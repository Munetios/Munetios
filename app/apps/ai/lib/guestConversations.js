const storageKey = "munetios.ai.guestConversations.v1";
const maximumConversations = 100;

function normalizeMessage(message) {
  const text = String(message?.text || "")
    .trim()
    .slice(0, 12000);
  if (!text) return null;
  return {
    attachments: Array.isArray(message?.attachments)
      ? message.attachments.slice(0, 20)
      : [],
    createdAt: String(message?.createdAt || new Date().toISOString()),
    id: String(message?.id || crypto.randomUUID()),
    role: message?.role === "assistant" ? "assistant" : "user",
    text,
  };
}

function normalizeConversation(conversation) {
  if (!conversation?.id) return null;
  const now = new Date().toISOString();
  return {
    archived: conversation.archived === true,
    archivedAt: conversation.archivedAt || null,
    createdAt: String(conversation.createdAt || now),
    id: String(conversation.id),
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map(normalizeMessage).filter(Boolean).slice(-200)
      : [],
    model: String(conversation.model || "munet-1-instant"),
    pinned: conversation.pinned === true,
    title: String(conversation.title || "New Chat")
      .trim()
      .slice(0, 72),
    type: conversation.type === "voice" ? "voice" : "chat",
    updatedAt: String(conversation.updatedAt || now),
  };
}

function readStore() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed)
      ? parsed.map(normalizeConversation).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function writeStore(conversations) {
  const normalized = conversations
    .map(normalizeConversation)
    .filter(Boolean)
    .sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt)),
    )
    .slice(0, maximumConversations);
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  window.dispatchEvent(new Event("munetios:aiconversationschange"));
  return normalized;
}

export function listGuestConversations({ includeArchived = false } = {}) {
  return readStore().filter(
    (conversation) => includeArchived || !conversation.archived,
  );
}

export function getGuestConversation(id) {
  return readStore().find((conversation) => conversation.id === id) || null;
}

export function saveGuestConversation(value) {
  const conversations = readStore();
  const current = value.id
    ? conversations.find((conversation) => conversation.id === value.id)
    : null;
  const now = new Date().toISOString();
  const conversation = normalizeConversation({
    ...current,
    ...value,
    createdAt: current?.createdAt || value.createdAt || now,
    id: current?.id || value.id || `guest-${crypto.randomUUID()}`,
    updatedAt: now,
  });
  writeStore([
    conversation,
    ...conversations.filter((item) => item.id !== conversation.id),
  ]);
  return conversation;
}

export function updateGuestConversation(id, action, value = {}) {
  const conversations = readStore();
  const current = conversations.find((conversation) => conversation.id === id);
  if (!current) throw new Error("conversation_not_found");
  const now = new Date().toISOString();
  const updated = normalizeConversation({
    ...current,
    ...(action === "pin" ? { pinned: value.pinned !== false } : {}),
    ...(action === "archive" ? { archived: true, archivedAt: now } : {}),
    ...(action === "unarchive" ? { archived: false, archivedAt: null } : {}),
    ...(action === "rename" ? { title: value.title || current.title } : {}),
    updatedAt: now,
  });
  writeStore([
    updated,
    ...conversations.filter((conversation) => conversation.id !== id),
  ]);
  return updated;
}

export function deleteGuestConversation(id) {
  const conversations = readStore();
  const remaining = conversations.filter(
    (conversation) => conversation.id !== id,
  );
  if (remaining.length === conversations.length)
    throw new Error("conversation_not_found");
  writeStore(remaining);
}

export function archiveAllGuestConversations() {
  const now = new Date().toISOString();
  return writeStore(
    readStore().map((conversation) => ({
      ...conversation,
      archived: true,
      archivedAt: now,
      updatedAt: now,
    })),
  );
}

export function deleteAllGuestConversations() {
  writeStore([]);
}
