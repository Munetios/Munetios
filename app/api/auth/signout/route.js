import {
  accountCollectionCookieName,
  assertSameOrigin,
  getAccountCollectionCookie,
  getRequestCookie,
  getSessionCookie,
  signOutAccountCollection,
  signOutSession,
} from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  const collectionToken = getRequestCookie(
    request,
    accountCollectionCookieName,
  );
  if (collectionToken) signOutAccountCollection(collectionToken);
  signOutSession(getRequestCookie(request, "munetios_session"));
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", getSessionCookie("", 0));
  headers.append("Set-Cookie", getAccountCollectionCookie("", 0));
  return Response.json(
    { signedOut: true },
    {
      headers,
    },
  );
}
