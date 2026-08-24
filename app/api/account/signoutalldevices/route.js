import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountData,
  getRequestFingerprint,
  signOutAllAccountSessions,
} from "../../../lib/authSecurity.js";
import { hasSensitiveGrant } from "../../../lib/twoFactorSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }

  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) {
    return authResponse;
  }
  if (session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const security = getAccountData(session.user.id, "security", {});
  if (security.lockdownMode && !hasSensitiveGrant(request, session.user.id)) {
    return response(
      { error: "sensitive_verification_required" },
      { status: 403 },
    );
  }

  const rateLimit = consumeRateLimit({
    key: `account-sign-out-all:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return response(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      { headers: { "Retry-After": String(rateLimit.retryAfter) }, status: 429 },
    );
  }

  signOutAllAccountSessions(session.user.id);
  return response({ signedOut: true });
}
