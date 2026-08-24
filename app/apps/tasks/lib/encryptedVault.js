"use client";

import { normalizeTaskLists, normalizeTasksForLists } from "./taskLists";

const iterations = 600_000;
const additionalData = new TextEncoder().encode("munetios.tasks.v1");
const localDocumentKey = "munetios.tasks.encrypted.v1";
const databaseName = "munetios-tasks-crypto";
const databaseStore = "keys";
let unlockedAccount = null;
let accountUnlockPromise = null;

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

async function importAccountVaultKey(vault) {
  return crypto.subtle.importKey(
    "raw",
    decode(vault.syncKey),
    "AES-GCM",
    true,
    ["encrypt", "decrypt"],
  );
}

async function deriveWrappingKey(password, salt, workFactor = iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { hash: "SHA-256", iterations: workFactor, name: "PBKDF2", salt },
    material,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function createWrappedVault(
  key,
  password,
  keyId = encode(crypto.getRandomValues(new Uint8Array(18))),
) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(password, salt);
  const rawKey = await crypto.subtle.exportKey("raw", key);
  const wrappedKey = await crypto.subtle.encrypt(
    {
      additionalData: new TextEncoder().encode(keyId),
      iv: wrapIv,
      name: "AES-GCM",
    },
    wrappingKey,
    rawKey,
  );
  return {
    algorithm: "AES-GCM",
    derivation: "PBKDF2-SHA-256",
    iterations,
    keyId,
    salt: encode(salt),
    version: 1,
    wrapIv: encode(wrapIv),
    wrappedKey: encode(new Uint8Array(wrappedKey)),
  };
}

async function unwrapVault(vault, password) {
  const wrappingKey = await deriveWrappingKey(
    password,
    decode(vault.salt),
    vault.iterations,
  );
  const rawKey = await crypto.subtle.decrypt(
    {
      additionalData: new TextEncoder().encode(vault.keyId),
      iv: decode(vault.wrapIv),
      name: "AES-GCM",
    },
    wrappingKey,
    decode(vault.wrappedKey),
  );
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptDocument(key, keyId, document) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(document));
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

async function decryptDocument(key, encryptedDocument) {
  const plaintext = await crypto.subtle.decrypt(
    { additionalData, iv: decode(encryptedDocument.iv), name: "AES-GCM" },
    key,
    decode(encryptedDocument.ciphertext),
  );
  const document = JSON.parse(new TextDecoder().decode(plaintext));
  return {
    categories: Array.isArray(document?.categories) ? document.categories : [],
    lists: normalizeTaskLists(document?.lists),
    tasks: Array.isArray(document?.tasks) ? document.tasks : [],
    settings:
      typeof document?.settings === "object" && document.settings !== null
        ? document.settings
        : {},
    workspaces:
      typeof document?.workspaces === "object" && document.workspaces !== null
        ? document.workspaces
        : {},
  };
}

function mergeImportedTasks(document, manifest) {
  if (
    manifest?.format !== "munetios-tasks-import-v1" ||
    (!Array.isArray(manifest.lists) && !Array.isArray(manifest.tasks))
  ) {
    return document;
  }
  const workspaces =
    typeof document?.workspaces === "object" && document.workspaces !== null
      ? document.workspaces
      : {};
  const workspaceId =
    typeof manifest.workspaceId === "string" && manifest.workspaceId
      ? manifest.workspaceId
      : "default";
  const current = workspaces[workspaceId] || {};
  const lists = normalizeTaskLists([
    ...(Array.isArray(current.lists) ? current.lists : []),
    ...(Array.isArray(manifest.lists) ? manifest.lists : []),
  ]).filter(
    (list, index, allLists) =>
      allLists.findIndex((candidate) => candidate.id === list.id) === index,
  );
  const tasks = normalizeTasksForLists(
    [
      ...(Array.isArray(current.tasks) ? current.tasks : []),
      ...(Array.isArray(manifest.tasks) ? manifest.tasks : []),
    ].filter(
      (task, index, allTasks) =>
        task?.id &&
        allTasks.findIndex((candidate) => candidate?.id === task.id) === index,
    ),
    lists,
  );
  return {
    ...document,
    workspaces: {
      ...workspaces,
      [workspaceId]: {
        ...current,
        categories: Array.isArray(current.categories) ? current.categories : [],
        lists,
        tasks,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

async function applyPendingTaskImport(stored, key, vault, data) {
  if (!stored?.importManifest) {
    return { data, document: stored?.document || null };
  }
  const merged = mergeImportedTasks(data, stored.importManifest);
  const document = await encryptDocument(key, vault.keyId, merged);
  await saveVault(vault, document);
  return { data: merged, document };
}

export function getActiveTasksWorkspaceId() {
  if (typeof window === "undefined") return "default";
  return (
    window.sessionStorage.getItem("munetiosActiveLockedWorkspace") ||
    window.localStorage.getItem("munetiosActiveWorkspace") ||
    "default"
  );
}

export function getTasksWorkspaceData(
  document,
  workspaceId = getActiveTasksWorkspaceId(),
) {
  const normalizedId = String(workspaceId || "default");
  const workspaces =
    typeof document?.workspaces === "object" && document.workspaces !== null
      ? document.workspaces
      : {};
  const scoped = workspaces[normalizedId];
  const canMigrateLegacy =
    !scoped &&
    Object.keys(workspaces).length === 0 &&
    ((document?.categories || []).length > 0 ||
      (document?.tasks || []).length > 0);
  const lists = normalizeTaskLists(scoped?.lists);
  const tasks = Array.isArray(scoped?.tasks)
    ? scoped.tasks
    : canMigrateLegacy && Array.isArray(document?.tasks)
      ? document.tasks
      : [];
  return {
    categories: Array.isArray(scoped?.categories)
      ? scoped.categories
      : canMigrateLegacy && Array.isArray(document?.categories)
        ? document.categories
        : [],
    lists,
    settings:
      typeof document?.settings === "object" && document.settings !== null
        ? document.settings
        : {},
    tasks: normalizeTasksForLists(tasks, lists),
  };
}

export function withTasksWorkspaceData(
  document,
  scopedData,
  workspaceId = getActiveTasksWorkspaceId(),
) {
  const normalizedId = String(workspaceId || "default");
  const workspaces =
    typeof document?.workspaces === "object" && document.workspaces !== null
      ? document.workspaces
      : {};
  return {
    ...document,
    categories: [],
    lists: [],
    settings:
      typeof scopedData?.settings === "object" && scopedData.settings !== null
        ? scopedData.settings
        : document?.settings || {},
    tasks: [],
    workspaces: {
      ...workspaces,
      [normalizedId]: {
        categories: Array.isArray(scopedData?.categories)
          ? scopedData.categories
          : [],
        lists: normalizeTaskLists(scopedData?.lists),
        tasks: normalizeTasksForLists(scopedData?.tasks, scopedData?.lists),
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

async function verifyPassword(password) {
  const response = await fetch("/api/account/security", {
    body: JSON.stringify({ action: "verify_password", password }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("password_verification_failed");
}

async function fetchVault() {
  const response = await fetch("/api/tasks/vault", {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) throw new Error("vault_load_failed");
  return response.json();
}

async function saveVault(vault, document) {
  const response = await fetch("/api/tasks/vault", {
    body: JSON.stringify({ document, vault }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  if (!response.ok) throw new Error("vault_save_failed");
}

export function hasUnlockedAccountVault() {
  return Boolean(unlockedAccount);
}

export function lockAccountVault() {
  unlockedAccount = null;
  accountUnlockPromise = null;
}

export async function unlockAccountVault(password) {
  await verifyPassword(password);
  const stored = await fetchVault();
  if (!stored.vault || !stored.document) {
    const key = await crypto.subtle.generateKey(
      { length: 256, name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
    const vault = await createWrappedVault(key, password);
    const data = {
      categories: Array.isArray(stored.legacyCategories)
        ? stored.legacyCategories
        : [],
      lists: normalizeTaskLists(),
      tasks: [],
      workspaces: {},
    };
    const importedData = mergeImportedTasks(data, stored.importManifest);
    const document = await encryptDocument(key, vault.keyId, importedData);
    await saveVault(vault, document);
    unlockedAccount = { data: importedData, document, key, vault };
    return importedData;
  }

  let key;
  if (stored.vault.protection === "device") {
    key = await getStoredKey(`account:${stored.vault.keyId}`);
    if (!key) throw new Error("device_key_unavailable");
  } else if (stored.vault.protection === "account") {
    key = await importAccountVaultKey(stored.vault);
  } else {
    key = await unwrapVault(stored.vault, password);
  }

  const decrypted = await decryptDocument(key, stored.document);
  const imported = await applyPendingTaskImport(
    stored,
    key,
    stored.vault,
    decrypted,
  );
  unlockedAccount = {
    data: imported.data,
    document: imported.document,
    key,
    vault: stored.vault,
  };
  return imported.data;
}

export async function ensureAccountVaultUnlocked() {
  if (unlockedAccount) return unlockedAccount.data;
  if (accountUnlockPromise) return accountUnlockPromise;
  accountUnlockPromise = ensureAccountVaultUnlockedOnce().finally(() => {
    accountUnlockPromise = null;
  });
  return accountUnlockPromise;
}

async function ensureAccountVaultUnlockedOnce() {
  if (unlockedAccount) return unlockedAccount.data;
  const stored = await fetchVault();
  if (!stored.vault || !stored.document) {
    const key = await crypto.subtle.generateKey(
      { length: 256, name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
    const keyId = encode(crypto.getRandomValues(new Uint8Array(18)));
    const vault = await createAccountVault(key, keyId);
    const data = {
      categories: Array.isArray(stored.legacyCategories)
        ? stored.legacyCategories
        : [],
      lists: normalizeTaskLists(),
      tasks: [],
      settings: {},
      workspaces: {},
    };
    const importedData = mergeImportedTasks(data, stored.importManifest);
    const document = await encryptDocument(key, vault.keyId, importedData);
    await saveVault(vault, document);
    unlockedAccount = { data: importedData, document, key, vault };
    return importedData;
  }
  if (stored.vault.protection === "account") {
    const key = await importAccountVaultKey(stored.vault);
    const decrypted = await decryptDocument(key, stored.document);
    const imported = await applyPendingTaskImport(
      stored,
      key,
      stored.vault,
      decrypted,
    );
    unlockedAccount = {
      data: imported.data,
      document: imported.document,
      key,
      vault: stored.vault,
    };
    return imported.data;
  }
  if (stored.vault.protection !== "device") {
    throw new Error("password_required");
  }
  const key = await getStoredKey(`account:${stored.vault.keyId}`);
  if (!key) throw new Error("device_key_unavailable");
  const vault = await createAccountVault(key, stored.vault.keyId);
  await saveVault(vault, stored.document);
  const decrypted = await decryptDocument(key, stored.document);
  const imported = await applyPendingTaskImport(stored, key, vault, decrypted);
  unlockedAccount = {
    data: imported.data,
    document: imported.document,
    key,
    vault,
  };
  return imported.data;
}

export function getUnlockedAccountData() {
  return unlockedAccount?.data || null;
}

export async function refreshUnlockedAccountData() {
  if (!unlockedAccount) return ensureAccountVaultUnlocked();
  const stored = await fetchVault();
  if (!stored.vault || !stored.document) return unlockedAccount.data;
  if (stored.vault.keyId !== unlockedAccount.vault.keyId) {
    throw new Error("vault_key_changed");
  }
  const decrypted = await decryptDocument(unlockedAccount.key, stored.document);
  const imported = await applyPendingTaskImport(
    stored,
    unlockedAccount.key,
    stored.vault,
    decrypted,
  );
  unlockedAccount = {
    ...unlockedAccount,
    data: imported.data,
    document: imported.document,
    vault: stored.vault,
  };
  return imported.data;
}

export async function saveUnlockedAccountData(data) {
  if (!unlockedAccount) throw new Error("vault_locked");
  const normalized = {
    categories: Array.isArray(data?.categories) ? data.categories : [],
    lists: normalizeTaskLists(data?.lists),
    tasks: normalizeTasksForLists(data?.tasks, data?.lists),
    settings:
      typeof data?.settings === "object" && data.settings !== null
        ? data.settings
        : {},
    workspaces:
      typeof data?.workspaces === "object" && data.workspaces !== null
        ? data.workspaces
        : {},
  };
  const document = await encryptDocument(
    unlockedAccount.key,
    unlockedAccount.vault.keyId,
    normalized,
  );
  await saveVault(unlockedAccount.vault, document);
  unlockedAccount = { ...unlockedAccount, data: normalized, document };
  return normalized;
}

export async function viewAccountEncryptionKey(password) {
  await verifyPassword(password);
  await unlockAccountVault(password);
  const rawKey = await crypto.subtle.exportKey("raw", unlockedAccount.key);
  return encode(new Uint8Array(rawKey));
}

export async function resetAccountEncryptionKey(password) {
  await verifyPassword(password);
  await unlockAccountVault(password);
  const key = await crypto.subtle.generateKey(
    { length: 256, name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
  const vault = await createWrappedVault(key, password);
  const document = await encryptDocument(
    key,
    vault.keyId,
    unlockedAccount.data,
  );
  await saveVault(vault, document);
  unlockedAccount = { data: unlockedAccount.data, document, key, vault };
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return encode(new Uint8Array(rawKey));
}

export async function preparePasswordRewrap(currentPassword) {
  return async function rewrap(newPassword) {
    const stored = await fetchVault();
    if (!stored.vault || !stored.document) {
      return null;
    }
    const key = await unwrapVault(stored.vault, currentPassword);
    const vault = await createWrappedVault(
      key,
      newPassword,
      stored.vault.keyId,
    );
    await saveVault(vault, stored.document);
  };
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

export async function readLocalEncryptedData() {
  const encrypted = window.localStorage.getItem(localDocumentKey);
  if (!encrypted) {
    return {
      categories: [],
      lists: normalizeTaskLists(),
      settings: {},
      tasks: [],
      workspaces: {},
    };
  }

  try {
    return decryptDocument(await getLocalKey(), JSON.parse(encrypted));
  } catch {
    window.localStorage.removeItem(localDocumentKey);
    return {
      categories: [],
      lists: normalizeTaskLists(),
      tasks: [],
      settings: {},
      workspaces: {},
    };
  }
}

export async function saveLocalEncryptedData(data) {
  try {
    const key = await getLocalKey();
    const document = await encryptDocument(key, "device", data);
    window.localStorage.setItem(localDocumentKey, JSON.stringify(document));
    return data;
  } catch {
    window.localStorage.removeItem(localDocumentKey);
    const key = await crypto.subtle.generateKey(
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    await putStoredKey("device-key", key);
    const document = await encryptDocument(key, "device", data);
    window.localStorage.setItem(localDocumentKey, JSON.stringify(document));
    return data;
  }
}
