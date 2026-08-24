const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function createVoiceConversationKey() {
  const key = await crypto.subtle.generateKey(
    { length: 256, name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  return toBase64Url(new Uint8Array(raw));
}

async function importKey(encodedKey, usages) {
  return crypto.subtle.importKey(
    "raw",
    fromBase64Url(encodedKey),
    "AES-GCM",
    false,
    usages,
  );
}

export async function encryptVoiceConversation(transcript, encodedKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(encodedKey, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    key,
    encoder.encode(JSON.stringify(transcript)),
  );
  return `e2ee1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptVoiceConversation(payload, encodedKey) {
  const [version, iv, ciphertext] = String(payload || "").split(".");
  if (version !== "e2ee1" || !iv || !ciphertext)
    throw new Error("invalid_encrypted_conversation");
  const key = await importKey(encodedKey, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { iv: fromBase64Url(iv), name: "AES-GCM" },
    key,
    fromBase64Url(ciphertext),
  );
  const transcript = JSON.parse(decoder.decode(plaintext));
  if (!Array.isArray(transcript))
    throw new Error("invalid_encrypted_conversation");
  return transcript;
}

export function voiceShareKeyFromLocation() {
  return new URLSearchParams(window.location.hash.slice(1)).get("key") || "";
}

export function withVoiceShareKey(url, key) {
  const value = new URL(url, window.location.origin);
  value.hash = new URLSearchParams({ key }).toString();
  return value.toString();
}
