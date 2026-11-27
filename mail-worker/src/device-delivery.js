// Device-only delivery for full mailboxes. The message is accepted, parsed, and held outside the quota until one of
// the owner's signed-in devices downloads it into encrypted local storage (IndexedDB) and acknowledges it.
// The server copy is then deleted. Unclaimed messages produce a non-delivery notice to the sender after 30 days.
import { notify } from "./mailbox.js";
import { authResults, header } from "./rules.js";
import { base64 } from "./mime.js";
import { fail, id, now, normalizeEmail, validEmail, cleanHeaderText, htmlToText, opsLog } from "./util.js";

const HOLD_MS = 30 * 86_400_000;
export const deviceKey = (mailboxId, deliveryId) => `m/${mailboxId}/device/${deliveryId}.json`;

export async function holdForDevice(env, mailbox, raw, parsed, envelopeFrom) {
    const messageIdHeader = (parsed.messageId || "").trim().slice(0, 998) || null;
    if (messageIdHeader) {
        const existing = await env.MAIL_DB.prepare("SELECT id FROM device_deliveries WHERE mailbox_id = ? AND message_id_header = ?").bind(mailbox.id, messageIdHeader).first();
        if (existing) return { status: "duplicate" };
    }
    const deliveryId = id("dd_");
    const at = now();
    const html = typeof parsed.html === "string" ? parsed.html : "";
    const text = typeof parsed.text === "string" ? parsed.text : htmlToText(html);
    const addresses = list => (list || []).flatMap(item => item.group || [item]).filter(item => item?.address).map(item => ({ email: normalizeEmail(item.address), name: cleanHeaderText(item.name, 200) }));
    // The device receives the parsed message plus the original MIME (for export and for moving it to the mailbox later).
    const payload = {
        id: deliveryId, mailboxId: mailbox.id, receivedAt: at,
        subject: cleanHeaderText(parsed.subject, 998), from: { email: normalizeEmail(parsed.from?.address || envelopeFrom), name: cleanHeaderText(parsed.from?.name, 200) },
        to: addresses(parsed.to), cc: addresses(parsed.cc), date: Math.min(at + 86_400_000, Date.parse(parsed.date || "") || at), html, text,
        auth: authResults(parsed), headers: (parsed.headers || []).slice(0, 200).map(item => [item.originalKey || item.key, String(item.value).slice(0, 4000)]),
        attachments: (parsed.attachments || []).map(item => ({ filename: cleanHeaderText(item.filename || "attachment", 255), mimeType: item.mimeType || "application/octet-stream",
            contentId: item.contentId ? item.contentId.replace(/^<|>$/g, "") : null, disposition: item.disposition === "inline" ? "inline" : "attachment", size: item.content?.byteLength || 0 })),
        raw: base64(raw),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    await env.MAIL_STORE.put(deviceKey(mailbox.id, deliveryId), bytes, { httpMetadata: { contentType: "application/json" } });
    try {
        await env.MAIL_DB.prepare("INSERT INTO device_deliveries (id, mailbox_id, envelope_from, from_addr, from_name, subject, message_id_header, auto_submitted, size, received_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(deliveryId, mailbox.id, normalizeEmail(envelopeFrom), payload.from.email, payload.from.name, payload.subject, messageIdHeader,
                header(parsed, "auto-submitted") && !/^no$/i.test(header(parsed, "auto-submitted")) ? 1 : 0, bytes.byteLength, at, at + HOLD_MS).run();
    } catch (error) {
        await env.MAIL_STORE.delete(deviceKey(mailbox.id, deliveryId));
        if (/UNIQUE/i.test(String(error?.message))) return { status: "duplicate" };
        throw error;
    }
    await opsLog(env.MAIL_DB, "inbound", "heldForDevice");
    await notify(env, mailbox.account_id, { type: "deviceDelivery", mailboxId: mailbox.id });
    return { status: "heldForDevice", deliveryId };
}

export async function pendingDeviceDeliveries(env, mailboxIds) {
    if (!mailboxIds.length) return [];
    const { results } = await env.MAIL_DB.prepare(
        `SELECT id, mailbox_id AS mailboxId, from_addr AS fromAddr, from_name AS fromName, subject, size, received_at AS receivedAt, expires_at AS expiresAt FROM device_deliveries WHERE mailbox_id IN (${mailboxIds.map(() => "?").join(",")}) ORDER BY received_at`)
        .bind(...mailboxIds).all();
    return results;
}

async function owned(env, session, deliveryId) {
    if (!/^dd_[a-z0-9]{15}$/.test(String(deliveryId))) fail(400, "invalidRequest");
    const row = await env.MAIL_DB.prepare("SELECT d.*, b.account_id FROM device_deliveries d JOIN mailboxes b ON b.id = d.mailbox_id WHERE d.id = ?").bind(deliveryId).first();
    if (!row || !session.accountIds.has(row.account_id)) fail(404, "notFound");
    return row;
}

export async function deviceDeliveryObject(env, session, deliveryId) {
    const row = await owned(env, session, deliveryId);
    const object = await env.MAIL_STORE.get(deviceKey(row.mailbox_id, row.id));
    if (!object) fail(404, "notFound");
    return object;
}

// Called only after the device has written the message to its local storage.
export async function acknowledgeDeviceDelivery(env, session, deliveryId) {
    const row = await owned(env, session, deliveryId);
    await env.MAIL_DB.prepare("DELETE FROM device_deliveries WHERE id = ?").bind(row.id).run();
    await env.MAIL_STORE.delete(deviceKey(row.mailbox_id, row.id));
    await opsLog(env.MAIL_DB, "inbound", "savedOnDevice");
    await notify(env, row.account_id, { type: "deviceDelivery", mailboxId: row.mailbox_id });
}

// Hourly: messages no device collected within 30 days. The sender is told the message wasn't delivered.
export async function expireDeviceDeliveries(env) {
    const { results } = await env.MAIL_DB.prepare("SELECT d.*, b.address FROM device_deliveries d JOIN mailboxes b ON b.id = d.mailbox_id WHERE d.expires_at < ? LIMIT 200").bind(now()).all();
    for (const row of results) {
        const target = row.envelope_from || row.from_addr;
        if (env.EMAIL && !row.auto_submitted && validEmail(target) && !/^(mailer-daemon|postmaster|no-?reply)@/i.test(target)) {
            try {
                await env.EMAIL.send({
                    to: target, from: { email: "mailer-daemon@munetios.com", name: "Munetios Mail" }, subject: `Undelivered: ${row.subject || "(no subject)"}`.slice(0, 998),
                    text: `Your message to ${row.address} couldn't be delivered. The recipient's mailbox was full and the message wasn't collected within 30 days.`,
                    headers: { "Auto-Submitted": "auto-replied", ...(row.message_id_header ? { "In-Reply-To": row.message_id_header, References: row.message_id_header } : {}) },
                });
                await opsLog(env.MAIL_DB, "inbound", "deviceExpiredNotified");
            } catch (error) { await opsLog(env.MAIL_DB, "inbound", error?.code || "deviceExpiredNoticeFailed"); continue; }
        }
        await env.MAIL_STORE.delete(deviceKey(row.mailbox_id, row.id));
        await env.MAIL_DB.prepare("DELETE FROM device_deliveries WHERE id = ?").bind(row.id).run();
    }
    return results.length;
}
