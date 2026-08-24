export const supportedCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD"];

const countryCurrencies = {
  AD: "EUR",
  AT: "EUR",
  AU: "AUD",
  BE: "EUR",
  CA: "CAD",
  CY: "EUR",
  DE: "EUR",
  EE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GB: "GBP",
  GR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  MC: "EUR",
  MT: "EUR",
  NL: "EUR",
  PT: "EUR",
  SI: "EUR",
  SK: "EUR",
  SM: "EUR",
  US: "USD",
  VA: "EUR",
};

const countryLanguages = {
  AT: ["de-DE", "en-AT"],
  AR: ["es-AR"],
  AU: ["en"],
  BE: ["en-BE"],
  BG: ["en-BG"],
  BR: ["pt-BR"],
  CA: ["en", "fr-FR"],
  CH: ["de-CH", "fr-FR", "it-CH", "en-CH"],
  CN: ["zh-CN"],
  CO: ["es-CO"],
  CY: ["en-CY"],
  CZ: ["en-CZ"],
  DE: ["de-DE", "en-DE"],
  DK: ["da-DK", "en-DK"],
  DO: ["es-DO"],
  EC: ["es-EQ"],
  EE: ["en-EE"],
  EQ: ["es-EQ"],
  ES: ["es-ES", "gl-ES", "en-ES"],
  FI: ["en-FI"],
  FR: ["fr-FR", "co-FR", "en-FR"],
  GB: ["en-GB"],
  GR: ["el-GR", "en-GR"],
  HR: ["en-HR"],
  HU: ["en-HU"],
  IE: ["en-IE"],
  IL: ["he-IL", "en"],
  IN: ["hi-IN", "en"],
  IS: ["en-IS"],
  IT: ["it-IT", "fur-IT", "en-IT"],
  JP: ["ja-JP"],
  KR: ["ko-KR"],
  LI: ["en-LI"],
  LT: ["en-LT"],
  LU: ["en-LU"],
  LV: ["en-LV"],
  MT: ["en-MT"],
  MX: ["es-MX"],
  MY: ["ms-MY", "en"],
  NL: ["nl-NL", "en-NL"],
  NO: ["en-NO"],
  PL: ["pl-PL", "en-PL"],
  PT: ["pt-PT", "en-PT"],
  PR: ["es-PR", "en"],
  RO: ["en-RO"],
  SA: ["ar-SA", "en"],
  SE: ["sv-SE", "en-SE"],
  SI: ["en-SI"],
  SK: ["en-SK"],
  TH: ["th-TH", "en"],
  TR: ["tr-TR"],
  TW: ["zh-TW"],
  US: ["en", "es-US"],
  VN: ["vi-VN"],
};

const countryPaymentMethods = {
  AU: ["card", "apple_pay", "paypal"],
  CA: ["card", "apple_pay", "paypal"],
  GB: ["card", "apple_pay", "paypal"],
  US: ["card", "apple_pay", "paypal", "cashapp"],
};

export function resolvePreferenceCountry(preferences = {}) {
  const selected = String(preferences.country || "auto").toUpperCase();
  const detected = String(preferences.detectedCountry || "US").toUpperCase();
  return selected === "AUTO" ? detected : selected;
}

export function getCountryCurrency(country) {
  return countryCurrencies[String(country || "").toUpperCase()] || "USD";
}

export function resolvePreferenceCurrency(preferences = {}) {
  const selected = String(preferences.currency || "auto").toUpperCase();
  if (selected !== "AUTO" && supportedCurrencies.includes(selected)) {
    return selected;
  }
  return getCountryCurrency(resolvePreferenceCountry(preferences));
}

export function getSuggestedLocales(country) {
  return countryLanguages[String(country || "").toUpperCase()] || ["en"];
}

export function getAvailablePaymentMethods(country) {
  return (
    countryPaymentMethods[String(country || "").toUpperCase()] || [
      "card",
      "apple_pay",
      "paypal",
    ]
  );
}

export function getRegionalLocale(locale, preferences = {}) {
  const language = String(locale || "en")
    .replaceAll("_", "-")
    .split("-")[0];
  const country = resolvePreferenceCountry(preferences);
  try {
    return new Intl.Locale(`${language}-${country}`).toString();
  } catch {
    return locale || "en";
  }
}
