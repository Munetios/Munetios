"use client";

import Link from "next/link";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import AccountAvatar from "../../../components/accountAvatar";
import AccountWrapper from "../../../components/accountwraper";
import AppLauncherWrapper from "../../../components/appLauncherWrapper";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { openFeedbackModal } from "../../../components/feedbackModal";
import { openKeyboardShortcutsModal } from "../../../components/keyboardShortcutsModal";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { getCurrentLocale, t } from "../../../i18n";
import {
  dateTimePreferenceStorageKey,
  defaultDateTimePreferences,
  formatUserDate,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import {
  fetchCalendarShareInvitations,
  respondToCalendarShareInvitation,
} from "../lib/calendarCollaboration";
import { loadCalendarSettings } from "../lib/calendarSettings";
import { calendarSyncStatusEvent } from "../lib/calendarSync";

const syncBannerDismissedKey = "munetios.calendar.syncBannerDismissed";

const IconButton = forwardRef(function IconButton(
  { ariaLabel, children, className = "", title = ariaLabel, ...props },
  ref,
) {
  return (
    <button
      aria-label={ariaLabel}
      className={`calendar-icon-button ${className}`}
      ref={ref}
      title={title}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
});

function CalendarSearch({ copy, mobile = false }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (mobile) inputRef.current?.focus();
  }, [mobile]);

  const updateQuery = (value) => {
    setQuery(value);
    window.dispatchEvent(
      new CustomEvent("munetios:calendarsearch", { detail: value }),
    );
  };

  return (
    <search className={mobile ? "calendar-mobile-search" : "calendar-search"}>
      <icon className="calendar-search-icon">search</icon>
      <input
        aria-label={copy.search}
        autoComplete="off"
        onChange={(event) => updateQuery(event.target.value)}
        placeholder={copy.search}
        ref={inputRef}
        type="search"
        value={query}
      />
    </search>
  );
}

export default function CalendarTopbar() {
  const accountPanelRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const appLauncherTriggerRef = useRef(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [appLauncherOpen, setAppLauncherOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(true);
  const [copy, setCopy] = useState(() => t("en"));
  const [datePreferences, setDatePreferences] = useState(
    defaultDateTimePreferences,
  );
  const [displayedDate, setDisplayedDate] = useState(() => new Date());
  const [locale, setLocale] = useState("en");
  const [mounted, setMounted] = useState(false);
  const [panelTop, setPanelTop] = useState(72);
  const [shareInvitations, setShareInvitations] = useState([]);
  const [shareResponseId, setShareResponseId] = useState("");
  const [sessionState, setSessionState] = useState("loading");
  const [syncEncryption, setSyncEncryption] = useState("end_to_end");
  const [syncState, setSyncState] = useState({ reason: "", status: "loading" });
  const [user, setUser] = useState(null);

  const dateLabel = useMemo(
    () =>
      formatUserDate(displayedDate, {
        dateStyle: "medium",
        locale,
        preferences: datePreferences,
      }),
    [datePreferences, displayedDate, locale],
  );

  const positionAccountPanel = useCallback(() => {
    const trigger = accountTriggerRef.current;
    if (!trigger) return;
    setPanelTop(Math.max(10, trigger.getBoundingClientRect().bottom + 10));
  }, []);

  const refreshShareInvitations = useCallback(async () => {
    if (!hasSignedInCookie()) {
      setShareInvitations([]);
      return;
    }
    try {
      const invitations = await fetchCalendarShareInvitations();
      if (loadCalendarSettings().autoAcceptShares && invitations.length) {
        await Promise.all(
          invitations.map((invitation) =>
            respondToCalendarShareInvitation(invitation.id, true),
          ),
        );
        setShareInvitations([]);
        return;
      }
      setShareInvitations(invitations);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setSyncState({
          reason: String(error),
          status: "failed",
        });
      }
    }
  }, []);

  const refreshSession = useCallback(
    async (signal) => {
      const signedIn = hasSignedInCookie();
      setSessionState(signedIn ? "active" : "inactive");
      if (!signedIn) {
        setSyncState({ reason: "", status: "device" });
        setUser(null);
        setShareInvitations([]);
        setAccountPanelOpen(false);
        return;
      }

      try {
        setSyncState((current) =>
          current.status === "failed"
            ? current
            : { reason: "", status: "syncing" },
        );
        const [response, privacyResponse] = await Promise.all([
          fetch("/api/account", {
            cache: "no-store",
            credentials: "include",
            signal,
          }),
          fetch("/api/account/data-controls", {
            cache: "no-store",
            credentials: "include",
            signal,
          }),
        ]);
        if (response.ok) setUser(await response.json());
        if (privacyResponse.ok) {
          const payload = await privacyResponse.json();
          setSyncEncryption(
            payload.settings?.encryptionType === "encrypted_at_rest"
              ? "managed"
              : "end_to_end",
          );
        }
        await refreshShareInvitations();
      } catch (error) {
        if (error?.name !== "AbortError" && !hasSignedInCookie()) {
          setSessionState("inactive");
          setUser(null);
        }
      }
    },
    [refreshShareInvitations],
  );

  const respondToShare = useCallback(async (shareId, accepted) => {
    setShareResponseId(shareId);
    try {
      await respondToCalendarShareInvitation(shareId, accepted);
      setShareInvitations((current) =>
        current.filter((invitation) => invitation.id !== shareId),
      );
    } catch (error) {
      setSyncState({
        reason: String(error),
        status: "failed",
      });
      showToast({
        messageKey: "calendarShareInvitationActionFailed",
        toastId: "calendar-share-invitation-action-failed",
        type: "error",
      });
    } finally {
      setShareResponseId("");
    }
  }, []);

  const openShortcuts = useCallback(() => {
    openKeyboardShortcutsModal({
      shortcuts: [
        { keys: ["Ctrl", "K"], label: copy.search },
        { keys: ["T"], label: copy.meetToday },
        { keys: ["←"], label: copy.accountProfilePreviousMonth },
        { keys: ["→"], label: copy.accountProfileNextMonth },
        { keys: ["Ctrl", "/"], label: copy.meetKeyboardShortcuts },
      ],
      title: `${copy.landingAppCalendarName} — ${copy.meetKeyboardShortcuts}`,
    });
  }, [copy]);

  const openMobileSearch = useCallback(() => {
    showModal(<CalendarSearch copy={copy} mobile />, {
      ariaLabel: copy.search,
      title: copy.search,
      width: "min(34rem, calc(100vw - 1rem))",
    });
  }, [copy]);

  const navigateCalendarView = useCallback((offset) => {
    window.dispatchEvent(
      new CustomEvent("munetios:calendarviewnavigate", {
        detail: {
          direction: offset < 0 ? "previous" : "next",
          months: offset,
        },
      }),
    );
  }, []);

  const goToday = useCallback(() => {
    setDisplayedDate(new Date());
    window.dispatchEvent(new Event("munetios:calendartoday"));
  }, []);

  useEffect(() => {
    setMounted(true);
    setBannerDismissed(
      window.localStorage.getItem(syncBannerDismissedKey) === "true",
    );
    const controller = new AbortController();
    const refreshCopy = () => {
      setCopy(t());
      setLocale(getCurrentLocale());
    };
    const refreshDatePreferences = (event) => {
      setDatePreferences(event?.detail || loadDateTimePreferences());
    };
    const handleStorage = (event) => {
      if (event.key === dateTimePreferenceStorageKey) {
        refreshDatePreferences();
      }
    };
    const handleAuthChange = () => void refreshSession();
    const handleSyncStatus = (event) => {
      const detail = event.detail || {};
      setSyncState({
        reason: detail.reason || "",
        status: detail.status || "loading",
      });
      if (detail.encryptionType) setSyncEncryption(detail.encryptionType);
    };
    const handleProfileChange = (event) => {
      if (!event.detail) return;
      setUser((current) => ({
        ...(current || {}),
        avatar: event.detail.avatar,
        avatarUrl: event.detail.profilePictureUrl || null,
        profilePictureUrl: event.detail.profilePictureUrl || null,
      }));
    };

    refreshCopy();
    refreshDatePreferences();
    void refreshSession(controller.signal);
    window.addEventListener("munetios:authchange", handleAuthChange);
    window.addEventListener(calendarSyncStatusEvent, handleSyncStatus);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener(
      "munetios:language-time-change",
      refreshDatePreferences,
    );
    window.addEventListener("munetios:profilechange", handleProfileChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      controller.abort();
      window.removeEventListener("munetios:authchange", handleAuthChange);
      window.removeEventListener(calendarSyncStatusEvent, handleSyncStatus);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener(
        "munetios:language-time-change",
        refreshDatePreferences,
      );
      window.removeEventListener("munetios:profilechange", handleProfileChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshSession]);

  const syncLabel =
    syncState.status === "failed"
      ? copy.calendarSyncFailed
      : syncState.status === "device" || sessionState === "inactive"
        ? copy.calendarSavedToDevice
        : syncState.status === "synced"
          ? syncEncryption === "managed"
            ? copy.calendarSyncedEncryptedAtRest
            : copy.calendarSyncedEndToEnd
          : copy.calendarSyncing;
  const syncReason = syncState.reason ? String(syncState.reason) : "";
  const syncIcon =
    syncState.status === "failed"
      ? "cloud_off"
      : syncState.status === "device" || sessionState === "inactive"
        ? "save"
        : syncState.status === "synced"
          ? "cloud_done"
          : "sync";

  useEffect(() => {
    const syncDate = (event) => {
      const nextDate = new Date(event.detail);
      if (!Number.isNaN(nextDate.getTime())) setDisplayedDate(nextDate);
    };
    const syncMonth = (event) => {
      const nextDate = new Date(event.detail);
      if (!Number.isNaN(nextDate.getTime())) {
        setDisplayedDate((current) => {
          const lastDay = new Date(
            nextDate.getFullYear(),
            nextDate.getMonth() + 1,
            0,
          ).getDate();
          return new Date(
            nextDate.getFullYear(),
            nextDate.getMonth(),
            Math.min(current.getDate(), lastDay),
          );
        });
      }
    };
    window.addEventListener("munetios:calendardatechange", syncDate);
    window.addEventListener("munetios:calendarmonthchange", syncMonth);
    return () => {
      window.removeEventListener("munetios:calendardatechange", syncDate);
      window.removeEventListener("munetios:calendarmonthchange", syncMonth);
    };
  }, []);

  useEffect(() => {
    if (sessionState !== "active") return undefined;
    const refreshRemoteCalendar = () => {
      if (document.visibilityState !== "visible") return;
      window.dispatchEvent(new Event("munetios:calendarvaultchange"));
      void refreshShareInvitations();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshRemoteCalendar();
    };
    const interval = window.setInterval(refreshRemoteCalendar, 20_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshRemoteCalendar);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshRemoteCalendar);
    };
  }, [refreshShareInvitations, sessionState]);

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

  useEffect(() => {
    const handleShortcut = (event) => {
      const key = String(event?.key || "").toLowerCase();
      if (event.ctrlKey && !event.altKey && !event.metaKey && key === "k") {
        event.preventDefault();
        if (window.innerWidth < 1000) openMobileSearch();
        else document.querySelector(".calendar-search input")?.focus();
      } else if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        key === "/"
      ) {
        event.preventDefault();
        openShortcuts();
      } else if (
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        key === "t"
      ) {
        goToday();
      } else if (
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key === "ArrowLeft"
      ) {
        navigateCalendarView(-1);
      } else if (
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key === "ArrowRight"
      ) {
        navigateCalendarView(1);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [goToday, navigateCalendarView, openMobileSearch, openShortcuts]);

  return (
    <>
      <style>{`
        .calendar-sync-button { position: relative; }
        .calendar-sync-invitation-badge {
          position: absolute;
          top: 0.15rem;
          inset-inline-end: 0.15rem;
          min-width: 0.95rem;
          height: 0.95rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 2px solid color-mix(in srgb, var(--app-background) 88%, transparent);
          border-radius: 999px;
          padding-inline: 0.18rem;
          color: white;
          background: #9333ea;
          font-size: 0.58rem;
          font-weight: 800;
        }
        .calendar-share-invitations {
          display: grid;
          gap: 0.45rem;
          border-top: 1px solid color-mix(in srgb, var(--foreground) 12%, transparent);
          padding: 0.65rem 0.35rem 0.25rem;
        }
        .calendar-share-invitations h3 {
          margin: 0 0 0.15rem;
          font-size: 0.78rem;
        }
        .calendar-share-invitations article {
          display: grid;
          gap: 0.55rem;
          border-radius: 0.75rem;
          padding: 0.65rem;
          background: color-mix(in srgb, #9333ea 11%, transparent);
        }
        .calendar-share-invitations article strong { font-size: 0.8rem; }
        .calendar-share-invitations article p {
          margin: 0.2rem 0 0;
          color: color-mix(in srgb, var(--foreground) 70%, transparent);
          font-size: 0.75rem;
          line-height: 1.35;
        }
        .calendar-share-invitations article > span {
          display: flex;
          justify-content: flex-end;
          gap: 0.4rem;
        }
        .calendar-share-invitations button {
          min-height: 2rem;
          cursor: pointer;
          border: 0;
          border-radius: 0.6rem;
          padding: 0.35rem 0.65rem;
          color: var(--foreground);
          background: color-mix(in srgb, var(--foreground) 9%, transparent);
          font: inherit;
          font-size: 0.72rem;
          font-weight: 720;
        }
        .calendar-share-invitations button:last-child {
          color: white;
          background: #7e22ce;
        }
        .calendar-share-invitations button:disabled {
          cursor: wait;
          opacity: 0.55;
        }
      `}</style>
      <header className="calendar-topbar">
        <div className="calendar-topbar-left">
          <IconButton
            ariaLabel={copy.dropdownToggle}
            className="calendar-menu-button liquid-glass"
            onClick={() =>
              window.dispatchEvent(new Event("munetios:calendarmenu"))
            }
          >
            <icon>menu</icon>
          </IconButton>
          <div className="calendar-date-surface liquid-glass">
            <strong className="calendar-date" title={dateLabel}>
              {dateLabel}
            </strong>
          </div>
          <span className="calendar-date-arrows liquid-glass">
            <IconButton
              ariaLabel={copy.accountProfilePreviousMonth}
              onClick={() => navigateCalendarView(-1)}
            >
              <icon>chevron_left</icon>
            </IconButton>
            <IconButton
              ariaLabel={copy.accountProfileNextMonth}
              onClick={() => navigateCalendarView(1)}
            >
              <icon>chevron_right</icon>
            </IconButton>
          </span>
          <button
            className="calendar-today-button liquid-glass"
            onClick={goToday}
            type="button"
          >
            {copy.meetToday}
          </button>
        </div>

        <div className="calendar-search-shell liquid-glass">
          <CalendarSearch copy={copy} />
        </div>

        <div className="calendar-topbar-right liquid-glass">
          <DropdownWrapper
            align="right"
            ariaLabel={
              shareInvitations.length
                ? `${syncLabel}. ${shareInvitations.length} ${copy.calendarShareInvitations}`
                : syncLabel
            }
            buttonClassName="calendar-icon-button calendar-sync-button"
            panelClassName="calendar-sync-panel"
            trigger={
              <>
                <icon>{syncIcon}</icon>
                {shareInvitations.length
                  ? <span className="calendar-sync-invitation-badge">
                      {shareInvitations.length > 9
                        ? "9+"
                        : shareInvitations.length}
                    </span>
                  : null}
              </>
            }
            triggerAs="button"
            triggerGlass={false}
          >
            <div className="calendar-sync-status">
              <icon>{syncIcon}</icon>
              <div>
                <strong>{syncLabel}</strong>
                {syncState.status === "failed" && syncReason
                  ? <p>{syncReason}</p>
                  : null}
              </div>
            </div>
            {shareInvitations.length
              ? <section className="calendar-share-invitations">
                  <h3>{copy.calendarShareInvitations}</h3>
                  {shareInvitations.map((invitation) => (
                    <article key={invitation.id}>
                      <div>
                        <strong>{invitation.ownerName}</strong>
                        <p>
                          {copy.calendarShareInvitation
                            .replace("{name}", invitation.ownerName)
                            .replace(
                              "{type}",
                              invitation.itemType === "calendar"
                                ? copy.calendarShareInvitationCalendar
                                : copy.calendarShareInvitationEvent,
                            )}
                        </p>
                      </div>
                      <span>
                        <button
                          disabled={shareResponseId === invitation.id}
                          onClick={() =>
                            void respondToShare(invitation.id, false)
                          }
                          type="button"
                        >
                          {copy.calendarDeclineShare}
                        </button>
                        <button
                          disabled={shareResponseId === invitation.id}
                          onClick={() =>
                            void respondToShare(invitation.id, true)
                          }
                          type="button"
                        >
                          {copy.calendarAcceptShare}
                        </button>
                      </span>
                    </article>
                  ))}
                </section>
              : null}
          </DropdownWrapper>
          <IconButton
            ariaLabel={copy.search}
            className="calendar-mobile-search-button"
            onClick={openMobileSearch}
          >
            <icon>search</icon>
          </IconButton>
          <IconButton
            ariaLabel={copy.tasksFavorites}
            onClick={() =>
              window.dispatchEvent(new Event("munetios:calendarfavorites"))
            }
          >
            <icon>star</icon>
          </IconButton>
          <IconButton
            ariaLabel={copy.calendarEvents}
            onClick={() =>
              window.dispatchEvent(new Event("munetios:calendarevents"))
            }
          >
            <icon>event</icon>
            <span className="calendar-action-label">{copy.calendarEvents}</span>
          </IconButton>
          <DropdownWrapper
            align="right"
            ariaLabel={copy.tasksHelp}
            buttonClassName="calendar-icon-button"
            className="calendar-help-control"
            panelClassName="w-[min(18rem,calc(100vw-1rem))]"
            trigger={<icon>help</icon>}
            triggerAs="div"
            triggerGlass={false}
          >
            <Link
              className="calendar-help-item"
              data-dropdown-close
              href="/help"
              rel="noopener noreferrer"
              target="_blank"
            >
              <icon>help_center</icon>
              <span>{copy.notesHelpCenter}</span>
            </Link>
            <button
              className="calendar-help-item"
              data-dropdown-close
              onClick={() => openFeedbackModal({ context: "calendar" })}
              type="button"
            >
              <icon>feedback</icon>
              <span>{copy.tasksFeedback}</span>
            </button>
            <button
              className="calendar-help-item"
              data-dropdown-close
              onClick={openShortcuts}
              type="button"
            >
              <icon>keyboard</icon>
              <span>{copy.meetKeyboardShortcuts}</span>
            </button>
          </DropdownWrapper>
          <IconButton
            ariaLabel={copy.settings}
            className="calendar-settings-button"
            onClick={() =>
              window.dispatchEvent(new Event("munetios:calendarsettings"))
            }
          >
            <icon>settings</icon>
          </IconButton>
          <IconButton
            aria-expanded={appLauncherOpen}
            ariaLabel={copy.openAppLauncher}
            className="calendar-apps-button"
            onClick={() => {
              setAccountPanelOpen(false);
              setAppLauncherOpen(true);
            }}
            ref={appLauncherTriggerRef}
          >
            <icon>apps</icon>
          </IconButton>
          {sessionState === "active"
            ? <IconButton
                aria-expanded={accountPanelOpen}
                ariaLabel={copy.openAccountMenu}
                className="calendar-account-button"
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
                  className="calendar-account-avatar"
                />
              </IconButton>
            : sessionState === "inactive"
              ? <a className="calendar-sign-in liquid-glass" href="/signin">
                  {copy.signIn}
                </a>
              : <output
                  aria-label={copy.accountProfileLoading}
                  className="calendar-account-loading"
                />}
        </div>
      </header>

      {mounted && sessionState === "inactive" && !bannerDismissed
        ? <output className="calendar-sync-banner liquid-glass">
            <icon>cloud_upload</icon>
            <span>{copy.calendarSignInToSyncBanner}</span>
            <a href="/signin">{copy.signIn}</a>
            <button
              aria-label={copy.calendarDismissSyncBanner}
              onClick={() => {
                window.localStorage.setItem(syncBannerDismissedKey, "true");
                setBannerDismissed(true);
              }}
              type="button"
            >
              <icon>close</icon>
            </button>
          </output>
        : null}

      {mounted && sessionState === "active" && accountPanelOpen
        ? createPortal(
            <div
              className="fixed z-100000000"
              ref={accountPanelRef}
              style={{ right: "10px", top: `${panelTop}px` }}
            >
              <AccountWrapper appContext="calendar" persistentDropdowns />
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
