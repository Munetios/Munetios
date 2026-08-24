import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  getAccountById,
  getSessionCookie,
  markAccountDeleted,
  verifyAccountPassword,
} from "../../../lib/authSecurity.js";
import { enforceStudentRestriction } from "../../../lib/education.js";
import { getSignedInCookie } from "../../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  if (!assertSameOrigin(request))
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const educationResponse = enforceStudentRestriction(session, "danger_zone");
  if (educationResponse) return educationResponse;
  if (session.demo)
    return Response.json({ error: "unsupported_account" }, { status: 400 });
  const payload = await request.json().catch(() => null);
  if (
    !Array.isArray(payload?.confirmations) ||
    payload.confirmations.filter(Boolean).length !== 5
  ) {
    return Response.json({ error: "confirmations_required" }, { status: 400 });
  }
  const account = getAccountById(session.user.id);
  if (!(await verifyAccountPassword(account, payload?.password))) {
    return Response.json(
      { error: "password_verification_failed" },
      { status: 400 },
    );
  }
  const lifecycle = markAccountDeleted(account.id);
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", getSessionCookie(request, "", 0));
  headers.append("Set-Cookie", getSignedInCookie(request, "", 0));
  return Response.json(
    { deleted: true, purgeAt: lifecycle.purgeAt },
    {
      headers,
    },
  );
}
