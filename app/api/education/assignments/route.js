import { requireAuth } from "../../../../auth.js";
import { assertSameOrigin } from "../../../lib/authSecurity.js";
import {
  getEducationProfile,
  listStudentAssignments,
  updateStudentAssignment,
} from "../../../lib/education.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (getEducationProfile(session.user.id)?.role !== "student") {
    return Response.json({ assignments: [] });
  }
  return Response.json(
    { assignments: listStudentAssignments(session.user.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (getEducationProfile(session.user.id)?.role !== "student") {
    return Response.json({ error: "student_required" }, { status: 403 });
  }
  const payload = await request.json().catch(() => null);
  const assignment = updateStudentAssignment(
    session.user.id,
    payload?.assignmentId,
    payload?.completed,
  );
  return assignment
    ? Response.json({ assignment })
    : Response.json({ error: "assignment_not_found" }, { status: 404 });
}
