// Munetios Mail HTTP API (/api/mail/v1/*). Runs in the Worker and, locally, under Express.
// Every route resolves the browser's Munetios session and checks mailbox ownership before touching data.
import { requireSession, checkOrigin } from "./auth.js";
import { ensureMailboxes, accessibleMailboxes, requireMailbox, mailboxJson, senderAddresses, mailboxSettings, saveMailboxSettings, publicSettings, createAlias, deleteAlias, latestSeq, changesSince } from "./mailbox.js";
import { listMessages, counts, getMessage, threadMessages, updateMessages, deleteMessages, emptyFolder, attachmentContent, messageEml, ownedMessages, summary } from "./messages.js";
import { createUpload, deleteUpload, uploadFromAttachment, uploadFromMessage, saveDraft, loadDraft, discardDraft, sendMessage, cancelOutbound, retryOutbound, startForwardingVerification, confirmForwarding, rateLimit } from "./outbound.js";
import * as org from "./organize.js";
import { storageSummary, readBlob } from "./storage.js";
import { proxyImage } from "./proxy.js";
import { startExport, listExports, exportObject, importEml, exportSettings, restoreSettings, exportContacts, importContacts } from "./transfer.js";
import { pendingDeviceDeliveries, deviceDeliveryObject, acknowledgeDeviceDelivery } from "./device-delivery.js";
import { fail, json, errorResponse, readJson, PRIVATE_HEADERS, now, QUOTA_BYTES, MAX_MESSAGE_BYTES, MAX_RECIPIENTS, MAX_ATTACHMENTS } from "./util.js";

export const API_PREFIX = "/api/mail/v1";
const SAFE_INLINE = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;

function contentDisposition(type, filename) {
    const fallback = String(filename || "file").replace(/[^\x20-\x7e]|["\\]/g, "_");
    return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename || "file")}`;
}

function download(bytes, filename, mimeType, inline = false) {
    const safeInline = inline && SAFE_INLINE.test(mimeType);
    return new Response(bytes, {
        headers: {
            ...PRIVATE_HEADERS,
            "Content-Type": safeInline ? mimeType : (mimeType === "message/rfc822" ? "message/rfc822" : "application/octet-stream"),
            "Content-Disposition": contentDisposition(safeInline ? "inline" : "attachment", filename),
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    });
}

const mailboxParam = url => url.searchParams.get("mailbox") || "";

async function scopedMailboxes(env, session, value) {
    const all = await accessibleMailboxes(env, session);
    if (!value || value === "all") return all;
    const one = all.find(row => row.id === value);
    if (!one) fail(404, "mailboxUnavailable");
    return [one];
}

async function bootstrap(env, session, execCtx) {
    const boxes = await ensureMailboxes(env, session, execCtx);
    const ids = boxes.map(row => row.id);
    const mailboxes = [];
    for (const row of boxes) {
        mailboxes.push({ ...mailboxJson(row), senders: await senderAddresses(env, row), settings: publicSettings(await mailboxSettings(env, row.id)),
            aliases: (await env.MAIL_DB.prepare("SELECT id, address, display_name AS displayName, created_at AS createdAt FROM aliases WHERE mailbox_id = ? ORDER BY created_at").bind(row.id).all()).results });
    }
    return {
        account: session.account, accounts: session.accounts, mailboxes,
        folders: await org.listFolders(env, ids), labels: await org.listLabels(env, ids), savedSearches: await org.listSavedSearches(env, ids),
        preferences: await org.getPreferences(env, session.account.id), themes: await org.listThemes(env, session.account.id),
        deviceDeliveries: await pendingDeviceDeliveries(env, ids),
        counts: await counts(env, boxes), seq: await latestSeq(env, ids),
        limits: { quotaBytes: Number(env.MAIL_QUOTA_BYTES) || QUOTA_BYTES, maxMessageBytes: MAX_MESSAGE_BYTES, maxRecipients: MAX_RECIPIENTS, maxAttachments: MAX_ATTACHMENTS },
        serverTime: now(),
    };
}

async function largeItems(env, mailbox, url) {
    const kind = url.searchParams.get("kind") === "attachments" ? "attachments" : "messages";
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const minBytes = Math.max(0, Number(url.searchParams.get("min")) || 0);
    if (kind === "attachments") {
        const { results } = await env.MAIL_DB.prepare(
            "SELECT a.id, a.filename, a.mime_type AS mimeType, a.size, m.id AS messageId, m.subject, m.from_addr AS fromAddr, m.date, m.folder FROM attachments a JOIN messages m ON m.id = a.message_id " +
            "WHERE a.mailbox_id = ? AND a.size >= ? ORDER BY a.size DESC LIMIT 100 OFFSET ?").bind(mailbox.id, minBytes, offset).all();
        return { attachments: results };
    }
    const { results } = await env.MAIL_DB.prepare("SELECT * FROM messages WHERE mailbox_id = ? AND size_bytes >= ? ORDER BY size_bytes DESC LIMIT 100 OFFSET ?").bind(mailbox.id, minBytes, offset).all();
    return { messages: results.map(row => summary(row)) };
}

// Size- and age-based suggestions, each with the exact search that selects the messages.
async function recommendations(env, mailbox) {
    const db = env.MAIL_DB;
    const year = now() - 365 * 86_400_000;
    const q = async (sql, ...values) => db.prepare(sql).bind(mailbox.id, ...values).first();
    const items = [
        { id: "trash", query: "in:trash", ...(await q("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM messages WHERE mailbox_id = ? AND folder = 'trash'")) },
        { id: "spam", query: "in:spam", ...(await q("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM messages WHERE mailbox_id = ? AND folder = 'spam'")) },
        { id: "large", query: "larger:10M", ...(await q("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM messages WHERE mailbox_id = ? AND size_bytes > 10000000 AND folder NOT IN ('trash','spam')")) },
        { id: "oldAttachments", query: `has:attachment before:${new Date(year).toISOString().slice(0, 10)}`, ...(await q("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM messages WHERE mailbox_id = ? AND attachment_count > 0 AND date < ? AND folder NOT IN ('trash','spam')", year)) },
        { id: "oldPromotions", query: `category:promotions before:${new Date(now() - 180 * 86_400_000).toISOString().slice(0, 10)}`, view: "promotions",
            ...(await q("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM messages WHERE mailbox_id = ? AND category = 'promotions' AND date < ? AND folder NOT IN ('trash','spam')", now() - 180 * 86_400_000)) },
        { id: "oldUnreadBulk", query: "is:unread", ...(await q("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM messages WHERE mailbox_id = ? AND is_read = 0 AND list_unsubscribe <> '' AND date < ? AND folder NOT IN ('trash','spam')", now() - 90 * 86_400_000)) },
    ];
    return items.filter(item => item.count > 0).sort((a, b) => b.bytes - a.bytes);
}

export async function handleApi(request, env, execCtx) {
    try {
        const url = new URL(request.url);
        const path = url.pathname.slice(API_PREFIX.length) || "/";
        const method = request.method;
        checkOrigin(request, env);
        const session = await requireSession(request, env);
        if (env.API_LIMITER) {
            const { success } = await env.API_LIMITER.limit({ key: session.account.id });
            if (!success) fail(429, "tooManyRequests", { retryAfter: 60 });
        }
        let m;
        const body = () => readJson(request);
        const mailboxFrom = async (value, write = false) => requireMailbox(env, session, value, { write });

        // ---- workspace
        if (path === "/bootstrap" && method === "GET") return json(await bootstrap(env, session, execCtx));
        if (path === "/messages" && method === "GET") {
            const boxes = await scopedMailboxes(env, session, mailboxParam(url));
            const params = Object.fromEntries(url.searchParams);
            if (params.view === "search" && params.q && params.record !== "0") {
                const prefs = await org.getPreferences(env, session.account.id);
                if (prefs.data?.behavior?.searchHistory !== false) await org.recordSearch(env, session.account.id, params.q);
            }
            return json(await listMessages(env, boxes, params));
        }
        if (path === "/counts" && method === "GET") return json(await counts(env, await scopedMailboxes(env, session, mailboxParam(url))));
        if (path === "/changes" && method === "GET") {
            const boxes = await scopedMailboxes(env, session, mailboxParam(url));
            return json(await changesSince(env, boxes.map(row => row.id), Math.max(0, Number(url.searchParams.get("since")) || 0)));
        }
        if (path === "/live" && method === "GET") {
            const accountId = url.searchParams.get("account") || session.account.id;
            if (!session.accountIds.has(accountId)) fail(403, "forbidden");
            if (request.headers.get("Upgrade") !== "websocket" || !env.MAIL_HUB) fail(426, "upgradeRequired");
            return env.MAIL_HUB.get(env.MAIL_HUB.idFromName("account:" + accountId)).fetch(request);
        }
        if (path === "/proxy" && method === "GET") return await proxyImage(env, url.searchParams.get("url") || "");

        // ---- mail held for this device because the mailbox was full
        if (path === "/device-deliveries" && method === "GET") return json({ deliveries: await pendingDeviceDeliveries(env, (await scopedMailboxes(env, session, mailboxParam(url))).map(row => row.id)) });
        if ((m = /^\/device-deliveries\/(dd_[a-z0-9]{15})$/.exec(path)) && method === "GET") {
            const object = await deviceDeliveryObject(env, session, m[1]);
            return new Response(object.body, { headers: { ...PRIVATE_HEADERS, "Content-Type": "application/json; charset=utf-8" } });
        }
        if ((m = /^\/device-deliveries\/(dd_[a-z0-9]{15})\/ack$/.exec(path)) && method === "POST") { await acknowledgeDeviceDelivery(env, session, m[1]); return json({ ok: true }); }

        // ---- messages
        if ((m = /^\/messages\/(m_[a-z0-9]{15})$/.exec(path)) && method === "GET") return json({ message: await getMessage(env, session, m[1]) });
        if ((m = /^\/messages\/(m_[a-z0-9]{15})\/thread$/.exec(path)) && method === "GET") return json({ messages: await threadMessages(env, session, m[1]) });
        if ((m = /^\/messages\/(m_[a-z0-9]{15})\/eml$/.exec(path)) && method === "GET") {
            const [row] = await ownedMessages(env, session, [m[1]]);
            return download(await messageEml(env, session, m[1], row), (row.subject || "message").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 100) + ".eml", "message/rfc822");
        }
        if ((m = /^\/messages\/(m_[a-z0-9]{15})\/trusted$/.exec(path)) && method === "GET") {
            const [row] = await ownedMessages(env, session, [m[1]]);
            return json({ trusted: await org.isTrusted(env, row.mailbox_id, row.from_addr), remoteContent: (await mailboxSettings(env, row.mailbox_id)).remoteContent });
        }
        if (path === "/messages/update" && method === "POST") { const input = await body(); return json(await updateMessages(env, session, execCtx, input.ids, input.patch || {})); }
        if (path === "/messages/delete" && method === "POST") { const input = await body(); return json(await deleteMessages(env, session, execCtx, input.ids)); }
        if (path === "/folders/empty" && method === "POST") { const input = await body(); return json(await emptyFolder(env, session, execCtx, await mailboxFrom(input.mailboxId), input.folder)); }
        if ((m = /^\/attachments\/(a_[a-z0-9]{15})$/.exec(path)) && method === "GET") {
            const content = await attachmentContent(env, session, m[1]);
            return download(content.bytes, content.filename, content.mimeType, url.searchParams.get("inline") === "1");
        }

        // ---- compose
        if (path === "/uploads" && method === "POST") return json(await createUpload(env, await mailboxFrom(mailboxParam(url), true), request), 201);
        if ((m = /^\/uploads\/(u_[a-z0-9]{15})$/.exec(path)) && method === "DELETE") { await deleteUpload(env, await mailboxFrom(mailboxParam(url)), m[1]); return json({ ok: true }); }
        if (path === "/uploads/from-attachment" && method === "POST") { const input = await body(); return json(await uploadFromAttachment(env, session, await mailboxFrom(input.mailboxId, true), input.attachmentId), 201); }
        if (path === "/uploads/from-message" && method === "POST") { const input = await body(); return json(await uploadFromMessage(env, session, await mailboxFrom(input.mailboxId, true), input.messageId), 201); }
        if (path === "/drafts" && method === "POST") { const input = await readJson(request, 12 * 1024 * 1024); return json(await saveDraft(env, session, execCtx, await mailboxFrom(input.mailboxId, true), input)); }
        if ((m = /^\/drafts\/(m_[a-z0-9]{15})$/.exec(path)) && method === "GET") return json({ draft: await loadDraft(env, session, m[1]) });
        if ((m = /^\/drafts\/(m_[a-z0-9]{15})$/.exec(path)) && method === "DELETE") return json(await discardDraft(env, session, execCtx, m[1]));
        if (path === "/send" && method === "POST") { const input = await readJson(request, 12 * 1024 * 1024); return json(await sendMessage(env, session, execCtx, await mailboxFrom(input.mailboxId, true), input), 202); }
        if ((m = /^\/outbound\/(o_[a-z0-9]{15})\/cancel$/.exec(path)) && method === "POST") return json(await cancelOutbound(env, session, execCtx, m[1]));
        if ((m = /^\/outbound\/(o_[a-z0-9]{15})\/retry$/.exec(path)) && method === "POST") return json(await retryOutbound(env, session, execCtx, m[1]));
        if (path === "/recipients" && method === "GET") return json({ suggestions: await org.suggestRecipients(env, await scopedMailboxes(env, session, mailboxParam(url)), url.searchParams.get("q")) });

        // ---- storage
        if (path === "/storage" && method === "GET") {
            const mailbox = await mailboxFrom(mailboxParam(url));
            return json({ ...(await storageSummary(env, mailbox.id)), recommendations: await recommendations(env, mailbox) });
        }
        if (path === "/storage/large" && method === "GET") return json(await largeItems(env, await mailboxFrom(mailboxParam(url)), url));

        // ---- mailboxes, aliases, settings, pictures
        if ((m = /^\/mailboxes\/(mb_[a-z0-9]{15})\/settings$/.exec(path))) {
            const mailbox = await mailboxFrom(m[1], method !== "GET");
            if (method === "GET") return json({ settings: publicSettings(await mailboxSettings(env, mailbox.id)), displayName: mailbox.display_name });
            if (method === "PUT") return json({ settings: await saveMailboxSettings(env, mailbox, await body()) });
        }
        if ((m = /^\/mailboxes\/(mb_[a-z0-9]{15})\/forwarding\/(verify|confirm)$/.exec(path)) && method === "POST") {
            const mailbox = await mailboxFrom(m[1], true);
            if (m[2] === "verify") return json(await startForwardingVerification(env, mailbox));
            return json(await confirmForwarding(env, mailbox, (await body()).code));
        }
        if ((m = /^\/mailboxes\/(mb_[a-z0-9]{15})\/aliases$/.exec(path)) && method === "POST") {
            const mailbox = await mailboxFrom(m[1], true);
            await rateLimit(env, "alias:" + session.account.id, 20, 86400);
            return json(await createAlias(env, mailbox, await body()), 201);
        }
        if ((m = /^\/mailboxes\/(mb_[a-z0-9]{15})\/aliases\/(al_[a-z0-9]{15})$/.exec(path)) && method === "DELETE") { await deleteAlias(env, await mailboxFrom(m[1]), m[2]); return json({ ok: true }); }
        if ((m = /^\/mailboxes\/(mb_[a-z0-9]{15})\/picture$/.exec(path))) {
            const mailbox = await mailboxFrom(m[1], method !== "GET");
            if (method === "GET") {
                const object = await readBlob(env, mailbox.id, mailbox.picture_hash);
                if (!object) fail(404, "notFound");
                return new Response(object.body, { headers: { ...PRIVATE_HEADERS, "Content-Type": object.httpMetadata?.contentType || "image/png", "Content-Security-Policy": "default-src 'none'; sandbox" } });
            }
            if (method === "POST") return json(await org.uploadAsset(env, mailbox, "picture", request), 201);
            if (method === "DELETE") { await org.removePicture(env, mailbox); return json({ ok: true }); }
        }
        if ((m = /^\/mailboxes\/(mb_[a-z0-9]{15})\/delete$/.exec(path)) && method === "POST") {
            const mailbox = await mailboxFrom(m[1]);
            const input = await body();
            if (input.confirm !== mailbox.address || input.phrase !== "DELETE") fail(400, "confirmationRequired");
            await env.MAIL_DB.batch([
                env.MAIL_DB.prepare("UPDATE mailboxes SET status = 'deleting', updated_at = ? WHERE id = ?").bind(now(), mailbox.id),
                env.MAIL_DB.prepare("UPDATE outbound SET state = 'canceled', updated_at = ? WHERE mailbox_id = ? AND state IN ('queued', 'scheduled')").bind(now(), mailbox.id),
            ]);
            await env.MAIL_JOBS?.send({ type: "delete-mailbox", mailboxId: mailbox.id });
            return json({ deleting: true }, 202);
        }

        // ---- folders and labels
        if (path === "/folders" && method === "POST") { const input = await body(); return json(await org.saveFolder(env, await mailboxFrom(input.mailboxId, true), input), 201); }
        if ((m = /^\/folders\/(f_[a-z0-9]{15})$/.exec(path))) {
            const owner = await env.MAIL_DB.prepare("SELECT mailbox_id FROM folders WHERE id = ?").bind(m[1]).first();
            if (!owner) fail(404, "notFound");
            const mailbox = await mailboxFrom(owner.mailbox_id);
            if (method === "PUT") return json(await org.saveFolder(env, mailbox, await body(), m[1]));
            if (method === "DELETE") { await org.deleteFolder(env, mailbox, m[1]); return json({ ok: true }); }
        }
        if (path === "/labels" && method === "POST") { const input = await body(); return json(await org.saveLabel(env, await mailboxFrom(input.mailboxId, true), input), 201); }
        if ((m = /^\/labels\/(l_[a-z0-9]{15})$/.exec(path))) {
            const owner = await env.MAIL_DB.prepare("SELECT mailbox_id FROM labels WHERE id = ?").bind(m[1]).first();
            if (!owner) fail(404, "notFound");
            const mailbox = await mailboxFrom(owner.mailbox_id);
            if (method === "PUT") return json(await org.saveLabel(env, mailbox, await body(), m[1]));
            if (method === "DELETE") { await org.deleteLabel(env, mailbox, m[1]); return json({ ok: true }); }
        }

        // ---- per-mailbox collections: /mailboxes/:id/<collection>[/:item]
        if ((m = /^\/mailboxes\/(mb_[a-z0-9]{15})\/(contacts|groups|signatures|templates|filters|senders|searches|subscriptions|exports|backup|contacts-transfer|import)(?:\/([A-Za-z0-9_@.+-]+))?(?:\/(run|members|unsubscribe))?$/.exec(path))) {
            const [, mailboxId, collection, item, action] = m;
            const mailbox = await mailboxFrom(mailboxId, method !== "GET");
            switch (collection) {
                case "contacts":
                    if (method === "GET") return json(await org.listContacts(env, mailbox, Object.fromEntries(url.searchParams)));
                    if (method === "POST" && !item) return json(await org.saveContact(env, mailbox, await body()), 201);
                    if (method === "PUT" && item) return json(await org.saveContact(env, mailbox, await body(), item));
                    if (method === "POST" && item === "delete") { await org.deleteContacts(env, mailbox, (await body()).ids); return json({ ok: true }); }
                    break;
                case "groups":
                    if (method === "GET" && item && action === "members") return json({ members: await org.groupMembers(env, mailbox, item) });
                    if (method === "POST" && !item) return json(await org.saveGroup(env, mailbox, await body()), 201);
                    if (method === "PUT" && item) return json(await org.saveGroup(env, mailbox, await body(), item));
                    if (method === "DELETE" && item) { await org.deleteGroup(env, mailbox, item); return json({ ok: true }); }
                    break;
                case "signatures":
                    if (method === "GET") return json({ signatures: await org.listSignatures(env, mailbox) });
                    if (method === "POST") return json(await org.saveSignature(env, mailbox, await body()), 201);
                    if (method === "PUT" && item) return json(await org.saveSignature(env, mailbox, await body(), item));
                    if (method === "DELETE" && item) { await org.deleteSignature(env, mailbox, item); return json({ ok: true }); }
                    break;
                case "templates":
                    if (method === "GET" && item) return json({ template: await org.getTemplate(env, mailbox, item) });
                    if (method === "GET") return json({ templates: await org.listTemplates(env, mailbox) });
                    if (method === "POST") return json(await org.saveTemplate(env, mailbox, await readJson(request, 8 * 1024 * 1024)), 201);
                    if (method === "PUT" && item) return json(await org.saveTemplate(env, mailbox, await readJson(request, 8 * 1024 * 1024), item));
                    if (method === "DELETE" && item) { await org.deleteTemplate(env, mailbox, item); return json({ ok: true }); }
                    break;
                case "filters":
                    if (method === "GET") return json({ filters: await org.listFilters(env, mailbox) });
                    if (method === "POST" && item === "order") { await org.reorderFilters(env, mailbox, (await body()).order); return json({ ok: true }); }
                    if (method === "POST" && item && action === "run") return json(await org.runFilter(env, session, execCtx, mailbox, item));
                    if (method === "POST") return json(await org.saveFilter(env, mailbox, await body()), 201);
                    if (method === "PUT" && item) return json(await org.saveFilter(env, mailbox, await body(), item));
                    if (method === "DELETE" && item) { await org.deleteFilter(env, mailbox, item); return json({ ok: true }); }
                    break;
                case "senders":
                    if (method === "GET") return json({ senders: await org.listSenders(env, mailbox) });
                    if (method === "POST") { const input = await body(); return json(await org.addSender(env, mailbox, input.list, input.pattern), 201); }
                    if (method === "DELETE") { await org.removeSender(env, mailbox, url.searchParams.get("list"), url.searchParams.get("pattern")); return json({ ok: true }); }
                    break;
                case "searches":
                    if (method === "POST") return json(await org.saveSearch(env, mailbox, await body()), 201);
                    if (method === "PUT" && item) return json(await org.saveSearch(env, mailbox, await body(), item));
                    if (method === "DELETE" && item) { await org.deleteSearch(env, mailbox, item); return json({ ok: true }); }
                    break;
                case "subscriptions":
                    if (method === "GET") return json({ subscriptions: await org.listSubscriptions(env, mailbox) });
                    if (method === "POST" && action === "unsubscribe") return json(await org.unsubscribe(env, mailbox, (await body()).sender));
                    break;
                case "exports":
                    if (method === "GET" && item && action === undefined && url.searchParams.get("download") === "1") {
                        const { object, row } = await exportObject(env, session, item);
                        return new Response(object.body, { headers: { ...PRIVATE_HEADERS, "Content-Type": "application/mbox", "Content-Disposition": contentDisposition("attachment", `munetios-mail-${new Date(row.created_at).toISOString().slice(0, 10)}.mbox`) } });
                    }
                    if (method === "GET") return json({ exports: await listExports(env, mailbox) });
                    if (method === "POST") return json(await startExport(env, mailbox), 202);
                    break;
                case "backup":
                    if (method === "GET") return json(await exportSettings(env, mailbox));
                    if (method === "POST") return json(await restoreSettings(env, mailbox, await readJson(request, 8 * 1024 * 1024)));
                    break;
                case "contacts-transfer":
                    if (method === "GET") {
                        const format = url.searchParams.get("format") === "csv" ? "csv" : "vcf";
                        return download(new TextEncoder().encode(await exportContacts(env, mailbox, format)), `contacts.${format}`, format === "csv" ? "text/csv" : "text/vcard");
                    }
                    if (method === "POST") return json(await importContacts(env, mailbox, (await readJson(request, 6 * 1024 * 1024)).text));
                    break;
                case "import":
                    if (method === "POST") return json(await importEml(env, execCtx, mailbox, request, url.searchParams.get("folder") || "inbox", url.searchParams.get("read") === "1"), 201);
                    break;
            }
        }

        // ---- account-level: search history, preferences, themes, assets
        if (path === "/search/history" && method === "GET") return json({ history: await org.searchHistory(env, session.account.id) });
        if (path === "/search/history" && method === "DELETE") { await env.MAIL_DB.prepare("DELETE FROM search_history WHERE account_id = ?").bind(session.account.id).run(); return json({ ok: true }); }
        if (path === "/preferences" && method === "GET") return json(await org.getPreferences(env, session.account.id));
        if (path === "/preferences" && method === "PUT") return json(await org.savePreferences(env, session.account.id, await readJson(request, 512 * 1024)));
        if (path === "/themes" && method === "GET") return json({ themes: await org.listThemes(env, session.account.id) });
        if (path === "/themes" && method === "POST") return json(await org.saveTheme(env, session.account.id, await readJson(request, 256 * 1024)), 201);
        if ((m = /^\/themes\/(th_[a-z0-9]{15})$/.exec(path))) {
            if (method === "PUT") return json(await org.saveTheme(env, session.account.id, await readJson(request, 256 * 1024), m[1]));
            if (method === "DELETE") { await org.deleteTheme(env, session.account.id, m[1]); return json({ ok: true }); }
        }
        if (path === "/assets" && method === "GET") return json({ assets: await org.listAssets(env, session.accountIds) });
        if ((m = /^\/assets\/(background|font|sound)$/.exec(path)) && method === "POST") return json(await org.uploadAsset(env, await mailboxFrom(mailboxParam(url), true), m[1], request), 201);
        if ((m = /^\/assets\/(as_[a-z0-9]{15})$/.exec(path))) {
            if (method === "GET") {
                const { object, row } = await org.assetObject(env, session, m[1]);
                return new Response(object.body, { headers: { ...PRIVATE_HEADERS, "Cache-Control": "private, max-age=86400", "Content-Type": row.mime_type, "Content-Security-Policy": "default-src 'none'; sandbox" } });
            }
            if (method === "DELETE") { await org.deleteAsset(env, session, m[1]); return json({ ok: true }); }
        }

        fail(404, "notFound");
    } catch (error) {
        return errorResponse(error);
    }
}

