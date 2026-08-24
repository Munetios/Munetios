import { requireAuth } from "../../../../../auth.js";
import { assertSameOrigin } from "../../../../lib/authSecurity.js";
import {
  deleteChildFamilyMember,
  removeFamilyMember,
  updateParentalControls,
} from "../../../../lib/family.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function memberForClient(member) {
  return {
    accountId: member.accountId,
    addedAt: member.addedAt,
    avatarLetter: member.avatarLetter,
    email: member.email,
    id: member.id,
    name: member.name,
    parentalControls: member.parentalControls,
    role: member.role,
  };
}

export async function PATCH(request, { params }) {
  if (!assertSameOrigin(request)) {
    return json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;

  const { memberId } = await params;
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return json({ error: "invalid_request" }, { status: 400 });
  }

  const result = updateParentalControls(session.user.id, memberId, payload);
  if (result.error) {
    return json(
      { error: result.error },
      { status: result.error === "not_authorized" ? 403 : 400 },
    );
  }

  return json({ member: memberForClient(result.member) });
}

export async function DELETE(request, { params }) {
  if (!assertSameOrigin(request)) {
    return json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;

  const { memberId } = await params;
  const payload = await request.json().catch(() => ({}));
  const result =
    payload?.action === "delete_child_account"
      ? deleteChildFamilyMember(session.user.id, memberId)
      : removeFamilyMember(session.user.id, memberId);
  if (result.error) {
    return json(
      { error: result.error },
      { status: result.error === "not_authorized" ? 403 : 400 },
    );
  }

  return json({ removed: true });
}
