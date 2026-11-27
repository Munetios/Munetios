// HTML/CSS source editor: a textarea over a syntax-highlighted layer with line numbers, automatic indentation,
// code folding, tag completion, CSS property autocomplete, bracket matching, find and replace, and error markers.
// The original source is preserved exactly as typed (folded regions are restored when reading the value).
import { t } from "./i18n.js";
import { el, iconButton, button, debounce } from "./ui.js";

const CSS_PROPERTIES = ["align-items", "background", "background-color", "background-image", "background-position", "background-repeat", "background-size", "border", "border-bottom", "border-collapse",
    "border-color", "border-left", "border-radius", "border-right", "border-spacing", "border-style", "border-top", "border-width", "color", "direction", "display", "font", "font-family", "font-size",
    "font-style", "font-variant", "font-weight", "height", "letter-spacing", "line-height", "list-style", "margin", "margin-bottom", "margin-left", "margin-right", "margin-top", "max-height",
    "max-width", "min-height", "min-width", "mso-line-height-rule", "mso-table-lspace", "mso-table-rspace", "opacity", "outline", "overflow", "padding", "padding-bottom", "padding-left", "padding-right",
    "padding-top", "table-layout", "text-align", "text-decoration", "text-indent", "text-transform", "vertical-align", "visibility", "white-space", "width", "word-break", "word-spacing", "-webkit-text-size-adjust"];
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const esc = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PAIRS = { "(": ")", "[": "]", "{": "}" };

function highlight(source) {
    let out = "";
    const pattern = /(<!--[\s\S]*?(?:-->|$))|(<\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?>)?|(\{\{\s*\w+\s*\}\})/g;
    let last = 0;
    let inStyle = false;
    let match;
    while ((match = pattern.exec(source))) {
        const before = source.slice(last, match.index);
        out += inStyle ? css(before) : esc(before);
        last = pattern.lastIndex;
        if (match[1]) { out += `<span class="c-comment">${esc(match[1])}</span>`; continue; }
        if (match[6]) { out += `<span class="c-var">${esc(match[6])}</span>`; continue; }
        const [, , open, name, attrs, close] = match;
        out += `<span class="c-tag">${esc(open)}${esc(name)}</span>` + attributes(attrs || "") + (close ? `<span class="c-tag">${esc(close)}</span>` : "");
        if (name.toLowerCase() === "style") inStyle = open === "<";
    }
    out += inStyle ? css(source.slice(last)) : esc(source.slice(last));
    return out + "\n";
}

function attributes(text) {
    return text.replace(/([^\s=]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?|([^\s]+)/g, (all, name, eq, value, lone) => {
        if (lone) return `<span class="c-attr">${esc(lone)}</span>`;
        const styled = /^style$/i.test(name) && value ? value[0] + css(value.slice(1, -1)) + value.at(-1) : esc(value || "");
        return `<span class="c-attr">${esc(name)}</span>${esc(eq)}<span class="c-string">${styled}</span>`;
    });
}

function css(text) {
    return esc(text).replace(/([a-z-]+)(\s*:)(?![^{]*\{)/gi, '<span class="c-prop">$1</span>$2').replace(/(#[0-9a-f]{3,8})\b/gi, '<span class="c-color">$1</span>');
}

export class CodeEditor {
    constructor({ value = "", onChange = () => {} } = {}) {
        this.onChange = onChange;
        this.folds = new Map();
        this.issues = [];
        this.textarea = el("textarea", { class: "mail-code-input", spellcheck: "false", autocapitalize: "off", autocomplete: "off", wrap: "off", "aria-label": t("htmlSource") });
        this.layer = el("pre", { class: "mail-code-layer", "aria-hidden": "true" });
        this.gutter = el("div", { class: "mail-code-gutter", "aria-hidden": "true" });
        this.status = el("div", { class: "mail-code-status", role: "status", "aria-live": "polite" });
        this.complete = el("ul", { class: "mu-menu mail-code-complete", role: "listbox", hidden: true });
        this.findBar = el("div", { class: "mail-find", hidden: true });
        this.node = el("div", { class: "mu-code-editor" }, this.findBar, el("div", { class: "mail-code-body" }, this.gutter, el("div", { class: "mail-code-stack" }, this.layer, this.textarea, this.complete)), this.status);
        this.textarea.value = value;
        this.render = this.render.bind(this);
        this.textarea.addEventListener("input", () => { this.render(); this.autocomplete(); this.changed(); });
        this.textarea.addEventListener("scroll", () => this.sync());
        this.textarea.addEventListener("keydown", event => this.onKey(event));
        this.textarea.addEventListener("keyup", () => this.matchBracket());
        this.textarea.addEventListener("click", () => { this.matchBracket(); this.complete.hidden = true; });
        this.gutter.addEventListener("click", event => { const line = event.target.closest("[data-line]"); if (line?.dataset.fold) this.toggleFold(Number(line.dataset.line)); });
        this.changed = debounce(() => this.onChange(this.value), 250);
        this.render();
    }

    get value() {
        let text = this.textarea.value;
        for (let pass = 0; pass < 20 && /<!--fold:\d+[^>]*-->/.test(text); pass++) text = text.replace(/<!--fold:(\d+)[^>]*-->/g, (match, id) => this.folds.get(Number(id)) ?? match);
        return text;
    }
    set value(text) { this.folds.clear(); this.textarea.value = text; this.render(); }
    focus() { this.textarea.focus(); }
    setIssues(issues) { this.issues = issues; this.render(); }

    render() {
        const text = this.textarea.value;
        this.layer.innerHTML = highlight(text).replace(/&lt;!--fold:(\d+)( \d+)?--&gt;/g, (match, id, lines) => `<span class="c-fold">${t("foldedLines", { count: (lines || "").trim() || "?" })}</span>`);
        const lines = text.split("\n");
        const errors = new Map(this.issues.map(issue => [issue.line, issue.level]));
        const foldable = this.foldableLines(lines);
        this.gutter.replaceChildren(...lines.map((line, index) => el("div", {
            class: "mail-code-line" + (errors.has(index + 1) ? " is-" + errors.get(index + 1) : ""), "data-line": String(index + 1), "data-fold": foldable.has(index) || /<!--fold:\d+/.test(line) ? "1" : undefined,
            title: this.issues.filter(issue => issue.line === index + 1).map(issue => issue.message).join("\n") || undefined,
        }, String(index + 1), foldable.has(index) ? el("span", { class: "mu-icon mail-code-fold", "aria-hidden": "true", text: "expand_more" }) : /<!--fold:\d+/.test(line) ? el("span", { class: "mu-icon mail-code-fold", "aria-hidden": "true", text: "chevron_right" }) : null)));
        this.sync();
    }

    sync() {
        this.layer.scrollTop = this.textarea.scrollTop;
        this.layer.scrollLeft = this.textarea.scrollLeft;
        this.gutter.scrollTop = this.textarea.scrollTop;
    }

    foldableLines(lines) {
        const set = new Set();
        lines.forEach((line, index) => {
            const open = /^\s*<([a-zA-Z][\w-]*)\b[^>]*>\s*$/.exec(line);
            if (open && !VOID.has(open[1].toLowerCase()) && index + 1 < lines.length) set.add(index);
            if (/\{\s*$/.test(line)) set.add(index);
        });
        return set;
    }

    toggleFold(lineNumber) {
        const lines = this.textarea.value.split("\n");
        const line = lines[lineNumber - 1];
        const folded = /<!--fold:(\d+)[^>]*-->/.exec(line);
        if (folded) {
            lines[lineNumber - 1] = line.replace(folded[0], this.folds.get(Number(folded[1])));
            this.folds.delete(Number(folded[1]));
        } else {
            const indent = /^\s*/.exec(line)[0].length;
            const tag = /^\s*<([a-zA-Z][\w-]*)/.exec(line)?.[1];
            let end = lineNumber;
            for (; end < lines.length; end++) {
                const current = lines[end];
                const currentIndent = /^\s*/.exec(current)[0].length;
                if (tag ? new RegExp(`^\\s*</${tag}>`, "i").test(current) && currentIndent <= indent : /^\s*\}/.test(current) && currentIndent <= indent) break;
            }
            if (end <= lineNumber || end >= lines.length) return;
            const id = this.folds.size + Date.now() % 100000;
            const hidden = lines.slice(lineNumber, end);
            this.folds.set(id, hidden.join("\n"));
            lines.splice(lineNumber, end - lineNumber, " ".repeat(indent + 2) + `<!--fold:${id} ${hidden.length}-->`);
        }
        const position = this.textarea.selectionStart;
        this.textarea.value = lines.join("\n");
        this.textarea.selectionStart = this.textarea.selectionEnd = Math.min(position, this.textarea.value.length);
        this.render();
    }

    insert(text, select = 0) {
        const { selectionStart: start, selectionEnd: end } = this.textarea;
        this.textarea.setRangeText(text, start, end, "end");
        if (select) this.textarea.selectionStart = this.textarea.selectionEnd = start + select;
        this.render(); this.changed();
    }

    onKey(event) {
        const ta = this.textarea;
        if (!this.complete.hidden) {
            const items = [...this.complete.children];
            const active = items.findIndex(item => item.classList.contains("is-active"));
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((item, i) => item.classList.toggle("is-active", i === next)); return; }
            if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); (items[active] || items[0])?.click(); return; }
            if (event.key === "Escape") { this.complete.hidden = true; return; }
        }
        if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "h")) { event.preventDefault(); this.toggleFind(true); return; }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); this.onFormat?.(); return; }
        if (event.key === "Tab") {
            event.preventDefault();
            const { selectionStart: start, selectionEnd: end, value } = ta;
            if (start === end) { this.insert("  "); return; }
            const lineStart = value.lastIndexOf("\n", start - 1) + 1;
            const block = value.slice(lineStart, end);
            const changed = event.shiftKey ? block.replace(/^ {1,2}/gm, "") : block.replace(/^/gm, "  ");
            ta.setRangeText(changed, lineStart, end, "select");
            this.render(); this.changed();
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            const before = ta.value.slice(0, ta.selectionStart);
            const line = before.slice(before.lastIndexOf("\n") + 1);
            let indent = /^\s*/.exec(line)[0];
            const after = ta.value.slice(ta.selectionEnd);
            const opensTag = /<([a-zA-Z][\w-]*)[^>]*>$/.exec(line);
            if ((opensTag && !VOID.has(opensTag[1].toLowerCase()) && after.startsWith(`</${opensTag[1]}`)) || (/\{$/.test(line) && after.startsWith("}"))) {
                this.insert("\n" + indent + "  " + "\n" + indent, indent.length + 3);
                return;
            }
            if (opensTag && !VOID.has(opensTag[1].toLowerCase()) || /\{$/.test(line)) indent += "  ";
            this.insert("\n" + indent);
            return;
        }
        if (event.key === ">") {
            const before = ta.value.slice(0, ta.selectionStart);
            const open = /<([a-zA-Z][\w-]*)(?:\s[^<>]*)?$/.exec(before);
            if (open && !VOID.has(open[1].toLowerCase()) && !before.endsWith("/")) { event.preventDefault(); this.insert(`></${open[1]}>`, 1); return; }
        }
        if (PAIRS[event.key] || event.key === '"') {
            const close = PAIRS[event.key] || '"';
            if (ta.selectionStart !== ta.selectionEnd) { event.preventDefault(); const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd); this.insert(event.key + selected + close); }
            else if (event.key !== '"' || /[\s=>(]$/.test(ta.value.slice(0, ta.selectionStart))) { event.preventDefault(); this.insert(event.key + close, 1); }
        }
    }

    // CSS property suggestions inside <style> blocks and style="" attributes.
    autocomplete() {
        const ta = this.textarea;
        const before = ta.value.slice(0, ta.selectionStart);
        const inStyleBlock = before.lastIndexOf("<style") > before.lastIndexOf("</style");
        const inStyleAttr = /style\s*=\s*"[^"]*$/i.test(before);
        const word = /(?:^|[{;\s"])([a-z-]{2,})$/i.exec(before)?.[1];
        if (!(inStyleBlock || inStyleAttr) || !word || /:\s*[^;]*$/.test(before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("{"), before.lastIndexOf('"'))))) { this.complete.hidden = true; return; }
        const matches = CSS_PROPERTIES.filter(name => name.startsWith(word.toLowerCase()) && name !== word).slice(0, 8);
        if (!matches.length) { this.complete.hidden = true; return; }
        this.complete.replaceChildren(...matches.map((name, index) => {
            const item = el("li", { class: "mu-menu-item" + (index === 0 ? " is-active" : ""), role: "option", text: name });
            item.addEventListener("mousedown", event => event.preventDefault());
            item.addEventListener("click", () => { ta.setRangeText(name + ": ", ta.selectionStart - word.length, ta.selectionStart, "end"); this.complete.hidden = true; this.render(); this.changed(); ta.focus(); });
            return item;
        }));
        const lines = before.split("\n");
        this.complete.style.top = (lines.length * 28 - ta.scrollTop + 30) + "px";
        this.complete.style.insetInlineStart = Math.min(lines.at(-1).length * 10.8 - ta.scrollLeft + 14, ta.clientWidth - 200) + "px";
        this.complete.hidden = false;
    }

    // Shows where the bracket or tag next to the cursor is closed.
    matchBracket() {
        const ta = this.textarea;
        const text = ta.value;
        const at = ta.selectionStart;
        const char = text[at - 1];
        const closers = { ")": "(", "]": "[", "}": "{" };
        let target = -1;
        if (PAIRS[char]) {
            let depth = 0;
            for (let i = at - 1; i < text.length; i++) { if (text[i] === char) depth++; else if (text[i] === PAIRS[char]) { depth--; if (!depth) { target = i; break; } } }
        } else if (closers[char]) {
            let depth = 0;
            for (let i = at - 1; i >= 0; i--) { if (text[i] === char) depth++; else if (text[i] === closers[char]) { depth--; if (!depth) { target = i; break; } } }
        } else {
            const tagStart = text.lastIndexOf("<", at);
            const open = /^<([a-zA-Z][\w-]*)/.exec(text.slice(tagStart, at + 20));
            if (open && text.lastIndexOf(">", at - 1) < tagStart) {
                const name = open[1];
                const pattern = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
                pattern.lastIndex = tagStart;
                let depth = 0, m;
                while ((m = pattern.exec(text))) { depth += m[1] ? -1 : 1; if (!depth) { target = m.index; break; } }
            }
        }
        const line = text.slice(0, at).split("\n").length;
        const column = at - text.lastIndexOf("\n", at - 1);
        this.status.textContent = t("cursorPosition", { line, column }) + (target >= 0 && target !== at - 1 ? " · " + t("matchAtLine", { line: text.slice(0, target).split("\n").length }) : "");
    }

    toggleFind(force) {
        const show = force ?? this.findBar.hidden;
        this.findBar.hidden = !show;
        if (!show) return;
        const find = el("input", { class: "mu-input", placeholder: t("find"), "aria-label": t("find") });
        const replace = el("input", { class: "mu-input", placeholder: t("replaceWith"), "aria-label": t("replaceWith") });
        const regex = el("input", { type: "checkbox" });
        const status = el("span", { class: "mu-muted", style: undefined });
        const pattern = () => { try { return new RegExp(regex.checked ? find.value : find.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); } catch { return null; } };
        const next = () => {
            const re = pattern();
            if (!re || !find.value) return;
            const text = this.textarea.value;
            re.lastIndex = this.textarea.selectionEnd;
            let m = re.exec(text);
            if (!m) { re.lastIndex = 0; m = re.exec(text); }
            if (!m) { status.textContent = t("noMatches"); return; }
            this.textarea.focus();
            this.textarea.setSelectionRange(m.index, m.index + m[0].length);
            const lineIndex = text.slice(0, m.index).split("\n").length - 1;
            this.textarea.scrollTop = Math.max(0, lineIndex * 28 - 84);
            status.textContent = t("matchCount", { count: (text.match(pattern()) || []).length });
        };
        const replaceOne = () => { const re = pattern(); const { selectionStart: s, selectionEnd: e } = this.textarea; if (re && s !== e && new RegExp(`^(?:${re.source})$`, "i").test(this.textarea.value.slice(s, e))) this.insert(replace.value); next(); };
        const replaceAll = () => { const re = pattern(); if (!re) return; const count = (this.textarea.value.match(re) || []).length; this.textarea.value = this.textarea.value.replace(re, replace.value); this.render(); this.changed(); status.textContent = t("replacedCount", { count }); };
        find.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); next(); } if (event.key === "Escape") this.toggleFind(false); });
        this.findBar.replaceChildren(find, replace, el("label", { class: "mu-check", style: undefined }, regex, t("regularExpression")), status,
            iconButton("expand_more", t("next"), next), button(t("replace"), replaceOne), button(t("replaceAll"), replaceAll), iconButton("close", t("close"), () => this.toggleFind(false)));
        find.focus();
    }
}
