// Deterministic mail classification: spam scoring, inbox categories, and user filters.
import { domainOf, normalizeEmail } from "./util.js";

const DANGEROUS = /\.(exe|scr|js|jse|vbs|vbe|bat|cmd|com|pif|jar|msi|msp|ps1|psm1|hta|lnk|iso|img|vhd|wsf|wsh|cpl|reg|dll|apk|appx)$/i;
const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy", "tiny.cc"]);
const PHRASES = ["you have won", "winner", "claim your prize", "act now", "urgent action required", "verify your account immediately", "100% free",
    "risk-free", "wire transfer", "bitcoin investment", "double your", "limited time offer", "click here to claim", "congratulations you", "lottery",
    "inheritance", "beneficiary", "unclaimed funds", "your account will be suspended", "confirm your password", "gift card"];
const SOCIAL = ["facebookmail.com", "linkedin.com", "x.com", "twitter.com", "instagram.com", "mastodon.social", "reddit.com", "redditmail.com", "pinterest.com", "tiktok.com", "discord.com", "youtube.com", "threads.net", "bsky.app", "tumblr.com", "snapchat.com", "quora.com", "meetup.com", "nextdoor.com", "strava.com"];
const UPDATE_WORDS = /\b(receipt|invoice|order|shipped|shipping|delivery|statement|payment|verification code|security alert|sign-in|password|reservation|booking|confirmation|subscription|renewal|itinerary)\b/i;
const PROMO_WORDS = /\b(sale|% off|discount|deal|offer|coupon|promo|newsletter|new arrivals|save \d|free shipping|limited time|shop now|exclusive)\b/i;

export function header(parsed, name) {
    const key = name.toLowerCase();
    return parsed.headers?.find(item => item.key === key)?.value || "";
}

// Authentication results added by Cloudflare Email Routing (Authentication-Results or ARC-Authentication-Results).
export function authResults(parsed) {
    const sources = (parsed.headers || []).filter(item => item.key === "authentication-results" || item.key === "arc-authentication-results").map(item => item.value);
    const result = { spf: "none", dkim: "none", dmarc: "none" };
    for (const value of sources) {
        for (const method of ["spf", "dkim", "dmarc"]) {
            const match = new RegExp(`\\b${method}=(pass|fail|softfail|neutral|none|temperror|permerror|bestguesspass)`, "i").exec(value);
            if (match && result[method] === "none") result[method] = match[1].toLowerCase();
        }
    }
    const spfHeader = header(parsed, "received-spf");
    if (result.spf === "none" && spfHeader) result.spf = (/^(pass|fail|softfail|neutral|none)/i.exec(spfHeader.trim())?.[1] || "none").toLowerCase();
    return result;
}

export function extractLinks(html) {
    const links = [];
    const pattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(html || "")) && links.length < 500) {
        links.push({ href: (match[1] ?? match[2] ?? match[3] ?? "").trim(), text: match[4].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() });
    }
    return links;
}

const hostOf = value => { try { return new URL(value).hostname.toLowerCase(); } catch { return ""; } };

export function scoreSpam(parsed, envelopeFrom, { allowed = false, blocked = false, sensitivity = "standard", internalDomain = "munetios.com" } = {}) {
    const reasons = [];
    let score = 0;
    const add = (points, reason) => { score += points; reasons.push(reason); };
    if (blocked) return { score: 100, reasons: ["blockedSender"], spam: true };
    const auth = authResults(parsed);
    if (auth.dmarc === "fail") add(4, "dmarcFail");
    if (auth.spf === "fail") add(2, "spfFail"); else if (auth.spf === "softfail") add(1, "spfSoftfail");
    if (auth.dkim === "fail") add(1.5, "dkimFail");
    if (auth.spf === "none" && auth.dkim === "none" && auth.dmarc === "none") add(1, "noAuthentication");
    const from = normalizeEmail(parsed.from?.address);
    if (domainOf(from) === internalDomain && auth.dmarc !== "pass") add(6, "spoofedInternalSender");
    const name = parsed.from?.name || "";
    const nameEmail = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(name)?.[0]?.toLowerCase();
    if (nameEmail && nameEmail !== from) add(1.5, "misleadingDisplayName");
    const subject = parsed.subject || "";
    if (subject.length > 10 && subject === subject.toUpperCase() && /[A-Z]/.test(subject)) add(1, "shoutingSubject");
    if ((subject.match(/!/g) || []).length >= 3) add(1, "excessivePunctuation");
    const haystack = (subject + " " + (parsed.text || "") + " " + (parsed.html || "").replace(/<[^>]+>/g, " ")).toLowerCase();
    let phraseHits = 0;
    for (const phrase of PHRASES) if (haystack.includes(phrase) && phraseHits < 3) { phraseHits++; add(1, "spamPhrase"); }
    const links = extractLinks(parsed.html);
    let ipLinks = 0, mismatched = 0, shortened = 0;
    for (const link of links) {
        const host = hostOf(link.href);
        if (!host) continue;
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) ipLinks++;
        const textHost = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(link.text) ? hostOf(link.text.startsWith("http") ? link.text : "https://" + link.text) : "";
        if (textHost && textHost !== host && !host.endsWith("." + textHost) && !textHost.endsWith("." + host)) mismatched++;
        if (SHORTENERS.has(host)) shortened++;
    }
    if (ipLinks) add(2, "ipAddressLinks");
    if (mismatched) add(2, "mismatchedLinks");
    if (shortened) add(0.5, "shortenedLinks");
    if ((parsed.attachments || []).some(item => DANGEROUS.test(item.filename || ""))) add(5, "dangerousAttachment");
    if (!parsed.messageId) add(1, "missingMessageId");
    if (!header(parsed, "date")) add(1, "missingDate");
    if (parsed.html && !parsed.text && haystack.trim().length < 40 && links.length) add(1, "linkOnlyMessage");
    if (envelopeFrom && from && domainOf(envelopeFrom) !== domainOf(from) && auth.dmarc !== "pass" && auth.dkim !== "pass") add(0.5, "envelopeMismatch");
    if (allowed) return { score: 0, reasons: ["allowedSender"], spam: false };
    const threshold = { relaxed: 7, standard: 5, strict: 3 }[sensitivity] || 5;
    return { score: Math.round(score * 10) / 10, reasons, spam: score >= threshold };
}

export function categorize(parsed) {
    const from = normalizeEmail(parsed.from?.address);
    const domain = domainOf(from);
    if (SOCIAL.some(item => domain === item || domain.endsWith("." + item))) return "social";
    const listId = header(parsed, "list-id");
    const listPost = header(parsed, "list-post");
    if (listPost && !/^\s*NO\s*$/i.test(listPost)) return "forums";
    const bulk = Boolean(header(parsed, "list-unsubscribe") || /bulk|list/i.test(header(parsed, "precedence")) || listId);
    const text = (parsed.subject || "") + " " + (parsed.text || "").slice(0, 3000);
    if (UPDATE_WORDS.test(text) && !PROMO_WORDS.test(parsed.subject || "")) return "updates";
    if (bulk) return PROMO_WORDS.test(text) ? "promotions" : "updates";
    return "primary";
}

export function senderMatches(pattern, address) {
    const value = normalizeEmail(address);
    const rule = String(pattern || "").trim().toLowerCase();
    if (!rule || !value) return false;
    if (rule.startsWith("@")) return value.endsWith(rule) || domainOf(value).endsWith("." + rule.slice(1));
    if (!rule.includes("@")) return domainOf(value) === rule || domainOf(value).endsWith("." + rule);
    return value === rule;
}

const FIELDS = new Set(["from", "to", "cc", "subject", "body", "any", "hasAttachment", "size", "listId", "filename"]);
const OPS = new Set(["contains", "notContains", "equals", "startsWith", "endsWith", "matches", "greater", "less", "is"]);
const ACTIONS = new Set(["move", "label", "star", "read", "important", "archive", "trash", "spam", "notSpam", "category", "forward", "pin"]);

export function validateFilter(input) {
    const conditions = (Array.isArray(input?.conditions) ? input.conditions : []).filter(item => FIELDS.has(item?.field) && OPS.has(item?.op))
        .map(item => ({ field: item.field, op: item.op, value: String(item.value ?? "").slice(0, 500) }));
    const actions = (Array.isArray(input?.actions) ? input.actions : []).filter(item => ACTIONS.has(item?.type))
        .map(item => ({ type: item.type, value: String(item.value ?? "").slice(0, 200) }));
    return { conditions, actions };
}

function wildcard(pattern) {
    return new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
}

function testCondition(condition, message) {
    const { field, op, value } = condition;
    if (field === "hasAttachment") return (message.attachmentCount > 0) === (value !== "false");
    if (field === "size") {
        const bytes = Number(value);
        return op === "less" ? message.size < bytes : message.size > bytes;
    }
    const source = {
        from: `${message.fromName} ${message.from}`, to: message.to.join(" "), cc: message.cc.join(" "), subject: message.subject,
        body: message.text, listId: message.listId, filename: message.filenames.join(" "),
        any: `${message.fromName} ${message.from} ${message.to.join(" ")} ${message.cc.join(" ")} ${message.subject} ${message.text}`,
    }[field] || "";
    const haystack = source.toLowerCase();
    const needle = value.toLowerCase();
    switch (op) {
        case "contains": return haystack.includes(needle);
        case "notContains": return !haystack.includes(needle);
        case "equals": case "is": return field === "from" ? message.from === needle : haystack.trim() === needle;
        case "startsWith": return haystack.trim().startsWith(needle);
        case "endsWith": return haystack.trim().endsWith(needle);
        case "matches": return wildcard(needle).test(field === "from" ? message.from : haystack.trim());
        default: return false;
    }
}

// Returns the combined actions of every matching filter, in order, honoring "stop processing".
export function applyFilters(filters, message) {
    const actions = [];
    for (const filter of filters) {
        if (!filter.enabled) continue;
        const conditions = JSON.parse(filter.conditions_json || "[]");
        if (!conditions.length) continue;
        const results = conditions.map(condition => testCondition(condition, message));
        const matched = filter.match_all ? results.every(Boolean) : results.some(Boolean);
        if (!matched) continue;
        actions.push(...JSON.parse(filter.actions_json || "[]"));
        if (filter.stop) break;
    }
    return actions;
}
