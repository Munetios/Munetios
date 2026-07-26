import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountData,
  getRequestFingerprint,
  setAccountData,
} from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const vaultKey = "tasks_encrypted_vault_v1";
const legacyCategoriesKey = "tasks_categories";
const demoVaults = globalThis.__munetiosTasksEncryptedVaults || new Map();
globalThis.__munetiosTasksEncryptedVaults = demoVaults;

function respond(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function validBase64Url(value, maximum = 2_000_000) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validVault(value) {
  return Boolean(
    value &&
      value.version === 1 &&
      value.algorithm === "AES-GCM" &&
      validBase64Url(value.keyId, 100) &&
      (value.protection === "device" ||
        (value.derivation === "PBKDF2-SHA-256" &&
          Number.isInteger(value.iterations) &&
          value.iterations >= 600_000 &&
          value.iterations <= 2_000_000 &&
          validBase64Url(value.salt, 100) &&
          validBase64Url(value.wrapIv, 100) &&
          validBase64Url(value.wrappedKey, 500))),
  );
}

function validDocument(value) {
  return Boolean(
    value &&
      value.version === 1 &&
      value.algorithm === "AES-GCM" &&
      validBase64Url(value.keyId, 100) &&
      validBase64Url(value.iv, 100) &&
      validBase64Url(value.ciphertext),
  );
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const stored = session.demo
    ? demoVaults.get(session.sessionKey) || null
    : getAccountData(session.user.id, vaultKey, null);
  const legacyCategories = stored
    ? []
    : getAccountData(session.user.id, legacyCategoriesKey, []);
  return respond({
    document: stored?.document || null,
    legacyCategories: Array.isArray(legacyCategories) ? legacyCategories : [],
    vault: stored?.vault || null,
  });
}

export async function PUT(request) {
  if (!assertSameOrigin(request)) {
    return respond({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const rateLimit = consumeRateLimit({
    key: `tasks-vault:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 40,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return respond(
      { error: "rate_limited" },
      {
        headers: { "Retry-After": String(rateLimit.retryAfter) },
        status: 429,
      },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond({ error: "invalid_json" }, { status: 400 });
  }
  if (
    !validVault(payload?.vault) ||
    !validDocument(payload?.document) ||
    payload.vault.keyId !== payload.document.keyId
  ) {
    return respond({ error: "invalid_encrypted_vault" }, { status: 400 });
  }

  const stored = {
    document: payload.document,
    updatedAt: new Date().toISOString(),
    vault: payload.vault,
  };
  if (session.demo) demoVaults.set(session.sessionKey, stored);
  else {
    setAccountData(session.user.id, vaultKey, stored);
    setAccountData(session.user.id, legacyCategoriesKey, []);
  }
  return respond({ saved: true });
}
