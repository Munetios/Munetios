// Storage dashboard: usage against the 20 GB quota, breakdown by category, warnings, cleanup recommendations based on
// size and age, the largest messages and attachments with bulk deletion, automatic Trash/Spam cleanup, and mail kept
// on this device while the mailbox was full.
import { state, emit, mailboxes, mailboxById, primaryMailbox } from "./state.js";
import { get, put } from "./api.js";
import { t, formatBytes, formatNumber, formatListDate } from "./i18n.js";
import { el, icon, dialog, button, select, toast, emptyState, alertBox, settingRow, check } from "./ui.js";
import * as actions from "./actions.js";
import { moveAllDeviceMail } from "./reader.js";

const COLORS = { inbox: "#8f5cff", archive: "#3b82f6", sent: "#22c55e", drafts: "#eab308", scheduled: "#06b6d4", outbox: "#14b8a6", folders: "#ec4899", spam: "#f97316", trash: "#ef4444", other: "#94a3b8" };

export function open(mailboxId = null) {
    let current = mailboxId || (state.scope !== "all" ? state.scope : primaryMailbox()?.id);
    const content = el("div", { style: "display:grid;gap:16px" });
    const d = dialog({ title: t("manageStorage"), iconName: "storage", size: "mu-dialog-lg", content: [content], actions: [button(t("close"), () => d.close(), { primary: true })] });
    d.dialog.style.width = "min(1000px, 100%)";
    const render = async () => {
        content.replaceChildren(el("span", { class: "mu-skeleton is-block" }));
        let summary;
        try { summary = await get(`/storage?mailbox=${current}`); state.storage[current] = summary; emit("storage"); }
        catch (error) { content.replaceChildren(alertBox("danger", "error", t("errLoadStorage"), "")); return; }
        const box = mailboxById(current);
        const parts = [];
        if (mailboxes().length > 1) parts.push(select(t("mailbox"), mailboxes().map(item => ({ value: item.id, label: item.address })), current, value => { current = value; render(); }));
        parts.push(hero(summary));
        if (summary.full) parts.push(alertBox("danger", "storage", t("storageFullTitle", { address: box.address }), t("storageFullDetail")));
        else if (summary.warningLevel) parts.push(alertBox(summary.warningLevel >= 95 ? "danger" : "warning", "warning", t("storageWarning", { percent: summary.warningLevel }), t("storageWarningDetail")));
        const device = state.deviceMessages.filter(item => item.mailboxId === current);
        if (device.length) parts.push(alertBox("warning", "smartphone", t("deviceMailBanner", { count: formatNumber(device.length) }), t("deviceMailBannerDetail"), [button(t("moveAllToMailbox"), async () => { await moveAllDeviceMail(); render(); })]));
        parts.push(el("h3", { class: "mu-h-title", text: t("recommendations") }));
        parts.push(summary.recommendations.length ? el("div", { class: "mail-list-editor" }, summary.recommendations.map(item => el("div", { class: "mail-list-item" },
            icon({ trash: "delete", spam: "report", large: "unfold_more", oldAttachments: "attach_file", oldPromotions: "sell", oldUnreadBulk: "mark_email_unread" }[item.id] || "lightbulb"),
            el("span", { text: `${t("rec_" + item.id)} · ${t("messagesTotal", { count: formatNumber(item.count) })} · ${formatBytes(item.bytes)}` }),
            item.id === "trash" || item.id === "spam" ? button(item.id === "trash" ? t("emptyTrash") : t("emptySpam"), async () => { await actions.emptyFolder(item.id, current); render(); }, { danger: true })
                : button(t("review"), () => { d.close(); emit("scope", current); emit("runSearch", item.query); })))) : el("p", { class: "mu-muted", text: t("noRecommendations") }));
        parts.push(el("h3", { class: "mu-h-title", text: t("autoCleanup") }));
        const retention = box.settings?.retention || { trashDays: 30, spamDays: 30 };
        const days = [0, 7, 14, 30, 60, 90, 180, 365].map(value => ({ value, label: value ? t("daysCount", { count: value }) : t("never") }));
        const saveRetention = async patch => {
            try { const result = await put(`/mailboxes/${current}/settings`, { retention: { ...retention, ...patch } }); box.settings = result.settings; Object.assign(retention, patch); toast(t("saved"), "success"); }
            catch (error) { toast(actions.failText(error, "errSaveSetting"), "error"); }
        };
        parts.push(settingRow(t("trashRetention"), t("trashRetentionHelp"), select(t("trashRetention"), days, retention.trashDays, value => saveRetention({ trashDays: Number(value) }))));
        parts.push(settingRow(t("spamRetention"), t("spamRetentionHelp"), select(t("spamRetention"), days, retention.spamDays, value => saveRetention({ spamDays: Number(value) }))));
        parts.push(el("h3", { class: "mu-h-title", text: t("largestMessages") }));
        parts.push(await largeTable(current, "messages", render));
        parts.push(el("h3", { class: "mu-h-title", text: t("largestAttachments") }));
        parts.push(await largeTable(current, "attachments", render));
        parts.push(el("p", { class: "mu-muted", style: undefined, text: t("storageExplainer") }));
        content.replaceChildren(...parts);
    };
    render();
}

function hero(summary) {
    const percent = Math.min(100, (summary.usedBytes / summary.quotaBytes) * 100);
    const categories = Object.entries(summary.categories).map(([key, value]) => ({ key, bytes: value.bytes, count: value.count }));
    const counted = categories.reduce((sum, item) => sum + item.bytes, 0);
    const other = Math.max(0, summary.usedBytes - counted);
    if (other > 0) categories.push({ key: "other", bytes: other, count: 0 });
    const bar = el("div", { class: "mail-storage-bar", role: "img", "aria-label": t("storageUsedOf", { used: formatBytes(summary.usedBytes), total: formatBytes(summary.quotaBytes) }) },
        categories.filter(item => item.bytes > 0).map(item => el("span", { style: `width:${(item.bytes / summary.quotaBytes) * 100}%;background:${COLORS[item.key] || COLORS.other}`, title: `${t("storage_" + item.key)}: ${formatBytes(item.bytes)}` })));
    return el("div", { class: "mail-storage-hero" },
        el("strong", { text: t("storageUsedOf", { used: formatBytes(summary.usedBytes), total: formatBytes(summary.quotaBytes) }) }),
        el("div", { class: "mu-muted", text: `${t("storageAvailable", { size: formatBytes(summary.availableBytes) })} · ${Math.round(percent)}%${summary.reservedBytes ? " · " + t("storageReserved", { size: formatBytes(summary.reservedBytes) }) : ""}` }),
        bar,
        el("div", { class: "mail-storage-legend" }, categories.filter(item => item.bytes > 0).map(item => el("span", {}, el("i", { style: `background:${COLORS[item.key] || COLORS.other}` }), `${t("storage_" + item.key)} ${formatBytes(item.bytes)}`))),
        el("div", { class: "mu-muted", style: undefined, text: `${t("attachmentsTotal", { size: formatBytes(summary.attachmentBytes) })} · ${t("customizationStorage", { size: formatBytes(summary.customizationBytes) })}${summary.pendingUploads.count ? " · " + t("pendingUploads", { size: formatBytes(summary.pendingUploads.bytes) }) : ""}` }));
}

async function largeTable(mailboxId, kind, refresh) {
    let data;
    try { data = await get(`/storage/large?mailbox=${mailboxId}&kind=${kind}&min=100000`); }
    catch { return emptyState("error", t("errLoadStorage"), ""); }
    const rows = kind === "messages" ? data.messages : data.attachments;
    if (!rows.length) return el("p", { class: "mu-muted", text: t("nothingLarge") });
    const selected = new Set();
    const ids = () => kind === "messages" ? [...selected] : [...new Set(rows.filter(row => selected.has(row.id)).map(row => row.messageId))];
    const bulk = el("div", { class: "mail-inline-form", style: "flex:none" },
        button(t("moveToTrashSelected"), async () => { if (!selected.size) return; await actions.trash(ids()); refresh(); }),
        button(t("deleteForeverSelected"), async () => { if (!selected.size) return; await actions.deleteForever(ids(), { failKey: "errFreeSpace" }); refresh(); }, { danger: true }));
    const table = el("table", { class: "mail-table" }, el("thead", {}, el("tr", {}, el("th", { "aria-label": t("select") }),
        el("th", { text: kind === "messages" ? t("subject") : t("attachmentName") }), el("th", { text: t("from") }), el("th", { text: t("date") }), el("th", { text: t("folder") }), el("th", { class: "is-num", text: t("size") }))),
        el("tbody", {}, rows.map(row => {
            const box = check(el("span", { class: "mu-visually-hidden", text: t("select") }), false, value => { if (value) selected.add(row.id); else selected.delete(row.id); });
            return el("tr", {}, el("td", {}, box), el("td", { text: kind === "messages" ? row.subject || t("noSubject") : `${row.filename} (${row.subject || t("noSubject")})` }),
                el("td", { text: kind === "messages" ? row.from?.email || "" : row.fromAddr }), el("td", { text: formatListDate(row.date) }), el("td", { text: actions.folderName(row.folder) }), el("td", { class: "is-num", text: formatBytes(row.size) }));
        })));
    return el("div", { style: "display:grid;gap:8px" }, bulk, el("div", { class: "mail-table-wrap" }, table));
}
