export const currencyOptions = [
  { key: "aiPricingCurrencyUsd", value: "USD" },
  { key: "aiPricingCurrencyEur", value: "EUR" },
  { key: "aiPricingCurrencyGbp", value: "GBP" },
  { key: "currencyCad", value: "CAD" },
  { key: "currencyAud", value: "AUD" },
];

export const plans = [
  {
    actionKey: "aiPricingStartFree",
    descriptionKey: "aiPricingFreeDescription",
    featureKeys: [],
    id: "free",
    nameKey: "aiPricingFree",
    priceUsd: 0,
  },
  {
    actionKey: "aiPricingChooseProLite",
    descriptionKey: "aiPricingProLiteDescription",
    featureKeys: [
      "aiPricingProLiteFeatureUsage",
      "aiPricingProLiteFeatureAdvancedModels",
      "aiPricingProLiteFeatureFasterResponses",
      "aiPricingProLiteFeatureContext",
    ],
    id: "pro-lite",
    nameKey: "aiPricingProLite",
    priceUsd: 2.99,
  },
  {
    actionKey: "aiPricingChoosePro",
    descriptionKey: "aiPricingProDescription",
    featureKeys: [
      "aiPricingProFeatureModels",
      "aiPricingProFeatureAdvancedAccess",
      "aiPricingProFeatureContext",
      "aiPricingProFeatureAdvancedThinking",
    ],
    id: "pro",
    nameKey: "aiPricingPro",
    popular: true,
    priceUsd: 12.99,
  },
  {
    actionKey: "businessSignupSubmit",
    category: "business",
    descriptionKey: "pricingBusinessFreeDescription",
    featureKeys: [
      "businessPreviewWorkspaceDescription",
      "businessPreviewSecurityDescription",
      "businessPreviewAppsDescription",
    ],
    id: "business-free",
    nameKey: "pricingBusinessFreeTitle",
    priceUsd: 0,
  },
  {
    actionKey: "pricingBusinessProCta",
    category: "business",
    descriptionKey: "pricingBusinessProDescription",
    featureKeys: [
      "businessPreviewWorkspaceDescription",
      "businessPreviewSecurityDescription",
      "businessPreviewBillingDescription",
    ],
    id: "business-pro",
    nameKey: "pricingBusinessProTitle",
    priceUsd: 9.99,
  },
];

const currencyRates = {
  AUD: 1.52,
  CAD: 1.37,
  EUR: 0.92,
  GBP: 0.79,
  USD: 1,
};

export function getPlan(planId) {
  return plans.find((plan) => plan.id === planId) || plans[0];
}

export function normalizeCurrency(currency) {
  const value = String(currency || "").toUpperCase();
  return currencyOptions.some((option) => option.value === value)
    ? value
    : "USD";
}

export function getPlanPrice(plan, currency) {
  return plan.priceUsd * (currencyRates[normalizeCurrency(currency)] || 1);
}

export function formatPlanPrice(plan, currency) {
  const normalizedCurrency = normalizeCurrency(currency);
  const value = getPlanPrice(plan, normalizedCurrency);

  if (value === 0) {
    return new Intl.NumberFormat("en", {
      currency: normalizedCurrency,
      maximumFractionDigits: 0,
      style: "currency",
    }).format(value);
  }

  return new Intl.NumberFormat("en", {
    currency: normalizedCurrency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}
