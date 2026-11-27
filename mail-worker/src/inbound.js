// Incoming mail from Cloudflare Email Routing: recipient validation, quota, MIME parsing,
// deduplication, spam scoring, user rules, storage, and real-time notification.
// Mail is stored, held for the owner's devices when the mailbox is full, or rejected with an SMTP error; never silently dropped.
import { legacyStore } from "./legacy.js";
import { provisionAccount, mailboxSettings, resolveThread, threadStatements, ftsStatements, changeStatement, notify } from "./mailbox.js";
import { reserve, release, storeBlob, dropRefStatements, warningLevel } from "./storage.js";
import { parseRaw } from "./messages.js";
import { holdForDevice } from "./device-delivery.js";
import { scoreSpam, categorize, applyFilters, header, authResults, senderMatches } from "./rules.js";
import { id, now, normalizeEmail, validEmail, isInternal, cleanHeaderText, snippetOf, htmlToText, sha256Hex, MAX_MESSAGE_BYTES, opsLog } from "./util.js";

async function findMailbox(env, recipient) {
    const plain = recipient.replace(/\+[^@]*@/, "@");
    for (const address of [...new Set([recipient, plain])]) {
        const direct = await env.MAIL_DB.prepare("SELECT * FROM mailboxes WHERE address = ?").bind(address).first();
        if (direct) return { mailbox: direct, address };
        const alias = await env.MAIL_DB.prepare("SELECT b.* FROM aliases a JOIN mailboxes b ON b.id = a.mailbox_id WHERE a.address = ?").bind(address).first();
        if (alias) return { mailbox: alias, address };
    }
    // Accounts that have a mailbox but haven't opened the new Mail yet are provisioned on first delivery.
    const account = await legacyStore(env).accountForAddress(plain);
    if (account) {
        const mailbox = await provisionAccount(env, account);
        if (mailbox) return { mailbox, address: plain };
    }
    return null;
}

const addresses = list => (list || []).flatMap(item => item.group ? item.group : [item]).filter(item => item?.address)
    .map(item => ({ email: normalizeEmail(item.address), name: cleanHeaderText(item.name, 200) })).filter(item => validEmail(item.email));

const headerIds = value => (String(value || "").match(/<[^<>\s]+>/g) || []);

// envelope: { from, to, rawSize, raw: () => Promise<Uint8Array>, reject(reason) }
// options.import: { mailbox, folder, read } stores an imported message without rules, spam checks, or auto-replies.
export async function deliverInbound(env, envelope, execCtx, options = {}) {
    const importing = options.import || null;
    const recipient = importing ? importing.mailbox.address : normalizeEmail(envelope.to);
    const sender = normalizeEmail(envelope.from);
    if (!importing && (!validEmail(recipient) || !isInternal(recipient))) return reject(env, envelope, "5.1.1 Recipient address rejected", "badRecipient");
    if (envelope.rawSize > MAX_MESSAGE_BYTES) return reject(env, envelope, "5.3.4 Message too big for this mailbox", "tooLarge");
    const target = importing ? { mailbox: importing.mailbox } : await findMailbox(env, recipient);
    if (!target) return reject(env, envelope, "5.1.1 Mailbox unavailable", "unknownRecipient");
    const { mailbox } = target;
    if (mailbox.status !== "active") return reject(env, envelope, "5.2.1 Mailbox disabled", "mailboxDisabled");
    // Space for the original message now; the parsed body copy is reserved exactly once its size is known.
    let reservation;
    let extra = null;
    try { reservation = await reserve(env, mailbox.id, envelope.rawSize + 1024, "inbound", 10 * 60_000); }
    catch (error) {
        if (error.code !== "quotaExceeded") throw error;
        await notifyFull(env, mailbox);
        // Imports are user-initiated and simply fail; real mail is kept for the owner's devices instead.
        if (importing) return reject(env, envelope, "5.2.2 Mailbox full", "mailboxFull");
        const raw = await envelope.raw();
        return holdForDevice(env, mailbox, raw, await parseRaw(raw), sender);
    }
    try {
        const raw = await envelope.raw();
        const parsed = await parseRaw(raw);
        const messageIdHeader = (parsed.messageId || "").trim().slice(0, 998) || null;
        const dedupeKey = messageIdHeader ? "mid:" + messageIdHeader.toLowerCase() + ":" + recipient : "sha:" + await sha256Hex(raw);
        const duplicate = await env.MAIL_DB.prepare("SELECT 1 FROM messages WHERE mailbox_id = ? AND dedupe_key = ?").bind(mailbox.id, dedupeKey).first();
        if (duplicate) { await release(env, reservation); await opsLog(env.MAIL_DB, "inbound", "duplicate"); return { status: "duplicate" }; }

        const settings = await mailboxSettings(env, mailbox.id);
        const from = normalizeEmail(parsed.from?.address || sender);
        const { results: lists } = await env.MAIL_DB.prepare("SELECT list, pattern FROM sender_lists WHERE mailbox_id = ? AND list IN ('block', 'allow')").bind(mailbox.id).all();
        const blocked = lists.some(item => item.list === "block" && senderMatches(item.pattern, from));
        const contact = await env.MAIL_DB.prepare("SELECT 1 FROM contacts WHERE mailbox_id = ? AND email = ?").bind(mailbox.id, from).first();
        const allowed = !blocked && (lists.some(item => item.list === "allow" && senderMatches(item.pattern, from)) || Boolean(contact));
        const spam = importing ? { score: 0, reasons: [], spam: false } : scoreSpam(parsed, sender, { allowed, blocked, sensitivity: settings.spamSensitivity });
        const text = typeof parsed.text === "string" ? parsed.text : htmlToText(parsed.html);
        const html = typeof parsed.html === "string" ? parsed.html : "";
        const to = addresses(parsed.to);
        const cc = addresses(parsed.cc);
        const subject = cleanHeaderText(parsed.subject, 998);
        const date = Math.min(now() + 86_400_000, Date.parse(parsed.date || "") || now());
        const attachments = (parsed.attachments || []).map((item, index) => ({
            id: id("a_"), filename: cleanHeaderText(item.filename || (item.mimeType?.startsWith("image/") ? "image" : "attachment"), 255) || "attachment",
            mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(item.mimeType || "") ? item.mimeType.toLowerCase() : "application/octet-stream",
            size: item.content?.byteLength || 0, contentId: item.contentId ? item.contentId.replace(/^<|>$/g, "").slice(0, 300) : null,
            disposition: item.disposition === "inline" ? "inline" : "attachment", partIndex: index,
        }));
        const visibleAttachments = attachments.filter(item => !(item.disposition === "inline" && item.contentId && html.includes("cid:" + item.contentId)));
        const keptHeaders = (parsed.headers || []).slice(0, 200).map(item => [item.originalKey || item.key, String(item.value).slice(0, 4000)]);

        const { results: filters } = await env.MAIL_DB.prepare("SELECT * FROM filters WHERE mailbox_id = ? AND enabled = 1 ORDER BY position").bind(mailbox.id).all();
        const actions = importing ? [] : applyFilters(filters, {
            from, fromName: parsed.from?.name || "", to: to.map(item => item.email), cc: cc.map(item => item.email), subject, text: text.slice(0, 50000),
            size: envelope.rawSize, attachmentCount: visibleAttachments.length, listId: header(parsed, "list-id"), filenames: attachments.map(item => item.filename),
        });
        let folder = importing ? importing.folder : spam.spam ? "spam" : "inbox";
        let category = settings.categories ? categorize(parsed) : "primary";
        const flags = { read: importing?.read ? 1 : 0, starred: 0, important: 0, pinned: 0 };
        const labelIds = [];
        let forwardTo = null;
        for (const action of actions) {
            switch (action.type) {
                case "move": if (folder !== "spam" || allowed) folder = action.value; break;
                case "archive": if (folder === "inbox") folder = "archive"; break;
                case "trash": folder = "trash"; break;
                case "spam": folder = "spam"; break;
                case "notSpam": if (folder === "spam" && !blocked) folder = "inbox"; break;
                case "label": labelIds.push(action.value); break;
                case "star": flags.starred = 1; break;
                case "read": flags.read = 1; break;
                case "important": flags.important = 1; break;
                case "pin": flags.pinned = 1; break;
                case "category": if (["primary", "social", "promotions", "updates", "forums"].includes(action.value)) category = action.value; break;
                case "forward": forwardTo = normalizeEmail(action.value); break;
            }
        }
        if (folder.startsWith("f_")) {
            const exists = await env.MAIL_DB.prepare("SELECT 1 FROM folders WHERE id = ? AND mailbox_id = ?").bind(folder, mailbox.id).first();
            if (!exists) folder = spam.spam ? "spam" : "inbox";
        } else if (!["inbox", "archive", "spam", "trash", ...(importing ? ["sent"] : [])].includes(folder)) folder = "inbox";
        const { results: validLabels } = labelIds.length
            ? await env.MAIL_DB.prepare(`SELECT id FROM labels WHERE mailbox_id = ? AND id IN (${labelIds.map(() => "?").join(",")})`).bind(mailbox.id, ...labelIds.slice(0, 90)).all()
            : { results: [] };

        const body = new TextEncoder().encode(JSON.stringify({ html, text, headers: keptHeaders }));
        const needed = raw.byteLength + body.byteLength - reservation.bytes;
        if (needed > 0) {
            try { extra = await reserve(env, mailbox.id, needed, "inbound", 10 * 60_000); }
            catch (error) {
                if (error.code !== "quotaExceeded") throw error;
                await notifyFull(env, mailbox);
                if (importing) return reject(env, envelope, "5.2.2 Mailbox full", "mailboxFull");
                return holdForDevice(env, mailbox, raw, parsed, sender);
            }
        }
        const rawBlob = await storeBlob(env, mailbox.id, raw, { reservation, contentType: "message/rfc822" });
        const bodyBlob = await storeBlob(env, mailbox.id, body, { reservation, contentType: "application/json" });
        const messageId = id("m_");
        const threadId = await resolveThread(env.MAIL_DB, mailbox.id, subject, date, [...headerIds(parsed.inReplyTo), ...headerIds(parsed.references)]);
        const auth = authResults(parsed);
        const unsubscribe = header(parsed, "list-unsubscribe").slice(0, 2000);
        const xPriority = header(parsed, "x-priority").trim();
        const declared = (header(parsed, "importance") + " " + header(parsed, "priority")).toLowerCase();
        const priority = /\bhigh\b|\burgent\b/.test(declared) || /^[12]\b/.test(xPriority) ? "high" : /\blow\b|non-urgent/.test(declared) || /^[45]\b/.test(xPriority) ? "low" : "normal";
        const db = env.MAIL_DB;
        const at = now();
        // storeBlob added one reference per object; the message owns those references.
        const statements = [
            ...threadStatements(db, mailbox.id, threadId, subject, date),
            db.prepare(
                "INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, storage, message_id_header, in_reply_to, references_header, subject, from_addr, from_name, to_json, cc_json, reply_to, snippet, date, " +
                "size_bytes, attachment_count, attachment_bytes, is_read, is_starred, is_important, is_pinned, category, priority, trashed_at, spam_score, spam_reasons, auth_json, list_unsubscribe, list_unsubscribe_post, raw_hash, body_hash, dedupe_key, created_at, updated_at) " +
                "VALUES (?, ?, ?, ?, 'in', 'raw', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(messageId, mailbox.id, threadId, folder, messageIdHeader, headerIds(parsed.inReplyTo).at(-1) || null, headerIds(parsed.references).slice(-100).join(" ") || null,
                    subject, from, cleanHeaderText(parsed.from?.name, 200), JSON.stringify(to), JSON.stringify(cc), normalizeEmail(parsed.replyTo?.[0]?.address || ""),
                    snippetOf(text), date, raw.byteLength + body.byteLength, visibleAttachments.length, visibleAttachments.reduce((sum, item) => sum + item.size, 0),
                    flags.read, flags.starred, flags.important, flags.pinned, category, priority, folder === "trash" ? at : null, spam.score, JSON.stringify(spam.reasons),
                    JSON.stringify(auth), unsubscribe, /one-click/i.test(header(parsed, "list-unsubscribe-post")) ? 1 : 0, rawBlob.hash, bodyBlob.hash, dedupeKey, at, at),
            ...attachments.map((item, position) => db.prepare(
                "INSERT INTO attachments (id, message_id, mailbox_id, filename, mime_type, size, content_id, disposition, part_index, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(item.id, messageId, mailbox.id, item.filename, item.mimeType, item.size, item.contentId, item.disposition, item.partIndex, position)),
            ...validLabels.map(label => db.prepare("INSERT OR IGNORE INTO message_labels (message_id, label_id) VALUES (?, ?)").bind(messageId, label.id)),
            ...ftsStatements(db, messageId, subject, [parsed.from?.name, from, ...to.map(item => `${item.name} ${item.email}`), ...cc.map(item => `${item.name} ${item.email}`)].join(" "),
                text, attachments.map(item => item.filename).join(" ")),
            changeStatement(db, mailbox.id, "message", messageId, "upsert"),
            changeStatement(db, mailbox.id, "storage", mailbox.id, "upsert"),
        ];
        try { await db.batch(statements); }
        catch (error) {
            // A concurrent delivery of the same message won the race: give back the references.
            await db.batch(dropRefStatements(db, mailbox.id, [rawBlob.hash, bodyBlob.hash])).catch(() => {});
            if (/UNIQUE/i.test(String(error?.message))) return { status: "duplicate" };
            throw error;
        }
        await release(env, reservation);
        reservation = null;
        if (extra) { await release(env, extra); extra = null; }
        await opsLog(db, "inbound", folder === "spam" ? "deliveredSpam" : "delivered");
        const work = Promise.allSettled([
            notify(env, mailbox.account_id, { type: "message", mailboxId: mailbox.id, folder, unread: !flags.read }),
            checkWarnings(env, mailbox.id),
            !importing && folder !== "spam" && folder !== "trash" ? vacationReply(env, mailbox, settings, parsed, from, envelope) : null,
            !importing && folder !== "spam" ? autoForward(env, mailbox, settings, messageId, parsed, forwardTo) : null,
        ]);
        if (execCtx?.waitUntil) execCtx.waitUntil(work); else await work;
        return { status: "delivered", messageId, folder };
    } finally {
        if (reservation) await release(env, reservation).catch(() => {});
        if (extra) await release(env, extra).catch(() => {});
    }
}

async function reject(env, envelope, reason, code) {
    envelope.reject(reason);
    await opsLog(env.MAIL_DB, "inbound", code);
    return { status: "rejected", reason };
}

async function notifyFull(env, mailbox) {
    await env.MAIL_DB.prepare("UPDATE mailboxes SET warned_level = 100 WHERE id = ?").bind(mailbox.id).run();
    await notify(env, mailbox.account_id, { type: "storage", mailboxId: mailbox.id, level: 100, rejected: true });
}

export async function checkWarnings(env, mailboxId) {
    const box = await env.MAIL_DB.prepare("SELECT account_id, used_bytes, quota_bytes, warned_level FROM mailboxes WHERE id = ?").bind(mailboxId).first();
    if (!box) return;
    const level = warningLevel(box.used_bytes, box.quota_bytes);
    if (level !== box.warned_level) {
        await env.MAIL_DB.prepare("UPDATE mailboxes SET warned_level = ? WHERE id = ?").bind(level, mailboxId).run();
        if (level > box.warned_level) await notify(env, box.account_id, { type: "storage", mailboxId, level });
    }
}

const AUTOMATED = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|bounces|notifications?)@/i;

async function vacationReply(env, mailbox, settings, parsed, from, envelope) {
    const vacation = settings.vacation;
    const at = now();
    if (!vacation?.enabled || (vacation.start && at < vacation.start) || (vacation.end && at > vacation.end)) return;
    if (!validEmail(from) || from === mailbox.address || AUTOMATED.test(from)) return;
    if (header(parsed, "auto-submitted") && !/^no$/i.test(header(parsed, "auto-submitted"))) return;
    if (header(parsed, "list-id") || /bulk|list|junk/i.test(header(parsed, "precedence"))) return;
    if (vacation.contactsOnly && !await env.MAIL_DB.prepare("SELECT 1 FROM contacts WHERE mailbox_id = ? AND email = ? AND auto = 0").bind(mailbox.id, from).first()) return;
    const last = await env.MAIL_DB.prepare("SELECT sent_at FROM vacation_replies WHERE mailbox_id = ? AND sender = ?").bind(mailbox.id, from).first();
    if (last && at - last.sent_at < 4 * 86_400_000) return;
    if (!env.EMAIL) return;
    const subject = cleanHeaderText(vacation.subject || ("Re: " + (parsed.subject || "")), 998);
    const message = {
        to: from, from: mailbox.display_name ? { email: mailbox.address, name: mailbox.display_name } : mailbox.address, subject,
        text: vacation.message || "", headers: { "Auto-Submitted": "auto-replied", ...(parsed.messageId ? { "In-Reply-To": parsed.messageId, References: parsed.messageId } : {}) },
    };
    try {
        await env.EMAIL.send(message);
        await env.MAIL_DB.prepare("INSERT INTO vacation_replies (mailbox_id, sender, sent_at) VALUES (?, ?, ?) ON CONFLICT (mailbox_id, sender) DO UPDATE SET sent_at = excluded.sent_at").bind(mailbox.id, from, at).run();
        await opsLog(env.MAIL_DB, "vacation", "sent");
    } catch (error) { await opsLog(env.MAIL_DB, "vacation", error?.code || "failed"); }
}

// Forwarding only goes to an address the owner verified with a code, so Mail can't be used as an open relay.
async function autoForward(env, mailbox, settings, messageId, parsed, filterTarget) {
    const forwarding = settings.forwarding;
    const targets = new Set();
    if (forwarding?.enabled && forwarding.verified && validEmail(forwarding.address)) targets.add(forwarding.address);
    if (filterTarget && forwarding?.verified && filterTarget === forwarding.address) targets.add(filterTarget);
    if (!targets.size || header(parsed, "x-munetios-forwarded") || (header(parsed, "auto-submitted") && !/^no$/i.test(header(parsed, "auto-submitted")))) return;
    for (const address of targets) {
        if (env.MAIL_JOBS) await env.MAIL_JOBS.send({ type: "forward", mailboxId: mailbox.id, messageId, address });
    }
    if (!forwarding.keepCopy) {
        await env.MAIL_DB.batch([
            env.MAIL_DB.prepare("UPDATE messages SET folder = 'archive', is_read = 1, version = version + 1, updated_at = ? WHERE id = ? AND folder = 'inbox'").bind(now(), messageId),
            changeStatement(env.MAIL_DB, mailbox.id, "message", messageId, "upsert"),
        ]);
    }
}

