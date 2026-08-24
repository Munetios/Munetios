import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  changeAccountPassword,
  consumeRateLimit,
  getAccountById,
  getAccountData,
  getRequestFingerprint,
  getSessionCookie,
  listAccountPasskeys,
  listAccountSessions,
  normalizeEmail,
  setAccountData,
  setAccountSessionLocation,
  signOutAccountSession,
  verifyAccountPassword,
} from "../../../lib/authSecurity.js";
import { enforceStudentRestriction } from "../../../lib/education.js";
import { lookupIpLocation } from "../../../lib/ipGeolocation.js";
import {
  createSensitiveGrantCookie,
  getTwoFactorState,
  hasSensitiveGrant,
  verifyAccountSecondFactor,
} from "../../../lib/twoFactorSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function describeUserAgent(userAgent) {
  const value = String(userAgent || "");
  const os = /Windows/i.test(value)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(value)
      ? "iOS"
      : /Android/i.test(value)
        ? "Android"
        : /Mac OS|Macintosh/i.test(value)
          ? "macOS"
          : /Linux/i.test(value)
            ? "Linux"
            : "Other";
  const browser = /Edg\//i.test(value)
    ? "Microsoft Edge"
    : /Firefox\//i.test(value)
      ? "Firefox"
      : /Chrome\//i.test(value)
        ? "Chrome"
        : /Safari\//i.test(value)
          ? "Safari"
          : "Browser";
  const mobile = /Mobile|Android|iPhone|iPad/i.test(value);
  const androidModel = value.match(
    /Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/|;|\))/i,
  )?.[1];
  const device = /iPad/i.test(value)
    ? "iPad"
    : /iPhone/i.test(value)
      ? "iPhone"
      : androidModel
        ? androidModel.trim()
        : /Android/i.test(value)
          ? "Android device"
          : `${os} ${mobile ? "device" : "desktop"}`;
  return {
    browser,
    deviceName: `${device} · ${browser}`,
    icon: mobile ? "smartphone" : "computer",
    os,
  };
}

export async function GET(request) {
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return authResponse;
  if (session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const security = getAccountData(session.user.id, "security", {});
  const twoFactor = getTwoFactorState(session.user.id);
  const sessions = await Promise.all(
    listAccountSessions(session.user.id).map(async (deviceSession) => {
      const resolvedLocation = await lookupIpLocation(deviceSession.ipAddress);
      const storedLocation = /^(?:IP\s|Unknown location$)/i.test(
        String(deviceSession.location || ""),
      )
        ? ""
        : deviceSession.location;
      if (resolvedLocation && resolvedLocation !== deviceSession.location) {
        setAccountSessionLocation(
          session.user.id,
          deviceSession.id,
          resolvedLocation,
        );
      }
      return {
        ...deviceSession,
        ...describeUserAgent(deviceSession.userAgent),
        current: deviceSession.id === session.sessionId,
        ipAddress: undefined,
        location: resolvedLocation || storedLocation || "Local device",
        userAgent: undefined,
      };
    }),
  );
  return response({
    lockdownMode: Boolean(security.lockdownMode),
    passkeyCount: listAccountPasskeys(session.user.id).length,
    recoveryEmail: security.recoveryEmail || "",
    sessions,
    trustedDevices: twoFactor.trustedDevices.map((device) => {
      const described = describeUserAgent(device.userAgent || device.label);
      return {
        createdAt: device.createdAt,
        deviceName: `${described.browser} · ${described.os}`,
        expiresAt: device.expiresAt,
        id: device.id,
      };
    }),
    twoFactorEnabled: twoFactor.enabled,
    recoveryCodesRemaining: twoFactor.recoveryCodesRemaining,
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return authResponse;
  if (session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const rateLimit = consumeRateLimit({
    key: `account-security:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return response(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      { headers: { "Retry-After": String(rateLimit.retryAfter) }, status: 429 },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, { status: 400 });
  }
  const action = String(payload?.action || "");

  if (["change_password", "recovery_email", "lockdown_mode"].includes(action)) {
    const educationResponse = enforceStudentRestriction(session, "security");
    if (educationResponse) return educationResponse;
  }

  if (action === "verify_password") {
    const verified = await verifyAccountPassword(
      getAccountById(session.user.id),
      payload.password,
    );
    return verified
      ? response({ verified: true })
      : response({ error: "password_verification_failed" }, { status: 400 });
  }

  if (action === "verify_sensitive") {
    const twoFactor = getTwoFactorState(session.user.id);
    const verified = twoFactor.enabled
      ? verifyAccountSecondFactor(session.user.id, payload.code)
      : await verifyAccountPassword(
          getAccountById(session.user.id),
          payload.password,
        );
    return verified
      ? response(
          {
            method: twoFactor.enabled ? "two_factor" : "password",
            verified: true,
          },
          {
            headers: {
              "Set-Cookie": createSensitiveGrantCookie(
                request,
                session.user.id,
              ),
            },
          },
        )
      : response({ error: "sensitive_verification_failed" }, { status: 401 });
  }

  const currentSecurity = getAccountData(session.user.id, "security", {});
  if (
    currentSecurity.lockdownMode &&
    !hasSensitiveGrant(request, session.user.id)
  ) {
    return response(
      { error: "sensitive_verification_required" },
      { status: 403 },
    );
  }

  if (action === "change_password") {
    const changed = await changeAccountPassword(
      session.user.id,
      payload.currentPassword,
      payload.newPassword,
    );
    return changed
      ? response({ changed: true })
      : response({ error: "password_change_failed" }, { status: 400 });
  }

  if (action === "recovery_email") {
    const recoveryEmail = normalizeEmail(payload.recoveryEmail);
    if (!recoveryEmail || recoveryEmail === session.user.email.toLowerCase()) {
      return response({ error: "invalid_recovery_email" }, { status: 400 });
    }
    const security = getAccountData(session.user.id, "security", {});
    setAccountData(session.user.id, "security", {
      ...security,
      recoveryEmail,
      updatedAt: new Date().toISOString(),
    });
    return response({ recoveryEmail, saved: true });
  }

  if (action === "lockdown_mode") {
    if (!hasSensitiveGrant(request, session.user.id)) {
      return response(
        { error: "sensitive_verification_required" },
        { status: 403 },
      );
    }
    const security = getAccountData(session.user.id, "security", {});
    const lockdownMode = payload.enabled === true;
    setAccountData(session.user.id, "security", {
      ...security,
      lockdownMode,
      updatedAt: new Date().toISOString(),
    });
    return response({ lockdownMode, saved: true });
  }

  if (action === "sign_out_session") {
    const sessionId = String(payload.sessionId || "");
    if (!/^[a-f\d]{64}$/i.test(sessionId)) {
      return response({ error: "invalid_session" }, { status: 400 });
    }
    const current = sessionId === session.sessionId;
    if (!signOutAccountSession(session.user.id, sessionId)) {
      return response({ error: "session_signout_failed" }, { status: 404 });
    }
    return response(
      { current, signedOut: true },
      current
        ? {
            headers: {
              "Set-Cookie": getSessionCookie(request, "", 0),
            },
          }
        : {},
    );
  }

  return response({ error: "invalid_action" }, { status: 400 });
}
