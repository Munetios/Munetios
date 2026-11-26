/*
 * Munetios SupaNotes features on Munetios UI v4.
 * Uses window.SupaNotesApp (exposed by the main script) and window.SupaNotesHooks.
 * Extra note fields live in note.meta, which the main script stores encrypted,
 * so every feature syncs end to end with the note.
 */
(() => {
  "use strict";

  const STR = window.SupaNotesFeatureStrings || { en: {} };
  const H = window.SupaNotesHooks || (window.SupaNotesHooks = {});
  const App = () => window.SupaNotesApp;
  const UI = () => window.MunetiosUI;
  const lang = () => { const l = (App() && App().language && App().language()) || "en"; return STR[l] ? l : "en"; };
  function t(key, vars) {
    let value = (STR[lang()] && STR[lang()][key]) ?? STR.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) value = value.split("{" + k + "}").join(String(v));
    return value;
  }
  window.SupaNotesT = t;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
  }
  const icon = (name, extra = "") => h("span", { class: "mu-icon " + extra, "aria-hidden": "true", text: name });
  const iconBtn = (name, label, onclick, extra = "") => h("button", { type: "button", class: "mu-icon-btn " + extra, "aria-label": label, title: label, onclick }, [icon(name)]);
  const toast = (msg, type = "success") => (UI() && UI().toast ? UI().toast(msg, { type }) : App().toast(msg));
  const nmAn = (text) => String(text).replace(/\b[Aa]\.?\s?[Mm]\.?(?=$|[\s,)])/g, "NM").replace(/\b[Pp]\.?\s?[Mm]\.?(?=$|[\s,)])/g, "AN");
  const fmtDateTime = (ms) => nmAn(new Date(ms).toLocaleString(lang(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  const isoDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const plain = (html) => App().stripHtml(html || "");
  const plainSpaced = (html) => plain(String(html || "").replace(/<\/(li|p|div|h[1-6]|blockquote|pre)>|<br\s*\/?>/gi, "$& ")).replace(/\s+/g, " ").trim();

  /* ------------------------------------------------------------ settings */
  const owner = () => (window.SupaNotesWorkspace && window.SupaNotesWorkspace.accountId) || "guest";
  const VIEW = { sort: "updated", layout: "grid", tag: "all", color: "all" };
  const SHARED = { autosave: true, templates: [], updatedAt: 0 };
  const read = (key, base) => { try { return { ...base, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return { ...base }; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const viewKey = () => "munetios-supanotes-view:" + owner();
  const sharedKey = () => "munetios-supanotes-extras:" + owner();
  let view = { ...VIEW };
  let shared = { ...SHARED };
  const loadSettings = () => { view = read(viewKey(), VIEW); shared = read(sharedKey(), SHARED); if (!Array.isArray(shared.templates)) shared.templates = []; };
  const setView = (patch) => { view = { ...view, ...patch }; write(viewKey(), view); };
  function setShared(patch) {
    shared = { ...shared, ...patch, updatedAt: Math.max(Date.now(), (shared.updatedAt || 0) + 1) };
    write(sharedKey(), shared);
    if (owner() !== "guest") window.MunetiosAccount?.sync.schedule(800);
  }
  function registerExtrasSync() {
    const account = window.MunetiosAccount;
    if (!account || owner() === "guest") return;
    const accountId = owner();
    const key = "munetios-supanotes-extras:settings";
    account.sync.register({
      id: "munetios-supanotes-extras", prefix: "munetios-supanotes-extras:", preserveLocal: true,
      enabled: () => String(account.state.account?.id) === accountId,
      async snapshot() { const data = read(sharedKey(), SHARED); return data.updatedAt ? [{ key, data, updatedAt: data.updatedAt }] : []; },
      async apply(items) {
        let changed = false;
        for (const item of items) {
          if (item.key !== key || item.deleted || !item.data || typeof item.data !== "object") continue;
          const next = { ...SHARED, ...item.data, updatedAt: item.updatedAt || 1 };
          next.templates = (Array.isArray(next.templates) ? next.templates : []).filter((x) => x && typeof x.name === "string").map((x) => ({
            id: String(x.id || crypto.randomUUID()), name: x.name.slice(0, 120), title: String(x.title || ""),
            content: window.SupaNotesSanitize ? window.SupaNotesSanitize.html(x.content) : "",
          }));
          write(sharedKey(), next);
          shared = next;
          changed = true;
        }
        if (changed) syncSettingsForm();
        return changed;
      },
    });
  }

  /* ------------------------------------------------------------ caches */
  let notesCache = new Map();
  let tagsCache = [];
  async function refreshCache() {
    if (!App()) return;
    try {
      const [notes, tags] = await Promise.all([App().getAllNotes(), App().getTags()]);
      notesCache = new Map(notes.map((n) => [n.id, n]));
      tagsCache = tags;
    } catch {}
  }
  const tagName = (id) => tagsCache.find((x) => x.id === id)?.name || "";
  const meta = (note) => (note && note.meta && typeof note.meta === "object" ? note.meta : {});

  /* ------------------------------------------------------------ colors */
  const COLORS = [
    ["", "colorNone"], ["red", "colorRed"], ["orange", "colorOrange"], ["yellow", "colorYellow"], ["green", "colorGreen"],
    ["teal", "colorTeal"], ["blue", "colorBlue"], ["purple", "colorPurple"], ["pink", "colorPink"], ["gray", "colorGray"],
  ];
  function pickColor(current, onPick) {
    UI().pickFromList({
      title: t("color"), icon: "palette", searchLabel: t("search"), closeLabel: t("close"), value: current || "",
      items: COLORS.map(([value, key]) => ({ value, label: t(key) })),
      onPick,
    });
  }

  /* ------------------------------------------------------------ save helpers + undo */
  async function update(note, patchMeta, patch = {}, undoLabel) {
    const before = structuredClone(note);
    const next = { ...note, ...patch, meta: { ...meta(note), ...patchMeta } };
    await App().saveNote(next);
    notesCache.set(next.id, next);
    if (undoLabel) pushUndo([before], undoLabel);
    return next;
  }
  const undoStack = [];
  let undoTimer = null;
  let undoing = 0;
  function pushUndo(notes, label) {
    undoStack.push(notes.map((n) => structuredClone(n)));
    let bar = $("#snUndoBar");
    if (!bar) {
      bar = h("div", { id: "snUndoBar", class: "sn-undo mu-glass", role: "status", "aria-live": "polite" }, [
        h("span", { class: "sn-undo-text" }),
        h("button", { type: "button", class: "mu-btn mu-btn-primary", onclick: () => undo() }, [icon("undo"), h("span", { class: "sn-undo-label" })]),
        iconBtn("close", t("dismiss"), () => { bar.hidden = true; }, "mu-icon-btn-soft"),
      ]);
      document.body.append(bar);
    }
    bar.querySelector(".sn-undo-text").textContent = label;
    bar.querySelector(".sn-undo-label").textContent = t("undo");
    bar.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { bar.hidden = true; }, 7000);
  }
  async function undo() {
    const notes = undoStack.pop();
    const bar = $("#snUndoBar");
    if (bar) bar.hidden = true;
    if (!notes) { toast(t("nothingToUndo"), "info"); return; }
    undoing++;
    try { for (const note of notes) await App().saveNote(note, { keepUpdatedAt: true }); } finally { undoing--; }
    await App().render();
    toast(t("undone"), "info");
  }

  /* ------------------------------------------------------------ passphrase lock */
  const sessionKeys = new Map();
  const b = (arr) => new Uint8Array(arr);
  async function deriveKey(passphrase, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function sealContent(content, key, salt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify({ content })));
    return { v: 1, salt: Array.from(salt), iv: Array.from(iv), data: Array.from(new Uint8Array(data)) };
  }
  async function openContent(lock, key) {
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b(lock.iv) }, key, b(lock.data));
    return JSON.parse(new TextDecoder().decode(buf)).content || "";
  }
  async function unlockNote(note) {
    const lock = meta(note).lock;
    if (!lock) return note;
    const cached = sessionKeys.get(note.id);
    if (cached) {
      try { return { ...note, content: await openContent(lock, cached.key) }; } catch { sessionKeys.delete(note.id); }
    }
    const passphrase = await promptDialog({ title: t("unlockNote"), label: t("passphrase"), type: "password", icon: "lock_open", confirm: t("unlock") });
    if (!passphrase) return null;
    try {
      const key = await deriveKey(passphrase, b(lock.salt));
      const content = await openContent(lock, key);
      sessionKeys.set(note.id, { key, salt: b(lock.salt) });
      return { ...note, content };
    } catch {
      toast(t("wrongPassphrase"), "error");
      return null;
    }
  }
  async function lockNote(note) {
    if (meta(note).lock) {
      const open = await unlockNote(note);
      if (!open) return;
      const next = { ...open, meta: { ...meta(open) } };
      delete next.meta.lock;
      sessionKeys.delete(note.id);
      await App().saveNote(next);
      toast(t("lockRemoved"));
      return App().render();
    }
    const first = await promptDialog({ title: t("lockNote"), label: t("newPassphrase"), type: "password", icon: "lock", confirm: t("next"), help: t("lockHelp") });
    if (!first) return;
    const second = await promptDialog({ title: t("lockNote"), label: t("confirmPassphrase"), type: "password", icon: "lock", confirm: t("lock") });
    if (second === null) return;
    if (first !== second) { toast(t("passphraseMismatch"), "error"); return; }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(first, salt);
    const lock = await sealContent(note.content || "", key, salt);
    sessionKeys.set(note.id, { key, salt });
    await App().saveNote({ ...note, content: "", meta: { ...meta(note), lock } });
    toast(t("noteLocked"));
    App().render();
  }
  // Every save goes through here: keep locked notes encrypted, and record undo steps.
  H.beforeSave = async (note) => {
    const m = meta(note);
    const previous = notesCache.get(note.id);
    if (m.lock && note.content && !note.fromSync) {
      const session = sessionKeys.get(note.id);
      if (session) note = { ...note, content: "", meta: { ...m, lock: await sealContent(note.content, session.key, session.salt) } };
      else note = { ...note, content: "" };
    }
    if (previous && !undoing) {
      if (!previous.trashed && note.trashed) pushUndo([previous], t("movedToTrash"));
      else if (!meta(previous).archived && meta(note).archived) pushUndo([previous], t("archived"));
    }
    delete note.fromSync;
    notesCache.set(note.id, note);
    return note;
  };
  H.beforeDelete = async (id) => {
    const previous = notesCache.get(id);
    if (previous && !undoing) pushUndo([previous], t("deletedForever"));
    notesCache.delete(id);
  };
  H.sanitizeNote = (note) => (window.SupaNotesSanitize ? window.SupaNotesSanitize.note(note) : note);

  /* ------------------------------------------------------------ dialogs */
  let dialogs = 0;
  function promptDialog({ title, label, value = "", type = "text", icon: iconName = "edit", confirm, help }) {
    return new Promise((resolve) => {
      const id = "snPrompt" + ++dialogs;
      const input = h("input", { class: "mu-input", type, value, autocomplete: type === "password" ? "new-password" : "off" });
      const modal = h("div", { class: "mu-modal", id, hidden: true }, [
        h("form", { class: "mu-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": id + "T" }, [
          h("div", { class: "mu-dialog-header" }, [
            h("div", { class: "mu-dialog-heading" }, [h("span", { class: "mu-icon-circle" }, [icon(iconName)]), h("h2", { id: id + "T", text: title })]),
            h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), "data-x": "" }, [icon("close")]),
          ]),
          h("label", { class: "mu-field" }, [h("span", { class: "mu-field-label", text: label }), input, help ? h("span", { class: "mu-field-help", text: help }) : null]),
          h("div", { class: "mu-dialog-actions" }, [
            h("button", { type: "button", class: "mu-btn", "data-x": "", text: t("cancel") }),
            h("button", { type: "submit", class: "mu-btn mu-btn-primary", text: confirm || t("save") }),
          ]),
        ]),
      ]);
      document.body.append(modal);
      const finish = (result) => { UI().closeModal(modal); modal.remove(); resolve(result); };
      modal.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); finish(type === "password" ? input.value : input.value.trim() || null); });
      modal.querySelectorAll("[data-x]").forEach((btn) => btn.addEventListener("click", () => finish(null)));
      modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); finish(null); } });
      UI().openModal(id);
      setTimeout(() => { input.focus(); input.select(); }, 40);
    });
  }

  /* ------------------------------------------------------------ list processing */
  let selectMode = false;
  const selected = new Set();
  const SORTS = {
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    title: (a, b) => String(a.title || "").localeCompare(String(b.title || ""), lang(), { sensitivity: "base" }),
    color: (a, b) => COLORS.findIndex(([c]) => c === (meta(a).color || "")) - COLORS.findIndex(([c]) => c === (meta(b).color || "")) || SORTS.updated(a, b),
  };
  const sortNotes = (list) => [...list].sort((a, b) => (Boolean(meta(b).pinned) - Boolean(meta(a).pinned)) || (SORTS[view.sort] || SORTS.updated)(a, b));
  H.processList = (list, page, query) => {
    let out = list;
    if (page === "notesPage" || page === "favoritesPage") out = out.filter((n) => !meta(n).archived);
    if (page === "notesPage") {
      if (view.tag !== "all") out = out.filter((n) => (n.tags || []).includes(view.tag));
      if (view.color !== "all") out = out.filter((n) => (meta(n).color || "") === view.color);
    }
    return page === "trashPage" ? out : sortNotes(out);
  };
  H.pageForHash = (hash) => (hash === "#/archive" ? "archivePage" : null);
  H.hashForPage = (page) => (page === "archivePage" ? "#/archive" : null);
  H.renderPage = async (page) => {
    if (page !== "archivePage") return;
    const list = $("#archiveList");
    const notes = sortNotes((await App().getAllNotes()).filter((n) => meta(n).archived && !n.trashed));
    list.replaceChildren();
    if (!notes.length) { list.append(h("div", { class: "notes-empty", text: t("archiveEmpty") })); return; }
    notes.forEach((note) => list.append(App().buildNoteCard(note, {})));
  };
  H.afterRender = async (page) => {
    await refreshCache();
    syncToolbar(page);
    updateBulkBar();
    translate();
    $$(".notes-list").forEach((list) => list.classList.toggle("is-list", view.layout === "list"));
    $$(".notes-empty").forEach((empty) => empty.setAttribute("role", "status"));
  };

  /* ------------------------------------------------------------ card decoration */
  H.decorateCard = (card, note, opts) => {
    const m = meta(note);
    card.dataset.color = m.color || "";
    card.classList.toggle("is-pinned", Boolean(m.pinned));
    card.classList.toggle("is-locked", Boolean(m.lock));
    card.classList.toggle("is-selected", selected.has(note.id));
    card.tabIndex = 0;
    card.setAttribute("role", "article");
    card.setAttribute("aria-label", note.title || t("untitled"));
    const title = card.querySelector(".note-card-title");
    if (m.pinned && title) title.prepend(h("span", { class: "mu-icon mu-icon-filled sn-pin", role: "img", "aria-label": t("pinned"), text: "push_pin" }));
    if (!m.lock) {
      const preview = card.querySelector(".note-card-preview");
      const text = plainSpaced(note.content).slice(0, 160);
      if (preview && text) preview.textContent = text;
    }
    if (m.lock) {
      title?.append(h("span", { class: "mu-icon sn-lock", role: "img", "aria-label": t("locked"), text: "lock" }));
      const preview = card.querySelector(".note-card-preview");
      if (preview) preview.textContent = t("lockedPreview");
    }
    const badges = h("div", { class: "sn-card-badges" });
    if (m.remindAt) badges.append(h("span", { class: "sn-badge" + (m.remindAt < Date.now() ? " is-late" : "") }, [icon("alarm"), h("span", { text: fmtDateTime(m.remindAt) })]));
    const checks = (note.content || "").match(/<li[^>]*class="[^"]*sn-check[^"]*"[^>]*>/g) || [];
    if (checks.length) {
      const done = checks.filter((x) => /data-checked="true"/.test(x)).length;
      badges.append(h("span", { class: "sn-badge" }, [icon("checklist"), h("span", { text: t("checkedCount", { done, total: checks.length }) })]));
    }
    (note.tags || []).map(tagName).filter(Boolean).forEach((name) => badges.append(h("span", { class: "sn-badge sn-tag", text: "#" + name })));
    if (badges.childElementCount) card.querySelector(".note-card-footer")?.before(badges);
    if (selectMode && !opts.restoreIcon) {
      const box = h("input", { type: "checkbox", class: "sn-select-box", "aria-label": t("selectNote", { title: note.title || t("untitled") }) });
      box.checked = selected.has(note.id);
      box.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("change", () => { box.checked ? selected.add(note.id) : selected.delete(note.id); card.classList.toggle("is-selected", box.checked); updateBulkBar(); });
      card.prepend(box);
    }
    // Locked notes and select mode intercept the card click.
    card.addEventListener("click", async (e) => {
      if (e.target.closest(".note-card-more, .note-card-del, .sn-select-box")) return;
      if (selectMode && !opts.restoreIcon) {
        e.stopImmediatePropagation();
        const box = card.querySelector(".sn-select-box");
        if (box) { box.checked = !box.checked; box.dispatchEvent(new Event("change")); }
        return;
      }
      if (m.lock) {
        e.stopImmediatePropagation();
        const open = await unlockNote(note);
        if (open) App().openPreview(open);
      }
    }, true);
    card.addEventListener("keydown", (e) => {
      if (e.target !== card) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); }
    });
    card.querySelectorAll(".note-card-more, .note-card-del").forEach((btn) => {
      btn.setAttribute("role", "button");
      btn.tabIndex = 0;
      if (!btn.getAttribute("aria-label")) btn.setAttribute("aria-label", btn.getAttribute("title") || "");
      btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); btn.click(); } });
    });
  };

  /* ------------------------------------------------------------ toolbar */
  function buildToolbar() {
    if ($("#snToolbar")) return $("#snToolbar");
    const sort = h("select", { id: "snSort", class: "mu-select", "aria-label": t("sortBy") }, [["updated", "sortUpdated"], ["created", "sortCreated"], ["title", "sortTitle"], ["color", "sortColor"]].map(([v, k]) => h("option", { value: v, "data-sf": k, text: t(k) })));
    const tag = h("select", { id: "snTagFilter", class: "mu-select", "aria-label": t("filterTag") });
    const color = h("select", { id: "snColorFilter", class: "mu-select", "aria-label": t("filterColor") }, [h("option", { value: "all", "data-sf": "allColors", text: t("allColors") }), ...COLORS.map(([v, k]) => h("option", { value: v, "data-sf": k, text: t(k) }))]);
    const layout = h("div", { class: "mu-segmented", role: "group", "aria-label": t("layout") }, [
      h("button", { type: "button", "data-layout": "grid", "aria-label": t("gridView"), title: t("gridView"), onclick: () => { setView({ layout: "grid" }); App().render(); } }, [icon("grid_view")]),
      h("button", { type: "button", "data-layout": "list", "aria-label": t("listView"), title: t("listView"), onclick: () => { setView({ layout: "list" }); App().render(); } }, [icon("view_agenda")]),
    ]);
    const bar = h("div", { id: "snToolbar", class: "sn-toolbar", role: "toolbar", "aria-label": t("listOptions") }, [
      h("div", { class: "sn-toolbar-field" }, [icon("sort"), sort]),
      h("div", { class: "sn-toolbar-field" }, [icon("label"), tag]),
      h("div", { class: "sn-toolbar-field" }, [icon("palette"), color]),
      layout,
      h("button", { type: "button", id: "snSelectBtn", class: "mu-btn", "aria-pressed": "false", onclick: () => toggleSelect() }, [icon("checklist"), h("span", { "data-sf": "select", text: t("select") })]),
    ]);
    sort.addEventListener("change", () => { setView({ sort: sort.value }); App().render(); });
    tag.addEventListener("change", () => { setView({ tag: tag.value }); App().render(); });
    color.addEventListener("change", () => { setView({ color: color.value }); App().render(); });
    return bar;
  }
  function syncToolbar(page) {
    const bar = buildToolbar();
    const list = { notesPage: "#notesList", favoritesPage: "#favoritesList", archivePage: "#archiveList" }[page];
    const target = list && $(list);
    if (!target) { bar.hidden = true; return; }
    bar.hidden = false;
    if (target.previousElementSibling !== bar) target.before(bar);
    const onNotes = page === "notesPage";
    $("#snTagFilter").closest(".sn-toolbar-field").hidden = !onNotes;
    $("#snColorFilter").closest(".sn-toolbar-field").hidden = !onNotes;
    const tag = $("#snTagFilter");
    const sig = lang() + "|" + tagsCache.map((x) => x.id + ":" + x.name).join("|");
    if (tag.dataset.sig !== sig) {
      tag.replaceChildren(h("option", { value: "all", text: t("allTags") }), ...tagsCache.map((x) => h("option", { value: x.id, text: "#" + x.name })));
      tag.dataset.sig = sig;
    }
    if (view.tag !== "all" && !tagsCache.some((x) => x.id === view.tag)) setView({ tag: "all" });
    for (const [id, value] of [["snSort", view.sort], ["snTagFilter", view.tag], ["snColorFilter", view.color]]) {
      const select = $("#" + id);
      if (select.value !== value) select.value = value;
      UI()?.refreshSelect?.(select);
    }
    $$("[data-layout]", bar).forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.layout === view.layout)));
    $("#snSelectBtn").setAttribute("aria-pressed", String(selectMode));
  }

  /* ------------------------------------------------------------ bulk actions */
  function toggleSelect(force) {
    selectMode = typeof force === "boolean" ? force : !selectMode;
    if (!selectMode) selected.clear();
    App().render();
  }
  function updateBulkBar() {
    let bar = $("#snBulkBar");
    if (!bar) {
      const act = (name, key, fn, danger) => h("button", { type: "button", class: "mu-icon-btn", "aria-label": t(key), title: t(key), "data-sf-label": key, "data-mu-danger": danger ? "" : undefined, onclick: fn }, [icon(name)]);
      bar = h("div", { id: "snBulkBar", class: "mu-action-bar sn-bulk-bar", role: "toolbar", "aria-label": t("selectedNotes"), hidden: true }, [
        h("span", { class: "mu-action-bar-count" }),
        act("select_all", "selectAll", () => { $$(".content-page.active .note-card").forEach((card) => { const box = card.querySelector(".sn-select-box"); if (box && !box.checked) { box.checked = true; box.dispatchEvent(new Event("change")); } }); }),
        act("push_pin", "pin", () => bulk((n) => ({ meta: { ...meta(n), pinned: true } }))),
        act("palette", "color", () => pickColor("", (color) => bulk((n) => ({ meta: { ...meta(n), color } })))),
        act("label", "addTag", () => bulkTag()),
        act("archive", "archive", () => bulk((n) => ({ meta: { ...meta(n), archived: true } }), t("archived"))),
        act("delete", "moveToTrash", () => bulk(() => ({ trashed: true }), t("movedToTrash")), true),
        h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("done"), title: t("done"), onclick: () => toggleSelect(false) }, [icon("close")]),
      ]);
      document.body.append(bar);
    }
    bar.hidden = !selectMode;
    bar.querySelector(".mu-action-bar-count").textContent = t("selectedCount", { count: selected.size });
  }
  async function bulk(patchFor, undoLabel) {
    if (!selected.size) { toast(t("selectFirst"), "info"); return; }
    const before = [];
    undoing++;
    try {
      for (const id of selected) {
        const note = notesCache.get(id);
        if (!note) continue;
        before.push(structuredClone(note));
        await App().saveNote({ ...note, ...patchFor(note) });
      }
    } finally { undoing--; }
    if (undoLabel) pushUndo(before, undoLabel);
    const count = before.length;
    selected.clear();
    await App().render();
    toast(t("updatedCount", { count }));
  }
  function bulkTag() {
    if (!tagsCache.length) { toast(t("noTagsYet"), "info"); return; }
    UI().pickFromList({
      title: t("addTag"), icon: "label", searchLabel: t("search"), closeLabel: t("close"),
      items: tagsCache.map((x) => ({ value: x.id, label: x.name })),
      onPick: (id) => bulk((n) => ({ tags: [...new Set([...(n.tags || []), id])] })),
    });
  }

  /* ------------------------------------------------------------ card menu additions */
  function mountCardMenu() {
    const menu = $("#cardMoreMenu");
    if (!menu || menu.querySelector("[data-sf-action]")) return;
    menu.setAttribute("role", "menu");
    const item = (action, iconName, key) => h("div", { class: "card-menu-item", role: "menuitem", tabindex: "0", "data-sf-action": action }, [h("icon", { text: iconName }), h("span", { class: "menu-item-label", "data-sf": key, text: t(key) })]);
    const sep = () => h("div", { class: "sn-menu-sep", role: "separator" });
    const trash = $("#menuTrashItem");
    menu.insertBefore(sep(), trash);
    [["pin", "push_pin", "pin"], ["color", "palette", "color"], ["archive", "archive", "archive"], ["remind", "alarm_add", "remindMe"],
      ["duplicate", "content_copy", "duplicate"], ["template", "library_add", "saveAsTemplate"], ["lock", "lock", "lockNote"],
      ["copy", "assignment", "copyNote"], ["export", "download", "exportNote"], ["speak", "record_voice_over", "readAloud"]]
      .forEach(([a, i, k]) => menu.insertBefore(item(a, i, k), trash));
    menu.insertBefore(sep(), trash);
    $$(".card-menu-item", menu).forEach((n) => { n.setAttribute("role", "menuitem"); n.tabIndex = 0; });
    menu.addEventListener("keydown", (e) => {
      const items = $$(".card-menu-item", menu);
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.activeElement?.click(); }
      else if (e.key === "Escape") App().hideCardMenu();
    });
    menu.addEventListener("click", async (e) => {
      const target = e.target.closest("[data-sf-action]");
      if (!target) return;
      e.stopPropagation();
      const note = App().menuNote();
      App().hideCardMenu();
      if (note) await runAction(target.dataset.sfAction, notesCache.get(note.id) || note);
    });
  }
  H.onCardMenu = (note, menu) => {
    const m = meta(note);
    const set = (action, iconName, key) => {
      const node = menu.querySelector(`[data-sf-action="${action}"]`);
      if (!node) return;
      node.querySelector("icon").textContent = iconName;
      const label = node.querySelector(".menu-item-label");
      label.dataset.sf = key;
      label.textContent = t(key);
    };
    set("pin", "push_pin", m.pinned ? "unpin" : "pin");
    set("archive", m.archived ? "unarchive" : "archive", m.archived ? "unarchive" : "archive");
    set("lock", m.lock ? "lock_open" : "lock", m.lock ? "removeLock" : "lockNote");
    set("remind", m.remindAt ? "alarm_off" : "alarm_add", m.remindAt ? "clearReminder" : "remindMe");
    $$("[data-sf-action]", menu).forEach((n) => { n.hidden = Boolean(note.trashed); });
    $$(".sn-menu-sep", menu).forEach((n) => { n.hidden = Boolean(note.trashed); });
    requestAnimationFrame(() => {
      const box = menu.getBoundingClientRect();
      const top = Math.max(8, Math.min(box.top, window.innerHeight - box.height - 8));
      menu.style.top = top + "px";
      menu.querySelector(".card-menu-item")?.focus({ preventScroll: true });
    });
  };

  async function runAction(action, note) {
    const m = meta(note);
    if (action === "pin") { await update(note, { pinned: !m.pinned }); toast(m.pinned ? t("unpinned") : t("pinnedToast")); }
    else if (action === "color") { pickColor(m.color, async (color) => { await update(note, { color }); App().render(); }); return; }
    else if (action === "archive") { await update(note, { archived: !m.archived }); if (m.archived) toast(t("unarchived")); }
    else if (action === "remind") { if (m.remindAt) { await update(note, { remindAt: null, reminded: false }); toast(t("reminderCleared"), "info"); } else setReminder(note); }
    else if (action === "duplicate") {
      const source = m.lock ? await unlockNote(note) : note;
      if (!source) return;
      const copy = { ...structuredClone(source), id: "n_" + Date.now(), title: t("copyOf", { title: note.title || t("untitled") }), createdAt: Date.now(), meta: { ...meta(source), pinned: false, remindAt: null, reminded: false } };
      if (copy.meta.lock) { const s = sessionKeys.get(note.id); if (s) sessionKeys.set(copy.id, s); }
      await App().saveNote(copy);
      toast(t("duplicated"));
    } else if (action === "template") {
      const source = m.lock ? await unlockNote(note) : note;
      if (!source) return;
      const name = await promptDialog({ title: t("saveAsTemplate"), label: t("templateName"), value: note.title || "", icon: "library_add" });
      if (!name) return;
      setShared({ templates: [...shared.templates, { id: "tpl_" + Date.now(), name, title: source.title || "", content: source.content || "" }] });
      toast(t("templateSaved"));
      return;
    } else if (action === "lock") { await lockNote(note); return; }
    else if (action === "copy") { copyNote(note); return; }
    else if (action === "export") { exportNote(note); return; }
    else if (action === "speak") { const open = m.lock ? await unlockNote(note) : note; if (open) speak(open); return; }
    App().render();
  }

  /* ------------------------------------------------------------ reminders */
  function setReminder(note) {
    const now = new Date(Date.now() + 3600000);
    const value = isoDay(now) + "T" + String(now.getHours()).padStart(2, "0") + ":00";
    UI().pickDateTime({
      value,
      onPick: async (picked) => {
        if (!picked) return;
        const at = new Date(picked).getTime();
        if (!Number.isFinite(at)) return;
        if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch {} }
        await update(note, { remindAt: at, reminded: false });
        toast(t("reminderSet", { date: fmtDateTime(at) }));
        App().render();
      },
    });
  }
  async function checkReminders() {
    if (!App()) return;
    await refreshCache();
    const due = [...notesCache.values()].filter((n) => !n.trashed && meta(n).remindAt && !meta(n).reminded && meta(n).remindAt <= Date.now());
    for (const note of due) {
      const title = note.title || t("untitled");
      toast(t("reminderDue", { title }), "info");
      try { if ("Notification" in window && Notification.permission === "granted") new Notification(t("appName"), { body: title, icon: "./android-chrome-192x192.png", tag: "supanotes-" + note.id }); } catch {}
      await App().saveNote({ ...note, meta: { ...meta(note), reminded: true } }, { keepUpdatedAt: true });
    }
    if (due.length) App().render();
  }

  /* ------------------------------------------------------------ export, copy, read aloud */
  function htmlToMarkdown(html) {
    const root = document.createElement("div");
    root.innerHTML = html || "";
    const walk = (node, depth = 0) => {
      if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, " ");
      if (node.nodeType !== 1) return "";
      const kids = () => [...node.childNodes].map((c) => walk(c, depth)).join("");
      const tag = node.tagName.toLowerCase();
      if (node.classList.contains("sn-voice-note")) return "\n\n[" + t("voiceNote") + "]\n\n";
      switch (tag) {
        case "h1": return "\n\n# " + kids().trim() + "\n\n";
        case "h2": return "\n\n## " + kids().trim() + "\n\n";
        case "h3": return "\n\n### " + kids().trim() + "\n\n";
        case "b": case "strong": return "**" + kids() + "**";
        case "i": case "em": return "_" + kids() + "_";
        case "s": case "strike": case "del": return "~~" + kids() + "~~";
        case "mark": return "==" + kids() + "==";
        case "code": return node.closest("pre") ? kids() : "`" + kids() + "`";
        case "pre": return "\n\n```\n" + node.textContent + "\n```\n\n";
        case "blockquote": return "\n\n" + kids().trim().split("\n").map((l) => "> " + l).join("\n") + "\n\n";
        case "a": return "[" + kids() + "](" + (node.getAttribute("href") || "") + ")";
        case "img": { const src = node.getAttribute("src") || ""; return /^https?:/i.test(src) ? "![](" + src + ")" : "[" + t("image") + "]"; }
        case "br": return "\n";
        case "ul": case "ol": return "\n" + [...node.children].map((li, i) => {
          const pad = "  ".repeat(depth);
          const mark = li.classList.contains("sn-check") ? "- [" + (li.dataset.checked === "true" ? "x" : " ") + "] " : tag === "ol" ? (i + 1) + ". " : "- ";
          return pad + mark + [...li.childNodes].map((c) => walk(c, depth + 1)).join("").trim();
        }).join("\n") + "\n";
        case "p": case "div": return "\n" + kids() + "\n";
        default: return kids();
      }
    };
    return walk(root).replace(/\n{3,}/g, "\n\n").trim();
  }
  const noteMarkdown = (note) => "# " + (note.title || t("untitled")) + "\n\n" + htmlToMarkdown(note.content);
  function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const fileName = (note) => (note.title || t("untitled")).replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "note";
  async function exportNote(note) {
    const open = meta(note).lock ? await unlockNote(note) : note;
    if (!open) return;
    UI().pickFromList({
      title: t("exportNote"), icon: "download", searchLabel: t("search"), closeLabel: t("close"),
      items: [{ value: "md", label: t("markdownFile"), trailing: ".md" }, { value: "txt", label: t("textFile"), trailing: ".txt" }, { value: "html", label: t("htmlFile"), trailing: ".html" }],
      onPick: (format) => {
        if (format === "md") download(fileName(open) + ".md", "text/markdown;charset=utf-8", noteMarkdown(open));
        else if (format === "txt") download(fileName(open) + ".txt", "text/plain;charset=utf-8", (open.title || "") + "\n\n" + plain(open.content));
        else download(fileName(open) + ".html", "text/html;charset=utf-8", '<!doctype html><html lang="' + lang() + '"><head><meta charset="utf-8"><title>' + esc(open.title || t("untitled")) + '</title></head><body><h1>' + esc(open.title || "") + "</h1>" + (window.SupaNotesSanitize ? window.SupaNotesSanitize.html(open.content) : "") + "</body></html>");
        toast(t("exported"));
      },
    });
  }
  async function exportAllMarkdown() {
    const notes = (await App().getAllNotes()).filter((n) => !n.trashed);
    if (!notes.length) { toast(t("nothingToExport"), "info"); return; }
    const parts = notes.map((n) => (meta(n).lock ? "# " + (n.title || t("untitled")) + "\n\n" + t("lockedPreview") : noteMarkdown(n)));
    download("SupaNotes-" + isoDay(new Date()) + ".md", "text/markdown;charset=utf-8", parts.join("\n\n---\n\n") + "\n");
    toast(t("exported"));
  }
  async function copyNote(note) {
    const open = meta(note).lock ? await unlockNote(note) : note;
    if (!open) return;
    UI().pickFromList({
      title: t("copyNote"), icon: "assignment", searchLabel: t("search"), closeLabel: t("close"),
      items: [{ value: "text", label: t("copyAsText") }, { value: "md", label: t("copyAsMarkdown") }],
      onPick: async (kind) => {
        const text = kind === "md" ? noteMarkdown(open) : (open.title ? open.title + "\n\n" : "") + plain(open.content);
        try { await navigator.clipboard.writeText(text); toast(t("copied")); } catch { toast(t("copyFailed"), "error"); }
      },
    });
  }
  let speaking = false;
  function speak(note) {
    if (!("speechSynthesis" in window)) { toast(t("speechUnsupported"), "error"); return; }
    if (speaking) { speechSynthesis.cancel(); speaking = false; toast(t("stoppedReading"), "info"); return; }
    const utterance = new SpeechSynthesisUtterance(((note.title || "") + ". " + plain(note.content)).trim());
    utterance.lang = lang();
    utterance.onend = utterance.onerror = () => { speaking = false; };
    speaking = true;
    speechSynthesis.speak(utterance);
    toast(t("readingAloud"), "info");
  }

  /* ------------------------------------------------------------ templates + daily note */
  const BUILTIN = () => [
    { id: "b-meeting", name: t("tplMeeting"), title: t("tplMeeting"), content: `<h2>${esc(t("tplAgenda"))}</h2><ul><li><br></li></ul><h2>${esc(t("tplNotes"))}</h2><p><br></p><h2>${esc(t("tplActionItems"))}</h2><ul class="sn-checklist"><li class="sn-check" data-checked="false"><br></li></ul>` },
    { id: "b-todo", name: t("tplTodo"), title: t("tplTodo"), content: `<ul class="sn-checklist"><li class="sn-check" data-checked="false"><br></li><li class="sn-check" data-checked="false"><br></li><li class="sn-check" data-checked="false"><br></li></ul>` },
    { id: "b-journal", name: t("tplJournal"), title: "", content: `<h2>${esc(t("tplGrateful"))}</h2><p><br></p><h2>${esc(t("tplHighlights"))}</h2><p><br></p><h2>${esc(t("tplTomorrow"))}</h2><ul class="sn-checklist"><li class="sn-check" data-checked="false"><br></li></ul>` },
    { id: "b-project", name: t("tplProject"), title: t("tplProject"), content: `<h2>${esc(t("tplGoal"))}</h2><p><br></p><h2>${esc(t("tplMilestones"))}</h2><ul class="sn-checklist"><li class="sn-check" data-checked="false"><br></li></ul><h2>${esc(t("tplRisks"))}</h2><ul><li><br></li></ul>` },
    { id: "b-lecture", name: t("tplLecture"), title: t("tplLecture"), content: `<h2>${esc(t("tplKeyIdeas"))}</h2><ul><li><br></li></ul><h2>${esc(t("tplQuestions"))}</h2><ul><li><br></li></ul><h2>${esc(t("tplSummary"))}</h2><p><br></p>` },
    { id: "b-weekly", name: t("tplWeekly"), title: t("tplWeekly"), content: `<h2>${esc(t("tplWins"))}</h2><ul><li><br></li></ul><h2>${esc(t("tplChallenges"))}</h2><ul><li><br></li></ul><h2>${esc(t("tplNextWeek"))}</h2><ul class="sn-checklist"><li class="sn-check" data-checked="false"><br></li></ul>` },
  ];
  function openTemplatePicker() {
    const builtins = BUILTIN();
    UI().pickFromList({
      title: t("newFromTemplate"), icon: "library_books", searchLabel: t("search"), closeLabel: t("close"), emptyText: t("noResults"),
      groups: [
        { label: t("myTemplates"), items: shared.templates.map((x) => ({ value: "u:" + x.id, label: x.name, sub: x.title })) },
        { label: t("builtInTemplates"), items: builtins.map((x) => ({ value: "b:" + x.id, label: x.name })) },
      ],
      onPick: (value) => {
        const tpl = value.startsWith("u:") ? shared.templates.find((x) => "u:" + x.id === value) : builtins.find((x) => "b:" + x.id === value);
        if (!tpl) return;
        App().openEditor(null);
        App().titleInput.value = tpl.title || "";
        App().editor.innerHTML = window.SupaNotesSanitize ? window.SupaNotesSanitize.html(tpl.content) : tpl.content;
        updateStats();
      },
    });
  }
  async function openDailyNote() {
    const today = isoDay(new Date());
    const notes = await App().getAllNotes();
    const existing = notes.find((n) => meta(n).daily === today && !n.trashed);
    if (existing) {
      const open = meta(existing).lock ? await unlockNote(existing) : existing;
      if (open) App().openEditor(open);
      return;
    }
    const journal = BUILTIN().find((x) => x.id === "b-journal");
    const note = { id: "n_" + Date.now(), title: new Date().toLocaleDateString(lang(), { weekday: "long", year: "numeric", month: "long", day: "numeric" }), content: journal.content, createdAt: Date.now(), favorite: false, trashed: false, tags: [], meta: { daily: today } };
    await App().saveNote(note);
    App().openEditor(note);
    App().render();
  }

  /* ------------------------------------------------------------ editor additions */
  let editorState = { color: "", pinned: false };
  let autosaveTimer = null;
  H.editorMeta = () => ({ color: editorState.color, pinned: editorState.pinned });
  H.onOpenEditor = (note) => {
    if (note && meta(note).lock && !sessionKeys.has(note.id)) {
      setTimeout(async () => {
        App().closeEditor();
        const open = await unlockNote(notesCache.get(note.id) || note);
        if (open) App().openEditor(open);
      }, 0);
      return;
    }
    editorState = { color: meta(note).color || "", pinned: Boolean(meta(note).pinned) };
    paintEditorHeader();
    setStatus("");
    closeFind();
    $("#newNoteModal").classList.remove("is-focus");
    $("#snTemplateBtn").hidden = Boolean(note);
    setTimeout(updateStats, 0);
    requestAnimationFrame(layoutToolbar);
  };
  H.onCloseEditor = () => { clearTimeout(autosaveTimer); closeFind(); closeToolMenu(); $("#newNoteModal")?.classList.remove("is-focus"); };
  H.onSaved = (note) => { notesCache.set(note.id, note); };
  function paintEditorHeader() {
    const modal = $("#newNoteModal");
    if (!modal) return;
    modal.querySelector(".new-note_Modal-content").dataset.color = editorState.color;
    const pin = $("#snEditorPin");
    if (pin) { pin.setAttribute("aria-pressed", String(editorState.pinned)); pin.querySelector(".mu-icon").classList.toggle("mu-icon-filled", editorState.pinned); }
  }
  function setStatus(text) { const s = $("#snEditorStatus"); if (s) s.textContent = text; }
  function updateStats() {
    const text = plain(App().editor.innerHTML);
    const words = (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
    const chars = text.replace(/\s/g, "").length;
    const minutes = Math.max(1, Math.round(words / 220));
    const stats = $("#snEditorStats");
    if (stats) stats.textContent = t("editorStats", { words, chars, minutes: words ? minutes : 0 });
  }
  function scheduleAutosave() {
    updateStats();
    if (!shared.autosave) return;
    clearTimeout(autosaveTimer);
    setStatus(t("unsavedChanges"));
    autosaveTimer = setTimeout(autosave, 1500);
  }
  async function autosave() {
    const app = App();
    if (!$("#newNoteModal").classList.contains("active")) return;
    const title = app.titleInput.value.trim();
    const content = app.editor.innerHTML.trim();
    if (!title && !plain(content).trim() && !/<img|sn-voice-note/.test(content)) return;
    const current = app.editorNote();
    const note = {
      id: current ? current.id : "n_" + Date.now(), title, content,
      createdAt: current ? current.createdAt : Date.now(),
      favorite: current ? current.favorite : false, trashed: current ? current.trashed : false, tags: current ? current.tags : [],
      meta: { ...meta(current), ...H.editorMeta() },
    };
    setStatus(t("saving"));
    await app.saveNote(note);
    if (!current) app.setEditorNote(note);
    else Object.assign(current, { title, content, meta: note.meta });
    setStatus(t("savedAt", { time: nmAn(new Date().toLocaleTimeString(lang(), { hour: "numeric", minute: "2-digit" })) }));
  }

  function mountEditor() {
    const modal = $("#newNoteModal");
    if (!modal || $("#snEditorStats")) return;
    const app = App();
    const left = modal.querySelector(".formatting-actions-left") || modal.querySelector(".formatting-actionsbar");
    const tool = (iconName, key, fn) => h("div", { class: "actionitem-formatting", role: "button", tabindex: "0", title: t(key), "aria-label": t(key), "data-sf-label": key, onmousedown: (e) => e.preventDefault(), onclick: fn, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } } }, [h("icon", { text: iconName })]);
    const block = (tag) => () => { app.editor.focus(); document.execCommand("formatBlock", false, "<" + tag + ">"); scheduleAutosave(); };
    const extras = [
      h("div", { class: "vl-divider" }),
      tool("format_h1", "heading1", block("h1")),
      tool("format_h2", "heading2", block("h2")),
      tool("format_quote", "quote", block("blockquote")),
      tool("code", "codeBlock", block("pre")),
      tool("ink_highlighter", "highlight", () => { app.editor.focus(); const sel = getSelection(); if (sel && sel.toString()) document.execCommand("insertHTML", false, "<mark>" + esc(sel.toString()) + "</mark>"); scheduleAutosave(); }),
      tool("checklist", "checklist", () => insertChecklist()),
      h("div", { class: "vl-divider" }),
      tool("find_replace", "findReplace", () => toggleFind()),
      tool("fullscreen", "focusMode", () => toggleFocus()),
    ];
    if (left) extras.forEach((node) => left.append(node));
    const headerRight = modal.querySelector(".new__note-modal-header-right");
    if (headerRight) {
      headerRight.prepend(
        h("button", { type: "button", id: "snTemplateBtn", class: "mu-icon-btn", title: t("newFromTemplate"), "aria-label": t("newFromTemplate"), "data-sf-label": "newFromTemplate", onclick: () => openTemplatePicker() }, [icon("library_books")]),
        h("button", { type: "button", id: "snEditorColor", class: "mu-icon-btn", title: t("color"), "aria-label": t("color"), "data-sf-label": "color", onclick: () => pickColor(editorState.color, (color) => { editorState.color = color; paintEditorHeader(); scheduleAutosave(); }) }, [icon("palette")]),
        h("button", { type: "button", id: "snEditorPin", class: "mu-icon-btn", title: t("pin"), "aria-label": t("pin"), "data-sf-label": "pin", "aria-pressed": "false", onclick: () => { editorState.pinned = !editorState.pinned; paintEditorHeader(); scheduleAutosave(); } }, [icon("push_pin")]),
      );
    }
    const container = modal.querySelector(".note-container");
    const findBar = h("div", { id: "snFind", class: "sn-find", hidden: true, role: "search", "aria-label": t("findReplace") }, [
      h("input", { id: "snFindInput", class: "mu-input", type: "search", placeholder: t("find"), "aria-label": t("find"), "data-sf-placeholder": "find" }),
      h("input", { id: "snReplaceInput", class: "mu-input", type: "text", placeholder: t("replaceWith"), "aria-label": t("replaceWith"), "data-sf-placeholder": "replaceWith" }),
      h("span", { id: "snFindCount", class: "mu-muted", "aria-live": "polite" }),
      iconBtn("keyboard_arrow_down", t("findNext"), () => findNext()),
      h("button", { type: "button", class: "mu-btn", onclick: () => replaceOne(), "data-sf": "replace", text: t("replace") }),
      h("button", { type: "button", class: "mu-btn", onclick: () => replaceAll(), "data-sf": "replaceAll", text: t("replaceAll") }),
      iconBtn("close", t("close"), () => closeFind(), "mu-icon-btn-soft"),
    ]);
    container?.prepend(findBar);
    $("#snFindInput").addEventListener("input", () => { findIndex = -1; countMatches(); });
    $("#snFindInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findNext(); } });
    const footer = h("div", { class: "sn-editor-footer" }, [h("span", { id: "snEditorStats", class: "mu-muted" }), h("span", { id: "snEditorStatus", class: "mu-muted", "aria-live": "polite" })]);
    container?.append(footer);
    app.editor.addEventListener("input", (e) => { markdownShortcut(e); scheduleAutosave(); });
    app.titleInput.addEventListener("input", scheduleAutosave);
    app.editor.addEventListener("click", (e) => {
      const li = e.target.closest?.("li.sn-check");
      if (!li) return;
      const box = li.getBoundingClientRect();
      const rtl = getComputedStyle(li).direction === "rtl";
      const x = rtl ? box.right - e.clientX : e.clientX - box.left;
      if (x <= 36) { li.dataset.checked = String(li.dataset.checked !== "true"); scheduleAutosave(); }
    });
    app.editor.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); $("#newNoteButton")?.click(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") { e.preventDefault(); toggleFind(true); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); toggleFocus(); }
    });
    app.titleInput.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); $("#newNoteButton")?.click(); } });
  }
  function insertChecklist() {
    const app = App();
    app.editor.focus();
    const sel = getSelection();
    const text = sel && sel.toString();
    const items = text ? text.split(/\n+/).filter(Boolean) : [""];
    document.execCommand("insertHTML", false, '<ul class="sn-checklist">' + items.map((x) => '<li class="sn-check" data-checked="false">' + (esc(x) || "<br>") + "</li>").join("") + "</ul>");
    scheduleAutosave();
  }
  // Markdown shortcuts: typing "# ", "## ", "### ", "> ", "- ", "1. ", "[] " or "``` "
  // at the start of a plain line turns that line into the matching block.
  function markdownShortcut(e) {
    if (e.inputType !== "insertText" || e.data !== " ") return;
    const sel = getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    const node = sel.anchorNode;
    const editor = App().editor;
    if (!node || node.nodeType !== 3 || !editor.contains(node)) return;
    if (node.parentElement?.closest("li, pre, h1, h2, h3, blockquote, .sn-voice-note")) return;
    const before = node.nodeValue.slice(0, sel.anchorOffset).replace(/ /g, " ");
    const rules = [[/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^>\s$/, "blockquote"], [/^[-*]\s$/, "ul"], [/^1[.)]\s$/, "ol"], [/^\[\s?\]\s$/, "check"], [/^```\s$/, "pre"]];
    const rule = rules.find(([re]) => re.test(before));
    if (!rule) return;
    // The line is the editor's direct child that holds the caret (bare text is wrapped first).
    let block = node;
    while (block.parentNode && block.parentNode !== editor) block = block.parentNode;
    if (block.parentNode !== editor) return;
    if (block.nodeType === 3) {
      const wrap = document.createElement("div");
      editor.insertBefore(wrap, block);
      wrap.append(block);
      block = wrap;
    }
    if (!/^(DIV|P)$/.test(block.tagName)) return;
    const text = block.textContent.replace(/ /g, " ");
    if (!text.startsWith(before)) return;
    const rest = text.slice(before.length);
    const kind = rule[1];
    let replacement;
    let target;
    if (kind === "ul" || kind === "ol" || kind === "check") {
      replacement = document.createElement(kind === "ol" ? "ol" : "ul");
      target = document.createElement("li");
      if (kind === "check") { replacement.className = "sn-checklist"; target.className = "sn-check"; target.dataset.checked = "false"; }
      replacement.append(target);
    } else {
      replacement = document.createElement(kind);
      target = replacement;
    }
    if (rest) target.textContent = rest;
    else target.append(document.createElement("br"));
    block.replaceWith(replacement);
    const range = document.createRange();
    if (rest) { range.selectNodeContents(target); range.collapse(false); }
    else { range.setStart(target, 0); range.collapse(true); }
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function toggleFocus() {
    const modal = $("#newNoteModal");
    const on = !modal.classList.contains("is-focus");
    modal.classList.toggle("is-focus", on);
    requestAnimationFrame(layoutToolbar);
    toast(on ? t("focusOn") : t("focusOff"), "info");
    App().editor.focus();
  }


  /* ------------------------------------------------------------ toolbar overflow ("More" menu) */
  // Tools that don't fit on one row move into a More menu, so the toolbar never scrolls sideways.
  // The same buttons are moved (not copied), so their actions and active states keep working.
  let toolMenu = null;
  let toolMore = null;
  function mountToolOverflow() {
    const left = document.querySelector("#newNoteModal .formatting-actions-left");
    if (!left || document.getElementById("snToolMore")) return;
    [...left.children].forEach((node, i) => { node.dataset.snOrder = String(i); });
    toolMore = h("button", { type: "button", id: "snToolMore", class: "mu-icon-btn mu-btn-ghost actionitem-formatting sn-tool-more", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": t("moreTools"), title: t("moreTools"), "data-sf-label": "moreTools",
      onmousedown: (e) => e.preventDefault(),
      onclick: (e) => { e.stopPropagation(); toolMenu.hidden ? openToolMenu() : closeToolMenu(); } }, [icon("more_horiz")]);
    left.append(toolMore);
    toolMenu = h("div", { id: "snToolMenu", class: "mu-menu sn-tool-menu", role: "menu", "aria-label": t("moreTools"), hidden: true });
    toolMenu.addEventListener("mousedown", (e) => e.preventDefault());
    toolMenu.addEventListener("click", (e) => { if (e.target.closest(".actionitem-formatting")) setTimeout(closeToolMenu, 0); });
    toolMenu.addEventListener("keydown", (e) => {
      const items = [...toolMenu.querySelectorAll(".actionitem-formatting")];
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
      else if (e.key === "Escape") { e.stopPropagation(); closeToolMenu(); toolMore.focus(); }
    });
    document.body.append(toolMenu);
    document.addEventListener("pointerdown", (e) => { if (!toolMenu.hidden && !toolMenu.contains(e.target) && e.target !== toolMore && !toolMore.contains(e.target)) closeToolMenu(); });
    window.addEventListener("resize", () => { closeToolMenu(); layoutToolbar(); });
    const bar = left.closest(".formatting-actionsbar");
    if (window.ResizeObserver && bar) new ResizeObserver(() => layoutToolbar()).observe(bar);
  }
  function layoutToolbar() {
    const left = document.querySelector("#newNoteModal .formatting-actions-left");
    const bar = left && left.closest(".formatting-actionsbar");
    if (!left || !toolMore || !bar || !bar.offsetParent) return;
    // Put everything back in its original order, then move overflow from the end into the menu.
    const all = [...left.querySelectorAll("[data-sn-order]"), ...toolMenu.querySelectorAll("[data-sn-order]")]
      .sort((a, b) => Number(a.dataset.snOrder) - Number(b.dataset.snOrder));
    all.forEach((node) => left.insertBefore(node, toolMore));
    toolMore.hidden = true;
    const right = bar.querySelector(".formatting-actions-right");
    const styles = getComputedStyle(bar);
    const sameRow = right && right.offsetWidth < bar.clientWidth * 0.8;
    const available = bar.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight) - (sameRow ? right.offsetWidth + 12 : 0);
    const fits = () => left.scrollWidth <= available;
    if (fits()) { toolMenu.replaceChildren(); return; }
    toolMore.hidden = false;
    const moved = [];
    let items = [...left.querySelectorAll("[data-sn-order]")];
    while (!fits() && items.length) {
      const last = items.pop();
      moved.unshift(last);
      toolMenu.prepend(last);
    }
    // No divider at the edge of either group.
    while (left.querySelector("[data-sn-order]:last-of-type") && left.lastElementChild.previousElementSibling?.classList.contains("vl-divider")) {
      toolMenu.prepend(left.lastElementChild.previousElementSibling);
    }
    toolMenu.querySelectorAll(":scope > .actionitem-formatting").forEach((item) => {
      item.setAttribute("role", "menuitem");
      item.tabIndex = 0;
      if (!item.dataset.snLabel) item.dataset.snLabel = item.getAttribute("aria-label") || item.getAttribute("title") || "";
    });
  }
  function openToolMenu() {
    if (!toolMenu.childElementCount) return;
    toolMenu.querySelectorAll(":scope > .actionitem-formatting").forEach((item) => { item.dataset.snLabel = item.getAttribute("aria-label") || item.getAttribute("title") || ""; });
    toolMenu.hidden = false;
    toolMore.setAttribute("aria-expanded", "true");
    const r = toolMore.getBoundingClientRect();
    const m = toolMenu.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const top = below > m.height + 12 || below > r.top ? r.bottom + 8 : r.top - m.height - 8;
    toolMenu.style.top = Math.max(8, Math.min(top, window.innerHeight - m.height - 8)) + "px";
    toolMenu.style.left = Math.max(8, Math.min(r.right - m.width, window.innerWidth - m.width - 8)) + "px";
    toolMenu.querySelector(".actionitem-formatting")?.focus({ preventScroll: true });
  }
  function closeToolMenu() {
    if (!toolMenu || toolMenu.hidden) return;
    toolMenu.hidden = true;
    toolMore.setAttribute("aria-expanded", "false");
  }

  /* find & replace */
  let findIndex = -1;
  function textNodes() {
    const walker = document.createTreeWalker(App().editor, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest(".sn-voice-note") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  function matches() {
    const q = $("#snFindInput").value;
    if (!q) return [];
    const needle = q.toLocaleLowerCase(lang());
    const out = [];
    for (const node of textNodes()) {
      const hay = node.nodeValue.toLocaleLowerCase(lang());
      let i = hay.indexOf(needle);
      while (i !== -1) { out.push({ node, start: i, end: i + q.length }); i = hay.indexOf(needle, i + Math.max(1, q.length)); }
    }
    return out;
  }
  function countMatches() { const n = matches().length; $("#snFindCount").textContent = $("#snFindInput").value ? t("matches", { count: n }) : ""; return n; }
  function findNext() {
    const list = matches();
    countMatches();
    if (!list.length) return;
    findIndex = (findIndex + 1) % list.length;
    const m = list[findIndex];
    const range = document.createRange();
    range.setStart(m.node, m.start);
    range.setEnd(m.node, m.end);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    m.node.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function replaceOne() {
    const sel = getSelection();
    const q = $("#snFindInput").value;
    if (!q) return;
    if (!sel.rangeCount || sel.toString().toLocaleLowerCase(lang()) !== q.toLocaleLowerCase(lang()) || !App().editor.contains(sel.anchorNode)) { findNext(); return; }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode($("#snReplaceInput").value));
    findIndex -= 1;
    scheduleAutosave();
    findNext();
  }
  function replaceAll() {
    const list = matches();
    if (!list.length) { countMatches(); return; }
    const replacement = $("#snReplaceInput").value;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      m.node.nodeValue = m.node.nodeValue.slice(0, m.start) + replacement + m.node.nodeValue.slice(m.end);
    }
    toast(t("replacedCount", { count: list.length }));
    findIndex = -1;
    countMatches();
    scheduleAutosave();
  }
  function toggleFind(force) {
    const bar = $("#snFind");
    const show = typeof force === "boolean" ? force : bar.hidden;
    bar.hidden = !show;
    if (show) { const sel = getSelection()?.toString(); if (sel && sel.length < 80) $("#snFindInput").value = sel; $("#snFindInput").focus(); countMatches(); }
  }
  function closeFind() { const bar = $("#snFind"); if (bar) bar.hidden = true; }

  /* ------------------------------------------------------------ preview additions */
  function mountPreview() {
    const actions = $("#notePreviewModal .npreview-actions");
    if (!actions || $("#snPreviewSpeak")) return;
    const btn = (id, iconName, key, fn) => h("div", { class: "npreview-action-btn", id, role: "button", tabindex: "0", title: t(key), "aria-label": t(key), "data-sf-label": key, onclick: fn, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } } }, [h("icon", { text: iconName })]);
    const close = $("#npreviewCloseBtn");
    actions.insertBefore(btn("snPreviewSpeak", "record_voice_over", "readAloud", () => { const n = App().previewNote(); if (n) speak(n); }), close);
    actions.insertBefore(btn("snPreviewCopy", "assignment", "copyNote", () => { const n = App().previewNote(); if (n) copyNote(n); }), close);
    actions.insertBefore(btn("snPreviewExport", "download", "exportNote", () => { const n = App().previewNote(); if (n) exportNote(n); }), close);
  }
  H.onOpenPreview = (note, body) => {
    body.querySelectorAll("li.sn-check").forEach((li) => {
      li.setAttribute("role", "checkbox");
      li.setAttribute("aria-checked", String(li.dataset.checked === "true"));
      li.tabIndex = 0;
      const toggle = async () => {
        li.dataset.checked = String(li.dataset.checked !== "true");
        li.setAttribute("aria-checked", li.dataset.checked);
        const content = body.innerHTML;
        const next = { ...note, content };
        note.content = content;
        await App().saveNote(next);
      };
      li.addEventListener("click", toggle);
      li.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
    });
  };

  /* ------------------------------------------------------------ topbar + settings */
  function mountTopbar() {
    const actions = $(".topbar-right-actions");
    if (!actions || $("#snDailyBtn")) return;
    const act = (id, iconName, key, fn) => h("div", { class: "topbar-right-action", id, role: "button", tabindex: "0", title: t(key), "aria-label": t(key), "data-sf-label": key, onclick: fn, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } } }, [h("icon", { text: iconName })]);
    const settings = $("#settingsBtn");
    const nav = $(".mobile-sidebar-nav");
    if (nav) {
      const close = () => $("#mobileSidebarOverlay")?.classList.remove("active");
      const link = (iconName, key, fn) => h("div", { class: "mobile-sidebar-navlink sn-mobile-action", role: "button", tabindex: "0", onclick: () => { close(); fn(); }, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); close(); fn(); } } }, [h("icon", { text: iconName }), h("span", { "data-sf": key, text: t(key) })]);
      nav.append(h("div", { class: "sn-menu-sep", role: "separator" }), link("today", "dailyNote", openDailyNote), link("library_books", "newFromTemplate", openTemplatePicker), link("bolt", "commandPalette", openPalette), link("help", "help", () => $("#helpBtn")?.click()));
    }
    actions.insertBefore(act("snDailyBtn", "today", "dailyNote", openDailyNote), settings);
    actions.insertBefore(act("snTemplatesBtn", "library_books", "newFromTemplate", openTemplatePicker), settings);
    actions.insertBefore(act("snPaletteBtn", "bolt", "commandPalette", openPalette), settings);
  }
  function mountSettings() {
    const body = $("#settingsModal .settings-modal-body");
    if (!body || $("#snSettings")) return;
    const advanced = body.querySelector(".advanced-section");
    const autosave = h("input", { type: "checkbox", id: "snAutosave", "aria-labelledby": "snAutosaveLabel" });
    autosave.addEventListener("change", () => setShared({ autosave: autosave.checked }));
    const section = h("div", { id: "snSettings", class: "sn-settings" }, [
      h("div", { class: "mu-row" }, [
        h("div", { class: "mu-row-info" }, [h("span", { class: "mu-row-title", id: "snAutosaveLabel", "data-sf": "autosave", text: t("autosave") }), h("span", { class: "mu-row-subtitle", "data-sf": "autosaveHelp", text: t("autosaveHelp") })]),
        h("label", { class: "mu-switch" }, [autosave, h("span", { class: "mu-switch-track" })]),
      ]),
      h("div", { class: "sn-settings-templates" }, [
        h("div", { class: "mu-row-title", "data-sf": "myTemplates", text: t("myTemplates") }),
        h("div", { id: "snTemplateList", class: "sn-template-list" }),
      ]),
    ]);
    body.insertBefore(section, advanced || null);
    const exportBtn = h("button", { type: "button", class: "advanced-settings-button is-success", id: "snExportMd", "data-sf": "exportAllMarkdown", text: t("exportAllMarkdown"), onclick: exportAllMarkdown });
    const exportJson = $("#exportAllNotesBtn");
    exportJson?.after(exportBtn);
    syncSettingsForm();
  }
  function syncSettingsForm() {
    const box = $("#snAutosave");
    if (box) box.checked = Boolean(shared.autosave);
    const list = $("#snTemplateList");
    if (!list) return;
    list.replaceChildren();
    if (!shared.templates.length) { list.append(h("p", { class: "mu-muted", text: t("noTemplatesHelp") })); return; }
    shared.templates.forEach((tpl) => list.append(h("div", { class: "sn-template-row" }, [
      icon("description"), h("span", { class: "sn-template-name", text: tpl.name }),
      iconBtn("delete", t("deleteTemplate"), () => { setShared({ templates: shared.templates.filter((x) => x.id !== tpl.id) }); syncSettingsForm(); toast(t("templateDeleted"), "info"); }, "mu-icon-btn-soft"),
    ])));
  }

  /* ------------------------------------------------------------ command palette + shortcuts */
  async function openPalette() {
    const notes = (await App().getAllNotes()).filter((n) => !n.trashed);
    const pages = [["notesPage", "notes"], ["tagsPage", "tags"], ["favoritesPage", "favorites"], ["archivePage", "archive"], ["trashPage", "trash"]];
    UI().pickFromList({
      title: t("commandPalette"), icon: "bolt", searchLabel: t("paletteSearch"), closeLabel: t("close"), emptyText: t("noResults"),
      groups: [
        { label: t("goTo"), items: pages.map(([page, key]) => ({ value: "page:" + page, label: key === "archive" ? t("archive") : App().t(key) })) },
        { label: t("actions"), items: [
          { value: "a:new", label: t("newNote") }, { value: "a:daily", label: t("dailyNote") }, { value: "a:template", label: t("newFromTemplate") },
          { value: "a:select", label: t("select") }, { value: "a:md", label: t("exportAllMarkdown") }, { value: "a:undo", label: t("undo") },
          { value: "a:settings", label: App().t("settingsTitle") }, { value: "a:shortcuts", label: t("keyboardShortcuts") },
        ] },
        { label: t("notesGroup"), items: sortNotes(notes).map((n) => ({ value: "n:" + n.id, label: n.title || t("untitled"), sub: meta(n).lock ? t("locked") : plain(n.content).slice(0, 80), trailing: meta(n).archived ? t("archive") : "" })) },
      ],
      onPick: async (value) => {
        if (value.startsWith("page:")) App().showPage(value.slice(5), true);
        else if (value.startsWith("n:")) { const n = notes.find((x) => "n:" + x.id === value); const open = n && (meta(n).lock ? await unlockNote(n) : n); if (open) App().openPreview(open); }
        else if (value === "a:new") App().openEditor(null);
        else if (value === "a:daily") openDailyNote();
        else if (value === "a:template") openTemplatePicker();
        else if (value === "a:select") { App().showPage("notesPage", true); toggleSelect(true); }
        else if (value === "a:md") exportAllMarkdown();
        else if (value === "a:undo") undo();
        else if (value === "a:settings") $("#settingsBtn")?.click();
        else if (value === "a:shortcuts") showShortcuts();
      },
    });
  }
  function showShortcuts() {
    const id = "snShortcuts";
    $("#" + id)?.remove();
    const rows = [["Ctrl", "K", "commandPalette"], ["N", "", "newNote"], ["/", "", "focusSearch"], ["Ctrl", "S", "saveNote"], ["Ctrl", "H", "findReplace"], ["Ctrl", "Shift F", "focusMode"], ["Ctrl", "Z", "undo"], ["D", "", "dailyNote"]];
    const modal = h("div", { class: "mu-modal", id, hidden: true }, [
      h("div", { class: "mu-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": id + "T" }, [
        h("div", { class: "mu-dialog-header" }, [h("div", { class: "mu-dialog-heading" }, [h("span", { class: "mu-icon-circle" }, [icon("keyboard")]), h("h2", { id: id + "T", text: t("keyboardShortcuts") })]), h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), "data-mu-close": "" }, [icon("close")])]),
        h("div", { class: "sn-shortcuts" }, rows.map(([a, k, key]) => h("div", { class: "sn-shortcut" }, [h("span", { text: t(key) }), h("span", { class: "sn-keys" }, [h("span", { class: "mu-kbd", text: a }), k ? h("span", { class: "mu-kbd", text: k }) : null])]))),
      ]),
    ]);
    document.body.append(modal);
    UI().openModal(id);
  }
  document.addEventListener("keydown", (e) => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (typing || $(".mu-modal:not([hidden])") || $(".new-note_Modal.active, .generic-modal.active")) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); App().openEditor(null); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "d") { e.preventDefault(); openDailyNote(); }
    else if (e.key === "/") { e.preventDefault(); const s = $("#searchInput"); if (s && s.offsetParent) s.focus(); else $("#mobileSearchBtn")?.click(); }
    else if (e.key === "Escape" && selectMode) toggleSelect(false);
  });
  // Escape also closes Settings, Help, and the tag picker (the main script handles the other dialogs).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || document.querySelector(".mu-modal:not([hidden])")) return;
    for (const id of ["tagSelectorModal", "helpModal", "settingsModal"]) {
      const modal = document.getElementById(id);
      if (modal && modal.classList.contains("active")) { modal.classList.remove("active"); break; }
    }
  });

  /* ------------------------------------------------------------ translation + start */
  function translate() {
    $$("[data-sf]").forEach((n) => { const v = t(n.dataset.sf); if (n.textContent !== v) n.textContent = v; });
    $$("[data-sf-label]").forEach((n) => { n.setAttribute("aria-label", t(n.dataset.sfLabel)); n.title = t(n.dataset.sfLabel); });
    $$("[data-sf-placeholder]").forEach((n) => n.setAttribute("placeholder", t(n.dataset.sfPlaceholder)));
    document.documentElement.dir = lang() === "ar" ? "rtl" : "ltr";
    syncSettingsForm();
  }
  window.SupaNotesFeatures = { translate, openPalette, exportAllMarkdown, htmlToMarkdown, undo };
  document.addEventListener("supanotes-ready", async () => {
    loadSettings();
    mountTopbar();
    mountCardMenu();
    mountEditor();
    mountToolOverflow();
    mountPreview();
    mountSettings();
    registerExtrasSync();
    await refreshCache();
    translate();
    App().render();
    checkReminders();
    setInterval(checkReminders, 30000);
    $$(".navlink, .mobile-sidebar-navlink, .topbar-right-action, #menuBtn").forEach((n) => {
      if (!n.hasAttribute("tabindex")) n.tabIndex = 0;
      if (!n.getAttribute("role")) n.setAttribute("role", n.classList.contains("navlink") || n.classList.contains("mobile-sidebar-navlink") ? "link" : "button");
    });
  });
  document.addEventListener("supanotes-changed", () => { refreshCache(); });
  document.addEventListener("munetios-sync-applied", () => { loadSettings(); syncSettingsForm(); });
})();
