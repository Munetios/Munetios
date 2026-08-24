import { requireAuth } from "../../../auth.js";
import {
  accountStorageBytes,
  deleteAccountFile,
  getAccountStorageCapacity,
  listAccountFiles,
} from "../../lib/accountStorage.js";
import { assertSameOrigin } from "../../lib/authSecurity.js";
import { getDemoSettings, getDemoStorage } from "../../lib/demoSettings.js";

export const dynamic = "force-dynamic";

function formatStorage(bytes) {
  if (bytes <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)}${units[unitIndex]}`;
}

function filePayload(file) {
  return {
    category: file.category,
    contentType: file.contentType,
    createdAt: file.createdAt,
    id: file.id,
    name: file.name,
    size: file.size,
  };
}

function storagePayload(session) {
  const storage = session.demo
    ? getDemoStorage(getDemoSettings(session))
    : getAccountStorageCapacity(session.user.id);
  return session.demo
    ? { ...storage, files: [] }
    : {
        availableBytes: storage.availableBytes,
        files: listAccountFiles(session.user.id).map(filePayload),
        totalBytes: accountStorageBytes,
        totalLabel: "96GB",
        usedBytes: storage.usedBytes,
        usedLabel: formatStorage(storage.usedBytes),
      };
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }

  return Response.json(storagePayload(session), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (session.demo) {
    return Response.json({ error: "demo_account" }, { status: 403 });
  }
  const fileId = new URL(request.url).searchParams.get("fileId") || "";
  if (!deleteAccountFile(session.user.id, fileId)) {
    return Response.json({ error: "file_not_found" }, { status: 404 });
  }
  return Response.json(storagePayload(session), {
    headers: { "Cache-Control": "no-store" },
  });
}
