import { translations } from "../languages/index.js";
import {
  deleteAccountData,
  getAccountData,
  setAccountData,
} from "./authSecurity.js";

const languageDataKey = "account-language-v1";
const localeCookieName = "munetios_locale";
const legacyPreferenceStore =
  globalThis.__munetiosLanguagePreferenceStore || new Map();

globalThis.__munetiosLanguagePreferenceStore = legacyPreferenceStore;

export function normalizeAccountLanguage(language) {
  if (typeof language !== "string" || !language.trim()) return null;
  const candidate = language.trim().replaceAll("_", "-");
  return (
    Object.keys(translations).find(
      (locale) => locale.toLowerCase() === candidate.toLowerCase(),
    ) || null
  );
}

function getCookieValue(request, name) {
  if (request?.cookies?.get) return request.cookies.get(name)?.value || null;
  const cookieHeader = request?.headers?.get?.("cookie") || "";
  const cookie = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return cookie.slice(name.length + 1);
  }
}

export function getAccountLanguage(accountId, request = null) {
  const stored = getAccountData(accountId, languageDataKey, null);
  const storedLanguage = normalizeAccountLanguage(
    typeof stored === "string" ? stored : stored?.language,
  );
  if (storedLanguage) return storedLanguage;

  const legacyLanguage = normalizeAccountLanguage(
    legacyPreferenceStore.get(accountId),
  );
  if (legacyLanguage) {
    setAccountLanguage(accountId, legacyLanguage);
    return legacyLanguage;
  }

  return normalizeAccountLanguage(getCookieValue(request, localeCookieName));
}

export function setAccountLanguage(accountId, language) {
  const normalized = normalizeAccountLanguage(language);
  if (!normalized) return null;
  legacyPreferenceStore.set(accountId, normalized);
  setAccountData(accountId, languageDataKey, {
    language: normalized,
    updatedAt: new Date().toISOString(),
  });
  return normalized;
}

export function clearAccountLanguage(accountId) {
  legacyPreferenceStore.delete(accountId);
  deleteAccountData(accountId, languageDataKey);
}

const stripeCheckoutLocales = Object.freeze({
  "co-FR": "fr",
  "da-DK": "da",
  "de-CH": "de",
  "de-DE": "de",
  "el-GR": "el",
  "en-GB": "en-GB",
  en: "en",
  "es-419": "es-419",
  "es-AR": "es-419",
  "es-CO": "es-419",
  "es-DO": "es-419",
  "es-EQ": "es-419",
  "es-ES": "es",
  "es-MX": "es-419",
  "es-PR": "es-419",
  "es-US": "es-419",
  es: "es",
  "fr-FR": "fr",
  "fur-IT": "it",
  "gl-ES": "es",
  "id-ID": "id",
  "it-CH": "it",
  "it-IT": "it",
  "ja-JP": "ja",
  "ms-MY": "ms",
  "nl-NL": "nl",
  "pl-PL": "pl",
  "pt-BR": "pt-BR",
  "pt-PT": "pt",
  "ru-RU": "ru",
  "sv-SE": "sv",
  "th-TH": "th",
  "tr-TR": "tr",
  "zh-CN": "zh",
  "zh-TW": "zh-TW",
});

const stripeElementsLocales = Object.freeze({
  ...stripeCheckoutLocales,
  "ar-SA": "ar",
  "he-IL": "he",
  "ko-KR": "ko",
  "vi-VN": "vi",
});

export function getStripeCheckoutLocale(accountId, request = null) {
  return stripeCheckoutLocales[getAccountLanguage(accountId, request)] || "en";
}

export function getStripeElementsLocale(accountId, request = null) {
  return stripeElementsLocales[getAccountLanguage(accountId, request)] || "en";
}
