import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const connectionString = String(process.env.DATABASE_URL || "").trim();
const sql = connectionString ? neon(connectionString) : null;
let schemaPromise = null;

function tokenHash(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function ensureSchema() {
  if (!sql) return Promise.resolve(false);
  if (!schemaPromise) {
    schemaPromise = sql
      .transaction([
        sql`CREATE TABLE IF NOT EXISTS munetios_auth_accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        contact TEXT NOT NULL,
        account JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS munetios_auth_accounts_username_idx
          ON munetios_auth_accounts (LOWER(username))`,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS munetios_auth_accounts_email_idx
          ON munetios_auth_accounts (LOWER(email))`,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS munetios_auth_accounts_contact_idx
          ON munetios_auth_accounts (LOWER(contact))`,
        sql`CREATE TABLE IF NOT EXISTS munetios_auth_sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES munetios_auth_accounts(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL,
        session JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
        sql`CREATE INDEX IF NOT EXISTS munetios_auth_sessions_account_idx
          ON munetios_auth_sessions (account_id)`,
      ])
      .then(() => true);
  }
  return schemaPromise;
}

export function hasDurableAuthStore() {
  return Boolean(sql);
}

export function durableAuthRequired() {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT,
  );
}

export async function durableIdentifierUsed(identifier) {
  if (!(await ensureSchema())) return false;
  const normalized = String(identifier || "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  const rows = await sql`
    SELECT 1 FROM munetios_auth_accounts
    WHERE LOWER(username) = ${normalized}
       OR LOWER(email) = ${normalized}
       OR LOWER(contact) = ${normalized}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getDurableAccount(identifier) {
  if (!(await ensureSchema())) return null;
  const normalized = String(identifier || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  const rows = await sql`
    SELECT account FROM munetios_auth_accounts
    WHERE LOWER(username) = ${normalized}
       OR LOWER(email) = ${normalized}
       OR LOWER(contact) = ${normalized}
    LIMIT 1
  `;
  return rows[0]?.account || null;
}

export async function saveDurableAccount(account) {
  if (!(await ensureSchema())) return false;
  await sql`
    INSERT INTO munetios_auth_accounts (id, username, email, contact, account)
    VALUES (
      ${account.id}, ${account.username}, ${account.email},
      ${account.contact}, ${JSON.stringify(account)}::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      email = EXCLUDED.email,
      contact = EXCLUDED.contact,
      account = EXCLUDED.account
  `;
  return true;
}

export async function saveDurableSession({ account, session, metadata = {} }) {
  if (!(await ensureSchema())) return false;
  const storedSession = {
    accountCollectionToken: session.accountCollectionToken,
    accountId: account.id,
    createdAt: new Date().toISOString(),
    expiresAt: session.expiresAt,
    ipAddress: String(metadata.ipAddress || "local").slice(0, 80),
    location: String(metadata.location || "Local device").slice(0, 180),
    userAgent: String(metadata.userAgent || "Unknown device").slice(0, 500),
  };
  await sql`
    INSERT INTO munetios_auth_sessions (token_hash, account_id, expires_at, session)
    VALUES (
      ${tokenHash(session.token)}, ${account.id}, ${session.expiresAt},
      ${JSON.stringify(storedSession)}::jsonb
    )
    ON CONFLICT (token_hash) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      expires_at = EXCLUDED.expires_at,
      session = EXCLUDED.session
  `;
  return true;
}

export async function getDurableSession(token) {
  if (!(await ensureSchema())) return null;
  const now = Date.now();
  const rows = await sql`
    SELECT a.account, s.session, s.token_hash
    FROM munetios_auth_sessions s
    JOIN munetios_auth_accounts a ON a.id = s.account_id
    WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > ${now}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    account: rows[0].account,
    session: rows[0].session,
    tokenHash: rows[0].token_hash,
  };
}

export async function deleteDurableSession(token) {
  if (!(await ensureSchema())) return false;
  await sql`
    DELETE FROM munetios_auth_sessions
    WHERE token_hash = ${tokenHash(token)}
  `;
  return true;
}
