export const supportedCountryCodes = Object.freeze([
  "US",
  "BR",
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "DO",
  "PR",
  "IN",
  "AR",
  "NG",
]);

export const supportedCountryCodeSet = new Set(supportedCountryCodes);

export function isSupportedCountry(country) {
  return supportedCountryCodeSet.has(String(country || "").toUpperCase());
}
