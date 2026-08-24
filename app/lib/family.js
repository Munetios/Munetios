import { randomUUID } from "node:crypto";
import {
  createAccount,
  createAvailableUsername,
  getAccountById,
  getAccountByIdentifier,
  getAccountData,
  getAge,
  isContactUsed,
  isStrongPassword,
  isUsernameUsed,
  normalizeEmail,
  permanentlyDeleteAccount,
  setAccountData,
} from "./authSecurity.js";
import { enforceStudentAiAccess, getEducationProfile } from "./education.js";

const familyKey = "family-v1";
const membershipKey = "family-membership-v1";
const subscriptionSharingKey = "subscription-sharing-v1";
const aiUsageLimitKey = "family-ai-usage-limit-v1";

export const familyRoles = Object.freeze({
  ADULT: "adult",
  CHILD: "child",
  TEEN: "teen",
});

export const usageLimitTypes = Object.freeze([
  "none",
  "hourly",
  "5hour",
  "daily",
  "weekly",
  "monthly",
]);

export const paymentApprovalLevels = Object.freeze([
  "allow",
  "require_approval",
  "disallow",
]);

const weekdayKeys = Object.freeze([
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
]);

function defaultSchedule() {
  return {
    days: Object.fromEntries(weekdayKeys.map((day) => [day, true])),
    enabled: false,
    end: "21:00",
    start: "07:00",
  };
}

function baseParentalControls() {
  return {
    aiSchedule: defaultSchedule(),
    allowAgentAi: false,
    allowChangeBirthday: true,
    allowCodeAi: true,
    allowConnectors: true,
    allowDeveloperMode: true,
    allowExportImport: true,
    allowGithub: true,
    allowHealthAi: false,
    allowImageGenerationAi: true,
    allowLocationAi: false,
    allowManageFamily: true,
    allowMeetJoinOutsideFamily: false,
    allowMeetRecordings: true,
    allowMunetiosAi: true,
    allowPasskeys: true,
    allowPayments: "require_approval",
    allowPersonalizationAi: false,
    allowTaskSharing: true,
    allowVoiceModeAi: true,
    allowWorkspaces: true,
    usageLimit: { maxRequests: 0, type: "none" },
  };
}

export function defaultParentalControlsForRole(role) {
  const controls = baseParentalControls();
  return sanitizeControlsForRole(role, controls);
}

function isValidTimeOfDay(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/u.test(String(value || ""));
}

function sanitizeSchedule(value) {
  const current = { ...defaultSchedule(), ...(value || {}) };
  return {
    days: Object.fromEntries(
      weekdayKeys.map((day) => [day, current.days?.[day] !== false]),
    ),
    enabled: current.enabled === true,
    end: isValidTimeOfDay(current.end) ? current.end : "21:00",
    start: isValidTimeOfDay(current.start) ? current.start : "07:00",
  };
}

function sanitizeUsageLimit(value) {
  const type = usageLimitTypes.includes(value?.type) ? value.type : "none";
  const maxRequests = Number.isFinite(Number(value?.maxRequests))
    ? Math.max(0, Math.min(100_000, Math.round(Number(value.maxRequests))))
    : 0;
  return { maxRequests, type };
}

function sanitizePaymentApproval(value) {
  return paymentApprovalLevels.includes(value) ? value : "require_approval";
}

export function sanitizeControlsForRole(role, controls = {}) {
  const merged = { ...baseParentalControls(), ...controls };
  const normalized = {
    ...merged,
    aiSchedule: sanitizeSchedule(merged.aiSchedule),
    allowPayments: sanitizePaymentApproval(merged.allowPayments),
    usageLimit: sanitizeUsageLimit(merged.usageLimit),
  };

  for (const key of Object.keys(normalized)) {
    if (
      key !== "aiSchedule" &&
      key !== "usageLimit" &&
      key !== "allowPayments" &&
      typeof normalized[key] !== "boolean"
    ) {
      normalized[key] = Boolean(normalized[key]);
    }
  }

  if (role === familyRoles.CHILD) {
    normalized.allowChangeBirthday = false;
    normalized.allowConnectors = false;
    normalized.allowDeveloperMode = false;
    normalized.allowGithub = false;
    normalized.allowManageFamily = false;
  }

  return normalized;
}

function emptyFamily(ownerId) {
  return {
    createdAt: new Date().toISOString(),
    id: randomUUID(),
    members: [],
    ownerId,
  };
}

function mapMember(account, role, existing = {}) {
  return {
    accountId: account.id,
    addedAt: existing.addedAt || new Date().toISOString(),
    avatarLetter: account.avatarLetter,
    email: account.email,
    id: existing.id || randomUUID(),
    name: account.name,
    parentalControls:
      role === familyRoles.ADULT
        ? null
        : sanitizeControlsForRole(role, existing.parentalControls || {}),
    role,
  };
}

export function getFamily(ownerId) {
  const stored = getAccountData(ownerId, familyKey, null);
  return stored && typeof stored === "object"
    ? { ...emptyFamily(ownerId), ...stored }
    : emptyFamily(ownerId);
}

function saveFamily(family) {
  setAccountData(family.ownerId, familyKey, family);
  return family;
}

export function getFamilyRecordForAccount(accountId) {
  if (!accountId) return null;

  const ownFamily = getAccountData(accountId, familyKey, null);
  if (ownFamily && Array.isArray(ownFamily.members)) {
    return { family: getFamily(accountId), isOwner: true, member: null };
  }

  const membership = getAccountData(accountId, membershipKey, null);
  if (!membership?.ownerId) return null;

  const family = getFamily(membership.ownerId);
  const member = family.members.find(
    (entry) => entry.id === membership.memberId,
  );
  if (!member) return null;

  return { family, isOwner: false, member };
}

export function canManageFamily(accountId) {
  const record = getFamilyRecordForAccount(accountId);
  if (!record) return true;
  if (record.isOwner) return true;
  if (record.member.role === familyRoles.ADULT) return true;
  if (record.member.role === familyRoles.TEEN) {
    return record.member.parentalControls?.allowManageFamily !== false;
  }
  return false;
}

export function resolveOwnerIdForActor(accountId) {
  const record = getFamilyRecordForAccount(accountId);
  if (record?.isOwner) return accountId;
  if (record?.family) return record.family.ownerId;
  return accountId;
}

export function listFamilyMembers(accountId) {
  const record = getFamilyRecordForAccount(accountId);
  if (!record) return { family: getFamily(accountId), isOwner: true };
  return record;
}

export function addFamilyMember(actingAccountId, { email, role }) {
  if (!canManageFamily(actingAccountId)) {
    return { error: "not_authorized" };
  }
  if (
    ![familyRoles.ADULT, familyRoles.TEEN, familyRoles.CHILD].includes(role)
  ) {
    return { error: "invalid_role" };
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { error: "invalid_email" };

  const target = getAccountByIdentifier(normalizedEmail);
  if (!target) return { error: "account_not_found" };

  const ownerId = resolveOwnerIdForActor(actingAccountId);
  if (target.id === ownerId) return { error: "cannot_add_self" };

  const family = getFamily(ownerId);
  if (family.members.some((member) => member.accountId === target.id)) {
    return { error: "already_member" };
  }
  if (getFamilyRecordForAccount(target.id)) {
    return { error: "already_in_family" };
  }

  const age = getAge(target.birthDate);
  const isAdult = age === null || age >= 18;
  if (isAdult && role !== familyRoles.ADULT) {
    return { error: "account_is_adult" };
  }

  const member = mapMember(target, role);
  family.members = [...family.members, member];
  saveFamily(family);
  setAccountData(target.id, membershipKey, {
    memberId: member.id,
    ownerId,
  });

  return { family, member };
}

export function removeFamilyMember(actingAccountId, memberId) {
  if (!canManageFamily(actingAccountId)) return { error: "not_authorized" };

  const ownerId = resolveOwnerIdForActor(actingAccountId);
  const family = getFamily(ownerId);
  const member = family.members.find((entry) => entry.id === memberId);
  if (!member) return { error: "member_not_found" };
  if (member.role === familyRoles.CHILD) {
    return { error: "child_deletion_required" };
  }

  family.members = family.members.filter((entry) => entry.id !== memberId);
  saveFamily(family);
  setAccountData(member.accountId, membershipKey, null);

  return { family };
}

export function deleteChildFamilyMember(actingAccountId, memberId) {
  if (!canManageFamily(actingAccountId)) return { error: "not_authorized" };

  const ownerId = resolveOwnerIdForActor(actingAccountId);
  const family = getFamily(ownerId);
  const member = family.members.find((entry) => entry.id === memberId);
  if (!member) return { error: "member_not_found" };
  if (member.role !== familyRoles.CHILD) {
    return { error: "child_account_required" };
  }
  if (!permanentlyDeleteAccount(member.accountId)) {
    return { error: "account_deletion_failed" };
  }

  family.members = family.members.filter((entry) => entry.id !== memberId);
  saveFamily(family);
  return { family };
}

export function updateParentalControls(actingAccountId, memberId, patch) {
  if (!canManageFamily(actingAccountId)) return { error: "not_authorized" };

  const ownerId = resolveOwnerIdForActor(actingAccountId);
  const family = getFamily(ownerId);
  const member = family.members.find((entry) => entry.id === memberId);
  if (!member) return { error: "member_not_found" };
  if (member.role === familyRoles.ADULT)
    return { error: "adults_have_no_controls" };
  if (member.accountId === actingAccountId) {
    return { error: "cannot_edit_own_controls" };
  }

  member.parentalControls = sanitizeControlsForRole(member.role, {
    ...member.parentalControls,
    ...patch,
  });
  saveFamily(family);

  return { family, member };
}

export async function createChildAccount(
  actingAccountId,
  { birthday, confirmPassword, email, firstName, gender, lastName, password },
) {
  if (!canManageFamily(actingAccountId)) return { error: "not_authorized" };
  const actingAccount = getAccountById(actingAccountId);
  const actingAge = getAge(actingAccount?.birthDate);
  if (actingAge === null || actingAge < 13) {
    return { error: "actor_age_restricted" };
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.endsWith("@munetios.com")) {
    return { error: "invalid_child_email" };
  }
  if (isContactUsed(normalizedEmail)) return { error: "email_in_use" };

  const age = getAge(String(birthday || ""));
  if (age === null || age >= 13) return { error: "invalid_birthday" };

  const trimmedFirstName = String(firstName || "").trim();
  const trimmedLastName = String(lastName || "").trim();
  if (!trimmedFirstName) {
    return { error: "invalid_name" };
  }
  if (password !== confirmPassword || !isStrongPassword(password)) {
    return { error: "invalid_password" };
  }

  const preferredUsername = normalizedEmail.split("@")[0];
  const username = createAvailableUsername(preferredUsername);
  if (!username || isUsernameUsed(username)) {
    return { error: "username_unavailable" };
  }

  const account = await createAccount({
    birthDate: birthday,
    contact: normalizedEmail,
    contactType: "email",
    email: normalizedEmail,
    firstName: trimmedFirstName,
    gender,
    lastName: trimmedLastName,
    name: [trimmedFirstName, trimmedLastName].filter(Boolean).join(" "),
    password,
    username,
  });
  if (!account) return { error: "account_creation_failed" };

  const ownerId = resolveOwnerIdForActor(actingAccountId);
  const family = getFamily(ownerId);
  const member = mapMember(
    { ...account, avatarLetter: account.avatarLetter || firstName?.[0] },
    familyRoles.CHILD,
  );
  family.members = [...family.members, member];
  saveFamily(family);
  setAccountData(account.id, membershipKey, {
    memberId: member.id,
    ownerId,
  });

  return { account, family, member };
}

export function getSubscriptionSharing(accountId) {
  return Boolean(getAccountData(accountId, subscriptionSharingKey, false));
}

export function setSubscriptionSharing(accountId, share) {
  setAccountData(accountId, subscriptionSharingKey, Boolean(share));
  return Boolean(share);
}

export function getEffectiveAiParentalControls(accountId) {
  const record = getFamilyRecordForAccount(accountId);
  if (!record || record.isOwner || !record.member) return null;
  if (record.member.role === familyRoles.ADULT) return null;
  return sanitizeControlsForRole(
    record.member.role,
    record.member.parentalControls || {},
  );
}

function isWithinSchedule(schedule, now = new Date()) {
  if (!schedule?.enabled) return true;
  const dayKey = weekdayKeys[now.getDay()];
  if (schedule.days?.[dayKey] === false) return false;

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMinute] = schedule.start.split(":").map(Number);
  const [endHour, endMinute] = schedule.end.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  return startMinutes <= endMinutes
    ? minutesNow >= startMinutes && minutesNow < endMinutes
    : minutesNow >= startMinutes || minutesNow < endMinutes;
}

function usageWindowStart(type, now = new Date()) {
  const next = new Date(now);
  if (type === "hourly") {
    next.setMinutes(0, 0, 0);
  } else if (type === "5hour") {
    next.setHours(Math.floor(next.getHours() / 5) * 5, 0, 0, 0);
  } else if (type === "daily") {
    next.setHours(0, 0, 0, 0);
  } else if (type === "weekly") {
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() - next.getDay());
  } else if (type === "monthly") {
    next.setHours(0, 0, 0, 0);
    next.setDate(1);
  }
  return next.toISOString();
}

function usageLimitState(accountId, usageLimit) {
  if (usageLimit.type === "none" || usageLimit.maxRequests <= 0) {
    return { allowed: true, used: 0 };
  }

  const windowStart = usageWindowStart(usageLimit.type);
  const stored = getAccountData(accountId, aiUsageLimitKey, {});
  const used =
    stored.windowStart === windowStart ? Number(stored.used) || 0 : 0;

  return { allowed: used < usageLimit.maxRequests, used };
}

// Increments the metered request count for a child/teen's configured AI usage
// window. Call this from the endpoint that actually performs an AI generation
// (not from read-only polling routes), otherwise background polling would
// exhaust the budget before the user sends a single message.
export function recordAiUsage(accountId) {
  const controls = getEffectiveAiParentalControls(accountId);
  if (!controls || controls.usageLimit.type === "none") return;
  const windowStart = usageWindowStart(controls.usageLimit.type);
  const stored = getAccountData(accountId, aiUsageLimitKey, {});
  const used =
    stored.windowStart === windowStart ? Number(stored.used) || 0 : 0;
  setAccountData(accountId, aiUsageLimitKey, { used: used + 1, windowStart });
}

export function enforceParentalAiAccess(session) {
  const accountId = session?.user?.id;
  if (!accountId) return null;

  const educationResponse = enforceStudentAiAccess(session);
  if (educationResponse) return educationResponse;
  if (getEducationProfile(accountId)?.role === "student") return null;

  const controls = getEffectiveAiParentalControls(accountId);
  if (!controls) return null;

  if (controls.allowMunetiosAi === false) {
    return parentalBlockedResponse("allowMunetiosAi");
  }
  if (!isWithinSchedule(controls.aiSchedule)) {
    return parentalBlockedResponse("aiSchedule");
  }
  if (!usageLimitState(accountId, controls.usageLimit).allowed) {
    return parentalBlockedResponse("usageLimit");
  }

  return null;
}

export function parentalBlockedResponse(
  control,
  message = "Ask your parent before you can use Munetios AI.",
) {
  return Response.json(
    {
      control,
      error: "parental_control_blocked",
      message,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Munetios-Parental-Control": control,
      },
      status: 403,
    },
  );
}

export function parentalApprovalRequiredResponse() {
  return Response.json(
    {
      control: "allowPayments",
      error: "parental_approval_required",
      message: "Ask your parent to approve this purchase.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Munetios-Parental-Control": "allowPayments",
      },
      status: 403,
    },
  );
}

export function isParentalConnectorBlocked(accountId, connectorId) {
  const controls = getEffectiveAiParentalControls(accountId);
  if (!controls) return false;
  if (connectorId === "github") {
    return controls.allowGithub === false || controls.allowConnectors === false;
  }
  return controls.allowConnectors === false;
}

export function enforceParentalConnectorAccess(session, { connectorId } = {}) {
  const accountId = session?.user?.id;
  if (!accountId) return null;
  if (!isParentalConnectorBlocked(accountId, connectorId)) return null;
  return parentalBlockedResponse(
    connectorId === "github" ? "allowGithub" : "allowConnectors",
    "Ask your parent before you can connect to connectors.",
  );
}

export function getParentalPaymentApproval(accountId) {
  const controls = getEffectiveAiParentalControls(accountId);
  return controls ? controls.allowPayments : "allow";
}

export function enforceParentalPaymentAccess(session) {
  const accountId = session?.user?.id;
  if (!accountId) return null;
  const approval = getParentalPaymentApproval(accountId);
  if (approval === "disallow") {
    return parentalBlockedResponse(
      "allowPayments",
      "Ask your parent before you can make a purchase.",
    );
  }
  if (approval === "require_approval") {
    return parentalApprovalRequiredResponse();
  }
  return null;
}

export function isChildOrTeenAccount(accountId) {
  const record = getFamilyRecordForAccount(accountId);
  return Boolean(
    record &&
      !record.isOwner &&
      record.member &&
      record.member.role !== familyRoles.ADULT,
  );
}

export function getAccountRoleInFamily(accountId) {
  const record = getFamilyRecordForAccount(accountId);
  if (!record) return null;
  if (record.isOwner) return "owner";
  return record.member?.role || null;
}
