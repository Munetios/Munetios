"use client";

import { useEffect, useRef } from "react";
import {
  applyDeveloperCss,
  developerSettingsChangeEvent,
  loadDeveloperSettings,
} from "../lib/developerSettings";

export const appearanceStorageKey = "munetios.appearance";
const appearanceSyncUrl = "/api/account/sync";

export const appearanceDefaults = {
  accountSettingsPadding: 16,
  accentColor: "#a855f7",
  backgroundColor: "#150627",
  backgroundColorSecondary: "#31164f",
  backgroundMode: "gradient",
  borderRadius: 24,
  compactMode: false,
  customBorderRadius: false,
  customColors: [],
  fontFamily: "theme-font",
  glassBlur: 3,
  gradientAngle: 135,
  gradientColors: [],
  reduceMotion: false,
  reduceTransparency: false,
  resizeViewportOnPinch: false,
  ss01: true,
  ss08: true,
  theme: "munetios-default",
  themeMode: "system",
  textSize: 100,
};

export const appearanceThemes = [
  {
    accent: "#a855f7",
    background: "#08020f",
    backgroundSecondary: "#23053b",
    font: '"Google Sans Flex", "Google Sans", system-ui, sans-serif',
    foreground: "#f7f2ff",
    glass: true,
    hoverY: "-3px",
    id: "munetios-default",
    labelKey: "accountThemeMunetiosDefault",
    name: "Munetios Default Redesign",
    containerRadius: "30px",
    radius: "26px",
    spacing: "0.3rem",
    transition: "240ms",
  },
  {
    accent: "#a855f7",
    background: "#150627",
    backgroundSecondary: "#31164f",
    font: '"Google Sans Flex", "Google Sans", system-ui, sans-serif',
    foreground: "#f7f2ff",
    glass: true,
    hoverY: "-2px",
    id: "munetios-classic",
    labelKey: "accountThemeClassic",
    name: "Munetios Classic",
    containerRadius: "28px",
    radius: "50px",
    spacing: "0.25rem",
    transition: "180ms",
  },
  {
    accent: "#d0bcff",
    background: "#141218",
    backgroundSecondary: "#211f26",
    colorRoles: {
      onPrimary: "#381e72",
      onSurface: "#e6e1e5",
      outline: "#938f99",
      primaryContainer: "#4f378b",
      surface: "#141218",
      surfaceContainer: "#211f26",
      surfaceContainerHigh: "#2b2930",
    },
    font: '"Google Sans Flex", "Google Sans", system-ui, sans-serif',
    foreground: "#e6e1e5",
    glass: true,
    hoverY: "-1px",
    id: "google-material-design",
    labelKey: "accountThemeGoogleMaterialDesign",
    containerRadius: "28px",
    radius: "50px",
    spacing: "0.27rem",
    transition: "220ms",
  },
  {
    accent: "#78a9ff",
    background: "#161616",
    backgroundSecondary: "#262626",
    font: '"Google Sans Flex", "Google Sans", system-ui, sans-serif',
    foreground: "#f4f4f4",
    glass: true,
    hoverY: "0px",
    id: "carbon",
    labelKey: "accountThemeCarbon",
    radius: "2px",
    spacing: "0.23rem",
    transition: "110ms",
  },
  {
    accent: "#8b5cf6",
    background: "#201f1e",
    backgroundSecondary: "#323130",
    font: 'system-ui, "Segoe UI Variable", "Segoe UI", sans-serif',
    foreground: "#ffffff",
    glass: true,
    hoverY: "-1px",
    id: "microsoft-fluent",
    labelKey: "accountThemeMicrosoftFluent",
    radius: "8px",
    spacing: "0.25rem",
    transition: "160ms",
  },
  {
    accent: "#38bdf8",
    background: "#071a2f",
    backgroundSecondary: "#12385c",
    font: '"Google Sans Flex", Inter, system-ui, sans-serif',
    foreground: "#eff8ff",
    glass: true,
    hoverY: "-2px",
    id: "blueish",
    labelKey: "accountThemeBlueish",
    containerRadius: "28px",
    radius: "50px",
    spacing: "0.25rem",
    transition: "190ms",
  },
  {
    accent: "#c084fc",
    background: "#10051f",
    backgroundSecondary: "#1d4d57",
    font: '"Google Sans Flex", "Google Sans", system-ui, sans-serif',
    foreground: "#f8f4ff",
    glass: true,
    hoverY: "-3px",
    id: "dymatic",
    labelKey: "accountThemeDymatic",
    containerRadius: "28px",
    radius: "50px",
    spacing: "0.27rem",
    transition: "260ms",
  },
  {
    accent: "#7c3aed",
    background: "#20132c",
    backgroundSecondary: "#3b254b",
    font: "system-ui, sans-serif",
    foreground: "#ffffff",
    glass: false,
    hoverY: "0px",
    id: "classic",
    labelKey: "accountThemeClassic",
    radius: "4px",
    spacing: "0.22rem",
    transition: "80ms",
  },
  {
    accent: "#ffff00",
    background: "#000000",
    backgroundSecondary: "#111111",
    font: "system-ui, sans-serif",
    foreground: "#ffffff",
    glass: true,
    hoverY: "0px",
    id: "high-contrast-dark",
    labelKey: "accountThemeHighContrastDark",
    radius: "0px",
    spacing: "0.27rem",
    transition: "1ms",
  },
  {
    accent: "#facc15",
    background: "#2b2205",
    backgroundSecondary: "#59450b",
    font: '"Google Sans Flex", system-ui, sans-serif',
    foreground: "#fffbe8",
    glass: true,
    hoverY: "-2px",
    id: "yellowish",
    labelKey: "accountThemeYellowish",
    containerRadius: "28px",
    radius: "50px",
    spacing: "0.25rem",
    transition: "180ms",
  },
];

const lightThemePalettes = {
  "munetios-default": {
    background: "#f7f0ff",
    backgroundSecondary: "#dec9f7",
    foreground: "#1e1029",
  },
  "munetios-classic": {
    background: "#f8f3ff",
    backgroundSecondary: "#e9dcf8",
    foreground: "#24152f",
  },
  "google-material-design": {
    background: "#fffbfe",
    backgroundSecondary: "#f3edf7",
    foreground: "#1d1b20",
  },
  carbon: {
    background: "#f4f4f4",
    backgroundSecondary: "#e0e0e0",
    foreground: "#161616",
  },
  "microsoft-fluent": {
    background: "#faf9f8",
    backgroundSecondary: "#edebe9",
    foreground: "#201f1e",
  },
  blueish: {
    background: "#eff8ff",
    backgroundSecondary: "#d8ebfa",
    foreground: "#08233d",
  },
  dymatic: {
    background: "#faf5ff",
    backgroundSecondary: "#dff2f4",
    foreground: "#21122f",
  },
  classic: {
    background: "#faf7fc",
    backgroundSecondary: "#e9e0ee",
    foreground: "#25172d",
  },
  "high-contrast-dark": {
    background: "#ffffff",
    backgroundSecondary: "#eeeeee",
    foreground: "#000000",
  },
  yellowish: {
    background: "#fffbe8",
    backgroundSecondary: "#fff0a8",
    foreground: "#2b2205",
  },
};

const darkThemePaletteOverrides = {};

function normalizeHex(value, fallback) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^#[\da-f]{6}$/i.test(normalized)
    ? normalized.toLowerCase()
    : fallback;
}

function clampAppearanceNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

const originalResponsiveMediaQueries = new WeakMap();
const responsiveMediaQueryRules = new Set();
let currentResponsiveMediaQueryScale = null;

function scaleMediaQueryLength(value, scale) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return String(Math.round(number * scale * 1000) / 1000);
}

function getScaledResponsiveMediaQuery(mediaText, scale) {
  const scaleLength = (_match, prefix, value, unit) =>
    `${prefix}${scaleMediaQueryLength(value, scale)}${unit}`;

  return mediaText
    .replace(
      /(\b(?:min-|max-)?(?:width|height)\s*:\s*)(\d*\.?\d+)(px|rem|em)\b/gi,
      scaleLength,
    )
    .replace(
      /(\b(?:width|height)\s*(?:<=|>=|<|>)\s*)(\d*\.?\d+)(px|rem|em)\b/gi,
      scaleLength,
    )
    .replace(
      /(\d*\.?\d+)(px|rem|em)(\s*(?:<=|>=|<|>)\s*(?:width|height)\b)/gi,
      (_match, value, unit, suffix) =>
        `${scaleMediaQueryLength(value, scale)}${unit}${suffix}`,
    );
}

function updateResponsiveMediaRuleList(ruleList, scale) {
  for (const rule of ruleList) {
    if (rule.media?.mediaText) {
      if (!originalResponsiveMediaQueries.has(rule)) {
        originalResponsiveMediaQueries.set(rule, rule.media.mediaText);
      }
      responsiveMediaQueryRules.add(rule);

      const originalMediaText = originalResponsiveMediaQueries.get(rule);
      const scaledMediaText = getScaledResponsiveMediaQuery(
        originalMediaText,
        scale,
      );
      if (rule.media.mediaText !== scaledMediaText) {
        try {
          rule.media.mediaText = scaledMediaText;
        } catch {
          // Some browser-managed stylesheets expose read-only media rules.
        }
      }
    }

    if (rule.cssRules) {
      updateResponsiveMediaRuleList(rule.cssRules, scale);
    }
  }
}

export function applyResponsiveMediaQueryScale(textSize) {
  if (typeof document === "undefined") return;

  const scale =
    clampAppearanceNumber(textSize, 25, 1000, appearanceDefaults.textSize) /
    100;

  for (const stylesheet of document.styleSheets) {
    try {
      updateResponsiveMediaRuleList(stylesheet.cssRules, scale);
    } catch {
      // Cross-origin stylesheets cannot be inspected through CSSOM.
    }
  }

  if (
    typeof window !== "undefined" &&
    currentResponsiveMediaQueryScale !== scale
  ) {
    currentResponsiveMediaQueryScale = scale;
    window.dispatchEvent(
      new CustomEvent("munetios:responsivechange", {
        detail: { scale },
      }),
    );
  }
}

function restoreResponsiveMediaQueries() {
  for (const rule of responsiveMediaQueryRules) {
    const originalMediaText = originalResponsiveMediaQueries.get(rule);
    if (!originalMediaText || !rule.media) continue;
    try {
      rule.media.mediaText = originalMediaText;
    } catch {
      // The stylesheet may have been replaced during navigation or hot reload.
    }
  }
  responsiveMediaQueryRules.clear();
}

function applyResponsiveViewportDimensions(textSize) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const scale =
    clampAppearanceNumber(textSize, 25, 1000, appearanceDefaults.textSize) /
    100;
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const root = document.documentElement;
  root.style.setProperty(
    "--app-responsive-viewport-width",
    `${viewportWidth / scale}px`,
  );
  root.style.setProperty(
    "--app-responsive-viewport-height",
    `${viewportHeight / scale}px`,
  );
}

function getReadableTextColor(hex) {
  const color = normalizeHex(hex, "#150627").slice(1);
  const channels = [0, 2, 4].map((index) => {
    const value = Number.parseInt(color.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.42 ? "#17121f" : "#ffffff";
}

export function getResolvedThemeMode(themeMode = "system") {
  if (themeMode === "light" || themeMode === "dark") return themeMode;
  if (themeMode === "custom") return "custom";

  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function getThemePalette(theme, themeMode = "system") {
  const resolvedMode = getResolvedThemeMode(themeMode);
  if (resolvedMode === "light") {
    return (
      lightThemePalettes[theme.id] || lightThemePalettes["munetios-default"]
    );
  }

  if (darkThemePaletteOverrides[theme.id]) {
    return darkThemePaletteOverrides[theme.id];
  }

  return {
    background: theme.background,
    backgroundSecondary: theme.backgroundSecondary,
    foreground: theme.foreground,
  };
}

export function loadAppearanceSettings() {
  if (typeof window === "undefined") return appearanceDefaults;

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(appearanceStorageKey) || "{}",
    );
    return {
      ...appearanceDefaults,
      ...stored,
      theme: appearanceThemes.some((theme) => theme.id === stored.theme)
        ? stored.theme
        : appearanceDefaults.theme,
    };
  } catch {
    return appearanceDefaults;
  }
}

function saveAppearanceSettings(settings) {
  try {
    window.localStorage.setItem(appearanceStorageKey, JSON.stringify(settings));
  } catch {
    // Local storage is the offline fallback and may be unavailable in private contexts.
  }
}

async function syncAppearanceSettings(settings) {
  try {
    const response = await fetch(appearanceSyncUrl, {
      body: JSON.stringify({ appearance: settings }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    return response.ok;
  } catch {
    return false;
  }
}

export function applyAppearanceSettings(settings) {
  if (typeof document === "undefined") return;

  const resolved = { ...appearanceDefaults, ...settings };
  const theme =
    appearanceThemes.find((candidate) => candidate.id === resolved.theme) ||
    appearanceThemes[0];
  const resolvedMode = getResolvedThemeMode(resolved.themeMode);
  const palette = getThemePalette(theme, resolved.themeMode);
  const isCustomColor = resolved.themeMode === "custom";
  const background = isCustomColor
    ? normalizeHex(resolved.backgroundColor, palette.background)
    : palette.background;
  const secondary = isCustomColor
    ? normalizeHex(
        resolved.backgroundColorSecondary,
        palette.backgroundSecondary,
      )
    : palette.backgroundSecondary;
  const gradientColors = Array.isArray(resolved.gradientColors)
    ? resolved.gradientColors
        .map((color) => normalizeHex(color, null))
        .filter(Boolean)
    : [];
  const accent = normalizeHex(resolved.accentColor, theme.accent);
  const borderRadius = clampAppearanceNumber(
    resolved.borderRadius,
    0,
    50,
    appearanceDefaults.borderRadius,
  );
  const accountSettingsPadding = clampAppearanceNumber(
    resolved.accountSettingsPadding,
    8,
    32,
    appearanceDefaults.accountSettingsPadding,
  );
  const glassBlur = clampAppearanceNumber(
    resolved.glassBlur,
    1,
    100,
    appearanceDefaults.glassBlur,
  );
  const textSize = clampAppearanceNumber(
    resolved.textSize,
    25,
    1000,
    appearanceDefaults.textSize,
  );
  const radius = resolved.customBorderRadius
    ? `${borderRadius}px`
    : theme.radius;
  const spacing = resolved.compactMode
    ? `${Math.max(0.12, (Number.parseFloat(theme.spacing) || 0.25) * 0.78).toFixed(3)}rem`
    : theme.spacing;
  const font =
    resolved.fontFamily === "theme-font"
      ? theme.font
      : resolved.fontFamily === "system-ui"
        ? "system-ui, sans-serif"
        : `"${String(resolved.fontFamily).replaceAll('"', "")}", system-ui, sans-serif`;
  const root = document.documentElement;

  root.dataset.munetiosTheme = theme.id;
  root.dataset.munetiosThemeMode = isCustomColor
    ? getReadableTextColor(background) === "#17121f"
      ? "light"
      : "dark"
    : resolvedMode;
  root.classList.toggle("reduce-motion", Boolean(resolved.reduceMotion));
  root.classList.toggle("compact-mode", Boolean(resolved.compactMode));
  root.classList.toggle(
    "reduce-transparency",
    Boolean(resolved.reduceTransparency),
  );
  root.classList.toggle("theme-no-glass", !theme.glass);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--purple", accent);
  root.style.setProperty("--background", background);
  root.style.setProperty("--background-secondary", secondary);
  root.style.setProperty("--background-secondary", secondary);
  root.style.setProperty(
    "--app-background",
    resolved.backgroundMode === "solid"
      ? background
      : `linear-gradient(${clampGradientAngle(resolved.gradientAngle)}deg, ${[
          background,
          ...gradientColors,
          secondary,
        ].join(", ")})`,
  );
  root.style.setProperty(
    "--foreground",
    isCustomColor ? getReadableTextColor(background) : palette.foreground,
  );
  root.style.setProperty("--app-font", font);
  root.style.setProperty("--liquid-glass-blur", `${glassBlur}px`);
  root.style.setProperty("--app-text-scale", String(textSize / 100));
  root.style.setProperty("zoom", `${textSize}%`);
  applyResponsiveViewportDimensions(textSize);
  root.style.setProperty("--font-ss01", resolved.ss01 ? "1" : "0");
  root.style.setProperty("--font-ss08", resolved.ss08 ? "1" : "0");
  root.style.setProperty("--theme-radius", radius);
  root.toggleAttribute(
    "data-custom-border-radius",
    Boolean(resolved.customBorderRadius),
  );
  root.style.setProperty(
    "--theme-container-radius",
    resolved.customBorderRadius
      ? radius
      : theme.containerRadius || theme.radius,
  );
  root.style.setProperty("--theme-spacing-unit", spacing);
  root.style.setProperty(
    "--account-settings-padding",
    `${accountSettingsPadding}px`,
  );
  root.style.setProperty("--theme-transition", theme.transition);
  root.style.setProperty("--theme-hover-y", theme.hoverY);
  root.style.setProperty("--spinner-primary", accent);
  root.style.setProperty("--spinner-secondary", secondary);
  root.style.setProperty("--spacing", spacing);
  root.style.setProperty(
    "--radius-sm",
    resolved.customBorderRadius ? radius : `max(0px, calc(${radius} - 10px))`,
  );
  root.style.setProperty(
    "--radius-md",
    resolved.customBorderRadius ? radius : `max(0px, calc(${radius} - 6px))`,
  );
  root.style.setProperty(
    "--radius-lg",
    resolved.customBorderRadius ? radius : `max(0px, calc(${radius} - 2px))`,
  );
  root.style.setProperty("--radius-xl", radius);
  root.style.setProperty(
    "--radius-2xl",
    resolved.customBorderRadius ? radius : `calc(${radius} + 4px)`,
  );
  root.style.setProperty(
    "--radius-3xl",
    resolved.customBorderRadius ? radius : `calc(${radius} + 8px)`,
  );
  root.style.setProperty("--default-transition-duration", theme.transition);
  const colorRoles =
    resolvedMode === "dark" && !isCustomColor
      ? theme.colorRoles || {}
      : {
          onPrimary: getReadableTextColor(accent),
          onSurface: isCustomColor
            ? getReadableTextColor(background)
            : palette.foreground,
          outline: `color-mix(in srgb, ${accent} 34%, transparent)`,
          primaryContainer: secondary,
          surface: background,
          surfaceContainer: secondary,
          surfaceContainerHigh: secondary,
        };
  root.style.setProperty("--theme-primary", accent);
  root.style.setProperty(
    "--theme-on-primary",
    colorRoles.onPrimary || "#ffffff",
  );
  root.style.setProperty("--theme-surface", colorRoles.surface || background);
  root.style.setProperty(
    "--theme-surface-container",
    colorRoles.surfaceContainer || secondary,
  );
  root.style.setProperty(
    "--theme-surface-container-high",
    colorRoles.surfaceContainerHigh || secondary,
  );
  root.style.setProperty(
    "--theme-on-surface",
    colorRoles.onSurface || getReadableTextColor(background),
  );
  root.style.setProperty(
    "--theme-outline",
    colorRoles.outline || `color-mix(in srgb, ${accent} 28%, transparent)`,
  );
  root.style.setProperty(
    "--theme-primary-container",
    colorRoles.primaryContainer || secondary,
  );
  root.style.colorScheme = root.dataset.munetiosThemeMode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", background);
}

function clampGradientAngle(value) {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return 135;
  return Math.min(360, Math.max(0, Math.round(angle)));
}

function updateViewportBehavior(enabled) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) return () => undefined;

  const setDeviceViewport = () => {
    viewport.setAttribute(
      "content",
      "width=device-width, initial-scale=1, user-scalable=yes",
    );
  };

  if (!enabled) {
    setDeviceViewport();
    return () => undefined;
  }

  let lastWidth = 0;
  const syncResponsiveViewport = () => {
    const visibleWidth =
      enabled && window.visualViewport
        ? window.visualViewport.width
        : window.innerWidth;
    const width = Math.max(320, Math.round(visibleWidth));
    if (Math.abs(width - lastWidth) < 2) return;
    lastWidth = width;
    viewport.setAttribute(
      "content",
      `width=${width}, initial-scale=1, user-scalable=yes`,
    );
    window.dispatchEvent(new Event("resize"));
  };

  syncResponsiveViewport();
  window.addEventListener("orientationchange", syncResponsiveViewport);
  window.visualViewport?.addEventListener("resize", syncResponsiveViewport);
  return () => {
    window.removeEventListener("orientationchange", syncResponsiveViewport);
    window.visualViewport?.removeEventListener(
      "resize",
      syncResponsiveViewport,
    );
    setDeviceViewport();
  };
}

export default function AppearanceRuntime() {
  const localChangeRef = useRef(false);

  useEffect(() => {
    const refreshDeveloperCss = (event) =>
      applyDeveloperCss(event?.detail || loadDeveloperSettings());
    refreshDeveloperCss();
    window.addEventListener(developerSettingsChangeEvent, refreshDeveloperCss);
    let viewportCleanup = () => undefined;
    let mediaQueryRefreshFrame = 0;
    let currentTextSize = appearanceDefaults.textSize;
    const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: light)");
    const reducedMotionMedia = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const refresh = (event) => {
      const settings = event?.detail || loadAppearanceSettings();
      applyAppearanceSettings(settings);
      currentTextSize = settings.textSize;
      applyResponsiveMediaQueryScale(currentTextSize);
      viewportCleanup();
      viewportCleanup = updateViewportBehavior(
        Boolean(settings.resizeViewportOnPinch),
      );
    };

    const localSettings = loadAppearanceSettings();
    refresh({ detail: localSettings });
    const loadAccountAppearance = async () => {
      try {
        const response = await fetch(appearanceSyncUrl, {
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;

        const payload = await response.json();
        if (localChangeRef.current) return;

        if (payload?.appearance && typeof payload.appearance === "object") {
          const syncedSettings = {
            ...appearanceDefaults,
            ...payload.appearance,
          };
          saveAppearanceSettings(syncedSettings);
          refresh({ detail: syncedSettings });
          window.dispatchEvent(
            new CustomEvent("munetios:appearance-sync", {
              detail: syncedSettings,
            }),
          );
          return;
        }

        void syncAppearanceSettings(localSettings);
      } catch {
        // The local settings already applied above are the offline fallback.
      }
    };
    void loadAccountAppearance();
    const refreshResponsiveMediaQueries = () => {
      window.cancelAnimationFrame(mediaQueryRefreshFrame);
      mediaQueryRefreshFrame = window.requestAnimationFrame(() => {
        applyResponsiveMediaQueryScale(currentTextSize);
      });
    };
    const refreshResponsiveViewportDimensions = () => {
      applyResponsiveViewportDimensions(currentTextSize);
    };
    const stylesheetObserver = new MutationObserver(
      refreshResponsiveMediaQueries,
    );
    stylesheetObserver.observe(document.head, {
      childList: true,
      subtree: true,
    });
    document.addEventListener("load", refreshResponsiveMediaQueries, true);
    window.addEventListener("resize", refreshResponsiveViewportDimensions);
    window.visualViewport?.addEventListener(
      "resize",
      refreshResponsiveViewportDimensions,
    );
    const refreshSystemTheme = () => {
      const settings = loadAppearanceSettings();
      if (settings.themeMode === "system") refresh({ detail: settings });
    };
    colorSchemeMedia.addEventListener("change", refreshSystemTheme);
    const handleAppearanceChange = (event) => {
      localChangeRef.current = true;
      const settings = event?.detail || loadAppearanceSettings();
      saveAppearanceSettings(settings);
      refresh({ detail: settings });
      void syncAppearanceSettings(settings);
    };
    window.addEventListener(
      "munetios:appearance-change",
      handleAppearanceChange,
    );
    const handleMaterialPress = (event) => {
      const target = event.target?.closest?.(
        "button:not(:disabled), a[href], [role='button']:not([aria-disabled='true'])",
      );
      if (!target || reducedMotionMedia.matches) return;
      const rect = target.getBoundingClientRect();
      const originX = `${event.clientX - rect.left}px`;
      const originY = `${event.clientY - rect.top}px`;
      target.animate(
        [
          {
            backgroundImage: `radial-gradient(circle at ${originX} ${originY}, rgb(255 255 255 / 24%) 0, transparent 0)`,
            transform: "scale(1)",
          },
          {
            backgroundImage: `radial-gradient(circle at ${originX} ${originY}, rgb(255 255 255 / 15%) 38%, transparent 70%)`,
            transform: "scale(0.975)",
          },
          {
            backgroundImage: `radial-gradient(circle at ${originX} ${originY}, transparent 70%)`,
            transform: "scale(1)",
          },
        ],
        {
          duration: 420,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        },
      );
    };
    document.addEventListener("pointerdown", handleMaterialPress);
    return () => {
      window.removeEventListener(
        developerSettingsChangeEvent,
        refreshDeveloperCss,
      );
      window.cancelAnimationFrame(mediaQueryRefreshFrame);
      stylesheetObserver.disconnect();
      document.removeEventListener("load", refreshResponsiveMediaQueries, true);
      window.removeEventListener("resize", refreshResponsiveViewportDimensions);
      window.visualViewport?.removeEventListener(
        "resize",
        refreshResponsiveViewportDimensions,
      );
      restoreResponsiveMediaQueries();
      viewportCleanup();
      colorSchemeMedia.removeEventListener("change", refreshSystemTheme);
      window.removeEventListener(
        "munetios:appearance-change",
        handleAppearanceChange,
      );
      document.removeEventListener("pointerdown", handleMaterialPress);
    };
  }, []);

  return null;
}
