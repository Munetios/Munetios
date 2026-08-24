import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getAccountData, setAccountData } from "./authSecurity.js";
import { dataDirectory } from "./dataDirectory.js";

const storageMetadataKey = "account-storage-files-v1";
const legacyMeetMetadataKey = "meet-recordings-v1";
const accountStorageDirectory = join(dataDirectory, "account-storage");
const legacyMeetDirectory = join(dataDirectory, "meet-recordings");

export const accountStorageBytes = 96 * 1024 * 1024 * 1024;

function accountFolderName(accountId) {
  return createHash("sha256")
    .update(String(accountId))
    .digest("hex")
    .slice(0, 32);
}

function accountDirectory(accountId) {
  return join(accountStorageDirectory, accountFolderName(accountId));
}

function normalizeExtension(value) {
  const extension = String(value || "")
    .trim()
    .toLowerCase();
  return /^\.[a-z\d]{1,10}$/u.test(extension) ? extension : ".bin";
}

function normalizeFiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((file) => file && typeof file === "object")
    .map((file) => ({
      category: String(file.category || "file").slice(0, 80),
      contentType: String(file.contentType || "application/octet-stream").slice(
        0,
        120,
      ),
      createdAt: String(file.createdAt || new Date().toISOString()),
      extension: normalizeExtension(file.extension),
      id: String(file.id || ""),
      metadata:
        file.metadata && typeof file.metadata === "object" ? file.metadata : {},
      name:
        String(file.name || "Munetios file")
          .trim()
          .slice(0, 180) || "Munetios file",
      size: Math.max(0, Number(file.size) || 0),
    }))
    .filter((file) => /^[\da-f-]{36}$/iu.test(file.id));
}

function migrateLegacyMeetRecordings(accountId) {
  const legacy = getAccountData(accountId, legacyMeetMetadataKey, []);
  if (!Array.isArray(legacy) || !legacy.length) return;
  const files = normalizeFiles(
    getAccountData(accountId, storageMetadataKey, []),
  );
  const existingIds = new Set(files.map((file) => file.id));
  const directory = accountDirectory(accountId);
  mkdirSync(directory, { recursive: true });
  let migratedAll = true;

  for (const recording of legacy) {
    const id = String(recording?.id || "");
    if (!/^[\da-f-]{36}$/iu.test(id) || existingIds.has(id)) continue;
    const source = join(
      legacyMeetDirectory,
      accountFolderName(accountId),
      `${id}.webm`,
    );
    const destination = join(directory, `${id}.webm`);
    try {
      if (!existsSync(source)) {
        migratedAll = false;
        continue;
      }
      renameSync(source, destination);
      files.push({
        category: "meet-recording",
        contentType: String(recording.mimeType || "video/webm").slice(0, 120),
        createdAt: String(recording.createdAt || new Date().toISOString()),
        extension: ".webm",
        id,
        metadata: {
          durationSeconds: Math.max(0, Number(recording.durationSeconds) || 0),
          meetingId: String(recording.meetingId || "").slice(0, 200),
        },
        name:
          String(recording.name || "Munetios Meet recording")
            .trim()
            .slice(0, 180) || "Munetios Meet recording",
        size: Math.max(0, Number(recording.size) || 0),
      });
      existingIds.add(id);
    } catch {
      migratedAll = false;
    }
  }

  setAccountData(accountId, storageMetadataKey, files.slice(0, 2000));
  if (migratedAll) setAccountData(accountId, legacyMeetMetadataKey, []);
}

export function listAccountFiles(accountId, category = "") {
  migrateLegacyMeetRecordings(accountId);
  const files = normalizeFiles(
    getAccountData(accountId, storageMetadataKey, []),
  );
  return files
    .filter((file) => !category || file.category === category)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getAccountStorageCapacity(accountId) {
  const files = listAccountFiles(accountId);
  const fileBytes = files.reduce((total, file) => total + file.size, 0);
  const reportedUsage = getAccountData(accountId, "account-storage-usage", {});
  const otherBytes = Math.max(0, Number(reportedUsage?.usedBytes) || 0);
  const usedBytes = Math.min(accountStorageBytes, fileBytes + otherBytes);
  return {
    availableBytes: Math.max(0, accountStorageBytes - usedBytes),
    fileBytes,
    limitBytes: accountStorageBytes,
    usedBytes,
  };
}

function createStoredFile({
  category,
  contentType,
  extension,
  id,
  metadata,
  name,
  size,
}) {
  return {
    category: String(category || "file").slice(0, 80),
    contentType: String(contentType || "application/octet-stream").slice(
      0,
      120,
    ),
    createdAt: new Date().toISOString(),
    extension: normalizeExtension(extension),
    id,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    name:
      String(name || "Munetios file")
        .trim()
        .slice(0, 180) || "Munetios file",
    size: Math.max(0, Number(size) || 0),
  };
}

function persistStoredFile(accountId, file) {
  setAccountData(
    accountId,
    storageMetadataKey,
    [file, ...listAccountFiles(accountId)].slice(0, 2000),
  );
  return { capacity: getAccountStorageCapacity(accountId), file };
}

export function saveAccountFile({
  accountId,
  bytes,
  category,
  contentType,
  extension,
  metadata = {},
  name,
}) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) {
    return { error: "invalid_file" };
  }
  const capacity = getAccountStorageCapacity(accountId);
  if (bytes.byteLength > capacity.availableBytes) {
    return { capacity, error: "storage_full" };
  }

  const id = randomUUID();
  const normalizedFileExtension = normalizeExtension(extension);
  const directory = accountDirectory(accountId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${id}${normalizedFileExtension}`), bytes);
  const file = createStoredFile({
    category,
    contentType,
    extension: normalizedFileExtension,
    id,
    metadata,
    name,
    size: bytes.byteLength,
  });
  return persistStoredFile(accountId, file);
}

export async function saveAccountFileStream({
  accountId,
  category,
  contentType,
  declaredSize = 0,
  extension,
  metadata = {},
  name,
  source,
}) {
  if (!source || typeof source.pipe !== "function") {
    return { error: "invalid_file" };
  }

  const startingCapacity = getAccountStorageCapacity(accountId);
  const normalizedDeclaredSize = Math.max(0, Number(declaredSize) || 0);
  if (normalizedDeclaredSize > startingCapacity.availableBytes) {
    return { capacity: startingCapacity, error: "storage_full" };
  }

  const id = randomUUID();
  const normalizedFileExtension = normalizeExtension(extension);
  const directory = accountDirectory(accountId);
  const temporaryPath = join(directory, `${id}.upload`);
  const finalPath = join(directory, `${id}${normalizedFileExtension}`);
  mkdirSync(directory, { recursive: true });

  let receivedBytes = 0;
  let movedToFinalPath = false;
  const capacityLimiter = new Transform({
    transform(chunk, _encoding, callback) {
      const chunkBytes = Buffer.isBuffer(chunk)
        ? chunk.byteLength
        : Buffer.byteLength(chunk);
      receivedBytes += chunkBytes;
      if (receivedBytes > startingCapacity.availableBytes) {
        const error = new Error("storage_full");
        error.code = "MUNETIOS_STORAGE_FULL";
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      source,
      capacityLimiter,
      createWriteStream(temporaryPath, { flags: "wx" }),
    );
    if (!receivedBytes) {
      rmSync(temporaryPath, { force: true });
      return { error: "invalid_file" };
    }

    const currentCapacity = getAccountStorageCapacity(accountId);
    if (receivedBytes > currentCapacity.availableBytes) {
      rmSync(temporaryPath, { force: true });
      return { capacity: currentCapacity, error: "storage_full" };
    }

    renameSync(temporaryPath, finalPath);
    movedToFinalPath = true;
    const file = createStoredFile({
      category,
      contentType,
      extension: normalizedFileExtension,
      id,
      metadata,
      name,
      size: receivedBytes,
    });
    return persistStoredFile(accountId, file);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    if (movedToFinalPath) rmSync(finalPath, { force: true });
    if (error?.code === "MUNETIOS_STORAGE_FULL") {
      return {
        capacity: getAccountStorageCapacity(accountId),
        error: "storage_full",
      };
    }
    return { error: "upload_failed" };
  }
}

export function readAccountFile(accountId, fileId, category = "") {
  const file = listAccountFiles(accountId).find(
    (entry) =>
      entry.id === fileId && (!category || entry.category === category),
  );
  if (!file) return null;
  const path = join(accountDirectory(accountId), `${file.id}${file.extension}`);
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return null;
    return { bytes: readFileSync(path), file };
  } catch {
    return null;
  }
}

export function updateAccountFileMetadata(
  accountId,
  fileId,
  metadataPatch,
  category = "",
) {
  const files = listAccountFiles(accountId);
  const index = files.findIndex(
    (entry) =>
      entry.id === fileId && (!category || entry.category === category),
  );
  if (index < 0) return null;
  const current = files[index];
  const updated = {
    ...current,
    metadata: {
      ...(current.metadata && typeof current.metadata === "object"
        ? current.metadata
        : {}),
      ...(metadataPatch && typeof metadataPatch === "object"
        ? metadataPatch
        : {}),
    },
  };
  setAccountData(
    accountId,
    storageMetadataKey,
    files.map((entry) => (entry.id === fileId ? updated : entry)),
  );
  return updated;
}

export function deleteAccountFile(accountId, fileId, category = "") {
  const files = listAccountFiles(accountId);
  const file = files.find(
    (entry) =>
      entry.id === fileId && (!category || entry.category === category),
  );
  if (!file) return false;
  const safeExtension = normalizeExtension(file.extension);
  try {
    rmSync(join(accountDirectory(accountId), `${file.id}${safeExtension}`), {
      force: true,
    });
  } catch {}
  setAccountData(
    accountId,
    storageMetadataKey,
    files.filter((entry) => entry.id !== fileId),
  );
  return true;
}
