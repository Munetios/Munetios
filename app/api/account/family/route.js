import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  getAccountById,
  getAccountData,
} from "../../../lib/authSecurity.js";
import {
  addFamilyMember,
  canManageFamily,
  getAccountRoleInFamily,
  listFamilyMembers,
} from "../../../lib/family.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function memberForClient(member) {
  const account = getAccountById(member.accountId);
  const profile = getAccountData(member.accountId, "profile", {});
  return {
    accountId: member.accountId,
    addedAt: member.addedAt,
    avatarLetter: member.avatarLetter,
    email: profile.email || member.email || account?.email || "",
    id: member.id,
    birthday: Object.hasOwn(profile, "birthday")
      ? profile.birthday
      : account?.birthDate || "",
    name: profile.name || member.name || account?.name || account?.email || "",
    parentalControls: member.parentalControls,
    role: member.role,
  };
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;

  const { family, isOwner, member } = listFamilyMembers(session.user.id);
  return json({
    canManage: canManageFamily(session.user.id),
    isOwner,
    members: family.members.map(memberForClient),
    owner: memberForClient({
      accountId: family.ownerId,
      addedAt: family.createdAt,
      avatarLetter: "",
      email: "",
      id: `family-owner-${family.ownerId}`,
      name: "",
      parentalControls: null,
      role: "owner",
    }),
    role: getAccountRoleInFamily(session.user.id),
    self: member ? memberForClient(member) : null,
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;

  const payload = await request.json().catch(() => null);
  const email = String(payload?.email || "").trim();
  const role = String(payload?.role || "").trim();
  if (!email || !["adult", "teen", "child"].includes(role)) {
    return json({ error: "invalid_request" }, { status: 400 });
  }

  const result = addFamilyMember(session.user.id, { email, role });
  if (result.error) {
    return json(
      { error: result.error },
      { status: result.error === "not_authorized" ? 403 : 400 },
    );
  }

  return json({ member: memberForClient(result.member) });
}
