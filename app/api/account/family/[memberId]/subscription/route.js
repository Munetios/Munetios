import { requireAuth } from "../../../../../../auth.js";
import {
  assertSameOrigin,
  updateAccountPlan,
} from "../../../../../lib/authSecurity.js";
import {
  canManageFamily,
  getFamily,
  resolveOwnerIdForActor,
} from "../../../../../lib/family.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function POST(request, { params }) {
  if (!assertSameOrigin(request)) {
    return json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;

  if (!canManageFamily(session.user.id)) {
    return json({ error: "not_authorized" }, { status: 403 });
  }

  const { memberId } = await params;
  const payload = await request.json().catch(() => null);
  if (payload?.action !== "cancel") {
    return json({ error: "invalid_action" }, { status: 400 });
  }

  const ownerId = resolveOwnerIdForActor(session.user.id);
  const family = getFamily(ownerId);
  const member = family.members.find((entry) => entry.id === memberId);
  if (!member) return json({ error: "member_not_found" }, { status: 404 });

  const canceled = updateAccountPlan(member.accountId, "free");
  return json({ canceled });
}
