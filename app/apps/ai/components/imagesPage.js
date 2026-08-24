"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingSpinner from "../../../components/loadingSpinner";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { t } from "../../../i18n";
import ImagesTopbar from "./imagesTopbar";
import {
  playVoiceTypingDenied,
  playVoiceTypingStart,
  playVoiceTypingStop,
} from "./tonesounds";

const microphoneDeniedImage = "https://api.munetios.com/cdn/micdenied.png";

function isPermissionError(error) {
  return ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(
    error?.name,
  );
}

function isMissingMicrophoneError(error) {
  return ["DevicesNotFoundError", "NotFoundError"].includes(error?.name);
}

function showMicrophonePermissionModal(copy) {
  showModal({
    ariaLabel: copy.aiMicrophonePermissionTitle,
    closeOnBackdrop: false,
    content: (
      <div className="ai-images-microphone-permission">
        <Image
          alt={copy.aiMicrophoneDeniedImageAlt}
          height={360}
          src={microphoneDeniedImage}
          unoptimized
          width={640}
        />
        <p>{copy.aiMicrophoneDeniedGuidance}</p>
      </div>
    ),
    contentClassName: "ai-images-microphone-permission-content",
    maxWidth: "min(34rem, calc(100vw - 2rem))",
    modalType: "ai-microphone-denied",
    title: copy.aiMicrophonePermissionTitle,
  });
}

export default function ImagesPage() {
  const [copy, setCopy] = useState(() => t());
  const [filter, setFilter] = useState("all");
  const [images, setImages] = useState([]);
  const [listState, setListState] = useState("loading");
  const [listening, setListening] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [view, setView] = useState("grid");
  const recognitionRef = useRef(null);
  const voiceFailureHandledRef = useRef(false);
  const listeningRef = useRef(false);
  const promptBeforeListeningRef = useRef("");
  const finalTranscriptRef = useRef("");

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    return () => {
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai/images", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) return { images: [] };
        if (!response.ok) throw new Error("images_load_failed");
        return response.json();
      })
      .then((payload) => {
        setImages(Array.isArray(payload.images) ? payload.images : []);
        setListState("ready");
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setListState("failed");
      });
    return () => controller.abort();
  }, []);

  const finishListening = useCallback(async ({ playSound = true } = {}) => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    setListening(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.stop();
    }
    if (playSound) await playVoiceTypingStop().catch(() => {});
  }, []);

  useEffect(
    () => () => {
      listeningRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  const handleVoiceFailure = useCallback(
    async (error) => {
      if (voiceFailureHandledRef.current) return;
      voiceFailureHandledRef.current = true;
      listeningRef.current = false;
      setListening(false);
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      }
      await playVoiceTypingDenied().catch(() => {});

      if (isPermissionError(error)) {
        showMicrophonePermissionModal(copy);
        return;
      }
      if (isMissingMicrophoneError(error) || error?.error === "audio-capture") {
        showToast({
          messageKey: "aiMicrophoneNotConnectedToast",
          type: "error",
        });
        return;
      }
      if (["not-allowed", "service-not-allowed"].includes(error?.error)) {
        showMicrophonePermissionModal(copy);
        return;
      }
      showToast({ messageKey: "aiVoiceInputFailedToast", type: "error" });
    },
    [copy],
  );

  const startListening = useCallback(async () => {
    if (listeningRef.current) return;
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || !navigator.mediaDevices?.getUserMedia) {
      showToast({ messageKey: "aiVoiceInputFailedToast", type: "error" });
      return;
    }

    try {
      voiceFailureHandledRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      await playVoiceTypingStart();

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = document.documentElement.lang || navigator.language;
      promptBeforeListeningRef.current = prompt.trim();
      finalTranscriptRef.current = "";
      listeningRef.current = true;
      recognitionRef.current = recognition;
      setListening(true);

      recognition.onresult = (event) => {
        let interimTranscript = "";
        for (
          let index = event.resultIndex;
          index < event.results.length;
          index += 1
        ) {
          const transcript = event.results[index][0]?.transcript || "";
          if (event.results[index].isFinal) {
            finalTranscriptRef.current += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        setPrompt(
          [
            promptBeforeListeningRef.current,
            finalTranscriptRef.current.trim(),
            interimTranscript.trim(),
          ]
            .filter(Boolean)
            .join(" "),
        );
      };
      recognition.onerror = (event) => void handleVoiceFailure(event);
      recognition.onend = () => {
        if (listeningRef.current) void finishListening();
      };
      recognition.start();
    } catch (error) {
      await handleVoiceFailure(error);
    }
  }, [finishListening, handleVoiceFailure, prompt]);

  const visibleImages = useMemo(
    () =>
      filter === "all"
        ? images
        : images.filter((image) => image.type === filter),
    [filter, images],
  );

  return (
    <section className="ai-images-page">
      <ImagesTopbar copy={copy} setView={setView} view={view} />
      <div className="ai-images-content">
        <div
          className={`ai-images-prompt liquid-glass${listening ? " is-listening" : ""}`}
        >
          {listening
            ? <>
                <span aria-hidden="true" className="ai-images-listening-icon">
                  <icon>mic</icon>
                </span>
                <span aria-live="polite" className="ai-images-listening-label">
                  {copy.aiListening}
                </span>
                <button
                  aria-label={copy.aiMicrophoneStop}
                  className="ai-images-end-microphone"
                  onClick={() => void finishListening()}
                  type="button"
                >
                  <icon>stop_circle</icon>
                </button>
              </>
            : <>
                <button
                  aria-label={copy.aiImagesUploadReference}
                  className="ai-images-add-button"
                  type="button"
                >
                  <icon>add</icon>
                </button>
                <input
                  aria-label={copy.aiImagesPromptPlaceholder}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={copy.aiImagesPromptPlaceholder}
                  value={prompt}
                />
                <button
                  aria-label={copy.aiPromptMicrophone}
                  className="ai-images-microphone-button"
                  data-ai-voice-input
                  onClick={() => void startListening()}
                  type="button"
                >
                  <icon>mic</icon>
                </button>
                <button
                  aria-disabled="true"
                  aria-label={copy.aiImagesCreate}
                  className="ai-images-send-button"
                  disabled
                  type="button"
                >
                  <icon>arrow_upward</icon>
                </button>
              </>}
        </div>

        <section
          aria-label={copy.aiImagesGenerated}
          className={`ai-images-gallery liquid-glass is-${view}`}
        >
          <div
            aria-label={copy.aiImagesTitle}
            className="ai-images-tabs"
            role="tablist"
          >
            {[
              ["all", copy.aiImagesAll],
              ["generated", copy.aiImagesGenerated],
              ["edited", copy.aiImagesEdited],
            ].map(([value, label]) => (
              <button
                aria-selected={filter === value}
                key={value}
                onClick={() => setFilter(value)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {listState === "loading"
            ? <LoadingSpinner
                className="ai-compact-loading-spinner"
                label={copy.loading}
                strokeWidth={3}
              />
            : null}
          {listState === "failed"
            ? <div className="ai-images-gallery-message" role="alert">
                <icon>image_not_supported</icon>
                <p>{copy.aiImagesEmpty}</p>
              </div>
            : null}
          {listState === "ready" && visibleImages.length === 0
            ? <div className="ai-images-gallery-message">
                <icon>image</icon>
                <p>{copy.aiImagesEmpty}</p>
              </div>
            : null}
          {listState === "ready" && visibleImages.length > 0
            ? <div className="ai-images-list">
                {visibleImages.map((image) => (
                  <article className="ai-images-card" key={image.id}>
                    <Image
                      alt={image.name}
                      height={640}
                      src={image.url}
                      unoptimized
                      width={640}
                    />
                    <div>
                      <h2>{image.name}</h2>
                      <p>{image.prompt || copy.aiImagesDescription}</p>
                    </div>
                  </article>
                ))}
              </div>
            : null}
        </section>
      </div>
    </section>
  );
}
