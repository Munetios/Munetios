// Secure HTML email rendering.
// Layers: (1) an allowlist sanitizer on an inert DOMParser document; (2) a sandboxed iframe without allow-scripts,
// allow-forms, allow-popups, allow-top-navigation, or allow-downloads; (3) a Content-Security-Policy inside the frame
// and the page CSP (img-src 'self' data: blob:), so remote content can only load through the Mail image proxy.
// The frame keeps allow-same-origin only so this page can measure it, show link destinations, and intercept clicks;
// no script can run inside it.
import { t } from "./i18n.js";
import { el } from "./ui.js";

const DROP = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "template", "form", "input", "button", "select", "textarea", "option",
    "svg", "math", "canvas", "audio", "video", "source", "track", "link", "base", "portal", "dialog", "xml", "noembed", "noframes", "param", "head", "title"]);
const ALLOWED = new Set(["a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "del",
    "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main",
    "mark", "nav", "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead",
    "time", "tr", "tt", "u", "ul", "var", "wbr", "style", "map", "area"]);
const ATTRS = new Set(["style", "class", "id", "dir", "lang", "title", "align", "valign", "width", "height", "bgcolor", "color", "border", "cellpadding", "cellspacing", "colspan",
    "rowspan", "nowrap", "face", "size", "alt", "href", "src", "background", "start", "type", "reversed", "span", "summary", "headers", "scope", "datetime", "name", "shape", "coords", "open", "role"]);
const TRACKER_HOSTS = /(^|\.)(list-manage\.com|mailchimp\.com|sendgrid\.net|mandrillapp\.com|mailgun\.org|hubspot\.com|hs-analytics\.net|exacttarget\.com|mktoresp\.com|doubleclick\.net|google-analytics\.com|pixel\.|track\.|tracking\.|open\.|beacon\.|mcusercontent\.com|sparkpostmail\.com|createsend\.com|klaviyo\.com|customeriomail\.com|intercom-mail\.com|mixpanel\.com|braze\.com|litmus\.com|emltrk\.com)/i;
const TRACKER_PATH = /(\/open(?:\.gif|\.php|\.aspx)?|\/track|\/pixel|\/beacon|\/o\.gif|\/e\/o\/|1x1|spacer\.gif|\/wf\/open|utm_|\/imp\b)/i;

// Placeholder for blocked remote images (an inline SVG, allowed by the frame CSP).
const BLOCKED_IMAGE = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64"><rect width="96" height="64" rx="10" fill="#ecebf3"/><path d="M30 44l12-14 9 10 6-7 9 11z" fill="#b9b4cc"/><circle cx="60" cy="24" r="5" fill="#b9b4cc"/></svg>');
const host = value => { try { return new URL(value).hostname.toLowerCase(); } catch { return ""; } };
const isRemote = value => /^https?:\/\//i.test(String(value).trim()) || String(value).trim().startsWith("//");

export function linkRisk(href, text) {
    let url;
    try { url = new URL(href); } catch { return "invalidLink"; }
    if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol)) return "unsafeScheme";
    if (url.protocol === "http:") return "insecureLink";
    if (url.username || url.password) return "hiddenCredentials";
    const name = url.hostname;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.startsWith("[")) return "ipAddressLink";
    if (name.split(".").some(part => part.startsWith("xn--"))) return "lookalikeDomain";
    const shown = String(text || "").trim();
    const shownHost = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(shown) ? host(shown.startsWith("http") ? shown : "https://" + shown) : "";
    if (shownHost && shownHost !== name && !name.endsWith("." + shownHost) && !shownHost.endsWith("." + name)) return "mismatchedLink";
    return "";
}

function cleanCss(css, report, allowRemote) {
    let value = String(css).replace(/\/\*[\s\S]*?\*\//g, "");
    if (/@import/i.test(value)) { report.remoteStyles++; value = value.replace(/@import[^;]*;?/gi, ""); }
    if (/@font-face/i.test(value)) { report.remoteFonts++; value = value.replace(/@font-face\s*\{[^}]*\}/gi, ""); }
    value = value.replace(/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|\\/gi, "");
    value = value.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, quote, url) => {
        if (/^data:image\//i.test(url) || /^cid:/i.test(url)) return `url("${url.replace(/"/g, "")}")`;
        if (isRemote(url)) {
            report.remoteImages++;
            return allowRemote ? `url("${proxied(url)}")` : "none";
        }
        return "none";
    });
    return value.replace(/position\s*:\s*(fixed|sticky)/gi, "position: static");
}

export const proxied = url => "/api/mail/v1/proxy?url=" + encodeURIComponent(url.startsWith("//") ? "https:" + url : url);

function isTracker(img, src) {
    const w = Number(img.getAttribute("width")), h = Number(img.getAttribute("height"));
    const style = (img.getAttribute("style") || "").toLowerCase();
    if ((w && w <= 3) || (h && h <= 3) || /(width|height)\s*:\s*[0-3]px/.test(style) || /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0*)?\s*(;|$)/.test(style)) return true;
    return TRACKER_HOSTS.test(host(src.startsWith("//") ? "https:" + src : src)) && TRACKER_PATH.test(src);
}

// Returns { html, report }. options: { allowRemote, cidMap: Map(contentId -> blob URL) }
export function sanitizeIncoming(html, { allowRemote = false, cidMap = new Map() } = {}) {
    const report = { remoteImages: 0, trackers: [], remoteFonts: 0, remoteStyles: 0, removed: 0, links: [], suspicious: [], forms: 0 };
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const walk = node => {
        for (const child of [...node.childNodes]) {
            if (child.nodeType === Node.COMMENT_NODE || child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) { child.remove(); continue; }
            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            const name = child.localName;
            if (DROP.has(name)) { if (name === "form" || name === "input" || name === "button") report.forms++; else report.removed++; child.remove(); continue; }
            if (!ALLOWED.has(name)) { walk(child); child.replaceWith(...child.childNodes); continue; }
            if (name === "style") { child.textContent = cleanCss(child.textContent, report, allowRemote); continue; }
            for (const attr of [...child.attributes]) {
                const key = attr.name.toLowerCase();
                if (!ATTRS.has(key) || key.startsWith("on")) { child.removeAttribute(attr.name); continue; }
                if (key === "style") child.setAttribute("style", cleanCss(attr.value, report, allowRemote));
                if (key === "background") {
                    if (isRemote(attr.value)) { report.remoteImages++; if (allowRemote) child.setAttribute("background", proxied(attr.value)); else child.removeAttribute("background"); }
                    else if (!/^data:image\/|^cid:/i.test(attr.value)) child.removeAttribute("background");
                }
            }
            if (name === "img") {
                const src = (child.getAttribute("src") || "").trim();
                child.removeAttribute("srcset");
                if (/^cid:/i.test(src)) {
                    const url = cidMap.get(src.slice(4).replace(/^<|>$/g, ""));
                    if (url) child.setAttribute("src", url); else child.removeAttribute("src");
                } else if (/^data:image\/(png|gif|jpe?g|webp|bmp);/i.test(src)) { /* inline image */ }
                else if (isRemote(src)) {
                    if (isTracker(child, src)) { report.trackers.push(host(src.startsWith("//") ? "https:" + src : src)); child.remove(); continue; }
                    report.remoteImages++;
                    if (allowRemote) child.setAttribute("src", proxied(src));
                    else { child.dataset.blocked = "1"; child.setAttribute("src", BLOCKED_IMAGE); child.setAttribute("alt", child.getAttribute("alt") || ""); }
                } else child.removeAttribute("src");
                child.setAttribute("loading", "lazy");
                child.setAttribute("referrerpolicy", "no-referrer");
            }
            if (name === "a" || name === "area") {
                const href = (child.getAttribute("href") || "").trim();
                if (!href) { child.removeAttribute("href"); }
                else if (href.startsWith("#")) { /* in-message anchor */ }
                else {
                    const risk = linkRisk(href, child.textContent);
                    if (risk === "unsafeScheme" || risk === "invalidLink") { child.removeAttribute("href"); report.removed++; }
                    else {
                        child.setAttribute("data-href", href);
                        report.links.push(href);
                        if (risk) { child.setAttribute("data-risk", risk); report.suspicious.push({ href, text: child.textContent.trim().slice(0, 120), risk }); }
                        child.setAttribute("rel", "noopener noreferrer");
                    }
                }
                child.removeAttribute("target");
            }
            walk(child);
        }
    };
    walk(doc.body);
    // Keep <style> blocks from <head> (already cleaned) so legitimate formatting survives.
    const styles = [...doc.head.querySelectorAll("style")].map(node => `<style>${cleanCss(node.textContent, report, allowRemote)}</style>`).join("");
    report.trackers = [...new Set(report.trackers)];
    return { html: styles + doc.body.innerHTML, report };
}

const FRAME_CSP = "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src data:; media-src 'none'; form-action 'none'; base-uri 'none'";

export function srcdoc(bodyHtml, { dark = false, font = "" } = {}) {
    const color = dark ? "color:#ece9f5;background:#16131f;" : "color:#1d2433;background:#ffffff;";
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><meta name="referrer" content="no-referrer">` +
        `<style>html,body{margin:0}body{padding:18px 20px;${color}font:16px/1.55 ${font || "system-ui, sans-serif"};overflow-wrap:anywhere;word-break:break-word}` +
        `img{max-width:100%;height:auto}table{max-width:100%}a{color:#5b3df5;cursor:pointer}a[data-risk]{text-decoration:underline wavy #d93a2b}` +
        `img[data-blocked]{display:inline-block;min-width:24px;min-height:24px;background:repeating-linear-gradient(45deg,#eee,#eee 6px,#f7f7f7 6px,#f7f7f7 12px);border-radius:6px}` +
        `pre{white-space:pre-wrap}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #ccc}</style></head><body>${bodyHtml}</body></html>`;
}

// Creates the iframe and wires measurement, link destinations, and safe link opening.
export function mountFrame(container, html, { dark = false, font = "", onLink } = {}) {
    const frame = el("iframe", { sandbox: "allow-same-origin", referrerpolicy: "no-referrer", title: t("messageContent"), loading: "lazy" });
    frame.srcdoc = srcdoc(html, { dark, font });
    container.replaceChildren(frame);
    const preview = el("div", { class: "mail-link-preview mu-tooltip", role: "tooltip", hidden: true });
    document.body.append(preview);
    let observer;
    frame.addEventListener("load", () => {
        const doc = frame.contentDocument;
        if (!doc) return;
        const resize = () => { frame.style.height = Math.min(doc.documentElement.scrollHeight + 4, 60_000) + "px"; };
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(doc.documentElement);
        doc.querySelectorAll("img").forEach(img => img.addEventListener("load", resize, { once: true }));
        doc.addEventListener("click", event => {
            const link = event.target.closest?.("a[href], area[href]");
            if (!link) return;
            event.preventDefault();
            const href = link.getAttribute("data-href") || link.getAttribute("href");
            if (href?.startsWith("#")) { doc.getElementById(href.slice(1))?.scrollIntoView(); return; }
            if (href) onLink?.(href, link.getAttribute("data-risk") || "", link.textContent.trim());
        });
        doc.addEventListener("submit", event => event.preventDefault(), true);
        doc.addEventListener("mouseover", event => {
            const link = event.target.closest?.("a[data-href]");
            if (!link) { preview.hidden = true; return; }
            const rect = frame.getBoundingClientRect();
            const linkRect = link.getBoundingClientRect();
            preview.textContent = (link.dataset.risk ? t("suspiciousLink") + " · " : "") + link.dataset.href;
            preview.hidden = false;
            preview.style.left = Math.max(8, Math.min(innerWidth - 540, rect.left + linkRect.left)) + "px";
            preview.style.top = Math.min(innerHeight - 40, rect.top + linkRect.bottom + 6) + "px";
        });
        doc.addEventListener("mouseleave", () => { preview.hidden = true; });
    });
    return { frame, dispose: () => { observer?.disconnect(); preview.remove(); } };
}

// Plain-text messages: escaped text with links created by this page (never from message HTML).
export function plainText(text) {
    const pre = el("pre", { class: "mail-plain" });
    const pattern = /\bhttps?:\/\/[^\s<>"')\]]+/g;
    let last = 0;
    for (const match of String(text || "").matchAll(pattern)) {
        pre.append(text.slice(last, match.index));
        pre.append(el("a", { href: match[0], "data-href": match[0], rel: "noopener noreferrer", text: match[0] }));
        last = match.index + match[0].length;
    }
    pre.append(String(text || "").slice(last));
    return pre;
}
