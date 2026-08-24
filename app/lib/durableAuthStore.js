import { createHash } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";

const databasePrefix = "munetios-scratch/v1";

function hash(value) {
  return createHash("sha256")
    .update(
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .digest("hex");
}

function blobOptions() {
  return {
    access: "private",
    token:
      process.env.MUNETIOS_DATABASE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN,
  };
}

async function readJson(pathname) {
  if (!hasDurableAuthStore()) return null;
  try {
    const result = await get(pathname, blobOptions());
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return await new Response(result.stream).json();
  } catch {
    return null;
  }
}

async function writeJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    ...blobOptions(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  });
}

function accountAliasPath(identifier) {
  return `${databasePrefix}/account-aliases/${hash(identifier)}.json`;
}

function accountRecordPath(accountId) {
  return `${databasePrefix}/accounts/${encodeURIComponent(accountId)}.json`;
}

function sessionPath(token) {
  return `${databasePrefix}/sessions/${hash(token)}.json`;
}

export function hasDurableAuthStore() {
  return Boolean(
    process.env.MUNETIOS_DATABASE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN,
  );
}

export function durableAuthRequired() {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT,
  );
}

export async function durableIdentifierUsed(identifier) {
  return Boolean(await getDurableAccount(identifier));
}

export async function getDurableAccount(identifier) {
  if (!hasDurableAuthStore()) return null;
  const alias = await readJson(accountAliasPath(identifier));
  if (!alias?.accountId) return null;
  return readJson(accountRecordPath(alias.accountId));
}

export async function saveDurableAccount(account) {
  if (!hasDurableAuthStore()) return false;
  const identifiers = [
    account.id,
    account.username,
    account.email,
    account.contact,
  ]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  await writeJson(accountRecordPath(account.id), account);
  await Promise.all(
    identifiers.map((identifier) =>
      writeJson(accountAliasPath(identifier), { accountId: account.id }),
    ),
  );
  return true;
}

export async function saveDurableSession({ account, session, metadata = {} }) {
  if (!hasDurableAuthStore()) return false;
  await writeJson(sessionPath(session.token), {
    accountId: account.id,
    createdAt: new Date().toISOString(),
    expiresAt: session.expiresAt,
    ipAddress: String(metadata.ipAddress || "local").slice(0, 80),
    location: String(metadata.location || "Local device").slice(0, 180),
    tokenHash: hash(session.token),
    userAgent: String(metadata.userAgent || "Unknown device").slice(0, 500),
  });
  return true;
}

export async function getDurableSession(token) {
  if (!hasDurableAuthStore()) return null;
  const session = await readJson(sessionPath(token));
  if (!session?.accountId || Number(session.expiresAt) <= Date.now())
    return null;
  const account = await readJson(accountRecordPath(session.accountId));
  if (!account) return null;
  return { account, session, tokenHash: session.tokenHash };
}

export async function deleteDurableSession(token) {
  if (!hasDurableAuthStore() || !token) return false;
  try {
    await del(sessionPath(token), blobOptions());
    return true;
  } catch {
    return false;
  }
}

export async function listDurableAccounts({ limit = 100 } = {}) {
  if (!hasDurableAuthStore()) return [];
  const result = await list({
    ...blobOptions(),
    limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    prefix: `${databasePrefix}/accounts/`,
  });
  const accounts = await Promise.all(
    result.blobs.map((blob) => readJson(blob.pathname)),
  );
  return accounts.filter(Boolean).map((account) => ({
    contact: account.contact,
    contactType: account.contactType,
    createdAt: account.createdAt,
    email: account.email,
    id: account.id,
    name: account.name,
    plan: account.plan,
    username: account.username,
  }));
}

export async function saveDurableFeedback(report) {
  if (!hasDurableAuthStore()) return false;
  await writeJson(
    `${databasePrefix}/feedback/${encodeURIComponent(report.id)}.json`,
    report,
  );
  return true;
}

export async function listDurableFeedback({ limit = 100 } = {}) {
  if (!hasDurableAuthStore()) return [];
  const result = await list({
    ...blobOptions(),
    limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    prefix: `${databasePrefix}/feedback/`,
  });
  const reports = await Promise.all(
    result.blobs.map((blob) => readJson(blob.pathname)),
  );
  return reports
    .filter(Boolean)
    .sort((first, second) =>
      String(second.createdAt || "").localeCompare(
        String(first.createdAt || ""),
      ),
    );
}
