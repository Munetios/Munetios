// Mailbox provisioning, ownership checks, aliases, per-mailbox settings, and the change feed.
import { legacyStore, reservedAddress } from "./legacy.js";
import { storeBlob } from "./storage.js";
import { fail, id, isInternal, normalizeEmail, now, validEmail, cleanHeaderText, parseJson, snippetOf, subjectKey, htmlToText, QUOTA_BYTES } from "./util.js";

export const DEFAULT_SETTINGS = Object.freeze({
    vacation: { enabled: false, subject: "", message: "", start: null, end: null, contactsOnly: false },
    forwarding: { enabled: false, address: "", verified: false, keepCopy: true },
    retention: { trashDays: 30, spamDays: 30 },
    autoArchive: { enabled: false, days: 30, readOnly: true },
    remoteContent: "block",
    categories: true,
    spamSensitivity: "standard",
    undoSendSeconds: 10,
    defaultPriority: "normal",
});

export function mailboxJson(row) {
    return {
        id: row.id, accountId: row.account_id, address: row.address, kind: row.kind, displayName: row.display_name,
        hasPicture: Boolean(row.picture_hash), status: row.status, position: row.position,
        storage: { usedBytes: row.used_bytes, reservedBytes: row.reserved_bytes, quotaBytes: row.quota_bytes },
    };
}

// Creates mailboxes for signed-in accounts that are entitled to one (idempotent).
export async function ensureMailboxes(env, session, execCtx) {
    const ids = [...session.accountIds];
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await env.MAIL_DB.prepare(`SELECT * FROM mailboxes WHERE account_id IN (${placeholders}) ORDER BY position, created_at`).bind(...ids).all();
    const have = new Set(results.map(row => row.account_id));
    const legacy = legacyStore(env);
    const all = [session.account, ...session.accounts];
    for (const account of all) {
        if (have.has(account.id)) continue;
        const created = await provision(env, legacy, account);
        if (created) results.push(created);
    }
    for (const row of results) {
        if (!row.legacy_imported && execCtx?.waitUntil) execCtx.waitUntil(importLegacy(env, row).catch(() => {}));
    }
    return results.filter(row => row.status !== "deleting");
}

export function provisionAccount(env, account) {
    return provision(env, legacyStore(env), account);
}

async function provision(env, legacy, account) {
    let address;
    let kind = "personal";
    if (isInternal(account.email)) {
        if (!await legacy.hasMailbox(account.id)) return null;
        address = account.email;
    } else {
        kind = "forwarding";
        address = await legacy.aliasFor(account.id);
        if (!address) {
            const bytes = crypto.getRandomValues(new Uint8Array(16));
            address = "inbox-" + [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("") + "@munetios.com";
        }
    }
    const retired = await env.MAIL_DB.prepare("SELECT 1 FROM retired_addresses WHERE address = ?").bind(address).first();
    if (retired && kind === "personal") return null;
    const at = now();
    const row = {
        id: id("mb_"), account_id: account.id, address, kind, display_name: cleanHeaderText(account.displayName, 200), picture_hash: null,
        status: "active", quota_bytes: Number(env.MAIL_QUOTA_BYTES) || QUOTA_BYTES, used_bytes: 0, reserved_bytes: 0, warned_level: 0,
        legacy_imported: 0, position: 0, created_at: at, updated_at: at,
    };
    const result = await env.MAIL_DB.prepare(
        "INSERT INTO mailboxes (id, account_id, address, kind, display_name, status, quota_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?) ON CONFLICT (address) DO NOTHING")
        .bind(row.id, row.account_id, row.address, row.kind, row.display_name, row.quota_bytes, at, at).run();
    if (!result.meta.changes) {
        const existing = await env.MAIL_DB.prepare("SELECT * FROM mailboxes WHERE address = ?").bind(address).first();
        return existing?.account_id === account.id ? existing : null;
    }
    await env.MAIL_DB.prepare("INSERT INTO mailbox_settings (mailbox_id, data_json, updated_at) VALUES (?, ?, ?)").bind(row.id, JSON.stringify(DEFAULT_SETTINGS), at).run();
    return row;
}

// Copies messages from the earlier plain-text Mail into this mailbox, a page at a time.
async function importLegacy(env, mailbox) {
    const legacy = legacyStore(env);
    let after = 0;
    const marker = await env.MAIL_DB.prepare("SELECT data_json FROM mailbox_settings WHERE mailbox_id = ?").bind(mailbox.id).first();
    const state = parseJson(marker?.data_json, {});
    after = Number(state.legacyCursor) || 0;
    for (let page = 0; page < 20; page++) {
        const rows = await legacy.messages(mailbox.account_id, after, 100);
        if (!rows.length) break;
        for (const item of rows) {
            after = Number(item.id);
            const body = { html: typeof item.html === "string" ? item.html : "", text: String(item.body || "") };
            const created = Date.parse(String(item.created_at).replace(" ", "T") + (String(item.created_at).endsWith("Z") ? "" : "Z")) || now();
            const messageId = id("m_");
            const dedupe = "legacy:" + item.direction + ":" + item.message_key;
            const exists = await env.MAIL_DB.prepare("SELECT 1 FROM messages WHERE mailbox_id = ? AND dedupe_key = ?").bind(mailbox.id, dedupe).first();
            if (exists) continue;
            let stored;
            try { stored = await storeBlob(env, mailbox.id, new TextEncoder().encode(JSON.stringify(body)), { contentType: "application/json" }); }
            catch { return; } // quota or storage error: try again on the next visit
            const outgoing = item.direction === "sent";
            const subject = cleanHeaderText(item.subject, 500);
            const text = body.text || htmlToText(body.html);
            const threadId = await resolveThread(env.MAIL_DB, mailbox.id, subject, created);
            await env.MAIL_DB.batch([
                ...threadStatements(env.MAIL_DB, mailbox.id, threadId, subject, created),
                env.MAIL_DB.prepare(
                    "INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, storage, subject, from_addr, to_json, snippet, date, size_bytes, is_read, body_hash, dedupe_key, created_at, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, 'structured', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
                    .bind(messageId, mailbox.id, threadId, outgoing ? "sent" : "inbox", outgoing ? "out" : "in", subject, normalizeEmail(item.sender),
                        JSON.stringify([{ email: normalizeEmail(item.recipient), name: "" }]), snippetOf(text), created, stored.size, stored.hash, dedupe, now(), now()),
                ...ftsStatements(env.MAIL_DB, messageId, subject, `${item.sender} ${item.recipient}`, text, ""),
                changeStatement(env.MAIL_DB, mailbox.id, "message", messageId, "upsert"),
            ]);
        }
        state.legacyCursor = after;
        await env.MAIL_DB.prepare("UPDATE mailbox_settings SET data_json = ? WHERE mailbox_id = ?").bind(JSON.stringify(state), mailbox.id).run();
    }
    if (!(await legacy.messages(mailbox.account_id, after, 1)).length) {
        await env.MAIL_DB.prepare("UPDATE mailboxes SET legacy_imported = 1 WHERE id = ?").bind(mailbox.id).run();
    }
}

// Finds the conversation for a message: In-Reply-To/References first, then the subject within 60 days.
export async function resolveThread(db, mailboxId, subject, date, headerIds = []) {
    const ids = headerIds.filter(Boolean).slice(-20);
    if (ids.length) {
        const row = await db.prepare(`SELECT thread_id FROM messages WHERE mailbox_id = ? AND message_id_header IN (${ids.map(() => "?").join(",")}) ORDER BY date DESC LIMIT 1`).bind(mailboxId, ...ids).first();
        if (row) return row.thread_id;
    }
    const key = subjectKey(subject);
    if (key) {
        const row = await db.prepare("SELECT id FROM threads WHERE mailbox_id = ? AND subject_key = ? AND last_date > ? ORDER BY last_date DESC LIMIT 1").bind(mailboxId, key, date - 5_184_000_000).first();
        if (row) return row.id;
    }
    return id("t_");
}

export function threadStatements(db, mailboxId, threadId, subject, date) {
    return [db.prepare("INSERT INTO threads (id, mailbox_id, subject_key, last_date, message_count) VALUES (?, ?, ?, ?, 1) ON CONFLICT (id) DO UPDATE SET last_date = MAX(last_date, excluded.last_date), message_count = message_count + 1")
        .bind(threadId, mailboxId, subjectKey(subject), date)];
}

export function ftsStatements(db, messageId, subject, people, body, filenames) {
    return [db.prepare("INSERT INTO messages_fts (rowid, subject, people, body, filenames) SELECT num, ?, ?, ?, ? FROM messages WHERE id = ?")
        .bind(subject, people, [...String(body || "")].slice(0, 32000).join(""), filenames, messageId)];
}

export async function accessibleMailboxes(env, session) {
    const ids = [...session.accountIds];
    const { results } = await env.MAIL_DB.prepare(`SELECT * FROM mailboxes WHERE account_id IN (${ids.map(() => "?").join(",")}) AND status <> 'deleting' ORDER BY position, created_at`).bind(...ids).all();
    return results;
}

// Every request names its mailbox; it must belong to one of this browser's signed-in accounts.
export async function requireMailbox(env, session, mailboxId, { write = false } = {}) {
    if (typeof mailboxId !== "string" || !/^mb_[a-z0-9]{15}$/.test(mailboxId)) fail(400, "invalidRequest");
    const row = await env.MAIL_DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(mailboxId).first();
    if (!row || !session.accountIds.has(row.account_id) || row.status === "deleting") fail(404, "mailboxUnavailable");
    if (write && row.status === "suspended") fail(403, "mailboxSuspended");
    return row;
}

export async function senderAddresses(env, mailbox) {
    const { results } = await env.MAIL_DB.prepare("SELECT address, display_name FROM aliases WHERE mailbox_id = ? AND can_send = 1").bind(mailbox.id).all();
    return [{ address: mailbox.address, displayName: mailbox.display_name, primary: true }, ...results.map(row => ({ address: row.address, displayName: row.display_name, primary: false }))];
}

export async function createAlias(env, mailbox, input) {
    const address = normalizeEmail(input?.address);
    if (!validEmail(address) || !isInternal(address) || !/^[a-z0-9][a-z0-9._-]{2,40}@munetios\.com$/.test(address)) fail(400, "invalidAddress");
    if (reservedAddress(address, env)) fail(409, "addressUnavailable");
    const legacy = legacyStore(env);
    if (await legacy.addressTaken(address)) fail(409, "addressUnavailable");
    const taken = await env.MAIL_DB.prepare("SELECT 1 FROM mailboxes WHERE address = ?1 UNION SELECT 1 FROM aliases WHERE address = ?1 UNION SELECT 1 FROM retired_addresses WHERE address = ?1").bind(address).first();
    if (taken) fail(409, "addressUnavailable");
    const alias = { id: id("al_"), address, displayName: cleanHeaderText(input?.displayName, 200) };
    try {
        await env.MAIL_DB.prepare("INSERT INTO aliases (id, mailbox_id, address, display_name, created_at) VALUES (?, ?, ?, ?, ?)").bind(alias.id, mailbox.id, address, alias.displayName, now()).run();
    } catch { fail(409, "addressUnavailable"); }
    return alias;
}

export async function deleteAlias(env, mailbox, aliasId) {
    const row = await env.MAIL_DB.prepare("SELECT address FROM aliases WHERE id = ? AND mailbox_id = ?").bind(aliasId, mailbox.id).first();
    if (!row) fail(404, "notFound");
    // Released aliases are retired so nobody else can receive mail meant for them.
    await env.MAIL_DB.batch([
        env.MAIL_DB.prepare("DELETE FROM aliases WHERE id = ?").bind(aliasId),
        env.MAIL_DB.prepare("INSERT OR IGNORE INTO retired_addresses (address, retired_at) VALUES (?, ?)").bind(row.address, now()),
    ]);
}

export async function mailboxSettings(env, mailboxId) {
    const row = await env.MAIL_DB.prepare("SELECT data_json FROM mailbox_settings WHERE mailbox_id = ?").bind(mailboxId).first();
    const stored = parseJson(row?.data_json, {});
    const merged = structuredClone(DEFAULT_SETTINGS);
    for (const [key, value] of Object.entries(stored)) {
        if (!(key in merged)) { merged[key] = value; continue; }
        merged[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...merged[key], ...value } : value;
    }
    return merged;
}

const clampInt = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;

export async function saveMailboxSettings(env, mailbox, input) {
    const current = await mailboxSettings(env, mailbox.id);
    const next = structuredClone(current);
    if (input.vacation) {
        const v = input.vacation;
        next.vacation = {
            enabled: Boolean(v.enabled), subject: cleanHeaderText(v.subject, 300), message: String(v.message || "").slice(0, 20000),
            start: Number.isFinite(v.start) ? v.start : null, end: Number.isFinite(v.end) ? v.end : null, contactsOnly: Boolean(v.contactsOnly),
        };
    }
    if (input.forwarding) {
        const address = normalizeEmail(input.forwarding.address);
        if (input.forwarding.enabled && !validEmail(address)) fail(400, "invalidAddress");
        const changed = address !== current.forwarding.address;
        next.forwarding = { ...current.forwarding, enabled: Boolean(input.forwarding.enabled) && !changed ? Boolean(input.forwarding.enabled) && current.forwarding.verified : false,
            address, keepCopy: input.forwarding.keepCopy !== false, verified: changed ? false : current.forwarding.verified };
        if (changed) { delete next.forwarding.codeHash; delete next.forwarding.codeExpires; }
    }
    if (input.retention) next.retention = { trashDays: clampInt(input.retention.trashDays, 0, 3650, 30), spamDays: clampInt(input.retention.spamDays, 0, 3650, 30) };
    if (input.autoArchive) next.autoArchive = { enabled: Boolean(input.autoArchive.enabled), days: clampInt(input.autoArchive.days, 1, 3650, 30), readOnly: input.autoArchive.readOnly !== false };
    if (["block", "ask", "proxy", "allow"].includes(input.remoteContent)) next.remoteContent = input.remoteContent;
    if ("categories" in input) next.categories = Boolean(input.categories);
    if (["relaxed", "standard", "strict"].includes(input.spamSensitivity)) next.spamSensitivity = input.spamSensitivity;
    if ("undoSendSeconds" in input) next.undoSendSeconds = clampInt(input.undoSendSeconds, 0, 120, 10);
    if (["low", "normal", "high"].includes(input.defaultPriority)) next.defaultPriority = input.defaultPriority;
    await env.MAIL_DB.prepare("INSERT INTO mailbox_settings (mailbox_id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (mailbox_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at")
        .bind(mailbox.id, JSON.stringify(next), now()).run();
    if ("displayName" in input) {
        await env.MAIL_DB.prepare("UPDATE mailboxes SET display_name = ?, updated_at = ? WHERE id = ?").bind(cleanHeaderText(input.displayName, 200), now(), mailbox.id).run();
    }
    return publicSettings(next);
}

export function publicSettings(settings) {
    const copy = structuredClone(settings);
    if (copy.forwarding) { delete copy.forwarding.codeHash; delete copy.forwarding.codeExpires; }
    // Only the address and expiry of a pending link are shown; the code hash stays on the server.
    if (copy.linkPending) copy.linkPending = { address: copy.linkPending.address, expires: copy.linkPending.codeExpires };
    if (!Array.isArray(copy.linked)) copy.linked = [];
    delete copy.legacyCursor;
    return copy;
}

export function changeStatement(db, mailboxId, entity, entityId, op) {
    return db.prepare("INSERT INTO changes (mailbox_id, entity, entity_id, op, at) VALUES (?, ?, ?, ?, ?)").bind(mailboxId, entity, String(entityId), op, now());
}

// Pushes a small notification to the account's live connections. Never includes content.
export async function notify(env, accountId, event) {
    if (!env.MAIL_HUB) return;
    try {
        const stub = env.MAIL_HUB.get(env.MAIL_HUB.idFromName("account:" + accountId));
        await stub.fetch("https://hub/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) });
    } catch { /* clients fall back to polling */ }
}

export function scheduleNotify(env, execCtx, accountId, event) {
    const work = notify(env, accountId, event);
    if (execCtx?.waitUntil) execCtx.waitUntil(work); else return work;
}

export async function latestSeq(env, mailboxIds) {
    if (!mailboxIds.length) return 0;
    const row = await env.MAIL_DB.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE mailbox_id IN (${mailboxIds.map(() => "?").join(",")})`).bind(...mailboxIds).first();
    return row.seq;
}

export async function changesSince(env, mailboxIds, since, limit = 500) {
    if (!mailboxIds.length) return { changes: [], seq: since };
    const { results } = await env.MAIL_DB.prepare(
        `SELECT seq, mailbox_id AS mailboxId, entity, entity_id AS entityId, op FROM changes WHERE mailbox_id IN (${mailboxIds.map(() => "?").join(",")}) AND seq > ? ORDER BY seq LIMIT ?`)
        .bind(...mailboxIds, since, limit).all();
    return { changes: results, seq: results.length ? results.at(-1).seq : since, more: results.length === limit };
}

