import {
  accountCollectionCookieName,
  assertSameOrigin,
  consumeRateLimit,
  createAccountSession,
  getAccountByIdentifier,
  getAccountCollectionCookie,
  getRequestCookie,
  getRequestFingerprint,
  getSessionCookie,
  getSessionMetadata,
  verifyAccountPassword,
} from "../../../lib/authSecurity.js";
import { getSignedInCookie } from "../../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, {
    ...init,
    headers,
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }

  const fingerprint = getRequestFingerprint(request);
  const rateLimit = consumeRateLimit({
    key: `signin:${fingerprint}`,
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return response(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      {
        headers: { "Retry-After": String(rateLimit.retryAfter) },
        status: 429,
      },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, { status: 400 });
  }

  const identifier = String(payload?.identifier || "")
    .trim()
    .toLowerCase();

  const account = getAccountByIdentifier(identifier);
  if (!account) {
    return response({ error: "account_not_found" }, { status: 404 });
  }
  const validPassword = await verifyAccountPassword(account, payload?.password);
  if (!validPassword) {
    return response({ error: "invalid_credentials" }, { status: 401 });
  }

  const session = createAccountSession(
    account,
    getRequestCookie(request, accountCollectionCookieName),
    getSessionMetadata(request),
  );
  const headers = new Headers();
  headers.append("Set-Cookie", getSessionCookie(request, session.token));
  headers.append("Set-Cookie", getSignedInCookie(request));
  headers.append(
    "Set-Cookie",
    getAccountCollectionCookie(request, session.accountCollectionToken),
  );
  return response(
    {
      authenticated: true,
      user: { email: account.email, id: account.id, name: account.name },
    },
    { headers },
  );
}
