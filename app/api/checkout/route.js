import { assertSameOrigin } from "../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable() {
  return Response.json(
    { error: "checkout_coming_soon" },
    { headers: { "Cache-Control": "no-store" }, status: 503 },
  );
}

export function GET() {
  return unavailable();
}

export function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json(
      { error: "invalid_origin" },
      { headers: { "Cache-Control": "no-store" }, status: 403 },
    );
  }
  return unavailable();
}
