import { isIP } from "node:net";

const cache = globalThis.__munetiosIpLocationCache || new Map();
globalThis.__munetiosIpLocationCache = cache;
const cacheLifetimeMs = 24 * 60 * 60 * 1000;

function clean(value, maximum = 80) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, maximum);
}

function isPublicIp(ipAddress) {
  const ip = String(ipAddress || "").trim();
  const version = isIP(ip);
  if (!version) return false;
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const normalized = ip.toLowerCase();
  return !(
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

export function formatLocation({ city, country, countryCode, region }) {
  let countryName = clean(country);
  const code = clean(countryCode, 2).toUpperCase();
  if (!countryName && /^[A-Z]{2}$/.test(code)) {
    try {
      countryName = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    } catch {
      countryName = code;
    }
  }
  return [...new Set([clean(city), clean(region), countryName].filter(Boolean))]
    .join(", ")
    .slice(0, 180);
}

export async function lookupIpLocation(ipAddress) {
  const ip = String(ipAddress || "").trim();
  const useServerAddress =
    !isPublicIp(ip) && process.env.NODE_ENV !== "production";
  if (!isPublicIp(ip) && !useServerAddress) return "";
  const cacheKey = useServerAddress ? "development-public-address" : ip;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.location;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const endpoint = useServerAddress
      ? "https://ipwho.is/"
      : `https://ipwho.is/${encodeURIComponent(ip)}`;
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Munetios/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) return "";
    const payload = await response.json();
    if (payload?.success === false) return "";
    const location = formatLocation({
      city: payload?.city,
      country: payload?.country,
      countryCode: payload?.country_code,
      region: payload?.region,
    });
    if (location) {
      cache.set(cacheKey, {
        expiresAt: Date.now() + cacheLifetimeMs,
        location,
      });
    }
    return location;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}
