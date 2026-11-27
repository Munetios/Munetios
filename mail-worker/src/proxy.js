// Outbound fetches on behalf of a user (remote images, one-click unsubscribe), hardened against SSRF:
// HTTPS only, no credentials, standard port, no private or special-use hosts, every redirect re-validated,
// bounded size and time. Locally, env.LOOKUP resolves DNS so private addresses can also be refused.
import { fail } from "./util.js";

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".home.arpa", ".onion", ".test", ".invalid", ".example"];

function ipv4Private(host) {
    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function ipv6Private(host) {
    const value = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (value === "::" || value === "::1") return true;
    if (/^(fc|fd|fe8|fe9|fea|feb|ff)/.test(value)) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return ipv4Private(mapped[1]);
    return /^(64:ff9b|2001:db8|2001::|2002:)/.test(value);
}

export function checkUrl(value) {
    let url;
    try { url = new URL(value); } catch { fail(400, "invalidUrl"); }
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) fail(400, "invalidUrl");
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some(suffix => host.endsWith(suffix))) fail(400, "invalidUrl");
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && ipv4Private(host)) fail(400, "invalidUrl");
    if (host.startsWith("[") && ipv6Private(host)) fail(400, "invalidUrl");
    if (/^\d+$/.test(host) || /^0x/i.test(host)) fail(400, "invalidUrl");
    return url;
}

async function checkDns(env, url) {
    if (typeof env.LOOKUP !== "function") return;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const records = await env.LOOKUP(host).catch(() => []);
    if (!records.length || records.some(record => (record.family === 6 ? ipv6Private(record.address) : ipv4Private(record.address)))) fail(400, "invalidUrl");
}

export async function safeFetch(env, value, { method = "GET", body, headers = {}, maxBytes = 8 * 1024 * 1024, accept = "*/*", timeoutMs = 8000 } = {}) {
    let url = checkUrl(value);
    for (let hop = 0; hop < 4; hop++) {
        await checkDns(env, url);
        const fetcher = env.FETCH || fetch;
        const response = await fetcher(url.href, {
            method, body: hop === 0 ? body : undefined, redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
            headers: { Accept: accept, "User-Agent": "MunetiosMail/1.0 (+privacy proxy)", ...headers },
        }).catch(() => fail(502, "fetchFailed"));
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("Location");
            if (!location) fail(502, "fetchFailed");
            url = checkUrl(new URL(location, url).href);
            if (response.status === 303) method = "GET";
            continue;
        }
        const length = Number(response.headers.get("Content-Length") || 0);
        if (length > maxBytes) fail(413, "tooLarge");
        const reader = response.body?.getReader();
        const chunks = [];
        let total = 0;
        if (reader) {
            for (;;) {
                const { value: chunk, done } = await reader.read();
                if (done) break;
                total += chunk.byteLength;
                if (total > maxBytes) { await reader.cancel().catch(() => {}); fail(413, "tooLarge"); }
                chunks.push(chunk);
            }
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return { ok: response.ok, status: response.status, headers: response.headers, bytes };
    }
    fail(508, "tooManyRedirects");
}

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/;

// Remote images are fetched by the server so the sender never sees the reader's IP address or cookies.
export async function proxyImage(env, value) {
    const result = await safeFetch(env, value, { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5", maxBytes: 10 * 1024 * 1024 });
    const type = String(result.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!result.ok || !IMAGE_TYPES.test(type)) fail(415, "notAnImage");
    return new Response(result.bytes, {
        headers: {
            "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer", "Content-Disposition": "inline",
        },
    });
}
