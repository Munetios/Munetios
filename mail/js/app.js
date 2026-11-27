// Munetios Mail entry point.
import { state, emit, on, mailboxes, mailboxById, primaryMailbox, folderById, labelById } from "./state.js";
import { get, post, setSignedOutHandler, ApiError } from "./api.js";
import { t, setLanguage, formatNumber, formatBytes } from "./i18n.js";
import { el, icon, iconButton, menu, toast, alertBox, button, debounce } from "./ui.js";
import { resolved } from "./theme-schema.js";
import * as list from "./list.js";
import * as reader from "./reader.js";
import * as sidebar from "./sidebar.js";
import * as actions from "./actions.js";
import * as sync from "./sync.js";
import * as offline from "./offline.js";
import * as search from "./search.js";
import * as customize from "./customize.js";

const Account = window.MunetiosAccount;
const UI = window.MunetiosUI;
let booted = false;
let compose = null;
const lazy = { compose: () => import("./compose.js"), settings: () => import("./settings.js"), storage: () => import("./storage-view.js"), studio: () => import("./studio.js") };

function signIn() { location.replace("/signin?continue=" + encodeURIComponent("/mail/")); }
setSignedOutHandler(async () => {
    await Account?.refresh?.();
    if (!Account?.state?.account) { await offline.clearPrivateData(); signIn(); }
});

async function boot() {
    let data;
    try { data = await get("/bootstrap"); }
    catch (error) {
        if (error instanceof ApiError && error.code === "signedOut") return signIn();
        setLanguage("system");
        document.getElementById("reader").replaceChildren(alertBox("danger", "error", t("mailUnavailable"), t("tryAgainLater"), [button(t("retry"), () => location.reload())]));
        return;
    }
    state.boot = data;
    state.accountId = data.account.id;
    state.counts = data.counts;
    applyPreferences(data.preferences.data);
    if (!data.mailboxes.length) {
        document.getElementById("reader").replaceChildren(alertBox("warning", "mail_lock", t("noMailbox"), t("noMailboxDetail")));
        return;
    }
    await offline.openFor(data.account.id).catch(() => null);
    state.deviceMessages = await offline.deviceList().catch(() => []);
    if (!booted) init();
    booted = true;
    restoreRoute();
    sidebar.render();
    sidebar.renderStorage();
    renderHead();
    list.measure();
    await list.reload();
    sync.start(data.seq);
    refreshStorage();
    offline.cachePrune((state.prefs.behavior.offlineDays || 30) * 86_400_000).catch(() => {});
    lazy.compose().then(module => { compose = module; module.init(); module.recoverDrafts(); });
    registerServiceWorker();
}

export function applyPreferences(data) {
    state.prefsRaw = data || {};
    state.prefs = resolved(state.prefsRaw);
    setLanguage(state.prefs.behavior.language, { timeFormat: state.prefs.behavior.timeFormat, weekStart: state.prefs.behavior.weekStart });
    customize.apply(state.prefs);
    document.body.classList.toggle("hide-header", !state.prefs.layout.headerVisible);
    if (booted) { sidebar.render(); renderHead(); list.measure(); }
}

// The Munetios Mail logo (mail/icons/mail-192.png) falls back to the envelope icon if the image is unavailable.
function logoFallback() {
    const logo = document.querySelector("img.mail-logo");
    if (!logo) return;
    const swap = () => logo.replaceWith(el("span", { class: "mail-logo mail-logo-icon", "aria-hidden": "true" }, icon("mark_email_unread", true)));
    if (logo.complete && !logo.naturalWidth) swap(); else logo.addEventListener("error", swap, { once: true });
}
logoFallback();

function init() {
    list.init({ open: openItem });
    reader.init();
    sidebar.init({ go: navigate });
    search.init({ run: runSearch });
    const sidebarNode = document.getElementById("mailSidebar");
    UI.enhanceResizable(sidebarNode);
    // Dragging the v4 resizer saves the width to the synced preferences.
    sidebarNode.addEventListener("pointerup", () => setTimeout(() => {
        const width = parseFloat(sidebarNode.style.getPropertyValue("--mu-sidebar-width"));
        if (width && Math.round(width) !== state.prefs.layout.sidebarWidth && !document.body.classList.contains("sidebar-collapsed")) customize.savePreference("layout.sidebarWidth", Math.round(width));
    }, 50));
    paneResizer();
    document.getElementById("navToggle").addEventListener("click", () => {
        if (matchMedia("(max-width: 760px)").matches) { document.body.classList.toggle("nav-open"); return; }
        const collapsed = !document.body.classList.contains("sidebar-collapsed");
        customize.savePreference("layout.sidebarCollapsed", collapsed);
    });
    document.addEventListener("click", event => { if (document.body.classList.contains("nav-open") && !event.target.closest("#mailSidebar, #navToggle")) document.body.classList.remove("nav-open"); });
    document.getElementById("composeButton").addEventListener("click", () => compose?.open());
    document.getElementById("settingsButton").addEventListener("click", () => openSettings());
    document.getElementById("customizeButton").addEventListener("click", () => lazy.studio().then(module => module.open()));
    on("openStorage", () => lazy.storage().then(module => module.open()));
    on("openSettings", section => openSettings(section));
    on("reload", () => list.reload({ keepScroll: true }));
    // Live customization: re-lay-out and retranslate without a reload.
    on("prefsChanged", path => {
        if (path === "*" || /^behavior\.(language|timeFormat|weekStart)/.test(path)) setLanguage(state.prefs.behavior.language, { timeFormat: state.prefs.behavior.timeFormat, weekStart: state.prefs.behavior.weekStart });
        document.body.classList.toggle("hide-header", !state.prefs.layout.headerVisible);
        list.measure();
        sidebar.render();
        renderHead();
    });
    on("refreshBoot", refreshBoot);
    on("reboot", () => location.reload());
    on("scope", scope => { state.scope = scope; state.openId = null; reader.showEmpty(); sidebar.render(); sidebar.renderStorage(); renderHead(); list.reload(); saveRoute(); refreshStorage(); });
    on("advance", delta => list.move(delta));
    on("runSearch", query => runSearch(query));
    on("selection", renderTools);
    on("listLoaded", renderHead);
    on("countsStale", debounce(refreshCounts, 400));
    on("storageStale", debounce(refreshStorage, 600));
    on("changes", ({ kinds }) => {
        if (kinds.has("message")) { list.reload({ keepScroll: true }); refreshCounts(); }
        if (kinds.has("storage")) refreshStorage();
        if (["folder", "label", "signature", "template", "senders"].some(kind => kinds.has(kind))) refreshBoot();
    });
    on("deviceMessages", ({ saved } = {}) => { if (saved) toast(t("savedToDevice", { count: saved }), "info", 6000); renderAlerts(); sidebar.render(); if (state.view === "device") list.reload(); });
    on("online", online => { document.getElementById("connectionStatus").hidden = online; if (online) list.reload({ keepScroll: true }); });
    on("showingCached", () => toast(t("showingOffline")));
    on("newMail", notifyNewMail);
    on("delivery", event => { if (event.state === "failed") toast(t("deliveryFailedToast"), "error", 6000); });
    on("storageWarning", event => { refreshStorage(); if (event.level >= 80) toast(t("storageWarning", { percent: event.level }), event.level >= 95 ? "error" : "info", 6000); });
    on("reply", ({ item, mode }) => compose?.reply(item, mode));
    on("editDraft", item => compose?.editDraft(item.id));
    on("composeTo", data => compose?.open(data));
    on("cancelOutbound", async message => {
        try { await post(`/outbound/${message.delivery.id}/cancel`); toast(t("sendCanceled"), "success"); reader.closeReader(); list.reload({ keepScroll: true }); }
        catch (error) { toast(actions.errorText(error), "error"); }
    });
    on("retryOutbound", async message => {
        try { await post(`/outbound/${message.delivery.id}/retry`); toast(t("retryQueued"), "success"); list.reload({ keepScroll: true }); }
        catch (error) { toast(actions.errorText(error), "error"); }
    });
    document.getElementById("connectionStatus").hidden = navigator.onLine;
    document.addEventListener("keydown", shortcut);
    window.addEventListener("popstate", () => { restoreRoute(); sidebar.render(); renderHead(); list.reload(); });
    Account?.on?.(async accountState => {
        if (accountState.ready && !accountState.offline && !accountState.account) { await offline.clearPrivateData(); signIn(); }
        else if (accountState.account && state.accountId && accountState.account.id !== state.accountId) location.reload();
    });
    for (const zone of [document.body]) {
        zone.addEventListener("dragover", event => { if (event.dataTransfer?.types?.includes("Files") && compose?.hasOpen()) { event.preventDefault(); document.getElementById("dropHint").hidden = false; } });
        zone.addEventListener("dragleave", event => { if (!event.relatedTarget) document.getElementById("dropHint").hidden = true; });
        zone.addEventListener("drop", event => { document.getElementById("dropHint").hidden = true; if (event.dataTransfer?.files?.length && compose?.hasOpen()) { event.preventDefault(); compose.attachFiles([...event.dataTransfer.files]); } });
    }
}

function openSettings(section) { lazy.settings().then(module => module.open(section)); }

async function refreshBoot() {
    try {
        const data = await get("/bootstrap");
        state.boot = data;
        state.counts = data.counts;
        sidebar.render();
        renderHead();
        emit("bootChanged");
    } catch { /* keep the current data */ }
}

async function refreshCounts() {
    try { state.counts = await get("/counts?mailbox=all"); emit("counts"); document.title = titleText(); } catch { /* offline */ }
}

function titleText() {
    const unread = mailboxes().reduce((sum, box) => sum + (state.counts[box.id]?.folders?.inbox || 0), 0);
    return unread ? `(${formatNumber(unread)}) ${t("appName")}` : t("appName");
}

async function refreshStorage() {
    for (const box of mailboxes()) {
        try { state.storage[box.id] = await get(`/storage?mailbox=${box.id}`); } catch { /* offline */ }
    }
    emit("storage");
    renderAlerts();
}

/* ---------------------------------------------------------------- navigation */
export function navigate(view) {
    state.view = view;
    state.openId = null;
    if (view !== "search") { state.query = ""; search.setValue(""); }
    state.filter = "";
    reader.showEmpty();
    document.body.classList.remove("reading");
    sidebar.render();
    renderHead();
    list.reload();
    saveRoute();
}

function runSearch(query) {
    if (!query.trim()) return navigate("inbox");
    state.query = query.trim();
    state.view = "search";
    search.setValue(state.query);
    sidebar.render();
    renderHead();
    list.reload();
    saveRoute();
}

function saveRoute() {
    const params = new URLSearchParams();
    if (state.view !== "inbox") params.set("view", state.view);
    if (state.scope !== "all") params.set("mailbox", state.scope);
    if (state.query) params.set("q", state.query);
    const hash = params.toString();
    if (("#" + hash) !== location.hash) history.pushState(null, "", hash ? "#" + hash : location.pathname);
}

function restoreRoute() {
    const params = new URLSearchParams(location.hash.slice(1));
    state.view = params.get("view") || "inbox";
    state.scope = mailboxById(params.get("mailbox")) ? params.get("mailbox") : "all";
    state.query = params.get("q") || "";
    if (state.view === "search") search.setValue(state.query);
}

function viewTitle() {
    if (state.view === "search") return t("searchResults");
    if (state.view === "device") return t("onThisDevice");
    if (state.view === "followup") return t("followUps");
    if (state.view.startsWith("label:")) return labelById(state.view.slice(6))?.name || t("labels");
    if (state.view.startsWith("f_")) return folderById(state.view)?.name || t("folders");
    return t(state.view === "all" ? "allMail" : state.view);
}

function renderHead() {
    document.getElementById("listHeading").textContent = viewTitle();
    document.getElementById("listCount").textContent = state.total ? t("messagesTotal", { count: formatNumber(state.total) }) : "";
    document.title = titleText();
    renderCategories();
    renderTools();
    renderAlerts();
}

function renderCategories() {
    const node = document.getElementById("categoryTabs");
    const show = state.view === "inbox" && state.prefs?.layout?.categoryTabs && mailboxes().some(box => box.settings?.categories !== false);
    node.hidden = !show;
    if (!show) return;
    node.replaceChildren(...["primary", "social", "promotions", "updates", "forums", "all"].map(category => {
        const chip = el("button", { type: "button", class: "mu-chip", role: "tab", "aria-selected": String(state.category === category), "aria-pressed": String(state.category === category) },
            icon({ primary: "inbox", social: "group", promotions: "sell", updates: "info", forums: "forum", all: "all_inbox" }[category]), t("category_" + category));
        chip.addEventListener("click", () => { state.category = category; renderCategories(); list.reload(); });
        return chip;
    }));
}

function renderTools() {
    const node = document.getElementById("listToolbar");
    const selected = [...state.selection];
    const tools = [];
    const allSelected = selected.length && selected.length >= state.items.filter(Boolean).length;
    tools.push(iconButton(allSelected ? "check_box" : selected.length ? "indeterminate_check_box" : "check_box_outline_blank", allSelected ? t("deselectAll") : t("selectAll"), () => allSelected ? list.clearSelection() : list.selectAll()));
    if (selected.length && state.view !== "device") {
        const mailboxId = state.items.find(item => item?.id === selected[0])?.mailboxId;
        const inTrash = state.view === "trash";
        tools.push(el("span", { class: "mu-muted", style: "padding:0 6px", text: t("selectedCount", { count: formatNumber(selected.length) }) }));
        tools.push(iconButton("archive", t("archive"), () => actions.archive(selected)));
        tools.push(inTrash ? iconButton("restore_from_trash", t("restore"), () => actions.restore(selected)) : iconButton("delete", t("delete"), () => actions.trash(selected)));
        tools.push(iconButton("drafts", t("markRead"), () => actions.markRead(selected, true)));
        tools.push(iconButton("mark_email_unread", t("markUnread"), () => actions.markRead(selected, false)));
        const move = iconButton("drive_file_move", t("moveTo"), () => actions.moveMenu(move, selected, mailboxId));
        const label = iconButton("label", t("labels"), () => actions.labelMenu(label, selected, mailboxId));
        const snooze = iconButton("snooze", t("snooze"), () => actions.snoozeMenu(snooze, selected));
        tools.push(move, label, snooze);
        const more = iconButton("more_vert", t("more"), () => menu(more, [
            { icon: "star", label: t("star"), action: () => actions.star(selected, true) }, { icon: "star_outline", label: t("unstar"), action: () => actions.star(selected, false) },
            { icon: "push_pin", label: t("pin"), action: () => actions.pin(selected, true) }, { icon: "label_important", label: t("markImportant"), action: () => actions.important(selected, true) },
            state.view === "spam" ? { icon: "report_off", label: t("notSpam"), action: () => actions.spam(selected, false) } : { icon: "report", label: t("reportSpam"), action: () => actions.spam(selected, true) },
            "sep", { icon: "delete_forever", label: t("deleteForever"), danger: true, action: () => actions.deleteForever(selected) },
        ]));
        tools.push(more);
    } else {
        tools.push(iconButton("refresh", t("refresh"), () => { list.reload({ keepScroll: true }); sync.catchUp(); sync.collectDeviceDeliveries(); }));
        const sort = iconButton("sort", t("sort"), () => menu(sort, ["date", "date_asc", "size", "size_asc", "from", "subject"].map(value => ({
            label: t("sort_" + value), checked: state.sort === value, action: () => { state.sort = value; list.reload(); },
        })), { label: t("sort") }));
        const filter = iconButton(state.filter ? "filter_alt" : "filter_list", t("filter"), () => menu(filter, ["", "unread", "starred", "attachments", "important", "large"].map(value => ({
            label: t("filter_" + (value || "none")), checked: state.filter === value, action: () => { state.filter = value; renderTools(); list.reload(); },
        })), { label: t("filter") }));
        tools.push(sort, filter);
        if (state.view === "trash" || state.view === "spam") tools.push(button(state.view === "trash" ? t("emptyTrash") : t("emptySpam"), () => { const box = state.scope === "all" ? primaryMailbox() : mailboxById(state.scope); if (box) actions.emptyFolder(state.view, box.id); }, { class: "mu-btn mu-btn-ghost", danger: false }));
        if (state.view === "search" && state.query) tools.push(iconButton("bookmark_add", t("saveSearch"), () => search.saveCurrent(state.query)));
    }
    node.replaceChildren(...tools);
}

function renderAlerts() {
    const node = document.getElementById("listAlerts");
    const alerts = [];
    for (const box of mailboxes()) {
        const storage = state.storage[box.id];
        if (!storage) continue;
        if (storage.full) alerts.push(alertBox("danger", "storage", t("storageFullTitle", { address: box.address }), t("storageFullDetail"), [button(t("manageStorage"), () => emit("openStorage"), { primary: true })]));
        else if (storage.warningLevel >= 80) alerts.push(alertBox(storage.warningLevel >= 95 ? "danger" : "warning", "storage", t("storageWarning", { percent: storage.warningLevel }), t("storageUsedOf", { used: formatBytes(storage.usedBytes), total: formatBytes(storage.quotaBytes) }), [button(t("manageStorage"), () => emit("openStorage"))]));
        if (box.status === "suspended") alerts.push(alertBox("danger", "block", t("mailboxSuspended"), t("mailboxSuspendedDetail")));
    }
    if (state.deviceMessages.length && state.view !== "device") alerts.push(alertBox("warning", "smartphone", t("deviceMailBanner", { count: formatNumber(state.deviceMessages.length) }), t("deviceMailBannerDetail"),
        [button(t("viewMail"), () => navigate("device")), button(t("moveAllToMailbox"), () => reader.moveAllDeviceMail())]));
    node.replaceChildren(...alerts);
}

function openItem(item) {
    state.openId = item.id;
    reader.open(item);
}

/* ---------------------------------------------------------------- resizing */
function paneResizer() {
    const handle = document.getElementById("paneResizer");
    const main = document.getElementById("mailMain");
    const setWidth = (value, save) => {
        const pane = document.body.dataset.pane;
        if (pane === "bottom") {
            const percent = Math.min(75, Math.max(30, value));
            document.documentElement.style.setProperty("--mail-reading-h", percent + "%");
            if (save) customize.savePreference("layout.readingHeight", Math.round(percent));
        } else {
            const width = Math.min(900, Math.max(280, value));
            document.documentElement.style.setProperty("--mail-list-w", width + "px");
            if (save) customize.savePreference("layout.listWidth", Math.round(width));
        }
    };
    handle.addEventListener("pointerdown", event => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        handle.classList.add("is-dragging");
        const rect = main.getBoundingClientRect();
        const rtl = document.documentElement.dir === "rtl";
        const valueAt = ev => document.body.dataset.pane === "bottom" ? ((rect.bottom - ev.clientY) / rect.height) * 100 : rtl ? rect.right - ev.clientX : ev.clientX - rect.left;
        const moveHandler = ev => setWidth(valueAt(ev), false);
        handle.addEventListener("pointermove", moveHandler);
        handle.addEventListener("pointerup", ev => { handle.removeEventListener("pointermove", moveHandler); handle.classList.remove("is-dragging"); setWidth(valueAt(ev), true); }, { once: true });
    });
    handle.addEventListener("keydown", event => {
        const pane = document.body.dataset.pane;
        const current = pane === "bottom" ? state.prefs.layout.readingHeight : state.prefs.layout.listWidth;
        const step = pane === "bottom" ? 2 : 16;
        if (["ArrowLeft", "ArrowUp"].includes(event.key)) { event.preventDefault(); setWidth(current - step * (pane === "bottom" ? -1 : 1), true); }
        if (["ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); setWidth(current + step * (pane === "bottom" ? -1 : 1), true); }
    });
}

/* ---------------------------------------------------------------- keyboard shortcuts */
let chord = "";
let chordTimer;
function comboOf(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey && event.key.length > 1) parts.push("Shift");
    let key = event.key.length === 1 ? event.key : event.key;
    if (event.shiftKey && /^[a-z]$/i.test(key)) { parts.push("Shift"); key = key.toUpperCase(); }
    parts.push(key.length === 1 ? key : key);
    return parts.join("+");
}

function shortcut(event) {
    if (!state.prefs?.behavior?.shortcutsEnabled) return;
    const typing = event.target.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable=''], .mu-modal");
    const combo = comboOf(event);
    const map = state.prefs.behavior.shortcuts;
    const match = action => { const value = map[action]; if (!value) return false; if (value.includes(" ")) return chord + " " + combo === value; return value.toLowerCase() === combo.toLowerCase(); };
    if (typing && !(event.ctrlKey || event.metaKey)) return;
    const ids = list.targetIds(state.items.find(item => item?.id === state.openId));
    const openItemNow = state.items.find(item => item?.id === state.openId);
    const run = {
        compose: () => compose?.open(), search: () => search.focus(), reply: () => openItemNow && emit("reply", { item: openItemNow, mode: "reply" }),
        replyAll: () => openItemNow && emit("reply", { item: openItemNow, mode: "replyAll" }), forward: () => openItemNow && emit("reply", { item: openItemNow, mode: "forward" }),
        archive: () => ids.length && actions.archive(ids), trash: () => ids.length && actions.trash(ids), read: () => ids.length && actions.markRead(ids, true), unread: () => ids.length && actions.markRead(ids, false),
        star: () => ids.length && actions.star(ids, !openItemNow?.starred), next: () => list.move(1), previous: () => list.move(-1),
        open: () => document.querySelector(".mail-row:focus")?.click(), back: () => reader.closeReader(), selectAll: () => list.selectAll(), settings: () => openSettings(),
        goInbox: () => navigate("inbox"), goSent: () => navigate("sent"), goDrafts: () => navigate("drafts"), help: () => openSettings("shortcuts"),
    };
    for (const action of Object.keys(run)) {
        if (action === "send" || !match(action)) continue;
        if (typing && action !== "settings") continue;
        event.preventDefault();
        chord = "";
        run[action]();
        return;
    }
    if (!typing && combo.length === 1) { chord = combo; clearTimeout(chordTimer); chordTimer = setTimeout(() => { chord = ""; }, 1200); }
    if (event.key === "Escape" && document.body.classList.contains("reading")) reader.closeReader();
}

/* ---------------------------------------------------------------- notifications */
const SOUNDS = { chime: [880, 1320], soft: [523, 659], bell: [1046, 1568], pop: [660, 990] };
async function playSound() {
    const sound = state.prefs.behavior.sound;
    if (sound === "none") return;
    try {
        if (state.prefs.behavior.soundAsset) { const audio = new Audio(`/api/mail/v1/assets/${state.prefs.behavior.soundAsset}`); await audio.play(); return; }
        const context = new AudioContext();
        (SOUNDS[sound] || SOUNDS.chime).forEach((frequency, index) => {
            const oscillator = context.createOscillator(); const gain = context.createGain();
            oscillator.frequency.value = frequency; oscillator.connect(gain); gain.connect(context.destination);
            const start = context.currentTime + index * 0.14;
            gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
            oscillator.start(start); oscillator.stop(start + 0.32);
        });
        setTimeout(() => context.close(), 1000);
    } catch { /* audio blocked */ }
}

function notifyNewMail(event) {
    playSound();
    if (!state.prefs.behavior.notifications || !("Notification" in window) || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    const box = mailboxById(event.mailboxId);
    // Previews are off by default so message content doesn't appear on the lock screen.
    new Notification(t("newMailNotification"), { body: box?.address || "", tag: "munetios-mail", icon: "/mail/icons/mail-192.png", silent: true });
}

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !state.prefs.behavior.offline) return;
    try { await navigator.serviceWorker.register("/mail/sw.js", { scope: "/mail/" }); } catch { /* not available */ }
}

boot();
