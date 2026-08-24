import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { auth } from "../../../../auth.js";
import {
  getAccountStorageCapacity,
  listAccountFiles,
  saveAccountFileStream,
} from "../../../lib/accountStorage.js";
import { assertSameOrigin } from "../../../lib/authSecurity.js";
import { enforceParentalAiAccess } from "../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function filePayload(file) {
  const metadata = file.metadata || {};
  return {
    contentType: file.contentType,
    createdAt: file.createdAt,
    id: file.id,
    name: file.name,
    size: file.size,
    deletedAt: metadata.deletedAt || null,
    encrypted: metadata.encrypted === true,
    endToEndEncrypted: metadata.endToEndEncrypted === true,
    encryption:
      metadata.endToEndEncrypted === true ? metadata.clientEncryption : null,
    pinned: metadata.pinned === true,
    updatedAt: metadata.updatedAt || file.createdAt,
    url: `/api/ai/files/${encodeURIComponent(file.id)}`,
  };
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

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "ai");
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;

  return response({
    capacity: getAccountStorageCapacity(session.user.id),
    files: [
      ...listAccountFiles(session.user.id, "ai-library-file"),
      ...listAccountFiles(session.user.id, "ai-file"),
    ]
      .sort((left, right) =>
        String(right.createdAt).localeCompare(String(left.createdAt)),
      )
      .map(filePayload),
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
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;

  const contentLength = Math.max(
    0,
    Number(request.headers.get("content-length")) || 0,
  );
  const capacity = getAccountStorageCapacity(session.user.id);
  if (contentLength > capacity.availableBytes) {
    return response({ capacity, error: "storage_full" }, { status: 507 });
  }

  if (!request.body) {
    return response({ error: "invalid_file" }, { status: 400 });
  }
  let name = "Munetios AI file";
  try {
    name = decodeURIComponent(
      request.headers.get("x-munetios-file-name") || "",
    );
  } catch {}
  const contentType =
    request.headers.get("x-munetios-original-content-type") ||
    request.headers.get("content-type") ||
    "application/octet-stream";
  const scope =
    request.headers.get("x-munetios-file-scope") === "library"
      ? "library"
      : "prompt";
  let clientFingerprint = "";
  try {
    clientFingerprint = decodeURIComponent(
      request.headers.get("x-munetios-file-fingerprint") || "",
    ).slice(0, 128);
  } catch {}
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    libraryEncryptionKey(session.user.id),
    iv,
  );
  const metadata = {
    clientFingerprint,
    endToEndEncrypted:
      request.headers.get("x-munetios-file-encryption") === "aes-256-gcm",
    encrypted: true,
    encryption: {
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64url"),
      tag: "",
    },
    scope,
    source: "munetios-ai",
  };
  if (metadata.endToEndEncrypted) {
    metadata.clientEncryption = {
      algorithm: "aes-256-gcm",
      iv: String(request.headers.get("x-munetios-file-iv") || "").slice(0, 64),
    };
  }
  cipher.once("end", () => {
    metadata.encryption.tag = cipher.getAuthTag().toString("base64url");
  });
  const source = Readable.fromWeb(request.body).pipe(cipher);
  const saved = await saveAccountFileStream({
    accountId: session.user.id,
    category: scope === "library" ? "ai-library-file" : "ai-prompt-file",
    contentType,
    declaredSize: contentLength,
    extension: extname(name),
    metadata,
    name,
    source,
  });
  if (saved.error) {
    return response(saved, {
      status: saved.error === "storage_full" ? 507 : 400,
    });
  }

  return response(
    { capacity: saved.capacity, file: filePayload(saved.file) },
    { status: 201 },
  );
}
