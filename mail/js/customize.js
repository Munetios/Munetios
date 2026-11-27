// Applies preferences instantly through CSS variables and body attributes (no reload, no theme-supplied CSS),
// and saves them to the account so they follow it across devices.
import { state, emit } from "./state.js";
import { put, ApiError } from "./api.js";
import { setPath, getPath, resolved, SCHEMA, cleanValue } from "./theme-schema.js";
import { debounce, toast } from "./ui.js";
import { t } from "./i18n.js";

const root = document.documentElement;
const UI = window.MunetiosUI;
const fontFaces = new Map();

const hexToRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const rgba = (hex, alpha) => `rgba(${hexToRgb(hex).join(", ")}, ${alpha})`;
const mix = (a, b, amount) => { const [x, y] = [hexToRgb(a), hexToRgb(b)]; return "#" + x.map((value, i) => Math.round(value + (y[i] - value) * amount).toString(16).padStart(2, "0")).join(""); };
const luminance = hex => { const [r, g, b] = hexToRgb(hex).map(value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

function fontStack(value) {
    if (!value) return "'Munetios UI v4 Font', system-ui, sans-serif";
    if (value.startsWith("asset:")) return `"mail-asset-${value.slice(6)}", 'Munetios UI v4 Font', system-ui, sans-serif`;
    if (value.startsWith("local:")) return `"${value.slice(6).replace(/"/g, "")}", 'Munetios UI v4 Font', system-ui, sans-serif`;
    return /^(serif|sans-serif|monospace|system-ui)$/.test(value) ? value : `"${value}", 'Munetios UI v4 Font', system-ui, sans-serif`;
}

// Custom font files are loaded from the account's private asset storage with the FontFace API.
async function loadAssetFont(value) {
    if (!value?.startsWith("asset:") || fontFaces.has(value)) return;
    const id = value.slice(6);
    try {
        const response = await fetch(`/api/mail/v1/assets/${id}`, { credentials: "same-origin" });
        if (!response.ok) return;
        const face = new FontFace(`mail-asset-${id}`, await response.arrayBuffer());
        await face.load();
        document.fonts.add(face);
        fontFaces.set(value, face);
    } catch { /* falls back to the default font */ }
}

let backgroundUrl = null;
async function applyBackground(background) {
    const layer = document.querySelector(".mail-backdrop");
    const set = (name, value) => root.style.setProperty(name, value);
    layer.classList.toggle("is-image", background.type === "image");
    if (backgroundUrl) { URL.revokeObjectURL(backgroundUrl); backgroundUrl = null; }
    if (background.type === "color") set("--mail-bg-image", `linear-gradient(${background.color}, ${background.color})`);
    else if (background.type === "gradient") set("--mail-bg-image", `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`);
    else if (background.type === "image" && background.image) {
        try {
            const response = await fetch(`/api/mail/v1/assets/${background.image}`, { credentials: "same-origin" });
            if (response.ok) { backgroundUrl = URL.createObjectURL(await response.blob()); set("--mail-bg-image", `url("${backgroundUrl}")`); }
        } catch { set("--mail-bg-image", "none"); }
    } else set("--mail-bg-image", "none");
    set("--mail-bg-size", background.size === "tile" ? "auto" : background.size);
    set("--mail-bg-repeat", background.size === "tile" ? "repeat" : "no-repeat");
    set("--mail-bg-position", background.position);
    set("--mail-bg-brightness", String(background.brightness));
    set("--mail-bg-opacity", String(background.opacity));
}

export function apply(prefs) {
    const { appearance: a, typography: ty, layout: l, behavior: b } = prefs;
    const set = (name, value) => root.style.setProperty(name, value);
    UI.theme.set(a.mode);
    const dark = root.getAttribute("data-mu-theme") !== "light";
    // Accent and gradient accents
    set("--mu-accent", a.accent);
    set("--mail-accent-2", a.accentGradient ? a.accent2 : a.accent);
    set("--mail-accent-fill", a.accentGradient ? `linear-gradient(${a.gradientAngle}deg, ${a.accent}, ${a.accent2})` : a.accent);
    set("--mu-current-bg", rgba(a.accent, dark ? 0.26 : 0.13));
    set("--mu-current-border", rgba(a.accent, 0.32));
    set("--mu-current-text", dark ? mix(a.accent, "#ffffff", 0.7) : mix(a.accent, "#000000", 0.35));
    // Liquid Glass: alpha 0.01-0.50, saturation, brightness, blur 0-3px (never the CSS filter property)
    const glassBase = a.customPalette ? a.palette.surface : dark ? "#2e1060" : "#ffffff";
    const glassEnd = a.customPalette ? mix(a.palette.surface, a.palette.background, 0.5) : dark ? "#140834" : "#f4f6fd";
    set("--mu-glass", `linear-gradient(180deg, ${rgba(glassBase, a.glass.alpha)}, ${rgba(glassEnd, Math.max(0.01, a.glass.alpha - 0.04))})`);
    set("--mu-tile-glass", rgba(glassEnd, Math.min(0.5, a.glass.alpha)));
    set("--mu-blur", `blur(${a.glass.blur}px) saturate(${a.glass.saturation}%) brightness(${a.glass.brightness})`);
    set("--mu-border", rgba(a.border.color === "#ffffff" && !dark ? "#1d2433" : a.border.color, a.border.opacity));
    set("--mu-shadow", `0 18px 48px rgba(8, 3, 26, ${0.32 * a.shadow}), inset 0 1px 0 rgba(255, 255, 255, ${0.08 * Math.min(1, a.shadow)})`);
    set("--mail-radius", String(a.radius));
    set("--mail-speed", String(a.animationSpeed || 0.0001));
    document.body.dataset.hover = a.hover;
    if (a.customPalette) {
        set("--mu-bg", a.palette.background);
        set("--mu-text", a.palette.text);
        set("--mu-text-muted", a.palette.muted);
        set("--mu-icon", a.palette.text);
        const darkPalette = luminance(a.palette.background) < 0.4;
        root.style.colorScheme = darkPalette ? "dark" : "light";
    } else for (const name of ["--mu-bg", "--mu-text", "--mu-text-muted", "--mu-icon"]) root.style.removeProperty(name);
    document.body.classList.toggle("high-contrast", a.highContrast);
    applyBackground(a.background);
    // Typography: font families, size, weight, variable axes, OpenType features
    for (const font of [ty.uiFont, ty.messageFont, ty.composeFont]) loadAssetFont(font);
    set("--mail-font", fontStack(ty.uiFont));
    set("--mail-font-message", fontStack(ty.messageFont));
    set("--mail-font-compose", fontStack(ty.composeFont));
    set("--mail-fs", ty.size + "px");
    set("--mail-fw", String(ty.weight));
    set("--mail-ls", ty.letterSpacing + "em");
    set("--mail-lh", String(ty.lineHeight));
    const axes = [`"wdth" ${ty.width}`, `"slnt" ${ty.slant}`, `"ROND" ${ty.roundness}`];
    if (ty.opsz) axes.push(`"opsz" ${ty.opsz}`);
    set("--mail-font-variation", axes.join(", "));
    const features = [...ty.stylisticSets.map(set => `"${set}" 1`), ...(ty.features ? ty.features.split(",").map(part => part.trim()) : [])];
    set("--mail-font-features", features.length ? features.join(", ") : "normal");
    // Layout
    set("--mu-sidebar-width", l.sidebarWidth + "px");
    set("--mail-sidebar-w", l.sidebarWidth + "px");
    set("--mail-list-w", l.listWidth + "px");
    set("--mail-reading-h", l.readingHeight + "%");
    set("--mail-avatar", l.avatarSize + "px");
    set("--mail-icon", l.iconSize + "px");
    set("--compose-w", l.composeWidth + "px");
    set("--compose-h", l.composeHeight + "px");
    document.body.dataset.density = l.density;
    document.body.dataset.pane = l.readingPane;
    document.body.classList.toggle("sidebar-end", l.sidebarPosition === "end");
    document.body.classList.toggle("sidebar-collapsed", l.sidebarCollapsed);
    document.body.classList.toggle("no-avatars", !l.avatars);
    document.body.classList.toggle("reduce-motion", b.reduceMotion === "on" || a.animationSpeed === 0);
    document.body.classList.toggle("allow-motion", b.reduceMotion === "off");
    const sidebar = document.getElementById("mailSidebar");
    if (sidebar) sidebar.style.setProperty("--mu-sidebar-width", l.sidebarWidth + "px");
    try { localStorage.setItem("munetios-ui-sidebar:mail-sidebar", String(l.sidebarWidth)); } catch { /* storage blocked */ }
}

/* ---------------------------------------------------------------- saving */
let saving = Promise.resolve();
const pushSoon = debounce(() => { saving = saving.then(push); }, 700);

async function push() {
    try {
        const result = await put("/preferences", { data: state.prefsRaw, baseVersion: state.boot.preferences.version });
        state.boot.preferences = result;
    } catch (error) {
        if (error instanceof ApiError && error.code === "preferencesConflict") {
            // Another device saved first: keep both by applying this device's changes on top of the newer copy.
            const server = error.data.server;
            const merged = mergeDeep(server.data, state.prefsRaw);
            const result = await put("/preferences", { data: merged, baseVersion: server.version }).catch(() => null);
            if (result) { state.boot.preferences = result; state.prefsRaw = result.data; }
        } else if (!(error instanceof ApiError && error.code === "offline")) toast(t("preferencesNotSaved"), "error");
    }
}

function mergeDeep(base, overlay) {
    const out = structuredClone(base || {});
    for (const [key, value] of Object.entries(overlay || {})) out[key] = value && typeof value === "object" && !Array.isArray(value) ? mergeDeep(out[key], value) : value;
    return out;
}

// Changes one preference, applies it immediately, and saves it.
export function savePreference(path, value) {
    const rule = SCHEMA[path];
    const clean = rule ? cleanValue(rule, value) : undefined;
    if (clean === undefined) return;
    setPath(state.prefsRaw, path, clean);
    state.prefs = resolved(state.prefsRaw);
    apply(state.prefs);
    emit("prefsChanged", path);
    pushSoon();
}

export function replacePreferences(data, { save = true } = {}) {
    state.prefsRaw = structuredClone(data || {});
    state.prefs = resolved(state.prefsRaw);
    apply(state.prefs);
    emit("prefsChanged", "*");
    if (save) pushSoon();
}

export function resetPreference(path) {
    const keys = path.split(".");
    let node = state.prefsRaw;
    for (const key of keys.slice(0, -1)) { if (!node?.[key]) return; node = node[key]; }
    delete node[keys.at(-1)];
    state.prefs = resolved(state.prefsRaw);
    apply(state.prefs);
    emit("prefsChanged", path);
    pushSoon();
}

export const preference = path => getPath(state.prefs, path);
export function flushPreferences() { pushSoon(); return saving; }
