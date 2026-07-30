import { auth } from "../../../../auth.js";
import {
  getAccountStorageCapacity,
  listAccountFiles,
  maximumAccountFileBytes,
  saveAccountFile,
} from "../../../lib/accountStorage.js";
import { assertSameOrigin } from "../../../lib/authSecurity.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function recordingPayload(file) {
  return {
    createdAt: file.createdAt,
    durationSeconds: Math.max(0, Number(file.metadata?.durationSeconds) || 0),
    id: file.id,
    meetingId: String(file.metadata?.meetingId || ""),
    mimeType: file.contentType,
    name: file.name,
    size: file.size,
  };
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "meet");
  if (policyResponse) return policyResponse;
  return response({
    capacity: getAccountStorageCapacity(session.user.id),
    recordings: listAccountFiles(session.user.id, "meet-recording").map(
      recordingPayload,
    ),
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "meet", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const contentLength = Math.max(
    0,
    Number(request.headers.get("content-length")) || 0,
  );
  if (contentLength > maximumAccountFileBytes) {
    return response({ error: "recording_too_large" }, { status: 413 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("video/mp4")) {
    return response({ error: "unsupported_recording_format" }, { status: 415 });
  }
  let recordingName = "";
  try {
    recordingName = decodeURIComponent(
      request.headers.get("x-munetios-recording-name") || "",
    );
  } catch {
    recordingName = "Munetios Meet recording";
  }
  const saved = saveAccountFile({
    accountId: session.user.id,
    bytes,
    category: "meet-recording",
    contentType,
    extension: ".mp4",
    metadata: {
      durationSeconds: request.headers.get("x-munetios-duration"),
      meetingId: request.headers.get("x-munetios-meeting-id"),
    },
    name: recordingName,
  });
  if (saved.error) {
    return response(saved, {
      status:
        saved.error === "storage_full"
          ? 507
          : saved.error === "file_too_large"
            ? 413
            : 400,
    });
  }
  return response(
    {
      capacity: saved.capacity,
      recording: recordingPayload(saved.file),
    },
    { status: 201 },
  );
}
