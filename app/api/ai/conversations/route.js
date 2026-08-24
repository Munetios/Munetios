import { requireAuth } from "../../../../auth.js";
import { getAccountData, setAccountData } from "../../../lib/authSecurity.js";
import { enforceParentalAiAccess } from "../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

const storageKey = "ai-conversations-v1";
const encryptedConversationPattern =
  /^e2ee1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/u;
const allowedModels = new Set([
  "munet-1-instant",
  "munet-1-mini",
  "munet-1-thinking",
  "munet-1-pro",
  "munet-1-advanced-plus",
  "munet-1-code-advanced-plus",
]);

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function text(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeAttachment(value) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.id, 100);
  const name = text(value.name, 240);
  const url = text(value.url, 600);
  if (!id || !name || !/^\/api\/ai\/files\/[A-Za-z0-9-]+$/u.test(url)) {
    return null;
  }
  return {
    contentType: text(value.contentType, 120),
    id,
    name,
    size: Math.max(0, Math.min(Number(value.size) || 0, 250 * 1024 * 1024)),
    url,
  };
}

function getStore(session) {
  if (session.demo) {
    globalThis.__munetiosAiConversationStore ||= new Map();
    return globalThis.__munetiosAiConversationStore.get(session.user.id) || [];
  }
  const stored = getAccountData(session.user.id, storageKey, []);
  return Array.isArray(stored) ? stored : [];
}

function saveStore(session, conversations) {
  const limited = conversations.slice(0, 100);
  if (session.demo) {
    globalThis.__munetiosAiConversationStore ||= new Map();
    globalThis.__munetiosAiConversationStore.set(session.user.id, limited);
    return;
  }
  setAccountData(session.user.id, storageKey, limited);
}

function pruneExpiredConversations(session, conversations) {
  if (session.demo) return conversations;
  const settings = getAccountData(session.user.id, "ai-settings", {});
  const days = {
    "7-days": 7,
    "30-days": 30,
    "90-days": 90,
    "1-year": 365,
  }[settings?.autoDeleteChatHistory];
  if (!days) return conversations;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const active = conversations.filter(
    (conversation) =>
      !Number.isFinite(Date.parse(conversation.updatedAt)) ||
      Date.parse(conversation.updatedAt) >= cutoff,
  );
  if (active.length !== conversations.length) saveStore(session, active);
  return active;
}

function summary(conversation) {
  return {
    archived: conversation.archived === true,
    createdAt: conversation.createdAt,
    id: conversation.id,
    model: conversation.model,
    pinned: conversation.pinned === true,
    title: conversation.title,
    type: conversation.type === "voice" ? "voice" : "chat",
    updatedAt: conversation.updatedAt,
  };
}

async function authenticated(request, mutating = false) {
  const { response, session } = await requireAuth(request);
  if (response) return { response };
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating,
  });
  if (policyResponse) return { response: policyResponse };
  const parentalResponse = enforceParentalAiAccess(session);
  return parentalResponse ? { response: parentalResponse } : { session };
}

export async function GET(request) {
  const auth = await authenticated(request);
  if (auth.response) return auth.response;
  const conversations = pruneExpiredConversations(
    auth.session,
    getStore(auth.session),
  );
  const conversationId = new URL(request.url).searchParams.get("id");
  if (conversationId) {
    const conversation = conversations.find(({ id }) => id === conversationId);
    return conversation
      ? json({ conversation })
      : json({ error: "conversation_not_found" }, { status: 404 });
  }
  const includeArchived =
    new URL(request.url).searchParams.get("archived") === "1";
  return json({
    conversations: conversations
      .filter((conversation) => includeArchived || !conversation.archived)
      .map(summary),
  });
}

export async function POST(request) {
  const auth = await authenticated(request, true);
  if (auth.response) return auth.response;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_payload" }, { status: 400 });
  }
  const type = payload?.type === "voice" ? "voice" : "chat";
  const encryptedPayload = text(payload?.encryptedPayload, 10_000_000);
  const suppliedMessages = Array.isArray(payload?.messages)
    ? payload.messages
        .map((message) => ({
          attachments: [],
          createdAt: text(message?.createdAt, 40) || new Date().toISOString(),
          id: text(message?.id, 100) || crypto.randomUUID(),
          role: message?.role === "assistant" ? "assistant" : "user",
          text: text(message?.text, 12000),
        }))
        .filter((message) => message.text)
        .slice(-200)
    : [];
  const prompt = text(payload?.prompt, 12000);
  const attachments = Array.isArray(payload?.attachments)
    ? payload.attachments.map(normalizeAttachment).filter(Boolean).slice(0, 20)
    : [];
  if (
    !prompt &&
    attachments.length === 0 &&
    suppliedMessages.length === 0 &&
    !encryptedConversationPattern.test(encryptedPayload)
  ) {
    return json({ error: "empty_conversation" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const conversation = {
    createdAt: now,
    id: crypto.randomUUID(),
    ...(encryptedConversationPattern.test(encryptedPayload)
      ? { encryptedPayload }
      : {}),
    messages: suppliedMessages.length
      ? suppliedMessages
      : [
          {
            attachments,
            createdAt: now,
            id: crypto.randomUUID(),
            role: "user",
            text: prompt,
          },
        ],
    model: allowedModels.has(payload?.model)
      ? payload.model
      : "munet-1-instant",
    pinned: false,
    title:
      text(payload?.title, 72) ||
      prompt.slice(0, 72) ||
      suppliedMessages[0]?.text.slice(0, 72) ||
      attachments[0]?.name ||
      (type === "voice" ? "Voice Mode" : "New Chat"),
    type,
    updatedAt: now,
  };
  saveStore(auth.session, [conversation, ...getStore(auth.session)]);
  return json({ conversation, created: true }, { status: 201 });
}

export async function PATCH(request) {
  const auth = await authenticated(request, true);
  if (auth.response) return auth.response;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_payload" }, { status: 400 });
  }
  if (payload?.action === "archive-all") {
    const archivedAt = new Date().toISOString();
    const conversations = getStore(auth.session).map((conversation) => ({
      ...conversation,
      archived: true,
      archivedAt,
    }));
    saveStore(auth.session, conversations);
    return json({ archived: conversations.length });
  }
  const conversationId = text(payload?.id, 100);
  const prompt = text(payload?.prompt, 12000);
  if (!conversationId) {
    return json({ error: "invalid_message" }, { status: 400 });
  }
  const conversations = getStore(auth.session);
  const index = conversations.findIndex(({ id }) => id === conversationId);
  if (index < 0) {
    return json({ error: "conversation_not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  const current = conversations[index];
  if (payload.action === "save-encrypted") {
    const encryptedPayload = text(payload.encryptedPayload, 10_000_000);
    if (!encryptedConversationPattern.test(encryptedPayload)) {
      return json({ error: "invalid_encrypted_conversation" }, { status: 400 });
    }
    const updated = {
      ...current,
      encryptedPayload,
      title: text(payload.title, 72) || current.title,
      type: "voice",
      updatedAt: now,
    };
    saveStore(auth.session, [
      updated,
      ...conversations.filter(({ id }) => id !== conversationId),
    ]);
    return json({ conversation: updated, saved: true });
  }
  if (
    payload.action === "pin" ||
    payload.action === "archive" ||
    payload.action === "unarchive" ||
    payload.action === "rename"
  ) {
    const updated = {
      ...current,
      ...(payload.action === "pin" ? { pinned: payload.pinned !== false } : {}),
      ...(payload.action === "archive"
        ? { archived: true, archivedAt: now }
        : {}),
      ...(payload.action === "unarchive"
        ? { archived: false, archivedAt: null }
        : {}),
      ...(payload.action === "rename"
        ? { title: text(payload.title, 72) || current.title }
        : {}),
      updatedAt: now,
    };
    saveStore(auth.session, [
      updated,
      ...conversations.filter(({ id }) => id !== conversationId),
    ]);
    return json({ conversation: updated, saved: true });
  }
  if (!prompt) return json({ error: "invalid_message" }, { status: 400 });
  const updated = {
    ...current,
    messages: [
      ...(Array.isArray(current.messages) ? current.messages : []),
      {
        attachments: [],
        createdAt: now,
        id: crypto.randomUUID(),
        role: "user",
        text: prompt,
      },
    ].slice(-200),
    updatedAt: now,
  };
  saveStore(auth.session, [
    updated,
    ...conversations.filter(({ id }) => id !== conversationId),
  ]);
  return json({ conversation: updated, saved: true });
}

export async function DELETE(request) {
  const auth = await authenticated(request, true);
  if (auth.response) return auth.response;
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    // A missing body is treated as an invalid delete request below.
  }
  if (payload.action === "delete-one") {
    const id = text(payload.id, 100);
    const conversations = getStore(auth.session);
    const remaining = conversations.filter(
      (conversation) => conversation.id !== id,
    );
    if (remaining.length === conversations.length) {
      return json({ error: "conversation_not_found" }, { status: 404 });
    }
    saveStore(auth.session, remaining);
    return json({ deleted: 1 });
  }
  if (payload.action !== "delete-all") {
    return json({ error: "invalid_action" }, { status: 400 });
  }
  const deleted = getStore(auth.session).length;
  saveStore(auth.session, []);
  return json({ deleted });
}
