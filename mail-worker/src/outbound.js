// Uploads, drafts, sending through Cloudflare Email Service, the delivery queue, and delivery events.
// Delivery status always reflects what Email Service reported; nothing is marked sent without its result.
import { reserve, release, storeBlob, readBlobBytes, readBlobJson, dropRefStatements, addRefStatement } from "./storage.js";
import { senderAddresses, changeStatement, scheduleNotify, notify, mailboxSettings, ftsStatements, resolveThread, threadStatements } from "./mailbox.js";
import { ownedMessages, messageEml, messageBody, parseRaw } from "./messages.js";
import { sanitizeEmailHtml } from "./sanitize.js";
import { fail, id, now, normalizeEmail, validEmail, isInternal, cleanHeaderText, addressList, snippetOf, htmlToText, readBytes, parseJson, sha256Hex, MAX_MESSAGE_BYTES, MAX_RECIPIENTS, MAX_ATTACHMENTS, opsLog, utf8 } from "./util.js";

const MAX_UPLOAD = MAX_MESSAGE_BYTES;
const MAX_HTML = 5 * 1024 * 1024;
const MODES = new Set(["rich", "html", "split", "designer", "plain"]);
const PERMANENT = new Set(["E_VALIDATION_ERROR", "E_FIELD_MISSING", "E_TOO_MANY_RECIPIENTS", "E_TOO_MANY_ATTACHMENTS", "E_CONTENT_TOO_LARGE", "E_SENDER_NOT_VERIFIED",
    "E_SENDER_DOMAIN_NOT_AVAILABLE", "E_SENDER_DOMAIN_NOT_CONFIGURED", "E_RECIPIENT_NOT_ALLOWED", "E_RECIPIENT_PLAN_RESTRICTED", "E_RECIPIENT_SUPPRESSED", "E_ACCOUNT_SUSPENDED",
    "E_HEADER_NOT_ALLOWED", "E_HEADER_USE_API_FIELD", "E_HEADER_VALUE_INVALID", "E_HEADER_VALUE_TOO_LONG", "E_HEADER_NAME_INVALID", "E_HEADERS_TOO_LARGE", "E_HEADERS_TOO_MANY"]);
const MAX_ATTEMPTS = 8;
const marks = list => list.map(() => "?").join(",");

/* ------------------------------------------------------------------ rate limits */
// Per-account limits come from Worker variables (MAIL_SENDS_PER_HOUR, MAIL_RECIPIENTS_PER_DAY, MAIL_UPLOADS_PER_HOUR).
export function limitSetting(env, name, fallback) {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function rateLimit(env, key, limit, windowSeconds, amount = 1) {
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const row = await env.MAIL_DB.prepare("INSERT INTO rate_counters (key, window, count) VALUES (?, ?, ?) ON CONFLICT (key, window) DO UPDATE SET count = count + excluded.count RETURNING count")
        .bind(key, window, amount).first();
    if (row.count > limit) fail(429, "tooManyRequests", { retryAfter: windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds) });
}

/* ------------------------------------------------------------------ uploads */
export async function createUpload(env, mailbox, request) {
    const declared = Number(request.headers.get("Content-Length"));
    if (!Number.isFinite(declared) || declared <= 0) fail(411, "lengthRequired");
    if (declared > MAX_UPLOAD) fail(413, "tooLarge");
    let filename = "attachment";
    try { filename = cleanHeaderText(decodeURIComponent(request.headers.get("X-File-Name") || "attachment"), 255) || "attachment"; } catch { /* keep default */ }
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(request.headers.get("X-File-Type") || "") ? request.headers.get("X-File-Type").toLowerCase() : "application/octet-stream";
    const source = ["device", "photos", "clipboard", "inline", "message"].includes(request.headers.get("X-Upload-Source")) ? request.headers.get("X-Upload-Source") : "device";
    await rateLimit(env, "upload:" + mailbox.account_id, limitSetting(env, "MAIL_UPLOADS_PER_HOUR", 600), 3600);
    const reservation = await reserve(env, mailbox.id, declared, "upload");
    try {
        const bytes = await readBytes(request, declared);
        return await saveUpload(env, mailbox, bytes, { filename, mimeType, source, reservation });
    } finally {
        await release(env, reservation).catch(() => {});
    }
}

export async function saveUpload(env, mailbox, bytes, { filename, mimeType, source, reservation = null }) {
    const uploadId = id("u_");
    const hash = await sha256Hex(bytes);
    const statements = [env.MAIL_DB.prepare("INSERT INTO uploads (id, mailbox_id, blob_hash, filename, mime_type, size, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(uploadId, mailbox.id, hash, filename, mimeType, bytes.byteLength, source, now())];
    await storeBlob(env, mailbox.id, bytes, { reservation, contentType: mimeType, extraStatements: [...statements, changeStatement(env.MAIL_DB, mailbox.id, "storage", mailbox.id, "upsert")] });
    return { id: uploadId, filename, mimeType, size: bytes.byteLength, source };
}

export async function deleteUpload(env, mailbox, uploadId) {
    const row = await env.MAIL_DB.prepare("SELECT blob_hash FROM uploads WHERE id = ? AND mailbox_id = ?").bind(uploadId, mailbox.id).first();
    if (!row) fail(404, "notFound");
    await env.MAIL_DB.batch([env.MAIL_DB.prepare("DELETE FROM uploads WHERE id = ?").bind(uploadId), ...dropRefStatements(env.MAIL_DB, mailbox.id, [row.blob_hash])]);
}

// Copies an existing attachment (for forwarding) into an upload for the given mailbox.
export async function uploadFromAttachment(env, session, mailbox, attachmentId) {
    const { attachmentContent } = await import("./messages.js");
    const content = await attachmentContent(env, session, attachmentId);
    if (content.row.mailbox_id === mailbox.id && content.attachment.blob_hash) {
        const uploadId = id("u_");
        await env.MAIL_DB.batch([
            env.MAIL_DB.prepare("INSERT INTO uploads (id, mailbox_id, blob_hash, filename, mime_type, size, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'message', ?)")
                .bind(uploadId, mailbox.id, content.attachment.blob_hash, content.filename, content.mimeType, content.bytes.byteLength, now()),
            addRefStatement(env.MAIL_DB, mailbox.id, content.attachment.blob_hash),
        ]);
        return { id: uploadId, filename: content.filename, mimeType: content.mimeType, size: content.bytes.byteLength, source: "message" };
    }
    return saveUpload(env, mailbox, content.bytes, { filename: content.filename, mimeType: content.mimeType, source: "message" });
}

// Forward as attachment: the message's MIME becomes a message/rfc822 upload.
export async function uploadFromMessage(env, session, mailbox, messageId) {
    const [row] = await ownedMessages(env, session, [messageId]);
    const bytes = await messageEml(env, session, messageId, row);
    const name = (cleanHeaderText(row.subject, 120) || "message").replace(/[\\/:*?"<>|]+/g, "_") + ".eml";
    return saveUpload(env, mailbox, bytes, { filename: name, mimeType: "message/rfc822", source: "message" });
}

/* ------------------------------------------------------------------ drafts */
function normalizeDraft(input) {
    const html = typeof input?.html === "string" ? input.html : "";
    const sourceHtml = typeof input?.source?.html === "string" ? input.source.html : "";
    const design = input?.source?.design && typeof input.source.design === "object" ? input.source.design : null;
    if (utf8(html).length > MAX_HTML || utf8(sourceHtml).length > MAX_HTML) fail(413, "tooLarge");
    const designJson = design ? JSON.stringify(design) : "";
    if (designJson.length > 2 * 1024 * 1024) fail(413, "tooLarge");
    return {
        from: normalizeEmail(input?.from), to: addressList(input?.to), cc: addressList(input?.cc), bcc: addressList(input?.bcc),
        subject: cleanHeaderText(input?.subject, 998), mode: MODES.has(input?.mode) ? input.mode : "rich", html,
        text: typeof input?.text === "string" ? input.text.slice(0, MAX_HTML) : "",
        source: { html: sourceHtml, design: design ? JSON.parse(designJson) : null },
        priority: ["low", "normal", "high"].includes(input?.priority) ? input.priority : "normal",
        replyToMessageId: /^m_[a-z0-9]{15}$/.test(input?.replyToMessageId || "") ? input.replyToMessageId : null,
        replyMode: ["reply", "replyAll", "forward"].includes(input?.replyMode) ? input.replyMode : null,
        signatureId: typeof input?.signatureId === "string" ? input.signatureId.slice(0, 40) : null,
        attachments: (Array.isArray(input?.attachments) ? input.attachments : []).slice(0, 200).map(item => ({
            kind: item?.kind === "attachment" ? "attachment" : "upload", id: String(item?.id || ""), inline: Boolean(item?.inline),
            contentId: typeof item?.contentId === "string" ? item.contentId.replace(/[^A-Za-z0-9@._-]/g, "").slice(0, 120) : null,
        })).filter(item => /^(u|a)_[a-z0-9]{15}$/.test(item.id)),
    };
}

const recipientCount = draft => new Set([...draft.to, ...draft.cc, ...draft.bcc].map(item => item.email)).size;

export async function loadDraft(env, session, messageId) {
    const [row] = await ownedMessages(env, session, [messageId]);
    if (row.direction !== "draft") fail(409, "notDraft");
    const data = await readBlobJson(env, row.mailbox_id, row.draft_hash) || {};
    const { results } = await env.MAIL_DB.prepare("SELECT id, filename, mime_type, size, content_id, disposition FROM attachments WHERE message_id = ? ORDER BY position").bind(row.id).all();
    return {
        ...data, draftId: row.id, mailboxId: row.mailbox_id, version: row.version, updatedAt: row.updated_at,
        attachments: results.map(item => ({ kind: "attachment", id: item.id, filename: item.filename, mimeType: item.mime_type, size: item.size, inline: item.disposition === "inline", contentId: item.content_id })),
    };
}

export async function saveDraft(env, session, execCtx, mailbox, input) {
    const draft = normalizeDraft(input);
    const db = env.MAIL_DB;
    let row = null;
    if (input.draftId) {
        [row] = await ownedMessages(env, session, [input.draftId]);
        if (row.mailbox_id !== mailbox.id) fail(404, "mailNotFound");
        if (row.direction !== "draft") fail(409, "notDraft");
        if (!input.force && Number.isFinite(input.baseVersion) && input.baseVersion !== row.version) {
            fail(409, "draftConflict", { draft: await loadDraft(env, session, row.id) });
        }
    }
    const content = { ...draft, attachments: undefined };
    const contentBytes = utf8(JSON.stringify(content));
    const stored = await storeBlob(env, mailbox.id, contentBytes, { contentType: "application/json" });
    const messageId = row?.id || id("m_");
    const at = now();
    const statements = [];
    // Attachments: keep listed ones, attach new uploads, drop removed ones.
    const existing = row ? (await db.prepare("SELECT id, blob_hash, size FROM attachments WHERE message_id = ?").bind(row.id).all()).results : [];
    const keep = new Map(draft.attachments.filter(item => item.kind === "attachment").map(item => [item.id, item]));
    const dropped = existing.filter(item => !keep.has(item.id));
    const uploads = draft.attachments.filter(item => item.kind === "upload");
    const uploadRows = uploads.length ? (await db.prepare(`SELECT * FROM uploads WHERE mailbox_id = ? AND id IN (${marks(uploads)})`).bind(mailbox.id, ...uploads.map(item => item.id)).all()).results : [];
    if (uploadRows.length !== uploads.length) fail(400, "invalidAttachment");
    if (existing.length - dropped.length + uploadRows.length > MAX_ATTACHMENTS) fail(400, "tooManyAttachments");
    let position = 0;
    const kept = existing.filter(item => keep.has(item.id));
    for (const item of kept) {
        const meta = keep.get(item.id);
        statements.push(db.prepare("UPDATE attachments SET disposition = ?, content_id = ?, position = ? WHERE id = ?").bind(meta.inline ? "inline" : "attachment", meta.contentId, position++, item.id));
    }
    const newAttachments = [];
    for (const upload of uploads) {
        const source = uploadRows.find(item => item.id === upload.id);
        const attachmentId = id("a_");
        newAttachments.push({ id: attachmentId, upload: upload.id, filename: source.filename, mimeType: source.mime_type, size: source.size, inline: upload.inline, contentId: upload.contentId });
        // The upload's reference moves to the attachment: insert + delete, no net change.
        statements.push(
            db.prepare("INSERT INTO attachments (id, message_id, mailbox_id, filename, mime_type, size, content_id, disposition, blob_hash, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(attachmentId, messageId, mailbox.id, source.filename, source.mime_type, source.size, upload.contentId, upload.inline ? "inline" : "attachment", source.blob_hash, position++),
            db.prepare("DELETE FROM uploads WHERE id = ?").bind(upload.id),
        );
    }
    const attachmentBytes = kept.reduce((sum, item) => sum + item.size, 0) + uploadRows.reduce((sum, item) => sum + item.size, 0);
    const visible = draft.attachments.filter(item => !item.inline).length;
    const text = draft.text?.trim() ? draft.text : htmlToText(draft.html);
    const meta = [draft.subject, draft.from, JSON.stringify(draft.to), JSON.stringify(draft.cc), JSON.stringify(draft.bcc), snippetOf(text), at, contentBytes.byteLength + attachmentBytes, visible, attachmentBytes, draft.priority];
    if (row) {
        statements.unshift(db.prepare("DELETE FROM messages_fts WHERE rowid = ?").bind(row.num));
        statements.push(
            db.prepare("UPDATE messages SET subject = ?, from_addr = ?, to_json = ?, cc_json = ?, bcc_json = ?, snippet = ?, date = ?, size_bytes = ?, attachment_count = ?, attachment_bytes = ?, priority = ?, draft_hash = ?, version = version + 1, updated_at = ? WHERE id = ?")
                .bind(...meta, stored.hash, at, row.id),
            ...dropped.map(item => db.prepare("DELETE FROM attachments WHERE id = ?").bind(item.id)),
            ...dropRefStatements(db, mailbox.id, [row.draft_hash, ...dropped.map(item => item.blob_hash)]),
        );
    } else {
        const threadId = draft.replyToMessageId ? (await db.prepare("SELECT thread_id FROM messages WHERE id = ? AND mailbox_id = ?").bind(draft.replyToMessageId, mailbox.id).first())?.thread_id || id("t_") : id("t_");
        statements.unshift(db.prepare(
            "INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, storage, subject, from_addr, to_json, cc_json, bcc_json, snippet, date, size_bytes, attachment_count, attachment_bytes, priority, draft_hash, is_read, version, created_at, updated_at) " +
            "VALUES (?, ?, ?, 'drafts', 'draft', 'structured', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)").bind(messageId, mailbox.id, threadId, ...meta, stored.hash, at, at));
    }
    statements.push(
        ...ftsStatements(db, messageId, draft.subject, [...draft.to, ...draft.cc].map(item => `${item.name} ${item.email}`).join(" "), text, ""),
        changeStatement(db, mailbox.id, "message", messageId, "upsert"),
        changeStatement(db, mailbox.id, "storage", mailbox.id, "upsert"),
    );
    try { await db.batch(statements); }
    catch (error) { await db.batch(dropRefStatements(db, mailbox.id, [stored.hash])).catch(() => {}); throw error; }
    scheduleNotify(env, execCtx, mailbox.account_id, { type: "changes", mailboxes: [mailbox.id] });
    const version = (await db.prepare("SELECT version FROM messages WHERE id = ?").bind(messageId).first()).version;
    return { draftId: messageId, version, attachments: newAttachments.map(item => ({ upload: item.upload, id: item.id })) };
}

export async function discardDraft(env, session, execCtx, messageId) {
    const [row] = await ownedMessages(env, session, [messageId]);
    if (row.direction !== "draft") fail(409, "notDraft");
    const { deleteMessages } = await import("./messages.js");
    return deleteMessages(env, session, execCtx, [row], { internal: true });
}

/* ------------------------------------------------------------------ send */
export async function sendMessage(env, session, execCtx, mailbox, input) {
    if (mailbox.status !== "active") fail(403, "mailboxSuspended");
    if (!env.EMAIL) fail(503, "emailDeliveryUnavailable");
    const idempotencyKey = String(input?.idempotencyKey || "");
    if (!/^[A-Za-z0-9-]{16,64}$/.test(idempotencyKey)) fail(400, "invalidRequest");
    const db = env.MAIL_DB;
    const prior = await db.prepare("SELECT id, message_id, state, send_at FROM outbound WHERE mailbox_id = ? AND idempotency_key = ?").bind(mailbox.id, idempotencyKey).first();
    if (prior) return { outboundId: prior.id, messageId: prior.message_id, state: prior.state, sendAt: prior.send_at, duplicate: true };
    const draft = normalizeDraft(input);
    const senders = await senderAddresses(env, mailbox);
    const sender = senders.find(item => item.address === draft.from);
    if (!sender) fail(403, "senderNotAllowed");
    const count = recipientCount(draft);
    if (!count) fail(400, "noRecipients");
    if (count > MAX_RECIPIENTS) fail(400, "tooManyRecipients");
    const settings = await mailboxSettings(env, mailbox.id);
    const sendAt = Number.isFinite(input.sendAt) && input.sendAt > now() + 60_000 ? Math.min(input.sendAt, now() + 366 * 86_400_000) : null;
    const undoSeconds = sendAt ? 0 : Math.min(120, Math.max(0, Number.isFinite(input.undoSeconds) ? input.undoSeconds : settings.undoSendSeconds));
    await rateLimit(env, "send:" + mailbox.account_id, limitSetting(env, "MAIL_SENDS_PER_HOUR", 300), 3600);
    await rateLimit(env, "rcpt:" + mailbox.account_id, limitSetting(env, "MAIL_RECIPIENTS_PER_DAY", 2000), 86400, count);
    // Persist the draft first so its attachments are attached to the message being sent.
    const saved = await saveDraft(env, session, execCtx, mailbox, { ...input, force: true });
    const messageId = saved.draftId;
    const { results: attachments } = await db.prepare("SELECT size, disposition, content_id FROM attachments WHERE message_id = ?").bind(messageId).all();
    const deliveryHtml = draft.mode === "plain" ? "" : sanitizeEmailHtml(draft.html);
    const text = draft.text?.trim() ? draft.text : htmlToText(deliveryHtml);
    const estimated = Math.ceil((attachments.reduce((sum, item) => sum + item.size, 0) + utf8(deliveryHtml).length + utf8(text).length) * 4 / 3) + 16_384;
    if (estimated > MAX_MESSAGE_BYTES) fail(413, "messageTooLarge", { limitBytes: MAX_MESSAGE_BYTES });
    const body = await storeBlob(env, mailbox.id, utf8(JSON.stringify({ html: deliveryHtml, text })), { contentType: "application/json" });
    const outboundId = id("o_");
    const at = now();
    const state = sendAt ? "scheduled" : "queued";
    const due = sendAt || at + undoSeconds * 1000;
    let inReplyTo = null;
    let references = null;
    if (draft.replyToMessageId && draft.replyMode !== "forward") {
        const original = await db.prepare("SELECT message_id_header, references_header FROM messages WHERE id = ? AND mailbox_id = ?").bind(draft.replyToMessageId, mailbox.id).first();
        if (original?.message_id_header) {
            inReplyTo = original.message_id_header;
            references = [...(original.references_header || "").split(/\s+/).filter(Boolean).slice(-98), original.message_id_header].join(" ");
        }
    }
    const recipients = [...new Set([...draft.to, ...draft.cc, ...draft.bcc].map(item => item.email))];
    // A From line with a name: the sender name set for this address, else the display name of the account that owns the mailbox.
    // Mail from a bare address with no name is more likely to be filtered as spam by Gmail and others.
    const owner = [session.account, ...(session.accounts || [])].find(account => account && String(account.id) === String(mailbox.account_id));
    const senderName = cleanHeaderText(sender.displayName || mailbox.display_name || owner?.displayName || "", 200);
    const statements = [
        db.prepare("UPDATE messages SET direction = 'out', folder = ?, from_name = ?, body_hash = ?, date = ?, in_reply_to = ?, references_header = ?, delivery_status = ?, " +
            "size_bytes = size_bytes + ?, version = version + 1, updated_at = ? WHERE id = ?")
            .bind(sendAt ? "scheduled" : "outbox", senderName, body.hash, due, inReplyTo, references, state, body.size, at, messageId),
        db.prepare("INSERT INTO outbound (id, mailbox_id, message_id, state, send_at, idempotency_key, recipient_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(outboundId, mailbox.id, messageId, state, due, idempotencyKey, recipients.length, at, at),
        ...recipients.map(email => db.prepare("INSERT INTO delivery_recipients (outbound_id, recipient, status, updated_at) VALUES (?, ?, 'pending', ?)").bind(outboundId, email, at)),
        ...[...draft.to, ...draft.cc, ...draft.bcc].map(item => db.prepare(
            "INSERT INTO contacts (id, mailbox_id, name, email, auto, use_count, last_used, created_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?) " +
            "ON CONFLICT (mailbox_id, email) DO UPDATE SET use_count = use_count + 1, last_used = excluded.last_used, name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END")
            .bind(id("c_"), mailbox.id, item.name, item.email, at, at)),
        changeStatement(db, mailbox.id, "message", messageId, "upsert"),
    ];
    try { await db.batch(statements); }
    catch (error) {
        await db.batch(dropRefStatements(db, mailbox.id, [body.hash])).catch(() => {});
        if (/UNIQUE/i.test(String(error?.message))) {
            const winner = await db.prepare("SELECT id, message_id, state, send_at FROM outbound WHERE mailbox_id = ? AND idempotency_key = ?").bind(mailbox.id, idempotencyKey).first();
            if (winner) return { outboundId: winner.id, messageId: winner.message_id, state: winner.state, sendAt: winner.send_at, duplicate: true };
        }
        throw error;
    }
    if (!sendAt) await enqueueSend(env, outboundId, undoSeconds);
    scheduleNotify(env, execCtx, mailbox.account_id, { type: "changes", mailboxes: [mailbox.id] });
    await opsLog(db, "outbound", sendAt ? "scheduled" : "queued");
    return { outboundId, messageId, state, sendAt: due, undoSeconds };
}

async function enqueueSend(env, outboundId, delaySeconds) {
    if (!env.MAIL_JOBS) fail(503, "deliveryQueueUnavailable");
    await env.MAIL_JOBS.send({ type: "send", outboundId }, { delaySeconds: Math.max(0, Math.ceil(delaySeconds)) });
}

async function ownedOutbound(env, session, outboundId) {
    if (!/^o_[a-z0-9]{15}$/.test(String(outboundId))) fail(400, "invalidRequest");
    const row = await env.MAIL_DB.prepare("SELECT o.*, b.account_id FROM outbound o JOIN mailboxes b ON b.id = o.mailbox_id WHERE o.id = ?").bind(outboundId).first();
    if (!row || !session.accountIds.has(row.account_id)) fail(404, "notFound");
    return row;
}

// Undo send and unscheduling: only possible before delivery starts. The message returns to Drafts.
export async function cancelOutbound(env, session, execCtx, outboundId) {
    const row = await ownedOutbound(env, session, outboundId);
    const db = env.MAIL_DB;
    const [update] = await db.batch([
        db.prepare("UPDATE outbound SET state = 'canceled', updated_at = ? WHERE id = ? AND state IN ('queued', 'scheduled', 'failed', 'unknown')").bind(now(), outboundId),
    ]);
    if (!update.meta.changes) fail(409, "alreadySending");
    const message = await db.prepare("SELECT body_hash FROM messages WHERE id = ?").bind(row.message_id).first();
    await db.batch([
        db.prepare("UPDATE messages SET direction = 'draft', folder = 'drafts', body_hash = NULL, delivery_status = NULL, version = version + 1, updated_at = ? WHERE id = ?").bind(now(), row.message_id),
        ...dropRefStatements(db, row.mailbox_id, [message?.body_hash]),
        changeStatement(db, row.mailbox_id, "message", row.message_id, "upsert"),
    ]);
    scheduleNotify(env, execCtx, row.account_id, { type: "changes", mailboxes: [row.mailbox_id] });
    return { messageId: row.message_id, state: "canceled" };
}

export async function retryOutbound(env, session, execCtx, outboundId) {
    const row = await ownedOutbound(env, session, outboundId);
    const update = await env.MAIL_DB.prepare("UPDATE outbound SET state = 'queued', attempts = 0, last_error = '', send_at = ?, updated_at = ? WHERE id = ? AND state IN ('failed', 'unknown')").bind(now(), now(), outboundId).run();
    if (!update.meta.changes) fail(409, "cannotRetry");
    await env.MAIL_DB.batch([
        env.MAIL_DB.prepare("UPDATE messages SET folder = 'outbox', delivery_status = 'queued', version = version + 1, updated_at = ? WHERE id = ?").bind(now(), row.message_id),
        changeStatement(env.MAIL_DB, row.mailbox_id, "message", row.message_id, "upsert"),
    ]);
    await enqueueSend(env, outboundId, 0);
    scheduleNotify(env, execCtx, row.account_id, { type: "changes", mailboxes: [row.mailbox_id] });
    return { state: "queued" };
}

const formatRecipient = item => item.name ? { email: item.email, name: item.name } : item.email;

// Queue consumer: one delivery attempt. Returns { retryDelaySeconds } for transient failures.
export async function processSend(env, outboundId) {
    const db = env.MAIL_DB;
    const at = now();
    const claim = await db.prepare("UPDATE outbound SET state = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND state = 'queued' AND send_at <= ?").bind(at, outboundId, at + 2000).run();
    if (!claim.meta.changes) {
        const row = await db.prepare("SELECT state, send_at, updated_at FROM outbound WHERE id = ?").bind(outboundId).first();
        if (row?.state === "queued" && row.send_at > at) return { retryDelaySeconds: Math.ceil((row.send_at - at) / 1000) };
        // A previous attempt stopped mid-send. Sending again could deliver twice, so ask the owner.
        if (row?.state === "sending" && at - row.updated_at > 10 * 60_000) await markUnknown(env, outboundId);
        return {};
    }
    const outbound = await db.prepare("SELECT o.*, b.address, b.display_name, b.account_id, b.status AS mailbox_status FROM outbound o JOIN mailboxes b ON b.id = o.mailbox_id WHERE o.id = ?").bind(outboundId).first();
    const message = await db.prepare("SELECT * FROM messages WHERE id = ?").bind(outbound.message_id).first();
    if (!message || outbound.mailbox_status !== "active") return finishFailure(env, outbound, message, "mailboxUnavailable", false);
    const body = await messageBody(env, message);
    const { results: attachmentRows } = await db.prepare("SELECT * FROM attachments WHERE message_id = ? ORDER BY position").bind(message.id).all();
    const attachments = [];
    for (const item of attachmentRows) {
        const content = await readBlobBytes(env, message.mailbox_id, item.blob_hash);
        if (!content) return finishFailure(env, outbound, message, "attachmentMissing", false);
        attachments.push({ content, filename: item.filename, type: item.mime_type, disposition: item.disposition === "inline" ? "inline" : "attachment", ...(item.content_id ? { contentId: item.content_id } : {}) });
    }
    const headers = {};
    if (message.in_reply_to) { headers["In-Reply-To"] = message.in_reply_to; headers.References = message.references_header || message.in_reply_to; }
    if (message.priority === "high") { headers.Importance = "high"; headers["X-Priority"] = "1"; }
    if (message.priority === "low") { headers.Importance = "low"; headers["X-Priority"] = "5"; }
    const name = message.from_name || outbound.display_name || "";
    const payload = {
        from: name ? { email: message.from_addr, name } : message.from_addr,
        to: parseJson(message.to_json, []).map(formatRecipient), cc: parseJson(message.cc_json, []).map(formatRecipient), bcc: parseJson(message.bcc_json, []).map(formatRecipient),
        subject: message.subject, text: (body.text && body.text.trim()) || htmlToText(body.html || "") || message.subject || " ", ...(body.html ? { html: body.html } : {}),
        ...(attachments.length ? { attachments } : {}), ...(Object.keys(headers).length ? { headers } : {}),
    };
    for (const field of ["to", "cc", "bcc"]) if (!payload[field].length) delete payload[field];
    if (!env.EMAIL) return finishFailure(env, outbound, message, "emailDeliveryUnavailable", false);
    let result;
    try { result = await env.EMAIL.send(payload); }
    catch (error) {
        const code = typeof error?.code === "string" ? error.code : error instanceof TypeError ? "E_VALIDATION_ERROR" : "E_INTERNAL_SERVER_ERROR";
        return finishFailure(env, outbound, message, code, !PERMANENT.has(code));
    }
    const providerId = String(result?.messageId || "").slice(0, 300) || null;
    await db.batch([
        db.prepare("UPDATE outbound SET state = 'sent', provider_message_id = ?, last_error = '', updated_at = ? WHERE id = ?").bind(providerId, now(), outboundId),
        db.prepare("UPDATE delivery_recipients SET status = 'accepted', updated_at = ? WHERE outbound_id = ? AND status = 'pending'").bind(now(), outboundId),
        db.prepare("UPDATE messages SET folder = 'sent', delivery_status = 'sent', draft_hash = NULL, date = ?, version = version + 1, updated_at = ? WHERE id = ?").bind(now(), now(), message.id),
        ...dropRefStatements(db, message.mailbox_id, [message.draft_hash]),
        changeStatement(db, message.mailbox_id, "message", message.id, "upsert"),
        changeStatement(db, message.mailbox_id, "storage", message.mailbox_id, "upsert"),
    ]);
    await opsLog(db, "outbound", "sent");
    await notify(env, outbound.account_id, { type: "delivery", mailboxId: message.mailbox_id, messageId: message.id, state: "sent" });
    return {};
}

async function markUnknown(env, outboundId) {
    const row = await env.MAIL_DB.prepare("SELECT o.message_id, o.mailbox_id, b.account_id FROM outbound o JOIN mailboxes b ON b.id = o.mailbox_id WHERE o.id = ?").bind(outboundId).first();
    await env.MAIL_DB.batch([
        env.MAIL_DB.prepare("UPDATE outbound SET state = 'unknown', last_error = 'interrupted', updated_at = ? WHERE id = ? AND state = 'sending'").bind(now(), outboundId),
        env.MAIL_DB.prepare("UPDATE messages SET delivery_status = 'unknown', version = version + 1, updated_at = ? WHERE id = ?").bind(now(), row.message_id),
        changeStatement(env.MAIL_DB, row.mailbox_id, "message", row.message_id, "upsert"),
    ]);
    await notify(env, row.account_id, { type: "delivery", mailboxId: row.mailbox_id, messageId: row.message_id, state: "unknown" });
}

async function finishFailure(env, outbound, message, code, transient) {
    const db = env.MAIL_DB;
    const retry = transient && outbound.attempts < MAX_ATTEMPTS;
    const delay = Math.min(3600, 30 * 2 ** Math.max(0, outbound.attempts - 1)) + Math.floor(Math.random() * 15);
    await db.batch([
        db.prepare("UPDATE outbound SET state = ?, last_error = ?, send_at = ?, updated_at = ? WHERE id = ?").bind(retry ? "queued" : "failed", code, retry ? now() + delay * 1000 : outbound.send_at, now(), outbound.id),
        ...(message ? [
            db.prepare("UPDATE messages SET delivery_status = ?, version = version + 1, updated_at = ? WHERE id = ?").bind(retry ? "retrying" : "failed", now(), message.id),
            changeStatement(db, message.mailbox_id, "message", message.id, "upsert"),
        ] : []),
        ...(retry ? [] : [db.prepare("UPDATE delivery_recipients SET status = 'failed', detail = ?, updated_at = ? WHERE outbound_id = ? AND status = 'pending'").bind(code, now(), outbound.id)]),
    ]);
    await opsLog(db, "outbound", code);
    if (!retry && message) await notify(env, outbound.account_id, { type: "delivery", mailboxId: message.mailbox_id, messageId: message.id, state: "failed", code });
    return retry ? { retryDelaySeconds: delay } : {};
}

// Cron: hands scheduled messages that are due to the queue.
export async function dispatchScheduled(env) {
    const { results } = await env.MAIL_DB.prepare("SELECT id, message_id, mailbox_id FROM outbound WHERE state = 'scheduled' AND send_at <= ? LIMIT 200").bind(now()).all();
    for (const row of results) {
        const update = await env.MAIL_DB.prepare("UPDATE outbound SET state = 'queued', updated_at = ? WHERE id = ? AND state = 'scheduled'").bind(now(), row.id).run();
        if (!update.meta.changes) continue;
        await env.MAIL_DB.batch([
            env.MAIL_DB.prepare("UPDATE messages SET folder = 'outbox', delivery_status = 'queued', version = version + 1, updated_at = ? WHERE id = ?").bind(now(), row.message_id),
            changeStatement(env.MAIL_DB, row.mailbox_id, "message", row.message_id, "upsert"),
        ]);
        await env.MAIL_JOBS.send({ type: "send", outboundId: row.id });
    }
    // Recover queued items whose queue message was lost.
    const { results: stale } = await env.MAIL_DB.prepare("SELECT id FROM outbound WHERE state = 'queued' AND send_at < ? LIMIT 100").bind(now() - 15 * 60_000).all();
    for (const row of stale) await env.MAIL_JOBS.send({ type: "send", outboundId: row.id });
    return results.length;
}

/* ------------------------------------------------------------------ delivery events */
const EVENT_STATUS = { delivered: "delivered", deferred: "deferred", bounced: "bounced", failed: "failed", rejected: "rejected", complained: "complained" };

export async function processDeliveryEvent(env, event) {
    const payload = event?.payload;
    const status = EVENT_STATUS[payload?.delivery?.status] || EVENT_STATUS[String(event?.type || "").split(".").pop()];
    if (!status || !payload?.messageId) return;
    const db = env.MAIL_DB;
    const outbound = await db.prepare("SELECT o.*, b.account_id FROM outbound o JOIN mailboxes b ON b.id = o.mailbox_id WHERE o.provider_message_id = ?").bind(String(payload.messageId)).first();
    if (!outbound) return;
    const recipient = normalizeEmail(payload.recipient);
    const detail = cleanHeaderText(payload.bounce?.reason || payload.rejection?.reason || payload.failure?.reason || payload.delivery?.smtpResponse || "", 300);
    await db.prepare("UPDATE delivery_recipients SET status = ?, detail = ?, updated_at = ? WHERE outbound_id = ? AND recipient = ?").bind(status, detail, now(), outbound.id, recipient).run();
    const { results } = await db.prepare("SELECT status FROM delivery_recipients WHERE outbound_id = ?").bind(outbound.id).all();
    const statuses = results.map(row => row.status);
    const failed = statuses.filter(value => ["bounced", "failed", "rejected"].includes(value)).length;
    const overall = failed === statuses.length ? "bounced" : failed ? "partial" : statuses.every(value => value === "delivered") ? "delivered" : statuses.some(value => value === "deferred") ? "deferred" : "sent";
    await db.batch([
        db.prepare("UPDATE messages SET delivery_status = ?, version = version + 1, updated_at = ? WHERE id = ?").bind(overall, now(), outbound.message_id),
        changeStatement(db, outbound.mailbox_id, "message", outbound.message_id, "upsert"),
    ]);
    if (["bounced", "rejected", "failed"].includes(status) && payload.terminal !== false) await bounceNotice(env, outbound, recipient, status, detail);
    if (status === "complained") {
        await db.prepare("INSERT INTO abuse_reports (id, mailbox_id, sender, sender_domain, reason, created_at) VALUES (?, ?, ?, ?, 'recipientComplaint', ?)")
            .bind(id("ab_"), outbound.mailbox_id, (await db.prepare("SELECT address FROM mailboxes WHERE id = ?").bind(outbound.mailbox_id).first())?.address || "", "", now()).run();
    }
    await opsLog(db, "delivery", status);
    await notify(env, outbound.account_id, { type: "delivery", mailboxId: outbound.mailbox_id, messageId: outbound.message_id, state: overall });
}

// A factual notice in the sender's inbox when a recipient's server refuses a message.
async function bounceNotice(env, outbound, recipient, status, detail) {
    const db = env.MAIL_DB;
    const original = await db.prepare("SELECT subject, thread_id FROM messages WHERE id = ?").bind(outbound.message_id).first();
    const text = `Your message${original?.subject ? ` "${original.subject}"` : ""} couldn't be delivered to ${recipient}.\n\nStatus: ${status}${detail ? `\nDetails from the receiving server: ${detail}` : ""}`;
    try {
        const stored = await storeBlob(env, outbound.mailbox_id, utf8(JSON.stringify({ html: "", text })), { contentType: "application/json" });
        const messageId = id("m_");
        const subject = `Delivery failed: ${original?.subject || "(no subject)"}`.slice(0, 998);
        const threadId = original?.thread_id || await resolveThread(db, outbound.mailbox_id, subject, now());
        await db.batch([
            ...threadStatements(db, outbound.mailbox_id, threadId, subject, now()),
            db.prepare("INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, storage, subject, from_addr, from_name, to_json, snippet, date, size_bytes, is_important, category, body_hash, dedupe_key, created_at, updated_at) " +
                "VALUES (?, ?, ?, 'inbox', 'in', 'structured', ?, 'mailer-daemon@munetios.com', 'Munetios Mail', '[]', ?, ?, ?, 1, 'primary', ?, ?, ?, ?)")
                .bind(messageId, outbound.mailbox_id, threadId, subject, snippetOf(text), now(), stored.size, stored.hash, `bounce:${outbound.id}:${recipient}`, now(), now()),
            ...ftsStatements(db, messageId, subject, "Munetios Mail " + recipient, text, ""),
            changeStatement(db, outbound.mailbox_id, "message", messageId, "upsert"),
        ]);
    } catch (error) {
        if (!/UNIQUE/i.test(String(error?.message))) await opsLog(db, "delivery", "noticeFailed");
    }
}

/* ------------------------------------------------------------------ forwarding */
export async function startForwardingVerification(env, mailbox) {
    const settings = await mailboxSettings(env, mailbox.id);
    const address = settings.forwarding.address;
    if (!validEmail(address)) fail(400, "invalidAddress");
    if (address === mailbox.address) fail(400, "invalidAddress");
    await rateLimit(env, "fwdverify:" + mailbox.id, 5, 3600);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    settings.forwarding.codeHash = await sha256Hex(mailbox.id + ":" + address + ":" + code);
    settings.forwarding.codeExpires = now() + 30 * 60_000;
    settings.forwarding.attempts = 0;
    if (!env.EMAIL) fail(503, "emailDeliveryUnavailable");
    try {
        await env.EMAIL.send({
            to: address, from: { email: mailbox.address, name: mailbox.display_name || "Munetios Mail" }, subject: "Confirm forwarding from " + mailbox.address,
            text: `${mailbox.address} asked to forward its mail to this address.\n\nConfirmation code: ${code}\n\nThe code expires in 30 minutes. If you didn't expect this, ignore this message and nothing will be forwarded.`,
        });
    } catch (error) { fail(502, "emailDeliveryFailed", { code: error?.code || "" }); }
    await env.MAIL_DB.prepare("UPDATE mailbox_settings SET data_json = ?, updated_at = ? WHERE mailbox_id = ?").bind(JSON.stringify(settings), now(), mailbox.id).run();
    return { sent: true };
}

export async function confirmForwarding(env, mailbox, code) {
    const settings = await mailboxSettings(env, mailbox.id);
    const forwarding = settings.forwarding;
    if (!forwarding.codeHash || forwarding.codeExpires < now() || (forwarding.attempts || 0) >= 5) fail(400, "codeExpired");
    const hash = await sha256Hex(mailbox.id + ":" + forwarding.address + ":" + String(code || ""));
    if (hash !== forwarding.codeHash) {
        forwarding.attempts = (forwarding.attempts || 0) + 1;
        await env.MAIL_DB.prepare("UPDATE mailbox_settings SET data_json = ? WHERE mailbox_id = ?").bind(JSON.stringify(settings), mailbox.id).run();
        fail(400, "invalidCode");
    }
    Object.assign(forwarding, { verified: true, enabled: true });
    delete forwarding.codeHash; delete forwarding.codeExpires; delete forwarding.attempts;
    await env.MAIL_DB.prepare("UPDATE mailbox_settings SET data_json = ?, updated_at = ? WHERE mailbox_id = ?").bind(JSON.stringify(settings), now(), mailbox.id).run();
    return { verified: true };
}

/* ------------------------------------------------------------------ addresses at other providers */
// An address at another provider (Gmail, Outlook, …) that forwards its mail here. Adding one proves ownership with a
// code sent to that address; the owner then turns on automatic forwarding in that provider. No provider API is used.
const saveSettingsJson = (env, mailboxId, settings) => env.MAIL_DB.prepare("UPDATE mailbox_settings SET data_json = ?, updated_at = ? WHERE mailbox_id = ?").bind(JSON.stringify(settings), now(), mailboxId).run();

export async function startLinkVerification(env, mailbox, input) {
    const address = normalizeEmail(input);
    if (!validEmail(address)) fail(400, "invalidAddress");
    if (isInternal(address)) fail(400, "addressIsMunetios");
    const settings = await mailboxSettings(env, mailbox.id);
    const linked = Array.isArray(settings.linked) ? settings.linked : [];
    if (linked.some(item => item.address === address)) fail(409, "alreadyLinked");
    await rateLimit(env, "linkverify:" + mailbox.id, 5, 3600);
    if (!env.EMAIL) fail(503, "emailDeliveryUnavailable");
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    settings.linkPending = { address, codeHash: await sha256Hex(mailbox.id + ":link:" + address + ":" + code), codeExpires: now() + 30 * 60_000, attempts: 0 };
    try {
        await env.EMAIL.send({
            to: address, from: { email: mailbox.address, name: mailbox.display_name || "Munetios Mail" }, subject: "Confirm your address for Munetios Mail",
            text: `${mailbox.address} asked to receive mail from this address in Munetios Mail.\n\nConfirmation code: ${code}\n\nThe code expires in 30 minutes. After confirming, turn on automatic forwarding to ${mailbox.address} in your email settings.\nIf you didn't expect this, ignore this message and nothing changes.`,
        });
    } catch (error) { fail(502, "emailDeliveryFailed", { code: error?.code || "" }); }
    await saveSettingsJson(env, mailbox.id, settings);
    return { sent: true, address };
}

export async function confirmLink(env, mailbox, code) {
    const settings = await mailboxSettings(env, mailbox.id);
    const pending = settings.linkPending;
    if (!pending?.codeHash || pending.codeExpires < now() || (pending.attempts || 0) >= 5) fail(400, "codeExpired");
    if (await sha256Hex(mailbox.id + ":link:" + pending.address + ":" + String(code || "").trim()) !== pending.codeHash) {
        pending.attempts = (pending.attempts || 0) + 1;
        await saveSettingsJson(env, mailbox.id, settings);
        fail(400, "invalidCode");
    }
    const linked = (Array.isArray(settings.linked) ? settings.linked : []).filter(item => item.address !== pending.address);
    linked.push({ address: pending.address, verifiedAt: now() });
    settings.linked = linked;
    delete settings.linkPending;
    await saveSettingsJson(env, mailbox.id, settings);
    return { linked };
}

export async function removeLink(env, mailbox, input) {
    const address = normalizeEmail(input);
    const settings = await mailboxSettings(env, mailbox.id);
    settings.linked = (Array.isArray(settings.linked) ? settings.linked : []).filter(item => item.address !== address);
    if (settings.linkPending?.address === address) delete settings.linkPending;
    await saveSettingsJson(env, mailbox.id, settings);
    return { linked: settings.linked };
}

// Queue job: forwards a received message to the owner's verified address.
export async function processForward(env, { mailboxId, messageId, address }) {
    const db = env.MAIL_DB;
    const mailbox = await db.prepare("SELECT * FROM mailboxes WHERE id = ? AND status = 'active'").bind(mailboxId).first();
    const settings = mailbox ? await mailboxSettings(env, mailboxId) : null;
    if (!mailbox || !settings.forwarding.verified || settings.forwarding.address !== address) return;
    const message = await db.prepare("SELECT * FROM messages WHERE id = ? AND mailbox_id = ?").bind(messageId, mailboxId).first();
    if (!message) return;
    const body = await messageBody(env, message);
    const attachments = [];
    if (message.raw_hash) {
        const raw = await readBlobBytes(env, mailboxId, message.raw_hash);
        if (raw && raw.byteLength * 1.4 < MAX_MESSAGE_BYTES) {
            const parsed = await parseRaw(raw);
            for (const item of parsed.attachments.slice(0, MAX_ATTACHMENTS)) {
                attachments.push({ content: new Uint8Array(item.content), filename: item.filename || "attachment", type: item.mimeType || "application/octet-stream",
                    disposition: item.disposition === "inline" ? "inline" : "attachment", ...(item.contentId ? { contentId: item.contentId.replace(/^<|>$/g, "") } : {}) });
            }
        }
    }
    try {
        await env.EMAIL.send({
            to: address, from: mailbox.display_name ? { email: mailbox.address, name: mailbox.display_name } : mailbox.address,
            subject: message.subject, text: (body.text && body.text.trim()) || htmlToText(body.html || "") || message.subject || " ", ...(body.html ? { html: body.html } : {}),
            ...(message.from_addr && validEmail(message.from_addr) ? { replyTo: message.from_addr } : {}),
            ...(attachments.length ? { attachments } : {}), headers: { "X-Munetios-Forwarded": "1", "Auto-Submitted": "auto-forwarded" },
        });
        await opsLog(db, "forward", "sent");
    } catch (error) {
        await opsLog(db, "forward", error?.code || "failed");
        if (!PERMANENT.has(error?.code)) throw error;
    }
}

