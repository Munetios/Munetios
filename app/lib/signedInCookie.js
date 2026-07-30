import { getSecureCookieAttribute } from "./requestSecurity.js";

export const signedInCookieName = "munetios_signed_in";

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
  return document.cookie
    .split(";")
    .some((entry) => entry.trim() === `${signedInCookieName}=1`);
}
