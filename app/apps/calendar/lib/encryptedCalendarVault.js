"use client";

import {
  fetchEncryptedCalendarCollaborations,
  mergeSharedCalendars,
} from "./calendarCollaboration";
import { publishCalendarSyncStatus } from "./calendarSync";

const additionalData = new TextEncoder().encode("munetios.calendar.v1");
const localDocumentKey = "munetios.calendar.encrypted.v1";
const localPendingSyncKey = "munetios.calendar.pendingSync.v1";
const databaseName = "munetios-calendar-crypto";
const databaseStore = "keys";
const accountVaultUrl = "/api/calendar/vault";
let unlockedAccount = null;

const defaultCalendar = Object.freeze({
  color: "#a855f7",
  createdAt: "",
  events: [],
  favoriteDates: [],
  id: "primary",
  name: "",
  workspaceId: "personal",
  updatedAt: "",
});

function encode(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decode(value) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizeColor(value) {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : "#a855f7";
}

export function normalizeCalendarData(value) {
  const calendars = Array.isArray(value?.calendars)
    ? value.calendars
        .filter((calendar) => calendar && typeof calendar === "object")
        .slice(0, 100)
        .map((calendar, index) => ({
          color: normalizeColor(calendar.color),
          createdAt:
            typeof calendar.createdAt === "string" ? calendar.createdAt : "",
          events: Array.isArray(calendar.events)
            ? calendar.events.slice(0, 10_000)
            : [],
          favoriteDates: Array.isArray(calendar.favoriteDates)
            ? [
                ...new Set(
                  calendar.favoriteDates
                    .filter(
                      (date) =>
                        typeof date === "string" &&
                        /^\d{4}-\d{2}-\d{2}$/.test(date),
                    )
                    .slice(0, 10_000),
                ),
              ]
            : [],
          id:
            typeof calendar.id === "string" && calendar.id.trim()
              ? calendar.id.trim().slice(0, 100)
              : `calendar-${index + 1}`,
          name:
            typeof calendar.name === "string"
              ? calendar.name.trim().slice(0, 80)
              : "",
          readOnly: calendar.readOnly === true,
          shareIds: Array.isArray(calendar.shareIds)
            ? calendar.shareIds
                .filter((id) => typeof id === "string")
                .slice(0, 1_000)
            : [],
          shared: calendar.shared === true,
          sharedOwner:
            typeof calendar.sharedOwner === "string"
              ? calendar.sharedOwner.trim().slice(0, 120)
              : "",
          workspaceId:
            typeof calendar.workspaceId === "string" &&
            calendar.workspaceId.trim()
              ? calendar.workspaceId.trim().slice(0, 100)
              : "personal",
          updatedAt:
            typeof calendar.updatedAt === "string" ? calendar.updatedAt : "",
        }))
    : [];
  const resolvedCalendars = calendars.length
    ? calendars
    : [{ ...defaultCalendar }];
  const requestedActiveId =
    typeof value?.activeCalendarId === "string"
      ? value.activeCalendarId
      : "primary";

  return {
    activeCalendarId: resolvedCalendars.some(
      (calendar) => calendar.id === requestedActiveId,
    )
      ? requestedActiveId
      : resolvedCalendars[0].id,
    calendars: resolvedCalendars,
    showHolidays: value?.showHolidays !== false,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : "",
  };
}

async function createAccountVault(key, keyId) {
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return {
    algorithm: "AES-GCM",
    keyId,
    protection: "account",
    syncKey: encode(new Uint8Array(rawKey)),
    version: 1,
  };
}

function importAccountKey(vault) {
  return crypto.subtle.importKey(
    "raw",
    decode(vault.syncKey),
    "AES-GCM",
    true,
    ["encrypt", "decrypt"],
  );
}

async function encryptDocument(key, keyId, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(
    JSON.stringify(normalizeCalendarData(data)),
  );
  const ciphertext = await crypto.subtle.encrypt(
    { additionalData, iv, name: "AES-GCM" },
    key,
    plaintext,
  );
  return {
    algorithm: "AES-GCM",
    ciphertext: encode(new Uint8Array(ciphertext)),
    iv: encode(iv),
    keyId,
    version: 1,
  };
}

async function decryptDocument(key, document) {
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData,
      iv: decode(document.iv),
      name: "AES-GCM",
    },
    key,
    decode(document.ciphertext),
  );
  return normalizeCalendarData(JSON.parse(new TextDecoder().decode(plaintext)));
}

function openKeyDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(databaseStore);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function getStoredKey(id) {
  const database = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(databaseStore)
      .objectStore(databaseStore)
      .get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

async function putStoredKey(id, key) {
  const database = await openKeyDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(databaseStore, "readwrite");
    transaction.objectStore(databaseStore).put(key, id);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = resolve;
  });
}

async function getLocalKey() {
  const existing = await getStoredKey("device-key");
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  await putStoredKey("device-key", key);
  return key;
}

async function loadLocalData() {
  const stored = window.localStorage.getItem(localDocumentKey);
  if (!stored) {
    let legacyCalendars = null;
    try {
      legacyCalendars = JSON.parse(
        window.localStorage.getItem("munetios.calendar.customCalendars") ||
          "null",
      );
    } catch {
      legacyCalendars = null;
    }
    const legacyData = normalizeCalendarData({
      calendars: legacyCalendars,
      showHolidays:
        window.localStorage.getItem("munetios.calendar.showHolidays") !==
        "false",
    });
    await saveLocalData(legacyData);
    window.localStorage.removeItem("munetios.calendar.customCalendars");
    window.localStorage.removeItem("munetios.calendar.visibleCalendars");
    window.localStorage.removeItem("munetios.calendar.showHolidays");
    return legacyData;
  }
  try {
    return await decryptDocument(await getLocalKey(), JSON.parse(stored));
  } catch {
    window.localStorage.removeItem(localDocumentKey);
    return normalizeCalendarData(null);
  }
}

async function saveLocalData(data) {
  const normalized = normalizeCalendarData(data);
  const document = await encryptDocument(
    await getLocalKey(),
    "device",
    normalized,
  );
  window.localStorage.setItem(localDocumentKey, JSON.stringify(document));
  return normalized;
}

async function fetchAccountVault() {
  const response = await fetch(accountVaultUrl, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok)
    throw await calendarVaultError(response, "calendar_vault_load_failed");
  return response.json();
}

async function calendarVaultError(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  let reason =
    payload.message || payload.error || response.statusText || fallback;
  if (
    response.status === 401 &&
    response.headers.get("X-Munetios-Auth-State") === "invalid-session"
  ) {
    reason =
      payload.message ||
      "Your session token is invalid. Sign in again to resume calendar sync.";
  }
  const error = new Error(reason);
  error.reason = reason;
  error.status = response.status;
  return error;
}

async function saveAccountVault(vault, document) {
  const response = await fetch(accountVaultUrl, {
    body: JSON.stringify({ document, vault }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  if (!response.ok)
    throw await calendarVaultError(response, "calendar_vault_save_failed");
}

async function unlockAccountVault(fallbackData, { refresh = false } = {}) {
  if (unlockedAccount && !refresh) return unlockedAccount.data;
  const stored = await fetchAccountVault();
  if (stored?.vault && stored?.document) {
    const key = await importAccountKey(stored.vault);
    const data = await decryptDocument(key, stored.document);
    unlockedAccount = { data, key, vault: stored.vault };
    return data;
  }

  const key = await crypto.subtle.generateKey(
    { length: 256, name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
  const keyId = encode(crypto.getRandomValues(new Uint8Array(18)));
  const vault = await createAccountVault(key, keyId);
  const data = normalizeCalendarData(fallbackData);
  const document = await encryptDocument(key, keyId, data);
  await saveAccountVault(vault, document);
  unlockedAccount = { data, key, vault };
  return data;
}

async function includeSharedCalendars(data, signedIn, options) {
  if (!signedIn) return data;
  try {
    const collaboration = await fetchEncryptedCalendarCollaborations();
    return mergeSharedCalendars(data, collaboration.received, options);
  } catch {
    return data;
  }
}

export async function loadEncryptedCalendarData(signedIn, options = {}) {
  const localData = await loadLocalData();
  if (!signedIn) {
    publishCalendarSyncStatus({ status: "device" });
    return localData;
  }
  publishCalendarSyncStatus({ status: "syncing" });
  try {
    let accountData = await unlockAccountVault(localData, { refresh: true });
    if (window.localStorage.getItem(localPendingSyncKey) === "true") {
      const document = await encryptDocument(
        unlockedAccount.key,
        unlockedAccount.vault.keyId,
        localData,
      );
      await saveAccountVault(unlockedAccount.vault, document);
      accountData = localData;
      unlockedAccount = { ...unlockedAccount, data: localData };
      window.localStorage.removeItem(localPendingSyncKey);
    } else {
      await saveLocalData(accountData);
    }
    const merged = await includeSharedCalendars(accountData, signedIn, options);
    publishCalendarSyncStatus({ status: "synced" });
    return merged;
  } catch (error) {
    const reason = String(error);
    publishCalendarSyncStatus({ reason, status: "failed" });
    return { ...localData, syncError: reason };
  }
}

export async function saveEncryptedCalendarData(data, signedIn) {
  const normalized = await saveLocalData({
    ...data,
    updatedAt: new Date().toISOString(),
  });
  window.localStorage.setItem(localPendingSyncKey, "true");
  if (!signedIn) {
    publishCalendarSyncStatus({ status: "device" });
    return normalized;
  }

  publishCalendarSyncStatus({ status: "syncing" });
  try {
    const accountData = await unlockAccountVault(normalized, { refresh: true });
    const resolved = normalizeCalendarData({ ...accountData, ...normalized });
    const document = await encryptDocument(
      unlockedAccount.key,
      unlockedAccount.vault.keyId,
      resolved,
    );
    await saveAccountVault(unlockedAccount.vault, document);
    unlockedAccount = { ...unlockedAccount, data: resolved };
    window.localStorage.removeItem(localPendingSyncKey);
    publishCalendarSyncStatus({ status: "synced" });
    return resolved;
  } catch (error) {
    if (unlockedAccount) {
      unlockedAccount = { ...unlockedAccount, data: normalized };
    }
    const reason = String(error);
    publishCalendarSyncStatus({ reason, status: "failed" });
    error.localData = normalized;
    throw error;
  }
}
