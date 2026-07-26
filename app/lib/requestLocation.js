const countryTimezoneDefaults = {
  AE: "Asia/Dubai",
  AR: "America/Argentina/Buenos_Aires",
  AT: "Europe/Vienna",
  AU: "Australia/Sydney",
  BE: "Europe/Brussels",
  BR: "America/Sao_Paulo",
  CA: "America/Toronto",
  CH: "Europe/Zurich",
  CL: "America/Santiago",
  CN: "Asia/Shanghai",
  CO: "America/Bogota",
  CZ: "Europe/Prague",
  DE: "Europe/Berlin",
  DK: "Europe/Copenhagen",
  EG: "Africa/Cairo",
  ES: "Europe/Madrid",
  FI: "Europe/Helsinki",
  FR: "Europe/Paris",
  GB: "Europe/London",
  GR: "Europe/Athens",
  HK: "Asia/Hong_Kong",
  HU: "Europe/Budapest",
  ID: "Asia/Jakarta",
  IE: "Europe/Dublin",
  IL: "Asia/Jerusalem",
  IN: "Asia/Kolkata",
  IT: "Europe/Rome",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  MX: "America/Mexico_City",
  MY: "Asia/Kuala_Lumpur",
  NL: "Europe/Amsterdam",
  NO: "Europe/Oslo",
  NZ: "Pacific/Auckland",
  PE: "America/Lima",
  PH: "Asia/Manila",
  PL: "Europe/Warsaw",
  PT: "Europe/Lisbon",
  RO: "Europe/Bucharest",
  RU: "Europe/Moscow",
  SA: "Asia/Riyadh",
  SE: "Europe/Stockholm",
  SG: "Asia/Singapore",
  TH: "Asia/Bangkok",
  TR: "Europe/Istanbul",
  TW: "Asia/Taipei",
  UA: "Europe/Kyiv",
  US: "America/New_York",
  VN: "Asia/Ho_Chi_Minh",
  ZA: "Africa/Johannesburg",
};

function normalizeCountry(value) {
  const country = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function normalizeRegion(value) {
  const region = typeof value === "string" ? value.trim() : "";
  return region && region.length <= 80 ? region : null;
}

function normalizeTimezone(value) {
  const timezone = typeof value === "string" ? value.trim() : "";
  if (!timezone || timezone.length > 100) return null;

  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return null;
  }
}

function inferCountryFromLanguage(request) {
  const languages = request.headers.get("accept-language") || "";

  for (const entry of languages.split(",")) {
    const locale = entry.split(";")[0]?.trim();
    const region = locale?.match(/[-_]([A-Za-z]{2})(?:$|[-_])/i)?.[1];
    const country = normalizeCountry(region);
    if (country) return country;
  }

  return "US";
}

export function getRequestLocation(request) {
  const country =
    normalizeCountry(request.headers.get("x-vercel-ip-country")) ||
    normalizeCountry(request.headers.get("cf-ipcountry")) ||
    normalizeCountry(request.headers.get("cloudfront-viewer-country")) ||
    normalizeCountry(request.headers.get("x-country-code")) ||
    inferCountryFromLanguage(request);
  const region =
    normalizeRegion(request.headers.get("x-vercel-ip-country-region")) ||
    normalizeRegion(request.headers.get("x-region-code")) ||
    normalizeRegion(request.headers.get("cf-region-code"));
  const timezone =
    normalizeTimezone(request.headers.get("x-vercel-ip-timezone")) ||
    normalizeTimezone(request.headers.get("cf-timezone")) ||
    normalizeTimezone(request.headers.get("x-timezone")) ||
    countryTimezoneDefaults[country] ||
    "UTC";

  return { country, region, timezone };
}

