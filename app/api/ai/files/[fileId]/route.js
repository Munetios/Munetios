import { createDecipheriv, createHash } from "node:crypto";
import { auth } from "../../../../../auth.js";
import {
  deleteAccountFile,
  readAccountFile,
  updateAccountFileMetadata,
} from "../../../../lib/accountStorage.js";
import { assertSameOrigin } from "../../../../lib/authSecurity.js";
import { enforceStudentAiCapability } from "../../../../lib/education.js";
import { enforceParentalAiAccess } from "../../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const aiFileCategories = new Set([
  "ai-file",
  "ai-generated-image",
  "ai-edited-image",
  "ai-library-file",
  "ai-prompt-file",
]);

function contentDisposition(name, download) {
  const safeName = String(name || "Munetios AI file").replace(/["\r\n]/gu, "_");
  return `${download ? "attachment" : "inline"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function libraryEncryptionKey(accountId) {
  const secret =
    process.env.MUNETIOS_STORAGE_ENCRYPTION_KEY ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "munetios-development-account-storage";
  return createHash("sha256")
    .update(`${secret}:munetios-ai-library:${accountId}`)
    .digest();
}

function decryptLibraryFile(accountId, result) {
  const encryption = result.file.metadata?.encryption;
  if (
    result.file.metadata?.encrypted !== true ||
    encryption?.algorithm !== "aes-256-gcm"
  ) {
    return result.bytes;
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    libraryEncryptionKey(accountId),
    Buffer.from(encryption.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encryption.tag, "base64url"));
  return Buffer.concat([decipher.update(result.bytes), decipher.final()]);
}

export async function GET(request, { params }) {
  const session = await auth(request);
  if (!session || session.demo) {
    return Response.json({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "ai");
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;
  const { fileId } = await params;
  const result = readAccountFile(session.user.id, fileId);
  if (!result || !aiFileCategories.has(result.file.category)) {
    return Response.json({ error: "file_not_found" }, { status: 404 });
  }
  if (
    ["ai-generated-image", "ai-edited-image"].includes(result.file.category)
  ) {
    const educationResponse = enforceStudentAiCapability(session, "images");
    if (educationResponse) return educationResponse;
  }
  const download = new URL(request.url).searchParams.has("download");
  let bytes;
  try {
    bytes = decryptLibraryFile(session.user.id, result);
  } catch {
    return Response.json({ error: "file_decryption_failed" }, { status: 500 });
  }
  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(result.file.name, download),
      "Content-Length": String(bytes.byteLength),
      "Content-Type": result.file.contentType,
      "X-Content-Type-Options": "nosniff",
      "X-Munetios-Encrypted-At-Rest": String(
        result.file.metadata?.encrypted === true,
      ),
      "X-Munetios-End-To-End-Encrypted": String(
        result.file.metadata?.endToEndEncrypted === true,
      ),
      ...(result.file.metadata?.endToEndEncrypted === true
        ? {
            "X-Munetios-File-Encryption": "aes-256-gcm",
            "X-Munetios-File-Iv": String(
              result.file.metadata?.clientEncryption?.iv || "",
            ),
          }
        : {}),
    },
  });
}

export async function PATCH(request, { params }) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
    return Response.json({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;
  const { fileId } = await params;
  const current = readAccountFile(session.user.id, fileId);
  if (!current || current.file.category !== "ai-library-file") {
    return Response.json({ error: "file_not_found" }, { status: 404 });
  }
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }
  const patch = { updatedAt: new Date().toISOString() };
  if (typeof payload.pinned === "boolean") patch.pinned = payload.pinned;
  if (payload.action === "trash") patch.deletedAt = new Date().toISOString();
  if (payload.action === "restore") patch.deletedAt = null;
  const file = updateAccountFileMetadata(
    session.user.id,
    fileId,
    patch,
    "ai-library-file",
  );
  return Response.json({
    file: {
      contentType: file.contentType,
      createdAt: file.createdAt,
      deletedAt: file.metadata.deletedAt || null,
      encrypted: file.metadata.encrypted === true,
      id: file.id,
      name: file.name,
      pinned: file.metadata.pinned === true,
      size: file.size,
      updatedAt: file.metadata.updatedAt || file.createdAt,
      url: `/api/ai/files/${encodeURIComponent(file.id)}`,
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
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;
  const { fileId } = await params;
  const result = readAccountFile(session.user.id, fileId);
  if (!result || !aiFileCategories.has(result.file.category)) {
    return Response.json({ error: "file_not_found" }, { status: 404 });
  }
  if (
    ["ai-generated-image", "ai-edited-image"].includes(result.file.category)
  ) {
    const educationResponse = enforceStudentAiCapability(session, "images");
    if (educationResponse) return educationResponse;
  }
  return deleteAccountFile(session.user.id, fileId)
    ? Response.json({ deleted: true })
    : Response.json({ error: "file_not_found" }, { status: 404 });
}
