"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AccountAvatar from "../../../components/accountAvatar";
import AccountWrapper from "../../../components/accountwraper";
import AppTopbarRight from "../../../components/appTopbarRight";
import { t } from "../../../i18n";

const sessionUrl = "/api/signedin";
const signedOutBannerStorageKey = "munetios.omniwrite.signedOutBannerDismissed";

function isSignedOutBannerDismissed() {
  try {
    return window.localStorage.getItem(signedOutBannerStorageKey) === "true";
  } catch {
    return false;
  }
}

export default function OmniWriteTopbar({ sidebarOpen, onSidebarToggle }) {
  const copy = t("en");
  const accountPanelRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelTop, setPanelTop] = useState(72);
  const [sessionState, setSessionState] = useState("loading");
  const [user, setUser] = useState(null);

  const updateAccountPanelPosition = useCallback(() => {
    const trigger = accountTriggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    setPanelTop(Math.max(10, rect.bottom + 10));
  }, []);

  const refreshSession = useCallback(async (signal) => {
    try {
      const response = await fetch(sessionUrl, {
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await response.json();
      const signedIn = Boolean(
        response.ok && payload.authenticated && payload.signedIn,
      );

      setUser(signedIn ? payload.user : null);
      setSessionState(signedIn ? "active" : "inactive");
      if (!signedIn) {
        setAccountPanelOpen(false);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        setUser(null);
        setSessionState("inactive");
        setAccountPanelOpen(false);
      }
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    setBannerDismissed(isSignedOutBannerDismissed());
    const controller = new AbortController();
    void refreshSession(controller.signal);

    const handleAuthChange = () => {
      void refreshSession();
    };
    const handleStorageChange = (event) => {
      if (event.key === signedOutBannerStorageKey || event.key === null) {
        setBannerDismissed(isSignedOutBannerDismissed());
      }
      void refreshSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSession();
      }
    };
    const handleProfileChange = (event) => {
      if (!event.detail) {
        return;
      }

      setUser((currentUser) => ({
        ...(currentUser || {}),
        avatar: event.detail.avatar,
        avatarLetter: event.detail.avatar?.value || currentUser?.avatarLetter,
        avatarUrl: event.detail.profilePictureUrl || null,
        profilePictureUrl: event.detail.profilePictureUrl || null,
      }));
    };

    window.addEventListener("munetios:authchange", handleAuthChange);
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("munetios:profilechange", handleProfileChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      controller.abort();
      window.removeEventListener("munetios:authchange", handleAuthChange);
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("munetios:profilechange", handleProfileChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshSession]);

  const dismissSignedOutBanner = () => {
    setBannerDismissed(true);
    try {
      window.localStorage.setItem(signedOutBannerStorageKey, "true");
    } catch {
      return;
    }
  };

  useEffect(() => {
    if (!accountPanelOpen) {
      return undefined;
    }

    updateAccountPanelPosition();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        const openDropdown = document.querySelector(
          "[data-munetios-dropdown-portal='true']:not([hidden])",
        );
        if (openDropdown) {
          return;
        }

        setAccountPanelOpen(false);
        accountTriggerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateAccountPanelPosition);
    window.addEventListener("scroll", updateAccountPanelPosition, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateAccountPanelPosition);
      window.removeEventListener("scroll", updateAccountPanelPosition, true);
    };
  }, [accountPanelOpen, updateAccountPanelPosition]);

  return (
    <>
      <div className="omniwrite-topbar sticky top-0 z-[1000] flex flex-col gap-2 bg-transparent p-2">
        {sessionState === "inactive" && !bannerDismissed ? (
          <aside className="liquid-glass flex w-full items-start gap-3 rounded-2xl border border-purple-200/15 bg-purple-950/65! px-4 py-3 text-white shadow-lg shadow-purple-950/20 sm:items-center">
            <icon className="mt-0.5 shrink-0 text-purple-200 lg:mt-0">
              cloud_off
            </icon>
            <div className="min-w-0 flex-1">
              <p
                className="font-semibold text-purple-50"
                data-translate="omniWriteSignedOutBannerTitle"
              >
                Sign in to sync and share documents
              </p>
              <p
                className="mt-0.5 text-sm leading-5 text-purple-100/80"
                data-translate="omniWriteSignedOutBannerMessage"
              >
                Sign in to securely sync your OmniWrite documents across
                devices, keep every change backed up, collaborate with others,
                and share documents without interrupting your writing.
              </p>
            </div>
            <button
              aria-label={
                copy.omniWriteDismissSignedOutBanner || "Dismiss sign-in banner"
              }
              className="omniwrite-topbar-button flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center text-purple-100 transition hover:bg-purple-700/45! hover:text-white"
              data-translate-aria-label="omniWriteDismissSignedOutBanner"
              onClick={dismissSignedOutBanner}
              type="button"
            >
              <icon>close</icon>
            </button>
          </aside>
        ) : null}

        <header className="flex w-full items-center justify-between gap-2 bg-transparent">
          <button
            aria-hidden={sidebarOpen}
            aria-label={copy.omniWriteOpenSidebar}
            className={`omniwrite-topbar-menu liquid-glass flex h-14 w-14 cursor-pointer items-center justify-center ${sidebarOpen ? "is-hidden" : ""}`}
            data-translate-aria-label="omniWriteOpenSidebar"
            id="sidebarToggleBtn"
            onClick={onSidebarToggle}
            tabIndex={sidebarOpen ? -1 : undefined}
            type="button"
          >
            <icon className="text-[28px]">menu</icon>
          </button>
          <AppTopbarRight className="omniwrite-topbar-actions">
            {sessionState === "active" ? (
              <button
                aria-controls="omniWriteAccountPanel"
                aria-expanded={accountPanelOpen}
                aria-label={copy.openAccountMenu}
                className="omniwrite-topbar-button flex h-10 w-10 cursor-pointer items-center justify-center overflow-hidden text-white transition-all hover:bg-purple-700/50!"
                data-translate-aria-label="openAccountMenu"
                onClick={() => {
                  updateAccountPanelPosition();
                  setAccountPanelOpen(true);
                }}
                ref={accountTriggerRef}
                type="button"
              >
                <AccountAvatar
                  account={user}
                  alt={copy.accountProfileAlt}
                  className="h-10 w-10 rounded-full"
                />
              </button>
            ) : sessionState === "inactive" ? (
              <button
                id="sign-in-button"
                className="omniwrite-topbar-button liquid-glass cursor-pointer bg-purple-800/90! px-4 py-2 text-white transition-all hover:bg-purple-600!"
                data-translate="signIn"
                onClick={() => {
                  window.location.assign("/signin");
                }}
                type="button"
              >
                {copy.signIn}
              </button>
            ) : (
              <output
                aria-label={copy.accountProfileLoading}
                className="h-9 w-9 animate-pulse rounded-full bg-purple-200/20"
                data-translate-aria-label="accountProfileLoading"
              />
            )}
          </AppTopbarRight>
        </header>
      </div>

      {mounted && sessionState === "active" && accountPanelOpen
        ? createPortal(
            <div
              className="fixed z-[1100]"
              id="omniWriteAccountPanel"
              ref={accountPanelRef}
              style={{
                right: "10px",
                top: `${panelTop}px`,
              }}
            >
              <AccountWrapper
                appContext
                legalLinksInNewTab
                persistentDropdowns
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
