import {
  createHmac,
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { dataDirectory as resolvedDataDirectory } from "./dataDirectory.js";
import { formatLocation } from "./ipGeolocation.js";
import { getSecureCookieAttribute } from "./requestSecurity.js";

const captchaLifetimeMs = 5 * 60 * 1000;
const verificationLifetimeMs = 10 * 60 * 1000;
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const accountCollectionCookieName = "munetios_accounts";
const captchaAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const databaseDirectory = resolvedDataDirectory;
const databasePath = join(databaseDirectory, "munetios.sqlite");
export const accountDataDirectory = databaseDirectory;

const authStore = globalThis.__munetiosAuthStore || {
  captchas: new Map(),
  rateLimits: new Map(),
  recoveries: new Map(),
  verifications: new Map(),
};

globalThis.__munetiosAuthStore = authStore;

function createAuthDatabase() {
  mkdirSync(databaseDirectory, { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 10000;");
  database.exec("PRAGMA encoding = 'UTF-8';");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      contact TEXT NOT NULL UNIQUE COLLATE NOCASE,
      contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'phone')),
      name TEXT NOT NULL,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      birth_date TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'Free',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      collection_hash TEXT,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_deleted_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_passkeys (
      credential_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      device_type TEXT NOT NULL DEFAULT '',
      backed_up INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_oauth_identities (
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      PRIMARY KEY (provider, provider_account_id),
      FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_passkey_challenges (
      challenge_id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      account_id TEXT,
      purpose TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_account_collections (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_account_collection_members (
      collection_hash TEXT NOT NULL,
      account_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (collection_hash, account_id),
      FOREIGN KEY (collection_hash) REFERENCES auth_account_collections(token_hash) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_account_data (
      account_id TEXT NOT NULL,
      data_key TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, data_key),
      FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_contact_verifications (
      verification_id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      identifier TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS auth_sessions_account_index
      ON auth_sessions (account_id);
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry_index
      ON auth_sessions (expires_at);
    CREATE INDEX IF NOT EXISTS auth_account_collection_members_account_index
      ON auth_account_collection_members (account_id);
  `);
  const accountColumns = new Set(
    database
      .prepare("PRAGMA table_info(auth_accounts)")
      .all()
      .map((column) => column.name),
  );
  if (!accountColumns.has("first_name")) {
    database.exec(
      "ALTER TABLE auth_accounts ADD COLUMN first_name TEXT NOT NULL DEFAULT '';",
    );
  }
  if (!accountColumns.has("last_name")) {
    database.exec(
      "ALTER TABLE auth_accounts ADD COLUMN last_name TEXT NOT NULL DEFAULT '';",
    );
  }
  if (!accountColumns.has("gender")) {
    database.exec(
      "ALTER TABLE auth_accounts ADD COLUMN gender TEXT NOT NULL DEFAULT '';",
    );
  }
  const sessionColumns = new Set(
    database
      .prepare("PRAGMA table_info(auth_sessions)")
      .all()
      .map((column) => column.name),
  );
  if (!sessionColumns.has("collection_hash")) {
    database.exec("ALTER TABLE auth_sessions ADD COLUMN collection_hash TEXT;");
  }
  for (const [column, definition] of [
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["last_seen_at", "TEXT NOT NULL DEFAULT ''"],
    ["user_agent", "TEXT NOT NULL DEFAULT ''"],
    ["ip_address", "TEXT NOT NULL DEFAULT ''"],
    ["location", "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!sessionColumns.has(column)) {
      database.exec(
        `ALTER TABLE auth_sessions ADD COLUMN ${column} ${definition};`,
      );
    }
  }
  return database;
}

export function getPublicSignupCount() {
  const database = createAuthDatabase();
  try {
    return Number(
      database.prepare("SELECT COUNT(*) AS count FROM auth_accounts").get()
        ?.count || 0,
    );
  } finally {
    database.close();
  }
}

const authDatabase = globalThis.__munetiosAuthDatabase || createAuthDatabase();
globalThis.__munetiosAuthDatabase = authDatabase;

function ensureHotReloadSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_deleted_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_account_collections (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_account_collection_members (
      collection_hash TEXT NOT NULL,
      account_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (collection_hash, account_id),
      FOREIGN KEY (collection_hash) REFERENCES auth_account_collections(token_hash) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS auth_account_data (
      account_id TEXT NOT NULL,
      data_key TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, data_key),
      FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS auth_contact_verifications (
      verification_id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      identifier TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS auth_passkeys (
      credential_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      device_type TEXT NOT NULL DEFAULT '',
      backed_up INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS auth_passkey_challenges (
      challenge_id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      account_id TEXT,
      purpose TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  const sessionColumns = new Set(
    database
      .prepare("PRAGMA table_info(auth_sessions)")
      .all()
      .map((column) => column.name),
  );
  if (!sessionColumns.has("collection_hash")) {
    database.exec("ALTER TABLE auth_sessions ADD COLUMN collection_hash TEXT;");
  }
  for (const [column, definition] of [
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["last_seen_at", "TEXT NOT NULL DEFAULT ''"],
    ["user_agent", "TEXT NOT NULL DEFAULT ''"],
    ["ip_address", "TEXT NOT NULL DEFAULT ''"],
    ["location", "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!sessionColumns.has(column)) {
      database.exec(
        `ALTER TABLE auth_sessions ADD COLUMN ${column} ${definition};`,
      );
    }
  }
}

ensureHotReloadSchema(authDatabase);

const contactUsedStatement = authDatabase.prepare(`
  SELECT 1 FROM auth_accounts
  WHERE lower(contact) = lower(?) OR lower(email) = lower(?)
  LIMIT 1
`);
const usernameUsedStatement = authDatabase.prepare(`
  SELECT 1 FROM auth_accounts WHERE lower(username) = lower(?) LIMIT 1
`);
const insertAccountStatement = authDatabase.prepare(`
  INSERT INTO auth_accounts (
    id, username, email, contact, contact_type, name, first_name, last_name,
    gender, birth_date, password_hash, plan, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const findAccountStatement = authDatabase.prepare(`
  SELECT * FROM auth_accounts
  WHERE lower(username) = lower(?)
     OR lower(email) = lower(?)
     OR lower(contact) = lower(?)
  LIMIT 1
`);
const insertSessionStatement = authDatabase.prepare(`
  INSERT INTO auth_sessions (
    token_hash, account_id, collection_hash, expires_at, created_at,
    last_seen_at, user_agent, ip_address, location
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const deleteExpiredSessionsStatement = authDatabase.prepare(`
  DELETE FROM auth_sessions WHERE expires_at <= ?
`);
const rememberDeletedSessionsStatement = authDatabase.prepare(`
  INSERT OR REPLACE INTO auth_deleted_sessions (
    token_hash, account_id, deleted_at, expires_at
  )
  SELECT token_hash, account_id, ?, ? FROM auth_sessions WHERE account_id = ?
`);
const findDeletedSessionStatement = authDatabase.prepare(`
  SELECT account_id FROM auth_deleted_sessions
  WHERE token_hash = ? AND expires_at > ? LIMIT 1
`);
const deleteExpiredDeletedSessionsStatement = authDatabase.prepare(`
  DELETE FROM auth_deleted_sessions WHERE expires_at <= ?
`);
const findSessionStatement = authDatabase.prepare(`
  SELECT
    a.id, a.email, a.name, a.plan, a.birth_date, a.first_name,
    a.last_name, a.gender, s.expires_at, s.token_hash, s.collection_hash,
    s.user_agent, s.ip_address, s.location
  FROM auth_sessions s
  JOIN auth_accounts a ON a.id = s.account_id
  WHERE s.token_hash = ? AND s.expires_at > ?
  LIMIT 1
`);
const findAccountByIdStatement = authDatabase.prepare(`
  SELECT * FROM auth_accounts WHERE id = ? LIMIT 1
`);
const findOAuthIdentityStatement = authDatabase.prepare(`
  SELECT a.* FROM auth_oauth_identities o
  JOIN auth_accounts a ON a.id = o.account_id
  WHERE o.provider = ? AND o.provider_account_id = ?
  LIMIT 1
`);
const insertOAuthIdentityStatement = authDatabase.prepare(`
  INSERT INTO auth_oauth_identities (
    provider, provider_account_id, account_id, email, created_at, last_used_at
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider, provider_account_id) DO UPDATE SET
    email = excluded.email,
    last_used_at = excluded.last_used_at
`);
const updateAccountPlanStatement = authDatabase.prepare(`
  UPDATE auth_accounts SET plan = ? WHERE id = ?
`);
const findAccountCollectionStatement = authDatabase.prepare(`
  SELECT token_hash, expires_at FROM auth_account_collections
  WHERE token_hash = ? AND expires_at > ? LIMIT 1
`);
const insertAccountCollectionStatement = authDatabase.prepare(`
  INSERT INTO auth_account_collections (token_hash, expires_at, created_at)
  VALUES (?, ?, ?)
`);
const insertAccountCollectionMemberStatement = authDatabase.prepare(`
  INSERT OR IGNORE INTO auth_account_collection_members (
    collection_hash, account_id, added_at
  ) VALUES (?, ?, ?)
`);
const listAccountCollectionMembersStatement = authDatabase.prepare(`
  SELECT a.* FROM auth_account_collection_members m
  JOIN auth_accounts a ON a.id = m.account_id
  WHERE m.collection_hash = ?
  ORDER BY m.added_at ASC
`);
const findAccountCollectionMemberStatement = authDatabase.prepare(`
  SELECT 1 FROM auth_account_collection_members
  WHERE collection_hash = ? AND account_id = ? LIMIT 1
`);
const deleteExpiredAccountCollectionsStatement = authDatabase.prepare(`
  DELETE FROM auth_account_collections WHERE expires_at <= ?
`);
const deleteAccountCollectionStatement = authDatabase.prepare(`
  DELETE FROM auth_account_collections WHERE token_hash = ?
`);
const deleteAccountCollectionSessionsStatement = authDatabase.prepare(`
  DELETE FROM auth_sessions WHERE collection_hash = ?
`);
const attachSessionToAccountCollectionStatement = authDatabase.prepare(`
  UPDATE auth_sessions SET collection_hash = ? WHERE token_hash = ?
`);
const getAccountDataStatement = authDatabase.prepare(`
  SELECT data_json FROM auth_account_data
  WHERE account_id = ? AND data_key = ? LIMIT 1
`);
const listAccountDataStatement = authDatabase.prepare(`
  SELECT account_id, data_json, updated_at FROM auth_account_data
  WHERE data_key = ? ORDER BY updated_at DESC
`);
const listAllAccountDataStatement = authDatabase.prepare(`
  SELECT data_key, data_json, updated_at FROM auth_account_data
  WHERE account_id = ? ORDER BY data_key ASC
`);
const deleteAccountDataStatement = authDatabase.prepare(`
  DELETE FROM auth_account_data WHERE account_id = ? AND data_key = ?
`);
const updateAccountIdentifiersStatement = authDatabase.prepare(`
  UPDATE auth_accounts
  SET username = ?, email = ?, contact = ?, contact_type = ?
  WHERE id = ?
`);
const updateManagedAccountProfileStatement = authDatabase.prepare(`
  UPDATE auth_accounts
  SET email = ?, contact = ?, name = ?, first_name = ?, last_name = ?,
      gender = ?, birth_date = ?
  WHERE id = ?
`);
const deleteAccountStatement = authDatabase.prepare(`
  DELETE FROM auth_accounts WHERE id = ?
`);
const setAccountDataStatement = authDatabase.prepare(`
  INSERT INTO auth_account_data (account_id, data_key, data_json, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(account_id, data_key) DO UPDATE SET
    data_json = excluded.data_json,
    updated_at = excluded.updated_at
`);
const insertVerificationStatement = authDatabase.prepare(`
  INSERT INTO auth_contact_verifications (
    verification_id, code_hash, fingerprint, identifier, expires_at
  ) VALUES (?, ?, ?, ?, ?)
`);
const getVerificationStatement = authDatabase.prepare(`
  SELECT * FROM auth_contact_verifications WHERE verification_id = ? LIMIT 1
`);
const incrementVerificationAttemptsStatement = authDatabase.prepare(`
  UPDATE auth_contact_verifications SET attempts = attempts + 1
  WHERE verification_id = ?
`);
const useVerificationStatement = authDatabase.prepare(`
  UPDATE auth_contact_verifications SET used = 1 WHERE verification_id = ?
`);
const deleteVerificationStatement = authDatabase.prepare(`
  DELETE FROM auth_contact_verifications WHERE verification_id = ?
`);
const deleteExpiredVerificationsStatement = authDatabase.prepare(`
  DELETE FROM auth_contact_verifications WHERE expires_at <= ? OR used = 1
`);
const updatePasswordStatement = authDatabase.prepare(`
  UPDATE auth_accounts SET password_hash = ? WHERE id = ?
`);
const deleteAccountSessionsStatement = authDatabase.prepare(`
  DELETE FROM auth_sessions WHERE account_id = ?
`);
const deleteAccountCollectionMembershipsStatement = authDatabase.prepare(`
  DELETE FROM auth_account_collection_members WHERE account_id = ?
`);
const deleteSessionByTokenStatement = authDatabase.prepare(`
  DELETE FROM auth_sessions WHERE token_hash = ?
`);
const listAccountSessionsStatement = authDatabase.prepare(`
  SELECT token_hash, expires_at, created_at, last_seen_at, user_agent,
         ip_address, location
  FROM auth_sessions
  WHERE account_id = ? AND expires_at > ?
  ORDER BY last_seen_at DESC, created_at DESC
`);
const deleteAccountSessionStatement = authDatabase.prepare(`
  DELETE FROM auth_sessions WHERE account_id = ? AND token_hash = ?
`);
const updateSessionActivityStatement = authDatabase.prepare(`
  UPDATE auth_sessions
  SET last_seen_at = ?, user_agent = CASE WHEN ? = '' THEN user_agent ELSE ? END,
      ip_address = CASE WHEN ? = '' THEN ip_address ELSE ? END,
      location = CASE WHEN ? = '' THEN location ELSE ? END
  WHERE token_hash = ?
`);
const updateSessionLocationStatement = authDatabase.prepare(`
  UPDATE auth_sessions SET location = ?
  WHERE account_id = ? AND token_hash = ?
`);
const insertPasskeyStatement = authDatabase.prepare(`
  INSERT INTO auth_passkeys (
    credential_id, account_id, public_key, counter, transports,
    device_type, backed_up, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(credential_id) DO UPDATE SET
    public_key = excluded.public_key,
    counter = excluded.counter,
    transports = excluded.transports,
    device_type = excluded.device_type,
    backed_up = excluded.backed_up
`);
const getPasskeyStatement = authDatabase.prepare(`
  SELECT * FROM auth_passkeys WHERE credential_id = ? LIMIT 1
`);
const listPasskeysStatement = authDatabase.prepare(`
  SELECT * FROM auth_passkeys WHERE account_id = ? ORDER BY created_at DESC
`);
const updatePasskeyCounterStatement = authDatabase.prepare(`
  UPDATE auth_passkeys SET counter = ? WHERE credential_id = ?
`);
const insertPasskeyChallengeStatement = authDatabase.prepare(`
  INSERT INTO auth_passkey_challenges (
    challenge_id, challenge, account_id, purpose, expires_at
  ) VALUES (?, ?, ?, ?, ?)
`);
const getPasskeyChallengeStatement = authDatabase.prepare(`
  SELECT * FROM auth_passkey_challenges
  WHERE challenge_id = ? AND purpose = ? AND expires_at > ?
  LIMIT 1
`);
const deletePasskeyChallengeStatement = authDatabase.prepare(`
  DELETE FROM auth_passkey_challenges WHERE challenge_id = ?
`);
const deleteExpiredPasskeyChallengesStatement = authDatabase.prepare(`
  DELETE FROM auth_passkey_challenges WHERE expires_at <= ?
`);

function mapAccount(row) {
  if (!row) return null;
  return {
    avatarLetter: getAvatarLetter(row.name || row.email),
    avatarUrl: null,
    birthDate: row.birth_date,
    contact: row.contact,
    contactType: row.contact_type,
    createdAt: row.created_at,
    email: row.email,
    firstName: row.first_name,
    gender: row.gender,
    id: row.id,
    name: row.name,
    passwordHash: row.password_hash,
    plan: row.plan,
    profilePictureUrl: null,
    lastName: row.last_name,
    username: row.username,
  };
}

export function getAvatarLetter(value, fallback = "M") {
  const normalized = String(value || "").trim();
  return (Array.from(normalized)[0] || fallback).toLocaleUpperCase();
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeEqual(firstValue, secondValue) {
  const first = Buffer.from(String(firstValue));
  const second = Buffer.from(String(secondValue));
  return first.length === second.length && timingSafeEqual(first, second);
}

function cleanupExpiredEntries(store, now = Date.now()) {
  for (const [key, entry] of store) {
    if (!entry?.expiresAt || entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

export function normalizeEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function normalizePhone(value) {
  const phone = String(value || "").replace(/[^\d+]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : "";
}

export function normalizeUsername(value) {
  const username = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");

  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) ? username : "";
}

export function isStrongPassword(value) {
  const password = String(value || "");
  return (
    password.length >= 12 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z\d]/.test(password)
  );
}

export function getAge(birthDate, now = new Date()) {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || birth > now) {
    return null;
  }

  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDifference = now.getUTCMonth() - birth.getUTCMonth();
  if (
    monthDifference < 0 ||
    (monthDifference === 0 && now.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }

  return age;
}

export function getRequestFingerprint(request) {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const agent = request.headers.get("user-agent") || "unknown";
  return hash(`${address}:${agent.slice(0, 180)}`);
}

export function getSessionMetadata(request) {
  const forwarded = request?.headers
    ?.get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const ipAddress = forwarded || request?.headers?.get("x-real-ip") || "local";
  const city =
    request?.headers?.get("x-vercel-ip-city") ||
    request?.headers?.get("cf-ipcity") ||
    "";
  const region =
    request?.headers?.get("x-vercel-ip-country-region") ||
    request?.headers?.get("cf-region") ||
    "";
  const country =
    request?.headers?.get("x-vercel-ip-country") ||
    request?.headers?.get("cf-ipcountry") ||
    "";
  const location = formatLocation({ city, countryCode: country, region });

  return {
    ipAddress: String(ipAddress).slice(0, 80),
    location: String(
      location || (ipAddress === "local" ? "Local device" : `IP ${ipAddress}`),
    ).slice(0, 180),
    userAgent: String(
      request?.headers?.get("user-agent") || "Unknown device",
    ).slice(0, 500),
  };
}

function getDeviceSignature(userAgent) {
  const value = String(userAgent || "");
  const os = /Windows/i.test(value)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(value)
      ? "iOS"
      : /Android/i.test(value)
        ? "Android"
        : /Mac OS|Macintosh/i.test(value)
          ? "macOS"
          : /Linux/i.test(value)
            ? "Linux"
            : "Other";
  const browser = /Edg\//i.test(value)
    ? "Microsoft Edge"
    : /Firefox\//i.test(value)
      ? "Firefox"
      : /Chrome\//i.test(value)
        ? "Chrome"
        : /Safari\//i.test(value)
          ? "Safari"
          : "Browser";
  return { browser, os };
}

/**
 * Scores how likely it is that a request is replaying a stolen session
 * token from a different device instead of the account's own browser.
 * A single differing signal (network change, browser update) is common
 * and tolerated; stacked signals point to token theft.
 */
function evaluateSessionRisk(storedSession, request) {
  const metadata = getSessionMetadata(request);
  const storedUserAgent = storedSession.user_agent || "";
  const storedIp = storedSession.ip_address || "";
  const storedLocation = storedSession.location || "";

  const storedDevice = getDeviceSignature(storedUserAgent);
  const currentDevice = getDeviceSignature(metadata.userAgent);
  const deviceChanged = Boolean(
    storedUserAgent &&
      (storedDevice.browser !== currentDevice.browser ||
        storedDevice.os !== currentDevice.os),
  );
  const ipChanged = Boolean(
    storedIp && storedIp !== "local" && storedIp !== metadata.ipAddress,
  );
  const locationChanged = Boolean(
    storedLocation && storedLocation !== metadata.location,
  );

  const providedCollectionToken = getRequestCookie(
    request,
    accountCollectionCookieName,
  );
  const providedCollectionHash = providedCollectionToken
    ? hash(providedCollectionToken)
    : "";
  const collectionMismatch = Boolean(
    storedSession.collection_hash &&
      providedCollectionHash !== storedSession.collection_hash,
  );

  const riskScore =
    (deviceChanged ? 2 : 0) +
    (ipChanged ? 1 : 0) +
    (locationChanged ? 1 : 0) +
    (collectionMismatch ? 3 : 0);

  return { metadata, suspicious: riskScore >= 3 };
}

export function consumeRateLimit({ key, limit = 8, windowMs = 60_000 }) {
  const now = Date.now();
  const timestamps = (authStore.rateLimits.get(key) || []).filter(
    (timestamp) => now - timestamp < windowMs,
  );

  if (timestamps.length >= limit) {
    authStore.rateLimits.set(key, timestamps);
    return {
      allowed: false,
      retryAfter: Math.max(
        1,
        Math.ceil((windowMs - (now - timestamps[0])) / 1000),
      ),
    };
  }

  timestamps.push(now);
  authStore.rateLimits.set(key, timestamps);
  return { allowed: true, retryAfter: 0 };
}

function randomCaptchaText(length = 6) {
  return Array.from(
    { length },
    () => captchaAlphabet[randomInt(captchaAlphabet.length)],
  ).join("");
}

export function createCaptcha(fingerprint) {
  cleanupExpiredEntries(authStore.captchas);
  const challengeId = randomBytes(18).toString("base64url");
  const accessToken = randomBytes(24).toString("base64url");
  const answer = randomCaptchaText();
  const expiresAt = Date.now() + captchaLifetimeMs;

  authStore.captchas.set(challengeId, {
    accessTokenHash: hash(accessToken),
    answerHash: hash(answer),
    attempts: 0,
    expiresAt,
    fingerprint,
    text: answer,
  });

  return { accessToken, challengeId, expiresAt };
}

export function getCaptchaImage(challengeId, accessToken) {
  cleanupExpiredEntries(authStore.captchas);
  const challenge = authStore.captchas.get(challengeId);
  if (!challenge || !safeEqual(challenge.accessTokenHash, hash(accessToken))) {
    return null;
  }

  const noiseLines = Array.from({ length: 11 }, (_, index) => {
    const x1 = randomInt(0, 280);
    const y1 = randomInt(0, 90);
    const x2 = randomInt(0, 280);
    const y2 = randomInt(0, 90);
    return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${index % 2 ? "#d8b4fe" : "#7e22ce"}" stroke-opacity=".34" stroke-width="${randomInt(1, 4)}"/>`;
  }).join("");
  const letters = [...challenge.text]
    .map((letter, index) => {
      const x = 30 + index * 40;
      const y = 56 + randomInt(-7, 8);
      const rotation = randomInt(-18, 19);
      return `<text x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})">${letter}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="90" viewBox="0 0 280 90" role="img" aria-label="Security challenge"><rect width="280" height="90" rx="16" fill="#210737"/><rect x="1" y="1" width="278" height="88" rx="15" fill="none" stroke="#d8b4fe" stroke-opacity=".35"/>${noiseLines}<g fill="#fff" font-family="Google Sans Flex,system-ui,sans-serif" font-size="34" font-weight="700" letter-spacing="5">${letters}</g></svg>`;
}

export function verifyCaptcha({ answer, challengeId, fingerprint }) {
  cleanupExpiredEntries(authStore.captchas);
  const challenge = authStore.captchas.get(challengeId);
  if (!challenge || challenge.fingerprint !== fingerprint) {
    return false;
  }

  challenge.attempts += 1;
  if (challenge.attempts > 4) {
    authStore.captchas.delete(challengeId);
    return false;
  }

  const valid = safeEqual(
    challenge.answerHash,
    hash(
      String(answer || "")
        .trim()
        .toUpperCase(),
    ),
  );
  if (valid) {
    authStore.captchas.delete(challengeId);
  }
  return valid;
}

export function createContactVerification(identifier, fingerprint) {
  deleteExpiredVerificationsStatement.run(Date.now());
  const normalizedIdentifier =
    normalizeEmail(identifier) || normalizePhone(identifier);
  if (!normalizedIdentifier) {
    return null;
  }

  const code = String(randomInt(100000, 1000000));
  const expiresAt = Date.now() + verificationLifetimeMs;
  const verificationSecret =
    process.env.MUNETIOS_EMAIL_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "";
  let verificationId = randomBytes(18).toString("base64url");
  if (verificationSecret) {
    const encoded = Buffer.from(
      JSON.stringify({
        codeHash: hash(code),
        expiresAt,
        fingerprintHash: hash(fingerprint),
        identifier: normalizedIdentifier,
      }),
      "utf8",
    ).toString("base64url");
    const signature = createHmac("sha256", verificationSecret)
      .update(encoded)
      .digest("base64url");
    verificationId = `v1.${encoded}.${signature}`;
  }
  insertVerificationStatement.run(
    verificationId,
    hash(code),
    fingerprint,
    normalizedIdentifier,
    expiresAt,
  );

  return {
    code,
    expiresAt,
    verificationId,
  };
}

export function deleteContactVerification(verificationId) {
  if (typeof verificationId !== "string" || !verificationId) return;
  deleteVerificationStatement.run(verificationId);
}

export function createRecoveryChallenge({ account, fingerprint, type }) {
  cleanupExpiredEntries(authStore.recoveries);
  const recoveryId = randomBytes(24).toString("base64url");
  const code = String(randomInt(100000, 1000000));
  const expiresAt = Date.now() + verificationLifetimeMs;
  authStore.recoveries.set(recoveryId, {
    accountId: account?.id || null,
    attempts: 0,
    codeHash: hash(code),
    expiresAt,
    fingerprint,
    type: type === "email" ? "email" : "password",
  });
  return { code, expiresAt, recoveryId };
}

export function verifyRecoveryChallenge({
  code,
  fingerprint,
  recoveryId,
  type,
}) {
  cleanupExpiredEntries(authStore.recoveries);
  const recovery = authStore.recoveries.get(recoveryId);
  if (
    !recovery ||
    recovery.fingerprint !== fingerprint ||
    recovery.type !== (type === "email" ? "email" : "password")
  ) {
    return null;
  }

  recovery.attempts += 1;
  if (recovery.attempts > 5) {
    authStore.recoveries.delete(recoveryId);
    return null;
  }
  if (!safeEqual(recovery.codeHash, hash(String(code || "").trim()))) {
    return null;
  }

  authStore.recoveries.delete(recoveryId);
  return recovery.accountId
    ? mapAccount(
        authDatabase
          .prepare("SELECT * FROM auth_accounts WHERE id = ? LIMIT 1")
          .get(recovery.accountId),
      )
    : null;
}

export async function updateAccountPassword(accountId, password) {
  if (!accountId || !isStrongPassword(password)) return false;
  const passwordHash = await bcrypt.hash(password, 12);
  const result = updatePasswordStatement.run(passwordHash, accountId);
  if (Number(result.changes) < 1) return false;
  deleteAccountSessionsStatement.run(accountId);
  return true;
}

export function updateManagedAccountProfile(accountId, profile) {
  const account = getAccountById(accountId);
  const email = normalizeEmail(profile?.email);
  const firstName = String(profile?.firstName || "")
    .trim()
    .slice(0, 60);
  const lastName = String(profile?.lastName || "")
    .trim()
    .slice(0, 60);
  const birthDate = String(profile?.birthDate || "");
  const age = getAge(birthDate);
  const gender = String(profile?.gender || "");
  if (
    !account ||
    !email ||
    !firstName ||
    !lastName ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(birthDate) ||
    age === null ||
    age >= 18 ||
    !["woman", "man", "nonbinary", "other"].includes(gender)
  ) {
    return null;
  }
  const existing = getAccountByIdentifier(email);
  if (existing && existing.id !== accountId) return null;
  updateManagedAccountProfileStatement.run(
    email,
    email,
    `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    gender,
    birthDate,
    accountId,
  );
  return getAccountById(accountId);
}

export function updateAccountPlan(accountId, planId) {
  const plan =
    {
      "business-free": "Business Free",
      "business-pro": "Business Pro",
      free: "Free",
      "munetios-ai-plus": "Pro Lite",
      pro: "Pro",
      "pro-lite": "Pro Lite",
    }[planId] || null;
  if (!accountId || !plan) return false;
  return Number(updateAccountPlanStatement.run(plan, accountId).changes) > 0;
}

export function verifyContact({
  code,
  fingerprint,
  identifier,
  verificationId,
}) {
  if (String(verificationId || "").startsWith("v1.")) {
    const verificationSecret =
      process.env.MUNETIOS_EMAIL_TOKEN_SECRET ||
      process.env.AUTH_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      "";
    const [version, encoded, providedSignature, extra] = String(
      verificationId || "",
    ).split(".");
    if (!verificationSecret || version !== "v1" || !encoded || extra) {
      return false;
    }
    const expectedSignature = createHmac("sha256", verificationSecret)
      .update(encoded)
      .digest("base64url");
    if (!safeEqual(providedSignature, expectedSignature)) return false;
    try {
      const verification = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      );
      const normalizedIdentifier =
        normalizeEmail(identifier) || normalizePhone(identifier);
      return Boolean(
        verification.expiresAt > Date.now() &&
          verification.identifier === normalizedIdentifier &&
          safeEqual(verification.fingerprintHash, hash(fingerprint)) &&
          safeEqual(verification.codeHash, hash(String(code || "").trim())),
      );
    } catch {
      return false;
    }
  }
  deleteExpiredVerificationsStatement.run(Date.now());
  incrementVerificationAttemptsStatement.run(verificationId);
  const verification = getVerificationStatement.get(verificationId);
  const normalizedIdentifier =
    normalizeEmail(identifier) || normalizePhone(identifier);
  if (
    !verification ||
    verification.used ||
    verification.attempts > 5 ||
    verification.fingerprint !== fingerprint ||
    verification.identifier !== normalizedIdentifier ||
    !safeEqual(verification.code_hash, hash(String(code || "").trim()))
  ) {
    if (verification?.attempts > 5) {
      deleteVerificationStatement.run(verificationId);
    }
    return false;
  }

  useVerificationStatement.run(verificationId);
  return true;
}

export function isContactUsed(identifier) {
  const normalizedIdentifier =
    normalizeEmail(identifier) || normalizePhone(identifier);
  return normalizedIdentifier
    ? Boolean(
        contactUsedStatement.get(normalizedIdentifier, normalizedIdentifier),
      )
    : false;
}

export function isUsernameUsed(username) {
  const normalizedUsername = normalizeUsername(username);
  return normalizedUsername
    ? Boolean(usernameUsedStatement.get(normalizedUsername))
    : false;
}

export function createAvailableUsername(preferredUsername) {
  const preferred = normalizeUsername(preferredUsername);
  if (preferred && !isUsernameUsed(preferred)) return preferred;

  const base =
    String(preferredUsername || "user")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 18) || "user";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = normalizeUsername(`${base}-${randomInt(100000, 999999)}`);
    if (candidate && !isUsernameUsed(candidate)) return candidate;
  }
  return null;
}

export async function createAccount({
  birthDate,
  contact,
  contactType,
  email,
  firstName,
  gender,
  lastName,
  name,
  password,
  username,
}) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedContact =
    contactType === "phone" ? normalizePhone(contact) : normalizeEmail(contact);
  const normalizedAccountEmail = email
    ? normalizeEmail(email)
    : `${normalizedUsername}@munetios.com`;
  if (
    !normalizedUsername ||
    !normalizedContact ||
    !normalizedAccountEmail ||
    isUsernameUsed(normalizedUsername) ||
    isContactUsed(normalizedContact)
  ) {
    return null;
  }

  const id = randomUUID();
  const account = {
    avatarUrl: null,
    birthDate,
    contact: normalizedContact,
    contactType,
    createdAt: new Date().toISOString(),
    email: normalizedAccountEmail,
    firstName: String(firstName || "")
      .trim()
      .slice(0, 60),
    gender: ["woman", "man", "nonbinary", "other"].includes(gender)
      ? gender
      : "",
    id,
    name:
      String(name || "")
        .trim()
        .slice(0, 100) || normalizedUsername,
    passwordHash: await bcrypt.hash(password, 12),
    plan: "Free",
    profilePictureUrl: null,
    lastName: String(lastName || "")
      .trim()
      .slice(0, 60),
    username: normalizedUsername,
  };

  try {
    insertAccountStatement.run(
      account.id,
      account.username,
      account.email,
      account.contact,
      account.contactType,
      account.name,
      account.firstName,
      account.lastName,
      account.gender,
      account.birthDate,
      account.passwordHash,
      account.plan,
      account.createdAt,
    );
    return account;
  } catch {
    return null;
  }
}

export function importDurableAccount(account) {
  if (!account?.id || !account?.passwordHash) return null;
  const existing = mapAccount(findAccountByIdStatement.get(account.id));
  if (existing) return existing;
  try {
    insertAccountStatement.run(
      account.id,
      account.username,
      account.email,
      account.contact,
      account.contactType,
      account.name,
      account.firstName,
      account.lastName,
      account.gender,
      account.birthDate,
      account.passwordHash,
      account.plan || "Free",
      account.createdAt || new Date().toISOString(),
    );
  } catch {
    return mapAccount(findAccountByIdStatement.get(account.id));
  }
  for (const [key, value] of Object.entries(account.durableData || {})) {
    setAccountDataStatement.run(
      account.id,
      String(key).slice(0, 160),
      JSON.stringify(value),
      new Date().toISOString(),
    );
  }
  return mapAccount(findAccountByIdStatement.get(account.id));
}

export function getAccountByIdentifier(identifier) {
  const normalized =
    normalizeEmail(identifier) ||
    normalizePhone(identifier) ||
    normalizeUsername(identifier);
  return normalized
    ? mapAccount(findAccountStatement.get(normalized, normalized, normalized))
    : null;
}

export function getAccountByOAuthIdentity(provider, providerAccountId) {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  const normalizedProviderAccountId = String(providerAccountId || "").trim();
  if (!normalizedProvider || !normalizedProviderAccountId) return null;
  return mapAccount(
    findOAuthIdentityStatement.get(
      normalizedProvider,
      normalizedProviderAccountId,
    ),
  );
}

export function linkOAuthIdentity(
  accountId,
  { email = "", provider, providerAccountId },
) {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  const normalizedProviderAccountId = String(providerAccountId || "").trim();
  if (
    !getAccountById(accountId) ||
    !normalizedProvider ||
    !normalizedProviderAccountId
  ) {
    return false;
  }
  const now = new Date().toISOString();
  insertOAuthIdentityStatement.run(
    normalizedProvider,
    normalizedProviderAccountId,
    accountId,
    normalizeEmail(email) || "",
    now,
    now,
  );
  return true;
}

export async function createOAuthAccount({
  email,
  name,
  provider,
  providerAccountId,
  username,
}) {
  const normalizedEmail = normalizeEmail(email);
  const availableUsername = createAvailableUsername(
    username || normalizedEmail?.split("@")[0] || "user",
  );
  if (!normalizedEmail || !availableUsername) return null;

  const normalizedName =
    String(name || "")
      .trim()
      .slice(0, 100) || availableUsername;
  const nameParts = normalizedName.split(/\s+/);
  const account = await createAccount({
    birthDate: "",
    contact: normalizedEmail,
    contactType: "email",
    email: normalizedEmail,
    firstName: nameParts[0] || normalizedName,
    gender: "",
    lastName: nameParts.slice(1).join(" "),
    name: normalizedName,
    password: randomBytes(48).toString("base64url"),
    username: availableUsername,
  });
  const resolvedAccount = account || getAccountByIdentifier(normalizedEmail);
  if (
    resolvedAccount &&
    linkOAuthIdentity(resolvedAccount.id, {
      email: normalizedEmail,
      provider,
      providerAccountId,
    })
  ) {
    return resolvedAccount;
  }
  return null;
}

export async function verifyAccountPassword(account, password) {
  return Boolean(
    account?.passwordHash &&
      (await bcrypt.compare(String(password || ""), account.passwordHash)),
  );
}

export function getRequestCookie(request, name) {
  if (request?.cookies?.get) {
    return request.cookies.get(name)?.value || null;
  }
  const header = request?.headers?.get?.("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function ensureAccountCollection(accountId, collectionToken) {
  const now = Date.now();
  deleteExpiredAccountCollectionsStatement.run(now);
  let token = String(collectionToken || "");
  let collectionHash = hash(token);
  let collection = token
    ? findAccountCollectionStatement.get(collectionHash, now)
    : null;

  if (!collection) {
    token = randomBytes(32).toString("base64url");
    collectionHash = hash(token);
    insertAccountCollectionStatement.run(
      collectionHash,
      now + sessionLifetimeMs,
      new Date(now).toISOString(),
    );
    collection = { token_hash: collectionHash };
  }

  insertAccountCollectionMemberStatement.run(
    collectionHash,
    accountId,
    new Date(now).toISOString(),
  );
  return { token, tokenHash: collectionHash };
}

export function getAccountCollectionAccounts(collectionToken) {
  const now = Date.now();
  deleteExpiredAccountCollectionsStatement.run(now);
  const tokenHash = hash(collectionToken || "");
  if (!findAccountCollectionStatement.get(tokenHash, now)) return [];
  return listAccountCollectionMembersStatement.all(tokenHash).map(mapAccount);
}

export function isAccountInCollection(collectionToken, accountId) {
  const now = Date.now();
  deleteExpiredAccountCollectionsStatement.run(now);
  const collectionHash = hash(collectionToken || "");
  return Boolean(
    findAccountCollectionStatement.get(collectionHash, now) &&
      findAccountCollectionMemberStatement.get(collectionHash, accountId),
  );
}

export function createAccountSession(
  account,
  collectionToken = null,
  metadata = {},
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionLifetimeMs;
  const createdAt = new Date().toISOString();
  deleteExpiredSessionsStatement.run(Date.now());
  const collection = ensureAccountCollection(account.id, collectionToken);
  insertSessionStatement.run(
    hash(token),
    account.id,
    collection.tokenHash,
    expiresAt,
    createdAt,
    createdAt,
    String(metadata.userAgent || "Unknown device").slice(0, 500),
    String(metadata.ipAddress || "local").slice(0, 80),
    String(metadata.location || "Local device").slice(0, 180),
  );
  return { accountCollectionToken: collection.token, expiresAt, token };
}

export function createSessionForCollectionAccount(
  collectionToken,
  accountId,
  metadata = {},
) {
  const now = Date.now();
  const collectionHash = hash(collectionToken || "");
  if (
    !findAccountCollectionStatement.get(collectionHash, now) ||
    !findAccountCollectionMemberStatement.get(collectionHash, accountId)
  ) {
    return null;
  }
  const account = mapAccount(findAccountByIdStatement.get(accountId));
  const lifecycle = getAccountLifecycle(accountId);
  return account && !lifecycle.archived && !lifecycle.deletedAt
    ? createAccountSession(account, collectionToken, metadata)
    : null;
}

export function signOutAccountCollection(collectionToken) {
  const collectionHash = hash(collectionToken || "");
  deleteAccountCollectionSessionsStatement.run(collectionHash);
  deleteAccountCollectionStatement.run(collectionHash);
}

export function attachSessionToAccountCollection(
  sessionToken,
  collectionToken,
) {
  if (!sessionToken || !collectionToken) return;
  attachSessionToAccountCollectionStatement.run(
    hash(collectionToken),
    hash(sessionToken),
  );
}

export function getAccountData(accountId, key, fallback = null) {
  const row = getAccountDataStatement.get(accountId, key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.data_json);
  } catch {
    return fallback;
  }
}

export function listAccountData(key) {
  return listAccountDataStatement.all(key).flatMap((row) => {
    try {
      return [
        {
          accountId: row.account_id,
          updatedAt: row.updated_at,
          value: JSON.parse(row.data_json),
        },
      ];
    } catch {
      return [];
    }
  });
}

export function listAllAccountData(accountId) {
  if (!accountId) return [];
  return listAllAccountDataStatement.all(accountId).map((row) => {
    let value = null;
    try {
      value = JSON.parse(row.data_json);
    } catch {}
    return {
      key: row.data_key,
      updatedAt: row.updated_at,
      value,
    };
  });
}

export function deleteAccountData(accountId, key) {
  if (!accountId || !key) return false;
  return deleteAccountDataStatement.run(accountId, key).changes > 0;
}

export function setAccountData(accountId, key, value) {
  setAccountDataStatement.run(
    accountId,
    key,
    JSON.stringify(value),
    new Date().toISOString(),
  );
  return value;
}

export function getAccountLifecycle(accountId) {
  return getAccountData(accountId, "account-lifecycle-v1", {
    archived: false,
    deletedAt: "",
    purgeAt: "",
  });
}

export function setAccountArchived(accountId, archived) {
  const current = getAccountLifecycle(accountId);
  const next = {
    ...current,
    archived: Boolean(archived),
    archivedAt: archived ? new Date().toISOString() : "",
    updatedAt: new Date().toISOString(),
  };
  setAccountData(accountId, "account-lifecycle-v1", next);
  if (archived) signOutAllAccountSessions(accountId);
  return next;
}

export function findDeletedAccountByIdentifier(identifier) {
  const normalized = String(identifier || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  const now = Date.now();
  for (const entry of listAccountData("account-lifecycle-v1")) {
    const lifecycle = entry.value || {};
    if (!lifecycle.deletedAt) continue;
    if (Date.parse(lifecycle.purgeAt || "") <= now) {
      purgeDeletedAccount(entry.accountId);
      continue;
    }
    const identifiers = [
      lifecycle.originalEmail,
      lifecycle.originalContact,
      lifecycle.originalUsername,
    ].map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    );
    if (identifiers.includes(normalized)) {
      return {
        account: getAccountById(entry.accountId),
        lifecycle,
      };
    }
  }
  return null;
}

function purgeDeletedAccount(accountId) {
  const lifecycle = getAccountLifecycle(accountId);
  if (
    !lifecycle.deletedAt ||
    Date.parse(lifecycle.purgeAt || "") > Date.now()
  ) {
    return false;
  }
  const profile = getAccountData(accountId, "profile", {});
  const profilePath = String(profile?.imageFile?.path || "");
  const profileDirectory = join(databaseDirectory, "profile-images");
  if (profilePath?.startsWith(`${profileDirectory}${sep}`)) {
    try {
      rmSync(profilePath, { force: true });
    } catch {}
  }
  try {
    rmSync(
      join(databaseDirectory, "account-storage", hash(accountId).slice(0, 32)),
      { force: true, recursive: true },
    );
  } catch {}
  const exportsDirectory = join(databaseDirectory, "account-exports");
  if (existsSync(exportsDirectory)) {
    for (const name of readdirSync(exportsDirectory)) {
      if (!name.startsWith(`${accountId}-`) || !name.endsWith(".zip")) continue;
      try {
        rmSync(join(exportsDirectory, name), { force: true });
      } catch {}
    }
  }
  return deleteAccountStatement.run(accountId).changes > 0;
}

export function purgeExpiredDeletedAccounts() {
  let purged = 0;
  for (const entry of listAccountData("account-lifecycle-v1")) {
    if (purgeDeletedAccount(entry.accountId)) purged += 1;
  }
  return purged;
}

export function markAccountDeleted(accountId) {
  const account = getAccountById(accountId);
  if (!account) return null;
  const deletedAt = new Date();
  const suffix = `${deletedAt.getTime()}-${accountId}`;
  const lifecycle = {
    ...getAccountLifecycle(accountId),
    archived: false,
    deletedAt: deletedAt.toISOString(),
    originalContact: account.contact,
    originalContactType: account.contactType,
    originalEmail: account.email,
    originalUsername: account.username,
    purgeAt: new Date(
      deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    updatedAt: deletedAt.toISOString(),
  };
  setAccountData(accountId, "account-lifecycle-v1", lifecycle);
  updateAccountIdentifiersStatement.run(
    `deleted-${suffix}`,
    `deleted-${suffix}@deleted.munetios.invalid`,
    `deleted-${suffix}@deleted.munetios.invalid`,
    "email",
    accountId,
  );
  signOutAllAccountSessions(accountId);
  return lifecycle;
}

export function permanentlyDeleteAccount(accountId) {
  const now = Date.now();
  rememberDeletedSessionsStatement.run(
    new Date(now).toISOString(),
    now + sessionLifetimeMs,
    accountId,
  );
  const lifecycle = markAccountDeleted(accountId);
  if (!lifecycle) return false;
  setAccountData(accountId, "account-lifecycle-v1", {
    ...lifecycle,
    purgeAt: new Date(0).toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return purgeDeletedAccount(accountId);
}

export function isDeletedAccountSessionToken(token) {
  const now = Date.now();
  deleteExpiredDeletedSessionsStatement.run(now);
  return Boolean(findDeletedSessionStatement.get(hash(token || ""), now));
}

export function recoverDeletedAccount(accountId) {
  const lifecycle = getAccountLifecycle(accountId);
  if (
    !lifecycle.deletedAt ||
    Date.parse(lifecycle.purgeAt || "") <= Date.now()
  ) {
    return { error: "recovery_expired" };
  }
  if (
    isContactUsed(lifecycle.originalEmail) ||
    isContactUsed(lifecycle.originalContact) ||
    isUsernameUsed(lifecycle.originalUsername)
  ) {
    return { error: "identifier_in_use" };
  }
  updateAccountIdentifiersStatement.run(
    lifecycle.originalUsername,
    lifecycle.originalEmail,
    lifecycle.originalContact,
    lifecycle.originalContactType === "phone" ? "phone" : "email",
    accountId,
  );
  const next = {
    archived: false,
    deletedAt: "",
    purgeAt: "",
    recoveredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  setAccountData(accountId, "account-lifecycle-v1", next);
  return { account: getAccountById(accountId), lifecycle: next };
}

export function signOutSession(sessionToken) {
  if (sessionToken) deleteSessionByTokenStatement.run(hash(sessionToken));
}

export function listAccountSessions(accountId, currentSessionToken = "") {
  const now = Date.now();
  deleteExpiredSessionsStatement.run(now);
  const currentTokenHash = hash(currentSessionToken || "");
  return listAccountSessionsStatement.all(accountId, now).map((session) => ({
    createdAt: session.created_at,
    current: safeEqual(session.token_hash, currentTokenHash),
    expiresAt: new Date(session.expires_at).toISOString(),
    id: session.token_hash,
    ipAddress: session.ip_address,
    lastSeenAt: session.last_seen_at || session.created_at,
    location:
      session.location ||
      (session.ip_address && session.ip_address !== "local"
        ? `IP ${session.ip_address}`
        : "Local device"),
    userAgent: session.user_agent || "Unknown device",
  }));
}

export function signOutAccountSession(accountId, sessionId) {
  const result = deleteAccountSessionStatement.run(accountId, sessionId);
  return result.changes > 0;
}

export function setAccountSessionLocation(accountId, sessionId, location) {
  const normalized = String(location || "")
    .trim()
    .slice(0, 180);
  if (!normalized || !/^[a-f\d]{64}$/i.test(String(sessionId || ""))) {
    return false;
  }
  return (
    updateSessionLocationStatement.run(normalized, accountId, sessionId)
      .changes > 0
  );
}

export function signOutAllAccountSessions(accountId) {
  const result = deleteAccountSessionsStatement.run(accountId);
  deleteAccountCollectionMembershipsStatement.run(accountId);
  return result.changes > 0;
}

export async function changeAccountPassword(
  accountId,
  currentPassword,
  newPassword,
) {
  const account = mapAccount(findAccountByIdStatement.get(accountId));
  if (
    !account ||
    !isStrongPassword(newPassword) ||
    !(await verifyAccountPassword(account, currentPassword))
  ) {
    return false;
  }
  updatePasswordStatement.run(await bcrypt.hash(newPassword, 12), accountId);
  return true;
}

export function getAccountById(accountId) {
  return mapAccount(findAccountByIdStatement.get(accountId));
}

function mapPasskey(row) {
  if (!row) return null;
  let transports = [];
  try {
    transports = JSON.parse(row.transports || "[]");
  } catch {}
  return {
    accountId: row.account_id,
    backedUp: Boolean(row.backed_up),
    counter: Number(row.counter) || 0,
    createdAt: row.created_at,
    credentialId: row.credential_id,
    deviceType: row.device_type,
    publicKey: new Uint8Array(row.public_key),
    transports,
  };
}

export function listAccountPasskeys(accountId) {
  return listPasskeysStatement.all(accountId).map(mapPasskey);
}

export function getPasskey(credentialId) {
  return mapPasskey(getPasskeyStatement.get(String(credentialId || "")));
}

export function savePasskey(accountId, registrationInfo, transports = []) {
  const credential = registrationInfo.credential;
  insertPasskeyStatement.run(
    credential.id,
    accountId,
    Buffer.from(credential.publicKey),
    credential.counter,
    JSON.stringify(transports),
    registrationInfo.credentialDeviceType,
    registrationInfo.credentialBackedUp ? 1 : 0,
    new Date().toISOString(),
  );
}

export function updatePasskeyCounter(credentialId, counter) {
  updatePasskeyCounterStatement.run(counter, credentialId);
}

export function createPasskeyChallenge({
  accountId = null,
  challenge,
  purpose,
}) {
  const challengeId = randomUUID();
  const now = Date.now();
  deleteExpiredPasskeyChallengesStatement.run(now);
  insertPasskeyChallengeStatement.run(
    challengeId,
    challenge,
    accountId,
    purpose,
    now + 5 * 60 * 1000,
  );
  return challengeId;
}

export function consumePasskeyChallenge(challengeId, purpose) {
  const challenge = getPasskeyChallengeStatement.get(
    String(challengeId || ""),
    purpose,
    Date.now(),
  );
  deletePasskeyChallengeStatement.run(String(challengeId || ""));
  return challenge || null;
}

export function getAccountSession(token, request = null) {
  purgeExpiredDeletedAccounts();
  const now = Date.now();
  deleteExpiredSessionsStatement.run(now);
  const tokenHash = hash(token || "");
  const account = findSessionStatement.get(tokenHash, now);
  if (!account) {
    return null;
  }
  const lifecycle = getAccountLifecycle(account.id);
  if (lifecycle.archived || lifecycle.deletedAt) {
    deleteSessionByTokenStatement.run(tokenHash);
    return null;
  }

  if (request) {
    const { metadata, suspicious } = evaluateSessionRisk(account, request);
    if (suspicious) {
      deleteSessionByTokenStatement.run(tokenHash);
      return null;
    }

    const lastSeenAt = new Date(now).toISOString();
    updateSessionActivityStatement.run(
      lastSeenAt,
      metadata.userAgent,
      metadata.userAgent,
      metadata.ipAddress,
      metadata.ipAddress,
      metadata.location,
      metadata.location,
      tokenHash,
    );
  }

  return {
    authenticated: true,
    sessionKey: hash(`${account.id}:${token}`),
    sessionId: account.token_hash,
    source: "munetios_session",
    user: {
      avatarLetter: getAvatarLetter(account.name || account.email),
      avatarUrl: null,
      birthDate: account.birth_date,
      email: account.email,
      firstName: account.first_name,
      gender: account.gender,
      id: account.id,
      lastName: account.last_name,
      name: account.name,
      plan: account.plan,
      profilePictureUrl: null,
      accountType: "personal",
    },
  };
}

export function getAccountCollectionCookie(
  request,
  token,
  maxAge = Math.floor(sessionLifetimeMs / 1000),
) {
  const secure = getSecureCookieAttribute(request);
  return `${accountCollectionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export { accountCollectionCookieName };

export function getSessionCookie(
  request,
  token,
  maxAge = Math.floor(sessionLifetimeMs / 1000),
) {
  const secure = getSecureCookieAttribute(request);
  return `munetios_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestUrl = new URL(request.url);
  if (origin === requestUrl.origin) return true;

  const forwardedHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProtocol =
    request.headers.get("x-forwarded-proto") ||
    requestUrl.protocol.slice(0, -1);
  if (forwardedHost && origin === `${forwardedProtocol}://${forwardedHost}`) {
    return true;
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      const originUrl = new URL(origin);
      const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
      return (
        loopbackHosts.has(originUrl.hostname) &&
        loopbackHosts.has(requestUrl.hostname) &&
        originUrl.port === requestUrl.port
      );
    } catch {
      return false;
    }
  }

  return false;
}
