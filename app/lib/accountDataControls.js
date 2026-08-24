import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  deleteAccountFile,
  listAccountFiles,
  readAccountFile,
  saveAccountFile,
} from "./accountStorage.js";
import {
  getAccountData,
  listAllAccountData,
  setAccountData,
} from "./authSecurity.js";
import { dataDirectory } from "./dataDirectory.js";

const exportDirectory = join(dataDirectory, "account-exports");
const exportsKey = "account-exports-v1";
const settingsKey = "account-data-controls-v1";
const tasksVaultKey = "tasks_encrypted_vault_v1";
const tasksImportKey = "tasks-import-manifest-v1";
const calendarVaultKey = "calendar_encrypted_vault_v1";
const calendarFormat = "munetios-calendar-v1";
const calendarAdditionalData = Buffer.from("munetios.calendar.v1", "utf8");
const maximumImportBytes = 512 * 1024 * 1024;
const maximumExpandedImportBytes = 768 * 1024 * 1024;
const maximumImportEntries = 20_000;
const exportFormat = "munetios-account-export-v2";
const applicationFolders = Object.freeze({
  ai: "Munetios AI",
  calendar: "Munetios Calendar",
  meet: "Munetios Meet",
  omniwrite: "Munetios OmniWrite",
  tasks: "Munetios Tasks",
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = zipDateTime();

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replaceAll("\\", "/"), "utf8");
    const bytes = Buffer.from(entry.bytes);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + bytes.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function findEndOfCentralDirectory(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function validArchivePath(value) {
  const name = String(value || "").replaceAll("\\", "/");
  return Boolean(
    name &&
      !name.startsWith("/") &&
      !/^[a-z]:\//iu.test(name) &&
      !name.split("/").includes(".."),
  );
}

function readZip(bytes) {
  const entries = new Map();
  const endOffset = findEndOfCentralDirectory(bytes);
  if (endOffset < 0) throw new Error("invalid_zip");
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralLength = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  if (
    entryCount > maximumImportEntries ||
    centralOffset + centralLength > endOffset
  ) {
    throw new Error("invalid_zip");
  }
  let offset = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > bytes.length ||
      bytes.readUInt32LE(offset) !== 0x02014b50
    ) {
      throw new Error("invalid_zip");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const checksum = bytes.readUInt32LE(offset + 16);
    const compressedLength = bytes.readUInt32LE(offset + 20);
    const expandedLength = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length || (flags & 0x01) !== 0) {
      throw new Error("unsupported_zip");
    }
    const name = bytes.subarray(nameStart, nameEnd).toString("utf8");
    if (!validArchivePath(name)) throw new Error("unsafe_zip_path");
    if (localOffset + 30 > bytes.length) throw new Error("invalid_zip");
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("invalid_zip");
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedLength;
    if (dataEnd > bytes.length) throw new Error("invalid_zip");
    expandedBytes += expandedLength;
    if (expandedBytes > maximumExpandedImportBytes) {
      throw new Error("expanded_import_too_large");
    }
    let content;
    if (method === 0) content = Buffer.from(bytes.subarray(dataStart, dataEnd));
    else if (method === 8) {
      content = inflateRawSync(bytes.subarray(dataStart, dataEnd), {
        maxOutputLength: Math.min(
          maximumExpandedImportBytes,
          Math.max(1, expandedLength),
        ),
      });
    } else throw new Error("unsupported_zip");
    if (content.length !== expandedLength || crc32(content) !== checksum) {
      throw new Error("invalid_zip");
    }
    if (!name.endsWith("/")) entries.set(name, content);
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function getExportJobs(accountId) {
  const jobs = getAccountData(accountId, exportsKey, []);
  return Array.isArray(jobs) ? jobs : [];
}

function saveExportJobs(accountId, jobs) {
  const retained = jobs.slice(0, 20);
  for (const job of jobs.slice(20)) {
    if (!job?.path) continue;
    try {
      rmSync(job.path, { force: true });
    } catch {}
  }
  setAccountData(accountId, exportsKey, retained);
}

function updateExportJob(accountId, exportId, patch) {
  const jobs = getExportJobs(accountId).map((job) =>
    job.id === exportId
      ? { ...job, ...patch, updatedAt: new Date().toISOString() }
      : job,
  );
  saveExportJobs(accountId, jobs);
}

export function getDataControlSettings(accountId) {
  const settings = getAccountData(accountId, settingsKey, {});
  return {
    encryptionType:
      settings.encryptionType === "encrypted_at_rest"
        ? "encrypted_at_rest"
        : "end_to_end",
    personalizeAi: settings.personalizeAi !== false,
    openAppLauncherLinksInNewTab:
      settings.openAppLauncherLinksInNewTab !== false,
  };
}

export function updateDataControlSettings(accountId, patch) {
  const current = getDataControlSettings(accountId);
  const next = {
    ...current,
    ...(Object.hasOwn(patch, "personalizeAi")
      ? { personalizeAi: patch.personalizeAi === true }
      : {}),
    ...(Object.hasOwn(patch, "openAppLauncherLinksInNewTab")
      ? {
          openAppLauncherLinksInNewTab:
            patch.openAppLauncherLinksInNewTab === true,
        }
      : {}),
    ...(Object.hasOwn(patch, "encryptionType")
      ? {
          encryptionType:
            patch.encryptionType === "encrypted_at_rest"
              ? "encrypted_at_rest"
              : "end_to_end",
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  setAccountData(accountId, settingsKey, next);
  return next;
}

export function listDataExports(accountId) {
  return getExportJobs(accountId).map(({ path: _path, ...job }) => job);
}

export function queueDataExport(accountId) {
  const exportId = randomUUID();
  const now = new Date().toISOString();
  const job = {
    completedAt: "",
    createdAt: now,
    error: "",
    fileName: `Munetios-data-${now.slice(0, 10)}-${exportId.slice(0, 8)}.zip`,
    id: exportId,
    progress: 0,
    status: "processing",
    updatedAt: now,
  };
  saveExportJobs(accountId, [job, ...getExportJobs(accountId)]);

  return job;
}

function jsonArchiveEntry(name, value) {
  return {
    bytes: Buffer.from(JSON.stringify(value, null, 2), "utf8"),
    name,
  };
}

function safeArchiveFileName(name, fallback) {
  const normalized = String(name || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replaceAll(/./gu, (character) =>
      character.codePointAt(0) < 32 ? "-" : character,
    )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

function appForFile(file) {
  const category = String(file?.category || "").toLowerCase();
  if (category.startsWith("meet-")) return "meet";
  if (category.startsWith("ai-")) return "ai";
  if (category.startsWith("tasks-")) return "tasks";
  return "omniwrite";
}

const importableContentKeys = Object.freeze({
  ai: new Set([
    "ai-conversations-v1",
    "ai-created-content-v1",
    "ai-history-v1",
  ]),
  omniwrite: new Set([
    "omniwrite-created-content-v1",
    "omniwrite-documents-v1",
    "omniwrite-folders-v1",
  ]),
});

const importableFileCategories = new Set([
  "ai-created-file",
  "ai-file",
  "meet-recording",
  "omniwrite-document",
  "omniwrite-file",
  "tasks-attachment",
]);

function exportContent(data, keys) {
  return data
    .filter((entry) => keys.has(entry.key))
    .map((entry) => ({ key: entry.key, value: entry.value }));
}

function normalizeExportWorkspaces(value) {
  return (Array.isArray(value) ? value : [])
    .filter((workspace) => workspace && typeof workspace === "object")
    .slice(0, 100)
    .map((workspace, index) => ({
      createdAt: String(workspace.createdAt || new Date().toISOString()),
      id: /^workspace-[\da-f-]{36}$/iu.test(String(workspace.id || ""))
        ? String(workspace.id)
        : `workspace-${randomUUID()}`,
      name:
        String(workspace.name || workspace.title || `Workspace ${index + 1}`)
          .trim()
          .slice(0, 80) || `Workspace ${index + 1}`,
      primary: workspace.primary === true,
      updatedAt: String(workspace.updatedAt || new Date().toISOString()),
    }));
}

function validCalendarVaultPart(value, maximum) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

function validCalendarVault(value) {
  return Boolean(
    value?.version === 1 &&
      value.algorithm === "AES-GCM" &&
      value.protection === "account" &&
      validCalendarVaultPart(value.keyId, 100) &&
      validCalendarVaultPart(value.syncKey, 100),
  );
}

function validCalendarDocument(value) {
  return Boolean(
    value?.version === 1 &&
      value.algorithm === "AES-GCM" &&
      validCalendarVaultPart(value.keyId, 100) &&
      validCalendarVaultPart(value.iv, 100) &&
      validCalendarVaultPart(value.ciphertext, 4_500_000),
  );
}

function normalizeCalendarEvent(event, index = 0) {
  const value = event && typeof event === "object" ? event : {};
  return {
    ...value,
    color: /^#[\da-f]{6}$/iu.test(String(value.color || ""))
      ? String(value.color).toLowerCase()
      : "#a855f7",
    date: /^\d{4}-\d{2}-\d{2}$/u.test(String(value.date || ""))
      ? String(value.date)
      : new Date().toISOString().slice(0, 10),
    description: String(value.description || "").slice(0, 20_000),
    descriptionHtml: String(value.descriptionHtml || "").slice(0, 40_000),
    durationMinutes: Math.max(
      1,
      Math.min(10_080, Number(value.durationMinutes) || 60),
    ),
    id: String(value.id || `event-${index + 1}`).slice(0, 160),
    guests: (Array.isArray(value.guests) ? value.guests : [])
      .map((guest) => String(guest).trim().toLowerCase())
      .filter((guest) => /^\S+@\S+\.\S+$/u.test(guest))
      .slice(0, 500),
    location: String(value.location || "").slice(0, 1_000),
    meetingId: String(value.meetingId || "").slice(0, 80),
    meetingLink: String(value.meetingLink || "").slice(0, 1_000),
    name: String(value.name || "Untitled event").slice(0, 500),
    time: /^\d{2}:\d{2}$/u.test(String(value.time || ""))
      ? String(value.time)
      : "00:00",
    type: ["appointment", "birthday", "event", "meeting"].includes(value.type)
      ? value.type
      : "event",
  };
}

export function normalizeCalendarArchiveData(value) {
  const calendars = (Array.isArray(value?.calendars) ? value.calendars : [])
    .filter((calendar) => calendar && typeof calendar === "object")
    .filter((calendar) => calendar.shared !== true)
    .slice(0, 100)
    .map((calendar, calendarIndex) => ({
      ...calendar,
      color: /^#[\da-f]{6}$/iu.test(String(calendar.color || ""))
        ? String(calendar.color).toLowerCase()
        : "#a855f7",
      events: (Array.isArray(calendar.events) ? calendar.events : [])
        .slice(0, 10_000)
        .map(normalizeCalendarEvent),
      favoriteDates: Array.isArray(calendar.favoriteDates)
        ? calendar.favoriteDates
            .filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(String(date)))
            .slice(0, 10_000)
        : [],
      id: String(calendar.id || `calendar-${calendarIndex + 1}`).slice(0, 160),
      name: String(calendar.name || `Calendar ${calendarIndex + 1}`).slice(
        0,
        200,
      ),
      shared: false,
      workspaceId: normalizeWorkspaceId(calendar.workspaceId || "personal"),
    }));
  return {
    activeCalendarId: String(
      value?.activeCalendarId || calendars[0]?.id || "primary",
    ).slice(0, 160),
    calendars,
    showHolidays: value?.showHolidays !== false,
    updatedAt: String(value?.updatedAt || new Date().toISOString()),
  };
}

export function decryptCalendarData(stored) {
  if (
    !validCalendarVault(stored?.vault) ||
    !validCalendarDocument(stored?.document) ||
    stored.vault.keyId !== stored.document.keyId
  ) {
    return null;
  }
  const encrypted = Buffer.from(stored.document.ciphertext, "base64url");
  if (encrypted.length <= 16) return null;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(stored.vault.syncKey, "base64url"),
    Buffer.from(stored.document.iv, "base64url"),
  );
  decipher.setAAD(calendarAdditionalData);
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
  const plaintext = Buffer.concat([
    decipher.update(encrypted.subarray(0, encrypted.length - 16)),
    decipher.final(),
  ]);
  return normalizeCalendarArchiveData(JSON.parse(plaintext.toString("utf8")));
}

export function encryptCalendarData(data, currentVault = null) {
  const vault = validCalendarVault(currentVault)
    ? currentVault
    : {
        algorithm: "AES-GCM",
        keyId: randomBytes(18).toString("base64url"),
        protection: "account",
        syncKey: randomBytes(32).toString("base64url"),
        version: 1,
      };
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(vault.syncKey, "base64url"),
    iv,
  );
  cipher.setAAD(calendarAdditionalData);
  const ciphertext = Buffer.concat([
    cipher.update(
      Buffer.from(JSON.stringify(normalizeCalendarArchiveData(data)), "utf8"),
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    document: {
      algorithm: "AES-GCM",
      ciphertext: ciphertext.toString("base64url"),
      iv: iv.toString("base64url"),
      keyId: vault.keyId,
      version: 1,
    },
    vault,
  };
}

function escapeIcsText(value) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function icsDateTime(date, time) {
  return `${String(date || "").replaceAll("-", "")}T${String(time || "00:00").replaceAll(":", "")}00`;
}

export function calendarDataToIcs(data) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Munetios//Munetios Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const calendar of data?.calendars || []) {
    if (calendar.shared) continue;
    for (const event of calendar.events || []) {
      const updatedAt = new Date(event.updatedAt || Date.now());
      const stamp = Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt;
      const meetingUrl = String(event.meetingLink || "").startsWith("/")
        ? `https://munetios.com${event.meetingLink}`
        : event.meetingLink;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${escapeIcsText(event.id || randomUUID())}@calendar.munetios.com`,
        `DTSTAMP:${stamp
          .toISOString()
          .replaceAll(/[-:]/gu, "")
          .replace(/\.\d{3}Z$/u, "Z")}`,
        `DTSTART:${icsDateTime(event.date, event.time)}`,
        `DURATION:PT${Math.max(1, Math.min(10_080, Number(event.durationMinutes) || 60))}M`,
        `SUMMARY:${escapeIcsText(event.name)}`,
        `DESCRIPTION:${escapeIcsText(event.description)}`,
        `X-MUNETIOS-CALENDAR:${escapeIcsText(calendar.name)}`,
        `X-MUNETIOS-COLOR:${escapeIcsText(event.color || calendar.color)}`,
        `X-MUNETIOS-TYPE:${escapeIcsText(event.type || "event")}`,
        `X-MUNETIOS-WORKSPACE:${escapeIcsText(calendar.workspaceId || "personal")}`,
      );
      if (event.location)
        lines.push(`LOCATION:${escapeIcsText(event.location)}`);
      for (const guest of event.guests || [])
        lines.push(`ATTENDEE:mailto:${escapeIcsText(guest)}`);
      if (meetingUrl) lines.push(`URL:${escapeIcsText(meetingUrl)}`);
      if (event.meetingId)
        lines.push(`X-MUNETIOS-MEETING-ID:${escapeIcsText(event.meetingId)}`);
      lines.push("END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function calendarExportEntries(accountId) {
  const stored = getAccountData(accountId, calendarVaultKey, null);
  let data = null;
  if (stored) {
    try {
      data = decryptCalendarData(stored);
    } catch {
      throw new Error("calendar_export_failed");
    }
    if (!data) throw new Error("calendar_export_failed");
  }
  data ||= normalizeCalendarArchiveData({ calendars: [] });
  const exportedAt = new Date().toISOString();
  return [
    jsonArchiveEntry(`${applicationFolders.calendar}/manifest.json`, {
      exportedAt,
      format: calendarFormat,
    }),
    jsonArchiveEntry(`${applicationFolders.calendar}/Calendar.mcalendar`, {
      data,
      exportedAt,
      format: calendarFormat,
    }),
    {
      bytes: Buffer.from(calendarDataToIcs(data), "utf8"),
      name: `${applicationFolders.calendar}/Calendar.ics`,
    },
  ];
}

function createFileExportEntries(accountId, files) {
  const entries = [];
  const manifests = { ai: [], meet: [], omniwrite: [], tasks: [] };
  for (const file of files) {
    const stored = readAccountFile(accountId, file.id);
    if (!stored) continue;
    const app = appForFile(file);
    const baseName = safeArchiveFileName(file.name, file.id);
    const path = `${applicationFolders[app]}/Files/${file.id}-${baseName}${file.extension}`;
    entries.push({ bytes: stored.bytes, name: path });
    manifests[app].push({
      category: file.category,
      contentType: file.contentType,
      createdAt: file.createdAt,
      extension: file.extension,
      metadata: file.metadata,
      name: file.name,
      path,
      size: file.size,
    });
  }
  return { entries, manifests };
}

export async function processDataExport(accountId, exportId) {
  try {
    updateExportJob(accountId, exportId, { progress: 15 });
    const data = listAllAccountData(accountId).filter(
      (entry) =>
        entry.key !== exportsKey && entry.key !== "account-lifecycle-v1",
    );
    const files = listAccountFiles(accountId);
    const fileExport = createFileExportEntries(accountId, files);
    const workspaces = normalizeExportWorkspaces(
      data.find((entry) => entry.key === "workspaces")?.value,
    );
    const tasks = data.find((entry) => entry.key === tasksVaultKey)?.value;
    const rootManifest = {
      exportedAt: new Date().toISOString(),
      folders: Object.values(applicationFolders),
      format: exportFormat,
      protectedDataExcluded: [
        "account identity and profile",
        "account settings",
        "billing and subscriptions",
        "encryption keys and recovery methods",
      ],
      workspaces,
    };
    const entries = [
      jsonArchiveEntry("manifest.json", rootManifest),
      jsonArchiveEntry(`${applicationFolders.ai}/manifest.json`, {
        content: exportContent(data, importableContentKeys.ai),
        files: fileExport.manifests.ai,
        format: "munetios-ai-export-v1",
      }),
      jsonArchiveEntry(`${applicationFolders.meet}/manifest.json`, {
        files: fileExport.manifests.meet,
        format: "munetios-meet-export-v1",
        history: getAccountData(accountId, "meet-history-v1", []),
      }),
      jsonArchiveEntry(`${applicationFolders.omniwrite}/manifest.json`, {
        content: exportContent(data, importableContentKeys.omniwrite),
        files: fileExport.manifests.omniwrite,
        format: "munetios-omniwrite-export-v1",
      }),
      jsonArchiveEntry(`${applicationFolders.tasks}/manifest.json`, {
        encryptedDocument:
          tasks?.document && tasks?.vault?.keyId === tasks.document.keyId
            ? tasks.document
            : null,
        files: fileExport.manifests.tasks,
        format: "munetios-tasks-export-v1",
        importManifest: getAccountData(accountId, tasksImportKey, null),
        keyMaterialIncluded: false,
      }),
      ...calendarExportEntries(accountId),
      ...fileExport.entries,
    ];
    updateExportJob(accountId, exportId, { progress: 70 });
    mkdirSync(exportDirectory, { recursive: true });
    const path = join(exportDirectory, `${accountId}-${exportId}.zip`);
    const archive = createZip(entries);
    writeFileSync(path, archive);
    updateExportJob(accountId, exportId, {
      completedAt: new Date().toISOString(),
      path,
      progress: 100,
      size: archive.length,
      status: "complete",
    });
  } catch (error) {
    updateExportJob(accountId, exportId, {
      error: String(error?.message || "export_failed").slice(0, 160),
      progress: 0,
      status: "failed",
    });
  }
}

export function readDataExport(accountId, exportId) {
  const job = getExportJobs(accountId).find(
    (entry) => entry.id === exportId && entry.status === "complete",
  );
  if (!job?.path) return null;
  try {
    return { bytes: readFileSync(job.path), job };
  } catch {
    return null;
  }
}

function parseJsonEntry(entries, path, requiredFormat = "") {
  const bytes = entries.get(path);
  if (!bytes) return null;
  if (bytes.length > 32 * 1024 * 1024) throw new Error("manifest_too_large");
  const value = JSON.parse(bytes.toString("utf8"));
  if (requiredFormat && value?.format !== requiredFormat) {
    throw new Error("invalid_import");
  }
  return value;
}

function importContentEntries(accountId, content, allowedKeys) {
  let imported = 0;
  for (const entry of Array.isArray(content) ? content.slice(0, 5000) : []) {
    if (!allowedKeys.has(entry?.key)) continue;
    setAccountData(accountId, entry.key, entry.value);
    imported += 1;
  }
  return imported;
}

function importFileEntries(accountId, entries, files) {
  let imported = 0;
  for (const file of Array.isArray(files) ? files.slice(0, 2000) : []) {
    if (!importableFileCategories.has(String(file?.category || ""))) continue;
    const path = String(file?.path || "");
    if (!validArchivePath(path)) continue;
    const fileBytes = entries.get(path);
    if (!fileBytes) continue;
    const saved = saveAccountFile({
      accountId,
      bytes: new Uint8Array(fileBytes),
      category: file.category,
      contentType: file.contentType,
      extension: file.extension,
      metadata: file.metadata,
      name: file.name,
    });
    if (saved.file) imported += 1;
  }
  return imported;
}

function importWorkspaces(accountId, value) {
  const imported = normalizeExportWorkspaces(value);
  if (!imported.length) return 0;
  const current = normalizeExportWorkspaces(
    getAccountData(accountId, "workspaces", []),
  );
  const usedIds = new Set(current.map((workspace) => workspace.id));
  const merged = [...current];
  for (const workspace of imported) {
    if (usedIds.has(workspace.id)) continue;
    merged.push({
      ...workspace,
      ownerId: accountId,
      primary: merged.length === 0,
    });
    usedIds.add(workspace.id);
  }
  if (merged.length)
    setAccountData(accountId, "workspaces", merged.slice(0, 100));
  return Math.max(0, merged.length - current.length);
}

function validEncryptedTaskDocument(value) {
  const validPart = (part, maximum) =>
    typeof part === "string" &&
    part.length > 0 &&
    part.length <= maximum &&
    /^[A-Za-z0-9_-]+$/u.test(part);
  return Boolean(
    value?.version === 1 &&
      value.algorithm === "AES-GCM" &&
      validPart(value.keyId, 100) &&
      validPart(value.iv, 100) &&
      validPart(value.ciphertext, 4_500_000),
  );
}

function importTaskManifest(accountId, manifest) {
  const document = manifest?.encryptedDocument;
  const current = getAccountData(accountId, tasksVaultKey, null);
  if (
    !validEncryptedTaskDocument(document) ||
    !current?.vault ||
    current.vault.keyId !== document.keyId
  ) {
    if (manifest?.importManifest) {
      setAccountData(accountId, tasksImportKey, manifest.importManifest);
      return 1;
    }
    return 0;
  }
  setAccountData(accountId, tasksVaultKey, {
    ...current,
    document,
    updatedAt: new Date().toISOString(),
  });
  return 1;
}

function stableImportId(prefix, ...parts) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part || "")).join("\u0000"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${digest}`;
}

function unescapeIcsText(value) {
  return String(value || "")
    .replaceAll(/\\[nN]/gu, "\n")
    .replaceAll("\\,", ",")
    .replaceAll("\\;", ";")
    .replaceAll("\\\\", "\\");
}

function parseIcsProperty(line) {
  const separator = line.indexOf(":");
  if (separator < 1) return null;
  const descriptor = line.slice(0, separator);
  const [rawName, ...parameterParts] = descriptor.split(";");
  const parameters = Object.fromEntries(
    parameterParts.map((part) => {
      const equals = part.indexOf("=");
      return equals < 0
        ? [part.toUpperCase(), ""]
        : [part.slice(0, equals).toUpperCase(), part.slice(equals + 1)];
    }),
  );
  return {
    name: rawName.toUpperCase(),
    parameters,
    value: line.slice(separator + 1),
  };
}

function parseIcsDateTime(property) {
  const raw = String(property?.value || "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/u);
  if (!match) return null;
  return {
    allDay: property?.parameters?.VALUE === "DATE" || !match[4],
    date: `${match[1]}-${match[2]}-${match[3]}`,
    time: match[4] ? `${match[4]}:${match[5]}` : "00:00",
    timeZone: String(
      property?.parameters?.TZID || (raw.endsWith("Z") ? "UTC" : ""),
    ),
  };
}

function parseIcsDuration(properties, start, first) {
  const duration = String(first(properties, "DURATION")?.value || "");
  const durationMatch = duration.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/iu,
  );
  if (durationMatch) {
    return Math.max(
      1,
      Math.min(
        10_080,
        Number(durationMatch[1] || 0) * 1_440 +
          Number(durationMatch[2] || 0) * 60 +
          Number(durationMatch[3] || 0),
      ),
    );
  }
  const end = parseIcsDateTime(first(properties, "DTEND"));
  if (!end) return 60;
  const startInstant = Date.parse(`${start.date}T${start.time}:00Z`);
  const endInstant = Date.parse(`${end.date}T${end.time}:00Z`);
  return Math.max(
    1,
    Math.min(10_080, Math.round((endInstant - startInstant) / 60_000) || 60),
  );
}

function expandRecurringCalendarEvent(event, recurrence, createId) {
  if (!recurrence) return [event];
  const rule = Object.fromEntries(
    recurrence.split(";").map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? [part.toUpperCase(), ""]
        : [part.slice(0, separator).toUpperCase(), part.slice(separator + 1)];
    }),
  );
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.FREQ)) {
    return [event];
  }
  const interval = Math.max(1, Math.min(100, Number(rule.INTERVAL) || 1));
  const limit = Math.max(1, Math.min(1_000, Number(rule.COUNT) || 500));
  const untilMatch = String(rule.UNTIL || "").match(/^(\d{4})(\d{2})(\d{2})/u);
  const horizon = new Date();
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 5);
  const until = untilMatch
    ? new Date(`${untilMatch[1]}-${untilMatch[2]}-${untilMatch[3]}T23:59:59Z`)
    : horizon;
  const end = until < horizon ? until : horizon;
  const start = new Date(`${event.date}T00:00:00Z`);
  const dayNumbers = { FR: 5, MO: 1, SA: 6, SU: 0, TH: 4, TU: 2, WE: 3 };
  const weekdays = String(rule.BYDAY || "")
    .split(",")
    .map((day) => dayNumbers[day.replace(/^[+-]?\d+/u, "")])
    .filter((day) => Number.isInteger(day));
  const results = [];
  let cursor = new Date(start);
  let iterations = 0;
  while (cursor <= end && results.length < limit && iterations < 20_000) {
    const offset = Math.floor((cursor - start) / 86_400_000);
    const matches =
      rule.FREQ === "DAILY"
        ? offset % interval === 0
        : rule.FREQ === "WEEKLY"
          ? Math.floor(offset / 7) % interval === 0 &&
            (weekdays.length
              ? weekdays.includes(cursor.getUTCDay())
              : cursor.getUTCDay() === start.getUTCDay())
          : true;
    if (matches) {
      const date = cursor.toISOString().slice(0, 10);
      results.push({
        ...event,
        date,
        id: createId(date, event.time),
        recurrence,
        recurrenceMasterId: event.id,
      });
    }
    if (rule.FREQ === "MONTHLY") {
      const day = start.getUTCDate();
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + interval, 1),
      );
      cursor.setUTCDate(
        Math.min(
          day,
          new Date(
            Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
          ).getUTCDate(),
        ),
      );
    } else if (rule.FREQ === "YEARLY") {
      cursor = new Date(
        Date.UTC(
          cursor.getUTCFullYear() + interval,
          start.getUTCMonth(),
          start.getUTCDate(),
        ),
      );
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    iterations += 1;
  }
  return results.length ? results : [event];
}

export function parseIcsCalendar(bytes, sourceName = "Imported calendar") {
  const text = bytes
    .toString("utf8")
    .replace(/^\uFEFF/u, "")
    .replaceAll(/\r?\n[ \t]/gu, "");
  if (!/BEGIN:VCALENDAR/iu.test(text)) throw new Error("invalid_calendar_file");
  const lines = text.split(/\r?\n/gu);
  const globalProperties = new Map();
  const eventProperties = [];
  let currentEvent = null;
  for (const line of lines) {
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      currentEvent = new Map();
      continue;
    }
    if (line.toUpperCase() === "END:VEVENT") {
      if (currentEvent) eventProperties.push(currentEvent);
      currentEvent = null;
      continue;
    }
    const property = parseIcsProperty(line);
    if (!property) continue;
    const target = currentEvent || globalProperties;
    if (!target.has(property.name)) target.set(property.name, []);
    target.get(property.name).push(property);
  }
  const first = (properties, name) => properties.get(name)?.[0] || null;
  const sourceTitle = unescapeIcsText(
    first(globalProperties, "X-WR-CALNAME")?.value ||
      String(sourceName).replace(/\.ics$/iu, ""),
  ).slice(0, 200);
  const grouped = new Map();
  for (const properties of eventProperties.slice(0, 10_000)) {
    const start = parseIcsDateTime(first(properties, "DTSTART"));
    if (!start) continue;
    const uid = unescapeIcsText(first(properties, "UID")?.value || "");
    const calendarName = unescapeIcsText(
      first(properties, "X-MUNETIOS-CALENDAR")?.value || sourceTitle,
    ).slice(0, 200);
    if (!grouped.has(calendarName)) grouped.set(calendarName, []);
    const url = unescapeIcsText(first(properties, "URL")?.value || "");
    const meetingId = unescapeIcsText(
      first(properties, "X-MUNETIOS-MEETING-ID")?.value || "",
    );
    const importedType = unescapeIcsText(
      first(properties, "X-MUNETIOS-TYPE")?.value || "event",
    );
    const createId = (date, time) =>
      stableImportId("calendar-event", uid, calendarName, date, time);
    const recurrence = unescapeIcsText(first(properties, "RRULE")?.value || "");
    const excludedDates = new Set(
      (properties.get("EXDATE") || []).flatMap((property) =>
        String(property.value || "")
          .split(",")
          .flatMap((value) => {
            const parsed = parseIcsDateTime({ ...property, value });
            return parsed ? [parsed.date] : [];
          }),
      ),
    );
    const importedEvent = normalizeCalendarEvent({
      allDay: start.allDay,
      color: unescapeIcsText(
        first(properties, "X-MUNETIOS-COLOR")?.value || "#4285f4",
      ),
      createdAt: new Date().toISOString(),
      date: start.date,
      description: unescapeIcsText(
        first(properties, "DESCRIPTION")?.value || "",
      ),
      durationMinutes: parseIcsDuration(properties, start, first),
      guests: (properties.get("ATTENDEE") || []).map((property) =>
        unescapeIcsText(property.value || "").replace(/^mailto:/iu, ""),
      ),
      id: createId(start.date, start.time),
      location: unescapeIcsText(first(properties, "LOCATION")?.value || ""),
      meetingId,
      meetingLink:
        url && /\/apps\/meet|meet\.munetios\.com/iu.test(url)
          ? url
          : meetingId
            ? `/apps/meet?room=${encodeURIComponent(meetingId)}&rejoin=1`
            : "",
      name: unescapeIcsText(
        first(properties, "SUMMARY")?.value || "Untitled event",
      ),
      recurrence,
      source: "Google Calendar",
      sourceUid: uid,
      time: start.time,
      timeZone: start.timeZone,
      type: ["appointment", "birthday", "event", "meeting"].includes(
        importedType,
      )
        ? importedType
        : "event",
      updatedAt: new Date().toISOString(),
    });
    grouped
      .get(calendarName)
      .push(
        ...expandRecurringCalendarEvent(
          importedEvent,
          recurrence,
          createId,
        ).filter((event) => !excludedDates.has(event.date)),
      );
  }
  return normalizeCalendarArchiveData({
    calendars: [...grouped.entries()].map(([name, events]) => ({
      color: "#4285f4",
      createdAt: new Date().toISOString(),
      events: [...new Map(events.map((event) => [event.id, event])).values()],
      favoriteDates: [],
      id: stableImportId("calendar", sourceName, name),
      name,
      updatedAt: new Date().toISOString(),
      workspaceId: "personal",
    })),
  });
}

function parseMunetiosCalendar(bytes) {
  const payload = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  if (payload?.format !== calendarFormat || !payload?.data) {
    throw new Error("invalid_calendar_file");
  }
  return normalizeCalendarArchiveData(payload.data);
}

function importCalendarData(accountId, importedData, workspaceId = "default") {
  let stored = getAccountData(accountId, calendarVaultKey, null);
  let current = null;
  try {
    current = decryptCalendarData(stored);
  } catch {
    current = null;
  }
  current ||= normalizeCalendarArchiveData({ calendars: [] });
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const calendars = [...current.calendars];
  let importedEvents = 0;
  for (const importedCalendar of importedData.calendars || []) {
    const calendar = {
      ...importedCalendar,
      workspaceId:
        normalizedWorkspaceId === "default"
          ? importedCalendar.workspaceId || "personal"
          : normalizedWorkspaceId,
    };
    const existingIndex = calendars.findIndex(
      (candidate) => candidate.id === calendar.id,
    );
    if (existingIndex < 0) {
      calendars.push(calendar);
      importedEvents += calendar.events.length;
      continue;
    }
    const existing = calendars[existingIndex];
    const eventMap = new Map(
      (existing.events || []).map((event) => [event.id, event]),
    );
    for (const event of calendar.events || []) {
      if (!eventMap.has(event.id)) importedEvents += 1;
      eventMap.set(event.id, event);
    }
    calendars[existingIndex] = {
      ...existing,
      ...calendar,
      events: [...eventMap.values()].slice(0, 10_000),
      updatedAt: new Date().toISOString(),
    };
  }
  const data = normalizeCalendarArchiveData({
    ...current,
    activeCalendarId: current.activeCalendarId || calendars[0]?.id,
    calendars,
    updatedAt: new Date().toISOString(),
  });
  const encrypted = encryptCalendarData(data, stored?.vault);
  stored = { ...encrypted, updatedAt: new Date().toISOString() };
  setAccountData(accountId, calendarVaultKey, stored);
  return { calendars: importedData.calendars.length, events: importedEvents };
}

function normalizeImportedTaskItems(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object")
    .slice(0, 10_000);
}

function googleTaskCollections(value, sourceName) {
  const sourceTitle = String(sourceName || "Google Tasks").replace(
    /\.json$/iu,
    "",
  );
  const possibleLists = Array.isArray(value)
    ? value
    : Array.isArray(value?.lists)
      ? value.lists
      : Array.isArray(value?.taskLists)
        ? value.taskLists
        : Array.isArray(value?.items) &&
            value.items.some(
              (item) =>
                item?.kind === "tasks#taskList" ||
                Array.isArray(item?.tasks) ||
                Array.isArray(item?.items),
            )
          ? value.items
          : [];
  const listCollections = possibleLists
    .filter(
      (item) =>
        item?.kind === "tasks#taskList" ||
        Array.isArray(item?.tasks) ||
        Array.isArray(item?.items),
    )
    .map((list, index) => ({
      id: list.id || `${sourceTitle}-${index}`,
      records: normalizeImportedTaskItems(list.tasks || list.items),
      title: list.title || list.name || `${sourceTitle} ${index + 1}`,
      updated: list.updated,
    }))
    .filter((list) => list.records.length);
  if (listCollections.length) return listCollections;
  const records = normalizeImportedTaskItems(
    Array.isArray(value)
      ? value
      : Array.isArray(value?.tasks)
        ? value.tasks
        : value?.items,
  );
  return records.length
    ? [
        {
          id: value?.id || sourceTitle,
          records,
          title: value?.title || value?.name || sourceTitle,
          updated: value?.updated,
        },
      ]
    : [];
}

function taskIsCompleted(task) {
  return task?.status === "completed" || Boolean(task?.completed);
}

function normalizeTaskSubtasks(value, identityPrefix) {
  return normalizeImportedTaskItems(value)
    .map((subtask, index) => {
      const label = String(subtask.label || subtask.title || subtask.name || "")
        .trim()
        .slice(0, 500);
      if (!label) return null;
      return {
        done: subtask.done === true || taskIsCompleted(subtask),
        id: stableImportId(
          "subtask-google",
          identityPrefix,
          subtask.id || index,
          label,
        ),
        label,
      };
    })
    .filter(Boolean);
}

function normalizeTaskOptions(value, identityPrefix) {
  return normalizeImportedTaskItems(value)
    .map((option, index) => {
      const label = String(option.label || option.title || option.name || "")
        .trim()
        .slice(0, 500);
      if (!label) return null;
      return {
        done: option.done === true || taskIsCompleted(option),
        id: stableImportId(
          "option-google",
          identityPrefix,
          option.id || index,
          label,
        ),
        label,
        subtasks: normalizeTaskSubtasks(
          option.subtasks || option.children,
          `${identityPrefix}:${option.id || index}`,
        ),
      };
    })
    .filter(Boolean);
}

function descendantTaskOptions(task, records, identityPrefix) {
  const children = records
    .filter((candidate) => String(candidate.parent || "") === String(task.id))
    .sort((left, right) =>
      String(left.position || "").localeCompare(String(right.position || "")),
    );
  return children.map((child, index) => {
    const grandchildren = records.filter(
      (candidate) => String(candidate.parent || "") === String(child.id),
    );
    const nested = grandchildren.flatMap((grandchild) => [
      {
        ...grandchild,
        label: grandchild.title || grandchild.name,
      },
      ...records
        .filter(
          (candidate) =>
            String(candidate.parent || "") === String(grandchild.id),
        )
        .map((descendant) => ({
          ...descendant,
          label: descendant.title || descendant.name,
        })),
    ]);
    return {
      done: taskIsCompleted(child),
      id: stableImportId("option-google", identityPrefix, child.id || index),
      label:
        String(child.title || child.name || "Google task")
          .trim()
          .slice(0, 500) || "Google task",
      subtasks: normalizeTaskSubtasks(
        nested,
        `${identityPrefix}:${child.id || index}`,
      ),
    };
  });
}

function normalizeGoogleTasks(value, sourceName) {
  const collections = googleTaskCollections(value, sourceName);
  if (!collections.length) return null;
  const now = new Date().toISOString();
  const lists = [];
  const tasks = [];
  for (const collection of collections) {
    const listId = stableImportId(
      "list-google",
      sourceName,
      collection.id,
      collection.title,
    );
    const listName =
      String(collection.title || sourceName || "Google Tasks")
        .trim()
        .slice(0, 80) || "Google Tasks";
    lists.push({
      createdAt: String(collection.updated || now),
      id: listId,
      name: listName,
      slug: `google-${listId.slice(-12)}`,
      system: false,
      updatedAt: String(collection.updated || now),
    });
    const records = collection.records.filter((task) => !task.deleted);
    const recordIds = new Set(records.map((task) => String(task.id || "")));
    const topLevel = records
      .filter((task) => !task.parent || !recordIds.has(String(task.parent)))
      .sort((left, right) =>
        String(left.position || "").localeCompare(String(right.position || "")),
      );
    for (const [index, task] of topLevel.entries()) {
      const name = String(task.title || task.name || "")
        .trim()
        .slice(0, 500);
      if (!name) continue;
      const completed = taskIsCompleted(task);
      const identity = `${sourceName}:${collection.id}:${task.id || index}`;
      const directOptions = normalizeTaskOptions(
        task.options || task.checklist || task.subtasks,
        identity,
      );
      tasks.push({
        archived: Boolean(task.hidden),
        attachment: null,
        categoryId: "",
        completedAt: completed
          ? String(task.completed || task.updated || now)
          : null,
        createdAt: String(task.created || task.updated || now),
        description: String(task.notes || task.description || "").slice(
          0,
          8192,
        ),
        dueDate: /^\d{4}-\d{2}-\d{2}/u.test(String(task.due || ""))
          ? String(task.due).slice(0, 10)
          : "",
        dueTime: "",
        favorite: Boolean(task.favorite || task.starred),
        id: stableImportId("task-google", identity, name),
        listId,
        name,
        options: [
          ...directOptions,
          ...descendantTaskOptions(task, records, identity),
        ].filter(
          (option, optionIndex, options) =>
            options.findIndex(
              (candidate) =>
                candidate.id === option.id || candidate.label === option.label,
            ) === optionIndex,
        ),
        sharedWith: [],
        status: completed ? "completed" : "active",
        trashedAt: null,
        updatedAt: String(task.updated || now),
      });
    }
  }
  return tasks.length ? { lists, tasks } : null;
}

function extensionFromPath(path) {
  const match = String(path).match(/(\.[a-z\d]{1,10})$/iu);
  return match ? match[1].toLowerCase() : ".bin";
}

function normalizedFieldMap(value) {
  return Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {}).map(
      ([key, fieldValue]) => [
        key.toLowerCase().replace(/[^a-z\d]/gu, ""),
        fieldValue,
      ],
    ),
  );
}

function firstField(fields, names) {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function parseCallTimestamp(value) {
  if (/^\d{10,18}$/u.test(String(value || "").trim())) {
    return parseCallTimestamp(Number(value));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds =
      value > 100_000_000_000_000
        ? value / 1000
        : value > 10_000_000_000
          ? value
          : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function parseCallDuration(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  const text = String(value || "").trim();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/u.test(text))
    return Math.max(0, Math.round(Number(text)));
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/u);
  if (clock) {
    return (
      Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
    );
  }
  const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:h|hour)/iu)?.[1] || 0);
  const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:m|min)/iu)?.[1] || 0);
  const seconds = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:s|sec)/iu)?.[1] || 0);
  return Math.max(0, Math.round(hours * 3600 + minutes * 60 + seconds));
}

function normalizeGoogleMeetCall(value, sourceName, index) {
  const fields = normalizedFieldMap(value);
  const started = firstField(fields, [
    "starttime",
    "startedat",
    "callstarttime",
    "callstarted",
    "starttimestamp",
    "starttimestampusec",
    "joinedat",
    "timestamp",
    "timestampmsec",
    "timestampusec",
    "datetime",
    "date",
    "time",
  ]);
  const ended = firstField(fields, [
    "endtime",
    "endedat",
    "callendtime",
    "callended",
    "endtimestamp",
    "endtimestampusec",
    "leftat",
  ]);
  const joinedAt = parseCallTimestamp(started);
  const endedAt = parseCallTimestamp(ended);
  const idValue = firstField(fields, [
    "id",
    "callid",
    "conferenceid",
    "conferencerecord",
    "name",
    "meetingid",
    "meetingcode",
    "groupid",
    "space",
  ]);
  const titleValue = firstField(fields, [
    "title",
    "meetingtitle",
    "displayname",
    "contactname",
    "participantname",
    "otherparticipant",
    "otherparty",
    "otherpartyidentifier",
    "contact",
    "participant",
    "participants",
    "callee",
    "calleephonenumber",
    "caller",
    "callerphonenumber",
    "email",
  ]);
  const hasCallIdentity = Boolean(
    joinedAt ||
      endedAt ||
      idValue ||
      fields.duration ||
      fields.durationseconds ||
      fields.durationmillis ||
      fields.durationusec,
  );
  if (!hasCallIdentity) return null;
  const calculatedDuration =
    joinedAt && endedAt
      ? Math.max(
          0,
          Math.round(
            (new Date(endedAt).getTime() - new Date(joinedAt).getTime()) / 1000,
          ),
        )
      : 0;
  const durationMilliseconds = Number(fields.durationmillis || 0);
  const durationMicroseconds = Number(fields.durationusec || 0);
  const durationSeconds = durationMicroseconds
    ? Math.max(0, Math.round(durationMicroseconds / 1_000_000))
    : durationMilliseconds
      ? Math.max(0, Math.round(durationMilliseconds / 1000))
      : parseCallDuration(
          firstField(fields, ["durationseconds", "duration", "callduration"]),
        ) || calculatedDuration;
  const meetingId = String(idValue || "")
    .replace(/^conferenceRecords\//u, "")
    .slice(0, 200);
  return {
    durationSeconds,
    id: stableImportId("meet-google", sourceName, meetingId, joinedAt, index),
    joinedAt: joinedAt || new Date().toISOString(),
    meetingId,
    title:
      String(titleValue || "Google Meet")
        .trim()
        .slice(0, 160) || "Google Meet",
  };
}

function collectMeetJsonRecords(value, records = [], depth = 0) {
  if (depth > 8 || records.length >= 5000) return records;
  if (Array.isArray(value)) {
    for (const item of value) collectMeetJsonRecords(item, records, depth + 1);
    return records;
  }
  if (!value || typeof value !== "object") return records;
  const fields = normalizedFieldMap(value);
  if (
    fields.starttime ||
    fields.starttimestamp ||
    fields.starttimestampusec ||
    fields.callstarttime ||
    fields.joinedat ||
    fields.timestampusec ||
    fields.conferenceid ||
    fields.conferencerecord ||
    fields.callid ||
    fields.duration ||
    fields.durationseconds
  ) {
    records.push(value);
    return records;
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectMeetJsonRecords(child, records, depth + 1);
    }
  }
  return records;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function tableRowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) =>
    header.replace(/^\uFEFF/u, "").trim(),
  );
  return rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row[index] || ""]),
      ),
    );
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function parseHtmlTableRows(text) {
  return [...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) =>
    [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/giu)].map((cell) =>
      decodeHtmlText(cell[1]),
    ),
  );
}

function parseGoogleMeetHistory(bytes, extension, sourceName) {
  const text = bytes.toString("utf8").replace(/^\uFEFF/u, "");
  let records = [];
  if (extension === ".json") {
    records = collectMeetJsonRecords(JSON.parse(text));
  } else if (extension === ".csv") {
    records = tableRowsToObjects(parseCsvRows(text));
  } else if (extension === ".html" || extension === ".htm") {
    records = tableRowsToObjects(parseHtmlTableRows(text));
  }
  return records
    .slice(0, 5000)
    .map((record, index) => normalizeGoogleMeetCall(record, sourceName, index))
    .filter(Boolean);
}

function isMeetRecording(path, contentType = "") {
  return (
    /^(audio|video)\//iu.test(contentType) ||
    [".m4a", ".mkv", ".mov", ".mp3", ".mp4", ".ogg", ".wav", ".webm"].includes(
      extensionFromPath(path),
    )
  );
}

function takeoutApplication(path, contentType = "") {
  const normalized = `/${String(path).replaceAll("\\", "/")}/`.toLowerCase();
  if (
    normalized.includes("/calendar/") ||
    normalized.includes("/calendars/") ||
    contentType === "text/calendar"
  ) {
    return "calendar";
  }
  if (normalized.includes("/tasks/") || normalized.includes("/google tasks/")) {
    return "tasks";
  }
  if (
    normalized.includes("/meet/") ||
    normalized.includes("/google meet/") ||
    normalized.includes("/meet recordings/") ||
    /^(audio|video)\//iu.test(contentType)
  ) {
    return "meet";
  }
  if (
    normalized.includes("/gemini apps/") ||
    normalized.includes("/my activity/gemini/")
  ) {
    return "ai";
  }
  if (normalized.includes("/drive/") || normalized.includes("/google drive/")) {
    return "omniwrite";
  }
  return "";
}

function normalizeWorkspaceId(value) {
  const id = String(value || "default");
  return /^[A-Za-z0-9_-]{1,120}$/u.test(id) ? id : "default";
}

export function importGoogleTakeoutEntries(
  accountId,
  inputEntries,
  { workspaceId = "default" } = {},
) {
  const entries = inputEntries instanceof Map ? inputEntries : new Map();
  const importedTaskLists = [];
  const importedTasks = [];
  const importedMeetCalls = [];
  const importedCalendarData = [];
  let fileItems = 0;
  for (const [path, rawEntry] of entries) {
    if (!validArchivePath(path)) throw new Error("unsafe_zip_path");
    const entry = Buffer.isBuffer(rawEntry)
      ? { bytes: rawEntry, contentType: "" }
      : rawEntry;
    const bytes = Buffer.from(entry?.bytes || []);
    const app = takeoutApplication(path, entry?.contentType || "");
    if (!app || !bytes.length) continue;
    const extension = extensionFromPath(path);
    if (app === "calendar" && [".ics", ".mcalendar"].includes(extension)) {
      try {
        importedCalendarData.push(
          extension === ".ics"
            ? parseIcsCalendar(bytes, path.split("/").at(-1))
            : parseMunetiosCalendar(bytes),
        );
      } catch {}
      continue;
    }
    if (app === "tasks" && extension === ".json") {
      try {
        const parsed = normalizeGoogleTasks(
          JSON.parse(bytes.toString("utf8")),
          path.split("/").at(-1),
        );
        if (parsed) {
          importedTaskLists.push(...parsed.lists);
          importedTasks.push(...parsed.tasks);
        }
      } catch {}
      continue;
    }
    if (
      app === "meet" &&
      [".csv", ".htm", ".html", ".json"].includes(extension)
    ) {
      try {
        importedMeetCalls.push(
          ...parseGoogleMeetHistory(bytes, extension, path.split("/").at(-1)),
        );
      } catch {}
      continue;
    }
    if (app === "meet" && !isMeetRecording(path, entry?.contentType || "")) {
      continue;
    }
    const category = {
      ai: "ai-file",
      meet: "meet-recording",
      omniwrite: "omniwrite-file",
      tasks: "tasks-attachment",
    }[app];
    const saved = saveAccountFile({
      accountId,
      bytes: new Uint8Array(bytes),
      category,
      contentType: entry?.contentType || "application/octet-stream",
      extension: extensionFromPath(path),
      metadata: {
        importedFrom: "Google Takeout",
        originalPath: path.slice(0, 500),
      },
      name: path.split("/").at(-1),
    });
    if (saved.file) fileItems += 1;
  }
  if (importedTasks.length) {
    const previous = getAccountData(accountId, tasksImportKey, {});
    const lists = [
      ...(Array.isArray(previous?.lists) ? previous.lists : []),
      ...importedTaskLists,
    ].filter(
      (list, index, allLists) =>
        list?.id &&
        allLists.findIndex((candidate) => candidate?.id === list.id) === index,
    );
    const tasks = [
      ...(Array.isArray(previous?.tasks) ? previous.tasks : []),
      ...importedTasks,
    ].filter(
      (task, index, allTasks) =>
        task?.id &&
        allTasks.findIndex((candidate) => candidate?.id === task.id) === index,
    );
    setAccountData(accountId, tasksImportKey, {
      format: "munetios-tasks-import-v1",
      importedAt: new Date().toISOString(),
      lists: lists.slice(0, 1000),
      tasks: tasks.slice(0, 10_000),
      workspaceId: normalizeWorkspaceId(workspaceId),
    });
  }
  if (importedMeetCalls.length) {
    const previousCalls = getAccountData(accountId, "meet-history-v1", []);
    const calls = [
      ...importedMeetCalls,
      ...(Array.isArray(previousCalls) ? previousCalls : []),
    ].filter(
      (call, index, allCalls) =>
        allCalls.findIndex(
          (candidate) =>
            candidate.id === call.id ||
            (candidate.meetingId &&
              candidate.meetingId === call.meetingId &&
              candidate.joinedAt === call.joinedAt),
        ) === index,
    );
    setAccountData(accountId, "meet-history-v1", calls.slice(0, 100));
  }
  const importedCalendarResult = importedCalendarData.length
    ? importCalendarData(
        accountId,
        normalizeCalendarArchiveData({
          calendars: importedCalendarData.flatMap(
            (calendarData) => calendarData.calendars,
          ),
        }),
        workspaceId,
      )
    : { calendars: 0, events: 0 };
  if (
    !fileItems &&
    !importedTasks.length &&
    !importedMeetCalls.length &&
    !importedCalendarResult.calendars
  ) {
    throw new Error("no_takeout_data");
  }
  return {
    calendarEvents: importedCalendarResult.events,
    calendars: importedCalendarResult.calendars,
    dataItems: importedTasks.length + importedMeetCalls.length,
    fileItems,
    imported: true,
    meetingCalls: importedMeetCalls.length,
    source: "google-takeout",
    taskLists: importedTaskLists.length,
    tasks: importedTasks.length,
  };
}

function importVersionTwo(accountId, entries) {
  const root = parseJsonEntry(entries, "manifest.json", exportFormat);
  if (!root) throw new Error("invalid_import");
  const ai = parseJsonEntry(
    entries,
    `${applicationFolders.ai}/manifest.json`,
    "munetios-ai-export-v1",
  );
  const meet = parseJsonEntry(
    entries,
    `${applicationFolders.meet}/manifest.json`,
    "munetios-meet-export-v1",
  );
  const omniwrite = parseJsonEntry(
    entries,
    `${applicationFolders.omniwrite}/manifest.json`,
    "munetios-omniwrite-export-v1",
  );
  const tasks = parseJsonEntry(
    entries,
    `${applicationFolders.tasks}/manifest.json`,
    "munetios-tasks-export-v1",
  );
  const calendar = parseJsonEntry(
    entries,
    `${applicationFolders.calendar}/Calendar.mcalendar`,
    calendarFormat,
  );
  let dataItems = importWorkspaces(accountId, root.workspaces);
  dataItems += importContentEntries(
    accountId,
    ai?.content,
    importableContentKeys.ai,
  );
  dataItems += importContentEntries(
    accountId,
    omniwrite?.content,
    importableContentKeys.omniwrite,
  );
  if (Array.isArray(meet?.history)) {
    setAccountData(accountId, "meet-history-v1", meet.history.slice(0, 100));
    dataItems += 1;
  }
  dataItems += importTaskManifest(accountId, tasks);
  if (calendar?.data) {
    const importedCalendar = importCalendarData(accountId, calendar.data);
    dataItems += importedCalendar.calendars + importedCalendar.events;
  }
  const fileItems =
    importFileEntries(accountId, entries, ai?.files) +
    importFileEntries(accountId, entries, meet?.files) +
    importFileEntries(accountId, entries, omniwrite?.files) +
    importFileEntries(accountId, entries, tasks?.files);
  return { dataItems, fileItems, imported: true, source: "munetios" };
}

function importLegacyVersionOne(accountId, entries, manifest) {
  let dataItems = 0;
  for (const entry of Array.isArray(manifest.data)
    ? manifest.data.slice(0, 5000)
    : []) {
    if (entry?.key === "meet-history-v1" && Array.isArray(entry.value)) {
      setAccountData(accountId, entry.key, entry.value.slice(0, 100));
      dataItems += 1;
    } else if (entry?.key === tasksVaultKey) {
      dataItems += importTaskManifest(accountId, {
        encryptedDocument: entry.value?.document,
      });
    } else {
      for (const keys of Object.values(importableContentKeys)) {
        if (keys.has(entry?.key)) {
          setAccountData(accountId, entry.key, entry.value);
          dataItems += 1;
          break;
        }
      }
    }
  }
  const files = (Array.isArray(manifest.files) ? manifest.files : []).map(
    (file) => ({
      ...file,
      path: `files/${file.id}${file.extension}`,
    }),
  );
  return {
    dataItems,
    fileItems: importFileEntries(accountId, entries, files),
    imported: true,
    source: "munetios-legacy",
  };
}

export function importDataArchive(
  accountId,
  input,
  { workspaceId = "default" } = {},
) {
  const bytes = Buffer.from(input);
  if (!bytes.length || bytes.length > maximumImportBytes)
    throw new Error("invalid_import_size");
  const prefix = bytes
    .subarray(0, 512)
    .toString("utf8")
    .replace(/^\uFEFF/u, "");
  if (/^\s*BEGIN:VCALENDAR/iu.test(prefix)) {
    const imported = importCalendarData(
      accountId,
      parseIcsCalendar(bytes, "Imported calendar"),
      workspaceId,
    );
    return { ...imported, imported: true, source: "calendar-ics" };
  }
  if (/^\s*\{/u.test(prefix)) {
    try {
      const imported = importCalendarData(
        accountId,
        parseMunetiosCalendar(bytes),
        workspaceId,
      );
      return { ...imported, imported: true, source: "munetios-calendar" };
    } catch (error) {
      if (error?.message !== "invalid_calendar_file") throw error;
    }
  }
  const entries = readZip(bytes);
  if (entries.has("manifest.json")) return importVersionTwo(accountId, entries);
  const legacyBytes = entries.get("munetios-account-data.json");
  if (legacyBytes) {
    const manifest = JSON.parse(legacyBytes.toString("utf8"));
    if (manifest?.format !== "munetios-account-export-v1") {
      throw new Error("invalid_import");
    }
    return importLegacyVersionOne(accountId, entries, manifest);
  }
  return importGoogleTakeoutEntries(accountId, entries, { workspaceId });
}

export function deleteAllRecordings(accountId) {
  const recordings = listAccountFiles(accountId, "meet-recording");
  for (const recording of recordings) {
    deleteAccountFile(accountId, recording.id, "meet-recording");
  }
  return recordings.length;
}

export function deleteExportFiles(accountId) {
  for (const job of getExportJobs(accountId)) {
    if (!job.path) continue;
    try {
      rmSync(job.path, { force: true });
    } catch {}
  }
  saveExportJobs(accountId, []);
}
