import { auth, hasAccountSessionCookie } from "../../auth.js";
import { meetEmojiSet } from "../apps/meet/lib/meetEmojis.js";
import { getAccountData, getRequestFingerprint } from "../lib/authSecurity.js";
import { enforceStudentAiAccess } from "../lib/education.js";
import {
  activityForPeer,
  isValidAnagramCreatorWord,
  isValidWordHuntBoard,
  meetActivityTypes,
  parseWordHuntCustomWords,
} from "../lib/meetActivities.js";
import {
  authenticateRealtimePeer,
  banRealtimePeer,
  createRealtimeChatMessage,
  createRealtimeRoom,
  editRealtimeChatMessage,
  endRealtimeActivity,
  hydrateRealtimeDatabase,
  isRealtimeRoomOwner,
  joinRealtimeActivity,
  joinRealtimeRoom,
  kickRealtimePeer,
  leaveRealtimeRoom,
  persistRealtimeDatabase,
  pollRealtimeEvents,
  publishRealtimeSignal,
  refreshRealtimeDatabaseFromDurable,
  rejoinRealtimeRoom,
  resumeRealtimeRoom,
  startRealtimeActivity,
  toggleRealtimeChatReaction,
  touchRealtimePeer,
  updateRealtimeActivity,
  updateRealtimePeerState,
  updateRealtimePeerStatus,
} from "../lib/realtimeDatabase.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const services = new Set(["meet", "ai-voice"]);
const signalKinds = new Set(["offer", "answer", "ice-candidate"]);
const roomIdPattern = /^[A-Za-z0-9_-]{8,64}$/;
const chatImagePattern =
  /^data:image\/(?:gif|jpeg|png|webp);base64,[a-z\d+/=\s]+$/i;
const encryptedChatPattern = /^e2ee1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/;
const rateLimits = globalThis.__munetiosRealtimeRateLimits || new Map();
globalThis.__munetiosRealtimeRateLimits = rateLimits;
const realtimeRequestState = globalThis.__munetiosRealtimeRequestState || {
  queue: Promise.resolve(),
};
globalThis.__munetiosRealtimeRequestState = realtimeRequestState;

function respond(payload, status = 200, additionalHeaders = {}) {
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
    status,
  });
}

function normalizedText(value, maximum) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maximum ? text : null;
}

function userIdentity(session) {
  const userId = session?.user?.id || session?.user?.email;
  if (!userId) return null;
  const storedProfile = session.demo
    ? globalThis.__munetiosAccountProfileStore?.get(userId) || {}
    : getAccountData(userId, "profile", {});
  const displayName =
    storedProfile.name ||
    session.user.name ||
    session.user.displayName ||
    session.user.email ||
    "Munetios user";
  const profilePictureUrl = Object.hasOwn(storedProfile, "profilePictureUrl")
    ? storedProfile.profilePictureUrl
    : session.user.profilePictureUrl;
  return {
    displayName,
    avatarUrl:
      profilePictureUrl || session.user.avatarUrl || session.user.image || null,
    userId,
  };
}

function guestIdentity(nickname, fingerprint) {
  const displayName = normalizedText(nickname, 80);
  return displayName
    ? {
        avatarUrl: null,
        displayName,
        userId: `guest:${fingerprint}`,
      }
    : null;
}

function allowRequest(userId) {
  const now = Date.now();
  const current = (rateLimits.get(userId) || []).filter(
    (time) => now - time < 10_000,
  );
  if (current.length >= 120) return false;
  current.push(now);
  rateLimits.set(userId, current);
  return true;
}

function unauthorized(request) {
  return respond({ error: "unauthorized" }, 401, {
    "X-Munetios-Auth-State": hasAccountSessionCookie(request)
      ? "invalid-session"
      : "guest",
  });
}

function credentials(payload) {
  return {
    peerId: normalizedText(payload?.peerId, 64),
    peerToken: normalizedText(payload?.peerToken, 128),
    roomId: normalizedText(payload?.roomId, 64),
  };
}

async function authenticatePeer(authFields) {
  if (!authFields.peerId || !authFields.peerToken || !authFields.roomId) {
    return false;
  }
  if (authenticateRealtimePeer(authFields)) return true;
  if (!(await refreshRealtimeDatabaseFromDurable())) return false;
  return Boolean(authenticateRealtimePeer(authFields));
}

async function handleGET(request) {
  const url = new URL(request.url);
  const authFields = credentials(Object.fromEntries(url.searchParams));
  if (!(await authenticatePeer(authFields))) {
    return respond({ error: "invalid_peer_credentials" }, 403);
  }
  if (!allowRequest(authFields.peerId)) {
    return respond({ error: "rate_limited" }, 429);
  }
  const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
  return respond({
    ...pollRealtimeEvents({
      after,
      peerId: authFields.peerId,
      roomId: authFields.roomId,
    }),
    realtime: true,
  });
}

async function handlePOST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond({ error: "invalid_json" }, 400);
  }

  if (
    payload?.action === "create" ||
    payload?.action === "join" ||
    payload?.action === "rejoin" ||
    payload?.action === "resume"
  ) {
    const session = await auth(request);
    const sessionIdentity = userIdentity(session);
    const requestFingerprint = getRequestFingerprint(request);
    const identity =
      sessionIdentity || guestIdentity(payload.nickname, requestFingerprint);
    if (!identity) return unauthorized(request);
    const rateLimitKey =
      sessionIdentity?.userId || `guest:${requestFingerprint}`;
    if (!allowRequest(rateLimitKey)) {
      return respond({ error: "rate_limited" }, 429);
    }

    if (payload.action === "create") {
      const service = normalizedText(payload.service, 24);
      if (!services.has(service)) {
        return respond({ error: "invalid_service" }, 400);
      }
      if (service === "ai-voice") {
        const educationResponse = enforceStudentAiAccess(session);
        if (educationResponse) return educationResponse;
      }
      return respond(
        createRealtimeRoom({
          avatarUrl: identity.avatarUrl,
          displayName: identity.displayName,
          service,
          userId: identity.userId,
        }),
        201,
      );
    }

    const roomId = normalizedText(payload.roomId, 64);
    if (!roomId || !roomIdPattern.test(roomId)) {
      return respond({ error: "invalid_room" }, 400);
    }
    if (payload.action === "resume") {
      const peerId = normalizedText(payload.peerId, 64);
      const peerToken = normalizedText(payload.peerToken, 128);
      const resumed =
        peerId && peerToken
          ? resumeRealtimeRoom({
              peerId,
              peerToken,
              roomId,
              userId: identity.userId,
            })
          : null;
      return resumed
        ? respond(resumed)
        : respond({ error: "resume_failed" }, 409);
    }
    const joined =
      payload.action === "rejoin"
        ? rejoinRealtimeRoom({
            avatarUrl: identity.avatarUrl,
            displayName: identity.displayName,
            roomId,
            userId: identity.userId,
          })
        : joinRealtimeRoom({
            avatarUrl: identity.avatarUrl,
            displayName: identity.displayName,
            roomId,
            userId: identity.userId,
          });
    if (!joined) return respond({ error: "room_not_found" }, 404);
    if (joined.banned) return respond({ error: "banned" }, 403);
    if (joined.full) return respond({ error: "room_full" }, 409);
    return respond(joined, 201);
  }

  const authFields = credentials(payload);
  if (!(await authenticatePeer(authFields))) {
    return respond({ error: "invalid_peer_credentials" }, 403);
  }
  if (!allowRequest(authFields.peerId)) {
    return respond({ error: "rate_limited" }, 429);
  }

  if (payload.action === "heartbeat") {
    touchRealtimePeer(authFields.peerId);
    return respond({ active: true });
  }
  if (payload.action === "leave") {
    leaveRealtimeRoom(authFields);
    return respond({ left: true });
  }
  if (payload.action === "media-state") {
    const state = payload.state;
    if (
      !state ||
      typeof state.microphoneOn !== "boolean" ||
      typeof state.cameraOn !== "boolean" ||
      typeof state.screenSharing !== "boolean" ||
      (state.recordingOn !== undefined &&
        typeof state.recordingOn !== "boolean")
    ) {
      return respond({ error: "invalid_media_state" }, 400);
    }
    return updateRealtimePeerState({
      ...authFields,
      cameraOn: state.cameraOn,
      microphoneOn: state.microphoneOn,
      recordingOn: state.recordingOn === true,
      screenSharing: state.screenSharing,
    })
      ? respond({ updated: true })
      : respond({ error: "peer_not_found" }, 404);
  }
  if (payload.action === "profile-status") {
    const emoji = payload.emoji === "" ? "" : normalizedText(payload.emoji, 32);
    if (emoji === null || (emoji && !meetEmojiSet.has(emoji))) {
      return respond({ error: "invalid_status" }, 400);
    }
    return updateRealtimePeerStatus({ ...authFields, emoji })
      ? respond({ emoji, updated: true })
      : respond({ error: "peer_not_found" }, 404);
  }
  if (payload.action === "chat-send") {
    const submittedBody =
      typeof payload.body === "string" ? payload.body.trim() : "";
    const encrypted = encryptedChatPattern.test(submittedBody);
    const body = encrypted ? submittedBody : submittedBody.slice(0, 4000);
    const imageUrl =
      typeof payload.imageUrl === "string" ? payload.imageUrl.trim() : "";
    if (
      (!body && !imageUrl) ||
      (encrypted && body.length > 10_000_000) ||
      (imageUrl &&
        (!chatImagePattern.test(imageUrl) || imageUrl.length > 7_000_000))
    ) {
      return respond({ error: "invalid_chat_message" }, 400);
    }
    const message = createRealtimeChatMessage({
      ...authFields,
      body,
      imageUrl: imageUrl || null,
    });
    return message
      ? respond({ message }, 201)
      : respond({ error: "peer_not_found" }, 404);
  }
  if (payload.action === "chat-edit") {
    const messageId = normalizedText(payload.messageId, 64);
    const submittedBody =
      typeof payload.body === "string" ? payload.body.trim() : "";
    const encrypted = encryptedChatPattern.test(submittedBody);
    const body = encrypted
      ? submittedBody.length <= 10_000_000
        ? submittedBody
        : null
      : normalizedText(submittedBody, 4000);
    if (!messageId || !body) {
      return respond({ error: "invalid_chat_message" }, 400);
    }
    return editRealtimeChatMessage({
      ...authFields,
      body,
      messageId,
    })
      ? respond({ edited: true })
      : respond({ error: "message_not_found" }, 404);
  }
  if (payload.action === "chat-react") {
    const messageId = normalizedText(payload.messageId, 64);
    const emoji = normalizedText(payload.emoji, 32);
    if (!messageId || !emoji || !meetEmojiSet.has(emoji)) {
      return respond({ error: "invalid_reaction" }, 400);
    }
    const active = toggleRealtimeChatReaction({
      ...authFields,
      emoji,
      messageId,
    });
    return active === null
      ? respond({ error: "message_not_found" }, 404)
      : respond({ active });
  }
  if (payload.action === "activity-start") {
    const type = normalizedText(payload.type, 24);
    if (!meetActivityTypes.has(type)) {
      return respond({ error: "invalid_activity" }, 400);
    }
    const creatorWord =
      type === "anagrams" && payload.creatorWord
        ? normalizedText(payload.creatorWord, 12)
        : "";
    if (creatorWord && !isValidAnagramCreatorWord(creatorWord)) {
      return respond({ error: "activity_invalid_word" }, 400);
    }
    const boardSize = type === "wordhunt" ? Number(payload.boardSize) : null;
    const customBoardText =
      type === "wordhunt" ? normalizedText(payload.customBoard, 49) || "" : "";
    const customBoard = customBoardText.replace(/[^a-z]/giu, "");
    const customWords =
      type === "wordhunt"
        ? parseWordHuntCustomWords(payload.customWords || "")
        : [];
    if (
      type === "wordhunt" &&
      (!new Set([4, 5, 6, 7]).has(boardSize) ||
        (customBoard && !isValidWordHuntBoard(customBoard, boardSize)) ||
        !customWords)
    ) {
      return respond({ error: "activity_invalid_board" }, 400);
    }
    const activity = startRealtimeActivity({
      ...authFields,
      allowOthers: payload.allowOthers !== false,
      boardSize,
      cheats: {
        aiPlaysWordHunt: payload.cheats?.aiPlaysWordHunt === true,
        allowAnyAnagramWord: payload.cheats?.allowAnyAnagramWord === true,
        alwaysShowAllWords: payload.cheats?.alwaysShowAllWords === true,
        customChessRules: payload.cheats?.customChessRules === true,
        enabled: payload.cheats?.enabled === true,
        ignoreChessMoveRules: payload.cheats?.ignoreChessMoveRules === true,
        ignoreDictionary: payload.cheats?.ignoreDictionary === true,
        shareFoundWords: payload.cheats?.shareFoundWords === true,
      },
      creatorWord,
      customBoard,
      customWords,
      durationSeconds: payload.durationSeconds,
      type,
    });
    return activity
      ? respond({ activity: activityForPeer(activity, authFields.peerId) }, 201)
      : respond({ error: "peer_not_found" }, 404);
  }
  if (payload.action === "activity-join") {
    const result = joinRealtimeActivity(authFields);
    return result.error
      ? respond({ error: result.error }, 409)
      : respond({
          ...result,
          activity: activityForPeer(result.activity, authFields.peerId),
        });
  }
  if (payload.action === "activity-update") {
    const serialized = JSON.stringify(payload.activityPayload || {});
    if (serialized.length > 4000) {
      return respond({ error: "invalid_activity_update" }, 400);
    }
    const result = updateRealtimeActivity({
      ...authFields,
      payload: payload.activityPayload || {},
    });
    return result.error
      ? respond({ error: result.error }, 409)
      : respond({
          ...result,
          activity: activityForPeer(result.activity, authFields.peerId),
        });
  }
  if (payload.action === "activity-end") {
    const result = endRealtimeActivity(authFields);
    return result.error
      ? respond(
          { error: result.error },
          result.error === "activity_owner_required" ? 403 : 404,
        )
      : respond({
          ...result,
          activity: activityForPeer(result.activity, authFields.peerId),
        });
  }
  if (payload.action === "signal") {
    const kind = normalizedText(payload.kind, 32);
    const toPeerId = normalizedText(payload.toPeerId, 64);
    const serialized = JSON.stringify(payload.payload ?? null);
    if (!signalKinds.has(kind) || !toPeerId || serialized.length > 256_000) {
      return respond({ error: "invalid_signal" }, 400);
    }
    const eventId = publishRealtimeSignal({
      fromPeerId: authFields.peerId,
      kind,
      payload: payload.payload ?? null,
      roomId: authFields.roomId,
      toPeerId,
    });
    return eventId
      ? respond({ accepted: true, eventId }, 202)
      : respond({ error: "peer_not_found" }, 404);
  }
  if (payload.action === "kick") {
    const targetPeerId = normalizedText(payload.targetPeerId, 64);
    if (!targetPeerId) return respond({ error: "invalid_peer" }, 400);
    if (!isRealtimeRoomOwner(authFields)) {
      return respond({ error: "owner_required" }, 403);
    }
    return kickRealtimePeer({ ...authFields, targetPeerId })
      ? respond({ kicked: true })
      : respond({ error: "peer_not_found" }, 404);
  }
  if (payload.action === "ban") {
    const targetPeerId = normalizedText(payload.targetPeerId, 64);
    if (!targetPeerId) return respond({ error: "invalid_peer" }, 400);
    if (!isRealtimeRoomOwner(authFields)) {
      return respond({ error: "owner_required" }, 403);
    }
    return banRealtimePeer({ ...authFields, targetPeerId })
      ? respond({ banned: true })
      : respond({ error: "peer_not_found" }, 404);
  }

  return respond({ error: "invalid_action" }, 400);
}

function runRealtimeRequest(handler, persistChanges) {
  const run = realtimeRequestState.queue.then(async () => {
    await refreshRealtimeDatabaseFromDurable();
    await hydrateRealtimeDatabase();
    try {
      return await handler();
    } finally {
      if (persistChanges) await persistRealtimeDatabase();
    }
  });
  realtimeRequestState.queue = run.catch(() => undefined);
  return run;
}

export function GET(request) {
  return runRealtimeRequest(() => handleGET(request), false);
}

export function POST(request) {
  return runRealtimeRequest(() => handlePOST(request), true);
}

async function handleDELETE(request) {
  const url = new URL(request.url);
  const authFields = credentials(Object.fromEntries(url.searchParams));
  if (!(await authenticatePeer(authFields))) {
    return respond({ error: "invalid_peer_credentials" }, 403);
  }
  leaveRealtimeRoom(authFields);
  return respond({ left: true });
}

export function DELETE(request) {
  return runRealtimeRequest(() => handleDELETE(request), true);
}
