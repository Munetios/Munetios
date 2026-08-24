import {
  getAccountById,
  getAccountData,
  isStrongPassword,
  permanentlyDeleteAccount,
  setAccountData,
  updateAccountPassword,
  updateManagedAccountProfile,
} from "./authSecurity.js";

const educationProfileKey = "education-profile-v1";
const teacherStudentsKey = "education-students-v1";
const teacherAssignmentsKey = "education-assignments-v1";

function cleanText(value, maximum = 160) {
  return String(value || "")
    .trim()
    .slice(0, maximum);
}

export function getEducationProfile(accountId) {
  const stored = getAccountData(accountId, educationProfileKey, null);
  if (!stored || !["teacher", "student"].includes(stored.role)) return null;
  return {
    aiAllowed: stored.role === "teacher" || stored.aiAllowed === true,
    role: stored.role,
    teacherId: cleanText(stored.teacherId, 80),
    schoolAddress: cleanText(stored.schoolAddress, 240),
    schoolAddressPromptDismissed: Boolean(stored.schoolAddressPromptDismissed),
  };
}

export function setEducationProfile(accountId, profile) {
  const current = getEducationProfile(accountId) || {};
  return setAccountData(accountId, educationProfileKey, {
    ...current,
    ...profile,
    aiAllowed:
      (profile.role || current.role) === "teacher"
        ? true
        : Boolean(profile.aiAllowed ?? current.aiAllowed),
    role: profile.role || current.role,
    teacherId: cleanText(profile.teacherId ?? current.teacherId, 80),
    schoolAddress: cleanText(
      profile.schoolAddress ?? current.schoolAddress,
      240,
    ),
    schoolAddressPromptDismissed: Boolean(
      profile.schoolAddressPromptDismissed ??
        current.schoolAddressPromptDismissed,
    ),
  });
}

export function addStudentToTeacher(teacherId, studentId) {
  const current = getAccountData(teacherId, teacherStudentsKey, []);
  const studentIds = Array.from(
    new Set([...(Array.isArray(current) ? current : []), studentId]),
  ).slice(0, 500);
  setAccountData(teacherId, teacherStudentsKey, studentIds);
  setEducationProfile(studentId, { role: "student", teacherId });
  return studentIds;
}

export function listTeacherStudents(teacherId) {
  const studentIds = getAccountData(teacherId, teacherStudentsKey, []);
  return (Array.isArray(studentIds) ? studentIds : []).flatMap((studentId) => {
    const account = getAccountById(studentId);
    const profile = getEducationProfile(studentId);
    const storedProfile = getAccountData(studentId, "profile", {});
    if (!account || profile?.teacherId !== teacherId) return [];
    return [
      {
        aiAllowed: profile.aiAllowed,
        bio: cleanText(storedProfile.bio, 1000),
        birthDate: account.birthDate,
        email: account.email,
        firstName: account.firstName,
        gender: account.gender,
        id: account.id,
        lastName: account.lastName,
        name: account.name,
      },
    ];
  });
}

export function isStudentAccount(accountId) {
  return getEducationProfile(accountId)?.role === "student";
}

export function isEducationAccount(accountId) {
  return Boolean(getEducationProfile(accountId));
}

export function enforceStudentRestriction(session, capability) {
  const profile = getEducationProfile(session?.user?.id);
  if (profile?.role !== "student") return null;
  return Response.json(
    {
      capability,
      error: "education_account_restricted",
      message: "This setting is managed by your teacher.",
    },
    { headers: { "Cache-Control": "no-store" }, status: 403 },
  );
}

export function enforceStudentAiAccess(session) {
  const profile = getEducationProfile(session?.user?.id);
  if (profile?.role !== "student" || profile.aiAllowed) return null;
  return Response.json(
    {
      error: "education_ai_blocked",
      message: "Munetios AI isn't available for your account.",
    },
    { headers: { "Cache-Control": "no-store" }, status: 403 },
  );
}

const restrictedStudentAiCapabilities = new Set([
  "agent",
  "image_creation",
  "images",
  "my_bots",
  "sharing",
]);

export function enforceStudentAiCapability(session, capability) {
  const accessResponse = enforceStudentAiAccess(session);
  if (accessResponse) return accessResponse;
  const profile = getEducationProfile(session?.user?.id);
  if (
    profile?.role !== "student" ||
    !restrictedStudentAiCapabilities.has(capability)
  ) {
    return null;
  }
  return Response.json(
    {
      capability,
      error: "education_ai_feature_restricted",
      message: "This Munetios AI feature isn't available for student accounts.",
    },
    { headers: { "Cache-Control": "no-store" }, status: 403 },
  );
}

export function deleteTeacherManagedStudent(teacherId, studentId) {
  const student = listTeacherStudents(teacherId).find(
    (item) => item.id === studentId,
  );
  if (!student) return false;
  const deleted = permanentlyDeleteAccount(studentId);
  if (!deleted) return false;
  const current = getAccountData(teacherId, teacherStudentsKey, []);
  setAccountData(
    teacherId,
    teacherStudentsKey,
    (Array.isArray(current) ? current : []).filter((id) => id !== studentId),
  );
  return true;
}

export async function updateTeacherManagedStudent(
  teacherId,
  studentId,
  settings,
) {
  const student = listTeacherStudents(teacherId).find(
    (item) => item.id === studentId,
  );
  if (!student) return null;
  const profile = getEducationProfile(studentId);
  if (settings.password && !isStrongPassword(settings.password)) return null;
  let account = getAccountById(studentId);
  if (settings.profile) {
    if (
      typeof settings.profile.bio !== "string" ||
      settings.profile.bio.trim().length > 1000
    ) {
      return null;
    }
    account = updateManagedAccountProfile(studentId, settings.profile);
    if (!account) return null;
    const storedProfile = getAccountData(studentId, "profile", {});
    setAccountData(studentId, "profile", {
      ...storedProfile,
      birthday: account.birthDate,
      bio: settings.profile.bio.trim(),
      email: account.email,
      gender: account.gender,
      name: account.name,
    });
  }
  if (Object.hasOwn(settings, "aiAllowed")) {
    setEducationProfile(studentId, {
      ...profile,
      aiAllowed: settings.aiAllowed === true,
    });
  }
  if (settings.password) {
    const changed = await updateAccountPassword(studentId, settings.password);
    if (!changed) return null;
  }
  return listTeacherStudents(teacherId).find((item) => item.id === studentId);
}

export function assignTeacherTask(teacherId, studentId, task) {
  const student = listTeacherStudents(teacherId).find(
    (item) => item.id === studentId,
  );
  if (!student) return null;
  const current = getAccountData(studentId, teacherAssignmentsKey, []);
  const now = new Date().toISOString();
  const assignment = {
    completed: false,
    completedAt: "",
    createdAt: now,
    description: cleanText(task.description, 1000),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate || "") ? task.dueDate : "",
    id: `teacher-task-${crypto.randomUUID()}`,
    studentId,
    teacherId,
    title: cleanText(task.title, 160),
    updatedAt: now,
  };
  if (!assignment.title) return null;
  setAccountData(
    studentId,
    teacherAssignmentsKey,
    [...(Array.isArray(current) ? current : []), assignment].slice(-1000),
  );
  return assignment;
}

export function listStudentAssignments(studentId) {
  const current = getAccountData(studentId, teacherAssignmentsKey, []);
  return (Array.isArray(current) ? current : []).filter(
    (task) => task?.studentId === studentId && task?.teacherId,
  );
}

export function updateStudentAssignment(studentId, assignmentId, completed) {
  const current = listStudentAssignments(studentId);
  let updated = null;
  const now = new Date().toISOString();
  const next = current.map((task) => {
    if (task.id !== assignmentId) return task;
    updated = {
      ...task,
      completed: Boolean(completed),
      completedAt: completed ? now : "",
      updatedAt: now,
    };
    return updated;
  });
  if (!updated) return null;
  setAccountData(studentId, teacherAssignmentsKey, next);
  return updated;
}
