// Customization studio: every control is generated from the shared schema, applies instantly, and saves to the
// account. Includes live preview, per-setting reset, custom backgrounds and fonts, and theme management.
import { state, emit, primaryMailbox } from "./state.js";
import { get, post, put, del, upload } from "./api.js";
import { t, localeList, formatBytes, weekdayName } from "./i18n.js";
import { el, icon, iconButton, button, dialog, select, switchControl, slider, toast, settingRow, confirmDialog, promptDialog, download, pickFiles, stamp, menu, colorField } from "./ui.js";
import { SCHEMA, FONT_CHOICES, getPath, sanitizeTheme, THEME_PREFIXES, SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS } from "./theme-schema.js";
import { savePreference, resetPreference, replacePreferences } from "./customize.js";

const label = path => t("pref_" + path.replace(/\./g, "_"));
const optionLabel = value => t("opt_" + String(value)) || String(value);
let assetsCache = null;

async function assets(force = false) {
    if (!assetsCache || force) assetsCache = get("/assets").then(result => result.assets).catch(() => []);
    return assetsCache;
}

function resetButton(path) {
    return iconButton("restart_alt", t("resetSetting"), () => { resetPreference(path); emit("studioRefresh"); }, { class: "mu-icon-btn mu-icon-btn-sm mail-control-reset" });
}

export function control(path) {
    if (PAIRED_HIDDEN.has(path)) return null;
    if (PAIRS[path]) return orderedVisibilityControl(path);
    const rule = SCHEMA[path];
    const value = getPath(state.prefs, path);
    const set = next => savePreference(path, next);
    let input;
    switch (rule.type) {
        case "bool": input = switchControl(label(path), value, set); break;
        case "number": {
            const format = numberFormat(path);
            return el("div", { class: "mail-slider-row" }, el("div", { style: "flex:1;min-width:0" }, slider(label(path), rule, value, set, format)), resetButton(path));
        }
        case "enum": input = select(label(path), rule.values.map(item => ({ value: item, label: path === "behavior.weekStart" && item !== "auto" ? weekdayName(item) : optionLabel(item) })), value, set); break;
        case "color": {
            input = colorField(label(path), value.toUpperCase(), next => { if (next) set(next.toLowerCase()); });
            break;
        }
        case "locale": input = select(label(path), [{ value: "system", label: t("opt_system") }, ...localeList().map(item => ({ value: item.code, label: item.name }))], value, next => { set(next); try { localStorage.setItem("munetiosLanguage", next === "system" ? "" : next); } catch { /* blocked */ } }); break;
        case "font": input = fontControl(path, value, set); break;
        case "asset": input = assetControl(path, value, set); break;
        case "list": case "order": input = listControl(path, rule, value, set); break;
        case "features": {
            const node = el("input", { class: "mu-input", value, placeholder: '"liga" 1, "tnum" 1', spellcheck: "false", "aria-label": label(path) });
            node.addEventListener("change", () => { if (node.value && !/^("[a-z0-9]{4}"\s+(0|1|on|off))(\s*,\s*"[a-z0-9]{4}"\s+(0|1|on|off))*$/i.test(node.value.trim())) { toast(t("invalidFeatures"), "error"); return; } set(node.value.trim()); });
            input = node;
            break;
        }
        case "shortcuts": input = shortcutsControl(value); break;
        default: input = el("span");
    }
    return settingRow(label(path), t("prefHelp_" + path.replace(/\./g, "_")) || "", el("div", { class: "mail-setting-control", style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap" }, input, rule.type !== "shortcuts" ? resetButton(path) : null));
}

// Slider value labels: line height is a unitless multiplier, letter spacing is in em, reading height is a percentage.
function numberFormat(path) {
    if (path === "typography.lineHeight") return v => String(Number(v.toFixed(2)));
    if (path === "typography.letterSpacing") return v => `${Number(v.toFixed(3))}em`;
    if (path === "layout.readingHeight") return v => `${v}%`;
    if (path.includes("glass.blur") || /(Width|Height|Size|size)$/.test(path)) return v => `${v}px`;
    return v => String(v);
}

function fontControl(path, value, set) {
    const wrap = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" });
    const draw = async () => {
        const fonts = (await assets()).filter(item => item.kind === "font");
        const options = [...FONT_CHOICES.map(name => ({ value: name, label: name })), ...fonts.map(item => ({ value: "asset:" + item.id, label: item.name }))];
        if (value.startsWith("local:")) options.push({ value, label: value.slice(6) });
        wrap.replaceChildren(select(label(path), options, value, set),
            button(t("localFont"), async () => {
                if (!("queryLocalFonts" in window)) { toast(t("localFontsUnsupported"), "error"); return; }
                try {
                    const families = [...new Set((await window.queryLocalFonts()).map(font => font.family))].filter(name => /^[A-Za-z0-9 _-]{1,60}$/.test(name)).sort();
                    menu(wrap, families.slice(0, 400).map(family => ({ label: family, action: () => set("local:" + family) })), { label: t("localFont") });
                } catch { toast(t("localFontsDenied"), "error"); }
            }, { iconName: "computer" }),
            button(t("importFont"), async () => {
                const [file] = await pickFiles({ accept: ".woff2,.woff,.ttf,.otf,font/*", multiple: false });
                if (!file) return;
                const type = file.type || ({ woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" }[file.name.split(".").pop().toLowerCase()] || "");
                try {
                    const result = await upload(`/assets/font?mailbox=${primaryMailbox().id}`, file, { headers: { "X-File-Name": encodeURIComponent(file.name), "X-File-Type": type } });
                    await assets(true); set("asset:" + result.id); toast(t("fontImported"), "success"); emit("storageStale");
                } catch (error) { toast(error.code === "unsupportedFile" ? t("unsupportedFont") : t("uploadFailed"), "error"); }
            }, { iconName: "upload" }));
    };
    draw();
    return wrap;
}

function assetControl(path, value, set) {
    const wrap = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" });
    const kind = path.includes("background") ? "background" : "sound";
    const draw = async () => {
        const list = (await assets()).filter(item => item.kind === kind);
        wrap.replaceChildren(
            list.length ? select(label(path), [{ value: "", label: t("none") }, ...list.map(item => ({ value: item.id, label: `${item.name} (${formatBytes(item.size)})` }))], value, set) : el("span", { class: "mu-muted", text: kind === "background" ? t("noImagesYet") : t("noSoundsYet") }),
            button(kind === "background" ? t("uploadImage") : t("uploadSound"), async () => {
                const accept = kind === "background" ? "image/png,image/jpeg,image/webp,image/gif,image/avif" : "audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/aac";
                const [file] = await pickFiles({ accept, multiple: false });
                if (!file) return;
                try {
                    const result = await upload(`/assets/${kind}?mailbox=${primaryMailbox().id}`, file, { headers: { "X-File-Name": encodeURIComponent(file.name), "X-File-Type": file.type } });
                    await assets(true);
                    if (kind === "background") savePreference("appearance.background.type", "image");
                    set(result.id); emit("storageStale"); draw();
                } catch (error) { toast(error.code === "quotaExceeded" ? t("uploadQuota") : t("uploadFailed"), "error"); }
            }, { iconName: "upload" }),
            value ? button(kind === "background" ? t("deleteImage") : t("deleteSound"), async () => { await del(`/assets/${value}`).catch(() => {}); set(""); await assets(true); draw(); emit("storageStale"); }) : null);
    };
    draw();
    return wrap;
}

const itemLabel = item => t("action_" + item) || t(item === "all" ? "allMail" : item) || item;

// One list per pair of order + hidden preferences: each item appears once, with a visibility switch and move buttons.
const PAIRS = { "layout.navOrder": "layout.navHidden", "layout.toolbarOrder": "layout.toolbarHidden" };
const PAIRED_HIDDEN = new Set(Object.values(PAIRS));

function orderedVisibilityControl(orderPath) {
    const hiddenPath = PAIRS[orderPath];
    const all = SCHEMA[orderPath].of;
    const list = el("div", { class: "mail-list-editor", role: "list", "aria-label": label(orderPath) });
    const draw = () => {
        const saved = (getPath(state.prefs, orderPath) || []).filter(item => all.includes(item));
        const order = [...new Set([...saved, ...all])];
        const hidden = new Set(getPath(state.prefs, hiddenPath) || []);
        const move = (index, delta) => {
            const target = index + delta;
            if (target < 0 || target >= order.length) return;
            const next = [...order];
            [next[index], next[target]] = [next[target], next[index]];
            savePreference(orderPath, next);
            draw();
        };
        list.replaceChildren(...order.map((item, index) => el("div", { class: "mail-list-item" + (hidden.has(item) ? " is-hidden" : ""), role: "listitem" },
            el("span", { class: "mail-list-name", text: itemLabel(item) }),
            switchControl(itemLabel(item), !hidden.has(item), on => {
                const next = on ? [...hidden].filter(entry => entry !== item) : [...hidden, item];
                savePreference(hiddenPath, next);
                draw();
            }),
            iconButton("arrow_upward", t("moveUp"), () => move(index, -1), { class: "mu-icon-btn mu-icon-btn-sm", disabled: index === 0 }),
            iconButton("arrow_downward", t("moveDown"), () => move(index, 1), { class: "mu-icon-btn mu-icon-btn-sm", disabled: index === order.length - 1 }))));
    };
    draw();
    return el("div", { class: "mail-block-setting" },
        el("div", { class: "mail-block-head" }, el("span", { class: "mu-row-title", text: label(orderPath) }),
            iconButton("restart_alt", t("resetSetting"), () => { resetPreference(orderPath); resetPreference(hiddenPath); draw(); }, { class: "mu-icon-btn mu-icon-btn-sm" })),
        list);
}

function listControl(path, rule, value, set) {
    const list = el("div", { class: "mail-list-editor mail-toggle-grid", role: "group", "aria-label": label(path) });
    const draw = current => {
        list.replaceChildren(...rule.of.map(item => el("div", { class: "mail-list-item" },
            el("span", { class: "mail-list-name", text: itemLabel(item) }),
            switchControl(itemLabel(item), current.includes(item), on => { const next = on ? [...current, item] : current.filter(entry => entry !== item); set(next); draw(next); }))));
    };
    draw(value || []);
    return list;
}

function shortcutsControl(value) {
    const rows = SHORTCUT_ACTIONS.map(action => {
        const input = el("input", { class: "mu-input mail-shortcut-input", value: value[action] || "", "aria-label": t("shortcut_" + action), readonly: true });
        input.addEventListener("keydown", event => {
            event.preventDefault();
            if (event.key === "Tab") return;
            if (event.key === "Backspace" || event.key === "Delete") { input.value = ""; }
            else if (!["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
                const parts = [];
                if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
                if (event.altKey) parts.push("Alt");
                if (event.shiftKey) parts.push("Shift");
                parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
                input.value = parts.join("+");
            }
            const next = { ...getPath(state.prefs, "behavior.shortcuts"), [action]: input.value };
            const clash = Object.entries(next).find(([other, combo]) => other !== action && combo && combo === input.value);
            if (clash) toast(t("shortcutInUse", { action: t("shortcut_" + clash[0]) }), "error");
            savePreference("behavior.shortcuts", next);
        });
        return el("div", { class: "mu-shortcut" }, el("span", { text: t("shortcut_" + action) }), input);
    });
    return el("div", { style: "display:grid;gap:8px;width:100%" }, el("div", { class: "mail-kbd-list" }, rows),
        button(t("resetShortcuts"), () => { savePreference("behavior.shortcuts", DEFAULT_SHORTCUTS); emit("studioRefresh"); }));
}

export const SECTIONS = {
    appearance: ["appearance.mode", "appearance.accent", "appearance.accentGradient", "appearance.accent2", "appearance.gradientAngle", "appearance.customPalette", "appearance.palette.background", "appearance.palette.surface",
        "appearance.palette.text", "appearance.palette.muted", "appearance.highContrast", "appearance.background.type", "appearance.background.color", "appearance.background.from", "appearance.background.to",
        "appearance.background.angle", "appearance.background.image", "appearance.background.position", "appearance.background.size", "appearance.background.brightness", "appearance.background.opacity"],
    glass: ["appearance.glass.alpha", "appearance.glass.saturation", "appearance.glass.brightness", "appearance.glass.blur", "appearance.border.color", "appearance.border.opacity", "appearance.shadow", "appearance.radius", "appearance.hover", "appearance.animationSpeed"],
    typography: ["typography.uiFont", "typography.messageFont", "typography.composeFont", "typography.size", "typography.weight", "typography.opsz", "typography.width", "typography.slant", "typography.roundness",
        "typography.stylisticSets", "typography.features", "typography.letterSpacing", "typography.lineHeight"],
    layout: ["layout.sidebarWidth", "layout.sidebarPosition", "layout.sidebarCollapsed", "layout.listWidth", "layout.readingPane", "layout.readingHeight", "layout.navHidden", "layout.navOrder", "layout.toolbarOrder",
        "layout.toolbarHidden", "layout.density", "layout.previewLines", "layout.avatars", "layout.avatarSize", "layout.iconSize", "layout.composeWidth", "layout.composeHeight", "layout.headerVisible",
        "layout.quickActions", "layout.swipeLeft", "layout.swipeRight", "layout.conversationView", "layout.categoryTabs"],
    shortcuts: ["behavior.shortcutsEnabled", "behavior.shortcuts"],
    sounds: ["behavior.notifications", "behavior.notificationPreview", "behavior.sound", "behavior.soundAsset"],
};

export function renderSection(name, exclude = []) {
    const paths = SECTIONS[name] || [];
    return paths.filter(path => visible(path) && !exclude.includes(path)).map(control).filter(Boolean);
}

function visible(path) {
    const p = state.prefs.appearance;
    if (path === "appearance.accent2" || path === "appearance.gradientAngle") return p.accentGradient;
    if (path.startsWith("appearance.palette.")) return p.customPalette;
    if (path.startsWith("appearance.background.") && path !== "appearance.background.type") {
        const type = p.background.type;
        if (type === "default") return false;
        if (["color"].includes(path.split(".").pop())) return type === "color";
        if (["from", "to", "angle"].includes(path.split(".").pop())) return type === "gradient";
        return type === "image";
    }
    if (path === "layout.readingHeight") return state.prefs.layout.readingPane === "bottom";
    return true;
}

export function themesSection(rerender) {
    const node = el("div", { class: "mail-list-editor" });
    const draw = async () => {
        const themes = (await get("/themes").catch(() => ({ themes: [] }))).themes;
        state.boot.themes = themes;
        node.replaceChildren(
            el("div", { class: "mail-inline-form", style: "align-items:center" },
                button(t("saveCurrentTheme"), async () => {
                    const name = await promptDialog({ title: t("createTheme"), label: t("name"), value: t("myTheme"), iconName: "palette" });
                    if (!name) return;
                    const data = Object.fromEntries(THEME_PREFIXES.map(prefix => [prefix.slice(0, -1), structuredClone(state.prefsRaw[prefix.slice(0, -1)] || {})]));
                    await post("/themes", { name, data }); toast(t("themeSaved"), "success"); draw();
                }, { iconName: "add", primary: true }),
                button(t("importTheme"), async () => {
                    const [file] = await pickFiles({ accept: ".json,application/json", multiple: false });
                    if (!file) return;
                    try {
                        const parsed = JSON.parse(await file.text());
                        const theme = sanitizeTheme(parsed);
                        if (!Object.keys(theme.data).length) throw new Error("empty");
                        await post("/themes", theme); toast(t("themeImported"), "success"); draw();
                    } catch { toast(t("themeImportFailed"), "error"); }
                }, { iconName: "upload" }),
                button(t("resetInterface"), async () => {
                    if (!await confirmDialog({ title: t("resetInterface"), message: t("resetInterfaceMessage"), confirm: t("reset"), danger: true })) return;
                    replacePreferences({ behavior: state.prefsRaw.behavior || {} }); rerender?.();
                }, { iconName: "restart_alt" })),
            ...(themes.length ? themes.map(theme => el("div", { class: "mail-list-item" }, icon("palette"), el("span", { class: "mail-list-name", text: theme.name }),
                button(t("preview"), () => previewTheme(theme, rerender)),
                button(t("apply"), () => { applyTheme(theme); rerender?.(); toast(t("themeApplied"), "success"); }, { primary: true }),
                iconButton("more_vert", t("more"), event => menu(event.currentTarget, [
                    { icon: "edit", label: t("rename"), action: async () => { const name = await promptDialog({ title: t("rename"), label: t("name"), value: theme.name }); if (name) { await put(`/themes/${theme.id}`, { name, data: theme.data }); draw(); } } },
                    { icon: "content_copy", label: t("duplicate"), action: async () => { await post("/themes", { name: t("copyOf", { name: theme.name }), data: theme.data }); draw(); } },
                    { icon: "save", label: t("updateWithCurrent"), action: async () => { const data = Object.fromEntries(THEME_PREFIXES.map(prefix => [prefix.slice(0, -1), structuredClone(state.prefsRaw[prefix.slice(0, -1)] || {})])); await put(`/themes/${theme.id}`, { name: theme.name, data }); toast(t("themeSaved"), "success"); } },
                    { icon: "download", label: t("exportTheme"), action: () => download(new Blob([JSON.stringify({ format: "munetios-mail-theme", version: 1, name: theme.name, data: theme.data }, null, 2)], { type: "application/json" }), theme.name.replace(/[\\/:*?"<>|]+/g, "_") + ".munetios-theme.json") },
                    "sep",
                    { icon: "delete", label: t("delete"), danger: true, action: async () => { if (await confirmDialog({ title: t("deleteTheme"), message: t("deleteThemeMessage", { name: theme.name }), confirm: t("delete"), danger: true })) { await del(`/themes/${theme.id}`); draw(); } } },
                ]), { class: "mu-icon-btn mu-icon-btn-sm" })))
                : [el("p", { class: "mu-muted", text: t("noThemesYet") })]));
    };
    draw();
    return node;
}

function applyTheme(theme) {
    const next = structuredClone(state.prefsRaw);
    for (const prefix of THEME_PREFIXES) delete next[prefix.slice(0, -1)];
    Object.assign(next, structuredClone(sanitizeTheme(theme).data));
    replacePreferences(next);
}

function previewTheme(theme, rerender) {
    const before = structuredClone(state.prefsRaw);
    applyTheme(theme);
    const bar = document.getElementById("undoBar");
    bar.className = "mail-undo mu-glass mu-glass-solid";
    bar.replaceChildren(el("span", { text: t("previewingTheme", { name: theme.name }) }),
        button(t("keep"), () => { bar.hidden = true; rerender?.(); }, { primary: true }),
        button(t("revert"), () => { replacePreferences(before); bar.hidden = true; rerender?.(); }));
    bar.hidden = false;
}

function previewCard() {
    const sample = [
        { from: "Lina Ortiz", email: "lina@example.org", subject: t("sampleSubject1"), snippet: t("sampleSnippet1"), unread: true },
        { from: "Kai Tanaka", email: "kai@example.org", subject: t("sampleSubject2"), snippet: t("sampleSnippet2"), unread: false },
    ];
    return el("div", { class: "mail-preview-card mu-glass", "aria-label": t("livePreview") },
        el("div", { class: "mu-section-label", text: t("livePreview") }),
        ...sample.map(item => el("div", { class: "mail-row" + (item.unread ? " is-unread" : ""), style: "position:relative" }, el("span"), stamp(item.from, item.email),
            el("div", { class: "mail-row-main" }, el("div", { class: "mail-row-line" }, el("span", { class: "mail-row-from", text: item.from }), el("span", { class: "mail-row-date", text: "9:41" })),
                el("div", { class: "mail-row-subject", text: item.subject }), el("div", { class: "mail-row-snippet", text: item.snippet })), el("span"))),
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, button(t("write"), null, { primary: true, iconName: "edit_square" }), button(t("reply"), null, { iconName: "reply" }), el("span", { class: "mu-chip", "aria-pressed": "true" }, t("category_primary"))),
        el("div", { class: "mail-paper" }, el("p", { class: "mail-plain", style: "font-family:var(--mail-font-message)", text: t("sampleBody") })));
}

export function open() {
    const tabs = ["appearance", "glass", "typography", "layout", "themes"];
    let current = "appearance";
    const controls = el("div", { class: "mail-studio-controls mu-scroll" });
    const preview = el("div", { class: "mail-studio-preview mu-scroll" });
    const tabBar = el("div", { class: "mu-tabs", role: "tablist", "aria-label": t("customize") });
    const draw = () => {
        tabBar.replaceChildren(...tabs.map(tab => {
            const node = el("button", { type: "button", role: "tab", "aria-selected": String(tab === current) }, t("studio_" + tab));
            node.addEventListener("click", () => { current = tab; draw(); });
            return node;
        }));
        controls.replaceChildren(tabBar, ...(current === "themes" ? [themesSection(draw)] : renderSection(current)));
        preview.replaceChildren(previewCard());
    };
    const off = [];
    import("./state.js").then(({ on }) => { off.push(on("prefsChanged", path => { if (/accentGradient|customPalette|background\.type|readingPane/.test(path) || path === "*") draw(); else preview.replaceChildren(previewCard()); })); off.push(on("studioRefresh", draw)); });
    const d = dialog({ title: t("customizationStudio"), iconName: "palette", content: [el("div", { class: "mail-studio" }, controls, preview)], actions: [button(t("done"), () => d.close(), { primary: true })], onClose: () => off.forEach(fn => fn()), className: "mail-studio-dialog" });
    draw();
}

