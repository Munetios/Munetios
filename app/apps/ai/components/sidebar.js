"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { openKeyboardShortcutsModal } from "../../../components/keyboardShortcutsModal";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { t } from "../../../i18n";
import { fetchSelfParentalControls } from "../../../lib/parentalControlsClient";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import { loadAiAccountCache, saveAiAccountCache } from "../lib/accountCache";
import {
  deleteGuestConversation,
  listGuestConversations,
  updateGuestConversation,
} from "../lib/guestConversations";
import { withVoiceShareKey } from "../lib/voiceConversationCrypto";
import ProfileTrigger from "./profileTrigger";
import { openAiSettingsModal } from "./settingsModal";

function conversationError(copy, response, id, payload) {
  if (response?.status === 429) return copy.aiConversationError429;
  if (response?.status === 401) return copy.invalidSessionToken;
  if (response?.status === 404 || payload?.error === "conversation_not_found")
    return copy.aiConversationErrorNotFound;
  if (payload?.error === "test_error") return copy.aiConversationErrorTest;
  if (payload?.error === "fetch_failed")
    return copy.aiConversationFetchFailed.replace("{id}", id);
  return copy.aiConversationErrorGeneric;
}

function conversationPath(item) {
  return `/apps/ai/${item.type === "voice" ? "v" : "c"}/${encodeURIComponent(item.id)}`;
}

function showShareSignIn(copy) {
  showModal(
    <div className="ai-voice-share-modal">
      <p>{copy.aiGuestPreviewSignInDescription}</p>
      <Link
        className="ai-guest-preview-sign-in"
        href={`/signin?returnTo=${encodeURIComponent(window.location.pathname)}`}
      >
        {copy.signIn}
      </Link>
    </div>,
    {
      ariaLabel: copy.aiVoiceShare,
      title: copy.aiVoiceShare,
      width: "min(30rem, calc(100vw - 1rem))",
    },
  );
}

function ConversationConfirmModal({ close, copy, item, onConfirm, type }) {
  return createPortal(
    <div className="ai-guest-preview-overlay is-visible">
      <div aria-hidden="true" className="ai-guest-preview-backdrop" />
      <section
        aria-modal="true"
        className="ai-conversation-confirm liquid-glass"
        role="dialog"
      >
        <h2>
          {type === "delete"
            ? copy.aiConversationDeleteConfirmTitle
            : copy.aiConversationArchiveConfirmTitle}
        </h2>
        <p>
          {type === "delete"
            ? copy.aiConversationDeleteConfirmDescription
            : copy.aiConversationArchiveConfirmDescription}
        </p>
        <strong>{item.title}</strong>
        <div>
          <button onClick={close} type="button">
            {copy.cancel}
          </button>
          <button
            className={type === "delete" ? "is-danger" : ""}
            onClick={() => void onConfirm().then(close)}
            type="button"
          >
            {type === "delete" ? copy.delete : copy.aiChatArchive}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ConversationRenameModal({ close, copy, item, onRename }) {
  const [title, setTitle] = useState(item.title);
  return createPortal(
    <div className="ai-guest-preview-overlay is-visible">
      <div aria-hidden="true" className="ai-guest-preview-backdrop" />
      <form
        aria-modal="true"
        className="ai-conversation-confirm liquid-glass"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) void onRename(title.trim());
        }}
        role="dialog"
      >
        <h2>{copy.aiConversationRename}</h2>
        <input
          aria-label={copy.aiConversationRename}
          maxLength={72}
          onChange={(event) => setTitle(event.target.value)}
          value={title}
        />
        <div>
          <button onClick={close} type="button">
            {copy.cancel}
          </button>
          <button disabled={!title.trim()} type="submit">
            {copy.aiVoiceDone}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function SidebarGroup({
  copy,
  empty,
  error,
  icon,
  items,
  limit = Number.POSITIVE_INFINITY,
  onAction,
  onNavigate,
  sharingDisabled = false,
  title,
}) {
  const visibleItems = items.slice(0, limit);
  const overflowItems = items.slice(limit);
  return (
    <section className="ai-sidebar-group">
      <h2 className="ai-sidebar-group-title">
        <icon className="ai-sidebar-group-icon">{icon}</icon>
        <span>{title}</span>
      </h2>
      {error
        ? <p className="ai-sidebar-group-status is-error">{error}</p>
        : items.length === 0
          ? <p className="ai-sidebar-group-status">{empty}</p>
          : <div className="ai-sidebar-group-items">
              {visibleItems.map((item) => (
                <div className="ai-sidebar-conversation-row" key={item.id}>
                  <Link
                    className="ai-sidebar-conversation"
                    href={conversationPath(item)}
                    onClick={onNavigate}
                    title={item.title}
                  >
                    <span>{item.title}</span>
                  </Link>
                  <DropdownWrapper
                    align="right"
                    ariaLabel={`${copy.aiSidebarMore}: ${item.title}`}
                    buttonClassName="ai-sidebar-conversation-more"
                    panelClassName="ai-sidebar-conversation-actions"
                    trigger={<icon>more_horiz</icon>}
                    triggerGlass={false}
                  >
                    {item.type === "voice" && !sharingDisabled
                      ? <button
                          data-dropdown-close
                          onClick={() => onAction("share", item)}
                          type="button"
                        >
                          <icon>share</icon>
                          <span>{copy.aiVoiceShare}</span>
                        </button>
                      : null}
                    <button
                      data-dropdown-close
                      onClick={() => onAction("rename", item)}
                      type="button"
                    >
                      <icon>edit</icon>
                      <span>{copy.aiConversationRename}</span>
                    </button>
                    <button
                      data-dropdown-close
                      onClick={() => onAction("pin", item)}
                      type="button"
                    >
                      <icon>{item.pinned ? "keep_off" : "keep"}</icon>
                      <span>{item.pinned ? copy.aiUnpin : copy.aiChatPin}</span>
                    </button>
                    <button
                      data-dropdown-close
                      onClick={() => onAction("archive", item)}
                      type="button"
                    >
                      <icon>archive</icon>
                      <span>{copy.aiChatArchive}</span>
                    </button>
                    <button
                      data-dropdown-close
                      className="is-danger"
                      onClick={() => onAction("delete", item)}
                      type="button"
                    >
                      <icon>delete</icon>
                      <span>{copy.delete}</span>
                    </button>
                  </DropdownWrapper>
                </div>
              ))}
              {overflowItems.length
                ? <DropdownWrapper
                    align="right"
                    ariaLabel={`${copy.aiSidebarMore}: ${title}`}
                    buttonClassName="ai-sidebar-group-more"
                    panelClassName="ai-sidebar-overflow-menu"
                    trigger={
                      <>
                        <span>{copy.aiSidebarMore}</span>
                        <icon>expand_more</icon>
                      </>
                    }
                    triggerGlass={false}
                  >
                    {overflowItems.map((item) => (
                      <Link
                        data-dropdown-close
                        href={conversationPath(item)}
                        key={item.id}
                        onClick={onNavigate}
                        title={item.title}
                      >
                        <span>{item.title}</span>
                      </Link>
                    ))}
                  </DropdownWrapper>
                : null}
            </div>}
    </section>
  );
}

function isTeenBirthday(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""))) return false;
  const birthday = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(birthday.getTime())) return false;
  const today = new Date();
  let age = today.getUTCFullYear() - birthday.getUTCFullYear();
  const birthdayPassed =
    today.getUTCMonth() > birthday.getUTCMonth() ||
    (today.getUTCMonth() === birthday.getUTCMonth() &&
      today.getUTCDate() >= birthday.getUTCDate());
  if (!birthdayPassed) age -= 1;
  return age < 18;
}

export function GuestFeatureModal({
  close,
  copy,
  feature,
  restricted = false,
  returnTo = "/apps/ai",
}) {
  const [visible, setVisible] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return createPortal(
    <div className={`ai-guest-preview-overlay${visible ? " is-visible" : ""}`}>
      <div aria-hidden="true" className="ai-guest-preview-backdrop" />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="ai-guest-preview-modal"
        role="dialog"
      >
        <button
          aria-label={copy.close}
          className="ai-guest-preview-close"
          onClick={close}
          type="button"
        >
          <icon>close</icon>
        </button>
        <Image
          alt=""
          className="ai-guest-preview-image"
          height={1024}
          priority
          src={
            feature === "health"
              ? "/ai-health-preview.png"
              : feature === "code"
                ? "/ai-code-preview.png"
                : "/ai-guest-feature-preview.png"
          }
          width={1536}
        />
        <div className="ai-guest-preview-copy">
          <h2 id={titleId}>
            {feature === "health"
              ? copy.aiGuestHealthPreviewTitle
              : feature === "code"
                ? copy.aiGuestCodePreviewTitle
                : copy.aiGuestPreviewTitle}
          </h2>
          <p>
            {feature === "health"
              ? copy.aiGuestHealthPreviewDescription
              : feature === "code"
                ? copy.aiGuestCodePreviewDescription
                : copy.aiGuestPreviewDescription}
          </p>
          {restricted
            ? null
            : <>
                <strong>{copy.aiGuestPreviewPrompt}</strong>
                <p>{copy.aiGuestPreviewSignInDescription}</p>
                <Link
                  className="ai-guest-preview-sign-in"
                  href={`/signin?returnTo=${encodeURIComponent(returnTo)}`}
                >
                  {copy.signIn}
                </Link>
              </>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function HealthUnavailableModal({ close, copy }) {
  return (
    <GuestFeatureModal
      close={close}
      copy={{
        ...copy,
        aiGuestHealthPreviewDescription: copy.aiHealthUnavailableDescription,
        aiGuestHealthPreviewTitle: copy.aiHealthUnavailableTitle,
        aiGuestPreviewPrompt: "",
        aiGuestPreviewSignInDescription: "",
      }}
      feature="health"
      restricted
    />
  );
}

export function SearchChatsModal({ close, copy, onNavigate }) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [results, setResults] = useState([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/ai/search?q=${encodeURIComponent(query)}&type=${filter}`,
          { credentials: "include", signal: controller.signal },
        );
        if (response.status === 401) {
          setResults([]);
          setFailed(false);
          return;
        }
        if (!response.ok) throw new Error("search_failed");
        const payload = await response.json();
        setResults(Array.isArray(payload.results) ? payload.results : []);
        setFailed(false);
      } catch (error) {
        if (error?.name !== "AbortError") {
          setResults([]);
          setFailed(true);
        }
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filter, query]);

  return createPortal(
    <div className="ai-guest-preview-overlay is-visible">
      <div aria-hidden="true" className="ai-guest-preview-backdrop" />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="ai-guest-preview-modal ai-search-modal"
        role="dialog"
      >
        <header>
          <h2 id={titleId}>{copy.aiSidebarSearchChats}</h2>
          <button aria-label={copy.close} onClick={close} type="button">
            <icon>close</icon>
          </button>
        </header>
        <label className="ai-search-field">
          <icon>search</icon>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.aiSearchChatsPlaceholder}
            value={query}
          />
        </label>
        <div
          aria-label={copy.aiSearchSort}
          className="ai-search-tabs"
          role="tablist"
        >
          {[
            ["all", copy.aiSearchAll],
            ["chats", copy.aiSidebarChats],
            ["voice", copy.aiVoiceMode],
            ["projects", copy.aiSidebarProjects],
            ["images", copy.aiSidebarImages],
            ["library", copy.aiSidebarLibrary],
            ["health", copy.aiSidebarHealth],
            ["code", copy.aiSidebarCode],
          ].map(([value, label]) => (
            <button
              aria-selected={filter === value}
              key={value}
              onClick={() => setFilter(value)}
              role="tab"
              className="search-chat-tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ai-search-results">
          {failed
            ? <p className="is-error">{copy.aiSearchLoadFailed}</p>
            : results.length === 0
              ? <p>{copy.aiSearchNoResults}</p>
              : results.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(conversationPath(item));
                      close();
                    }}
                    type="button"
                  >
                    <icon>{item.type === "voice" ? "graphic_eq" : "chat"}</icon>
                    <span>{item.title}</span>
                  </button>
                ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function Sidebar({
  activePage = "home",
  appLoading = false,
  educationStudent = false,
  onNavigate = () => {},
}) {
  const [copy, setCopy] = useState(() => t());
  const [history, setHistory] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [historyError, setHistoryError] = useState(false);
  const [pinnedError, setPinnedError] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const [shortViewport, setShortViewport] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [selfParentalControls, setSelfParentalControls] = useState(null);
  const [modalStack, setModalStack] = useState([]);
  const [conversationConfirm, setConversationConfirm] = useState(null);
  const [conversationRename, setConversationRename] = useState(null);
  const [conversationRefresh, setConversationRefresh] = useState(0);
  const modalSequence = useRef(0);
  const healthGateShown = useRef(false);

  const openModal = useCallback((type, feature = "") => {
    modalSequence.current += 1;
    const modal = { feature, id: modalSequence.current, type };
    setModalStack((current) => [...current, modal]);
  }, []);

  const runConversationAction = useCallback(
    async (action, item) => {
      if (action === "archive" || action === "delete") {
        setConversationConfirm({ action, item });
        return;
      }
      if (action === "rename") {
        setConversationRename(item);
        return;
      }
      if (action === "share" && !signedIn) {
        showShareSignIn(copy);
        return;
      }
      try {
        if (action === "pin") {
          if (!signedIn) {
            updateGuestConversation(item.id, "pin", {
              pinned: !item.pinned,
            });
            return;
          }
          const response = await fetch("/api/ai/conversations", {
            body: JSON.stringify({
              action: "pin",
              id: item.id,
              pinned: !item.pinned,
            }),
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            method: "PATCH",
          });
          if (!response.ok)
            throw Object.assign(new Error("pin_failed"), { response });
          setConversationRefresh((value) => value + 1);
          return;
        }
        const conversationResponse = await fetch(
          `/api/ai/conversations?id=${encodeURIComponent(item.id)}`,
          { credentials: "include" },
        );
        const conversationPayload = await conversationResponse
          .json()
          .catch(() => ({}));
        if (!conversationResponse.ok)
          throw Object.assign(new Error("fetch_failed"), {
            payload: conversationPayload,
            response: conversationResponse,
          });
        const key =
          window.localStorage.getItem(
            `munetios.ai.voiceConversationKey.${item.id}`,
          ) || "";
        if (!key || !conversationPayload.conversation?.encryptedPayload)
          throw new Error("missing_encryption_key");
        const shareResponse = await fetch("/api/ai/shared-links", {
          body: JSON.stringify({
            conversationId: item.id,
            encryptedPayload: conversationPayload.conversation.encryptedPayload,
            title: item.title,
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!shareResponse.ok)
          throw Object.assign(new Error("share_failed"), {
            response: shareResponse,
          });
        const { link } = await shareResponse.json();
        const url = withVoiceShareKey(link.url, key);
        window.localStorage.setItem(
          `munetios.ai.voiceShareKey.${link.id}`,
          key,
        );
        showModal(
          <div className="ai-voice-share-modal">
            <p>{copy.aiVoiceShareLinkDescription}</p>
            <input
              aria-label={copy.aiVoiceGeneratedShareLink}
              readOnly
              value={url}
            />
            <a href={url} rel="noreferrer" target="_blank">
              {copy.aiVoiceOpenShareLink}
              <icon>open_in_new</icon>
            </a>
          </div>,
          {
            ariaLabel: copy.aiVoiceGeneratedShareLink,
            title: copy.aiVoiceGeneratedShareLink,
          },
        );
      } catch (error) {
        showToast({
          message:
            action === "share"
              ? copy.aiVoiceShareFailed
              : conversationError(copy, error.response, item.id, error.payload),
          type: "error",
        });
      }
    },
    [copy, signedIn],
  );

  const confirmConversationAction = useCallback(async () => {
    const current = conversationConfirm;
    if (!current) return;
    const method = current.action === "delete" ? "DELETE" : "PATCH";
    const body =
      current.action === "delete"
        ? { action: "delete-one", id: current.item.id }
        : { action: "archive", id: current.item.id };
    try {
      if (!signedIn) {
        if (current.action === "delete") {
          deleteGuestConversation(current.item.id);
        } else {
          updateGuestConversation(current.item.id, "archive");
        }
        return;
      }
      const response = await fetch("/api/ai/conversations", {
        body: JSON.stringify(body),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Object.assign(new Error(payload.error || "action_failed"), {
          payload,
          response,
        });
      setConversationRefresh((value) => value + 1);
      window.dispatchEvent(new Event("munetios:aiconversationschange"));
    } catch (error) {
      if (current.action === "delete") {
        const detail = conversationError(
          copy,
          error.response,
          current.item.id,
          error.payload,
        );
        showToast({
          message: copy.aiConversationDeleteFailed.replace("{error}", detail),
          type: "error",
        });
      } else {
        showToast({ message: copy.aiConversationArchiveFailed, type: "error" });
      }
    } finally {
      setConversationConfirm(null);
    }
  }, [conversationConfirm, copy, signedIn]);

  const renameConversation = useCallback(
    async (title) => {
      if (!conversationRename) return;
      try {
        if (!signedIn) {
          updateGuestConversation(conversationRename.id, "rename", { title });
          setConversationRename(null);
          return;
        }
        const response = await fetch("/api/ai/conversations", {
          body: JSON.stringify({
            action: "rename",
            id: conversationRename.id,
            title,
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        });
        if (!response.ok) throw new Error("rename_failed");
        setConversationRefresh((value) => value + 1);
        window.dispatchEvent(new Event("munetios:aiconversationschange"));
        setConversationRename(null);
      } catch {
        showToast({ message: copy.aiConversationRenameFailed, type: "error" });
      }
    },
    [conversationRename, copy.aiConversationRenameFailed, signedIn],
  );

  const closeModal = useCallback((id) => {
    setModalStack((current) => current.filter((modal) => modal.id !== id));
  }, []);

  useEffect(() => {
    const latestModalId = modalStack.at(-1)?.id;
    if (!latestModalId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeModal(latestModalId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeModal, modalStack]);

  useEffect(() => {
    const refreshCopy = () => setCopy(t());

    refreshCopy();
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);

    return () => {
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  useEffect(() => {
    const compactQuery = window.matchMedia("(max-width: 1149.98px)");
    const mobileQuery = window.matchMedia("(max-width: 559.98px)");
    const shortHeightQuery = window.matchMedia("(max-height: 699.98px)");
    const refreshViewport = () => {
      setCompactViewport(compactQuery.matches);
      setMobileViewport(mobileQuery.matches);
      setShortViewport(shortHeightQuery.matches);
      if (!compactQuery.matches) setOverlayOpen(false);
    };
    refreshViewport();
    compactQuery.addEventListener("change", refreshViewport);
    mobileQuery.addEventListener("change", refreshViewport);
    shortHeightQuery.addEventListener("change", refreshViewport);
    return () => {
      compactQuery.removeEventListener("change", refreshViewport);
      mobileQuery.removeEventListener("change", refreshViewport);
      shortHeightQuery.removeEventListener("change", refreshViewport);
    };
  }, []);

  useEffect(() => {
    const openSidebar = () => setOverlayOpen(true);
    window.addEventListener("munetios:ai-open-sidebar", openSidebar);
    return () =>
      window.removeEventListener("munetios:ai-open-sidebar", openSidebar);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refreshSession = async () => {
      const cookieSignedIn = hasSignedInCookie();
      setSignedIn(cookieSignedIn);
      if (!cookieSignedIn) {
        setAccount(null);
        return;
      }

      const cachedAccount = loadAiAccountCache();
      if (cachedAccount) setAccount(cachedAccount);

      try {
        const response = await fetch("/api/account", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const authoritativeAccount = await response.json();
        setAccount(authoritativeAccount);
        saveAiAccountCache(authoritativeAccount);
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    };
    void refreshSession();
    window.addEventListener("munetios:authchange", refreshSession);
    return () => {
      controller.abort();
      window.removeEventListener("munetios:authchange", refreshSession);
    };
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setSelfParentalControls(null);
      return;
    }
    let cancelled = false;
    fetchSelfParentalControls().then((controls) => {
      if (!cancelled) setSelfParentalControls(controls);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const closeResponsiveSidebar = useCallback(() => {
    if (compactViewport) setOverlayOpen(false);
  }, [compactViewport]);

  const teenAccount =
    signedIn && isTeenBirthday(account?.birthday || account?.birthDate);
  const healthBlocked = selfParentalControls
    ? selfParentalControls.allowHealthAi !== true
    : teenAccount;
  const agentBlocked =
    educationStudent || selfParentalControls?.allowAgentAi === false;

  const openGuestFeature = useCallback(
    (event, feature) => {
      if (signedIn) return;
      event.preventDefault();
      setOverlayOpen(false);
      openModal("guest", feature);
    },
    [openModal, signedIn],
  );

  const navigate = useCallback(
    (event, path) => {
      event?.preventDefault?.();
      onNavigate(path);
      closeResponsiveSidebar();
    },
    [closeResponsiveSidebar, onNavigate],
  );

  useEffect(() => {
    const openShortcuts = () =>
      openKeyboardShortcutsModal({
        shortcuts: [
          { keys: ["Ctrl", "Shift", "O"], label: copy.aiSidebarNewChat },
          { keys: ["Ctrl", "K"], label: copy.aiSidebarSearchChats },
          { keys: ["Ctrl", "Shift", "S"], label: copy.aiPromptMicrophone },
          { keys: ["Ctrl", "/"], label: copy.meetKeyboardShortcuts },
        ],
        title: copy.meetKeyboardShortcuts,
      });
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "/" && !event.shiftKey) {
        event.preventDefault();
        openShortcuts();
        return;
      }
      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        openModal("search");
        return;
      }
      if (key === "o" && event.shiftKey) {
        event.preventDefault();
        onNavigate("/apps/ai");
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copy, onNavigate, openModal]);

  useEffect(() => {
    if (activePage === "health" && healthBlocked && !healthGateShown.current) {
      healthGateShown.current = true;
      openModal("health-unavailable");
    }
    if (activePage !== "health" || !healthBlocked)
      healthGateShown.current = false;
  }, [activePage, openModal, healthBlocked]);

  useEffect(() => {
    setCollapsed(
      window.localStorage.getItem("munetios.ai.sidebarCollapsed") === "true",
    );
  }, []);

  const toggleSidebar = () => {
    if (compactViewport) {
      setOverlayOpen((current) => !current);
      return;
    }
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("munetios.ai.sidebarCollapsed", String(next));
      return next;
    });
  };

  const effectiveCollapsed = compactViewport ? !overlayOpen : collapsed;
  const searchOpen = modalStack.some((modal) => modal.type === "search");

  useEffect(() => {
    const refreshConversations = () =>
      setConversationRefresh((value) => value + 1);
    window.addEventListener(
      "munetios:aiconversationschange",
      refreshConversations,
    );
    return () =>
      window.removeEventListener(
        "munetios:aiconversationschange",
        refreshConversations,
      );
  }, []);

  useEffect(() => {
    void conversationRefresh;
    const controller = new AbortController();

    const loadSidebarContent = async () => {
      if (!signedIn) {
        const conversations = listGuestConversations();
        setHistory(conversations);
        setPinned(conversations.filter((conversation) => conversation.pinned));
        setHistoryError(false);
        setPinnedError(false);
        return;
      }
      const [historyResult, pinnedResult] = await Promise.allSettled([
        fetch("/api/ai/history", {
          credentials: "include",
          signal: controller.signal,
        }),
        fetch("/api/ai/pinned", {
          credentials: "include",
          signal: controller.signal,
        }),
      ]);

      if (controller.signal.aborted) return;

      if (
        historyResult.status === "fulfilled" &&
        (historyResult.value.ok || historyResult.value.status === 401)
      ) {
        const payload = await historyResult.value.json().catch(() => ({}));
        setHistory(
          Array.isArray(payload.conversations) ? payload.conversations : [],
        );
        setHistoryError(false);
      } else {
        setHistory([]);
        setHistoryError(true);
      }

      if (
        pinnedResult.status === "fulfilled" &&
        (pinnedResult.value.ok || pinnedResult.value.status === 401)
      ) {
        const payload = await pinnedResult.value.json().catch(() => ({}));
        setPinned(Array.isArray(payload.pinned) ? payload.pinned : []);
        setPinnedError(false);
      } else {
        setPinned([]);
        setPinnedError(true);
      }
    };

    void loadSidebarContent();
    return () => controller.abort();
  }, [conversationRefresh, signedIn]);

  return (
    <>
      {conversationConfirm
        ? <ConversationConfirmModal
            close={() => setConversationConfirm(null)}
            copy={copy}
            item={conversationConfirm.item}
            onConfirm={confirmConversationAction}
            type={conversationConfirm.action}
          />
        : null}
      {conversationRename
        ? <ConversationRenameModal
            close={() => setConversationRename(null)}
            copy={copy}
            item={conversationRename}
            onRename={renameConversation}
          />
        : null}
      {mobileViewport && !overlayOpen && activePage !== "connectors"
        ? <button
            aria-label={copy.notesShortcutToggleSidebar}
            className="ai-mobile-menu-button liquid-glass"
            onClick={() => setOverlayOpen(true)}
            type="button"
          >
            <icon>menu</icon>
          </button>
        : null}
      {compactViewport && overlayOpen
        ? <button
            aria-label={copy.close}
            className="ai-sidebar-overlay"
            onClick={() => setOverlayOpen(false)}
            type="button"
          />
        : null}
      <munetios-ai-sidebar
        className={`ai-sidebar${effectiveCollapsed ? " is-collapsed" : ""}${overlayOpen ? " is-overlay-open" : ""}${mobileViewport && !overlayOpen ? " is-mobile-hidden" : ""}`}
        id="ai-sidebar"
      >
        <nav
          aria-label={copy.aiSidebarNavigation}
          className="ai-sidebar-nav liquid-glass"
          data-translate-aria-label="aiSidebarNavigation"
        >
          <h1 hidden>{copy.aiSidebarChats}</h1>
          <div className="ai-sidebar-header">
            <div className="ai-logo">
              <Image
                src="/ai.png"
                alt={copy.aiAppPageLabel}
                data-translate-alt="aiAppPageLabel"
                width={48}
                height={48}
              />
              <div className="ai-logo-text">Munetios AI</div>
            </div>
            <div className="ai-sidebar-controls">
              <button
                aria-expanded={!effectiveCollapsed}
                className="ai-sidebar-toggle"
                aria-label={copy.notesShortcutToggleSidebar}
                data-translate-aria-label="notesShortcutToggleSidebar"
                onClick={toggleSidebar}
                type="button"
              >
                <icon>
                  {effectiveCollapsed ? "right_panel_open" : "left_panel_close"}
                </icon>
              </button>
            </div>
          </div>
          <div className="sticky-sidebar-items">
            <Link
              aria-current={activePage === "home" ? "page" : undefined}
              className="ai-sidebar-item"
              href="/apps/ai"
              onClick={(event) => navigate(event, "/apps/ai")}
            >
              <icon>edit_square</icon>
              <span
                className="ai-sidebar-item-text"
                data-translate="aiSidebarNewChat"
              >
                {copy.aiSidebarNewChat}
              </span>
            </Link>
            <Link
              aria-current={
                activePage === "search" || searchOpen ? "page" : undefined
              }
              className="ai-sidebar-item"
              href="/apps/ai/search"
              onClick={(event) => {
                event.preventDefault();
                setOverlayOpen(false);
                openModal("search");
              }}
            >
              <icon>search</icon>
              <span
                className="ai-sidebar-item-text"
                data-translate="aiSidebarSearchChats"
              >
                {copy.aiSidebarSearchChats}
              </span>
            </Link>
            {!agentBlocked
              ? <Link
                  aria-current={activePage === "agent" ? "page" : undefined}
                  className="ai-sidebar-item"
                  href="/apps/ai/agent"
                  onClick={(event) => navigate(event, "/apps/ai/agent")}
                >
                  <icon>highlight_mouse_cursor</icon>
                  <span
                    className="ai-sidebar-item-text"
                    data-translate="aiSettingsAgent"
                  >
                    {copy.aiSettingsAgent}
                  </span>
                </Link>
              : null}
          </div>
          <div className="ai-sidebar-scroll">
            <div className="ai-sidebar-navigation">
              <div className="ai-sidebar-items" id="ai-sidebar-items">
                {!educationStudent
                  ? <Link
                      aria-current={
                        activePage === "images" ? "page" : undefined
                      }
                      className="ai-sidebar-item"
                      href="/apps/ai/images"
                      onClick={(event) => navigate(event, "/apps/ai/images")}
                    >
                      <icon>photo_library</icon>
                      <span
                        className="ai-sidebar-item-text"
                        data-translate="aiSidebarImages"
                      >
                        {copy.aiSidebarImages}
                      </span>
                    </Link>
                  : null}
                <Link
                  aria-current={activePage === "projects" ? "page" : undefined}
                  className="ai-sidebar-item"
                  href="/apps/ai/projects"
                  onClick={(event) => navigate(event, "/apps/ai/projects")}
                >
                  <icon>folder_copy</icon>
                  <span
                    className="ai-sidebar-item-text"
                    data-translate="aiSidebarProjects"
                  >
                    {copy.aiSidebarProjects}
                  </span>
                </Link>
                {signedIn
                  ? <Link
                      aria-current={
                        activePage === "library" ? "page" : undefined
                      }
                      className="ai-sidebar-item"
                      href="/apps/ai/library"
                      onClick={(event) => navigate(event, "/apps/ai/library")}
                    >
                      <icon>cards_stack</icon>
                      <span
                        className="ai-sidebar-item-text"
                        data-translate="aiSidebarLibrary"
                      >
                        {copy.aiSidebarLibrary}
                      </span>
                    </Link>
                  : null}
                <Link
                  aria-current={activePage === "code" ? "page" : undefined}
                  className="ai-sidebar-item"
                  href="/apps/ai/code"
                  onClick={(event) =>
                    signedIn
                      ? navigate(event, "/apps/ai/code")
                      : openGuestFeature(event, "code")
                  }
                >
                  <icon>code</icon>
                  <span
                    className="ai-sidebar-item-text"
                    data-translate="aiSidebarCode"
                  >
                    {copy.aiSidebarCode}
                  </span>
                </Link>
                {!educationStudent
                  ? <Link
                      aria-current={activePage === "bots" ? "page" : undefined}
                      className="ai-sidebar-item"
                      href="/apps/ai/bots"
                      onClick={(event) => navigate(event, "/apps/ai/bots")}
                    >
                      <icon>smart_toy</icon>
                      <span
                        className="ai-sidebar-item-text"
                        data-translate="aiSidebarMyBots"
                      >
                        {copy.aiSidebarMyBots}
                      </span>
                    </Link>
                  : null}
                {!appLoading && !healthBlocked
                  ? <Link
                      aria-current={
                        activePage === "health" ? "page" : undefined
                      }
                      className="ai-sidebar-item"
                      href="/apps/ai/health"
                      onClick={(event) =>
                        signedIn
                          ? navigate(event, "/apps/ai/health")
                          : openGuestFeature(event, "health")
                      }
                    >
                      <icon>health_and_safety</icon>
                      <span
                        className="ai-sidebar-item-text"
                        data-translate="aiSidebarHealth"
                      >
                        {copy.aiSidebarHealth}
                      </span>
                    </Link>
                  : null}
              </div>
            </div>
            {!appLoading
              ? <div className="ai-sidebar-content">
                  <SidebarGroup
                    copy={copy}
                    empty={copy.aiSidebarNoPinnedContent}
                    error={pinnedError ? copy.aiSidebarPinnedLoadFailed : ""}
                    icon="keep"
                    items={pinned}
                    limit={shortViewport ? 10 : 50}
                    onAction={runConversationAction}
                    onNavigate={(event) =>
                      navigate(event, event.currentTarget.getAttribute("href"))
                    }
                    sharingDisabled={educationStudent}
                    title={copy.aiSidebarPinned}
                  />
                  <SidebarGroup
                    copy={copy}
                    empty={copy.aiSidebarNoVoiceConversations}
                    error={
                      historyError ? copy.aiSidebarConversationsLoadFailed : ""
                    }
                    icon="graphic_eq"
                    items={history.filter((item) => item.type === "voice")}
                    limit={10}
                    onAction={runConversationAction}
                    onNavigate={(event) =>
                      navigate(event, event.currentTarget.getAttribute("href"))
                    }
                    sharingDisabled={educationStudent}
                    title={copy.aiVoiceMode}
                  />
                  <SidebarGroup
                    copy={copy}
                    empty={copy.aiSidebarNoConversations}
                    error={
                      historyError ? copy.aiSidebarConversationsLoadFailed : ""
                    }
                    icon="history"
                    items={history.filter((item) => item.type !== "voice")}
                    onAction={runConversationAction}
                    onNavigate={(event) =>
                      navigate(event, event.currentTarget.getAttribute("href"))
                    }
                    sharingDisabled={educationStudent}
                    title={copy.aiSidebarChatHistory}
                  />
                </div>
              : null}
          </div>
          <div className="ai-sidebar-bottom">
            <Link
              aria-current={activePage === "connectors" ? "page" : undefined}
              className="ai-sidebar-item"
              href="/apps/ai/connectors"
              onClick={(event) => navigate(event, "/apps/ai/connectors")}
            >
              <icon>extension</icon>
              <span
                className="ai-sidebar-item-text"
                data-translate="accountSettingsConnectors"
              >
                {copy.accountSettingsConnectors}
              </span>
            </Link>
            <button
              className="ai-sidebar-item"
              onClick={() => {
                setOverlayOpen(false);
                openAiSettingsModal({ signedIn });
              }}
              type="button"
            >
              <icon>settings</icon>
              <span
                className="ai-sidebar-item-text"
                data-translate="aiSidebarSettings"
              >
                {copy.aiSidebarSettings}
              </span>
            </button>
            <ProfileTrigger appLoading={appLoading} />
          </div>
        </nav>
      </munetios-ai-sidebar>
      {modalStack.map((modal) => {
        if (modal.type === "guest") {
          return (
            <GuestFeatureModal
              close={() => closeModal(modal.id)}
              copy={copy}
              feature={modal.feature}
              key={modal.id}
            />
          );
        }
        if (modal.type === "health-unavailable") {
          return (
            <HealthUnavailableModal
              close={() => closeModal(modal.id)}
              copy={copy}
              key={modal.id}
            />
          );
        }
        return (
          <SearchChatsModal
            close={() => closeModal(modal.id)}
            copy={copy}
            key={modal.id}
            onNavigate={onNavigate}
          />
        );
      })}
    </>
  );
}
