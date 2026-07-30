"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { playMicrophoneDenied, playMicrophoneStart } from "./microphoneSounds";
import { openUnlockFeaturesModal } from "./unlockFeaturesModal";

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

const models = [
  ["munet-1-instant", "Munet 1.0 Instant", false],
  ["munet-1-mini", "Munet 1.0 Mini", false],
  ["munet-1-thinking", "Munet 1.0 Thinking", true],
  ["munet-1-pro", "Munet 1.0 Pro", true],
  ["munet-1-advanced-plus", "Munet 1.0 Advanced+", true],
  ["munet-1-code-advanced-plus", "Munet 1.0 Code Advanced+", true],
];
const freeCosts = {
  "munet-1-advanced-plus": 8,
  "munet-1-code-advanced-plus": 8,
  "munet-1-instant": 0,
  "munet-1-mini": 0,
  "munet-1-pro": 2,
  "munet-1-thinking": 1,
};
const composerTools = [
  ["attach-files", "attach_file", "aiToolAttachFiles"],
  ["image-generation", "image", "aiToolImageGeneration"],
  ["web-search", "travel_explore", "aiToolWebSearch"],
  ["deep-research", "science", "aiToolDeepResearch"],
  ["canvas", "draw", "aiToolCanvas"],
  ["agent", "smart_toy", "aiToolAgent"],
  ["study-quizzes", "school", "aiToolStudyQuizzes"],
  ["plugins", "extension", "aiToolPlugins"],
];
const guestRestrictedTools = new Set(["agent", "deep-research", "plugins"]);
const normalizePinnedTools = (value) =>
  Array.isArray(value)
    ? value.filter((toolId) =>
        composerTools.some(([id]) => id === toolId),
      )
    : [];

export default function NewChatPage({ account, aiSettings, copy, signedIn }) {
  const [prompt, setPrompt] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    aiSettings?.selectedModel || "munet-1-instant",
  );
  const [modelCosts, setModelCosts] = useState(freeCosts);
  const [selectedTools, setSelectedTools] = useState([]);
  const [pinnedTools, setPinnedTools] = useState(() =>
    normalizePinnedTools(aiSettings?.pinnedTools),
  );
  const [attachments, setAttachments] = useState([]);
  const [usageInfo, setUsageInfo] = useState(null);
  const limitNotice = "";
  const attachmentInputRef = useRef(null);
  const attachmentsRef = useRef([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    },
    [],
  );
  useEffect(() => {
    setSelectedModel(aiSettings?.selectedModel || "munet-1-instant");
  }, [aiSettings?.selectedModel]);
  useEffect(() => {
    setPinnedTools(normalizePinnedTools(aiSettings?.pinnedTools));
  }, [aiSettings?.pinnedTools]);
  useEffect(() => {
    if (!account) return;
    fetch("/api/ai/usage", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.modelCosts) {
          setModelCosts(payload.modelCosts);
          setUsageInfo(payload);
        }
      })
      .catch(() => undefined);
  }, [account]);
  const firstName = String(account?.firstName || account?.name || "")
    .trim()
    .split(/\s+/)[0];
  const greetingName = String(aiSettings?.nickname || firstName).trim();
  const greeting = greetingName
    ? copy.aiNewChatGreetingName.replace("{name}", greetingName)
    : copy.aiNewChatGreeting;
  const selectedModelLabel =
    models.find(([id]) => id === selectedModel)?.[1] || models[0][1];
  const lowCredits =
    usageInfo &&
    usageInfo.plan !== "pro" &&
    ((usageInfo.limits.hourly &&
      usageInfo.hourlyUsed / usageInfo.limits.hourly >= 0.9) ||
      (usageInfo.limits.daily &&
        usageInfo.dailyUsed / usageInfo.limits.daily >= 0.9));

  const selectModel = async (model) => {
    const requiresSignIn = models.find(([id]) => id === model)?.[2];
    if (requiresSignIn && !signedIn) {
      openUnlockFeaturesModal(copy);
      return;
    }
    setSelectedModel(model);
    const nextSettings = { ...aiSettings, selectedModel: model };
    window.dispatchEvent(
      new CustomEvent("munetios:aisettingschange", { detail: nextSettings }),
    );
    if (account) {
      await fetch("/api/ai/settings", {
        body: JSON.stringify({ settings: nextSettings }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }).catch(() => undefined);
    }
  };

  const showMicrophoneDenied = useCallback(() => {
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
  }, [copy]);

  const handleMicrophone = useCallback(async () => {
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
  }, [isListening, showMicrophoneDenied]);

  useEffect(() => {
    const startVoiceInput = () => {
      if (!isListening) void handleMicrophone();
    };
    window.addEventListener("munetios:aistartvoice", startVoiceInput);
    return () =>
      window.removeEventListener("munetios:aistartvoice", startVoiceInput);
  }, [handleMicrophone, isListening]);

  const stopListening = () => setIsListening(false);
  const toggleTool = (toolId) => {
    setSelectedTools((current) =>
      current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [...current, toolId],
    );
  };
  const togglePinnedTool = async (toolId) => {
    const nextPinnedTools = pinnedTools.includes(toolId)
      ? pinnedTools.filter((id) => id !== toolId)
      : [...pinnedTools, toolId];
    setPinnedTools(nextPinnedTools);
    const nextSettings = {
      ...aiSettings,
      pinnedTools: nextPinnedTools,
    };
    window.dispatchEvent(
      new CustomEvent("munetios:aisettingschange", {
        detail: nextSettings,
      }),
    );
    if (account) {
      const response = await fetch("/api/ai/settings", {
        body: JSON.stringify({ settings: nextSettings }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }).catch(() => null);
      if (!response?.ok) {
        showToast({ message: copy.aiSettingsSaveFailed, type: "error" });
      }
    }
  };
  const openAttachmentPicker = () => attachmentInputRef.current?.click();
  const activateTool = (toolId) => {
    if (!signedIn && guestRestrictedTools.has(toolId)) {
      openUnlockFeaturesModal(copy);
      return;
    }
    if (toolId === "agent") {
      showModal(<p>{copy.aiSettingsAgentComingSoon}</p>, {
        ariaLabel: copy.aiSettingsAgent,
        title: copy.aiSettingsAgent,
      });
      return;
    }
    if (toolId === "attach-files") {
      openAttachmentPicker();
      return;
    }
    toggleTool(toolId);
  };
  const removeAllAttachments = () => {
    setAttachments((current) => {
      for (const attachment of current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
      return [];
    });
    setSelectedTools((current) =>
      current.filter((id) => id !== "attach-files"),
    );
  };
  const removeAttachment = (attachmentId) => {
    setAttachments((current) => {
      const removed = current.find(({ id }) => id === attachmentId);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      const next = current.filter(({ id }) => id !== attachmentId);
      if (next.length === 0) {
        setSelectedTools((tools) =>
          tools.filter((id) => id !== "attach-files"),
        );
      }
      return next;
    });
  };
  const handleAttachments = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const next = files.map((file) => ({
      file,
      id:
        globalThis.crypto?.randomUUID?.() ||
        `${file.name}-${file.lastModified}-${Math.random()}`,
      previewUrl: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : "",
    }));
    setAttachments((current) => [...current, ...next]);
    setSelectedTools((current) =>
      current.includes("attach-files")
        ? current
        : [...current, "attach-files"],
    );
    event.target.value = "";
  };
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const getTool = (toolId) =>
    composerTools.find(([id]) => id === toolId) || composerTools[0];
  const toolMenu = (
    <div className="munetios-ai-tool-menu" data-dropdown-keep-open="true">
      {composerTools.map(([id, icon, key]) => (
        <div className="munetios-ai-tool-menu-row" key={id}>
          <button
            aria-pressed={selectedTools.includes(id)}
            onClick={() => activateTool(id)}
            type="button"
          >
            <icon>{icon}</icon>
            <span>{copy[key]}</span>
            {selectedTools.includes(id) ? <icon>check</icon> : null}
          </button>
          <button
            aria-label={`${copy.aiPinTool}: ${copy[key]}`}
            aria-pressed={pinnedTools.includes(id)}
            onClick={() => togglePinnedTool(id)}
            type="button"
          >
            <icon>{pinnedTools.includes(id) ? "keep" : "keep_off"}</icon>
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <section className="munetios-ai-new-chat">
      <div className="munetios-ai-new-chat-content">
        <div className="munetios-ai-new-chat-logo">
          <Image
            alt="Munetios AI"
            height={72}
            priority
            src="/ai.png"
            width={72}
          />
        </div>
        <p className="munetios-ai-new-chat-eyebrow">
          <icon>auto_awesome</icon>
          <span>{copy.aiForYouPoweredBy}</span>
        </p>
        <h1>{greeting}</h1>
        <p className="munetios-ai-new-chat-subtitle">
          {copy.aiNewChatSubtitle}
        </p>

        {limitNotice ? (
          <div className="munetios-ai-usage-notice is-limit">
            <icon>schedule</icon>
            <span>{limitNotice}</span>
          </div>
        ) : lowCredits ? (
          <div className="munetios-ai-usage-notice">
            <icon>warning</icon>
            <span>{copy.aiUsageAlmostOut}</span>
          </div>
        ) : null}
        <form
          className={`munetios-ai-composer liquid-glass ${isListening ? "is-listening" : ""} ${pinnedTools.length ? "is-expanded" : ""}`}
          onSubmit={(event) => event.preventDefault()}
        >
          <input
            className="munetios-ai-attachment-input"
            multiple
            onChange={handleAttachments}
            ref={attachmentInputRef}
            type="file"
          />
          <div className="munetios-ai-composer-input-row">
            {isListening ? (
              <span
                aria-hidden="true"
                className="munetios-ai-composer-listening-icon"
              >
                <icon>mic</icon>
              </span>
            ) : null}
            <textarea
              aria-label={
                isListening ? copy.aiListening : copy.aiPromptPlaceholder
              }
              disabled={isListening}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                isListening ? copy.aiListening : copy.aiPromptPlaceholder
              }
              rows={pinnedTools.length ? 3 : 1}
              value={prompt}
            />
          </div>
          {selectedTools.length ? (
            <div className="munetios-ai-selected-tools">
              <icon className="munetios-ai-selected-tools-add">add</icon>
              {selectedTools.map((toolId) => {
                const [, icon, key] = getTool(toolId);
                return (
                  <button
                    key={toolId}
                    onClick={() =>
                      toolId === "attach-files"
                        ? removeAllAttachments()
                        : toggleTool(toolId)
                    }
                    type="button"
                  >
                    <icon>{icon}</icon>
                    <span>{copy[key]}</span>
                    <icon>close</icon>
                  </button>
                );
              })}
            </div>
          ) : null}
          {attachments.length ? (
            <section
              aria-label={copy.aiAttachedFiles}
              className="munetios-ai-attachment-previews"
            >
              {attachments.map((attachment) => (
                <article key={attachment.id}>
                  {attachment.previewUrl ? (
                    // biome-ignore lint/performance/noImgElement: browser object URLs provide local attachment previews.
                    <img
                      alt={attachment.file.name}
                      src={attachment.previewUrl}
                    />
                  ) : (
                    <span className="munetios-ai-attachment-file-icon">
                      <icon>description</icon>
                    </span>
                  )}
                  <span className="munetios-ai-attachment-details">
                    <strong>{attachment.file.name}</strong>
                    <small>
                      {attachment.file.type || copy.aiAttachmentFile} ·{" "}
                      {formatFileSize(attachment.file.size)}
                    </small>
                  </span>
                  <button
                    aria-label={`${copy.aiRemoveAttachment}: ${attachment.file.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                    type="button"
                  >
                    <icon>close</icon>
                  </button>
                </article>
              ))}
            </section>
          ) : null}
          <div className="munetios-ai-composer-bottom-row">
            <div className="munetios-ai-composer-tools">
              {!isListening ? (
                <DropdownWrapper
                  align="left"
                  ariaLabel={copy.aiPromptAdd}
                  buttonClassName="munetios-ai-composer-action"
                  panelClassName="w-[min(24rem,calc(100vw-1rem))]"
                  trigger={<icon>add</icon>}
                  triggerGlass={false}
                >
                  {toolMenu}
                </DropdownWrapper>
              ) : null}
              {pinnedTools.map((toolId) => {
                const [, icon, key] = getTool(toolId);
                return (
                  <button
                    aria-label={copy[key]}
                    aria-pressed={selectedTools.includes(toolId)}
                    className="munetios-ai-pinned-tool"
                    key={toolId}
                    onClick={() => activateTool(toolId)}
                    type="button"
                  >
                    <icon>{icon}</icon>
                  </button>
                );
              })}
            </div>
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
                <DropdownWrapper
                  align="right"
                  ariaLabel={copy.aiModelPicker}
                  buttonClassName="munetios-ai-model-trigger"
                  panelClassName="w-[min(27rem,calc(100vw-1rem))]"
                  trigger={
                    <>
                      <span>{selectedModelLabel}</span>
                      <small>{modelCosts[selectedModel] ?? 0}x</small>
                      <icon>expand_more</icon>
                    </>
                  }
                  triggerGlass={false}
                >
                  {models.map(([id, label, requiresSignIn]) => (
                    <button
                      className="munetios-ai-model-option"
                      data-dropdown-close
                      key={id}
                      onClick={() => selectModel(id)}
                      role="menuitem"
                      type="button"
                    >
                      <span>{label}</span>
                      <strong>
                        {requiresSignIn && !signedIn ? (
                          <icon>lock</icon>
                        ) : (
                          `${modelCosts[id] ?? 0}x`
                        )}
                      </strong>
                    </button>
                  ))}
                </DropdownWrapper>
                <button
                  aria-label={copy.aiPromptMicrophone}
                  className="munetios-ai-composer-microphone"
                  onClick={handleMicrophone}
                  type="button"
                >
                  <icon>mic</icon>
                </button>
                {prompt.trim() || attachments.length ? (
                  <button
                    aria-label={copy.aiPromptSend}
                    className="munetios-ai-composer-send is-send"
                    type="button"
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
          </div>
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
