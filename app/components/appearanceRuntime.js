"use client";

import { useEffect, useRef } from "react";

export const appearanceStorageKey = "munetios.appearance";
const appearanceSyncUrl = "/api/account/sync";

export const appearanceDefaults = {
  accentColor: "#a855f7",
  backgroundColor: "#150627",
  backgroundColorSecondary: "#31164f",
  backgroundMode: "gradient",
  customColors: [],
  fontFamily: "theme-font",
  gradientAngle: 135,
  gradientColors: [],
  reduceMotion: false,
  reduceTransparency: false,
  resizeViewportOnPinch: false,
  ss01: true,
  ss08: true,
  theme: "munetios-default",
  themeMode: "system",
};

export const appearanceThemes = [
  {
    accent: "#a855f7",
    background: "#150627",
    backgroundSecondary: "#31164f",
    font: '"Google Sans Flex", "Google Sans", system-ui, sans-serif',
    foreground: "#f7f2ff",
    glass: true,
    hoverY: "-2px",
    id: "munetios-default",
    labelKey: "accountThemeMunetiosDefault",
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
    accent: "#6d28d9",
    background: "#f8f7fb",
    backgroundSecondary: "#e9e5f2",
    font: '"Google Sans Flex", system-ui, sans-serif',
    foreground: "#17121f",
    glass: true,
    hoverY: "-1px",
    id: "light-mode",
    labelKey: "accountThemeLightMode",
    lightOnly: true,
    radius: "18px",
    spacing: "0.26rem",
    transition: "180ms",
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
  "light-mode": {
    background: "#f8f7fb",
    backgroundSecondary: "#e9e5f2",
    foreground: "#17121f",
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

const darkThemePaletteOverrides = {
  "light-mode": {
    background: "#18151f",
    backgroundSecondary: "#292431",
    foreground: "#f8f7fb",
  },
};

function normalizeHex(value, fallback) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^#[\da-f]{6}$/i.test(normalized)
    ? normalized.toLowerCase()
    : fallback;
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
    return {
      ...appearanceDefaults,
      ...JSON.parse(window.localStorage.getItem(appearanceStorageKey) || "{}"),
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
  root.style.setProperty("--font-ss01", resolved.ss01 ? "1" : "0");
  root.style.setProperty("--font-ss08", resolved.ss08 ? "1" : "0");
  root.style.setProperty("--theme-radius", theme.radius);
  root.style.setProperty(
    "--theme-container-radius",
    theme.containerRadius || theme.radius,
  );
  root.style.setProperty("--theme-spacing-unit", theme.spacing);
  root.style.setProperty("--theme-transition", theme.transition);
  root.style.setProperty("--theme-hover-y", theme.hoverY);
  root.style.setProperty("--spinner-primary", accent);
  root.style.setProperty("--spinner-secondary", secondary);
  root.style.setProperty("--spacing", theme.spacing);
  root.style.setProperty(
    "--radius-sm",
    `max(0px, calc(${theme.radius} - 10px))`,
  );
  root.style.setProperty(
    "--radius-md",
    `max(0px, calc(${theme.radius} - 6px))`,
  );
  root.style.setProperty(
    "--radius-lg",
    `max(0px, calc(${theme.radius} - 2px))`,
  );
  root.style.setProperty("--radius-xl", theme.radius);
  root.style.setProperty("--radius-2xl", `calc(${theme.radius} + 4px)`);
  root.style.setProperty("--radius-3xl", `calc(${theme.radius} + 8px)`);
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

  if (!enabled || !window.visualViewport) {
    setDeviceViewport();
    return () => undefined;
  }

  let lastWidth = 0;
  const syncVisualViewport = () => {
    const width = Math.max(320, Math.round(window.visualViewport.width));
    if (Math.abs(width - lastWidth) < 2) return;
    lastWidth = width;
    viewport.setAttribute(
      "content",
      `width=${width}, initial-scale=1, user-scalable=yes`,
    );
    window.dispatchEvent(new Event("resize"));
  };

  window.visualViewport.addEventListener("resize", syncVisualViewport);
  return () => {
    window.visualViewport.removeEventListener("resize", syncVisualViewport);
    setDeviceViewport();
  };
}

export default function AppearanceRuntime() {
  const localChangeRef = useRef(false);

  useEffect(() => {
    let viewportCleanup = () => undefined;
    const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: light)");
    const refresh = (event) => {
      const settings = event?.detail || loadAppearanceSettings();
      applyAppearanceSettings(settings);
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
    return () => {
      viewportCleanup();
      colorSchemeMedia.removeEventListener("change", refreshSystemTheme);
      window.removeEventListener(
        "munetios:appearance-change",
        handleAppearanceChange,
      );
    };
  }, []);

  return null;
}
