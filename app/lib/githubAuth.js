import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSecureCookieAttribute } from "./requestSecurity.js";

const cookieName = "munetios_github_auth";
const lifetimeSeconds = 10 * 60;

function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function getSigningSecret() {
  return (
    process.env.GITHUB_AUTH_STATE_SECRET ||
    process.env.GITHUB_AUTH_CLIENT_SECRET ||
    process.env.GITHUB_CONNECTOR_CLIENT_SECRET ||
    process.env.GITHUB_CLIENT_SECRET ||
    ""
  );
}

function sign(value) {
  const secret = getSigningSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function getGithubAuthConfiguration() {
  return {
    clientId:
      process.env.GITHUB_AUTH_CLIENT_ID ||
      process.env.GITHUB_CONNECTOR_CLIENT_ID ||
      process.env.GITHUB_CLIENT_ID ||
      "",
    clientSecret:
      process.env.GITHUB_AUTH_CLIENT_SECRET ||
      process.env.GITHUB_CONNECTOR_CLIENT_SECRET ||
      process.env.GITHUB_CLIENT_SECRET ||
      "",
  };
}

export function createGithubAuthRequest(
  request,
  { addAccount = false, embedded = false, returnTo = "/" } = {},
) {
  const state = randomBytes(32).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      addAccount: Boolean(addAccount),
      embedded: Boolean(embedded),
      expiresAt: Date.now() + lifetimeSeconds * 1000,
      returnTo,
      state,
    }),
  ).toString("base64url");
  const signature = sign(payload);
  if (!signature) return null;

  return {
    cookie: `${cookieName}=${encodeURIComponent(`${payload}.${signature}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetimeSeconds}${getSecureCookieAttribute(request)}`,
    state,
  };
}

export function readGithubAuthRequest(request) {
  const storedValue = getCookie(request, cookieName);
  const separator = storedValue.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = storedValue.slice(0, separator);
  const signature = storedValue.slice(separator + 1);
  if (!safeEqual(signature, sign(payload))) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      !parsed?.state ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt < Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearGithubAuthCookie(request) {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${getSecureCookieAttribute(request)}`;
}
