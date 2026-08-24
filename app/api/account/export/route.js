import { after } from "next/server";
import { requireAuth } from "../../../../auth.js";
import {
  listDataExports,
  processDataExport,
  queueDataExport,
  readDataExport,
} from "../../../lib/accountDataControls.js";
import { assertSameOrigin } from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function GET(request) {
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return authResponse;
  const exportId = new URL(request.url).searchParams.get("id");
  if (!exportId) return response({ exports: listDataExports(session.user.id) });
  const result = readDataExport(session.user.id, exportId);
  if (!result) return response({ error: "export_not_ready" }, { status: 404 });
  return new Response(result.bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${result.job.fileName}"`,
      "Content-Length": String(result.bytes.length),
      "Content-Type": "application/zip",
    },
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request))
    return response({ error: "invalid_origin" }, { status: 403 });
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return authResponse;
  if (session.demo)
    return response({ error: "signin_required" }, { status: 401 });
  const job = queueDataExport(session.user.id);
  after(() => processDataExport(session.user.id, job.id));
  return response({ export: job }, { status: 202 });
}
