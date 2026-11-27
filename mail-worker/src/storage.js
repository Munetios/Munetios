// Quota, reservations, and content-addressed R2 objects with reference counts.
// used_bytes counts each stored object once per mailbox; reserved_bytes holds space for work in progress.
import { fail, id, now, sha256Hex } from "./util.js";

export const blobKey = (mailboxId, hash) => `m/${mailboxId}/b/${hash}`;
export const WARNING_LEVELS = [80, 90, 95, 100];

// Reserves space atomically. D1 runs a batch as one transaction, so concurrent
// reservations can never push used + reserved above the quota.
export async function reserve(env, mailboxId, bytes, purpose, ttlMs = 15 * 60_000, { allowSuspended = false } = {}) {
    const size = Math.max(1, Math.ceil(Number(bytes) || 0));
    const reservationId = id("r_");
    const status = allowSuspended ? "status IN ('active', 'suspended')" : "status = 'active'";
    const [update] = await env.MAIL_DB.batch([
        env.MAIL_DB.prepare(`UPDATE mailboxes SET reserved_bytes = reserved_bytes + ?1 WHERE id = ?2 AND ${status} AND used_bytes + reserved_bytes + ?1 <= quota_bytes`).bind(size, mailboxId),
        env.MAIL_DB.prepare("INSERT INTO reservations (id, mailbox_id, bytes, purpose, expires_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1")
            .bind(reservationId, mailboxId, size, purpose, now() + ttlMs),
    ]);
    if (!update.meta.changes) {
        const row = await env.MAIL_DB.prepare("SELECT status, used_bytes, reserved_bytes, quota_bytes FROM mailboxes WHERE id = ?").bind(mailboxId).first();
        if (!row) fail(404, "mailboxUnavailable");
        if (row.status !== "active" && !(allowSuspended && row.status === "suspended")) fail(403, "mailboxSuspended");
        fail(507, "quotaExceeded", { usedBytes: row.used_bytes, quotaBytes: row.quota_bytes, neededBytes: size });
    }
    return { id: reservationId, bytes: size };
}

export function releaseStatements(db, reservationId) {
    return [
        db.prepare("UPDATE mailboxes SET reserved_bytes = MAX(0, reserved_bytes - COALESCE((SELECT bytes FROM reservations WHERE id = ?1), 0)) WHERE id = (SELECT mailbox_id FROM reservations WHERE id = ?1)").bind(reservationId),
        db.prepare("DELETE FROM reservations WHERE id = ?").bind(reservationId),
    ];
}

export async function release(env, reservation) {
    if (!reservation) return;
    await env.MAIL_DB.batch(releaseStatements(env.MAIL_DB, reservation.id || reservation));
}

// Statements that add one reference to an object, charging its size only when it is new.
export function addBlobStatements(db, mailboxId, hash, size, category) {
    return [
        db.prepare("INSERT INTO blobs (mailbox_id, hash, size, ref_count, category, created_at) VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT (mailbox_id, hash) DO NOTHING")
            .bind(mailboxId, hash, size, category, now()),
        db.prepare("UPDATE mailboxes SET used_bytes = used_bytes + ? WHERE id = ? AND changes() = 1").bind(size, mailboxId),
        db.prepare("UPDATE blobs SET ref_count = ref_count + 1 WHERE mailbox_id = ? AND hash = ?").bind(mailboxId, hash),
    ];
}

export function addRefStatement(db, mailboxId, hash) {
    return db.prepare("UPDATE blobs SET ref_count = ref_count + 1 WHERE mailbox_id = ? AND hash = ?").bind(mailboxId, hash);
}

// Statements that drop references; objects reaching zero release their space and queue the R2 deletion.
export function dropRefStatements(db, mailboxId, hashes) {
    const list = hashes.filter(Boolean);
    if (!list.length) return [];
    return [
        ...list.map(hash => db.prepare("UPDATE blobs SET ref_count = ref_count - 1 WHERE mailbox_id = ? AND hash = ?").bind(mailboxId, hash)),
        ...collectUnreferencedStatements(db, mailboxId),
    ];
}

export function collectUnreferencedStatements(db, mailboxId) {
    return [
        db.prepare("INSERT OR IGNORE INTO blob_deletions (r2_key, queued_at) SELECT 'm/' || mailbox_id || '/b/' || hash, ? FROM blobs WHERE mailbox_id = ? AND ref_count <= 0").bind(now(), mailboxId),
        db.prepare("UPDATE mailboxes SET used_bytes = MAX(0, used_bytes - (SELECT COALESCE(SUM(size), 0) FROM blobs WHERE mailbox_id = ?1 AND ref_count <= 0)) WHERE id = ?1").bind(mailboxId),
        db.prepare("DELETE FROM blobs WHERE mailbox_id = ? AND ref_count <= 0").bind(mailboxId),
    ];
}

// Writes the bytes to R2 (always, so a concurrent deletion can't leave a row without its object),
// then records the reference. When a reservation is given, its space converts into usage.
export async function storeBlob(env, mailboxId, bytes, { category = "mail", reservation = null, contentType = "application/octet-stream", extraStatements = [] } = {}) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const hash = await sha256Hex(data);
    let ownReservation = null;
    if (!reservation) ownReservation = reservation = await reserve(env, mailboxId, data.byteLength, "blob");
    try {
        await env.MAIL_STORE.put(blobKey(mailboxId, hash), data, { httpMetadata: { contentType } });
        await env.MAIL_DB.batch([
            ...addBlobStatements(env.MAIL_DB, mailboxId, hash, data.byteLength, category),
            ...(ownReservation ? releaseStatements(env.MAIL_DB, ownReservation.id) : []),
            ...extraStatements,
        ]);
    } catch (error) {
        if (ownReservation) await release(env, ownReservation).catch(() => {});
        throw error;
    }
    return { hash, size: data.byteLength };
}

export async function readBlob(env, mailboxId, hash) {
    if (!hash) return null;
    return env.MAIL_STORE.get(blobKey(mailboxId, hash));
}

export async function readBlobBytes(env, mailboxId, hash) {
    const object = await readBlob(env, mailboxId, hash);
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

export async function readBlobJson(env, mailboxId, hash) {
    const object = await readBlob(env, mailboxId, hash);
    if (!object) return null;
    try { return JSON.parse(await object.text()); } catch { return null; }
}

// Deletes R2 objects whose rows are gone. A short grace period and a row re-check
// protect objects that were just stored again by a concurrent request.
export async function processBlobDeletions(env, limit = 500) {
    const { results } = await env.MAIL_DB.prepare("SELECT r2_key FROM blob_deletions WHERE queued_at <= ? ORDER BY queued_at LIMIT ?").bind(now() - 30_000, limit).all();
    let deleted = 0;
    for (const { r2_key: key } of results) {
        const [, mailboxId, , hash] = key.split("/");
        const live = await env.MAIL_DB.prepare("SELECT 1 FROM blobs WHERE mailbox_id = ? AND hash = ?").bind(mailboxId, hash).first();
        if (!live) { await env.MAIL_STORE.delete(key); deleted++; }
        await env.MAIL_DB.prepare("DELETE FROM blob_deletions WHERE r2_key = ?").bind(key).run();
    }
    return deleted;
}

export async function expireReservations(env) {
    const { results } = await env.MAIL_DB.prepare("SELECT id FROM reservations WHERE expires_at < ? LIMIT 500").bind(now()).all();
    for (const row of results) await release(env, row.id);
    return results.length;
}

// Recomputes usage from the object table to correct any drift, a few mailboxes at a time.
export async function reconcileUsage(env, mailboxId) {
    const row = await env.MAIL_DB.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM blobs WHERE mailbox_id = ?").bind(mailboxId).first();
    const reserved = await env.MAIL_DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS reserved FROM reservations WHERE mailbox_id = ?").bind(mailboxId).first();
    await env.MAIL_DB.prepare("UPDATE mailboxes SET used_bytes = ?, reserved_bytes = ? WHERE id = ?").bind(row.used, reserved.reserved, mailboxId).run();
    return { usedBytes: row.used, reservedBytes: reserved.reserved };
}

// R2 objects that no row references (for example after a failed write) are removed after a day.
export async function sweepOrphans(env, mailboxId) {
    let cursor;
    let removed = 0;
    do {
        const page = await env.MAIL_STORE.list({ prefix: `m/${mailboxId}/b/`, cursor, limit: 500 });
        for (const object of page.objects) {
            if (object.uploaded && now() - new Date(object.uploaded).getTime() < 86_400_000) continue;
            const hash = object.key.split("/").pop();
            const live = await env.MAIL_DB.prepare("SELECT 1 FROM blobs WHERE mailbox_id = ? AND hash = ?").bind(mailboxId, hash).first();
            if (!live) { await env.MAIL_STORE.delete(object.key); removed++; }
        }
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return removed;
}

export function warningLevel(used, quota) {
    const percent = quota ? (used / quota) * 100 : 0;
    return WARNING_LEVELS.filter(level => percent >= level).pop() || 0;
}

export async function storageSummary(env, mailboxId) {
    const db = env.MAIL_DB;
    const box = await db.prepare("SELECT used_bytes, reserved_bytes, quota_bytes FROM mailboxes WHERE id = ?").bind(mailboxId).first();
    if (!box) fail(404, "mailboxUnavailable");
    const { results: folders } = await db.prepare(
        "SELECT CASE WHEN folder IN ('inbox','sent','drafts','scheduled','outbox','archive','spam','trash') THEN folder ELSE 'folders' END AS bucket, " +
        "COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes, COALESCE(SUM(attachment_bytes), 0) AS attachments FROM messages WHERE mailbox_id = ? GROUP BY bucket").bind(mailboxId).all();
    const assets = await db.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM blobs WHERE mailbox_id = ? AND category IN ('asset', 'template')").bind(mailboxId).first();
    const uploads = await db.prepare("SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS count FROM uploads WHERE mailbox_id = ?").bind(mailboxId).first();
    const categories = Object.fromEntries(folders.map(row => [row.bucket, { count: row.count, bytes: row.bytes, attachmentBytes: row.attachments }]));
    const level = warningLevel(box.used_bytes, box.quota_bytes);
    return {
        usedBytes: box.used_bytes,
        reservedBytes: box.reserved_bytes,
        quotaBytes: box.quota_bytes,
        availableBytes: Math.max(0, box.quota_bytes - box.used_bytes - box.reserved_bytes),
        warningLevel: level,
        full: box.used_bytes + box.reserved_bytes >= box.quota_bytes,
        categories,
        attachmentBytes: folders.reduce((sum, row) => sum + row.attachments, 0),
        customizationBytes: assets.bytes,
        pendingUploads: { bytes: uploads.bytes, count: uploads.count },
    };
}
