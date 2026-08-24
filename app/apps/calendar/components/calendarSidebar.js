"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomToggle from "../../../components/customToggle";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { getCurrentLocale, t } from "../../../i18n";
import {
  dateTimePreferenceStorageKey,
  defaultDateTimePreferences,
  formatUserTime,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import {
  removeReceivedCalendarShares,
  shareEncryptedCalendarItem,
} from "../lib/calendarCollaboration";
import {
  calendarSettingsChangeEvent,
  loadCalendarSettings,
} from "../lib/calendarSettings";
import { calendarOperation } from "../lib/calendarSync";
import {
  loadEncryptedCalendarData,
  saveEncryptedCalendarData,
} from "../lib/encryptedCalendarVault";

const DEFAULT_CALENDAR = Object.freeze({
  color: "#a855f7",
  events: [],
  favoriteDates: [],
  id: "primary",
  name: "",
  workspaceId: "personal",
});

const CALENDAR_COLORS = [
  "#a855f7",
  "#7c3aed",
  "#2563eb",
  "#0891b2",
  "#059669",
  "#d97706",
  "#e11d48",
];

function getActiveWorkspaceId() {
  return window.localStorage.getItem("munetiosActiveWorkspace") || "personal";
}

function createWorkspaceCalendar(workspaceId, name = "") {
  const now = new Date().toISOString();
  return {
    ...DEFAULT_CALENDAR,
    createdAt: now,
    id: workspaceId === "personal" ? "primary" : `primary-${workspaceId}`,
    name,
    updatedAt: now,
    workspaceId,
  };
}

function getMonthGrid(monthDate, weekStarts) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const leadingDays = (firstDay.getDay() - weekStarts + 7) % 7;
  const gridStart = new Date(year, month, 1 - leadingDays);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

function isSameDay(first, second) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function AddCalendarForm({ close, copy, onCreate }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || saving) return;
    setSaving(true);
    try {
      await onCreate(normalizedName);
      close();
    } catch {
      setSaving(false);
    }
  };

  return (
    <form className="calendar-add-calendar-form" onSubmit={submit}>
      <label htmlFor="calendar-name-input">{copy.calendarName}</label>
      <input
        autoComplete="off"
        id="calendar-name-input"
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        placeholder={copy.calendarNamePlaceholder}
        ref={inputRef}
        required
        type="text"
        value={name}
      />
      <div className="calendar-modal-actions">
        <button disabled={saving} onClick={close} type="button">
          {copy.cancel}
        </button>
        <button disabled={!name.trim() || saving} type="submit">
          {copy.calendarDone}
        </button>
      </div>
    </form>
  );
}

function ShareCalendarForm({ calendar, close, copy }) {
  const [error, setError] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sharing, setSharing] = useState(false);
  return (
    <form
      className="calendar-add-calendar-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!recipient.trim() || sharing) return;
        setError("");
        setSharing(true);
        try {
          await calendarOperation("share/invite", { method: "POST" });
          await shareEncryptedCalendarItem({
            email: recipient.trim(),
            item: calendar,
            itemType: "calendar",
          });
          close();
        } catch {
          showToast({
            messageKey: "calendarShareInviteFailed",
            toastId: "calendar-share-calendar-failed",
            type: "error",
          });
          setError(copy.calendarShareInviteFailed);
          setSharing(false);
        }
      }}
    >
      <label htmlFor={`calendar-share-${calendar.id}`}>
        {copy.calendarShareWith}
      </label>
      <input
        autoComplete="email"
        id={`calendar-share-${calendar.id}`}
        onChange={(event) => setRecipient(event.target.value)}
        placeholder={copy.familyMemberEmail}
        required
        type="text"
        value={recipient}
      />
      {error
        ? <p className="calendar-form-error" role="alert">
            {error}
          </p>
        : null}
      <div className="calendar-modal-actions">
        <button disabled={sharing} onClick={close} type="button">
          {copy.cancel}
        </button>
        <button disabled={!recipient.trim() || sharing} type="submit">
          {sharing ? `${copy.loading}...` : copy.tasksSendShare}
        </button>
      </div>
    </form>
  );
}

function DeleteCalendarConfirmation({ calendar, close, copy, onDelete }) {
  const [deleting, setDeleting] = useState(false);
  const name = calendar.name || copy.calendarPrimaryCalendar;
  return (
    <div className="calendar-delete-confirmation">
      <p>{copy.calendarDeleteCalendarWarning.replace("{name}", name)}</p>
      <div className="calendar-modal-actions">
        <button disabled={deleting} onClick={close} type="button">
          {copy.cancel}
        </button>
        <button
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            try {
              await onDelete(calendar);
              close();
            } catch {
              setDeleting(false);
            }
          }}
          type="button"
        >
          {deleting ? `${copy.loading}...` : copy.delete}
        </button>
      </div>
    </div>
  );
}

export default function CalendarSidebar() {
  const [activeCalendarId, setActiveCalendarId] = useState("primary");
  const [calendars, setCalendars] = useState([{ ...DEFAULT_CALENDAR }]);
  const [copy, setCopy] = useState(() => t("en"));
  const [datePreferences, setDatePreferences] = useState(
    defaultDateTimePreferences,
  );
  const [displayedMonth, setDisplayedMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [locale, setLocale] = useState("en");
  const [open, setOpen] = useState(false);
  const [otherCalendarsOpen, setOtherCalendarsOpen] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showHolidays, setShowHolidays] = useState(true);
  const [workspaceId, setWorkspaceId] = useState("personal");
  const [worldClocks, setWorldClocks] = useState([]);
  const [clockNow, setClockNow] = useState(null);

  useEffect(() => {
    const refreshClocks = (event) =>
      setWorldClocks(
        (event?.detail || loadCalendarSettings()).worldClocks || [],
      );
    refreshClocks();
    setClockNow(new Date());
    const interval = window.setInterval(() => setClockNow(new Date()), 30_000);
    window.addEventListener(calendarSettingsChangeEvent, refreshClocks);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(calendarSettingsChangeEvent, refreshClocks);
    };
  }, []);
  const visibleCalendars = useMemo(
    () => calendars.filter((calendar) => calendar.workspaceId === workspaceId),
    [calendars, workspaceId],
  );

  const weekStarts = datePreferences.weekStarts === "monday" ? 1 : 0;
  const monthDays = useMemo(
    () => getMonthGrid(displayedMonth, weekStarts),
    [displayedMonth, weekStarts],
  );
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
      }).format(displayedMonth),
    [displayedMonth, locale],
  );
  const weekdayLabels = useMemo(() => {
    const sunday = new Date(2024, 0, 7);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + ((index + weekStarts) % 7));
      return {
        id: (index + weekStarts) % 7,
        label: new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(
          date,
        ),
      };
    });
  }, [locale, weekStarts]);

  const publishFilters = useCallback(
    (activeId, holidays, activeWorkspaceId) => {
      window.dispatchEvent(
        new CustomEvent("munetios:calendarfilterschange", {
          detail: {
            activeCalendarId: activeId,
            calendarIds: [activeId],
            showHolidays: holidays,
            workspaceId: activeWorkspaceId,
          },
        }),
      );
    },
    [],
  );

  const persistData = useCallback(
    async (nextCalendars, nextActiveId, nextShowHolidays) => {
      publishFilters(nextActiveId, nextShowHolidays, workspaceId);
      const saved = await saveEncryptedCalendarData(
        {
          activeCalendarId: nextActiveId,
          calendars: nextCalendars,
          showHolidays: nextShowHolidays,
        },
        hasSignedInCookie(),
      );
      window.dispatchEvent(new Event("munetios:calendarvaultchange"));
      return saved;
    },
    [publishFilters, workspaceId],
  );

  const chooseDate = useCallback((date) => {
    const nextDate = new Date(date);
    setSelectedDate(nextDate);
    setDisplayedMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    window.dispatchEvent(
      new CustomEvent("munetios:calendardatechange", {
        detail: nextDate.toISOString(),
      }),
    );
  }, []);

  const moveMonth = useCallback(
    (offset) => {
      const nextMonth = new Date(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth() + offset,
        1,
      );
      setDisplayedMonth(nextMonth);
    },
    [displayedMonth],
  );

  useEffect(() => {
    let cancelled = false;
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
    const toggleSidebar = () => setOpen((current) => !current);
    const sidebarMedia = window.matchMedia("(min-width: 1150px)");
    const syncSidebarForViewport = (event) => setOpen(event.matches);
    const goToday = () => chooseDate(new Date());
    const syncDate = (event) => {
      const nextDate = new Date(event.detail);
      if (!Number.isNaN(nextDate.getTime())) {
        setSelectedDate(nextDate);
        setDisplayedMonth(
          new Date(nextDate.getFullYear(), nextDate.getMonth(), 1),
        );
      }
    };
    const syncMonth = (event) => {
      const nextDate = new Date(event.detail);
      if (!Number.isNaN(nextDate.getTime())) {
        setDisplayedMonth(
          new Date(nextDate.getFullYear(), nextDate.getMonth(), 1),
        );
      }
    };

    refreshCopy();
    refreshDatePreferences();
    setOpen(sidebarMedia.matches);
    const loadVaultData = async () => {
      const nextWorkspaceId = getActiveWorkspaceId();
      const signedIn = hasSignedInCookie();
      const data = await loadEncryptedCalendarData(signedIn, {
        sharedCalendarName: t().calendarSharedCalendar,
        workspaceId: nextWorkspaceId,
      });
      if (signedIn) {
        try {
          await calendarOperation("load/calendars");
          if (data.syncError) throw new Error(data.syncError);
        } catch {
          showToast({
            messageKey: "calendarLoadCalendarsFailed",
            toastId: "calendar-load-calendars-failed",
            type: "error",
          });
        }
      }
      if (cancelled) return;
      let nextCalendars = data.calendars;
      let workspaceCalendars = nextCalendars.filter(
        (calendar) => calendar.workspaceId === nextWorkspaceId,
      );
      if (!workspaceCalendars.length) {
        const workspaceCalendar = createWorkspaceCalendar(nextWorkspaceId);
        nextCalendars = [...nextCalendars, workspaceCalendar];
        workspaceCalendars = [workspaceCalendar];
        await saveEncryptedCalendarData(
          {
            ...data,
            activeCalendarId: workspaceCalendar.id,
            calendars: nextCalendars,
          },
          hasSignedInCookie(),
        );
      }
      const nextActiveId = workspaceCalendars.some(
        (calendar) => calendar.id === data.activeCalendarId,
      )
        ? data.activeCalendarId
        : workspaceCalendars[0].id;
      setWorkspaceId(nextWorkspaceId);
      setActiveCalendarId(nextActiveId);
      setCalendars(nextCalendars);
      setShowHolidays(data.showHolidays);
      publishFilters(nextActiveId, data.showHolidays, nextWorkspaceId);
    };
    void loadVaultData();

    window.addEventListener("munetios:calendarmenu", toggleSidebar);
    window.addEventListener("munetios:calendartoday", goToday);
    window.addEventListener("munetios:calendardatechange", syncDate);
    window.addEventListener("munetios:calendarmonthchange", syncMonth);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener(
      "munetios:language-time-change",
      refreshDatePreferences,
    );
    window.addEventListener("storage", handleStorage);
    window.addEventListener("munetios:authchange", loadVaultData);
    window.addEventListener("munetios:calendarvaultchange", loadVaultData);
    window.addEventListener("munetios:workspacechange", loadVaultData);
    sidebarMedia.addEventListener("change", syncSidebarForViewport);
    return () => {
      cancelled = true;
      window.removeEventListener("munetios:calendarmenu", toggleSidebar);
      window.removeEventListener("munetios:calendartoday", goToday);
      window.removeEventListener("munetios:calendardatechange", syncDate);
      window.removeEventListener("munetios:calendarmonthchange", syncMonth);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener(
        "munetios:language-time-change",
        refreshDatePreferences,
      );
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("munetios:authchange", loadVaultData);
      window.removeEventListener("munetios:calendarvaultchange", loadVaultData);
      window.removeEventListener("munetios:workspacechange", loadVaultData);
      sidebarMedia.removeEventListener("change", syncSidebarForViewport);
    };
  }, [chooseDate, publishFilters]);

  const selectCalendar = (calendarId) => {
    setActiveCalendarId(calendarId);
    void calendarOperation("update/calendar", { method: "POST" })
      .then(() => persistData(calendars, calendarId, showHolidays))
      .catch(() =>
        showToast({
          messageKey: "calendarUpdateCalendarsFailed",
          toastId: "calendar-select-calendar-sync-failed",
          type: "error",
        }),
      );
  };

  const toggleHolidays = () => {
    const next = !showHolidays;
    setShowHolidays(next);
    void calendarOperation("update/calendar", { method: "POST" })
      .then(() => persistData(calendars, activeCalendarId, next))
      .catch(() =>
        showToast({
          messageKey: "calendarUpdateCalendarsFailed",
          toastId: "calendar-holidays-sync-failed",
          type: "error",
        }),
      );
  };

  const createCalendar = async (name) => {
    try {
      await calendarOperation("create/calendar", { method: "POST" });
    } catch (error) {
      showToast({
        messageKey: "calendarCreateCalendarFailed",
        toastId: "calendar-create-calendar-failed",
        type: "error",
      });
      throw error;
    }
    const now = new Date().toISOString();
    const calendar = {
      color: CALENDAR_COLORS[calendars.length % CALENDAR_COLORS.length],
      createdAt: now,
      events: [],
      favoriteDates: [],
      id: crypto.randomUUID(),
      name,
      updatedAt: now,
      workspaceId,
    };
    const nextCalendars = [...calendars, calendar];
    setCalendars(nextCalendars);
    setActiveCalendarId(calendar.id);
    try {
      await persistData(nextCalendars, calendar.id, showHolidays);
    } catch (error) {
      showToast({
        messageKey: "calendarCreateCalendarFailed",
        toastId: "calendar-create-calendar-sync-failed",
        type: "error",
      });
      throw error;
    }
  };

  const openAddCalendar = () => {
    showModal(
      ({ close }) => (
        <AddCalendarForm close={close} copy={copy} onCreate={createCalendar} />
      ),
      {
        ariaLabel: copy.calendarAddCalendar,
        title: copy.calendarAddCalendar,
        width: "min(28rem, calc(100vw - 1rem))",
      },
    );
  };

  const openShareCalendar = (calendar) => {
    if (!hasSignedInCookie()) {
      showToast({
        messageKey: "calendarSignInToShare",
        toastId: "calendar-sign-in-to-share-calendar",
        type: "warning",
      });
      return;
    }
    showModal(
      ({ close }) => (
        <ShareCalendarForm calendar={calendar} close={close} copy={copy} />
      ),
      {
        ariaLabel: copy.calendarToolbarShare,
        title: copy.calendarToolbarShare,
        width: "min(30rem, calc(100vw - 1rem))",
      },
    );
  };

  const deleteCalendar = async (calendar) => {
    if (calendar.id === "primary" || calendar.id === `primary-${workspaceId}`) {
      return;
    }
    try {
      await calendarOperation("delete/calendar", { method: "POST" });
    } catch (error) {
      showToast({
        messageKey: "calendarDeleteCalendarFailed",
        toastId: "calendar-delete-calendar-failed",
        type: "error",
      });
      throw error;
    }
    if (calendar.shared && calendar.shareIds?.length) {
      await removeReceivedCalendarShares(calendar.shareIds);
    }
    const nextCalendars = calendars.filter((item) => item.id !== calendar.id);
    const remainingWorkspaceCalendars = nextCalendars.filter(
      (item) => item.workspaceId === workspaceId,
    );
    const nextActiveId =
      activeCalendarId === calendar.id
        ? remainingWorkspaceCalendars[0]?.id || "primary"
        : activeCalendarId;
    setCalendars(nextCalendars);
    setActiveCalendarId(nextActiveId);
    try {
      await persistData(nextCalendars, nextActiveId, showHolidays);
    } catch (error) {
      showToast({
        messageKey: "calendarDeleteCalendarFailed",
        toastId: "calendar-delete-calendar-sync-failed",
        type: "error",
      });
      throw error;
    }
  };

  const openDeleteCalendar = (calendar) => {
    showModal(
      ({ close }) => (
        <DeleteCalendarConfirmation
          calendar={calendar}
          close={close}
          copy={copy}
          onDelete={deleteCalendar}
        />
      ),
      {
        ariaLabel: copy.calendarDeleteCalendar,
        title: copy.calendarDeleteCalendar,
        width: "min(30rem, calc(100vw - 1rem))",
      },
    );
  };

  const today = new Date();

  return (
    <>
      <button
        aria-hidden={!open}
        aria-label={copy.tasksCloseSidebar}
        className={`calendar-sidebar-backdrop${open ? " is-open" : ""}`}
        onClick={() => setOpen(false)}
        tabIndex={open ? 0 : -1}
        type="button"
      />
      <aside
        aria-label={copy.calendarSidebar}
        className={`calendar-sidebar liquid-glass${open ? " is-open" : ""}`}
      >
        <style>{`.calendar-world-clocks{display:grid;gap:6px}.calendar-world-clock{align-items:center;display:flex;justify-content:space-between;gap:10px;border-radius:10px;padding:7px 9px;background:rgb(255 255 255 / 4%)}.calendar-world-clock span{font-size:.76rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.calendar-world-clock time{font-size:.8rem;font-weight:720}`}</style>
        <section className="calendar-mini-calendar" aria-label={monthLabel}>
          <div className="calendar-mini-header">
            <h2>{monthLabel}</h2>
            <span className="calendar-mini-arrows">
              <button
                aria-label={copy.accountProfilePreviousMonth}
                onClick={() => moveMonth(-1)}
                type="button"
              >
                <icon>chevron_left</icon>
              </button>
              <button
                aria-label={copy.accountProfileNextMonth}
                onClick={() => moveMonth(1)}
                type="button"
              >
                <icon>chevron_right</icon>
              </button>
            </span>
          </div>
          <div className="calendar-mini-weekdays" aria-hidden="true">
            {weekdayLabels.map((weekday) => (
              <span key={weekday.id}>{weekday.label}</span>
            ))}
          </div>
          <div className="calendar-mini-grid">
            {monthDays.map((date) => {
              const selected = isSameDay(date, selectedDate);
              const isToday = isSameDay(date, today);
              return (
                <button
                  aria-current={isToday ? "date" : undefined}
                  aria-label={new Intl.DateTimeFormat(locale, {
                    dateStyle: "full",
                  }).format(date)}
                  className={`${date.getMonth() === displayedMonth.getMonth() ? "" : "is-outside"}${selected ? " is-selected" : ""}`}
                  key={date.toISOString()}
                  onClick={() => chooseDate(date)}
                  type="button"
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </section>

        <button
          className="calendar-add-birthday"
          onClick={() =>
            window.dispatchEvent(new Event("munetios:calendaraddbirthday"))
          }
          type="button"
        >
          <icon>cake</icon>
          <span>{copy.calendarAddBirthday}</span>
        </button>

        <section className="calendar-sidebar-section">
          <div className="calendar-my-calendars-header">
            <h2>{copy.calendarMyCalendars}</h2>
            <button onClick={openAddCalendar} type="button">
              <icon>add</icon>
              <span>{copy.calendarAddCalendar}</span>
            </button>
          </div>
          <ul className="calendar-list">
            {visibleCalendars.map((calendar) => (
              <li key={calendar.id}>
                <button
                  aria-current={
                    activeCalendarId === calendar.id ? "true" : undefined
                  }
                  className="calendar-list-item"
                  onClick={() => selectCalendar(calendar.id)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="calendar-color"
                    style={{ "--calendar-list-color": calendar.color }}
                  />
                  <span>{calendar.name || copy.calendarPrimaryCalendar}</span>
                  {activeCalendarId === calendar.id
                    ? <icon className="calendar-list-check">check</icon>
                    : null}
                </button>
                <span className="calendar-list-actions">
                  <button
                    aria-label={`${copy.calendarToolbarShare}: ${calendar.name || copy.calendarPrimaryCalendar}`}
                    onClick={() => openShareCalendar(calendar)}
                    type="button"
                  >
                    <icon>share</icon>
                  </button>
                  {calendar.id === "primary" ||
                  calendar.id === `primary-${workspaceId}`
                    ? null
                    : <button
                        aria-label={`${copy.delete}: ${calendar.name || copy.calendarPrimaryCalendar}`}
                        onClick={() => openDeleteCalendar(calendar)}
                        type="button"
                      >
                        <icon>delete</icon>
                      </button>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="calendar-sidebar-section">
          <button
            aria-expanded={otherCalendarsOpen}
            className="calendar-section-toggle"
            onClick={() => setOtherCalendarsOpen((current) => !current)}
            type="button"
          >
            <span>{copy.calendarOtherCalendars}</span>
            <icon>{otherCalendarsOpen ? "expand_less" : "expand_more"}</icon>
          </button>
          {otherCalendarsOpen
            ? <div className="calendar-switch-row">
                <span>{copy.calendarShowHolidays}</span>
                <CustomToggle
                  checked={showHolidays}
                  label={copy.calendarShowHolidays}
                  onChange={() => toggleHolidays()}
                />
              </div>
            : null}
        </section>
        {worldClocks.length && clockNow
          ? <section className="calendar-sidebar-section calendar-world-clocks">
              <h2>{copy.calendarWorldClock}</h2>
              {worldClocks.map((zone) => (
                <div className="calendar-world-clock" key={zone}>
                  <span>{zone.replaceAll("_", " ")}</span>
                  <time>
                    {formatUserTime(clockNow, {
                      locale,
                      preferences: datePreferences,
                      timeZone: zone,
                    })}
                  </time>
                </div>
              ))}
            </section>
          : null}
      </aside>
    </>
  );
}
