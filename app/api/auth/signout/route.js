import {
  accountCollectionCookieName,
  assertSameOrigin,
  getAccountCollectionCookie,
  getRequestCookie,
  getSessionCookie,
  signOutAccountCollection,
  signOutSession,
} from "../../../lib/authSecurity.js";
import { deleteDurableSession } from "../../../lib/durableAuthStore.js";
import { getSignedInCookie } from "../../../lib/signedInCookie.js";

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
  const sessionToken = getRequestCookie(request, "munetios_session");
  signOutSession(sessionToken);
  await deleteDurableSession(sessionToken);
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", getSessionCookie(request, "", 0));
  headers.append("Set-Cookie", getSignedInCookie(request, "", 0));
  headers.append("Set-Cookie", getAccountCollectionCookie(request, "", 0));
  return Response.json(
    { signedOut: true },
    {
      headers,
    },
  );
}
