/*!
 * Munetios Calendar (v4 redesign)
 *  - Events, birthdays, holidays, and multiple calendars, encrypted on this device
 *  - Sync with Munetios Account (end-to-end encrypted) and sharing with collaborators
 *  - Day, 4 days, week, month, year, agenda, and timeline views
 *  - Time zones from the server, custom date, time, and AM/PM symbol formats
 * Requires munetios-ui-v4.js, account-core.js, cloud-i18n.js, munetios-cloud.js, calendar-i18n.js.
 */
(() => {
  "use strict";
  const UI = window.MunetiosUI;
  const Cloud = window.MunetiosCloud;
  const A = window.MunetiosAccount;
  const STR = window.MunetiosCalendarStrings;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { localStorage.setItem(key, value); },
    json(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  };
  const COLORS = ["#8f5cff", "#4f7dff", "#1e9bd7", "#14a37f", "#43a047", "#c0ca33", "#f9a825", "#fb8c00", "#e53935", "#e91e8c", "#8d6e63", "#607d8b"];
  const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const DAY_MS = 86400000;

  /* ================================================================ settings */
  const SETTINGS_KEY = "munetiosCalendar:settings";
  const DEFAULTS = {
    language: "system", view: "month", weekStart: "auto", dateFormat: "locale", timeFormat: "auto", meridiem: "nm-an",
    meridiemAm: "NM", meridiemPm: "AN", timeZone: "auto", secondaryTimeZone: "", worldClocks: [], showWeekNumbers: false,
    hideWeekends: false, density: "comfortable", workStart: "09:00", workEnd: "17:00", workDays: [1, 2, 3, 4, 5],
    showWorkingHours: true, defaultDuration: 60, defaultReminder: 10, notifications: false, holidayCountry: "auto",
    showHolidays: true, showBirthdays: true, accountSync: true, labelFilter: [], sharedPrefs: {}, birthdayReminder: true,
  };
  let settings = Object.assign({}, DEFAULTS, store.json(SETTINGS_KEY, {}));
  function saveSettings(patch, { quiet = false } = {}) {
    const next = Object.assign({}, settings, patch, { updatedAt: Date.now() });
    try {
      store.set(SETTINGS_KEY, JSON.stringify(next));
      settings = next;
      if (settings.accountSync) A?.sync?.schedule?.(800);
      return true;
    } catch {
      if (!quiet) UI.toast(t("errorSettings"), { type: "error" });
      return false;
    }
  }

  /* ================================================================ language */
  const language = () => Cloud.resolveLanguage(settings.language === "system" ? navigator.language : settings.language);
  // The locale used for dates and numbers. "es" follows Spain, "en" follows the United States.
  const uiLocale = () => ({ es: "es-ES", en: "en-US", "es-419": "es-419" })[language()] || language();
  let catalog = {};
  function buildCatalog() {
    const code = language();
    const base = Cloud.catalogBase(code);
    catalog = Object.assign({}, Cloud.strings("en"), STR.en, Cloud.strings(code === "zh-CN" ? "zh" : code), STR[base] || {}, STR[code] || {});
  }
  function t(key, vars) {
    let text = catalog[key] ?? key;
    if (vars) text = text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] ?? m));
    return text;
  }
  function translateUI() {
    document.documentElement.lang = language();
    document.documentElement.dir = ["ar"].includes(Cloud.catalogBase(language())) ? "rtl" : "ltr";
    document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll("[data-t-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.tLabel)); el.title = t(el.dataset.tLabel); });
    document.querySelectorAll("[data-t-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.tPlaceholder); });
    A?.setLocaleSource?.(() => language());
  }

  /* ================================================================ dates and time zones */
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (s, n) => iso(new Date(parse(s).getTime() + n * DAY_MS));
  const addMonths = (s, n) => { const d = parse(s); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return iso(d); };
  const weekday = (s) => parse(s).getUTCDay();
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY_MS);
  const monthStart = (s) => s.slice(0, 8) + "01";
  const monthEnd = (s) => iso(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)));
  const toMin = (time) => { const [h, m] = String(time || "0:0").split(":").map(Number); return h * 60 + m; };
  const fromMin = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  const displayTz = () => (settings.timeZone === "auto" ? BROWSER_TZ : settings.timeZone);
  const fmtCache = new Map();
  function zoneParts(ms, tz) {
    let f = fmtCache.get(tz);
    if (!f) {
      try { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
      catch { f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
      fmtCache.set(tz, f);
    }
    const p = {};
    for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
    return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  }
  function zoneOffset(ms, tz) {
    const p = zoneParts(ms, tz);
    return Math.round((parse(p.date).getTime() + p.min * 60000 - Math.floor(ms / 60000) * 60000) / 60000);
  }
  function toInstant(date, time, tz) {
    const guess = parse(date).getTime() + toMin(time) * 60000;
    const first = guess - zoneOffset(guess, tz) * 60000;
    return guess - zoneOffset(first, tz) * 60000;
  }
  const todayIso = () => zoneParts(Date.now(), displayTz()).date;
  const nowMin = () => zoneParts(Date.now(), displayTz()).min;
  function weekStartDay() {
    if (settings.weekStart !== "auto") return Number(settings.weekStart);
    try { const info = new Intl.Locale(uiLocale()).getWeekInfo?.() || new Intl.Locale(uiLocale()).weekInfo; if (info?.firstDay) return info.firstDay % 7; } catch {}
    return /^(en-US|en-CA|es-US|es-MX|pt-BR|ja|ko|zh|hi|ar|he)/.test(uiLocale()) ? 0 : 1;
  }
  const startOfWeek = (s) => addDays(s, -((weekday(s) - weekStartDay() + 7) % 7));
  function isoWeek(s) {
    const d = parse(s);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - firstThursday) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  }

  /* ---------------------------------------------------------- formatting */
  const MERIDIEMS = { "nm-an": ["NM", "AN"], "am-pm": ["AM", "PM"], lower: ["am", "pm"], dotted: ["a.m.", "p.m."], short: ["A", "P"] };
  function uses12h() {
    if (settings.timeFormat === "12") return true;
    if (settings.timeFormat === "24") return false;
    try { return new Intl.DateTimeFormat(uiLocale(), { hour: "numeric" }).resolvedOptions().hour12 !== false; } catch { return true; }
  }
  function meridiemSymbols() {
    if (settings.meridiem === "custom") return [settings.meridiemAm || "NM", settings.meridiemPm || "AN"];
    if (settings.meridiem === "locale") return null;
    return MERIDIEMS[settings.meridiem] || MERIDIEMS["nm-an"];
  }
  function formatTime(time) {
    const min = typeof time === "number" ? time : toMin(time);
    const h = Math.floor(min / 60) % 24, m = min % 60;
    const date = new Date(Date.UTC(2026, 0, 1, h, m));
    const twelve = uses12h();
    const parts = new Intl.DateTimeFormat(uiLocale(), { hour: "numeric", minute: "2-digit", hourCycle: twelve ? "h12" : "h23", timeZone: "UTC" }).formatToParts(date);
    const symbols = twelve ? meridiemSymbols() : null;
    return parts.map((part) => (part.type === "dayPeriod" && symbols ? symbols[h < 12 ? 0 : 1] : part.value)).join("").trim();
  }
  function formatHour(h) {
    if (!uses12h()) return `${pad(h)}:00`;
    const symbols = meridiemSymbols();
    const parts = new Intl.DateTimeFormat(uiLocale(), { hour: "numeric", hourCycle: "h12", timeZone: "UTC" }).formatToParts(new Date(Date.UTC(2026, 0, 1, h)));
    return parts.map((part) => (part.type === "dayPeriod" && symbols ? symbols[h < 12 ? 0 : 1] : part.value)).join("").trim();
  }
  const intl = (s, options) => new Intl.DateTimeFormat(uiLocale(), Object.assign({ timeZone: "UTC" }, options)).format(parse(s));
  function formatDate(s, style = "medium") {
    const [y, m, d] = s.split("-");
    switch (settings.dateFormat) {
      case "MDY": return `${m}/${d}/${y}`;
      case "DMY": return `${d}/${m}/${y}`;
      case "YMD": return `${y}-${m}-${d}`;
      case "DMY.": return `${d}.${m}.${y}`;
      case "long": return intl(s, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      default: return intl(s, style === "long" ? { weekday: "long", year: "numeric", month: "long", day: "numeric" } : { dateStyle: style });
    }
  }
  const monthName = (s, style = "long") => intl(s, { month: style, year: "numeric" });
  const dayLabel = (s) => intl(s, { weekday: "long", month: "long", day: "numeric" });
  const weekdayShort = (dayIndex) => intl(addDays("2026-11-01", dayIndex), { weekday: "short" });
  const weekdayNarrow = (dayIndex) => intl(addDays("2026-11-01", dayIndex), { weekday: "narrow" });
  const num = (n) => new Intl.NumberFormat(uiLocale()).format(n);
  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    try {
      if (h && m) return new Intl.NumberFormat(uiLocale(), { style: "unit", unit: "hour", unitDisplay: "narrow" }).format(h) + " " + new Intl.NumberFormat(uiLocale(), { style: "unit", unit: "minute", unitDisplay: "narrow" }).format(m);
      if (h) return new Intl.NumberFormat(uiLocale(), { style: "unit", unit: "hour", unitDisplay: "long" }).format(h);
      return new Intl.NumberFormat(uiLocale(), { style: "unit", unit: "minute", unitDisplay: "long" }).format(m);
    } catch { return `${h}h ${m}m`; }
  }
  function relative(ms) {
    const diff = Math.round((ms - Date.now()) / 60000);
    const rtf = new Intl.RelativeTimeFormat(uiLocale(), { numeric: "auto" });
    if (Math.abs(diff) < 60) return rtf.format(diff, "minute");
    if (Math.abs(diff) < 1440) return rtf.format(Math.round(diff / 60), "hour");
    return rtf.format(Math.round(diff / 1440), "day");
  }
  function zoneLabel(id) {
    const offset = zoneOffset(Date.now(), id);
    const sign = offset < 0 ? "-" : "+";
    return { city: id === "UTC" ? "UTC" : id.split("/").pop().replace(/_/g, " "), offset: `UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}` };
  }

  /* ================================================================ storage (encrypted IndexedDB) */
  const DB_NAME = "munetios-calendar-v4";
  let dbPromise = null, cryptoKey = null;
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  function openDb() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore("records", { keyPath: "id" }); open.result.createObjectStore("keys", { keyPath: "id" }); };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => { dbPromise = null; reject(open.error); };
    });
    return dbPromise;
  }
  async function deviceKey() {
    if (cryptoKey) return cryptoKey;
    const db = await openDb();
    const found = await req(db.transaction("keys").objectStore("keys").get("main"));
    if (found?.key) return (cryptoKey = found.key);
    // Non-extractable: scripts can use it on this device but can't read it out.
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await req(db.transaction("keys", "readwrite").objectStore("keys").put({ id: "main", key }));
    return (cryptoKey = key);
  }
  async function putRecord(id, value) {
    const key = await deviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
    const db = await openDb();
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put({ id, iv, data });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
  }
  async function deleteRecord(id) {
    const db = await openDb();
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").delete(id);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
  }
  async function allRecords() {
    const key = await deviceKey();
    const db = await openDb();
    const rows = await req(db.transaction("records").objectStore("records").getAll());
    const out = [];
    for (const row of rows) {
      if (row.id === "notification-schedule") continue;
      try { out.push([row.id, JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv }, key, row.data)))]); } catch {}
    }
    return out;
  }

  /* ================================================================ state */
  let calendars = [];          // { id, name, color, visible, spaceId?, role?, ownerName?, shared?, updatedAt }
  const items = new Map();     // id -> event or birthday
  let favorites = [];          // { date, note }
  const spaces = new Map();    // spaceId -> Space
  let current = todayIso();
  let view = settings.view;
  let searchQuery = "";
  let holidayCache = new Map();
  let countries = null;
  let timeZones = null;
  const failedHolidaysAt = new Map();

  const isDeleted = (item) => Boolean(item.deletedAt);
  const calendarOf = (item) => calendars.find((cal) => cal.id === item.calendarId);
  const canEdit = (cal) => !cal || !cal.spaceId || cal.role === "owner" || cal.role === "edit";
  const defaultCalendar = () => calendars.find((cal) => canEdit(cal) && !cal.shared) || calendars[0];

  async function saveCalendars() {
    calendars.forEach((cal) => { cal.updatedAt = cal.updatedAt || Date.now(); });
    await putRecord("calendars", calendars.filter((cal) => !cal.shared));
    await putRecord("favorites", favorites);
    A?.sync?.schedule?.(800);
  }
  async function persistItem(item) {
    await putRecord(`item:${item.id}`, item);
    A?.sync?.schedule?.(800);
  }
  async function removeItemRecord(id) { await deleteRecord(`item:${id}`); A?.sync?.schedule?.(800); }

  // Saves an event or birthday to its calendar: shared calendars save to the space first.
  async function commitItem(item) {
    item.updatedAt = Date.now();
    const cal = calendarOf(item);
    const space = cal?.spaceId && spaces.get(cal.spaceId);
    if (cal?.spaceId && !space) throw new Error("spaceUnavailable");
    if (space) await space.update((content) => { content.items = content.items || {}; content.items[item.id] = item; });
    items.set(item.id, item);
    await persistItem(item);
  }
  async function purgeItem(item) {
    const cal = calendarOf(item);
    const space = cal?.spaceId && spaces.get(cal.spaceId);
    if (space) await space.update((content) => { delete content.items[item.id]; });
    items.delete(item.id);
    await removeItemRecord(item.id);
  }

  /* ---------------------------------------------------------- migration from the previous Calendar */
  async function migrateLegacy() {
    if (store.get("munetiosCalendar:migrated")) return;
    const legacySettings = {
      language: store.get("munetiosLang"), weekStart: store.get("munetiosWeekStarts"), holidayCountry: store.get("munetiosHolidayCountry"),
      density: store.get("munetiosCalendarDensity"), notifications: store.get("munetiosNotifications") === "on" ? true : null,
      defaultReminder: store.get("munetiosNotificationLead"), view: store.get("calendarView"),
      timeFormat: store.get("munetiosTimeFormat") === "24h" ? "24" : store.get("munetiosTimeFormat") === "12h" ? "12" : null,
      dateFormat: ({ "MM/DD/YY": "MDY", "DD/MM/YY": "DMY", "YY/MM/DD": "YMD" })[store.get("munetiosDateFormat")] || null,
    };
    const patch = {};
    for (const [k, v] of Object.entries(legacySettings)) if (v !== null && v !== undefined && v !== "") patch[k] = ["defaultReminder"].includes(k) ? Number(v) : v;
    if (patch.language) patch.language = Cloud.resolveLanguage(patch.language);
    if (!["day", "week", "month", "year", "agenda", "timeline"].includes(patch.view)) delete patch.view;
    if (Object.keys(patch).length) saveSettings(patch, { quiet: true });
    const names = store.json("calendars", null);
    const legacy = [];
    try {
      const exists = indexedDB.databases ? (await indexedDB.databases()).some((d) => d.name === "munetios_calendar") : true;
      if (exists) {
        const db = await new Promise((resolve, reject) => {
          const open = indexedDB.open("munetios_calendar");
          open.onupgradeneeded = () => { open.transaction.abort(); };
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        if (["events", "birthdays", "encryption"].every((s) => db.objectStoreNames.contains(s))) {
          const keyRow = await req(db.transaction("encryption").objectStore("encryption").get("masterKey"));
          const key = keyRow?.key ? await crypto.subtle.importKey("raw", keyRow.key, { name: "AES-GCM" }, false, ["decrypt"]) : null;
          for (const storeName of ["events", "birthdays"]) {
            for (const row of await req(db.transaction(storeName).objectStore(storeName).getAll())) {
              let data = row;
              if (row.encrypted && key) {
                try {
                  const bytes = Uint8Array.from(atob(row.encrypted), (c) => c.charCodeAt(0));
                  data = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12))));
                } catch { continue; }
              }
              legacy.push({ kind: storeName === "events" ? "event" : "birthday", data });
            }
          }
        }
        db.close();
      }
    } catch {}
    if (names || legacy.length) {
      const list = Array.isArray(names) && names.length ? names : ["My Calendar"];
      calendars = list.map((name, i) => ({ id: uid(), name: String(name), color: COLORS[i % COLORS.length], visible: true, updatedAt: Date.now() }));
      for (const { kind, data } of legacy) {
        const cal = calendars.find((c) => c.name === data.calendar) || calendars[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || "")) continue;
        const item = kind === "event"
          ? newEvent({ calendarId: cal.id, title: data.title || "", start: data.date, end: data.date, startTime: data.time || "09:00", allDay: !data.time, description: data.desc || "", color: data.color || "" })
          : newBirthday({ calendarId: cal.id, name: data.name || "", date: data.date, color: data.color || "" });
        items.set(item.id, item);
        await putRecord(`item:${item.id}`, item);
      }
      favorites = (store.json("favoriteDates", []) || []).map((f) => (typeof f === "string" ? { date: f } : f?.year ? { date: `${f.year}-${pad(f.month + 1)}-${pad(f.day)}` } : null)).filter((f) => f && /^\d{4}-\d{2}-\d{2}$/.test(f.date));
      await saveCalendars();
    }
    store.set("munetiosCalendar:migrated", "1");
  }

  /* ---------------------------------------------------------- item factories */
  function newEvent(fields = {}) {
    const start = fields.start || current;
    const startTime = fields.startTime || "09:00";
    const endTime = fields.endTime || fromMin(Math.min(toMin(startTime) + Number(settings.defaultDuration || 60), 23 * 60 + 59));
    return Object.assign({
      id: uid(), kind: "event", type: "event", calendarId: defaultCalendar()?.id, title: "", start, end: start, startTime, endTime, allDay: false,
      tz: displayTz(), location: "", url: "", description: "", color: "", labels: [], guests: [], reminders: [Number(settings.defaultReminder ?? 10)],
      recurrence: { freq: "none", interval: 1, byDay: [], until: "", count: 0 }, exceptions: [], starred: false, createdAt: Date.now(), updatedAt: Date.now(),
    }, fields, { end: fields.end || start, endTime: fields.endTime || endTime });
  }
  function newBirthday(fields = {}) {
    return Object.assign({ id: uid(), kind: "birthday", calendarId: defaultCalendar()?.id, name: "", date: current, yearKnown: true, color: "", notes: "", reminder: true, createdAt: Date.now(), updatedAt: Date.now() }, fields);
  }

  /* ================================================================ occurrences */
  // Start dates (in the item's own time zone) of an event between two dates.
  function expandDates(ev, from, to) {
    const r = ev.recurrence || { freq: "none" };
    const out = [];
    const skip = new Set(ev.exceptions || []);
    const push = (d) => { if (d >= from && d <= to && !skip.has(d)) out.push(d); };
    if (!r.freq || r.freq === "none") { push(ev.start); return out; }
    const interval = Math.max(1, Number(r.interval) || 1);
    const until = r.until || "9999-12-31";
    const limit = Number(r.count) > 0 ? Number(r.count) : Infinity;
    const last = to < until ? to : until;
    let count = 0;
    const take = (d) => { if (d > until) return false; count++; if (count > limit) return false; push(d); return true; };
    if (r.freq === "daily") {
      let d = ev.start;
      if (limit === Infinity && d < from) d = addDays(d, Math.floor(daysBetween(d, from) / interval) * interval);
      for (; d <= last; d = addDays(d, interval)) if (!take(d)) break;
    } else if (r.freq === "weekly" || r.freq === "weekdays") {
      const days = r.freq === "weekdays" ? [1, 2, 3, 4, 5] : (r.byDay?.length ? r.byDay : [weekday(ev.start)]);
      let week = addDays(ev.start, -weekday(ev.start));
      const step = r.freq === "weekdays" ? 1 : interval;
      if (limit === Infinity && week < from) week = addDays(week, Math.floor(daysBetween(week, from) / (7 * step)) * 7 * step);
      outer: for (; week <= last; week = addDays(week, 7 * step)) {
        for (const day of [...days].sort()) {
          const d = addDays(week, day);
          if (d < ev.start) continue;
          if (d > last) break outer;
          if (!take(d)) break outer;
        }
      }
    } else if (r.freq === "monthly") {
      const day = Number(ev.start.slice(8));
      for (let i = 0; ; i += interval) {
        const base = addMonths(monthStart(ev.start), i);
        if (base > last) break;
        const lastDay = Number(monthEnd(base).slice(8));
        if (day > lastDay) continue;
        if (!take(base.slice(0, 8) + pad(day))) break;
      }
    } else if (r.freq === "yearly") {
      const md = ev.start.slice(5);
      for (let y = Number(ev.start.slice(0, 4)); ; y += interval) {
        const d = `${y}-${md}`;
        if (d > last) break;
        if (md === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) continue;
        if (!take(d)) break;
      }
    }
    return out;
  }

  // Everything visible between two display dates, as occurrences.
  function occurrences(from, to, { includeHidden = false, forReminders = false, source = items.values() } = {}) {
    const tz = displayTz();
    const out = [];
    const visible = new Set(calendars.filter((c) => includeHidden || c.visible !== false).map((c) => c.id));
    const labelFilter = forReminders ? [] : settings.labelFilter || [];
    for (const item of source) {
      if (isDeleted(item) || !visible.has(item.calendarId)) continue;
      const cal = calendarOf(item);
      if (item.kind === "birthday") {
        if (!settings.showBirthdays) continue;
        const md = item.date.slice(5);
        for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
          const d = `${y}-${md}`;
          if (d < from || d > to) continue;
          if (md === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) continue;
          if (item.yearKnown && y < Number(item.date.slice(0, 4))) continue;
          const age = item.yearKnown ? y - Number(item.date.slice(0, 4)) : null;
          out.push({ key: `${item.id}@${d}`, item, cal, kind: "birthday", date: d, endDate: d, allDay: true, title: t("birthdayOf", { name: item.name }), sub: age ? t("turnsAge", { age: num(age) }) : "", color: item.color || cal?.color || "#e91e8c", icon: "cake", startMs: parse(d).getTime() });
        }
        continue;
      }
      if (labelFilter.length && !labelFilter.some((label) => (item.labels || []).includes(label))) continue;
      const span = Math.max(0, daysBetween(item.start, item.end || item.start));
      const own = item.tz || tz;
      const shift = item.allDay || own === tz ? 0 : 1;
      const dates = expandDates(item, addDays(from, -span - shift), addDays(to, shift));
      for (const d of dates) {
        const base = { key: `${item.id}@${d}`, item, cal, kind: "event", occurrence: d, title: item.title || t("untitled"), color: item.color || cal?.color || COLORS[0], icon: { focus: "center_focus_strong", ooo: "flight_takeoff" }[item.type] || "" };
        if (item.allDay) {
          const end = addDays(d, span);
          if (end < from || d > to) continue;
          out.push(Object.assign(base, { date: d, endDate: end, allDay: true, startMs: parse(d).getTime() }));
        } else {
          const startMs = toInstant(d, item.startTime, own);
          const duration = Math.max(0, toInstant(item.end || item.start, item.endTime || item.startTime, own) - toInstant(item.start, item.startTime, own));
          const endMs = startMs + duration;
          const s = zoneParts(startMs, tz), e = zoneParts(endMs, tz);
          let endDate = e.date, endMin = e.min;
          if (endMin === 0 && endDate > s.date) { endDate = addDays(endDate, -1); endMin = 1440; }
          if (endDate < from || s.date > to) continue;
          out.push(Object.assign(base, { date: s.date, endDate, allDay: false, startMin: s.min, endMin, startMs, endMs }));
        }
      }
    }
    if (settings.showHolidays && !forReminders) {
      for (const h of holidaysBetween(from, to)) out.push({ key: `holiday:${h.date}:${h.name}`, kind: "holiday", date: h.date, endDate: h.date, allDay: true, title: h.name, color: "#14a37f", icon: "celebration", startMs: parse(h.date).getTime() });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (b.allDay - a.allDay) || (a.startMin || 0) - (b.startMin || 0) || a.title.localeCompare(b.title)));
  }
  const coversDay = (o, d) => o.date <= d && o.endDate >= d;

  /* ================================================================ holidays, countries, and time zones (server) */
  const holidayCountry = () => {
    if (settings.holidayCountry !== "auto") return settings.holidayCountry;
    const region = (navigator.languages?.[0] || navigator.language || "en-US").split("-")[1]?.toUpperCase();
    const list = countries || ["US", "CA", "GB", "AU", "DE", "FR", "ES", "IT", "PT", "NL", "PL", "SE", "NO", "DK", "FI", "HU", "CZ", "TR", "JP", "KR", "CN", "IN", "BD", "RU", "SA", "MX", "BR"];
    return list.includes(region) ? region : "US";
  };
  const pendingHolidays = new Set();
  let holidayErrorShown = false;
  function holidaysBetween(from, to) {
    const country = holidayCountry();
    const out = [];
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      const key = `${country}:${y}`;
      const cached = holidayCache.get(key) || store.json(`munetiosCalendar:holidays:${key}`, null);
      if (cached) {
        holidayCache.set(key, cached);
        out.push(...cached.filter((h) => h.date >= from && h.date <= to));
      } else loadHolidays(country, y);
    }
    return out;
  }
  async function loadHolidays(country, year) {
    const key = `${country}:${year}`;
    if (pendingHolidays.has(key)) return;
    if (navigator.onLine === false || Date.now() - (failedHolidaysAt.get(key) || 0) < 30000) return;
    pendingHolidays.add(key);
    try {
      const data = await Cloud.request(`/calendar/holidays?country=${encodeURIComponent(country)}&year=${year}`);
      holidayCache.set(key, data.holidays);
      try { store.set(`munetiosCalendar:holidays:${key}`, JSON.stringify(data.holidays)); } catch {}
      render();
    } catch {
      failedHolidaysAt.set(key, Date.now());
      if (navigator.onLine !== false && !holidayErrorShown) { holidayErrorShown = true; UI.toast(t("errorHolidays"), { type: "error" }); }
    } finally { pendingHolidays.delete(key); }
  }
  async function loadCountries() {
    countries ||= store.json("munetiosCalendar:holidayCountries", null);
    if (countries || navigator.onLine === false) return countries || [];
    try {
      countries = (await Cloud.request("/calendar/holidays/countries")).countries;
      store.set("munetiosCalendar:holidayCountries", JSON.stringify(countries));
    } catch { UI.toast(t("errorHolidays"), { type: "error" }); }
    return countries || [];
  }
  async function loadTimeZones() {
    if (timeZones) return timeZones;
    if (navigator.onLine !== false) {
      try {
        timeZones = (await Cloud.request("/calendar/timezones")).zones;
        return timeZones;
      } catch {}
    }
    const ids = new Set(["UTC", BROWSER_TZ, ...(Intl.supportedValuesOf?.("timeZone") || [])]);
    timeZones = [...ids].map((id) => ({ id, label: zoneLabel(id).offset }));
    return timeZones;
  }
  async function pickTimeZone({ value, allowNone, title, onPick }) {
    const zones = await loadTimeZones();
    if (!zones) return;
    const items = zones.map((zone) => ({ value: zone.id, label: zone.id === "UTC" ? "UTC" : zone.id.split("/").pop().replace(/_/g, " "), sub: zone.id.replace(/_/g, " "), trailing: zone.label, keywords: zone.label }));
    const groups = [];
    const top = [];
    if (allowNone) top.push({ value: "", label: t("none"), sub: t("noSecondaryZone") });
    if (title !== t("addClock")) top.push({ value: "auto", label: t("useDeviceZone"), sub: BROWSER_TZ.replace(/_/g, " "), trailing: zoneLabel(BROWSER_TZ).offset });
    if (top.length) groups.push({ label: t("suggested"), items: top });
    groups.push({ label: t("allTimeZones"), items });
    UI.pickFromList({ title: title || t("timeZone"), icon: "public", value, groups, searchLabel: t("searchTimeZones"), emptyText: t("noResults"), closeLabel: t("close"), onPick });
  }

  /* ================================================================ dialogs and menus */
  function dialog({ icon, title, body, actions = "", size = "md", className = "" }) {
    const id = "cal" + Math.random().toString(36).slice(2, 9);
    const modal = document.createElement("div");
    modal.className = `mu-modal cal-dialog ${className}`;
    modal.id = id;
    modal.hidden = true;
    modal.innerHTML = `<div class="mu-dialog ${size === "lg" ? "mu-dialog-lg" : size === "md" ? "mu-dialog-md" : ""}" role="dialog" aria-modal="false" aria-labelledby="${id}T">
      <div class="mu-dialog-header"><div class="mu-dialog-heading"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${esc(icon)}</span></span><h2 id="${id}T">${esc(title)}</h2></div>
      <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-close aria-label="${esc(t("close"))}"><span class="mu-icon" aria-hidden="true">close</span></button></div>
      <div class="cal-dialog-body">${body}</div>${actions ? `<div class="mu-dialog-actions">${actions}</div>` : ""}</div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("select.mu-select").forEach((s) => UI.enhanceSelect(s));
    const api = { modal, q: (s) => modal.querySelector(s), qa: (s) => [...modal.querySelectorAll(s)], close: () => { if (!modal.hidden) UI.closeModal(modal); }, onClose: null };
    new MutationObserver((records, observer) => { if (modal.hidden) { observer.disconnect(); modal.remove(); api.onClose?.(); } }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
    UI.openModal(id);
    return api;
  }
  function confirmDialog({ icon = "help", title, text, confirm, danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const d = dialog({ icon, title, size: "", body: `<p class="cal-dialog-text">${esc(text)}</p>`, actions: `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="button" class="mu-btn ${danger ? "mu-btn-danger" : "mu-btn-primary"}" data-ok>${esc(confirm)}</button>` });
      d.q("[data-ok]").addEventListener("click", () => { answered = true; d.close(); resolve(true); });
      d.onClose = () => { if (!answered) resolve(false); };
    });
  }
  let openMenuEl = null;
  function closeMenu() { openMenuEl?.remove(); openMenuEl = null; }
  function menu(anchor, entries) {
    closeMenu();
    const el = document.createElement("div");
    el.className = "mu-menu mu-menu-context cal-floating-menu";
    el.setAttribute("role", "menu");
    el.innerHTML = entries.map((e, i) => (e === "-" ? '<div class="mu-menu-sep" role="separator"></div>' : `<button type="button" class="mu-menu-item${e.danger ? " is-danger" : ""}${e.selected ? " is-selected" : ""}" role="menuitem" data-i="${i}"><span class="mu-icon" aria-hidden="true">${esc(e.icon || "")}</span><span>${esc(e.label)}</span>${e.selected ? '<span class="mu-icon mu-menu-check" aria-hidden="true">check</span>' : ""}</button>`)).join("");
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(12, Math.min(innerWidth - w - 12, document.dir === "rtl" ? r.left : r.right - w)) + "px";
    el.style.top = (r.bottom + h + 12 > innerHeight ? Math.max(12, r.top - h - 6) : r.bottom + 6) + "px";
    el.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-i]");
      if (!btn) return;
      closeMenu();
      entries[Number(btn.dataset.i)].action();
    });
    openMenuEl = el;
    el.querySelector(".mu-menu-item")?.focus();
    setTimeout(() => document.addEventListener("pointerdown", (event) => { if (!el.contains(event.target)) closeMenu(); }, { once: true }), 0);
  }
  const notify = (message, type = "info") => UI.toast(message, { type });
  const pickerLabels = () => ({ done: t("done"), cancel: t("cancel"), clear: t("clear"), today: t("today"), now: t("now"), previous: t("previousMonth"), next: t("nextMonth"), hour: t("hour"), minute: t("minute"), date: t("date"), time: t("time"), color: t("color"), hex: t("hexColor") });

  /* ================================================================ rendering */
  const VIEWS = ["day", "4day", "week", "month", "year", "agenda", "timeline"];
  const main = $("calView");
  function rangeFor(v = view, d = current) {
    if (v === "day") return [d, d];
    if (v === "4day") return [d, addDays(d, 3)];
    if (v === "week") { const s = startOfWeek(d); return [s, addDays(s, 6)]; }
    if (v === "month") { const s = startOfWeek(monthStart(d)); return [s, addDays(s, 41)]; }
    if (v === "year") return [d.slice(0, 4) + "-01-01", d.slice(0, 4) + "-12-31"];
    if (v === "agenda") return [d, addDays(d, agendaDays - 1)];
    if (v === "timeline") return [monthStart(d), monthEnd(d)];
    return [d, d];
  }
  let agendaDays = 60;
  function render() {
    backgroundReminders?.refresh();
    main.setAttribute("aria-busy", "false");
    renderTitle();
    renderMini();
    renderSidebarLists();
    renderUpNext();
    if (searchQuery) return renderSearch();
    main.className = `cal-main mu-glass cal-view-${view} is-${settings.density}`;
    if (view === "month") renderMonth();
    else if (view === "year") renderYear();
    else if (view === "agenda") renderAgenda();
    else if (view === "timeline") renderTimeline();
    else renderTimeGrid();
  }
  function renderTitle() {
    let title;
    if (searchQuery) title = t("searchResults");
    else if (view === "day") title = formatDate(current, "long");
    else if (view === "year") title = intl(current, { year: "numeric" });
    else if (view === "month" || view === "timeline") title = monthName(current, matchMedia("(width < 768px)").matches ? "short" : "long");
    else { const [a, b] = rangeFor(); title = a.slice(0, 7) === b.slice(0, 7) ? monthName(a) : `${intl(a, { month: "short" })} – ${intl(b, { month: "short", year: "numeric" })}`; }
    $("rangeTitle").textContent = title;
    document.title = `${title} · Munetios Calendar`;
  }

  /* ---------------------------------------------------------- month */
  function renderMonth() {
    const [from, to] = rangeFor();
    const occ = occurrences(from, to);
    const today = todayIso();
    const days = [];
    const start = weekStartDay();
    let order = [0, 1, 2, 3, 4, 5, 6].map((i) => (start + i) % 7);
    if (settings.hideWeekends) order = order.filter((d) => d !== 0 && d !== 6);
    const head = `<div class="cal-month-head" style="--cols:${order.length}">${settings.showWeekNumbers ? `<span class="cal-weeknum-head" aria-hidden="true">${esc(t("weekShort"))}</span>` : ""}${order.map((d) => `<span>${esc(weekdayShort(d))}</span>`).join("")}</div>`;
    for (let w = 0; w < 6; w++) {
      const weekStart = addDays(from, w * 7);
      let row = settings.showWeekNumbers ? `<span class="cal-weeknum" aria-label="${esc(t("weekNumber", { n: isoWeek(weekStart) }))}">${num(isoWeek(weekStart))}</span>` : "";
      for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        if (!order.includes(weekday(d))) continue;
        const list = occ.filter((o) => coversDay(o, d));
        const fav = favorites.some((f) => f.date === d);
        row += `<div class="cal-month-cell${d.slice(0, 7) !== current.slice(0, 7) ? " is-other" : ""}${d === today ? " is-today" : ""}" data-date="${d}" role="gridcell" aria-label="${esc(dayLabel(d))}">
          <button type="button" class="cal-day-num" data-goto="${d}" aria-label="${esc(t("openDay", { date: dayLabel(d) }))}">${num(Number(d.slice(8)))}</button>${fav ? `<span class="mu-icon cal-fav-dot" aria-label="${esc(t("favoriteDay"))}">star</span>` : ""}
          <div class="cal-cell-events mu-scroll">${list.map((o) => chip(o, d)).join("")}</div></div>`;
      }
      days.push(`<div class="cal-month-row" role="row" style="--cols:${order.length}">${row}</div>`);
    }
    main.innerHTML = `<div class="cal-month${settings.showWeekNumbers ? " has-weeknums" : ""}" role="grid" aria-label="${esc(monthName(current))}">${head}${days.join("")}</div>`;
  }
  function chip(o, day) {
    const continues = o.date < day;
    const time = !o.allDay && !continues ? `<span class="cal-chip-time">${esc(formatTime(o.startMin))}</span>` : "";
    const draggable = o.kind === "event" && canEdit(o.cal) && !(o.item.recurrence?.freq && o.item.recurrence.freq !== "none");
    return `<button type="button" class="cal-chip${o.allDay ? " is-allday" : ""}${continues ? " is-continued" : ""}${o.kind === "holiday" ? " is-holiday" : ""}${o.item?.starred ? " is-starred" : ""}" style="--chip:${esc(o.color)}" data-key="${esc(o.key)}"${draggable ? ' draggable="true"' : ""}>
      ${o.icon ? `<span class="mu-icon" aria-hidden="true">${esc(o.icon)}</span>` : ""}${time}<span class="cal-chip-title">${esc(o.title)}</span></button>`;
  }

  /* ---------------------------------------------------------- day, 4 days, week */
  function renderTimeGrid() {
    const [from, to] = rangeFor();
    let days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    if (view === "week" && settings.hideWeekends) days = days.filter((d) => weekday(d) !== 0 && weekday(d) !== 6);
    const occ = occurrences(from, to);
    const today = todayIso();
    const second = settings.secondaryTimeZone;
    const allDay = occ.filter((o) => o.allDay || (o.endMs - o.startMs) >= DAY_MS);
    const timed = occ.filter((o) => !allDay.includes(o));
    const [ws, we] = [toMin(settings.workStart), toMin(settings.workEnd)];
    const hours = Array.from({ length: 24 }, (_, h) => h);
    const offsetDiff = second ? (zoneOffset(Date.now(), second) - zoneOffset(Date.now(), displayTz())) : 0;
    const gutter = `<div class="cal-gutter" aria-hidden="true">${second ? `<div class="cal-gutter-zones"><span>${esc(zoneLabel(second).city)}</span><span>${esc(zoneLabel(displayTz()).city)}</span></div>` : ""}${hours.map((h) => `<div class="cal-hour-label">${second ? `<span class="mu-muted">${esc(formatTime(((h * 60 + offsetDiff) % 1440 + 1440) % 1440))}</span>` : ""}<span>${h ? esc(formatHour(h)) : ""}</span></div>`).join("")}</div>`;
    const columns = days.map((d) => {
      const working = settings.showWorkingHours && (settings.workDays || []).includes(weekday(d));
      const list = layout(timed.filter((o) => coversDay(o, d)).map((o) => ({ o, s: o.date < d ? 0 : o.startMin, e: o.endDate > d ? 1440 : Math.max(o.endMin, (o.date < d ? 0 : o.startMin) + 20) })));
      return `<div class="cal-day-col${d === today ? " is-today" : ""}" data-date="${d}" role="gridcell" aria-label="${esc(dayLabel(d))}">
        ${working ? `<div class="cal-work" style="top:calc(${ws} * var(--min));height:calc(${Math.max(0, we - ws)} * var(--min))" aria-hidden="true"></div>` : ""}
        ${hours.map((h) => `<div class="cal-slot" data-hour="${h}"></div>`).join("")}
        ${list.map(({ o, s, e, col, cols }) => `<button type="button" class="cal-block${o.item?.type === "focus" ? " is-focus" : o.item?.type === "ooo" ? " is-ooo" : ""}" data-key="${esc(o.key)}" style="--chip:${esc(o.color)};top:calc(${s} * var(--min));height:calc(${Math.max(20, e - s)} * var(--min));inset-inline-start:calc(${col} / ${cols} * 100%);width:calc(100% / ${cols} - 4px)"${canEdit(o.cal) && o.kind === "event" && o.item.recurrence?.freq === "none" ? ' draggable="true"' : ""}>
          <span class="cal-block-title">${o.icon ? `<span class="mu-icon" aria-hidden="true">${esc(o.icon)}</span>` : ""}${esc(o.title)}</span><span class="cal-block-time">${esc(formatTime(o.date < d ? 0 : o.startMin))} – ${esc(formatTime(o.endDate > d ? 1440 : o.endMin))}</span>${o.item?.location ? `<span class="cal-block-time">${esc(o.item.location)}</span>` : ""}</button>`).join("")}
        ${d === today ? `<div class="cal-now" style="top:calc(${nowMin()} * var(--min))" aria-label="${esc(t("now"))}"></div>` : ""}</div>`;
    }).join("");
    const head = days.map((d) => `<button type="button" class="cal-col-head${d === today ? " is-today" : ""}" data-goto="${d}"><span class="mu-muted">${esc(intl(d, { weekday: "short" }))}</span><span class="cal-col-day">${num(Number(d.slice(8)))}</span>${favorites.some((f) => f.date === d) ? '<span class="mu-icon cal-fav-dot" aria-hidden="true">star</span>' : ""}</button>`).join("");
    const allDayRow = days.map((d) => `<div class="cal-allday-cell" data-date="${d}">${allDay.filter((o) => coversDay(o, d)).map((o) => chip(o, d)).join("")}</div>`).join("");
    main.innerHTML = `<div class="cal-grid" style="--days:${days.length}">
      <div class="cal-grid-head"><div class="cal-gutter-head">${settings.showWeekNumbers ? `<span class="mu-badge">${esc(t("weekNumber", { n: num(isoWeek(days[0])) }))}</span>` : `<span class="mu-muted cal-tz-chip">${esc(zoneLabel(displayTz()).offset)}</span>`}</div>${head}</div>
      <div class="cal-grid-allday"><div class="cal-gutter-head mu-muted">${esc(t("allDay"))}</div>${allDayRow}</div>
      <div class="cal-grid-body mu-scroll" id="gridBody">${gutter}<div class="cal-cols">${columns}</div></div></div>`;
    const body = $("gridBody");
    const target = days.includes(today) ? Math.max(0, nowMin() - 120) : toMin(settings.workStart) - 60;
    setTimeout(() => { body.scrollTop = Math.max(0, target) * (body.querySelector(".cal-slot")?.offsetHeight || 60) / 60; }, 0);
  }
  // Puts overlapping events side by side.
  function layout(blocks) {
    blocks.sort((a, b) => a.s - b.s || b.e - a.e);
    const out = [];
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      const colsEnd = [];
      for (const b of cluster) {
        let col = colsEnd.findIndex((end) => end <= b.s);
        if (col < 0) { col = colsEnd.length; colsEnd.push(b.e); } else colsEnd[col] = b.e;
        b.col = col;
      }
      cluster.forEach((b) => { b.cols = colsEnd.length; out.push(b); });
      cluster = [];
    };
    for (const b of blocks) {
      if (b.s >= clusterEnd && cluster.length) flush();
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, b.e);
    }
    if (cluster.length) flush();
    return out;
  }

  /* ---------------------------------------------------------- year */
  function renderYear() {
    const year = current.slice(0, 4);
    const occ = occurrences(`${year}-01-01`, `${year}-12-31`);
    const counts = new Map();
    for (const o of occ) for (let d = o.date; d <= o.endDate && d <= `${year}-12-31`; d = addDays(d, 1)) counts.set(d, (counts.get(d) || 0) + 1);
    const today = todayIso();
    const start = weekStartDay();
    const months = Array.from({ length: 12 }, (_, m) => {
      const first = `${year}-${pad(m + 1)}-01`;
      const lead = (weekday(first) - start + 7) % 7;
      const total = Number(monthEnd(first).slice(8));
      let cells = [0, 1, 2, 3, 4, 5, 6].map((i) => `<span class="mu-calendar-dow" aria-hidden="true">${esc(weekdayNarrow((start + i) % 7))}</span>`).join("");
      cells += "<span></span>".repeat(lead);
      for (let day = 1; day <= total; day++) {
        const d = first.slice(0, 8) + pad(day);
        const c = counts.get(d) || 0;
        cells += `<button type="button" class="mu-calendar-day cal-heat${d === today ? " is-today" : ""}" data-goto="${d}" style="--heat:${Math.min(c, 4)}" aria-pressed="false" aria-label="${esc(dayLabel(d))}${c ? ", " + esc(t("eventsCount", { n: num(c) })) : ""}">${num(day)}</button>`;
      }
      return `<section class="mu-calendar cal-year-month"><div class="mu-calendar-head"><button type="button" class="mu-btn mu-btn-ghost cal-year-title" data-month="${first}">${esc(intl(first, { month: "long" }))}</button></div><div class="mu-calendar-grid">${cells}</div></section>`;
    }).join("");
    main.innerHTML = `<div class="cal-year">${months}</div>`;
  }

  /* ---------------------------------------------------------- agenda */
  function renderAgenda() {
    const [from, to] = rangeFor();
    const occ = occurrences(from, to);
    const groups = new Map();
    for (const o of occ) for (let d = o.date < from ? from : o.date; d <= o.endDate && d <= to; d = addDays(d, 1)) { if (!groups.has(d)) groups.set(d, []); groups.get(d).push(o); }
    const today = todayIso();
    const html = [...groups.keys()].sort().map((d) => `<section class="cal-agenda-day${d === today ? " is-today" : ""}"><button type="button" class="cal-agenda-date" data-goto="${d}"><span class="cal-agenda-num">${num(Number(d.slice(8)))}</span><span class="mu-muted">${esc(intl(d, { weekday: "short", month: "short" }))}</span></button><div class="cal-agenda-list">${groups.get(d).map((o) => agendaRow(o, d)).join("")}</div></section>`).join("");
    main.innerHTML = `<div class="cal-agenda">${html || emptyState("event_available", t("agendaEmpty"))}<div class="cal-agenda-more"><button type="button" class="mu-btn" id="agendaMore"><span class="mu-icon" aria-hidden="true">expand_more</span>${esc(t("showMore"))}</button></div></div>`;
    $("agendaMore").addEventListener("click", () => { agendaDays += 60; render(); });
  }
  function agendaRow(o, d) {
    const time = o.allDay ? t("allDay") : `${formatTime(o.date < d ? 0 : o.startMin)} – ${formatTime(o.endDate > d ? 1440 : o.endMin)}`;
    return `<button type="button" class="mu-row cal-agenda-row" data-key="${esc(o.key)}"><span class="cal-dot" style="--chip:${esc(o.color)}" aria-hidden="true"></span><span class="cal-agenda-time mu-muted">${esc(time)}</span><span class="mu-row-info"><span class="mu-row-title">${o.icon ? `<span class="mu-icon" aria-hidden="true">${esc(o.icon)}</span> ` : ""}${esc(o.title)}</span>${o.sub || o.item?.location ? `<span class="mu-row-subtitle">${esc(o.sub || o.item.location)}</span>` : ""}</span>${o.cal ? `<span class="mu-badge">${esc(o.cal.name)}</span>` : ""}</button>`;
  }
  const emptyState = (icon, text) => `<div class="mu-empty"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${esc(icon)}</span></span><span>${esc(text)}</span></div>`;

  /* ---------------------------------------------------------- timeline */
  function renderTimeline() {
    const [from, to] = rangeFor();
    const days = daysBetween(from, to) + 1;
    const occ = occurrences(from, to);
    const today = todayIso();
    const rows = calendars.filter((c) => c.visible !== false).map((cal) => ({ label: cal.name, color: cal.color, list: occ.filter((o) => o.cal?.id === cal.id) }));
    if (settings.showHolidays) rows.push({ label: t("holidays"), color: "#14a37f", list: occ.filter((o) => o.kind === "holiday") });
    const head = Array.from({ length: days }, (_, i) => { const d = addDays(from, i); return `<button type="button" class="cal-tl-day${d === today ? " is-today" : ""}" data-goto="${d}"><span class="mu-muted">${esc(weekdayNarrow(weekday(d)))}</span><span>${num(i + 1)}</span></button>`; }).join("");
    const body = rows.map((row) => {
      const lanes = [];
      const bars = row.list.map((o) => {
        const s = Math.max(0, daysBetween(from, o.date)), e = Math.min(days - 1, daysBetween(from, o.endDate));
        let lane = lanes.findIndex((end) => end < s);
        if (lane < 0) { lane = lanes.length; lanes.push(e); } else lanes[lane] = e;
        return `<button type="button" class="cal-tl-bar" data-key="${esc(o.key)}" style="--chip:${esc(o.color)};grid-column:${s + 1} / ${e + 2};grid-row:${lane + 1}" title="${esc(o.title)}">${esc(o.title)}</button>`;
      }).join("");
      return `<div class="cal-tl-row"><div class="cal-tl-label"><span class="cal-dot" style="--chip:${esc(row.color)}" aria-hidden="true"></span>${esc(row.label)}</div><div class="cal-tl-track" style="--days:${days}">${bars}</div></div>`;
    }).join("");
    main.innerHTML = `<div class="cal-timeline mu-scroll"><div class="cal-tl-row cal-tl-head"><div class="cal-tl-label"></div><div class="cal-tl-track" style="--days:${days}">${head}</div></div>${body}</div>`;
  }

  /* ---------------------------------------------------------- search */
  function renderSearch() {
    const q = searchQuery.toLocaleLowerCase(uiLocale());
    const found = [];
    for (const item of items.values()) {
      if (isDeleted(item)) continue;
      const text = [item.title, item.name, item.location, item.description, item.notes, ...(item.labels || []), ...(item.guests || [])].join(" ").toLocaleLowerCase(uiLocale());
      if (text.includes(q)) found.push(item);
    }
    found.sort((a, b) => String(a.start || a.date).localeCompare(String(b.start || b.date)));
    main.className = "cal-main mu-glass cal-view-search";
    main.innerHTML = `<div class="cal-search-results"><div class="cal-search-head"><span class="mu-muted">${esc(t("resultsFor", { query: searchQuery, n: num(found.length) }))}</span><button type="button" class="mu-btn mu-btn-ghost" id="clearSearch"><span class="mu-icon" aria-hidden="true">close</span>${esc(t("clearSearch"))}</button></div>
      ${found.length ? found.map((item) => { const cal = calendarOf(item); const date = item.start || item.date; return `<button type="button" class="mu-row cal-agenda-row" data-item="${esc(item.id)}"><span class="cal-dot" style="--chip:${esc(item.color || cal?.color || COLORS[0])}" aria-hidden="true"></span><span class="cal-agenda-time mu-muted">${esc(formatDate(date))}</span><span class="mu-row-info"><span class="mu-row-title">${esc(item.kind === "birthday" ? t("birthdayOf", { name: item.name }) : item.title || t("untitled"))}</span>${item.location ? `<span class="mu-row-subtitle">${esc(item.location)}</span>` : ""}</span>${cal ? `<span class="mu-badge">${esc(cal.name)}</span>` : ""}</button>`; }).join("") : emptyState("search_off", t("noResults"))}</div>`;
    $("clearSearch").addEventListener("click", () => { $("searchInput").value = ""; searchQuery = ""; render(); });
  }

  /* ---------------------------------------------------------- sidebar */
  let miniMonth = null;
  function renderMini() {
    const month = miniMonth || current;
    const first = monthStart(month);
    const start = startOfWeek(first);
    const today = todayIso();
    const busy = new Set(occurrences(start, addDays(start, 41)).flatMap((o) => { const out = []; for (let d = o.date; d <= o.endDate; d = addDays(d, 1)) out.push(d); return out; }));
    let cells = [0, 1, 2, 3, 4, 5, 6].map((i) => `<span class="mu-calendar-dow" aria-hidden="true">${esc(weekdayNarrow((weekStartDay() + i) % 7))}</span>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      cells += `<button type="button" class="mu-calendar-day${d.slice(0, 7) !== first.slice(0, 7) ? " is-muted" : ""}${d === today ? " is-today" : ""}${busy.has(d) ? " has-events" : ""}" data-goto="${d}" aria-pressed="${d === current}" aria-label="${esc(dayLabel(d))}">${num(Number(d.slice(8)))}</button>`;
    }
    $("miniCalendar").innerHTML = `<div class="mu-calendar-head"><button type="button" class="mu-icon-btn mu-icon-btn-sm" data-mini="-1" aria-label="${esc(t("previousMonth"))}"><span class="mu-icon" aria-hidden="true">chevron_left</span></button><button type="button" class="mu-btn mu-btn-ghost mu-calendar-title" data-mini-title aria-label="${esc(t("goToDate"))}">${esc(monthName(first))}</button><button type="button" class="mu-icon-btn mu-icon-btn-sm" data-mini="1" aria-label="${esc(t("nextMonth"))}"><span class="mu-icon" aria-hidden="true">chevron_right</span></button></div><div class="mu-calendar-grid">${cells}</div>`;
  }
  function calendarRow(cal) {
    const shared = Boolean(cal.spaceId);
    return `<div class="cal-list-row" data-cal="${esc(cal.id)}">
      <label class="mu-check cal-cal-check" style="--chip:${esc(cal.color)}"><input type="checkbox" ${cal.visible !== false ? "checked" : ""} data-toggle-cal="${esc(cal.id)}"><span class="cal-cal-name">${esc(cal.name)}</span></label>
      ${shared ? `<span class="mu-icon cal-shared-icon" aria-label="${esc(cal.shared ? t("sharedBy", { name: cal.ownerName || "" }) : t("shared"))}">${cal.shared ? "group" : "share"}</span>` : ""}
      <button type="button" class="mu-icon-btn mu-icon-btn-sm" data-cal-menu="${esc(cal.id)}" aria-label="${esc(t("calendarOptions", { name: cal.name }))}"><span class="mu-icon" aria-hidden="true">more_vert</span></button></div>`;
  }
  function renderSidebarLists() {
    $("myCalendars").innerHTML = calendars.filter((c) => !c.shared).map(calendarRow).join("");
    const shared = calendars.filter((c) => c.shared);
    $("sharedCard").hidden = !shared.length;
    $("sharedCalendars").innerHTML = shared.map(calendarRow).join("");
    $("otherCalendars").innerHTML = `
      <div class="cal-list-row"><label class="mu-check" style="--chip:#14a37f"><input type="checkbox" id="toggleHolidays" ${settings.showHolidays ? "checked" : ""}><span class="cal-cal-name">${esc(t("holidaysIn", { country: countryName(holidayCountry()) }))}</span></label><button type="button" class="mu-icon-btn mu-icon-btn-sm" id="holidayCountryBtn" aria-label="${esc(t("holidayCountry"))}"><span class="mu-icon" aria-hidden="true">public</span></button></div>
      <div class="cal-list-row"><label class="mu-check" style="--chip:#e91e8c"><input type="checkbox" id="toggleBirthdays" ${settings.showBirthdays ? "checked" : ""}><span class="cal-cal-name">${esc(t("birthdays"))}</span></label></div>`;
    const labels = [...new Set([...items.values()].filter((i) => !isDeleted(i)).flatMap((i) => i.labels || []))].sort((a, b) => a.localeCompare(b, uiLocale()));
    $("labelsCard").hidden = !labels.length;
    $("labelFilters").innerHTML = labels.map((label) => `<button type="button" class="mu-chip" aria-pressed="${(settings.labelFilter || []).includes(label)}" data-label="${esc(label)}">${esc(label)}</button>`).join("");
    renderClocks();
  }
  function countryName(code) {
    try { return new Intl.DisplayNames([uiLocale()], { type: "region" }).of(code) || code; } catch { return code; }
  }
  function renderClocks() {
    const zones = settings.worldClocks.length ? settings.worldClocks : [displayTz()];
    $("worldClocks").innerHTML = zones.map((zone) => {
      const p = zoneParts(Date.now(), zone);
      const diff = p.date > todayIso() ? ` (${t("tomorrow")})` : p.date < todayIso() ? ` (${t("yesterday")})` : "";
      return `<div class="cal-clock" data-zone="${esc(zone)}"><span>${esc(zoneLabel(zone).city)}<span class="mu-muted"> · ${esc(zoneLabel(zone).offset)}</span></span><time>${esc(formatTime(p.min))}${esc(diff)}</time>${settings.worldClocks.includes(zone) ? `<button type="button" class="mu-icon-btn mu-icon-btn-sm" data-remove-clock="${esc(zone)}" aria-label="${esc(t("removeClock", { name: zoneLabel(zone).city }))}"><span class="mu-icon" aria-hidden="true">close</span></button>` : ""}</div>`;
    }).join("");
  }
  function renderUpNext() {
    const now = Date.now();
    const today = todayIso();
    const next = occurrences(today, addDays(today, 7)).filter((o) => o.kind === "event" && !o.allDay && o.endMs > now).sort((a, b) => a.startMs - b.startMs)[0];
    $("upNext").innerHTML = next
      ? `<button type="button" class="mu-row cal-upnext" data-key="${esc(next.key)}"><span class="cal-dot" style="--chip:${esc(next.color)}" aria-hidden="true"></span><span class="mu-row-info"><span class="mu-row-title">${esc(next.title)}</span><span class="mu-row-subtitle">${esc(next.startMs <= now ? t("happeningNow") : relative(next.startMs))} · ${esc(formatTime(next.startMin))}</span></span></button>`
      : `<p class="mu-muted cal-empty-line">${esc(t("nothingUpNext"))}</p>`;
  }

  /* ================================================================ event and birthday details */
  function findOccurrence(key) {
    if (key.startsWith("holiday:")) { const [, date, ...name] = key.split(":"); return { kind: "holiday", date, title: name.join(":") }; }
    const [id, date] = key.split("@");
    const item = items.get(id);
    if (!item) return null;
    return occurrences(addDays(date, -2), addDays(date, 2), { includeHidden: true }).find((o) => o.key === key) || { item, kind: item.kind, occurrence: date, date, cal: calendarOf(item), title: item.title || item.name };
  }
  function showDetails(key) {
    const o = findOccurrence(key);
    if (!o) return;
    if (o.kind === "holiday") {
      dialog({ icon: "celebration", title: o.title, size: "", body: `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">calendar_today</span>${esc(formatDate(o.date, "long"))}</p><p class="cal-detail-line mu-muted"><span class="mu-icon" aria-hidden="true">public</span>${esc(t("holidaysIn", { country: countryName(holidayCountry()) }))}</p>` });
      return;
    }
    const item = o.item, cal = o.cal || calendarOf(item);
    const editable = canEdit(cal);
    if (item.kind === "birthday") {
      const d = dialog({ icon: "cake", title: t("birthdayOf", { name: item.name }), size: "",
        body: `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">calendar_today</span>${esc(item.yearKnown ? formatDate(item.date, "long") : intl(item.date, { month: "long", day: "numeric" }))}</p>${o.sub ? `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">celebration</span>${esc(o.sub)}</p>` : ""}${item.notes ? `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">notes</span>${esc(item.notes)}</p>` : ""}<p class="cal-detail-line mu-muted"><span class="cal-dot" style="--chip:${esc(cal?.color || "")}" aria-hidden="true"></span>${esc(cal?.name || "")}</p>`,
        actions: editable ? `<button type="button" class="mu-btn mu-btn-danger-outline" data-del><span class="mu-icon" aria-hidden="true">delete</span>${esc(t("delete"))}</button><button type="button" class="mu-btn mu-btn-primary" data-edit><span class="mu-icon" aria-hidden="true">edit</span>${esc(t("edit"))}</button>` : "" });
      d.q("[data-edit]")?.addEventListener("click", () => { d.close(); openBirthdayEditor(item); });
      d.q("[data-del]")?.addEventListener("click", () => { d.close(); trashItem(item); });
      return;
    }
    const when = o.allDay
      ? (o.date === o.endDate ? formatDate(o.date, "long") : `${formatDate(o.date)} – ${formatDate(o.endDate)}`)
      : `${formatDate(o.date, "long")} · ${formatTime(o.startMin)} – ${o.endDate !== o.date ? formatDate(o.endDate) + " " : ""}${formatTime(o.endMin)}`;
    const repeat = item.recurrence?.freq && item.recurrence.freq !== "none" ? recurrenceText(item) : "";
    const reminders = (item.reminders || []).map(reminderLabel).join(", ");
    const d = dialog({ icon: o.icon || "event", title: item.title || t("untitled"), size: "md",
      body: `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">schedule</span>${esc(when)}</p>
        ${!o.allDay && item.tz && item.tz !== displayTz() ? `<p class="cal-detail-line mu-muted"><span class="mu-icon" aria-hidden="true">public</span>${esc(t("inZone", { zone: zoneLabel(item.tz).city, time: `${formatTime(item.startTime)} – ${formatTime(item.endTime)}` }))}</p>` : ""}
        ${repeat ? `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">repeat</span>${esc(repeat)}</p>` : ""}
        ${item.location ? `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">location_on</span>${esc(item.location)}</p>` : ""}
        ${item.url ? `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">videocam</span><a href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${esc(item.url)}</a></p>` : ""}
        ${(item.guests || []).length ? `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">group</span>${esc(item.guests.join(", "))}</p>` : ""}
        ${reminders ? `<p class="cal-detail-line"><span class="mu-icon" aria-hidden="true">notifications</span>${esc(reminders)}</p>` : ""}
        ${(item.labels || []).length ? `<div class="mu-tags">${item.labels.map((l) => `<span class="mu-badge">${esc(l)}</span>`).join("")}</div>` : ""}
        ${item.description ? `<p class="cal-detail-desc">${esc(item.description)}</p>` : ""}
        <p class="cal-detail-line mu-muted"><span class="cal-dot" style="--chip:${esc(o.color)}" aria-hidden="true"></span>${esc(cal?.name || "")}${cal?.shared ? " · " + esc(t("sharedBy", { name: cal.ownerName || "" })) : ""}</p>`,
      actions: `<button type="button" class="mu-icon-btn" data-copy aria-label="${esc(t("copyDetails"))}" title="${esc(t("copyDetails"))}"><span class="mu-icon" aria-hidden="true">content_copy</span></button>
        <button type="button" class="mu-icon-btn" data-ics aria-label="${esc(t("exportEvent"))}" title="${esc(t("exportEvent"))}"><span class="mu-icon" aria-hidden="true">download</span></button>
        ${editable ? `<button type="button" class="mu-icon-btn" data-star aria-pressed="${Boolean(item.starred)}" aria-label="${esc(t(item.starred ? "unstar" : "star"))}" title="${esc(t(item.starred ? "unstar" : "star"))}"><span class="mu-icon" aria-hidden="true">${item.starred ? "star" : "star_outline"}</span></button>
        <button type="button" class="mu-icon-btn" data-dup aria-label="${esc(t("duplicate"))}" title="${esc(t("duplicate"))}"><span class="mu-icon" aria-hidden="true">library_add</span></button>
        <button type="button" class="mu-btn mu-btn-danger-outline" data-del><span class="mu-icon" aria-hidden="true">delete</span>${esc(t("delete"))}</button>
        <button type="button" class="mu-btn mu-btn-primary" data-edit><span class="mu-icon" aria-hidden="true">edit</span>${esc(t("edit"))}</button>` : `<span class="mu-badge">${esc(t("viewOnly"))}</span>`}` });
    d.q("[data-copy]").addEventListener("click", async () => {
      const text = [item.title || t("untitled"), when, item.location, item.url, item.description].filter(Boolean).join("\n");
      try { await navigator.clipboard.writeText(text); notify(t("copied"), "success"); } catch { notify(t("errorGeneric"), "error"); }
    });
    d.q("[data-ics]").addEventListener("click", () => download(`${(item.title || "event").replace(/[\\/:*?"<>|]+/g, "_")}.ics`, toIcs([item]), "text/calendar"));
    d.q("[data-star]")?.addEventListener("click", async () => {
      const updated = Object.assign({}, item, { starred: !item.starred });
      try { await commitItem(updated); d.close(); render(); } catch { notify(t("errorGeneric"), "error"); }
    });
    d.q("[data-dup]")?.addEventListener("click", async () => {
      const copy = Object.assign(structuredClone(item), { id: uid(), title: t("copyOf", { title: item.title || t("untitled") }), createdAt: Date.now(), exceptions: [] });
      try { await commitItem(copy); d.close(); render(); notify(t("eventDuplicated"), "success"); } catch { notify(t("errorCreateEvent"), "error"); }
    });
    d.q("[data-edit]")?.addEventListener("click", async () => {
      d.close();
      if (item.recurrence?.freq && item.recurrence.freq !== "none") {
        const scope = await askScope();
        if (!scope) return;
        if (scope === "one") return openEventEditor(Object.assign(structuredClone(item), { id: uid(), start: o.occurrence, end: addDays(o.occurrence, daysBetween(item.start, item.end || item.start)), recurrence: { freq: "none", interval: 1, byDay: [], until: "", count: 0 }, exceptions: [], seriesId: item.id }), { detachFrom: item, occurrence: o.occurrence, isNew: true });
      }
      openEventEditor(item);
    });
    d.q("[data-del]")?.addEventListener("click", async () => {
      d.close();
      if (item.recurrence?.freq && item.recurrence.freq !== "none") {
        const scope = await askScope();
        if (!scope) return;
        if (scope === "one") {
          const updated = Object.assign({}, item, { exceptions: [...(item.exceptions || []), o.occurrence] });
          try { await commitItem(updated); render(); notify(t("eventDeleted"), "success"); } catch { notify(t("errorGeneric"), "error"); }
          return;
        }
      }
      trashItem(item);
    });
  }
  const safeUrl = (url) => (/^(https?:|mailto:)/i.test(url) ? url : "https://" + url);
  function askScope() {
    return new Promise((resolve) => {
      let picked = null;
      const d = dialog({ icon: "repeat", title: t("recurringEvent"), size: "", body: `<div class="mu-pick-list cal-scope"><label class="mu-radio"><input type="radio" name="scope" value="one" checked><span>${esc(t("scopeThis"))}</span></label><label class="mu-radio"><input type="radio" name="scope" value="all"><span>${esc(t("scopeAll"))}</span></label></div>`,
        actions: `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="button" class="mu-btn mu-btn-primary" data-ok>${esc(t("continue"))}</button>` });
      d.q("[data-ok]").addEventListener("click", () => { picked = d.q("input[name=scope]:checked").value; d.close(); });
      d.onClose = () => resolve(picked);
    });
  }
  function recurrenceText(item) {
    const r = item.recurrence;
    const n = Math.max(1, Number(r.interval) || 1);
    let text = { daily: n > 1 ? t("everyNDays", { n: num(n) }) : t("repeatDaily"), weekdays: t("repeatWeekdays"), weekly: n > 1 ? t("everyNWeeks", { n: num(n) }) : t("repeatWeekly"), monthly: n > 1 ? t("everyNMonths", { n: num(n) }) : t("repeatMonthly"), yearly: n > 1 ? t("everyNYears", { n: num(n) }) : t("repeatYearly") }[r.freq] || "";
    if (r.freq === "weekly" && r.byDay?.length) text += " · " + r.byDay.map((d) => weekdayShort(d)).join(", ");
    if (r.until) text += " · " + t("untilDate", { date: formatDate(r.until) });
    else if (Number(r.count) > 0) text += " · " + t("timesCount", { n: num(r.count) });
    return text;
  }
  const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
  function reminderLabel(min) {
    if (Number(min) === 0) return t("atStart");
    return t("beforeStart", { time: formatDuration(Number(min)) });
  }

  /* ---------------------------------------------------------- trash */
  async function trashItem(item) {
    const updated = Object.assign({}, item, { deletedAt: Date.now() });
    try { await commitItem(updated); render(); notify(t(item.kind === "birthday" ? "birthdayDeleted" : "eventDeleted"), "success"); }
    catch { notify(t("errorGeneric"), "error"); }
  }
  async function purgeOldTrash() {
    const cutoff = Date.now() - 30 * DAY_MS;
    for (const item of [...items.values()]) if (item.deletedAt && item.deletedAt < cutoff && canEdit(calendarOf(item))) { try { await purgeItem(item); } catch {} }
  }
  function openTrash() {
    const list = [...items.values()].filter(isDeleted).sort((a, b) => b.deletedAt - a.deletedAt);
    const d = dialog({ icon: "delete", title: t("recentlyDeleted"), size: "md",
      body: `<p class="mu-muted">${esc(t("trashHelp"))}</p><div class="cal-trash-list">${list.length ? list.map((item) => `<div class="mu-row" data-item="${esc(item.id)}"><span class="mu-row-info"><span class="mu-row-title">${esc(item.kind === "birthday" ? t("birthdayOf", { name: item.name }) : item.title || t("untitled"))}</span><span class="mu-row-subtitle">${esc(formatDate(item.start || item.date))} · ${esc(t("deletedAgo", { time: relative(item.deletedAt) }))}</span></span><button type="button" class="mu-btn" data-restore><span class="mu-icon" aria-hidden="true">restore</span>${esc(t("restore"))}</button><button type="button" class="mu-icon-btn" data-forever aria-label="${esc(t("deleteForever"))}" title="${esc(t("deleteForever"))}"><span class="mu-icon" aria-hidden="true">delete_forever</span></button></div>`).join("") : emptyState("delete", t("trashEmpty"))}</div>`,
      actions: list.length ? `<button type="button" class="mu-btn mu-btn-danger-outline" data-empty><span class="mu-icon" aria-hidden="true">delete_sweep</span>${esc(t("emptyTrash"))}</button>` : "" });
    d.modal.addEventListener("click", async (event) => {
      const row = event.target.closest("[data-item]");
      const item = row && items.get(row.dataset.item);
      if (item && event.target.closest("[data-restore]")) {
        const restored = Object.assign({}, item); delete restored.deletedAt;
        try { await commitItem(restored); row.remove(); render(); notify(t("restored"), "success"); } catch { notify(t("errorGeneric"), "error"); }
      } else if (item && event.target.closest("[data-forever]")) {
        try { await purgeItem(item); row.remove(); render(); } catch { notify(t("errorGeneric"), "error"); }
      }
    });
    d.q("[data-empty]")?.addEventListener("click", async () => {
      if (!(await confirmDialog({ icon: "delete_sweep", title: t("emptyTrash"), text: t("emptyTrashConfirm"), confirm: t("emptyTrash"), danger: true }))) return;
      for (const item of [...items.values()].filter(isDeleted)) { try { await purgeItem(item); } catch {} }
      d.close(); render();
    });
  }

  /* ================================================================ editors */
  const fieldButton = (kind, value, attrs = "") => `<button type="button" class="mu-picker-field cal-field-btn" data-kind="${kind}" data-value="${esc(value)}" ${attrs}><span class="mu-icon" aria-hidden="true">${kind === "date" ? "calendar_today" : kind === "time" ? "schedule" : kind === "zone" ? "public" : "palette"}</span><span class="mu-picker-value">${esc(kind === "date" ? formatDate(value) : kind === "time" ? formatTime(value) : kind === "zone" ? `${zoneLabel(value).city} (${zoneLabel(value).offset})` : value)}</span></button>`;
  function bindFieldButtons(root, onChange) {
    root.addEventListener("click", (event) => {
      const btn = event.target.closest(".cal-field-btn");
      if (!btn) return;
      const set = (value) => {
        if (value === null || value === undefined) return;
        btn.dataset.value = value;
        const kind = btn.dataset.kind;
        btn.querySelector(".mu-picker-value").textContent = kind === "date" ? formatDate(value) : kind === "time" ? formatTime(value) : kind === "zone" ? `${zoneLabel(value).city} (${zoneLabel(value).offset})` : value;
        onChange?.(btn);
      };
      const labels = pickerLabels();
      if (btn.dataset.kind === "date") UI.pickDate({ anchor: btn, value: btn.dataset.value, locale: uiLocale(), firstDay: weekStartDay(), labels, onPick: set });
      if (btn.dataset.kind === "time") UI.pickTime({ anchor: btn, value: btn.dataset.value, locale: uiLocale(), labels, hour12: uses12h(), minuteStep: 1, onPick: set });
      if (btn.dataset.kind === "zone") pickTimeZone({ value: btn.dataset.value, onPick: (value) => set(value === "auto" ? BROWSER_TZ : value) });
    });
  }
  const tagEditor = (name, values, placeholder, type = "text") => `<div class="cal-tag-editor" data-tags="${name}"><div class="mu-tags">${values.map((v) => tagHtml(v)).join("")}</div><div class="mu-input-action"><input class="mu-input" type="${type}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"><button type="button" class="mu-btn" data-add-tag><span class="mu-icon" aria-hidden="true">add</span>${esc(t("add"))}</button></div></div>`;
  const tagHtml = (value) => `<span class="mu-tag" data-value="${esc(value)}">${esc(value)}<button type="button" aria-label="${esc(t("removeItem", { name: value }))}"><span class="mu-icon" aria-hidden="true">close</span></button></span>`;
  function bindTagEditors(root) {
    root.querySelectorAll(".cal-tag-editor").forEach((editor) => {
      const input = editor.querySelector("input");
      const add = () => {
        const value = input.value.trim();
        if (!value) return;
        if (input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { notify(t("errorEmail"), "error"); return; }
        if (![...editor.querySelectorAll(".mu-tag")].some((tag) => tag.dataset.value === value)) editor.querySelector(".mu-tags").insertAdjacentHTML("beforeend", tagHtml(value));
        input.value = "";
      };
      editor.querySelector("[data-add-tag]").addEventListener("click", add);
      input.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); } });
    });
  }
  const tagValues = (root, name) => [...root.querySelectorAll(`[data-tags="${name}"] .mu-tag`)].map((tag) => tag.dataset.value);
  const calendarOptions = (selected) => calendars.filter(canEdit).map((cal) => `<option value="${esc(cal.id)}"${cal.id === selected ? " selected" : ""}>${esc(cal.name)}</option>`).join("");
  const swatches = (selected) => `<div class="mu-swatches cal-swatches" role="group" aria-label="${esc(t("color"))}"><button type="button" class="mu-swatch cal-swatch-default" data-color="" aria-pressed="${!selected}" aria-label="${esc(t("calendarColor"))}"><span class="mu-icon" aria-hidden="true">format_color_reset</span></button>${COLORS.map((c) => `<button type="button" class="mu-swatch" style="background:${c}" data-color="${c}" aria-pressed="${selected === c}" aria-label="${esc(c)}"></button>`).join("")}<button type="button" class="mu-swatch cal-swatch-custom" data-color="custom" aria-pressed="${Boolean(selected && !COLORS.includes(selected))}" aria-label="${esc(t("customColor"))}"${selected && !COLORS.includes(selected) ? ` style="background:${esc(selected)}"` : ""}><span class="mu-icon" aria-hidden="true">colorize</span></button></div>`;
  function bindSwatches(root, onPick) {
    root.querySelectorAll(".cal-swatches").forEach((group) => group.addEventListener("click", (event) => {
      const sw = event.target.closest(".mu-swatch");
      if (!sw) return;
      const choose = (color) => { group.querySelectorAll(".mu-swatch").forEach((s) => s.setAttribute("aria-pressed", String(s === sw))); group.dataset.value = color; onPick?.(color); };
      if (sw.dataset.color === "custom") UI.pickColor({ anchor: sw, value: group.dataset.value || COLORS[0], labels: pickerLabels(), onPick: (color) => { if (!color) return; sw.style.background = color; choose(color); } });
      else choose(sw.dataset.color);
    }));
  }

  function openEventEditor(source, { isNew = false, detachFrom = null, occurrence = null } = {}) {
    const item = structuredClone(source);
    const r = item.recurrence || { freq: "none", interval: 1, byDay: [], until: "", count: 0 };
    const repeatValue = r.freq === "none" ? "none" : (Number(r.interval) > 1 || r.until || Number(r.count) > 0 || (r.freq === "weekly" && r.byDay?.length > 1)) ? "custom" : r.freq;
    const typeSeg = ["event", "focus", "ooo"].map((type) => `<button type="button" data-type="${type}" aria-pressed="${item.type === type}"><span class="mu-icon" aria-hidden="true">${{ event: "event", focus: "center_focus_strong", ooo: "flight_takeoff" }[type]}</span>${esc(t({ event: "typeEvent", focus: "typeFocus", ooo: "typeOutOfOffice" }[type]))}</button>`).join("");
    const d = dialog({ icon: "event", title: t(isNew ? "newEventTitle" : "editEvent"), size: "lg", className: "cal-editor",
      body: `<form class="cal-form" novalidate>
        <label class="mu-field"><span class="mu-field-label">${esc(t("title"))}</span><input class="mu-input cal-title-input" name="title" required value="${esc(item.title)}" placeholder="${esc(t("addTitle"))}"></label>
        <div class="mu-segmented cal-type" role="group" aria-label="${esc(t("eventType"))}">${typeSeg}</div>
        <div class="cal-form-row"><label class="cal-switch-row"><span>${esc(t("allDay"))}</span><span class="mu-switch"><input type="checkbox" name="allDay" ${item.allDay ? "checked" : ""}><span class="mu-switch-track"></span></span></label></div>
        <div class="cal-when">
          <div class="mu-field"><span class="mu-field-label">${esc(t("starts"))}</span><div class="cal-pair">${fieldButton("date", item.start, 'data-field="start"')}<span class="cal-time-wrap">${fieldButton("time", item.startTime, 'data-field="startTime"')}</span></div></div>
          <div class="mu-field"><span class="mu-field-label">${esc(t("ends"))}</span><div class="cal-pair">${fieldButton("date", item.end || item.start, 'data-field="end"')}<span class="cal-time-wrap">${fieldButton("time", item.endTime, 'data-field="endTime"')}</span></div></div>
          <div class="mu-field cal-time-wrap"><span class="mu-field-label">${esc(t("timeZone"))}</span>${fieldButton("zone", item.tz || displayTz(), 'data-field="tz"')}</div>
        </div>
        <div class="mu-alert is-warning cal-conflict" role="status" hidden><span class="mu-icon" aria-hidden="true">event_busy</span><div class="mu-alert-body"><span class="mu-alert-title">${esc(t("conflictTitle"))}</span><span class="mu-muted cal-conflict-list"></span></div></div>
        <div class="cal-form-grid">
          <label class="mu-field"><span class="mu-field-label">${esc(t("repeat"))}</span><select class="mu-select" name="repeat">${["none", "daily", "weekdays", "weekly", "monthly", "yearly", "custom"].map((v) => `<option value="${v}"${v === repeatValue ? " selected" : ""}>${esc(t({ none: "doesNotRepeat", daily: "repeatDaily", weekdays: "repeatWeekdays", weekly: "repeatWeekly", monthly: "repeatMonthly", yearly: "repeatYearly", custom: "repeatCustom" }[v]))}</option>`).join("")}</select></label>
          <label class="mu-field"><span class="mu-field-label">${esc(t("calendar"))}</span><select class="mu-select" name="calendarId">${calendarOptions(item.calendarId)}</select></label>
        </div>
        <fieldset class="cal-custom-repeat" ${repeatValue === "custom" ? "" : "hidden"}><legend class="mu-field-label">${esc(t("repeatCustom"))}</legend>
          <div class="cal-form-grid">
            <label class="mu-field"><span class="mu-field-label">${esc(t("repeatEvery"))}</span><input class="mu-input" type="number" name="interval" min="1" value="${esc(Math.max(1, Number(r.interval) || 1))}"></label>
            <label class="mu-field"><span class="mu-field-label">${esc(t("repeatUnit"))}</span><select class="mu-select" name="unit">${["daily", "weekly", "monthly", "yearly"].map((u) => `<option value="${u}"${(r.freq === u || (u === "weekly" && r.freq === "weekdays")) ? " selected" : ""}>${esc(t({ daily: "unitDays", weekly: "unitWeeks", monthly: "unitMonths", yearly: "unitYears" }[u]))}</option>`).join("")}</select></label>
          </div>
          <div class="mu-chip-grid cal-weekdays" role="group" aria-label="${esc(t("repeatOn"))}">${[0, 1, 2, 3, 4, 5, 6].map((i) => (weekStartDay() + i) % 7).map((day) => `<button type="button" class="mu-chip" data-day="${day}" aria-pressed="${(r.byDay?.length ? r.byDay : [weekday(item.start)]).includes(day)}">${esc(weekdayShort(day))}</button>`).join("")}</div>
          <div class="cal-ends" role="radiogroup" aria-label="${esc(t("repeatEnds"))}"><span class="mu-field-label">${esc(t("repeatEnds"))}</span>
            <div class="cal-end-row"><label class="mu-radio"><input type="radio" name="ends" value="never" ${!r.until && !Number(r.count) ? "checked" : ""}><span>${esc(t("never"))}</span></label></div>
            <div class="cal-end-row"><label class="mu-radio"><input type="radio" name="ends" value="until" ${r.until ? "checked" : ""}><span>${esc(t("onDate"))}</span></label>${fieldButton("date", r.until || addMonths(item.start, 3), 'data-field="until"')}</div>
            <div class="cal-end-row"><label class="mu-radio"><input type="radio" name="ends" value="count" ${Number(r.count) > 0 ? "checked" : ""}><span>${esc(t("afterOccurrences"))}</span></label><input class="mu-input cal-count" type="number" name="count" min="1" value="${esc(Number(r.count) || 10)}" aria-label="${esc(t("afterOccurrences"))}"></div>
          </div>
        </fieldset>
        <label class="mu-field"><span class="mu-field-label">${esc(t("location"))}</span><input class="mu-input" name="location" value="${esc(item.location)}" placeholder="${esc(t("addLocation"))}"></label>
        <label class="mu-field"><span class="mu-field-label">${esc(t("meetingLink"))}</span><input class="mu-input" name="url" type="url" inputmode="url" value="${esc(item.url)}" placeholder="https://"></label>
        <div class="mu-field"><span class="mu-field-label">${esc(t("guests"))}</span>${tagEditor("guests", item.guests || [], t("addGuestEmail"), "email")}</div>
        <div class="mu-field"><span class="mu-field-label">${esc(t("labels"))}</span>${tagEditor("labels", item.labels || [], t("addLabel"))}</div>
        <div class="mu-field"><span class="mu-field-label">${esc(t("reminders"))}</span><div class="cal-reminders">${(item.reminders || []).map(reminderSelect).join("")}</div><button type="button" class="mu-btn mu-btn-ghost" data-add-reminder><span class="mu-icon" aria-hidden="true">add_alert</span>${esc(t("addReminder"))}</button></div>
        <div class="mu-field"><span class="mu-field-label">${esc(t("color"))}</span>${swatches(item.color)}</div>
        <label class="mu-field"><span class="mu-field-label">${esc(t("description"))}</span><textarea class="mu-textarea" name="description" rows="4" placeholder="${esc(t("addDescription"))}">${esc(item.description)}</textarea></label>
      </form>`,
      actions: `${!isNew ? `<button type="button" class="mu-btn mu-btn-danger-outline" data-del><span class="mu-icon" aria-hidden="true">delete</span>${esc(t("delete"))}</button>` : ""}<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="button" class="mu-btn mu-btn-primary" data-save><span class="mu-icon" aria-hidden="true">check</span>${esc(t("save"))}</button>` });
    const form = d.q("form");
    d.q(".cal-swatches").dataset.value = item.color || "";
    const toggleAllDay = () => d.qa(".cal-time-wrap").forEach((el) => { el.hidden = form.allDay.checked; });
    toggleAllDay();
    form.allDay.addEventListener("change", () => { toggleAllDay(); checkConflicts(); });
    d.q(".cal-type").addEventListener("click", (event) => {
      const b = event.target.closest("[data-type]");
      if (!b) return;
      d.qa(".cal-type [data-type]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (b.dataset.type === "ooo" && !form.title.value.trim()) form.title.value = t("typeOutOfOffice");
      if (b.dataset.type === "focus" && !form.title.value.trim()) form.title.value = t("typeFocus");
    });
    form.repeat.addEventListener("change", () => { d.q(".cal-custom-repeat").hidden = form.repeat.value !== "custom"; });
    // Weekday chips only apply to weekly repeats; the end fields follow their radio.
    const syncUnit = () => { d.q(".cal-weekdays").hidden = form.unit.value !== "weekly"; };
    const syncEnds = () => { const ends = form.querySelector("[name=ends]:checked")?.value; d.q("[data-field=until]").disabled = ends !== "until"; form.count.disabled = ends !== "count"; };
    form.unit.addEventListener("change", syncUnit);
    form.querySelectorAll("[name=ends]").forEach((radio) => radio.addEventListener("change", syncEnds));
    d.q(".cal-ends").addEventListener("click", (event) => {
      const row = event.target.closest(".cal-end-row");
      const radio = row?.querySelector("[name=ends]");
      if (radio && !radio.checked && event.target.closest(".cal-field-btn, .cal-count")) { radio.checked = true; syncEnds(); }
    }, true);
    syncUnit();
    syncEnds();
    d.q(".cal-weekdays").addEventListener("click", (event) => { const c = event.target.closest(".mu-chip"); if (c) c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); });
    d.q("[data-add-reminder]").addEventListener("click", () => { d.q(".cal-reminders").insertAdjacentHTML("beforeend", reminderSelect(10)); d.q(".cal-reminders .cal-reminder:last-child select") && UI.enhanceSelect(d.q(".cal-reminders .cal-reminder:last-child select")); });
    d.q(".cal-reminders").addEventListener("click", (event) => { event.target.closest("[data-remove-reminder]")?.closest(".cal-reminder").remove(); });
    bindTagEditors(form);
    bindSwatches(form);
    const value = (field) => d.q(`[data-field="${field}"]`).dataset.value;
    bindFieldButtons(form, (btn) => {
      const f = btn.dataset.field;
      if (f === "start") { const span = daysBetween(item.start, value("end")); item.start = value("start"); setField("end", addDays(item.start, Math.max(0, span))); }
      if (f === "startTime") { const dur = toMin(value("endTime")) - toMin(item.startTime); item.startTime = value("startTime"); if (value("end") === value("start")) setField("endTime", fromMin(Math.min(1439, toMin(item.startTime) + Math.max(15, dur)))); }
      checkConflicts();
    });
    function setField(field, v) { const b = d.q(`[data-field="${field}"]`); b.dataset.value = v; b.querySelector(".mu-picker-value").textContent = field.endsWith("Time") ? formatTime(v) : formatDate(v); }
    function collect() {
      const type = d.q(".cal-type [aria-pressed='true']")?.dataset.type || "event";
      const repeat = form.repeat.value;
      let recurrence = { freq: repeat, interval: 1, byDay: [], until: "", count: 0 };
      if (repeat === "custom") {
        const unit = form.unit.value;
        const ends = form.querySelector("input[name=ends]:checked").value;
        recurrence = { freq: unit, interval: Math.max(1, Number(form.interval.value) || 1), byDay: unit === "weekly" ? d.qa(".cal-weekdays [aria-pressed='true']").map((c) => Number(c.dataset.day)) : [], until: ends === "until" ? value("until") : "", count: ends === "count" ? Math.max(1, Number(form.count.value) || 1) : 0 };
      }
      return Object.assign(item, {
        title: form.title.value.trim(), type, allDay: form.allDay.checked, start: value("start"), end: value("end") < value("start") ? value("start") : value("end"),
        startTime: value("startTime"), endTime: value("endTime"), tz: value("tz"), calendarId: form.calendarId.value, recurrence,
        location: form.location.value.trim(), url: form.url.value.trim(), description: form.description.value.trim(), color: d.q(".cal-swatches").dataset.value || "",
        guests: tagValues(form, "guests"), labels: tagValues(form, "labels"), reminders: d.qa(".cal-reminder select").map((s) => Number(s.value)),
      });
    }
    function checkConflicts() {
      const draft = collect();
      const box = d.q(".cal-conflict");
      if (draft.allDay || draft.type === "ooo") { box.hidden = true; return; }
      const s = toInstant(draft.start, draft.startTime, draft.tz), e = toInstant(draft.end, draft.endTime, draft.tz);
      const clash = occurrences(addDays(draft.start, -1), addDays(draft.end, 1)).filter((o) => o.kind === "event" && !o.allDay && o.item.id !== draft.id && o.item.id !== draft.seriesId && o.startMs < e && o.endMs > s);
      box.hidden = !clash.length;
      d.q(".cal-conflict-list").textContent = clash.map((o) => `${o.title} (${formatTime(o.startMin)})`).join(", ");
    }
    checkConflicts();
    d.q("[data-save]").addEventListener("click", async () => {
      const draft = collect();
      if (!draft.title) { form.title.focus(); notify(t("errorTitle"), "error"); return; }
      if (!draft.allDay && toInstant(draft.end, draft.endTime, draft.tz) <= toInstant(draft.start, draft.startTime, draft.tz)) { notify(t("errorEndBeforeStart"), "error"); return; }
      const btn = d.q("[data-save]");
      btn.disabled = true;
      try {
        if (detachFrom) {
          const parent = Object.assign({}, items.get(detachFrom.id) || detachFrom);
          parent.exceptions = [...new Set([...(parent.exceptions || []), occurrence])];
          await commitItem(parent);
        }
        await commitItem(draft);
        d.close();
        render();
        notify(t(isNew ? "eventCreated" : "eventSaved"), "success");
        scheduleNotifications();
      } catch {
        btn.disabled = false;
        notify(t(isNew ? "errorCreateEvent" : "errorSaveEvent"), "error");
      }
    });
    d.q("[data-del]")?.addEventListener("click", () => { d.close(); trashItem(source); });
    setTimeout(() => form.title.focus(), 30);
  }
  const reminderSelect = (min) => `<div class="cal-reminder"><select class="mu-select" aria-label="${esc(t("reminder"))}">${[...new Set([...REMINDER_OPTIONS, Number(min)])].sort((a, b) => a - b).map((m) => `<option value="${m}"${m === Number(min) ? " selected" : ""}>${esc(reminderLabel(m))}</option>`).join("")}</select><button type="button" class="mu-icon-btn mu-icon-btn-sm" data-remove-reminder aria-label="${esc(t("removeReminder"))}"><span class="mu-icon" aria-hidden="true">close</span></button></div>`;

  function openBirthdayEditor(source, { isNew = false } = {}) {
    const item = structuredClone(source);
    const d = dialog({ icon: "cake", title: t(isNew ? "newBirthdayTitle" : "editBirthday"), size: "md",
      body: `<form class="cal-form" novalidate>
        <label class="mu-field"><span class="mu-field-label">${esc(t("name"))}</span><input class="mu-input" name="name" required value="${esc(item.name)}" placeholder="${esc(t("birthdayNamePlaceholder"))}"></label>
        <div class="mu-field"><span class="mu-field-label">${esc(t("date"))}</span>${fieldButton("date", item.date, 'data-field="date"')}</div>
        <label class="mu-check"><input type="checkbox" name="yearUnknown" ${item.yearKnown ? "" : "checked"}><span>${esc(t("yearUnknown"))}</span></label>
        <label class="mu-field"><span class="mu-field-label">${esc(t("calendar"))}</span><select class="mu-select" name="calendarId">${calendarOptions(item.calendarId)}</select></label>
        <div class="mu-row cal-plain-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("birthdayReminder"))}</span><span class="mu-row-subtitle">${esc(t("birthdayReminderHelp"))}</span></div><label class="mu-switch"><input type="checkbox" name="reminder" ${item.reminder !== false ? "checked" : ""} aria-label="${esc(t("birthdayReminder"))}"><span class="mu-switch-track"></span></label></div>
        <div class="mu-field"><span class="mu-field-label">${esc(t("color"))}</span>${swatches(item.color)}</div>
        <label class="mu-field"><span class="mu-field-label">${esc(t("notes"))}</span><textarea class="mu-textarea" name="notes" rows="3" placeholder="${esc(t("birthdayNotesPlaceholder"))}">${esc(item.notes)}</textarea></label>
      </form>`,
      actions: `${!isNew ? `<button type="button" class="mu-btn mu-btn-danger-outline" data-del><span class="mu-icon" aria-hidden="true">delete</span>${esc(t("delete"))}</button>` : ""}<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="button" class="mu-btn mu-btn-primary" data-save><span class="mu-icon" aria-hidden="true">check</span>${esc(t("save"))}</button>` });
    const form = d.q("form");
    d.q(".cal-swatches").dataset.value = item.color || "";
    bindSwatches(form);
    bindFieldButtons(form);
    d.q("[data-save]").addEventListener("click", async () => {
      Object.assign(item, { name: form.name.value.trim(), date: d.q('[data-field="date"]').dataset.value, yearKnown: !form.yearUnknown.checked, calendarId: form.calendarId.value, reminder: form.reminder.checked, color: d.q(".cal-swatches").dataset.value || "", notes: form.notes.value.trim() });
      if (!item.name) { form.name.focus(); notify(t("errorName"), "error"); return; }
      try { await commitItem(item); d.close(); render(); notify(t(isNew ? "birthdayCreated" : "birthdaySaved"), "success"); }
      catch { notify(t(isNew ? "errorCreateBirthday" : "errorSaveBirthday"), "error"); }
    });
    d.q("[data-del]")?.addEventListener("click", () => { d.close(); trashItem(source); });
    setTimeout(() => form.name.focus(), 30);
  }

  function create(kind, fields = {}) {
    if (!defaultCalendar()) { notify(t(kind === "birthday" ? "errorCreateBirthday" : "errorCreateEvent"), "error"); return; }
    if (kind === "birthday") return openBirthdayEditor(newBirthday(fields), { isNew: true });
    if (kind === "calendar") return openCalendarEditor();
    if (kind === "import") return $("icsInput").click();
    const extra = kind === "focus" ? { type: "focus", title: t("typeFocus") } : kind === "ooo" ? { type: "ooo", title: t("typeOutOfOffice"), allDay: true } : {};
    openEventEditor(newEvent(Object.assign({}, extra, fields)), { isNew: true });
  }

  /* ---------------------------------------------------------- calendars */
  function openCalendarEditor(cal) {
    const isNew = !cal;
    const draft = cal ? Object.assign({}, cal) : { id: uid(), name: "", color: COLORS[calendars.length % COLORS.length], visible: true };
    const d = dialog({ icon: "calendar_add_on", title: t(isNew ? "newCalendar" : "calendarSettings"), size: "",
      body: `<form class="cal-form" novalidate><label class="mu-field"><span class="mu-field-label">${esc(t("name"))}</span><input class="mu-input" name="name" required value="${esc(draft.name)}" placeholder="${esc(t("calendarNamePlaceholder"))}"></label><div class="mu-field"><span class="mu-field-label">${esc(t("color"))}</span>${swatches(draft.color).replace(/<button type="button" class="mu-swatch cal-swatch-default"[\s\S]*?<\/button>/, "")}</div></form>`,
      actions: `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="button" class="mu-btn mu-btn-primary" data-save>${esc(t(isNew ? "create" : "save"))}</button>` });
    const form = d.q("form");
    d.q(".cal-swatches").dataset.value = draft.color;
    bindSwatches(form);
    d.q("[data-save]").addEventListener("click", async () => {
      draft.name = form.name.value.trim();
      draft.color = d.q(".cal-swatches").dataset.value || draft.color;
      if (!draft.name) { form.name.focus(); notify(t("errorName"), "error"); return; }
      draft.updatedAt = Date.now();
      try {
        if (draft.shared) { settings.sharedPrefs[draft.spaceId] = Object.assign({}, settings.sharedPrefs[draft.spaceId], { color: draft.color }); saveSettings({ sharedPrefs: settings.sharedPrefs }); }
        else if (draft.spaceId && draft.role === "owner") await spaces.get(draft.spaceId)?.update((c) => { c.meta = Object.assign({}, c.meta, { name: draft.name, color: draft.color }); });
        if (isNew) calendars.push(draft); else Object.assign(cal, draft);
        await saveCalendars();
        d.close(); render();
        notify(t(isNew ? "calendarCreated" : "calendarSaved"), "success");
      } catch { notify(t(isNew ? "errorCreateCalendar" : "errorGeneric"), "error"); }
    });
    setTimeout(() => form.name.focus(), 30);
  }
  function calendarMenu(anchor, cal) {
    const entries = [
      { icon: "visibility", label: t("showOnly"), action: () => { calendars.forEach((c) => { c.visible = c.id === cal.id; }); saveCalendars(); render(); } },
      { icon: "edit", label: t("calendarSettings"), action: () => openCalendarEditor(cal) },
    ];
    if (!cal.shared) entries.push({ icon: "share", label: t("shareCalendar"), action: () => shareCalendar(cal) });
    else entries.push({ icon: "group", label: t("sharingDetails"), action: () => shareCalendar(cal) });
    entries.push({ icon: "download", label: t("exportCalendar"), action: () => download(`${cal.name.replace(/[\\/:*?"<>|]+/g, "_")}.ics`, toIcs([...items.values()].filter((i) => i.calendarId === cal.id && !isDeleted(i))), "text/calendar") });
    entries.push("-");
    if (cal.shared) entries.push({ icon: "logout", label: t("leaveCalendar"), danger: true, action: () => leaveShared(cal) });
    else if (calendars.filter((c) => !c.shared).length > 1) entries.push({ icon: "delete", label: t("deleteCalendar"), danger: true, action: () => deleteCalendar(cal) });
    menu(anchor, entries);
  }
  async function deleteCalendar(cal) {
    if (!(await confirmDialog({ icon: "delete", title: t("deleteCalendar"), text: t("deleteCalendarConfirm", { name: cal.name }), confirm: t("delete"), danger: true }))) return;
    try {
      if (cal.spaceId) { await spaces.get(cal.spaceId)?.remove(); spaces.delete(cal.spaceId); }
      for (const item of [...items.values()].filter((i) => i.calendarId === cal.id)) { items.delete(item.id); await removeItemRecord(item.id); }
      calendars = calendars.filter((c) => c !== cal);
      await saveCalendars();
      render();
      notify(t("calendarDeleted"), "success");
    } catch { notify(t("errorGeneric"), "error"); }
  }

  /* ================================================================ sharing with collaborators */
  const signedIn = () => Boolean(A?.state?.account);
  function requireSignIn() {
    const d = dialog({ icon: "account_circle", title: t("signInToShareTitle"), size: "", body: `<p class="cal-dialog-text">${esc(t("signInToShare"))}</p>`, actions: `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><a class="mu-btn mu-btn-primary" href="/signin?continue=${encodeURIComponent(location.pathname + location.search)}">${esc(t("signIn"))}</a>` });
    return d;
  }
  function spaceContent(cal) {
    const content = { meta: { name: cal.name, color: cal.color }, items: {} };
    for (const item of items.values()) if (item.calendarId === cal.id) content.items[item.id] = item;
    return content;
  }
  async function shareCalendar(cal) {
    if (!signedIn()) return requireSignIn();
    try {
      let space = cal.spaceId ? spaces.get(cal.spaceId) : null;
      if (cal.spaceId && !space) { space = await Cloud.Space.open(cal.spaceId); attachSpace(cal, space); }
      if (!space) {
        space = await Cloud.Space.create("calendar", spaceContent(cal));
        cal.spaceId = space.id; cal.role = "owner"; cal.updatedAt = Date.now();
        attachSpace(cal, space);
        await saveCalendars();
        renderSidebarLists();
      }
      await Cloud.openShareDialog({
        space, kind: "calendar", title: cal.name, t, me: A.state.account,
        onStop: async () => {
          if (!(await confirmDialog({ icon: "link_off", title: t("stopSharing"), text: t("stopSharingConfirm", { name: cal.name }), confirm: t("stopSharing"), danger: true }))) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
          await space.remove();
          spaces.delete(space.id);
          delete cal.spaceId; delete cal.role; cal.updatedAt = Date.now();
          for (const item of items.values()) if (item.calendarId === cal.id) await persistItem(item);
          await saveCalendars();
          render();
          notify(t("sharingStopped"), "success");
        },
        onLeave: () => leaveShared(cal, true),
      });
    } catch (error) {
      if (error?.code === "cancelled") return;
      notify(error?.code === "offline" ? t("errorOffline") : t("errorShareDialog"), "error");
    }
  }
  async function leaveShared(cal, skipConfirm = false) {
    if (!skipConfirm && !(await confirmDialog({ icon: "logout", title: t("leaveCalendar"), text: t("leaveCalendarConfirm", { name: cal.name }), confirm: t("leave"), danger: true }))) return;
    try {
      const space = spaces.get(cal.spaceId) || await Cloud.Space.open(cal.spaceId);
      await space.remove();
      dropShared(cal);
      notify(t("leftCalendar"), "success");
    } catch (error) { notify(Cloud.errorText(error, t("errorGeneric"), t), "error"); if (skipConfirm) throw error; }
  }
  function dropShared(cal) {
    spaces.get(cal.spaceId)?.stop();
    spaces.delete(cal.spaceId);
    for (const item of [...items.values()].filter((i) => i.calendarId === cal.id)) { items.delete(item.id); deleteRecord(`item:${item.id}`).catch(() => {}); }
    calendars = calendars.filter((c) => c !== cal);
    render();
  }
  // Replaces the cached items of a shared calendar with the space content and listens for changes.
  function attachSpace(cal, space) {
    spaces.set(space.id, space);
    const apply = () => {
      const incoming = space.content.items || {};
      for (const item of [...items.values()]) if (item.calendarId === cal.id && !incoming[item.id]) { items.delete(item.id); deleteRecord(`item:${item.id}`).catch(() => {}); }
      for (const [id, item] of Object.entries(incoming)) { const local = Object.assign({}, item, { calendarId: cal.id }); items.set(id, local); putRecord(`item:${id}`, local).catch(() => {}); }
      if (cal.shared) {
        cal.name = space.content.meta?.name || cal.name;
        cal.color = settings.sharedPrefs[space.id]?.color || space.content.meta?.color || cal.color;
      }
      cal.role = space.role;
    };
    apply();
    space.watch((event) => {
      if (event.type === "content" || event.type === "role") { apply(); render(); }
      if (event.type === "role") notify(t(space.role === "edit" ? "nowCanEdit" : "nowCanView", { name: cal.name }), "info");
      if (event.type === "revoked" || event.type === "deleted") {
        if (cal.shared) { dropShared(cal); notify(t("accessRemoved", { name: cal.name }), "info"); }
      }
    });
  }
  async function loadSharedCalendars() {
    if (!signedIn() || navigator.onLine === false) return;
    let list;
    try { list = await Cloud.Space.list("calendar"); } catch { return; }
    // Calendars I own that are shared: refresh their content.
    for (const cal of calendars.filter((c) => c.spaceId && !c.shared)) {
      if (spaces.has(cal.spaceId)) continue;
      if (!list.some((s) => s.id === cal.spaceId)) { delete cal.spaceId; delete cal.role; continue; }
      try { attachSpace(cal, await Cloud.Space.open(cal.spaceId)); } catch {}
    }
    // Calendars other people shared with me.
    for (const info of list.filter((s) => s.role !== "owner")) {
      let cal = calendars.find((c) => c.spaceId === info.id);
      if (!cal) {
        cal = { id: `space-${info.id}`, name: "", color: COLORS[1], visible: settings.sharedPrefs[info.id]?.visible !== false, spaceId: info.id, role: info.role, ownerName: info.owner?.name || "", shared: true };
        calendars.push(cal);
      }
      if (spaces.has(info.id)) continue;
      try { attachSpace(cal, await Cloud.Space.open(info.id)); } catch { calendars = calendars.filter((c) => c !== cal); }
    }
    for (const cal of calendars.filter((c) => c.shared && !list.some((s) => s.id === c.spaceId))) dropShared(cal);
    render();
  }

  /* ================================================================ Munetios Account sync (end-to-end encrypted) */
  const PREFIX = "munetios-calendar:";
  function registerSync() {
    if (!A?.sync?.register || !settings.accountSync || window.__munetiosCalendarSync) return;
    window.__munetiosCalendarSync = true;
    A.sync.register({
      id: "munetios-calendar", prefix: PREFIX,
      async snapshot() {
        if (!settings.accountSync) return [];
        const out = [{ key: PREFIX + "calendars", data: { calendars: calendars.filter((c) => !c.shared), favorites }, updatedAt: Math.max(0, ...calendars.map((c) => c.updatedAt || 0)) }];
        const { sharedPrefs, labelFilter, view: v, ...prefs } = settings;
        out.push({ key: PREFIX + "settings", data: prefs, updatedAt: settings.updatedAt || 0 });
        for (const item of items.values()) {
          const cal = calendarOf(item);
          if (cal?.spaceId) continue;
          out.push({ key: PREFIX + "item:" + item.id, data: item, updatedAt: item.updatedAt || 0 });
        }
        return out;
      },
      async apply(list, { replace = false } = {}) {
        if (!settings.accountSync) return false;
        let changed = false;
        const incomingItems = new Set();
        for (const entry of list) {
          if (entry.key === PREFIX + "calendars" && entry.data?.calendars) {
            const shared = calendars.filter((c) => c.shared);
            calendars = [...entry.data.calendars, ...shared];
            favorites = Array.isArray(entry.data.favorites) ? entry.data.favorites : favorites;
            await putRecord("calendars", calendars.filter((c) => !c.shared));
            await putRecord("favorites", favorites);
            changed = true;
          } else if (entry.key === PREFIX + "settings" && entry.data) {
            settings = Object.assign({}, settings, entry.data, { sharedPrefs: settings.sharedPrefs, labelFilter: settings.labelFilter, view: settings.view });
            try { store.set(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
            changed = true;
          } else if (entry.key.startsWith(PREFIX + "item:")) {
            const id = entry.key.slice((PREFIX + "item:").length);
            incomingItems.add(id);
            if (entry.deleted) { if (items.has(id)) { items.delete(id); await deleteRecord(`item:${id}`); changed = true; } continue; }
            const local = items.get(id);
            if (!local || (entry.data.updatedAt || 0) >= (local.updatedAt || 0)) { items.set(id, entry.data); await putRecord(`item:${id}`, entry.data); changed = true; }
          }
        }
        if (replace) {
          for (const item of [...items.values()]) if (!incomingItems.has(item.id) && !calendarOf(item)?.spaceId) { items.delete(item.id); await deleteRecord(`item:${item.id}`); changed = true; }
        }
        if (changed) { if (!calendars.some((c) => !c.shared)) calendars.unshift({ id: uid(), name: t("myCalendar"), color: COLORS[0], visible: true, updatedAt: Date.now() }); buildCatalog(); translateUI(); render(); }
        return changed;
      },
    });
  }

  /* ================================================================ notifications */
  let notifyTimer = null;
  const notifiedKey = "munetiosCalendar:notified";
  function reminderEntries(events, earliest) {
    const reminders = [];
    for (const event of events) {
      if (event.kind === "birthday") {
        if (settings.birthdayReminder && event.item.reminder !== false) {
          const at = toInstant(event.date, "09:00", displayTz());
          if (at >= earliest) reminders.push({ key: event.key + ":day", at, title: event.title, body: event.sub || formatDate(event.date, "long") });
        }
      } else if (event.kind === "event") {
        const time = event.allDay ? toInstant(event.date, "09:00", displayTz()) : event.startMs;
        const body = event.allDay ? formatDate(event.date, "long") : `${formatDate(event.date, "long")} · ${formatTime(event.startMin)}`;
        for (const min of event.item.reminders || []) {
          const at = time - min * 60000;
          if (Number.isSafeInteger(at) && at >= earliest) reminders.push({ key: `${event.key}:${min}`, at, title: event.title, body });
        }
      }
    }
    return reminders;
  }

  function backgroundSchedule() {
    const today = todayIso();
    const end = addDays(today, 180);
    const events = occurrences(addDays(today, -1), end, { forReminders: true });
    for (const item of items.values()) {
      if (item.kind === "birthday" || (item.recurrence?.freq && item.recurrence.freq !== "none") ||
          item.start <= addDays(end, -1) || !item.reminders?.length) continue;
      events.push(...occurrences(addDays(item.start, -1), addDays(item.start, 1), { forReminders: true, source: [item] }));
    }
    const reminders = reminderEntries(events, Date.now() - 900000);
    return [...new Map(reminders.map(item => [item.key, item])).values()].sort((a, b) => a.at - b.at);
  }

  const backgroundReminders = window.MunetiosCalendarReminders?.create({
    account: A, reminders: backgroundSchedule,
    writeSchedule: list => putRecord("notification-schedule", list),
    clearSchedule: () => deleteRecord("notification-schedule")
  });

  function scheduleNotifications() {
    clearInterval(notifyTimer);
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const check = () => {
      if (!settings.notifications && !backgroundReminders?.active()) return;
      if (backgroundReminders?.delivering()) return;
      const now = Date.now();
      const seen = store.json(notifiedKey, {});
      const today = todayIso();
      for (const { key, at, title, body } of reminderEntries(occurrences(addDays(today, -1), addDays(today, 8), { forReminders: true }), now - 900000)) {
        if (at > now || seen[key]) continue;
        seen[key] = now;
        const options = { body, tag: "calendar:" + key };
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.getRegistration(location.href).then(worker => {
            if (worker?.active) return worker.showNotification(title, options);
            new Notification(title, options);
          }).catch(() => {});
        } else {
          try { new Notification(title, options); } catch {}
        }
      }
      for (const [key, at] of Object.entries(seen)) if (now - at > 10 * DAY_MS) delete seen[key];
      try { store.set(notifiedKey, JSON.stringify(seen)); } catch {}
    };
    check();
    notifyTimer = setInterval(check, 30000);
  }

  /* ================================================================ import and export */
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const icsEscape = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const fold = (line) => { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = " " + line.slice(74); } out.push(line); return out.join("\r\n"); };
  function toIcs(list) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Munetios//Calendar 4//EN", "CALSCALE:GREGORIAN"];
    for (const item of list) {
      lines.push("BEGIN:VEVENT", `UID:${item.id}@calendar.munetios.com`, `DTSTAMP:${stamp}`);
      if (item.kind === "birthday") {
        lines.push(`DTSTART;VALUE=DATE:${item.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDays(item.date, 1).replace(/-/g, "")}`, "RRULE:FREQ=YEARLY", `SUMMARY:${icsEscape(t("birthdayOf", { name: item.name }))}`);
        if (item.notes) lines.push(`DESCRIPTION:${icsEscape(item.notes)}`);
      } else {
        if (item.allDay) lines.push(`DTSTART;VALUE=DATE:${item.start.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDays(item.end || item.start, 1).replace(/-/g, "")}`);
        else lines.push(`DTSTART;TZID=${item.tz}:${item.start.replace(/-/g, "")}T${item.startTime.replace(":", "")}00`, `DTEND;TZID=${item.tz}:${(item.end || item.start).replace(/-/g, "")}T${item.endTime.replace(":", "")}00`);
        lines.push(`SUMMARY:${icsEscape(item.title)}`);
        if (item.location) lines.push(`LOCATION:${icsEscape(item.location)}`);
        if (item.description) lines.push(`DESCRIPTION:${icsEscape(item.description)}`);
        if (item.url) lines.push(`URL:${icsEscape(item.url)}`);
        if ((item.labels || []).length) lines.push(`CATEGORIES:${item.labels.map(icsEscape).join(",")}`);
        for (const guest of item.guests || []) lines.push(`ATTENDEE:mailto:${guest}`);
        const r = item.recurrence;
        if (r?.freq && r.freq !== "none") {
          const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
          let rule = `RRULE:FREQ=${r.freq === "weekdays" ? "WEEKLY;BYDAY=MO,TU,WE,TH,FR" : r.freq.toUpperCase()}`;
          if (Number(r.interval) > 1) rule += `;INTERVAL=${r.interval}`;
          if (r.freq === "weekly" && r.byDay?.length) rule += `;BYDAY=${r.byDay.map((d) => days[d]).join(",")}`;
          if (r.until) rule += `;UNTIL=${r.until.replace(/-/g, "")}`;
          else if (Number(r.count) > 0) rule += `;COUNT=${r.count}`;
          lines.push(rule);
        }
        if ((item.exceptions || []).length) lines.push(`EXDATE;VALUE=DATE:${item.exceptions.map((x) => x.replace(/-/g, "")).join(",")}`);
        for (const min of item.reminders || []) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(item.title)}`, `TRIGGER:-PT${min}M`, "END:VALARM");
      }
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }
  function parseIcs(text) {
    const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
    const out = [];
    let ev = null, inAlarm = false;
    const unescape = (s) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
    const dateOf = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") { ev = { reminders: [] }; continue; }
      if (line === "BEGIN:VALARM") { inAlarm = true; continue; }
      if (line === "END:VALARM") { inAlarm = false; continue; }
      if (line === "END:VEVENT") { if (ev?.start) out.push(ev); ev = null; continue; }
      if (!ev) continue;
      const at = line.indexOf(":");
      if (at < 0) continue;
      const [name, ...params] = line.slice(0, at).split(";");
      const value = line.slice(at + 1);
      const param = (key) => params.find((p) => p.startsWith(key + "="))?.split("=")[1];
      if (inAlarm) { const m = /^-P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(value); if (name === "TRIGGER" && m) ev.reminders.push((Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)); continue; }
      if (name === "SUMMARY") ev.title = unescape(value);
      else if (name === "DESCRIPTION") ev.description = unescape(value);
      else if (name === "LOCATION") ev.location = unescape(value);
      else if (name === "URL") ev.url = value;
      else if (name === "CATEGORIES") ev.labels = unescape(value).split(",").map((s) => s.trim()).filter(Boolean);
      else if (name === "ATTENDEE") { const mail = value.replace(/^mailto:/i, ""); if (mail.includes("@")) (ev.guests = ev.guests || []).push(mail); }
      else if (name === "DTSTART" || name === "DTEND") {
        const allDay = param("VALUE") === "DATE" || /^\d{8}$/.test(value);
        let date = dateOf(value), time = allDay ? "" : `${value.slice(9, 11)}:${value.slice(11, 13)}`, tz = param("TZID") || (value.endsWith("Z") ? "UTC" : displayTz());
        try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { tz = displayTz(); }
        if (name === "DTSTART") Object.assign(ev, { start: date, startTime: time || "09:00", allDay, tz });
        else { if (allDay) date = addDays(date, -1); Object.assign(ev, { end: date, endTime: time || ev.startTime }); }
      } else if (name === "RRULE") {
        const parts = Object.fromEntries(value.split(";").map((p) => p.split("=")));
        const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
        const freq = (parts.FREQ || "").toLowerCase();
        if (["daily", "weekly", "monthly", "yearly"].includes(freq)) ev.recurrence = { freq, interval: Number(parts.INTERVAL) || 1, byDay: parts.BYDAY ? parts.BYDAY.split(",").map((d) => days.indexOf(d.slice(-2))).filter((d) => d >= 0) : [], until: parts.UNTIL ? dateOf(parts.UNTIL) : "", count: Number(parts.COUNT) || 0 };
      } else if (name === "EXDATE") ev.exceptions = value.split(",").map(dateOf);
    }
    return out;
  }
  async function importIcs(file) {
    let parsed;
    try { parsed = parseIcs(await file.text()); } catch { notify(t("errorImport"), "error"); return; }
    if (!parsed.length) { notify(t("importNothing"), "info"); return; }
    const cal = calendars.find((c) => c.visible !== false && canEdit(c) && !c.shared) || defaultCalendar();
    let count = 0;
    for (const p of parsed) {
      const ev = newEvent(Object.assign({ calendarId: cal.id }, p, { title: p.title || t("untitled"), reminders: p.reminders?.length ? p.reminders : [] }));
      try { await commitItem(ev); count++; } catch {}
    }
    render();
    notify(count === parsed.length ? t("imported", { n: num(count), calendar: cal.name }) : t("errorCreateEvent"), count === parsed.length ? "success" : "error");
  }
  function backup() {
    const data = { app: "munetios-calendar", version: 4, exportedAt: new Date().toISOString(), calendars: calendars.filter((c) => !c.shared), items: [...items.values()].filter((i) => !calendarOf(i)?.shared), favorites, settings };
    download(`munetios-calendar-${todayIso()}.json`, JSON.stringify(data, null, 2), "application/json");
  }
  async function restore(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "munetios-calendar" || !Array.isArray(data.calendars)) throw new Error("invalid");
      const shared = calendars.filter((c) => c.shared);
      calendars = [...data.calendars, ...shared];
      for (const item of data.items || []) if (item?.id) { items.set(item.id, item); await putRecord(`item:${item.id}`, item); }
      favorites = Array.isArray(data.favorites) ? data.favorites : favorites;
      if (data.settings) saveSettings(Object.assign({}, data.settings, { sharedPrefs: settings.sharedPrefs }));
      await saveCalendars();
      buildCatalog(); translateUI(); render();
      notify(t("restoreDone"), "success");
    } catch { notify(t("errorRestore"), "error"); }
  }

  /* ================================================================ quick add (natural language) */
  function parseQuickAdd(text) {
    let rest = ` ${text} `;
    let date = current, time = null, duration = Number(settings.defaultDuration || 60), allDay = false;
    const words = (key) => t(key).toLocaleLowerCase(uiLocale()).split("|").map((w) => w.trim()).filter(Boolean);
    const take = (re) => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], " "); return m; };
    const wordRe = (list) => new RegExp(`\\s(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=\\s)`, "i");
    if (take(wordRe(words("quickToday")))) date = todayIso();
    else if (take(wordRe(words("quickTomorrow")))) date = addDays(todayIso(), 1);
    else {
      const names = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [[intl(addDays("2026-11-01", d), { weekday: "long" }).toLocaleLowerCase(uiLocale()), d], [weekdayShort(d).toLocaleLowerCase(uiLocale()).replace(".", ""), d]]);
      for (const [name, day] of names) {
        const m = take(new RegExp(`\\s${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?(?=\\s)`, "i"));
        if (m) { const today = todayIso(); date = addDays(today, ((day - weekday(today)) + 7) % 7 || 7); break; }
      }
    }
    const isoDate = take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/);
    if (isoDate) date = `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
    const dur = take(/\s(?:for\s|por\s|pour\s|für\s|per\s)?(\d+(?:[.,]\d+)?)\s?(h|hr|hrs|hours?|horas?|heures?|stunden?|ore|m|min|mins|minutes?|minutos?|minuten?|minuti)(?=\s)/i);
    if (dur) { const n = parseFloat(dur[1].replace(",", ".")); duration = /^m/i.test(dur[2]) ? Math.round(n) : Math.round(n * 60); }
    const [am, pm] = meridiemSymbols() || ["NM", "AN"];
    const meridiemRe = `(a\\.?m\\.?|p\\.?m\\.?|nm|an|${am.replace(/\./g, "\\.")}|${pm.replace(/\./g, "\\.")})`;
    const tm = take(new RegExp(`\\s(?:at\\s|a las\\s|à\\s|um\\s|alle\\s|às\\s|@)?(\\d{1,2})(?:[:h.](\\d{2}))?\\s?${meridiemRe}?(?=\\s)`, "i"));
    if (tm && (tm[2] || tm[3] || /(at|a las|à|um|alle|às|@)\s/i.test(tm[0]))) {
      let h = Number(tm[1]);
      const m = Number(tm[2] || 0);
      const mer = (tm[3] || "").toLowerCase().replace(/\./g, "");
      const isPm = mer === "pm" || mer === "an" || mer === pm.toLowerCase().replace(/\./g, "");
      const isAm = mer === "am" || mer === "nm" || mer === am.toLowerCase().replace(/\./g, "");
      if (isPm && h < 12) h += 12;
      if (isAm && h === 12) h = 0;
      if (h < 24 && m < 60) time = `${pad(h)}:${pad(m)}`;
    } else if (tm) rest = rest + tm[0];
    if (!time) allDay = true;
    const title = rest.replace(/\s+/g, " ").trim();
    const startTime = time || "09:00";
    const endMin = toMin(startTime) + duration;
    return { title, start: date, end: endMin >= 1440 ? addDays(date, 1) : date, startTime, endTime: fromMin(endMin % 1440), allDay };
  }

  /* ================================================================ settings dialog */
  function openSettings() {
    const opt = (value, label, selected) => `<option value="${esc(value)}"${String(selected) === String(value) ? " selected" : ""}>${esc(label)}</option>`;
    const sample = "2026-11-21";
    const dateFormats = [["locale", formatDateWith("locale", sample)], ["long", formatDateWith("long", sample)], ["MDY", "11/21/2026"], ["DMY", "21/11/2026"], ["YMD", "2026-11-21"], ["DMY.", "21.11.2026"]];
    const meridiems = [["nm-an", "NM / AN"], ["am-pm", "AM / PM"], ["lower", "am / pm"], ["dotted", "a.m. / p.m."], ["short", "A / P"], ["locale", t("meridiemLocale")], ["custom", t("meridiemCustom")]];
    // 2026-11-01 is a Sunday, so day i of that week has weekday number i.
    const weekStarts = [["auto", t("weekStartAuto")], ...[1, 2, 3, 4, 5, 6, 0].map((day) => [String(day), intl(`2026-11-0${day + 1}`, { weekday: "long" })])];
    const zoneText = (z) => (z === "auto" ? `${t("useDeviceZone")} (${zoneLabel(BROWSER_TZ).city})` : z ? `${zoneLabel(z).city} (${zoneLabel(z).offset})` : t("none"));
    const languageText = settings.language === "system" ? `${t("systemDefault")} (${Cloud.languageName(language(), uiLocale())})` : Cloud.languageName(language(), uiLocale());
    const accountSyncText = signedIn() ? t("syncOnHelp") : t("syncSignedOutHelp");
    const row = (title, sub, control) => `<div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(title)}</span>${sub ? `<span class="mu-row-subtitle">${esc(sub)}</span>` : ""}</div><div class="cal-setting-control">${control}</div></div>`;
    const sw = (name, on, label) => `<label class="mu-switch"><input type="checkbox" data-setting="${name}" ${on ? "checked" : ""} aria-label="${esc(label)}"><span class="mu-switch-track"></span></label>`;
    const sel = (name, options, label) => `<select class="mu-select" data-setting="${name}" aria-label="${esc(label)}">${options.map(([v, l]) => opt(v, l, settings[name])).join("")}</select>`;
    const d = dialog({ icon: "settings", title: t("settings"), size: "lg", className: "cal-settings",
      body: `<div class="mu-tabs" role="tablist">
          <button type="button" role="tab" data-mu-tab="general" aria-selected="true">${esc(t("general"))}</button>
          <button type="button" role="tab" data-mu-tab="formatting" aria-selected="false">${esc(t("formatting"))}</button>
          <button type="button" role="tab" data-mu-tab="views" aria-selected="false">${esc(t("viewOptions"))}</button>
          <button type="button" role="tab" data-mu-tab="notifications" aria-selected="false">${esc(t("notifications"))}</button>
          <button type="button" role="tab" data-mu-tab="data" aria-selected="false">${esc(t("dataAndSync"))}</button>
        </div>
        <div data-mu-panel="general" class="mu-group">
          ${row(t("language"), t("languageHelp"), `<button type="button" class="mu-btn" id="langBtn"><span class="mu-icon" aria-hidden="true">translate</span><span>${esc(languageText)}</span></button>`)}
          ${row(t("theme"), "", `<div class="mu-segmented" role="group" aria-label="${esc(t("theme"))}" id="themeSeg">${["system", "light", "dark"].map((v) => `<button type="button" data-theme-pref="${v}" aria-pressed="${UI.theme.get() === v}">${esc(t({ system: "themeSystem", light: "themeLight", dark: "themeDark" }[v]))}</button>`).join("")}</div>`)}
          ${row(t("defaultView"), "", sel("view", VIEWS.map((v) => [v, viewLabel(v)]), t("defaultView")))}
          ${row(t("defaultDuration"), "", sel("defaultDuration", [15, 30, 45, 60, 90, 120].map((m) => [String(m), formatDuration(m)]), t("defaultDuration")))}
          ${row(t("holidayCountry"), "", `<button type="button" class="mu-btn" id="countryBtn"><span class="mu-icon" aria-hidden="true">public</span><span>${esc(settings.holidayCountry === "auto" ? `${t("automatic")} (${countryName(holidayCountry())})` : countryName(settings.holidayCountry))}</span></button>`)}
        </div>
        <div data-mu-panel="formatting" class="mu-group" hidden>
          ${row(t("timeZone"), t("timeZoneHelp"), `<button type="button" class="mu-btn" id="zoneBtn"><span class="mu-icon" aria-hidden="true">public</span><span>${esc(zoneText(settings.timeZone))}</span></button>`)}
          ${row(t("secondaryTimeZone"), t("secondaryTimeZoneHelp"), `<button type="button" class="mu-btn" id="zone2Btn"><span class="mu-icon" aria-hidden="true">travel_explore</span><span>${esc(zoneText(settings.secondaryTimeZone))}</span></button>`)}
          ${row(t("dateFormat"), "", sel("dateFormat", dateFormats, t("dateFormat")))}
          ${row(t("timeFormat"), "", sel("timeFormat", [["auto", t("timeFormatAuto")], ["12", t("timeFormat12")], ["24", t("timeFormat24")]], t("timeFormat")))}
          ${row(t("meridiemSymbols"), t("meridiemHelp"), sel("meridiem", meridiems, t("meridiemSymbols")))}
          <div class="mu-row cal-custom-meridiem" ${settings.meridiem === "custom" ? "" : "hidden"}><label class="mu-field"><span class="mu-field-label">${esc(t("beforeNoon"))}</span><input class="mu-input" data-setting="meridiemAm" maxlength="12" value="${esc(settings.meridiemAm)}"></label><label class="mu-field"><span class="mu-field-label">${esc(t("afterNoon"))}</span><input class="mu-input" data-setting="meridiemPm" maxlength="12" value="${esc(settings.meridiemPm)}"></label></div>
          ${row(t("weekStart"), "", sel("weekStart", weekStarts, t("weekStart")))}
          <div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("preview"))}</span><span class="mu-row-subtitle" id="formatPreview"></span></div></div>
        </div>
        <div data-mu-panel="views" class="mu-group" hidden>
          ${row(t("showWeekNumbers"), "", sw("showWeekNumbers", settings.showWeekNumbers, t("showWeekNumbers")))}
          ${row(t("hideWeekends"), t("hideWeekendsHelp"), sw("hideWeekends", settings.hideWeekends, t("hideWeekends")))}
          ${row(t("density"), "", sel("density", [["comfortable", t("densityComfortable")], ["spacious", t("densitySpacious")]], t("density")))}
          ${row(t("workingHours"), t("workingHoursHelp"), sw("showWorkingHours", settings.showWorkingHours, t("workingHours")))}
          <div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("workingHoursTime"))}</span></div><div class="cal-pair">${fieldButton("time", settings.workStart, 'data-work="workStart"')}${fieldButton("time", settings.workEnd, 'data-work="workEnd"')}</div></div>
          <div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("workingDays"))}</span></div><div class="mu-chip-grid" id="workDays">${[0, 1, 2, 3, 4, 5, 6].map((i) => (weekStartDay() + i) % 7).map((day) => `<button type="button" class="mu-chip" data-day="${day}" aria-pressed="${settings.workDays.includes(day)}">${esc(weekdayShort(day))}</button>`).join("")}</div></div>
        </div>
        <div data-mu-panel="notifications" class="mu-group" hidden>
          ${row(t("desktopNotifications"), t("desktopNotificationsHelp"), sw("notifications", settings.notifications, t("desktopNotifications")))}
          ${row(t("backgroundReminders"), t("backgroundRemindersHelp"), `<label class="mu-switch"><input id="backgroundReminders" type="checkbox" aria-label="${esc(t("backgroundReminders"))}" ${backgroundReminders?.active() ? "checked" : ""} ${backgroundReminders?.supported() ? "" : "disabled"}><span class="mu-switch-track"></span></label>`)}
          ${row(t("defaultReminder"), "", sel("defaultReminder", REMINDER_OPTIONS.map((m) => [String(m), reminderLabel(m)]), t("defaultReminder")))}
          ${row(t("birthdayReminder"), t("birthdayReminderHelp"), sw("birthdayReminder", settings.birthdayReminder, t("birthdayReminder")))}
        </div>
        <div data-mu-panel="data" class="mu-group" hidden>
          ${row(t("accountSync"), accountSyncText, sw("accountSync", settings.accountSync, t("accountSync")))}
          ${row(t("exportAll"), t("exportAllHelp"), `<button type="button" class="mu-btn" id="exportIcsBtn"><span class="mu-icon" aria-hidden="true">download</span>.ics</button>`)}
          ${row(t("importIcs"), "", `<button type="button" class="mu-btn" id="importIcsBtn"><span class="mu-icon" aria-hidden="true">upload_file</span>${esc(t("import"))}</button>`)}
          ${row(t("backup"), t("backupHelp"), `<button type="button" class="mu-btn" id="backupBtn"><span class="mu-icon" aria-hidden="true">save</span>${esc(t("download"))}</button>`)}
          ${row(t("restore"), t("restoreHelp"), `<button type="button" class="mu-btn" id="restoreBtn"><span class="mu-icon" aria-hidden="true">settings_backup_restore</span>${esc(t("restore"))}</button>`)}
          ${row(t("print"), "", `<button type="button" class="mu-btn" id="printBtn"><span class="mu-icon" aria-hidden="true">print</span>${esc(t("print"))}</button>`)}
          <div class="mu-danger-zone cal-danger"><div class="mu-row-info"><span class="mu-row-title">${esc(t("deleteAllData"))}</span><span class="mu-row-subtitle">${esc(t("deleteAllDataHelp"))}</span></div><button type="button" class="mu-btn mu-btn-danger" id="deleteAllBtn"><span class="mu-icon" aria-hidden="true">delete_forever</span>${esc(t("deleteAllData"))}</button></div>
        </div>` });
    const preview = () => { d.q("#formatPreview").textContent = `${formatDate(todayIso(), "long")} · ${formatTime(nowMin())} · ${zoneLabel(displayTz()).offset}`; };
    preview();
    const applyChange = (name, value) => {
      if (!saveSettings({ [name]: value })) return;
      if (name === "view") { view = value; }
      if (name === "notifications" && value) requestNotifications();
      if (name === "accountSync" && value) registerSync();
      if (name === "meridiem") d.q(".cal-custom-meridiem").hidden = value !== "custom";
      preview();
      render();
      scheduleNotifications();
    };
    d.modal.addEventListener("change", (event) => {
      const el = event.target.closest("[data-setting]");
      if (!el) return;
      const name = el.dataset.setting;
      let value = el.type === "checkbox" ? el.checked : el.value;
      if (["defaultDuration", "defaultReminder"].includes(name)) value = Number(value);
      applyChange(name, value);
    });
    d.q("#backgroundReminders").addEventListener("change", async event => {
      const input = event.currentTarget;
      input.disabled = true;
      try {
        if (input.checked) await backgroundReminders.enable();
        else await backgroundReminders.disable();
      } catch (error) {
        notify(t(error.message === "calendarNotificationsBlocked" ? "notificationsBlocked" : "backgroundRemindersFailed"), "error");
      } finally {
        input.checked = backgroundReminders.active();
        input.disabled = false;
        scheduleNotifications();
      }
    });
    d.modal.addEventListener("input", (event) => { const el = event.target.closest("input.mu-input[data-setting]"); if (el) applyChange(el.dataset.setting, el.value.trim() || DEFAULTS[el.dataset.setting]); });
    d.q("#themeSeg").addEventListener("click", (event) => { const b = event.target.closest("[data-theme-pref]"); if (!b) return; UI.theme.set(b.dataset.themePref); d.qa("#themeSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
    d.q("#langBtn").addEventListener("click", () => Cloud.pickLanguage({ value: settings.language, uiLocale: uiLocale(), t, onPick: (value) => { if (saveSettings({ language: value })) { buildCatalog(); translateUI(); fillViewSelect(); render(); d.close(); openSettings(); } } }));
    d.q("#zoneBtn").addEventListener("click", () => pickTimeZone({ value: settings.timeZone, onPick: (value) => { if (saveSettings({ timeZone: value })) { d.q("#zoneBtn span:last-child").textContent = zoneText(value); preview(); render(); } } }));
    d.q("#zone2Btn").addEventListener("click", () => pickTimeZone({ value: settings.secondaryTimeZone, allowNone: true, title: t("secondaryTimeZone"), onPick: (value) => { const v = value === "auto" ? BROWSER_TZ : value; if (saveSettings({ secondaryTimeZone: v })) { d.q("#zone2Btn span:last-child").textContent = zoneText(v); render(); } } }));
    d.q("#countryBtn").addEventListener("click", () => pickCountry((value) => { if (saveSettings({ holidayCountry: value })) { holidayErrorShown = false; d.q("#countryBtn span:last-child").textContent = value === "auto" ? `${t("automatic")} (${countryName(holidayCountry())})` : countryName(value); render(); } }));
    bindFieldButtons(d.modal, (btn) => { if (btn.dataset.work) applyChange(btn.dataset.work, btn.dataset.value); });
    d.q("#workDays").addEventListener("click", (event) => { const c = event.target.closest(".mu-chip"); if (!c) return; c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); applyChange("workDays", d.qa("#workDays [aria-pressed='true']").map((x) => Number(x.dataset.day))); });
    d.q("#exportIcsBtn").addEventListener("click", () => download(`munetios-calendar-${todayIso()}.ics`, toIcs([...items.values()].filter((i) => !isDeleted(i))), "text/calendar"));
    d.q("#importIcsBtn").addEventListener("click", () => $("icsInput").click());
    d.q("#backupBtn").addEventListener("click", backup);
    d.q("#restoreBtn").addEventListener("click", () => $("backupInput").click());
    d.q("#printBtn").addEventListener("click", () => { d.close(); setTimeout(() => print(), 200); });
    d.q("#deleteAllBtn").addEventListener("click", async () => {
      if (!(await confirmDialog({ icon: "delete_forever", title: t("deleteAllData"), text: t("deleteAllDataConfirm"), confirm: t("deleteAllData"), danger: true }))) return;
      try {
        for (const cal of calendars.filter((c) => c.spaceId && !c.shared)) await spaces.get(cal.spaceId)?.remove().catch(() => {});
        const db = await openDb();
        const tx = db.transaction("records", "readwrite"); tx.objectStore("records").clear();
        await new Promise((resolve) => { tx.oncomplete = resolve; });
        items.clear(); favorites = [];
        calendars = [{ id: uid(), name: t("myCalendar"), color: COLORS[0], visible: true, updatedAt: Date.now() }, ...calendars.filter((c) => c.shared)];
        await saveCalendars();
        d.close(); render();
        notify(t("allDataDeleted"), "success");
      } catch { notify(t("errorGeneric"), "error"); }
    });
  }
  function formatDateWith(format, s) { const old = settings.dateFormat; settings.dateFormat = format; const out = formatDate(s); settings.dateFormat = old; return out; }
  async function pickCountry(onPick) {
    const list = await loadCountries();
    if (!list.length) return;
    UI.pickFromList({ title: t("holidayCountry"), icon: "public", value: settings.holidayCountry, searchLabel: t("searchCountries"), emptyText: t("noResults"), closeLabel: t("close"),
      groups: [{ items: [{ value: "auto", label: t("automatic"), sub: countryName(holidayCountry()) }] }, { label: t("allCountries"), items: list.map((c) => ({ value: c, label: countryName(c), sub: c })).sort((a, b) => a.label.localeCompare(b.label, uiLocale())) }], onPick });
  }
  async function requestNotifications() {
    if (!("Notification" in window)) { notify(t("notificationsUnsupported"), "error"); saveSettings({ notifications: false }); return; }
    const result = await Notification.requestPermission();
    if (result !== "granted") { saveSettings({ notifications: false }); notify(t("notificationsBlocked"), "error"); }
    scheduleNotifications();
  }

  /* ================================================================ insights, favorites, shortcuts, command palette */
  function openInsights() {
    const [from, to] = view === "month" || view === "timeline" ? [monthStart(current), monthEnd(current)] : view === "year" ? rangeFor("year") : rangeFor("week");
    const occ = occurrences(from, to).filter((o) => o.kind === "event");
    const timed = occ.filter((o) => !o.allDay);
    const minutes = timed.reduce((sum, o) => sum + Math.max(0, (o.endMs - o.startMs) / 60000), 0);
    const focus = timed.filter((o) => o.item.type === "focus").reduce((sum, o) => sum + (o.endMs - o.startMs) / 60000, 0);
    const byDay = new Map();
    for (const o of occ) byDay.set(o.date, (byDay.get(o.date) || 0) + 1);
    const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    const byCal = new Map();
    for (const o of timed) byCal.set(o.cal?.id, (byCal.get(o.cal?.id) || 0) + (o.endMs - o.startMs) / 60000);
    const max = Math.max(1, ...byCal.values());
    const stat = (icon, value, label) => `<div class="mu-stat"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${icon}</span></span><div><div class="mu-stat-value">${esc(value)}</div><div class="mu-stat-label">${esc(label)}</div></div></div>`;
    dialog({ icon: "insights", title: t("insights"), className: "cal-insights",
      body: `<p class="mu-muted">${esc(formatDate(from))} – ${esc(formatDate(to))}</p>
        <div class="cal-stats">${stat("event", num(occ.length), t("statEvents"))}${stat("schedule", formatDuration(Math.round(minutes)), t("statBooked"))}${stat("center_focus_strong", formatDuration(Math.round(focus)), t("statFocus"))}${stat("local_fire_department", busiest ? intl(busiest[0], { weekday: "short", day: "numeric", month: "short" }) : "—", t("statBusiest"))}</div>
        <div class="mu-section-label">${esc(t("timeByCalendar"))}</div>
        <ul class="mu-comparison-bars">${[...byCal.entries()].map(([id, m]) => { const cal = calendars.find((c) => c.id === id); return `<li><span>${esc(cal?.name || "")}</span><span class="mu-progress mu-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(m / max * 100)}" aria-label="${esc(cal?.name || "")}"><span style="--mu-meter-value:${Math.round(m / max * 100)}%;--mu-meter-fill:${esc(cal?.color || COLORS[0])}"></span></span><span class="mu-muted">${esc(formatDuration(Math.round(m)))}</span></li>`; }).join("") || `<li class="mu-muted">${esc(t("noTimedEvents"))}</li>`}</ul>` });
  }
  function openFavorites() {
    const list = [...favorites].sort((a, b) => a.date.localeCompare(b.date));
    const isFav = favorites.some((f) => f.date === current);
    const d = dialog({ icon: "star", title: t("favoriteDays"), size: "md",
      body: `<p class="mu-muted">${esc(t("favoritesHelp"))}</p><div class="cal-fav-list">${list.length ? list.map((f) => `<div class="mu-row" data-date="${f.date}"><button type="button" class="mu-row-info cal-link-btn" data-open="${f.date}"><span class="mu-row-title">${esc(formatDate(f.date, "long"))}</span>${f.note ? `<span class="mu-row-subtitle">${esc(f.note)}</span>` : ""}</button><button type="button" class="mu-icon-btn" data-unfav="${f.date}" aria-label="${esc(t("removeFavorite"))}"><span class="mu-icon" aria-hidden="true">star_off</span></button></div>`).join("") : emptyState("star", t("favoritesEmpty"))}</div>`,
      actions: `<button type="button" class="mu-btn mu-btn-primary" data-toggle><span class="mu-icon" aria-hidden="true">${isFav ? "star_off" : "star"}</span>${esc(t(isFav ? "removeFavoriteDay" : "addFavoriteDay", { date: formatDate(current) }))}</button>` });
    d.modal.addEventListener("click", async (event) => {
      const open = event.target.closest("[data-open]");
      if (open) { current = open.dataset.open; view = "day"; d.close(); render(); return; }
      const un = event.target.closest("[data-unfav]");
      if (un) { favorites = favorites.filter((f) => f.date !== un.dataset.unfav); await saveCalendars(); un.closest(".mu-row").remove(); render(); }
    });
    d.q("[data-toggle]").addEventListener("click", async () => {
      favorites = isFav ? favorites.filter((f) => f.date !== current) : [...favorites, { date: current }];
      try { await saveCalendars(); d.close(); render(); notify(t(isFav ? "favoriteRemoved" : "favoriteAdded"), "success"); } catch { notify(t("errorGeneric"), "error"); }
    });
  }
  const SHORTCUTS = [["T", "today"], ["N", "newEvent"], ["B", "newBirthday"], ["Q", "quickAdd"], ["D", "viewDay"], ["X", "view4day"], ["W", "viewWeek"], ["M", "viewMonth"], ["Y", "viewYear"], ["A", "viewAgenda"], ["L", "viewTimeline"], ["J / →", "next"], ["K / ←", "previous"], ["G", "goToDate"], ["/", "search"], ["S", "settings"], ["I", "insights"], ["Ctrl + K", "commandPalette"], ["?", "keyboardShortcuts"]];
  function openShortcuts() {
    dialog({ icon: "keyboard", title: t("keyboardShortcuts"), size: "md", body: `<div class="mu-shortcuts">${SHORTCUTS.map(([keys, label]) => `<div class="mu-shortcut"><span>${esc(t(label))}</span><span>${keys.split(" ").map((k) => (["/", "+"].includes(k) && keys.length > 1 ? esc(k) : `<span class="mu-kbd">${esc(k)}</span>`)).join(" ")}</span></div>`).join("")}</div>` });
  }
  function commands() {
    return [
      { icon: "add", label: t("newEvent"), run: () => create("event") },
      { icon: "cake", label: t("newBirthday"), run: () => create("birthday") },
      { icon: "center_focus_strong", label: t("typeFocus"), run: () => create("focus") },
      { icon: "flight_takeoff", label: t("typeOutOfOffice"), run: () => create("ooo") },
      { icon: "calendar_add_on", label: t("newCalendar"), run: () => create("calendar") },
      { icon: "today", label: t("today"), run: goToday },
      { icon: "event", label: t("goToDate"), run: goToDate },
      ...VIEWS.map((v) => ({ icon: "view_agenda", label: viewLabel(v), run: () => setView(v) })),
      { icon: "insights", label: t("insights"), run: openInsights },
      { icon: "star", label: t("favoriteDays"), run: openFavorites },
      { icon: "delete", label: t("recentlyDeleted"), run: openTrash },
      { icon: "upload_file", label: t("importIcs"), run: () => $("icsInput").click() },
      { icon: "download", label: t("exportAll"), run: () => download(`munetios-calendar-${todayIso()}.ics`, toIcs([...items.values()].filter((i) => !isDeleted(i))), "text/calendar") },
      { icon: "print", label: t("print"), run: () => print() },
      { icon: "translate", label: t("language"), run: () => Cloud.pickLanguage({ value: settings.language, uiLocale: uiLocale(), t, onPick: (value) => { if (saveSettings({ language: value })) { buildCatalog(); translateUI(); fillViewSelect(); render(); } } }) },
      { icon: "public", label: t("timeZone"), run: () => pickTimeZone({ value: settings.timeZone, onPick: (value) => { if (saveSettings({ timeZone: value })) render(); } }) },
      { icon: "dark_mode", label: t("toggleTheme"), run: () => UI.theme.set(document.documentElement.dataset.muTheme === "dark" ? "light" : "dark") },
      { icon: "settings", label: t("settings"), run: openSettings },
      { icon: "keyboard", label: t("keyboardShortcuts"), run: openShortcuts },
    ];
  }
  function openPalette() {
    const all = commands();
    const d = dialog({ icon: "manage_search", title: t("commandPalette"), size: "md", className: "cal-palette",
      body: `<div class="mu-palette"><label class="mu-search"><span class="mu-icon" aria-hidden="true">search</span><input type="search" placeholder="${esc(t("typeCommand"))}" aria-label="${esc(t("typeCommand"))}" autocomplete="off"></label><div class="mu-palette-list" role="listbox"></div></div>` });
    const input = d.q("input"), list = d.q(".mu-palette-list");
    let active = 0, shown = all;
    const draw = () => {
      const q = input.value.trim().toLocaleLowerCase(uiLocale());
      shown = all.filter((c) => !q || c.label.toLocaleLowerCase(uiLocale()).includes(q));
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.innerHTML = shown.map((c, i) => `<div class="mu-palette-item" role="option" aria-selected="${i === active}" data-i="${i}"><span class="mu-icon" aria-hidden="true">${esc(c.icon)}</span>${esc(c.label)}</div>`).join("") || emptyState("search_off", t("noResults"));
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    };
    const run = (i) => { const c = shown[i]; if (!c) return; d.close(); setTimeout(c.run, 30); };
    input.addEventListener("input", () => { active = 0; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); draw(); }
      if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
      if (e.key === "Enter") { e.preventDefault(); run(active); }
    });
    list.addEventListener("click", (e) => { const item = e.target.closest("[data-i]"); if (item) run(Number(item.dataset.i)); });
    draw();
    setTimeout(() => input.focus(), 20);
  }

  /* ================================================================ navigation */
  const viewLabel = (v) => t({ day: "viewDay", "4day": "view4day", week: "viewWeek", month: "viewMonth", year: "viewYear", agenda: "viewAgenda", timeline: "viewTimeline" }[v]);
  function fillViewSelect() {
    const select = $("viewSelect");
    select.innerHTML = VIEWS.map((v) => `<option value="${v}"${v === view ? " selected" : ""}>${esc(viewLabel(v))}</option>`).join("");
    UI.refreshSelect?.(select);
  }
  function setView(v) {
    if (!VIEWS.includes(v)) return;
    view = v;
    searchQuery = ""; $("searchInput").value = "";
    $("viewSelect").value = v; UI.refreshSelect?.($("viewSelect"));
    saveSettings({ view: v }, { quiet: true });
    render();
  }
  function step(dir) {
    if (view === "day") current = addDays(current, dir);
    else if (view === "4day") current = addDays(current, 4 * dir);
    else if (view === "week") current = addDays(current, 7 * dir);
    else if (view === "year") current = addMonths(current, 12 * dir);
    else if (view === "agenda") current = addDays(current, agendaDays * dir);
    else current = addMonths(current, dir);
    miniMonth = null;
    render();
  }
  function goToday() { current = todayIso(); miniMonth = null; render(); }
  function goToDate() { UI.pickDate({ anchor: $("rangeTitle"), value: current, locale: uiLocale(), firstDay: weekStartDay(), labels: pickerLabels(), onPick: (v) => { if (v) { current = v; miniMonth = null; render(); } } }); }

  /* ================================================================ events (DOM) */
  function bind() {
    $("todayBtn").addEventListener("click", goToday);
    $("prevBtn").addEventListener("click", () => step(-1));
    $("nextBtn").addEventListener("click", () => step(1));
    $("rangeTitle").addEventListener("click", goToDate);
    $("viewSelect").addEventListener("change", (e) => setView(e.target.value));
    $("settingsBtn").addEventListener("click", openSettings);
    $("insightsBtn").addEventListener("click", openInsights);
    $("paletteBtn").addEventListener("click", openPalette);
    $("favoritesBtn").addEventListener("click", openFavorites);
    $("navInsightsBtn").addEventListener("click", openInsights);
    $("navPaletteBtn").addEventListener("click", openPalette);
    // On phones the view picker joins the date controls on the second top bar row.
    const phone = matchMedia("(width < 768px)");
    const placeViewPicker = () => {
      const picker = document.querySelector(".cal-view-select");
      if (phone.matches) document.querySelector(".cal-title-capsule").appendChild(picker);
      else document.querySelector(".cal-actions").prepend(picker);
    };
    phone.addEventListener?.("change", () => { placeViewPicker(); renderTitle(); });
    placeViewPicker();
    $("trashBtn").addEventListener("click", openTrash);
    $("shortcutsBtn").addEventListener("click", openShortcuts);
    $("createBtn").addEventListener("click", () => create("event"));
    $("addCalendarBtn").addEventListener("click", () => create("calendar"));
    $("createMenu").addEventListener("click", (e) => { const b = e.target.closest("[data-create]"); if (!b) return; $("createMenu").hidden = true; create(b.dataset.create); });
    // On wide screens the class hides the sidebar. On narrow screens the sidebar starts hidden and the class shows it.
    const narrow = matchMedia("(max-width: 900px)");
    const syncToggle = () => { const on = document.body.classList.contains("is-sidebar-collapsed"); $("sidebarToggle").setAttribute("aria-expanded", String(narrow.matches ? on : !on)); };
    $("sidebarToggle").addEventListener("click", () => { document.body.classList.toggle("is-sidebar-collapsed"); syncToggle(); });
    narrow.addEventListener?.("change", syncToggle);
    syncToggle();
    let searchTimer;
    $("searchInput").addEventListener("input", (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { searchQuery = e.target.value.trim(); render(); }, 160); });
    $("quickAddForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("quickAddInput");
      const text = input.value.trim();
      if (!text) return;
      const parsed = parseQuickAdd(text);
      if (!parsed.title) { notify(t("errorTitle"), "error"); return; }
      const ev = newEvent(parsed);
      try { await commitItem(ev); input.value = ""; current = ev.start; render(); notify(t("quickAdded", { title: ev.title, when: ev.allDay ? formatDate(ev.start) : `${formatDate(ev.start)} ${formatTime(ev.startTime)}` }), "success"); scheduleNotifications(); }
      catch { notify(t("errorCreateEvent"), "error"); }
    });
    $("icsInput").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importIcs(f); });
    $("backupInput").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) restore(f); });
    $("addClockBtn").addEventListener("click", () => pickTimeZone({ value: "", title: t("addClock"), onPick: (zone) => { if (zone && !settings.worldClocks.includes(zone) && saveSettings({ worldClocks: [...settings.worldClocks, zone] })) renderClocks(); } }));

    // Sidebar
    $("calSidebar").addEventListener("click", (e) => {
      const go = e.target.closest("[data-goto]");
      if (go) { current = go.dataset.goto; if (view === "year" || view === "agenda" || view === "timeline") view = "day"; render(); return; }
      const mini = e.target.closest("[data-mini]");
      if (mini) { miniMonth = addMonths(monthStart(miniMonth || current), Number(mini.dataset.mini)); renderMini(); return; }
      if (e.target.closest("[data-mini-title]")) { goToDate(); return; }
      const m = e.target.closest("[data-cal-menu]");
      if (m) { const cal = calendars.find((c) => c.id === m.dataset.calMenu); if (cal) calendarMenu(m, cal); return; }
      const label = e.target.closest("[data-label]");
      if (label) { const l = label.dataset.label; const list = settings.labelFilter.includes(l) ? settings.labelFilter.filter((x) => x !== l) : [...settings.labelFilter, l]; saveSettings({ labelFilter: list }, { quiet: true }); render(); return; }
      const rc = e.target.closest("[data-remove-clock]");
      if (rc) { saveSettings({ worldClocks: settings.worldClocks.filter((z) => z !== rc.dataset.removeClock) }); renderClocks(); return; }
      if (e.target.closest("#holidayCountryBtn")) pickCountry((value) => { if (saveSettings({ holidayCountry: value })) { holidayErrorShown = false; render(); } });
      const key = e.target.closest("[data-key]");
      if (key) showDetails(key.dataset.key);
    });
    $("calSidebar").addEventListener("change", async (e) => {
      const toggle = e.target.closest("[data-toggle-cal]");
      if (toggle) {
        const cal = calendars.find((c) => c.id === toggle.dataset.toggleCal);
        if (!cal) return;
        cal.visible = toggle.checked;
        if (cal.shared) { settings.sharedPrefs[cal.spaceId] = Object.assign({}, settings.sharedPrefs[cal.spaceId], { visible: cal.visible }); saveSettings({ sharedPrefs: settings.sharedPrefs }, { quiet: true }); }
        else { cal.updatedAt = Date.now(); saveCalendars().catch(() => notify(t("errorSettings"), "error")); }
        render();
      }
      if (e.target.id === "toggleHolidays") { saveSettings({ showHolidays: e.target.checked }); render(); }
      if (e.target.id === "toggleBirthdays") { saveSettings({ showBirthdays: e.target.checked }); render(); }
    });

    // Main view
    main.addEventListener("click", (e) => {
      const key = e.target.closest("[data-key]");
      if (key) { showDetails(key.dataset.key); return; }
      const item = e.target.closest("[data-item]");
      if (item) { const it = items.get(item.dataset.item); if (it) { current = it.start || it.date; searchQuery = ""; $("searchInput").value = ""; render(); } return; }
      const go = e.target.closest("[data-goto]");
      if (go) { current = go.dataset.goto; setView("day"); return; }
      const month = e.target.closest("[data-month]");
      if (month) { current = month.dataset.month; setView("month"); return; }
      const slot = e.target.closest(".cal-slot");
      if (slot) {
        const col = slot.closest("[data-date]");
        const h = Number(slot.dataset.hour);
        const rect = slot.getBoundingClientRect();
        const minute = (e.clientY - rect.top) / rect.height >= 0.5 ? 30 : 0;
        create("event", { start: col.dataset.date, end: col.dataset.date, startTime: `${pad(h)}:${pad(minute)}`, endTime: fromMin(Math.min(1439, h * 60 + minute + Number(settings.defaultDuration || 60))) });
        return;
      }
      const cell = e.target.closest(".cal-month-cell, .cal-allday-cell");
      if (cell && !e.target.closest("button")) create("event", { start: cell.dataset.date, end: cell.dataset.date, allDay: cell.classList.contains("cal-allday-cell") });
    });
    // Drag and drop to reschedule
    main.addEventListener("dragstart", (e) => {
      const el = e.target.closest("[data-key][draggable]");
      if (!el) return;
      e.dataTransfer.setData("text/plain", el.dataset.key);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("is-dragging");
    });
    main.addEventListener("dragend", (e) => e.target.closest?.("[data-key]")?.classList.remove("is-dragging"));
    main.addEventListener("dragover", (e) => {
      const target = e.target.closest(".cal-month-cell, .cal-day-col, .cal-allday-cell");
      if (!target) return;
      e.preventDefault();
      main.querySelectorAll(".is-drop").forEach((x) => x !== target && x.classList.remove("is-drop"));
      target.classList.add("is-drop");
    });
    main.addEventListener("dragleave", (e) => e.target.closest?.(".is-drop")?.classList.remove("is-drop"));
    main.addEventListener("drop", async (e) => {
      const target = e.target.closest(".cal-month-cell, .cal-day-col, .cal-allday-cell");
      main.querySelectorAll(".is-drop").forEach((x) => x.classList.remove("is-drop"));
      if (!target) return;
      e.preventDefault();
      const key = e.dataTransfer.getData("text/plain");
      const [id] = key.split("@");
      const item = items.get(id);
      if (!item || item.kind !== "event") return;
      const updated = structuredClone(item);
      const span = daysBetween(item.start, item.end || item.start);
      const newDate = target.dataset.date;
      if (target.classList.contains("cal-day-col")) {
        const rect = target.getBoundingClientRect();
        const minutes = Math.max(0, Math.min(1425, Math.round(((e.clientY - rect.top) / rect.height) * 1440 / 15) * 15));
        const duration = toInstant(item.end || item.start, item.endTime, item.tz || displayTz()) - toInstant(item.start, item.startTime, item.tz || displayTz());
        const startMs = toInstant(newDate, fromMin(minutes), displayTz());
        const s = zoneParts(startMs, item.tz || displayTz()), en = zoneParts(startMs + duration, item.tz || displayTz());
        Object.assign(updated, { allDay: false, start: s.date, startTime: fromMin(s.min), end: en.date, endTime: fromMin(en.min) });
      } else {
        const shift = daysBetween(item.allDay ? item.start : zoneParts(toInstant(item.start, item.startTime, item.tz || displayTz()), displayTz()).date, newDate);
        Object.assign(updated, { start: addDays(item.start, shift), end: addDays(item.start, shift + span), allDay: target.classList.contains("cal-allday-cell") ? true : updated.allDay });
      }
      try { await commitItem(updated); render(); notify(t("eventMoved", { date: formatDate(newDate) }), "success"); } catch { notify(t("errorSaveEvent"), "error"); }
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest("input, textarea, select, [contenteditable], .mu-modal, .mu-menu, .mu-date-picker, .mu-time-picker, .mu-color-picker")) return;
      if (document.querySelector(".mu-modal:not([hidden])")) return;
      const map = { t: goToday, n: () => create("event"), b: () => create("birthday"), q: () => $("quickAddInput").focus(), d: () => setView("day"), x: () => setView("4day"), w: () => setView("week"), m: () => setView("month"), y: () => setView("year"), a: () => setView("agenda"), l: () => setView("timeline"), j: () => step(1), k: () => step(-1), arrowright: () => step(document.dir === "rtl" ? -1 : 1), arrowleft: () => step(document.dir === "rtl" ? 1 : -1), g: goToDate, "/": () => $("searchInput").focus(), s: openSettings, i: openInsights, "?": openShortcuts };
      const fn = map[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(); }
    });
    let rateNoticeAt = 0;
    addEventListener("munetios-cloud-rate-limited", (e) => {
      if (Date.now() - rateNoticeAt < 20000) return;
      rateNoticeAt = Date.now();
      notify(Cloud.errorText({ code: "rateLimited", body: e.detail }, t("errorGeneric"), t), "error");
    });
    document.addEventListener("mu-theme", () => render());
    window.addEventListener("storage", (e) => { if (e.key === SETTINGS_KEY) { settings = Object.assign({}, DEFAULTS, store.json(SETTINGS_KEY, {})); buildCatalog(); translateUI(); render(); } });
    setInterval(() => { renderClocks(); renderUpNext(); const line = main.querySelector(".cal-now"); if (line) line.style.top = `calc(${nowMin()} * var(--min))`; }, 30000);
    A?.on?.(() => {
      if (!signedIn() || A.state.offline) { loadedShared = false; return; }
      if (!loadedShared) { loadedShared = true; loadSharedCalendars(); }
    });
  }
  let loadedShared = false;

  /* ================================================================ start */
  async function start() {
    buildCatalog();
    translateUI();
    fillViewSelect();
    try {
      await migrateLegacy();
      const rows = await allRecords();
      for (const [id, value] of rows) {
        if (id === "calendars") calendars = value;
        else if (id === "favorites") favorites = value;
        else if (id.startsWith("item:")) items.set(id.slice(5), value);
      }
    } catch {
      notify(t("errorLoad"), "error");
    }
    if (!calendars.length) { calendars = [{ id: uid(), name: t("myCalendar"), color: COLORS[0], visible: true, updatedAt: Date.now() }]; saveCalendars().catch(() => {}); }
    for (const item of items.values()) if (!calendars.some((c) => c.id === item.calendarId) && !item.calendarId?.startsWith("space-")) item.calendarId = calendars[0].id;
    bind();
    render();
    loadCountries();
    purgeOldTrash();
    registerSync();
    scheduleNotifications();
    A?.on?.(() => backgroundReminders?.refresh());
    window.addEventListener("online", () => {
      backgroundReminders?.refresh();
      failedHolidaysAt.clear();
      holidayErrorShown = false;
      render();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") backgroundReminders?.refresh();
    });
    if (signedIn() && !A.state.offline) { loadedShared = true; loadSharedCalendars(); }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
