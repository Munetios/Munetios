import { requireAuth } from "../../../../auth.js";
import { getAccountData, setAccountData } from "../../../lib/authSecurity.js";
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
const allowedThemes = new Set(["account-default", "system", "light", "dark"]);
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
  "image-generation",
  "plugins",
  "study-quizzes",
  "web-search",
]);
const hexColor = /^#[\da-f]{6}$/i;
const unsafeInstructionPattern =
  /\b(bypass|jailbreak|ignore (all|any|previous|prior) (rules|instructions)|disable safety|unsafe tools?|evade safeguards?|override system)\b/i;

const defaults = {
  accentColor: "#a855f7",
  additionalInstructions: "",
  automaticThinking: true,
  bubbleRoundness: 24,
  chatFont: "account-default",
  chatFontSize: 16,
  customization: true,
  customIntroductions: "",
  extendedRequests: false,
  lineHeight: 1.55,
  location: false,
  memory: true,
  memories: [],
  moreAboutYou: "",
  nickname: "",
  pinnedTools: [],
  rememberChatHistory: true,
  selectedModel: "munet-1-instant",
  textColor: "#f7f2ff",
  theme: "account-default",
  tone: "balanced",
  traits: "",
  voiceInputComposer: true,
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

  const customIntroductions = text(value.customIntroductions, 1200);
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

  return {
    accentColor: hexColor.test(value.accentColor)
      ? value.accentColor.toLowerCase()
      : defaults.accentColor,
    additionalInstructions,
    automaticThinking: value.automaticThinking !== false,
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
    customization: value.customization !== false,
    customIntroductions,
    extendedRequests: Boolean(value.extendedRequests),
    lineHeight: Math.min(
      2.2,
      Math.max(1.1, Number(value.lineHeight) || defaults.lineHeight),
    ),
    location: Boolean(value.location),
    memory: value.memory !== false,
    memories,
    moreAboutYou: text(value.moreAboutYou, 1200),
    nickname: text(value.nickname, 80),
    pinnedTools: Array.isArray(value.pinnedTools)
      ? [...new Set(value.pinnedTools)]
          .filter((tool) => allowedPinnedTools.has(tool))
          .slice(0, allowedPinnedTools.size)
      : [],
    rememberChatHistory: value.rememberChatHistory !== false,
    selectedModel: allowedModels.has(value.selectedModel)
      ? value.selectedModel
      : defaults.selectedModel,
    textColor: hexColor.test(value.textColor)
      ? value.textColor.toLowerCase()
      : defaults.textColor,
    theme: allowedThemes.has(value.theme) ? value.theme : defaults.theme,
    tone: allowedTones.has(value.tone) ? value.tone : defaults.tone,
    traits: text(value.traits, 500),
    voiceInputComposer: value.voiceInputComposer !== false,
  };
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "ai");
  if (policyResponse) return policyResponse;

  const saved = session.demo
    ? globalThis.__munetiosAiSettingsStore?.get(session.user.id)
    : getAccountData(session.user.id, "ai-settings", null);

  return jsonResponse({ settings: { ...defaults, ...(saved || {}) } });
}

export async function PATCH(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_payload" }, { status: 400 });
  }

  const settings = normalizeSettings(payload?.settings);
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
