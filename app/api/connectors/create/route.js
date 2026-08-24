import { auth, unauthorizedResponse } from "../../../../auth.js";
import { assertSameOrigin } from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session) return unauthorizedResponse();
  return Response.json(
    { error: "connector_create_coming_soon" },
    { headers: { "Cache-Control": "no-store" }, status: 503 },
  );
}
