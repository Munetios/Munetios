// Message listing, reading, organization, and permanent deletion.
// Reference invariant: a message holds one blob reference for each of raw_hash, body_hash, draft_hash
// (when set) and one for every attachment row with a blob_hash. Deletion drops exactly those.
import { buildSearch } from "./search.js";
import { changeStatement, scheduleNotify } from "./mailbox.js";
import { dropRefStatements, readBlobBytes, readBlobJson } from "./storage.js";
import { buildMime } from "./mime.js";
import { fail, now, parseJson, MOVABLE_FOLDERS, bool, domainOf, id, normalizeEmail, validEmail } from "./util.js";

const VIEWS = new Set(["inbox", "starred", "important", "snoozed", "sent", "drafts", "scheduled", "outbox", "all", "archive", "spam", "trash", "followup", "pinned"]);
const CATEGORIES = new Set(["primary", "social", "promotions", "updates", "forums"]);
const SORTS = {
    date: "m.date DESC, m.num DESC", date_asc: "m.date ASC, m.num ASC", size: "m.size_bytes DESC, m.num DESC", size_asc: "m.size_bytes ASC, m.num ASC",
    from: "m.from_name COLLATE NOCASE ASC, m.from_addr ASC, m.date DESC", subject: "m.subject COLLATE NOCASE ASC, m.date DESC",
};
const chunk = (list, size) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };
const marks = list => list.map(() => "?").join(",");

export function summary(row, labels = []) {
    return {
        id: row.id, mailboxId: row.mailbox_id, threadId: row.thread_id, folder: row.folder, direction: row.direction,
        subject: row.subject, from: { email: row.from_addr, name: row.from_name }, to: parseJson(row.to_json, []), cc: parseJson(row.cc_json, []),
        snippet: row.snippet, date: row.date, size: row.size_bytes, attachments: row.attachment_count, attachmentBytes: row.attachment_bytes,
        read: Boolean(row.is_read), starred: Boolean(row.is_starred), important: Boolean(row.is_important), pinned: Boolean(row.is_pinned),
        category: row.category, priority: row.priority, snoozeUntil: row.snooze_until, followUpAt: row.follow_up_at, followUpDue: Boolean(row.follow_up_due),
        deliveryStatus: row.delivery_status, labels, spam: row.spam_score >= 5 ? row.spam_score : 0,
        ...(row.thread_count ? { threadCount: row.thread_count, threadUnread: row.thread_unread } : {}),
    };
}

async function labelsFor(db, ids) {
    const map = new Map();
    for (const group of chunk(ids, 90)) {
        if (!group.length) continue;
        const { results } = await db.prepare(`SELECT message_id, label_id FROM message_labels WHERE message_id IN (${marks(group)})`).bind(...group).all();
        for (const row of results) map.set(row.message_id, [...(map.get(row.message_id) || []), row.label_id]);
    }
    return map;
}

export async function listMessages(env, mailboxes, params) {
    const db = env.MAIL_DB;
    const ids = mailboxes.map(row => row.id);
    if (!ids.length) return { messages: [], total: 0 };
    const view = String(params.view || "inbox");
    const where = [`m.mailbox_id IN (${marks(ids)})`];
    const values = [...ids];
    if (view.startsWith("f_")) { where.push("m.folder = ?"); values.push(view); }
    else if (view.startsWith("label:")) { where.push("EXISTS (SELECT 1 FROM message_labels ml WHERE ml.message_id = m.id AND ml.label_id = ?)", "m.folder NOT IN ('trash', 'spam')"); values.push(view.slice(6)); }
    else if (view === "search") {
        const search = buildSearch(params.q, { tzOffsetMinutes: Number(params.tz) || 0 });
        where.push(...search.where); values.push(...search.params);
    } else if (VIEWS.has(view)) {
        switch (view) {
            case "inbox": where.push("m.folder = 'inbox'", "m.snooze_until IS NULL"); break;
            case "starred": where.push("m.is_starred = 1", "m.folder NOT IN ('trash', 'spam')"); break;
            case "important": where.push("m.is_important = 1", "m.folder NOT IN ('trash', 'spam')"); break;
            case "pinned": where.push("m.is_pinned = 1", "m.folder NOT IN ('trash', 'spam')"); break;
            case "snoozed": where.push("m.snooze_until IS NOT NULL"); break;
            case "followup": where.push("m.follow_up_due = 1"); break;
            case "all": where.push("m.folder NOT IN ('trash', 'spam', 'drafts')"); break;
            default: where.push("m.folder = ?"); values.push(view);
        }
    } else fail(400, "invalidRequest");
    if (view === "inbox" && CATEGORIES.has(params.category)) {
        if (params.category === "primary") {
            where.push("m.category IN ('primary', 'updates', 'forums')");
        } else {
            where.push("m.category = ?");
            values.push(params.category);
        }
    }
    // Mail sent to one address (an address at another provider that forwards here): exact match in To or Cc.
    const address = normalizeEmail(params.address);
    if (params.address && validEmail(address)) {
        const pattern = '%"email":"' + address.replace(/[\\%_]/g, character => "\\" + character) + '"%';
        where.push("(m.to_json LIKE ? ESCAPE '\\' OR m.cc_json LIKE ? ESCAPE '\\')"); values.push(pattern, pattern);
    }
    for (const filter of String(params.filter || "").split(",")) {
        if (filter === "unread") where.push("m.is_read = 0");
        if (filter === "starred") where.push("m.is_starred = 1");
        if (filter === "attachments") where.push("m.attachment_count > 0");
        if (filter === "important") where.push("m.is_important = 1");
        if (filter === "large") where.push("m.size_bytes >= 5000000");
    }
    const sort = SORTS[params.sort] || SORTS.date;
    const pinnedFirst = params.pinnedFirst !== "0" && !["search", "pinned"].includes(view) && !params.sort?.startsWith("size") ? "m.is_pinned DESC, " : "";
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 60));
    const offset = Math.max(0, Number(params.offset) || 0);
    const clause = where.join(" AND ");
    let rows;
    let total;
    if (params.threads === "1" && view !== "drafts" && view !== "search") {
        const outer = sort.replaceAll("m.", "v.");
        const { results } = await db.prepare(
            `WITH v AS (SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.thread_id ORDER BY m.date DESC, m.num DESC) AS rn, COUNT(*) OVER (PARTITION BY m.thread_id) AS thread_count, ` +
            `SUM(1 - m.is_read) OVER (PARTITION BY m.thread_id) AS thread_unread, MAX(m.is_pinned) OVER (PARTITION BY m.thread_id) AS thread_pinned FROM messages m WHERE ${clause}) ` +
            `SELECT * FROM v WHERE rn = 1 ORDER BY ${pinnedFirst ? "v.thread_pinned DESC, " : ""}${outer} LIMIT ? OFFSET ?`).bind(...values, limit, offset).all();
        rows = results;
        total = (await db.prepare(`SELECT COUNT(DISTINCT m.thread_id) AS n FROM messages m WHERE ${clause}`).bind(...values).first()).n;
    } else {
        rows = (await db.prepare(`SELECT m.* FROM messages m WHERE ${clause} ORDER BY ${pinnedFirst}${sort} LIMIT ? OFFSET ?`).bind(...values, limit, offset).all()).results;
        total = (await db.prepare(`SELECT COUNT(*) AS n FROM messages m WHERE ${clause}`).bind(...values).first()).n;
    }
    const labels = await labelsFor(db, rows.map(row => row.id));
    return { messages: rows.map(row => summary(row, labels.get(row.id) || [])), total, offset, limit };
}

export async function counts(env, mailboxes) {
    const ids = mailboxes.map(row => row.id);
    if (!ids.length) return {};
    const db = env.MAIL_DB;
    const out = Object.fromEntries(ids.map(mailboxId => [mailboxId, { folders: {}, totals: {}, labels: {}, starred: 0, important: 0, snoozed: 0, followup: 0 }]));
    const { results: unread } = await db.prepare(`SELECT mailbox_id, folder, COUNT(*) AS n FROM messages WHERE mailbox_id IN (${marks(ids)}) AND is_read = 0 AND snooze_until IS NULL GROUP BY mailbox_id, folder`).bind(...ids).all();
    for (const row of unread) out[row.mailbox_id].folders[row.folder] = row.n;
    const { results: totals } = await db.prepare(`SELECT mailbox_id, folder, COUNT(*) AS n FROM messages WHERE mailbox_id IN (${marks(ids)}) AND folder IN ('drafts', 'scheduled', 'outbox', 'spam', 'trash') GROUP BY mailbox_id, folder`).bind(...ids).all();
    for (const row of totals) out[row.mailbox_id].totals[row.folder] = row.n;
    const { results: flags } = await db.prepare(
        `SELECT mailbox_id, SUM(is_starred = 1 AND is_read = 0 AND folder NOT IN ('trash','spam')) AS starred, SUM(is_important = 1 AND is_read = 0 AND folder NOT IN ('trash','spam')) AS important, ` +
        `SUM(snooze_until IS NOT NULL) AS snoozed, SUM(follow_up_due = 1) AS followup FROM messages WHERE mailbox_id IN (${marks(ids)}) GROUP BY mailbox_id`).bind(...ids).all();
    for (const row of flags) Object.assign(out[row.mailbox_id], { starred: row.starred || 0, important: row.important || 0, snoozed: row.snoozed || 0, followup: row.followup || 0 });
    const { results: labelCounts } = await db.prepare(
        `SELECT m.mailbox_id, ml.label_id, COUNT(*) AS n FROM message_labels ml JOIN messages m ON m.id = ml.message_id WHERE m.mailbox_id IN (${marks(ids)}) AND m.is_read = 0 AND m.folder NOT IN ('trash','spam') GROUP BY m.mailbox_id, ml.label_id`).bind(...ids).all();
    for (const row of labelCounts) out[row.mailbox_id].labels[row.label_id] = row.n;
    return out;
}

// Loads messages and confirms each one belongs to a mailbox of this browser's accounts.
export async function ownedMessages(env, session, messageIds) {
    const list = [...new Set((Array.isArray(messageIds) ? messageIds : [messageIds]).filter(value => typeof value === "string" && /^m_[a-z0-9]{15}$/.test(value)))];
    if (!list.length) fail(400, "invalidRequest");
    const rows = [];
    for (const group of chunk(list, 90)) {
        const { results } = await env.MAIL_DB.prepare(
            `SELECT m.*, b.account_id AS owner_account, b.status AS mailbox_status FROM messages m JOIN mailboxes b ON b.id = m.mailbox_id WHERE m.id IN (${marks(group)})`).bind(...group).all();
        rows.push(...results);
    }
    const owned = rows.filter(row => session.accountIds.has(row.owner_account) && row.mailbox_status !== "deleting");
    if (owned.length !== list.length) fail(404, "mailNotFound");
    return owned;
}

export async function messageBody(env, row) {
    const body = await readBlobJson(env, row.mailbox_id, row.body_hash);
    return { html: typeof body?.html === "string" ? body.html : "", text: typeof body?.text === "string" ? body.text : "", headers: Array.isArray(body?.headers) ? body.headers : [] };
}

export async function getMessage(env, session, messageId) {
    const [row] = await ownedMessages(env, session, [messageId]);
    const db = env.MAIL_DB;
    const labels = await labelsFor(db, [row.id]);
    const { results: attachments } = await db.prepare("SELECT id, filename, mime_type, size, content_id, disposition FROM attachments WHERE message_id = ? ORDER BY position").bind(row.id).all();
    const body = row.direction === "draft" ? { html: "", text: "", headers: [] } : await messageBody(env, row);
    let delivery = null;
    if (row.direction === "out") {
        const outbound = await db.prepare("SELECT id, state, send_at, attempts, last_error FROM outbound WHERE message_id = ? ORDER BY created_at DESC LIMIT 1").bind(row.id).first();
        if (outbound) {
            const { results } = await db.prepare("SELECT recipient, status, detail, updated_at FROM delivery_recipients WHERE outbound_id = ?").bind(outbound.id).all();
            delivery = { id: outbound.id, state: outbound.state, sendAt: outbound.send_at, attempts: outbound.attempts, error: outbound.last_error, recipients: results };
        }
    }
    return {
        ...summary(row, labels.get(row.id) || []),
        bcc: row.direction === "in" ? [] : parseJson(row.bcc_json, []),
        replyTo: row.reply_to,
        messageIdHeader: row.message_id_header, inReplyTo: row.in_reply_to, references: row.references_header,
        auth: parseJson(row.auth_json, {}), spamReasons: parseJson(row.spam_reasons, []), spamScore: row.spam_score,
        listUnsubscribe: row.list_unsubscribe, listUnsubscribePost: Boolean(row.list_unsubscribe_post),
        html: body.html, text: body.text, headers: body.headers,
        attachmentList: attachments.map(item => ({ id: item.id, filename: item.filename, mimeType: item.mime_type, size: item.size, contentId: item.content_id, disposition: item.disposition })),
        delivery,
    };
}

export async function threadMessages(env, session, messageId) {
    const [row] = await ownedMessages(env, session, [messageId]);
    const { results } = await env.MAIL_DB.prepare("SELECT * FROM messages WHERE mailbox_id = ? AND thread_id = ? AND folder <> 'drafts' ORDER BY date ASC, num ASC").bind(row.mailbox_id, row.thread_id).all();
    const labels = await labelsFor(env.MAIL_DB, results.map(item => item.id));
    return results.map(item => summary(item, labels.get(item.id) || []));
}

async function validFolder(db, mailboxId, folder) {
    if (MOVABLE_FOLDERS.includes(folder)) return true;
    if (!/^f_[a-z0-9]{15}$/.test(folder)) return false;
    return Boolean(await db.prepare("SELECT 1 FROM folders WHERE id = ? AND mailbox_id = ?").bind(folder, mailboxId).first());
}

async function validLabels(db, mailboxId, labels) {
    const list = (Array.isArray(labels) ? labels : []).filter(value => typeof value === "string");
    if (!list.length) return [];
    const { results } = await db.prepare(`SELECT id FROM labels WHERE mailbox_id = ? AND id IN (${marks(list.slice(0, 90))})`).bind(mailboxId, ...list.slice(0, 90)).all();
    if (results.length !== new Set(list).size) fail(400, "invalidLabel");
    return results.map(row => row.id);
}

export async function updateMessages(env, session, execCtx, messageIds, patch) {
    const rows = await ownedMessages(env, session, messageIds);
    const db = env.MAIL_DB;
    const at = now();
    const statements = [];
    const touched = new Map();
    const checked = new Map();
    for (const row of rows) {
        if (row.mailbox_status === "suspended" && (patch.folder || patch.addLabels)) fail(403, "mailboxSuspended");
        const set = [];
        const values = [];
        const put = (column, value) => { set.push(`${column} = ?`); values.push(value); };
        if ("read" in patch) put("is_read", bool(patch.read));
        if ("starred" in patch) put("is_starred", bool(patch.starred));
        if ("important" in patch) put("is_important", bool(patch.important));
        if ("pinned" in patch) put("is_pinned", bool(patch.pinned));
        if ("category" in patch) { if (!CATEGORIES.has(patch.category)) fail(400, "invalidRequest"); put("category", patch.category); }
        if ("snoozeUntil" in patch) {
            if (patch.snoozeUntil !== null && !(Number.isFinite(patch.snoozeUntil) && patch.snoozeUntil > at)) fail(400, "invalidDate");
            put("snooze_until", patch.snoozeUntil);
            if (patch.snoozeUntil !== null && row.folder !== "inbox" && row.folder !== "archive") put("folder", "inbox");
        }
        if ("followUpAt" in patch) {
            if (patch.followUpAt !== null && !(Number.isFinite(patch.followUpAt) && patch.followUpAt > at)) fail(400, "invalidDate");
            put("follow_up_at", patch.followUpAt); put("follow_up_due", 0);
        }
        if (patch.folder !== undefined || patch.spam !== undefined) {
            const target = patch.spam === true ? "spam" : patch.spam === false ? "inbox" : patch.folder;
            const key = row.mailbox_id + ":" + target;
            if (!checked.has(key)) checked.set(key, await validFolder(db, row.mailbox_id, target));
            if (!checked.get(key)) fail(400, "invalidFolder");
            if (["drafts", "scheduled", "outbox"].includes(row.folder)) fail(409, "cannotMove");
            if (target !== row.folder) {
                put("folder", target);
                if (target === "trash") { put("trashed_at", at); put("previous_folder", row.folder); }
                else if (row.folder === "trash") { put("trashed_at", null); put("previous_folder", null); }
                else put("previous_folder", row.folder);
                if (target !== "inbox") put("snooze_until", null);
            }
            if (patch.spam === true && row.direction === "in" && row.from_addr) {
                statements.push(db.prepare("INSERT INTO abuse_reports (id, mailbox_id, sender, sender_domain, reason, created_at) VALUES (?, ?, ?, ?, 'userMarkedSpam', ?)")
                    .bind(id("ab_"), row.mailbox_id, row.from_addr, domainOf(row.from_addr), at));
            }
        }
        if (patch.restore === true && row.folder === "trash") {
            const target = row.previous_folder && row.previous_folder !== "trash" ? row.previous_folder : row.direction === "out" ? "sent" : "inbox";
            put("folder", target); put("trashed_at", null); put("previous_folder", null);
        }
        if (patch.addLabels?.length) {
            for (const label of await validLabels(db, row.mailbox_id, patch.addLabels)) statements.push(db.prepare("INSERT OR IGNORE INTO message_labels (message_id, label_id) VALUES (?, ?)").bind(row.id, label));
        }
        if (patch.removeLabels?.length) {
            const list = patch.removeLabels.filter(value => typeof value === "string").slice(0, 90);
            if (list.length) statements.push(db.prepare(`DELETE FROM message_labels WHERE message_id = ? AND label_id IN (${marks(list)})`).bind(row.id, ...list));
        }
        put("version", row.version + 1);
        put("updated_at", at);
        statements.push(db.prepare(`UPDATE messages SET ${set.join(", ")} WHERE id = ?`).bind(...values, row.id));
        statements.push(changeStatement(db, row.mailbox_id, "message", row.id, "upsert"));
        touched.set(row.owner_account, [...(touched.get(row.owner_account) || []), row.mailbox_id]);
    }
    for (const group of chunk(statements, 80)) await db.batch(group);
    for (const [account, boxes] of touched) scheduleNotify(env, execCtx, account, { type: "changes", mailboxes: [...new Set(boxes)] });
    return { updated: rows.length };
}

function messageHashes(row, attachmentHashes) {
    return [row.raw_hash, row.body_hash, row.draft_hash, ...attachmentHashes].filter(Boolean);
}

// Permanently deletes messages and releases storage once nothing else references the data.
export async function deleteMessages(env, session, execCtx, messageIds, { internal = false } = {}) {
    const rows = internal ? messageIds : await ownedMessages(env, session, messageIds);
    const db = env.MAIL_DB;
    const accounts = new Map();
    for (const group of chunk(rows, 25)) {
        const statements = [];
        const byMailbox = new Map();
        for (const row of group) {
            const { results } = await db.prepare("SELECT blob_hash FROM attachments WHERE message_id = ? AND blob_hash IS NOT NULL").bind(row.id).all();
            const hashes = messageHashes(row, results.map(item => item.blob_hash));
            byMailbox.set(row.mailbox_id, [...(byMailbox.get(row.mailbox_id) || []), ...hashes]);
            statements.push(
                db.prepare("DELETE FROM messages_fts WHERE rowid = ?").bind(row.num),
                db.prepare("UPDATE outbound SET state = 'canceled', updated_at = ? WHERE message_id = ? AND state IN ('queued', 'scheduled')").bind(now(), row.id),
                db.prepare("DELETE FROM messages WHERE id = ?").bind(row.id),
                db.prepare("UPDATE threads SET message_count = message_count - 1 WHERE id = ?").bind(row.thread_id),
                db.prepare("DELETE FROM threads WHERE id = ? AND message_count <= 0").bind(row.thread_id),
                changeStatement(db, row.mailbox_id, "message", row.id, "delete"),
            );
            if (row.owner_account) accounts.set(row.owner_account, [...(accounts.get(row.owner_account) || []), row.mailbox_id]);
        }
        for (const [mailboxId, hashes] of byMailbox) statements.push(...dropRefStatements(db, mailboxId, hashes), changeStatement(db, mailboxId, "storage", mailboxId, "upsert"));
        await db.batch(statements);
    }
    if (env.MAIL_JOBS) {
        const work = env.MAIL_JOBS.send({ type: "blob-deletions" }, { delaySeconds: 35 }).catch(() => {});
        if (execCtx?.waitUntil) execCtx.waitUntil(work);
    }
    for (const [account, boxes] of accounts) scheduleNotify(env, execCtx, account, { type: "changes", mailboxes: [...new Set(boxes)] });
    return { deleted: rows.length };
}

export async function emptyFolder(env, session, execCtx, mailbox, folder) {
    if (!["trash", "spam"].includes(folder)) fail(400, "invalidFolder");
    let deleted = 0;
    for (;;) {
        const { results } = await env.MAIL_DB.prepare("SELECT m.*, ? AS owner_account FROM messages m WHERE mailbox_id = ? AND folder = ? LIMIT 100").bind(mailbox.account_id, mailbox.id, folder).all();
        if (!results.length) break;
        deleted += (await deleteMessages(env, session, execCtx, results, { internal: true })).deleted;
    }
    return { deleted };
}

let postalMime;
export async function parseRaw(bytes) {
    postalMime ||= (await import("postal-mime")).default;
    return postalMime.parse(bytes, { attachmentEncoding: "arraybuffer" });
}

export async function attachmentContent(env, session, attachmentId) {
    if (!/^a_[a-z0-9]{15}$/.test(String(attachmentId))) fail(400, "invalidRequest");
    const attachment = await env.MAIL_DB.prepare("SELECT * FROM attachments WHERE id = ?").bind(attachmentId).first();
    if (!attachment) fail(404, "notFound");
    const [row] = await ownedMessages(env, session, [attachment.message_id]);
    let bytes;
    if (attachment.blob_hash) bytes = await readBlobBytes(env, row.mailbox_id, attachment.blob_hash);
    else if (row.raw_hash && Number.isInteger(attachment.part_index)) {
        const raw = await readBlobBytes(env, row.mailbox_id, row.raw_hash);
        if (raw) {
            const parsed = await parseRaw(raw);
            const part = parsed.attachments[attachment.part_index];
            if (part) bytes = new Uint8Array(part.content);
        }
    }
    if (!bytes) fail(404, "notFound");
    return { bytes, filename: attachment.filename, mimeType: attachment.mime_type, row, attachment };
}

// Original MIME for received mail; generated MIME (without Bcc) for composed mail.
export async function messageEml(env, session, messageId, preloaded = null) {
    const row = preloaded || (await ownedMessages(env, session, [messageId]))[0];
    if (row.raw_hash) {
        const raw = await readBlobBytes(env, row.mailbox_id, row.raw_hash);
        if (raw) return raw;
    }
    const body = await messageBody(env, row);
    const { results } = await env.MAIL_DB.prepare("SELECT * FROM attachments WHERE message_id = ? ORDER BY position").bind(row.id).all();
    const attachments = [];
    for (const item of results) {
        const content = item.blob_hash ? await readBlobBytes(env, row.mailbox_id, item.blob_hash) : null;
        if (content) attachments.push({ filename: item.filename, mimeType: item.mime_type, content, contentId: item.content_id, disposition: item.disposition });
    }
    const mime = buildMime({
        from: { email: row.from_addr, name: row.from_name }, to: parseJson(row.to_json, []), cc: parseJson(row.cc_json, []),
        subject: row.subject, date: row.date, messageId: row.message_id_header || undefined, inReplyTo: row.in_reply_to, references: row.references_header,
        priority: row.priority, html: body.html, text: body.text, attachments,
    });
    return new TextEncoder().encode(mime);
}
