import { auth } from "../../../../auth.js";
import {
  assertSameOrigin,
  changeAccountPassword,
  consumeRateLimit,
  getAccountById,
  getAccountData,
  getRequestFingerprint,
  listAccountPasskeys,
  listAccountSessions,
  normalizeEmail,
  setAccountData,
  signOutAccountSession,
  signOutAllAccountSessions,
  verifyAccountPassword,
} from "../../../lib/authSecurity.js";

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
  return { browser, icon: mobile ? "smartphone" : "computer", os };
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const security = getAccountData(session.user.id, "security", {});
  const sessions = listAccountSessions(session.user.id).map(
    (deviceSession) => ({
      ...deviceSession,
      ...describeUserAgent(deviceSession.userAgent),
      current: deviceSession.id === session.sessionId,
      ipAddress: undefined,
      userAgent: undefined,
    }),
  );
  return response({
    lockdownMode: Boolean(security.lockdownMode),
    passkeyCount: listAccountPasskeys(session.user.id).length,
    recoveryEmail: security.recoveryEmail || "",
    sessions,
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
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

  if (action === "verify_password") {
    const verified = await verifyAccountPassword(
      getAccountById(session.user.id),
      payload.password,
    );
    return verified
      ? response({ verified: true })
      : response({ error: "password_verification_failed" }, { status: 400 });
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
              "Set-Cookie":
                "munetios_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
            },
          }
        : {},
    );
  }

  if (action === "sign_out_all") {
    signOutAllAccountSessions(session.user.id);
    return response(
      { signedOut: true },
      {
        headers: {
          "Set-Cookie":
            "munetios_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        },
      },
    );
  }

  return response({ error: "invalid_action" }, { status: 400 });
}
