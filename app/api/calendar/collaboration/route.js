import { generateKeyPairSync } from "node:crypto";
import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountByIdentifier,
  getAccountData,
  getRequestFingerprint,
  setAccountData,
} from "../../../lib/authSecurity.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";
import { hasSensitiveGrant } from "../../../lib/twoFactorSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const identityKey = "calendar_collaboration_public_key_v1";
const inboxKey = "calendar_collaboration_inbox_v1";
const demoData = globalThis.__munetiosCalendarCollaborationData || new Map();
globalThis.__munetiosCalendarCollaborationData = demoData;

function respond(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function readData(accountId, key, fallback) {
  return String(accountId).startsWith("demo-")
    ? (demoData.get(`${accountId}:${key}`) ?? fallback)
    : getAccountData(accountId, key, fallback);
}

function writeData(accountId, key, value) {
  if (String(accountId).startsWith("demo-")) {
    demoData.set(`${accountId}:${key}`, value);
    return value;
  }
  return setAccountData(accountId, key, value);
}

function readInbox(accountId) {
  const value = readData(accountId, inboxKey, []);
  return Array.isArray(value) ? value : [];
}

function validPublicKey(value) {
  return Boolean(
    value &&
      value.kty === "RSA" &&
      value.alg !== "none" &&
      typeof value.e === "string" &&
      typeof value.n === "string" &&
      value.n.length <= 1_000,
  );
}

function readIdentity(accountId) {
  const stored = readData(accountId, identityKey, null);
  if (validPublicKey(stored)) {
    return { privateKey: null, publicKey: stored };
  }
  if (validPublicKey(stored?.publicKey)) {
    return {
      privateKey:
        stored.privateKey && typeof stored.privateKey === "object"
          ? stored.privateKey
          : null,
      publicKey: stored.publicKey,
    };
  }
  return null;
}

function ensureIdentity(accountId) {
  const existing = readIdentity(accountId);
  if (existing) return existing;
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const identity = {
    privateKey: pair.privateKey.export({ format: "jwk" }),
    publicKey: pair.publicKey.export({ format: "jwk" }),
  };
  writeData(accountId, identityKey, identity);
  return identity;
}

function validEnvelope(value) {
  const valid = (part, maximum) =>
    typeof part === "string" &&
    part.length > 0 &&
    part.length <= maximum &&
    /^[A-Za-z0-9_-]+$/.test(part);
  return Boolean(
    value?.version === 1 &&
      valid(value.iv, 100) &&
      valid(value.wrappedKey, 1_000) &&
      valid(value.ciphertext, 2_000_000),
  );
}

function rateLimit(request, accountId) {
  return consumeRateLimit({
    key: `calendar-collaboration:${accountId}:${getRequestFingerprint(request)}`,
    limit: 60,
    windowMs: 60_000,
  });
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "calendar");
  if (policyResponse) return policyResponse;
  const identity = readIdentity(session.user.id);
  return respond({
    privateKey: identity?.privateKey || null,
    publicKey: identity?.publicKey || null,
    received: readInbox(session.user.id)
      .filter((item) => item.recipientId === session.user.id)
      .map((item) => ({
        createdAt: item.createdAt,
        envelope: item.envelope,
        id: item.id,
        itemId: item.itemId,
        itemType: item.itemType,
        ownerName: item.ownerName,
        status: item.status || "pending",
        updatedAt: item.updatedAt,
      })),
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return respond({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "calendar", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const limit = rateLimit(request, session.user.id);
  if (!limit.allowed) {
    return respond(
      { error: "rate_limited" },
      { headers: { "Retry-After": String(limit.retryAfter) }, status: 429 },
    );
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond({ error: "invalid_json" }, { status: 400 });
  }

  if (payload?.action === "register") {
    if (!validPublicKey(payload.publicKey)) {
      return respond({ error: "invalid_public_key" }, { status: 400 });
    }
    const existing = readIdentity(session.user.id);
    writeData(session.user.id, identityKey, {
      privateKey: existing?.privateKey || null,
      publicKey: existing?.privateKey ? existing.publicKey : payload.publicKey,
    });
    return respond({ registered: true });
  }

  if (payload?.action === "lookup") {
    const recipient = getAccountByIdentifier(payload.email);
    if (!recipient) {
      return respond({ error: "account_not_found" }, { status: 404 });
    }
    return respond({ publicKey: ensureIdentity(recipient.id).publicKey });
  }

  if (payload?.action === "remove") {
    const ids = Array.isArray(payload.shareIds)
      ? payload.shareIds.filter((id) => typeof id === "string").slice(0, 200)
      : [];
    const nextInbox = readInbox(session.user.id).filter(
      (item) => !ids.includes(item.id) || item.recipientId !== session.user.id,
    );
    writeData(session.user.id, inboxKey, nextInbox);
    return respond({ removed: true });
  }

  if (["accept", "decline"].includes(payload?.action)) {
    const shareId =
      typeof payload.shareId === "string" ? payload.shareId.slice(0, 160) : "";
    const inbox = readInbox(session.user.id);
    const invitation = inbox.find(
      (item) => item.id === shareId && item.recipientId === session.user.id,
    );
    if (!invitation) {
      return respond({ error: "share_invitation_not_found" }, { status: 404 });
    }
    if (payload.action === "decline") {
      writeData(
        session.user.id,
        inboxKey,
        inbox.filter((item) => item.id !== shareId),
      );
      return respond({ declined: true, id: shareId });
    }
    const acceptedAt = new Date().toISOString();
    writeData(
      session.user.id,
      inboxKey,
      inbox.map((item) =>
        item.id === shareId
          ? { ...item, acceptedAt, status: "accepted", updatedAt: acceptedAt }
          : item,
      ),
    );
    return respond({ accepted: true, id: shareId });
  }

  if (payload?.action === "share") {
    const security = getAccountData(session.user.id, "security", {});
    if (security.lockdownMode && !hasSensitiveGrant(request, session.user.id)) {
      return respond(
        { error: "sensitive_verification_required" },
        { status: 403 },
      );
    }
    const recipient = getAccountByIdentifier(payload.email);
    if (!recipient) {
      return respond({ error: "account_not_found" }, { status: 404 });
    }
    if (
      recipient.id === session.user.id ||
      !["event", "calendar"].includes(payload.itemType) ||
      typeof payload.itemId !== "string" ||
      !validEnvelope(payload.envelope)
    ) {
      return respond({ error: "invalid_share" }, { status: 400 });
    }
    ensureIdentity(recipient.id);
    const now = new Date().toISOString();
    const recipientInbox = readInbox(recipient.id);
    const sharesFromOwner = recipientInbox.filter(
      (item) =>
        item.ownerId === session.user.id && item.recipientId === recipient.id,
    );
    const pendingFromOwner = sharesFromOwner.filter(
      (item) => (item.status || "pending") === "pending",
    );
    const existingShare = sharesFromOwner.find(
      (item) =>
        item.itemId === payload.itemId.slice(0, 120) &&
        item.itemType === payload.itemType,
    );
    const allPending = recipientInbox.filter(
      (item) => (item.status || "pending") === "pending",
    );
    if (!existingShare && allPending.length >= 100) {
      return respond({ error: "share_inbox_full" }, { status: 429 });
    }
    if (!existingShare && pendingFromOwner.length >= 20) {
      return respond(
        { error: "too_many_pending_share_invites" },
        { status: 429 },
      );
    }
    const record = {
      createdAt: now,
      envelope: payload.envelope,
      id: existingShare?.id || `calendar-share-${crypto.randomUUID()}`,
      itemId: payload.itemId.slice(0, 120),
      itemType: payload.itemType,
      ownerId: session.user.id,
      ownerName:
        session.user.name || session.user.email || session.user.username,
      recipientId: recipient.id,
      status: existingShare?.status || "pending",
      updatedAt: now,
    };
    if (existingShare?.acceptedAt) record.acceptedAt = existingShare.acceptedAt;
    if (existingShare) {
      record.createdAt = existingShare.createdAt;
      writeData(
        recipient.id,
        inboxKey,
        recipientInbox.map((item) =>
          item.id === existingShare.id ? record : item,
        ),
      );
    } else {
      writeData(recipient.id, inboxKey, [...recipientInbox, record]);
    }
    return respond({ id: record.id, invitationSent: true });
  }

  return respond({ error: "invalid_action" }, { status: 400 });
}
