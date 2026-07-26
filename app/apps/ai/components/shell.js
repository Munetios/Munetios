"use client";

import { useCallback, useEffect, useState } from "react";
import AppTopbarRight from "../../../components/appTopbarRight";
import { t } from "../../../i18n";
import NewChatPage from "./newChatPage";
import PricingOverlay from "./pricingOverlay";
import AiSidebar from "./sidebar";

const accountUrl = "/api/account";
const accountRetryDelayMs = 1000;
const sidebarCompactQuery = "(max-width: 1149.98px)";
const sidebarHiddenQuery = "(max-width: 767.98px)";

export default function AiShell({ pagePath }) {
  const [copy, setCopy] = useState(() => t("en"));
  const [account, setAccount] = useState(null);
  const [sessionState, setSessionState] = useState("loading");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCompactMode, setSidebarCompactMode] = useState(false);
  const [sidebarHiddenMode, setSidebarHiddenMode] = useState(false);

  useEffect(() => {
    const refreshCopy = () => {
      setCopy(t());
    };

    refreshCopy();
    window.addEventListener("languagechange", refreshCopy);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);

    return () => {
      window.removeEventListener("languagechange", refreshCopy);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  const refreshSession = useCallback(async (signal) => {
    try {
      const response = await fetch(accountUrl, {
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal,
      });

      if (response.ok) {
        const nextAccount = await response.json();
        setAccount(nextAccount);
        setSessionState("active");
        return true;
      }

      if (response.status === 401) {
        setAccount(null);
        setSessionState("inactive");
        return true;
      }

      return false;
    } catch (error) {
      return error?.name === "AbortError";
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer = null;
    let running = false;

    const refresh = async () => {
      if (running) return;
      running = true;
      const settled = await refreshSession(controller.signal);
      running = false;

      if (!settled && !controller.signal.aborted) {
        retryTimer = window.setTimeout(refresh, accountRetryDelayMs);
      }
    };

    void refresh();
    window.addEventListener("munetios:authchange", refresh);

    return () => {
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener("munetios:authchange", refresh);
    };
  }, [refreshSession]);

  useEffect(() => {
    const compactMediaQuery = window.matchMedia(sidebarCompactQuery);
    const hiddenMediaQuery = window.matchMedia(sidebarHiddenQuery);
    const syncSidebarMode = () => {
      const compact = compactMediaQuery.matches;

      setSidebarCompactMode(compact);
      setSidebarHiddenMode(hiddenMediaQuery.matches);
      setSidebarOpen(!compact);
    };

    syncSidebarMode();
    compactMediaQuery.addEventListener("change", syncSidebarMode);
    hiddenMediaQuery.addEventListener("change", syncSidebarMode);

    return () => {
      compactMediaQuery.removeEventListener("change", syncSidebarMode);
      hiddenMediaQuery.removeEventListener("change", syncSidebarMode);
    };
  }, []);

  useEffect(() => {
    if (!sidebarCompactMode || !sidebarOpen) {
      return undefined;
    }

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [sidebarCompactMode, sidebarOpen]);

  const toggleSidebar = () => setSidebarOpen((currentValue) => !currentValue);
  const sidebarCollapsed = !sidebarOpen;
  const normalizedPagePath = String(pagePath || "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  const isPricingPage = normalizedPagePath === "pricing";
  const isNewChatPage =
    normalizedPagePath === "" || normalizedPagePath === "new-chat";

  return (
    <munetios-app-container
      className={`munetios-ai-shell ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"} ${sidebarCompactMode ? "sidebar-responsive-compact" : ""} ${sidebarHiddenMode ? "sidebar-hidden" : ""}`}
    >
      {sidebarCompactMode && sidebarOpen
        ? <button
            aria-label={copy.omniWriteCloseSidebar}
            className="munetios-ai-sidebar-overlay"
            data-translate-aria-label="omniWriteCloseSidebar"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
        : null}
      <AiSidebar
        account={account}
        collapsed={sidebarCollapsed}
        copy={copy}
        hidden={sidebarHiddenMode && sidebarCollapsed}
        onToggle={toggleSidebar}
        signedIn={sessionState === "active"}
      />
      <main
        aria-label="Munetios AI"
        className="munetios-ai-page munetios-ai-main"
        data-ai-page={pagePath || "home"}
        data-translate-aria-label="aiAppPageLabel"
      >
        <div className="munetios-ai-topbar sticky top-0 z-[1000] flex flex-col gap-2 bg-transparent p-2">
          <header className="flex w-full items-center justify-between gap-2 bg-transparent">
            <button
              aria-hidden={!sidebarCollapsed}
              aria-label={copy.omniWriteOpenSidebar}
              className={`munetios-ai-topbar-menu liquid-glass flex h-14 w-14 cursor-pointer items-center justify-center ${!sidebarCollapsed ? "is-hidden" : ""}`}
              data-translate-aria-label="omniWriteOpenSidebar"
              onClick={toggleSidebar}
              tabIndex={!sidebarCollapsed ? -1 : undefined}
              type="button"
            >
              <icon className="text-[28px]">menu</icon>
            </button>
            {isNewChatPage || sessionState === "inactive"
              ? <AppTopbarRight className="munetios-ai-topbar-actions">
                  {isNewChatPage
                    ? <button
                        aria-label={copy.aiTemporaryChat}
                        className="munetios-ai-temporary-chat-button flex h-10 w-10 cursor-pointer items-center justify-center text-white transition hover:bg-purple-600/35!"
                        type="button"
                      >
                        <icon>chat_bubble_outline</icon>
                      </button>
                    : null}
                  {sessionState === "inactive"
                    ? <button
                        className="munetios-ai-topbar-button liquid-glass cursor-pointer bg-purple-800/40! px-4 py-2 text-white transition-all hover:bg-purple-600/55!"
                        data-translate="signIn"
                        id="sign-in-button"
                        onClick={() => {
                          window.location.assign("/signin");
                        }}
                        type="button"
                      >
                        {copy.signIn}
                      </button>
                    : null}
                </AppTopbarRight>
              : null}
          </header>
        </div>
        {isNewChatPage ? <NewChatPage account={account} copy={copy} /> : null}
        {isPricingPage
          ? <section
              aria-label={copy.aiPricingTitle}
              className="min-h-[calc(100dvh-4.5rem)] px-2 pb-6"
            >
              <PricingOverlay
                close={() => {}}
                copy={copy}
                signedIn={sessionState === "active"}
              />
            </section>
          : null}
      </main>
    </munetios-app-container>
  );
}
