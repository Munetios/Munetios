import { requireAuth } from "../../../../auth.js";
import { getAccountData, setAccountData } from "../../../lib/authSecurity.js";
import { getEducationProfile } from "../../../lib/education.js";
import { enforceParentalAiAccess } from "../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

const allowedFonts = new Set([
  "account-default",
  "Google Sans Flex",
  "Google Sans",
  "Inter",
  "Roboto",
  "Poppins",
  "Open Sans",
  "system-ui",
]);
const allowedTones = new Set([
  "balanced",
  "concise",
  "friendly",
  "professional",
  "creative",
]);
const allowedModels = new Set([
  "munet-1-instant",
  "munet-1-mini",
  "munet-1-thinking",
  "munet-1-pro",
  "munet-1-advanced-plus",
  "munet-1-code-advanced-plus",
]);
const allowedPinnedTools = new Set([
  "agent",
  "attach-files",
  "canvas",
  "deep-research",
  "draw-sketch",
  "image",
  "image-generation",
  "plugins",
  "study-quizzes",
  "web-search",
]);
const allowedForYouCards = new Set([
  "canvas-idea",
  "connectors",
  "create-image",
  "history",
  "research",
  "study",
  "tasks",
  "workspace",
]);
const allowedVoiceModeTypes = new Set(["prompt", "fullscreen", "wrapper"]);
const allowedVoiceModeVersions = new Set(["new", "classic"]);
const voiceModeVoicePattern = /^(?:auto|speech:[A-Za-z0-9_.!~*'()%+-]{1,360})$/;
const hexColor = /^#[\da-f]{6}$/i;
const unsafeInstructionPattern =
  /\b(bypass|jailbreak|ignore (all|any|previous|prior) (rules|instructions)|disable safety|unsafe tools?|evade safeguards?|override system)\b/i;

const defaults = {
  accentColor: "#a855f7",
  additionalInstructions: "",
  agentApprovalMode: "always-ask",
  automaticImageGeneration: true,
  autoDeleteChatHistory: "never",
  automaticThinking: true,
  automaticWebSearch: true,
  backgroundColor: "#090220",
  botProfile: {
    developer: "",
    facebook: "",
    github: "",
    instagram: "",
    website: "",
    youtube: "",
  },
  bubbleRoundness: 24,
  chatFont: "account-default",
  chatFontSize: 16,
  compactMode: false,
  country: "auto",
  customization: true,
  customIntroductions: "",
  developerMode: false,
  extendedRequests: false,
  fastAnswers: false,
  forYouSuggestions: true,
  hiddenForYouCards: [],
  lineHeight: 1.55,
  listsAndHeaders: true,
  liquidGlassBlur: 3,
  location: false,
  memory: true,
  memories: [],
  moreAboutYou: "",
  mobileResizeViewport: false,
  emojis: true,
  nickname: "",
  pinnedTools: [],
  rememberChatHistory: true,
  privacyPersonalization: true,
  reduceMotion: false,
  selectedModel: "munet-1-instant",
  textColor: "#f7f2ff",
  theme: "system",
  tone: "balanced",
  traits: "",
  uiFont: "Google Sans Flex",
  voiceInputComposer: true,
  voiceModePitch: 1,
  voiceModeSpeed: 1,
  voiceModeType: "prompt",
  voiceModeVersion: "new",
  voiceModeVoice: "auto",
};

function jsonResponse(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function text(value, maximum = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const customIntroductions = text(value.customIntroductions, 10000);
  const additionalInstructions = text(value.additionalInstructions, 2400);
  const memories = Array.isArray(value.memories)
    ? value.memories
        .slice(0, 100)
        .map((memory) => ({
          createdAt: text(memory?.createdAt, 40) || new Date().toISOString(),
          id: text(memory?.id, 80) || crypto.randomUUID(),
          text: text(memory?.text, 500),
        }))
        .filter((memory) => memory.text)
    : [];
  if (
    unsafeInstructionPattern.test(customIntroductions) ||
    unsafeInstructionPattern.test(additionalInstructions) ||
    memories.some((memory) => unsafeInstructionPattern.test(memory.text))
  ) {
    return { error: "unsafe_instructions" };
  }

  const voiceModeVersion = allowedVoiceModeVersions.has(value.voiceModeVersion)
    ? value.voiceModeVersion
    : defaults.voiceModeVersion;
  const requestedVoiceModeType = allowedVoiceModeTypes.has(value.voiceModeType)
    ? value.voiceModeType
    : defaults.voiceModeType;
  return {
    accentColor: hexColor.test(value.accentColor)
      ? value.accentColor.toLowerCase()
      : defaults.accentColor,
    additionalInstructions,
    agentApprovalMode: ["always-ask", "low-risk", "everything"].includes(
      value.agentApprovalMode,
    )
      ? value.agentApprovalMode
      : defaults.agentApprovalMode,
    automaticImageGeneration: value.automaticImageGeneration !== false,
    autoDeleteChatHistory: [
      "never",
      "7-days",
      "30-days",
      "90-days",
      "1-year",
    ].includes(value.autoDeleteChatHistory)
      ? value.autoDeleteChatHistory
      : defaults.autoDeleteChatHistory,
    automaticThinking: value.automaticThinking !== false,
    automaticWebSearch: value.automaticWebSearch !== false,
    backgroundColor: hexColor.test(value.backgroundColor)
      ? value.backgroundColor.toLowerCase()
      : defaults.backgroundColor,
    botProfile: Object.fromEntries(
      [
        "developer",
        "facebook",
        "github",
        "instagram",
        "website",
        "youtube",
      ].map((field) => [field, text(value.botProfile?.[field], 300)]),
    ),
    bubbleRoundness: Math.min(
      40,
      Math.max(0, Number(value.bubbleRoundness) || defaults.bubbleRoundness),
    ),
    chatFont: allowedFonts.has(value.chatFont)
      ? value.chatFont
      : defaults.chatFont,
    chatFontSize: Math.min(
      24,
      Math.max(12, Number(value.chatFontSize) || defaults.chatFontSize),
    ),
    compactMode: Boolean(value.compactMode),
    country: /^(?:auto|[A-Z]{2})$/u.test(value.country)
      ? value.country
      : defaults.country,
    customization: value.customization !== false,
    customIntroductions,
    developerMode: Boolean(value.developerMode),
    extendedRequests: Boolean(value.extendedRequests),
    fastAnswers: Boolean(value.fastAnswers),
    forYouSuggestions: value.forYouSuggestions !== false,
    hiddenForYouCards: Array.isArray(value.hiddenForYouCards)
      ? [...new Set(value.hiddenForYouCards)]
          .filter((cardId) => allowedForYouCards.has(cardId))
          .slice(0, allowedForYouCards.size)
      : [],
    lineHeight: Math.min(
      2.2,
      Math.max(1.1, Number(value.lineHeight) || defaults.lineHeight),
    ),
    listsAndHeaders: value.listsAndHeaders !== false,
    liquidGlassBlur: Math.min(
      3,
      Math.max(0, Number(value.liquidGlassBlur) || 0),
    ),
    location: Boolean(value.location),
    memory: value.memory !== false,
    memories,
    moreAboutYou: text(value.moreAboutYou, 1200),
    mobileResizeViewport: Boolean(value.mobileResizeViewport),
    emojis: value.emojis !== false,
    nickname: text(value.nickname, 80),
    pinnedTools: Array.isArray(value.pinnedTools)
      ? [...new Set(value.pinnedTools)]
          .filter((tool) => allowedPinnedTools.has(tool))
          .slice(0, allowedPinnedTools.size)
      : [],
    rememberChatHistory: value.rememberChatHistory !== false,
    privacyPersonalization: value.privacyPersonalization !== false,
    reduceMotion: Boolean(value.reduceMotion),
    selectedModel: allowedModels.has(value.selectedModel)
      ? value.selectedModel
      : defaults.selectedModel,
    textColor: hexColor.test(value.textColor)
      ? value.textColor.toLowerCase()
      : defaults.textColor,
    theme: ["system", "light", "dark"].includes(value.theme)
      ? value.theme
      : defaults.theme,
    tone: allowedTones.has(value.tone) ? value.tone : defaults.tone,
    traits: text(value.traits, 500),
    uiFont: allowedFonts.has(value.uiFont) ? value.uiFont : defaults.uiFont,
    voiceInputComposer: value.voiceInputComposer !== false,
    voiceModePitch: Math.min(
      2,
      Math.max(0.5, Number(value.voiceModePitch) || 1),
    ),
    voiceModeSpeed: Math.min(
      2,
      Math.max(0.5, Number(value.voiceModeSpeed) || 1),
    ),
    voiceModeType:
      voiceModeVersion === "classic" && requestedVoiceModeType === "prompt"
        ? "fullscreen"
        : requestedVoiceModeType,
    voiceModeVersion,
    voiceModeVoice: voiceModeVoicePattern.test(value.voiceModeVoice)
      ? value.voiceModeVoice.slice(0, 367)
      : defaults.voiceModeVoice,
  };
}

function applyEducationSettings(settings, session) {
  const education = getEducationProfile(session?.user?.id);
  if (!education) return settings;
  const next = { ...settings, developerMode: false };
  if (education.role === "student") {
    return {
      ...next,
      agentApprovalMode: defaults.agentApprovalMode,
      automaticImageGeneration: false,
      forYouSuggestions: false,
      location: false,
      memories: [],
      memory: false,
      pinnedTools: next.pinnedTools.filter(
        (tool) => !["agent", "image", "image-generation"].includes(tool),
      ),
    };
  }
  return next;
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "ai");
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;

  const saved = session.demo
    ? globalThis.__munetiosAiSettingsStore?.get(session.user.id)
    : getAccountData(session.user.id, "ai-settings", null);
  const settings = applyEducationSettings(
    { ...defaults, ...(saved || {}) },
    session,
  );
  if (!voiceModeVoicePattern.test(settings.voiceModeVoice)) {
    settings.voiceModeVoice = defaults.voiceModeVoice;
  }

  return jsonResponse({ settings });
}

export async function PATCH(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_payload" }, { status: 400 });
  }

  const normalizedSettings = normalizeSettings(payload?.settings);
  const settings =
    !normalizedSettings || normalizedSettings.error
      ? normalizedSettings
      : applyEducationSettings(normalizedSettings, session);
  if (!settings || settings.error) {
    return jsonResponse(
      { error: settings?.error || "invalid_settings" },
      { status: 400 },
    );
  }

  if (session.demo) {
    globalThis.__munetiosAiSettingsStore ||= new Map();
    globalThis.__munetiosAiSettingsStore.set(session.user.id, settings);
  } else {
    setAccountData(session.user.id, "ai-settings", settings);
  }

  return jsonResponse({ saved: true, settings });
}
