import { requireAuth } from "../../../../auth.js";
import {
  accountCollectionCookieName,
  assertSameOrigin,
  consumeRateLimit,
  createAccountSession,
  getAccountById,
  getAccountCollectionCookie,
  getAccountData,
  getRequestCookie,
  getRequestFingerprint,
  getSessionCookie,
  getSessionMetadata,
  setAccountArchived,
  verifyAccountPassword,
} from "../../../lib/authSecurity.js";
import { enforceStudentRestriction } from "../../../lib/education.js";
import { getSignedInCookie } from "../../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(payload, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, {
    ...init,
    headers,
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request))
    return json({ error: "invalid_origin" }, { status: 403 });
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const educationResponse = enforceStudentRestriction(session, "danger_zone");
  if (educationResponse) return educationResponse;
  if (session.demo)
    return json({ error: "unsupported_account" }, { status: 400 });
  const payload = await request.json().catch(() => null);
  const account = getAccountById(session.user.id);
  if (!(await verifyAccountPassword(account, payload?.password))) {
    return json({ error: "password_verification_failed" }, { status: 400 });
  }
  setAccountArchived(account.id, true);
  const profile = getAccountData(account.id, "profile", {});
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", getSessionCookie(request, "", 0));
  headers.append("Set-Cookie", getSignedInCookie(request, "", 0));
  return json(
    {
      account: {
        archived: true,
        avatar: profile.avatar,
        email: profile.email || account.email,
        id: account.id,
        name: profile.name || account.name,
        profilePictureUrl: profile.profilePictureUrl || null,
      },
      archived: true,
    },
    { headers },
  );
}

export async function PUT(request) {
  if (!assertSameOrigin(request))
    return json({ error: "invalid_origin" }, { status: 403 });
  const payload = await request.json().catch(() => null);
  const rateLimit = consumeRateLimit({
    key: `account-unarchive:${getRequestFingerprint(request)}`,
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed)
    return json(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      {
        headers: { "Retry-After": String(rateLimit.retryAfter) },
        status: 429,
      },
    );
  const account = getAccountById(String(payload?.accountId || ""));
  if (!account || !(await verifyAccountPassword(account, payload?.password))) {
    return json({ error: "password_verification_failed" }, { status: 400 });
  }
  setAccountArchived(account.id, false);
  const session = createAccountSession(
    account,
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
  return json({ archived: false, authenticated: true }, { headers });
}
