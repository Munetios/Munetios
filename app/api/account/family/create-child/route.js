import { requireAuth } from "../../../../../auth.js";
import { assertSameOrigin } from "../../../../lib/authSecurity.js";
import { createChildAccount } from "../../../../lib/family.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await createChildAccount(session.user.id, payload);
  if (result.error) {
    return json(
      { error: result.error },
      { status: result.error === "not_authorized" ? 403 : 400 },
    );
  }

  return json({
    member: {
      accountId: result.member.accountId,
      addedAt: result.member.addedAt,
      avatarLetter: result.member.avatarLetter,
      email: result.member.email,
      id: result.member.id,
      name: result.member.name,
      parentalControls: result.member.parentalControls,
      role: result.member.role,
    },
  });
}
