"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { openColorPickerModal } from "../../../components/colorPickerModal";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import {
  developerSettingsChangeEvent,
  loadDeveloperSettings,
} from "../../../lib/developerSettings";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import {
  getGuestConversation,
  saveGuestConversation,
} from "../lib/guestConversations";
import {
  createVoiceConversationKey,
  decryptVoiceConversation,
  encryptVoiceConversation,
} from "../lib/voiceConversationCrypto";
import { openAiSettingsModal } from "./settingsModal";
import {
  playVoiceTypingDenied,
  playVoiceTypingStart,
  playVoiceTypingStop,
} from "./tonesounds";
import VoiceMode from "./voiceMode";

const microphoneDeniedImage = "https://api.munetios.com/cdn/micdenied.png";
const hiddenCardsStorageKey = "munetios.ai.hiddenForYouCards";
const pinnedToolsStorageKey = "munetios.ai.pinnedTools";
const selectedModelStorageKey = "munetios.ai.selectedModel";
const drawingColors = [
  "#111827",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0ea5e9",
  "#7c3aed",
];
const recommendationCards = [
  {
    descriptionKey: "aiForYouTasksDescription",
    icon: "task_alt",
    id: "tasks",
    titleKey: "aiForYouTasksTitle",
  },
  {
    descriptionKey: "aiForYouConnectorsDescription",
    icon: "extension",
    id: "connectors",
    titleKey: "aiForYouConnectorsTitle",
  },
  {
    descriptionKey: "aiForYouHistoryDescription",
    icon: "history",
    id: "history",
    titleKey: "aiForYouHistoryTitle",
  },
  {
    descriptionKey: "aiForYouWorkspaceDescription",
    icon: "folder_data",
    id: "workspace",
    titleKey: "aiForYouWorkspaceTitle",
  },
  {
    descriptionKey: "aiImagesDescription",
    icon: "add_photo_alternate",
    id: "create-image",
    titleKey: "aiImagesCreate",
  },
  {
    descriptionKey: "aiNewChatSubtitle",
    icon: "travel_explore",
    id: "research",
    titleKey: "aiToolDeepResearch",
  },
  {
    descriptionKey: "aiCanvasContinuePrompt",
    icon: "edit_document",
    id: "canvas-idea",
    titleKey: "aiToolCanvas",
  },
  {
    descriptionKey: "aiNewChatSubtitle",
    icon: "school",
    id: "study",
    titleKey: "aiToolStudyQuizzes",
  },
];
const composerTools = [
  { icon: "attach_file", id: "attach-files", key: "aiToolAttachFiles" },
  { icon: "draw", id: "draw-sketch", key: "aiToolDrawSketch" },
  { disabled: true, icon: "cloud_upload", id: "drive", key: "aiUploadDrive" },
  {
    dividerBefore: true,
    icon: "add_photo_alternate",
    id: "image",
    key: "aiImagesCreate",
  },
  { icon: "search", id: "web-search", key: "aiToolWebSearch" },
  { icon: "travel_explore", id: "deep-research", key: "aiToolDeepResearch" },
  { icon: "highlight_mouse_cursor", id: "agent", key: "aiToolAgentMode" },
  { icon: "edit_document", id: "canvas", key: "aiToolCanvas" },
  { icon: "school", id: "study-quizzes", key: "aiToolStudyQuizzes" },
];
const loadingComposerToolIds = new Set([
  "attach-files",
  "draw-sketch",
  "web-search",
  "canvas",
]);
const models = [
  ["munet-1-instant", "Munet 1.0 Instant"],
  ["munet-1-mini", "Munet 1.0 Mini"],
  ["munet-1-thinking", "Munet 1.0 Thinking"],
  ["munet-1-pro", "Munet 1.0 Pro"],
  ["munet-1-advanced-plus", "Munet 1.0 Advanced+"],
  ["munet-1-code-advanced-plus", "Munet 1.0 Code Advanced+"],
];
const internalModels = [
  ["gpt-5.6-sol", "GPT-5.6 Sol"],
  ["gpt-5.6-terra", "GPT-5.6 Terra"],
  ["gpt-5.6-luna", "GPT-5.6 Luna"],
  ["gpt-5.5", "GPT-5.5"],
  ["gpt-5.4", "GPT-5.4"],
  ["gpt-5", "GPT-5"],
  ["gpt-4.1", "GPT-4.1"],
  ["gpt-4o", "GPT-4o"],
  ["o3", "OpenAI o3"],
  ["o4-mini", "OpenAI o4-mini"],
  ["claude-opus-4-1", "Claude Opus 4.1"],
  ["claude-sonnet-4", "Claude Sonnet 4"],
  ["claude-3-7-sonnet", "Claude 3.7 Sonnet"],
  ["claude-3-5-haiku", "Claude 3.5 Haiku"],
  ["gemini-2.5-pro", "Gemini 2.5 Pro"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash"],
  ["gemini-2.0-flash", "Gemini 2.0 Flash"],
  ["grok-4", "Grok 4"],
  ["grok-3", "Grok 3"],
  ["llama-4-maverick", "Llama 4 Maverick"],
  ["llama-4-scout", "Llama 4 Scout"],
  ["llama-3.3-70b-instruct", "Llama 3.3 70B Instruct"],
  ["mistral-large-latest", "Mistral Large"],
  ["mistral-small-latest", "Mistral Small"],
  ["codestral-latest", "Codestral"],
  ["deepseek-r1", "DeepSeek R1"],
  ["deepseek-v3", "DeepSeek V3"],
  ["qwen3-235b-a22b", "Qwen3 235B A22B"],
  ["qwen2.5-coder-32b-instruct", "Qwen2.5 Coder 32B"],
  ["command-a-03-2025", "Cohere Command A"],
  ["command-r-plus", "Cohere Command R+"],
  ["jamba-1.5-large", "AI21 Jamba 1.5 Large"],
  ["amazon-nova-pro", "Amazon Nova Pro"],
  ["amazon-nova-lite", "Amazon Nova Lite"],
  ["amazon-nova-micro", "Amazon Nova Micro"],
  ["phi-4", "Microsoft Phi-4"],
  ["phi-4-multimodal-instruct", "Microsoft Phi-4 Multimodal"],
  ["nemotron-ultra-253b-v1", "NVIDIA Nemotron Ultra 253B"],
  ["kimi-k2", "Moonshot Kimi K2"],
  ["glm-4.5", "Zhipu GLM-4.5"],
  ["sonar-pro", "Perplexity Sonar Pro"],
  ["palmyra-x5", "Writer Palmyra X5"],
  ["granite-3.3-8b-instruct", "IBM Granite 3.3 8B"],
  ["dbrx-instruct", "Databricks DBRX Instruct"],
  ["yi-large", "01.AI Yi-Large"],
  ["ernie-4.5", "Baidu ERNIE 4.5"],
  ["hunyuan-t1", "Tencent Hunyuan T1"],
  ["reka-core", "Reka Core"],
  ["internal-munet-local-1", "Munet Local 1"],
  ["internal-munet-reasoning-lab", "Munet Reasoning Lab"],
  ["internal-munet-code-lab", "Munet Code Lab"],
];
const legacyModels = [
  ["legacy-munet-0-instant", "Munet 0 Instant"],
  ["legacy-munet-0-pro", "Munet 0 Pro"],
];
const otherModels = [
  ["other-experimental-small", "Experimental Small"],
  ["other-local-preview", "Local Preview"],
];
const hiddenBuiltInModels = [
  ...internalModels,
  ...legacyModels,
  ...otherModels,
];

function isKnownModel(modelId) {
  if ([...models, ...hiddenBuiltInModels].some(([id]) => id === modelId)) {
    return true;
  }
  return loadDeveloperSettings().byokProviders.some(
    (provider) => provider.id === modelId,
  );
}

function normalizePinnedTools(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((toolId) => (toolId === "image-generation" ? "image" : toolId))
        .filter((toolId) =>
          composerTools.some((tool) => tool.id === toolId && !tool.disabled),
        ),
    ),
  ];
}

function isPermissionError(error) {
  return ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(
    error?.name,
  );
}

function isMissingMicrophoneError(error) {
  return ["DevicesNotFoundError", "NotFoundError"].includes(error?.name);
}

function saveHiddenCardsLocally(cardIds) {
  return savePreferenceLocally(hiddenCardsStorageKey, JSON.stringify(cardIds));
}

function savePreferenceLocally(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return false;
  }
  return true;
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

function DrawSketchEditor({ close, copy, onSave }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [brushSize, setBrushSize] = useState(12);
  const [color, setColor] = useState("#111827");
  const [tool, setTool] = useState("brush");

  const configureContext = useCallback(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return null;
    context.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    context.strokeStyle = color;
    return context;
  }, [brushSize, color, tool]);

  const getCanvasPoint = (event) => {
    const canvas = canvasRef.current;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  };

  const beginDrawing = (event) => {
    const context = configureContext();
    if (!context) return;
    const point = getCanvasPoint(event);
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const continueDrawing = (event) => {
    if (!drawingRef.current) return;
    const context = configureContext();
    if (!context) return;
    const point = getCanvasPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const finishDrawing = (event) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    canvasRef.current?.getContext("2d")?.closePath();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="ai-draw-sketch-editor">
      <div className="ai-draw-toolbar">
        <div className="ai-draw-tool-toggle">
          <button
            aria-pressed={tool === "brush"}
            onClick={() => setTool("brush")}
            type="button"
          >
            <icon>draw</icon>
            <span>{copy.aiDraw}</span>
          </button>
          <button
            aria-pressed={tool === "eraser"}
            onClick={() => setTool("eraser")}
            type="button"
          >
            <icon>ink_eraser</icon>
            <span>{copy.aiDrawEraser}</span>
          </button>
        </div>
        <div className="ai-draw-colors">
          {drawingColors.map((swatch) => (
            <button
              aria-label={swatch}
              aria-pressed={tool === "brush" && color === swatch}
              key={swatch}
              onClick={() => {
                setColor(swatch);
                setTool("brush");
              }}
              style={{ backgroundColor: swatch }}
              type="button"
            />
          ))}
          <button
            aria-label={copy.accountAppearanceOpenColorPicker}
            className="ai-draw-custom-color"
            onClick={() =>
              openColorPickerModal({
                copy,
                onSelect: (nextColor) => {
                  setColor(nextColor);
                  setTool("brush");
                },
                value: color,
              })
            }
            style={{ "--draw-custom-color": color }}
            type="button"
          >
            <icon>palette</icon>
          </button>
        </div>
        <label className="ai-draw-brush-size">
          <span>
            {copy.aiDrawBrushSize}
            <output>{brushSize}px</output>
          </span>
          <input
            className="munetios-custom-slider"
            max="48"
            min="2"
            onChange={(event) => setBrushSize(Number(event.target.value))}
            style={{
              "--slider-progress": `${((brushSize - 2) / 46) * 100}%`,
            }}
            type="range"
            value={brushSize}
          />
        </label>
      </div>
      <canvas
        aria-label={`${copy.aiToolDrawSketch} ${copy.aiToolCanvas}`}
        height="700"
        onPointerCancel={finishDrawing}
        onPointerDown={beginDrawing}
        onPointerMove={continueDrawing}
        onPointerUp={finishDrawing}
        ref={canvasRef}
        role="img"
        width="1200"
      />
      <div className="ai-draw-actions">
        <button onClick={clearCanvas} type="button">
          {copy.appLauncherClearSearch}
        </button>
        <div>
          <button onClick={close} type="button">
            {copy.cancel}
          </button>
          <button
            className="is-primary"
            onClick={() => {
              onSave(canvasRef.current?.toDataURL("image/png") || "");
              close();
            }}
            type="button"
          >
            {copy.aiChatSave}
          </button>
        </div>
      </div>
    </div>
  );
}

function openDrawSketchModal({ copy, onSave }) {
  showModal(
    ({ close }) => (
      <DrawSketchEditor close={close} copy={copy} onSave={onSave} />
    ),
    {
      ariaLabel: copy.aiToolDrawSketch,
      closeOnBackdrop: false,
      maxWidth: "min(58rem, calc(100vw - 1rem))",
      modalType: "ai-draw-sketch",
      title: copy.aiToolDrawSketch,
      width: "min(58rem, calc(100vw - 1rem))",
    },
  );
}

export default function NewChatPage({
  appLoading = false,
  autoOpenVoiceMode = false,
  copy,
  educationStudent = false,
  openConversationId = "",
}) {
  const [attachments, setAttachments] = useState([]);
  const [drawing, setDrawing] = useState("");
  const [hiddenCards, setHiddenCards] = useState([]);
  const [listening, setListening] = useState(false);
  const [nickname, setNickname] = useState("");
  const [pinnedTools, setPinnedTools] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState("munet-1-instant");
  const [selectedTools, setSelectedTools] = useState([]);
  const [temporaryChat, setTemporaryChat] = useState(false);
  const [developerSettings, setDeveloperSettings] = useState(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelsLoadFailed, setModelsLoadFailed] = useState(false);
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [voiceModeSettings, setVoiceModeSettings] = useState(null);
  const [voicePromptTarget, setVoicePromptTarget] = useState(null);
  const [voiceConversation, setVoiceConversation] = useState(null);
  const [voiceConversationKey, setVoiceConversationKey] = useState("");
  const attachmentInputRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const hiddenCardsRef = useRef([]);
  const listeningRef = useRef(false);
  const promptBeforeListeningRef = useRef("");
  const recognitionRef = useRef(null);
  const settingsRef = useRef(null);
  const voiceFailureHandledRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let locallyHidden = [];
    let locallyPinned = [];
    let locallySelectedModel = "munet-1-instant";
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(hiddenCardsStorageKey) || "[]",
      );
      locallyHidden = Array.isArray(saved)
        ? saved.filter((cardId) =>
            recommendationCards.some((card) => card.id === cardId),
          )
        : [];
      locallyPinned = normalizePinnedTools(
        JSON.parse(window.localStorage.getItem(pinnedToolsStorageKey) || "[]"),
      );
      const savedModel = window.localStorage.getItem(selectedModelStorageKey);
      locallySelectedModel = isKnownModel(savedModel)
        ? savedModel
        : "munet-1-instant";
    } catch {
      locallyHidden = [];
      locallyPinned = [];
    }
    hiddenCardsRef.current = locallyHidden;
    setHiddenCards(locallyHidden);
    setPinnedTools(locallyPinned);
    setSelectedModel(locallySelectedModel);

    fetch("/api/ai/settings", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setModelsLoadFailed(true);
          return null;
        }
        return response.json();
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (!payload?.settings) {
          setModelsLoadFailed(true);
          return;
        }
        setModelsLoadFailed(false);
        const accountHidden = Array.isArray(payload.settings.hiddenForYouCards)
          ? payload.settings.hiddenForYouCards.filter((cardId) =>
              recommendationCards.some((card) => card.id === cardId),
            )
          : [];
        const merged = [
          ...new Set([...accountHidden, ...hiddenCardsRef.current]),
        ];
        const accountPinned = normalizePinnedTools(
          payload.settings.pinnedTools,
        );
        const mergedPinned = normalizePinnedTools([
          ...accountPinned,
          ...locallyPinned,
        ]);
        const localDeveloperModel =
          isKnownModel(locallySelectedModel) &&
          !models.some(([modelId]) => modelId === locallySelectedModel);
        const accountModel = localDeveloperModel
          ? locallySelectedModel
          : isKnownModel(payload.settings.selectedModel)
            ? payload.settings.selectedModel
            : "munet-1-instant";
        const nextSettings = {
          ...payload.settings,
          hiddenForYouCards: merged,
          pinnedTools: mergedPinned,
          selectedModel: accountModel,
        };
        settingsRef.current = nextSettings;
        setVoiceModeSettings(nextSettings);
        hiddenCardsRef.current = merged;
        setHiddenCards(merged);
        setNickname(String(payload.settings.nickname || "").trim());
        setPinnedTools(mergedPinned);
        setSelectedModel(accountModel);
        saveHiddenCardsLocally(merged);
        savePreferenceLocally(
          pinnedToolsStorageKey,
          JSON.stringify(mergedPinned),
        );
        savePreferenceLocally(selectedModelStorageKey, accountModel);

        if (
          merged.length !== accountHidden.length ||
          mergedPinned.length !== accountPinned.length
        ) {
          void fetch("/api/ai/settings", {
            body: JSON.stringify({ settings: nextSettings }),
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            method: "PATCH",
          }).catch(() => undefined);
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          settingsRef.current = null;
          setModelsLoadFailed(true);
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const refresh = (event) =>
      setDeveloperSettings(event?.detail || loadDeveloperSettings());
    refresh();
    window.addEventListener(developerSettingsChangeEvent, refresh);
    return () =>
      window.removeEventListener(developerSettingsChangeEvent, refresh);
  }, []);

  useEffect(() => {
    const syncSettings = (event) => {
      if (!event.detail || typeof event.detail !== "object") return;
      settingsRef.current = event.detail;
      setVoiceModeSettings(event.detail);
      const accountHidden = Array.isArray(event.detail.hiddenForYouCards)
        ? event.detail.hiddenForYouCards.filter((cardId) =>
            recommendationCards.some((card) => card.id === cardId),
          )
        : [];
      hiddenCardsRef.current = accountHidden;
      setHiddenCards(accountHidden);
      setNickname(String(event.detail.nickname || "").trim());
      const accountPinned = normalizePinnedTools(event.detail.pinnedTools);
      setPinnedTools(accountPinned);
      const accountModel = isKnownModel(event.detail.selectedModel)
        ? event.detail.selectedModel
        : "munet-1-instant";
      setSelectedModel(accountModel);
      saveHiddenCardsLocally(accountHidden);
      savePreferenceLocally(
        pinnedToolsStorageKey,
        JSON.stringify(accountPinned),
      );
      savePreferenceLocally(selectedModelStorageKey, accountModel);
    };
    window.addEventListener("munetios:aisettingschange", syncSettings);
    return () =>
      window.removeEventListener("munetios:aisettingschange", syncSettings);
  }, []);

  const hideRecommendation = (cardId) => {
    const next = hiddenCardsRef.current.includes(cardId)
      ? hiddenCardsRef.current
      : [...hiddenCardsRef.current, cardId];
    hiddenCardsRef.current = next;
    setHiddenCards(next);
    saveHiddenCardsLocally(next);

    if (!settingsRef.current) return;
    const nextSettings = {
      ...settingsRef.current,
      hiddenForYouCards: next,
    };
    settingsRef.current = nextSettings;
    void fetch("/api/ai/settings", {
      body: JSON.stringify({ settings: nextSettings }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        settingsRef.current = payload.settings || nextSettings;
      })
      .catch(() => undefined);
  };

  const persistComposerPreference = (patch) => {
    if (!settingsRef.current) return;
    const nextSettings = { ...settingsRef.current, ...patch };
    settingsRef.current = nextSettings;
    void fetch("/api/ai/settings", {
      body: JSON.stringify({ settings: nextSettings }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        settingsRef.current = payload.settings || nextSettings;
      })
      .catch(() => undefined);
  };

  const startVoiceMode = useCallback(() => {
    if (window.location.pathname !== "/apps/ai/voice") {
      window.history.pushState({}, "", "/apps/ai/voice");
    }
    setVoiceModeOpen(true);
  }, []);

  const updateVoiceModeSettings = async (patch) => {
    const previousSettings = settingsRef.current || voiceModeSettings || {};
    const nextSettings = { ...previousSettings, ...patch };
    settingsRef.current = nextSettings;
    setVoiceModeSettings(nextSettings);
    try {
      const response = await fetch("/api/ai/settings", {
        body: JSON.stringify({ settings: nextSettings }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) throw new Error("voice_update_failed");
      const payload = await response.json();
      const savedSettings = payload.settings || nextSettings;
      settingsRef.current = savedSettings;
      setVoiceModeSettings(savedSettings);
      window.dispatchEvent(
        new CustomEvent("munetios:aisettingschange", {
          detail: savedSettings,
        }),
      );
      return savedSettings;
    } catch (error) {
      settingsRef.current = previousSettings;
      setVoiceModeSettings(previousSettings);
      throw error;
    }
  };

  useEffect(() => {
    window.addEventListener("munetios:aivoicestart", startVoiceMode);
    return () =>
      window.removeEventListener("munetios:aivoicestart", startVoiceMode);
  }, [startVoiceMode]);

  useEffect(() => {
    if (autoOpenVoiceMode) setVoiceModeOpen(true);
  }, [autoOpenVoiceMode]);

  useEffect(() => {
    if (!openConversationId) return undefined;
    const controller = new AbortController();
    const loadConversation = async () => {
      try {
        if (!hasSignedInCookie()) {
          const localConversation = getGuestConversation(openConversationId);
          if (!localConversation)
            throw new Error(`fetch_${openConversationId}`);
          if (localConversation.type !== "voice") return;
          setVoiceConversation(localConversation);
          setVoiceConversationKey("");
          setVoiceModeOpen(true);
          return;
        }
        const response = await fetch(
          `/api/ai/conversations?id=${encodeURIComponent(openConversationId)}`,
          { credentials: "include", signal: controller.signal },
        );
        if (!response.ok) throw new Error(`fetch_${openConversationId}`);
        const payload = await response.json();
        if (payload.conversation?.type !== "voice") return;
        const key =
          window.localStorage.getItem(
            `munetios.ai.voiceConversationKey.${openConversationId}`,
          ) || "";
        const transcript =
          payload.conversation.encryptedPayload && key
            ? await decryptVoiceConversation(
                payload.conversation.encryptedPayload,
                key,
              )
            : payload.conversation.messages || [];
        setVoiceConversation({ ...payload.conversation, messages: transcript });
        setVoiceConversationKey(key);
        setVoiceModeOpen(true);
      } catch (error) {
        if (error?.name !== "AbortError") {
          showToast({
            message: copy.aiConversationFetchFailed.replace(
              "{id}",
              openConversationId,
            ),
            type: "error",
          });
        }
      }
    };
    void loadConversation();
    return () => controller.abort();
  }, [copy.aiConversationFetchFailed, openConversationId]);

  const persistVoiceTranscript = useCallback(
    async (transcript) => {
      if (!transcript.length) return;
      if (!hasSignedInCookie()) {
        const conversation = saveGuestConversation({
          id: voiceConversation?.id || "",
          messages: transcript,
          model: selectedModel,
          title: voiceConversation?.title || copy.aiVoiceMode,
          type: "voice",
        });
        setVoiceConversation(conversation);
        return;
      }
      let key = voiceConversationKey;
      if (!key) {
        key = await createVoiceConversationKey();
        setVoiceConversationKey(key);
      }
      const encryptedPayload = await encryptVoiceConversation(transcript, key);
      const currentId = voiceConversation?.id || "";
      const response = await fetch("/api/ai/conversations", {
        body: JSON.stringify(
          currentId
            ? {
                action: "save-encrypted",
                encryptedPayload,
                id: currentId,
                title: voiceConversation.title,
              }
            : { encryptedPayload, title: copy.aiVoiceMode, type: "voice" },
        ),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: currentId ? "PATCH" : "POST",
      });
      if (!response.ok) throw new Error("voice_conversation_save_failed");
      const payload = await response.json();
      const conversation = payload.conversation;
      if (conversation?.id) {
        window.localStorage.setItem(
          `munetios.ai.voiceConversationKey.${conversation.id}`,
          key,
        );
        setVoiceConversation({ ...conversation, messages: transcript });
        window.dispatchEvent(new Event("munetios:aiconversationschange"));
      }
    },
    [copy.aiVoiceMode, selectedModel, voiceConversation, voiceConversationKey],
  );

  const togglePinnedTool = (toolId) => {
    const next = pinnedTools.includes(toolId)
      ? pinnedTools.filter((id) => id !== toolId)
      : [...pinnedTools, toolId];
    setPinnedTools(next);
    savePreferenceLocally(pinnedToolsStorageKey, JSON.stringify(next));
    persistComposerPreference({ pinnedTools: next });
  };

  const selectModel = (modelId) => {
    setSelectedModel(modelId);
    savePreferenceLocally(selectedModelStorageKey, modelId);
    persistComposerPreference({ selectedModel: modelId });
  };
  const showHiddenModels = Boolean(
    developerSettings?.developerMode && developerSettings?.showHiddenItems,
  );
  const voiceModeType = voiceModeSettings?.voiceModeType || "prompt";
  const voicePromptActive = voiceModeOpen && voiceModeType === "prompt";
  const byokModels = (developerSettings?.byokProviders || []).map(
    (provider) => [provider.id, provider.name],
  );
  const showInternalModelFallback = modelsLoadFailed && !showHiddenModels;
  const availableModels = showHiddenModels
    ? [...models, ...hiddenBuiltInModels, ...byokModels]
    : showInternalModelFallback
      ? [...models, ...internalModels]
      : models;
  const modelGroups = showHiddenModels
    ? [
        [copy.developerCurrentModels, models],
        [copy.developerInternalModels, internalModels],
        [copy.developerLegacyModels, legacyModels],
        [copy.developerOtherModels, [...otherModels, ...byokModels]],
      ]
    : showInternalModelFallback
      ? [
          [copy.developerCurrentModels, models],
          [copy.developerInternalModels, internalModels],
        ]
      : [["", models]];
  const normalizedModelSearch = modelSearch.trim().toLowerCase();
  const sendPrompt = () => {
    if (
      !models.some(([modelId]) => modelId === selectedModel) &&
      !showInternalModelFallback
    ) {
      showToast({
        message: copy.developerHiddenModelSendFailed,
        type: "error",
      });
    }
  };

  const toggleTemporaryChat = () => {
    const next = !temporaryChat;
    setTemporaryChat(next);
    if (next) {
      setSelectedTools((current) =>
        current.filter(
          (toolId) => !["agent", "deep-research"].includes(toolId),
        ),
      );
    }
    window.dispatchEvent(
      new CustomEvent("munetios:ai-temporary-chat-change", {
        detail: { enabled: next },
      }),
    );
  };

  const finishListening = useCallback(async () => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    setListening(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.stop();
    }
    await playVoiceTypingStop().catch(() => {});
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
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      await playVoiceTypingDenied().catch(() => {});

      if (
        isPermissionError(error) ||
        ["not-allowed", "service-not-allowed"].includes(error?.error)
      ) {
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
      showToast({ messageKey: "aiVoiceInputFailedToast", type: "error" });
    },
    [copy],
  );

  const startListening = useCallback(async () => {
    if (listeningRef.current) {
      await finishListening();
      return;
    }
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
          const transcript = event.results[index][0].transcript;
          if (event.results[index].isFinal) {
            finalTranscriptRef.current += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        setPrompt(
          [
            promptBeforeListeningRef.current,
            finalTranscriptRef.current,
            interimTranscript,
          ]
            .filter(Boolean)
            .join(" ")
            .trim(),
        );
      };
      recognition.onerror = (event) => void handleVoiceFailure(event);
      recognition.onend = () => {
        listeningRef.current = false;
        recognitionRef.current = null;
        setListening(false);
      };
      recognition.start();
    } catch (error) {
      await handleVoiceFailure(error);
    }
  }, [finishListening, handleVoiceFailure, prompt]);

  const toggleTool = (toolId) => {
    setSelectedTools((current) =>
      current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [...current, toolId],
    );
  };

  const activateTool = (toolId) => {
    if (toolId === "attach-files") {
      attachmentInputRef.current?.click();
      return;
    }
    if (toolId === "draw-sketch") {
      openDrawSketchModal({
        copy,
        onSave: (drawingData) => {
          setDrawing(drawingData);
          setSelectedTools((current) =>
            current.includes(toolId) ? current : [...current, toolId],
          );
        },
      });
      return;
    }
    toggleTool(toolId);
  };

  const removeTool = (toolId) => {
    setSelectedTools((current) => current.filter((id) => id !== toolId));
    if (toolId === "attach-files") setAttachments([]);
    if (toolId === "draw-sketch") setDrawing("");
  };

  const toolMenu = (
    <div className="munetios-ai-tool-menu">
      {composerTools
        .filter(
          (tool) =>
            (!appLoading || loadingComposerToolIds.has(tool.id)) &&
            (!temporaryChat || !["agent", "deep-research"].includes(tool.id)) &&
            (!educationStudent || !["agent", "image"].includes(tool.id)),
        )
        .map((tool) => (
          <div
            className={tool.dividerBefore ? "has-divider" : ""}
            key={tool.id}
          >
            <button
              className="munetios-ai-tool-menu-action"
              aria-pressed={selectedTools.includes(tool.id)}
              data-dropdown-close={!tool.disabled ? "true" : undefined}
              disabled={tool.disabled}
              onClick={() => activateTool(tool.id)}
              type="button"
            >
              <icon>{tool.icon}</icon>
              <span>{copy[tool.key]}</span>
              {tool.disabled ? <small>({copy.comingSoon})</small> : null}
              {selectedTools.includes(tool.id) ? <icon>check</icon> : null}
            </button>
            {!tool.disabled
              ? <button
                  aria-label={`${copy.aiPinTool}: ${copy[tool.key]}`}
                  aria-pressed={pinnedTools.includes(tool.id)}
                  className="munetios-ai-tool-pin"
                  data-dropdown-keep-open
                  onClick={() => togglePinnedTool(tool.id)}
                  type="button"
                >
                  <icon>
                    {pinnedTools.includes(tool.id) ? "keep" : "keep_off"}
                  </icon>
                </button>
              : null}
          </div>
        ))}
    </div>
  );

  return (
    <section className="munetios-ai-new-chat">
      <div className="munetios-ai-new-chat-topbar liquid-glass">
        <button
          aria-label={copy.aiSettingsPersonalization}
          onClick={() =>
            openAiSettingsModal({
              initialPanel: "personalization",
              signedIn: hasSignedInCookie(),
            })
          }
          type="button"
        >
          <icon>tune</icon>
        </button>
        <button
          aria-label={copy.aiTemporaryChat}
          aria-pressed={temporaryChat}
          className="munetios-ai-temporary-chat"
          onClick={toggleTemporaryChat}
          type="button"
        >
          <icon>chat_dashed</icon>
        </button>
      </div>
      <div className="munetios-ai-new-chat-content">
        <header className="munetios-ai-new-chat-hero">
          <Image
            alt="Munetios AI"
            height={72}
            priority
            src="/ai.png"
            width={72}
          />
          <h1>
            {nickname
              ? `${copy.aiNewChatGreetingName.replace("{name}", nickname)} ${copy.aiNewChatGreeting}`
              : copy.aiNewChatGreeting}
          </h1>
        </header>

        {temporaryChat
          ? <aside className="munetios-ai-temporary-notice liquid-glass">
              <icon>history_toggle_off</icon>
              <div>
                <strong>{copy.aiTemporaryMode}</strong>
                <p>{copy.aiTemporaryModeDescription}</p>
              </div>
            </aside>
          : null}

        <div
          className={`munetios-ai-composer liquid-glass${selectedTools.length || attachments.length || drawing ? " is-expanded" : ""}${voicePromptActive ? " has-voice-prompt" : ""}`}
          data-temporary-chat={temporaryChat || undefined}
          data-voice-prompt={voicePromptActive || undefined}
        >
          {voicePromptActive
            ? <div
                className="munetios-ai-voice-prompt-slot"
                ref={setVoicePromptTarget}
              />
            : <>
                <input
                  className="munetios-ai-attachment-input"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    if (!files.length) return;
                    setAttachments((current) => [...current, ...files]);
                    setSelectedTools((current) =>
                      current.includes("attach-files")
                        ? current
                        : [...current, "attach-files"],
                    );
                    event.target.value = "";
                  }}
                  ref={attachmentInputRef}
                  type="file"
                />
                <textarea
                  aria-label={copy.aiCodeAskAnything}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={
                    listening ? copy.aiListening : copy.aiCodeAskAnything
                  }
                  rows="2"
                  value={prompt}
                />
                {attachments.length || drawing
                  ? <div className="munetios-ai-composer-attachments">
                      {drawing
                        ? // biome-ignore lint/performance/noImgElement: the sketch preview is a browser-generated data URL.
                          <img alt={copy.aiToolDrawSketch} src={drawing} />
                        : null}
                      {attachments.map((file) => (
                        <span key={`${file.name}-${file.lastModified}`}>
                          <icon>description</icon>
                          {file.name}
                        </span>
                      ))}
                    </div>
                  : null}
                <div className="munetios-ai-composer-bottom-row">
                  <div className="munetios-ai-composer-tools">
                    <DropdownWrapper
                      align="left"
                      ariaLabel={copy.aiPromptAdd}
                      buttonClassName="munetios-ai-composer-action"
                      panelClassName="munetios-ai-tool-panel"
                      trigger={<icon>add</icon>}
                      triggerGlass={false}
                    >
                      {toolMenu}
                    </DropdownWrapper>
                    {!appLoading
                      ? pinnedTools
                          .filter(
                            (toolId) =>
                              (!temporaryChat ||
                                !["agent", "deep-research"].includes(toolId)) &&
                              (!educationStudent ||
                                !["agent", "image"].includes(toolId)),
                          )
                          .map((toolId, toolIndex) => {
                            const tool = composerTools.find(
                              (item) => item.id === toolId,
                            );
                            if (!tool) return null;
                            return (
                              <button
                                aria-label={copy[tool.key]}
                                aria-pressed={selectedTools.includes(tool.id)}
                                className="munetios-ai-pinned-tool"
                                data-mobile-overflow={
                                  toolIndex >= 2 ? "true" : undefined
                                }
                                key={tool.id}
                                onClick={() => activateTool(tool.id)}
                                type="button"
                              >
                                <icon>{tool.icon}</icon>
                              </button>
                            );
                          })
                      : null}
                    {!appLoading
                      ? selectedTools.map((toolId, toolIndex) => {
                          const tool = composerTools.find(
                            (item) => item.id === toolId,
                          );
                          if (!tool) return null;
                          return (
                            <button
                              className="munetios-ai-selected-tool"
                              data-mobile-overflow={
                                toolIndex >= 1 ? "true" : undefined
                              }
                              key={tool.id}
                              onClick={() => removeTool(tool.id)}
                              type="button"
                            >
                              <icon>{tool.icon}</icon>
                              <span>{copy[tool.key]}</span>
                              <icon>close</icon>
                            </button>
                          );
                        })
                      : null}
                  </div>
                  <div className="munetios-ai-composer-actions">
                    {!appLoading
                      ? <DropdownWrapper
                          align="right"
                          ariaLabel={copy.aiModelPicker}
                          buttonClassName="munetios-ai-model-trigger"
                          panelClassName="munetios-ai-model-menu"
                          trigger={
                            <>
                              <span>
                                {availableModels.find(
                                  ([modelId]) => modelId === selectedModel,
                                )?.[1] || models[0][1]}
                              </span>
                              <icon>expand_more</icon>
                            </>
                          }
                          triggerGlass={false}
                        >
                          {showHiddenModels || showInternalModelFallback
                            ? <input
                                aria-label={copy.developerInternalModelSearch}
                                className="munetios-ai-model-search"
                                onChange={(event) =>
                                  setModelSearch(event.target.value)
                                }
                                placeholder={copy.developerInternalModelSearch}
                                value={modelSearch}
                              />
                            : null}
                          {modelGroups.map(([groupLabel, groupModels]) => {
                            const visibleModels = groupModels.filter(
                              ([modelId, label]) =>
                                `${label} ${modelId}`
                                  .toLowerCase()
                                  .includes(normalizedModelSearch),
                            );
                            if (!visibleModels.length) return null;
                            return (
                              <div
                                className="munetios-ai-model-group"
                                key={groupLabel || "current"}
                              >
                                {groupLabel ? <p>{groupLabel}</p> : null}
                                {visibleModels.map(([modelId, label]) => (
                                  <button
                                    aria-pressed={selectedModel === modelId}
                                    className="munetios-ai-model-option"
                                    data-dropdown-close
                                    key={modelId}
                                    onClick={() => selectModel(modelId)}
                                    type="button"
                                  >
                                    <span className="munetios-ai-model-option-copy">
                                      <span>{label}</span>
                                      {showHiddenModels
                                        ? <code>{modelId}</code>
                                        : null}
                                    </span>
                                    {selectedModel === modelId
                                      ? <icon>check</icon>
                                      : null}
                                  </button>
                                ))}
                              </div>
                            );
                          })}
                        </DropdownWrapper>
                      : null}
                    <button
                      aria-label={
                        listening
                          ? copy.aiMicrophoneStop
                          : copy.aiPromptMicrophone
                      }
                      className={listening ? "is-listening" : ""}
                      data-ai-voice-input
                      onClick={() => void startListening()}
                      type="button"
                    >
                      <icon>{listening ? "stop_circle" : "mic"}</icon>
                    </button>
                    {prompt.trim() || attachments.length || drawing
                      ? <button
                          aria-label={copy.aiPromptSend}
                          className="is-accent"
                          onClick={sendPrompt}
                          type="button"
                        >
                          <icon>arrow_upward</icon>
                        </button>
                      : <button
                          aria-label={copy.aiVoiceMode}
                          className="is-accent"
                          onClick={startVoiceMode}
                          type="button"
                        >
                          <icon>graphic_eq</icon>
                        </button>}
                  </div>
                </div>
              </>}
        </div>

        {!temporaryChat
          ? <section
              aria-labelledby="ai-for-you-title"
              className="munetios-ai-for-you"
            >
              <h2 id="ai-for-you-title">{copy.aiForYouTitle}</h2>
              <div className="munetios-ai-for-you-grid">
                {recommendationCards
                  .filter(
                    (card) =>
                      !hiddenCards.includes(card.id) &&
                      (!educationStudent || card.id !== "create-image"),
                  )
                  .slice(0, 4)
                  .map((card) => (
                    <article className="liquid-glass" key={card.id}>
                      <span className="munetios-ai-for-you-icon">
                        <icon>{card.icon}</icon>
                      </span>
                      <div>
                        <h3>{copy[card.titleKey]}</h3>
                        <p>{copy[card.descriptionKey]}</p>
                      </div>
                      <DropdownWrapper
                        align="right"
                        ariaLabel={`${copy.aiSidebarMore}: ${copy[card.titleKey]}`}
                        buttonClassName="munetios-ai-card-more"
                        className="munetios-ai-card-menu-anchor"
                        panelClassName="munetios-ai-card-menu"
                        trigger={<icon>more_horiz</icon>}
                        triggerGlass={false}
                      >
                        <button
                          data-dropdown-close
                          onClick={() => hideRecommendation(card.id)}
                          type="button"
                        >
                          <icon>visibility_off</icon>
                          <span>{copy.aiNotInterested}</span>
                        </button>
                      </DropdownWrapper>
                    </article>
                  ))}
              </div>
            </section>
          : null}
      </div>
      {voiceModeOpen
        ? <VoiceMode
            appLoading={appLoading}
            copy={copy}
            conversationId={voiceConversation?.id || ""}
            initialTranscript={voiceConversation?.messages || []}
            nickname={nickname}
            onClose={() => {
              setVoiceModeOpen(false);
              setVoiceConversation(null);
              setVoiceConversationKey("");
              if (
                window.location.pathname === "/apps/ai/voice" ||
                window.location.pathname.startsWith("/apps/ai/v/")
              ) {
                window.history.replaceState({}, "", "/apps/ai");
              }
            }}
            onSettingsChange={updateVoiceModeSettings}
            onTranscriptChange={persistVoiceTranscript}
            promptTarget={voicePromptTarget}
            settings={voiceModeSettings}
            sharingDisabled={educationStudent}
          />
        : null}
    </section>
  );
}
