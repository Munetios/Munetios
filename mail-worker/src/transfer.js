// Mailbox export (mbox, built in R2 with a resumable multipart upload), message import, settings backup and
// restore, and contact import/export (vCard and CSV).
import { messageEml } from "./messages.js";
import { deliverInbound } from "./inbound.js";
import { mboxEntry } from "./mime.js";
import { listFolders, listLabels, listFilters, listSignatures, listSavedSearches, listSenders, saveFolder, saveLabel, saveFilter, saveSignature, saveSearch, addSender, saveContact } from "./organize.js";
import { mailboxSettings, publicSettings, saveMailboxSettings } from "./mailbox.js";
import { fail, id, now, readBytes, MAX_MESSAGE_BYTES, normalizeEmail, validEmail, opsLog } from "./util.js";

const PART = 8 * 1024 * 1024;
export const exportKey = (mailboxId, exportId) => `m/${mailboxId}/exports/${exportId}.mbox`;

export async function startExport(env, mailbox) {
    const running = await env.MAIL_DB.prepare("SELECT id FROM exports WHERE mailbox_id = ? AND state IN ('queued', 'running')").bind(mailbox.id).first();
    if (running) return { id: running.id, state: "running" };
    const exportId = id("ex_");
    await env.MAIL_DB.prepare("INSERT INTO exports (id, mailbox_id, account_id, state, created_at, expires_at) VALUES (?, ?, ?, 'queued', ?, ?)")
        .bind(exportId, mailbox.id, mailbox.account_id, now(), now() + 7 * 86_400_000).run();
    if (!env.MAIL_JOBS) fail(503, "unavailable");
    await env.MAIL_JOBS.send({ type: "export", exportId });
    return { id: exportId, state: "queued" };
}

export async function listExports(env, mailbox) {
    const { results } = await env.MAIL_DB.prepare("SELECT id, state, message_count AS messageCount, size, created_at AS createdAt, expires_at AS expiresAt FROM exports WHERE mailbox_id = ? ORDER BY created_at DESC").bind(mailbox.id).all();
    return results;
}

// Queue job. Processes for about 60 seconds per run, then saves its place and continues in the next run.
export async function processExport(env, exportId) {
    const db = env.MAIL_DB;
    const job = await db.prepare("SELECT e.*, b.address FROM exports e JOIN mailboxes b ON b.id = e.mailbox_id WHERE e.id = ? AND e.state IN ('queued', 'running')").bind(exportId).first();
    if (!job) return {};
    const key = exportKey(job.mailbox_id, job.id);
    const upload = job.upload_id ? env.MAIL_STORE.resumeMultipartUpload(key, job.upload_id) : await env.MAIL_STORE.createMultipartUpload(key, { httpMetadata: { contentType: "application/mbox" } });
    const parts = JSON.parse(job.parts_json || "[]");
    const carryKey = key + ".carry";
    let cursor = job.cursor;
    let count = job.message_count;
    let size = job.size;
    // R2 needs every part except the last to have the same size, so leftover bytes carry over between runs.
    const carried = job.upload_id ? await env.MAIL_STORE.get(carryKey) : null;
    let buffer = carried ? [new Uint8Array(await carried.arrayBuffer())] : [];
    let buffered = buffer.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const encoder = new TextEncoder();
    const started = Date.now();
    const joined = () => {
        const bytes = new Uint8Array(buffered);
        let offset = 0;
        for (const chunk of buffer) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
    };
    const uploadFullParts = async () => {
        if (buffered < PART) return;
        const bytes = joined();
        let offset = 0;
        while (bytes.byteLength - offset >= PART) {
            const part = await upload.uploadPart(parts.length + 1, bytes.subarray(offset, offset + PART));
            parts.push({ partNumber: part.partNumber, etag: part.etag });
            offset += PART;
        }
        buffer = [bytes.slice(offset)];
        buffered = bytes.byteLength - offset;
    };
    let done = false;
    while (Date.now() - started < 60_000) {
        const { results } = await db.prepare("SELECT m.*, ? AS owner_account FROM messages m WHERE mailbox_id = ? AND num > ? AND direction <> 'draft' ORDER BY num LIMIT 50").bind(job.account_id, job.mailbox_id, cursor).all();
        if (!results.length) { done = true; break; }
        for (const row of results) {
            const raw = await messageEml(env, null, row.id, row).catch(() => null);
            cursor = row.num;
            if (!raw) continue;
            const entry = encoder.encode(mboxEntry(row.from_addr, row.date, raw));
            buffer.push(entry); buffered += entry.byteLength; size += entry.byteLength; count++;
            await uploadFullParts();
        }
    }
    if (done) {
        if (buffered || !parts.length) {
            const part = await upload.uploadPart(parts.length + 1, joined());
            parts.push({ partNumber: part.partNumber, etag: part.etag });
        }
        await upload.complete(parts);
        await env.MAIL_STORE.delete(carryKey);
        await db.prepare("UPDATE exports SET state = 'ready', cursor = ?, message_count = ?, size = ?, parts_json = '[]', upload_id = NULL WHERE id = ?").bind(cursor, count, size, job.id).run();
        await opsLog(db, "export", "ready");
        return {};
    }
    await env.MAIL_STORE.put(carryKey, joined());
    await db.prepare("UPDATE exports SET state = 'running', upload_id = ?, parts_json = ?, cursor = ?, message_count = ?, size = ? WHERE id = ?")
        .bind(upload.uploadId, JSON.stringify(parts), cursor, count, size, job.id).run();
    return { continue: true };
}

export async function exportObject(env, session, exportId) {
    const row = await env.MAIL_DB.prepare("SELECT * FROM exports WHERE id = ?").bind(String(exportId)).first();
    if (!row || !session.accountIds.has(row.account_id) || row.state !== "ready") fail(404, "notFound");
    const object = await env.MAIL_STORE.get(exportKey(row.mailbox_id, row.id));
    if (!object) fail(404, "notFound");
    return { object, row };
}

// One .eml per request; the browser splits mbox files into messages before uploading them.
export async function importEml(env, execCtx, mailbox, request, folder, read) {
    if (mailbox.status !== "active") fail(403, "mailboxSuspended");
    const declared = Number(request.headers.get("Content-Length"));
    if (!Number.isFinite(declared) || declared <= 0) fail(411, "lengthRequired");
    if (declared > MAX_MESSAGE_BYTES) fail(413, "tooLarge");
    const bytes = await readBytes(request, declared);
    if (!/^[\x09\x0a\x0d\x20-\x7e]*:/.test(new TextDecoder().decode(bytes.subarray(0, 200)))) fail(400, "invalidMessage");
    if (folder.startsWith("f_")) {
        const exists = await env.MAIL_DB.prepare("SELECT 1 FROM folders WHERE id = ? AND mailbox_id = ?").bind(folder, mailbox.id).first();
        if (!exists) fail(400, "invalidFolder");
    } else if (!["inbox", "archive", "sent", "spam", "trash"].includes(folder)) fail(400, "invalidFolder");
    let rejected = null;
    const result = await deliverInbound(env, { from: "", to: mailbox.address, rawSize: bytes.byteLength, raw: async () => bytes, reject: reason => { rejected = reason; } }, execCtx,
        { import: { mailbox, folder, read: Boolean(read) } });
    if (rejected) fail(rejected.includes("full") ? 507 : 400, rejected.includes("full") ? "quotaExceeded" : "invalidMessage");
    return result;
}

export async function exportSettings(env, mailbox) {
    const { results: contacts } = await env.MAIL_DB.prepare("SELECT name, email, phone, company, notes, favorite FROM contacts WHERE mailbox_id = ? AND auto = 0").bind(mailbox.id).all();
    return {
        format: "munetios-mail-settings", version: 1, exportedAt: now(), address: mailbox.address,
        settings: publicSettings(await mailboxSettings(env, mailbox.id)), displayName: mailbox.display_name,
        folders: await listFolders(env, [mailbox.id]), labels: await listLabels(env, [mailbox.id]), filters: await listFilters(env, mailbox),
        signatures: await listSignatures(env, mailbox), savedSearches: await listSavedSearches(env, [mailbox.id]), senders: await listSenders(env, mailbox), contacts,
    };
}

// Restores a settings backup. Existing items are kept; IDs are remapped for folders and labels.
export async function restoreSettings(env, mailbox, data) {
    if (data?.format !== "munetios-mail-settings") fail(400, "invalidBackup");
    const folderMap = new Map();
    const labelMap = new Map();
    const pending = [...(Array.isArray(data.folders) ? data.folders : [])];
    for (let guard = 0; pending.length && guard < 10_000; guard++) {
        const folder = pending.shift();
        if (folder.parentId && !folderMap.has(folder.parentId) && pending.some(item => item.id === folder.parentId)) { pending.push(folder); continue; }
        const created = await saveFolder(env, mailbox, { name: folder.name, color: folder.color, icon: folder.icon, favorite: folder.favorite, parentId: folderMap.get(folder.parentId) || null }).catch(() => null);
        if (created) folderMap.set(folder.id, created.id);
    }
    for (const label of Array.isArray(data.labels) ? data.labels : []) {
        const existing = await env.MAIL_DB.prepare("SELECT id FROM labels WHERE mailbox_id = ? AND name = ?").bind(mailbox.id, String(label.name || "")).first();
        const created = existing || await saveLabel(env, mailbox, { name: label.name, color: label.color, icon: label.icon, favorite: label.favorite }).catch(() => null);
        if (created) labelMap.set(label.id, created.id);
    }
    for (const filter of Array.isArray(data.filters) ? data.filters : []) {
        const actions = (filter.actions || []).map(action => ({ ...action, value: action.type === "move" ? folderMap.get(action.value) || action.value : action.type === "label" ? labelMap.get(action.value) || action.value : action.value }));
        await saveFilter(env, mailbox, { ...filter, actions }).catch(() => null);
    }
    for (const signature of Array.isArray(data.signatures) ? data.signatures : []) await saveSignature(env, mailbox, signature).catch(() => null);
    for (const search of Array.isArray(data.savedSearches) ? data.savedSearches : []) await saveSearch(env, mailbox, search).catch(() => null);
    for (const sender of Array.isArray(data.senders) ? data.senders : []) await addSender(env, mailbox, sender.list, sender.pattern).catch(() => null);
    for (const contact of Array.isArray(data.contacts) ? data.contacts : []) await saveContact(env, mailbox, contact).catch(() => null);
    if (data.settings && typeof data.settings === "object") {
        const { forwarding, ...rest } = data.settings; // forwarding must be verified again
        await saveMailboxSettings(env, mailbox, rest);
    }
    return { restored: true };
}

/* ------------------------------------------------------------------ contacts import/export */
const vEscape = value => String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, match => "\\" + match);
const vUnescape = value => String(value || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const csvCell = value => /[",\n\r]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value ?? "");

export async function exportContacts(env, mailbox, format) {
    const { results } = await env.MAIL_DB.prepare("SELECT name, email, phone, company, notes FROM contacts WHERE mailbox_id = ? ORDER BY name COLLATE NOCASE").bind(mailbox.id).all();
    if (format === "csv") return ["Name,Email,Phone,Company,Notes", ...results.map(row => [row.name, row.email, row.phone, row.company, row.notes].map(csvCell).join(","))].join("\r\n");
    return results.map(row => ["BEGIN:VCARD", "VERSION:3.0", `FN:${vEscape(row.name || row.email)}`, `EMAIL;TYPE=INTERNET:${row.email}`,
        row.phone ? `TEL:${vEscape(row.phone)}` : null, row.company ? `ORG:${vEscape(row.company)}` : null, row.notes ? `NOTE:${vEscape(row.notes)}` : null, "END:VCARD"].filter(Boolean).join("\r\n")).join("\r\n");
}

function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; continue; }
        if (c === '"') quoted = true;
        else if (c === ",") { row.push(cell); cell = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
        else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

export async function importContacts(env, mailbox, text) {
    const source = String(text || "").slice(0, 5 * 1024 * 1024);
    const people = [];
    if (/BEGIN:VCARD/i.test(source)) {
        const unfolded = source.replace(/\r?\n[ \t]/g, "");
        for (const card of unfolded.split(/BEGIN:VCARD/i).slice(1)) {
            const field = name => (new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "im").exec(card)?.[1] || "").trim();
            people.push({ name: vUnescape(field("FN")), email: field("EMAIL"), phone: vUnescape(field("TEL")), company: vUnescape(field("ORG")).split(";")[0], notes: vUnescape(field("NOTE")) });
        }
    } else {
        const rows = parseCsv(source);
        const head = (rows.shift() || []).map(value => value.trim().toLowerCase());
        const col = (...names) => head.findIndex(value => names.some(name => value.includes(name)));
        const [n, e, p, c, o] = [col("name"), col("e-mail", "email"), col("phone", "mobile"), col("company", "organization"), col("note")];
        for (const row of rows) people.push({ name: row[n] || "", email: row[e] || "", phone: row[p] || "", company: row[c] || "", notes: row[o] || "" });
    }
    let imported = 0;
    for (const person of people) {
        if (!validEmail(normalizeEmail(person.email))) continue;
        await saveContact(env, mailbox, person).then(() => imported++).catch(() => {});
    }
    return { imported, skipped: people.length - imported };
}
