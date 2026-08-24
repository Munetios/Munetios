import { requireAuth } from "../../../auth.js";
import { assertSameOrigin } from "../../lib/authSecurity.js";

export const dynamic = "force-dynamic";

function unavailable() {
  return Response.json(
    { error: "billing_coming_soon" },
    { headers: { "Cache-Control": "no-store" }, status: 503 },
  );
}

export async function GET(request) {
  const { response } = await requireAuth(request);
  return response || unavailable();
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response } = await requireAuth(request);
  return response || unavailable();
}
