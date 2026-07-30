import { createHash, timingSafeEqual } from "node:crypto";
import {
  accountCollectionCookieName,
  createAccountSession,
  getAccountById,
  getAccountCollectionCookie,
  getAccountData,
  getRequestCookie,
  getSessionCookie,
  getSessionMetadata,
} from "../../../../../lib/authSecurity.js";
import { getSignedInCookie } from "../../../../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  const { businessId, token } = await params;
  const settings = getAccountData(businessId, "business-admin", {});
  const received = createHash("sha256")
    .update(String(token || ""))
    .digest();
  const card = (settings.quickCards || []).find((entry) => {
    if (!/^[a-f\d]{64}$/i.test(entry.tokenHash || "")) return false;
    const expected = Buffer.from(entry.tokenHash, "hex");
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  });
  const member = (settings.members || []).find(
    (entry) =>
      entry.id === card?.memberId &&
      entry.status === "active" &&
      entry.accountId,
  );
  const account = member ? getAccountById(member.accountId) : null;
  if (!card || !account) {
    return Response.json(
      { error: "quickcard_invalid" },
      { headers: { "Cache-Control": "no-store" }, status: 404 },
    );
  }

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
  return Response.json({ authenticated: true }, { headers });
}
