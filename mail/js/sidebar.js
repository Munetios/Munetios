// Navigation sidebar: accounts and unified inbox, folders with unread counts, favorites, nested folders, labels,
// saved and smart searches, mail on this device, drag-and-drop targets, and the storage indicator.
import { state, emit, on, mailboxes, mailboxById, folders, labels, primaryMailbox } from "./state.js";
import { post, put, del } from "./api.js";
import { t, formatBytes, formatNumber } from "./i18n.js";
import { el, icon, iconButton, menu, confirmDialog, toast, colorFor, initials, dialog, button, field, select, settingRow, switchControl } from "./ui.js";
import * as actions from "./actions.js";

const SYSTEM = {
    inbox: "inbox", starred: "star", important: "label_important", snoozed: "snooze", sent: "send", drafts: "draft", scheduled: "schedule_send",
    outbox: "outbox", all: "all_inbox", archive: "archive", spam: "report", trash: "delete",
};
const COLORS = ["#8f5cff", "#e05cff", "#3b82f6", "#06b6d4", "#22c55e", "#eab308", "#f97316", "#ef4444", "#ec4899", "#64748b"];
let navigate = () => {};

export function init({ go }) {
    navigate = go;
    on("counts", render);
    on("deviceMessages", render);
    on("bootChanged", render);
    on("storage", renderStorage);
    document.getElementById("storageMini").addEventListener("click", () => emit("openStorage"));
}

function count(view) {
    const boxes = state.scope === "all" ? mailboxes() : [mailboxById(state.scope)].filter(Boolean);
    let total = 0;
    for (const box of boxes) {
        const c = state.counts[box.id];
        if (!c) continue;
        if (["starred", "important", "snoozed", "followup"].includes(view)) total += c[view] || 0;
        else if (["drafts", "scheduled", "outbox"].includes(view)) total += c.totals?.[view] || 0;
        else if (view.startsWith("label:")) total += c.labels?.[view.slice(6)] || 0;
        else total += c.folders?.[view] || 0;
    }
    return total;
}

function navItem(view, label, iconName, { color = null, drop = null, onMenu = null, total = false, draggable = false, hint = "" } = {}) {
    const current = state.view === view;
    const n = count(view);
    const node = el("button", { type: "button", class: "mu-nav-item", "aria-current": current ? "page" : undefined, "data-view": view, title: hint ? `${label} · ${hint}` : label },
        color ? el("span", { class: "mu-icon", "aria-hidden": "true", style: `color:${color}`, text: iconName }) : icon(iconName, current),
        el("span", { class: "mail-nav-label", text: label }, hint ? el("small", { class: "mail-nav-hint", text: hint.split("@")[0] }) : null),
        n ? el("span", { class: "mail-count" + (total ? " is-total" : ""), "aria-label": t(total ? "itemsCount" : "unreadCount", { count: n }), text: formatNumber(n) }) : null);
    node.addEventListener("click", () => { navigate(view); document.body.classList.remove("nav-open"); });
    if (onMenu) node.addEventListener("contextmenu", event => { event.preventDefault(); onMenu(node, event); });
    if (drop) {
        node.addEventListener("dragover", event => { if (event.dataTransfer.types.includes("application/x-munetios-mail")) { event.preventDefault(); node.classList.add("is-drop"); } });
        node.addEventListener("dragleave", () => node.classList.remove("is-drop"));
        node.addEventListener("drop", event => {
            event.preventDefault();
            node.classList.remove("is-drop");
            try { const data = JSON.parse(event.dataTransfer.getData("application/x-munetios-mail")); drop(data.ids, data.mailboxId); } catch { /* not a message */ }
        });
    }
    if (draggable) node.draggable = true;
    return node;
}

export function render() {
    renderMailboxes();
    const nav = document.getElementById("mailNav");
    const prefs = state.prefs?.layout || {};
    const hidden = new Set(prefs.navHidden || []);
    const order = prefs.navOrder || Object.keys(SYSTEM);
    const system = el("div", { class: "mu-nav" });
    for (const view of order) {
        if (hidden.has(view)) continue;
        const drop = ["inbox", "archive", "spam", "trash"].includes(view) ? ids => actions.moveTo(ids, view)
            : view === "starred" ? ids => actions.star(ids, true) : view === "important" ? ids => actions.important(ids, true) : null;
        system.append(navItem(view, t(view === "all" ? "allMail" : view), SYSTEM[view], { drop, total: ["drafts", "scheduled", "outbox"].includes(view),
            onMenu: ["trash", "spam"].includes(view) ? anchor => menu(anchor, [{ icon: "delete_forever", label: view === "trash" ? t("emptyTrash") : t("emptySpam"), danger: true, action: () => emptyFor(view) }]) : null }));
    }
    if (count("followup")) system.append(navItem("followup", t("followUps"), "flag"));
    if (state.deviceMessages.length) system.append(navItem("device", t("onThisDevice"), "smartphone"));
    const parts = [system];

    const scopeBoxes = state.scope === "all" ? mailboxes().map(box => box.id) : [state.scope];
    const scopedFolders = folders().filter(folder => scopeBoxes.includes(folder.mailboxId));
    const scopedLabels = labels().filter(label => scopeBoxes.includes(label.mailboxId));
    // Each folder and label appears exactly once: favorites (with their subfolders) move to the Favorites section.
    const byPosition = (a, b) => (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name);
    const multiBox = state.scope === "all" && scopeBoxes.length > 1;
    const boxHint = item => multiBox ? (mailboxById(item.mailboxId)?.address || "") : "";
    const subtree = (folder, container) => {
        container.append(folderItem(folder, boxHint(folder)));
        const kids = scopedFolders.filter(item => item.parentId === folder.id && !item.favorite).sort(byPosition);
        if (kids.length) {
            const children = el("div", { class: "mu-nav mail-nav-children" });
            for (const kid of kids) subtree(kid, children);
            container.append(children);
        }
    };
    const favoriteFolders = scopedFolders.filter(item => item.favorite).sort(byPosition);
    const favoriteLabels = scopedLabels.filter(item => item.favorite).sort(byPosition);
    if (favoriteFolders.length || favoriteLabels.length) {
        parts.push(el("div", { class: "mail-nav-section" }, el("span", { text: t("favorites") })));
        const favNav = el("div", { class: "mu-nav" });
        for (const folder of favoriteFolders) subtree(folder, favNav);
        for (const label of favoriteLabels) favNav.append(labelItem(label, boxHint(label)));
        parts.push(favNav);
    }
    parts.push(section(t("folders"), () => editFolder(null)));
    const tree = el("div", { class: "mu-nav" });
    const known = new Set(scopedFolders.map(item => item.id));
    for (const folder of scopedFolders.filter(item => !item.favorite && (!item.parentId || !known.has(item.parentId))).sort(byPosition)) subtree(folder, tree);
    parts.push(tree);
    parts.push(section(t("labels"), () => editLabel(null)));
    parts.push(el("div", { class: "mu-nav" }, scopedLabels.filter(item => !item.favorite).sort(byPosition).map(item => labelItem(item, boxHint(item)))));
    const searches = (state.boot?.savedSearches || []).filter(item => scopeBoxes.includes(item.mailboxId));
    if (searches.length) {
        parts.push(el("div", { class: "mail-nav-section" }, el("span", { text: t("savedSearches") })));
        parts.push(el("div", { class: "mu-nav" }, searches.map(item => {
            const node = el("button", { type: "button", class: "mu-nav-item", "aria-current": state.view === "search" && state.query === item.query ? "page" : undefined }, icon(item.icon || "saved_search"), el("span", { class: "mail-nav-label", text: item.name }));
            node.addEventListener("click", () => { emit("runSearch", item.query); document.body.classList.remove("nav-open"); });
            node.addEventListener("contextmenu", event => { event.preventDefault(); menu(node, [{ icon: "delete", label: t("delete"), danger: true, action: async () => { await del(`/mailboxes/${item.mailboxId}/searches/${item.id}`); emit("refreshBoot"); } }]); });
            return node;
        })));
    }
    nav.replaceChildren(...parts);
}

function section(title, onAdd) {
    return el("div", { class: "mail-nav-section" }, el("span", { text: title }), iconButton("add", t("addItem", { item: title }), onAdd, { class: "mu-icon-btn mu-icon-btn-sm" }));
}

function folderItem(folder, hint = "") {
    return navItem(folder.id, folder.name, folder.icon || "folder", { color: folder.color || null, hint, drop: ids => actions.moveTo(ids, folder.id),
        onMenu: anchor => menu(anchor, [
            { icon: "edit", label: t("edit"), action: () => editFolder(folder) },
            { icon: "create_new_folder", label: t("newSubfolder"), action: () => editFolder(null, folder.id, folder.mailboxId) },
            { icon: folder.favorite ? "star" : "star_outline", label: folder.favorite ? t("removeFavorite") : t("addFavorite"), action: () => put(`/folders/${folder.id}`, { favorite: !folder.favorite }).then(() => emit("refreshBoot")) },
            "sep",
            { icon: "delete", label: t("deleteFolder"), danger: true, action: () => deleteFolder(folder) },
        ]) });
}

function labelItem(label, hint = "") {
    return navItem("label:" + label.id, label.name, label.icon || "label", { color: label.color, hint, drop: ids => actions.update(ids, { addLabels: [label.id] }),
        onMenu: anchor => menu(anchor, [
            { icon: "edit", label: t("edit"), action: () => editLabel(label) },
            { icon: label.favorite ? "star" : "star_outline", label: label.favorite ? t("removeFavorite") : t("addFavorite"), action: () => put(`/labels/${label.id}`, { favorite: !label.favorite }).then(() => emit("refreshBoot")) },
            "sep",
            { icon: "delete", label: t("deleteLabel"), danger: true, action: () => deleteLabel(label) },
        ]) });
}

export async function deleteFolder(folder) {
    if (!await confirmDialog({ title: t("deleteFolder"), message: t("deleteFolderMessage", { name: folder.name }), confirm: t("delete"), danger: true })) return false;
    try { await del(`/folders/${folder.id}`); } catch (error) { toast(actions.errorText(error), "error"); return false; }
    if (state.view === folder.id) navigate("inbox");
    emit("refreshBoot");
    return true;
}

export async function deleteLabel(label) {
    if (!await confirmDialog({ title: t("deleteLabel"), message: t("deleteLabelMessage", { name: label.name }), confirm: t("delete"), danger: true })) return false;
    try { await del(`/labels/${label.id}`); } catch (error) { toast(actions.errorText(error), "error"); return false; }
    if (state.view === "label:" + label.id) navigate("inbox");
    emit("refreshBoot");
    return true;
}

function editor({ title, iconName, item, kind, parentId, mailboxId }) {
    const name = el("input", { class: "mu-input", value: item?.name || "", maxlength: kind === "label" ? 80 : 120 });
    let color = item?.color || (kind === "label" ? COLORS[0] : "");
    const swatches = el("div", { class: "mu-swatches", role: "group", "aria-label": t("color") }, COLORS.map(value => {
        const swatch = el("button", { type: "button", class: "mu-swatch", style: `background:${value}`, "aria-label": value, "aria-pressed": String(value === color) });
        swatch.addEventListener("click", () => { color = value; swatches.querySelectorAll(".mu-swatch").forEach(node => node.setAttribute("aria-pressed", String(node === swatch))); });
        return swatch;
    }));
    const iconInput = el("input", { class: "mu-input", value: item?.icon || (kind === "label" ? "label" : "folder"), maxlength: 40, spellcheck: "false" });
    let isFavorite = Boolean(item?.favorite);
    const favorite = settingRow(t("favorite"), "", switchControl(t("favorite"), isFavorite, on => { isFavorite = on; }));
    const boxes = mailboxes();
    let targetBox = mailboxId || item?.mailboxId || primaryMailbox()?.id;
    const content = [field(t("name"), name), field(t("color"), swatches), field(t("iconName"), iconInput, t("iconNameHelp")), favorite];
    if (!item && boxes.length > 1 && !mailboxId) content.unshift(field(t("mailbox"), select(t("mailbox"), boxes.map(box => ({ value: box.id, label: box.address })), targetBox, value => { targetBox = value; })));
    if (kind === "folder" && !item && !parentId) {
        const parents = folders().filter(folder => folder.mailboxId === targetBox);
        if (parents.length) content.push(field(t("parentFolder"), select(t("parentFolder"), [{ value: "", label: t("none") }, ...parents.map(folder => ({ value: folder.id, label: folder.name }))], "", value => { parentId = value || null; })));
    }
    const d = dialog({ title, iconName, content, actions: [
        button(t("cancel"), () => d.close()),
        button(t("save"), async () => {
            const body = { name: name.value.trim(), color, icon: iconInput.value.trim(), favorite: isFavorite };
            if (!body.name) { name.focus(); return; }
            try {
                if (item) await put(`/${kind}s/${item.id}`, body);
                else await post(`/${kind}s`, { ...body, mailboxId: targetBox, ...(parentId ? { parentId } : {}) });
                d.close(); emit("refreshBoot");
            } catch (error) { toast(actions.errorText(error), "error"); }
        }, { primary: true }),
    ] });
    setTimeout(() => name.focus(), 50);
}

export const editFolder = (folder, parentId = null, mailboxId = null) => editor({ title: folder ? t("editFolder") : t("newFolder"), iconName: "create_new_folder", item: folder, kind: "folder", parentId, mailboxId });
export const editLabel = (label, mailboxId = null) => editor({ title: label ? t("editLabel") : t("newLabel"), iconName: "new_label", item: label, kind: "label", mailboxId });

function emptyFor(view) {
    const box = state.scope === "all" ? primaryMailbox() : mailboxById(state.scope);
    if (box) actions.emptyFolder(view, box.id);
}

function avatarFor(box) {
    const node = el("span", { class: "mail-avatar-sm", style: `background:${colorFor(box.address)}` });
    if (box.hasPicture) node.append(el("img", { src: `/api/mail/v1/mailboxes/${box.id}/picture`, alt: "" }));
    else node.textContent = initials(box.displayName, box.address);
    return node;
}

function renderMailboxes() {
    const container = document.getElementById("mailboxPicker");
    const boxes = mailboxes();
    if (boxes.length <= 1) { container.replaceChildren(); return; }
    const items = [el("button", { type: "button", class: "mu-nav-item", "aria-current": state.scope === "all" ? "true" : undefined, title: t("allInboxes"), onclick: () => emit("scope", "all") },
        icon("stacks"), el("span", { class: "mail-nav-label", text: t("allInboxes") }))];
    for (const box of boxes) {
        items.push(el("button", { type: "button", class: "mu-nav-item", "aria-current": state.scope === box.id ? "true" : undefined, title: box.address, onclick: () => emit("scope", box.id) },
            avatarFor(box), el("span", { class: "mail-nav-label", text: box.displayName || box.address }),
            (state.counts[box.id]?.folders?.inbox || 0) ? el("span", { class: "mail-count", text: formatNumber(state.counts[box.id].folders.inbox) }) : null));
    }
    container.replaceChildren(el("div", { class: "mu-nav" }, items));
}

export function renderStorage() {
    const node = document.getElementById("storageMini");
    const box = primaryMailbox();
    const storage = box ? (state.storage[box.id] || box.storage) : null;
    if (!storage) { node.replaceChildren(); return; }
    const percent = Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100);
    node.className = "mail-storage-mini" + (percent >= 95 ? " is-danger" : percent >= 80 ? " is-warning" : "");
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    node.setAttribute("aria-label", t("storageUsedOf", { used: formatBytes(storage.usedBytes), total: formatBytes(storage.quotaBytes) }));
    node.replaceChildren(
        el("div", { class: "mail-storage-text" }, el("span", { text: t("storage") }), el("span", { text: `${Math.round(percent)}%` })),
        el("div", { class: "mu-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(percent)), "aria-label": t("storage") }, el("span", { style: `width:${percent}%` })),
        el("div", { class: "mail-storage-text" }, el("span", { text: t("storageUsedOf", { used: formatBytes(storage.usedBytes), total: formatBytes(storage.quotaBytes) }) })));
    node.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); emit("openStorage"); } };
}
