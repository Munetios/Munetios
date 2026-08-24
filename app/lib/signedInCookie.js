import { getSecureCookieAttribute } from "./requestSecurity.js";

export const signedInCookieName = "munetios_signed_in";
let serverSessionCookiePresent = null;

export function setServerSessionCookiePresent(value) {
  serverSessionCookiePresent = typeof value === "boolean" ? value : null;
}

export function getSignedInCookie(
  request,
  value = "1",
  maximumAge = 60 * 60 * 24 * 30,
) {
  const secure = getSecureCookieAttribute(request);
  return `${signedInCookieName}=${encodeURIComponent(value)}; Path=/; Max-Age=${maximumAge}; SameSite=Lax${secure}`;
}

export function hasSignedInCookie() {
  if (typeof document === "undefined") return false;
  if (serverSessionCookiePresent !== null) return serverSessionCookiePresent;
  return document.cookie
    .split(";")
    .some((entry) => entry.trim() === `${signedInCookieName}=1`);
}
