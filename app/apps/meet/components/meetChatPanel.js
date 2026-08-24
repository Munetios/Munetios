"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AccountAvatar from "../../../components/accountAvatar";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { showToast } from "../../../components/toast";
import { formatUserTime } from "../../../lib/dateTimePreferences";
import {
  createResponsiveMediaQuery,
  getResponsiveViewportWidth,
} from "../../../lib/responsiveMediaQuery";
import { meetEmojiCategories, meetEmojis } from "../lib/meetEmojis";
import { meetSoundEffects, prepareMeetAudio } from "./meetSounds";

const maximumImageBytes = 5 * 1024 * 1024;

function playChatSound(name) {
  return meetSoundEffects[name]().catch(() => {});
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("image_read_failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export default function MeetChatPanel({
  copy,
  localPeerId,
  messages,
  onClose,
  onEdit,
  onReact,
  onSend,
  open,
  panelWidth,
  setPanelWidth,
  ttsVoice,
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState("");
  const [emojiCategory, setEmojiCategory] = useState("smileys");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isMobileBottomSheet, setIsMobileBottomSheet] = useState(false);
  const [reactionMessageId, setReactionMessageId] = useState("");
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const swipeStartRef = useRef(null);
  const visibleEmojiCategories = useMemo(() => {
    const query = emojiQuery.trim().toLocaleLowerCase();
    return meetEmojiCategories
      .filter((category) => query || category.id === emojiCategory)
      .map((category) => {
        const label = copy[category.labelKey];
        const categoryMatches = label.toLocaleLowerCase().includes(query);
        return {
          ...category,
          emojis:
            query && !categoryMatches
              ? category.emojis.filter((emoji) => emoji.includes(query))
              : category.emojis,
          label,
        };
      })
      .filter((category) => category.emojis.length);
  }, [copy, emojiCategory, emojiQuery]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort?.();
    },
    [],
  );

  useEffect(() => {
    const mobileQuery = createResponsiveMediaQuery("(max-width: 767px)");
    const updateMobileLayout = () =>
      setIsMobileBottomSheet(mobileQuery.matches);
    updateMobileLayout();
    mobileQuery.addEventListener("change", updateMobileLayout);
    return () => mobileQuery.removeEventListener("change", updateMobileLayout);
  }, []);

  useEffect(() => {
    if (!open) return;
    const fitPanel = () => {
      const responsiveWidth = getResponsiveViewportWidth();
      if (responsiveWidth < 768) return;
      const maximum = Math.min(900, responsiveWidth - 280);
      setPanelWidth((current) => Math.max(360, Math.min(maximum, current)));
    };
    fitPanel();
    window.addEventListener("resize", fitPanel);
    window.addEventListener("munetios:responsivechange", fitPanel);
    return () => {
      window.removeEventListener("resize", fitPanel);
      window.removeEventListener("munetios:responsivechange", fitPanel);
    };
  }, [open, setPanelWidth]);

  if (!open) return null;

  const resetComposer = () => {
    setDraft("");
    setEditingId("");
    setImageUrl("");
    setEmojiOpen(false);
    setEmojiQuery("");
  };

  const submit = async () => {
    const body = draft.trim();
    if (editingId) {
      if (!body) return;
      if (await onEdit(editingId, body)) resetComposer();
      return;
    }
    if (!body && !imageUrl) return;
    if (await onSend({ body, imageUrl: imageUrl || null })) resetComposer();
  };

  const chooseImage = async (event) => {
    const [file] = event.target.files || [];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > maximumImageBytes) {
      showToast({ message: copy.filePickerInvalidImage, type: "error" });
      return;
    }
    try {
      setImageUrl(await readImage(file));
    } catch {
      showToast({ message: copy.meetSomethingWentWrongToast, type: "error" });
    }
  };

  const startVoiceInput = () => {
    prepareMeetAudio();
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      void playChatSound("microphoneDenied");
      showToast({ message: copy.meetChatVoiceUnavailable, type: "warning" });
      return;
    }
    recognitionRef.current?.abort?.();
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = document.documentElement.lang || navigator.language;
    recognition.onstart = () => {
      setRecording(true);
      void playChatSound("microphoneStart");
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      if (transcript) {
        setDraft((current) => `${current}${current ? " " : ""}${transcript}`);
        void playChatSound("success");
      } else {
        void playChatSound("microphoneDidntHear");
      }
    };
    recognition.onerror = (event) => {
      void playChatSound(
        event.error === "not-allowed" ? "microphoneDenied" : "microphoneError",
      );
      showToast({ message: copy.meetChatVoiceUnavailable, type: "warning" });
    };
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
  };

  const readAloud = (message) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message.body);
    utterance.lang = document.documentElement.lang || navigator.language;
    const selectedVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.voiceURI === ttsVoice);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    }
    window.speechSynthesis.speak(utterance);
  };

  const copyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(message.body);
    } catch {
      showToast({ message: copy.meetClipboardFailed, type: "warning" });
    }
  };

  const beginResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const move = (moveEvent) => {
      const maximum = Math.min(900, getResponsiveViewportWidth() - 280);
      setPanelWidth(
        Math.max(
          360,
          Math.min(maximum, startWidth + startX - moveEvent.clientX),
        ),
      );
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  return (
    <aside
      aria-label={copy.meetChat}
      className={`meet-chat-panel${isMobileBottomSheet ? " liquid-glass" : ""}`}
      style={{ "--meet-chat-width": `${panelWidth}px` }}
    >
      <button
        aria-label={copy.meetChatResize}
        className="meet-chat-resize"
        onPointerDown={beginResize}
        type="button"
      />
      <header
        className="meet-chat-header liquid-glass"
        onPointerDown={(event) => {
          swipeStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = swipeStartRef.current;
          swipeStartRef.current = null;
          if (
            start &&
            event.clientY - start.y > 80 &&
            Math.abs(event.clientX - start.x) < 70
          ) {
            onClose();
          }
        }}
      >
        <span className="meet-chat-drag-indicator" />
        <h2>{copy.meetChat}</h2>
        <button aria-label={copy.close} onClick={onClose} type="button">
          <icon>close</icon>
        </button>
      </header>

      <div className="meet-chat-scroll">
        <div className="meet-chat-messages">
          {messages.length
            ? messages.map((message) => {
                const mine = message.peerId === localPeerId;
                return (
                  <article
                    className={`meet-chat-message${mine ? " is-mine" : ""}`}
                    key={message.id}
                  >
                    {!mine
                      ? <AccountAvatar
                          account={{
                            avatarUrl: message.avatarUrl,
                            name: message.senderName,
                          }}
                          alt={message.senderName}
                          className="meet-chat-avatar"
                        />
                      : null}
                    <div className="meet-chat-message-content">
                      <header>
                        <strong>
                          {mine ? copy.meetYou : message.senderName}
                        </strong>
                        <span>
                          {formatUserTime(message.createdAt)}
                          {message.editedAt ? ` · ${copy.meetChatEdited}` : ""}
                        </span>
                        <DropdownWrapper
                          align={mine ? "right" : "left"}
                          ariaLabel={copy.moreOptions}
                          buttonClassName="meet-chat-message-more"
                          panelClassName="w-48"
                          trigger={<icon>more_vert</icon>}
                          triggerGlass={false}
                        >
                          {message.body
                            ? <button
                                className="meet-menu-item"
                                data-dropdown-close
                                onClick={() => readAloud(message)}
                                role="menuitem"
                                type="button"
                              >
                                <icon>volume_up</icon>
                                {copy.aiChatReadAloud}
                              </button>
                            : null}
                          <button
                            className="meet-menu-item"
                            data-dropdown-close
                            onClick={() => setReactionMessageId(message.id)}
                            role="menuitem"
                            type="button"
                          >
                            <icon>add_reaction</icon>
                            {copy.meetChatReactions}
                          </button>
                          {message.body
                            ? <button
                                className="meet-menu-item"
                                data-dropdown-close
                                onClick={() => void copyMessage(message)}
                                role="menuitem"
                                type="button"
                              >
                                <icon>content_copy</icon>
                                {copy.aiChatCopy}
                              </button>
                            : null}
                          {mine && message.body
                            ? <button
                                className="meet-menu-item"
                                data-dropdown-close
                                onClick={() => {
                                  setDraft(message.body);
                                  setEditingId(message.id);
                                  setImageUrl("");
                                }}
                                role="menuitem"
                                type="button"
                              >
                                <icon>edit</icon>
                                {copy.aiChatEdit}
                              </button>
                            : null}
                        </DropdownWrapper>
                      </header>
                      <div className="meet-chat-bubble">
                        {message.body ? <p>{message.body}</p> : null}
                        {message.imageUrl
                          ? // biome-ignore lint/performance/noImgElement: Realtime data URL attachments cannot use the Next image optimizer.
                            <img
                              alt={copy.meetChatAttachedImage}
                              src={message.imageUrl}
                            />
                          : null}
                      </div>
                      {reactionMessageId === message.id
                        ? <div className="meet-chat-reaction-picker liquid-glass">
                            {meetEmojis.map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => {
                                  void onReact(message.id, emoji);
                                  setReactionMessageId("");
                                }}
                                type="button"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        : null}
                      {message.reactions?.length
                        ? <div className="meet-chat-reactions liquid-glass">
                            {message.reactions.map((reaction) => (
                              <button
                                className={
                                  reaction.reactedByMe ? "is-active" : ""
                                }
                                key={reaction.emoji}
                                onClick={() =>
                                  void onReact(message.id, reaction.emoji)
                                }
                                type="button"
                              >
                                {reaction.emoji} {reaction.count}
                              </button>
                            ))}
                          </div>
                        : null}
                    </div>
                  </article>
                );
              })
            : <div className="meet-chat-empty">
                <icon className="meet-chat-empty-icon">forum</icon>
                <p>{copy.meetChatEmpty}</p>
              </div>}
        </div>
      </div>

      <div
        className="meet-chat-composer liquid-glass"
        style={{ "--meet-chat-width": `${panelWidth}px` }}
      >
        {imageUrl
          ? <div className="meet-chat-image-preview">
              {/* biome-ignore lint/performance/noImgElement: Local attachment previews use an in-memory data URL. */}
              <img alt={copy.meetChatAttachedImage} src={imageUrl} />
              <button
                aria-label={copy.close}
                onClick={() => setImageUrl("")}
                type="button"
              >
                <icon>close</icon>
              </button>
            </div>
          : null}
        {editingId
          ? <div className="meet-chat-editing">
              <span>{copy.meetChatEditing}</span>
              <button onClick={resetComposer} type="button">
                {copy.cancel}
              </button>
            </div>
          : null}
        {emojiOpen
          ? <div className="meet-chat-emoji-picker liquid-glass">
              <label className="meet-chat-emoji-search">
                <icon>search</icon>
                <input
                  onChange={(event) => setEmojiQuery(event.target.value)}
                  placeholder={copy.meetEmojiSearch}
                  type="search"
                  value={emojiQuery}
                />
              </label>
              <nav aria-label={copy.meetEmojiCategories}>
                {meetEmojiCategories.map((category) => (
                  <button
                    aria-label={copy[category.labelKey]}
                    className={
                      !emojiQuery && emojiCategory === category.id
                        ? "is-active"
                        : ""
                    }
                    data-tooltip={copy[category.labelKey]}
                    key={category.id}
                    onClick={() => {
                      setEmojiCategory(category.id);
                      setEmojiQuery("");
                    }}
                    type="button"
                  >
                    <icon>{category.icon}</icon>
                  </button>
                ))}
              </nav>
              <div className="meet-chat-emoji-results">
                {visibleEmojiCategories.length
                  ? visibleEmojiCategories.map((category) => (
                      <section key={category.id}>
                        <h3>{category.label}</h3>
                        <div className="meet-chat-emoji-grid">
                          {category.emojis.map((emoji) => (
                            <button
                              aria-label={emoji}
                              key={emoji}
                              onClick={() => {
                                setDraft((current) => `${current}${emoji}`);
                                setEmojiOpen(false);
                                setEmojiQuery("");
                              }}
                              type="button"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </section>
                    ))
                  : <p>{copy.meetEmojiNoResults}</p>}
              </div>
            </div>
          : null}
        <div className="meet-chat-input-row">
          <input
            accept="image/gif,image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => void chooseImage(event)}
            ref={fileInputRef}
            type="file"
          />
          <button
            aria-label={copy.aiToolAttachFiles}
            disabled={Boolean(editingId)}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <icon>add</icon>
          </button>
          <textarea
            aria-label={copy.meetChatMessagePlaceholder}
            onChange={(event) => setDraft(event.target.value.slice(0, 4000))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={copy.meetChatMessagePlaceholder}
            rows={1}
            value={draft}
          />
          <button
            aria-label={copy.aiSettingsVoiceInputComposer}
            className={recording ? "is-recording" : ""}
            onClick={startVoiceInput}
            type="button"
          >
            <icon>{recording ? "graphic_eq" : "mic"}</icon>
          </button>
          <button
            aria-label={copy.accountProfilePictureEmoji}
            onClick={() => setEmojiOpen((current) => !current)}
            type="button"
          >
            <icon>sentiment_satisfied</icon>
          </button>
          {draft.trim() || imageUrl
            ? <button
                aria-label={copy.aiPromptSend}
                className="meet-chat-send"
                onClick={() => void submit()}
                type="button"
              >
                <icon>{editingId ? "check" : "send"}</icon>
              </button>
            : null}
        </div>
      </div>
    </aside>
  );
}
