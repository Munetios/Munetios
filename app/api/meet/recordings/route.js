import { Readable } from "node:stream";
import { auth } from "../../../../auth.js";
import {
  getAccountStorageCapacity,
  listAccountFiles,
  saveAccountFileStream,
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
  const capacity = getAccountStorageCapacity(session.user.id);
  if (contentLength > capacity.availableBytes) {
    return response({ capacity, error: "storage_full" }, { status: 507 });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("video/mp4")) {
    return response({ error: "unsupported_recording_format" }, { status: 415 });
  }
  if (!request.body) {
    return response({ error: "invalid_file" }, { status: 400 });
  }
  let recordingName = "";
  try {
    recordingName = decodeURIComponent(
      request.headers.get("x-munetios-recording-name") || "",
    );
  } catch {
    recordingName = "Munetios Meet recording";
  }
  const saved = await saveAccountFileStream({
    accountId: session.user.id,
    category: "meet-recording",
    contentType,
    declaredSize: contentLength,
    extension: ".mp4",
    metadata: {
      durationSeconds: request.headers.get("x-munetios-duration"),
      meetingId: request.headers.get("x-munetios-meeting-id"),
    },
    name: recordingName,
    source: Readable.fromWeb(request.body),
  });
  if (saved.error) {
    return response(saved, {
      status: saved.error === "storage_full" ? 507 : 400,
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
