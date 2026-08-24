import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getRequestFingerprint,
} from "../../../lib/authSecurity.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";
import {
  getSupaNotesNotes,
  setSupaNotesNotes,
} from "../../../lib/supaNotesData.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function respond(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "notes");
  if (policyResponse) return policyResponse;
  return respond({ notes: getSupaNotesNotes(session) });
}

export async function DELETE(request) {
  if (!assertSameOrigin(request)) {
    return respond({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "notes", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const rateLimit = consumeRateLimit({
    key: `supanotes-delete:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 8,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return respond(
      { error: "rate_limited" },
      {
        headers: { "Retry-After": String(rateLimit.retryAfter) },
        status: 429,
      },
    );
  }
  setSupaNotesNotes(session, []);
  return respond({ deleted: true });
}
