import { translations } from "./languages/index.js";

export { translations };

const LOCALE_STORAGE_KEY = "munetiosLanguage";
const SECONDARY_LOCALE_STORAGE_KEY = "munetios.locale";
const LOCALE_COOKIE_KEY = "munetios_locale";
const LOCALE_ALIASES = {
  ar: "ar-SA",
  da: "da-DK",
  de: "de-DE",
  en: "en",
  "en-US": "en",
  el: "el-GR",
  es: "es",
  "es-EC": "es-EQ",
  fr: "fr-FR",
  he: "he-IL",
  hi: "hi-IN",
  id: "id-ID",
  it: "it-IT",
  ja: "ja-JP",
  "ja-JP": "ja-JP",
  "jp-JP": "ja-JP",
  ko: "ko-KR",
  ms: "ms-MY",
  nl: "nl-NL",
  pl: "pl-PL",
  pt: "pt-BR",
  ru: "ru-RU",
  sv: "sv-SE",
  "se-SE": "sv-SE",
  "sv-SE": "sv-SE",
  th: "th-TH",
  tr: "tr-TR",
  vi: "vi-VN",
  zh: "zh-CN",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  "cn-ZH": "zh-CN",
  "cn-TW": "zh-TW",
};
const RTL_LOCALES = new Set(["ar-SA", "he-IL"]);
const GENDER_VARIANT_SEPARATOR = "__";

export function normalizeTranslationGender(gender) {
  const normalized = String(gender || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (new Set(["female", "woman"]).has(normalized)) return "woman";
  if (new Set(["male", "man"]).has(normalized)) return "man";
  if (new Set(["nonbinary", "nonconforming"]).has(normalized)) {
    return "nonBinary";
  }
  if (
    new Set(["custom", "other", "prefernottosay", "unknown"]).has(normalized)
  ) {
    return "other";
  }
  return null;
}

export function applyGenderTranslations(copy, gender) {
  const normalizedGender = normalizeTranslationGender(gender);
  if (!normalizedGender) return copy;

  const suffix = `${GENDER_VARIANT_SEPARATOR}${normalizedGender}`;
  const resolved = { ...copy };
  for (const [key, value] of Object.entries(copy)) {
    if (key.endsWith(suffix)) {
      resolved[key.slice(0, -suffix.length)] = value;
    }
  }
  return resolved;
}

function getLocaleCookie() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE_KEY}=`))
    ?.slice(LOCALE_COOKIE_KEY.length + 1);

  if (!rawValue) {
    return null;
  }

  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

function getSavedLocale() {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage === "undefined"
  ) {
    return null;
  }

  return (
    getLocaleCookie() ||
    window.localStorage.getItem(LOCALE_STORAGE_KEY) ||
    window.localStorage.getItem(SECONDARY_LOCALE_STORAGE_KEY)
  );
}

function getUrlLocale() {
  if (typeof window === "undefined") {
    return null;
  }

  const hash = window.location.hash.slice(1);
  const hashQueryStart = hash.indexOf("?");
  const hashQuery =
    hashQueryStart >= 0
      ? hash.slice(hashQueryStart + 1)
      : hash.startsWith("hl=")
        ? hash
        : "";
  const hashLocale = new URLSearchParams(hashQuery).get("hl");
  const searchLocale = new URLSearchParams(window.location.search).get("hl");

  return hashLocale || searchLocale;
}

function resolveLocaleCandidate(locale) {
  if (!locale) {
    return null;
  }

  if (translations[locale]) {
    return locale;
  }

  if (LOCALE_ALIASES[locale] && translations[LOCALE_ALIASES[locale]]) {
    return LOCALE_ALIASES[locale];
  }

  const normalized = locale.toLowerCase();
  const aliasMatch = Object.entries(LOCALE_ALIASES).find(
    ([alias]) => alias.toLowerCase() === normalized,
  );
  if (aliasMatch && translations[aliasMatch[1]]) {
    return aliasMatch[1];
  }

  const exactMatch = Object.keys(translations).find(
    (key) => key.toLowerCase() === normalized,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const prefix = normalized.split(/[-_]/)[0];
  const prefixAlias = LOCALE_ALIASES[prefix];
  if (prefixAlias && translations[prefixAlias]) {
    return prefixAlias;
  }

  return (
    Object.keys(translations).find((key) =>
      key.toLowerCase().startsWith(prefix),
    ) || null
  );
}

function resolveLocale(locale) {
  const localeCandidates = [
    locale,
    getUrlLocale(),
    getSavedLocale(),
    typeof navigator !== "undefined"
      ? navigator.language || navigator.userLanguage
      : null,
    typeof document !== "undefined" ? document.documentElement.lang : null,
  ];

  for (const candidate of localeCandidates) {
    const resolvedCandidate = resolveLocaleCandidate(candidate);
    if (resolvedCandidate) {
      return resolvedCandidate;
    }
  }

  return "en";
}

export function t(locale, options = {}) {
  const resolvedLocale = resolveLocale(locale);
  const copy = { ...translations.en, ...(translations[resolvedLocale] || {}) };
  return applyGenderTranslations(copy, options?.gender);
}

export function getCurrentLocale(locale) {
  return locale ? resolveLocaleCandidate(locale) || "en" : resolveLocale();
}

export function getUrlLocaleOverride() {
  return resolveLocaleCandidate(getUrlLocale());
}

export function getLocaleDirection(locale) {
  const resolvedLocale = locale
    ? resolveLocaleCandidate(locale) || "en"
    : resolveLocale();

  return RTL_LOCALES.has(resolvedLocale) ? "rtl" : "ltr";
}

export function setCurrentLocale(locale) {
  const resolvedLocale = resolveLocaleCandidate(locale) || "en";
  const resolvedDirection = getLocaleDirection(resolvedLocale);

  if (typeof window !== "undefined") {
    const previousLocale = window.document.documentElement.lang;
    const previousDirection = window.document.documentElement.dir || "ltr";
    window.localStorage?.setItem(LOCALE_STORAGE_KEY, resolvedLocale);
    window.localStorage?.setItem(SECONDARY_LOCALE_STORAGE_KEY, resolvedLocale);
    // biome-ignore lint/suspicious/noDocumentCookie: The locale is a non-sensitive preference cookie.
    window.document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(resolvedLocale)}; Path=/; Max-Age=31536000; SameSite=Lax`;

    if (previousLocale !== resolvedLocale) {
      window.document.documentElement.lang = resolvedLocale;
    }
    if (previousDirection !== resolvedDirection) {
      window.document.documentElement.dir = resolvedDirection;
    }
    if (
      previousLocale === resolvedLocale &&
      previousDirection === resolvedDirection
    ) {
      return resolvedLocale;
    }

    const detail = { direction: resolvedDirection, locale: resolvedLocale };
    window.dispatchEvent(
      new CustomEvent("munetios:languagechange", { detail }),
    );
    window.dispatchEvent(new CustomEvent("munetios:localechange", { detail }));
  }

  return resolvedLocale;
}
