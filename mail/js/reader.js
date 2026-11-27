// Reading pane: conversation view, privacy information, remote content controls, link safety, attachments,
// message tabs, full-screen reading, and mail kept only on this device.
import { state, emit, on, mailboxById, labelById, mailboxes } from "./state.js";
import { get, post, fetchBlob, upload, ApiError } from "./api.js";
import { t, formatDateTime, formatBytes, formatListDate } from "./i18n.js";
import { el, icon, iconButton, stamp, menu, dialog, button, toast, confirmDialog, download, emptyState, alertBox } from "./ui.js";
import { sanitizeIncoming, mountFrame, plainText, linkRisk } from "./render-email.js";
import * as actions from "./actions.js";
import * as offline from "./offline.js";

const reader = () => document.getElementById("reader");
const tabsNode = () => document.getElementById("readerTabs");
let disposers = [];
let readTimer = null;
const blobUrls = new Set();
const sessionTrusted = new Set();

function cleanup() {
    disposers.forEach(fn => fn());
    disposers = [];
    clearTimeout(readTimer);
    for (const url of blobUrls) URL.revokeObjectURL(url);
    blobUrls.clear();
}

export function init() {
    on("changes", ({ ids }) => { if (state.openId && ids.has(state.openId)) refreshOpen(); });
    on("openTab", item => openTab(item));
    showEmpty();
}

export function showEmpty() {
    cleanup();
    reader().replaceChildren(el("div", { class: "mail-empty-reader" }, emptyState("mark_email_read", t("selectMessage"), t("selectMessageDetail"))));
}

function skeleton() {
    reader().replaceChildren(el("div", { class: "mail-reader-skeleton" }, el("span", { class: "mu-skeleton is-title" }), el("span", { class: "mu-skeleton is-text" }), el("span", { class: "mu-skeleton is-block" })));
}

export async function open(item) {
    if (item.folder === "drafts" || item.direction === "draft") { emit("editDraft", item); return; }
    document.body.classList.add("reading");
    if (item.device) return openDevice(item.id);
    cleanup();
    skeleton();
    let thread;
    try {
        const [{ message }, threadResult] = await Promise.all([get(`/messages/${item.id}`), state.prefs?.layout?.conversationView ? get(`/messages/${item.id}/thread`) : Promise.resolve({ messages: [] })]);
        thread = { message, others: threadResult.messages.filter(other => other.id !== item.id) };
        offline.cachePut("message:" + item.id, thread).catch(() => {});
    } catch (error) {
        thread = await offline.cacheGet("message:" + item.id);
        if (!thread) { reader().replaceChildren(emptyState("error", error instanceof ApiError && error.code === "offline" ? t("offlineMessage") : t("errLoadEmail"), "")); return; }
    }
    if (state.openId !== item.id && !state.tabs.some(tab => tab.id === item.id)) return;
    render(thread);
    scheduleRead(thread.message);
}

async function refreshOpen() {
    if (!state.openId || String(state.openId).startsWith("dd_")) return;
    try {
        const { message } = await get(`/messages/${state.openId}`);
        const subject = reader().querySelector(".mail-subject");
        if (subject) subject.textContent = message.subject || t("noSubject");
        const status = reader().querySelector("[data-delivery]");
        if (status) status.replaceWith(deliveryInfo(message));
    } catch { /* keep the current view */ }
}

function scheduleRead(message) {
    if (message.read) return;
    const delay = Number(state.prefs?.behavior?.markReadDelay ?? 0);
    if (delay < 0) return;
    readTimer = setTimeout(() => actions.markRead([message.id], true), delay * 1000);
}

function toolbar(message) {
    const ids = [message.id];
    const box = mailboxById(message.mailboxId);
    const back = iconButton("arrow_back", t("back"), () => closeReader(), { class: "mu-icon-btn mail-back" });
    const more = iconButton("more_vert", t("more"), () => menu(more, [
        { icon: "print", label: t("print"), action: () => window.print() },
        { icon: "download", label: t("downloadEml"), action: () => downloadEml(message) },
        message.html ? { icon: "html", label: t("viewHtml"), action: () => showHtml(message) } : null,
        { icon: "code", label: t("showOriginal"), action: () => showHeaders(message) },
        { icon: "shield", label: t("privacyInfo"), action: () => privacyDialog(message) },
        { icon: "flag", label: t("followUp"), action: () => actions.followUpMenu(more, ids) },
        { icon: "label_important", label: message.important ? t("markNotImportant") : t("markImportant"), action: () => actions.important(ids, !message.important) },
        { icon: "push_pin", label: message.pinned ? t("unpin") : t("pin"), action: () => actions.pin(ids, !message.pinned) },
        { icon: "mark_email_unread", label: t("markUnread"), action: () => { actions.markRead(ids, false); closeReader(); } },
        message.direction === "in" ? { icon: "block", label: t("blockSender"), action: () => blockSender(message) } : null,
        message.direction === "in" ? { icon: "verified_user", label: t("trustSender"), action: () => trustSender(message) } : null,
        "sep",
        message.folder === "trash" || message.folder === "spam" ? { icon: "delete_forever", label: t("deleteForever"), danger: true, action: () => { actions.deleteForever(ids); closeReader(); } } : null,
    ], { label: t("more") }));
    const order = state.prefs?.layout?.toolbarOrder || [];
    const hidden = new Set(state.prefs?.layout?.toolbarHidden || []);
    const map = {
        archive: () => iconButton("archive", t("archive"), () => { actions.archive(ids); afterAction(); }),
        trash: () => message.folder === "trash" ? iconButton("restore_from_trash", t("restore"), () => { actions.restore(ids); afterAction(); }) : iconButton("delete", t("delete"), () => { actions.trash(ids); afterAction(); }),
        spam: () => message.folder === "spam" ? iconButton("report_off", t("notSpam"), () => { actions.spam(ids, false); afterAction(); }) : iconButton("report", t("reportSpam"), () => { actions.spam(ids, true); afterAction(); }),
        move: () => { const btn = iconButton("drive_file_move", t("moveTo"), () => actions.moveMenu(btn, ids, message.mailboxId)); return btn; },
        label: () => { const btn = iconButton("label", t("labels"), () => actions.labelMenu(btn, ids, message.mailboxId)); return btn; },
        read: () => iconButton("mark_email_unread", t("markUnread"), () => { actions.markRead(ids, false); closeReader(); }),
        star: () => iconButton("star", message.starred ? t("unstar") : t("star"), () => { message.starred = !message.starred; actions.star(ids, message.starred); }, { "aria-pressed": String(Boolean(message.starred)) }),
        important: () => iconButton("label_important", t("important"), () => actions.important(ids, !message.important)),
        snooze: () => { const btn = iconButton("snooze", t("snooze"), () => actions.snoozeMenu(btn, ids)); return btn; },
        pin: () => iconButton("push_pin", message.pinned ? t("unpin") : t("pin"), () => actions.pin(ids, !message.pinned)),
        print: () => iconButton("print", t("print"), () => window.print()),
        more: () => more,
    };
    return el("div", { class: "mail-reader-toolbar", role: "toolbar", "aria-label": t("messageActions") }, back,
        ...order.filter(key => !hidden.has(key) || key === "more").map(key => { const node = map[key]?.(); if (node && !["archive", "trash", "more"].includes(key)) node.dataset.secondary = ""; return node; }),
        el("span", { class: "mail-spacer" }),
        box && state.scope === "all" && mailboxes().length > 1 ? el("span", { class: "mail-chip", text: box.address }) : null,
        iconButton("reply", t("reply"), () => emit("reply", { item: message, mode: "reply" })),
        iconButton("reply_all", t("replyAll"), () => emit("reply", { item: message, mode: "replyAll" })),
        iconButton("forward", t("forward"), () => emit("reply", { item: message, mode: "forward" })),
        iconButton("tab", t("openInTab"), () => openTab(message), { "data-secondary": "" }),
        iconButton(document.body.classList.contains("reader-full") ? "close_fullscreen" : "open_in_full", t("fullScreen"), event => {
            document.body.classList.toggle("reader-full");
            event.currentTarget.querySelector(".mu-icon").textContent = document.body.classList.contains("reader-full") ? "close_fullscreen" : "open_in_full";
        }));
}

function afterAction() {
    const behavior = state.prefs?.behavior?.afterAction || "next";
    if (behavior === "list") closeReader();
    else emit("advance", behavior === "previous" ? -1 : 1);
}

export function closeReader() {
    document.body.classList.remove("reading", "reader-full");
    state.openId = null;
    emit("listChanged");
    showEmpty();
}

function render({ message, others }) {
    cleanup();
    const thread = el("div", { class: "mail-thread" });
    for (const other of others.filter(item => item.date < message.date)) thread.append(collapsed(other));
    thread.append(messageCard(message, true));
    for (const other of others.filter(item => item.date >= message.date)) thread.append(collapsed(other));
    const labelChips = (message.labels || []).map(labelById).filter(Boolean).map(label => el("span", { class: "mail-chip" }, el("span", { class: "mail-swatch-dot", style: `background:${label.color}` }), label.name));
    reader().replaceChildren(toolbar(message), el("h2", { class: "mail-subject", text: message.subject || t("noSubject") }),
        labelChips.length ? el("div", { class: "mail-row-meta", style: "margin:-4px 0 12px" }, labelChips) : null, thread);
    reader().scrollTop = 0;
}

function collapsed(summary) {
    const card = el("article", { class: "mail-message is-collapsed" });
    const head = el("div", { class: "mail-message-head", role: "button", tabindex: "0", "aria-expanded": "false" }, stamp(summary.from?.name, summary.from?.email),
        el("div", { class: "mail-message-who" }, el("strong", { text: summary.from?.name || summary.from?.email }), el("span", { class: "mu-muted", text: summary.snippet })),
        el("span", { class: "mu-muted", text: formatListDate(summary.date) }));
    const expand = async () => {
        head.setAttribute("aria-expanded", "true");
        try { const { message } = await get(`/messages/${summary.id}`); card.replaceWith(messageCard(message, false)); }
        catch { toast(t("errLoadEmail"), "error"); }
    };
    head.addEventListener("click", expand);
    head.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); expand(); } });
    card.append(head);
    return card;
}

function people(list) { return (list || []).map(person => person.name ? `${person.name} <${person.email}>` : person.email).join(", "); }

function messageCard(message, primary) {
    const card = el("article", { class: "mail-message", "aria-label": t("messageFrom", { name: message.from?.name || message.from?.email || "" }) });
    const box = mailboxById(message.mailboxId);
    const who = el("div", { class: "mail-message-who" },
        el("strong", { text: message.from?.name || message.from?.email || t("unknownSender") }),
        el("span", { class: "mu-muted", text: message.from?.email || "" }),
        el("span", { class: "mu-muted", text: t("toLine", { names: people(message.to) || box?.address || "" }) }),
        message.cc?.length ? el("span", { class: "mu-muted", text: t("ccLine", { names: people(message.cc) }) }) : null,
        message.bcc?.length ? el("span", { class: "mu-muted", text: t("bccLine", { names: people(message.bcc) }) }) : null);
    const actionsNode = el("div", { class: "mail-message-actions" }, el("span", { class: "mu-muted", text: formatDateTime(message.date), style: undefined }),
        !primary && message.html ? iconButton("html", t("viewHtml"), () => showHtml(message)) : null,
        primary ? null : iconButton("reply", t("reply"), () => emit("reply", { item: message, mode: "reply" })));
    const head = el("div", { class: "mail-message-head" }, stamp(message.from?.name, message.from?.email), who, actionsNode);
    if (!primary) head.addEventListener("click", event => { if (!event.target.closest("button")) card.classList.toggle("is-collapsed"); });
    const extra = el("div", { class: "mail-message-extra" });
    const body = el("div", { class: "mail-message-body" });
    card.append(head, extra, body);
    if (message.direction === "out" && message.delivery) extra.append(deliveryInfo(message));
    if (message.listUnsubscribe) extra.append(unsubscribeBar(message));
    renderBody(message, extra, body);
    if (message.attachmentList?.some(item => item.disposition !== "inline" || !message.html.includes("cid:" + item.contentId))) body.append(attachmentsView(message));
    return card;
}

function deliveryInfo(message) {
    const delivery = message.delivery;
    const node = el("div", { class: "mail-privacy" + (["failed", "bounced", "unknown", "partial"].includes(message.deliveryStatus) ? " is-danger" : ""), "data-delivery": "1" },
        icon(["failed", "bounced", "unknown"].includes(message.deliveryStatus) ? "error" : message.deliveryStatus === "delivered" ? "done_all" : "schedule_send"),
        el("span", { text: t("delivery_" + (message.deliveryStatus || "sent")) }));
    if (delivery?.recipients?.length) {
        node.append(el("div", { class: "mu-accordion", style: "flex:1 1 100%" }, el("details", {}, el("summary", { text: t("deliveryDetails") }),
            el("div", { class: "mu-accordion-body" }, el("ul", { style: "margin:0" }, delivery.recipients.map(item => el("li", { text: `${item.recipient}: ${t("recipient_" + item.status) || item.status}${item.detail ? " (" + item.detail + ")" : ""}` })))))));
    }
    if (delivery?.state === "scheduled" || delivery?.state === "queued") node.append(el("span", { class: "mail-spacer" }), button(t("cancelSend"), () => emit("cancelOutbound", message), { class: "mu-btn mu-btn-ghost" }));
    if (["failed", "unknown"].includes(delivery?.state)) node.append(el("span", { class: "mail-spacer" }), button(t("retrySend"), () => emit("retryOutbound", message), { class: "mu-btn" }));
    return node;
}

function unsubscribeBar(message) {
    return el("div", { class: "mail-privacy" }, icon("unsubscribe"), el("span", { text: t("mailingList") }), el("span", { class: "mail-spacer" }),
        button(t("unsubscribe"), async () => {
            const ok = await confirmDialog({ title: t("unsubscribe"), message: t("unsubscribeConfirm", { sender: message.from?.email || "" }), confirm: t("unsubscribe") });
            if (!ok) return;
            try {
                const result = await post(`/mailboxes/${message.mailboxId}/subscriptions/unsubscribe`, { sender: message.from.email });
                if (result.method === "web") openLink(result.url, "", t("unsubscribe"));
                else toast(t("unsubscribed"), "success");
            } catch (error) { toast(actions.failText(error, "errUnsubscribe"), "error"); }
        }, { class: "mu-btn mu-btn-ghost" }));
}

async function cidMapFor(message) {
    const map = new Map();
    for (const item of message.attachmentList || []) {
        if (!item.contentId || !/^image\//.test(item.mimeType) || !message.html.includes(item.contentId)) continue;
        try {
            const url = URL.createObjectURL(await fetchBlob(`/attachments/${item.id}?inline=1`));
            blobUrls.add(url);
            map.set(item.contentId, url);
        } catch { /* image unavailable */ }
    }
    return map;
}

async function renderBody(message, extra, body, allowRemote = null) {
    const paper = el("div", { class: "mail-paper" });
    body.prepend(paper);
    if (!message.html) {
        paper.append(plainText(message.text));
        paper.querySelectorAll("a[data-href]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); openLink(link.dataset.href, linkRisk(link.dataset.href, link.textContent), link.textContent); }));
        extra.prepend(privacyPanel(message, { remoteImages: 0, trackers: [], remoteFonts: 0, remoteStyles: 0, suspicious: [], forms: 0, removed: 0 }, false));
        return;
    }
    if (allowRemote === null) {
        const mode = (mailboxById(message.mailboxId)?.settings?.remoteContent) || "block";
        allowRemote = mode === "allow" || mode === "proxy" || sessionTrusted.has(message.from?.email);
        if (!allowRemote && mode === "ask" && message.direction === "in") {
            try { allowRemote = (await get(`/messages/${message.id}/trusted`)).trusted; } catch { /* keep blocked */ }
        } else if (!allowRemote && message.direction === "in") {
            try { allowRemote = (await get(`/messages/${message.id}/trusted`)).trusted; } catch { /* keep blocked */ }
        }
        if (message.direction !== "in") allowRemote = true;
        if (message.folder === "spam") allowRemote = false;
    }
    const { html, report } = sanitizeIncoming(message.html, { allowRemote, cidMap: await cidMapFor(message) });
    const font = getComputedStyle(document.documentElement).getPropertyValue("--mail-font-message").trim();
    const mounted = mountFrame(paper, html, { font, onLink: openLink });
    disposers.push(mounted.dispose);
    extra.querySelector(".mail-privacy[data-privacy]")?.remove();
    extra.prepend(privacyPanel(message, report, allowRemote, () => {
        mounted.dispose();
        paper.remove();
        renderBody(message, extra, body, true);
    }));
}

function privacyPanel(message, report, allowed, loadRemote) {
    const auth = message.auth || {};
    const authFailed = ["fail", "softfail"].includes(auth.dmarc) || auth.spf === "fail" || auth.dkim === "fail";
    const blocked = !allowed && report.remoteImages > 0;
    const risky = report.suspicious.length > 0 || authFailed || message.spamScore >= 5;
    const parts = [];
    if (report.trackers.length) parts.push(t("trackersBlocked", { count: report.trackers.length }));
    if (blocked) parts.push(t("remoteBlocked", { count: report.remoteImages }));
    if (report.suspicious.length) parts.push(t("suspiciousLinks", { count: report.suspicious.length }));
    if (authFailed) parts.push(t("authFailed"));
    if (!parts.length) parts.push(message.direction === "in" ? (auth.dmarc === "pass" ? t("senderVerified") : t("noTrackersFound")) : t("noTrackersFound"));
    return el("div", { class: "mail-privacy" + (risky ? " is-danger" : blocked || report.trackers.length ? " is-warning" : ""), "data-privacy": "1" },
        icon(risky ? "gpp_maybe" : "shield"), el("span", { text: parts.join(" · ") }),
        el("div", { class: "mail-privacy-actions" },
            blocked && loadRemote ? button(t("loadRemote"), loadRemote, { class: "mu-btn", iconName: "image" }) : null,
            blocked && loadRemote && message.from?.email ? button(t("alwaysTrust"), async () => { sessionTrusted.add(message.from.email); await trustSender(message, true); loadRemote(); }, { class: "mu-btn mu-btn-ghost" }) : null,
            button(t("details"), () => privacyDialog(message, report, allowed), { class: "mu-btn mu-btn-ghost" })));
}

function privacyDialog(message, report = null, allowed = false) {
    const auth = message.auth || {};
    const rows = [
        [t("spfResult"), t("auth_" + (auth.spf || "none")) || auth.spf], [t("dkimResult"), t("auth_" + (auth.dkim || "none")) || auth.dkim], [t("dmarcResult"), t("auth_" + (auth.dmarc || "none")) || auth.dmarc],
        [t("spamScore"), String(message.spamScore ?? 0)],
    ];
    const content = [
        el("p", { class: "mu-muted", style: "margin:0", text: t("encryptionExplainer") }),
        el("div", { class: "mail-table-wrap" }, el("table", { class: "mail-table" }, el("tbody", {}, rows.map(([key, value]) => el("tr", {}, el("th", { text: key }), el("td", { text: value })))))),
    ];
    if (message.spamReasons?.length) content.push(el("p", { text: t("spamReasons") + ": " + message.spamReasons.map(reason => t("reason_" + reason) || reason).join(", ") }));
    if (report) {
        content.push(el("p", { text: allowed ? t("remoteLoadedViaProxy") : t("remoteBlockedDetail", { count: report.remoteImages }) }));
        if (report.trackers.length) content.push(el("p", { text: t("trackerList") + ": " + report.trackers.join(", ") }));
        if (report.remoteFonts || report.remoteStyles) content.push(el("p", { text: t("externalResourcesBlocked") }));
        if (report.forms) content.push(el("p", { text: t("formsRemoved") }));
        if (report.suspicious.length) content.push(el("ul", { class: "mail-link-report" }, report.suspicious.map(item => el("li", {},
            el("span", { text: item.text || shortUrl(item.href) }),
            el("span", { class: "mail-link-report-url", dir: "ltr", "data-tooltip": item.href, text: shortUrl(item.href) }),
            el("span", { class: "mu-muted", text: t("risk_" + item.risk) || item.risk })))));
    }
    const d = dialog({ title: t("privacyInfo"), iconName: "shield", content, className: "mail-privacy-dialog", actions: [button(t("close"), () => d.close(), { primary: true })] });
}

// Host and the start of the path; tracking links are often hundreds of characters long.
function shortUrl(href) {
    try {
        const url = new URL(href);
        const rest = url.pathname + url.search;
        return url.host + (rest.length > 1 ? (rest.length > 40 ? rest.slice(0, 40) + "…" : rest) : "");
    } catch { return String(href || "").slice(0, 60); }
}

// Links always show their real destination; risky links and every external open ask first when enabled.
export async function openLink(href, risk = "", text = "") {
    if (/^mailto:/i.test(href)) {
        const url = new URL(href);
        emit("composeTo", { to: decodeURIComponent(url.pathname), subject: url.searchParams.get("subject") || "", body: url.searchParams.get("body") || "" });
        return;
    }
    const warn = risk || state.prefs?.behavior?.linkWarnings !== false;
    if (warn) {
        const ok = await confirmDialog({
            title: risk ? t("suspiciousLinkTitle") : t("openLinkTitle"), danger: Boolean(risk),
            message: (risk ? t("risk_" + risk) + " " : "") + t("openLinkMessage", { url: href }) + (text && text !== href ? " " + t("linkTextWas", { text: text.slice(0, 120) }) : ""),
            confirm: t("openLink"), iconName: risk ? "gpp_maybe" : "open_in_new",
        });
        if (!ok) return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
}

function attachmentsView(message) {
    const list = el("div", { class: "mail-attachments", style: "margin-top:12px" });
    for (const item of message.attachmentList) {
        if (item.disposition === "inline" && item.contentId && message.html.includes("cid:" + item.contentId)) continue;
        const thumb = el("span", { class: "mail-attachment-thumb" }, icon(/^image\//.test(item.mimeType) ? "image" : /pdf/.test(item.mimeType) ? "picture_as_pdf" : /^video\//.test(item.mimeType) ? "movie" : /zip|compressed/.test(item.mimeType) ? "folder_zip" : "draft"));
        const save = iconButton("download", t("downloadName", { name: item.filename }), async () => {
            try { download(await fetchBlob(`/attachments/${item.id}`), item.filename); } catch (error) { toast(actions.failText(error, "errDownload"), "error"); }
        });
        const card = el("div", { class: "mail-attachment" }, thumb, el("div", { style: "min-width:0" }, el("div", { class: "mail-attachment-name", text: item.filename }), el("div", { class: "mu-muted", text: formatBytes(item.size) })), save);
        if (/^image\/(png|jpeg|gif|webp)$/.test(item.mimeType) && item.size < 15_000_000) {
            fetchBlob(`/attachments/${item.id}?inline=1`).then(blob => {
                const url = URL.createObjectURL(blob); blobUrls.add(url);
                thumb.replaceWith(el("img", { class: "mail-attachment-thumb", src: url, alt: "" }));
                card.style.cursor = "zoom-in";
                card.addEventListener("click", event => { if (!event.target.closest("button")) lightbox(url, item.filename); });
            }).catch(() => {});
        }
        list.append(card);
    }
    return list;
}

function lightbox(url, name) {
    const close = () => box.remove();
    const box = el("div", { class: "mail-lightbox", role: "dialog", "aria-label": name, tabindex: "-1" }, el("img", { src: url, alt: name }), iconButton("close", t("close"), close));
    box.addEventListener("click", event => { if (event.target === box) close(); });
    box.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    document.body.append(box);
    box.focus();
}

async function downloadEml(message) {
    try { download(await fetchBlob(`/messages/${message.id}/eml`), (message.subject || "message").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) + ".eml"); }
    catch (error) { toast(actions.failText(error, "errDownload"), "error"); }
}

function showHtml(message) {
    const title = t("viewHtml");
    const source = el("pre", { class: "mail-plain", dir: "ltr", tabindex: "0", "aria-label": title, style: "max-height:60vh;overflow:auto", text: message.html });
    const d = dialog({ title, iconName: "html", size: "mu-dialog-lg", content: [source],
        actions: [button(t("close"), () => d.close(), { primary: true })] });
}

function showHeaders(message) {
    const text = (message.headers || []).map(([key, value]) => `${key}: ${value}`).join("\n") || t("noHeaders");
    const d = dialog({ title: t("showOriginal"), iconName: "code", size: "mu-dialog-lg", content: [el("pre", { class: "mail-plain", style: "max-height:60vh;overflow:auto", text })],
        actions: [button(t("downloadEml"), () => downloadEml(message)), button(t("close"), () => d.close(), { primary: true })] });
}

async function blockSender(message) {
    const ok = await confirmDialog({ title: t("blockSender"), message: t("blockSenderConfirm", { sender: message.from?.email || "" }), confirm: t("block"), danger: true });
    if (!ok) return;
    try {
        await post(`/mailboxes/${message.mailboxId}/senders`, { list: "block", pattern: message.from.email });
        await actions.spam([message.id], true);
        toast(t("senderBlocked"), "success");
    } catch (error) { toast(actions.failText(error, "errBlockSender"), "error"); }
}

async function trustSender(message, quiet = false) {
    try { await post(`/mailboxes/${message.mailboxId}/senders`, { list: "trusted", pattern: message.from.email }); if (!quiet) toast(t("senderTrusted"), "success"); }
    catch (error) { toast(actions.failText(error, "errTrustedSender"), "error"); }
}
on("blockSender", item => blockSender(item));

/* ---------------------------------------------------------------- tabs */
function openTab(item) {
    if (!state.tabs.some(tab => tab.id === item.id)) state.tabs.push({ id: item.id, title: item.subject || t("noSubject"), device: Boolean(item.device) });
    state.openId = item.id;
    renderTabs();
    open(item);
}

function renderTabs() {
    const node = tabsNode();
    node.hidden = !state.tabs.length;
    node.replaceChildren(...state.tabs.map(tab => {
        const button = el("button", { type: "button", class: "mail-tab", role: "tab", "aria-selected": String(tab.id === state.openId) }, el("span", { text: tab.title }));
        const close = iconButton("close", t("closeTab"), event => {
            event.stopPropagation();
            state.tabs = state.tabs.filter(other => other.id !== tab.id);
            if (state.openId === tab.id) { const next = state.tabs.at(-1); if (next) { state.openId = next.id; open({ id: next.id, device: next.device }); } else closeReader(); }
            renderTabs();
        }, { class: "mu-icon-btn mu-icon-btn-sm" });
        button.append(close);
        button.addEventListener("click", () => { state.openId = tab.id; renderTabs(); open({ id: tab.id, device: tab.device }); emit("listChanged"); });
        return button;
    }));
}

/* ---------------------------------------------------------------- device-only mail */
async function openDevice(id) {
    cleanup();
    const message = state.deviceMessages.find(item => item.id === id);
    if (!message) { showEmpty(); return; }
    if (!message.read) { message.read = true; offline.deviceSave(message).catch(() => {}); emit("listChanged"); }
    const box = mailboxById(message.mailboxId);
    const toolbarNode = el("div", { class: "mail-reader-toolbar", role: "toolbar", "aria-label": t("messageActions") },
        iconButton("arrow_back", t("back"), () => closeReader()),
        button(t("moveToMailbox"), () => moveDeviceToMailbox(message), { iconName: "cloud_upload" }),
        message.html ? iconButton("html", t("viewHtml"), () => showHtml(message)) : null,
        iconButton("download", t("downloadEml"), () => download(new Blob([Uint8Array.from(atob(message.raw), c => c.charCodeAt(0))], { type: "message/rfc822" }), (message.subject || "message").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) + ".eml")),
        iconButton("reply", t("reply"), () => emit("reply", { item: { ...message, id: null, mailboxId: message.mailboxId, folder: "device" }, mode: "reply" })),
        el("span", { class: "mail-spacer" }),
        iconButton("delete_forever", t("removeFromDevice"), async () => {
            const ok = await confirmDialog({ title: t("removeFromDevice"), message: t("removeFromDeviceMessage"), confirm: t("deleteForever"), danger: true });
            if (!ok) return;
            await offline.deviceDelete(message.id);
            state.deviceMessages = state.deviceMessages.filter(item => item.id !== message.id);
            emit("deviceMessages", {}); closeReader();
        }));
    const extra = el("div", { class: "mail-message-extra", style: "padding:0" }, alertBox("warning", "smartphone", t("deviceOnlyTitle"), t("deviceOnlyDetail", { address: box?.address || "" })));
    const body = el("div", { class: "mail-message-body", style: "padding:0" });
    const card = el("article", { class: "mail-message" }, el("div", { class: "mail-message-head" }, stamp(message.from?.name, message.from?.email),
        el("div", { class: "mail-message-who" }, el("strong", { text: message.from?.name || message.from?.email }), el("span", { class: "mu-muted", text: message.from?.email }), el("span", { class: "mu-muted", text: t("toLine", { names: people(message.to) }) })),
        el("span", { class: "mu-muted", text: formatDateTime(message.date || message.receivedAt) })), body);
    reader().replaceChildren(toolbarNode, el("h2", { class: "mail-subject", text: message.subject || t("noSubject") }), extra, card);
    const paper = el("div", { class: "mail-paper" });
    body.append(paper);
    if (message.html) {
        const { html, report } = sanitizeIncoming(message.html, { allowRemote: false });
        disposers.push(mountFrame(paper, html, { onLink: openLink }).dispose);
        extra.append(privacyPanel({ ...message, direction: "in", spamScore: 0 }, report, false, null));
    } else paper.append(plainText(message.text));
    if (message.attachments?.length) body.append(el("p", { class: "mu-muted", style: "padding:0 12px", text: t("deviceAttachmentsHint", { count: message.attachments.length }) }));
}

// Moves device-only mail into the mailbox once space is available (uploads the original MIME).
async function moveDeviceToMailbox(message) {
    const bytes = Uint8Array.from(atob(message.raw), c => c.charCodeAt(0));
    try {
        await upload(`/mailboxes/${message.mailboxId}/import?folder=inbox&read=${message.read ? 1 : 0}`, new Blob([bytes], { type: "message/rfc822" }));
        await offline.deviceDelete(message.id);
        state.deviceMessages = state.deviceMessages.filter(item => item.id !== message.id);
        emit("deviceMessages", {}); emit("reload"); emit("storageStale");
        toast(t("movedToMailbox"), "success");
        closeReader();
    } catch (error) {
        toast(error instanceof ApiError && error.code === "quotaExceeded" ? t("stillFull") : actions.failText(error, "errMoveToMailbox"), "error");
    }
}

export async function moveAllDeviceMail() {
    for (const message of [...state.deviceMessages]) {
        const bytes = Uint8Array.from(atob(message.raw), c => c.charCodeAt(0));
        try {
            await upload(`/mailboxes/${message.mailboxId}/import?folder=inbox&read=${message.read ? 1 : 0}`, new Blob([bytes], { type: "message/rfc822" }));
            await offline.deviceDelete(message.id);
        } catch (error) { toast(error?.code === "quotaExceeded" ? t("stillFull") : actions.failText(error, "errMoveToMailbox"), "error"); break; }
    }
    state.deviceMessages = await offline.deviceList();
    emit("deviceMessages", {}); emit("reload"); emit("storageStale");
}
