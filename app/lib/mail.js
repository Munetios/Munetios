import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  getAccountByIdentifier,
  getAccountData,
  setAccountData,
} from "./authSecurity.js";

const mailboxKey = "mail-mailbox-v1";
const settingsKey = "mail-settings-v1";
const publicKeyKey = "mail-zero-knowledge-public-key-v1";
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;
const allowedFonts = new Set([
  "account-default",
  "Arial",
  "Courier New",
  "Georgia",
  "Google Sans Flex",
  "Verdana",
]);
const dangerousTags =
  /<\/?(?:script|iframe|object|embed|form|input|button|textarea|select|meta|base|link|svg|math)[^>]*>/giu;

function encryptionKey(accountId) {
  const secret =
    process.env.MUNETIOS_MAIL_ENCRYPTION_KEY ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "munetios-development-mail-key";
  return createHash("sha256").update(`${secret}:mail:${accountId}`).digest();
}

function encrypt(accountId, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(accountId), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

function decrypt(accountId, envelope) {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(accountId),
      Buffer.from(envelope.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    return null;
  }
}

function text(value, maximum = 200) {
  return String(value || "")
    .trim()
    .slice(0, maximum);
}

export function normalizeMailAddress(value) {
  const address = text(value, 320).toLowerCase();
  return emailPattern.test(address) ? address : "";
}

export function getMailPublicKey(accountId) {
  const key = getAccountData(accountId, publicKeyKey, null);
  return key?.kty === "RSA" &&
    typeof key.n === "string" &&
    typeof key.e === "string"
    ? key
    : null;
}

export function setMailPublicKey(accountId, key) {
  if (
    key?.kty !== "RSA" ||
    typeof key.n !== "string" ||
    typeof key.e !== "string" ||
    key.n.length < 300 ||
    key.n.length > 1000
  ) {
    return null;
  }
  const normalized = {
    alg: "RSA-OAEP-256",
    e: key.e,
    ext: true,
    key_ops: ["encrypt"],
    kty: "RSA",
    n: key.n,
  };
  setAccountData(accountId, publicKeyKey, normalized);
  return normalized;
}

export function sanitizeMailHtml(value) {
  return String(value || "")
    .slice(0, 250_000)
    .replace(dangerousTags, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
    .replace(
      /\s+(?:src|href)\s*=\s*(["'])\s*(?:javascript|vbscript):[^"']*\1/giu,
      "",
    )
    .replace(
      /\s+style\s*=\s*(["'])[^"']*(?:expression\s*\(|url\s*\(\s*['"]?javascript:)[^"']*\1/giu,
      "",
    )
    .replace(/<!--([\s\S]*?)-->/gu, "");
}

export function mailPlainText(html) {
  return sanitizeMailHtml(html)
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

export function scoreMailSpam({ from, html, subject, text: plainText }) {
  const body = `${subject || ""} ${plainText || mailPlainText(html)}`;
  const normalized = body.toLowerCase();
  let score = 0;
  const reasons = [];
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  if (
    /\b(?:free money|act now|urgent payment|wire transfer|crypto giveaway|claim prize|guaranteed income|password expires)\b/iu.test(
      normalized,
    )
  )
    add(3, "high-risk wording");
  if (
    /\b(?:verify your account|confirm immediately|limited time|winner|lottery|gift card)\b/iu.test(
      normalized,
    )
  )
    add(2, "phishing wording");
  const urls = body.match(/https?:\/\/[^\s<]+/giu) || [];
  if (urls.length > 4) add(2, "many links");
  if (
    urls.some((url) =>
      /(?:\.zip|\.mov|\.click|\.top|\.xyz)(?:\/|$)/iu.test(url),
    )
  )
    add(3, "risky link domain");
  if (/\b(?:bit\.ly|tinyurl\.com|t\.co)\b/iu.test(normalized))
    add(2, "shortened link");
  if ((body.match(/[A-Z]/gu) || []).length > Math.max(20, body.length * 0.55))
    add(2, "excessive capitals");
  if ((body.match(/!/gu) || []).length > 5) add(1, "excessive punctuation");
  if (!normalizeMailAddress(from)) add(5, "invalid sender");
  if (/<img\b[^>]*\bwidth=["']?1\b/iu.test(html || ""))
    add(3, "tracking pixel");
  return { reasons: [...new Set(reasons)], score };
}

function storedMailbox(accountId) {
  const stored = getAccountData(accountId, mailboxKey, null);
  if (stored?.version === 1 && Array.isArray(stored.messages)) return stored;
  const now = new Date().toISOString();
  const welcome = {
    createdAt: now,
    favorite: false,
    folder: "inbox",
    from: "welcome@munetios.com",
    html: "<p>Welcome to <strong>Munetios Mail</strong>.</p><p>This Beta includes encrypted Munetios mailboxes, sending, replies, search, spam protection, accounts, and settings.</p>",
    id: `mail-${crypto.randomUUID()}`,
    read: false,
    security: { encrypted: true, spamReasons: [], spamScore: 0 },
    subject: "Welcome to Munetios Mail",
    text: "Welcome to Munetios Mail. This Beta includes encrypted Munetios mailboxes, sending, replies, search, spam protection, accounts, and settings.",
    threadId: `thread-${crypto.randomUUID()}`,
    to: "",
    updatedAt: now,
  };
  const mailbox = { messages: [encrypt(accountId, welcome)], version: 1 };
  setAccountData(accountId, mailboxKey, mailbox);
  return mailbox;
}

function readMessages(accountId) {
  return storedMailbox(accountId)
    .messages.map((envelope) => decrypt(accountId, envelope))
    .filter(Boolean);
}

function saveMessages(accountId, messages) {
  setAccountData(accountId, mailboxKey, {
    messages: messages
      .slice(-2000)
      .map((message) => encrypt(accountId, message)),
    version: 1,
  });
}

export function getMailSettings(accountId, primaryEmail = "") {
  const stored = getAccountData(accountId, settingsKey, {});
  return {
    font: allowedFonts.has(stored.font) ? stored.font : "account-default",
    folders: Array.isArray(stored.folders)
      ? stored.folders
          .filter((folder) => folder?.id?.startsWith("folder-") && folder.name)
          .slice(0, 30)
      : [],
    labels: Array.isArray(stored.labels)
      ? stored.labels
          .filter((label) => label?.id?.startsWith("label-") && label.name)
          .slice(0, 50)
      : [],
    notificationEmails: Array.isArray(stored.notificationEmails)
      ? stored.notificationEmails
          .map(normalizeMailAddress)
          .filter(Boolean)
          .slice(0, 5)
      : [],
    primaryEmail: normalizeMailAddress(primaryEmail),
    theme: ["system", "dark", "light"].includes(stored.theme)
      ? stored.theme
      : "system",
  };
}

export function updateMailSettings(accountId, primaryEmail, patch) {
  const current = getMailSettings(accountId, primaryEmail);
  const next = {
    ...current,
    ...(Object.hasOwn(patch, "font")
      ? {
          font: allowedFonts.has(patch.font) ? patch.font : "account-default",
        }
      : {}),
    ...(Object.hasOwn(patch, "folders") && Array.isArray(patch.folders)
      ? {
          folders: patch.folders
            .map((folder) => ({
              color: /^#[\da-f]{6}$/iu.test(folder?.color)
                ? folder.color.toLowerCase()
                : "#a855f7",
              id: String(
                folder?.id || `folder-${crypto.randomUUID()}`,
              ).startsWith("folder-")
                ? String(folder?.id || `folder-${crypto.randomUUID()}`).slice(
                    0,
                    100,
                  )
                : `folder-${crypto.randomUUID()}`,
              name: text(folder?.name, 60),
            }))
            .filter((folder) => folder.name)
            .slice(0, 30),
        }
      : {}),
    ...(Object.hasOwn(patch, "labels") && Array.isArray(patch.labels)
      ? {
          labels: patch.labels
            .map((label) => ({
              color: /^#[\da-f]{6}$/iu.test(label?.color)
                ? label.color.toLowerCase()
                : "#c084fc",
              id: String(
                label?.id || `label-${crypto.randomUUID()}`,
              ).startsWith("label-")
                ? String(label?.id || `label-${crypto.randomUUID()}`).slice(
                    0,
                    100,
                  )
                : `label-${crypto.randomUUID()}`,
              name: text(label?.name, 60),
            }))
            .filter((label) => label.name)
            .slice(0, 50),
        }
      : {}),
    ...(Object.hasOwn(patch, "notificationEmails")
      ? {
          notificationEmails: Array.isArray(patch.notificationEmails)
            ? [
                ...new Set(
                  patch.notificationEmails
                    .map(normalizeMailAddress)
                    .filter(Boolean),
                ),
              ].slice(0, 5)
            : current.notificationEmails,
        }
      : {}),
    ...(Object.hasOwn(patch, "theme") &&
    ["system", "dark", "light"].includes(patch.theme)
      ? { theme: patch.theme }
      : {}),
  };
  setAccountData(accountId, settingsKey, next);
  return next;
}

export function listMail(accountId, { folder = "inbox", query = "" } = {}) {
  const needle = text(query, 200).toLowerCase();
  return readMessages(accountId)
    .filter((message) =>
      folder === "favorites"
        ? message.favorite
        : folder.startsWith("label:")
          ? message.labels?.includes(folder.slice(6))
          : message.folder === folder,
    )
    .filter((message) =>
      needle
        ? [message.from, message.to, message.subject, message.text]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        : true,
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getMailMessage(accountId, messageId) {
  return (
    readMessages(accountId).find((message) => message.id === messageId) || null
  );
}

export function createDraft(accountId, data) {
  return storeMessage(accountId, { ...data, folder: "drafts", read: true });
}

export function storeMessage(accountId, data) {
  const messages = readMessages(accountId);
  const now = new Date().toISOString();
  const zeroKnowledgeEnvelope =
    data.zeroKnowledgeEnvelope?.version === 1 &&
    typeof data.zeroKnowledgeEnvelope.ciphertext === "string" &&
    typeof data.zeroKnowledgeEnvelope.iv === "string" &&
    typeof data.zeroKnowledgeEnvelope.wrappedKey === "string"
      ? {
          ciphertext: data.zeroKnowledgeEnvelope.ciphertext.slice(0, 400_000),
          iv: data.zeroKnowledgeEnvelope.iv.slice(0, 40),
          version: 1,
          wrappedKey: data.zeroKnowledgeEnvelope.wrappedKey.slice(0, 1000),
        }
      : null;
  const html = zeroKnowledgeEnvelope ? "" : sanitizeMailHtml(data.html);
  const plainText = mailPlainText(html) || text(data.text, 250_000);
  const spam = zeroKnowledgeEnvelope
    ? { reasons: [], score: 0 }
    : scoreMailSpam({
        from: data.from,
        html,
        subject: data.subject,
        text: plainText,
      });
  const message = {
    createdAt: data.createdAt || now,
    favorite: Boolean(data.favorite),
    folder: data.folder || (spam.score >= 5 ? "spam" : "inbox"),
    from: normalizeMailAddress(data.from),
    html,
    id: data.id || `mail-${crypto.randomUUID()}`,
    labels: Array.isArray(data.labels)
      ? data.labels
          .filter((label) => String(label).startsWith("label-"))
          .slice(0, 20)
      : [],
    read: Boolean(data.read),
    replyToId: text(data.replyToId, 100),
    security: {
      encrypted: true,
      spamReasons: spam.reasons,
      spamScore: spam.score,
    },
    subject: zeroKnowledgeEnvelope
      ? "Encrypted message"
      : text(data.subject, 300) || "(No subject)",
    text: plainText,
    threadId: text(data.threadId, 100) || `thread-${crypto.randomUUID()}`,
    to: normalizeMailAddress(data.to),
    updatedAt: now,
    zeroKnowledgeEnvelope,
  };
  saveMessages(accountId, [
    ...messages.filter((item) => item.id !== message.id),
    message,
  ]);
  return message;
}

export function updateMailMessage(accountId, messageId, patch) {
  const messages = readMessages(accountId);
  let updated = null;
  const next = messages.map((message) => {
    if (message.id !== messageId) return message;
    updated = {
      ...message,
      ...(Object.hasOwn(patch, "favorite")
        ? { favorite: Boolean(patch.favorite) }
        : {}),
      ...(Object.hasOwn(patch, "read") ? { read: Boolean(patch.read) } : {}),
      ...(["inbox", "spam", "trash"].includes(patch.folder) ||
      String(patch.folder || "").startsWith("folder-")
        ? { folder: patch.folder }
        : {}),
      ...(Object.hasOwn(patch, "labels") && Array.isArray(patch.labels)
        ? {
            labels: patch.labels
              .filter((label) => String(label).startsWith("label-"))
              .slice(0, 20),
          }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    return updated;
  });
  if (!updated) return null;
  saveMessages(accountId, next);
  return updated;
}

export function deleteMailMessage(accountId, messageId) {
  const messages = readMessages(accountId);
  const next = messages.filter((message) => message.id !== messageId);
  if (next.length === messages.length) return false;
  saveMessages(accountId, next);
  return true;
}

export function resolveMunetiosRecipient(email) {
  return getAccountByIdentifier(normalizeMailAddress(email));
}

export function mailAsEml(message) {
  return [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date(message.createdAt).toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    message.html || message.text,
  ].join("\r\n");
}
