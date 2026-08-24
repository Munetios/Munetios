"use client";

const databaseName = "munetios-calendar-collaboration";
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

async function importProvisionedIdentity(publicJwk, privateJwk) {
  if (!publicJwk || !privateJwk) return null;
  const algorithm = { hash: "SHA-256", name: "RSA-OAEP" };
  const identity = {
    privateKey: await crypto.subtle.importKey(
      "jwk",
      privateJwk,
      algorithm,
      true,
      ["decrypt"],
    ),
    publicJwk,
    publicKey: await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      algorithm,
      true,
      ["encrypt"],
    ),
  };
  await writeIdentity(identity);
  return identity;
}

async function request(payload, method = "POST") {
  const response = await fetch("/api/calendar/collaboration", {
    body: method === "GET" ? undefined : JSON.stringify(payload),
    cache: "no-store",
    credentials: "include",
    headers:
      method === "GET" ? undefined : { "Content-Type": "application/json" },
    method,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      result.message ||
        result.error ||
        response.statusText ||
        "calendar_share_failed",
    );
    error.reason = error.message;
    error.status = response.status;
    throw error;
  }
  return result;
}

export async function registerCalendarCollaborationIdentity() {
  let identity = await readIdentity();
  if (!identity) {
    const serverIdentity = await request(null, "GET");
    identity = await importProvisionedIdentity(
      serverIdentity.publicKey,
      serverIdentity.privateKey,
    );
  }
  identity ||= await getIdentity();
  await request({ action: "register", publicKey: identity.publicJwk });
  return identity;
}

async function encryptItem(publicJwk, item) {
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
    encoder.encode(JSON.stringify(item)),
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

async function decryptItem(identity, envelope) {
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

export async function shareEncryptedCalendarItem({ email, item, itemType }) {
  await registerCalendarCollaborationIdentity();
  const lookup = await request({ action: "lookup", email });
  if (!lookup.publicKey) throw new Error("recipient_calendar_key_unavailable");
  return request({
    action: "share",
    email,
    envelope: await encryptItem(lookup.publicKey, item),
    itemId: item.id,
    itemType,
  });
}

export async function fetchEncryptedCalendarCollaborations() {
  const identity = await registerCalendarCollaborationIdentity();
  const result = await request(null, "GET");
  const received = await Promise.all(
    (result.received || [])
      .filter((share) => share.status === "accepted")
      .map(async (share) => {
        try {
          return {
            ...share,
            item: await decryptItem(identity, share.envelope),
          };
        } catch {
          return { ...share, decryptFailed: true, item: null };
        }
      }),
  );
  return { received: received.filter((share) => share.item) };
}

export async function fetchCalendarShareInvitations() {
  const result = await request(null, "GET");
  return (result.received || []).filter(
    (share) => (share.status || "pending") === "pending",
  );
}

export async function respondToCalendarShareInvitation(shareId, accepted) {
  const result = await request({
    action: accepted ? "accept" : "decline",
    shareId,
  });
  window.dispatchEvent(new Event("munetios:calendarvaultchange"));
  return result;
}

export async function removeReceivedCalendarShares(shareIds) {
  const ids = [...new Set((shareIds || []).filter(Boolean))];
  if (!ids.length) return;
  await request({ action: "remove", shareIds: ids });
}

export function mergeSharedCalendars(
  data,
  received,
  { sharedCalendarName = "Shared calendar", workspaceId = "personal" } = {},
) {
  const localCalendars = (data.calendars || []).filter(
    (calendar) => !calendar.shared,
  );
  const eventShares = received.filter((share) => share.itemType === "event");
  const sharedCalendars = received
    .filter((share) => share.itemType === "calendar")
    .map((share) => ({
      ...share.item,
      createdAt: share.createdAt,
      events: Array.isArray(share.item.events) ? share.item.events : [],
      favoriteDates: [],
      id: `shared-calendar-${share.id}`,
      readOnly: true,
      shareIds: [share.id],
      shared: true,
      sharedOwner: share.ownerName,
      updatedAt: share.updatedAt,
      workspaceId,
    }));
  if (eventShares.length) {
    sharedCalendars.unshift({
      color: "#7c3aed",
      createdAt: eventShares[0].createdAt,
      events: eventShares.map((share) => ({
        ...share.item,
        id: `shared-event-${share.id}`,
        readOnly: true,
        shareId: share.id,
        sharedOwner: share.ownerName,
      })),
      favoriteDates: [],
      id: "shared-events",
      name: sharedCalendarName,
      readOnly: true,
      shareIds: eventShares.map((share) => share.id),
      shared: true,
      updatedAt: eventShares.at(-1)?.updatedAt || "",
      workspaceId,
    });
  }
  return { ...data, calendars: [...localCalendars, ...sharedCalendars] };
}
