import { requireAuth } from "../../../../../auth.js";
import { assertSameOrigin } from "../../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response } = await requireAuth(request);
  if (response) return response;
  return Response.json(
    { error: "purchases_coming_soon" },
    { headers: { "Cache-Control": "no-store" }, status: 503 },
  );
}
