// Sessions come from the existing Munetios accounts backend; this Worker never sees passwords.
import { fail, sha256Hex } from "./util.js";

const cache = new Map();
const CACHE_MS = 15_000;

function trimCache() {
    const at = Date.now();
    for (const [key, entry] of cache) if (entry.expires <= at) cache.delete(key);
    while (cache.size > 2000) cache.delete(cache.keys().next().value);
}

// Returns { account, accounts, accountIds } or throws 401.
export async function requireSession(request, env) {
    const session = await resolveSession(request, env);
    if (!session?.account) fail(401, "signedOut");
    return session;
}

export async function resolveSession(request, env) {
    if (typeof env.resolveSession === "function") return normalize(await env.resolveSession(request));
    const cookie = request.headers.get("Cookie") || "";
    if (!cookie) return null;
    const key = await sha256Hex(cookie + "|" + new URL(request.url).host);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (!env.ACCOUNTS) fail(503, "unavailable");
    const url = new URL("/api/auth/session", request.url);
    const headers = new Headers({ Cookie: cookie, Accept: "application/json" });
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) headers.set("CF-Connecting-IP", ip);
    const response = await env.ACCOUNTS.fetch(new Request(url, { headers, redirect: "manual" }));
    if (!response.ok) fail(503, "unavailable");
    const value = normalize(await response.json().catch(() => null));
    trimCache();
    cache.set(key, { value, expires: Date.now() + CACHE_MS });
    return value;
}

function normalize(data) {
    if (!data?.account?.id) return null;
    const pick = item => ({ id: String(item.id), email: String(item.email || "").toLowerCase(), displayName: String(item.displayName || ""), picture: item.picture || null });
    const account = pick(data.account);
    const accounts = (Array.isArray(data.accounts) ? data.accounts : []).filter(item => item?.id).map(pick).filter(item => item.id !== account.id);
    return { account, accounts, accountIds: new Set([account.id, ...accounts.map(item => item.id)]) };
}

// Mutating requests must come from this origin (CSRF). JSON or raw-upload bodies only.
export function checkOrigin(request, env) {
    if (request.method === "GET" || request.method === "HEAD") return;
    const origin = request.headers.get("Origin");
    const allowed = new Set([new URL(request.url).origin, ...String(env.MAIL_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)]);
    if (!origin || !allowed.has(origin)) fail(403, "forbidden");
    const site = request.headers.get("Sec-Fetch-Site");
    if (site && site !== "same-origin") fail(403, "forbidden");
}
