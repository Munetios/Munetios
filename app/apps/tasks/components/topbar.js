"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AccountAvatar from "../../../components/accountAvatar";
import AccountWrapper from "../../../components/accountwraper";
import AppLauncherWrapper from "../../../components/appLauncherWrapper";
import AppTopbarRight from "../../../components/appTopbarRight";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { openFeedbackModal } from "../../../components/feedbackModal";
import {
  openKeyboardShortcutsModal,
  tasksKeyboardShortcuts,
} from "../../../components/keyboardShortcutsModal";
import { showModal } from "../../../components/modal";
import { dismissTaskNotification } from "../lib/collaborationCrypto";
import { openTasksSettingsModal } from "./tasksSettingsModal";

function SearchField({ copy, mobile = false }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("munetios:tasksfocussearch", focus);
    return () => window.removeEventListener("munetios:tasksfocussearch", focus);
  }, []);
  const updateQuery = (value) => {
    setQuery(value);
    window.dispatchEvent(
      new CustomEvent("munetios:taskssearch", { detail: value }),
    );
  };
  return (
    <form
      className={mobile ? "tasks-mobile-search-form" : "tasks-search-form"}
      onSubmit={(event) => event.preventDefault()}
    >
      <icon>search</icon>
      <input
        aria-label={copy.tasksSearchPlaceholder}
        onChange={(event) => updateQuery(event.target.value)}
        placeholder={copy.tasksSearchPlaceholder}
        ref={inputRef}
        type="search"
        value={query}
      />
    </form>
  );
}

function TopbarIconButton({ ariaLabel, children, className = "", ...props }) {
  return (
    <button
      aria-label={ariaLabel}
      className={`tasks-topbar-icon-button ${className}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export default function TasksTopbar({ copy, onSidebarToggle, sidebarOpen }) {
  const accountPanelRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const appLauncherTriggerRef = useRef(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [appLauncherOpen, setAppLauncherOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [panelTop, setPanelTop] = useState(72);
  const [sessionState, setSessionState] = useState("loading");
  const [loadingProgress, setLoadingProgress] = useState(18);
  const [user, setUser] = useState(null);

  const positionAccountPanel = useCallback(() => {
    const trigger = accountTriggerRef.current;
    if (!trigger) return;
    setPanelTop(Math.max(10, trigger.getBoundingClientRect().bottom + 10));
  }, []);

  const refreshSession = useCallback(async (signal) => {
    try {
      const response = await fetch("/api/signedin", {
        cache: "no-store",
        credentials: "include",
        signal,
      });
      const payload = await response.json();
      const signedIn = Boolean(
        response.ok && payload.authenticated && payload.signedIn,
      );
      setSessionState(signedIn ? "active" : "inactive");
      setUser(signedIn ? payload.user : null);
      if (!signedIn) setAccountPanelOpen(false);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setSessionState("inactive");
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    if (sessionState !== "loading") {
      setLoadingProgress(100);
      const completeTimer = window.setTimeout(() => setLoadingProgress(0), 220);
      return () => window.clearTimeout(completeTimer);
    }

    setLoadingProgress(18);
    const intervalId = window.setInterval(() => {
      setLoadingProgress((current) => {
        if (current >= 82) return current;
        const step = 8 + Math.random() * 14;
        return Math.min(82, Number((current + step).toFixed(1)));
      });
    }, 180);

    return () => window.clearInterval(intervalId);
  }, [sessionState]);

  useEffect(() => {
    setMounted(true);
    const controller = new AbortController();
    void refreshSession(controller.signal);
    const handleAuthChange = () => void refreshSession();
    const handleProfileChange = (event) => {
      if (!event.detail) return;
      setUser((current) => ({
        ...(current || {}),
        avatar: event.detail.avatar,
        avatarUrl: event.detail.profilePictureUrl || null,
        profilePictureUrl: event.detail.profilePictureUrl || null,
      }));
    };
    window.addEventListener("munetios:authchange", handleAuthChange);
    window.addEventListener("munetios:profilechange", handleProfileChange);
    return () => {
      controller.abort();
      window.removeEventListener("munetios:authchange", handleAuthChange);
      window.removeEventListener("munetios:profilechange", handleProfileChange);
    };
  }, [refreshSession]);

  useEffect(() => {
    if (sessionState !== "active") {
      setNotifications([]);
      return undefined;
    }
    let active = true;
    const refreshNotifications = async () => {
      try {
        const response = await fetch("/api/tasks/collaboration", {
          cache: "no-store",
          credentials: "include",
        });
        const payload = await response.json();
        if (active && response.ok) {
          setNotifications(payload.notifications || []);
        }
      } catch {
        // Notifications refresh again while the Tasks shell remains active.
      }
    };
    void refreshNotifications();
    const interval = window.setInterval(refreshNotifications, 3_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [sessionState]);

  useEffect(() => {
    if (!accountPanelOpen) return undefined;
    positionAccountPanel();
    const closeOnPointerDown = (event) => {
      if (
        accountPanelRef.current?.contains(event.target) ||
        accountTriggerRef.current?.contains(event.target) ||
        event.target.closest?.("[data-munetios-dropdown-portal='true']")
      ) {
        return;
      }
      setAccountPanelOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setAccountPanelOpen(false);
    };
    window.addEventListener("resize", positionAccountPanel);
    window.addEventListener("scroll", positionAccountPanel, true);
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", positionAccountPanel);
      window.removeEventListener("scroll", positionAccountPanel, true);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountPanelOpen, positionAccountPanel]);

  const openMobileSearch = () => {
    showModal(<SearchField copy={copy} mobile />, {
      ariaLabel: copy.tasksSearch,
      title: copy.tasksSearch,
    });
  };

  const openShortcuts = useCallback(
    () =>
      openKeyboardShortcutsModal({
        shortcuts: tasksKeyboardShortcuts,
        title: "Munetios Tasks keyboard shortcuts",
      }),
    [],
  );

  useEffect(() => {
    const routes = {
      a: "/apps/tasks/archived",
      c: "/apps/tasks/completed",
      d: "/apps/tasks/drafts",
      f: "/apps/tasks/favorites",
      g: "/apps/tasks/categories",
      i: "/apps/tasks/in-progress",
      s: "/apps/tasks/shared",
      t: "/apps/tasks/trash",
    };
    const handleShortcut = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "/") {
        event.preventDefault();
        openShortcuts();
      } else if (!event.shiftKey && key === "k") {
        event.preventDefault();
        window.dispatchEvent(new Event("munetios:tasksfocussearch"));
      } else if (!event.shiftKey && key === ",") {
        event.preventDefault();
        openTasksSettingsModal({ copy });
      } else if (event.shiftKey && key === "o") {
        event.preventDefault();
        if (window.location.pathname === "/apps/tasks") {
          window.dispatchEvent(new Event("munetios:taskscreate"));
        } else {
          window.location.assign("/apps/tasks#new");
        }
      } else if (event.shiftKey && routes[key]) {
        event.preventDefault();
        window.location.assign(routes[key]);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [copy, openShortcuts]);

  return (
    <>
      <div
        aria-hidden="true"
        className={`tasks-topbar-progress-shell ${sessionState === "loading" ? "is-active" : "is-complete"}`}
      >
        <div
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(loadingProgress)}
          className="tasks-topbar-progress-bar"
          role="progressbar"
          style={{ width: `${Math.max(loadingProgress, 8)}%` }}
        />
      </div>
      <header className="tasks-topbar">
        <div className="tasks-topbar-left">
          <TopbarIconButton
            aria-expanded={sidebarOpen}
            ariaLabel={copy.tasksOpenSidebar}
            className="tasks-menu-button liquid-glass"
            onClick={onSidebarToggle}
          >
            <icon>menu</icon>
          </TopbarIconButton>
          <Link
            aria-label={copy.tasksLogoAlt}
            className="tasks-floating-logo liquid-glass"
            href="/apps/tasks"
          >
            {/* biome-ignore lint/performance/noImgElement: this is the official deployed Munetios Tasks logo. */}
            <img
              alt={copy.tasksLogoAlt}
              height="46"
              src="https://tasks.munetios.com/apple-touch-icon.png"
              width="46"
            />
            <span className="hide-mobile-616">{copy.tasksAppName}</span>
          </Link>
        </div>

        <div className="tasks-search-container liquid-glass">
          <SearchField copy={copy} />
        </div>

        <AppTopbarRight className="tasks-topbar-right">
          <TopbarIconButton
            ariaLabel={copy.tasksSearch}
            className="tasks-mobile-search-button"
            onClick={openMobileSearch}
          >
            <icon>search</icon>
          </TopbarIconButton>
          <DropdownWrapper
            align="right"
            ariaLabel={copy.tasksNotifications}
            buttonClassName="tasks-topbar-icon-button"
            panelClassName="w-[min(22rem,calc(100vw-1rem))]"
            trigger={<icon>notifications</icon>}
            triggerAs="div"
            triggerGlass={false}
            zIndex={100000000}
          >
            <div className="p-3">
              <h2 className="font-bold">{copy.tasksNotifications}</h2>
              {notifications.length === 0
                ? <p className="mt-2 text-sm text-white/60">
                    {copy.tasksNoNotifications}
                  </p>
                : <div className="mt-2 grid gap-2">
                    {notifications.map((notification) => (
                      <button
                        className="flex w-full items-start gap-2 rounded-xl border border-white/8 bg-white/5! p-2 text-left text-sm text-white/80 transition hover:bg-white/10!"
                        key={notification.id}
                        onClick={async () => {
                          await dismissTaskNotification(notification.id);
                          setNotifications((current) =>
                            current.filter(
                              (item) => item.id !== notification.id,
                            ),
                          );
                        }}
                        type="button"
                      >
                        <icon className="mt-0.5 text-purple-200">
                          {notification.message === "task_updated"
                            ? "edit_note"
                            : "group_add"}
                        </icon>
                        <span>
                          {(notification.message === "task_updated"
                            ? copy.tasksNotificationUpdated
                            : copy.tasksNotificationShared
                          ).replace(
                            "{name}",
                            notification.ownerName || copy.tasksCollaborator,
                          )}
                        </span>
                      </button>
                    ))}
                  </div>}
            </div>
          </DropdownWrapper>
          <TopbarIconButton
            ariaLabel={copy.settings}
            onClick={() => openTasksSettingsModal({ copy })}
          >
            <icon>settings</icon>
          </TopbarIconButton>
          <DropdownWrapper
            align="right"
            ariaLabel={copy.tasksHelp}
            buttonClassName="tasks-topbar-icon-button hide-mobile-616"
            panelClassName="w-[min(18rem,calc(100vw-1rem))]"
            trigger={<icon>help</icon>}
            triggerAs="div"
            triggerGlass={false}
            zIndex={100000000}
          >
            <Link
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white transition hover:bg-white/10!"
              data-dropdown-close
              href="/help"
            >
              <icon>help_center</icon>
              <span>{copy.tasksHelp}</span>
            </Link>
            <button
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white transition hover:bg-white/10!"
              data-dropdown-close
              onClick={openShortcuts}
              type="button"
            >
              <icon>keyboard</icon>
              <span>Keyboard shortcuts</span>
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white transition hover:bg-white/10!"
              data-dropdown-close
              onClick={() => openFeedbackModal({ context: "tasks" })}
              type="button"
            >
              <icon>feedback</icon>
              <span>{copy.tasksFeedback}</span>
            </button>
          </DropdownWrapper>
          <TopbarIconButton
            aria-expanded={appLauncherOpen}
            ariaLabel={copy.openAppLauncher}
            className="hide-mobile-616"
            onClick={() => {
              setAccountPanelOpen(false);
              setAppLauncherOpen(true);
            }}
            ref={appLauncherTriggerRef}
          >
            <icon>apps</icon>
          </TopbarIconButton>
          {sessionState === "active"
            ? <TopbarIconButton
                aria-expanded={accountPanelOpen}
                ariaLabel={copy.openAccountMenu}
                className="tasks-account-button"
                onClick={() => {
                  positionAccountPanel();
                  setAppLauncherOpen(false);
                  setAccountPanelOpen((current) => !current);
                }}
                ref={accountTriggerRef}
              >
                <AccountAvatar
                  account={user}
                  alt={copy.accountProfileAlt}
                  className="h-10 w-10 rounded-full"
                />
              </TopbarIconButton>
            : sessionState === "inactive"
              ? <a
                  className="tasks-sign-in"
                  href="/signin"
                  title={copy.tasksSyncRequiresSignIn}
                >
                  {copy.signIn}
                </a>
              : <output
                  aria-label={copy.accountProfileLoading}
                  className="h-9 w-9 animate-pulse rounded-full bg-purple-200/20"
                />}
        </AppTopbarRight>
      </header>
      {mounted && sessionState === "active" && accountPanelOpen
        ? createPortal(
            <div
              className="fixed z-100000000"
              ref={accountPanelRef}
              style={{ right: "10px", top: `${panelTop}px` }}
            >
              <AccountWrapper
                appContext="tasks"
                legalLinksInNewTab
                persistentDropdowns
              />
            </div>,
            document.body,
          )
        : null}
      <AppLauncherWrapper
        copy={copy}
        onClose={() => setAppLauncherOpen(false)}
        open={appLauncherOpen}
        triggerRef={appLauncherTriggerRef}
      />
    </>
  );
}
