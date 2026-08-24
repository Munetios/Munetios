import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "./dataDirectory.js";

const directory = dataDirectory;
mkdirSync(directory, { recursive: true });
const database =
  globalThis.__munetiosConnectorDatabase ||
  new DatabaseSync(join(directory, "connectors.sqlite"));
globalThis.__munetiosConnectorDatabase = database;

database.exec("PRAGMA busy_timeout = 5000;");
database.exec(`
  CREATE TABLE IF NOT EXISTS connectors (
    id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL, developer TEXT NOT NULL, icon_url TEXT NOT NULL,
    terms_url TEXT NOT NULL, privacy_url TEXT NOT NULL, website_url TEXT NOT NULL,
    owner_user_id TEXT, visibility TEXT NOT NULL, status TEXT NOT NULL,
    oauth_authorize_url TEXT, oauth_token_url TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS connector_connections (
    account_id TEXT NOT NULL, connector_id TEXT NOT NULL,
    external_account TEXT, access_token TEXT, connected_at TEXT NOT NULL,
    PRIMARY KEY (account_id, connector_id)
  );
  CREATE TABLE IF NOT EXISTS connector_oauth_states (
    state TEXT PRIMARY KEY, account_id TEXT NOT NULL, connector_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL, return_to TEXT NOT NULL DEFAULT '/account/settings/connectors'
  );
  CREATE TABLE IF NOT EXISTS connector_developer_businesses (
    account_id TEXT PRIMARY KEY, business_name TEXT NOT NULL,
    website TEXT NOT NULL, contact_email TEXT NOT NULL,
    description TEXT NOT NULL, status TEXT NOT NULL, submitted_at TEXT NOT NULL
  );
`);

try {
  database.exec(
    "ALTER TABLE connector_oauth_states ADD COLUMN return_to TEXT NOT NULL DEFAULT '/account/settings/connectors'",
  );
} catch (error) {
  if (!String(error?.message || "").includes("duplicate column name"))
    throw error;
}

database
  .prepare(`INSERT OR IGNORE INTO connectors (
    id, slug, name, description, developer, icon_url, terms_url, privacy_url,
    website_url, visibility, status, oauth_authorize_url, oauth_token_url, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', 'published', ?, ?, ?)`)
  .run(
    "github",
    "github",
    "GitHub",
    "Connect GitHub repositories and developer workflows to Munetios.",
    "Munetios",
    "/connectors/github.svg",
    "https://docs.github.com/site-policy/github-terms/github-terms-of-service",
    "https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement",
    "https://github.com",
    "https://github.com/login/oauth/authorize",
    "https://github.com/login/oauth/access_token",
    new Date().toISOString(),
  );

database
  .prepare("UPDATE connectors SET developer = ? WHERE id = ?")
  .run("Munetios", "github");

function rowConnector(row, connected = false) {
  return {
    connected,
    description: row.description,
    developer: row.developer,
    iconUrl: row.icon_url,
    id: row.id,
    name: row.name,
    privacyUrl: row.privacy_url,
    slug: row.slug,
    status: row.status,
    termsUrl: row.terms_url,
    visibility: row.visibility,
    websiteUrl: row.website_url,
  };
}

export function listPublicConnectors() {
  return database
    .prepare(
      "SELECT * FROM connectors WHERE visibility = 'public' AND status = 'published' ORDER BY name",
    )
    .all()
    .map((row) => rowConnector(row));
}

export function listAccountConnectors(accountId) {
  return database
    .prepare(`SELECT c.*, cc.account_id AS connected
      FROM connectors c LEFT JOIN connector_connections cc
      ON cc.connector_id = c.id AND cc.account_id = ?
      WHERE (c.visibility = 'public' AND c.status = 'published') OR c.owner_user_id = ?
      ORDER BY c.name`)
    .all(accountId, accountId)
    .map((row) => rowConnector(row, Boolean(row.connected)));
}

export function getConnector(slug) {
  const row = database
    .prepare("SELECT * FROM connectors WHERE slug = ?")
    .get(slug);
  return row ? rowConnector(row) : null;
}

export function createPrivateConnector(accountId, input) {
  const id = randomUUID();
  const slug = `${input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${id.slice(0, 8)}`;
  database
    .prepare(`INSERT INTO connectors (
    id, slug, name, description, developer, icon_url, terms_url, privacy_url,
    website_url, owner_user_id, visibility, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      slug,
      input.name,
      input.description,
      input.developer,
      input.iconUrl,
      input.termsUrl,
      input.privacyUrl,
      input.websiteUrl,
      accountId,
      input.visibility,
      input.visibility === "private" ? "private" : "pending",
      new Date().toISOString(),
    );
  return getConnector(slug);
}

export function disconnectConnector(accountId, connectorId) {
  return (
    database
      .prepare(
        "DELETE FROM connector_connections WHERE account_id = ? AND connector_id = ?",
      )
      .run(accountId, connectorId).changes > 0
  );
}

export function createOAuthState(
  accountId,
  connectorId,
  returnTo = "/account/settings/connectors",
) {
  const state = randomBytes(32).toString("base64url");
  database
    .prepare("DELETE FROM connector_oauth_states WHERE expires_at < ?")
    .run(Date.now());
  database
    .prepare(
      "INSERT INTO connector_oauth_states (state, account_id, connector_id, expires_at, return_to) VALUES (?, ?, ?, ?, ?)",
    )
    .run(state, accountId, connectorId, Date.now() + 10 * 60 * 1000, returnTo);
  return state;
}

export function consumeOAuthState(state, connectorId) {
  const row = database
    .prepare(
      "SELECT * FROM connector_oauth_states WHERE state = ? AND connector_id = ? AND expires_at >= ?",
    )
    .get(state, connectorId, Date.now());
  if (row)
    database
      .prepare("DELETE FROM connector_oauth_states WHERE state = ?")
      .run(state);
  return row || null;
}

export function connectConnector(
  accountId,
  connectorId,
  externalAccount,
  accessToken,
) {
  database
    .prepare(`INSERT INTO connector_connections
    (account_id, connector_id, external_account, access_token, connected_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, connector_id) DO UPDATE SET
      external_account = excluded.external_account,
      access_token = excluded.access_token,
      connected_at = excluded.connected_at`)
    .run(
      accountId,
      connectorId,
      externalAccount || "",
      accessToken || "",
      new Date().toISOString(),
    );
}

export function getConnectorConnection(accountId, connectorId) {
  return (
    database
      .prepare(
        `SELECT external_account, access_token, connected_at
         FROM connector_connections
         WHERE account_id = ? AND connector_id = ?`,
      )
      .get(accountId, connectorId) || null
  );
}

export function getDeveloperBusiness(accountId) {
  return (
    database
      .prepare(
        "SELECT * FROM connector_developer_businesses WHERE account_id = ?",
      )
      .get(accountId) || null
  );
}

export function verifyDeveloperBusiness(accountId, input) {
  const submittedAt = new Date().toISOString();
  database
    .prepare(`INSERT INTO connector_developer_businesses
    (account_id, business_name, website, contact_email, description, status, submitted_at)
    VALUES (?, ?, ?, ?, ?, 'verified', ?)
    ON CONFLICT(account_id) DO UPDATE SET business_name = excluded.business_name,
      website = excluded.website, contact_email = excluded.contact_email,
      description = excluded.description, status = 'verified',
      submitted_at = excluded.submitted_at`)
    .run(
      accountId,
      input.businessName,
      input.website,
      input.contactEmail,
      input.description,
      submittedAt,
    );
  return getDeveloperBusiness(accountId);
}
