// HTML email tools: paste cleaning, formatting, validation, email-client compatibility checks, CSS inlining,
// plain-text conversion, personalization variables, and EML/HTML export.
import { t } from "./i18n.js";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const DANGEROUS = new Set(["script", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "link", "base", "meta", "frame", "frameset", "applet", "noscript", "template", "svg", "math"]);
const KNOWN = new Set(["html", "head", "body", "title", "style", "meta", "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
    "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark", "nav",
    "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr", "map", "area"]);

// Cleans HTML pasted from other apps: keeps structure and basic formatting, drops scripts, handlers, and classes.
export function cleanPasted(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const walk = node => {
        for (const child of [...node.children]) {
            const name = child.localName;
            if (DANGEROUS.has(name) || name === "style" || name === "title") { child.remove(); continue; }
            if (!KNOWN.has(name)) { walk(child); child.replaceWith(...child.childNodes); continue; }
            for (const attr of [...child.attributes]) {
                const key = attr.name.toLowerCase();
                if (key.startsWith("on") || key === "class" || key === "id" || key.startsWith("data-") || key === "contenteditable") child.removeAttribute(attr.name);
                if ((key === "href" || key === "src") && /^\s*(javascript|vbscript|data:text)/i.test(attr.value)) child.removeAttribute(attr.name);
            }
            const style = child.getAttribute("style");
            if (style) child.setAttribute("style", style.split(";").filter(rule => /^\s*(color|background-color|font-weight|font-style|text-decoration|text-align|font-size|font-family)\s*:/i.test(rule)).join(";"));
            walk(child);
        }
    };
    walk(doc.body);
    return doc.body.innerHTML.replace(/<!--[\s\S]*?-->/g, "");
}

export function formatHtml(html) {
    const tokens = String(html).replace(/>\s+</g, "><").split(/(<[^>]+>)/g).filter(token => token.trim() !== "");
    let depth = 0;
    const out = [];
    let preserve = 0;
    for (const token of tokens) {
        const tag = /^<\/?([a-zA-Z0-9-]+)/.exec(token)?.[1]?.toLowerCase();
        if (/^<(pre|textarea|style)\b/i.test(token)) preserve++;
        if (preserve) { out.push("  ".repeat(depth) + token); if (/^<\/(pre|textarea|style)>/i.test(token)) preserve--; continue; }
        if (/^<\//.test(token)) { depth = Math.max(0, depth - 1); out.push("  ".repeat(depth) + token); continue; }
        out.push("  ".repeat(depth) + token.trim());
        if (tag && /^</.test(token) && !/^<!|\/>$/.test(token) && !VOID.has(tag)) depth++;
    }
    return out.join("\n");
}

// Returns [{ level: "error"|"warning", line, message }].
export function validateHtml(source) {
    const issues = [];
    const stack = [];
    const ids = new Set();
    const lineAt = index => source.slice(0, index).split("\n").length;
    const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let match;
    while ((match = pattern.exec(source))) {
        if (match[0].startsWith("<!--")) continue;
        const [raw, closing, nameRaw, attrs] = match;
        const name = nameRaw.toLowerCase();
        const line = lineAt(match.index);
        if (DANGEROUS.has(name)) issues.push({ level: "error", line, message: t("issueRemovedTag", { tag: name }) });
        else if (!KNOWN.has(name)) issues.push({ level: "warning", line, message: t("issueUnknownTag", { tag: name }) });
        if (closing) {
            const index = stack.map(item => item.name).lastIndexOf(name);
            if (index < 0) issues.push({ level: "error", line, message: t("issueUnexpectedClose", { tag: name }) });
            else { for (const item of stack.slice(index + 1)) issues.push({ level: "error", line: item.line, message: t("issueUnclosed", { tag: item.name }) }); stack.length = index; }
            continue;
        }
        if (/\bon[a-z]+\s*=/i.test(attrs)) issues.push({ level: "error", line, message: t("issueEventHandler") });
        if (/javascript:/i.test(attrs)) issues.push({ level: "error", line, message: t("issueJavascriptUrl") });
        if (name === "img" && !/\balt\s*=/i.test(attrs)) issues.push({ level: "warning", line, message: t("issueMissingAlt") });
        const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
        if (id) { if (ids.has(id)) issues.push({ level: "warning", line, message: t("issueDuplicateId", { id }) }); ids.add(id); }
        if (!VOID.has(name) && !raw.endsWith("/>") && !["p", "li", "td", "th", "tr", "option", "dt", "dd"].includes(name)) stack.push({ name, line });
        else if (["p", "li", "td", "th", "tr", "dt", "dd"].includes(name)) stack.push({ name, line, optional: true });
    }
    for (const item of stack) if (!item.optional && !["html", "body", "head"].includes(item.name)) issues.push({ level: "error", line: item.line, message: t("issueUnclosed", { tag: item.name }) });
    return issues.concat(compatibility(source));
}

const COMPAT = [
    [/display\s*:\s*(flex|inline-flex)/i, "compatFlex"], [/display\s*:\s*grid|grid-template/i, "compatGrid"], [/position\s*:\s*(absolute|fixed|sticky)/i, "compatPosition"],
    [/var\(--/i, "compatVariables"], [/@import|<link\b/i, "compatExternalCss"], [/@font-face|fonts\.googleapis/i, "compatWebFonts"], [/<svg\b/i, "compatSvg"], [/<video\b|<audio\b/i, "compatMedia"],
    [/<form\b|<input\b/i, "compatForms"], [/<script\b/i, "compatScript"], [/<div[^>]*style="[^"]*background-image/i, "compatBackgroundImage"], [/\b\d+(\.\d+)?rem\b/i, "compatRem"],
    [/box-shadow|text-shadow/i, "compatShadows"], [/border-radius/i, "compatRadius"], [/:hover/i, "compatHover"], [/calc\(/i, "compatCalc"], [/\bobject-fit\b/i, "compatObjectFit"],
];

export function compatibility(source) {
    const issues = [];
    for (const [pattern, key] of COMPAT) if (pattern.test(source)) issues.push({ level: "warning", line: source.slice(0, source.search(pattern)).split("\n").length, message: t(key) });
    if (!/<table/i.test(source) && /<div/i.test(source) && source.length > 400) issues.push({ level: "warning", line: 1, message: t("compatTables") });
    if (new TextEncoder().encode(source).length > 102_000) issues.push({ level: "warning", line: 1, message: t("compatClipped") });
    return issues;
}

// Moves rules from <style> blocks onto matching elements (media queries and pseudo-classes stay in <style>).
export function inlineCss(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const keep = [];
    for (const style of [...doc.querySelectorAll("style")]) {
        const sheet = new CSSStyleSheet();
        try { sheet.replaceSync(style.textContent); } catch { continue; }
        for (const rule of sheet.cssRules) {
            if (rule.type !== CSSRule.STYLE_RULE || /:(hover|focus|active|visited|before|after)/.test(rule.selectorText)) { keep.push(rule.cssText); continue; }
            let targets = [];
            try { targets = doc.querySelectorAll(rule.selectorText); } catch { keep.push(rule.cssText); continue; }
            for (const target of targets) {
                const existing = target.getAttribute("style") || "";
                target.setAttribute("style", `${rule.style.cssText}${existing ? " " + existing : ""}`.trim());
            }
        }
        style.remove();
    }
    if (keep.length) { const style = doc.createElement("style"); style.textContent = keep.join("\n"); doc.head.append(style); }
    const doctype = /^\s*<!doctype/i.test(html) ? "<!DOCTYPE html>\n" : "";
    return /<html/i.test(html) ? doctype + doc.documentElement.outerHTML : doc.head.innerHTML + doc.body.innerHTML;
}

export function htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script, style, head").forEach(node => node.remove());
    doc.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
    doc.querySelectorAll("p, div, tr, li, h1, h2, h3, h4, h5, h6, blockquote, table").forEach(node => node.append("\n"));
    doc.querySelectorAll("a[href]").forEach(node => { const href = node.getAttribute("href"); if (/^https?:/.test(href) && node.textContent.trim() !== href) node.append(` (${href})`); });
    doc.querySelectorAll("li").forEach(node => node.prepend("• "));
    return (doc.body.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function textToHtml(text) {
    const escaped = String(text || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    return escaped.split(/\n{2,}/).map(part => `<p>${part.replace(/\n/g, "<br>")}</p>`).join("");
}

export const VARIABLES = ["first_name", "last_name", "name", "email", "sender_name", "date"];
export const hasVariables = html => /\{\{\s*(first_name|last_name|name|email|sender_name|date)\s*\}\}/.test(html || "");
export function personalize(html, values) {
    const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    return String(html || "").replace(/\{\{\s*(first_name|last_name|name|email|sender_name|date)\s*\}\}/g, (_, key) => escape(values[key]));
}

// A complete document for preview and export.
export function emailDocument(html, title = "") {
    if (/<html[\s>]/i.test(html)) return html;
    return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="x-apple-disable-message-reformatting">\n<title>${title.replace(/[<&]/g, "")}</title>\n</head>\n<body style="margin:0;padding:0">\n${html}\n</body>\n</html>`;
}

const b64 = text => { const bytes = new TextEncoder().encode(text); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/(.{76})/g, "$1\r\n"); };
const word = text => /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(text).replace(/\r\n/g, "")}?=`;

// Standalone .eml for the HTML studio's export (no Bcc).
export function buildEml({ from, to = [], cc = [], subject = "", html = "", text = "" }) {
    const boundary = "=_munetios_" + crypto.randomUUID().replace(/-/g, "");
    const list = people => people.map(person => person.name ? `${word(person.name)} <${person.email}>` : person.email).join(", ");
    return [`From: ${from}`, to.length ? `To: ${list(to)}` : null, cc.length ? `Cc: ${list(cc)}` : null, `Subject: ${word(subject)}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(text || htmlToText(html)),
        `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(emailDocument(html, subject)), `--${boundary}--`, ""].filter(line => line !== null).join("\r\n");
}

// Mentions of attachments in many languages, for the forgotten-attachment reminder.
const ATTACH_WORDS = /\b(attach(ed|ment|ments|ing)?|enclosed|adjunt[oa]s?|anexo|anexado|ci-joint|pièce jointe|anhang|angehängt|allegat[oa]|allegato|附件|첨부|مرفق|संलग्न|aghjunt[ua])\b/i;
export function mentionsAttachment(text) {
    const withoutQuotes = String(text || "").split(/\n(?:On .+wrote:|-{2,}\s*Original|>)/)[0];
    return ATTACH_WORDS.test(withoutQuotes);
}
