// Drag-and-drop visual email designer. The editable design is JSON; the delivery HTML is generated with
// table-based layouts and inline CSS so it works in email clients that ignore modern CSS.
import { t } from "./i18n.js";
import { el, icon, button, field, select, toast, promptDialog, colorField, stepper, check } from "./ui.js";
import { VARIABLES } from "./html-tools.js";

const uid = () => "b" + Math.random().toString(36).slice(2, 10);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = value => /^(https?:|mailto:|tel:|cid:)/i.test(String(value || "").trim()) ? String(value).trim() : "";
const color = value => /^#[0-9a-f]{6}$/i.test(value || "") ? value : "";
const DESIGN_FONTS = [
    "'Munetios UI v4 Font', Arial, Helvetica, sans-serif",
    "'Google Sans Flex', Arial, Helvetica, sans-serif",
    "Arial, Helvetica, sans-serif",
    "Georgia, serif",
    "'Trebuchet MS', sans-serif",
    "Verdana, sans-serif",
    "'Times New Roman', serif",
    "'Courier New', monospace",
];
const googleSansFeatures = font => font === DESIGN_FONTS[1] ? ";font-feature-settings:'ss01' 1" : "";

export const BLOCKS = {
    header: () => ({ type: "header", props: { text: t("designerHeaderText"), logo: "", align: "center", background: "#6d4aff", color: "#ffffff", padding: 28, size: 28 } }),
    text: () => ({ type: "text", props: { html: `<p>${esc(t("designerTextSample"))}</p>`, align: "left", color: "#1d2433", size: 16, lineHeight: 1.6, padding: 16, background: "" } }),
    image: () => ({ type: "image", props: { src: "", alt: "", href: "", width: 100, align: "center", padding: 12, radius: 12 } }),
    button: () => ({ type: "button", props: { text: t("buttonDefault"), href: "https://", background: "#6d4aff", color: "#ffffff", align: "center", radius: 24, padding: 16, size: 16 } }),
    divider: () => ({ type: "divider", props: { color: "#e3e5ec", thickness: 1, padding: 16, width: 100 } }),
    spacer: () => ({ type: "spacer", props: { height: 24, background: "" } }),
    columns: () => ({ type: "columns", props: { count: 2, gap: 16, padding: 12, background: "", stack: true }, columns: [[], []] }),
    table: () => ({ type: "table", props: { rows: [["", ""], ["", ""]], header: true, border: "#d6d9e3", headerBackground: "#f3f0ff", padding: 12 } }),
    footer: () => ({ type: "footer", props: { html: `<p>${esc(t("designerFooterText"))}</p>`, align: "center", color: "#6b7183", size: 13, padding: 24, background: "#f6f7fb" } }),
    html: () => ({ type: "html", props: { html: "<p>HTML</p>" } }),
};
const BLOCK_ICONS = { header: "title", text: "notes", image: "image", button: "smart_button", divider: "horizontal_rule", spacer: "height", columns: "view_column", table: "table", footer: "call_to_action", html: "code" };

export function emptyDesign() {
    return { version: 1, settings: { background: "#eef0f6", contentBackground: "#ffffff", width: 600, font: DESIGN_FONTS[0], textColor: "#1d2433", linkColor: "#5b3df5", padding: 24, radius: 16, preheader: "" }, blocks: [] };
}

export function templateDesign(kind) {
    const design = emptyDesign();
    const add = (type, props = {}) => { const block = { id: uid(), ...BLOCKS[type]() }; Object.assign(block.props, props); design.blocks.push(block); return block; };
    if (kind === "newsletter") {
        add("header", { text: t("templateNewsletterTitle") });
        add("text", { html: `<h2>${esc(t("templateNewsletterHeadline"))}</h2><p>${esc(t("designerTextSample"))}</p>` });
        const cols = add("columns");
        cols.columns = [[{ id: uid(), ...BLOCKS.text(), props: { ...BLOCKS.text().props, html: `<h3>${esc(t("templateStoryOne"))}</h3><p>${esc(t("designerTextShort"))}</p>` } }], [{ id: uid(), ...BLOCKS.text(), props: { ...BLOCKS.text().props, html: `<h3>${esc(t("templateStoryTwo"))}</h3><p>${esc(t("designerTextShort"))}</p>` } }]];
        add("button", { text: t("readMore") }); add("divider"); add("footer");
    } else if (kind === "business") {
        add("text", { html: `<p>${esc(t("templateGreeting"))}</p><p>${esc(t("designerTextSample"))}</p><p>${esc(t("templateSignOff"))}<br>{{sender_name}}</p>`, padding: 28 });
        add("divider"); add("footer", { html: `<p>{{sender_name}}</p>` });
    } else if (kind === "invitation") {
        add("header", { text: t("templateInvitationTitle"), background: "#1f1440", size: 32, padding: 40 });
        add("text", { html: `<p style="text-align:center">${esc(t("templateInvitationBody"))}</p>`, align: "center" });
        add("table", { rows: [[t("date"), ""], [t("time"), ""], [t("place"), ""]], header: false });
        add("button", { text: t("templateRsvp") }); add("footer");
    } else if (kind === "announcement") {
        add("image", { alt: t("image") });
        add("header", { text: t("templateAnnouncementTitle"), background: "#ffffff", color: "#1d2433" });
        add("text", { html: `<p>${esc(t("designerTextSample"))}</p>` }); add("button", { text: t("learnMore") }); add("footer");
    }
    return design;
}

/* ---------------------------------------------------------------- HTML generation */
function blockHtml(block, settings) {
    const p = block.props;
    const pad = n => `${Number(n) || 0}px`;
    switch (block.type) {
        case "header": return `<tr><td align="${p.align}" style="padding:${pad(p.padding)};background-color:${color(p.background) || "transparent"};color:${color(p.color)};font-size:${Number(p.size)}px;line-height:1.25;font-family:${settings.font}">${safeUrl(p.logo) ? `<img src="${esc(safeUrl(p.logo))}" alt="" width="120" style="display:block;margin:0 auto 12px;border:0;max-width:120px;height:auto">` : ""}${esc(p.text)}</td></tr>`;
        case "text": case "footer": return `<tr><td align="${p.align}" style="padding:${pad(p.padding)};${color(p.background) ? `background-color:${p.background};` : ""}color:${color(p.color)};font-size:${Number(p.size)}px;line-height:${Number(p.lineHeight) || 1.6};font-family:${settings.font};text-align:${p.align}">${p.html}</td></tr>`;
        case "image": {
            const src = safeUrl(p.src);
            if (!src) return "";
            const img = `<img src="${esc(src)}" alt="${esc(p.alt)}" width="${Math.round(settings.width * (Number(p.width) || 100) / 100)}" style="display:block;width:100%;max-width:${Number(p.width) || 100}%;height:auto;border:0;border-radius:${Number(p.radius) || 0}px;margin:0 auto">`;
            return `<tr><td align="${p.align}" style="padding:${pad(p.padding)}">${safeUrl(p.href) ? `<a href="${esc(safeUrl(p.href))}" style="text-decoration:none">${img}</a>` : img}</td></tr>`;
        }
        case "button": return `<tr><td align="${p.align}" style="padding:${pad(p.padding)}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${color(p.background)}" style="border-radius:${Number(p.radius)}px;background-color:${color(p.background)}"><a href="${esc(safeUrl(p.href) || "#")}" style="display:inline-block;padding:13px 28px;font-family:${settings.font};font-size:${Number(p.size)}px;font-weight:600;color:${color(p.color)};text-decoration:none;border-radius:${Number(p.radius)}px">${esc(p.text)}</a></td></tr></table></td></tr>`;
        case "divider": return `<tr><td style="padding:${pad(p.padding)}"><table role="presentation" width="${Number(p.width) || 100}%" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td style="border-top:${Number(p.thickness) || 1}px solid ${color(p.color)};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`;
        case "spacer": return `<tr><td style="height:${Number(p.height)}px;line-height:${Number(p.height)}px;font-size:0;${color(p.background) ? `background-color:${p.background}` : ""}">&nbsp;</td></tr>`;
        case "columns": {
            const count = block.columns.length;
            const width = Math.floor(100 / count);
            const cells = block.columns.map(column => `<td class="mail-col" width="${width}%" valign="top" style="padding:0 ${Number(p.gap) / 2}px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${column.map(child => blockHtml(child, settings)).join("")}</table></td>`).join("");
            return `<tr><td style="padding:${pad(p.padding)};${color(p.background) ? `background-color:${p.background}` : ""}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${p.stack ? "mail-stack" : ""}"><tr>${cells}</tr></table></td></tr>`;
        }
        case "table": {
            const rows = (p.rows || []).map((row, index) => `<tr>${row.map(cell => {
                const tag = p.header && index === 0 ? "th" : "td";
                return `<${tag} style="border:1px solid ${color(p.border)};padding:8px 10px;text-align:left;font-family:${settings.font};${tag === "th" ? `background-color:${color(p.headerBackground)};` : ""}">${esc(cell)}</${tag}>`;
            }).join("")}</tr>`).join("");
            return `<tr><td style="padding:${pad(p.padding)}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table></td></tr>`;
        }
        case "html": return `<tr><td>${p.html}</td></tr>`;
        default: return "";
    }
}

export function designToHtml(design) {
    const s = { ...design.settings, font: design.settings?.font || DESIGN_FONTS[0] };
    const rows = design.blocks.map(block => blockHtml(block, s)).join("\n");
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<title></title>
<style>
a{color:${color(s.linkColor)}}
@media only screen and (max-width:620px){.mail-container{width:100%!important}.mail-stack .mail-col{display:block!important;width:100%!important;padding:0 0 12px!important}}
</style>
</head>
<body style="margin:0;padding:0;background-color:${color(s.background)}">
${s.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(s.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${color(s.background)}">
<tr><td align="center" style="padding:${Number(s.padding)}px 12px">
<!--[if mso]><table role="presentation" width="${Number(s.width)}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="mail-container" width="${Number(s.width)}" cellpadding="0" cellspacing="0" border="0" style="width:${Number(s.width)}px;max-width:100%;background-color:${color(s.contentBackground)};border-radius:${Number(s.radius)}px;overflow:hidden;font-family:${s.font}${googleSansFeatures(s.font)};color:${color(s.textColor)}">
${rows}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/* ---------------------------------------------------------------- editor UI */
export class Designer {
    constructor({ design = null, onChange = () => {}, onImage = async () => null, onSaveComponent = null, components = [] } = {}) {
        this.design = design && Array.isArray(design.blocks) ? structuredClone(design) : emptyDesign();
        this.design.settings = { ...emptyDesign().settings, ...this.design.settings, font: this.design.settings?.font || DESIGN_FONTS[0] };
        this.onChange = onChange;
        this.onImage = onImage;
        this.onSaveComponent = onSaveComponent;
        this.components = components;
        this.selected = null;
        this.palette = el("div", { class: "mail-designer-palette mu-scroll", role: "list", "aria-label": t("blocks") });
        this.canvas = el("div", { class: "mail-designer-canvas mu-scroll" });
        this.props = el("div", { class: "mail-designer-props mu-scroll", "aria-label": t("properties") });
        this.node = el("div", { class: "mail-designer" }, this.palette, this.canvas, this.props);
        this.renderPalette();
        this.render();
    }

    get html() { return designToHtml(this.design); }

    changed() { this.render(); this.onChange(this.design); }

    renderPalette() {
        const items = Object.keys(BLOCKS).map(type => {
            const item = el("button", { type: "button", class: "mu-nav-item", draggable: "true", role: "listitem", "aria-label": t("addBlock", { block: t("block_" + type) }) }, icon(BLOCK_ICONS[type]), el("span", { text: t("block_" + type) }));
            item.addEventListener("dragstart", event => event.dataTransfer.setData("application/x-mail-block", JSON.stringify({ type })));
            item.addEventListener("click", () => this.add(BLOCKS[type]()));
            return item;
        });
        const parts = [el("div", { class: "mu-section-label", text: t("blocks") }), ...items];
        if (this.components.length) {
            parts.push(el("div", { class: "mu-section-label", text: t("components") }));
            for (const component of this.components) {
                const item = el("button", { type: "button", class: "mu-nav-item", draggable: "true" }, icon("widgets"), el("span", { text: component.name }));
                item.addEventListener("dragstart", event => event.dataTransfer.setData("application/x-mail-block", JSON.stringify({ component: component.block })));
                item.addEventListener("click", () => this.add(structuredClone(component.block)));
                parts.push(item);
            }
        }
        this.palette.replaceChildren(...parts);
    }

    withIds(block) {
        block.id = uid();
        if (block.columns) block.columns = block.columns.map(column => column.map(child => this.withIds(child)));
        return block;
    }

    add(block, list = this.design.blocks, index = list.length) {
        const item = this.withIds(structuredClone(block));
        list.splice(index, 0, item);
        this.selected = item.id;
        this.changed();
    }

    find(id, list = this.design.blocks) {
        for (let i = 0; i < list.length; i++) {
            if (list[i].id === id) return { block: list[i], list, index: i };
            for (const column of list[i].columns || []) { const found = this.find(id, column); if (found) return found; }
        }
        return null;
    }

    dropTarget(node, list, index) {
        node.addEventListener("dragover", event => {
            if (![...event.dataTransfer.types].some(type => type.startsWith("application/x-mail-"))) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = node.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            node.classList.toggle("is-drop-after", after);
            node.classList.toggle("is-drop-before", !after);
        });
        node.addEventListener("dragleave", () => node.classList.remove("is-drop-after", "is-drop-before"));
        node.addEventListener("drop", event => {
            event.preventDefault();
            event.stopPropagation();
            const after = node.classList.contains("is-drop-after");
            node.classList.remove("is-drop-after", "is-drop-before");
            const target = index + (after ? 1 : 0);
            const moving = event.dataTransfer.getData("application/x-mail-move");
            if (moving) {
                const found = this.find(moving);
                if (!found) return;
                if (found.block.columns && found.block.columns.some(column => column === list)) return;
                found.list.splice(found.index, 1);
                list.splice(found.list === list && found.index < target ? target - 1 : target, 0, found.block);
                this.changed();
                return;
            }
            try {
                const data = JSON.parse(event.dataTransfer.getData("application/x-mail-block"));
                this.add(data.component || BLOCKS[data.type](), list, target);
            } catch { /* not a block */ }
        });
    }

    render() {
        const page = el("div", { class: "mail-designer-page", style: `max-width:${this.design.settings.width}px;background:${this.design.settings.contentBackground};font-family:${this.design.settings.font}${googleSansFeatures(this.design.settings.font)};color:${this.design.settings.textColor};border-radius:${this.design.settings.radius}px` });
        const renderList = (list, container) => {
            if (!list.length) {
                const empty = el("div", { class: "mail-designer-empty mail-column-drop", text: t("dropBlocksHere") });
                this.dropTarget(empty, list, 0);
                container.append(empty);
            }
            list.forEach((block, index) => {
                const node = el("div", { class: "mail-block" + (this.selected === block.id ? " is-selected" : ""), draggable: "true", tabindex: "0", "data-id": block.id, "aria-label": t("block_" + block.type) });
                node.addEventListener("dragstart", event => { event.stopPropagation(); event.dataTransfer.setData("application/x-mail-move", block.id); });
                node.addEventListener("click", event => { event.stopPropagation(); this.selected = block.id; this.render(); });
                node.addEventListener("keydown", event => {
                    if (event.target !== node) return;
                    if (event.key === "Delete") { event.preventDefault(); this.remove(block.id); }
                    if (event.key === "ArrowUp" && event.altKey) { event.preventDefault(); this.move(block.id, -1); }
                    if (event.key === "ArrowDown" && event.altKey) { event.preventDefault(); this.move(block.id, 1); }
                });
                this.dropTarget(node, list, index);
                if (block.type === "columns") {
                    const row = el("div", { style: `display:flex;gap:${block.props.gap}px;padding:${block.props.padding}px;background:${block.props.background || "transparent"}` });
                    for (const column of block.columns) { const cell = el("div", { class: "mail-column-drop", style: "flex:1;min-width:0" }); renderList(column, cell); row.append(cell); }
                    node.append(row);
                } else {
                    const preview = el("table", { role: "presentation", width: "100%", cellpadding: "0", cellspacing: "0" });
                    const html = blockHtml(block, this.design.settings) || `<tr><td style="padding:24px;text-align:center;color:#8a8fa3">${esc(t("block_" + block.type))}</td></tr>`;
                    const doc = new DOMParser().parseFromString(`<table>${html}</table>`, "text/html");
                    doc.querySelectorAll("script, iframe, object, embed, form").forEach(item => item.remove());
                    doc.querySelectorAll("*").forEach(item => [...item.attributes].forEach(attr => { if (attr.name.startsWith("on")) item.removeAttribute(attr.name); }));
                    doc.querySelectorAll("img").forEach(img => { if (!/^(blob:|data:image\/|\/api\/mail\/v1\/)/.test(img.getAttribute("src") || "")) img.removeAttribute("src"); });
                    preview.append(...doc.querySelector("table").rows);
                    preview.querySelectorAll("a").forEach(link => link.addEventListener("click", event => event.preventDefault()));
                    node.append(preview);
                }
                node.append(el("div", { class: "mail-block-handle" },
                    el("button", { type: "button", "aria-label": t("moveUp"), onclick: event => { event.stopPropagation(); this.move(block.id, -1); } }, icon("arrow_upward")),
                    el("button", { type: "button", "aria-label": t("moveDown"), onclick: event => { event.stopPropagation(); this.move(block.id, 1); } }, icon("arrow_downward")),
                    el("button", { type: "button", "aria-label": t("duplicate"), onclick: event => { event.stopPropagation(); const found = this.find(block.id); this.add(found.block, found.list, found.index + 1); } }, icon("content_copy")),
                    el("button", { type: "button", "aria-label": t("delete"), onclick: event => { event.stopPropagation(); this.remove(block.id); } }, icon("delete"))));
                container.append(node);
            });
        };
        renderList(this.design.blocks, page);
        page.addEventListener("click", () => { this.selected = null; this.render(); });
        this.canvas.style.background = this.design.settings.background;
        this.canvas.replaceChildren(page);
        this.renderProps();
    }

    move(id, delta) {
        const found = this.find(id);
        if (!found) return;
        const target = found.index + delta;
        if (target < 0 || target >= found.list.length) return;
        found.list.splice(target, 0, found.list.splice(found.index, 1)[0]);
        this.changed();
    }

    remove(id) {
        const found = this.find(id);
        if (!found) return;
        found.list.splice(found.index, 1);
        if (this.selected === id) this.selected = null;
        this.changed();
    }

    // Munetios UI v4 controls: picker fields for colors, steppers for numbers, mu-input for text.
    input(label, value, onInput, type = "text", attrs = {}) {
        if (type === "color") return field(label, colorField(label, value || "#FFFFFF", next => { if (next) onInput(next.toLowerCase()); }));
        if (type === "number") return field(label, stepper(label, value ?? 0, { min: attrs.min ?? 0, max: attrs.max ?? 9999 }, onInput));
        const node = el("input", { class: "mu-input", type, value: value ?? "", ...attrs });
        node.addEventListener("change", () => onInput(node.value));
        return field(label, node);
    }

    renderProps() {
        const found = this.selected && this.find(this.selected);
        const set = (key, value) => { found.block.props[key] = value; this.changed(); };
        const s = this.design.settings;
        const setS = (key, value) => { s[key] = value; this.changed(); };
        if (!found) {
            this.props.replaceChildren(el("div", { class: "mu-section-label", text: t("emailSettings") }),
                el("div", { class: "mail-props-group" },
                    this.input(t("pageBackground"), s.background, value => setS("background", value), "color"),
                    this.input(t("contentBackground"), s.contentBackground, value => setS("contentBackground", value), "color"),
                    this.input(t("textColor"), s.textColor, value => setS("textColor", value), "color"),
                    this.input(t("linkColor"), s.linkColor, value => setS("linkColor", value), "color"),
                    this.input(t("contentWidth"), s.width, value => setS("width", Math.min(800, Math.max(320, value))), "number", { min: 320, max: 800 }),
                    this.input(t("cornerRadius"), s.radius, value => setS("radius", value), "number", { min: 0, max: 40 }),
                    field(t("font"), select(t("font"), DESIGN_FONTS.map(value => ({ value, label: value.split(",")[0].replace(/'/g, "") })), s.font, value => setS("font", value))),
                    this.input(t("preheader"), s.preheader, value => setS("preheader", value))),
                el("div", { class: "mail-props-group" }, el("div", { class: "mu-field-label", text: t("variables") }), el("p", { class: "mu-muted", style: "margin:0", text: VARIABLES.map(name => `{{${name}}}`).join(" ") })));
            return;
        }
        const p = found.block.props;
        const group = [];
        const pad = () => this.input(t("padding"), p.padding, value => set("padding", value), "number", { min: 0, max: 80 });
        const align = () => field(t("alignment"), select(t("alignment"), ["left", "center", "right"].map(value => ({ value, label: t("align_" + value) })), p.align, value => set("align", value)));
        const richText = () => {
            const area = el("div", { class: "mu-textarea", contenteditable: "true", style: "min-height:120px;background:#fff;color:#1d2433", role: "textbox", "aria-multiline": "true", "aria-label": t("text") });
            area.innerHTML = p.html;
            area.addEventListener("blur", () => { set("html", sanitizeBlockHtml(area.innerHTML)); });
            return field(t("text"), area, t("variablesHint"));
        };
        switch (found.block.type) {
            case "header": group.push(this.input(t("text"), p.text, value => set("text", value)), this.input(t("logoUrl"), p.logo, value => set("logo", safeUrl(value))), this.input(t("backgroundColor"), p.background, value => set("background", value), "color"), this.input(t("textColor"), p.color, value => set("color", value), "color"), this.input(t("fontSize"), p.size, value => set("size", value), "number", { min: 12, max: 60 }), align(), pad()); break;
            case "text": case "footer": group.push(richText(), this.input(t("textColor"), p.color, value => set("color", value), "color"), this.input(t("backgroundColor"), p.background || "#ffffff", value => set("background", value), "color"), this.input(t("fontSize"), p.size, value => set("size", value), "number", { min: 10, max: 40 }), align(), pad()); break;
            case "image": group.push(button(t("chooseImage"), async () => { const url = await this.onImage(); if (url) set("src", url); }, { iconName: "image" }), this.input(t("imageUrl"), p.src, value => set("src", safeUrl(value))), this.input(t("altText"), p.alt, value => set("alt", value)), this.input(t("linkUrl"), p.href, value => set("href", safeUrl(value))), this.input(t("widthPercent"), p.width, value => set("width", Math.min(100, Math.max(10, value))), "number", { min: 10, max: 100 }), this.input(t("cornerRadius"), p.radius, value => set("radius", value), "number", { min: 0, max: 40 }), align(), pad()); break;
            case "button": group.push(this.input(t("linkText"), p.text, value => set("text", value)), this.input(t("linkUrl"), p.href, value => set("href", safeUrl(value) || "https://")), this.input(t("backgroundColor"), p.background, value => set("background", value), "color"), this.input(t("textColor"), p.color, value => set("color", value), "color"), this.input(t("cornerRadius"), p.radius, value => set("radius", value), "number", { min: 0, max: 40 }), align(), pad()); break;
            case "divider": group.push(this.input(t("color"), p.color, value => set("color", value), "color"), this.input(t("thickness"), p.thickness, value => set("thickness", value), "number", { min: 1, max: 10 }), this.input(t("widthPercent"), p.width, value => set("width", value), "number", { min: 10, max: 100 }), pad()); break;
            case "spacer": group.push(this.input(t("height"), p.height, value => set("height", value), "number", { min: 4, max: 200 }), this.input(t("backgroundColor"), p.background || "#ffffff", value => set("background", value), "color")); break;
            case "columns": group.push(field(t("columns"), select(t("columns"), [1, 2, 3, 4].map(value => ({ value, label: String(value) })), found.block.columns.length, value => {
                const count = Number(value);
                while (found.block.columns.length < count) found.block.columns.push([]);
                if (found.block.columns.length > count) { const extra = found.block.columns.splice(count).flat(); found.block.columns[count - 1].push(...extra); }
                this.changed();
            })), this.input(t("gap"), p.gap, value => set("gap", value), "number", { min: 0, max: 48 }), this.input(t("backgroundColor"), p.background || "#ffffff", value => set("background", value), "color"),
                el("label", { class: "mu-check" }, (() => { const box = el("input", { type: "checkbox" }); box.checked = p.stack; box.addEventListener("change", () => set("stack", box.checked)); return box; })(), t("stackOnMobile")), pad()); break;
            case "table": {
                const grid = el("div", { style: "display:grid;gap:4px" });
                p.rows.forEach((row, r) => grid.append(el("div", { style: `display:grid;grid-template-columns:repeat(${row.length},1fr);gap:4px` }, row.map((cell, c) => { const input = el("input", { class: "mu-input", value: cell, "aria-label": t("cellPosition", { row: r + 1, column: c + 1 }) }); input.addEventListener("change", () => { p.rows[r][c] = input.value; this.changed(); }); return input; }))));
                group.push(grid, el("div", { class: "mail-inline-form" },
                    button(t("addRow"), () => { p.rows.push(p.rows[0].map(() => "")); this.changed(); }), button(t("addColumn"), () => { p.rows.forEach(row => row.push("")); this.changed(); }),
                    button(t("deleteRow"), () => { if (p.rows.length > 1) { p.rows.pop(); this.changed(); } }), button(t("deleteColumn"), () => { if (p.rows[0].length > 1) { p.rows.forEach(row => row.pop()); this.changed(); } })),
                    this.input(t("borderColor"), p.border, value => set("border", value), "color"), this.input(t("headerBackground"), p.headerBackground, value => set("headerBackground", value), "color"),
                    el("label", { class: "mu-check" }, (() => { const box = el("input", { type: "checkbox" }); box.checked = p.header; box.addEventListener("change", () => set("header", box.checked)); return box; })(), t("headerRow")), pad());
                break;
            }
            case "html": {
                const area = el("textarea", { class: "mu-textarea", rows: 8, spellcheck: "false", style: "font-family:'Google Sans Code',monospace" });
                area.value = p.html;
                area.addEventListener("change", () => set("html", sanitizeBlockHtml(area.value)));
                group.push(field(t("customHtml"), area, t("customHtmlHelp")));
                break;
            }
        }
        if (this.onSaveComponent) group.push(button(t("saveAsComponent"), async () => {
            const name = await promptDialog({ title: t("saveAsComponent"), label: t("name"), value: t("block_" + found.block.type) });
            if (name) { await this.onSaveComponent(name, structuredClone(found.block)); toast(t("componentSaved"), "success"); }
        }, { iconName: "widgets" }));
        this.props.replaceChildren(el("div", { class: "mu-section-label", text: t("block_" + found.block.type) }), el("div", { class: "mail-props-group" }, group),
            button(t("back"), () => { this.selected = null; this.render(); }, { iconName: "arrow_back" }));
    }
}

// Custom HTML blocks may not contain scripts, handlers, frames, or forms.
export function sanitizeBlockHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script, iframe, frame, object, embed, form, input, button, select, textarea, link, meta, base, svg, math, template, noscript").forEach(node => node.remove());
    doc.querySelectorAll("*").forEach(node => [...node.attributes].forEach(attr => {
        if (attr.name.startsWith("on") || ((attr.name === "href" || attr.name === "src") && /^\s*(javascript|vbscript|data:text)/i.test(attr.value))) node.removeAttribute(attr.name);
    }));
    return doc.body.innerHTML;
}

