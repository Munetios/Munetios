import { createHash } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";

const databasePrefix = "munetios-scratch/v1";
const realtimeDatabasePath = `${databasePrefix}/system/realtime-v2.sqlite`;

function firstEnvironmentValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function connectedBlobToken() {
  const configured = firstEnvironmentValue(
    "MUNETIOS_DATABASE_TOKEN",
    "MUNETIOS_DATABASE_READ_WRITE_TOKEN",
    "BLOB_READ_WRITE_TOKEN",
  );
  if (configured) return configured;
  const connectedStoreEntry = Object.entries(process.env).find(
    ([key, value]) =>
      ((key.includes("BLOB") && key.endsWith("_READ_WRITE_TOKEN")) ||
        key.endsWith("_DATABASE_READ_WRITE_TOKEN")) &&
      typeof value === "string" &&
      value.trim(),
  );
  if (connectedStoreEntry) return connectedStoreEntry[1].trim();
  return (
    Object.values(process.env).find(
      (value) =>
        typeof value === "string" && value.startsWith("vercel_blob_rw_"),
    ) || ""
  );
}

function connectedBlobStoreId() {
  const configured = firstEnvironmentValue(
    "MUNETIOS_DATABASE_STORE_ID",
    "BLOB_STORE_ID",
  );
  if (configured) return configured;
  const customStoreEntry = Object.entries(process.env).find(
    ([key, value]) =>
      key.endsWith("_BLOB_STORE_ID") &&
      typeof value === "string" &&
      value.trim(),
  );
  return customStoreEntry?.[1]?.trim() || "";
}

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
  const token = connectedBlobToken();
  const storeId = connectedBlobStoreId();
  const oidcToken = firstEnvironmentValue("VERCEL_OIDC_TOKEN");
  return {
    access: "private",
    ...(token ? { token } : {}),
    ...(!token && oidcToken && storeId ? { oidcToken, storeId } : {}),
  };
}

async function readJson(pathname) {
  if (!hasDurableAuthStore()) return null;
  try {
    const result = await get(pathname, {
      ...blobOptions(),
      useCache: false,
    });
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
    connectedBlobToken() ||
      (connectedBlobStoreId() && process.env.VERCEL_OIDC_TOKEN),
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

export async function saveDurableAccountData(accountId, key, value) {
  if (!hasDurableAuthStore() || !accountId || !key) return false;
  await writeJson(
    `${databasePrefix}/account-data/${encodeURIComponent(accountId)}/${hash(key)}.json`,
    { key, value },
  );
  const account = await readJson(accountRecordPath(accountId));
  if (account) {
    account.durableData = { ...(account.durableData || {}), [key]: value };
    if (key === "profile") {
      account.name = value?.name || account.name;
      account.profilePictureUrl = Object.hasOwn(
        value || {},
        "profilePictureUrl",
      )
        ? value.profilePictureUrl
        : account.profilePictureUrl;
    }
    await saveDurableAccount(account);
  }
  return true;
}

export async function getDurableAccountData(accountId, key) {
  if (!hasDurableAuthStore() || !accountId || !key) return null;
  const stored = await readJson(
    `${databasePrefix}/account-data/${encodeURIComponent(accountId)}/${hash(key)}.json`,
  );
  return stored?.key === key ? stored.value : null;
}

export async function saveDurableProfileImage(token, body, contentType) {
  if (!hasDurableAuthStore()) return false;
  await put(
    `${databasePrefix}/profile-images/${encodeURIComponent(token)}`,
    body,
    {
      ...blobOptions(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    },
  );
  return true;
}

export async function getDurableProfileImage(token) {
  if (!hasDurableAuthStore()) return null;
  try {
    const result = await get(
      `${databasePrefix}/profile-images/${encodeURIComponent(token)}`,
      { ...blobOptions(), useCache: false },
    );
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return {
      contentType: result.blob.contentType || "application/octet-stream",
      stream: result.stream,
    };
  } catch {
    return null;
  }
}

export async function deleteDurableProfileImage(token) {
  if (!hasDurableAuthStore() || !token) return false;
  try {
    await del(
      `${databasePrefix}/profile-images/${encodeURIComponent(token)}`,
      blobOptions(),
    );
    return true;
  } catch {
    return false;
  }
}

export async function saveDurableCustomConnector(accountId, connector) {
  if (!hasDurableAuthStore() || !accountId || !connector?.id) return false;
  await writeJson(
    `${databasePrefix}/custom-connectors/${encodeURIComponent(accountId)}/${encodeURIComponent(connector.id)}.json`,
    connector,
  );
  return true;
}

export async function listDurableCustomConnectors(
  accountId,
  { limit = 100 } = {},
) {
  if (!hasDurableAuthStore() || !accountId) return [];
  const result = await list({
    ...blobOptions(),
    limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    prefix: `${databasePrefix}/custom-connectors/${encodeURIComponent(accountId)}/`,
  });
  const connectors = await Promise.all(
    result.blobs.map((blob) => readJson(blob.pathname)),
  );
  return connectors.filter(Boolean);
}

export async function getDurableRealtimeDatabase() {
  if (!hasDurableAuthStore()) return null;
  try {
    const result = await get(realtimeDatabasePath, {
      ...blobOptions(),
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return {
      body: new Uint8Array(await new Response(result.stream).arrayBuffer()),
      etag: result.etag || "",
    };
  } catch {
    return null;
  }
}

export async function saveDurableRealtimeDatabase(body, expectedEtag = "") {
  if (!hasDurableAuthStore()) return false;
  const result = await put(realtimeDatabasePath, body, {
    ...blobOptions(),
    addRandomSuffix: false,
    ...(expectedEtag
      ? { allowOverwrite: true, ifMatch: expectedEtag }
      : { allowOverwrite: false }),
    contentType: "application/vnd.sqlite3",
  });
  return { etag: result.etag || "", saved: true };
}

export function isDurableRealtimeWriteConflict(error) {
  return (
    error?.name === "BlobPreconditionFailedError" ||
    error?.status === 412 ||
    error?.statusCode === 412 ||
    /precondition|already exists|overwrite/iu.test(String(error?.message || ""))
  );
}

export async function saveDurableConnectorIcon(iconId, body, contentType) {
  if (!hasDurableAuthStore()) return false;
  await put(
    `${databasePrefix}/connector-icons/${encodeURIComponent(iconId)}`,
    body,
    {
      ...blobOptions(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    },
  );
  return true;
}

export async function getDurableConnectorIcon(iconId) {
  if (!hasDurableAuthStore()) return null;
  try {
    const result = await get(
      `${databasePrefix}/connector-icons/${encodeURIComponent(iconId)}`,
      { ...blobOptions(), useCache: false },
    );
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return {
      contentType: result.blob.contentType || "application/octet-stream",
      stream: result.stream,
    };
  } catch {
    return null;
  }
}

export async function incrementDurableMetric(metric) {
  if (!hasDurableAuthStore() || !/^[a-z0-9_-]{1,80}$/u.test(metric)) {
    return null;
  }
  const pathname = `${databasePrefix}/metrics/${metric}.json`;
  const current = await readJson(pathname);
  const total = Math.max(0, Number(current?.total) || 0) + 1;
  await writeJson(pathname, { total, updatedAt: new Date().toISOString() });
  return total;
}

export async function countDurableAccounts() {
  if (!hasDurableAuthStore()) return null;
  let cursor;
  let total = 0;
  do {
    const result = await list({
      ...blobOptions(),
      cursor,
      limit: 1000,
      prefix: `${databasePrefix}/accounts/`,
    });
    total += result.blobs.length;
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return total;
}
