import QRCode from "qrcode";
import { requireAuth } from "../../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountData,
  getRequestFingerprint,
  getSessionMetadata,
} from "../../../../lib/authSecurity.js";
import { enforceStudentRestriction } from "../../../../lib/education.js";
import {
  beginTwoFactorSetup,
  completeTwoFactorSetup,
  disableTwoFactor,
  getAccountRecoveryCodes,
  getTrustedDeviceCookie,
  getTwoFactorState,
  hasSensitiveGrant,
  removeTrustedDevice,
  trustDevice,
} from "../../../../lib/twoFactorSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function respond(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request))
    return respond({ error: "invalid_origin" }, { status: 403 });
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const educationResponse = enforceStudentRestriction(session, "two_factor");
  if (educationResponse) return educationResponse;
  const rateLimit = consumeRateLimit({
    key: `two-factor-setup:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed)
    return respond({ error: "rate_limited" }, { status: 429 });
  const payload = await request.json().catch(() => ({}));
  const security = getAccountData(session.user.id, "security", {});
  const sensitiveAction = [
    "recovery_codes",
    "disable",
    "remove_trusted_device",
    "trust_current_device",
  ].includes(payload.action);
  if (sensitiveAction && !hasSensitiveGrant(request, session.user.id)) {
    return respond(
      { error: "sensitive_verification_required" },
      { status: 403 },
    );
  }
  if (security.lockdownMode && !hasSensitiveGrant(request, session.user.id)) {
    return respond(
      { error: "sensitive_verification_required" },
      { status: 403 },
    );
  }
  if (payload.action === "begin") {
    if (getTwoFactorState(session.user.id).enabled) {
      return respond({ error: "two_factor_already_enabled" }, { status: 409 });
    }
    const setup = beginTwoFactorSetup(session.user.id, session.user.email);
    return respond({
      qrCode: await QRCode.toDataURL(setup.otpauthUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 280,
      }),
      secret: setup.secret,
      setupId: setup.setupId,
    });
  }
  if (payload.action === "complete") {
    const recoveryCodes = completeTwoFactorSetup(
      session.user.id,
      payload.setupId,
      payload.code,
    );
    return recoveryCodes
      ? respond({ enabled: true, recoveryCodes })
      : respond({ error: "invalid_two_factor_code" }, { status: 400 });
  }
  if (payload.action === "disable") {
    return disableTwoFactor(session.user.id)
      ? respond(
          { disabled: true },
          {
            headers: {
              "Set-Cookie": getTrustedDeviceCookie(request, "", 0),
            },
          },
        )
      : respond({ error: "two_factor_not_enabled" }, { status: 409 });
  }
  if (payload.action === "remove_trusted_device") {
    return removeTrustedDevice(session.user.id, String(payload.deviceId || ""))
      ? respond({ removed: true })
      : respond({ error: "trusted_device_not_found" }, { status: 404 });
  }
  if (payload.action === "trust_current_device") {
    if (!getTwoFactorState(session.user.id).enabled) {
      return respond({ error: "two_factor_required" }, { status: 409 });
    }
    const trusted = trustDevice(
      session.user.id,
      getSessionMetadata(request).userAgent,
    );
    return respond(
      { trusted: true },
      {
        headers: {
          "Set-Cookie": getTrustedDeviceCookie(request, trusted.token),
        },
      },
    );
  }
  if (payload.action === "recovery_codes") {
    return respond({ recoveryCodes: getAccountRecoveryCodes(session.user.id) });
  }
  return respond({ error: "invalid_action" }, { status: 400 });
}
