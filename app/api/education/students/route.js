import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  createAccount,
  createAvailableUsername,
  getAge,
  getRequestFingerprint,
  isContactUsed,
  isStrongPassword,
  normalizeEmail,
  verifyCaptcha,
} from "../../../lib/authSecurity.js";
import {
  addStudentToTeacher,
  assignTeacherTask,
  deleteTeacherManagedStudent,
  getEducationProfile,
  listTeacherStudents,
  updateTeacherManagedStudent,
} from "../../../lib/education.js";

export const dynamic = "force-dynamic";

function teacherRequired(session) {
  return getEducationProfile(session.user.id)?.role === "teacher";
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (!teacherRequired(session)) {
    return Response.json({ error: "teacher_required" }, { status: 403 });
  }
  return Response.json(
    { students: listTeacherStudents(session.user.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (!teacherRequired(session)) {
    return Response.json({ error: "teacher_required" }, { status: 403 });
  }
  const payload = await request.json().catch(() => null);
  if (payload?.action === "assign_task") {
    const assignment = assignTeacherTask(session.user.id, payload.studentId, {
      description: payload.description,
      dueDate: payload.dueDate,
      title: payload.title,
    });
    return assignment
      ? Response.json({ assignment }, { status: 201 })
      : Response.json({ error: "invalid_assignment" }, { status: 400 });
  }
  if (
    !verifyCaptcha({
      answer: payload?.captchaAnswer,
      challengeId: payload?.captchaChallengeId,
      fingerprint: getRequestFingerprint(request),
    })
  ) {
    return Response.json({ error: "invalid_captcha" }, { status: 400 });
  }
  const email = normalizeEmail(payload?.email);
  const firstName = String(payload?.firstName || "").trim();
  const lastName = String(payload?.lastName || "").trim();
  const age = getAge(payload?.birthDate);
  if (
    !email ||
    !firstName ||
    !lastName ||
    age === null ||
    age >= 18 ||
    !["woman", "man", "nonbinary", "other"].includes(payload?.gender) ||
    !isStrongPassword(payload?.password) ||
    payload?.password !== payload?.confirmPassword
  ) {
    return Response.json({ error: "invalid_student_details" }, { status: 400 });
  }
  if (isContactUsed(email)) {
    return Response.json({ error: "email_taken" }, { status: 409 });
  }
  const account = await createAccount({
    birthDate: payload.birthDate,
    contact: email,
    contactType: "email",
    email,
    firstName,
    gender: payload?.gender,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    password: payload.password,
    username: createAvailableUsername(email.split("@")[0]),
  });
  if (!account) {
    return Response.json({ error: "email_taken" }, { status: 409 });
  }
  addStudentToTeacher(session.user.id, account.id);
  const student = listTeacherStudents(session.user.id).find(
    (item) => item.id === account.id,
  );
  return Response.json({ student }, { status: 201 });
}

export async function PATCH(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (!teacherRequired(session)) {
    return Response.json({ error: "teacher_required" }, { status: 403 });
  }
  const payload = await request.json().catch(() => null);
  if (!payload?.studentId || typeof payload.settings !== "object") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const student = await updateTeacherManagedStudent(
    session.user.id,
    String(payload.studentId),
    payload.settings,
  );
  return student
    ? Response.json({ student })
    : Response.json({ error: "invalid_student_settings" }, { status: 400 });
}

export async function DELETE(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (!teacherRequired(session)) {
    return Response.json({ error: "teacher_required" }, { status: 403 });
  }
  const payload = await request.json().catch(() => null);
  const studentId = String(payload?.studentId || "").trim();
  if (!studentId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  return deleteTeacherManagedStudent(session.user.id, studentId)
    ? Response.json({ deleted: true })
    : Response.json({ error: "student_not_found" }, { status: 404 });
}
