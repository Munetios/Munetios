import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getRequestFingerprint,
} from "../../../lib/authSecurity.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";
import {
  getSupaNotesSettings,
  mergeSupaNotesSettings,
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
  return respond({ settings: getSupaNotesSettings(session) });
}

export async function PATCH(request) {
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
    key: `supanotes-settings:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 60,
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
  if (!payload?.settings || typeof payload.settings !== "object") {
    return respond({ error: "invalid_settings" }, { status: 400 });
  }
  return respond({
    settings: mergeSupaNotesSettings(session, payload.settings),
  });
}
