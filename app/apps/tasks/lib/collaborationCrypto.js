"use client";

const databaseName = "munetios-tasks-collaboration";
const storeName = "identity";
const identityKey = "rsa-oaep-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readIdentity() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(storeName)
      .objectStore(storeName)
      .get(identityKey);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

async function writeIdentity(identity) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(identity, identityKey);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = resolve;
  });
}

async function getIdentity() {
  const stored = await readIdentity();
  if (stored?.privateKey && stored?.publicKey) return stored;
  const keyPair = await crypto.subtle.generateKey(
    {
      hash: "SHA-256",
      modulusLength: 2048,
      name: "RSA-OAEP",
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["encrypt", "decrypt"],
  );
  const identity = {
    privateKey: keyPair.privateKey,
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
    publicKey: keyPair.publicKey,
  };
  await writeIdentity(identity);
  return identity;
}

async function request(payload, method = "POST") {
  const response = await fetch("/api/tasks/collaboration", {
    body: method === "GET" ? undefined : JSON.stringify(payload),
    cache: "no-store",
    credentials: "include",
    headers:
      method === "GET" ? undefined : { "Content-Type": "application/json" },
    method,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "collaboration_failed");
  return result;
}

export async function registerCollaborationIdentity() {
  const identity = await getIdentity();
  await request({ action: "register", publicKey: identity.publicJwk });
  return identity;
}

async function encryptTask(publicJwk, task) {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { hash: "SHA-256", name: "RSA-OAEP" },
    false,
    ["encrypt"],
  );
  const dataKey = await crypto.subtle.generateKey(
    { length: 256, name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    dataKey,
    encoder.encode(JSON.stringify(task)),
  );
  const rawKey = await crypto.subtle.exportKey("raw", dataKey);
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    rawKey,
  );
  return {
    ciphertext: encode(new Uint8Array(ciphertext)),
    iv: encode(iv),
    version: 1,
    wrappedKey: encode(new Uint8Array(wrappedKey)),
  };
}

async function decryptTask(identity, envelope) {
  const rawKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    identity.privateKey,
    decode(envelope.wrappedKey),
  );
  const dataKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { iv: decode(envelope.iv), name: "AES-GCM" },
    dataKey,
    decode(envelope.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext));
}

export async function shareEncryptedTask({ email, permission, task }) {
  await registerCollaborationIdentity();
  const lookup = await request({ action: "lookup", email });
  if (!lookup.publicKey) throw new Error("recipient_tasks_key_unavailable");
  const envelope = await encryptTask(lookup.publicKey, task);
  return request({
    action: "share",
    email,
    envelope,
    permission,
    taskId: task.id,
  });
}

export async function fetchEncryptedCollaborations() {
  const identity = await registerCollaborationIdentity();
  const result = await request(null, "GET");
  const decryptItems = async (items) =>
    Promise.all(
      (items || []).map(async (item) => {
        try {
          return { ...item, task: await decryptTask(identity, item.envelope) };
        } catch {
          return { ...item, decryptFailed: true, task: null };
        }
      }),
    );
  return {
    notifications: result.notifications || [],
    owned: await decryptItems(result.owned),
    received: await decryptItems(result.received),
  };
}

export async function updateEncryptedCollaboration(sharedItem, task) {
  if (sharedItem.permission !== "edit") {
    throw new Error("view_only");
  }
  const envelope = await encryptTask(sharedItem.peerPublicKey, task);
  return request({
    action: "update",
    envelope,
    shareId: sharedItem.id,
    taskId: task.id,
  });
}

export async function dismissTaskNotification(notificationId) {
  return request({ action: "dismiss_notification", notificationId });
}
