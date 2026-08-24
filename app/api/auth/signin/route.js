import {
  accountCollectionCookieName,
  assertSameOrigin,
  consumeRateLimit,
  createAccountSession,
  findDeletedAccountByIdentifier,
  getAccountByIdentifier,
  getAccountCollectionCookie,
  getAccountLifecycle,
  getRequestCookie,
  getRequestFingerprint,
  getSessionCookie,
  getSessionMetadata,
  verifyAccountPassword,
} from "../../../lib/authSecurity.js";
import { getSignedInCookie } from "../../../lib/signedInCookie.js";
import {
  createSignInChallenge,
  getTwoFactorState,
} from "../../../lib/twoFactorSecurity.js";

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
    const deleted = findDeletedAccountByIdentifier(identifier);
    if (deleted?.account) {
      const validDeletedPassword = await verifyAccountPassword(
        deleted.account,
        payload?.password,
      );
      if (!validDeletedPassword) {
        return response({ error: "invalid_credentials" }, { status: 401 });
      }
      return response(
        {
          accountId: deleted.account.id,
          error: "account_deleted",
          purgeAt: deleted.lifecycle.purgeAt,
        },
        { status: 410 },
      );
    }
    return response({ error: "account_not_found" }, { status: 404 });
  }
  const validPassword = await verifyAccountPassword(account, payload?.password);
  if (!validPassword) {
    return response({ error: "invalid_credentials" }, { status: 401 });
  }
  const lifecycle = getAccountLifecycle(account.id);
  if (lifecycle.archived) {
    return response(
      { accountId: account.id, error: "account_archived" },
      { status: 423 },
    );
  }

  const twoFactor = getTwoFactorState(account.id);
  if (twoFactor.enabled) {
    return response(
      {
        challengeId: createSignInChallenge(account.id),
        error: "two_factor_required",
        recoveryCodeAllowed: twoFactor.recoveryCodesRemaining > 0,
      },
      { status: 202 },
    );
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
