// Virtualized message list: windowed rendering for very large mailboxes, paged loading, multi-select,
// keyboard navigation, context menus, drag-and-drop to folders and labels, and touch swipe gestures.
import { state, emit, on, labelById, mailboxById, mailboxes } from "./state.js";
import { get, ApiError } from "./api.js";
import { t, formatListDate, formatNumber, formatBytes } from "./i18n.js";
import { el, icon, iconButton, stamp, menu, emptyState } from "./ui.js";
import * as actions from "./actions.js";
import * as offline from "./offline.js";

const PAGE = 60;
const list = () => document.getElementById("mailList");
let rowHeight = 84;
let spacer;
let loading = new Set();
let generation = 0;
let lastFocus = 0;
let onOpen = () => {};

export function init({ open }) {
    onOpen = open;
    const node = list();
    spacer = el("div", { class: "mail-list-spacer" });
    node.append(spacer);
    node.addEventListener("scroll", () => requestAnimationFrame(render), { passive: true });
    new ResizeObserver(() => render()).observe(node);
    node.addEventListener("keydown", onKey);
    on("listChanged", render);
    on("removeRows", ids => {
        const set = new Set(ids);
        const before = state.items.length;
        state.items = state.items.filter(item => !item || !set.has(item.id));
        state.total = Math.max(0, state.total - (before - state.items.length));
        for (const id of ids) state.selection.delete(id);
        emit("selection");
        render();
    });
}

export function measure() {
    const density = state.prefs?.layout?.density || "comfortable";
    const lines = Number(state.prefs?.layout?.previewLines ?? 1);
    // Fixed row height for virtualization, from the real text metrics: sender and subject lines, preview lines, chips.
    const line = Math.ceil((state.prefs?.typography?.size || 18) * (state.prefs?.typography?.lineHeight || 1.5));
    const pad = { compact: 6, comfortable: 12, spacious: 18 }[density];
    rowHeight = Math.ceil(pad * 2 + line * (2 + lines) + 36 + 8);
    document.body.dataset.preview = String(lines);
    document.documentElement.style.setProperty("--mail-preview-lines", String(Math.max(1, lines)));
    render();
}

function params(offset) {
    const search = new URLSearchParams({ mailbox: state.scope, view: state.view, offset, limit: PAGE, sort: state.sort, tz: String(-new Date().getTimezoneOffset()) });
    if (state.view === "search") search.set("q", state.query);
    if (state.view === "inbox" && state.address) search.set("address", state.address);
    if (state.filter) search.set("filter", state.filter);
    if (state.view === "inbox" && state.prefs?.layout?.categoryTabs && state.category && state.category !== "all") search.set("category", state.category);
    if (state.prefs?.layout?.conversationView && !["drafts", "search", "scheduled", "outbox"].includes(state.view)) search.set("threads", "1");
    return search;
}

const cacheKey = () => `list:${state.scope}:${state.view}:${state.address || ""}:${state.category}:${state.filter}:${state.sort}:${state.query}`;

export async function reload({ keepScroll = false } = {}) {
    const current = ++generation;
    loading = new Set();
    if (!keepScroll) { list().scrollTop = 0; state.selection.clear(); emit("selection"); }
    if (state.view === "device") {
        state.items = state.deviceMessages.map(deviceRow);
        state.total = state.items.length;
        render(); emit("listLoaded");
        return;
    }
    if (!state.items.length || !keepScroll) showSkeleton();
    try {
        const page = await get("/messages?" + params(0));
        if (current !== generation) return;
        state.items = page.messages;
        state.total = page.total;
        offline.cachePut(cacheKey(), { messages: page.messages, total: page.total }).catch(() => {});
    } catch (error) {
        if (current !== generation) return;
        const cached = await offline.cacheGet(cacheKey());
        if (cached) { state.items = cached.messages; state.total = cached.total; emit("showingCached"); }
        else { state.items = []; state.total = 0; renderError(error); return; }
    }
    render();
    emit("listLoaded");
}

function deviceRow(message) {
    return {
        id: message.id, mailboxId: message.mailboxId, device: true, subject: message.subject, from: message.from, to: message.to, snippet: String(message.text || "").replace(/\s+/g, " ").slice(0, 200),
        date: message.date || message.receivedAt, read: Boolean(message.read), attachments: (message.attachments || []).filter(item => item.disposition !== "inline").length, labels: [], folder: "device",
    };
}

async function loadPage(index) {
    const offset = Math.floor(index / PAGE) * PAGE;
    if (loading.has(offset) || offset >= state.total) return;
    loading.add(offset);
    const current = generation;
    try {
        const page = await get("/messages?" + params(offset));
        if (current !== generation) return;
        page.messages.forEach((item, i) => { state.items[offset + i] = item; });
        render();
    } catch { loading.delete(offset); }
}

function showSkeleton() {
    spacer.style.height = "100%";
    spacer.replaceChildren(...Array.from({ length: 8 }, (_, i) => el("div", { class: "mail-skeleton-row", style: `top:${i * rowHeight}px;height:${rowHeight}px` },
        el("span", { class: "mu-skeleton is-circle" }), el("div", {}, el("span", { class: "mu-skeleton is-title" }), el("span", { class: "mu-skeleton is-text" })))));
}

function renderError(error) {
    spacer.style.height = "auto";
    const offlineError = error instanceof ApiError && error.code === "offline";
    spacer.replaceChildren(emptyState(offlineError ? "cloud_off" : "error", offlineError ? t("offlineNoCache") : t("errLoadLatestFailed"), offlineError ? t("offlineNoCacheDetail") : t("tryAgainLater"),
        el("button", { type: "button", class: "mu-btn", onclick: () => reload() }, icon("refresh"), t("retry"))));
}

function emptyFor() {
    const map = { inbox: ["inbox", t("emptyInbox"), t("emptyInboxDetail")], starred: ["star", t("emptyStarred"), ""], snoozed: ["snooze", t("emptySnoozed"), ""], drafts: ["draft", t("emptyDrafts"), ""],
        scheduled: ["schedule_send", t("emptyScheduled"), ""], outbox: ["outbox", t("emptyOutbox"), ""], spam: ["report", t("emptySpam"), t("emptySpamDetail")], trash: ["delete", t("emptyTrashState"), ""],
        search: ["search_off", t("noResults"), t("noResultsDetail")], device: ["smartphone", t("emptyDevice"), t("emptyDeviceDetail")] };
    const [name, title, detail] = map[state.view] || ["mail", t("emptyFolder"), ""];
    return emptyState(name, title, detail);
}

export function render() {
    const node = list();
    if (!spacer) return;
    if (!state.total) { spacer.style.height = "auto"; spacer.replaceChildren(emptyFor()); return; }
    spacer.style.height = state.total * rowHeight + "px";
    const top = node.scrollTop;
    const height = node.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / rowHeight) - 6);
    const last = Math.min(state.total - 1, Math.ceil((top + height) / rowHeight) + 6);
    const rows = [];
    for (let index = first; index <= last; index++) {
        const item = state.items[index];
        if (!item) { loadPage(index); rows.push(el("div", { class: "mail-skeleton-row", style: `top:${index * rowHeight}px;height:${rowHeight}px` }, el("span", { class: "mu-skeleton is-circle" }), el("div", {}, el("span", { class: "mu-skeleton is-title" }), el("span", { class: "mu-skeleton is-text" })))); continue; }
        rows.push(row(item, index));
    }
    const focused = document.activeElement?.closest?.(".mail-row")?.dataset.id;
    spacer.replaceChildren(...rows);
    if (focused) spacer.querySelector(`.mail-row[data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}

function fromLabel(item) {
    if (["sent", "drafts", "scheduled", "outbox"].includes(item.folder) || item.direction === "out" || item.direction === "draft") {
        const names = (item.to || []).map(person => person.name || person.email).filter(Boolean);
        return names.length ? t("toRecipients", { names: names.join(", ") }) : t("noRecipients");
    }
    return item.from?.name || item.from?.email || t("unknownSender");
}

function row(item, index) {
    const selected = state.selection.has(item.id);
    const node = el("div", {
        class: "mail-row" + (item.read ? "" : " is-unread") + (state.openId === item.id ? " is-open" : ""), role: "option", tabindex: index === lastFocus ? "0" : "-1",
        "aria-selected": String(selected), "aria-setsize": String(state.total), "aria-posinset": String(index + 1), "data-id": item.id, "data-index": String(index),
        style: `top:${index * rowHeight + 4}px;height:${rowHeight - 6}px`, draggable: item.device ? "false" : "true",
        "aria-label": [item.read ? "" : t("unread"), fromLabel(item), item.subject || t("noSubject"), formatListDate(item.date)].filter(Boolean).join(", "),
    });
    const check = el("button", { type: "button", class: "mail-row-check", tabindex: "-1", "aria-label": selected ? t("deselect") : t("select") }, icon(selected ? "check_circle" : "radio_button_unchecked", selected));
    check.addEventListener("click", event => { event.stopPropagation(); toggle(item.id, index, event.shiftKey); });
    const meta = el("div", { class: "mail-row-meta" },
        item.device ? el("span", { class: "mail-chip is-warning" }, icon("smartphone"), t("onThisDevice")) : null,
        state.scope === "all" && mailboxes().length > 1 ? el("span", { class: "mail-chip", text: mailboxById(item.mailboxId)?.address?.split("@")[0] || "" }) : null,
        item.pinned ? icon("push_pin", true) : null, item.important ? icon("label_important", true) : null, item.attachments ? icon("attach_file") : null,
        item.priority === "high" ? el("span", { class: "mail-chip is-danger", text: t("priorityHigh") }) : null,
        item.snoozeUntil ? el("span", { class: "mail-chip" }, icon("snooze"), formatListDate(item.snoozeUntil)) : null,
        item.followUpDue ? el("span", { class: "mail-chip is-warning" }, icon("flag"), t("followUpDue")) : null,
        ["failed", "bounced", "unknown", "partial"].includes(item.deliveryStatus) ? el("span", { class: "mail-chip is-danger", text: t("delivery_" + item.deliveryStatus) }) : null,
        ["queued", "retrying", "scheduled"].includes(item.deliveryStatus) ? el("span", { class: "mail-chip", text: t("delivery_" + item.deliveryStatus) }) : null,
        state.sort.startsWith("size") ? el("span", { class: "mail-chip", text: formatBytes(item.size) }) : null,
        item.threadCount > 1 ? el("span", { class: "mail-chip mail-chip-count", text: formatNumber(item.threadCount) }) : null,
        ...(item.labels || []).map(labelById).filter(Boolean).map(label => el("span", { class: "mail-chip" }, el("span", { class: "mail-swatch-dot", style: `background:${label.color}` }), label.name)));
    const quickActions = state.prefs?.layout?.quickActions || [];
    const quick = el("div", { class: "mail-row-quick" }, ...quickActions.map(action => quickButton(action, item)));
    // The hover actions float over the row; the text fades out beneath them instead of being squeezed.
    node.style.setProperty("--mail-quick-w", `${quickActions.length * 40 + 8}px`);
    const starButton = el("button", { type: "button", class: "mu-icon-btn mu-icon-btn-sm mail-row-star" + (item.starred ? " is-on" : ""), tabindex: "-1", "aria-label": item.starred ? t("unstar") : t("star"), "aria-pressed": String(Boolean(item.starred)) }, icon("star", item.starred));
    starButton.addEventListener("click", event => { event.stopPropagation(); actions.star([item.id], !item.starred); });
    node.append(check, stamp(item.from?.name, fromLabel(item) === (item.from?.name || item.from?.email) ? item.from?.email : (item.to?.[0]?.email || "")),
        el("div", { class: "mail-row-main" },
            el("div", { class: "mail-row-line" }, el("span", { class: "mail-row-from", text: fromLabel(item) }), el("span", { class: "mail-row-date", text: formatListDate(item.date) })),
            el("div", { class: "mail-row-subject", text: item.subject || t("noSubject") }),
            el("div", { class: "mail-row-snippet", text: item.snippet || "" }), meta),
        el("div", { class: "mail-row-line" }, quick, item.device ? null : starButton));
    node.addEventListener("click", event => {
        lastFocus = index;
        if (event.metaKey || event.ctrlKey) return toggle(item.id, index, false);
        if (event.shiftKey) return toggle(item.id, index, true);
        open(item, index);
    });
    node.addEventListener("contextmenu", event => { event.preventDefault(); if (!state.selection.has(item.id)) { state.selection.clear(); state.selection.add(item.id); emit("selection"); render(); } contextMenu(event, item); });
    node.addEventListener("dragstart", event => {
        const ids = state.selection.has(item.id) ? [...state.selection] : [item.id];
        event.dataTransfer.setData("application/x-munetios-mail", JSON.stringify({ ids, mailboxId: item.mailboxId }));
        event.dataTransfer.effectAllowed = "move";
        node.classList.add("is-dragging");
    });
    node.addEventListener("dragend", () => node.classList.remove("is-dragging"));
    if (!item.device) swipe(node, item);
    return node;
}

function quickButton(action, item) {
    const map = {
        archive: ["archive", t("archive"), () => actions.archive([item.id])], trash: ["delete", t("delete"), () => actions.trash([item.id])],
        read: [item.read ? "mark_email_unread" : "drafts", item.read ? t("markUnread") : t("markRead"), () => actions.markRead([item.id], !item.read)],
        star: ["star", item.starred ? t("unstar") : t("star"), () => actions.star([item.id], !item.starred)], pin: ["push_pin", item.pinned ? t("unpin") : t("pin"), () => actions.pin([item.id], !item.pinned)],
        important: ["label_important", t("important"), () => actions.important([item.id], !item.important)], spam: ["report", t("reportSpam"), () => actions.spam([item.id])],
        snooze: ["snooze", t("snooze"), null],
    };
    const [name, label, fn] = map[action] || [];
    if (!name || item.device) return null;
    const btn = iconButton(name, label, event => { event.stopPropagation(); if (action === "snooze") actions.snoozeMenu(btn, [item.id]); else fn(); }, { class: "mu-icon-btn mu-icon-btn-sm", tabindex: "-1" });
    return btn;
}

function swipe(node, item) {
    let startX = 0, startY = 0, dx = 0, active = false, pointer = null;
    node.addEventListener("pointerdown", event => { if (event.pointerType !== "touch") return; startX = event.clientX; startY = event.clientY; dx = 0; active = true; pointer = event.pointerId; });
    node.addEventListener("pointermove", event => {
        if (!active || event.pointerId !== pointer) return;
        dx = event.clientX - startX;
        if (Math.abs(event.clientY - startY) > 24 && Math.abs(dx) < 24) { active = false; node.style.transform = ""; return; }
        if (Math.abs(dx) > 10) node.style.transform = `translateX(${dx}px)`;
    });
    const end = () => {
        if (!active) return;
        active = false;
        node.style.transform = "";
        if (Math.abs(dx) < 90) return;
        const action = dx < 0 ? state.prefs?.layout?.swipeLeft : state.prefs?.layout?.swipeRight;
        const run = { archive: () => actions.archive([item.id]), trash: () => actions.trash([item.id]), read: () => actions.markRead([item.id], !item.read),
            star: () => actions.star([item.id], !item.starred), pin: () => actions.pin([item.id], !item.pinned), snooze: () => actions.snoozeMenu(node, [item.id]) }[action];
        run?.();
    };
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", () => { active = false; node.style.transform = ""; });
}

function toggle(id, index, range) {
    if (range && state.anchor !== null) {
        const [a, b] = [Math.min(state.anchor, index), Math.max(state.anchor, index)];
        for (let i = a; i <= b; i++) if (state.items[i]) state.selection.add(state.items[i].id);
    } else {
        if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
        state.anchor = index;
    }
    emit("selection");
    render();
}

export function selectAll() {
    for (const item of state.items) if (item) state.selection.add(item.id);
    emit("selection"); render();
}
export function clearSelection() { state.selection.clear(); emit("selection"); render(); }

function open(item, index) {
    lastFocus = index;
    state.openId = item.id;
    render();
    onOpen(item);
}

export function move(delta) {
    const index = Math.max(0, Math.min(state.total - 1, (state.items.findIndex(item => item?.id === state.openId) >= 0 ? state.items.findIndex(item => item?.id === state.openId) : lastFocus) + delta));
    const item = state.items[index];
    if (!item) return;
    list().scrollTop = Math.max(0, Math.min(list().scrollTop, index * rowHeight - 20, Infinity));
    if (index * rowHeight > list().scrollTop + list().clientHeight - rowHeight) list().scrollTop = index * rowHeight - list().clientHeight + rowHeight;
    if (index * rowHeight < list().scrollTop) list().scrollTop = index * rowHeight;
    open(item, index);
}

function focusIndex(index) {
    lastFocus = Math.max(0, Math.min(state.total - 1, index));
    const node = list();
    if (lastFocus * rowHeight < node.scrollTop) node.scrollTop = lastFocus * rowHeight;
    if ((lastFocus + 1) * rowHeight > node.scrollTop + node.clientHeight) node.scrollTop = (lastFocus + 1) * rowHeight - node.clientHeight;
    render();
    spacer.querySelector(`.mail-row[data-index="${lastFocus}"]`)?.focus();
}

function onKey(event) {
    const rowNode = event.target.closest?.(".mail-row");
    if (!rowNode) return;
    const index = Number(rowNode.dataset.index);
    const item = state.items[index];
    switch (event.key) {
        case "ArrowDown": event.preventDefault(); focusIndex(index + 1); if (event.shiftKey && state.items[index + 1]) toggle(state.items[index + 1].id, index + 1, false); break;
        case "ArrowUp": event.preventDefault(); focusIndex(index - 1); if (event.shiftKey && state.items[index - 1]) toggle(state.items[index - 1].id, index - 1, false); break;
        case "Home": event.preventDefault(); focusIndex(0); break;
        case "End": event.preventDefault(); focusIndex(state.total - 1); break;
        case "PageDown": event.preventDefault(); focusIndex(index + 10); break;
        case "PageUp": event.preventDefault(); focusIndex(index - 10); break;
        case "Enter": event.preventDefault(); if (item) open(item, index); break;
        case " ": case "x": event.preventDefault(); if (item) toggle(item.id, index, event.shiftKey); break;
        case "ContextMenu": event.preventDefault(); if (item) { const rect = rowNode.getBoundingClientRect(); contextMenu({ clientX: rect.left + 40, clientY: rect.top + 20 }, item); } break;
    }
}

export function targetIds(item) {
    return state.selection.size ? [...state.selection] : item ? [item.id] : state.openId ? [state.openId] : [];
}

export function contextMenu(event, item) {
    const ids = targetIds(item);
    const anchor = document.elementFromPoint(event.clientX, event.clientY) || list();
    if (item.device) {
        menu(anchor, [{ icon: "open_in_new", label: t("open"), action: () => onOpen(item) }], { point: { x: event.clientX, y: event.clientY } });
        return;
    }
    const inTrash = item.folder === "trash";
    menu(anchor, [
        { icon: "open_in_new", label: t("open"), action: () => onOpen(item) },
        { icon: "tab", label: t("openInTab"), action: () => emit("openTab", item) },
        "sep",
        { icon: "reply", label: t("reply"), action: () => emit("reply", { item, mode: "reply" }) },
        { icon: "reply_all", label: t("replyAll"), action: () => emit("reply", { item, mode: "replyAll" }) },
        { icon: "forward", label: t("forward"), action: () => emit("reply", { item, mode: "forward" }) },
        "sep",
        { icon: item.read ? "mark_email_unread" : "drafts", label: item.read ? t("markUnread") : t("markRead"), action: () => actions.markRead(ids, !item.read) },
        { icon: "star", label: item.starred ? t("unstar") : t("star"), action: () => actions.star(ids, !item.starred) },
        { icon: "label_important", label: item.important ? t("markNotImportant") : t("markImportant"), action: () => actions.important(ids, !item.important) },
        { icon: "push_pin", label: item.pinned ? t("unpin") : t("pin"), action: () => actions.pin(ids, !item.pinned) },
        { icon: "snooze", label: t("snooze"), action: () => actions.snoozeMenu(anchor, ids) },
        { icon: "flag", label: t("followUp"), action: () => actions.followUpMenu(anchor, ids) },
        "sep",
        { icon: "drive_file_move", label: t("moveTo"), action: () => actions.moveMenu(anchor, ids, item.mailboxId) },
        { icon: "label", label: t("labels"), action: () => actions.labelMenu(anchor, ids, item.mailboxId) },
        { icon: "archive", label: t("archive"), action: () => actions.archive(ids) },
        item.folder === "spam" ? { icon: "report_off", label: t("notSpam"), action: () => actions.spam(ids, false) } : { icon: "report", label: t("reportSpam"), action: () => actions.spam(ids, true) },
        { icon: "block", label: t("blockSender"), action: () => emit("blockSender", item) },
        inTrash ? { icon: "restore_from_trash", label: t("restore"), action: () => actions.restore(ids) } : { icon: "delete", label: t("delete"), action: () => actions.trash(ids) },
        inTrash || item.folder === "spam" ? { icon: "delete_forever", label: t("deleteForever"), danger: true, action: () => actions.deleteForever(ids) } : null,
    ], { point: { x: event.clientX, y: event.clientY }, label: t("messageActions") });
}
