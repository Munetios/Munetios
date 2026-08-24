import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getRequestFingerprint,
} from "../../../lib/authSecurity.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";
import {
  getSupaNotesNotes,
  mergeSupaNotesNotes,
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

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return respond({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "notes", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const contentLength = Number(request.headers.get("content-length")) || 0;
  if (contentLength > 5_000_000) {
    return respond({ error: "payload_too_large" }, { status: 413 });
  }
  const rateLimit = consumeRateLimit({
    key: `supanotes-import:${session.user.id}:${getRequestFingerprint(request)}`,
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
  const payload = await request.json().catch(() => null);
  const importedNotes = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.notes)
      ? payload.notes
      : null;
  if (!importedNotes) {
    return respond({ error: "invalid_notes" }, { status: 400 });
  }
  const notes = mergeSupaNotesNotes(getSupaNotesNotes(session), importedNotes);
  setSupaNotesNotes(session, notes);
  return respond({ imported: importedNotes.length, notes });
}
