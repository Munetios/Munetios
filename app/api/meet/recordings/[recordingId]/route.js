import { auth } from "../../../../../auth.js";
import {
  deleteAccountFile,
  readAccountFile,
} from "../../../../lib/accountStorage.js";
import { assertSameOrigin } from "../../../../lib/authSecurity.js";
import { enforceOrganizationAppAccess } from "../../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const session = await auth(request);
  if (!session || session.demo) {
    return Response.json({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "meet");
  if (policyResponse) return policyResponse;
  const { recordingId } = await params;
  if (!/^[\da-f-]{36}$/i.test(recordingId || "")) {
    return Response.json({ error: "recording_not_found" }, { status: 404 });
  }
  const result = readAccountFile(
    session.user.id,
    recordingId,
    "meet-recording",
  );
  if (!result) {
    return Response.json({ error: "recording_not_found" }, { status: 404 });
  }
  return new Response(result.bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="Munetios-Meet-${recordingId}${result.file.extension}"`,
      "Content-Length": String(result.bytes.byteLength),
      "Content-Type": result.file.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(request, { params }) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
    return Response.json({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "meet", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const { recordingId } = await params;
  return deleteAccountFile(session.user.id, recordingId, "meet-recording")
    ? Response.json({ deleted: true })
    : Response.json({ error: "recording_not_found" }, { status: 404 });
}
