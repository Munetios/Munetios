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
  recoverDeletedAccount,
  verifyAccountPassword,
} from "../../../lib/authSecurity.js";
import { getSignedInCookie } from "../../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  if (!assertSameOrigin(request))
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  const payload = await request.json().catch(() => null);
  const rateLimit = consumeRateLimit({
    key: `account-delete-recovery:${getRequestFingerprint(request)}`,
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed)
    return Response.json(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      {
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rateLimit.retryAfter),
        },
        status: 429,
      },
    );
  const account = getAccountById(String(payload?.accountId || ""));
  if (!account || !(await verifyAccountPassword(account, payload?.password))) {
    return Response.json(
      { error: "password_verification_failed" },
      { status: 400 },
    );
  }
  const recovered = recoverDeletedAccount(account.id);
  if (recovered.error) return Response.json(recovered, { status: 409 });
  const session = createAccountSession(
    recovered.account,
    getRequestCookie(request, accountCollectionCookieName),
    getSessionMetadata(request),
  );
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", getSessionCookie(request, session.token));
  headers.append("Set-Cookie", getSignedInCookie(request));
  headers.append(
    "Set-Cookie",
    getAccountCollectionCookie(request, session.accountCollectionToken),
  );
  return Response.json({ authenticated: true, recovered: true }, { headers });
}
