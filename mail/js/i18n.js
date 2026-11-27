// Translations and locale-aware formatting for Munetios Mail.
// Catalogs come from /mail/strings.js (all 17 Munetios locales). Missing strings fall back to American English,
// so a translation key is never shown.
const catalogs = window.MunetiosMailTranslations || {};
const Locales = window.MunetiosLocales;
const english = catalogs["en-US"] || {};
let locale = "en-US";
let dict = english;
let preference = "system";
let hourCycle = "auto";
let weekStart = "auto";

export function resolveLocale(pref) {
    let saved = "";
    try { saved = localStorage.getItem("munetiosLanguage") || ""; } catch { /* storage blocked */ }
    const wanted = pref && pref !== "system" ? pref : saved;
    return (Locales && ((wanted && Locales.resolve(wanted)) || Locales.detect())) || "en-US";
}

export function setLanguage(pref = preference, options = {}) {
    preference = pref || "system";
    hourCycle = options.timeFormat || hourCycle;
    weekStart = options.weekStart || weekStart;
    locale = resolveLocale(preference);
    dict = { ...english, ...(catalogs[locale] || {}) };
    document.documentElement.lang = locale;
    document.documentElement.dir = Locales?.LOCALES?.find?.(item => item.code === locale)?.dir || (locale === "ar" ? "rtl" : "ltr");
    translateDom(document);
    return locale;
}

export const currentLocale = () => locale;
export const isRtl = () => document.documentElement.dir === "rtl";

const pluralRules = new Map();
// Plural forms: a key with an "_one" variant uses it when the count is grammatically singular in this locale.
function pluralKey(key, vars) {
    if (!vars || vars.count === undefined) return key;
    const count = typeof vars.count === "number" ? vars.count : Number(String(vars.count).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(count) || String(vars.count).trim() === "") return key;
    if (!pluralRules.has(locale)) pluralRules.set(locale, new Intl.PluralRules(locale));
    return pluralRules.get(locale).select(count) === "one" && (typeof dict[key + "_one"] === "string" || typeof english[key + "_one"] === "string") ? key + "_one" : key;
}

export function t(key, vars) {
    key = pluralKey(key, vars);
    let text = dict[key];
    if (typeof text !== "string") text = english[key];
    if (typeof text !== "string") text = "";
    if (vars) text = text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
    return text;
}

export function translateDom(root) {
    root.querySelectorAll("[data-label]").forEach(node => { node.textContent = t(node.dataset.label); });
    root.querySelectorAll("[data-label-aria]").forEach(node => { node.setAttribute("aria-label", t(node.dataset.labelAria)); if (node.hasAttribute("data-tip")) node.title = t(node.dataset.labelAria); });
    root.querySelectorAll("[data-label-placeholder]").forEach(node => { node.placeholder = t(node.dataset.labelPlaceholder); });
    root.querySelectorAll("[data-label-resize]").forEach(node => { node.dataset.muResizeLabel = t(node.dataset.labelResize); });
}

const numberFormat = new Map();
export function formatNumber(value, options = {}) {
    const key = locale + JSON.stringify(options);
    if (!numberFormat.has(key)) numberFormat.set(key, new Intl.NumberFormat(locale, options));
    return numberFormat.get(key).format(value);
}

// Decimal units to match the 20 GB (20,000,000,000 bytes) quota: "4.8 GB of 20 GB".
export function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    const units = [["byte", 1], ["kilobyte", 1e3], ["megabyte", 1e6], ["gigabyte", 1e9], ["terabyte", 1e12]];
    let [unit, size] = units[0];
    for (const entry of units) if (value >= entry[1]) [unit, size] = entry;
    const amount = value / size;
    const digits = unit === "byte" ? 0 : amount < 10 ? 1 : 0;
    try { return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: digits }).format(amount); }
    catch { return `${amount.toFixed(digits)} ${["B", "KB", "MB", "GB", "TB"][units.findIndex(item => item[0] === unit)]}`; }
}

const isEnglish = () => locale.startsWith("en");
// Munetios uses NM and AN instead of AM and PM.
function periods(text) {
    return isEnglish() ? text.replace(/\bAM\b/g, "NM").replace(/\bPM\b/g, "AN").replace(/\ba\.m\./gi, "NM").replace(/\bp\.m\./gi, "AN") : text;
}

function timeOptions(extra = {}) {
    const options = { ...extra };
    if (hourCycle === "12") options.hour12 = true;
    if (hourCycle === "24") options.hourCycle = "h23";
    return options;
}

export function formatTime(ms) { return periods(new Intl.DateTimeFormat(locale, timeOptions({ hour: "numeric", minute: "2-digit" })).format(ms)); }
export function formatDate(ms, options = { dateStyle: "medium" }) { return periods(new Intl.DateTimeFormat(locale, timeOptions(options)).format(ms)); }
export function formatDateTime(ms) { return periods(new Intl.DateTimeFormat(locale, timeOptions({ dateStyle: "full", timeStyle: "short" })).format(ms)); }

// List dates: time today, weekday this week, month and day this year, full date otherwise.
export function formatListDate(ms) {
    const date = new Date(ms);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return formatTime(ms);
    const days = (today - date) / 86_400_000;
    if (days < 6 && days > 0) return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
    if (date.getFullYear() === today.getFullYear()) return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
    return new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(date);
}

export function formatRelative(ms) {
    const diff = ms - Date.now();
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const abs = Math.abs(diff);
    if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
    if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
    if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
    return rtf.format(Math.round(diff / 86_400_000), "day");
}

// Localized weekday name; 0 is Sunday. 4 January 2026 was a Sunday.
export function weekdayName(day) {
    try { return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + (Number(day) % 7)))); }
    catch { return String(day); }
}

export function firstDayOfWeek() {
    if (weekStart !== "auto") return Number(weekStart);
    try { const info = new Intl.Locale(locale).weekInfo || new Intl.Locale(locale).getWeekInfo?.(); if (info) return info.firstDay % 7; } catch { /* unsupported */ }
    return 0;
}

export function languageName(code) {
    return Locales?.LOCALES?.find?.(item => item.code === code)?.name || code;
}
export const localeList = () => Locales?.LOCALES || [{ code: "en-US", name: "English (United States)" }];
