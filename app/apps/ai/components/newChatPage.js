"use client";

import { useState } from "react";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { playMicrophoneDenied, playMicrophoneStart } from "./microphoneSounds";

const forYouCards = [
  {
    descriptionKey: "aiForYouTasksDescription",
    icon: "task_alt",
    titleKey: "aiForYouTasksTitle",
  },
  {
    descriptionKey: "aiForYouConnectorsDescription",
    icon: "extension",
    titleKey: "aiForYouConnectorsTitle",
  },
  {
    descriptionKey: "aiForYouHistoryDescription",
    icon: "history",
    titleKey: "aiForYouHistoryTitle",
  },
  {
    descriptionKey: "aiForYouWorkspaceDescription",
    icon: "folder_data",
    titleKey: "aiForYouWorkspaceTitle",
  },
];

export default function NewChatPage({ account, copy }) {
  const [prompt, setPrompt] = useState("");
  const [isListening, setIsListening] = useState(false);
  const firstName = String(account?.firstName || account?.name || "")
    .trim()
    .split(/\s+/)[0];
  const greeting = firstName
    ? copy.aiNewChatGreetingName.replace("{name}", firstName)
    : copy.aiNewChatGreeting;

  const showMicrophoneDenied = () => {
    void playMicrophoneDenied().catch(() => {});
    showToast({ messageKey: "aiMicrophoneDeniedToast", type: "error" });
    showModal(
      ({ close }) => (
        <div className="munetios-ai-microphone-denied">
          {/* biome-ignore lint/performance/noImgElement: supplied Munetios permission-help artwork is loaded from the product CDN. */}
          <img
            alt=""
            width="400"
            src="https://api.munetios.com/cdn/micdenied.png"
          />
          <div>
            <h2>{copy.aiMicrophoneDeniedTitle}</h2>
            <p>{copy.aiMicrophoneDeniedGuidance}</p>
          </div>
          <button
            className="munetios-ai-microphone-denied-close"
            onClick={close}
            type="button"
          >
            {copy.modalClose}
          </button>
        </div>
      ),
      { ariaLabel: copy.aiMicrophoneDeniedTitle, contentClassName: "p-1" },
    );
  };

  const handleMicrophone = async () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices?.getUserMedia({
        audio: true,
      });
      if (!stream) throw new Error("Microphone unavailable");
      for (const track of stream.getTracks()) track.stop();
      await playMicrophoneStart();
      setIsListening(true);
      window.setTimeout(() => setIsListening(false), 2400);
    } catch {
      showMicrophoneDenied();
    }
  };

  const stopListening = () => setIsListening(false);

  return (
    <section className="munetios-ai-new-chat">
      <div className="munetios-ai-new-chat-content">
        <p className="munetios-ai-new-chat-eyebrow">
          <icon>auto_awesome</icon>
          <span>{copy.aiForYouPoweredBy}</span>
        </p>
        <h1>{greeting}</h1>
        <p className="munetios-ai-new-chat-subtitle">
          {copy.aiNewChatSubtitle}
        </p>

        <form
          className={`munetios-ai-composer liquid-glass ${isListening ? "is-listening" : ""}`}
          onSubmit={(event) => event.preventDefault()}
        >
          {isListening ? (
            <span
              aria-hidden="true"
              className="munetios-ai-composer-listening-icon"
            >
              <icon>mic</icon>
            </span>
          ) : (
            <button
              aria-label={copy.aiPromptAdd}
              className="munetios-ai-composer-action"
              type="button"
            >
              <icon>add</icon>
            </button>
          )}
          <textarea
            aria-label={
              isListening ? copy.aiListening : copy.aiPromptPlaceholder
            }
            disabled={isListening}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              isListening ? copy.aiListening : copy.aiPromptPlaceholder
            }
            rows={1}
            value={prompt}
          />
          {isListening ? (
            <div className="munetios-ai-composer-listening-actions">
              <button
                aria-label={copy.aiMicrophoneStop}
                className="munetios-ai-composer-stop"
                onClick={stopListening}
                type="button"
              >
                <icon>stop</icon>
              </button>
              <button
                aria-label={copy.aiUseVoiceInput}
                className="munetios-ai-composer-use"
                onClick={stopListening}
                type="button"
              >
                <span>{copy.aiUseVoiceInput}</span>
              </button>
            </div>
          ) : (
            <div className="munetios-ai-composer-actions">
              <button
                aria-label={copy.aiPromptMicrophone}
                className="munetios-ai-composer-microphone"
                onClick={handleMicrophone}
                type="button"
              >
                <icon>mic</icon>
              </button>
              {prompt.trim() ? (
                <button
                  aria-label={copy.aiPromptSend}
                  className="munetios-ai-composer-send is-send"
                  type="submit"
                >
                  <icon>arrow_upward</icon>
                </button>
              ) : (
                <button
                  aria-label={copy.aiVoiceMode}
                  className="munetios-ai-composer-voice-mode is-primary"
                  type="button"
                >
                  <icon>graphic_eq</icon>
                </button>
              )}
            </div>
          )}
        </form>

        <section
          aria-labelledby="aiForYouHeading"
          className="munetios-ai-for-you"
        >
          <div className="munetios-ai-for-you-heading">
            <div>
              <p>{copy.aiForYouPoweredBy}</p>
              <h2 id="aiForYouHeading">{copy.aiForYouTitle}</h2>
            </div>
            <icon className="munetios-ai-for-you-heading-icon">wand_stars</icon>
          </div>
          <div className="munetios-ai-for-you-grid">
            {forYouCards.map((card) => (
              <article className="liquid-glass" key={card.titleKey}>
                <span className="munetios-ai-for-you-icon">
                  <icon>{card.icon}</icon>
                </span>
                <div>
                  <h3>{copy[card.titleKey]}</h3>
                  <p>{copy[card.descriptionKey]}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
