import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getAccountData, setAccountData } from "./authSecurity.js";
import { getSecureCookieAttribute } from "./requestSecurity.js";

const challengeLifetimeMs = 5 * 60 * 1000;
const sensitiveGrantLifetimeMs = 10 * 60 * 1000;
const trustedDeviceLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const challenges = globalThis.__munetiosTwoFactorChallenges || new Map();
globalThis.__munetiosTwoFactorChallenges = challenges;

function hash(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function equalHex(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function encryptionKey() {
  const configured = process.env.MUNETIOS_AUTH_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error("MUNETIOS_AUTH_ENCRYPTION_KEY is required for 2FA");
  }
  return createHash("sha256")
    .update(configured || `munetios-development:${process.cwd()}`)
    .digest();
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decrypt(value) {
  const [iv, tag, encrypted] = String(value || "")
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted) return "";
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

function base32Encode(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let current = 0;
  const bytes = [];
  for (const character of String(value || "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30_000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 15;
  const number =
    (((digest[offset] & 127) << 24) |
      ((digest[offset + 1] & 255) << 16) |
      ((digest[offset + 2] & 255) << 8) |
      (digest[offset + 3] & 255)) %
    1_000_000;
  return String(number).padStart(6, "0");
}

export function getTwoFactorState(accountId) {
  const data = getAccountData(accountId, "two-factor-v1", {});
  return {
    ...data,
    enabled: Boolean(data.enabled && data.secret),
    recoveryCodesRemaining: Array.isArray(data.recoveryCodeHashes)
      ? data.recoveryCodeHashes.length
      : 0,
    trustedDevices: (Array.isArray(data.trustedDevices)
      ? data.trustedDevices
      : []
    ).filter((device) => Date.parse(device.expiresAt || "") > Date.now()),
  };
}

export function beginTwoFactorSetup(accountId, email) {
  const secret = base32Encode(randomBytes(20));
  const setupId = randomUUID();
  challenges.set(setupId, {
    accountId,
    expiresAt: Date.now() + challengeLifetimeMs,
    purpose: "setup",
    secret,
  });
  const label = encodeURIComponent(`Munetios:${email}`);
  const issuer = encodeURIComponent("Munetios");
  return {
    otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    secret,
    setupId,
  };
}

export function verifyTotp(secret, code) {
  const normalized = String(code || "").replace(/\D/g, "");
  if (normalized.length !== 6) return false;
  return [-1, 0, 1].some((offset) => {
    const expected = Buffer.from(totp(secret, Date.now() + offset * 30_000));
    const received = Buffer.from(normalized);
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  });
}

function createRecoveryCodes() {
  return Array.from(
    { length: 10 },
    () =>
      `${randomBytes(4).toString("hex").toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`,
  );
}

export function completeTwoFactorSetup(accountId, setupId, code) {
  const pending = challenges.get(String(setupId || ""));
  challenges.delete(String(setupId || ""));
  if (
    !pending ||
    pending.accountId !== accountId ||
    pending.purpose !== "setup" ||
    pending.expiresAt <= Date.now() ||
    !verifyTotp(pending.secret, code)
  )
    return null;
  const recoveryCodes = createRecoveryCodes();
  setAccountData(accountId, "two-factor-v1", {
    enabled: true,
    enabledAt: new Date().toISOString(),
    recoveryCodeHashes: recoveryCodes.map(hash),
    recoveryCodes: encrypt(JSON.stringify(recoveryCodes)),
    secret: encrypt(pending.secret),
    trustedDevices: [],
  });
  return recoveryCodes;
}

export function disableTwoFactor(accountId) {
  const state = getTwoFactorState(accountId);
  if (!state.enabled) return false;
  setAccountData(accountId, "two-factor-v1", {
    disabledAt: new Date().toISOString(),
    enabled: false,
    recoveryCodeHashes: [],
    trustedDevices: [],
  });
  return true;
}

export function createSignInChallenge(accountId) {
  const challengeId = randomUUID();
  challenges.set(challengeId, {
    accountId,
    expiresAt: Date.now() + challengeLifetimeMs,
    purpose: "signin",
  });
  return challengeId;
}

export function consumeSignInChallenge(challengeId) {
  const pending = challenges.get(String(challengeId || ""));
  challenges.delete(String(challengeId || ""));
  return pending?.purpose === "signin" && pending.expiresAt > Date.now()
    ? pending.accountId
    : null;
}

export function verifyAccountSecondFactor(accountId, code) {
  const state = getTwoFactorState(accountId);
  if (!state.enabled) return false;
  let secret = "";
  try {
    secret = decrypt(state.secret);
  } catch {
    return false;
  }
  if (verifyTotp(secret, code)) return true;
  const codeHash = hash(
    String(code || "")
      .trim()
      .toUpperCase(),
  );
  const recoveryCodeHashes = state.recoveryCodeHashes || [];
  const index = recoveryCodeHashes.findIndex((candidate) =>
    equalHex(candidate, codeHash),
  );
  if (index < 0) return false;
  setAccountData(accountId, "two-factor-v1", {
    ...state,
    recoveryCodeHashes: recoveryCodeHashes.filter(
      (_, itemIndex) => itemIndex !== index,
    ),
  });
  return true;
}

export function getAccountRecoveryCodes(accountId) {
  const state = getTwoFactorState(accountId);
  if (!state.enabled) return [];
  if (!state.recoveryCodes) {
    const recoveryCodes = createRecoveryCodes();
    setAccountData(accountId, "two-factor-v1", {
      ...state,
      recoveryCodeHashes: recoveryCodes.map(hash),
      recoveryCodes: encrypt(JSON.stringify(recoveryCodes)),
    });
    return recoveryCodes;
  }
  try {
    const codes = JSON.parse(decrypt(state.recoveryCodes));
    const activeHashes = new Set(state.recoveryCodeHashes || []);
    return Array.isArray(codes)
      ? codes.filter((code) => activeHashes.has(hash(code)))
      : [];
  } catch {
    return [];
  }
}

export function isTrustedDevice(accountId, token) {
  if (!token) return false;
  const state = getTwoFactorState(accountId);
  return state.trustedDevices.some((device) =>
    equalHex(device.tokenHash, hash(token)),
  );
}

export function trustDevice(accountId, label) {
  const token = randomBytes(32).toString("base64url");
  const state = getTwoFactorState(accountId);
  const device = {
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + trustedDeviceLifetimeMs).toISOString(),
    id: randomUUID(),
    label: String(label || "Trusted device").slice(0, 120),
    tokenHash: hash(token),
    userAgent: String(label || "").slice(0, 500),
  };
  setAccountData(accountId, "two-factor-v1", {
    ...state,
    trustedDevices: [...state.trustedDevices, device].slice(-20),
  });
  return { device, token };
}

export function removeTrustedDevice(accountId, deviceId) {
  const state = getTwoFactorState(accountId);
  const next = state.trustedDevices.filter((device) => device.id !== deviceId);
  setAccountData(accountId, "two-factor-v1", {
    ...state,
    trustedDevices: next,
  });
  return next.length !== state.trustedDevices.length;
}

export function getTrustedDeviceCookie(
  request,
  token,
  maxAge = trustedDeviceLifetimeMs / 1000,
) {
  return `munetios_trusted_device=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAge)}${getSecureCookieAttribute(request)}`;
}

export function createSensitiveGrantCookie(request, accountId) {
  const expiresAt = Date.now() + sensitiveGrantLifetimeMs;
  const secret =
    process.env.MUNETIOS_AUTH_ENCRYPTION_KEY ||
    `munetios-development:${process.cwd()}`;
  const payload = `${accountId}.${expiresAt}`;
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `munetios_sensitive_grant=${encodeURIComponent(`${payload}.${signature}`)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sensitiveGrantLifetimeMs / 1000}${getSecureCookieAttribute(request)}`;
}

export function hasSensitiveGrant(request, accountId) {
  const cookie = request.headers.get("cookie") || "";
  const value = cookie.match(/(?:^|;\s*)munetios_sensitive_grant=([^;]+)/)?.[1];
  if (!value) return false;
  const decoded = decodeURIComponent(value);
  const [id, expiresAt, signature] = decoded.split(".");
  if (id !== accountId || Number(expiresAt) <= Date.now()) return false;
  const secret =
    process.env.MUNETIOS_AUTH_ENCRYPTION_KEY ||
    `munetios-development:${process.cwd()}`;
  const expected = createHmac("sha256", secret)
    .update(`${id}.${expiresAt}`)
    .digest("base64url");
  return (
    Buffer.from(expected).length === Buffer.from(signature || "").length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ""))
  );
}
