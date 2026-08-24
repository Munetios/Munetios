"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { t } from "../../../i18n";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import ProfileTrigger from "./profileTrigger";
import { openAiSettingsModal } from "./settingsModal";
import { SearchChatsModal } from "./sidebar";

export default function CodeSidebar({
  activeSection = "home",
  onNavigate = () => {},
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [copy, setCopy] = useState(() => t());
  const [historyError, setHistoryError] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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
    setCollapsed(
      window.localStorage.getItem("munetios.ai.code.sidebarCollapsed") ===
        "true",
    );
    const compactQuery = window.matchMedia("(max-width: 1149.98px)");
    const mobileQuery = window.matchMedia("(max-width: 559.98px)");
    const refreshViewport = () => {
      setCompactViewport(compactQuery.matches);
      setMobileViewport(mobileQuery.matches);
      if (!compactQuery.matches) setOverlayOpen(false);
    };
    refreshViewport();
    compactQuery.addEventListener("change", refreshViewport);
    mobileQuery.addEventListener("change", refreshViewport);
    return () => {
      compactQuery.removeEventListener("change", refreshViewport);
      mobileQuery.removeEventListener("change", refreshViewport);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai/history", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) return { conversations: [] };
        if (!response.ok) throw new Error("history_load_failed");
        return response.json();
      })
      .then((payload) => {
        setConversations(
          Array.isArray(payload.conversations)
            ? payload.conversations.filter((item) => item.type !== "voice")
            : [],
        );
        setHistoryError(false);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setConversations([]);
        setHistoryError(true);
      });
    return () => controller.abort();
  }, []);

  const navigate = useCallback(
    (event, path) => {
      event.preventDefault();
      setOverlayOpen(false);
      onNavigate(path);
    },
    [onNavigate],
  );

  const toggleSidebar = () => {
    if (compactViewport) {
      setOverlayOpen((current) => !current);
      return;
    }
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(
        "munetios.ai.code.sidebarCollapsed",
        String(next),
      );
      return next;
    });
  };

  const effectiveCollapsed = compactViewport ? !overlayOpen : collapsed;

  return (
    <>
      {mobileViewport && !overlayOpen
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
        className={`ai-sidebar ai-code-sidebar${effectiveCollapsed ? " is-collapsed" : ""}${overlayOpen ? " is-overlay-open" : ""}${mobileViewport && !overlayOpen ? " is-mobile-hidden" : ""}`}
        id="ai-code-sidebar"
      >
        <nav
          aria-label={copy.aiCodeSidebarNavigation}
          className="ai-sidebar-nav liquid-glass"
        >
          <div className="ai-sidebar-header">
            <div className="ai-logo">
              <Image
                alt={copy.aiCodeTitle}
                height={48}
                src="/ai.png"
                width={48}
              />
              <div className="ai-logo-text">{copy.aiCodeTitle}</div>
            </div>
            <div className="ai-sidebar-controls">
              <button
                aria-expanded={!effectiveCollapsed}
                aria-label={copy.notesShortcutToggleSidebar}
                className="ai-sidebar-toggle"
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
              aria-current={activeSection === "home" ? "page" : undefined}
              aria-label={copy.aiSidebarNewChat}
              className="ai-sidebar-item"
              href="/apps/ai/code"
              onClick={(event) => navigate(event, "/apps/ai/code")}
            >
              <icon>edit_square</icon>
              <span className="ai-sidebar-item-text">
                {copy.aiSidebarNewChat}
              </span>
            </Link>
            <button
              aria-expanded={searchOpen}
              aria-label={copy.aiSidebarSearchChats}
              className="ai-sidebar-item"
              onClick={() => {
                setOverlayOpen(false);
                setSearchOpen(true);
              }}
              type="button"
            >
              <icon>search</icon>
              <span className="ai-sidebar-item-text">
                {copy.aiSidebarSearchChats}
              </span>
            </button>
            <Link
              aria-current={activeSection === "connectors" ? "page" : undefined}
              aria-label={copy.accountSettingsConnectors}
              className="ai-sidebar-item"
              href="/apps/ai/code/connectors"
              onClick={(event) => navigate(event, "/apps/ai/code/connectors")}
            >
              <icon>extension</icon>
              <span className="ai-sidebar-item-text">
                {copy.accountSettingsConnectors}
              </span>
            </Link>
          </div>
          <div className="ai-sidebar-scroll">
            <section className="ai-sidebar-group ai-code-conversations">
              <h2 className="ai-sidebar-group-title">
                <icon className="ai-sidebar-group-icon">history</icon>
                <span>{copy.aiSidebarChatHistory}</span>
              </h2>
              {historyError
                ? <p className="ai-sidebar-group-status is-error">
                    {copy.aiSidebarConversationsLoadFailed}
                  </p>
                : conversations.length === 0
                  ? <p className="ai-sidebar-group-status">
                      {copy.aiSidebarNoConversations}
                    </p>
                  : <div className="ai-sidebar-group-items">
                      {conversations.map((conversation) => (
                        <Link
                          className="ai-sidebar-conversation"
                          href={`/apps/ai/code/chat/${encodeURIComponent(conversation.id)}`}
                          key={conversation.id}
                          onClick={(event) =>
                            navigate(
                              event,
                              `/apps/ai/code/chat/${encodeURIComponent(conversation.id)}`,
                            )
                          }
                          title={conversation.title}
                        >
                          <icon className="ai-sidebar-conversation-icon">
                            code
                          </icon>
                          <span>{conversation.title}</span>
                        </Link>
                      ))}
                    </div>}
            </section>
          </div>
          <div className="ai-sidebar-bottom">
            <button
              aria-label={copy.aiSidebarSettings}
              className="ai-sidebar-item"
              onClick={() => {
                setOverlayOpen(false);
                openAiSettingsModal({ signedIn: hasSignedInCookie() });
              }}
              type="button"
            >
              <icon>settings</icon>
              <span className="ai-sidebar-item-text">
                {copy.aiSidebarSettings}
              </span>
            </button>
            <ProfileTrigger />
          </div>
        </nav>
      </munetios-ai-sidebar>
      {searchOpen
        ? <SearchChatsModal
            close={() => setSearchOpen(false)}
            copy={copy}
            onNavigate={(path) => {
              setSearchOpen(false);
              onNavigate(path);
            }}
            pathPrefix="/apps/ai/code/chat"
          />
        : null}
    </>
  );
}
