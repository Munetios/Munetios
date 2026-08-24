import { requireAuth } from "../../../../auth.js";
import { assertSameOrigin } from "../../../lib/authSecurity.js";
import {
  getEducationProfile,
  setEducationProfile,
} from "../../../lib/education.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  return Response.json(
    { profile: getEducationProfile(session.user.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const current = getEducationProfile(session.user.id);
  if (current?.role !== "teacher") {
    return Response.json({ error: "teacher_required" }, { status: 403 });
  }
  const payload = await request.json().catch(() => null);
  const profile = setEducationProfile(session.user.id, {
    schoolAddress: payload?.schoolAddress,
    schoolAddressPromptDismissed: true,
  });
  return Response.json({ profile });
}
