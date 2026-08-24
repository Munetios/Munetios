import {
  accountCollectionCookieName,
  assertSameOrigin,
  consumeRateLimit,
  createAccountSession,
  getAccountById,
  getAccountCollectionCookie,
  getRequestCookie,
  getRequestFingerprint,
  getSessionCookie,
  getSessionMetadata,
} from "../../../../lib/authSecurity.js";
import { getSignedInCookie } from "../../../../lib/signedInCookie.js";
import {
  consumeSignInChallenge,
  verifyAccountSecondFactor,
} from "../../../../lib/twoFactorSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function respond(payload, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, { ...init, headers });
}

export async function POST(request) {
  if (!assertSameOrigin(request))
    return respond({ error: "invalid_origin" }, { status: 403 });
  const rateLimit = consumeRateLimit({
    key: `two-factor-signin:${getRequestFingerprint(request)}`,
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed)
    return respond({ error: "rate_limited" }, { status: 429 });
  const payload = await request.json().catch(() => ({}));
  const accountId = consumeSignInChallenge(payload.challengeId);
  if (!accountId || !verifyAccountSecondFactor(accountId, payload.code)) {
    return respond({ error: "invalid_two_factor_code" }, { status: 401 });
  }
  const account = getAccountById(accountId);
  if (!account)
    return respond({ error: "invalid_two_factor_challenge" }, { status: 401 });
  const metadata = getSessionMetadata(request);
  const session = createAccountSession(
    account,
    getRequestCookie(request, accountCollectionCookieName),
    metadata,
  );
  const headers = new Headers();
  headers.append("Set-Cookie", getSessionCookie(request, session.token));
  headers.append("Set-Cookie", getSignedInCookie(request));
  headers.append(
    "Set-Cookie",
    getAccountCollectionCookie(request, session.accountCollectionToken),
  );
  return respond({ authenticated: true }, { headers });
}
