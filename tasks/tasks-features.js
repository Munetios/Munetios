/*
 * Munetios Tasks features on Munetios UI v4.
 * Loaded after the main Tasks script. It uses the Tasks globals
 * (allTasks, allCategories, updateTask, addTask, deleteTask, saveTasks,
 * renderTask, renderCurrentPage, ...) and keeps every task field inside the
 * task object, so the end-to-end encrypted Tasks sync carries it too.
 * Settings and templates sync through their own encrypted provider.
 */
(() => {
  "use strict";

  const STR = window.TasksFeatureStrings || { en: {} };
  const lang = () => (window.currentLang && STR[window.currentLang] ? window.currentLang : "en-US");
  function t(key, vars) {
    let value = (STR[lang()] && STR[lang()][key]) ?? (STR["en-US"] || STR.en)[key] ?? key;
    if (vars) for (const [name, v] of Object.entries(vars)) value = value.split("{" + name + "}").join(String(v));
    return value;
  }
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const UI = () => window.MunetiosUI;
  const toast = (message, type = "success") => (UI()?.toast ? UI().toast(message, { type }) : showToast(message, true));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const child of [].concat(children)) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }
  const icon = (name, extra = "") => h("span", { class: "mu-icon " + extra, "aria-hidden": "true", text: name });
  const iconBtn = (name, label, onclick, extra = "") => h("button", { type: "button", class: "mu-icon-btn " + extra, "aria-label": label, title: label, onclick }, [icon(name)]);

  /* ------------------------------------------------------------ dates & time */
  const DAY = 86400000;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const isoDate = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const nmAn = (text) => String(text)
    .replace(/\b[Aa]\.?\s?[Mm]\.?(?=$|[\s,)])/g, "NM")
    .replace(/\b[Pp]\.?\s?[Mm]\.?(?=$|[\s,)])/g, "AN");
  const dueOf = (task) => { try { return getTaskDueDate(task); } catch { return null; } };
  const fmtDate = (d, opts) => new Intl.DateTimeFormat(lang(), opts).format(d);
  const fmtTime = (d) => nmAn(d.toLocaleTimeString(lang(), { hour: "numeric", minute: "2-digit" }));
  const fmtDuration = (ms) => {
    const total = Math.max(0, Math.round(ms / 60000));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    if (hours && !minutes) return t("durationHM", { h: hours, m: "\u0000" }).split("\u0000")[0].replace(/[\s·,]+$/, "") || String(hours);
    return hours ? t("durationHM", { h: hours, m: minutes }) : t("durationM", { m: minutes });
  };
  const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const hh = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(hh ? 2 : 1, "0");
    const ss = String(s % 60).padStart(2, "0");
    return (hh ? hh + ":" : "") + mm + ":" + ss;
  };

  // Times show NM and AN instead of AM and PM, in the selected language.
  window.formatTimeValue = function (timeValue) {
    const fallback = getCurrentTranslations().labels.reminderTime;
    if (!timeValue) return fallback;
    const [hour, minute] = timeValue.split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
    return fmtTime(new Date(2000, 0, 1, hour, minute));
  };
  // Reminder time: the v4 time picker lists every minute (the old picker offered 5-minute steps only).
  window.openCustomTimePicker = function (anchor, currentValue, onSelect) {
    if (!UI()?.pickTime) return;
    const trans = getCurrentTranslations();
    UI().pickTime({
      anchor,
      value: currentValue || "09:00",
      locale: lang(),
      minuteStep: 1,
      hour12: new Intl.DateTimeFormat(lang(), { hour: "numeric" }).resolvedOptions().hour12 !== false,
      labels: { hour: t("pickerHour"), minute: t("pickerMinute"), now: t("pickerNow"), done: trans?.buttons?.confirm || t("done"), time: trans?.labels?.reminderTime || t("pickerTime") },
      onPick: (value) => { if (value) onSelect(value); },
    });
  };
  window.hideCustomTimePicker = function () { try { UI()?.closePicker?.(); } catch {} };

  window.formatTaskDue = function (task) {
    const due = dueOf(task);
    if (!due) return "";
    return nmAn(due.toLocaleString(lang(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  };

  /* ------------------------------------------------------------ settings */
  const VIEW_DEFAULTS = { sort: "manual", filterPriority: "all", filterTag: "all" };
  const SHARED_DEFAULTS = { dailyGoal: 3, focusMin: 25, breakMin: 5, weekStart: 0, templates: [], updatedAt: 0 };
  const owner = () => (typeof workspaceAccountId === "undefined" || workspaceAccountId === null ? "guest" : workspaceAccountId) + (window.MunetiosWorkspaceScope?.suffix || "");
  const viewKey = () => "munetios-tasks-view:" + owner();
  const sharedKey = () => "munetios-tasks-extras:" + owner();
  const readJson = (key, fallback) => { try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return { ...fallback }; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  let view = { ...VIEW_DEFAULTS };
  let shared = { ...SHARED_DEFAULTS };
  const loadSettings = () => { view = readJson(viewKey(), VIEW_DEFAULTS); shared = readJson(sharedKey(), SHARED_DEFAULTS); };
  const setView = (patch) => { view = { ...view, ...patch }; writeJson(viewKey(), view); };
  function setShared(patch) {
    shared = { ...shared, ...patch, updatedAt: Math.max(Date.now(), (shared.updatedAt || 0) + 1) };
    writeJson(sharedKey(), shared);
    if (owner() !== "guest") window.MunetiosAccount?.sync.schedule(800);
  }

  // Encrypted sync for settings and templates (tasks already sync through tasks-sync.js).
  const EXTRAS_PREFIX = "munetios-tasks-extras:";
  function registerExtrasSync() {
    const account = window.MunetiosAccount;
    if (!account || owner() === "guest") return;
    const accountId = owner();
    const key = EXTRAS_PREFIX + "settings";
    account.sync.register({
      id: "munetios-tasks-extras", prefix: EXTRAS_PREFIX, preserveLocal: true,
      enabled: () => String(account.state.account?.id) === accountId,
      async snapshot() {
        const data = readJson(sharedKey(), SHARED_DEFAULTS);
        return data.updatedAt ? [{ key, data, updatedAt: data.updatedAt }] : [];
      },
      async apply(items) {
        let changed = false;
        for (const item of items) {
          if (item.key !== key || item.deleted || !item.data || typeof item.data !== "object") continue;
          const incoming = { ...SHARED_DEFAULTS, ...item.data };
          if (!Array.isArray(incoming.templates)) incoming.templates = [];
          incoming.updatedAt = item.updatedAt || incoming.updatedAt || 1;
          writeJson(sharedKey(), incoming);
          shared = incoming;
          changed = true;
        }
        if (changed) queueMicrotask(() => { renderCurrentPage(); syncSettingsForm(); });
        return changed;
      },
    });
  }

  /* ------------------------------------------------------------ task helpers */
  const PRIORITIES = [
    { value: 0, key: "priorityNone", icon: "outlined_flag" },
    { value: 1, key: "priorityLow", icon: "flag" },
    { value: 2, key: "priorityMedium", icon: "flag" },
    { value: 3, key: "priorityHigh", icon: "flag" },
    { value: 4, key: "priorityUrgent", icon: "priority_high" },
  ];
  const REPEATS = ["", "daily", "weekdays", "weekly", "monthly", "yearly"];
  const repeatKey = (r) => ({ "": "repeatNone", daily: "repeatDaily", weekdays: "repeatWeekdays", weekly: "repeatWeekly", monthly: "repeatMonthly", yearly: "repeatYearly" })[r || ""];
  const created = (task) => Date.parse(task.createdAt) || 0;
  const orderOf = (task) => (Number.isFinite(task.order) ? task.order : created(task));
  const isActive = (task) => !task.completed && !task.archived && !task.deleted;
  const tagsOf = (task) => (Array.isArray(task.tags) ? task.tags : []);
  const allTags = () => [...new Set(allTasks.filter((x) => !x.deleted).flatMap(tagsOf))].sort((a, b) => a.localeCompare(b, lang()));
  const categoryName = (id) => allCategories.find((c) => c.id === id)?.name || "";
  const findTask = (id) => allTasks.find((x) => x.id === id);
  const normalizeTag = (value) => String(value || "").trim().replace(/^#+/, "").replace(/\s+/g, "-").slice(0, 60);
  const parseTags = (value) => [...new Set(String(value || "").split(/[,\s]+/).map(normalizeTag).filter(Boolean))];
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value).trim().match(/^[a-z][a-z0-9+.-]*:/i) ? String(value).trim() : "https://" + String(value).trim());
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch { return ""; }
  };
  const progressOf = (task) => {
    const items = [...(task.options || []).map((o) => Boolean(o.checked)), ...(task.subtasks || []).map((s) => Boolean(s.completed))];
    return items.length ? { done: items.filter(Boolean).length, total: items.length } : null;
  };
  const trackedMs = (task) => (task.trackedMs || 0) + (task.timerStartedAt ? Date.now() - Date.parse(task.timerStartedAt) : 0);
  const matchesSearch = (task) => {
    const q = (typeof searchQuery === "string" ? searchQuery : "").trim().toLowerCase();
    if (!q) return true;
    return [task.title, task.description, categoryName(task.categoryId), ...tagsOf(task).map((x) => "#" + x)]
      .some((v) => String(v || "").toLowerCase().includes(q));
  };
  const matchesFilters = (task) =>
    (view.filterPriority === "all" || String(task.priority || 0) === view.filterPriority) &&
    (view.filterTag === "all" || tagsOf(task).includes(view.filterTag));

  const SORTS = {
    manual: (a, b) => orderOf(a) - orderOf(b),
    due: (a, b) => (dueOf(a)?.getTime() ?? Infinity) - (dueOf(b)?.getTime() ?? Infinity) || orderOf(a) - orderOf(b),
    priority: (a, b) => (b.priority || 0) - (a.priority || 0) || SORTS.due(a, b),
    created: (a, b) => created(b) - created(a),
    title: (a, b) => String(a.title).localeCompare(String(b.title), lang(), { sensitivity: "base" }),
  };
  const sortTasks = (list) => [...list].sort((a, b) => (Boolean(b.pinned) - Boolean(a.pinned)) || (SORTS[view.sort] || SORTS.manual)(a, b));

  async function saveMany(changes, undoLabel) {
    const before = [];
    for (const [id, patch] of changes) {
      const index = allTasks.findIndex((x) => x.id === id);
      if (index === -1) continue;
      before.push(structuredClone(allTasks[index]));
      allTasks[index] = { ...allTasks[index], ...patch };
    }
    if (!before.length) return;
    await saveTasks(allTasks);
    if (undoLabel) pushUndo({ type: "restore", tasks: before }, undoLabel);
  }

  /* ------------------------------------------------------------ undo */
  const undoStack = [];
  let undoTimer = null;
  let suppressUndo = 0;
  function pushUndo(entry, label) {
    undoStack.push(entry);
    let bar = $("#tasksUndoBar");
    if (!bar) {
      bar = h("div", { id: "tasksUndoBar", class: "tasks-undo mu-glass", role: "status", "aria-live": "polite" }, [
        h("span", { class: "tasks-undo-text" }),
        h("button", { type: "button", class: "mu-btn mu-btn-primary", onclick: () => undo() }, [icon("undo"), h("span", { "data-tf": "undo", text: t("undo") })]),
        iconBtn("close", t("dismiss"), () => { bar.hidden = true; }, "mu-icon-btn-soft"),
      ]);
      document.body.append(bar);
    }
    bar.querySelector(".tasks-undo-text").textContent = label;
    bar.querySelector("[data-tf='undo']").textContent = t("undo");
    bar.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { bar.hidden = true; }, 7000);
  }
  async function undo() {
    const entry = undoStack.pop();
    const bar = $("#tasksUndoBar");
    if (bar) bar.hidden = true;
    if (!entry) { toast(t("nothingToUndo"), "info"); return; }
    suppressUndo++;
    try {
      if (entry.type === "restore") {
        for (const task of entry.tasks) {
          const index = allTasks.findIndex((x) => x.id === task.id);
          if (index === -1) allTasks.push(task);
          else allTasks[index] = task;
        }
        await saveTasks(allTasks);
      } else if (entry.type === "remove") {
        allTasks = allTasks.filter((x) => !entry.ids.includes(x.id));
        await saveTasks(allTasks);
      }
    } finally { suppressUndo--; }
    renderCurrentPage();
    updateNotificationBadge();
    toast(t("undone"), "info");
  }

  /* ------------------------------------------------------------ data hooks */
  const baseUpdateTask = window.updateTask;
  window.updateTask = async function (taskId, updates) {
    const before = findTask(taskId);
    if (!before || !updates) return baseUpdateTask(taskId, updates);
    const snapshot = structuredClone(before);
    const extra = {};
    const now = new Date().toISOString();
    if ("completed" in updates) {
      if (updates.completed && !before.completed) {
        extra.completedAt = now;
        if (before.timerStartedAt) { extra.trackedMs = trackedMs(before); extra.timerStartedAt = null; }
      } else if (!updates.completed && before.completed) extra.completedAt = null;
    }
    if ("deleted" in updates) extra.deletedAt = updates.deleted ? now : null;
    const result = await baseUpdateTask(taskId, { ...updates, ...extra });
    if (!suppressUndo) {
      const label = updates.completed && !before.completed ? t("undoCompleted")
        : updates.deleted && !before.deleted ? t("undoTrashed")
        : "archived" in updates && updates.archived !== before.archived ? (updates.archived ? t("undoArchived") : t("undoUnarchived"))
        : null;
      if (label) pushUndo({ type: "restore", tasks: [snapshot] }, label);
    }
    if (updates.completed && !before.completed && before.recurrence) await scheduleNext(before);
    return result;
  };

  const baseDeleteTask = window.deleteTask;
  window.deleteTask = async function (taskId) {
    const before = findTask(taskId);
    const result = await baseDeleteTask(taskId);
    if (before && !suppressUndo) pushUndo({ type: "restore", tasks: [structuredClone(before)] }, t("undoDeleted"));
    return result;
  };

  let pendingCreate = null;
  const baseAddTask = window.addTask;
  window.addTask = async function (task) {
    const maxOrder = allTasks.reduce((m, x) => Math.max(m, orderOf(x)), 0);
    const extras = pendingCreate || {};
    pendingCreate = null;
    const next = {
      priority: 0, tags: [], recurrence: "", pinned: false, links: [], estimateMin: 0, trackedMs: 0, timerStartedAt: null,
      ...task, ...extras,
      order: Number.isFinite(task.order) ? task.order : Math.max(maxOrder + 1, Date.now()),
    };
    return baseAddTask(next);
  };

  function nextDue(from, rule) {
    const d = new Date(from);
    if (rule === "daily") d.setDate(d.getDate() + 1);
    else if (rule === "weekdays") { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
    else if (rule === "weekly") d.setDate(d.getDate() + 7);
    else if (rule === "monthly") { const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
    else if (rule === "yearly") d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  async function scheduleNext(task) {
    let due = dueOf(task) || new Date();
    const now = new Date();
    do due = nextDue(due, task.recurrence); while (due < startOfDay(now));
    const copy = {
      ...structuredClone(task),
      id: "task-" + crypto.randomUUID(),
      completed: false, completedAt: null, inProgress: false, archived: false, deleted: false, deletedAt: null,
      reminderNotifiedAt: null, dueDate: due.toISOString(), trackedMs: 0, timerStartedAt: null,
      options: (task.options || []).map((o) => ({ ...o, checked: false })),
      subtasks: (task.subtasks || []).map((s) => ({ ...s, completed: false })),
      createdAt: new Date().toISOString(),
    };
    suppressUndo++;
    try { await window.addTask(copy); } finally { suppressUndo--; }
    toast(t("nextScheduled", { date: fmtDate(due, { weekday: "short", month: "short", day: "numeric" }) }), "info");
  }

  /* ------------------------------------------------------------ quick add (natural language) */
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  function parseQuickAdd(input) {
    let text = " " + input + " ";
    const out = { tags: [], priority: 0, recurrence: "", estimateMin: 0, categoryId: null, date: null, time: "" };
    const take = (re, fn) => { text = text.replace(re, (...m) => { fn(...m); return " "; }); };
    take(/\s#([^\s#]+)/g, (_, tag) => { const v = normalizeTag(tag); if (v) out.tags.push(v); });
    take(/\s!(urgent|high|medium|med|low|[1-4])(?=\s)/gi, (_, p) => {
      const map = { low: 1, "1": 1, medium: 2, med: 2, "2": 2, high: 3, "3": 3, urgent: 4, "4": 4 };
      out.priority = map[p.toLowerCase()];
    });
    take(/\s@([^\s@]+)/g, (whole, name) => {
      const match = allCategories.find((c) => c.name.toLowerCase().replace(/\s+/g, "") === name.toLowerCase());
      if (match) out.categoryId = match.id;
      else text += whole;
    });
    take(/\s~(\d+(?:\.\d+)?)\s*(h|m|min)?(?=\s)/gi, (_, n, unit) => { out.estimateMin = Math.round(Number(n) * (/^h/i.test(unit || "m") ? 60 : 1)); });
    take(/\s(every\s+weekday|weekdays|every\s+day|daily|every\s+week|weekly|every\s+month|monthly|every\s+year|yearly|annually)(?=\s)/gi, (_, r) => {
      r = r.toLowerCase();
      out.recurrence = /weekday/.test(r) ? "weekdays" : /day|daily/.test(r) ? "daily" : /week/.test(r) ? "weekly" : /month/.test(r) ? "monthly" : "yearly";
    });
    take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(nm|an|am|pm|a\.m\.|p\.m\.)(?=\s)/gi, (_, hh, mm, ap) => {
      let hour = Number(hh) % 12;
      if (/^(an|pm|p\.m\.)$/i.test(ap)) hour += 12;
      out.time = String(hour).padStart(2, "0") + ":" + String(Number(mm || 0)).padStart(2, "0");
    });
    if (!out.time) take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/g, (_, hh, mm) => { out.time = String(hh).padStart(2, "0") + ":" + mm; });
    const today = startOfDay(new Date());
    const localToday = t("today").toLowerCase();
    const localTomorrow = t("tomorrow").toLowerCase();
    take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/g, (_, y, m, d) => { out.date = new Date(Number(y), Number(m) - 1, Number(d)); });
    if (!out.date) take(/\s(\d{1,2})\/(\d{1,2})(?=\s)/g, (_, m, d) => {
      let date = new Date(today.getFullYear(), Number(m) - 1, Number(d));
      if (date < today) date = new Date(today.getFullYear() + 1, Number(m) - 1, Number(d));
      out.date = date;
    });
    if (!out.date) take(/\sin\s+(\d+)\s+(day|days|week|weeks)(?=\s)/gi, (_, n, unit) => { out.date = addDays(today, Number(n) * (/week/i.test(unit) ? 7 : 1)); });
    if (!out.date) {
      const escaped = [localToday, localTomorrow].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      take(new RegExp("\\s(today|tonight|" + escaped[0] + ")(?=\\s)", "gi"), () => { out.date = today; });
      if (!out.date) take(new RegExp("\\s(tomorrow|tmr|" + escaped[1] + ")(?=\\s)", "gi"), () => { out.date = addDays(today, 1); });
    }
    if (!out.date) take(/\s(?:next\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)(?=\s)/gi, (_, day) => {
      const index = WEEKDAYS.findIndex((w) => w.startsWith(day.toLowerCase().slice(0, 3)));
      let diff = (index - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      out.date = addDays(today, diff);
    });
    if (out.time && !out.date) out.date = today;
    out.title = text.replace(/\s+/g, " ").trim();
    return out;
  }
  async function quickAdd(value) {
    const parsed = parseQuickAdd(value);
    if (!parsed.title) { toast(t("quickAddEmpty"), "error"); return false; }
    const dueDate = parsed.date ? combineDueDateTime(isoDate(parsed.date) + "T00:00", parsed.time) : null;
    await window.addTask({
      id: "task-" + crypto.randomUUID(), title: parsed.title, description: "", image: null,
      categoryId: parsed.categoryId, dueDate, dueTime: parsed.time, reminderNotifiedAt: null, options: [],
      completed: false, archived: false, deleted: false, createdAt: new Date().toISOString(),
      priority: parsed.priority, tags: parsed.tags, recurrence: parsed.recurrence, estimateMin: parsed.estimateMin,
    });
    renderCurrentPage();
    updateNotificationBadge();
    toast(t("taskAdded"));
    return true;
  }

  /* ------------------------------------------------------------ fields shared by create + edit */
  function fieldSelect(id, labelKey, options, value) {
    const select = h("select", { id, class: "mu-select" }, options.map(([v, key]) => h("option", { value: v, text: t(key), "data-tf": key })));
    select.value = String(value);
    return h("div", { class: "mu-field" }, [h("label", { class: "mu-field-label", for: id, "data-tf": labelKey, text: t(labelKey) }), select]);
  }
  function fieldInput(id, labelKey, attrs = {}, placeholderKey) {
    return h("label", { class: "mu-field" }, [
      h("span", { class: "mu-field-label", "data-tf": labelKey, text: t(labelKey) }),
      h("input", { id, class: "mu-input", ...attrs, placeholder: placeholderKey ? t(placeholderKey) : undefined, "data-tf-placeholder": placeholderKey }),
    ]);
  }
  const priorityOptions = () => PRIORITIES.map((p) => [String(p.value), p.key]);
  const repeatOptions = () => REPEATS.map((r) => [r, repeatKey(r)]);
  function extrasFields(prefix) {
    return h("div", { class: "tasks-extras-grid" }, [
      fieldSelect(prefix + "Priority", "priority", priorityOptions(), 0),
      fieldSelect(prefix + "Repeat", "repeat", repeatOptions(), ""),
      fieldInput(prefix + "Tags", "tags", { type: "text", autocomplete: "off" }, "tagsPlaceholder"),
      fieldInput(prefix + "Estimate", "estimate", { type: "number", min: "0", step: "5", inputmode: "numeric" }, "estimatePlaceholder"),
    ]);
  }
  function setSelect(id, value) {
    const select = document.getElementById(id);
    if (!select) return;
    select.value = String(value);
    UI()?.refreshSelect?.(select);
  }
  const readExtras = (prefix) => ({
    priority: Number($("#" + prefix + "Priority")?.value || 0),
    recurrence: $("#" + prefix + "Repeat")?.value || "",
    tags: parseTags($("#" + prefix + "Tags")?.value),
    estimateMin: Math.max(0, Math.round(Number($("#" + prefix + "Estimate")?.value || 0))),
  });

  function mountCreateExtras() {
    const inputs = $(".create-task-inputs");
    if (!inputs || $("#tfCreatePriority")) return;
    const extras = extrasFields("tfCreate");
    inputs.insertBefore(extras, $(".task-schedule-row", inputs));
    $("#createTaskBtn")?.addEventListener("click", () => { pendingCreate = readExtras("tfCreate"); }, true);
    $("#createTaskBtn")?.addEventListener("click", () => {
      setTimeout(() => {
        if (pendingCreate) return; // task was not created (for example, no title)
        setSelect("tfCreatePriority", 0);
        setSelect("tfCreateRepeat", "");
        $("#tfCreateTags").value = "";
        $("#tfCreateEstimate").value = "";
      }, 0);
    });
  }

  function mountQuickAdd() {
    const page = $("#tasksPage");
    if (!page || $("#tfQuickAdd")) return;
    const input = h("input", { id: "tfQuickAdd", type: "text", autocomplete: "off", "data-tf-placeholder": "quickAddPlaceholder", placeholder: t("quickAddPlaceholder"), "aria-describedby": "tfQuickAddHelp" });
    const form = h("form", { class: "tasks-quick-add", onsubmit: async (e) => { e.preventDefault(); if (await quickAdd(input.value)) input.value = ""; } }, [
      h("label", { class: "mu-search tasks-quick-add-field" }, [icon("bolt"), h("span", { class: "tasks-visually-hidden", "data-tf": "quickAdd", text: t("quickAdd") }), input]),
      h("button", { type: "submit", class: "mu-btn mu-btn-primary" }, [icon("add"), h("span", { "data-tf": "add", text: t("add") })]),
    ]);
    const help = h("p", { id: "tfQuickAddHelp", class: "tasks-help mu-muted", "data-tf": "quickAddHelp", text: t("quickAddHelp") });
    page.querySelector("h1").after(form, help);
  }

  /* ------------------------------------------------------------ edit modal extras */
  let editTarget = null;
  function mountEditExtras() {
    const modal = $("#editModal");
    const body = modal?.querySelector(".edit-modal-body");
    if (!body || $("#tfEditPriority")) return;
    const links = h("div", { class: "tasks-links-editor" }, [
      h("div", { class: "mu-field-label", "data-tf": "links", text: t("links") }),
      h("div", { id: "tfEditLinks", class: "tasks-links-list" }),
      h("button", { type: "button", class: "mu-btn", onclick: () => addLinkRow("") }, [icon("add_link"), h("span", { "data-tf": "addLink", text: t("addLink") })]),
    ]);
    const optionsBlock = $("#editOptionsContainer")?.parentElement;
    body.insertBefore(extrasFields("tfEdit"), optionsBlock || null);
    body.insertBefore(links, optionsBlock || null);
    new MutationObserver(() => {
      if (!modal.classList.contains("show")) return;
      const id = currentTaskId;
      if (!id || id === editTarget && modal.dataset.tfOpen === "1") return;
      editTarget = id;
      modal.dataset.tfOpen = "1";
      fillEditExtras(findTask(id));
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(() => { if (!modal.classList.contains("show")) { modal.dataset.tfOpen = "0"; } }).observe(modal, { attributes: true, attributeFilter: ["class"] });
    $("#editModalSave")?.addEventListener("click", () => {
      const id = editTarget;
      if (!id || !findTask(id)) return;
      const links = $$("#tfEditLinks input").map((input) => safeUrl(input.value)).filter(Boolean).map((url) => ({ url }));
      const patch = { ...readExtras("tfEdit"), links };
      const index = allTasks.findIndex((x) => x.id === id);
      if (index !== -1) allTasks[index] = { ...allTasks[index], ...patch };
    }, true);
  }
  function addLinkRow(value) {
    const list = $("#tfEditLinks");
    const row = h("div", { class: "tasks-link-row" }, [
      h("input", { type: "url", class: "mu-input", value, placeholder: "https://", "aria-label": t("linkAddress"), inputmode: "url" }),
      iconBtn("close", t("removeLink"), () => row.remove(), "mu-icon-btn-soft"),
    ]);
    list.append(row);
    if (!value) row.querySelector("input").focus();
  }
  function fillEditExtras(task) {
    if (!task) return;
    setSelect("tfEditPriority", task.priority || 0);
    setSelect("tfEditRepeat", task.recurrence || "");
    $("#tfEditTags").value = tagsOf(task).join(", ");
    $("#tfEditEstimate").value = task.estimateMin || "";
    $("#tfEditLinks").replaceChildren();
    (task.links || []).forEach((link) => addLinkRow(link.url));
  }
  function openEdit(taskId) {
    currentTaskId = taskId;
    editTarget = null;
    const item = $('#taskMoreDropdown [data-action="edit"]');
    item?.click();
  }

  /* ------------------------------------------------------------ task card decoration */
  let selectMode = false;
  const selected = new Set();
  const LIST_PAGES = {
    tasksPage: "tasksListContainer", completedPage: "completedList", favoritesPage: "favoritesList",
    inProgressPage: "inProgressList", archivedPage: "archivedList", trashPage: "trashList",
    todayPage: "todayList", upcomingPage: "upcomingList", overduePage: "overdueList",
  };
  const activePageId = () => $(".content.page.active")?.id || "tasksPage";

  const baseRenderTask = window.renderTask;
  window.renderTask = function (task) {
    const node = baseRenderTask(task);
    try { decorate(node, task); } catch (error) { console.error("[Tasks features]", error); }
    return node;
  };

  function decorate(node, task) {
    node.dataset.priority = String(task.priority || 0);
    node.classList.toggle("is-pinned", Boolean(task.pinned));
    node.classList.toggle("is-done", Boolean(task.completed));
    node.classList.toggle("is-selected", selected.has(task.id));
    const header = node.querySelector(".task-item-header");
    const title = node.querySelector(".task-item-title");
    const actions = node.querySelector(".task-item-actions");
    const lead = h("div", { class: "tasks-card-lead" });
    if (selectMode) {
      const box = h("input", { type: "checkbox", class: "tasks-select-box", "aria-label": t("selectTask", { title: task.title }) });
      box.checked = selected.has(task.id);
      box.addEventListener("change", () => { box.checked ? selected.add(task.id) : selected.delete(task.id); node.classList.toggle("is-selected", box.checked); updateBulkBar(); });
      lead.append(box);
    } else if (view.sort === "manual" && LIST_PAGES[activePageId()] && !task.deleted) {
      node.draggable = true;
      lead.append(h("span", { class: "mu-icon tasks-drag-handle", "aria-hidden": "true", title: t("dragToReorder"), text: "drag_indicator" }));
    }
    if (!task.deleted) {
      const label = task.completed ? t("markIncomplete") : t("markComplete");
      lead.append(h("button", {
        type: "button", class: "tasks-check" + (task.completed ? " is-checked" : ""), "aria-label": label, title: label, "aria-pressed": String(Boolean(task.completed)),
        onclick: async (e) => {
          e.stopPropagation();
          await updateTask(task.id, task.completed ? { completed: false } : { completed: true, inProgress: false });
          renderCurrentPage();
          updateNotificationBadge();
          if (!task.completed) toast(t("undoCompleted"));
        },
      }, [icon(task.completed ? "check_circle" : "radio_button_unchecked", task.completed ? "mu-icon-filled" : "")]));
    }
    header.prepend(lead);
    if (task.pinned) title.prepend(h("span", { class: "mu-icon mu-icon-filled tasks-pin-mark", "aria-label": t("pinned"), role: "img", text: "push_pin" }));

    if (actions && !task.deleted && !task.completed) {
      const more = actions.lastElementChild;
      const running = Boolean(task.timerStartedAt);
      const timerLabel = running ? t("stopTimer") : t("startTimer");
      actions.insertBefore(h("div", {
        class: "task-action-btn icon-only tasks-timer-btn" + (running ? " is-running" : ""), role: "button", tabindex: "0", "aria-label": timerLabel, title: timerLabel,
        onclick: (e) => { e.stopPropagation(); toggleTimer(task.id); },
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTimer(task.id); } },
      }, [h("icon", { text: running ? "pause_circle" : "timer" })]), more);
      actions.insertBefore(h("div", {
        class: "task-action-btn icon-only", role: "button", tabindex: "0", "aria-label": t("focus"), title: t("focus"),
        onclick: (e) => { e.stopPropagation(); openFocus(task.id); },
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFocus(task.id); } },
      }, [h("icon", { text: "center_focus_strong" })]), more);
    }
    // Existing action buttons become keyboard reachable.
    actions?.querySelectorAll(".task-action-btn:not([tabindex])").forEach((btn) => {
      btn.tabIndex = 0;
      btn.setAttribute("role", "button");
      btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); btn.click(); } });
    });

    const progress = progressOf(task);
    if (progress) {
      const pct = Math.round((progress.done / progress.total) * 100);
      const wrap = h("div", { class: "tasks-progress" }, [
        h("div", { class: "mu-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": t("progress") }, [h("span", { style: "width:" + pct + "%" })]),
        h("span", { class: "mu-muted", text: t("progressCount", { done: progress.done, total: progress.total }) }),
      ]);
      header.after(wrap);
    }
    const links = (task.links || []).map((l) => safeUrl(l.url)).filter(Boolean);
    if (links.length) {
      const list = h("div", { class: "tasks-links" }, links.map((url) => {
        let label = url;
        try { const u = new URL(url); label = u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : ""); } catch {}
        return h("a", { class: "mu-chip tasks-link", href: url, target: "_blank", rel: "noopener noreferrer" }, [icon("link"), h("span", { text: label })]);
      }));
      (node.querySelector(".task-footer") || node).before(list);
    }
    const footerLeft = node.querySelector(".task-footer > div");
    if (footerLeft) {
      const p = PRIORITIES[task.priority || 0];
      if (p && p.value) footerLeft.append(h("span", { class: "tasks-badge tasks-priority p" + p.value }, [icon(p.icon, "mu-icon-filled"), h("span", { text: t(p.key) })]));
      if (task.recurrence) footerLeft.append(h("span", { class: "tasks-badge" }, [icon("repeat"), h("span", { text: t(repeatKey(task.recurrence)) })]));
      tagsOf(task).forEach((tag) => footerLeft.append(h("button", {
        type: "button", class: "tasks-badge tasks-tag", title: t("filterByTag"),
        onclick: (e) => { e.stopPropagation(); setView({ filterTag: tag }); renderCurrentPage(); },
      }, [h("span", { text: "#" + tag })])));
      const tracked = trackedMs(task);
      if (task.estimateMin || tracked >= 60000 || task.timerStartedAt) {
        footerLeft.append(h("span", { class: "tasks-badge" + (task.timerStartedAt ? " is-running" : ""), "data-timer-for": task.id }, [
          icon("schedule"),
          h("span", { class: "tasks-timer-text", text: timerText(task) }),
        ]));
      }
    }
  }
  const timerText = (task) => {
    const tracked = trackedMs(task);
    const spent = task.timerStartedAt ? clock(tracked) : fmtDuration(tracked);
    return task.estimateMin ? t("trackedOfEstimate", { tracked: spent, estimate: fmtDuration(task.estimateMin * 60000) }) : spent;
  };

  async function toggleTimer(taskId) {
    const task = findTask(taskId);
    if (!task) return;
    const now = new Date().toISOString();
    const changes = [];
    if (task.timerStartedAt) changes.push([taskId, { trackedMs: trackedMs(task), timerStartedAt: null }]);
    else {
      allTasks.filter((x) => x.timerStartedAt && x.id !== taskId).forEach((x) => changes.push([x.id, { trackedMs: trackedMs(x), timerStartedAt: null }]));
      changes.push([taskId, { timerStartedAt: now, inProgress: true }]);
    }
    await saveMany(changes);
    renderCurrentPage();
    toast(task.timerStartedAt ? t("timerStopped") : t("timerStarted"), "info");
  }
  setInterval(() => {
    $$("[data-timer-for]").forEach((badge) => {
      const task = findTask(badge.dataset.timerFor);
      if (task?.timerStartedAt) badge.querySelector(".tasks-timer-text").textContent = timerText(task);
    });
  }, 1000);

  /* ------------------------------------------------------------ drag and drop ordering */
  let dragId = null;
  document.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.(".task-item[draggable='true']");
    if (!card) return;
    dragId = card.dataset.taskId;
    card.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", dragId); } catch {}
  });
  document.addEventListener("dragend", (e) => { e.target.closest?.(".task-item")?.classList.remove("is-dragging"); dragId = null; });
  document.addEventListener("dragover", (e) => {
    if (!dragId) return;
    const container = e.target.closest?.(".tasks-list-container, .completed-tasks-list, .favorites-tasks-list, .in-progress-tasks-list, .archived-tasks-list, .tasks-view-list");
    if (!container) return;
    e.preventDefault();
    const dragging = container.querySelector(`.task-item[data-task-id="${CSS.escape(dragId)}"]`);
    if (!dragging) return;
    const after = [...container.querySelectorAll(".task-item:not(.is-dragging)")].find((card) => {
      const box = card.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    if (after) container.insertBefore(dragging, after); else container.append(dragging);
  });
  document.addEventListener("drop", async (e) => {
    if (!dragId) return;
    const container = e.target.closest?.(".tasks-list-container, .completed-tasks-list, .favorites-tasks-list, .in-progress-tasks-list, .archived-tasks-list, .tasks-view-list");
    if (!container) return;
    e.preventDefault();
    const ids = [...container.querySelectorAll(".task-item")].map((card) => card.dataset.taskId);
    const orders = ids.map((id) => orderOf(findTask(id) || {})).sort((a, b) => a - b);
    for (let i = 1; i < orders.length; i++) if (orders[i] <= orders[i - 1]) orders[i] = orders[i - 1] + 1;
    await saveMany(ids.map((id, i) => [id, { order: orders[i] }]));
    renderCurrentPage();
  });

  /* ------------------------------------------------------------ toolbar: sort, filter, select */
  function buildToolbar() {
    if ($("#tasksToolbar")) return $("#tasksToolbar");
    const sort = h("select", { id: "tfSort", class: "mu-select", "aria-label": t("sortBy") }, [
      ["manual", "sortManual"], ["due", "sortDue"], ["priority", "sortPriority"], ["created", "sortCreated"], ["title", "sortTitle"],
    ].map(([v, key]) => h("option", { value: v, "data-tf": key, text: t(key) })));
    const priority = h("select", { id: "tfFilterPriority", class: "mu-select", "aria-label": t("filterPriority") }, [
      h("option", { value: "all", "data-tf": "allPriorities", text: t("allPriorities") }),
      ...PRIORITIES.map((p) => h("option", { value: String(p.value), "data-tf": p.key, text: t(p.key) })),
    ]);
    const tag = h("select", { id: "tfFilterTag", class: "mu-select", "aria-label": t("filterTag") });
    const bar = h("div", { id: "tasksToolbar", class: "tasks-toolbar", role: "toolbar", "aria-label": t("listOptions") }, [
      h("div", { class: "tasks-toolbar-field" }, [icon("sort"), sort]),
      h("div", { class: "tasks-toolbar-field" }, [icon("flag"), priority]),
      h("div", { class: "tasks-toolbar-field" }, [icon("sell"), tag]),
      h("button", { type: "button", id: "tfSelectMode", class: "mu-btn", "aria-pressed": "false", onclick: () => toggleSelectMode() }, [icon("checklist"), h("span", { "data-tf": "select", text: t("select") })]),
      h("button", { type: "button", id: "tfClearFilters", class: "mu-btn mu-btn-ghost", hidden: true, onclick: () => { setView({ filterPriority: "all", filterTag: "all" }); renderCurrentPage(); } }, [icon("filter_alt_off"), h("span", { "data-tf": "clearFilters", text: t("clearFilters") })]),
    ]);
    sort.addEventListener("change", () => { setView({ sort: sort.value }); renderCurrentPage(); });
    priority.addEventListener("change", () => { setView({ filterPriority: priority.value }); renderCurrentPage(); });
    tag.addEventListener("change", () => { setView({ filterTag: tag.value }); renderCurrentPage(); });
    return bar;
  }
  function syncToolbar() {
    const bar = buildToolbar();
    const pageId = activePageId();
    const listId = LIST_PAGES[pageId];
    const list = listId && document.getElementById(listId);
    if (!list) { bar.hidden = true; return; }
    bar.hidden = false;
    if (list.previousElementSibling !== bar) list.before(bar);
    const tag = $("#tfFilterTag");
    const tags = allTags();
    if (view.filterTag !== "all" && !tags.includes(view.filterTag)) tags.push(view.filterTag);
    const signature = lang() + "|" + tags.join("|");
    if (tag.dataset.signature !== signature) {
      tag.replaceChildren(h("option", { value: "all", text: t("allTags") }), ...tags.map((x) => h("option", { value: x, text: "#" + x })));
      tag.dataset.signature = signature;
    }
    for (const [id, value] of [["tfSort", view.sort], ["tfFilterPriority", view.filterPriority], ["tfFilterTag", view.filterTag]]) {
      const select = document.getElementById(id);
      if (select.value !== value) select.value = value;
      UI()?.refreshSelect?.(select);
    }
    $("#tfClearFilters").hidden = view.filterPriority === "all" && view.filterTag === "all";
    $("#tfSelectMode").setAttribute("aria-pressed", String(selectMode));
  }

  /* ------------------------------------------------------------ bulk actions */
  function toggleSelectMode(force) {
    selectMode = typeof force === "boolean" ? force : !selectMode;
    if (!selectMode) selected.clear();
    renderCurrentPage();
  }
  function updateBulkBar() {
    let bar = $("#tasksBulkBar");
    if (!bar) {
      const act = (name, key, fn, danger) => h("button", { type: "button", class: "mu-icon-btn", "aria-label": t(key), title: t(key), "data-tf-label": key, onclick: fn, "data-mu-danger": danger ? "" : undefined }, [icon(name)]);
      bar = h("div", { id: "tasksBulkBar", class: "mu-action-bar tasks-bulk-bar", role: "toolbar", "aria-label": t("selectedTasks"), hidden: true }, [
        h("span", { class: "mu-action-bar-count" }),
        act("select_all", "selectAll", () => { visibleTaskIds().forEach((id) => selected.add(id)); renderCurrentPage(); }),
        act("check_circle", "markComplete", () => bulk({ completed: true, inProgress: false }, t("undoCompleted"))),
        act("push_pin", "pin", () => bulk({ pinned: true }, t("undoChanged"))),
        act("flag", "priority", () => bulkPriority()),
        act("category", "moveToCategory", () => bulkCategory()),
        act("archive", "archive", () => bulk({ archived: true }, t("undoArchived"))),
        act("delete", "moveToTrash", () => bulk({ deleted: true, deletedAt: new Date().toISOString() }, t("undoTrashed")), true),
        h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("done"), title: t("done"), onclick: () => toggleSelectMode(false) }, [icon("close")]),
      ]);
      document.body.append(bar);
    }
    bar.hidden = !selectMode;
    bar.querySelector(".mu-action-bar-count").textContent = t("selectedCount", { count: selected.size });
    bar.querySelectorAll("[data-tf-label]").forEach((b) => { b.setAttribute("aria-label", t(b.dataset.tfLabel)); b.title = t(b.dataset.tfLabel); });
  }
  const visibleTaskIds = () => $$(".content.page.active .task-item[data-task-id]").map((n) => n.dataset.taskId);
  async function bulk(patch, label) {
    if (!selected.size) { toast(t("selectFirst"), "info"); return; }
    const count = selected.size;
    const now = new Date().toISOString();
    await saveMany([...selected].map((id) => {
      const task = findTask(id);
      const extra = patch.completed && task && !task.completed ? { completedAt: now } : {};
      return [id, { ...patch, ...extra }];
    }), label);
    const recurring = patch.completed ? [...selected].map(findTask).filter((x) => x?.recurrence) : [];
    selected.clear();
    for (const task of recurring) await scheduleNext(task);
    renderCurrentPage();
    updateNotificationBadge();
    toast(t("updatedCount", { count }));
  }
  function bulkPriority() {
    if (!selected.size) { toast(t("selectFirst"), "info"); return; }
    UI().pickFromList({
      title: t("priority"), icon: "flag", searchLabel: t("search"), closeLabel: t("close"),
      items: PRIORITIES.map((p) => ({ value: String(p.value), label: t(p.key) })),
      onPick: (value) => bulk({ priority: Number(value) }, t("undoChanged")),
    });
  }
  function bulkCategory() {
    if (!selected.size) { toast(t("selectFirst"), "info"); return; }
    UI().pickFromList({
      title: t("moveToCategory"), icon: "category", searchLabel: t("search"), closeLabel: t("close"),
      items: [{ value: "", label: t("noCategory") }, ...allCategories.map((c) => ({ value: c.id, label: c.name }))],
      onPick: (value) => bulk({ categoryId: value || null }, t("undoChanged")),
    });
  }

  /* ------------------------------------------------------------ more menu: pin, duplicate, template, snooze */
  function mountMoreItems() {
    const menu = $("#taskMoreDropdown");
    if (!menu || menu.querySelector("[data-action='tf-pin']")) return;
    const item = (action, iconName, key) => h("div", { class: "more-dropdown-item", "data-action": action, role: "menuitem", tabindex: "0" }, [h("icon", { text: iconName }), h("span", { "data-tf": key, text: t(key) })]);
    const edit = menu.querySelector("[data-action='edit']");
    edit.after(item("tf-pin", "push_pin", "pin"), item("tf-duplicate", "content_copy", "duplicate"), item("tf-template", "library_add", "saveAsTemplate"), item("tf-snooze", "snooze", "snooze"), item("tf-progress", "hourglass_top", "markInProgress"));
    menu.setAttribute("role", "menu");
    $$(".more-dropdown-item", menu).forEach((n) => { n.setAttribute("role", "menuitem"); n.tabIndex = 0; });
    menu.addEventListener("keydown", (e) => {
      const items = $$(".more-dropdown-item", menu).filter((n) => n.style.display !== "none");
      const index = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.activeElement?.click(); }
    });
    document.addEventListener("click", async (e) => {
      const target = e.target.closest?.("#taskMoreDropdown .more-dropdown-item[data-action^='tf-']");
      if (!target) return;
      e.stopPropagation();
      const id = currentTaskId;
      hideMoreDropdown();
      const task = findTask(id);
      if (!task) return;
      const action = target.dataset.action;
      if (action === "tf-pin") {
        await saveMany([[id, { pinned: !task.pinned }]]);
        toast(task.pinned ? t("unpinned") : t("pinnedToast"));
      } else if (action === "tf-progress") {
        await updateTask(id, { inProgress: !task.inProgress });
        toast(task.inProgress ? t("removedFromInProgress") : t("markedInProgress"));
      } else if (action === "tf-duplicate") {
        const copy = { ...structuredClone(task), id: "task-" + crypto.randomUUID(), title: t("copyOf", { title: task.title }), completed: false, completedAt: null, deleted: false, deletedAt: null, archived: false, reminderNotifiedAt: null, trackedMs: 0, timerStartedAt: null, createdAt: new Date().toISOString(), order: orderOf(task) + 0.5 };
        await baseAddTask(copy);
        pushUndo({ type: "remove", ids: [copy.id] }, t("undoDuplicated"));
      } else if (action === "tf-template") {
        const name = await promptText({ title: t("saveAsTemplate"), label: t("templateName"), value: task.title, icon: "library_add" });
        if (!name) return;
        const template = {
          id: "template-" + crypto.randomUUID(), name, title: task.title, description: task.description || "",
          categoryId: task.categoryId || null, priority: task.priority || 0, tags: tagsOf(task), recurrence: task.recurrence || "",
          estimateMin: task.estimateMin || 0, links: task.links || [], dueTime: task.dueTime || "",
          options: (task.options || []).map((o) => ({ text: o.text || String(o), checked: false })),
          subtasks: (task.subtasks || []).map((s) => ({ text: s.text, completed: false })),
        };
        setShared({ templates: [...shared.templates, template] });
        toast(t("templateSaved"));
      } else if (action === "tf-snooze") {
        snooze(id);
        return;
      }
      renderCurrentPage();
      updateNotificationBadge();
    }, true);
    const baseShow = window.showMoreDropdown;
    window.showMoreDropdown = function (btn, taskId) {
      baseShow(btn, taskId);
      const task = findTask(taskId);
      if (!task) return;
      const trash = Boolean(task.deleted);
      menu.querySelectorAll("[data-action^='tf-']").forEach((n) => { n.style.display = trash ? "none" : ""; });
      const pin = menu.querySelector("[data-action='tf-pin'] span");
      pin.textContent = task.pinned ? t("unpin") : t("pin");
      const progress = menu.querySelector("[data-action='tf-progress'] span");
      progress.textContent = task.inProgress ? t("removeFromInProgress") : t("markInProgress");
      menu.querySelector("[data-action='tf-progress']").style.display = trash || task.completed ? "none" : "";
      menu.querySelector("[data-action='tf-snooze']").style.display = trash || task.completed ? "none" : "";
      requestAnimationFrame(() => menu.querySelector(".more-dropdown-item")?.focus({ preventScroll: true }));
    };
  }

  function snooze(taskId) {
    const task = findTask(taskId);
    if (!task) return;
    const base = new Date();
    const at = (days, hour) => { const d = startOfDay(addDays(base, days)); d.setHours(hour, 0, 0, 0); return d; };
    const nextMonday = (() => { const d = startOfDay(base); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; })();
    const options = [
      ["15", new Date(base.getTime() + 15 * 60000), "in15Minutes"],
      ["60", new Date(base.getTime() + 60 * 60000), "in1Hour"],
      ["3h", new Date(base.getTime() + 3 * 3600000), "in3Hours"],
      ["tonight", at(0, 19), "tonight"],
      ["tomorrow", at(1, 9), "tomorrowMorning"],
      ["week", nextMonday, "nextWeek"],
    ].filter(([, date]) => date > base);
    UI().pickFromList({
      title: t("snooze"), icon: "snooze", searchLabel: t("search"), closeLabel: t("close"),
      items: options.map(([value, date, key]) => ({ value, label: t(key), trailing: fmtDate(date, { weekday: "short" }) + " " + fmtTime(date) })),
      onPick: async (value) => {
        const date = options.find(([v]) => v === value)?.[1];
        if (!date) return;
        const time = String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
        await saveMany([[taskId, { dueDate: date.toISOString(), dueTime: time, reminderNotifiedAt: null }]], t("undoChanged"));
        renderCurrentPage();
        updateNotificationBadge();
        toast(t("snoozedUntil", { date: fmtDate(date, { weekday: "short", month: "short", day: "numeric" }) + " " + fmtTime(date) }));
      },
    });
  }

  /* ------------------------------------------------------------ small dialogs (v4 modal) */
  let dialogCount = 0;
  function promptText({ title, label, value = "", icon: iconName = "edit" }) {
    return new Promise((resolve) => {
      const id = "tfPrompt" + ++dialogCount;
      const input = h("input", { class: "mu-input", type: "text", value });
      const modal = h("div", { class: "mu-modal", id, hidden: true }, [
        h("form", { class: "mu-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": id + "Title" }, [
          h("div", { class: "mu-dialog-header" }, [
            h("div", { class: "mu-dialog-heading" }, [h("span", { class: "mu-icon-circle" }, [icon(iconName)]), h("h2", { id: id + "Title", text: title })]),
            h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), "data-close": "" }, [icon("close")]),
          ]),
          h("label", { class: "mu-field" }, [h("span", { class: "mu-field-label", text: label }), input]),
          h("div", { class: "mu-dialog-actions" }, [
            h("button", { type: "button", class: "mu-btn", "data-close": "", text: t("cancel") }),
            h("button", { type: "submit", class: "mu-btn mu-btn-primary", text: t("save") }),
          ]),
        ]),
      ]);
      document.body.append(modal);
      const finish = (result) => { UI().closeModal(modal); modal.remove(); resolve(result); };
      modal.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); finish(input.value.trim() || null); });
      modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => finish(null)));
      modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); finish(null); } });
      UI().openModal(id);
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }

  /* ------------------------------------------------------------ smart lists */
  function emptyState(container, iconName, message) {
    container.replaceChildren(h("div", { class: "mu-empty tasks-empty" }, [h("span", { class: "mu-icon-circle" }, [icon(iconName)]), h("span", { text: message })]));
  }
  function renderSection(container, heading, tasks) {
    if (!tasks.length) return;
    if (heading) container.append(h("h2", { class: "tasks-section-heading" }, [h("span", { text: heading }), h("span", { class: "mu-badge", text: String(tasks.length) })]));
    sortTasks(tasks).forEach((task) => container.append(window.renderTask(task)));
  }
  const smartBase = () => allTasks.filter((x) => isActive(x) && matchesSearch(x) && matchesFilters(x));
  function renderToday() {
    const container = $("#todayList");
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const base = smartBase();
    const overdue = base.filter((x) => { const d = dueOf(x); return d && d < today; });
    const due = base.filter((x) => { const d = dueOf(x); return d && d >= today && d < tomorrow; });
    container.replaceChildren(goalCard());
    if (!overdue.length && !due.length) { const empty = h("div"); emptyState(empty, "wb_sunny", t("nothingToday")); container.append(empty.firstChild); return; }
    renderSection(container, t("overdue"), overdue);
    renderSection(container, fmtDate(today, { weekday: "long", month: "long", day: "numeric" }), due);
  }
  function renderUpcoming() {
    const container = $("#upcomingList");
    container.replaceChildren();
    const today = startOfDay(new Date());
    const base = smartBase();
    let any = false;
    for (let i = 1; i <= 7; i++) {
      const day = addDays(today, i);
      const tasks = base.filter((x) => sameDay(dueOf(x), day));
      if (!tasks.length) continue;
      any = true;
      renderSection(container, i === 1 ? t("tomorrow") : fmtDate(day, { weekday: "long", month: "short", day: "numeric" }), tasks);
    }
    const later = base.filter((x) => { const d = dueOf(x); return d && d >= addDays(today, 8); });
    if (later.length) { any = true; renderSection(container, t("later"), later); }
    if (!any) emptyState(container, "event_available", t("nothingUpcoming"));
  }
  function renderOverdue() {
    const container = $("#overdueList");
    container.replaceChildren();
    const now = new Date();
    const tasks = smartBase().filter((x) => { const d = dueOf(x); return d && d < now; });
    if (!tasks.length) emptyState(container, "task_alt", t("nothingOverdue"));
    else renderSection(container, "", tasks);
  }

  /* ------------------------------------------------------------ daily goal + streak */
  const completedOn = (day) => allTasks.filter((x) => x.completed && x.completedAt && !x.deleted && sameDay(new Date(x.completedAt), day)).length;
  function streaks() {
    const days = new Set(allTasks.filter((x) => x.completed && x.completedAt && !x.deleted).map((x) => isoDate(new Date(x.completedAt))));
    let current = 0;
    let cursor = startOfDay(new Date());
    if (!days.has(isoDate(cursor))) cursor = addDays(cursor, -1);
    while (days.has(isoDate(cursor))) { current++; cursor = addDays(cursor, -1); }
    let best = 0;
    let run = 0;
    let prev = null;
    [...days].sort().forEach((iso) => {
      const d = new Date(iso + "T00:00");
      run = prev && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    });
    return { current, best };
  }
  function goalCard() {
    const goal = Math.max(1, Number(shared.dailyGoal) || 1);
    const done = completedOn(new Date());
    const pct = Math.min(100, Math.round((done / goal) * 100));
    const { current } = streaks();
    return h("section", { class: "tasks-goal mu-glass" }, [
      h("div", { class: "mu-ring", style: "--mu-value:" + pct, role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": t("dailyGoal") }, [h("span", { text: pct + "%" })]),
      h("div", { class: "tasks-goal-text" }, [
        h("span", { class: "mu-h-title", text: t("goalProgress", { done, goal }) }),
        h("span", { class: "mu-muted", text: done >= goal ? t("goalReached") : t("goalRemaining", { count: goal - done }) }),
      ]),
      h("span", { class: "mu-badge tasks-streak" }, [icon("local_fire_department", "mu-icon-filled"), h("span", { text: t("streakDays", { count: current }) })]),
    ]);
  }

  /* ------------------------------------------------------------ board */
  const COLUMNS = [
    { id: "todo", key: "toDo", icon: "radio_button_unchecked", filter: (x) => isActive(x) && !x.inProgress, patch: { inProgress: false, completed: false } },
    { id: "doing", key: "inProgress", icon: "hourglass_top", filter: (x) => isActive(x) && x.inProgress, patch: { inProgress: true, completed: false } },
    { id: "done", key: "completed", icon: "check_circle", filter: (x) => x.completed && !x.deleted && !x.archived, patch: { completed: true, inProgress: false } },
  ];
  async function moveToColumn(taskId, columnId) {
    const column = COLUMNS.find((c) => c.id === columnId);
    const task = findTask(taskId);
    if (!column || !task || column.filter(task)) return;
    await updateTask(taskId, column.patch);
    renderCurrentPage();
    updateNotificationBadge();
  }
  function renderBoard() {
    const board = $("#boardView");
    board.replaceChildren();
    COLUMNS.forEach((column, index) => {
      const tasks = sortTasks(allTasks.filter((x) => column.filter(x) && matchesSearch(x) && matchesFilters(x)));
      const list = h("div", { class: "tasks-board-list", "data-column": column.id });
      const col = h("section", { class: "tasks-board-column mu-glass", "aria-label": t(column.key) }, [
        h("header", { class: "tasks-board-head" }, [icon(column.icon), h("h2", { class: "mu-h-title", text: t(column.key) }), h("span", { class: "mu-badge", text: String(tasks.length) })]),
        list,
      ]);
      list.addEventListener("dragover", (e) => { if (dragBoard) { e.preventDefault(); list.classList.add("is-over"); } });
      list.addEventListener("dragleave", () => list.classList.remove("is-over"));
      list.addEventListener("drop", (e) => { e.preventDefault(); list.classList.remove("is-over"); if (dragBoard) moveToColumn(dragBoard, column.id); });
      if (!tasks.length) list.append(h("div", { class: "tasks-board-empty mu-muted", text: t("dropHere") }));
      tasks.forEach((task) => {
        const due = dueOf(task);
        const p = PRIORITIES[task.priority || 0];
        const card = h("article", { class: "tasks-board-card", draggable: "true", "data-priority": String(task.priority || 0), tabindex: "0", "aria-label": task.title }, [
          h("div", { class: "tasks-board-title", text: task.title }),
          h("div", { class: "tasks-board-meta" }, [
            p.value ? h("span", { class: "tasks-badge tasks-priority p" + p.value }, [icon(p.icon, "mu-icon-filled"), h("span", { text: t(p.key) })]) : null,
            due ? h("span", { class: "tasks-badge" + (due < new Date() && !task.completed ? " is-late" : "") }, [icon("event"), h("span", { text: formatTaskDue(task) })]) : null,
            ...tagsOf(task).map((tag) => h("span", { class: "tasks-badge tasks-tag", text: "#" + tag })),
          ]),
          h("div", { class: "tasks-board-actions" }, [
            index > 0 ? iconBtn("arrow_back", t("moveTo", { column: t(COLUMNS[index - 1].key) }), (e) => { e.stopPropagation(); moveToColumn(task.id, COLUMNS[index - 1].id); }, "mu-icon-btn-sm") : null,
            iconBtn("edit", t("edit"), (e) => { e.stopPropagation(); openEdit(task.id); }, "mu-icon-btn-sm"),
            index < COLUMNS.length - 1 ? iconBtn("arrow_forward", t("moveTo", { column: t(COLUMNS[index + 1].key) }), (e) => { e.stopPropagation(); moveToColumn(task.id, COLUMNS[index + 1].id); }, "mu-icon-btn-sm") : null,
          ]),
        ]);
        card.addEventListener("dragstart", (e) => { dragBoard = task.id; card.classList.add("is-dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", task.id); } catch {} });
        card.addEventListener("dragend", () => { dragBoard = null; card.classList.remove("is-dragging"); });
        card.addEventListener("keydown", (e) => {
          if (e.key === "Enter") openEdit(task.id);
          if (e.key === "ArrowRight" && index < COLUMNS.length - 1) moveToColumn(task.id, COLUMNS[index + 1].id);
          if (e.key === "ArrowLeft" && index > 0) moveToColumn(task.id, COLUMNS[index - 1].id);
        });
        list.append(card);
      });
      board.append(col);
    });
  }
  let dragBoard = null;

  /* ------------------------------------------------------------ calendar */
  let calMonth = startOfDay(new Date());
  calMonth.setDate(1);
  let calSelected = startOfDay(new Date());
  function renderCalendar() {
    const root = $("#calendarView");
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() - Number(shared.weekStart || 0) + 7) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
    const tasksByDay = new Map();
    allTasks.filter((x) => !x.deleted && !x.archived && matchesSearch(x) && matchesFilters(x)).forEach((x) => {
      const d = dueOf(x);
      if (!d) return;
      const key = isoDate(d);
      if (!tasksByDay.has(key)) tasksByDay.set(key, []);
      tasksByDay.get(key).push(x);
    });
    const head = h("div", { class: "tasks-cal-head" }, [
      iconBtn("chevron_left", t("previousMonth"), () => { calMonth = new Date(year, month - 1, 1); renderCalendar(); }),
      h("h2", { class: "mu-h-section", text: fmtDate(first, { month: "long", year: "numeric" }) }),
      iconBtn("chevron_right", t("nextMonth"), () => { calMonth = new Date(year, month + 1, 1); renderCalendar(); }),
      h("button", { type: "button", class: "mu-btn", onclick: () => { calMonth = startOfDay(new Date()); calMonth.setDate(1); calSelected = startOfDay(new Date()); renderCalendar(); } }, [icon("today"), h("span", { text: t("today") })]),
    ]);
    const grid = h("div", { class: "tasks-cal-grid", role: "grid", "aria-label": fmtDate(first, { month: "long", year: "numeric" }) });
    for (let i = 0; i < 7; i++) {
      const d = new Date(2023, 0, 1 + ((i + Number(shared.weekStart || 0)) % 7));
      grid.append(h("div", { class: "tasks-cal-dow", role: "columnheader", text: fmtDate(d, { weekday: "short" }) }));
    }
    const today = startOfDay(new Date());
    for (let i = 0; i < cells; i++) {
      const date = new Date(year, month, 1 - offset + i);
      const key = isoDate(date);
      const tasks = sortTasks(tasksByDay.get(key) || []);
      const cell = h("div", {
        class: "tasks-cal-day" + (date.getMonth() !== month ? " is-outside" : "") + (sameDay(date, today) ? " is-today" : "") + (sameDay(date, calSelected) ? " is-selected" : ""),
        role: "gridcell", tabindex: sameDay(date, calSelected) ? "0" : "-1", "aria-label": fmtDate(date, { weekday: "long", month: "long", day: "numeric" }) + (tasks.length ? ", " + t("taskCount", { count: tasks.length }) : ""),
        onclick: () => { calSelected = date; renderCalendar(); },
        onkeydown: (e) => {
          const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (!move) return;
          e.preventDefault();
          calSelected = addDays(calSelected, move);
          if (calSelected.getMonth() !== month) { calMonth = new Date(calSelected.getFullYear(), calSelected.getMonth(), 1); }
          renderCalendar();
          $(".tasks-cal-day.is-selected")?.focus();
        },
      }, [h("span", { class: "tasks-cal-num", text: String(date.getDate()) })]);
      tasks.forEach((task) => cell.append(h("button", {
        type: "button", class: "tasks-cal-chip" + (task.completed ? " is-done" : ""), "data-priority": String(task.priority || 0), title: task.title,
        onclick: (e) => { e.stopPropagation(); openEdit(task.id); },
      }, [h("span", { text: task.title })])));
      grid.append(cell);
    }
    const dayTasks = sortTasks(tasksByDay.get(isoDate(calSelected)) || []);
    const dayList = h("div", { class: "tasks-view-list" });
    if (dayTasks.length) dayTasks.forEach((task) => dayList.append(window.renderTask(task)));
    else emptyState(dayList, "event_available", t("noTasksThisDay"));
    root.replaceChildren(
      h("section", { class: "tasks-cal mu-glass" }, [head, grid]),
      h("div", { class: "tasks-cal-day-head" }, [
        h("h2", { class: "mu-h-title", text: fmtDate(calSelected, { weekday: "long", month: "long", day: "numeric" }) }),
        h("button", { type: "button", class: "mu-btn mu-btn-primary", onclick: () => addOnDay(calSelected) }, [icon("add"), h("span", { text: t("addTaskThisDay") })]),
      ]),
      dayList,
    );
  }
  function addOnDay(date) {
    location.hash = "#/tasks";
    setTimeout(() => {
      const input = $("#tfQuickAdd");
      if (!input) return;
      input.value = isoDate(date) + " ";
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 60);
  }

  /* ------------------------------------------------------------ insights */
  function bars(items) {
    const max = Math.max(1, ...items.map((x) => x.value));
    return h("ul", { class: "mu-comparison-bars" }, items.map((item, i) => {
      const pct = Math.round((item.value / max) * 100);
      const id = "tfBar" + i + Math.random().toString(36).slice(2, 6);
      return h("li", {}, [
        h("span", { id, text: item.label }),
        h("span", { class: "mu-progress mu-meter", role: "meter", "aria-labelledby": id, "aria-valuemin": "0", "aria-valuemax": String(max), "aria-valuenow": String(item.value) }, [h("span", { style: "--mu-meter-value:" + pct + "%;width:" + pct + "%" })]),
        h("span", { "aria-hidden": "true", text: String(item.value) }),
      ]);
    }));
  }
  function renderInsights() {
    const root = $("#insightsView");
    const live = allTasks.filter((x) => !x.deleted);
    const active = live.filter(isActive);
    const done = live.filter((x) => x.completed);
    const today = startOfDay(new Date());
    const weekAgo = addDays(today, -6);
    const doneWeek = done.filter((x) => x.completedAt && new Date(x.completedAt) >= weekAgo).length;
    const overdue = active.filter((x) => { const d = dueOf(x); return d && d < new Date(); }).length;
    const rate = live.length ? Math.round((done.length / (done.length + active.length || 1)) * 100) : 0;
    const { current, best } = streaks();
    const tracked = live.reduce((sum, x) => sum + trackedMs(x), 0);
    const stat = (iconName, value, key) => h("div", { class: "mu-stat" }, [h("span", { class: "mu-icon-circle" }, [icon(iconName)]), h("div", {}, [h("div", { class: "mu-stat-value", text: String(value) }), h("div", { class: "mu-stat-label", text: t(key) })])]);
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = addDays(today, -i); days.push({ label: i === 0 ? t("today") : fmtDate(d, { weekday: "short" }), value: completedOn(d) }); }
    const byCategory = [{ label: t("noCategory"), value: active.filter((x) => !x.categoryId || !categoryName(x.categoryId)).length }, ...allCategories.map((c) => ({ label: c.name, value: active.filter((x) => x.categoryId === c.id).length }))].filter((x) => x.value);
    const byPriority = PRIORITIES.map((p) => ({ label: t(p.key), value: active.filter((x) => (x.priority || 0) === p.value).length })).filter((x) => x.value);
    const tagCounts = allTags().map((tag) => ({ label: "#" + tag, value: active.filter((x) => tagsOf(x).includes(tag)).length })).filter((x) => x.value).sort((a, b) => b.value - a.value);
    const card = (titleKey, content) => h("section", { class: "tasks-insight-card mu-glass" }, [h("h2", { class: "mu-h-title", text: t(titleKey) }), content]);
    root.replaceChildren(
      goalCard(),
      h("div", { class: "tasks-stat-grid" }, [
        stat("pending_actions", active.length, "statActive"),
        stat("task_alt", completedOn(today), "statDoneToday"),
        stat("date_range", doneWeek, "statDoneWeek"),
        stat("event_busy", overdue, "overdue"),
        stat("percent", rate + "%", "statCompletionRate"),
        stat("local_fire_department", current, "statStreak"),
        stat("emoji_events", best, "statBestStreak"),
        stat("schedule", fmtDuration(tracked), "statTimeTracked"),
      ]),
      h("div", { class: "tasks-insight-grid" }, [
        card("completedLast7Days", bars(days)),
        card("activeByCategory", byCategory.length ? bars(byCategory) : h("p", { class: "mu-muted", text: t("noActiveTasks") })),
        card("activeByPriority", byPriority.length ? bars(byPriority) : h("p", { class: "mu-muted", text: t("noActiveTasks") })),
        card("activeByTag", tagCounts.length ? bars(tagCounts) : h("p", { class: "mu-muted", text: t("noTags") })),
      ]),
    );
  }

  /* ------------------------------------------------------------ templates */
  async function useTemplate(template) {
    const time = template.dueTime || "";
    await window.addTask({
      id: "task-" + crypto.randomUUID(), title: template.title, description: template.description || "", image: null,
      categoryId: allCategories.some((c) => c.id === template.categoryId) ? template.categoryId : null,
      dueDate: null, dueTime: time, reminderNotifiedAt: null,
      options: (template.options || []).map((o) => ({ text: o.text, checked: false })),
      subtasks: (template.subtasks || []).map((s) => ({ text: s.text, completed: false })),
      completed: false, archived: false, deleted: false, createdAt: new Date().toISOString(),
      priority: template.priority || 0, tags: template.tags || [], recurrence: template.recurrence || "",
      estimateMin: template.estimateMin || 0, links: template.links || [],
    });
    updateNotificationBadge();
    toast(t("taskAddedFromTemplate", { name: template.name }));
  }
  function renderTemplates() {
    const root = $("#templatesView");
    const list = shared.templates || [];
    const intro = h("p", { class: "tasks-help mu-muted", text: t("templatesHelp") });
    if (!list.length) {
      const empty = h("div");
      emptyState(empty, "library_books", t("noTemplates"));
      root.replaceChildren(intro, empty.firstChild);
      return;
    }
    root.replaceChildren(intro, h("div", { class: "tasks-template-grid" }, list.map((template) => {
      const p = PRIORITIES[template.priority || 0];
      const checklist = (template.options || []).length + (template.subtasks || []).length;
      return h("article", { class: "tasks-template mu-glass" }, [
        h("div", { class: "tasks-template-head" }, [h("span", { class: "mu-icon-circle" }, [icon("library_books")]), h("h2", { class: "mu-h-title", text: template.name })]),
        h("p", { class: "mu-muted", text: template.title }),
        h("div", { class: "tasks-board-meta" }, [
          p.value ? h("span", { class: "tasks-badge tasks-priority p" + p.value }, [icon(p.icon, "mu-icon-filled"), h("span", { text: t(p.key) })]) : null,
          template.recurrence ? h("span", { class: "tasks-badge" }, [icon("repeat"), h("span", { text: t(repeatKey(template.recurrence)) })]) : null,
          checklist ? h("span", { class: "tasks-badge" }, [icon("checklist"), h("span", { text: t("checklistItems", { count: checklist }) })]) : null,
          ...(template.tags || []).map((tag) => h("span", { class: "tasks-badge tasks-tag", text: "#" + tag })),
        ]),
        h("div", { class: "tasks-template-actions" }, [
          h("button", { type: "button", class: "mu-btn mu-btn-primary", onclick: () => useTemplate(template) }, [icon("add_task"), h("span", { text: t("useTemplate") })]),
          h("button", { type: "button", class: "mu-btn", onclick: async () => {
            const name = await promptText({ title: t("renameTemplate"), label: t("templateName"), value: template.name, icon: "edit" });
            if (!name) return;
            setShared({ templates: shared.templates.map((x) => (x.id === template.id ? { ...x, name } : x)) });
            renderTemplates();
          } }, [icon("edit"), h("span", { text: t("rename") })]),
          h("button", { type: "button", class: "mu-btn mu-btn-danger-outline", onclick: () => {
            const before = shared.templates;
            setShared({ templates: before.filter((x) => x.id !== template.id) });
            renderTemplates();
            toast(t("templateDeleted"), "info");
          } }, [icon("delete"), h("span", { text: t("delete") })]),
        ]),
      ]);
    })));
  }

  /* ------------------------------------------------------------ focus timer (Pomodoro) */
  const focus = { taskId: null, mode: "focus", endsAt: 0, remaining: 0, running: false, timer: null };
  function focusLength(mode) { return Math.max(1, Number(mode === "focus" ? shared.focusMin : shared.breakMin) || 1) * 60000; }
  function ensureFocusModal() {
    if ($("#tfFocusModal")) return $("#tfFocusModal");
    const modal = h("div", { class: "mu-modal", id: "tfFocusModal", hidden: true }, [
      h("div", { class: "mu-dialog mu-dialog-md tasks-focus", role: "dialog", "aria-modal": "true", "aria-labelledby": "tfFocusTitle" }, [
        h("div", { class: "mu-dialog-header" }, [
          h("div", { class: "mu-dialog-heading" }, [h("span", { class: "mu-icon-circle" }, [icon("center_focus_strong")]), h("h2", { id: "tfFocusTitle", text: t("focus") })]),
          h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), onclick: () => UI().closeModal("tfFocusModal") }, [icon("close")]),
        ]),
        h("p", { class: "tasks-focus-task mu-muted", id: "tfFocusTask" }),
        h("div", { class: "tasks-focus-ring mu-ring", id: "tfFocusRing", role: "timer", "aria-live": "off" }, [h("span", { id: "tfFocusClock", text: "25:00" })]),
        h("div", { class: "mu-segmented", role: "group", "aria-label": t("focusMode") }, [
          h("button", { type: "button", "data-mode": "focus", "aria-pressed": "true", onclick: () => setFocusMode("focus") }, [t("focus")]),
          h("button", { type: "button", "data-mode": "break", "aria-pressed": "false", onclick: () => setFocusMode("break") }, [t("break")]),
        ]),
        h("div", { class: "mu-dialog-actions" }, [
          h("button", { type: "button", class: "mu-btn", onclick: () => resetFocus() }, [icon("restart_alt"), h("span", { text: t("reset") })]),
          h("button", { type: "button", class: "mu-btn mu-btn-primary", id: "tfFocusToggle", onclick: () => toggleFocus() }, [icon("play_arrow"), h("span", { text: t("start") })]),
        ]),
      ]),
    ]);
    document.body.append(modal);
    return modal;
  }
  function openFocus(taskId) {
    const modal = ensureFocusModal();
    if (focus.taskId !== taskId && !focus.running) { focus.taskId = taskId; focus.mode = "focus"; focus.remaining = focusLength("focus"); }
    else if (focus.taskId !== taskId && focus.running) { toast(t("focusAlreadyRunning"), "info"); }
    $("#tfFocusTask").textContent = findTask(focus.taskId)?.title || "";
    paintFocus();
    if (modal.hidden) UI().openModal("tfFocusModal");
  }
  function setFocusMode(mode) {
    if (focus.running) return;
    focus.mode = mode;
    focus.remaining = focusLength(mode);
    paintFocus();
  }
  function resetFocus() {
    clearInterval(focus.timer);
    focus.running = false;
    focus.remaining = focusLength(focus.mode);
    paintFocus();
  }
  function toggleFocus() {
    if (focus.running) {
      clearInterval(focus.timer);
      focus.remaining = Math.max(0, focus.endsAt - Date.now());
      focus.running = false;
    } else {
      if (!focus.remaining) focus.remaining = focusLength(focus.mode);
      focus.endsAt = Date.now() + focus.remaining;
      focus.running = true;
      focus.timer = setInterval(tickFocus, 500);
    }
    paintFocus();
  }
  async function tickFocus() {
    const left = focus.endsAt - Date.now();
    if (left > 0) { focus.remaining = left; paintFocus(); return; }
    clearInterval(focus.timer);
    focus.running = false;
    const finished = focus.mode;
    if (finished === "focus" && findTask(focus.taskId)) {
      const task = findTask(focus.taskId);
      await saveMany([[task.id, { trackedMs: (task.trackedMs || 0) + focusLength("focus"), inProgress: !task.completed }]]);
      renderCurrentPage();
    }
    const message = finished === "focus" ? t("focusDone") : t("breakDone");
    toast(message, "success");
    try { if ("Notification" in window && Notification.permission === "granted") new Notification(t("appName"), { body: message, icon: "./android-chrome-192x192.png" }); } catch {}
    focus.mode = finished === "focus" ? "break" : "focus";
    focus.remaining = focusLength(focus.mode);
    paintFocus();
  }
  function paintFocus() {
    const total = focusLength(focus.mode);
    const remaining = focus.running ? Math.max(0, focus.endsAt - Date.now()) : focus.remaining || total;
    const clockText = clock(remaining);
    if ($("#tfFocusClock")) {
      $("#tfFocusClock").textContent = clockText;
      $("#tfFocusRing").style.setProperty("--mu-value", String(Math.round((1 - remaining / total) * 100)));
      $("#tfFocusRing").setAttribute("aria-label", t("timeLeft", { time: clockText }));
      $$("#tfFocusModal .mu-segmented button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === focus.mode)));
      const toggle = $("#tfFocusToggle");
      toggle.replaceChildren(icon(focus.running ? "pause" : "play_arrow"), h("span", { text: focus.running ? t("pause") : t("start") }));
    }
    let chip = $("#tfFocusChip");
    if (focus.running || (focus.remaining && focus.remaining < total)) {
      if (!chip) {
        chip = h("button", { type: "button", id: "tfFocusChip", class: "tasks-focus-chip mu-glass", onclick: () => openFocus(focus.taskId) }, [icon("center_focus_strong"), h("span")]);
        document.body.append(chip);
      }
      chip.querySelector("span:last-child").textContent = (focus.mode === "focus" ? t("focus") : t("break")) + " · " + clockText;
      chip.hidden = false;
    } else if (chip) chip.hidden = true;
  }

  /* ------------------------------------------------------------ command palette */
  function openPalette() {
    const pages = [
      ["tasks", "task_alt", "nav.tasks"], ["today", "today", "today"], ["upcoming", "date_range", "upcoming"], ["overdue", "event_busy", "overdue"],
      ["board", "view_kanban", "board"], ["calendar", "calendar_month", "calendar"], ["insights", "insights", "insights"], ["templates", "library_books", "templates"],
      ["completed", "check_circle", "nav.completed"], ["favorites", "star", "nav.favorites"], ["categories", "category", "nav.categories"],
      ["inprogress", "hourglass_top", "nav.inProgress"], ["archived", "archive", "nav.archived"], ["trash", "delete", "nav.trash"], ["settings", "settings", "nav.settings"],
    ];
    const navLabel = (key) => {
      if (!key.startsWith("nav.")) return t(key);
      const trans = getCurrentTranslations();
      const name = key.slice(4);
      return trans?.nav?.[name] || trans?.sidebar?.[name] || t(name);
    };
    const actions = [
      ["action:new", t("newTask")], ["action:select", t("select")], ["action:focus", t("focus")],
      ["action:ics", t("exportIcs")], ["action:csv", t("exportCsv")], ["action:md", t("exportMarkdown")], ["action:undo", t("undo")],
      ["action:help", $("#helpIcon")?.getAttribute("aria-label") || "Help"], ["action:apps", $("#appsIcon")?.getAttribute("aria-label") || "Apps"],
    ];
    const tasks = sortTasks(allTasks.filter((x) => !x.deleted)).map((x) => ({
      value: "task:" + x.id, label: x.title,
      sub: [categoryName(x.categoryId), ...tagsOf(x).map((tag) => "#" + tag)].filter(Boolean).join("  "),
      trailing: x.completed ? t("completed") : dueOf(x) ? formatTaskDue(x) : "",
    }));
    UI().pickFromList({
      title: t("commandPalette"), icon: "bolt", searchLabel: t("paletteSearch"), closeLabel: t("close"), emptyText: t("noResults"),
      groups: [
        { label: t("goTo"), items: pages.map(([hash, , key]) => ({ value: "page:" + hash, label: navLabel(key) })) },
        { label: t("actions"), items: actions.map(([value, label]) => ({ value, label })) },
        { label: t("tasksGroup"), items: tasks },
      ],
      onPick: (value) => {
        if (value.startsWith("page:")) location.hash = "#/" + value.slice(5);
        else if (value.startsWith("task:")) openEdit(value.slice(5));
        else if (value === "action:new") { location.hash = "#/tasks"; setTimeout(() => $("#tfQuickAdd")?.focus(), 80); }
        else if (value === "action:select") toggleSelectMode(true);
        else if (value === "action:focus") { const first = sortTasks(allTasks.filter(isActive))[0]; if (first) openFocus(first.id); else toast(t("noActiveTasks"), "info"); }
        else if (value === "action:ics") exportIcs();
        else if (value === "action:csv") exportCsv();
        else if (value === "action:md") exportMarkdown();
        else if (value === "action:undo") undo();
        else if (value === "action:help") $("#helpIcon")?.click();
        else if (value === "action:apps") $("#appsIcon")?.click();
      },
    });
  }

  /* ------------------------------------------------------------ exports */
  function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => isoDate(new Date());
  function exportIcs() {
    const icsText = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
    const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const rule = { daily: "FREQ=DAILY", weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", weekly: "FREQ=WEEKLY", monthly: "FREQ=MONTHLY", yearly: "FREQ=YEARLY" };
    const fold = (line) => line.match(/.{1,73}/g).join("\r\n ");
    const events = allTasks.filter((x) => !x.deleted && dueOf(x)).map((x) => {
      const start = dueOf(x);
      const end = new Date(start.getTime() + Math.max(15, x.estimateMin || 30) * 60000);
      return [
        "BEGIN:VEVENT", "UID:" + x.id + "@tasks.munetios.com", "DTSTAMP:" + utc(new Date()), "DTSTART:" + utc(start), "DTEND:" + utc(end),
        "SUMMARY:" + icsText(x.title), x.description ? "DESCRIPTION:" + icsText(x.description) : "",
        x.recurrence ? "RRULE:" + rule[x.recurrence] : "", tagsOf(x).length ? "CATEGORIES:" + tagsOf(x).map(icsText).join(",") : "",
        x.completed ? "STATUS:CANCELLED" : "", "END:VEVENT",
      ].filter(Boolean).map(fold).join("\r\n");
    });
    if (!events.length) { toast(t("nothingToExport"), "info"); return; }
    download("munetios-tasks-" + stamp() + ".ics", "text/calendar", ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Munetios//Tasks//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n") + "\r\n");
    toast(t("exported"));
  }
  function exportCsv() {
    const cell = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const head = ["sortTitle", "csv.description", "csv.category", "priority", "tags", "sortDue", "csv.status", "repeat", "estimate", "csv.tracked", "csv.created"].map((k) => t(k));
    const rows = allTasks.filter((x) => !x.deleted).map((x) => [
      x.title, x.description, categoryName(x.categoryId), t(PRIORITIES[x.priority || 0].key), tagsOf(x).join(" "),
      dueOf(x) ? dueOf(x).toISOString() : "", x.completed ? t("completed") : x.archived ? t("archive") : x.inProgress ? t("inProgress") : t("toDo"),
      x.recurrence ? t(repeatKey(x.recurrence)) : "", x.estimateMin || "", Math.round(trackedMs(x) / 60000) || "", x.createdAt || "",
    ]);
    if (!rows.length) { toast(t("nothingToExport"), "info"); return; }
    download("munetios-tasks-" + stamp() + ".csv", "text/csv;charset=utf-8", "\ufeff" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"));
    toast(t("exported"));
  }
  function exportMarkdown() {
    const live = allTasks.filter((x) => !x.deleted && !x.archived);
    if (!live.length) { toast(t("nothingToExport"), "info"); return; }
    const groups = new Map();
    sortTasks(live).forEach((x) => { const name = categoryName(x.categoryId) || t("noCategory"); if (!groups.has(name)) groups.set(name, []); groups.get(name).push(x); });
    const md = (v) => String(v || "").replace(/([\\`*_[\]#|])/g, "\\$1");
    const lines = ["# " + t("appName"), ""];
    for (const [name, tasks] of groups) {
      lines.push("## " + md(name), "");
      tasks.forEach((x) => {
        const bits = [x.priority ? "(" + t(PRIORITIES[x.priority].key) + ")" : "", dueOf(x) ? "— " + formatTaskDue(x) : "", ...tagsOf(x).map((tag) => "#" + tag)].filter(Boolean).join(" ");
        lines.push("- [" + (x.completed ? "x" : " ") + "] " + md(x.title) + (bits ? " " + bits : ""));
        (x.subtasks || []).forEach((s) => lines.push("  - [" + (s.completed ? "x" : " ") + "] " + md(s.text)));
        (x.options || []).forEach((o) => lines.push("  - [" + (o.checked ? "x" : " ") + "] " + md(o.text || o)));
      });
      lines.push("");
    }
    download("munetios-tasks-" + stamp() + ".md", "text/markdown;charset=utf-8", lines.join("\n"));
    toast(t("exported"));
  }

  /* ------------------------------------------------------------ settings rows */
  function mountSettings() {
    const container = $(".settings-container");
    if (!container || $("#tfSettings")) return;
    const row = (titleKey, subKey, control) => h("div", { class: "mu-row" }, [
      h("div", { class: "mu-row-info" }, [h("span", { class: "mu-row-title", "data-tf": titleKey, text: t(titleKey) }), h("span", { class: "mu-row-subtitle", "data-tf": subKey, text: t(subKey) })]),
      control,
    ]);
    const number = (id, key) => {
      const input = h("input", { id, class: "mu-input tasks-number", type: "number", min: "1", step: "1", inputmode: "numeric", "aria-label": t(key), "data-tf-label": key });
      input.addEventListener("change", () => {
        const value = Math.max(1, Math.round(Number(input.value) || 1));
        input.value = value;
        setShared({ [id === "tfGoal" ? "dailyGoal" : id === "tfFocusLen" ? "focusMin" : "breakMin"]: value });
        if (!focus.running) { focus.remaining = focusLength(focus.mode); paintFocus(); }
      });
      return input;
    };
    // 2023-01-01 is a Sunday, so day i of that week has weekday number i.
    const weekStart = h("select", { id: "tfWeekStart", class: "mu-select", "aria-label": t("weekStartsOn") },
      [1, 2, 3, 4, 5, 6, 0].map((day) => h("option", { value: String(day), text: fmtDate(new Date(2023, 0, 1 + day), { weekday: "long" }) })));
    weekStart.addEventListener("change", () => setShared({ weekStart: Number(weekStart.value) }));
    const section = h("div", { id: "tfSettings", class: "setting-item tasks-settings-group" }, [
      row("dailyGoal", "dailyGoalHelp", number("tfGoal", "dailyGoal")),
      row("focusLength", "focusLengthHelp", number("tfFocusLen", "focusLength")),
      row("breakLength", "breakLengthHelp", number("tfBreakLen", "breakLength")),
      row("weekStartsOn", "weekStartsOnHelp", h("div", { class: "tasks-select-wrap" }, [weekStart])),
    ]);
    container.insertBefore(section, $("#tasksDataActions"));
    const actions = $("#tasksDataActions");
    actions?.prepend(
      h("button", { type: "button", class: "btn", onclick: exportIcs }, [h("icon", { text: "event" }), h("span", { "data-tf": "exportIcs", text: t("exportIcs") })]),
      h("button", { type: "button", class: "btn", onclick: exportCsv }, [h("icon", { text: "table_view" }), h("span", { "data-tf": "exportCsv", text: t("exportCsv") })]),
      h("button", { type: "button", class: "btn", onclick: exportMarkdown }, [h("icon", { text: "description" }), h("span", { "data-tf": "exportMarkdown", text: t("exportMarkdown") })]),
    );
    syncSettingsForm();
  }
  function syncSettingsForm() {
    if (!$("#tfSettings")) return;
    $("#tfGoal").value = shared.dailyGoal;
    $("#tfFocusLen").value = shared.focusMin;
    $("#tfBreakLen").value = shared.breakMin;
    setSelect("tfWeekStart", shared.weekStart || 0);
  }

  /* ------------------------------------------------------------ page enhancement */
  function translateStatic() {
    $$("[data-tf]").forEach((node) => { const v = t(node.dataset.tf); if (node.textContent !== v) node.textContent = v; });
    $$("[data-tf-placeholder]").forEach((node) => node.setAttribute("placeholder", t(node.dataset.tfPlaceholder)));
    $$("[data-tf-label]").forEach((node) => { node.setAttribute("aria-label", t(node.dataset.tfLabel)); if (node.hasAttribute("title")) node.title = t(node.dataset.tfLabel); });
    document.documentElement.lang = window.currentLang || "en";
    document.documentElement.dir = ["ar", "he"].includes(window.currentLang) ? "rtl" : "ltr";
  }
  function updateCounts() {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const now = new Date();
    const active = allTasks.filter(isActive);
    const counts = {
      today: active.filter((x) => { const d = dueOf(x); return d && d < tomorrow; }).length,
      upcoming: active.filter((x) => { const d = dueOf(x); return d && d >= tomorrow && d < addDays(today, 8); }).length,
      overdue: active.filter((x) => { const d = dueOf(x); return d && d < now; }).length,
    };
    for (const [key, value] of Object.entries(counts)) {
      const badge = $(`.sidebar-count[data-count="${key}"]`);
      if (badge) badge.textContent = value ? String(value) : "";
    }
  }
  function enhanceList(container) {
    const nodes = $$(":scope > .task-item", container);
    if (!nodes.length) {
      const legacy = container.firstElementChild;
      if (legacy && !legacy.classList.contains("mu-empty") && legacy.getAttribute("style")) emptyState(container, (typeof searchQuery === "string" && searchQuery.trim()) ? "search_off" : "inbox", legacy.textContent.trim());
      return;
    }
    const byId = new Map(allTasks.map((x) => [x.id, x]));
    const visible = nodes.map((node) => ({ node, task: byId.get(node.dataset.taskId) })).filter((x) => x.task && matchesFilters(x.task));
    const order = new Map(sortTasks(visible.map((x) => x.task)).map((task, i) => [task.id, i]));
    visible.sort((a, b) => order.get(a.task.id) - order.get(b.task.id));
    container.replaceChildren(...visible.map((x) => x.node));
    if (!visible.length) emptyState(container, "filter_alt_off", t("noMatches"));
  }
  function enhancePage() {
    loadSettings();
    const pageId = activePageId();
    if (pageId === "todayPage") renderToday();
    else if (pageId === "upcomingPage") renderUpcoming();
    else if (pageId === "overduePage") renderOverdue();
    else if (pageId === "boardPage") renderBoard();
    else if (pageId === "calendarPage") renderCalendar();
    else if (pageId === "insightsPage") renderInsights();
    else if (pageId === "templatesPage") renderTemplates();
    else if (LIST_PAGES[pageId]) enhanceList(document.getElementById(LIST_PAGES[pageId]));
    syncToolbar();
    updateBulkBar();
    updateCounts();
    translateStatic();
  }

  const baseRenderCurrentPage = window.renderCurrentPage;
  window.renderCurrentPage = function () {
    baseRenderCurrentPage();
    try { enhancePage(); } catch (error) { console.error("[Tasks features]", error); }
  };
  window.renderTasks = function () { window.renderCurrentPage(); };

  /* ------------------------------------------------------------ keyboard */
  document.addEventListener("keydown", (e) => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    if (e.key === "q" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); location.hash = "#/tasks"; setTimeout(() => $("#tfQuickAdd")?.focus(), 60); }
    if (e.key === "Escape" && selectMode && !$(".mu-modal:not([hidden])")) toggleSelectMode(false);
  });

  /* ------------------------------------------------------------ due-date picker */
  // The original due-date calendar always started on Sunday with English day names.
  // The v4 date picker follows "Week starts on" and the selected language.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("#setDueDateBtn");
    if (!btn || !UI()?.pickDate) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const legacy = $(".calendar-date-picker-wrapper");
    if (legacy) legacy.style.display = "none";
    const current = selectedDueDate ? new Date(selectedDueDate) : new Date();
    const trans = getCurrentTranslations();
    UI().pickDate({
      anchor: btn,
      value: isoDate(current),
      locale: lang(),
      firstDay: Number(shared.weekStart || 0),
      labels: { previous: t("previousMonth"), next: t("nextMonth"), today: t("today"), done: trans?.buttons?.confirm || t("done") },
      onPick: (iso) => {
        if (!iso) return;
        const [y, m, d] = iso.split("-").map(Number);
        selectedDueDate = new Date(y, m - 1, d).toISOString();
        selectedDueTime = document.getElementById("setDueTimeBtn")?.dataset.timeValue || "09:00";
        updateTimeButton("setDueTimeBtn", "setDueTimeLabel", selectedDueTime);
        const due = new Date(combineDueDateTime(selectedDueDate, selectedDueTime));
        btn.textContent = fmtDate(due, { month: "short", day: "numeric" }) + ", " + fmtTime(due);
      },
    });
  }, true);

  /* ------------------------------------------------------------ popover + share fixes */
  // The reminder-time popover and the due-date calendar close when you click away or change pages.
  const closePopovers = () => {
    if ($("#timePickerPopover")?.classList.contains("show")) { try { hideCustomTimePicker(); } catch { $("#timePickerPopover").classList.remove("show"); } }
    const cal = $(".calendar-date-picker-wrapper");
    if (cal && cal.style.display && cal.style.display !== "none") cal.style.display = "none";
  };
  document.addEventListener("pointerdown", (e) => {
    const pop = $("#timePickerPopover");
    if (!pop?.classList.contains("show")) return;
    if (pop.contains(e.target) || e.target.closest?.(".time-picker-btn")) return;
    try { hideCustomTimePicker(); } catch { pop.classList.remove("show"); }
  }, true);
  window.addEventListener("hashchange", closePopovers);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopovers(); });
  // Share preview shows the due date in the selected language instead of a raw ISO timestamp.
  function fixShareDates() {
    document.querySelectorAll(".share-task-preview").forEach(fixShareDatesIn);
  }
  function fixShareDatesIn(preview) {
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (iso.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(iso, (m) => nmAn(new Date(m).toLocaleString(lang(), { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })));
      iso.lastIndex = 0;
    }
  }

  /* ------------------------------------------------------------ start */
  window.TasksFeatures = { t, openPalette, undo, exportIcs, exportCsv, exportMarkdown, parseQuickAdd };
  document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    mountQuickAdd();
    mountCreateExtras();
    mountEditExtras();
    mountMoreItems();
    mountSettings();
    $("#tasksCommandBtn")?.addEventListener("click", openPalette);
    const menuBtn = $(".menu-btn");
    menuBtn?.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); menuBtn.click(); } });
    $$(".sidebar-item").forEach((item) => {
      item.tabIndex = 0;
      item.setAttribute("role", "link");
      item.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.click(); } });
    });
    translateStatic();
    const start = window.initialHashChangeHandler;
    window.initialHashChangeHandler = function () {
      loadSettings();
      registerExtrasSync();
      syncSettingsForm();
      if (start) start();
      else window.renderCurrentPage();
    };
    document.addEventListener("munetios-sync-applied", () => { loadSettings(); syncSettingsForm(); });
    let shareFrame = 0;
    new MutationObserver(() => { cancelAnimationFrame(shareFrame); shareFrame = requestAnimationFrame(fixShareDates); }).observe(document.body, { childList: true, subtree: true });
    setInterval(updateCounts, 60000);
  });
})();
