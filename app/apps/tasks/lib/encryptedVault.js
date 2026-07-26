"use client";

const iterations = 600_000;
const additionalData = new TextEncoder().encode("munetios.tasks.v1");
const localDocumentKey = "munetios.tasks.encrypted.v1";
const databaseName = "munetios-tasks-crypto";
const databaseStore = "keys";
let unlockedAccount = null;
let accountUnlockPromise = null;

function createDeviceVault(
  keyId = encode(crypto.getRandomValues(new Uint8Array(18))),
) {
  return {
    algorithm: "AES-GCM",
    keyId,
    protection: "device",
    version: 1,
  };
}

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

export function getActiveTasksWorkspaceId() {
  if (typeof window === "undefined") return "default";
  return window.localStorage.getItem("munetiosActiveWorkspace") || "default";
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
  return {
    categories: Array.isArray(scoped?.categories)
      ? scoped.categories
      : canMigrateLegacy && Array.isArray(document?.categories)
        ? document.categories
        : [],
    settings:
      typeof document?.settings === "object" && document.settings !== null
        ? document.settings
        : {},
    tasks: Array.isArray(scoped?.tasks)
      ? scoped.tasks
      : canMigrateLegacy && Array.isArray(document?.tasks)
        ? document.tasks
        : [],
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
        tasks: Array.isArray(scopedData?.tasks) ? scopedData.tasks : [],
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
      tasks: [],
      workspaces: {},
    };
    const document = await encryptDocument(key, vault.keyId, data);
    await saveVault(vault, document);
    unlockedAccount = { data, document, key, vault };
    return data;
  }

  let key;
  if (stored.vault.protection === "device") {
    key = await getStoredKey(`account:${stored.vault.keyId}`);
    if (!key) throw new Error("device_key_unavailable");
  } else {
    key = await unwrapVault(stored.vault, password);
  }

  const data = await decryptDocument(key, stored.document);
  unlockedAccount = {
    data,
    document: stored.document,
    key,
    vault: stored.vault,
  };
  return data;
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
    const vault = createDeviceVault();
    await putStoredKey(`account:${vault.keyId}`, key);
    const data = {
      categories: Array.isArray(stored.legacyCategories)
        ? stored.legacyCategories
        : [],
      tasks: [],
      settings: {},
      workspaces: {},
    };
    const document = await encryptDocument(key, vault.keyId, data);
    await saveVault(vault, document);
    unlockedAccount = { data, document, key, vault };
    return data;
  }
  if (stored.vault.protection !== "device") {
    throw new Error("password_required");
  }
  const key = await getStoredKey(`account:${stored.vault.keyId}`);
  if (!key) throw new Error("device_key_unavailable");
  const data = await decryptDocument(key, stored.document);
  unlockedAccount = {
    data,
    document: stored.document,
    key,
    vault: stored.vault,
  };
  return data;
}

export function getUnlockedAccountData() {
  return unlockedAccount?.data || null;
}

export async function saveUnlockedAccountData(data) {
  if (!unlockedAccount) throw new Error("vault_locked");
  const normalized = {
    categories: Array.isArray(data?.categories) ? data.categories : [],
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
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
    return { categories: [], settings: {}, tasks: [], workspaces: {} };
  }

  try {
    return decryptDocument(await getLocalKey(), JSON.parse(encrypted));
  } catch {
    window.localStorage.removeItem(localDocumentKey);
    return { categories: [], tasks: [], settings: {} };
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
