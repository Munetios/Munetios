import { auth, unauthorizedResponse } from "../../../../../auth.js";
import {
  accountCollectionCookieName,
  assertSameOrigin,
  createSessionForCollectionAccount,
  getRequestCookie,
  getSessionCookie,
  getSessionMetadata,
} from "../../../../lib/authSecurity.js";
import { getSignedInCookie } from "../../../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const currentSession = await auth(request);
  if (!currentSession || currentSession.demo) return unauthorizedResponse();

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const collectionToken = getRequestCookie(
    request,
    accountCollectionCookieName,
  );
  const session = createSessionForCollectionAccount(
    collectionToken,
    String(payload?.accountId || ""),
    getSessionMetadata(request),
  );
  if (!session) {
    return Response.json({ error: "account_not_available" }, { status: 403 });
  }
  return Response.json(
    { switched: true },
    {
      headers: [
        ["Cache-Control", "no-store"],
        ["Set-Cookie", getSessionCookie(request, session.token)],
        ["Set-Cookie", getSignedInCookie(request)],
      ],
    },
  );
}
