// Munetios Mail preferences and theme schema, shared by the browser and the Mail Worker.
// Every value is typed and range-checked. Themes are data only: they cannot contain JavaScript,
// selectors, or free-form CSS, and unknown keys are dropped on import.

export const FONT_CHOICES = ["Munetios UI v4 Font", "Google Sans Flex", "Google Sans Code", "system-ui", "Georgia", "Times New Roman", "Arial", "Verdana", "Trebuchet MS", "Courier New", "serif", "sans-serif", "monospace"];
export const STYLISTIC_SETS = Array.from({ length: 20 }, (_, index) => "ss" + String(index + 1).padStart(2, "0"));
export const TOOLBAR_ACTIONS = ["archive", "trash", "spam", "move", "label", "read", "star", "important", "snooze", "pin", "print", "more"];
export const QUICK_ACTIONS = ["archive", "trash", "read", "star", "snooze", "pin", "important", "spam"];
export const SWIPE_ACTIONS = ["none", "archive", "trash", "read", "star", "snooze", "pin"];
export const NAV_ITEMS = ["inbox", "starred", "important", "snoozed", "sent", "drafts", "scheduled", "outbox", "all", "archive", "spam", "trash"];
export const SHORTCUT_ACTIONS = ["compose", "search", "reply", "replyAll", "forward", "archive", "trash", "read", "unread", "star", "next", "previous", "open", "back", "selectAll", "send", "settings", "goInbox", "goSent", "goDrafts", "help"];
export const DEFAULT_SHORTCUTS = {
    compose: "c", search: "/", reply: "r", replyAll: "a", forward: "f", archive: "e", trash: "#", read: "Shift+I", unread: "Shift+U", star: "s",
    next: "j", previous: "k", open: "o", back: "u", selectAll: "Ctrl+A", send: "Ctrl+Enter", settings: "Ctrl+,", goInbox: "g i", goSent: "g t", goDrafts: "g d", help: "?",
};
export const SOUNDS = ["none", "chime", "soft", "bell", "pop"];

const color = { type: "color" };
// path: [type, default, ...constraints]
export const SCHEMA = {
    "appearance.mode": { type: "enum", values: ["system", "light", "dark"], default: "system" },
    "appearance.accent": { ...color, default: "#8f5cff" },
    "appearance.accent2": { ...color, default: "#e05cff" },
    "appearance.accentGradient": { type: "bool", default: false },
    "appearance.gradientAngle": { type: "number", min: 0, max: 360, step: 1, default: 135 },
    "appearance.customPalette": { type: "bool", default: false },
    "appearance.palette.background": { ...color, default: "#110736" },
    "appearance.palette.surface": { ...color, default: "#2e1060" },
    "appearance.palette.text": { ...color, default: "#f6f3ff" },
    "appearance.palette.muted": { ...color, default: "#b9b0d6" },
    "appearance.highContrast": { type: "bool", default: false },
    "appearance.background.type": { type: "enum", values: ["default", "color", "gradient", "image"], default: "default" },
    "appearance.background.color": { ...color, default: "#1b0d45" },
    "appearance.background.from": { ...color, default: "#2b1170" },
    "appearance.background.to": { ...color, default: "#0d0628" },
    "appearance.background.angle": { type: "number", min: 0, max: 360, step: 1, default: 160 },
    "appearance.background.image": { type: "asset", default: "" },
    "appearance.background.position": { type: "enum", values: ["center", "top", "bottom", "left", "right"], default: "center" },
    "appearance.background.size": { type: "enum", values: ["cover", "contain", "auto", "tile"], default: "cover" },
    "appearance.background.brightness": { type: "number", min: 0.3, max: 1.5, step: 0.05, default: 1 },
    "appearance.background.opacity": { type: "number", min: 0, max: 1, step: 0.05, default: 1 },
    "appearance.glass.alpha": { type: "number", min: 0.01, max: 0.5, step: 0.01, default: 0.42 },
    "appearance.glass.saturation": { type: "number", min: 100, max: 250, step: 5, default: 180 },
    "appearance.glass.brightness": { type: "number", min: 0.7, max: 1.3, step: 0.01, default: 1 },
    "appearance.glass.blur": { type: "number", min: 0, max: 3, step: 0.5, default: 2 },
    "appearance.border.color": { ...color, default: "#ffffff" },
    "appearance.border.opacity": { type: "number", min: 0, max: 0.6, step: 0.01, default: 0.12 },
    "appearance.shadow": { type: "number", min: 0, max: 2, step: 0.1, default: 1 },
    "appearance.radius": { type: "number", min: 0.4, max: 1.4, step: 0.05, default: 1 },
    "appearance.hover": { type: "enum", values: ["none", "subtle", "normal", "strong"], default: "normal" },
    "appearance.animationSpeed": { type: "number", min: 0, max: 2, step: 0.1, default: 1 },

    "typography.uiFont": { type: "font", default: "Munetios UI v4 Font" },
    "typography.messageFont": { type: "font", default: "Munetios UI v4 Font" },
    "typography.composeFont": { type: "font", default: "Munetios UI v4 Font" },
    "typography.size": { type: "number", min: 18, max: 28, step: 1, default: 18 },
    "typography.weight": { type: "number", min: 300, max: 400, step: 10, default: 400 },
    "typography.opsz": { type: "number", min: 0, max: 144, step: 1, default: 0 },
    "typography.width": { type: "number", min: 75, max: 125, step: 1, default: 100 },
    "typography.slant": { type: "number", min: -10, max: 0, step: 1, default: 0 },
    "typography.roundness": { type: "number", min: 0, max: 100, step: 1, default: 0 },
    "typography.stylisticSets": { type: "list", of: STYLISTIC_SETS, default: ["ss01"] },
    "typography.features": { type: "features", default: "" },
    "typography.letterSpacing": { type: "number", min: -0.05, max: 0.2, step: 0.005, default: 0 },
    "typography.lineHeight": { type: "number", min: 1.1, max: 2.2, step: 0.05, default: 1.5 },

    "layout.sidebarWidth": { type: "number", min: 200, max: 480, step: 4, default: 280 },
    "layout.sidebarPosition": { type: "enum", values: ["start", "end"], default: "start" },
    "layout.sidebarCollapsed": { type: "bool", default: false },
    "layout.listWidth": { type: "number", min: 280, max: 900, step: 4, default: 420 },
    "layout.readingPane": { type: "enum", values: ["right", "bottom", "off"], default: "right" },
    "layout.readingHeight": { type: "number", min: 30, max: 75, step: 1, default: 55 },
    "layout.navHidden": { type: "list", of: NAV_ITEMS, default: [] },
    "layout.navOrder": { type: "order", of: NAV_ITEMS, default: NAV_ITEMS },
    "layout.toolbarOrder": { type: "order", of: TOOLBAR_ACTIONS, default: TOOLBAR_ACTIONS },
    "layout.toolbarHidden": { type: "list", of: TOOLBAR_ACTIONS, default: ["print"] },
    "layout.density": { type: "enum", values: ["compact", "comfortable", "spacious"], default: "comfortable" },
    "layout.previewLines": { type: "number", min: 0, max: 3, step: 1, default: 1 },
    "layout.avatars": { type: "bool", default: true },
    "layout.avatarSize": { type: "number", min: 24, max: 56, step: 2, default: 40 },
    "layout.iconSize": { type: "number", min: 18, max: 30, step: 1, default: 24 },
    "layout.composeWidth": { type: "number", min: 420, max: 1100, step: 10, default: 640 },
    "layout.composeHeight": { type: "number", min: 360, max: 960, step: 10, default: 620 },
    "layout.headerVisible": { type: "bool", default: true },
    "layout.quickActions": { type: "list", of: QUICK_ACTIONS, default: ["archive", "trash", "read", "snooze"] },
    "layout.swipeLeft": { type: "enum", values: SWIPE_ACTIONS, default: "archive" },
    "layout.swipeRight": { type: "enum", values: SWIPE_ACTIONS, default: "read" },
    "layout.conversationView": { type: "bool", default: true },
    "layout.categoryTabs": { type: "bool", default: true },

    "behavior.shortcutsEnabled": { type: "bool", default: true },
    "behavior.shortcuts": { type: "shortcuts", default: DEFAULT_SHORTCUTS },
    "behavior.notifications": { type: "bool", default: false },
    "behavior.notificationPreview": { type: "bool", default: false },
    "behavior.sound": { type: "enum", values: SOUNDS, default: "none" },
    "behavior.soundAsset": { type: "asset", default: "" },
    "behavior.markReadDelay": { type: "number", min: -1, max: 10, step: 1, default: 0 },
    "behavior.afterAction": { type: "enum", values: ["next", "previous", "list"], default: "next" },
    "behavior.confirmDelete": { type: "bool", default: true },
    "behavior.attachmentReminder": { type: "bool", default: true },
    "behavior.spellcheck": { type: "bool", default: true },
    "behavior.defaultMode": { type: "enum", values: ["rich", "html", "split", "designer", "plain"], default: "rich" },
    "behavior.replyAll": { type: "bool", default: false },
    "behavior.quoteOriginal": { type: "bool", default: true },
    "behavior.searchHistory": { type: "bool", default: true },
    "behavior.offline": { type: "bool", default: true },
    "behavior.offlineDays": { type: "number", min: 1, max: 90, step: 1, default: 30 },
    "behavior.language": { type: "locale", default: "system" },
    "behavior.timeFormat": { type: "enum", values: ["auto", "12", "24"], default: "auto" },
    "behavior.weekStart": { type: "enum", values: ["auto", "0", "1", "2", "3", "4", "5", "6"], default: "auto" },
    "behavior.reduceMotion": { type: "enum", values: ["system", "on", "off"], default: "system" },
    "behavior.linkWarnings": { type: "bool", default: true },
};

export const THEME_PREFIXES = ["appearance.", "typography.", "layout."];
const HEX = /^#[0-9a-f]{6}$/i;
const FONT_NAME = /^[A-Za-z0-9 _-]{1,60}$/;
const ASSET = /^as_[a-z0-9]{15}$/;
const FEATURE = /^"[a-z0-9]{4}"\s+(?:[01]|on|off)$/i;
const KEY_COMBO = /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*(?:[a-z0-9]|F\d{1,2}|Enter|Escape|Delete|Backspace|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|[#/?,.;'[\]\\=-])(?: [a-z0-9])?$/i;
const LOCALES = ["system", "en-US", "en-GB", "es-419", "es-ES", "es-US", "fr-FR", "fr-CA", "de", "it", "pt-BR", "pt-PT", "zh-CN", "zh-TW", "ko", "ar", "hi", "co"];

export function cleanValue(rule, value) {
    switch (rule.type) {
        case "bool": return typeof value === "boolean" ? value : undefined;
        case "number": {
            const number = Number(value);
            if (typeof value === "boolean" || value === null || value === "" || !Number.isFinite(number)) return undefined;
            return Math.min(rule.max, Math.max(rule.min, number));
        }
        case "enum": return rule.values.includes(value) ? value : undefined;
        case "color": return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : undefined;
        case "asset": return value === "" || (typeof value === "string" && ASSET.test(value)) ? value : undefined;
        case "font":
            if (typeof value !== "string") return undefined;
            if (FONT_CHOICES.includes(value)) return value;
            if (value.startsWith("asset:") && ASSET.test(value.slice(6))) return value;
            if (value.startsWith("local:") && FONT_NAME.test(value.slice(6))) return value;
            return undefined;
        case "list": return Array.isArray(value) ? [...new Set(value.filter(item => rule.of.includes(item)))] : undefined;
        case "order": {
            if (!Array.isArray(value)) return undefined;
            const list = [...new Set(value.filter(item => rule.of.includes(item)))];
            return [...list, ...rule.of.filter(item => !list.includes(item))];
        }
        case "features": {
            if (typeof value !== "string") return undefined;
            const parts = value.split(",").map(part => part.trim()).filter(Boolean);
            return parts.length <= 40 && parts.every(part => FEATURE.test(part)) ? parts.join(", ") : undefined;
        }
        case "shortcuts": {
            if (!value || typeof value !== "object") return undefined;
            const out = {};
            for (const action of SHORTCUT_ACTIONS) {
                const combo = value[action];
                out[action] = typeof combo === "string" && (combo === "" || KEY_COMBO.test(combo)) ? combo : DEFAULT_SHORTCUTS[action];
            }
            return out;
        }
        case "locale": return LOCALES.includes(value) ? value : undefined;
        default: return undefined;
    }
}

export function getPath(object, path) { return path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), object); }
export function setPath(object, path, value) {
    const keys = path.split(".");
    let node = object;
    for (const key of keys.slice(0, -1)) node = node[key] && typeof node[key] === "object" ? node[key] : (node[key] = {});
    node[keys.at(-1)] = value;
    return object;
}

// Keeps only known, valid values. prefixes limits which sections are accepted (themes vs. all preferences).
export function sanitizePreferences(input, prefixes = null) {
    const out = {};
    if (!input || typeof input !== "object") return out;
    for (const [path, rule] of Object.entries(SCHEMA)) {
        if (prefixes && !prefixes.some(prefix => path.startsWith(prefix))) continue;
        const value = cleanValue(rule, getPath(input, path));
        if (value !== undefined) setPath(out, path, value);
    }
    return out;
}

export function defaults(prefixes = null) {
    const out = {};
    for (const [path, rule] of Object.entries(SCHEMA)) {
        if (prefixes && !prefixes.some(prefix => path.startsWith(prefix))) continue;
        setPath(out, path, structuredClone(rule.default));
    }
    return out;
}

export function resolved(preferences) {
    const out = defaults();
    const clean = sanitizePreferences(preferences);
    for (const path of Object.keys(SCHEMA)) {
        const value = getPath(clean, path);
        if (value !== undefined) setPath(out, path, value);
    }
    return out;
}

export function sanitizeTheme(input) {
    const name = typeof input?.name === "string" ? input.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) : "";
    return { name: name || "Theme", data: sanitizePreferences(input?.data ?? input, THEME_PREFIXES) };
}
