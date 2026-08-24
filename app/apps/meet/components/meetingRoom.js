"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AccountAvatar from "../../../components/accountAvatar";
import DropdownWrapper from "../../../components/dropdownwrapper";
import LoadingSpinner from "../../../components/loadingSpinner";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { meetEmojiCategories } from "../lib/meetEmojis";
import MeetActivitiesPanel, { MeetActivityTile } from "./meetActivitiesPanel";
import MeetChatPanel from "./meetChatPanel";
import {
  meetSoundEffects,
  playAnagramScore,
  prepareMeetAudio,
} from "./meetSounds";
import { openMeetSettingsModal } from "./settingsModal";

const rtcConfiguration = {
  bundlePolicy: "max-bundle",
  iceCandidatePoolSize: 10,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
const localMeetDevicesKey = "munetios.meet.devices";
const localMeetSettingsKey = "munetios.meet.settings";
const activeMeetingStorageKey = "munetios.meet.activeMeeting";
const meetingSecretsStorageKey = "munetios.meet.secrets";
const recentMeetToasts = new Map();
const meetRecordingMp4Types = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1.42001E,mp4a.40.2",
  "video/mp4;codecs=h264,aac",
  "video/mp4",
];
const recordingQualityProfiles = {
  highest: {
    audioBitrate: 256_000,
    frameRate: 60,
    height: 2160,
    videoBitrate: 20_000_000,
    width: 3840,
  },
  higher: {
    audioBitrate: 192_000,
    frameRate: 30,
    height: 1080,
    videoBitrate: 9_000_000,
    width: 1920,
  },
  lower: {
    audioBitrate: 128_000,
    frameRate: 24,
    height: 540,
    videoBitrate: 2_500_000,
    width: 960,
  },
  lowest: {
    audioBitrate: 96_000,
    frameRate: 15,
    height: 360,
    videoBitrate: 1_000_000,
    width: 640,
  },
  medium: {
    audioBitrate: 160_000,
    frameRate: 30,
    height: 720,
    videoBitrate: 5_000_000,
    width: 1280,
  },
};
const recordingChunkIntervals = {
  default: 2,
  high: 1,
  low: 8,
  medium: 4,
};

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function canControlBackgroundBlur(track) {
  try {
    const values = track?.getCapabilities?.().backgroundBlur;
    return (
      Array.isArray(values) && values.includes(true) && values.includes(false)
    );
  } catch {
    return false;
  }
}

async function applyBackgroundBlur(track, enabled) {
  if (!canControlBackgroundBlur(track)) return false;
  await track.applyConstraints({
    ...track.getConstraints(),
    backgroundBlur: { exact: enabled },
  });
  return track.getSettings().backgroundBlur === enabled;
}

function getEncodedEncryptionKey(value) {
  const key = String(value || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return "";
  return `${key.replaceAll("-", "+").replaceAll("_", "/")}=`;
}

function encodeBinary(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBinary(value) {
  const normalized = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) =>
    character.charCodeAt(0),
  );
}

async function encryptMeetingContent(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ iv, name: "AES-GCM" }, key, plaintext),
  );
  return `e2ee1.${encodeBinary(iv)}.${encodeBinary(ciphertext)}`;
}

async function decryptMeetingContent(key, value) {
  if (!String(value || "").startsWith("e2ee1.")) return null;
  const [, encodedIv, encodedCiphertext] = value.split(".");
  const plaintext = await crypto.subtle.decrypt(
    { iv: decodeBinary(encodedIv), name: "AES-GCM" },
    key,
    decodeBinary(encodedCiphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function deriveNumericMeetingSecret(roomId) {
  const material = new TextEncoder().encode(
    `munetios-meet-numeric-room:${roomId}`,
  );
  return encodeBinary(
    new Uint8Array(await crypto.subtle.digest("SHA-256", material)),
  );
}

function readLocalJson(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

async function loadMeetPreferences(signedIn) {
  if (!signedIn) return readLocalJson(localMeetSettingsKey);
  const response = await fetch("/api/meet", {
    cache: "no-store",
    credentials: "include",
  }).catch(() => null);
  if (!response?.ok) return {};
  const payload = await response.json().catch(() => ({}));
  return payload.settings || {};
}

function createMicrophoneConstraints(noiseCancellation = true) {
  const devices = readLocalJson(localMeetDevicesKey);
  return {
    autoGainControl: true,
    ...(devices.microphone ? { deviceId: { exact: devices.microphone } } : {}),
    echoCancellation: true,
    noiseSuppression: noiseCancellation,
    voiceIsolation: noiseCancellation,
  };
}

function showMeetToast(key, message, type = "error") {
  const now = Date.now();
  if (!message || now - (recentMeetToasts.get(key) || 0) < 4500) return;
  recentMeetToasts.set(key, now);
  showToast({
    message,
    toastId: `meet-${key}`,
    type,
  });
}

function playSound(name) {
  return meetSoundEffects[name]().catch(() => {});
}

function credentialsPayload(credentials) {
  return {
    peerId: credentials.peerId,
    peerToken: credentials.peerToken,
    roomId: credentials.roomId,
  };
}

function getMeetGuestId() {
  const storageKey = "munetios.meet.guestId";
  let guestId = window.localStorage.getItem(storageKey) || "";
  if (!/^[A-Za-z0-9_-]{16,80}$/u.test(guestId)) {
    guestId = crypto.randomUUID().replaceAll("-", "");
    window.localStorage.setItem(storageKey, guestId);
  }
  return guestId;
}

async function realtimePost(payload) {
  const requestPayload = ["create", "join", "rejoin", "resume"].includes(
    payload?.action,
  )
    ? { ...payload, guestId: getMeetGuestId() }
    : payload;
  const response = await fetch("/api/realtime", {
    body: JSON.stringify(requestPayload),
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "realtime_request_failed");
    error.status = response.status;
    throw error;
  }
  return body;
}

function showModerationConfirmation({
  cancelLabel,
  confirmLabel,
  description,
  onConfirm,
  title,
}) {
  showModal(
    ({ close }) => (
      <div className="grid gap-4">
        <p className="m-0 text-sm leading-6 text-white/75">{description}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="min-h-10 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-bold text-white transition hover:bg-white/10"
            onClick={close}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="min-h-10 rounded-full border border-red-200/20 bg-red-600/50 px-4 text-sm font-bold text-white transition hover:bg-red-600/40"
            onClick={() => {
              close();
              void onConfirm();
            }}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    ),
    { ariaLabel: title, title, width: "min(28rem, calc(100vw - 1.5rem))" },
  );
}

function RemoteVideo({ cameraVisible, screenSharing, stream }) {
  const audioRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !video) return;
    const playRemoteMedia = () => {
      void audio.play().catch(() => {
        // Browsers can require another page gesture after a permission prompt.
      });
      void video.play().catch(() => {
        // Muted remote video should autoplay, but retry after a page gesture
        // for browsers that pause media while a permission prompt is open.
      });
    };
    const attachRemoteTracks = () => {
      audio.srcObject = stream
        ? new MediaStream(stream.getAudioTracks())
        : null;
      video.srcObject =
        stream && (cameraVisible || screenSharing)
          ? new MediaStream(stream.getVideoTracks())
          : null;
      playRemoteMedia();
    };
    attachRemoteTracks();
    if (!stream) return;

    const resumeRemoteMedia = () => playRemoteMedia();
    stream.addEventListener("addtrack", attachRemoteTracks);
    stream.addEventListener("removetrack", attachRemoteTracks);
    audio.addEventListener("loadedmetadata", playRemoteMedia);
    video.addEventListener("loadedmetadata", playRemoteMedia);
    window.addEventListener("click", resumeRemoteMedia);
    window.addEventListener("pointerdown", resumeRemoteMedia);
    window.addEventListener("keydown", resumeRemoteMedia);
    playRemoteMedia();

    return () => {
      stream.removeEventListener("addtrack", attachRemoteTracks);
      stream.removeEventListener("removetrack", attachRemoteTracks);
      audio.removeEventListener("loadedmetadata", playRemoteMedia);
      video.removeEventListener("loadedmetadata", playRemoteMedia);
      window.removeEventListener("click", resumeRemoteMedia);
      window.removeEventListener("pointerdown", resumeRemoteMedia);
      window.removeEventListener("keydown", resumeRemoteMedia);
      audio.srcObject = null;
      video.srcObject = null;
    };
  }, [cameraVisible, screenSharing, stream]);

  return (
    <>
      <video
        aria-hidden={!cameraVisible}
        autoPlay
        className={`meet-remote-video${cameraVisible ? " is-visible" : ""}`}
        muted
        playsInline
        ref={videoRef}
      />
      {/* biome-ignore lint/a11y/useMediaCaption: WebRTC is a live call without a prerecorded caption track. */}
      <audio autoPlay ref={audioRef} />
    </>
  );
}

function ParticipantTile({
  actions = null,
  copy,
  focused,
  local = false,
  localCameraOn,
  localCameraStream,
  localScreenSharing = false,
  localScreenStream,
  participant,
}) {
  const localCameraVideoRef = useRef(null);
  const localScreenVideoRef = useRef(null);
  const [preferredLocalMedia, setPreferredLocalMedia] = useState("screen");
  const localCameraVisible = Boolean(
    localCameraOn &&
      localCameraStream
        ?.getVideoTracks()
        .some((track) => track.enabled && track.readyState === "live"),
  );
  const localScreenVisible = Boolean(
    localScreenSharing &&
      localScreenStream
        ?.getVideoTracks()
        .some((track) => track.readyState === "live"),
  );
  const remoteVideoTrackVisible = Boolean(
    participant.stream
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && !track.muted),
  );
  const hasPublishedRemoteVideoState =
    typeof participant.cameraOn === "boolean" &&
    typeof participant.screenSharing === "boolean";
  const cameraVisible = local
    ? localCameraVisible || localScreenVisible
    : remoteVideoTrackVisible &&
      (hasPublishedRemoteVideoState
        ? participant.cameraOn || participant.screenSharing
        : participant.cameraVisible);
  const account = {
    avatarUrl: participant.avatarUrl,
    name: participant.displayName,
  };
  const isScreenSharing = local
    ? localScreenSharing
    : Boolean(participant.screenSharing);
  const hasDualLocalMedia = localCameraVisible && localScreenVisible;
  const primaryLocalMedia = hasDualLocalMedia
    ? preferredLocalMedia
    : localScreenVisible
      ? "screen"
      : "camera";

  useEffect(() => {
    const video = localCameraVideoRef.current;
    if (!video) return;
    video.srcObject = localCameraVisible ? localCameraStream : null;
    if (localCameraVisible) void video.play().catch(() => {});
  }, [localCameraStream, localCameraVisible]);

  useEffect(() => {
    const video = localScreenVideoRef.current;
    if (!video) return;
    video.srcObject = localScreenVisible ? localScreenStream : null;
    if (localScreenVisible) void video.play().catch(() => {});
  }, [localScreenStream, localScreenVisible]);

  useEffect(() => {
    if (localScreenSharing) setPreferredLocalMedia("screen");
  }, [localScreenSharing]);

  return (
    <article
      className={`meet-participant-tile${focused ? " is-focused" : ""}`}
      data-camera={cameraVisible ? "on" : "off"}
      data-screen-sharing={isScreenSharing}
    >
      {local
        ? <div
            className="meet-local-media-stack"
            data-dual-media={hasDualLocalMedia}
            data-primary-media={primaryLocalMedia}
          >
            {localScreenVisible
              ? <button
                  aria-label={copy.meetShareScreen}
                  className={`meet-local-media-view meet-local-screen-view ${
                    primaryLocalMedia === "screen"
                      ? "is-primary"
                      : "is-floating"
                  }`}
                  onClick={() => setPreferredLocalMedia("screen")}
                  type="button"
                >
                  <video
                    autoPlay
                    className="is-visible"
                    muted
                    playsInline
                    ref={localScreenVideoRef}
                  />
                </button>
              : null}
            {localCameraVisible
              ? <button
                  aria-label={copy.meetCamera}
                  className={`meet-local-media-view meet-local-camera-view ${
                    primaryLocalMedia === "camera"
                      ? "is-primary"
                      : "is-floating"
                  }`}
                  onClick={() => setPreferredLocalMedia("camera")}
                  type="button"
                >
                  <video
                    autoPlay
                    className="is-visible"
                    muted
                    playsInline
                    ref={localCameraVideoRef}
                  />
                </button>
              : null}
          </div>
        : <RemoteVideo
            cameraVisible={cameraVisible}
            screenSharing={isScreenSharing}
            stream={participant.stream}
          />}
      {!cameraVisible
        ? <div className="meet-participant-avatar">
            <AccountAvatar
              account={account}
              alt={participant.displayName}
              className="meet-participant-avatar-image"
            />
          </div>
        : null}
      {participant.statusEmoji
        ? <span
            aria-label={`${copy.meetProfileStatus}: ${participant.statusEmoji}`}
            className="meet-participant-status liquid-glass"
            role="img"
          >
            {participant.statusEmoji}
          </span>
        : null}
      {actions
        ? <div className="meet-participant-actions">{actions}</div>
        : null}
      <footer className="meet-participant-label liquid-glass">
        <span>{local ? copy.meetYou : participant.displayName}</span>
        {participant.microphoneOn === false || participant.microphoneOff
          ? <icon
              aria-label={copy.meetMicrophoneOff}
              className="meet-microphone-off-icon"
            >
              mic_off
            </icon>
          : null}
      </footer>
    </article>
  );
}

function MeetStatusPicker({ copy, onClose, onSelect, selectedEmoji }) {
  const [categoryId, setCategoryId] = useState("hearts");
  const category =
    meetEmojiCategories.find((entry) => entry.id === categoryId) ||
    meetEmojiCategories[0];
  return (
    <aside
      aria-label={copy.meetProfileStatus}
      className="meet-status-picker liquid-glass"
    >
      <header>
        <strong>{copy.meetProfileStatus}</strong>
        <button aria-label={copy.close} onClick={onClose} type="button">
          <icon className="meet-status-picker-icon">close</icon>
        </button>
      </header>
      <nav aria-label={copy.meetProfileStatus}>
        {meetEmojiCategories.map((entry) => (
          <button
            aria-label={copy[entry.labelKey]}
            className={entry.id === category.id ? "is-active" : ""}
            key={entry.id}
            onClick={() => setCategoryId(entry.id)}
            title={copy[entry.labelKey]}
            type="button"
          >
            <icon className="meet-status-picker-icon">{entry.icon}</icon>
          </button>
        ))}
      </nav>
      <div className="meet-status-emoji-grid">
        {category.emojis.map((emoji) => (
          <button
            aria-label={emoji}
            className={emoji === selectedEmoji ? "is-active" : ""}
            key={emoji}
            onClick={() => onSelect(emoji)}
            type="button"
          >
            {emoji}
          </button>
        ))}
      </div>
      {selectedEmoji
        ? <button
            className="meet-status-clear"
            onClick={() => onSelect("")}
            type="button"
          >
            {copy.meetClearStatus}
          </button>
        : null}
    </aside>
  );
}

export default function MeetingRoom({ copy, onLeave, request, signedIn }) {
  const [activity, setActivity] = useState(null);
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [activitiesSound, setActivitiesSound] = useState(true);
  const [allowOthersJoinActivity, setAllowOthersJoinActivity] = useState(true);
  const [backgroundBlurAvailable, setBackgroundBlurAvailable] = useState(false);
  const [backgroundBlurEnabled, setBackgroundBlurEnabled] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(600);
  const [chatUnread, setChatUnread] = useState(0);
  const [copied, setCopied] = useState(false);
  const [focusedPeerId, setFocusedPeerId] = useState("");
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [leaveWhenAlone, setLeaveWhenAlone] = useState(false);
  const [liveTranscriptionAvailable, setLiveTranscriptionAvailable] =
    useState(false);
  const [liveTranscriptionEnabled, setLiveTranscriptionEnabled] =
    useState(false);
  const [liveTranscriptionFinal, setLiveTranscriptionFinal] = useState("");
  const [liveTranscriptionInterim, setLiveTranscriptionInterim] = useState("");
  const [localCameraPreviewStream, setLocalCameraPreviewStream] =
    useState(null);
  const [localIdentity, setLocalIdentity] = useState(null);
  const [localScreenPreviewStream, setLocalScreenPreviewStream] =
    useState(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [microphoneOn, setMicrophoneOn] = useState(false);
  const [mutedPeerIds, setMutedPeerIds] = useState(() => new Set());
  const [participants, setParticipants] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recordingSaving, setRecordingSaving] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [statusEmoji, setStatusEmoji] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [startAttempt, setStartAttempt] = useState(0);
  const [ttsVoice, setTtsVoice] = useState("");
  const copyRef = useRef(copy);
  const backgroundBlurPreferenceRef = useRef(null);
  const captionClearTimerRef = useRef(null);
  const activityRef = useRef(null);
  const activitiesSoundRef = useRef(true);
  const e2eeCryptoKeyRef = useRef(null);
  const e2eeKeyRef = useRef(String(request.e2eeKey || ""));
  const chatInitializedRef = useRef(false);
  const chatOpenRef = useRef(false);
  const chatMessageIdsRef = useRef(new Set());
  const blockedPeerIdsRef = useRef(new Set());
  const friendsLoadFailedRef = useRef(false);
  const friendsOpenRef = useRef(false);
  const aloneLeaveTimerRef = useRef(null);
  const credentialsRef = useRef(null);
  const cursorRef = useRef(0);
  const leftRef = useRef(false);
  const localStreamRef = useRef(null);
  const mediaStateRevisionRef = useRef(0);
  const mutedPeerIdsRef = useRef(new Set());
  const noiseCancellationRef = useRef(true);
  const recordingEncodingChunksRef = useRef("default");
  const recordingQualityRef = useRef("medium");
  const mediaStateRef = useRef({
    cameraOn: false,
    microphoneOn: false,
    recordingOn: false,
    screenSharing: false,
  });
  const metadataRef = useRef(new Map());
  const peerConnectionsRef = useRef(new Map());
  const pollBusyRef = useRef(false);
  const pollTimerRef = useRef(null);
  const roomExpiryTimerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingStartedAtRef = useRef(0);
  const recordingRoomIdRef = useRef("meeting");
  const speechRecognitionRef = useRef(null);
  const screenAudioTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const startedAtRef = useRef(Date.now());
  const transcriptionEnabledRef = useRef(false);
  const transcriptionRestartTimerRef = useRef(null);
  const leaveMeetingRef = useRef(null);
  copyRef.current = copy;
  activityRef.current = activity;
  chatOpenRef.current = chatOpen;
  friendsOpenRef.current = friendsOpen;

  useEffect(() => {
    setLiveTranscriptionAvailable(Boolean(getSpeechRecognitionConstructor()));
  }, []);

  const syncBackgroundBlurForTrack = useCallback(async (track) => {
    const available = canControlBackgroundBlur(track);
    setBackgroundBlurAvailable(available);
    if (!available) {
      setBackgroundBlurEnabled(false);
      return;
    }

    const preferred = backgroundBlurPreferenceRef.current;
    if (typeof preferred === "boolean") {
      try {
        await applyBackgroundBlur(track, preferred);
      } catch {
        // Keep the actual camera setting when the device rejects the preference.
      }
    }
    const enabled = track.getSettings().backgroundBlur === true;
    backgroundBlurPreferenceRef.current = enabled;
    setBackgroundBlurEnabled(enabled);
  }, []);

  const getMeetingCryptoKey = useCallback(() => {
    const rawKey = getEncodedEncryptionKey(e2eeKeyRef.current);
    if (!rawKey) return null;
    e2eeCryptoKeyRef.current ||= crypto.subtle.importKey(
      "raw",
      Uint8Array.from(atob(rawKey), (character) => character.charCodeAt(0)),
      { name: "AES-GCM" },
      false,
      ["decrypt", "encrypt"],
    );
    return e2eeCryptoKeyRef.current;
  }, []);

  const updateChatMessages = useCallback(
    async (messages) => {
      const cryptoKey = getMeetingCryptoKey();
      const normalized = await Promise.all(
        (Array.isArray(messages) ? messages : []).map(async (message) => {
          if (!cryptoKey || !message.body?.startsWith("e2ee1.")) return message;
          try {
            const decrypted = await decryptMeetingContent(
              await cryptoKey,
              message.body,
            );
            return {
              ...message,
              body: String(decrypted?.body || ""),
              imageUrl:
                typeof decrypted?.imageUrl === "string"
                  ? decrypted.imageUrl
                  : null,
            };
          } catch {
            return { ...message, body: "", imageUrl: null };
          }
        }),
      );
      const nextIds = new Set(normalized.map((message) => message.id));
      if (chatInitializedRef.current) {
        const incoming = normalized.filter(
          (message) =>
            !chatMessageIdsRef.current.has(message.id) &&
            message.peerId !== credentialsRef.current?.peerId,
        );
        if (incoming.length) {
          void playSound("message");
          if (!chatOpenRef.current) {
            setChatUnread((current) => current + incoming.length);
          }
        }
      }
      chatInitializedRef.current = true;
      chatMessageIdsRef.current = nextIds;
      setChatMessages(normalized);
    },
    [getMeetingCryptoKey],
  );

  const updateParticipant = useCallback((peerId, changes) => {
    setParticipants((current) => {
      const existing = current.find((item) => item.peerId === peerId);
      const metadata = metadataRef.current.get(peerId) || {};
      const next = {
        avatarUrl: null,
        cameraVisible: false,
        displayName: copyRef.current.meetParticipant,
        microphoneOff: false,
        peerId,
        ...metadata,
        ...existing,
        ...changes,
      };
      return existing
        ? current.map((item) => (item.peerId === peerId ? next : item))
        : [...current, next];
    });
  }, []);

  const sendSignal = useCallback(async (toPeerId, kind, payload) => {
    const credentials = credentialsRef.current;
    if (!credentials || leftRef.current) return;
    await realtimePost({
      action: "signal",
      ...credentialsPayload(credentials),
      kind,
      payload,
      toPeerId,
    });
  }, []);

  const negotiatePeerConnection = useCallback(
    async (peerId, connection) => {
      if (!connection || connection.connectionState === "closed") return;
      if (
        !connection.munetiosInitialInitiator &&
        !connection.remoteDescription
      ) {
        connection.munetiosNegotiationPending = true;
        return;
      }
      if (
        connection.munetiosMakingOffer ||
        connection.signalingState !== "stable"
      ) {
        connection.munetiosNegotiationPending = true;
        return;
      }

      connection.munetiosMakingOffer = true;
      connection.munetiosNegotiationPending = false;
      try {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        await sendSignal(peerId, "offer", connection.localDescription);
      } catch {
        void playSound("error");
        showMeetToast(
          "connection-failed",
          copyRef.current.meetSomethingWentWrongToast,
        );
      } finally {
        connection.munetiosMakingOffer = false;
      }
    },
    [sendSignal],
  );

  const renegotiatePeerConnections = useCallback(async () => {
    await Promise.all(
      [...peerConnectionsRef.current].map(([peerId, connection]) => {
        if (connection.munetiosInitialInitiator) {
          return negotiatePeerConnection(peerId, connection);
        }
        return sendSignal(peerId, "offer", {
          munetiosRenegotiateRequest: true,
        });
      }),
    );
  }, [negotiatePeerConnection, sendSignal]);

  const publishMediaState = useCallback((changes = {}) => {
    const state = { ...mediaStateRef.current, ...changes };
    mediaStateRef.current = state;
    const credentials = credentialsRef.current;
    if (!credentials || leftRef.current) return;
    const revision = ++mediaStateRevisionRef.current;
    const publish = async (attempt = 0) => {
      try {
        await realtimePost({
          action: "media-state",
          ...credentialsPayload(credentials),
          state,
        });
      } catch {
        if (
          attempt < 2 &&
          revision === mediaStateRevisionRef.current &&
          !leftRef.current
        ) {
          window.setTimeout(
            () => void publish(attempt + 1),
            350 * (attempt + 1),
          );
        }
      }
    };
    void publish();
  }, []);

  const createPeerConnection = useCallback(
    (peerId, initiator = false) => {
      const existing = peerConnectionsRef.current.get(peerId);
      if (existing) return existing;

      const connection = new RTCPeerConnection(rtcConfiguration);
      const remoteStream = new MediaStream();
      const stream = localStreamRef.current;
      const audioTrack = stream?.getAudioTracks()[0] || null;
      const videoTrack =
        screenTrackRef.current ||
        (mediaStateRef.current.cameraOn
          ? stream?.getVideoTracks()[0] || null
          : null);
      const screenAudioTrack = screenAudioTrackRef.current;
      const audioTransceiver = connection.addTransceiver("audio", {
        direction: "sendrecv",
      });
      const videoTransceiver = connection.addTransceiver("video", {
        direction: "sendrecv",
      });
      const screenAudioTransceiver = connection.addTransceiver("audio", {
        direction: "sendrecv",
      });
      if (audioTrack) void audioTransceiver.sender.replaceTrack(audioTrack);
      if (videoTrack) void videoTransceiver.sender.replaceTrack(videoTrack);
      if (screenAudioTrack) {
        void screenAudioTransceiver.sender.replaceTrack(screenAudioTrack);
      }
      connection.munetiosAudioTransceiver = audioTransceiver;
      connection.munetiosAudioSender = audioTransceiver.sender;
      connection.munetiosInitialInitiator = initiator;
      connection.munetiosIceRestartTimer = null;
      connection.munetiosMakingOffer = false;
      connection.munetiosNegotiationPending = false;
      connection.munetiosPendingCandidates = [];
      connection.munetiosRemoteStream = remoteStream;
      connection.munetiosScreenAudioSender = screenAudioTransceiver.sender;
      connection.munetiosScreenAudioTransceiver = screenAudioTransceiver;
      connection.munetiosVideoTransceiver = videoTransceiver;
      connection.munetiosVideoSender = videoTransceiver.sender;

      connection.onicecandidate = (event) => {
        if (event.candidate) {
          void sendSignal(peerId, "ice-candidate", event.candidate.toJSON());
        }
      };
      connection.ontrack = (event) => {
        const track = event.track;
        if (track.kind === "audio") {
          track.enabled = !mutedPeerIdsRef.current.has(peerId);
        }
        if (!remoteStream.getTracks().some((item) => item.id === track.id)) {
          remoteStream.addTrack(track);
        }
        const refreshTrackState = () => {
          updateParticipant(peerId, {
            cameraVisible: remoteStream
              .getVideoTracks()
              .some((track) => track.readyState === "live" && !track.muted),
            microphoneOff: remoteStream
              .getAudioTracks()
              .every((track) => track.muted || track.readyState !== "live"),
            stream: remoteStream,
          });
        };
        event.track.onmute = refreshTrackState;
        event.track.onunmute = refreshTrackState;
        event.track.onended = () => {
          if (remoteStream.getTracks().some((item) => item.id === track.id)) {
            remoteStream.removeTrack(track);
          }
          refreshTrackState();
        };
        refreshTrackState();
      };
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === "failed") {
          if (connection.munetiosInitialInitiator) {
            connection.restartIce();
            void negotiatePeerConnection(peerId, connection);
          }
          void playSound("error");
          showMeetToast(
            "connection-failed",
            copyRef.current.meetSomethingWentWrongToast,
          );
        }
      };
      connection.oniceconnectionstatechange = () => {
        if (
          connection.iceConnectionState === "connected" ||
          connection.iceConnectionState === "completed"
        ) {
          window.clearTimeout(connection.munetiosIceRestartTimer);
          connection.munetiosIceRestartTimer = null;
          return;
        }
        if (
          connection.iceConnectionState === "disconnected" &&
          !connection.munetiosIceRestartTimer
        ) {
          connection.munetiosIceRestartTimer = window.setTimeout(() => {
            connection.munetiosIceRestartTimer = null;
            if (
              connection.iceConnectionState === "disconnected" &&
              connection.munetiosInitialInitiator
            ) {
              connection.restartIce();
              void negotiatePeerConnection(peerId, connection);
            }
          }, 2500);
        }
      };
      peerConnectionsRef.current.set(peerId, connection);

      if (initiator) {
        void negotiatePeerConnection(peerId, connection);
      }
      return connection;
    },
    [negotiatePeerConnection, sendSignal, updateParticipant],
  );

  const stopTracks = useCallback(() => {
    transcriptionEnabledRef.current = false;
    if (transcriptionRestartTimerRef.current) {
      window.clearTimeout(transcriptionRestartTimerRef.current);
      transcriptionRestartTimerRef.current = null;
    }
    if (captionClearTimerRef.current) {
      window.clearTimeout(captionClearTimerRef.current);
      captionClearTimerRef.current = null;
    }
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onend = null;
      speechRecognitionRef.current.abort();
      speechRecognitionRef.current = null;
    }
    setLiveTranscriptionEnabled(false);
    setLiveTranscriptionFinal("");
    setLiveTranscriptionInterim("");
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    if (screenTrackRef.current) {
      screenTrackRef.current.onended = null;
      screenTrackRef.current.stop();
    }
    if (screenAudioTrackRef.current) {
      screenAudioTrackRef.current.stop();
    }
    screenAudioTrackRef.current = null;
    screenTrackRef.current = null;
    setLocalScreenPreviewStream(null);
    localStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    localStreamRef.current = null;
    setLocalCameraPreviewStream(null);
    setBackgroundBlurAvailable(false);
    setBackgroundBlurEnabled(false);
    for (const connection of peerConnectionsRef.current.values()) {
      connection.close();
    }
    peerConnectionsRef.current.clear();
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    if (aloneLeaveTimerRef.current) {
      window.clearTimeout(aloneLeaveTimerRef.current);
      aloneLeaveTimerRef.current = null;
    }
    if (roomExpiryTimerRef.current) {
      window.clearTimeout(roomExpiryTimerRef.current);
    }
  }, []);

  const recordHistory = useCallback(
    (credentials) => {
      const entry = {
        durationSeconds: Math.round((Date.now() - startedAtRef.current) / 1000),
        id: crypto.randomUUID(),
        joinedAt: new Date(startedAtRef.current).toISOString(),
        meetingId: credentials.roomId,
        title: copyRef.current.meetJoinedMeeting,
      };
      if (signedIn) {
        void fetch("/api/meet", {
          body: JSON.stringify({ action: "record_history", ...entry }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          method: "POST",
        })
          .then((response) => {
            if (response.ok) {
              window.dispatchEvent(new Event("munetios:meetdatachange"));
            }
          })
          .catch(() => {});
        return;
      }
      try {
        const history = JSON.parse(
          window.localStorage.getItem("munetios.meet.history") || "[]",
        );
        window.localStorage.setItem(
          "munetios.meet.history",
          JSON.stringify(
            [entry, ...(Array.isArray(history) ? history : [])].slice(0, 100),
          ),
        );
      } catch {}
    },
    [signedIn],
  );

  const leaveMeeting = useCallback(
    ({ silent = false } = {}) => {
      if (leftRef.current) return;
      leftRef.current = true;
      const credentials = credentialsRef.current;
      if (credentials) {
        recordHistory(credentials);
        void fetch("/api/realtime", {
          body: JSON.stringify({
            action: "leave",
            ...credentialsPayload(credentials),
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          method: "POST",
        }).catch(() => {});
      }
      stopTracks();
      if (!silent) void playSound("meetLeft");
      onLeave();
    },
    [onLeave, recordHistory, stopTracks],
  );
  leaveMeetingRef.current = leaveMeeting;

  useEffect(() => {
    const loadPreferences = async () => {
      const settings = await loadMeetPreferences(signedIn);
      setLeaveWhenAlone(Boolean(settings.leaveWhenAlone));
      setTtsVoice(
        typeof settings.ttsVoice === "string" ? settings.ttsVoice : "",
      );
      noiseCancellationRef.current = settings.noiseCancellation !== false;
      recordingEncodingChunksRef.current = Object.hasOwn(
        recordingChunkIntervals,
        settings.recordingEncodingChunks,
      )
        ? settings.recordingEncodingChunks
        : "default";
      recordingQualityRef.current = Object.hasOwn(
        recordingQualityProfiles,
        settings.recordingQuality,
      )
        ? settings.recordingQuality
        : "medium";
      const constraints = createMicrophoneConstraints(
        noiseCancellationRef.current,
      );
      for (const track of localStreamRef.current?.getAudioTracks() || []) {
        void track.applyConstraints(constraints).catch(() => {});
      }
    };
    void loadPreferences();
    window.addEventListener("munetios:meetdatachange", loadPreferences);
    return () =>
      window.removeEventListener("munetios:meetdatachange", loadPreferences);
  }, [signedIn]);

  useEffect(() => {
    if (status !== "connected" || !leaveWhenAlone || participants.length > 0) {
      if (aloneLeaveTimerRef.current) {
        window.clearTimeout(aloneLeaveTimerRef.current);
        aloneLeaveTimerRef.current = null;
      }
      return;
    }
    aloneLeaveTimerRef.current = window.setTimeout(
      () => {
        aloneLeaveTimerRef.current = null;
        void leaveMeetingRef.current?.();
      },
      10 * 60 * 1000,
    );
    return () => {
      if (aloneLeaveTimerRef.current) {
        window.clearTimeout(aloneLeaveTimerRef.current);
        aloneLeaveTimerRef.current = null;
      }
    };
  }, [leaveWhenAlone, participants.length, status]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: startAttempt intentionally restarts the complete meeting connection lifecycle.
  useEffect(() => {
    leftRef.current = false;
    chatInitializedRef.current = false;
    chatMessageIdsRef.current = new Set();
    setChatMessages([]);
    setChatUnread(0);
    setLocalIdentity(null);
    setMediaReady(false);
    setParticipants([]);
    setStatus("connecting");
    let cancelled = false;
    let meetingFailed = false;

    async function failMeeting() {
      if (cancelled || leftRef.current) return;
      meetingFailed = true;
      setStatus("failed");
      stopTracks();
      showMeetToast("start-failed", copyRef.current.meetStartFailed);
      await playSound("error");
    }

    async function processEvent(event) {
      if (
        blockedPeerIdsRef.current.has(event.fromPeerId) &&
        event.kind !== "peer-left"
      ) {
        return;
      }
      if (event.kind === "peer-joined" && event.payload?.resumed) {
        peerConnectionsRef.current.get(event.fromPeerId)?.close();
        peerConnectionsRef.current.delete(event.fromPeerId);
        updateParticipant(event.fromPeerId, {
          cameraVisible: false,
          microphoneOff: true,
          stream: null,
        });
        const credentials = credentialsRef.current;
        createPeerConnection(
          event.fromPeerId,
          Boolean(
            credentials &&
              credentials.peerId.localeCompare(event.fromPeerId) < 0,
          ),
        );
        return;
      }
      if (event.kind === "peer-joined") {
        void playSound("userJoin");
        return;
      }
      if (event.kind === "peer-left") {
        peerConnectionsRef.current.get(event.fromPeerId)?.close();
        peerConnectionsRef.current.delete(event.fromPeerId);
        setParticipants((current) =>
          current.filter((item) => item.peerId !== event.fromPeerId),
        );
        setFocusedPeerId((current) =>
          current === event.fromPeerId ? "" : current,
        );
        void playSound("userLeft");
        return;
      }

      const connection = createPeerConnection(event.fromPeerId, false);
      try {
        if (
          event.kind === "offer" &&
          event.payload?.munetiosRenegotiateRequest
        ) {
          if (connection.munetiosInitialInitiator) {
            await negotiatePeerConnection(event.fromPeerId, connection);
          }
        } else if (event.kind === "offer") {
          await connection.setRemoteDescription(event.payload);
          for (const candidate of connection.munetiosPendingCandidates.splice(
            0,
          )) {
            await connection.addIceCandidate(candidate);
          }
          connection.munetiosNegotiationPending = false;
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          await sendSignal(
            event.fromPeerId,
            "answer",
            connection.localDescription,
          );
        } else if (event.kind === "answer") {
          if (connection.signalingState !== "stable") {
            await connection.setRemoteDescription(event.payload);
          }
          for (const candidate of connection.munetiosPendingCandidates.splice(
            0,
          )) {
            await connection.addIceCandidate(candidate);
          }
          if (connection.munetiosNegotiationPending) {
            await negotiatePeerConnection(event.fromPeerId, connection);
          }
        } else if (event.kind === "ice-candidate") {
          if (connection.remoteDescription) {
            await connection.addIceCandidate(event.payload);
          } else {
            connection.munetiosPendingCandidates.push(event.payload);
          }
        }
      } catch {
        void playSound("error");
        showMeetToast(
          "connection-failed",
          copyRef.current.meetSomethingWentWrongToast,
        );
      }
    }

    async function poll() {
      const credentials = credentialsRef.current;
      if (!credentials || pollBusyRef.current || leftRef.current) return;
      pollBusyRef.current = true;
      try {
        const query = new URLSearchParams({
          after: String(cursorRef.current),
          ...credentialsPayload(credentials),
        });
        const response = await fetch(`/api/realtime?${query}`, {
          cache: "no-store",
          credentials: "include",
        });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error || "poll_failed");
        if (payload.ended) {
          await leaveMeetingRef.current?.();
          return;
        }
        if (payload.kicked) {
          meetingFailed = true;
          leftRef.current = true;
          recordHistory(credentials);
          setStatus("kicked");
          stopTracks();
          showMeetToast("kicked", copyRef.current.meetKickedOut, "warning");
          await playSound("meetLeft");
          return;
        }

        const peerIds = new Set();
        for (const peer of payload.peers || []) {
          peerIds.add(peer.peerId);
          if (blockedPeerIdsRef.current.has(peer.peerId)) continue;
          metadataRef.current.set(peer.peerId, peer);
          updateParticipant(peer.peerId, peer);
          createPeerConnection(
            peer.peerId,
            credentials.peerId.localeCompare(peer.peerId) < 0,
          );
        }
        for (const [peerId, connection] of peerConnectionsRef.current) {
          if (!peerIds.has(peerId)) {
            connection.close();
            peerConnectionsRef.current.delete(peerId);
            setParticipants((current) =>
              current.filter((participant) => participant.peerId !== peerId),
            );
          }
        }
        for (const event of payload.events || []) {
          cursorRef.current = Math.max(
            cursorRef.current,
            Number(event.id) || 0,
          );
          await processEvent(event);
        }
        const previousActivity = activityRef.current;
        const nextActivity = payload.activity || null;
        if (
          nextActivity &&
          (!previousActivity ||
            previousActivity.createdAt !== nextActivity.createdAt)
        ) {
          if (activitiesSoundRef.current) void playSound("activityStarted");
          showMeetToast(
            "activity-started",
            copyRef.current.meetActivityStarted,
            "success",
          );
        } else if (
          previousActivity &&
          !previousActivity.state?.ended &&
          nextActivity?.state?.ended
        ) {
          if (activitiesSoundRef.current) void playSound("activityEnded");
        }
        activityRef.current = nextActivity;
        setActivity(nextActivity);
        await updateChatMessages(payload.chatMessages);
        friendsLoadFailedRef.current = false;
      } catch {
        // The room was already joined successfully. A transient poll failure
        // must not replace the active meeting with a false start error.
        if (friendsOpenRef.current && !friendsLoadFailedRef.current) {
          friendsLoadFailedRef.current = true;
          showMeetToast(
            "friends-load-failed",
            copyRef.current.meetFriendsLoadFailed,
          );
        }
        return;
      } finally {
        pollBusyRef.current = false;
      }
    }

    async function startMeeting() {
      prepareMeetAudio();
      if (
        typeof RTCPeerConnection === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        await failMeeting();
        return;
      }

      const mediaPromise = (async () => {
        const stream = new MediaStream();
        const preferences = await loadMeetPreferences(signedIn);
        noiseCancellationRef.current = preferences.noiseCancellation !== false;
        const activitySoundsEnabled = preferences.activitiesSound !== false;
        setActivitiesSound(activitySoundsEnabled);
        activitiesSoundRef.current = activitySoundsEnabled;
        setAllowOthersJoinActivity(
          preferences.allowOthersJoinActivity !== false,
        );
        const selectedDevices = readLocalJson(localMeetDevicesKey);
        try {
          const microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: createMicrophoneConstraints(noiseCancellationRef.current),
            video: false,
          });
          microphoneStream.getAudioTracks().forEach((track) => {
            stream.addTrack(track);
          });
        } catch {
          void playSound("microphoneDenied");
          showMeetToast(
            "microphone-denied",
            copyRef.current.meetMicrophoneDeniedToast,
            "warning",
          );
        }
        try {
          const cameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: selectedDevices.camera
              ? { deviceId: { exact: selectedDevices.camera } }
              : true,
          });
          cameraStream.getVideoTracks().forEach((track) => {
            stream.addTrack(track);
          });
        } catch {
          void playSound("cameraDenied");
          showMeetToast(
            "camera-denied",
            copyRef.current.meetCameraDeniedToast,
            "warning",
          );
        }
        return stream;
      })();

      try {
        let credentials;
        if (request.peerId && request.peerToken && request.roomId) {
          try {
            credentials = await realtimePost({
              action: "resume",
              nickname: request.nickname || undefined,
              peerId: request.peerId,
              peerToken: request.peerToken,
              roomId: request.roomId,
            });
          } catch (error) {
            if (error?.message !== "resume_failed") throw error;
          }
        }
        credentials ||= await realtimePost({
          action: request.action,
          nickname: request.nickname || undefined,
          roomId: request.roomId || undefined,
          service: "meet",
        });
        if (
          !e2eeKeyRef.current &&
          /^\d{8}$/u.test(String(credentials.roomId || ""))
        ) {
          e2eeKeyRef.current = await deriveNumericMeetingSecret(
            credentials.roomId,
          );
        }
        if (cancelled) {
          void realtimePost({
            action: "leave",
            ...credentialsPayload(credentials),
          }).catch(() => {});
          void mediaPromise.then((stream) => {
            stream.getTracks().forEach((track) => {
              track.stop();
            });
          });
          return;
        }
        credentialsRef.current = credentials;
        cursorRef.current = Math.max(0, Number(credentials.cursor) || 0);
        setLocalIdentity(credentials);
        startedAtRef.current = Date.now();
        setStatus("connected");
        const activeMeeting = {
          action: "join",
          e2eeKey: e2eeKeyRef.current,
          nickname: request.nickname || "",
          peerId: credentials.peerId,
          peerToken: credentials.peerToken,
          roomId: credentials.roomId,
        };
        window.sessionStorage.setItem(
          activeMeetingStorageKey,
          JSON.stringify(activeMeeting),
        );
        if (e2eeKeyRef.current) {
          let secrets = {};
          try {
            secrets = JSON.parse(
              window.sessionStorage.getItem(meetingSecretsStorageKey) || "{}",
            );
          } catch {}
          window.sessionStorage.setItem(
            meetingSecretsStorageKey,
            JSON.stringify({
              ...secrets,
              [credentials.roomId]: e2eeKeyRef.current,
            }),
          );
        }
        const encryptionFragment =
          !/^\d{8}$/u.test(credentials.roomId) && e2eeKeyRef.current
            ? `#key=${encodeURIComponent(e2eeKeyRef.current)}`
            : "";
        window.history.replaceState(
          null,
          "",
          `/apps/meet?room=${encodeURIComponent(credentials.roomId)}${encryptionFragment}`,
        );
        void playSound("meetJoin");
        roomExpiryTimerRef.current = window.setTimeout(
          () => void leaveMeetingRef.current?.(),
          Math.max(0, Number(credentials.expiresAt) - Date.now()),
        );
      } catch (error) {
        void mediaPromise.then((stream) => {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
        });
        if (error?.message === "banned") {
          meetingFailed = true;
          leftRef.current = true;
          setStatus("banned");
          stopTracks();
          showMeetToast("banned", copyRef.current.meetBannedFromMeeting);
          await playSound("error");
          return;
        }
        await failMeeting();
        return;
      }

      const stream = await mediaPromise;
      if (cancelled || meetingFailed || leftRef.current) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }

      localStreamRef.current = stream;
      setMediaReady(true);
      const audioTrack = stream.getAudioTracks()[0] || null;
      const videoTrack = stream.getVideoTracks()[0] || null;
      await syncBackgroundBlurForTrack(videoTrack);
      setLocalCameraPreviewStream(
        videoTrack ? new MediaStream([videoTrack]) : null,
      );
      const nextMediaState = {
        cameraOn: Boolean(videoTrack?.enabled),
        microphoneOn: Boolean(audioTrack?.enabled),
        screenSharing: Boolean(screenTrackRef.current),
      };
      setMicrophoneOn(nextMediaState.microphoneOn);
      setCameraOn(nextMediaState.cameraOn);
      publishMediaState(nextMediaState);
      for (const connection of peerConnectionsRef.current.values()) {
        connection.munetiosAudioTransceiver.direction = "sendrecv";
        connection.munetiosVideoTransceiver.direction = "sendrecv";
        await connection.munetiosAudioSender?.replaceTrack(audioTrack);
        await connection.munetiosVideoSender?.replaceTrack(
          screenTrackRef.current || videoTrack,
        );
      }
      await renegotiatePeerConnections();
      void poll();
      pollTimerRef.current = window.setInterval(poll, 900);
    }

    const startTimer = window.setTimeout(() => void startMeeting(), 0);
    let pageUnloading = false;
    const markPageUnloading = () => {
      pageUnloading = true;
    };
    window.addEventListener("beforeunload", markPageUnloading);
    window.addEventListener("pagehide", markPageUnloading);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.removeEventListener("beforeunload", markPageUnloading);
      window.removeEventListener("pagehide", markPageUnloading);
      const credentials = credentialsRef.current;
      if (credentials && !leftRef.current && !pageUnloading) {
        void realtimePost({
          action: "leave",
          ...credentialsPayload(credentials),
        }).catch(() => {});
      }
      credentialsRef.current = null;
      stopTracks();
    };
  }, [
    createPeerConnection,
    negotiatePeerConnection,
    request.action,
    request.nickname,
    request.peerId,
    request.peerToken,
    request.roomId,
    startAttempt,
    publishMediaState,
    recordHistory,
    renegotiatePeerConnections,
    sendSignal,
    signedIn,
    stopTracks,
    syncBackgroundBlurForTrack,
    updateParticipant,
    updateChatMessages,
  ]);

  const replaceOutgoingVideo = useCallback(async (track) => {
    await Promise.allSettled(
      [...peerConnectionsRef.current.values()].map(async (connection) => {
        const sender = connection.munetiosVideoSender;
        const transceiver = connection.munetiosVideoTransceiver;
        if (transceiver) {
          transceiver.direction = "sendrecv";
        }
        if (sender) await sender.replaceTrack(track);
      }),
    );
  }, []);

  const toggleMicrophone = async () => {
    let tracks = localStreamRef.current?.getAudioTracks() || [];
    if (!tracks.length) {
      try {
        const microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: createMicrophoneConstraints(noiseCancellationRef.current),
          video: false,
        });
        const [track] = microphoneStream.getAudioTracks();
        if (!track) throw new Error("microphone_track_unavailable");
        localStreamRef.current ||= new MediaStream();
        localStreamRef.current.addTrack(track);
        tracks = [track];
        for (const connection of peerConnectionsRef.current.values()) {
          connection.munetiosAudioTransceiver.direction = "sendrecv";
          await connection.munetiosAudioSender?.replaceTrack(track);
        }
        await renegotiatePeerConnections();
      } catch {
        void playSound("microphoneDenied");
        showMeetToast(
          "microphone-denied",
          copy.meetMicrophoneDeniedToast,
          "warning",
        );
        return;
      }
    }
    const next = !microphoneOn;
    for (const track of tracks) track.enabled = next;
    setMicrophoneOn(next);
    publishMediaState({ microphoneOn: next });
    void playSound(next ? "unmute" : "mute");
  };

  const replaceOutgoingScreenAudio = useCallback(async (track) => {
    await Promise.allSettled(
      [...peerConnectionsRef.current.values()].map(async (connection) => {
        const sender = connection.munetiosScreenAudioSender;
        const transceiver = connection.munetiosScreenAudioTransceiver;
        if (transceiver) {
          transceiver.direction = "sendrecv";
        }
        if (sender) await sender.replaceTrack(track);
      }),
    );
  }, []);

  const toggleCamera = async () => {
    if (cameraOn) {
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
      if (cameraTrack) cameraTrack.enabled = false;
      if (!screenSharing) {
        await replaceOutgoingVideo(null);
        await renegotiatePeerConnections();
      }
      setCameraOn(false);
      publishMediaState({ cameraOn: false });
      void playSound("cameraOff");
      return;
    }

    let track = localStreamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        [track] = cameraStream.getVideoTracks();
        for (const previousTrack of localStreamRef.current.getVideoTracks()) {
          if (previousTrack.readyState !== "live") {
            localStreamRef.current.removeTrack(previousTrack);
          }
        }
        localStreamRef.current.addTrack(track);
      } catch {
        void playSound("cameraDenied");
        showMeetToast("camera-denied", copy.meetCameraDeniedToast, "warning");
        return;
      }
    }
    track.enabled = true;
    await syncBackgroundBlurForTrack(track);
    setLocalCameraPreviewStream(new MediaStream([track]));
    if (!screenSharing) {
      await replaceOutgoingVideo(track);
      await renegotiatePeerConnections();
    }
    setCameraOn(true);
    publishMediaState({ cameraOn: true });
    void playSound("cameraOn");
  };

  const toggleBackgroundBlur = async () => {
    const cameraTrack = localStreamRef.current
      ?.getVideoTracks()
      .find((track) => track.readyState === "live");
    if (!cameraTrack || !canControlBackgroundBlur(cameraTrack)) {
      setBackgroundBlurAvailable(false);
      showMeetToast(
        "background-blur-unavailable",
        copy.meetBackgroundBlurUnavailable,
        "warning",
      );
      return;
    }

    const nextEnabled = !backgroundBlurEnabled;
    try {
      const applied = await applyBackgroundBlur(cameraTrack, nextEnabled);
      if (!applied) throw new Error("background_blur_not_applied");
      backgroundBlurPreferenceRef.current = nextEnabled;
      setBackgroundBlurAvailable(true);
      setBackgroundBlurEnabled(nextEnabled);
    } catch {
      showMeetToast(
        "background-blur-unavailable",
        copy.meetBackgroundBlurUnavailable,
        "warning",
      );
    }
  };

  const stopLiveTranscription = useCallback(() => {
    transcriptionEnabledRef.current = false;
    if (transcriptionRestartTimerRef.current) {
      window.clearTimeout(transcriptionRestartTimerRef.current);
      transcriptionRestartTimerRef.current = null;
    }
    if (captionClearTimerRef.current) {
      window.clearTimeout(captionClearTimerRef.current);
      captionClearTimerRef.current = null;
    }
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        recognition.abort();
      }
    }
    setLiveTranscriptionEnabled(false);
    setLiveTranscriptionFinal("");
    setLiveTranscriptionInterim("");
  }, []);

  const startLiveTranscription = useCallback(() => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setLiveTranscriptionAvailable(false);
      showMeetToast(
        "live-transcription-unavailable",
        copyRef.current.meetLiveTranscriptionUnavailable,
        "warning",
      );
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang =
      document.documentElement.lang || navigator.language || "en-US";
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index++
      ) {
        const text = String(event.results[index][0]?.transcript || "").trim();
        if (!text) continue;
        if (event.results[index].isFinal) {
          finalText += `${text} `;
        } else {
          interimText += `${text} `;
        }
      }
      if (finalText) {
        setLiveTranscriptionFinal((current) =>
          `${current} ${finalText}`.trim().slice(-500),
        );
      }
      setLiveTranscriptionInterim(interimText.trim());
      if (captionClearTimerRef.current) {
        window.clearTimeout(captionClearTimerRef.current);
      }
      captionClearTimerRef.current = window.setTimeout(() => {
        setLiveTranscriptionFinal("");
        setLiveTranscriptionInterim("");
        captionClearTimerRef.current = null;
      }, 8000);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      transcriptionEnabledRef.current = false;
      speechRecognitionRef.current = null;
      setLiveTranscriptionEnabled(false);
      setLiveTranscriptionInterim("");
      showMeetToast(
        "live-transcription-failed",
        copyRef.current.meetLiveTranscriptionFailedToast,
        "warning",
      );
    };
    recognition.onend = () => {
      if (
        !transcriptionEnabledRef.current ||
        speechRecognitionRef.current !== recognition
      ) {
        return;
      }
      transcriptionRestartTimerRef.current = window.setTimeout(() => {
        try {
          recognition.start();
        } catch {
          transcriptionEnabledRef.current = false;
          speechRecognitionRef.current = null;
          setLiveTranscriptionEnabled(false);
          showMeetToast(
            "live-transcription-failed",
            copyRef.current.meetLiveTranscriptionFailedToast,
            "warning",
          );
        }
      }, 250);
    };

    speechRecognitionRef.current = recognition;
    transcriptionEnabledRef.current = true;
    setLiveTranscriptionAvailable(true);
    setLiveTranscriptionEnabled(true);
    try {
      recognition.start();
    } catch {
      speechRecognitionRef.current = null;
      transcriptionEnabledRef.current = false;
      setLiveTranscriptionEnabled(false);
      showMeetToast(
        "live-transcription-failed",
        copyRef.current.meetLiveTranscriptionFailedToast,
        "warning",
      );
    }
  }, []);

  const toggleLiveTranscription = () => {
    if (liveTranscriptionEnabled) {
      stopLiveTranscription();
      return;
    }
    startLiveTranscription();
  };

  const stopScreenShare = useCallback(async () => {
    const screenTrack = screenTrackRef.current;
    const screenAudioTrack = screenAudioTrackRef.current;
    const cameraTrack = mediaStateRef.current.cameraOn
      ? localStreamRef.current?.getVideoTracks()[0] || null
      : null;
    if (screenTrack) screenTrack.onended = null;
    screenAudioTrackRef.current = null;
    screenTrackRef.current = null;
    setLocalScreenPreviewStream(null);
    setScreenSharing(false);
    publishMediaState({ screenSharing: false });
    await Promise.all([
      replaceOutgoingVideo(cameraTrack),
      replaceOutgoingScreenAudio(null),
    ]);
    screenTrack?.stop();
    screenAudioTrack?.stop();
    await renegotiatePeerConnections().catch(() => {});
    void playSound("screenShareStop");
  }, [
    publishMediaState,
    renegotiatePeerConnections,
    replaceOutgoingScreenAudio,
    replaceOutgoingVideo,
  ]);

  const toggleScreenShare = async () => {
    if (screenSharing) {
      await stopScreenShare();
      return;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
        video: {
          frameRate: { ideal: 30, max: 30 },
          height: { ideal: 1080 },
          width: { ideal: 1920 },
        },
      });
      const [track] = displayStream.getVideoTracks();
      const [screenAudioTrack] = displayStream.getAudioTracks();
      if (!track) throw new Error("screen_track_unavailable");
      track.contentHint = "detail";
      screenTrackRef.current = track;
      screenAudioTrackRef.current = screenAudioTrack || null;
      track.onended = () => void stopScreenShare();
      await replaceOutgoingVideo(track);
      await replaceOutgoingScreenAudio(screenAudioTrack || null);
      await renegotiatePeerConnections();
      setLocalScreenPreviewStream(displayStream);
      setScreenSharing(true);
      publishMediaState({ screenSharing: true });
      void playSound("screenShareStart");
    } catch {
      if (screenTrackRef.current) {
        screenTrackRef.current.onended = null;
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }
      if (screenAudioTrackRef.current) {
        screenAudioTrackRef.current.stop();
        screenAudioTrackRef.current = null;
      }
      const cameraTrack = cameraOn
        ? localStreamRef.current?.getVideoTracks()[0] || null
        : null;
      await replaceOutgoingVideo(cameraTrack).catch(() => {});
      await replaceOutgoingScreenAudio(null).catch(() => {});
      await renegotiatePeerConnections().catch(() => {});
      setLocalScreenPreviewStream(null);
      setScreenSharing(false);
      publishMediaState({ screenSharing: false });
      void playSound("screenShareDenied");
      showMeetToast(
        "screen-share-denied",
        copy.meetScreenShareDeniedToast,
        "warning",
      );
    }
  };

  const saveRecordingToDevice = useCallback((blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `${name}.mp4`;
    link.href = url;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, []);

  const finishRecording = useCallback(
    async (blob, durationSeconds) => {
      const roomId = recordingRoomIdRef.current || "meeting";
      const name = `Munetios-Meet-${roomId}-${new Date()
        .toISOString()
        .replaceAll(":", "-")
        .replace(/\.\d{3}Z$/u, "Z")}`;
      if (!signedIn) {
        saveRecordingToDevice(blob, name);
        setRecordingSaving(false);
        showMeetToast(
          "recording-device",
          copyRef.current.meetRecordingSavedToDevice,
          "success",
        );
        return;
      }
      setRecordingSaving(true);
      try {
        const response = await fetch("/api/meet/recordings", {
          body: blob,
          credentials: "include",
          headers: {
            "Content-Type": blob.type || "video/mp4",
            "X-Munetios-Duration": String(durationSeconds),
            "X-Munetios-Meeting-Id": roomId,
            "X-Munetios-Recording-Name": encodeURIComponent(name),
          },
          method: "POST",
        });
        if (!response.ok) {
          saveRecordingToDevice(blob, name);
          showMeetToast(
            response.status === 507
              ? "recording-storage-full"
              : "recording-device",
            response.status === 507
              ? copyRef.current.meetRecordingStorageFull
              : copyRef.current.meetRecordingSavedToDevice,
            "warning",
          );
          return;
        }
        showMeetToast(
          "recording-account",
          copyRef.current.meetRecordingSavedToAccount,
          "success",
        );
        window.dispatchEvent(new Event("munetios:meetrecordingschange"));
        window.dispatchEvent(new Event("munetios:accountstoragechange"));
      } catch {
        saveRecordingToDevice(blob, name);
        showMeetToast(
          "recording-device",
          copyRef.current.meetRecordingSavedToDevice,
          "warning",
        );
      } finally {
        setRecordingSaving(false);
      }
    },
    [saveRecordingToDevice, signedIn],
  );

  const _startLegacyRecording = useCallback(async () => {
    if (typeof MediaRecorder === "undefined") {
      showMeetToast(
        "recording-failed",
        copyRef.current.meetSomethingWentWrongToast,
      );
      return;
    }
    const recordingMimeType =
      typeof MediaRecorder.isTypeSupported === "function"
        ? meetRecordingMp4Types.find((type) =>
            MediaRecorder.isTypeSupported(type),
          )
        : "";
    if (!recordingMimeType) {
      showMeetToast(
        "recording-unsupported",
        copyRef.current.meetRecordingUnsupported,
        "warning",
      );
      return;
    }
    if (navigator.mediaDevices?.getDisplayMedia) {
      let displayStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          preferCurrentTab: true,
          selfBrowserSurface: "include",
          surfaceSwitching: "include",
          video: { frameRate: { ideal: 30, max: 30 } },
        });
      } catch {
        showMeetToast(
          "recording-failed",
          copyRef.current.meetSomethingWentWrongToast,
          "warning",
        );
        return;
      }

      const displayVideoTrack = displayStream.getVideoTracks()[0];
      if (!displayVideoTrack) {
        displayStream.getTracks().forEach((track) => {
          track.stop();
        });
        showMeetToast(
          "recording-failed",
          copyRef.current.meetSomethingWentWrongToast,
        );
        return;
      }
      const outputStream = new MediaStream([displayVideoTrack]);
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      const audioContext = AudioContextClass ? new AudioContextClass() : null;
      const audioDestination = audioContext?.createMediaStreamDestination();
      const connectedTrackIds = new Set();
      const connectAudio = (stream) => {
        if (!audioContext || !audioDestination) return;
        const audioTracks =
          stream
            ?.getAudioTracks()
            .filter((track) => track.readyState === "live") || [];
        const freshTracks = audioTracks.filter(
          (track) => !connectedTrackIds.has(track.id),
        );
        if (!freshTracks.length) return;
        freshTracks.forEach((track) => {
          connectedTrackIds.add(track.id);
        });
        audioContext
          .createMediaStreamSource(new MediaStream(freshTracks))
          .connect(audioDestination);
      };
      const hasCapturedTabAudio = displayStream.getAudioTracks().length > 0;
      connectAudio(displayStream);
      connectAudio(localStreamRef.current);
      if (!hasCapturedTabAudio) {
        for (const connection of peerConnectionsRef.current.values()) {
          connectAudio(connection.munetiosRemoteStream);
        }
      }
      for (const track of audioDestination?.stream.getAudioTracks() || []) {
        outputStream.addTrack(track);
      }
      const audioSyncTimer = window.setInterval(() => {
        if (hasCapturedTabAudio) return;
        for (const connection of peerConnectionsRef.current.values()) {
          connectAudio(connection.munetiosRemoteStream);
        }
      }, 1000);

      let recorder;
      try {
        recorder = new MediaRecorder(outputStream, {
          mimeType: recordingMimeType,
          videoBitsPerSecond: 4_000_000,
        });
      } catch {
        window.clearInterval(audioSyncTimer);
        displayStream.getTracks().forEach((track) => {
          track.stop();
        });
        outputStream.getTracks().forEach((track) => {
          track.stop();
        });
        void audioContext?.close();
        showMeetToast(
          "recording-failed",
          copyRef.current.meetSomethingWentWrongToast,
        );
        return;
      }

      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recordingRoomIdRef.current = credentialsRef.current?.roomId || "meeting";
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        window.clearInterval(audioSyncTimer);
        displayStream.getTracks().forEach((track) => {
          track.stop();
        });
        outputStream.getTracks().forEach((track) => {
          track.stop();
        });
        void audioContext?.close();
        mediaRecorderRef.current = null;
        setRecording(false);
        publishMediaState({ recordingOn: false });
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        if (!chunks.length) {
          setRecordingSaving(false);
          showMeetToast(
            "recording-failed",
            copyRef.current.meetSomethingWentWrongToast,
          );
          return;
        }
        const blob = new Blob(chunks, {
          type: recorder.mimeType || recordingMimeType,
        });
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - recordingStartedAtRef.current) / 1000),
        );
        void finishRecording(blob, durationSeconds);
      };
      recorder.onerror = () => {
        window.clearInterval(audioSyncTimer);
        setRecording(false);
        setRecordingSaving(false);
        publishMediaState({ recordingOn: false });
        showMeetToast(
          "recording-failed",
          copyRef.current.meetSomethingWentWrongToast,
        );
      };
      displayVideoTrack.onended = () => {
        if (recorder.state !== "inactive") recorder.stop();
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      publishMediaState({ recordingOn: true });
      showMeetToast(
        "recording-started",
        copyRef.current.meetRecordingStarted,
        "success",
      );
      return;
    }
    if (!HTMLCanvasElement.prototype.captureStream) {
      showMeetToast(
        "recording-failed",
        copyRef.current.meetSomethingWentWrongToast,
      );
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const canvasStream = canvas.captureStream(30);
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = AudioContextClass ? new AudioContextClass() : null;
    const audioDestination = audioContext?.createMediaStreamDestination();
    const connectedStreamIds = new Set();
    const connectAudio = (stream) => {
      if (
        !audioContext ||
        !audioDestination ||
        !stream?.getAudioTracks().length ||
        connectedStreamIds.has(stream.id)
      ) {
        return;
      }
      connectedStreamIds.add(stream.id);
      audioContext.createMediaStreamSource(stream).connect(audioDestination);
    };
    connectAudio(localStreamRef.current);
    if (screenAudioTrackRef.current) {
      connectAudio(new MediaStream([screenAudioTrackRef.current]));
    }
    for (const connection of peerConnectionsRef.current.values()) {
      connectAudio(connection.munetiosRemoteStream);
    }
    for (const track of audioDestination?.stream.getAudioTracks() || []) {
      canvasStream.addTrack(track);
    }
    const roomElement = document.querySelector(".meet-room");
    let roomSnapshot = null;
    let activitySnapshot = null;
    let snapshotBusy = false;
    let snapshotTimer = 0;
    const captureInterface = async () => {
      if (!roomElement || snapshotBusy) return;
      snapshotBusy = true;
      try {
        const { default: html2canvas } = await import("html2canvas");
        roomSnapshot = await html2canvas(roomElement, {
          backgroundColor: "#08050f",
          ignoreElements: (element) =>
            element instanceof HTMLVideoElement ||
            element instanceof HTMLIFrameElement,
          logging: false,
          scale: 1,
          useCORS: true,
        });
        const activityFrame = roomElement.querySelector(
          "iframe[data-meet-record-layer='activity']",
        );
        const activityDocument = activityFrame?.contentDocument;
        if (activityDocument?.documentElement) {
          activitySnapshot = {
            canvas: await html2canvas(activityDocument.documentElement, {
              backgroundColor: "#08050f",
              logging: false,
              scale: 1,
              useCORS: true,
            }),
            frame: activityFrame,
          };
        } else {
          activitySnapshot = null;
        }
      } catch {
        // Video recording continues even if a transient UI snapshot fails.
      } finally {
        snapshotBusy = false;
      }
    };
    void captureInterface();
    snapshotTimer = window.setInterval(() => {
      void captureInterface();
    }, 750);
    let animationFrame = 0;
    const drawFrame = () => {
      for (const connection of peerConnectionsRef.current.values()) {
        connectAudio(connection.munetiosRemoteStream);
      }
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const roomRect = roomElement?.getBoundingClientRect();
      const roomScale =
        roomRect?.width && roomRect?.height
          ? Math.min(
              canvas.width / roomRect.width,
              canvas.height / roomRect.height,
            )
          : 1;
      const roomX = roomRect
        ? (canvas.width - roomRect.width * roomScale) / 2
        : 0;
      const roomY = roomRect
        ? (canvas.height - roomRect.height * roomScale) / 2
        : 0;
      if (roomSnapshot && roomRect) {
        context.drawImage(
          roomSnapshot,
          roomX,
          roomY,
          roomRect.width * roomScale,
          roomRect.height * roomScale,
        );
      }
      if (activitySnapshot?.canvas && roomRect) {
        const frameRect = activitySnapshot.frame.getBoundingClientRect();
        context.drawImage(
          activitySnapshot.canvas,
          roomX + (frameRect.left - roomRect.left) * roomScale,
          roomY + (frameRect.top - roomRect.top) * roomScale,
          frameRect.width * roomScale,
          frameRect.height * roomScale,
        );
      }
      const videos = [
        ...document.querySelectorAll(".meet-video-grid video"),
      ].filter(
        (video) =>
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth &&
          video.videoHeight,
      );
      videos.forEach((video) => {
        const videoRect = video.getBoundingClientRect();
        const tileWidth = videoRect.width * roomScale;
        const tileHeight = videoRect.height * roomScale;
        const scale = Math.min(
          tileWidth / video.videoWidth,
          tileHeight / video.videoHeight,
        );
        const width = video.videoWidth * scale;
        const height = video.videoHeight * scale;
        const x =
          roomX +
          (videoRect.left - (roomRect?.left || 0)) * roomScale +
          (tileWidth - width) / 2;
        const y =
          roomY +
          (videoRect.top - (roomRect?.top || 0)) * roomScale +
          (tileHeight - height) / 2;
        context.drawImage(video, x, y, width, height);
      });
      animationFrame = window.requestAnimationFrame(drawFrame);
    };
    drawFrame();
    let recorder;
    try {
      recorder = new MediaRecorder(canvasStream, {
        mimeType: recordingMimeType,
        videoBitsPerSecond: 2_500_000,
      });
    } catch {
      window.cancelAnimationFrame(animationFrame);
      canvasStream.getTracks().forEach((track) => {
        track.stop();
      });
      void audioContext?.close();
      showMeetToast(
        "recording-failed",
        copyRef.current.meetSomethingWentWrongToast,
      );
      return;
    }
    recordingChunksRef.current = [];
    recordingStartedAtRef.current = Date.now();
    recordingRoomIdRef.current = credentialsRef.current?.roomId || "meeting";
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearInterval(snapshotTimer);
      canvasStream.getTracks().forEach((track) => {
        track.stop();
      });
      void audioContext?.close();
      mediaRecorderRef.current = null;
      setRecording(false);
      publishMediaState({ recordingOn: false });
      const chunks = recordingChunksRef.current;
      recordingChunksRef.current = [];
      if (!chunks.length) {
        setRecordingSaving(false);
        showMeetToast(
          "recording-failed",
          copyRef.current.meetSomethingWentWrongToast,
        );
        return;
      }
      const blob = new Blob(chunks, {
        type: recorder.mimeType || recordingMimeType,
      });
      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - recordingStartedAtRef.current) / 1000),
      );
      void finishRecording(blob, durationSeconds);
    };
    recorder.onerror = () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearInterval(snapshotTimer);
      canvasStream.getTracks().forEach((track) => {
        track.stop();
      });
      void audioContext?.close();
      setRecording(false);
      setRecordingSaving(false);
      publishMediaState({ recordingOn: false });
      showMeetToast(
        "recording-failed",
        copyRef.current.meetSomethingWentWrongToast,
      );
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    publishMediaState({ recordingOn: true });
    showMeetToast(
      "recording-started",
      copyRef.current.meetRecordingStarted,
      "success",
    );
  }, [finishRecording, publishMediaState]);

  const _startCompositeRecording = useCallback(async () => {
    if (
      typeof VideoEncoder === "undefined" ||
      typeof VideoFrame === "undefined"
    ) {
      showMeetToast(
        "recording-unsupported",
        copyRef.current.meetRecordingUnsupported,
        "warning",
      );
      return;
    }

    const roomElement = document.querySelector(".meet-room");
    if (!roomElement) {
      showMeetToast(
        "recording-failed",
        copyRef.current.meetSomethingWentWrongToast,
      );
      return;
    }

    let output = null;
    let audioContext = null;
    let audioSource = null;
    let snapshotTimer = 0;
    let frameTimer = 0;
    let pendingFrame = Promise.resolve();
    let roomSnapshot = null;
    let activitySnapshot = null;
    let snapshotBusy = false;
    let controller = null;
    const interfaceListeners = [];
    const connectedTrackIds = new Set();
    const audioNodes = [];

    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: false,
    });
    if (!context) {
      showMeetToast(
        "recording-failed",
        copyRef.current.meetSomethingWentWrongToast,
      );
      return;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const captureInterface = async () => {
      if (snapshotBusy || controller?.state === "inactive") return;
      snapshotBusy = true;
      try {
        const { default: html2canvas } = await import("html2canvas");
        roomSnapshot = await html2canvas(roomElement, {
          backgroundColor: "#08050f",
          ignoreElements: (element) =>
            element instanceof HTMLVideoElement ||
            element instanceof HTMLIFrameElement,
          logging: false,
          scale: Math.min(window.devicePixelRatio || 1, 1.5),
          useCORS: true,
        });
        const activityFrame = roomElement.querySelector(
          "iframe[data-meet-record-layer='activity']",
        );
        const activityDocument = activityFrame?.contentDocument;
        if (activityDocument?.documentElement) {
          activitySnapshot = {
            canvas: await html2canvas(activityDocument.documentElement, {
              backgroundColor: "#08050f",
              logging: false,
              scale: Math.min(window.devicePixelRatio || 1, 1.5),
              useCORS: true,
            }),
            frame: activityFrame,
          };
        } else {
          activitySnapshot = null;
        }
      } catch {
        // A transient interface snapshot failure must not interrupt recording.
      } finally {
        snapshotBusy = false;
      }
    };

    const drawFrame = () => {
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const roomRect = roomElement.getBoundingClientRect();
      if (!roomRect.width || !roomRect.height) return;
      const roomScale = Math.min(
        canvas.width / roomRect.width,
        canvas.height / roomRect.height,
      );
      const roomX = (canvas.width - roomRect.width * roomScale) / 2;
      const roomY = (canvas.height - roomRect.height * roomScale) / 2;

      if (roomSnapshot) {
        context.drawImage(
          roomSnapshot,
          roomX,
          roomY,
          roomRect.width * roomScale,
          roomRect.height * roomScale,
        );
      }
      if (activitySnapshot?.canvas) {
        const frameRect = activitySnapshot.frame.getBoundingClientRect();
        context.drawImage(
          activitySnapshot.canvas,
          roomX + (frameRect.left - roomRect.left) * roomScale,
          roomY + (frameRect.top - roomRect.top) * roomScale,
          frameRect.width * roomScale,
          frameRect.height * roomScale,
        );
      }

      const videos = roomElement.querySelectorAll(
        ".meet-video-grid video, video[data-meet-record-layer]",
      );
      videos.forEach((video) => {
        if (
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          !video.videoWidth ||
          !video.videoHeight
        ) {
          return;
        }
        const videoRect = video.getBoundingClientRect();
        if (!videoRect.width || !videoRect.height) return;
        const tileWidth = videoRect.width * roomScale;
        const tileHeight = videoRect.height * roomScale;
        const videoScale = Math.min(
          tileWidth / video.videoWidth,
          tileHeight / video.videoHeight,
        );
        const width = video.videoWidth * videoScale;
        const height = video.videoHeight * videoScale;
        const x =
          roomX +
          (videoRect.left - roomRect.left) * roomScale +
          (tileWidth - width) / 2;
        const y =
          roomY +
          (videoRect.top - roomRect.top) * roomScale +
          (tileHeight - height) / 2;
        try {
          context.drawImage(video, x, y, width, height);
        } catch {
          // A video can change tracks between the readiness check and draw.
        }
      });
    };

    const cleanup = () => {
      window.clearTimeout(frameTimer);
      window.clearInterval(snapshotTimer);
      interfaceListeners.forEach(([eventName, listener]) => {
        roomElement.removeEventListener(eventName, listener, true);
      });
      audioNodes.forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // The audio graph may already be disconnected.
        }
      });
    };

    try {
      const {
        BufferTarget,
        CanvasSource,
        MediaStreamAudioTrackSource,
        Mp4OutputFormat,
        Output,
        canEncodeAudio,
        canEncodeVideo,
      } = await import("mediabunny");
      const videoBitrate = 12_000_000;
      const videoSupported = await canEncodeVideo("avc", {
        bitrate: videoBitrate,
        height: canvas.height,
        width: canvas.width,
      });
      if (!videoSupported) {
        showMeetToast(
          "recording-unsupported",
          copyRef.current.meetRecordingUnsupported,
          "warning",
        );
        return;
      }

      const target = new BufferTarget();
      output = new Output({
        format: new Mp4OutputFormat({ fastStart: "in-memory" }),
        target,
      });
      const videoSource = new CanvasSource(canvas, {
        bitrate: videoBitrate,
        codec: "avc",
        keyFrameInterval: 2,
        sizeChangeBehavior: "deny",
      });
      output.addVideoTrack(videoSource, {
        frameRate: 30,
        name: "Munetios Meet",
      });

      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      audioContext = AudioContextClass ? new AudioContextClass() : null;
      const audioDestination = audioContext?.createMediaStreamDestination();
      const connectAudio = (stream) => {
        if (!audioContext || !audioDestination) return;
        const freshTracks =
          stream
            ?.getAudioTracks()
            .filter(
              (track) =>
                track.readyState === "live" && !connectedTrackIds.has(track.id),
            ) || [];
        if (!freshTracks.length) return;
        freshTracks.forEach((track) => {
          connectedTrackIds.add(track.id);
        });
        const node = audioContext.createMediaStreamSource(
          new MediaStream(freshTracks),
        );
        node.connect(audioDestination);
        audioNodes.push(node);
      };
      connectAudio(localStreamRef.current);
      if (screenAudioTrackRef.current) {
        connectAudio(new MediaStream([screenAudioTrackRef.current]));
      }
      for (const connection of peerConnectionsRef.current.values()) {
        connectAudio(connection.munetiosRemoteStream);
      }

      const mixedAudioTrack = audioDestination?.stream.getAudioTracks()[0];
      if (
        mixedAudioTrack &&
        (await canEncodeAudio("aac", {
          bitrate: 192_000,
          numberOfChannels: 2,
          sampleRate: audioContext.sampleRate,
        }))
      ) {
        audioSource = new MediaStreamAudioTrackSource(
          mixedAudioTrack,
          {
            bitrate: 192_000,
            codec: "aac",
          },
          { timestampBase: "synced-zero" },
        );
        output.addAudioTrack(audioSource, { name: "Meeting audio" });
      }

      output.setMetadataTags({
        artist: "Munetios Meet",
        creationTime: new Date(),
        title: `Munetios Meet ${credentialsRef.current?.roomId || "meeting"}`,
      });
      await audioContext?.resume();
      await captureInterface();
      drawFrame();
      await output.start();

      recordingStartedAtRef.current = Date.now();
      recordingRoomIdRef.current = credentialsRef.current?.roomId || "meeting";
      let frameIndex = 0;
      const frameRate = 30;
      const frameDuration = 1 / frameRate;
      const recordingClockStartedAt = performance.now();

      const connectNewRemoteAudio = () => {
        for (const connection of peerConnectionsRef.current.values()) {
          connectAudio(connection.munetiosRemoteStream);
        }
      };

      controller = {
        state: "recording",
        async stop() {
          if (this.state !== "recording") return;
          this.state = "stopping";
          setRecordingSaving(true);
          setRecording(false);
          publishMediaState({ recordingOn: false });
          cleanup();
          try {
            await pendingFrame;
            videoSource.close();
            audioSource?.close();
            await output.finalize();
            const buffer = target.buffer;
            if (!buffer?.byteLength) {
              throw new Error("The recording output was empty.");
            }
            const blob = new Blob([buffer], { type: "video/mp4" });
            const durationSeconds = Math.max(
              1,
              Math.round((Date.now() - recordingStartedAtRef.current) / 1000),
            );
            this.state = "inactive";
            mediaRecorderRef.current = null;
            await finishRecording(blob, durationSeconds);
          } catch {
            this.state = "inactive";
            mediaRecorderRef.current = null;
            setRecordingSaving(false);
            try {
              if (output.state !== "finalized" && output.state !== "canceled") {
                await output.cancel();
              }
            } catch {
              // The encoder may already have released its resources.
            }
            showMeetToast(
              "recording-failed",
              copyRef.current.meetSomethingWentWrongToast,
            );
          } finally {
            void audioContext?.close();
          }
        },
      };

      const encodeNextFrame = () => {
        if (controller.state !== "recording") return;
        pendingFrame = (async () => {
          connectNewRemoteAudio();
          drawFrame();
          await videoSource.add(frameIndex * frameDuration, frameDuration, {
            keyFrame: frameIndex % (frameRate * 2) === 0,
          });
          frameIndex += 1;
          if (controller.state !== "recording") return;
          const nextFrameAt =
            recordingClockStartedAt + frameIndex * frameDuration * 1000;
          frameTimer = window.setTimeout(
            encodeNextFrame,
            Math.max(0, nextFrameAt - performance.now()),
          );
        })().catch(async () => {
          if (controller.state !== "recording") return;
          controller.state = "inactive";
          cleanup();
          mediaRecorderRef.current = null;
          setRecording(false);
          setRecordingSaving(false);
          publishMediaState({ recordingOn: false });
          try {
            videoSource.close();
            audioSource?.close();
            if (output.state !== "finalized" && output.state !== "canceled") {
              await output.cancel();
            }
          } catch {
            // The encoder may already have released its resources.
          }
          void audioContext?.close();
          showMeetToast(
            "recording-failed",
            copyRef.current.meetSomethingWentWrongToast,
          );
        });
      };

      const requestInterfaceCapture = () => {
        void captureInterface();
      };
      ["pointerup", "input", "change", "transitionend"].forEach((eventName) => {
        roomElement.addEventListener(eventName, requestInterfaceCapture, true);
        interfaceListeners.push([eventName, requestInterfaceCapture]);
      });
      snapshotTimer = window.setInterval(() => {
        void captureInterface();
      }, 500);

      mediaRecorderRef.current = controller;
      encodeNextFrame();
      setRecording(true);
      publishMediaState({ recordingOn: true });
      showMeetToast(
        "recording-started",
        copyRef.current.meetRecordingStarted,
        "success",
      );
    } catch {
      cleanup();
      try {
        if (
          output &&
          output.state !== "finalized" &&
          output.state !== "canceled"
        ) {
          await output.cancel();
        }
      } catch {
        // The output may not have completed initialization.
      }
      void audioContext?.close();
      mediaRecorderRef.current = null;
      setRecording(false);
      setRecordingSaving(false);
      publishMediaState({ recordingOn: false });
      showMeetToast(
        "recording-failed",
        copyRef.current.meetSomethingWentWrongToast,
      );
    }
  }, [finishRecording, publishMediaState]);

  const startRecording = useCallback(async () => {
    if (
      !navigator.mediaDevices?.getDisplayMedia ||
      typeof VideoEncoder === "undefined" ||
      typeof VideoFrame === "undefined"
    ) {
      showMeetToast(
        "recording-unsupported",
        copyRef.current.meetRecordingUnsupported,
        "warning",
      );
      return;
    }

    let displayStream = null;
    let output = null;
    let audioContext = null;
    let audioSource = null;
    let videoSource = null;
    let audioSyncTimer = 0;
    const audioNodes = [];
    const connectedAudioTrackIds = new Set();
    let controller = null;
    const qualityProfile =
      recordingQualityProfiles[recordingQualityRef.current] ||
      recordingQualityProfiles.medium;
    const keyFrameInterval =
      recordingChunkIntervals[recordingEncodingChunksRef.current] ||
      recordingChunkIntervals.default;

    const stopDisplayTracks = () => {
      window.clearInterval(audioSyncTimer);
      for (const node of audioNodes) {
        try {
          node.disconnect();
        } catch {
          // The audio graph may already have been disconnected.
        }
      }
      for (const track of displayStream?.getTracks() || []) {
        track.onended = null;
        track.stop();
      }
    };

    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("Audio recording is not supported.");
      }
      audioContext = new AudioContextClass({
        latencyHint: "playback",
        sampleRate: 48_000,
      });
      await audioContext.resume();

      displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        monitorTypeSurfaces: "include",
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "include",
        video: {
          frameRate: {
            ideal: qualityProfile.frameRate,
            max: qualityProfile.frameRate,
          },
          height: {
            ideal: qualityProfile.height,
            max: qualityProfile.height,
          },
          width: {
            ideal: qualityProfile.width,
            max: qualityProfile.width,
          },
        },
      });
      const displayVideoTrack = displayStream.getVideoTracks()[0];
      if (!displayVideoTrack) {
        throw new Error("No screen source was selected.");
      }
      const displaySettings = displayVideoTrack.getSettings();

      const {
        BufferTarget,
        MediaStreamAudioTrackSource,
        MediaStreamVideoTrackSource,
        Mp4OutputFormat,
        Output,
        canEncodeAudio,
        canEncodeVideo,
      } = await import("mediabunny");
      const width = Math.max(2, Number(displaySettings.width) || 1920);
      const height = Math.max(2, Number(displaySettings.height) || 1080);
      const videoBitrate = qualityProfile.videoBitrate;
      if (
        !(await canEncodeVideo("avc", {
          bitrate: videoBitrate,
          height,
          width,
        }))
      ) {
        throw new Error("AVC screen recording is not supported.");
      }

      const target = new BufferTarget();
      output = new Output({
        format: new Mp4OutputFormat({ fastStart: "in-memory" }),
        target,
      });
      videoSource = new MediaStreamVideoTrackSource(
        displayVideoTrack,
        {
          bitrate: videoBitrate,
          codec: "avc",
          keyFrameInterval,
          sizeChangeBehavior: "contain",
        },
        {
          frameRate: qualityProfile.frameRate,
          timestampBase: "synced-zero",
        },
      );
      output.addVideoTrack(videoSource, {
        frameRate: qualityProfile.frameRate,
        name: "Munetios Meet",
      });

      const audioDestination = audioContext.createMediaStreamDestination();
      const connectAudio = (stream) => {
        const freshTracks =
          stream
            ?.getAudioTracks()
            .filter(
              (track) =>
                track.readyState === "live" &&
                !connectedAudioTrackIds.has(track.id),
            ) || [];
        if (!freshTracks.length) return;
        for (const track of freshTracks) {
          connectedAudioTrackIds.add(track.id);
        }
        const node = audioContext.createMediaStreamSource(
          new MediaStream(freshTracks),
        );
        node.connect(audioDestination);
        audioNodes.push(node);
      };

      const capturedScreenAudio = displayStream.getAudioTracks().length > 0;
      const syncRecordingAudio = () => {
        if (capturedScreenAudio) connectAudio(displayStream);
        connectAudio(localStreamRef.current);
        if (!capturedScreenAudio && screenAudioTrackRef.current) {
          connectAudio(new MediaStream([screenAudioTrackRef.current]));
        }
        if (!capturedScreenAudio) {
          for (const connection of peerConnectionsRef.current.values()) {
            connectAudio(connection.munetiosRemoteStream);
          }
        }
      };
      syncRecordingAudio();
      audioSyncTimer = window.setInterval(syncRecordingAudio, 1000);

      const mixedAudioTrack = audioDestination.stream.getAudioTracks()[0];
      if (!mixedAudioTrack) {
        throw new Error("The recording audio mix could not be created.");
      }
      const audioChannelCount = Math.max(
        1,
        Number(mixedAudioTrack.getSettings().channelCount) || 2,
      );
      let audioCodec = "";
      for (const codec of ["aac", "opus"]) {
        if (
          await canEncodeAudio(codec, {
            bitrate: qualityProfile.audioBitrate,
            numberOfChannels: audioChannelCount,
            sampleRate: audioContext.sampleRate,
          })
        ) {
          audioCodec = codec;
          break;
        }
      }
      if (!audioCodec) {
        throw new Error("No compatible recording audio encoder was found.");
      }
      audioSource = new MediaStreamAudioTrackSource(
        mixedAudioTrack,
        {
          bitrate: qualityProfile.audioBitrate,
          codec: audioCodec,
        },
        { timestampBase: "synced-zero" },
      );
      output.addAudioTrack(audioSource, { name: "Meeting audio" });

      output.setMetadataTags({
        artist: "Munetios Meet",
        title: `Munetios Meet ${credentialsRef.current?.roomId || "meeting"}`,
      });
      await output.start();

      recordingStartedAtRef.current = Date.now();
      recordingRoomIdRef.current = credentialsRef.current?.roomId || "meeting";

      controller = {
        state: "recording",
        async stop() {
          if (this.state !== "recording") return;
          this.state = "stopping";
          setRecordingSaving(true);
          setRecording(false);
          publishMediaState({ recordingOn: false });
          stopDisplayTracks();
          try {
            videoSource.close();
            audioSource?.close();
            await output.finalize();
            const buffer = target.buffer;
            if (!buffer?.byteLength) {
              throw new Error("The recording output was empty.");
            }
            const durationSeconds = Math.max(
              1,
              Math.round((Date.now() - recordingStartedAtRef.current) / 1000),
            );
            this.state = "inactive";
            mediaRecorderRef.current = null;
            await finishRecording(
              new Blob([buffer], { type: "video/mp4" }),
              durationSeconds,
            );
          } catch {
            this.state = "inactive";
            mediaRecorderRef.current = null;
            setRecordingSaving(false);
            try {
              if (output.state !== "finalized" && output.state !== "canceled") {
                await output.cancel();
              }
            } catch {
              // The output may already have released its encoders.
            }
            showMeetToast(
              "recording-failed",
              copyRef.current.meetSomethingWentWrongToast,
            );
          } finally {
            void audioContext?.close();
          }
        },
      };

      displayVideoTrack.onended = () => {
        void controller?.stop();
      };
      videoSource.errorPromise.catch(() => {
        void controller?.stop();
      });
      audioSource?.errorPromise.catch(() => {
        void controller?.stop();
      });
      mediaRecorderRef.current = controller;
      setRecording(true);
      publishMediaState({ recordingOn: true });
      showMeetToast(
        "recording-started",
        copyRef.current.meetRecordingStarted,
        "success",
      );
    } catch (error) {
      stopDisplayTracks();
      try {
        if (
          output &&
          output.state !== "finalized" &&
          output.state !== "canceled"
        ) {
          await output.cancel();
        }
      } catch {
        // The output may not have completed initialization.
      }
      void audioContext?.close();
      mediaRecorderRef.current = null;
      setRecording(false);
      setRecordingSaving(false);
      publishMediaState({ recordingOn: false });
      const permissionDenied =
        error?.name === "NotAllowedError" || error?.name === "AbortError";
      showMeetToast(
        permissionDenied ? "recording-permission-denied" : "recording-failed",
        permissionDenied
          ? copyRef.current.meetScreenShareDeniedToast
          : copyRef.current.meetSomethingWentWrongToast,
        "warning",
      );
    }
  }, [finishRecording, publishMediaState]);

  const toggleRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      setRecordingSaving(true);
      try {
        recorder.stop();
      } catch {
        setRecordingSaving(false);
        showMeetToast(
          "recording-failed",
          copyRef.current.meetSomethingWentWrongToast,
        );
      }
      return;
    }
    void startRecording();
  }, [startRecording]);

  const updateProfileStatus = async (emoji) => {
    const previousEmoji = statusEmoji;
    setStatusEmoji(emoji);
    setStatusOpen(false);
    try {
      await realtimePost({
        action: "profile-status",
        ...credentialsPayload(credentialsRef.current),
        emoji,
      });
    } catch {
      setStatusEmoji(previousEmoji);
      void playSound("error");
      showMeetToast("profile-status-failed", copy.meetSomethingWentWrongToast);
    }
  };

  const startActivity = async (type, options) => {
    try {
      const preferences = await loadMeetPreferences(signedIn);
      const wordHuntCustomWords =
        type === "wordhunt"
          ? String(preferences.wordHuntCustomWords || "")
          : "";
      const cheats = {
        aiPlaysWordHunt: preferences.aiPlaysWordHunt === true,
        allowAnyAnagramWord: preferences.allowAnyAnagramWord === true,
        alwaysShowAllWords: preferences.alwaysShowAllActivityWords === true,
        customChessRules: preferences.customChessRules === true,
        enabled: preferences.activityCheatsEnabled === true,
        ignoreChessMoveRules: preferences.ignoreChessMoveRules === true,
        ignoreDictionary: preferences.ignoreActivityDictionary === true,
        shareFoundWords: preferences.shareFoundActivityWords === true,
      };
      const payload = await realtimePost({
        action: "activity-start",
        ...credentialsPayload(credentialsRef.current),
        cheats,
        type,
        ...options,
        ...(type === "wordhunt" ? { customWords: wordHuntCustomWords } : {}),
      });
      activityRef.current = payload.activity;
      setActivity(payload.activity);
      setActivitiesOpen(false);
      if (activitiesSound) void playSound("activityStarted");
    } catch {
      void playSound("error");
      showMeetToast("activity-launch-failed", copy.meetActivityLaunchFailed);
    }
  };

  const joinActivity = async () => {
    try {
      const payload = await realtimePost({
        action: "activity-join",
        ...credentialsPayload(credentialsRef.current),
      });
      activityRef.current = payload.activity;
      setActivity(payload.activity);
    } catch {
      void playSound("error");
      showMeetToast("activity-join-failed", copy.meetActivityJoinFailed);
    }
  };

  const updateActivity = async (activityPayload) => {
    try {
      const payload = await realtimePost({
        action: "activity-update",
        ...credentialsPayload(credentialsRef.current),
        activityPayload,
      });
      activityRef.current = payload.activity;
      setActivity(payload.activity);
      if (payload.points && activitiesSound) {
        await playAnagramScore(payload.points).catch(() => {});
      }
      return true;
    } catch (error) {
      const message =
        error.message === "activity_word_already_used"
          ? copy.meetActivityWordAlreadyUsed
          : error.message === "activity_invalid_word"
            ? copy.meetActivityInvalidWord
            : error.message === "activity_not_your_turn"
              ? copy.meetActivityNotYourTurn
              : copy.meetActivityFailed;
      void playSound("error");
      showMeetToast(`activity-${error.message}`, message, "warning");
      return false;
    }
  };

  const endActivity = async () => {
    try {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        setRecordingSaving(true);
        try {
          recorder.stop();
        } catch {
          setRecordingSaving(false);
        }
      }
      const payload = await realtimePost({
        action: "activity-end",
        ...credentialsPayload(credentialsRef.current),
      });
      activityRef.current = payload.activity;
      setActivity(payload.activity);
      setActivitiesOpen(true);
      if (activitiesSound) void playSound("activityEnded");
    } catch {
      void playSound("error");
      showMeetToast("activity-end-failed", copy.meetActivityFailed);
    }
  };

  const copyInviteCode = async () => {
    if (!localIdentity?.roomId) return;
    try {
      await navigator.clipboard.writeText(localIdentity.roomId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      showMeetToast("clipboard-failed", copy.meetClipboardFailed, "warning");
    }
  };

  const sendChatMessage = async ({ body, imageUrl }) => {
    try {
      const cryptoKey = getMeetingCryptoKey();
      const encryptedBody = cryptoKey
        ? await encryptMeetingContent(await cryptoKey, { body, imageUrl })
        : body;
      await realtimePost({
        action: "chat-send",
        ...credentialsPayload(credentialsRef.current),
        body: encryptedBody,
        imageUrl: cryptoKey ? null : imageUrl,
      });
      return true;
    } catch {
      void playSound("error");
      showMeetToast("chat-send-failed", copy.meetMessageSendFailed);
      return false;
    }
  };

  const editChatMessage = async (messageId, body) => {
    try {
      const cryptoKey = getMeetingCryptoKey();
      const encryptedBody = cryptoKey
        ? await encryptMeetingContent(await cryptoKey, {
            body,
            imageUrl: null,
          })
        : body;
      await realtimePost({
        action: "chat-edit",
        ...credentialsPayload(credentialsRef.current),
        body: encryptedBody,
        messageId,
      });
      return true;
    } catch {
      void playSound("error");
      showMeetToast("chat-edit-failed", copy.meetSomethingWentWrongToast);
      return false;
    }
  };

  const reactToChatMessage = async (messageId, emoji) => {
    try {
      await realtimePost({
        action: "chat-react",
        ...credentialsPayload(credentialsRef.current),
        emoji,
        messageId,
      });
    } catch {
      void playSound("error");
      showMeetToast("chat-reaction-failed", copy.meetSomethingWentWrongToast);
    }
  };

  const moderateParticipant = async (action, peerId) => {
    try {
      await realtimePost({
        action,
        ...credentialsPayload(credentialsRef.current),
        targetPeerId: peerId,
      });
    } catch {
      void playSound("error");
      showMeetToast("action-failed", copy.meetSomethingWentWrongToast);
    }
  };

  const confirmModeration = (action, participant) => {
    const isBan = action === "ban";
    showModerationConfirmation({
      cancelLabel: copy.cancel,
      confirmLabel: isBan ? copy.meetBan : copy.meetKick,
      description: (isBan
        ? copy.meetConfirmBanDescription
        : copy.meetConfirmKickDescription
      ).replace("{name}", participant.displayName),
      onConfirm: () => moderateParticipant(action, participant.peerId),
      title: isBan ? copy.meetConfirmBanTitle : copy.meetConfirmKickTitle,
    });
  };

  const confirmLeaveMeeting = () => {
    showModerationConfirmation({
      cancelLabel: copy.meetStayInCall,
      confirmLabel: copy.meetLeaveCall,
      description: copy.meetLeaveCallDescription,
      onConfirm: leaveMeeting,
      title: copy.meetLeaveCallTitle,
    });
  };

  const toggleParticipantMute = (participant) => {
    const next = new Set(mutedPeerIdsRef.current);
    if (next.has(participant.peerId)) {
      next.delete(participant.peerId);
    } else {
      next.add(participant.peerId);
    }
    mutedPeerIdsRef.current = next;
    setMutedPeerIds(next);
    const remoteStream = peerConnectionsRef.current.get(
      participant.peerId,
    )?.munetiosRemoteStream;
    for (const track of remoteStream?.getAudioTracks() || []) {
      track.enabled = !next.has(participant.peerId);
    }
  };

  const blockParticipant = async (participant) => {
    blockedPeerIdsRef.current.add(participant.peerId);
    peerConnectionsRef.current.get(participant.peerId)?.close();
    peerConnectionsRef.current.delete(participant.peerId);
    setParticipants((current) =>
      current.filter((item) => item.peerId !== participant.peerId),
    );
    setFocusedPeerId((current) =>
      current === participant.peerId ? "" : current,
    );
    const person = {
      avatarUrl: participant.avatarUrl || null,
      blockedAt: new Date().toISOString(),
      id: participant.userKey || participant.peerId,
      name: participant.displayName,
    };
    if (signedIn) {
      const response = await fetch("/api/meet", {
        body: JSON.stringify({ action: "block_person", person }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).catch(() => null);
      if (!response?.ok) {
        void playSound("error");
        showMeetToast("action-failed", copy.meetSomethingWentWrongToast);
      }
    } else {
      try {
        const current = JSON.parse(
          window.localStorage.getItem(localMeetSettingsKey) || "{}",
        );
        window.localStorage.setItem(
          localMeetSettingsKey,
          JSON.stringify({
            ...current,
            blockedPeople: [
              person,
              ...(Array.isArray(current.blockedPeople)
                ? current.blockedPeople.filter((item) => item.id !== person.id)
                : []),
            ].slice(0, 100),
          }),
        );
      } catch {}
    }
    window.dispatchEvent(new Event("munetios:meetdatachange"));
  };

  if (status === "kicked" || status === "banned") {
    return (
      <section className="meet-room-state">
        <div className="meet-room-state-card liquid-glass" role="alert">
          <span className="meet-room-state-icon">
            <icon>person_remove</icon>
          </span>
          <h1>
            {status === "kicked"
              ? copy.meetKickedOut
              : copy.meetBannedFromMeeting}
          </h1>
          <button onClick={onLeave} type="button">
            <icon>arrow_back</icon>
            {copy.close}
          </button>
        </div>
      </section>
    );
  }

  const localParticipant = {
    avatarUrl: localIdentity?.avatarUrl,
    displayName: localIdentity?.displayName || copy.meetYou,
    peerId: localIdentity?.peerId,
    statusEmoji,
  };
  const visibleParticipants = focusedPeerId
    ? participants.filter((participant) => participant.peerId === focusedPeerId)
    : participants;
  const meetingConnected = status === "connected";
  const liveTranscriptionText = [
    liveTranscriptionFinal,
    liveTranscriptionInterim,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const displayedRoomId =
    localIdentity?.roomId || request.roomId || copy.meetStartingMeeting;
  const retryMeeting = () => {
    setActivitiesOpen(false);
    setChatOpen(false);
    setFriendsOpen(false);
    setStatusOpen(false);
    setStatus("connecting");
    setStartAttempt((current) => current + 1);
  };

  return (
    <section
      className={`meet-room${chatOpen ? " has-chat-open" : ""}${
        activitiesOpen ? " has-activity-open" : ""
      }`}
      style={{ "--meet-chat-width": `${chatPanelWidth}px` }}
    >
      <header className="meet-room-topbar">
        <button
          className="meet-invite-code liquid-glass"
          disabled={!localIdentity?.roomId}
          onClick={copyInviteCode}
          type="button"
        >
          <icon className="meet-invite-code-icon">
            {copied ? "check" : "link"}
          </icon>
          <span>
            <small>{copied ? copy.copied : copy.meetInviteCode}</small>
            <strong>{displayedRoomId}</strong>
          </span>
        </button>
        <div className="meet-room-topbar-right liquid-glass">
          <button
            aria-expanded={friendsOpen}
            onClick={() => {
              setFriendsOpen((current) => {
                const next = !current;
                if (next) {
                  friendsLoadFailedRef.current = false;
                  setChatOpen(false);
                  setActivitiesOpen(false);
                  if (!meetingConnected) {
                    friendsLoadFailedRef.current = true;
                    showMeetToast(
                      "friends-load-failed",
                      copy.meetFriendsLoadFailed,
                    );
                  }
                }
                return next;
              });
            }}
            type="button"
            className="friendsButton"
          >
            <icon>group</icon>
            <span>{copy.meetFriends}</span>
            <strong>{participants.length + 1}</strong>
          </button>
          <button
            aria-label={copy.settings}
            onClick={() => openMeetSettingsModal({ copy, signedIn })}
            type="button"
          >
            <icon>settings</icon>
          </button>
        </div>
      </header>

      {recording || participants.some((participant) => participant.recordingOn)
        ? <output className="meet-recording-indicator liquid-glass">
            <span />
            {copy.meetRecordingInProgress}
          </output>
        : null}

      {liveTranscriptionEnabled
        ? <output
            aria-atomic="false"
            aria-label={copy.meetLiveTranscript}
            aria-live="polite"
            className="meet-live-transcription liquid-glass"
          >
            <icon className="meet-live-transcription-icon">closed_caption</icon>
            <span>
              {liveTranscriptionText || copy.meetLiveTranscriptionListening}
            </span>
          </output>
        : null}

      <div
        className={`meet-video-grid${focusedPeerId ? " is-focused" : ""}${
          meetingConnected ? "" : " is-state"
        }`}
      >
        {status === "connecting"
          ? <section
              aria-label={copy.meetStartingMeeting}
              className="meet-room-state meet-room-inline-state"
            >
              <LoadingSpinner label={copy.meetStartingMeeting} />
            </section>
          : status === "failed"
            ? <section className="meet-room-state meet-room-inline-state">
                <div className="meet-room-state-card liquid-glass" role="alert">
                  <span className="meet-room-state-icon">
                    <icon>error</icon>
                  </span>
                  <h1>{copy.meetStartFailed}</h1>
                  <button onClick={retryMeeting} type="button">
                    <icon>refresh</icon>
                    {copy.retry}
                  </button>
                </div>
              </section>
            : <>
                {!focusedPeerId
                  ? <ParticipantTile
                      actions={
                        <DropdownWrapper
                          ariaLabel={copy.meetCameraActions}
                          buttonClassName="meet-camera-actions-trigger liquid-glass"
                          className="meet-camera-actions-dropdown"
                          panelClassName="meet-camera-actions-menu"
                          trigger={
                            <>
                              <icon>video_settings</icon>
                              <span>{copy.meetCameraActions}</span>
                            </>
                          }
                          triggerAs="button"
                          triggerGlass={false}
                        >
                          <p
                            className="meet-camera-actions-title"
                            role="presentation"
                          >
                            {copy.meetCameraActions}
                          </p>
                          <button
                            aria-checked={backgroundBlurEnabled}
                            className="meet-camera-action-item"
                            data-dropdown-keep-open="true"
                            onClick={() => void toggleBackgroundBlur()}
                            role="menuitemcheckbox"
                            type="button"
                          >
                            <icon className="meet-camera-action-icon">
                              blur_on
                            </icon>
                            <span>
                              <strong>{copy.meetBackgroundBlur}</strong>
                              <small>
                                {backgroundBlurAvailable
                                  ? copy.meetBackgroundBlurDescription
                                  : copy.meetBackgroundBlurUnavailable}
                              </small>
                            </span>
                            <i
                              aria-hidden="true"
                              data-active={backgroundBlurEnabled}
                            >
                              <span />
                            </i>
                          </button>
                          <button
                            aria-checked={liveTranscriptionEnabled}
                            className="meet-camera-action-item"
                            data-dropdown-keep-open="true"
                            onClick={toggleLiveTranscription}
                            role="menuitemcheckbox"
                            type="button"
                          >
                            <icon className="meet-camera-action-icon">
                              closed_caption
                            </icon>
                            <span>
                              <strong>{copy.meetLiveTranscription}</strong>
                              <small>
                                {liveTranscriptionAvailable
                                  ? copy.meetLiveTranscriptionDescription
                                  : copy.meetLiveTranscriptionUnavailable}
                              </small>
                            </span>
                            <i
                              aria-hidden="true"
                              data-active={liveTranscriptionEnabled}
                            >
                              <span />
                            </i>
                          </button>
                        </DropdownWrapper>
                      }
                      copy={copy}
                      local
                      localCameraOn={cameraOn}
                      localCameraStream={localCameraPreviewStream}
                      localScreenSharing={screenSharing}
                      localScreenStream={localScreenPreviewStream}
                      participant={localParticipant}
                    />
                  : null}
                {visibleParticipants.map((participant) => (
                  <ParticipantTile
                    actions={
                      <button
                        aria-label={`${copy.meetLiveTranscription}: ${participant.displayName}`}
                        aria-pressed={liveTranscriptionEnabled}
                        className="meet-participant-transcription-button liquid-glass"
                        onClick={toggleLiveTranscription}
                        title={copy.meetLiveTranscription}
                        type="button"
                      >
                        <icon>closed_caption</icon>
                      </button>
                    }
                    copy={copy}
                    focused={focusedPeerId === participant.peerId}
                    key={participant.peerId}
                    participant={participant}
                  />
                ))}
                {activity && !focusedPeerId
                  ? <MeetActivityTile
                      activity={activity}
                      copy={copy}
                      localPeerId={localIdentity?.peerId}
                      onEnd={endActivity}
                      onJoin={joinActivity}
                      onUpdate={updateActivity}
                    />
                  : null}
              </>}
      </div>

      {friendsOpen
        ? <aside className="meet-friends-panel liquid-glass">
            <header>
              <span>
                <small>{copy.meetInThisMeeting}</small>
                <h2>{copy.meetFriends}</h2>
              </span>
              <button
                aria-label={copy.close}
                onClick={() => setFriendsOpen(false)}
                type="button"
              >
                <icon>close</icon>
              </button>
            </header>
            <div className="meet-friends-list">
              <div className="meet-friend-row">
                <AccountAvatar
                  account={localParticipant}
                  alt={localParticipant.displayName}
                  className="meet-friend-avatar"
                />
                <span>
                  <strong>
                    {localParticipant.displayName}
                    {localParticipant.statusEmoji
                      ? <i className="meet-friend-status">
                          {localParticipant.statusEmoji}
                        </i>
                      : null}
                  </strong>
                  <small>{copy.meetYou}</small>
                </span>
              </div>
              {participants.map((participant) => (
                <div className="meet-friend-row" key={participant.peerId}>
                  <AccountAvatar
                    account={participant}
                    alt={participant.displayName}
                    className="meet-friend-avatar"
                  />
                  <span>
                    <strong>
                      {participant.displayName}
                      {participant.statusEmoji
                        ? <i className="meet-friend-status">
                            {participant.statusEmoji}
                          </i>
                        : null}
                    </strong>
                  </span>
                  <DropdownWrapper
                    ariaLabel={copy.moreOptions}
                    buttonClassName="meet-friend-more"
                    panelClassName="w-52"
                    trigger={<icon>more_vert</icon>}
                    triggerGlass={false}
                  >
                    <button
                      className="meet-menu-item"
                      data-dropdown-close
                      onClick={() => {
                        setFocusedPeerId(participant.peerId);
                        setFriendsOpen(false);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <icon>center_focus_strong</icon>
                      <span>{copy.meetSeePerson}</span>
                    </button>
                    <button
                      className="meet-menu-item"
                      data-dropdown-close
                      onClick={() => toggleParticipantMute(participant)}
                      role="menuitem"
                      type="button"
                    >
                      <icon>
                        {mutedPeerIds.has(participant.peerId)
                          ? "volume_up"
                          : "volume_off"}
                      </icon>
                      <span>
                        {mutedPeerIds.has(participant.peerId)
                          ? copy.meetUnmute
                          : copy.meetMute}
                      </span>
                    </button>
                    <button
                      className="meet-menu-item"
                      data-dropdown-close
                      onClick={() => void blockParticipant(participant)}
                      role="menuitem"
                      type="button"
                    >
                      <icon>block</icon>
                      <span>{copy.meetBlockUser}</span>
                    </button>
                    {localIdentity?.owner
                      ? <>
                          <button
                            className="meet-menu-item is-danger"
                            data-dropdown-close
                            onClick={() =>
                              confirmModeration("kick", participant)
                            }
                            role="menuitem"
                            type="button"
                          >
                            <icon>person_remove</icon>
                            <span>{copy.meetKick}</span>
                          </button>
                          <button
                            className="meet-menu-item is-danger"
                            data-dropdown-close
                            onClick={() =>
                              confirmModeration("ban", participant)
                            }
                            role="menuitem"
                            type="button"
                          >
                            <icon>gavel</icon>
                            <span>{copy.meetBan}</span>
                          </button>
                        </>
                      : null}
                  </DropdownWrapper>
                </div>
              ))}
            </div>
          </aside>
        : null}

      <MeetChatPanel
        copy={copy}
        localPeerId={localIdentity?.peerId}
        messages={chatMessages}
        onClose={() => setChatOpen(false)}
        onEdit={editChatMessage}
        onReact={reactToChatMessage}
        onSend={sendChatMessage}
        open={chatOpen}
        panelWidth={chatPanelWidth}
        setPanelWidth={setChatPanelWidth}
        ttsVoice={ttsVoice}
      />

      <MeetActivitiesPanel
        allowOthers={allowOthersJoinActivity}
        copy={copy}
        onClose={() => setActivitiesOpen(false)}
        onStart={startActivity}
        open={activitiesOpen}
      />

      {focusedPeerId
        ? <button
            className="meet-exit-focus liquid-glass"
            onClick={() => setFocusedPeerId("")}
            type="button"
          >
            <icon>grid_view</icon>
            {copy.meetShowEveryone}
          </button>
        : null}

      {statusOpen
        ? <MeetStatusPicker
            copy={copy}
            onClose={() => setStatusOpen(false)}
            onSelect={(emoji) => void updateProfileStatus(emoji)}
            selectedEmoji={statusEmoji}
          />
        : null}

      <nav
        aria-label={copy.meetCallControls}
        className="meet-call-controls liquid-glass"
      >
        <button
          aria-label={microphoneOn ? copy.meetMute : copy.meetUnmute}
          aria-pressed={!microphoneOn}
          data-active={microphoneOn}
          data-tooltip={microphoneOn ? copy.meetMute : copy.meetUnmute}
          disabled={!mediaReady}
          onClick={toggleMicrophone}
          type="button"
        >
          <icon className="meet-call-control-icon">
            {microphoneOn ? "mic" : "mic_off"}
          </icon>
        </button>
        <button
          aria-label={cameraOn ? copy.meetTurnCameraOff : copy.meetTurnCameraOn}
          aria-pressed={!cameraOn}
          data-active={cameraOn}
          data-tooltip={
            cameraOn ? copy.meetTurnCameraOff : copy.meetTurnCameraOn
          }
          disabled={!mediaReady}
          onClick={() => void toggleCamera()}
          type="button"
        >
          <icon className="meet-call-control-icon">
            {cameraOn ? "videocam" : "videocam_off"}
          </icon>
        </button>
        <button
          aria-label={
            screenSharing ? copy.meetStopSharing : copy.meetShareScreen
          }
          aria-pressed={screenSharing}
          data-active={screenSharing}
          data-tooltip={
            screenSharing ? copy.meetStopSharing : copy.meetShareScreen
          }
          disabled={!mediaReady}
          onClick={() => void toggleScreenShare()}
          type="button"
        >
          <icon className="meet-call-control-icon">
            {screenSharing ? "stop_screen_share" : "screen_share"}
          </icon>
        </button>
        <button
          aria-expanded={chatOpen}
          aria-label={copy.meetChat}
          aria-pressed={chatOpen}
          className="meet-chat-control"
          data-active={chatOpen}
          data-tooltip={copy.meetChat}
          onClick={() => {
            setChatOpen((current) => {
              const next = !current;
              if (next) {
                setChatUnread(0);
                setFriendsOpen(false);
                setStatusOpen(false);
              }
              return next;
            });
          }}
          type="button"
        >
          <icon className="meet-call-control-icon">chat</icon>
          {chatUnread
            ? <strong
                className="meet-chat-unread-badge"
                title={copy.meetChatUnread}
              >
                {Math.min(chatUnread, 99)}
              </strong>
            : null}
        </button>
        <button
          aria-expanded={activitiesOpen}
          aria-label={copy.meetActivities}
          aria-pressed={activitiesOpen}
          className="meet-activities-control"
          data-active={activitiesOpen}
          data-tooltip={copy.meetActivities}
          onClick={() => {
            setActivitiesOpen((current) => {
              const next = !current;
              if (next) {
                setFriendsOpen(false);
                setStatusOpen(false);
              }
              return next;
            });
          }}
          type="button"
        >
          <icon className="meet-call-control-icon">extension</icon>
          {activity && !activitiesOpen
            ? <strong
                className="meet-chat-unread-badge"
                title={copy.meetActivityInProgress}
              >
                1
              </strong>
            : null}
        </button>
        <button
          aria-expanded={statusOpen}
          aria-label={copy.meetProfileStatus}
          aria-pressed={statusOpen}
          className="meet-status-control"
          data-active={Boolean(statusEmoji) || statusOpen}
          data-tooltip={copy.meetProfileStatus}
          onClick={() => {
            setStatusOpen((current) => !current);
            setActivitiesOpen(false);
            setChatOpen(false);
            setFriendsOpen(false);
          }}
          type="button"
        >
          <icon className="meet-call-control-icon">favorite</icon>
          {statusEmoji
            ? <strong className="meet-status-control-badge">
                {statusEmoji}
              </strong>
            : null}
        </button>
        <button
          aria-label={
            recording ? copy.meetStopRecording : copy.meetStartRecording
          }
          aria-pressed={recording}
          data-active={recording}
          data-tooltip={
            recording ? copy.meetStopRecording : copy.meetStartRecording
          }
          disabled={recordingSaving}
          onClick={toggleRecording}
          type="button"
        >
          <icon className="meet-call-control-icon">
            {recordingSaving
              ? "progress_activity"
              : recording
                ? "stop_circle"
                : "fiber_manual_record"}
          </icon>
        </button>
        <button
          aria-label={copy.meetEndCall}
          className="meet-end-call"
          data-tooltip={copy.meetEndCall}
          onClick={confirmLeaveMeeting}
          type="button"
        >
          <icon className="meet-call-control-icon">call_end</icon>
        </button>
      </nav>
    </section>
  );
}
