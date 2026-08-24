"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import {
  createVoiceConversationKey,
  encryptVoiceConversation,
  withVoiceShareKey,
} from "../lib/voiceConversationCrypto";
import {
  playCameraDenied,
  playCameraStart,
  playCameraStop,
  playMute,
  playShareDenied,
  playShareStart,
  playShareStop,
  playUnmute,
  playVoiceModeDenied,
  playVoiceModeError,
  playVoiceModeStart,
  playVoiceModeStop,
} from "./tonesounds";

const defaultSettings = {
  voiceModePitch: 1,
  voiceModeSpeed: 1,
  voiceModeType: "prompt",
  voiceModeVersion: "new",
  voiceModeVoice: "auto",
};

const voiceModeLeaseKey = "munetios.ai.voiceMode.active";
let lastVoiceRequestFailureToast = 0;

function showVoiceRequestFailure(message) {
  const now = Date.now();
  if (now - lastVoiceRequestFailureToast < 2000) return;
  lastVoiceRequestFailureToast = now;
  showToast({ message, type: "error" });
}

function showShareSignIn(copy) {
  showModal(
    <div className="ai-voice-share-modal">
      <p>{copy.aiGuestPreviewSignInDescription}</p>
      <a
        className="ai-guest-preview-sign-in"
        href={`/signin?returnTo=${encodeURIComponent(window.location.pathname)}`}
      >
        {copy.signIn}
      </a>
    </div>,
    {
      ariaLabel: copy.aiVoiceShare,
      title: copy.aiVoiceShare,
      width: "min(30rem, calc(100vw - 1rem))",
    },
  );
}

function safelyPlay(sound) {
  try {
    void Promise.resolve(sound()).catch(() => undefined);
  } catch {}
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try {
      track.stop();
    } catch {}
  }
}

function selectedVoiceUri(value) {
  if (!String(value || "").startsWith("speech:")) return "";
  try {
    return decodeURIComponent(String(value).slice(7));
  } catch {
    return "";
  }
}

function isMicrophoneDenied(error) {
  return ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(
    error?.name,
  );
}

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function transcriptEntry(role, text) {
  return {
    id: crypto.randomUUID(),
    role,
    text,
  };
}

async function copyToClipboard(text, copy, successMessage = "") {
  if (!document.hasFocus()) {
    showToast({ message: copy.aiSettingsClipboardFocusFailed, type: "error" });
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    if (successMessage) showToast({ message: successMessage, type: "success" });
    return true;
  } catch {
    showToast({
      message: document.hasFocus()
        ? copy.meetClipboardFailed
        : copy.aiSettingsClipboardFocusFailed,
      type: "error",
    });
    return false;
  }
}

function DeviceVoicePicker({ close, copy, onSelect, selectedVoice, voices }) {
  const [savingVoice, setSavingVoice] = useState("");
  const chooseVoice = async (voiceModeVoice) => {
    setSavingVoice(voiceModeVoice);
    try {
      await onSelect(voiceModeVoice);
      close();
    } catch {
      setSavingVoice("");
      showToast({ message: copy.aiVoiceUpdateFailed, type: "error" });
    }
  };
  return (
    <div className="ai-voice-picker-modal-list" role="listbox">
      <button
        aria-selected={selectedVoice === "auto"}
        disabled={Boolean(savingVoice)}
        onClick={() => void chooseVoice("auto")}
        role="option"
        type="button"
      >
        <span>
          <strong>{copy.aiVoiceAutomatic}</strong>
          <small>{copy.aiVoiceLocal}</small>
        </span>
        {selectedVoice === "auto" ? <icon>check</icon> : null}
      </button>
      {voices.map((voice) => {
        const value = `speech:${encodeURIComponent(voice.voiceURI)}`;
        return (
          <button
            aria-selected={selectedVoice === value}
            disabled={Boolean(savingVoice)}
            key={voice.voiceURI}
            onClick={() => void chooseVoice(value)}
            role="option"
            type="button"
          >
            <span>
              <strong>{voice.name}</strong>
              <small>{voice.lang}</small>
            </span>
            {selectedVoice === value ? <icon>check</icon> : null}
          </button>
        );
      })}
      {!voices.length
        ? <p className="ai-voice-picker-modal-empty">
            {copy.aiVoiceNoDeviceVoices}
          </p>
        : null}
    </div>
  );
}

function ManageShareModal({ copy, initialLink }) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState(initialLink);
  const [saving, setSaving] = useState(false);
  const updateMember = async (action, memberEmail) => {
    setSaving(true);
    try {
      const response = await fetch("/api/ai/shared-links", {
        body: JSON.stringify({ action, email: memberEmail, id: link.id }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) throw new Error("member_update_failed");
      const payload = await response.json();
      setLink((current) => ({ ...current, ...payload.link }));
      setEmail("");
    } catch {
      showToast({
        message: copy.aiVoiceShareMemberUpdateFailed,
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="ai-voice-share-manage">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim()) void updateMember("add-member", email.trim());
        }}
      >
        <input
          aria-label={copy.accountProfileEmail}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={copy.accountProfileEmail}
          type="email"
          value={email}
        />
        <button disabled={saving || !email.trim()} type="submit">
          {copy.adminAddUser}
        </button>
      </form>
      <div className="ai-voice-share-members">
        {(link.members || []).map((member) => (
          <article key={member.accountId}>
            <span>
              <strong>{member.name}</strong>
              <small>{member.email}</small>
            </span>
            <button
              aria-label={`${copy.aiVoiceShareRemoveUser}: ${member.email}`}
              disabled={saving}
              onClick={() => void updateMember("remove-member", member.email)}
              type="button"
            >
              <icon>person_remove</icon>
            </button>
          </article>
        ))}
        {!link.members?.length ? <p>{copy.adminNoUsers}</p> : null}
      </div>
    </div>
  );
}

function ShareLinkModal({ copy, link }) {
  return (
    <div className="ai-voice-share-modal">
      <p>{copy.aiVoiceShareLinkDescription}</p>
      <div>
        <input
          aria-label={copy.aiVoiceGeneratedShareLink}
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={link.url}
        />
        <button
          onClick={() => void copyToClipboard(link.url, copy)}
          type="button"
        >
          <icon>content_copy</icon>
          <span>{copy.aiVoiceCopyLink}</span>
        </button>
      </div>
      <a href={link.url} rel="noreferrer" target="_blank">
        {copy.aiVoiceOpenShareLink}
        <icon>open_in_new</icon>
      </a>
      <button
        onClick={() =>
          showModal(<ManageShareModal copy={copy} initialLink={link} />, {
            ariaLabel: copy.aiVoiceShareManage,
            title: copy.aiVoiceShareManage,
            width: "min(34rem, calc(100vw - 1rem))",
          })
        }
        type="button"
      >
        <icon>manage_accounts</icon>
        <span>{copy.aiVoiceShareManage}</span>
      </button>
    </div>
  );
}

export default function VoiceMode({
  appLoading = false,
  copy,
  conversationId = "",
  initialTranscript = [],
  nickname,
  onClose,
  onTranscriptChange = null,
  onSettingsChange,
  promptTarget = null,
  settings: suppliedSettings,
  sharingDisabled = false,
}) {
  const settings = useMemo(
    () => ({ ...defaultSettings, ...(suppliedSettings || {}) }),
    [suppliedSettings],
  );
  const [cameraOn, setCameraOn] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingMessageText, setEditingMessageText] = useState("");
  const [microphoneDenied, setMicrophoneDenied] = useState(false);
  const [muted, setMuted] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [transcript, setTranscript] = useState(initialTranscript);
  const [typedMessage, setTypedMessage] = useState("");
  const [voices, setVoices] = useState([]);
  const [wrapperPosition, setWrapperPosition] = useState(null);
  const cameraPreviewRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const closingRef = useRef(false);
  const connectionAbortRef = useRef(null);
  const credentialsRef = useRef(null);
  const displayStreamRef = useRef(null);
  const displayPreviewRef = useRef(null);
  const initialConnectionRef = useRef({ copy, nickname });
  const initialTranscriptRef = useRef(initialTranscript);
  const lastExternalTranscriptRef = useRef(JSON.stringify(initialTranscript));
  const lastPersistedTranscriptRef = useRef(JSON.stringify(initialTranscript));
  const microphoneDeniedRef = useRef(false);
  const microphoneStreamRef = useRef(null);
  const mutedRef = useRef(true);
  const recognitionRef = useRef(null);
  const restartRecognitionRef = useRef(false);
  const screenSharingRef = useRef(false);
  const speakRef = useRef(() => undefined);
  const failureSpeechTimerRef = useRef(0);
  const transcriptEndRef = useRef(null);
  const voiceLeaseHeartbeatRef = useRef(0);
  const voiceLeaseOwnerRef = useRef(crypto.randomUUID());
  const wrapperDragRef = useRef(null);

  useEffect(() => {
    const serialized = JSON.stringify(initialTranscript);
    if (serialized === lastExternalTranscriptRef.current) return;
    lastExternalTranscriptRef.current = serialized;
    lastPersistedTranscriptRef.current = serialized;
    setTranscript(initialTranscript);
  }, [initialTranscript]);

  useEffect(() => {
    if (!transcript.length || !onTranscriptChange) return undefined;
    const serialized = JSON.stringify(transcript);
    if (serialized === lastPersistedTranscriptRef.current) return undefined;
    const timer = window.setTimeout(() => {
      void Promise.resolve(onTranscriptChange(transcript))
        .then(() => {
          lastPersistedTranscriptRef.current = serialized;
        })
        .catch(() => {
          showVoiceRequestFailure(copy.accountRequestFailed);
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [copy.accountRequestFailed, onTranscriptChange, transcript]);

  const chooseableVoices = useMemo(
    () =>
      voices
        .filter((voice) => voice.localService === true)
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
          }),
        ),
    [voices],
  );

  const syncMediaState = useCallback((patch = {}) => {
    const credentials = credentialsRef.current;
    if (!credentials) return;
    void fetch("/api/realtime", {
      body: JSON.stringify({
        action: "media-state",
        ...credentials,
        state: {
          cameraOn: cameraStreamRef.current != null,
          microphoneOn:
            !mutedRef.current && microphoneStreamRef.current != null,
          recordingOn: false,
          screenSharing: screenSharingRef.current,
          ...patch,
        },
      }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => undefined);
  }, []);

  const stopRecognition = useCallback(() => {
    restartRecognitionRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      // The browser may already have stopped recognition.
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (
      status !== "connected" ||
      mutedRef.current ||
      microphoneDeniedRef.current ||
      speaking
    ) {
      return;
    }
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;

    if (!recognitionRef.current) {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = document.documentElement.lang || navigator.language;
      recognition.onresult = (event) => {
        let finalText = "";
        for (
          let index = event.resultIndex;
          index < event.results.length;
          index += 1
        ) {
          if (event.results[index].isFinal) {
            finalText += event.results[index][0]?.transcript || "";
          }
        }
        const normalized = finalText.trim();
        if (normalized) {
          setTranscript((current) => [
            ...current,
            transcriptEntry("user", normalized),
          ]);
        }
      };
      recognition.onerror = (event) => {
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          microphoneDeniedRef.current = true;
          mutedRef.current = true;
          setMicrophoneDenied(true);
          setMuted(true);
          safelyPlay(playVoiceModeDenied);
        }
      };
      recognition.onend = () => {
        if (restartRecognitionRef.current) {
          window.setTimeout(() => {
            try {
              recognition.start();
            } catch {
              // Recognition is already restarting.
            }
          }, 180);
        }
      };
      recognitionRef.current = recognition;
    }

    restartRecognitionRef.current = true;
    try {
      recognitionRef.current.start();
    } catch {
      // Recognition is already active.
    }
  }, [speaking, status]);

  const speak = useCallback(
    (text) => {
      if (!window.speechSynthesis || !text) return;
      stopRecognition();
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const requestedUri = selectedVoiceUri(settings.voiceModeVoice);
      utterance.voice =
        voices.find(
          (voice) => voice.localService && voice.voiceURI === requestedUri,
        ) || null;
      utterance.lang =
        utterance.voice?.lang ||
        document.documentElement.lang ||
        navigator.language;
      utterance.pitch = Number(settings.voiceModePitch) || 1;
      utterance.rate = Number(settings.voiceModeSpeed) || 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => {
        setSpeaking(false);
        window.setTimeout(startRecognition, 120);
      };
      utterance.onerror = () => {
        setSpeaking(false);
        window.setTimeout(startRecognition, 120);
      };
      window.speechSynthesis.speak(utterance);
    },
    [settings, startRecognition, stopRecognition, voices],
  );

  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);

  useEffect(() => {
    const refreshVoices = () =>
      setVoices(window.speechSynthesis?.getVoices?.() || []);
    refreshVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", refreshVoices);
    return () =>
      window.speechSynthesis?.removeEventListener?.(
        "voiceschanged",
        refreshVoices,
      );
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "nearest" });
  });

  useEffect(() => {
    if (cameraOn && cameraPreviewRef.current && cameraStreamRef.current) {
      cameraPreviewRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraOn]);

  useEffect(() => {
    if (
      screenSharing &&
      displayPreviewRef.current &&
      displayStreamRef.current
    ) {
      displayPreviewRef.current.srcObject = displayStreamRef.current;
    }
  }, [screenSharing]);

  useEffect(() => {
    const receiveAssistantSpeech = (event) => {
      const text = String(event.detail?.text || "").trim();
      if (!text || closingRef.current || status !== "connected") return;
      setTranscript((current) => [
        ...current,
        transcriptEntry("assistant", text),
      ]);
      speak(text);
    };
    window.addEventListener(
      "munetios:aivoiceassistant",
      receiveAssistantSpeech,
    );
    return () =>
      window.removeEventListener(
        "munetios:aivoiceassistant",
        receiveAssistantSpeech,
      );
  }, [speak, status]);

  const releaseVoiceLease = useCallback(() => {
    window.clearInterval(voiceLeaseHeartbeatRef.current);
    voiceLeaseHeartbeatRef.current = 0;
    try {
      const lease = JSON.parse(
        window.localStorage.getItem(voiceModeLeaseKey) || "null",
      );
      if (lease?.owner === voiceLeaseOwnerRef.current) {
        window.localStorage.removeItem(voiceModeLeaseKey);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (appLoading) {
      setStatus("connecting");
      return undefined;
    }
    const controller = new AbortController();
    connectionAbortRef.current = controller;
    let active = true;
    let connectionTimer = 0;
    const connectionCopy = initialConnectionRef.current.copy;
    const connectionNickname = initialConnectionRef.current.nickname;

    const connect = async () => {
      let microphoneRequest = Promise.resolve({});

      try {
        let existingLease = null;
        try {
          existingLease = JSON.parse(
            window.localStorage.getItem(voiceModeLeaseKey) || "null",
          );
        } catch {
          existingLease = null;
        }
        if (
          existingLease?.owner !== voiceLeaseOwnerRef.current &&
          Number(existingLease?.expiresAt) > Date.now()
        ) {
          const abortError = new Error("voice_mode_aborted_by_another_tab");
          abortError.name = "AbortError";
          throw abortError;
        }
        const refreshLease = () => {
          try {
            window.localStorage.setItem(
              voiceModeLeaseKey,
              JSON.stringify({
                expiresAt: Date.now() + 6000,
                owner: voiceLeaseOwnerRef.current,
              }),
            );
          } catch {}
        };
        refreshLease();
        voiceLeaseHeartbeatRef.current = window.setInterval(refreshLease, 2000);

        connectionTimer = window.setTimeout(() => {
          controller.abort(
            new DOMException("Voice mode connection timed out", "TimeoutError"),
          );
        }, 8000);
        const response = await fetch("/api/realtime", {
          body: JSON.stringify({
            action: "create",
            nickname: connectionNickname || connectionCopy.aiVoiceYou,
            service: "ai-voice",
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const session = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(
            session.message || `voice_session_${response.status}`,
          );
          error.code = session.error || "voice_session_failed";
          throw error;
        }
        if (!session?.roomId || !session?.peerId || !session?.peerToken) {
          throw new Error("invalid_voice_session");
        }
        microphoneRequest = navigator.mediaDevices?.getUserMedia
          ? navigator.mediaDevices
              .getUserMedia({ audio: true })
              .then((stream) => ({ stream }))
              .catch((error) => ({ error }))
          : Promise.resolve({ error: { name: "NotAllowedError" } });
        credentialsRef.current = {
          peerId: session.peerId,
          peerToken: session.peerToken,
          roomId: session.roomId,
        };

        const heartbeat = await fetch("/api/realtime", {
          body: JSON.stringify({
            action: "heartbeat",
            ...credentialsRef.current,
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        if (!heartbeat.ok)
          throw new Error(`invalid_voice_token_${heartbeat.status}`);
        window.clearTimeout(connectionTimer);

        const microphone = await microphoneRequest;
        if (!active) {
          stopStream(microphone.stream);
          return;
        }
        if (microphone.stream) {
          microphoneStreamRef.current = microphone.stream;
          mutedRef.current = false;
          setMuted(false);
        } else {
          const denied =
            isMicrophoneDenied(microphone.error) || !navigator.mediaDevices;
          microphoneDeniedRef.current = denied;
          setMicrophoneDenied(denied);
          mutedRef.current = true;
          setMuted(true);
        }

        setStatus("connected");
        syncMediaState();
        safelyPlay(
          microphoneDeniedRef.current
            ? playVoiceModeDenied
            : playVoiceModeStart,
        );
        if (!initialTranscriptRef.current.length) {
          const greeting = connectionCopy.aiVoiceAssistantGreeting;
          setTranscript([transcriptEntry("assistant", greeting)]);
          window.setTimeout(() => {
            if (active) speakRef.current(greeting);
          }, 380);
        }
      } catch (error) {
        window.clearTimeout(connectionTimer);
        void microphoneRequest.then(({ stream }) => stopStream(stream));
        if (!active || closingRef.current) return;
        releaseVoiceLease();
        const aborted = error?.name === "AbortError";
        const educationBlocked = error?.code === "education_ai_blocked";
        const failureMessage = educationBlocked
          ? error.message
          : aborted
            ? connectionCopy.aiVoiceAbortedApology
            : connectionCopy.aiVoiceConnectionApology;
        setStatus("failed");
        setMuted(true);
        mutedRef.current = true;
        setTranscript([transcriptEntry("assistant", failureMessage)]);
        safelyPlay(playVoiceModeError);
        showToast({
          message: aborted
            ? connectionCopy.aiVoiceStartAborted
            : educationBlocked
              ? error.message
              : connectionCopy.aiVoiceModeStartFailed,
          toastId: "ai-voice-mode-start-failed",
          type: "error",
        });
        failureSpeechTimerRef.current = window.setTimeout(() => {
          failureSpeechTimerRef.current = 0;
          if (active && !closingRef.current) speakRef.current(failureMessage);
        }, 120);
      }
    };

    void connect();
    return () => {
      active = false;
      window.clearTimeout(connectionTimer);
      window.clearTimeout(failureSpeechTimerRef.current);
      failureSpeechTimerRef.current = 0;
      controller.abort();
      if (connectionAbortRef.current === controller) {
        connectionAbortRef.current = null;
      }
      releaseVoiceLease();
    };
  }, [appLoading, releaseVoiceLease, syncMediaState]);

  useEffect(() => {
    if (status === "connected" && !muted && !speaking) startRecognition();
  }, [muted, speaking, startRecognition, status]);

  const finish = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    window.clearTimeout(failureSpeechTimerRef.current);
    failureSpeechTimerRef.current = 0;
    try {
      connectionAbortRef.current?.abort();
    } catch {}
    connectionAbortRef.current = null;
    try {
      stopRecognition();
      window.speechSynthesis?.cancel?.();
    } catch {}
    stopStream(microphoneStreamRef.current);
    stopStream(cameraStreamRef.current);
    stopStream(displayStreamRef.current);
    microphoneStreamRef.current = null;
    cameraStreamRef.current = null;
    displayStreamRef.current = null;
    try {
      const credentials = credentialsRef.current;
      credentialsRef.current = null;
      if (credentials) {
        void fetch("/api/realtime", {
          body: JSON.stringify({ action: "leave", ...credentials }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }).catch(() => undefined);
      }
    } catch {}
    try {
      releaseVoiceLease();
      if (status === "connected" || status === "failed") {
        safelyPlay(playVoiceModeStop);
      }
    } finally {
      onClose();
    }
  }, [onClose, releaseVoiceLease, status, stopRecognition]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish]);

  const toggleMicrophone = async () => {
    if (status !== "connected") return;
    if (!mutedRef.current) {
      mutedRef.current = true;
      setMuted(true);
      stopRecognition();
      microphoneStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      safelyPlay(playMute);
      syncMediaState({ microphoneOn: false });
      return;
    }

    try {
      if (!microphoneStreamRef.current) {
        microphoneStreamRef.current = await navigator.mediaDevices.getUserMedia(
          {
            audio: true,
          },
        );
      }
      microphoneStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      microphoneDeniedRef.current = false;
      setMicrophoneDenied(false);
      mutedRef.current = false;
      setMuted(false);
      safelyPlay(playUnmute);
      syncMediaState({ microphoneOn: true });
    } catch (error) {
      if (isMicrophoneDenied(error)) {
        microphoneDeniedRef.current = true;
        setMicrophoneDenied(true);
      }
      safelyPlay(playVoiceModeDenied);
    }
  };

  const toggleCamera = async () => {
    if (status !== "connected") return;
    if (cameraStreamRef.current) {
      stopStream(cameraStreamRef.current);
      cameraStreamRef.current = null;
      if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null;
      setCameraOn(false);
      safelyPlay(playCameraStop);
      syncMediaState({ cameraOn: false });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraStreamRef.current = stream;
      if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = stream;
      setCameraOn(true);
      safelyPlay(playCameraStart);
      syncMediaState({ cameraOn: true });
    } catch {
      safelyPlay(playCameraDenied);
      showToast({ message: copy.aiVoiceCameraDenied, type: "error" });
    }
  };

  const toggleScreenShare = async () => {
    if (status !== "connected") return;
    if (displayStreamRef.current) {
      stopStream(displayStreamRef.current);
      displayStreamRef.current = null;
      screenSharingRef.current = false;
      setScreenSharing(false);
      safelyPlay(playShareStop);
      syncMediaState({ screenSharing: false });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      displayStreamRef.current = stream;
      screenSharingRef.current = true;
      setScreenSharing(true);
      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          displayStreamRef.current = null;
          screenSharingRef.current = false;
          setScreenSharing(false);
          safelyPlay(playShareStop);
          syncMediaState({ screenSharing: false });
        },
        { once: true },
      );
      safelyPlay(playShareStart);
      syncMediaState({ screenSharing: true });
    } catch {
      safelyPlay(playShareDenied);
      showToast({ message: copy.aiVoiceScreenShareDenied, type: "error" });
    }
  };

  const selectVoice = async (voiceModeVoice) => {
    await onSettingsChange({ voiceModeVoice });
  };

  const openVoicePicker = () => {
    showModal(
      ({ close }) => (
        <DeviceVoicePicker
          close={close}
          copy={copy}
          onSelect={selectVoice}
          selectedVoice={settings.voiceModeVoice}
          voices={chooseableVoices}
        />
      ),
      {
        ariaLabel: copy.aiVoiceChooseVoice,
        className: "ai-voice-picker-modal",
        contentClassName: "overflow-hidden",
        maxWidth: "min(34rem, calc(100vw - 1rem))",
        title: copy.aiVoiceChooseVoice,
        width: "min(34rem, calc(100vw - 1rem))",
      },
    );
  };

  const shareTranscript = async () => {
    if (!hasSignedInCookie()) {
      showShareSignIn(copy);
      return;
    }
    try {
      const encryptionKey = await createVoiceConversationKey();
      const encryptedPayload = await encryptVoiceConversation(
        transcript,
        encryptionKey,
      );
      const response = await fetch("/api/ai/shared-links", {
        body: JSON.stringify({
          conversationId,
          encryptedPayload,
          title: copy.aiVoiceSharedTranscript,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("share_failed");
      const payload = await response.json();
      if (!payload.link?.url) throw new Error("invalid_share_link");
      const link = {
        ...payload.link,
        members: [],
        url: withVoiceShareKey(payload.link.url, encryptionKey),
      };
      window.localStorage.setItem(
        `munetios.ai.voiceShareKey.${link.id}`,
        encryptionKey,
      );
      showModal(<ShareLinkModal copy={copy} link={link} />, {
        ariaLabel: copy.aiVoiceGeneratedShareLink,
        className: "ai-voice-share-link-modal",
        maxWidth: "min(36rem, calc(100vw - 1rem))",
        title: copy.aiVoiceGeneratedShareLink,
        width: "min(36rem, calc(100vw - 1rem))",
      });
    } catch {
      showToast({ message: copy.aiVoiceShareFailed, type: "error" });
    }
  };

  const copyTranscriptMessage = (entry) => {
    void copyToClipboard(entry.text, copy, copy.aiCopiedToClipboard);
  };

  const beginEditingMessage = (entry) => {
    setEditingMessageId(entry.id);
    setEditingMessageText(entry.text);
  };

  const finishEditingMessage = () => {
    const text = editingMessageText.trim();
    if (!text) return;
    const messageId = editingMessageId;
    setTranscript((current) => {
      const index = current.findIndex((entry) => entry.id === messageId);
      if (index < 0) return current;
      return [...current.slice(0, index), { ...current[index], text }];
    });
    setEditingMessageId("");
    setEditingMessageText("");
    window.dispatchEvent(
      new CustomEvent("munetios:aivoicetextinput", {
        detail: { messageId, retry: true, text },
      }),
    );
  };

  const submitTypedMessage = (event) => {
    event.preventDefault();
    const text = typedMessage.trim();
    if (!text || status !== "connected") return;
    setTranscript((current) => [...current, transcriptEntry("user", text)]);
    setTypedMessage("");
    window.dispatchEvent(
      new CustomEvent("munetios:aivoicetextinput", { detail: { text } }),
    );
  };

  const statusText =
    status === "connected"
      ? copy.aiVoiceConnected
      : status === "failed"
        ? copy.aiVoiceCouldntConnect
        : copy.aiVoiceConnecting;
  const modeType = ["fullscreen", "prompt", "wrapper"].includes(
    settings.voiceModeType,
  )
    ? settings.voiceModeType
    : "prompt";
  const compactMode = modeType !== "fullscreen";
  const startWrapperDrag = (event) => {
    if (
      modeType !== "wrapper" ||
      event.button !== 0 ||
      event.target.closest("button, a, input, textarea")
    ) {
      return;
    }
    const wrapper = event.currentTarget.closest(".ai-voice-mode");
    if (!wrapper) return;
    const bounds = wrapper.getBoundingClientRect();
    wrapperDragRef.current = {
      height: bounds.height,
      left: bounds.left,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      top: bounds.top,
      width: bounds.width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveWrapper = (event) => {
    const drag = wrapperDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setWrapperPosition({
      left: Math.min(
        Math.max(8, drag.left + event.clientX - drag.startX),
        Math.max(8, window.innerWidth - drag.width - 8),
      ),
      top: Math.min(
        Math.max(8, drag.top + event.clientY - drag.startY),
        Math.max(8, window.innerHeight - drag.height - 8),
      ),
    });
  };
  const stopWrapperDrag = (event) => {
    if (wrapperDragRef.current?.pointerId !== event.pointerId) return;
    wrapperDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
  };
  const wrapperStyle =
    modeType === "wrapper" && wrapperPosition
      ? {
          bottom: "auto",
          left: `${wrapperPosition.left}px`,
          right: "auto",
          top: `${wrapperPosition.top}px`,
        }
      : undefined;
  const portalTarget = modeType === "prompt" ? promptTarget : document.body;
  if (!portalTarget) return null;

  return createPortal(
    <section
      aria-label={copy.aiVoiceMode}
      aria-modal={modeType === "fullscreen" ? "true" : undefined}
      className="ai-voice-mode"
      data-has-preview={cameraOn || screenSharing || undefined}
      data-mode={modeType}
      data-status={status}
      data-version={settings.voiceModeVersion}
      role="dialog"
      style={wrapperStyle}
    >
      <header
        className="ai-voice-mode__topbar"
        onPointerCancel={stopWrapperDrag}
        onPointerDown={startWrapperDrag}
        onPointerMove={moveWrapper}
        onPointerUp={stopWrapperDrag}
      >
        <div className="ai-voice-mode__title">
          <icon>graphic_eq</icon>
          <div>
            <h1>{copy.aiVoiceMode}</h1>
            {compactMode ? <small>{statusText}</small> : null}
          </div>
        </div>
        <div className="ai-voice-mode__top-actions">
          {!compactMode && !sharingDisabled
            ? <button
                aria-label={copy.aiVoiceShare}
                className="ai-voice-mode__share liquid-glass"
                disabled={!transcript.length}
                onClick={() => void shareTranscript()}
                type="button"
              >
                <icon>share</icon>
                <span>{copy.aiVoiceShare}</span>
              </button>
            : null}
          <div className="ai-voice-mode__voice-picker">
            <button
              aria-haspopup="dialog"
              className="liquid-glass"
              onClick={openVoicePicker}
              type="button"
            >
              <icon>record_voice_over</icon>
              <span>{copy.aiVoiceChooseVoice}</span>
            </button>
          </div>
          <button
            aria-label={copy.aiVoiceEnd}
            className="ai-voice-mode__end liquid-glass"
            onClick={finish}
            type="button"
          >
            <icon>call_end</icon>
            <span>{copy.aiVoiceEnd}</span>
          </button>
        </div>
      </header>

      <div className="ai-voice-mode__layout">
        <section className="ai-voice-mode__stage" aria-live="polite">
          <div
            aria-hidden="true"
            className={`ai-voice-mode__orb${speaking ? " is-speaking" : ""}`}
          >
            <div className="ai-voice-mode__orb-ring" />
            <div className="ai-voice-mode__orb-ball" />
          </div>
          {screenSharing
            ? <video
                aria-label={copy.aiVoiceScreenPreview}
                autoPlay
                className="ai-voice-mode__screen-preview"
                muted
                playsInline
                ref={displayPreviewRef}
              />
            : null}
          {cameraOn
            ? <video
                aria-label={copy.aiVoiceCameraPreview}
                autoPlay
                className="ai-voice-mode__camera-preview"
                muted
                playsInline
                ref={cameraPreviewRef}
              />
            : null}
          <div className="ai-voice-mode__connection-copy">
            <strong>{statusText}</strong>
            {microphoneDenied && status === "connected"
              ? <p>{copy.aiVoiceMicrophoneDeniedPrompt}</p>
              : null}
          </div>
          {!compactMode
            ? <fieldset className="ai-voice-mode__controls">
                <legend>{copy.aiVoiceControls}</legend>
                <button
                  aria-label={muted ? copy.aiVoiceUnmute : copy.aiVoiceMute}
                  aria-pressed={!muted}
                  className="liquid-glass"
                  disabled={status !== "connected"}
                  onClick={() => void toggleMicrophone()}
                  type="button"
                >
                  <icon>{muted ? "mic_off" : "mic"}</icon>
                  <span>{muted ? copy.aiVoiceUnmute : copy.aiVoiceMute}</span>
                </button>
                <button
                  aria-label={copy.aiVoiceCamera}
                  aria-pressed={cameraOn}
                  className="liquid-glass"
                  disabled={status !== "connected"}
                  onClick={() => void toggleCamera()}
                  type="button"
                >
                  <icon>{cameraOn ? "videocam" : "videocam_off"}</icon>
                  <span>{copy.aiVoiceCamera}</span>
                </button>
                <button
                  aria-label={copy.aiVoiceScreenShare}
                  aria-pressed={screenSharing}
                  className="liquid-glass"
                  disabled={status !== "connected"}
                  onClick={() => void toggleScreenShare()}
                  type="button"
                >
                  <icon>
                    {screenSharing ? "stop_screen_share" : "screen_share"}
                  </icon>
                  <span>{copy.aiVoiceScreenShare}</span>
                </button>
              </fieldset>
            : null}
        </section>

        <aside className="ai-voice-mode__transcript liquid-glass">
          <header>
            <icon>subject</icon>
            <h2>{copy.aiVoiceTranscript}</h2>
          </header>
          {modeType === "prompt" && microphoneDenied && status === "connected"
            ? <p className="ai-voice-mode__compact-guidance">
                {copy.aiVoiceMicrophoneDeniedPrompt}
              </p>
            : null}
          <div className="ai-voice-mode__transcript-scroll">
            {transcript.length
              ? transcript.map((entry) => (
                  <article data-role={entry.role} key={entry.id}>
                    <header>
                      <strong>
                        {entry.role === "user"
                          ? copy.aiVoiceYou
                          : copy.aiAppPageLabel}
                      </strong>
                      <button
                        aria-label={
                          entry.role === "user"
                            ? copy.aiVoiceEditMessage
                            : copy.aiVoiceCopyMessage
                        }
                        onClick={() =>
                          entry.role === "user"
                            ? beginEditingMessage(entry)
                            : copyTranscriptMessage(entry)
                        }
                        type="button"
                      >
                        <icon>
                          {entry.role === "user" ? "edit" : "content_copy"}
                        </icon>
                      </button>
                    </header>
                    {editingMessageId === entry.id
                      ? <form
                          className="ai-voice-mode__message-editor"
                          onSubmit={(event) => {
                            event.preventDefault();
                            finishEditingMessage();
                          }}
                        >
                          <textarea
                            aria-label={copy.aiVoiceEditMessageLabel}
                            onChange={(event) =>
                              setEditingMessageText(event.target.value)
                            }
                            rows="3"
                            value={editingMessageText}
                          />
                          <div>
                            <button
                              onClick={() => {
                                setEditingMessageId("");
                                setEditingMessageText("");
                              }}
                              type="button"
                            >
                              {copy.cancel}
                            </button>
                            <button
                              disabled={!editingMessageText.trim()}
                              type="submit"
                            >
                              {copy.aiVoiceDone}
                            </button>
                          </div>
                        </form>
                      : <p>{entry.text}</p>}
                  </article>
                ))
              : <p className="ai-voice-mode__empty">
                  {modeType === "prompt"
                    ? copy.aiVoiceTranscript
                    : copy.aiVoiceTranscriptEmpty}
                </p>}
            <span ref={transcriptEndRef} />
          </div>
          <form
            className="ai-voice-mode__text-composer"
            onSubmit={submitTypedMessage}
          >
            {modeType !== "prompt"
              ? <div className="ai-voice-mode__composer-input">
                  <input
                    aria-label={copy.aiVoiceTypeMessage}
                    disabled={status !== "connected"}
                    onChange={(event) => setTypedMessage(event.target.value)}
                    placeholder={copy.aiVoiceTypeMessage}
                    type="text"
                    value={typedMessage}
                  />
                  <button
                    aria-label={copy.aiVoiceSendMessage}
                    disabled={status !== "connected" || !typedMessage.trim()}
                    type="submit"
                  >
                    <icon>arrow_upward</icon>
                  </button>
                </div>
              : null}
            {compactMode
              ? <fieldset className="ai-voice-mode__controls">
                  <legend>{copy.aiVoiceControls}</legend>
                  <button
                    aria-label={muted ? copy.aiVoiceUnmute : copy.aiVoiceMute}
                    aria-pressed={!muted}
                    className="liquid-glass"
                    disabled={status !== "connected"}
                    onClick={() => void toggleMicrophone()}
                    type="button"
                  >
                    <icon>{muted ? "mic_off" : "mic"}</icon>
                    <span>{muted ? copy.aiVoiceUnmute : copy.aiVoiceMute}</span>
                  </button>
                  <button
                    aria-label={copy.aiVoiceCamera}
                    aria-pressed={cameraOn}
                    className="liquid-glass"
                    disabled={status !== "connected"}
                    onClick={() => void toggleCamera()}
                    type="button"
                  >
                    <icon>{cameraOn ? "videocam" : "videocam_off"}</icon>
                    <span>{copy.aiVoiceCamera}</span>
                  </button>
                  <button
                    aria-label={copy.aiVoiceScreenShare}
                    aria-pressed={screenSharing}
                    className="liquid-glass"
                    disabled={status !== "connected"}
                    onClick={() => void toggleScreenShare()}
                    type="button"
                  >
                    <icon>
                      {screenSharing ? "stop_screen_share" : "screen_share"}
                    </icon>
                    <span>{copy.aiVoiceScreenShare}</span>
                  </button>
                </fieldset>
              : null}
          </form>
        </aside>
      </div>
    </section>,
    portalTarget,
  );
}
