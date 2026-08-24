import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getRequestFingerprint,
} from "../../../lib/authSecurity.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const readOperations = new Set([
  "load/calendars",
  "load/events",
  "load/favorites",
]);
const writeOperations = new Set([
  "create/calendar",
  "create/event",
  "delete/calendar",
  "delete/event",
  "share/invite",
  "update/calendar",
  "update/event",
  "update/favorites",
]);

function respond(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

async function authorize(request, context, mutating) {
  const operation = (await context.params).operation?.join("/") || "";
  const allowed = mutating ? writeOperations : readOperations;
  if (!allowed.has(operation)) {
    return {
      operation,
      response: respond({ error: "not_found" }, { status: 404 }),
    };
  }
  if (mutating && !assertSameOrigin(request)) {
    return {
      operation,
      response: respond({ error: "invalid_origin" }, { status: 403 }),
    };
  }
  const authenticated = await requireAuth(request);
  if (authenticated.response) {
    return { operation, response: authenticated.response };
  }
  const policyResponse = enforceOrganizationAppAccess(
    authenticated.session,
    "calendar",
    mutating ? { mutating: true } : undefined,
  );
  if (policyResponse) return { operation, response: policyResponse };
  const limit = consumeRateLimit({
    key: `calendar-operation:${authenticated.session.user.id}:${getRequestFingerprint(request)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return {
      operation,
      response: respond(
        { error: "rate_limited" },
        { headers: { "Retry-After": String(limit.retryAfter) }, status: 429 },
      ),
    };
  }
  return { operation, session: authenticated.session };
}

export async function GET(request, context) {
  const result = await authorize(request, context, false);
  if (result.response) return result.response;
  return respond({ operation: result.operation, ready: true });
}

export async function POST(request, context) {
  const result = await authorize(request, context, true);
  if (result.response) return result.response;
  return respond({ accepted: true, operation: result.operation });
}
