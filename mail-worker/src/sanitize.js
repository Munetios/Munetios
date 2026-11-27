// Allowlist sanitizer for outgoing HTML email (the delivery copy). The editable source is kept separately.
// It is fail-closed: unknown elements are unwrapped, unknown attributes dropped, and scripts, event handlers,
// forms, frames, and unsafe URL schemes are removed. Incoming mail is additionally rendered in a sandboxed iframe.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const ALLOWED = new Set(["a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
    "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins",
    "kbd", "li", "main", "mark", "nav", "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td",
    "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr", "html", "head", "body", "style", "title", "meta", "center", "area", "map"]);
const DROP_WITH_CONTENT = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "template", "form", "input", "button", "select", "textarea", "option",
    "svg", "math", "canvas", "audio", "video", "source", "track", "link", "base", "portal", "dialog", "xml", "noembed", "noframes", "plaintext", "xmp", "param"]);
const GLOBAL_ATTRS = new Set(["style", "class", "id", "dir", "lang", "title", "align", "valign", "width", "height", "bgcolor", "color", "border", "role", "aria-label", "aria-hidden"]);
const TAG_ATTRS = {
    a: ["href", "name", "target", "rel"], img: ["src", "alt", "srcset"], table: ["cellpadding", "cellspacing", "summary", "background"], td: ["colspan", "rowspan", "nowrap", "background", "headers", "scope"],
    th: ["colspan", "rowspan", "nowrap", "background", "scope", "abbr"], font: ["face", "size"], col: ["span"], colgroup: ["span"], ol: ["start", "type", "reversed"], ul: ["type"], li: ["value"],
    meta: ["charset", "name", "content"], time: ["datetime"], area: ["href", "alt", "shape", "coords"], map: ["name"], blockquote: ["cite"], q: ["cite"], details: ["open"], body: ["background"],
};
const URL_ATTRS = new Set(["href", "src", "background", "cite", "srcset"]);
const SAFE_SCHEMES = /^(https?:|mailto:|tel:|cid:|#)/i;

const decodeEntities = value => value.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16))))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Math.min(0x10ffff, Number(dec)))).replace(/&colon;/gi, ":").replace(/&tab;/gi, "").replace(/&newline;/gi, "");
const escapeAttr = value => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function safeUrl(value, { allowData = false } = {}) {
    const decoded = decodeEntities(String(value)).replace(/[\u0000- \u007f-\u009f]+/g, "");
    if (allowData && /^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(decoded)) return decoded;
    if (SAFE_SCHEMES.test(decoded)) return String(value).trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(decoded) && !decoded.startsWith("//")) return String(value).trim(); // relative
    return null;
}

export function sanitizeCss(css) {
    let value = String(css);
    value = value.replace(/\/\*[\s\S]*?\*\//g, "");
    if (/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|\\/i.test(value)) {
        value = value.replace(/expression\s*\([^)]*\)?|javascript:|vbscript:|behavior\s*:[^;]*|-moz-binding[^;]*|@import[^;]*;?|\\[0-9a-f]{1,6}\s?|\\/gi, "");
    }
    // url(...) only for https, cid, and inline images.
    value = value.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, quote, url) => safeUrl(url, { allowData: true }) && !/^\/\//.test(url) ? `url("${url.replace(/"/g, "")}")` : "none");
    return value.replace(/position\s*:\s*fixed/gi, "position: static");
}

export function sanitizeEmailHtml(html, { maxBytes = 5 * 1024 * 1024 } = {}) {
    const input = String(html || "").slice(0, maxBytes);
    let out = "";
    const stack = [];
    let i = 0;
    let dropDepth = 0;
    let dropTag = "";
    const tagPattern = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<!doctype[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
    let match;
    while ((match = tagPattern.exec(input))) {
        const text = input.slice(i, match.index);
        if (!dropDepth) out += text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&(?![a-z0-9#]+;)/gi, "&amp;");
        i = tagPattern.lastIndex;
        const raw = match[0];
        if (raw.startsWith("<!--") || raw.startsWith("<![")) {
            // Keep Outlook conditional comments' content out; plain comments are removed.
            continue;
        }
        if (/^<!doctype/i.test(raw)) { if (!dropDepth) out += "<!DOCTYPE html>"; continue; }
        const name = match[1].toLowerCase();
        const closing = raw.startsWith("</");
        if (dropDepth) {
            if (name === dropTag) dropDepth += closing ? -1 : (VOID.has(name) || /\/\s*>$/.test(raw) ? 0 : 1);
            continue;
        }
        if (DROP_WITH_CONTENT.has(name)) {
            if (!closing && !/\/\s*>$/.test(raw) && !VOID.has(name)) { dropDepth = 1; dropTag = name; }
            continue;
        }
        if (!ALLOWED.has(name)) continue;
        if (closing) {
            const index = stack.lastIndexOf(name);
            if (index >= 0) { for (let n = stack.length - 1; n >= index; n--) out += `</${stack[n]}>`; stack.length = index; }
            continue;
        }
        if (name === "style") {
            const end = input.toLowerCase().indexOf("</style", i);
            const css = input.slice(i, end < 0 ? input.length : end);
            out += `<style>${sanitizeCss(css).replace(/<\/?[a-z]/gi, "")}</style>`;
            i = end < 0 ? input.length : input.indexOf(">", end) + 1 || input.length;
            tagPattern.lastIndex = i;
            continue;
        }
        if (name === "meta" && /http-equiv/i.test(match[2])) continue;
        const attrs = [];
        const attrPattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        let attr;
        const allowedForTag = new Set(TAG_ATTRS[name] || []);
        while ((attr = attrPattern.exec(match[2] || ""))) {
            const key = attr[1].toLowerCase();
            let value = attr[2] ?? attr[3] ?? attr[4] ?? "";
            if (key.startsWith("on") || key === "formaction" || key === "srcdoc") continue;
            if (!GLOBAL_ATTRS.has(key) && !allowedForTag.has(key) && !key.startsWith("data-")) continue;
            if (key.startsWith("data-") && !/^data-[a-z0-9-]{1,40}$/.test(key)) continue;
            if (URL_ATTRS.has(key)) {
                if (key === "srcset") { value = value.split(",").filter(part => safeUrl(part.trim().split(/\s+/)[0]) !== null).join(","); if (!value) continue; }
                else { const safe = safeUrl(value, { allowData: name === "img" && key === "src" }); if (safe === null) continue; value = safe; }
            }
            if (key === "style") value = sanitizeCss(decodeEntities(value));
            if (key === "target") value = "_blank";
            if (URL_ATTRS.has(key)) value = value.replace(/&amp;/gi, "&");
            attrs.push(`${key}="${escapeAttr(value)}"`);
        }
        if (name === "a" && attrs.some(item => item.startsWith("href="))) {
            const filtered = attrs.filter(item => !item.startsWith("rel="));
            filtered.push('rel="noopener noreferrer"');
            attrs.length = 0; attrs.push(...filtered);
        }
        out += `<${name}${attrs.length ? " " + attrs.join(" ") : ""}>`;
        if (!VOID.has(name) && !/\/\s*>$/.test(raw)) stack.push(name);
    }
    if (!dropDepth) out += input.slice(i).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    for (let n = stack.length - 1; n >= 0; n--) out += `</${stack[n]}>`;
    return out;
}
