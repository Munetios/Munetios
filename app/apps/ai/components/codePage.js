"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import AppTopbarRight from "../../../components/appTopbarRight";
import DropdownWrapper from "../../../components/dropdownwrapper";
import LoadingSpinner from "../../../components/loadingSpinner";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { t } from "../../../i18n";
import { showParentalAwareToast } from "../../../lib/parentalControlsClient";
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

function attachmentKind(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    type.startsWith("text/") ||
    /\.(?:c|cc|cpp|css|csv|h|html|java|js|jsx|json|md|php|py|rb|rs|sh|sql|ts|tsx|txt|xml|ya?ml)$/u.test(
      name,
    )
  ) {
    return "text";
  }
  return "document";
}

function attachmentIcon(file) {
  return {
    document: "description",
    image: "image",
    pdf: "picture_as_pdf",
    text: "draft",
    video: "movie",
  }[attachmentKind(file)];
}

function formatAttachmentSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function AttachmentPreview({ attachment, textContent }) {
  const kind = attachmentKind(attachment.file);
  if (kind === "image") {
    return (
      <div className="ai-code-attachment-preview is-media">
        <Image
          alt={attachment.name}
          height={900}
          src={attachment.previewUrl}
          unoptimized
          width={1400}
        />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="ai-code-attachment-preview is-media">
        <video
          controls
          playsInline
          preload="metadata"
          src={attachment.previewUrl}
        >
          <track kind="captions" />
        </video>
      </div>
    );
  }
  if (kind === "pdf") {
    return (
      <iframe
        className="ai-code-attachment-document-frame"
        src={attachment.previewUrl}
        title={attachment.name}
      />
    );
  }
  if (kind === "text") {
    return <pre className="ai-code-attachment-text-preview">{textContent}</pre>;
  }
  return (
    <div className="ai-code-attachment-generic-preview">
      <icon>{attachmentIcon(attachment.file)}</icon>
      <strong>{attachment.name}</strong>
      <span>{attachment.file.type || "application/octet-stream"}</span>
      <span>{formatAttachmentSize(attachment.size)}</span>
    </div>
  );
}

async function fingerprintFile(file) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

const attachmentEncryptionKeyPromises = new Map();

function openAttachmentKeyDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("munetios-ai-e2ee", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("keys")) {
        request.result.createObjectStore("keys");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAttachmentEncryptionKey(accountId) {
  if (attachmentEncryptionKeyPromises.has(accountId)) {
    return attachmentEncryptionKeyPromises.get(accountId);
  }
  const keyName = `${accountId}:code-files-v1`;
  const keyPromise = (async () => {
    const database = await openAttachmentKeyDatabase();
    const existing = await new Promise((resolve, reject) => {
      const transaction = database.transaction("keys", "readonly");
      const request = transaction.objectStore("keys").get(keyName);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    if (existing) return existing;
    const key = await crypto.subtle.generateKey(
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("keys", "readwrite");
      transaction.objectStore("keys").put(key, keyName);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    return key;
  })().catch((error) => {
    attachmentEncryptionKeyPromises.delete(accountId);
    throw error;
  });
  attachmentEncryptionKeyPromises.set(accountId, keyPromise);
  return keyPromise;
}

async function encryptAttachment(file, accountId) {
  const key = await getAttachmentEncryptionKey(accountId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBytes = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    key,
    await file.arrayBuffer(),
  );
  return {
    body: new Blob([encryptedBytes], { type: "application/octet-stream" }),
    iv: bytesToBase64Url(iv),
  };
}

function RepositoryDropdown({ copy, onSelect, repositories, selected }) {
  return (
    <DropdownWrapper
      align="left"
      ariaLabel={copy.aiCodeRepository}
      buttonClassName="ai-code-toolbar-button"
      panelClassName="ai-code-select-menu"
      trigger={
        <>
          <icon>book_2</icon>
          <span>{selected?.name || copy.aiCodeRepository}</span>
          <icon>expand_more</icon>
        </>
      }
      triggerAs="button"
      triggerGlass={false}
    >
      {repositories.map((repository) => (
        <button
          aria-checked={selected?.id === repository.id}
          data-dropdown-close
          key={repository.id}
          onClick={() => onSelect(repository)}
          role="menuitemradio"
          type="button"
        >
          <icon>{repository.private ? "lock" : "public"}</icon>
          <span>{repository.fullName}</span>
        </button>
      ))}
    </DropdownWrapper>
  );
}

function BranchDropdown({ branches, copy, disabled, onSelect, selected }) {
  return (
    <DropdownWrapper
      align="left"
      ariaLabel={copy.aiCodeBranch}
      buttonClassName={`ai-code-toolbar-button${disabled ? " is-disabled" : ""}`}
      panelClassName="ai-code-select-menu"
      trigger={
        <>
          <icon>fork_right</icon>
          <span>{selected || copy.aiCodeBranch}</span>
          <icon>expand_more</icon>
        </>
      }
      triggerAs="button"
      triggerGlass={false}
    >
      {disabled
        ? <span className="ai-code-dropdown-empty">
            {copy.aiCodeSelectRepository}
          </span>
        : branches.map((branch) => (
            <button
              aria-checked={selected === branch.name}
              data-dropdown-close
              key={branch.name}
              onClick={() => onSelect(branch.name)}
              role="menuitemradio"
              type="button"
            >
              <icon>{branch.protected ? "verified_user" : "fork_right"}</icon>
              <span>{branch.name}</span>
            </button>
          ))}
    </DropdownWrapper>
  );
}

function CodeNotifications({ copy }) {
  const [notifications, setNotifications] = useState([]);
  const [state, setState] = useState("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai/notifications", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("notifications_load_failed");
        return response.json();
      })
      .then((payload) => {
        setNotifications(
          Array.isArray(payload.notifications) ? payload.notifications : [],
        );
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setNotifications([]);
        setState("failed");
      });
    return () => controller.abort();
  }, []);

  const unreadCount = notifications.filter(
    (notification) => !notification.read,
  ).length;

  return (
    <DropdownWrapper
      align="right"
      ariaLabel={copy.tasksNotifications}
      buttonClassName="ai-code-notifications-trigger"
      panelClassName="ai-code-notifications-menu"
      trigger={
        <>
          <icon>notifications</icon>
          {unreadCount > 0 ? <span>{Math.min(unreadCount, 99)}</span> : null}
        </>
      }
      triggerAs="button"
      triggerGlass={false}
    >
      <div className="ai-code-notifications-heading">
        <strong>{copy.tasksNotifications}</strong>
      </div>
      {state === "loading"
        ? <div className="ai-code-notifications-state">
            <LoadingSpinner label={copy.loading} />
          </div>
        : null}
      {state === "failed"
        ? <p className="ai-code-notifications-state is-error" role="alert">
            {copy.aiNotificationsLoadFailed}
          </p>
        : null}
      {state === "ready" && notifications.length === 0
        ? <p className="ai-code-notifications-state">
            {copy.tasksNoNotifications}
          </p>
        : null}
      {state === "ready" && notifications.length > 0
        ? <div className="ai-code-notifications-list">
            {notifications.map((notification) => (
              <article key={notification.id}>
                <icon>notifications</icon>
                <p>{notification.message}</p>
              </article>
            ))}
          </div>
        : null}
    </DropdownWrapper>
  );
}

export default function CodePage() {
  const [branches, setBranches] = useState([]);
  const [connectionState, setConnectionState] = useState("loading");
  const [githubAllowed, setGithubAllowed] = useState(null);
  const [copy, setCopy] = useState(() => t());
  const [attachments, setAttachments] = useState([]);
  const [listening, setListening] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [repositories, setRepositories] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedRepository, setSelectedRepository] = useState(null);
  const [withoutGithub, setWithoutGithub] = useState(false);
  const attachmentUrlsRef = useRef(new Set());
  const fileInputRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const listeningRef = useRef(false);
  const promptBeforeListeningRef = useRef("");
  const recognitionRef = useRef(null);
  const voiceFailureHandledRef = useRef(false);

  const updateAttachment = useCallback((localId, patch) => {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.localId === localId
          ? { ...attachment, ...patch }
          : attachment,
      ),
    );
  }, []);

  const uploadAttachment = useCallback(
    async (attachment) => {
      try {
        const accountResponse = await fetch("/api/account", {
          cache: "no-store",
          credentials: "include",
        });
        const account = await accountResponse.json().catch(() => ({}));
        if (!accountResponse.ok || !account.id) {
          throw new Error("account_load_failed");
        }
        const fingerprint = await fingerprintFile(attachment.file);
        const reusableResponse = await fetch(
          `/api/ai/files/reuse?${new URLSearchParams({ fingerprint, scope: "prompt" })}`,
          { cache: "no-store", credentials: "include" },
        );
        if (reusableResponse.ok) {
          const reusablePayload = await reusableResponse.json();
          updateAttachment(attachment.localId, {
            fingerprint,
            status: "ready",
            storedFile: reusablePayload.file,
          });
          return;
        }
        const encrypted = await encryptAttachment(attachment.file, account.id);
        const response = await fetch("/api/ai/files", {
          body: encrypted.body,
          credentials: "include",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Munetios-File-Encryption": "aes-256-gcm",
            "X-Munetios-File-Fingerprint": encodeURIComponent(fingerprint),
            "X-Munetios-File-Iv": encrypted.iv,
            "X-Munetios-File-Name": encodeURIComponent(attachment.name),
            "X-Munetios-File-Scope": "prompt",
            "X-Munetios-Original-Content-Type":
              attachment.file.type || "application/octet-stream",
          },
          method: "POST",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.file) throw new Error("upload_failed");
        updateAttachment(attachment.localId, {
          fingerprint,
          status: "ready",
          storedFile: payload.file,
        });
        window.dispatchEvent(new Event("munetios:accountstoragechange"));
      } catch {
        updateAttachment(attachment.localId, { status: "failed" });
        showToast({ messageKey: "aiFileUploadFailed", type: "error" });
      }
    },
    [updateAttachment],
  );

  const addAttachments = useCallback(
    (selectedFiles) => {
      const additions = Array.from(selectedFiles || []).map((file) => {
        const previewUrl = URL.createObjectURL(file);
        attachmentUrlsRef.current.add(previewUrl);
        return {
          file,
          localId: crypto.randomUUID(),
          name: file.name,
          previewUrl,
          size: file.size,
          status: "uploading",
        };
      });
      if (!additions.length) return;
      setAttachments((current) => [...current, ...additions]);
      for (const attachment of additions) void uploadAttachment(attachment);
    },
    [uploadAttachment],
  );

  const removeAttachment = useCallback((localId) => {
    setAttachments((current) => {
      const removed = current.find(
        (attachment) => attachment.localId === localId,
      );
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        attachmentUrlsRef.current.delete(removed.previewUrl);
      }
      return current.filter((attachment) => attachment.localId !== localId);
    });
  }, []);

  const previewAttachment = useCallback(
    async (attachment) => {
      const kind = attachmentKind(attachment.file);
      const textContent =
        kind === "text"
          ? (await attachment.file.slice(0, 512 * 1024).text()) || " "
          : "";
      showModal({
        ariaLabel: `${copy.filePickerPreview}: ${attachment.name}`,
        className: "ai-code-attachment-preview-modal",
        content: (
          <AttachmentPreview
            attachment={attachment}
            textContent={textContent}
          />
        ),
        contentClassName: "ai-code-attachment-preview-content",
        height: "min(56rem, calc(100dvh - 1rem))",
        maxHeight: "calc(100dvh - 1rem)",
        maxWidth: "calc(100vw - 1rem)",
        modalType: "ai-code-attachment-preview",
        title: attachment.name,
        width: "min(90rem, calc(100vw - 1rem))",
      });
    },
    [copy],
  );

  useEffect(
    () => () => {
      for (const previewUrl of attachmentUrlsRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
      attachmentUrlsRef.current.clear();
    },
    [],
  );

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
    fetch("/api/account", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("account_load_failed");
        return payload;
      })
      .then((account) => {
        const allowed = account?.education?.role !== "student";
        setGithubAllowed(allowed);
        if (!allowed) {
          setConnectionState("disconnected");
          setWithoutGithub(true);
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setGithubAllowed(true);
      });
    return () => controller.abort();
  }, []);

  const loadRepositories = useCallback(
    async (signal) => {
      if (githubAllowed !== true) return;
      setConnectionState("loading");
      try {
        const response = await fetch("/api/connector/github/repos", {
          cache: "no-store",
          credentials: "include",
          signal,
        });
        if (response.status === 401 || response.status === 403) {
          setRepositories([]);
          setConnectionState("disconnected");
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("repositories_load_failed");
        if (!payload.connected) {
          setRepositories([]);
          setConnectionState("disconnected");
          return;
        }
        const nextRepositories = Array.isArray(payload.repositories)
          ? payload.repositories
          : [];
        setRepositories(nextRepositories);
        setSelectedRepository((current) =>
          current
            ? nextRepositories.find(
                (repository) => repository.id === current.id,
              ) ||
              nextRepositories[0] ||
              null
            : nextRepositories[0] || null,
        );
        setConnectionState("connected");
      } catch (error) {
        if (error?.name === "AbortError") return;
        setRepositories([]);
        setConnectionState("failed");
      }
    },
    [githubAllowed],
  );

  useEffect(() => {
    const controller = new AbortController();
    if (githubAllowed === true) void loadRepositories(controller.signal);
    return () => controller.abort();
  }, [githubAllowed, loadRepositories]);

  useEffect(() => {
    if (!selectedRepository?.fullName || connectionState !== "connected") {
      setBranches([]);
      setSelectedBranch("");
      return undefined;
    }
    const controller = new AbortController();
    const loadBranches = async () => {
      try {
        const response = await fetch(
          `/api/connector/github/branches?repo=${encodeURIComponent(selectedRepository.fullName)}`,
          {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(payload.branches)) {
          setBranches([]);
          setSelectedBranch("");
          showParentalAwareToast(
            payload,
            { messageKey: "aiCodeBranchesFailedToast", type: "error" },
            showToast,
          );
          return;
        }
        setBranches(payload.branches);
        setSelectedBranch(
          payload.branches.some(
            (branch) => branch.name === selectedRepository.defaultBranch,
          )
            ? selectedRepository.defaultBranch
            : payload.branches[0]?.name || "",
        );
      } catch (error) {
        if (error?.name === "AbortError") return;
        setBranches([]);
        setSelectedBranch("");
        showToast({ messageKey: "aiCodeBranchesFailedToast", type: "error" });
      }
    };
    void loadBranches();
    return () => controller.abort();
  }, [connectionState, selectedRepository]);

  const startGithubSetup = async () => {
    try {
      const response = await fetch(
        "/api/connectors/github/connect?returnTo=%2Fapps%2Fai%2Fcode",
        {
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (
        !response.ok ||
        !/^https:\/\/github\.com\//u.test(payload.authorizeUrl)
      ) {
        showParentalAwareToast(
          payload,
          { messageKey: "aiCodeSetupFailedToast", type: "error" },
          showToast,
        );
        return;
      }
      window.location.assign(payload.authorizeUrl);
    } catch {
      showToast({ messageKey: "aiCodeSetupFailedToast", type: "error" });
    }
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
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      }
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

  const visibleWorkspace =
    connectionState === "connected" ||
    connectionState === "failed" ||
    withoutGithub;
  return (
    <section className="ai-code-page">
      <header className="ai-code-topbar">
        <div className="ai-code-topbar-left">
          <h1 className="ai-code-title liquid-glass">
            <icon>code</icon>
            <span>{copy.aiCodeTitle}</span>
          </h1>
        </div>
        <AppTopbarRight className="ai-code-topbar-right">
          <CodeNotifications copy={copy} />
        </AppTopbarRight>
      </header>
      <div className="ai-code-content">
        {connectionState === "loading" || githubAllowed === null
          ? <div className="ai-code-loading liquid-glass">
              <LoadingSpinner label={copy.loading} />
            </div>
          : null}
        {githubAllowed === true &&
        connectionState === "disconnected" &&
        !withoutGithub
          ? <section className="ai-code-setup liquid-glass">
              <div className="ai-code-setup-icon">
                <icon>code_blocks</icon>
              </div>
              <h2>{copy.aiCodeSetupTitle}</h2>
              <p>{copy.aiCodeGithubDescription}</p>
              <div className="ai-code-setup-actions">
                <button
                  className="is-primary"
                  onClick={() => void startGithubSetup()}
                  type="button"
                >
                  <Image
                    alt=""
                    height={20}
                    src="/connectors/github.svg"
                    width={20}
                  />
                  {copy.aiCodeConnectGithub}
                </button>
                <button onClick={() => setWithoutGithub(true)} type="button">
                  {copy.aiCodeContinueWithoutGithub}
                </button>
              </div>
            </section>
          : null}
        {visibleWorkspace
          ? <div className="ai-code-workspace">
              <div className="ai-code-chat">
                <div className="ai-code-empty-state">
                  <div className="ai-code-empty-icon liquid-glass">
                    <icon>terminal</icon>
                  </div>
                  <h2>{copy.aiCodeAskAnything}</h2>
                  <p>{copy.aiCodeAskDescription}</p>
                </div>
                <div
                  className={`ai-code-composer liquid-glass${listening ? " is-listening" : ""}`}
                >
                  {attachments.length > 0
                    ? <fieldset className="ai-code-attachment-list">
                        <legend className="sr-only">
                          {copy.filePickerPreview}
                        </legend>
                        {attachments.map((attachment) => {
                          const kind = attachmentKind(attachment.file);
                          return (
                            <article
                              className={`ai-code-attachment-card is-${kind}`}
                              key={attachment.localId}
                            >
                              <button
                                aria-label={`${copy.filePickerPreview}: ${attachment.name}`}
                                className="ai-code-attachment-open"
                                onClick={() =>
                                  void previewAttachment(attachment)
                                }
                                type="button"
                              >
                                <span className="ai-code-attachment-thumbnail">
                                  {kind === "image"
                                    ? <Image
                                        alt=""
                                        fill
                                        sizes="4.5rem"
                                        src={attachment.previewUrl}
                                        unoptimized
                                      />
                                    : kind === "video"
                                      ? <video
                                          muted
                                          playsInline
                                          preload="metadata"
                                          src={attachment.previewUrl}
                                          tabIndex={-1}
                                        />
                                      : <icon>
                                          {attachmentIcon(attachment.file)}
                                        </icon>}
                                </span>
                                <span className="ai-code-attachment-details">
                                  <strong>{attachment.name}</strong>
                                  <small>
                                    {attachment.status === "uploading"
                                      ? copy.loading
                                      : attachment.status === "failed"
                                        ? copy.aiFileUploadFailed
                                        : `${formatAttachmentSize(attachment.size)} · ${copy.accountAdvancedEndToEndEncrypted}`}
                                  </small>
                                </span>
                              </button>
                              <button
                                aria-label={`${copy.aiRemoveAttachment}: ${attachment.name}`}
                                className="ai-code-attachment-remove"
                                onClick={() =>
                                  removeAttachment(attachment.localId)
                                }
                                type="button"
                              >
                                <icon>close</icon>
                              </button>
                            </article>
                          );
                        })}
                      </fieldset>
                    : null}
                  <textarea
                    aria-label={copy.aiCodeAskAnything}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={copy.aiCodeAskAnything}
                    rows={3}
                    value={prompt}
                  />
                  <div className="ai-code-composer-toolbar">
                    <div className="ai-code-composer-left">
                      <input
                        accept="image/*,video/*,.c,.cc,.cpp,.css,.csv,.doc,.docx,.h,.html,.java,.js,.jsx,.json,.md,.odt,.pdf,.php,.ppt,.pptx,.py,.rb,.rs,.rtf,.sh,.sql,.ts,.tsx,.txt,.xls,.xlsx,.xml,.yaml,.yml"
                        hidden
                        multiple
                        onChange={(event) => {
                          addAttachments(event.target.files);
                          event.target.value = "";
                        }}
                        ref={fileInputRef}
                        type="file"
                      />
                      <button
                        aria-label={copy.aiCodeAddFiles}
                        className="ai-code-icon-button"
                        onClick={() => fileInputRef.current?.click()}
                        title={copy.aiCodeAddFiles}
                        type="button"
                      >
                        <icon>add</icon>
                      </button>
                      {githubAllowed === true && connectionState === "connected"
                        ? <>
                            <RepositoryDropdown
                              copy={copy}
                              onSelect={setSelectedRepository}
                              repositories={repositories}
                              selected={selectedRepository}
                            />
                            <BranchDropdown
                              branches={branches}
                              copy={copy}
                              disabled={
                                !selectedRepository || branches.length === 0
                              }
                              onSelect={setSelectedBranch}
                              selected={selectedBranch}
                            />
                          </>
                        : null}
                    </div>
                    <div className="ai-code-composer-right">
                      <button
                        aria-label={copy.aiCodePlanMode}
                        aria-pressed={planMode}
                        className="ai-code-plan-mode"
                        onClick={() => setPlanMode((current) => !current)}
                        type="button"
                      >
                        <icon>assignment</icon>
                        <span>{copy.aiCodePlanMode}</span>
                      </button>
                      <button
                        aria-label={
                          listening
                            ? copy.aiMicrophoneStop
                            : copy.aiPromptMicrophone
                        }
                        className={`ai-code-icon-button${listening ? " is-listening" : ""}`}
                        data-ai-voice-input
                        onClick={() =>
                          listening
                            ? void finishListening()
                            : void startListening()
                        }
                        type="button"
                      >
                        <icon>{listening ? "stop_circle" : "mic"}</icon>
                      </button>
                      <button
                        aria-label={copy.aiPromptSend}
                        className="ai-code-send-button"
                        disabled
                        type="button"
                      >
                        <icon>arrow_upward</icon>
                      </button>
                    </div>
                  </div>
                </div>
                {githubAllowed === true && connectionState === "failed"
                  ? <section
                      className="ai-code-repositories ai-code-repositories-error liquid-glass"
                      role="alert"
                    >
                      <icon>cloud_off</icon>
                      <p>{copy.aiCodeRepositoriesLoadFailed}</p>
                      <button
                        onClick={() => void loadRepositories()}
                        type="button"
                      >
                        {copy.retry}
                      </button>
                    </section>
                  : null}
                {githubAllowed === true && connectionState === "connected"
                  ? <section className="ai-code-repositories liquid-glass">
                      <div className="ai-code-repositories-heading">
                        <div>
                          <icon>book_2</icon>
                          <h2>{copy.aiCodeRepositories}</h2>
                        </div>
                        <span>{repositories.length}</span>
                      </div>
                      {repositories.length === 0
                        ? <p className="ai-code-repositories-empty">
                            {copy.aiCodeNoRepositories}
                          </p>
                        : <div className="ai-code-repository-list">
                            {repositories.map((repository) => (
                              <button
                                aria-pressed={
                                  selectedRepository?.id === repository.id
                                }
                                key={repository.id}
                                onClick={() =>
                                  setSelectedRepository(repository)
                                }
                                type="button"
                              >
                                <span className="ai-code-repository-icon">
                                  <icon>
                                    {repository.private ? "lock" : "public"}
                                  </icon>
                                </span>
                                <span>
                                  <strong>{repository.name}</strong>
                                  <small>{repository.owner}</small>
                                </span>
                                <icon>chevron_right</icon>
                              </button>
                            ))}
                          </div>}
                    </section>
                  : null}
              </div>
            </div>
          : null}
      </div>
    </section>
  );
}
