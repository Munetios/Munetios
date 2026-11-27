// Rich-text email editor on contenteditable. Formatting commands, tables, images, links, buttons, checklists,
// special characters, find and replace, an undo history, sanitized paste, and pasted or dropped images.
// Spell checking is the browser's built-in checker.
import { t } from "./i18n.js";
import { el, icon, iconButton, menu, dialog, button, field, toast, debounce, promptDialog, colorField, stepper } from "./ui.js";
import { cleanPasted } from "./html-tools.js";

const FONTS = ["Munetios UI v4 Font", "Google Sans Flex", "Arial", "Georgia", "Times New Roman", "Verdana", "Trebuchet MS", "Courier New", "Google Sans Code"];
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
const CHARS = "©®™§¶†‡•…–—‘’“”«»‹›¡¿€£¥¢₹₽₩₺±×÷≈≠≤≥∞√∑∏∫∂µπΩαβγδλσφψ°′″←↑→↓↔⇒⇔✓✗★☆♠♣♥♦½⅓¼¾⅛¹²³áéíóúñüçàèìòùâêîôûäëïöœæßøåþðł";

export class RichEditor {
    constructor({ html = "", spellcheck = true, onChange = () => {}, onImage = async () => null, placeholder = "" } = {}) {
        this.onChange = onChange;
        this.onImage = onImage;
        this.history = [];
        this.future = [];
        this.area = el("div", { class: "mail-rte", contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": t("messageBody"), spellcheck: String(spellcheck), "data-placeholder": placeholder });
        this.area.innerHTML = html;
        this.findBar = el("div", { class: "mail-find", hidden: true });
        this.bar = this.toolbar();
        this.node = el("div", { class: "mail-compose-editor" }, this.bar, this.findBar, this.area);
        this.snapshot = debounce(() => this.record(), 400);
        this.area.addEventListener("input", () => { this.snapshot(); this.onChange(); this.updateState(); });
        this.area.addEventListener("keyup", () => this.updateState());
        this.area.addEventListener("mouseup", () => this.updateState());
        this.area.addEventListener("keydown", event => this.onKey(event));
        this.area.addEventListener("paste", event => this.onPaste(event));
        this.area.addEventListener("drop", event => this.onDrop(event));
        this.area.addEventListener("click", event => this.onClick(event));
        this.area.addEventListener("contextmenu", event => this.onContext(event));
        this.record();
    }

    get html() { return this.area.innerHTML; }
    set html(value) { this.area.innerHTML = value; this.record(); }
    focus() { this.area.focus(); }

    record() {
        const value = this.area.innerHTML;
        if (this.history.at(-1) === value) return;
        this.history.push(value);
        if (this.history.length > 200) this.history.shift();
        this.future = [];
    }
    undo() { if (this.history.length < 2) return; this.future.push(this.history.pop()); this.area.innerHTML = this.history.at(-1); this.caretEnd(); this.onChange(); }
    redo() { const value = this.future.pop(); if (value === undefined) return; this.history.push(value); this.area.innerHTML = value; this.caretEnd(); this.onChange(); }
    caretEnd() { const range = document.createRange(); range.selectNodeContents(this.area); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }

    exec(command, value = null) {
        this.area.focus();
        document.execCommand("styleWithCSS", false, true);
        document.execCommand(command, false, value);
        this.record(); this.onChange(); this.updateState();
    }

    // Wraps the selection in a span with one style property (font size, weight, family).
    styleSelection(property, value) {
        this.area.focus();
        const selection = getSelection();
        if (!selection.rangeCount || selection.isCollapsed) { toast(t("selectTextFirst")); return; }
        const range = selection.getRangeAt(0);
        const span = el("span");
        span.style.setProperty(property, value);
        span.append(range.extractContents());
        range.insertNode(span);
        selection.removeAllRanges();
        const after = document.createRange(); after.selectNodeContents(span); selection.addRange(after);
        this.record(); this.onChange();
    }

    block() {
        const selection = getSelection();
        let node = selection.rangeCount ? selection.getRangeAt(0).startContainer : null;
        while (node && node !== this.area) { if (node.nodeType === 1 && /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH|FIGURE)$/.test(node.nodeName)) return node; node = node.parentNode; }
        return null;
    }

    insertHtml(html) { this.area.focus(); document.execCommand("insertHTML", false, html); this.record(); this.onChange(); }
    insertNode(node) {
        this.area.focus();
        const selection = getSelection();
        if (!selection.rangeCount || !this.area.contains(selection.anchorNode)) { this.area.append(node); }
        else { const range = selection.getRangeAt(0); range.deleteContents(); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
        this.record(); this.onChange();
    }

    toolbar() {
        const b = (name, label, fn, extra = {}) => iconButton(name, label, event => { event.preventDefault(); fn(event); }, { ...extra, "data-cmd": extra["data-cmd"] || "" });
        const textStyle = el("button", { type: "button", class: "mu-toolbar-field", "aria-label": t("textStyle") }, t("paragraph"), icon("arrow_drop_down"));
        textStyle.addEventListener("click", () => menu(textStyle, [
            ["p", t("paragraph")], ["h1", t("heading1")], ["h2", t("heading2")], ["h3", t("heading3")], ["h4", t("heading4")], ["blockquote", t("quote")], ["pre", t("codeBlock")],
        ].map(([tag, label]) => ({ label, action: () => this.exec("formatBlock", tag) })), { label: t("textStyle") }));
        const font = el("button", { type: "button", class: "mu-toolbar-field", "aria-label": t("font") }, icon("font_download"));
        font.addEventListener("click", () => menu(font, FONTS.map(name => ({ label: name, action: () => this.styleSelection("font-family", `"${name}", sans-serif`) })), { label: t("font") }));
        const size = el("button", { type: "button", class: "mu-toolbar-field", "aria-label": t("fontSize") }, icon("format_size"));
        size.addEventListener("click", () => menu(size, SIZES.map(px => ({ label: px + " px", action: () => this.styleSelection("font-size", px + "px") })), { label: t("fontSize") }));
        const weight = b("line_weight", t("fontWeight"), event => menu(event.currentTarget, [300, 400, 500, 600, 700].map(value => ({ label: String(value), action: () => this.styleSelection("font-weight", String(value)) }))));
        const color = this.colorButton("format_color_text", t("textColor"), value => this.exec("foreColor", value));
        const highlight = this.colorButton("format_ink_highlighter", t("highlight"), value => this.exec("hiliteColor", value));
        const align = b("format_align_left", t("alignment"), event => menu(event.currentTarget, [
            { icon: "format_align_left", label: t("alignLeft"), action: () => this.exec("justifyLeft") }, { icon: "format_align_center", label: t("alignCenter"), action: () => this.exec("justifyCenter") },
            { icon: "format_align_right", label: t("alignRight"), action: () => this.exec("justifyRight") }, { icon: "format_align_justify", label: t("justify"), action: () => this.exec("justifyFull") },
        ]));
        const spacing = b("format_line_spacing", t("lineSpacing"), event => menu(event.currentTarget, [1, 1.15, 1.5, 2, 2.5].map(value => ({ label: String(value), action: () => { const node = this.block(); if (node) { node.style.lineHeight = String(value); this.record(); this.onChange(); } } }))));
        const insert = b("add_box", t("insert"), event => menu(event.currentTarget, [
            { icon: "image", label: t("image"), action: () => this.onImage("pick") },
            { icon: "table", label: t("table"), action: () => this.tableDialog() },
            { icon: "smart_button", label: t("buttonBlock"), action: () => this.buttonDialog() },
            { icon: "horizontal_rule", label: t("divider"), action: () => this.exec("insertHorizontalRule") },
            { icon: "checklist", label: t("checklist"), action: () => this.checklist() },
            { icon: "code_blocks", label: t("codeBlock"), action: () => this.exec("formatBlock", "pre") },
            { icon: "format_quote", label: t("quote"), action: () => this.exec("formatBlock", "blockquote") },
            { icon: "special_character", label: t("specialCharacters"), action: () => this.charDialog() },
        ], { label: t("insert") }));
        return el("div", { class: "mail-format-bar", role: "toolbar", "aria-label": t("formatting") },
            b("undo", t("undo"), () => this.undo()), b("redo", t("redo"), () => this.redo()), el("span", { class: "mu-divider-v" }),
            textStyle, font, size, el("span", { class: "mu-divider-v" }),
            b("format_bold", t("bold"), () => this.exec("bold"), { "data-cmd": "bold" }), b("format_italic", t("italic"), () => this.exec("italic"), { "data-cmd": "italic" }),
            b("format_underlined", t("underline"), () => this.exec("underline"), { "data-cmd": "underline" }), b("format_strikethrough", t("strikethrough"), () => this.exec("strikeThrough"), { "data-cmd": "strikeThrough" }),
            b("superscript", t("superscript"), () => this.exec("superscript"), { "data-cmd": "superscript" }), b("subscript", t("subscript"), () => this.exec("subscript"), { "data-cmd": "subscript" }),
            weight, color, highlight, el("span", { class: "mu-divider-v" }),
            align, spacing, b("format_list_bulleted", t("bulletedList"), () => this.exec("insertUnorderedList")), b("format_list_numbered", t("numberedList"), () => this.exec("insertOrderedList")),
            b("format_indent_decrease", t("decreaseIndent"), () => this.exec("outdent")), b("format_indent_increase", t("increaseIndent"), () => this.exec("indent")), el("span", { class: "mu-divider-v" }),
            b("link", t("link"), () => this.linkDialog()), insert, b("format_clear", t("clearFormatting"), () => this.exec("removeFormat")), b("find_replace", t("findReplace"), () => this.toggleFind()));
    }

    // Munetios UI v4 color picker; the text selection is restored before the color is applied.
    colorButton(iconName, label, apply) {
        let last = "#5B3DF5";
        const btn = iconButton(iconName, label, () => {
            const selection = getSelection();
            const range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
            window.MunetiosUI.pickColor({ anchor: btn, value: last, onPick: value => {
                if (!value) return;
                last = value;
                if (range) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
                apply(value);
            } });
        });
        return btn;
    }

    pickColorFor(anchor, value, apply) {
        window.MunetiosUI.pickColor({ anchor, value, onPick: next => { if (next) apply(next); } });
    }

    updateState() {
        for (const node of this.bar.querySelectorAll("[data-cmd]")) {
            if (!node.dataset.cmd) continue;
            let on = false;
            try { on = document.queryCommandState(node.dataset.cmd); } catch { /* unsupported */ }
            node.classList.toggle("is-active", on);
            node.setAttribute("aria-pressed", String(on));
        }
    }

    onKey(event) {
        const mod = event.ctrlKey || event.metaKey;
        if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
        else if (mod && event.key.toLowerCase() === "y") { event.preventDefault(); this.redo(); }
        else if (mod && event.key.toLowerCase() === "k") { event.preventDefault(); this.linkDialog(); }
        else if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); this.toggleFind(true); }
        else if (mod && event.key.toLowerCase() === "h") { event.preventDefault(); this.toggleFind(true); }
        else if (event.key === "Tab" && this.inCell()) { event.preventDefault(); this.nextCell(event.shiftKey); }
    }

    async onPaste(event) {
        const items = [...(event.clipboardData?.items || [])];
        const images = items.filter(item => item.kind === "file" && item.type.startsWith("image/"));
        if (images.length) {
            event.preventDefault();
            for (const item of images) { const file = item.getAsFile(); if (file) this.onImage("file", file); }
            return;
        }
        const html = event.clipboardData?.getData("text/html");
        if (html) { event.preventDefault(); this.insertHtml(cleanPasted(html)); }
    }

    onDrop(event) {
        const files = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith("image/"));
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        for (const file of files) this.onImage("file", file);
    }

    insertImage(src, { cid, alt = "", upload = "" } = {}) {
        const img = el("img", { src, alt, "data-cid": cid || undefined, "data-upload": upload || undefined, style: "max-width:100%;height:auto" });
        this.insertNode(img);
        return img;
    }

    onClick(event) {
        this.area.querySelectorAll("img.is-selected").forEach(img => img.classList.remove("is-selected"));
        this.imageTools?.remove();
        const li = event.target.closest("ul[data-checklist] > li");
        if (li && event.offsetX < 24) { li.dataset.checked = String(li.dataset.checked !== "true"); this.record(); this.onChange(); return; }
        const img = event.target.closest("img");
        if (img) this.selectImage(img);
    }

    selectImage(img) {
        img.classList.add("is-selected");
        const size = value => { img.style.width = value; img.style.height = "auto"; img.removeAttribute("width"); img.removeAttribute("height"); this.record(); this.onChange(); };
        const alignTo = value => {
            img.style.float = value === "left" || value === "right" ? value : "none";
            img.style.display = value === "center" ? "block" : "";
            img.style.margin = value === "center" ? "8px auto" : value === "left" ? "4px 12px 4px 0" : value === "right" ? "4px 0 4px 12px" : "";
            this.record(); this.onChange();
        };
        const tools = el("div", { class: "mail-image-tools mu-glass mu-glass-solid" },
            iconButton("photo_size_select_small", t("small"), () => size("25%")), iconButton("photo_size_select_large", t("medium"), () => size("50%")), iconButton("fit_screen", t("fullWidth"), () => size("100%")),
            iconButton("format_align_left", t("alignLeft"), () => alignTo("left")), iconButton("format_align_center", t("alignCenter"), () => alignTo("center")), iconButton("format_align_right", t("alignRight"), () => alignTo("right")),
            iconButton("closed_caption", t("caption"), () => this.caption(img)), iconButton("text_fields", t("altText"), async () => {
                const value = await promptDialog({ title: t("altText"), label: t("altTextHelp"), value: img.alt });
                if (value !== null) { img.alt = value; this.record(); this.onChange(); }
            }), iconButton("delete", t("remove"), () => { (img.closest("figure") || img).remove(); tools.remove(); this.record(); this.onChange(); }));
        this.node.append(tools);
        const editorRect = this.node.getBoundingClientRect();
        const rect = img.getBoundingClientRect();
        tools.style.top = Math.max(0, rect.top - editorRect.top - 50) + "px";
        tools.style.insetInlineStart = Math.max(4, rect.left - editorRect.left) + "px";
        this.imageTools = tools;
        // Drag the bottom-right corner area to resize.
        img.onpointerdown = event => {
            const box = img.getBoundingClientRect();
            if (event.clientX < box.right - 24 || event.clientY < box.bottom - 24) return;
            event.preventDefault();
            const start = event.clientX, width = box.width;
            const move = ev => { img.style.width = Math.max(40, width + ev.clientX - start) + "px"; img.style.height = "auto"; };
            const up = () => { removeEventListener("pointermove", move); this.record(); this.onChange(); };
            addEventListener("pointermove", move);
            addEventListener("pointerup", up, { once: true });
        };
    }

    async caption(img) {
        const figure = img.closest("figure");
        const current = figure?.querySelector("figcaption")?.textContent || "";
        const value = await promptDialog({ title: t("caption"), label: t("caption"), value: current });
        if (value === null) return;
        if (figure) { figure.querySelector("figcaption").textContent = value; }
        else {
            const wrap = el("figure", { style: "margin:12px 0;text-align:center" });
            img.replaceWith(wrap);
            wrap.append(img, el("figcaption", { style: "font-size:13px;color:#5f6475", text: value }));
        }
        this.record(); this.onChange();
    }

    linkDialog() {
        const selection = getSelection();
        const range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
        const existing = selection.anchorNode?.parentElement?.closest?.("a");
        const url = el("input", { class: "mu-input", type: "url", value: existing?.getAttribute("href") || "https://", spellcheck: "false" });
        const text = el("input", { class: "mu-input", value: existing?.textContent || selection.toString() });
        const d = dialog({ title: existing ? t("editLink") : t("insertLink"), iconName: "link", content: [field(t("linkUrl"), url), field(t("linkText"), text)], actions: [
            existing ? button(t("removeLink"), () => { existing.replaceWith(...existing.childNodes); d.close(); this.record(); this.onChange(); }) : null,
            button(t("cancel"), () => d.close()),
            button(t("save"), () => {
                const href = url.value.trim();
                if (!/^(https?:|mailto:|tel:)/i.test(href)) { toast(t("invalidLink"), "error"); return; }
                d.close();
                if (existing) { existing.href = href; if (text.value) existing.textContent = text.value; this.record(); this.onChange(); return; }
                if (range) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
                const link = el("a", { href, text: text.value || href });
                this.insertNode(link);
            }, { primary: true }),
        ].filter(Boolean) });
        setTimeout(() => url.focus(), 50);
    }

    buttonDialog() {
        const label = el("input", { class: "mu-input", value: t("buttonDefault") });
        const url = el("input", { class: "mu-input", type: "url", value: "https://" });
        const color = { value: "#6D4AFF" };
        const d = dialog({ title: t("buttonBlock"), iconName: "smart_button", content: [field(t("linkText"), label), field(t("linkUrl"), url), field(t("color"), colorField(t("color"), color.value, value => { color.value = value || color.value; }))], actions: [
            button(t("cancel"), () => d.close()),
            button(t("insert"), () => {
                if (!/^https?:/i.test(url.value)) { toast(t("invalidLink"), "error"); return; }
                d.close();
                const table = el("table", { role: "presentation", cellpadding: "0", cellspacing: "0", border: "0", style: "margin:12px 0" },
                    el("tr", {}, el("td", { style: `border-radius:24px;background:${color.value}` }, el("a", { href: url.value, style: `display:inline-block;padding:12px 26px;color:#ffffff;text-decoration:none;font-weight:600;border-radius:24px;background:${color.value}`, text: label.value || t("buttonDefault") }))));
                this.insertNode(table);
            }, { primary: true }),
        ] });
    }

    tableDialog() {
        const size = { rows: 3, cols: 3, border: "#C9CDD8", background: "#FFFFFF" };
        const d = dialog({ title: t("insertTable"), iconName: "table", content: [
            el("div", { class: "mail-inline-form" }, field(t("rows"), stepper(t("rows"), 3, { min: 1, max: 500 }, value => { size.rows = value; })), field(t("columns"), stepper(t("columns"), 3, { min: 1, max: 50 }, value => { size.cols = value; }))),
            el("div", { class: "mail-inline-form" }, field(t("borderColor"), colorField(t("borderColor"), size.border, value => { size.border = value || size.border; })), field(t("backgroundColor"), colorField(t("backgroundColor"), size.background, value => { size.background = value || size.background; })))], actions: [
            button(t("cancel"), () => d.close()),
            button(t("insert"), () => {
                d.close();
                const table = el("table", { style: `border-collapse:collapse;width:100%;background:${size.background}` });
                for (let r = 0; r < size.rows; r++) {
                    const tr = el("tr");
                    for (let c = 0; c < size.cols; c++) tr.append(el(r === 0 ? "th" : "td", { style: `border:1px solid ${size.border};padding:6px 10px;text-align:left` }, el("br")));
                    table.append(tr);
                }
                this.insertNode(table);
            }, { primary: true }),
        ] });
    }

    inCell() { const node = getSelection().anchorNode; return Boolean(node && (node.nodeType === 1 ? node : node.parentElement)?.closest("td, th") && this.area.contains(node)); }
    cell() { const node = getSelection().anchorNode; return (node?.nodeType === 1 ? node : node?.parentElement)?.closest("td, th"); }
    nextCell(back) {
        const cells = [...this.area.querySelectorAll("td, th")];
        const index = cells.indexOf(this.cell());
        const target = cells[index + (back ? -1 : 1)];
        if (!target) return;
        const range = document.createRange(); range.selectNodeContents(target); range.collapse(true);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }

    onContext(event) {
        const cell = event.target.closest("td, th");
        if (!cell || !this.area.contains(cell)) return;
        event.preventDefault();
        const row = cell.parentElement;
        const table = cell.closest("table");
        const index = [...row.children].indexOf(cell);
        const style = cell.getAttribute("style") || "";
        const blank = tag => { const node = el(tag, { style }); node.append(el("br")); return node; };
        const change = () => { this.record(); this.onChange(); };
        menu(cell, [
            { icon: "add_row_above", label: t("rowAbove"), action: () => { const tr = el("tr"); [...row.children].forEach(() => tr.append(blank("td"))); row.before(tr); change(); } },
            { icon: "add_row_below", label: t("rowBelow"), action: () => { const tr = el("tr"); [...row.children].forEach(() => tr.append(blank("td"))); row.after(tr); change(); } },
            { icon: "add_column_left", label: t("columnLeft"), action: () => { for (const tr of table.rows) tr.children[index]?.before(blank(tr.children[index]?.localName || "td")); change(); } },
            { icon: "add_column_right", label: t("columnRight"), action: () => { for (const tr of table.rows) tr.children[index]?.after(blank(tr.children[index]?.localName || "td")); change(); } },
            "sep",
            { icon: "format_color_fill", label: t("cellBackground"), action: () => this.pickColorFor(cell, "#F1ECFF", value => { cell.style.background = value; change(); }) },
            { icon: "border_all", label: t("tableBorders"), action: () => this.pickColorFor(cell, "#C9CDD8", value => { for (const node of table.querySelectorAll("td, th")) node.style.border = `1px solid ${value}`; change(); }) },
            "sep",
            { icon: "delete", label: t("deleteRow"), danger: true, action: () => { row.remove(); if (!table.rows.length) table.remove(); change(); } },
            { icon: "delete", label: t("deleteColumn"), danger: true, action: () => { for (const tr of table.rows) tr.children[index]?.remove(); if (!table.rows[0]?.children.length) table.remove(); change(); } },
            { icon: "delete_forever", label: t("deleteTable"), danger: true, action: () => { table.remove(); change(); } },
        ], { point: { x: event.clientX, y: event.clientY }, label: t("table") });
    }

    checklist() {
        const list = el("ul", { "data-checklist": "true" }, el("li", { "data-checked": "false" }, el("br")));
        this.insertNode(list);
    }

    charDialog() {
        const d = dialog({ title: t("specialCharacters"), iconName: "special_character", content: [el("div", { class: "mail-charmap" }, [...CHARS].map(char => el("button", { type: "button", "aria-label": char, text: char, onclick: () => { d.close(); this.insertHtml(char); } })))],
            actions: [button(t("close"), () => d.close())] });
    }

    /* ---------------------------------------------------------------- find and replace */
    toggleFind(force) {
        const show = force ?? this.findBar.hidden;
        this.findBar.hidden = !show;
        this.clearHits();
        if (!show) return;
        const find = el("input", { class: "mu-input", placeholder: t("find"), "aria-label": t("find") });
        const replace = el("input", { class: "mu-input", placeholder: t("replaceWith"), "aria-label": t("replaceWith") });
        const status = el("span", { class: "mu-muted" });
        const caseBox = el("input", { type: "checkbox" });
        let index = 0;
        const search = () => {
            this.clearHits();
            const term = find.value;
            if (!term) { status.textContent = ""; return []; }
            const hits = [];
            const walker = document.createTreeWalker(this.area, NodeFilter.SHOW_TEXT);
            const needle = caseBox.checked ? term : term.toLowerCase();
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            for (const node of nodes) {
                const hay = caseBox.checked ? node.data : node.data.toLowerCase();
                let at = hay.indexOf(needle);
                let current = node;
                let offset = 0;
                while (at >= 0) {
                    const range = document.createRange();
                    range.setStart(current, at - offset);
                    range.setEnd(current, at - offset + term.length);
                    const mark = el("mark", { class: "mail-find-hit" });
                    range.surroundContents(mark);
                    hits.push(mark);
                    current = mark.nextSibling;
                    if (!current || current.nodeType !== 3) break;
                    offset = at + term.length;
                    at = hay.indexOf(needle, offset);
                }
            }
            index = Math.min(index, Math.max(0, hits.length - 1));
            hits.forEach((mark, i) => mark.classList.toggle("is-current", i === index));
            hits[index]?.scrollIntoView({ block: "nearest" });
            status.textContent = hits.length ? t("matchOf", { current: index + 1, total: hits.length }) : t("noMatches");
            return hits;
        };
        find.addEventListener("input", () => { index = 0; search(); });
        find.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); index++; if (index >= search().length) { index = 0; search(); } } if (event.key === "Escape") this.toggleFind(false); });
        const replaceOne = () => { const hits = search(); const mark = hits[index]; if (!mark) return; mark.replaceWith(document.createTextNode(replace.value)); this.record(); this.onChange(); search(); };
        const replaceAll = () => { const hits = search(); for (const mark of hits) mark.replaceWith(document.createTextNode(replace.value)); this.area.normalize(); this.record(); this.onChange(); status.textContent = t("replacedCount", { count: hits.length }); };
        this.findBar.replaceChildren(find, replace, el("label", { class: "mu-check" }, caseBox, t("matchCase")), status,
            iconButton("expand_more", t("next"), () => { index++; if (index >= search().length) { index = 0; search(); } }),
            button(t("replace"), replaceOne), button(t("replaceAll"), replaceAll), iconButton("close", t("close"), () => this.toggleFind(false)));
        find.focus();
    }

    clearHits() {
        for (const mark of this.area.querySelectorAll("mark.mail-find-hit")) mark.replaceWith(...mark.childNodes);
        this.area.normalize();
    }
}

