"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import LoadingSpinner from "../../../../components/loadingSpinner";
import { showToast } from "../../../../components/toast";
import { t } from "../../../../i18n";
import VoiceMode from "../../components/voiceMode";
import {
  decryptVoiceConversation,
  encryptVoiceConversation,
  voiceShareKeyFromLocation,
} from "../../lib/voiceConversationCrypto";

const animals = [
  "Brave Badger",
  "Calm Capybara",
  "Clever Fox",
  "Curious Otter",
  "Gentle Panda",
  "Happy Quokka",
  "Kind Koala",
  "Swift Falcon",
  "Wise Owl",
];

function guestName() {
  const key = "munetios.ai.voiceGuestName";
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) return stored;
    const name =
      animals[crypto.getRandomValues(new Uint32Array(1))[0] % animals.length];
    window.localStorage.setItem(key, name);
    return name;
  } catch {
    return animals[0];
  }
}

export default function SharedVoiceConversationPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const [copy, setCopy] = useState(() => t());
  const [conversation, setConversation] = useState(null);
  const [nickname, setNickname] = useState("Guest");
  const [state, setState] = useState("loading");
  const versionRef = useRef(0);
  const errorShownRef = useRef(false);
  const id = Array.isArray(params?.shareId)
    ? params.shareId[0]
    : params?.shareId;
  const token = searchParams.get("token") || "";

  useEffect(() => setNickname(guestName()), []);

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    return () => {
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  const loadConversation = useCallback(async () => {
    if (!id || !token) throw new Error("share_link_unavailable");
    const key = voiceShareKeyFromLocation();
    if (!key) throw new Error("missing_encryption_key");
    const response = await fetch(
      `/api/ai/shared-links?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("share_link_unavailable");
    const payload = await response.json();
    if (payload.link.version <= versionRef.current) return;
    const messages = await decryptVoiceConversation(
      payload.link.encryptedPayload,
      key,
    );
    versionRef.current = payload.link.version;
    setConversation({ ...payload.link, messages });
    setState("ready");
  }, [id, token]);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      loadConversation().catch(() => {
        if (!active) return;
        setState("error");
        if (!errorShownRef.current) {
          errorShownRef.current = true;
          showToast({
            message: copy.aiConversationFetchFailed.replace("{id}", id || ""),
            type: "error",
          });
        }
      });
    void refresh();
    const interval = window.setInterval(refresh, 1250);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [copy.aiConversationFetchFailed, id, loadConversation]);

  const updateConversation = useCallback(
    async (messages) => {
      const key = voiceShareKeyFromLocation();
      const encryptedPayload = await encryptVoiceConversation(messages, key);
      const response = await fetch("/api/ai/shared-links", {
        body: JSON.stringify({
          encryptedPayload,
          id,
          token,
          version: versionRef.current,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && payload.link)
          versionRef.current = payload.link.version;
        throw new Error(payload.error || "collaboration_update_failed");
      }
      versionRef.current = payload.link.version;
      setConversation((current) => ({ ...current, ...payload.link, messages }));
    },
    [id, token],
  );

  if (state === "loading") {
    return (
      <main className="ai-shared-voice-page">
        <LoadingSpinner label={copy.accountProcessing} strokeWidth={3} />
      </main>
    );
  }
  if (state === "error" || !conversation) {
    return (
      <main className="ai-shared-voice-page">
        <section className="ai-shared-voice-card liquid-glass">
          <div className="ai-shared-voice-error">
            <icon>link_off</icon>
            <p>{copy.aiVoiceSharedTranscriptUnavailable}</p>
          </div>
        </section>
      </main>
    );
  }
  return (
    <VoiceMode
      conversationId={conversation.conversationId}
      copy={copy}
      initialTranscript={conversation.messages}
      nickname={nickname}
      onClose={() => window.location.assign("/apps/ai")}
      onSettingsChange={async () => ({})}
      onTranscriptChange={updateConversation}
      settings={{ voiceModeVoice: "auto" }}
    />
  );
}
