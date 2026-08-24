import { auth } from "../../../auth.js";
import {
  assertSameOrigin,
  getAccountData,
  normalizeEmail,
  setAccountData,
} from "../../lib/authSecurity.js";
import { enforceOrganizationAppAccess } from "../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

const settingsKey = "meet-settings-v1";
const historyKey = "meet-history-v1";
const defaultSettings = {
  activityCheatsEnabled: false,
  activitiesSound: true,
  aiPlaysWordHunt: false,
  allowAnyAnagramWord: false,
  allowOthersJoinActivity: true,
  alwaysShowAllActivityWords: false,
  blockedEmails: [],
  blockedPeople: [],
  contactsOnly: false,
  customChessRules: false,
  desktopNotifications: true,
  leaveWhenAlone: false,
  ignoreActivityDictionary: false,
  ignoreChessMoveRules: false,
  noiseCancellation: true,
  recordingEncodingChunks: "default",
  recordingQuality: "medium",
  shareFoundActivityWords: false,
  ttsVoice: "",
  useActivities: true,
  wordHuntCustomWords: "",
};

function normalizeWordHuntCustomWords(value) {
  const words = String(value || "")
    .split(/[\s,;]+/u)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z]{2,49}$/u.test(word));
  return [...new Set(words)].join("\n");
}

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function normalizeSettings(value = {}) {
  return {
    activityCheatsEnabled: Boolean(value.activityCheatsEnabled),
    activitiesSound: value.activitiesSound !== false,
    aiPlaysWordHunt: Boolean(value.aiPlaysWordHunt),
    allowAnyAnagramWord: Boolean(value.allowAnyAnagramWord),
    allowOthersJoinActivity: value.allowOthersJoinActivity !== false,
    alwaysShowAllActivityWords: Boolean(value.alwaysShowAllActivityWords),
    blockedEmails: Array.isArray(value.blockedEmails)
      ? [
          ...new Set(
            value.blockedEmails
              .map(normalizeEmail)
              .filter(Boolean)
              .slice(0, 100),
          ),
        ]
      : [],
    blockedPeople: Array.isArray(value.blockedPeople)
      ? value.blockedPeople
          .filter((person) => person && typeof person === "object")
          .map((person) => ({
            avatarUrl:
              typeof person.avatarUrl === "string"
                ? person.avatarUrl.slice(0, 1000)
                : null,
            blockedAt: String(person.blockedAt || new Date().toISOString()),
            id: String(person.id || "").slice(0, 200),
            name: String(person.name || "")
              .trim()
              .slice(0, 100),
          }))
          .filter((person) => person.id && person.name)
          .filter(
            (person, index, people) =>
              people.findIndex((item) => item.id === person.id) === index,
          )
          .slice(0, 100)
      : [],
    contactsOnly: Boolean(value.contactsOnly),
    customChessRules: Boolean(value.customChessRules),
    desktopNotifications: value.desktopNotifications !== false,
    leaveWhenAlone: Boolean(value.leaveWhenAlone),
    ignoreActivityDictionary: Boolean(value.ignoreActivityDictionary),
    ignoreChessMoveRules: Boolean(value.ignoreChessMoveRules),
    noiseCancellation: value.noiseCancellation !== false,
    recordingEncodingChunks: ["default", "high", "medium", "low"].includes(
      value.recordingEncodingChunks,
    )
      ? value.recordingEncodingChunks
      : "default",
    recordingQuality: [
      "lowest",
      "lower",
      "medium",
      "higher",
      "highest",
    ].includes(value.recordingQuality)
      ? value.recordingQuality
      : "medium",
    shareFoundActivityWords: Boolean(value.shareFoundActivityWords),
    ttsVoice:
      typeof value.ttsVoice === "string" ? value.ttsVoice.slice(0, 300) : "",
    useActivities: value.useActivities !== false,
    wordHuntCustomWords: normalizeWordHuntCustomWords(
      value.wordHuntCustomWords,
    ),
  };
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .slice(0, 100)
    .map((entry) => ({
      durationSeconds: Math.max(0, Number(entry.durationSeconds) || 0),
      id: String(entry.id || crypto.randomUUID()).slice(0, 200),
      joinedAt: String(entry.joinedAt || new Date().toISOString()),
      meetingId: String(entry.meetingId || "").slice(0, 200),
      title: String(entry.title || "Munetios Meet").slice(0, 160),
    }));
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return response({
      authenticated: false,
      history: [],
      settings: defaultSettings,
    });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "meet");
  if (policyResponse) return policyResponse;
  return response({
    authenticated: true,
    history: normalizeHistory(getAccountData(session.user.id, historyKey, [])),
    settings: normalizeSettings(
      getAccountData(session.user.id, settingsKey, defaultSettings),
    ),
  });
}

export async function PATCH(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "meet", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const payload = await request.json().catch(() => ({}));
  const settings = normalizeSettings(payload.settings);
  setAccountData(session.user.id, settingsKey, settings);
  return response({ settings });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "meet", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const payload = await request.json().catch(() => ({}));
  if (payload.action === "block_person") {
    const id = String(payload.person?.id || "").slice(0, 200);
    const name = String(payload.person?.name || "")
      .trim()
      .slice(0, 100);
    if (!id || !name) {
      return response({ error: "invalid_person" }, { status: 400 });
    }
    const currentSettings = normalizeSettings(
      getAccountData(session.user.id, settingsKey, defaultSettings),
    );
    const settings = normalizeSettings({
      ...currentSettings,
      blockedPeople: [
        {
          avatarUrl:
            typeof payload.person.avatarUrl === "string"
              ? payload.person.avatarUrl
              : null,
          blockedAt: new Date().toISOString(),
          id,
          name,
        },
        ...currentSettings.blockedPeople.filter((person) => person.id !== id),
      ],
    });
    setAccountData(session.user.id, settingsKey, settings);
    return response({ settings }, { status: 201 });
  }
  if (payload.action !== "record_history") {
    return response({ error: "invalid_action" }, { status: 400 });
  }
  const current = normalizeHistory(
    getAccountData(session.user.id, historyKey, []),
  );
  const [entry] = normalizeHistory([
    {
      durationSeconds: payload.durationSeconds,
      id: crypto.randomUUID(),
      joinedAt: payload.joinedAt,
      meetingId: payload.meetingId,
      title: payload.title,
    },
  ]);
  const history = [entry, ...current].slice(0, 100);
  setAccountData(session.user.id, historyKey, history);
  return response({ entry, history }, { status: 201 });
}
