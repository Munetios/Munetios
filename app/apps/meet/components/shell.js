"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AccountAvatar from "../../../components/accountAvatar";
import AccountWrapper from "../../../components/accountwraper";
import AppLauncherWrapper from "../../../components/appLauncherWrapper";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { openFeedbackModal } from "../../../components/feedbackModal";
import { openKeyboardShortcutsModal } from "../../../components/keyboardShortcutsModal";
import LoadingSpinner from "../../../components/loadingSpinner";
import { t } from "../../../i18n";
import {
  formatUserDateTime,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import MeetHome from "./home";
import MeetingRoom from "./meetingRoom";
import { prepareMeetAudio } from "./meetSounds";
import { openMeetSettingsModal } from "./settingsModal";

const meetKeyboardShortcuts = [
  { keys: ["Ctrl", "/"], label: "Keyboard shortcuts" },
];
const activeMeetingStorageKey = "munetios.meet.activeMeeting";
const meetingSecretsStorageKey = "munetios.meet.secrets";

function readSessionJson(key, fallback) {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

function getStoredMeetingSecret(roomId) {
  const secrets = readSessionJson(meetingSecretsStorageKey, {});
  return typeof secrets[roomId] === "string" ? secrets[roomId] : "";
}

function TopbarButton({ children, label, translationKey, ...props }) {
  return (
    <button
      aria-label={label}
      className="meet-topbar-button"
      data-tooltip-translate={translationKey}
      data-translate-aria-label={translationKey}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function MeetHistory({ copy, onRejoin }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dateTimePreferences, setDateTimePreferences] = useState(
    loadDateTimePreferences,
  );

  useEffect(() => {
    const refreshPreferences = () =>
      setDateTimePreferences(loadDateTimePreferences());
    window.addEventListener(
      "munetios:language-time-change",
      refreshPreferences,
    );
    fetch("/api/meet/history", { cache: "no-store", credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("history_request_failed");
        return response.json();
      })
      .then((payload) => {
        if (payload?.authenticated) {
          setHistory(payload.history || []);
          return;
        }
        try {
          setHistory(
            JSON.parse(
              window.localStorage.getItem("munetios.meet.history") || "[]",
            ),
          );
        } catch {
          setHistory([]);
        }
      })
      .catch(() => {
        setHistory([]);
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
    return () =>
      window.removeEventListener(
        "munetios:language-time-change",
        refreshPreferences,
      );
  }, []);

  const formatJoinedAt = (value) => {
    const preferredDateTime = formatUserDateTime(value, {
      preferences: dateTimePreferences,
    });
    if (preferredDateTime) return preferredDateTime;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(
      document.documentElement.lang || navigator.language,
      { dateStyle: "medium", timeStyle: "short" },
    ).format(date);
  };
  const formatDuration = (seconds) => {
    const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
    return copy.meetDurationMinutes.replace("{count}", String(minutes));
  };

  return (
    <section className="meet-history-page">
      <a className="meet-history-back liquid-glass" href="/apps/meet">
        <icon>arrow_back</icon>
        <span>{copy.meetBack}</span>
      </a>
      <div className="meet-history-heading">
        <p>{copy.meetAppName}</p>
        <h1>{copy.meetHistory}</h1>
      </div>
      {loading
        ? <div className="meet-history-empty liquid-glass">
            <LoadingSpinner label={copy.accountProcessing} />
          </div>
        : loadFailed
          ? <div className="meet-history-empty liquid-glass" role="alert">
              <icon className="meet-history-empty-icon">error</icon>
              <h2>{copy.meetHistoryLoadFailed}</h2>
            </div>
          : history.length
            ? <div className="meet-history-list">
                {history.map((entry) => (
                  <article className="liquid-glass" key={entry.id}>
                    <span className="meet-history-icon">
                      <icon>videocam</icon>
                    </span>
                    <div>
                      <h2>{entry.title || copy.meetJoinedMeeting}</h2>
                      <p>
                        {formatJoinedAt(entry.joinedAt)} ·{" "}
                        {formatDuration(entry.durationSeconds)}
                      </p>
                    </div>
                    <button
                      className="meet-history-rejoin"
                      onClick={() => onRejoin(entry)}
                      type="button"
                    >
                      <icon>replay</icon>
                      {copy.meetRejoin}
                    </button>
                  </article>
                ))}
              </div>
            : <div className="meet-history-empty liquid-glass">
                <icon className="meet-history-empty-icon">history</icon>
                <h2>{copy.meetNoHistory}</h2>
                <p>{copy.meetNoHistoryDescription}</p>
              </div>}
    </section>
  );
}

export default function MeetShell({ view = "home" }) {
  const [copy, setCopy] = useState(() => t());
  const [accountOpen, setAccountOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [meetingRequest, setMeetingRequest] = useState(null);
  const [sessionState, setSessionState] = useState(() =>
    hasSignedInCookie() ? "active" : "loading",
  );
  const [user, setUser] = useState(null);
  const accountRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const appsTriggerRef = useRef(null);

  const refreshSession = useCallback(async (signal) => {
    const cookieSignedIn = hasSignedInCookie();
    if (cookieSignedIn) {
      setSessionState("active");
      return;
    }
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
      if (!signedIn) setAccountOpen(false);
    } catch (error) {
      if (error?.name !== "AbortError" && !hasSignedInCookie()) {
        setSessionState("inactive");
        setUser(null);
      }
    }
  }, []);

  const openShortcuts = useCallback(() => {
    openKeyboardShortcutsModal({
      shortcuts: meetKeyboardShortcuts.map((shortcut) => ({
        ...shortcut,
        label: copy.meetKeyboardShortcuts,
      })),
      title: copy.meetKeyboardShortcutsTitle,
    });
  }, [copy]);

  const rejoinMeeting = useCallback(
    (entry) => {
      const roomId = String(entry?.meetingId || "").trim();
      if (!roomId) return;
      const nickname =
        window.sessionStorage.getItem("munetios.meet.guestNickname") || "";
      const needsGuestNickname = sessionState !== "active";
      if (needsGuestNickname && !nickname.trim()) {
        window.location.assign(
          `/apps/meet?room=${encodeURIComponent(roomId)}&rejoin=1`,
        );
        return;
      }
      prepareMeetAudio();
      setMeetingRequest({
        action: "rejoin",
        e2eeKey: getStoredMeetingSecret(roomId),
        nickname: needsGuestNickname ? nickname.trim() : "",
        roomId,
      });
    },
    [sessionState],
  );

  useEffect(() => {
    setMounted(true);
    const controller = new AbortController();
    void refreshSession(controller.signal);
    const refreshCopy = () => setCopy(t());
    const refreshAccount = () => void refreshSession();
    refreshCopy();
    window.addEventListener("languagechange", refreshCopy);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener("munetios:authchange", refreshAccount);
    return () => {
      controller.abort();
      window.removeEventListener("languagechange", refreshCopy);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener("munetios:authchange", refreshAccount);
    };
  }, [refreshSession]);

  useEffect(() => {
    if (sessionState === "loading" || meetingRequest) return;
    const storedMeeting = readSessionJson(activeMeetingStorageKey, null);
    if (
      !storedMeeting?.roomId ||
      !["join", "rejoin"].includes(storedMeeting.action)
    ) {
      return;
    }
    prepareMeetAudio();
    setMeetingRequest({
      action: "join",
      e2eeKey:
        storedMeeting.e2eeKey || getStoredMeetingSecret(storedMeeting.roomId),
      nickname:
        sessionState === "active" ? "" : String(storedMeeting.nickname || ""),
      peerId: String(storedMeeting.peerId || ""),
      peerToken: String(storedMeeting.peerToken || ""),
      roomId: String(storedMeeting.roomId),
    });
  }, [meetingRequest, sessionState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key === "/"
      ) {
        event.preventDefault();
        openShortcuts();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openShortcuts]);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const close = (event) => {
      if (
        accountRef.current?.contains(event.target) ||
        accountTriggerRef.current?.contains(event.target) ||
        event.target.closest?.("[data-munetios-dropdown-portal='true']")
      ) {
        return;
      }
      setAccountOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  return (
    <main className="meet-shell">
      {!meetingRequest
        ? <header className="meet-topbar">
            <div className="meet-topbar-left">
              <Link
                aria-label={copy.meetLogoAlt}
                className="meet-brand liquid-glass"
                data-tooltip-translate="meetLogoAlt"
                data-translate-aria-label="meetLogoAlt"
                href="/apps/meet"
              >
                <Image alt="" height={46} priority src="/meet.png" width={46} />
                <span>{copy.meetAppName}</span>
              </Link>
            </div>

            <nav
              aria-label={copy.meetNavigation}
              className="meet-topbar-actions liquid-glass"
            >
              <Link
                aria-label={copy.meetHistory}
                className="meet-topbar-button"
                data-tooltip-translate="meetHistory"
                data-translate-aria-label="meetHistory"
                href="/apps/meet/history"
              >
                <icon>history</icon>
              </Link>
              <TopbarButton
                label={copy.settings}
                onClick={() =>
                  openMeetSettingsModal({
                    copy,
                    signedIn: sessionState === "active",
                  })
                }
                translationKey="settings"
              >
                <icon>settings</icon>
              </TopbarButton>
              <DropdownWrapper
                ariaLabel={copy.meetHelp}
                buttonClassName="meet-dropdown-trigger"
                panelClassName="w-[min(19rem,calc(100vw-1rem))]"
                trigger={<icon>help</icon>}
                triggerGlass={false}
                translationKey="meetHelp"
                zIndex={100000000}
              >
                <Link
                  className="meet-menu-item"
                  data-dropdown-close
                  href="/help"
                  role="menuitem"
                >
                  <icon>help_center</icon>
                  <span>{copy.meetHelp}</span>
                </Link>
                <button
                  className="meet-menu-item"
                  data-dropdown-close
                  onClick={() => openFeedbackModal({ context: "meet" })}
                  role="menuitem"
                  type="button"
                >
                  <icon>feedback</icon>
                  <span>{copy.meetSendFeedback}</span>
                </button>
                <button
                  className="meet-menu-item"
                  data-dropdown-close
                  onClick={openShortcuts}
                  role="menuitem"
                  type="button"
                >
                  <icon>keyboard</icon>
                  <span>{copy.meetKeyboardShortcuts}</span>
                </button>
              </DropdownWrapper>
              <TopbarButton
                aria-expanded={appsOpen}
                label={copy.openAppLauncher}
                onClick={() => {
                  setAccountOpen(false);
                  setAppsOpen((current) => !current);
                }}
                ref={appsTriggerRef}
                translationKey="openAppLauncher"
              >
                <icon>apps</icon>
              </TopbarButton>
              {sessionState === "active"
                ? <TopbarButton
                    aria-expanded={accountOpen}
                    label={copy.openAccountMenu}
                    onClick={() => {
                      setAppsOpen(false);
                      setAccountOpen((current) => !current);
                    }}
                    ref={accountTriggerRef}
                    translationKey="openAccountMenu"
                  >
                    <AccountAvatar
                      account={user || { name: "Munetios" }}
                      alt={copy.accountProfileAlt}
                      className="h-8 w-8 rounded-full"
                    />
                  </TopbarButton>
                : sessionState === "inactive"
                  ? <TopbarButton
                      label={copy.signIn}
                      onClick={() => window.location.assign("/signin")}
                      translationKey="signIn"
                    >
                      <icon>account_circle</icon>
                    </TopbarButton>
                  : <output
                      aria-label={copy.accountProfileLoading}
                      className="meet-profile-loading"
                    />}
            </nav>
          </header>
        : null}

      {meetingRequest
        ? <MeetingRoom
            copy={copy}
            onLeave={() => {
              window.sessionStorage.removeItem(activeMeetingStorageKey);
              window.history.replaceState(null, "", "/apps/meet");
              setMeetingRequest(null);
            }}
            request={meetingRequest}
            signedIn={sessionState === "active"}
          />
        : view === "history"
          ? <MeetHistory copy={copy} onRejoin={rejoinMeeting} />
          : <MeetHome
              copy={copy}
              onStartMeeting={(nextRequest) => {
                if (nextRequest.roomId) {
                  window.sessionStorage.setItem(
                    activeMeetingStorageKey,
                    JSON.stringify(nextRequest),
                  );
                }
                setMeetingRequest(nextRequest);
              }}
              sessionState={sessionState}
            />}

      <AppLauncherWrapper
        copy={copy}
        onClose={() => setAppsOpen(false)}
        open={appsOpen}
        panelId="meetAppsPanel"
        triggerRef={appsTriggerRef}
      />
      {mounted && sessionState === "active" && accountOpen
        ? createPortal(
            <div className="meet-account-panel" ref={accountRef}>
              <AccountWrapper
                appContext
                legalLinksInNewTab
                persistentDropdowns
              />
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}
