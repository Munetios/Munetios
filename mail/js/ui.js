// DOM helpers built on Munetios UI v4: elements, icons, menus, dialogs, prompts, and toasts.
import { t } from "./i18n.js";

const UI = window.MunetiosUI;

// Conditional children (cond ? node : null) are skipped instead of being rendered as the text "null".
for (const method of ["replaceChildren", "append", "prepend"]) {
    const native = Element.prototype[method];
    if (native.__mailSafe) continue;
    const safe = function (...nodes) { return native.apply(this, nodes.filter(node => node !== null && node !== undefined && node !== false)); };
    safe.__mailSafe = true;
    Element.prototype[method] = safe;
}

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "dataset") Object.assign(node.dataset, value);
        else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (value === true) node.setAttribute(key, "");
        else node.setAttribute(key, value);
    }
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

export const icon = (name, filled = false) => el("span", { class: "mu-icon" + (filled ? " mu-icon-filled" : ""), "aria-hidden": "true", text: name });

export function iconButton(name, label, onClick, attrs = {}) {
    return el("button", { type: "button", class: "mu-icon-btn", "aria-label": label, "data-tooltip": label, onclick: onClick, ...attrs }, icon(name));
}

/* ---------------------------------------------------------------- Munetios UI v4 tooltips (no native title tooltips) */
let tipNode = null;
let tipTarget = null;
function showTip(target) {
    if (target.hasAttribute("title")) { if (!target.dataset.tooltip) target.dataset.tooltip = target.getAttribute("title"); target.removeAttribute("title"); }
    const text = target.dataset.tooltip;
    if (!text) return;
    tipNode ||= document.body.appendChild(el("div", { class: "mu-tooltip mu-tooltip-floating", role: "tooltip", "aria-hidden": "true" }));
    tipTarget = target;
    tipNode.textContent = text;
    const rect = target.getBoundingClientRect();
    const width = tipNode.offsetWidth, height = tipNode.offsetHeight;
    let top = rect.bottom + 8;
    if (top + height > innerHeight - 8) top = rect.top - height - 8;
    tipNode.style.left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), innerWidth - width - 8) + "px";
    tipNode.style.top = Math.max(8, top) + "px";
    tipNode.style.opacity = "1";
    tipNode.style.transform = "none";
}
function hideTip() { if (tipNode) { tipNode.style.opacity = "0"; tipNode.style.transform = ""; } tipTarget = null; }
document.addEventListener("pointerover", event => {
    const target = event.target.closest?.("[data-tooltip], [title]");
    if (target && target !== tipTarget && event.pointerType !== "touch") showTip(target);
    else if (!target) hideTip();
}, true);
let keyboardUser = false;
document.addEventListener("keydown", event => { if (event.key === "Tab") keyboardUser = true; }, true);
document.addEventListener("pointerdown", () => { keyboardUser = false; }, true);
document.addEventListener("focusin", event => { const target = event.target.closest?.("[data-tooltip], [title]"); if (target && keyboardUser) showTip(target); else hideTip(); });
for (const type of ["pointerdown", "scroll", "focusout"]) document.addEventListener(type, hideTip, true);
document.addEventListener("keydown", event => { if (event.key === "Escape") hideTip(); }, true);

/* ---------------------------------------------------------------- Munetios UI v4 form controls (no native pickers) */
// Color, date, and date-time fields use the v4 picker panels (button.mu-picker-field[data-mu-picker]).
function pickerField(kind, label, value, onChange, attrs = {}) {
    const node = el("button", { type: "button", class: "mu-picker-field", "data-mu-picker": kind, "data-value": value || "", "aria-label": label, ...attrs });
    node.addEventListener("mu-pick", event => onChange(event.detail.value || ""));
    return node;
}
export const colorField = (label, value, onChange) => pickerField("color", label, value, onChange);
export const dateField = (label, value, onChange) => pickerField("date", label, value, onChange, { "data-clearable": "" });
export const dateTimeField = (label, value, onChange) => pickerField("datetime", label, value, onChange, { "data-clearable": "" });
// Local "YYYY-MM-DDTHH:MM" for a timestamp, and back.
export const toLocalDateTime = ms => { if (!ms) return ""; const date = new Date(ms); return new Date(ms - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
export const fromLocalDateTime = value => { if (!value) return null; const ms = new Date(value).getTime(); return Number.isFinite(ms) ? ms : null; };

export function stepper(label, value, { min = 0, max = 9999, step = 1 } = {}, onChange) {
    const input = el("input", { type: "number", value, min, max, step, "aria-label": label, inputmode: "decimal" });
    const clamp = () => { let next = Number(input.value); if (!Number.isFinite(next)) next = Number(min); next = Math.min(Number(max), Math.max(Number(min), next)); input.value = String(next); onChange?.(next); };
    input.addEventListener("change", clamp);
    const node = el("div", { class: "mu-stepper" },
        el("button", { type: "button", class: "mu-icon-btn", "data-mu-step": String(-step), "aria-label": t("decrease"), "data-tooltip": t("decrease") }, icon("remove")), input,
        el("button", { type: "button", class: "mu-icon-btn", "data-mu-step": String(step), "aria-label": t("increase"), "data-tooltip": t("increase") }, icon("add")));
    node.addEventListener("click", event => { if (event.target.closest("[data-mu-step]")) setTimeout(clamp); });
    node.input = input;
    return node;
}

export function check(label, checked, onChange) {
    const input = el("input", { type: "checkbox" });
    input.checked = Boolean(checked);
    input.addEventListener("change", () => onChange?.(input.checked));
    const node = el("label", { class: "mu-check" }, input, label);
    node.input = input;
    return node;
}

export function button(text, onClick, { primary = false, danger = false, iconName = null, ...attrs } = {}) {
    return el("button", { type: "button", class: "mu-btn" + (primary ? " mu-btn-primary" : "") + (danger ? " mu-btn-danger" : ""), onclick: onClick, ...attrs }, iconName ? icon(iconName) : null, text);
}

export function toast(message, type = "info", duration) { UI.toast(message, { type, ...(duration ? { duration } : {}) }); }

export function switchControl(label, checked, onChange) {
    const input = el("input", { type: "checkbox", "aria-label": label });
    input.checked = Boolean(checked);
    input.addEventListener("change", () => onChange(input.checked));
    return el("label", { class: "mu-switch" }, input, el("span", { class: "mu-switch-track" }));
}

export function select(label, options, value, onChange) {
    const node = el("select", { class: "mu-select", "aria-label": label });
    for (const option of options) {
        const item = el("option", { value: option.value, text: option.label });
        if (String(option.value) === String(value)) item.selected = true;
        node.append(item);
    }
    node.addEventListener("change", () => onChange(node.value));
    queueMicrotask(() => { if (node.isConnected) UI.enhanceSelect(node); });
    return node;
}

export function settingRow(title, subtitle, control) {
    return el("div", { class: "mu-row" }, el("div", { class: "mu-row-info" }, el("span", { class: "mu-row-title", text: title }), subtitle ? el("span", { class: "mu-row-subtitle", text: subtitle }) : null), control);
}

export function field(label, input, help) {
    return el("label", { class: "mu-field" }, el("span", { class: "mu-field-label", text: label }), input, help ? el("span", { class: "mu-field-help", text: help }) : null);
}

export function slider(label, rule, value, onInput, format = v => v) {
    const id = "s" + Math.random().toString(36).slice(2, 9);
    const output = el("output", { class: "mu-slider-value", for: id, text: format(value) });
    const input = el("input", { id, class: "mu-range", type: "range", min: rule.min, max: rule.max, step: rule.step, value });
    input.addEventListener("input", () => { output.textContent = format(Number(input.value)); onInput(Number(input.value)); });
    return el("div", { class: "mu-slider" }, el("label", { class: "mu-slider-head", for: id }, el("span", { text: label }), output), input);
}

/* ---------------------------------------------------------------- menus */
let openMenu = null;
export function closeMenu() {
    if (!openMenu) return;
    const { node, restore, cleanup } = openMenu;
    openMenu = null;
    cleanup();
    node.remove();
    restore?.focus?.({ preventScroll: true });
}

// items: [{ icon, label, action, danger, checked, disabled, shortcut, children }] or "sep"
// focus: false keeps the keyboard in the anchor (autocomplete suggestions); ArrowDown moves into the menu.
export function menu(anchor, items, { point = null, label = "", focus = true } = {}) {
    closeMenu();
    const node = el("div", { class: "mu-menu mu-menu-floating mu-menu-context", role: "menu", "aria-label": label || undefined });
    const buttons = [];
    for (const item of items.filter(Boolean)) {
        if (item === "sep") { node.append(el("div", { class: "mu-menu-sep", role: "separator" })); continue; }
        const entry = el("button", {
            type: "button", class: "mu-menu-item" + (item.danger ? " is-danger" : "") + (item.checked ? " is-selected" : ""), role: item.checked !== undefined ? "menuitemcheckbox" : "menuitem",
            "aria-checked": item.checked !== undefined ? String(Boolean(item.checked)) : undefined, disabled: item.disabled || undefined,
        }, item.icon ? icon(item.icon) : el("span", { class: "mu-icon", "aria-hidden": "true" }), el("span", { text: item.label }),
            item.shortcut ? el("kbd", { "aria-hidden": "true", text: item.shortcut }) : null, item.children ? icon("chevron_right") : null,
            item.checked ? el("span", { class: "mu-icon mu-menu-check", "aria-hidden": "true", text: "check" }) : null);
        entry.addEventListener("click", event => {
            event.stopPropagation();
            if (item.children) { menu(entry, item.children, { label: item.label }); return; }
            closeMenu();
            item.action?.();
        });
        node.append(entry);
        buttons.push(entry);
    }
    document.body.append(node);
    const rect = point ? { left: point.x, right: point.x, top: point.y, bottom: point.y } : anchor.getBoundingClientRect();
    const width = node.offsetWidth, height = node.offsetHeight;
    let left = document.documentElement.dir === "rtl" && !point ? rect.right - width : rect.left;
    let top = rect.bottom + 6;
    if (top + height > innerHeight - 8) top = Math.max(8, rect.top - height - 6);
    left = Math.min(Math.max(8, left), innerWidth - width - 8);
    node.style.left = left + "px";
    node.style.top = top + "px";
    const focusAt = index => buttons[(index + buttons.length) % buttons.length]?.focus();
    const onKey = event => {
        const index = buttons.indexOf(document.activeElement);
        if (event.key === "ArrowDown") { event.preventDefault(); focusAt(index + 1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); focusAt(index - 1); }
        else if (event.key === "Home") { event.preventDefault(); focusAt(0); }
        else if (event.key === "End") { event.preventDefault(); focusAt(-1); }
        else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); closeMenu(); }
    };
    const onDown = event => { if (!node.contains(event.target)) closeMenu(); };
    node.addEventListener("keydown", onKey);
    setTimeout(() => document.addEventListener("pointerdown", onDown, true));
    window.addEventListener("resize", closeMenu, { once: true });
    openMenu = { node, restore: anchor, cleanup: () => { document.removeEventListener("pointerdown", onDown, true); } };
    if (focus) focusAt(0);
    return node;
}

/* ---------------------------------------------------------------- dialogs */
let dialogCount = 0;
// Returns { modal, dialog, body, close }. Content is built by the caller; nothing is injected as HTML.
export function dialog({ title, iconName = "mail", size = "", content = [], actions = [], onClose = null, labelledBy = null, className = "" }) {
    const id = "mailDialog" + ++dialogCount;
    const heading = el("h2", { id: id + "Title", text: title });
    const close = () => { UI.closeModal(id); setTimeout(() => modal.remove(), 220); onClose?.(); };
    const closeButton = iconButton("close", t("close"), close, { class: "mu-icon-btn mu-icon-btn-soft" });
    const body = el("div", { class: "mail-dialog-body" }, content);
    const dialogNode = el("div", { class: `mu-dialog ${size} ${className}`.trim(), role: "dialog", "aria-modal": "true", "aria-labelledby": labelledBy || id + "Title" },
        title ? el("div", { class: "mu-dialog-header" }, el("div", { class: "mu-dialog-heading" }, el("span", { class: "mu-icon-circle" }, icon(iconName)), heading), closeButton) : null,
        body, actions.length ? el("div", { class: "mu-dialog-actions" }, actions) : null);
    const modal = el("div", { class: "mu-modal", id, hidden: true }, dialogNode);
    modal.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); close(); } });
    document.getElementById("modalRoot").append(modal);
    UI.openModal(id);
    return { modal, dialog: dialogNode, body, close };
}

export function confirmDialog({ title, message, confirm = t("confirm"), danger = false, iconName = danger ? "warning" : "help" }) {
    return new Promise(resolve => {
        let settled = false;
        const finish = value => { if (settled) return; settled = true; resolve(value); };
        const d = dialog({
            title, iconName, content: [el("p", { class: "mu-muted", style: "margin:0", text: message })], onClose: () => finish(false),
            actions: [button(t("cancel"), () => d.close()), button(confirm, () => { finish(true); d.close(); }, { primary: !danger, danger })],
        });
    });
}

export function promptDialog({ title, label, value = "", confirm = t("save"), iconName = "edit", type = "text", multiline = false, placeholder = "" }) {
    return new Promise(resolve => {
        let settled = false;
        const finish = result => { if (settled) return; settled = true; resolve(result); };
        const input = multiline ? el("textarea", { class: "mu-textarea", rows: 5, placeholder }) : el("input", { class: "mu-input", type, placeholder });
        input.value = value;
        const submit = () => { finish(input.value.trim()); d.close(); };
        input.addEventListener("keydown", event => { if (event.key === "Enter" && !multiline) { event.preventDefault(); submit(); } });
        const d = dialog({ title, iconName, content: [field(label, input)], onClose: () => finish(null), actions: [button(t("cancel"), () => d.close()), button(confirm, submit, { primary: true })] });
        setTimeout(() => { input.focus(); input.select?.(); }, 60);
    });
}

export function emptyState(iconName, title, detail, actionButton = null) {
    return el("div", { class: "mu-empty" }, el("span", { class: "mu-icon-circle" }, icon(iconName)), el("span", { text: title }), detail ? el("span", { class: "mu-muted", text: detail }) : null, actionButton);
}

export function alertBox(kind, iconName, title, detail, actionsList = []) {
    return el("div", { class: "mu-alert" + (kind ? " is-" + kind : ""), role: kind === "danger" ? "alert" : "status" }, icon(iconName),
        el("div", { class: "mu-alert-body" }, el("span", { class: "mu-alert-title", text: title }), detail ? el("span", { class: "mu-muted", text: detail }) : null), actionsList);
}

// Deterministic sender color from the address (no network, no tracking).
export function colorFor(text) {
    let hash = 0;
    for (const char of String(text || "")) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return `hsl(${hash % 360} 62% 48%)`;
}

export function initials(name, email) {
    const source = (name || email || "?").trim();
    const parts = source.replace(/[<>"]/g, "").split(/[\s@._-]+/).filter(Boolean);
    return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[1][0] : "")).toUpperCase();
}

export function stamp(name, email, pictureUrl = null) {
    const node = el("span", { class: "mail-stamp", "aria-hidden": "true", style: `background:${colorFor(email || name)}` });
    if (pictureUrl) node.append(el("img", { src: pictureUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }));
    else node.textContent = initials(name, email);
    return node;
}

export function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function pickFiles({ accept = "", multiple = true } = {}) {
    return new Promise(resolve => {
        const input = el("input", { type: "file", accept: accept || undefined, multiple: multiple || undefined, style: "position:fixed;left:-9999px" });
        input.addEventListener("change", () => { resolve([...input.files]); input.remove(); });
        input.addEventListener("cancel", () => { resolve([]); input.remove(); });
        document.body.append(input);
        input.click();
    });
}

export function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
