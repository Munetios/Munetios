import { requireAuth } from "../../../../auth.js";
import {
  getDemoSettings,
  updateDemoSettings,
} from "../../../lib/demoSettings.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (!session.demo)
    return Response.json({ error: "demo_only" }, { status: 403 });
  return Response.json(getDemoSettings(session), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (!session.demo)
    return Response.json({ error: "demo_only" }, { status: 403 });
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  return Response.json(updateDemoSettings(session, payload || {}), {
    headers: { "Cache-Control": "no-store" },
  });
}
