// Shared helpers for the Munetios Mail backend. Nothing here logs message content.
export const QUOTA_BYTES = 20_000_000_000;
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024; // Cloudflare Email Service and Email Routing limit
export const MAX_RECIPIENTS = 50;
export const MAX_ATTACHMENTS = 32;
export const INTERNAL_DOMAIN = "munetios.com";
export const SYSTEM_FOLDERS = ["inbox", "sent", "drafts", "scheduled", "outbox", "archive", "spam", "trash"];
export const MOVABLE_FOLDERS = ["inbox", "archive", "spam", "trash"];

const encoder = new TextEncoder();
export const utf8 = value => encoder.encode(value);
export const byteLength = value => encoder.encode(String(value ?? "")).length;
export const now = () => Date.now();

export function id(prefix = "") {
    const bytes = crypto.getRandomValues(new Uint8Array(15));
    let out = "";
    for (const byte of bytes) out += "0123456789abcdefghijklmnopqrstuvwxyz"[byte % 36];
    return prefix + out;
}

export async function sha256Hex(data) {
    const buffer = typeof data === "string" ? utf8(data) : data;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const EMAIL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
export const normalizeEmail = value => typeof value === "string" ? value.trim().toLowerCase() : "";
export function validEmail(value) {
    const email = normalizeEmail(value);
    if (!email || email.length > 254 || !EMAIL.test(email)) return false;
    const [local, domain] = email.split("@");
    return local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..") && domain.length <= 253;
}
export const isInternal = email => normalizeEmail(email).endsWith("@" + INTERNAL_DOMAIN);
export const domainOf = email => normalizeEmail(email).split("@")[1] || "";

export function cleanHeaderText(value, max = 998) {
    return [...String(value ?? "").replace(/[\r\n\0]+/g, " ")].slice(0, max).join("").trim();
}

export function clampString(value, max) {
    return typeof value === "string" ? [...value].slice(0, max).join("") : "";
}

export class HttpError extends Error {
    constructor(status, code, extra) {
        super(code);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}
export const fail = (status, code, extra) => { throw new HttpError(status, code, extra); };

export const PRIVATE_HEADERS = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
};

export function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...PRIVATE_HEADERS, ...headers },
    });
}

export function errorResponse(error) {
    if (error instanceof HttpError) return json({ error: error.code, ...(error.extra || {}) }, error.status);
    // Only the error class name is recorded; messages can contain user data.
    console.error("mail: unexpected error", error?.name || "Error");
    return json({ error: "unavailable" }, 503);
}

export async function readJson(request, maxBytes = 1024 * 1024) {
    const type = request.headers.get("Content-Type") || "";
    if (!type.toLowerCase().startsWith("application/json")) fail(415, "invalidRequest");
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > maxBytes) fail(413, "tooLarge");
    const buffer = await readBytes(request, maxBytes);
    try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { fail(400, "invalidRequest"); }
}

export async function readBytes(request, maxBytes) {
    if (!request.body) return new Uint8Array();
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            fail(413, "tooLarge");
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out;
}

export const parseJson = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
export const bool = value => value ? 1 : 0;

export function addressList(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    for (const item of value) {
        const email = normalizeEmail(typeof item === "string" ? item : item?.email);
        if (!validEmail(email) || seen.has(email)) continue;
        seen.add(email);
        out.push({ email, name: cleanHeaderText(typeof item === "object" ? item?.name : "", 200) });
    }
    return out;
}

export function snippetOf(text, length = 220) {
    return [...String(text || "").replace(/\s+/g, " ").trim()].slice(0, length).join("");
}

export function subjectKey(subject) {
    return String(subject || "").toLowerCase()
        .replace(/^(\s*(re|fw|fwd|aw|wg|sv|vs|rv|tr|antw|odp|r|res|enc)(\[\d+\])?\s*:\s*)+/i, "")
        .replace(/\s+/g, " ").trim().slice(0, 200);
}

export function htmlToText(html) {
    return String(html || "")
        .replace(/<(script|style|head|template)[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, n) => {
            const code = Number(n);
            return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
        })
        .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function textToHtml(text) {
    return '<div style="white-space:pre-wrap">' + escapeHtml(text) + "</div>";
}

// Concise, privacy-preserving operational counter (codes only).
export async function opsLog(db, kind, code) {
    try { await db.prepare("INSERT INTO ops_log (kind, code, at) VALUES (?, ?, ?)").bind(kind, String(code).slice(0, 60), now()).run(); } catch { /* best effort */ }
}
