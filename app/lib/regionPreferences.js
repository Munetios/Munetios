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
  AT: ["de-DE"],
  AR: ["es-AR"],
  AU: ["en"],
  BR: ["pt-BR"],
  CA: ["en", "fr-FR"],
  CH: ["de-CH", "fr-FR", "it-CH"],
  CN: ["zh-CN"],
  CO: ["es-CO"],
  DE: ["de-DE", "en"],
  DO: ["es-DO"],
  EC: ["es-EQ"],
  EQ: ["es-EQ"],
  ES: ["es-ES", "gl-ES"],
  FR: ["fr-FR", "co-FR"],
  GB: ["en-GB"],
  GR: ["el-GR", "en"],
  IL: ["he-IL", "en"],
  IN: ["hi-IN", "en"],
  IT: ["it-IT", "fur-IT"],
  JP: ["ja-JP"],
  KR: ["ko-KR"],
  MX: ["es-MX"],
  MY: ["ms-MY", "en"],
  NL: ["nl-NL", "en"],
  PL: ["pl-PL"],
  PT: ["pt-PT"],
  PR: ["es-PR", "en"],
  SA: ["ar-SA", "en"],
  SE: ["sv-SE", "en"],
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
