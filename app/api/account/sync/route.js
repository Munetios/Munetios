import { requireAuth } from "../../../../auth.js";
import { getAccountData, setAccountData } from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";

const appearanceStore =
  globalThis.__munetiosAccountAppearanceStore || new Map();
const appearanceThemes = new Set([
  "munetios-default",
  "google-material-design",
  "carbon",
  "light-mode",
  "microsoft-fluent",
  "blueish",
  "dymatic",
  "classic",
  "high-contrast-dark",
  "yellowish",
]);
const appearanceModes = new Set(["system", "light", "dark", "custom"]);
const backgroundModes = new Set(["gradient", "solid"]);
const fontFamilies = new Set(["theme-font", "system-ui"]);
const hexColor = /^#[\da-f]{6}$/i;

globalThis.__munetiosAccountAppearanceStore = appearanceStore;

function jsonResponse(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function normalizeColor(value, fallback) {
  return typeof value === "string" && hexColor.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

function normalizeColors(value, maximum) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((color) => normalizeColor(color, null))
        .filter(Boolean)
        .slice(0, maximum),
    ),
  );
}

function normalizeAppearance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const fontFamily =
    typeof value.fontFamily === "string" && value.fontFamily.length <= 160
      ? value.fontFamily.trim()
      : "theme-font";

  return {
    accentColor: normalizeColor(value.accentColor, "#a855f7"),
    backgroundColor: normalizeColor(value.backgroundColor, "#150627"),
    backgroundColorSecondary: normalizeColor(
      value.backgroundColorSecondary,
      "#31164f",
    ),
    backgroundMode: backgroundModes.has(value.backgroundMode)
      ? value.backgroundMode
      : "gradient",
    customColors: normalizeColors(value.customColors, 36),
    fontFamily: fontFamilies.has(fontFamily)
      ? fontFamily
      : fontFamily || "theme-font",
    gradientAngle: Math.min(
      360,
      Math.max(0, Math.round(Number(value.gradientAngle) || 135)),
    ),
    gradientColors: normalizeColors(value.gradientColors, 12),
    reduceMotion: Boolean(value.reduceMotion),
    reduceTransparency: Boolean(value.reduceTransparency),
    resizeViewportOnPinch: Boolean(value.resizeViewportOnPinch),
    ss01: value.ss01 !== false,
    ss08: value.ss08 !== false,
    theme: appearanceThemes.has(value.theme) ? value.theme : "munetios-default",
    themeMode: appearanceModes.has(value.themeMode)
      ? value.themeMode
      : "system",
  };
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;

  return jsonResponse({
    appearance: session.demo
      ? appearanceStore.get(session.user.id) || null
      : getAccountData(session.user.id, "appearance", null),
  });
}

export async function PATCH(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_payload", message: "Appearance settings are invalid." },
      { status: 400 },
    );
  }

  const appearance = normalizeAppearance(payload?.appearance);
  if (!appearance) {
    return jsonResponse(
      {
        error: "invalid_appearance",
        message: "Appearance settings are invalid.",
      },
      { status: 400 },
    );
  }

  if (session.demo) {
    appearanceStore.set(session.user.id, appearance);
  } else {
    setAccountData(session.user.id, "appearance", appearance);
  }
  return jsonResponse({ appearance, saved: true });
}
