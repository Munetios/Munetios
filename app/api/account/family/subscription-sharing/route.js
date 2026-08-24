import { requireAuth } from "../../../../../auth.js";
import { assertSameOrigin } from "../../../../lib/authSecurity.js";
import {
  getSubscriptionSharing,
  setSubscriptionSharing,
} from "../../../../lib/family.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  return json({ shareSubscription: getSubscriptionSharing(session.user.id) });
}

export async function PATCH(request) {
  if (!assertSameOrigin(request)) {
    return json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;

  const payload = await request.json().catch(() => null);
  const shareSubscription = setSubscriptionSharing(
    session.user.id,
    payload?.shareSubscription === true,
  );

  return json({ shareSubscription });
}
