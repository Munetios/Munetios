import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databaseDirectory =
  process.env.MUNETIOS_DATA_DIR || join(process.cwd(), "data");
const databasePath = join(databaseDirectory, "munetios.sqlite");

function openDatabase() {
  mkdirSync(databaseDirectory, { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 10000;");
  database.exec("PRAGMA encoding = 'UTF-8';");
  database.exec("PRAGMA journal_mode = WAL;");
  return database;
}

function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_shared_links (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      public_url TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      transcript_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_shared_links_owner_index
      ON ai_shared_links (owner_id, created_at DESC);
  `);
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(ai_shared_links)")
      .all()
      .map(({ name }) => name),
  );
  const additions = [
    ["conversation_id", "TEXT NOT NULL DEFAULT ''"],
    ["encrypted_payload", "TEXT NOT NULL DEFAULT ''"],
    ["members_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"],
    ["version", "INTEGER NOT NULL DEFAULT 1"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name))
      database.exec(
        `ALTER TABLE ai_shared_links ADD COLUMN ${name} ${definition}`,
      );
  }
}

const database = globalThis.__munetiosAiSharedLinksDatabase || openDatabase();
globalThis.__munetiosAiSharedLinksDatabase = database;
ensureSchema(database);

const insertLink = database.prepare(`
  INSERT INTO ai_shared_links (
    id, owner_id, title, public_url, token_hash, transcript_json, created_at,
    conversation_id, encrypted_payload, members_json, updated_at, version
  ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, '[]', ?, 1)
`);
const listLinks = database.prepare(`
  SELECT id, title, public_url, created_at, updated_at, conversation_id, members_json, version
  FROM ai_shared_links WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 200
`);
const findLink = database.prepare("SELECT * FROM ai_shared_links WHERE id = ?");
const deleteLink = database.prepare(
  "DELETE FROM ai_shared_links WHERE id = ? AND owner_id = ?",
);
const updatePayload = database.prepare(`
  UPDATE ai_shared_links SET encrypted_payload = ?, updated_at = ?, version = version + 1
  WHERE id = ? AND version = ?
`);
const updateMembers = database.prepare(`
  UPDATE ai_shared_links SET members_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?
`);

function hashToken(token) {
  return createHash("sha256").update(token).digest();
}

function tokenMatches(link, token) {
  if (!link || !token) return false;
  const supplied = hashToken(token);
  const expected = Buffer.from(link.token_hash, "hex");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function parseMembers(value) {
  try {
    const members = JSON.parse(value || "[]");
    return Array.isArray(members) ? members : [];
  } catch {
    return [];
  }
}

function publicLink(link, { includeMembers = false } = {}) {
  return {
    conversationId: link.conversation_id,
    createdAt: link.created_at,
    encryptedPayload: link.encrypted_payload,
    id: link.id,
    ...(includeMembers ? { members: parseMembers(link.members_json) } : {}),
    title: link.title,
    updatedAt: link.updated_at || link.created_at,
    version: Number(link.version) || 1,
  };
}

export function createAiSharedLink({
  conversationId = "",
  encryptedPayload,
  origin,
  ownerId,
  title,
}) {
  const id = randomUUID();
  const token = randomBytes(24).toString("base64url");
  const url = `${origin}/apps/ai/v/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
  const now = new Date().toISOString();
  insertLink.run(
    id,
    ownerId,
    title,
    url,
    hashToken(token).toString("hex"),
    now,
    conversationId,
    encryptedPayload,
    now,
  );
  return {
    conversationId,
    createdAt: now,
    id,
    title,
    updatedAt: now,
    url,
    version: 1,
  };
}

export function listAiSharedLinks(ownerId) {
  return listLinks.all(ownerId).map((link) => ({
    ...publicLink(link, { includeMembers: true }),
    url: link.public_url,
  }));
}

export function deleteAiSharedLink(ownerId, id) {
  return deleteLink.run(id, ownerId).changes > 0;
}

export function getAiSharedLink(id, token, accountId = "") {
  const link = findLink.get(id);
  const members = parseMembers(link?.members_json);
  const isOwner = Boolean(accountId && link?.owner_id === accountId);
  const isMember = Boolean(
    accountId && members.some((member) => member.accountId === accountId),
  );
  if (!link || (!tokenMatches(link, token) && !isOwner && !isMember))
    return null;
  return { ...publicLink(link, { includeMembers: isOwner }), isOwner };
}

export function updateAiSharedLink({ encryptedPayload, id, token, version }) {
  const link = findLink.get(id);
  if (!tokenMatches(link, token)) return { error: "link_not_found" };
  const now = new Date().toISOString();
  const result = updatePayload.run(encryptedPayload, now, id, version);
  if (!result.changes)
    return { error: "version_conflict", link: publicLink(findLink.get(id)) };
  return { link: publicLink(findLink.get(id)) };
}

export function updateAiSharedLinkMembers(ownerId, id, members) {
  const result = updateMembers.run(
    JSON.stringify(members),
    new Date().toISOString(),
    id,
    ownerId,
  );
  return result.changes
    ? publicLink(findLink.get(id), { includeMembers: true })
    : null;
}
