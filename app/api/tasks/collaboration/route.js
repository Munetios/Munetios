import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountByIdentifier,
  getAccountData,
  getRequestFingerprint,
  setAccountData,
} from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const identityKey = "tasks_collaboration_public_key_v1";
const inboxKey = "tasks_collaboration_inbox_v1";
const notificationsKey = "tasks_notifications_v1";
const demoCollaborationData =
  globalThis.__munetiosTasksDemoCollaborationData || new Map();
globalThis.__munetiosTasksDemoCollaborationData = demoCollaborationData;

function respond(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function validPublicKey(value) {
  return Boolean(
    value &&
      value.kty === "RSA" &&
      value.alg !== "none" &&
      typeof value.e === "string" &&
      typeof value.n === "string" &&
      value.n.length <= 1000,
  );
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
      valid(value.wrappedKey, 1000) &&
      valid(value.ciphertext, 2_000_000),
  );
}

function accountLabel(account) {
  return (
    account?.name || account?.email || account?.username || "Munetios user"
  );
}

function readData(accountId, key, fallback) {
  if (String(accountId).startsWith("demo-")) {
    return demoCollaborationData.get(`${accountId}:${key}`) ?? fallback;
  }
  return getAccountData(accountId, key, fallback);
}

function writeData(accountId, key, value) {
  if (String(accountId).startsWith("demo-")) {
    demoCollaborationData.set(`${accountId}:${key}`, value);
    return value;
  }
  return setAccountData(accountId, key, value);
}

function readInbox(accountId) {
  const value = readData(accountId, inboxKey, []);
  return Array.isArray(value) ? value : [];
}

function readNotifications(accountId) {
  const value = readData(accountId, notificationsKey, []);
  return Array.isArray(value) ? value : [];
}

function getRateLimit(request, accountId) {
  return consumeRateLimit({
    key: `tasks-collaboration:${accountId}:${getRequestFingerprint(request)}`,
    limit: 80,
    windowMs: 60_000,
  });
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const inbox = readInbox(session.user.id);
  const publicKey = readData(session.user.id, identityKey, null);
  return respond({
    notifications: readNotifications(session.user.id),
    owned: inbox
      .filter((item) => item.ownerId === session.user.id && item.ownerEnvelope)
      .map((item) => ({
        createdAt: item.createdAt,
        email: item.recipientEmail,
        envelope: item.ownerEnvelope,
        id: item.id,
        peerPublicKey: item.recipientPublicKey,
        permission: item.permission,
        taskId: item.taskId,
        updatedAt: item.updatedAt,
      })),
    publicKey,
    received: inbox
      .filter((item) => item.recipientId === session.user.id)
      .map((item) => ({
        createdAt: item.createdAt,
        email: item.ownerEmail,
        envelope: item.recipientEnvelope,
        id: item.id,
        ownerName: item.ownerName,
        peerPublicKey: item.ownerPublicKey,
        permission: item.permission,
        taskId: item.taskId,
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
  const rateLimit = getRateLimit(request, session.user.id);
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

  if (payload?.action === "register") {
    if (!validPublicKey(payload.publicKey)) {
      return respond({ error: "invalid_public_key" }, { status: 400 });
    }
    writeData(session.user.id, identityKey, payload.publicKey);
    return respond({ registered: true });
  }

  if (payload?.action === "lookup") {
    const recipient = getAccountByIdentifier(payload.email);
    if (!recipient) {
      return respond({ error: "account_not_found" }, { status: 404 });
    }
    return respond({
      publicKey: readData(recipient.id, identityKey, null),
    });
  }

  if (payload?.action === "dismiss_notification") {
    const notifications = readNotifications(session.user.id).filter(
      (item) => item.id !== payload.notificationId,
    );
    writeData(session.user.id, notificationsKey, notifications);
    return respond({ dismissed: true });
  }

  if (payload?.action === "share") {
    const recipient = getAccountByIdentifier(payload.email);
    if (!recipient) {
      return respond({ error: "account_not_found" }, { status: 404 });
    }
    if (
      recipient.id === session.user.id ||
      !["view", "edit"].includes(payload.permission) ||
      !validEnvelope(payload.envelope) ||
      typeof payload.taskId !== "string"
    ) {
      return respond({ error: "invalid_share" }, { status: 400 });
    }
    const ownerPublicKey = readData(session.user.id, identityKey, null);
    const recipientPublicKey = readData(recipient.id, identityKey, null);
    if (!ownerPublicKey || !recipientPublicKey) {
      return respond(
        { error: "recipient_tasks_key_unavailable" },
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    const record = {
      createdAt: now,
      id: `share-${crypto.randomUUID()}`,
      ownerEmail: session.user.email,
      ownerId: session.user.id,
      ownerName: accountLabel(session.user),
      ownerPublicKey,
      permission: payload.permission,
      recipientEmail: recipient.email,
      recipientEnvelope: payload.envelope,
      recipientId: recipient.id,
      recipientPublicKey,
      taskId: payload.taskId,
      updatedAt: now,
    };
    writeData(recipient.id, inboxKey, [...readInbox(recipient.id), record]);
    writeData(session.user.id, inboxKey, [
      ...readInbox(session.user.id),
      record,
    ]);
    const notification = {
      createdAt: now,
      id: `notification-${crypto.randomUUID()}`,
      message: "task_shared",
      ownerName: record.ownerName,
      shareId: record.id,
    };
    writeData(
      recipient.id,
      notificationsKey,
      [notification, ...readNotifications(recipient.id)].slice(0, 50),
    );
    return respond({ id: record.id, shared: true });
  }

  if (payload?.action === "update") {
    if (
      !validEnvelope(payload.envelope) ||
      typeof payload.shareId !== "string"
    ) {
      return respond({ error: "invalid_update" }, { status: 400 });
    }
    const recipientInbox = readInbox(session.user.id);
    const record = recipientInbox.find(
      (item) =>
        item.id === payload.shareId && item.recipientId === session.user.id,
    );
    if (!record || record.permission !== "edit") {
      return respond({ error: "view_only" }, { status: 403 });
    }
    const now = new Date().toISOString();
    const updated = {
      ...record,
      ownerEnvelope: payload.envelope,
      updatedAt: now,
    };
    writeData(
      session.user.id,
      inboxKey,
      recipientInbox.map((item) => (item.id === record.id ? updated : item)),
    );
    writeData(
      record.ownerId,
      inboxKey,
      readInbox(record.ownerId).map((item) =>
        item.id === record.id ? updated : item,
      ),
    );
    writeData(
      record.ownerId,
      notificationsKey,
      [
        {
          createdAt: now,
          id: `notification-${crypto.randomUUID()}`,
          message: "task_updated",
          ownerName: accountLabel(session.user),
          shareId: record.id,
        },
        ...readNotifications(record.ownerId),
      ].slice(0, 50),
    );
    return respond({ updated: true });
  }

  return respond({ error: "invalid_action" }, { status: 400 });
}
