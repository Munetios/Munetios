// Message actions with optimistic updates, offline queueing, and undo.
import { state, emit, folders, labels, mailboxById } from "./state.js";
import { perform } from "./sync.js";
import { post, ApiError } from "./api.js";
import { t, formatDateTime } from "./i18n.js";
import { el, icon, toast, menu, confirmDialog, dialog, button, field, dateTimeField, toLocalDateTime, fromLocalDateTime } from "./ui.js";

let undoTimer = null;
export function showUndo(message, undo, seconds = 8) {
    const bar = document.getElementById("undoBar");
    clearTimeout(undoTimer);
    bar.className = "mail-undo mu-glass mu-glass-solid";
    bar.replaceChildren(el("span", { text: message }), undo ? button(t("undo"), async () => { bar.hidden = true; await undo(); }, { class: "mu-btn mu-btn-ghost" }) : null,
        el("button", { type: "button", class: "mu-icon-btn mu-icon-btn-sm", "aria-label": t("close"), onclick: () => { bar.hidden = true; } }, icon("close")));
    bar.hidden = false;
    undoTimer = setTimeout(() => { bar.hidden = true; }, seconds * 1000);
}

const byId = id => state.items.find(item => item?.id === id);

function errorText(error) {
    if (error instanceof ApiError) return t("error_" + error.code) || t("actionFailed");
    return t("actionFailed");
}

// patch: server patch. Applies locally first, rolls back if the server refuses.
export async function update(ids, patch, { message = "", undoPatch = null, silent = false } = {}) {
    const list = [...ids].filter(id => !String(id).startsWith("dd_"));
    if (!list.length) return;
    const before = list.map(id => ({ id, item: byId(id) && { ...byId(id) } }));
    applyLocal(list, patch);
    try {
        await perform("/messages/update", "POST", { ids: list, patch });
        if (message && !silent) showUndo(message, undoPatch ? () => update(list, typeof undoPatch === "function" ? undoPatch(before) : undoPatch, { silent: true }) : null);
    } catch (error) {
        for (const { id, item } of before) if (item) Object.assign(byId(id) || {}, item);
        emit("listChanged");
        toast(errorText(error), "error");
    }
}

function applyLocal(ids, patch) {
    const leaves = patch.folder !== undefined || patch.spam !== undefined || patch.restore || patch.snoozeUntil;
    for (const id of ids) {
        const item = byId(id);
        if (!item) continue;
        if ("read" in patch) item.read = patch.read;
        if ("starred" in patch) item.starred = patch.starred;
        if ("important" in patch) item.important = patch.important;
        if ("pinned" in patch) item.pinned = patch.pinned;
        if (patch.addLabels) item.labels = [...new Set([...(item.labels || []), ...patch.addLabels])];
        if (patch.removeLabels) item.labels = (item.labels || []).filter(label => !patch.removeLabels.includes(label));
        if (patch.folder) item.folder = patch.folder;
    }
    if (leaves && !["search", "all", "starred", "important"].includes(state.view)) emit("removeRows", ids);
    emit("listChanged");
    emit("countsStale");
}

export const archive = ids => update(ids, { folder: "archive" }, { message: t("archivedMessages", { count: ids.length }), undoPatch: before => ({ folder: before[0]?.item?.folder || "inbox" }) });
export const trash = ids => update(ids, { folder: "trash" }, { message: t("movedToTrash", { count: ids.length }), undoPatch: { restore: true } });
export const markRead = (ids, read = true) => update(ids, { read });
export const star = (ids, starred) => update(ids, { starred });
export const important = (ids, value) => update(ids, { important: value });
export const pin = (ids, value) => update(ids, { pinned: value });
export const spam = (ids, value = true) => update(ids, { spam: value }, { message: value ? t("reportedSpam") : t("notSpamDone"), undoPatch: { spam: !value } });
export const restore = ids => update(ids, { restore: true }, { message: t("restoredMessages") });

export function moveTo(ids, folder) {
    const name = folderName(folder);
    return update(ids, { folder }, { message: t("movedTo", { folder: name }), undoPatch: before => ({ folder: before[0]?.item?.folder || "inbox" }) });
}

export function folderName(folder) {
    const system = { inbox: t("inbox"), archive: t("archive"), spam: t("spam"), trash: t("trash"), sent: t("sent") };
    return system[folder] || folders().find(item => item.id === folder)?.name || folder;
}

export async function deleteForever(ids) {
    const list = [...ids].filter(id => !String(id).startsWith("dd_"));
    if (!list.length) return;
    if (state.prefs?.behavior?.confirmDelete !== false) {
        const ok = await confirmDialog({ title: t("deleteForeverTitle"), message: t("deleteForeverMessage", { count: list.length }), confirm: t("deleteForever"), danger: true });
        if (!ok) return;
    }
    emit("removeRows", list);
    try {
        await perform("/messages/delete", "POST", { ids: list });
        toast(t("deletedForever"), "success");
        emit("storageStale");
    } catch (error) { toast(errorText(error), "error"); emit("reload"); }
}

export function moveMenu(anchor, ids, mailboxId) {
    const custom = folders().filter(folder => folder.mailboxId === mailboxId);
    menu(anchor, [
        ...["inbox", "archive", "spam", "trash"].map(folder => ({ icon: { inbox: "inbox", archive: "archive", spam: "report", trash: "delete" }[folder], label: folderName(folder), action: () => moveTo(ids, folder) })),
        custom.length ? "sep" : null,
        ...custom.map(folder => ({ icon: folder.icon || "folder", label: folder.name, action: () => moveTo(ids, folder.id) })),
    ], { label: t("moveTo") });
}

export function labelMenu(anchor, ids, mailboxId) {
    const items = ids.map(byId).filter(Boolean);
    const options = labels().filter(label => label.mailboxId === mailboxId);
    if (!options.length) { toast(t("noLabelsYet")); return; }
    menu(anchor, options.map(label => {
        const all = items.length && items.every(item => item.labels?.includes(label.id));
        return { icon: label.icon || "label", label: label.name, checked: all, action: () => update(ids, all ? { removeLabels: [label.id] } : { addLabels: [label.id] }) };
    }), { label: t("labels") });
}

// Snooze until a chosen date and time.
export function snoozeMenu(anchor, ids) {
    const at = (days, hour) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hour, 0, 0, 0); return date.getTime(); };
    const laterToday = Date.now() + 3 * 3_600_000;
    const nextWeek = (() => { const date = new Date(); date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7)); date.setHours(8, 0, 0, 0); return date.getTime(); })();
    const snooze = until => update(ids, { snoozeUntil: until }, { message: t("snoozedUntil", { time: formatDateTime(until) }), undoPatch: { snoozeUntil: null } });
    menu(anchor, [
        { icon: "schedule", label: t("laterToday"), shortcut: formatDateTime(laterToday).split(",").pop().trim(), action: () => snooze(laterToday) },
        { icon: "wb_sunny", label: t("tomorrow"), action: () => snooze(at(1, 8)) },
        { icon: "weekend", label: t("thisWeekend"), action: () => snooze(at((6 - new Date().getDay() + 7) % 7 || 7, 9)) },
        { icon: "next_week", label: t("nextWeek"), action: () => snooze(nextWeek) },
        "sep",
        { icon: "edit_calendar", label: t("pickDateTime"), action: () => pickDateTime(t("snooze"), snooze) },
    ], { label: t("snooze") });
}

export function followUpMenu(anchor, ids) {
    const set = until => update(ids, { followUpAt: until }, { message: t("followUpSet", { time: formatDateTime(until) }) });
    menu(anchor, [
        { icon: "event", label: t("tomorrow"), action: () => set(Date.now() + 86_400_000) },
        { icon: "date_range", label: t("inThreeDays"), action: () => set(Date.now() + 3 * 86_400_000) },
        { icon: "next_week", label: t("nextWeek"), action: () => set(Date.now() + 7 * 86_400_000) },
        { icon: "edit_calendar", label: t("pickDateTime"), action: () => pickDateTime(t("followUp"), set) },
        "sep",
        { icon: "event_busy", label: t("clearFollowUp"), action: () => update(ids, { followUpAt: null }) },
    ], { label: t("followUp") });
}

export function pickDateTime(title, onPick) {
    const soon = new Date(Date.now() + 3_600_000);
    soon.setMinutes(0, 0, 0);
    let chosen = toLocalDateTime(soon.getTime());
    const d = dialog({ title, iconName: "event", content: [field(t("dateAndTime"), dateTimeField(t("dateAndTime"), chosen, value => { chosen = value; }))], actions: [
        button(t("cancel"), () => d.close()),
        button(t("confirm"), () => {
            const value = fromLocalDateTime(chosen);
            if (!value || value <= Date.now()) { toast(t("chooseFutureTime"), "error"); return; }
            d.close(); onPick(value);
        }, { primary: true }),
    ] });
}

export async function emptyFolder(folder, mailboxId) {
    const box = mailboxById(mailboxId);
    const ok = await confirmDialog({ title: folder === "trash" ? t("emptyTrash") : t("emptySpam"), message: t("emptyFolderMessage", { address: box?.address || "" }), confirm: t("deleteForever"), danger: true });
    if (!ok) return;
    try {
        const result = await post("/folders/empty", { mailboxId, folder });
        toast(t("deletedCount", { count: result.deleted }), "success");
        emit("reload"); emit("storageStale");
    } catch (error) { toast(errorText(error), "error"); }
}

export { errorText };
