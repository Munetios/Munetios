"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatUserDate,
  formatUserTime,
  getTimeZone,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import { prepareMeetAudio } from "./meetSounds";

function startOfWeek(value, weekStartsOnMonday) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const weekday = date.getDay();
  const offset = weekStartsOnMonday ? (weekday + 6) % 7 : weekday;
  date.setDate(date.getDate() - offset);
  return date;
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function calendarDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function instantDateKey(value, preferences) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: getTimeZone(preferences),
    year: "numeric",
  })
    .formatToParts(date)
    .reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isToday(value, preferences) {
  return calendarDateKey(value) === instantDateKey(new Date(), preferences);
}

function getStoredHistory() {
  if (typeof window === "undefined") return [];

  try {
    const history = JSON.parse(
      window.localStorage.getItem("munetios.meet.history") || "[]",
    );
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

function getStoredGuestNickname() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem("munetios.meet.guestNickname") || "";
}

function getLocale() {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang || navigator.language || "en";
}

function getMeetingDetails(value) {
  const text = value.trim();
  if (!text) return { e2eeKey: "", roomId: "" };
  if (!text.includes("/") && !text.includes("?") && !text.includes("#")) {
    const separator = text.lastIndexOf(".");
    return separator > 0
      ? {
          e2eeKey: text.slice(separator + 1),
          roomId: text.slice(0, separator),
        }
      : { e2eeKey: "", roomId: text };
  }
  try {
    const url = new URL(text, window.location.origin);
    const roomId =
      url.searchParams.get("room") ||
      url.pathname.split("/").filter(Boolean).at(-1) ||
      "";
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    return { e2eeKey: fragment.get("key") || "", roomId };
  } catch {
    return { e2eeKey: "", roomId: text };
  }
}

export default function MeetHome({ copy, onStartMeeting, sessionState }) {
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [guestNickname, setGuestNickname] = useState(getStoredGuestNickname);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [meetingCode, setMeetingCode] = useState("");
  const [nicknameError, setNicknameError] = useState(false);
  const [rejoinMode, setRejoinMode] = useState(false);
  const [weekStartsOnMonday, setWeekStartsOnMonday] = useState(false);
  const [dateTimePreferences, setDateTimePreferences] = useState(
    loadDateTimePreferences,
  );
  const nicknameInputRef = useRef(null);
  const locale = getLocale();
  const isGuest = sessionState === "inactive";
  const sessionLoading = sessionState === "loading";

  useEffect(() => {
    const refreshDateTimePreferences = () => {
      const nextPreferences = loadDateTimePreferences();
      setDateTimePreferences(nextPreferences);
      setWeekStartsOnMonday(nextPreferences.weekStarts === "monday");
    };
    refreshDateTimePreferences();
    window.addEventListener(
      "munetios:language-time-change",
      refreshDateTimePreferences,
    );
    const searchParameters = new URLSearchParams(window.location.search);
    const roomId = searchParameters.get("room");
    const fragment = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    );
    if (roomId) {
      const key = fragment.get("key");
      setMeetingCode(key ? `${roomId}.${key}` : roomId);
    }
    setRejoinMode(searchParameters.get("rejoin") === "1");

    fetch("/api/meet", { cache: "no-store", credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("meet_home_request_failed");
        return response.json();
      })
      .then((payload) => {
        setHistory(
          payload?.authenticated && Array.isArray(payload.history)
            ? payload.history
            : getStoredHistory(),
        );
      })
      .catch(() => setHistory(getStoredHistory()))
      .finally(() => setHistoryLoading(false));
    return () => {
      window.removeEventListener(
        "munetios:language-time-change",
        refreshDateTimePreferences,
      );
    };
  }, []);

  useEffect(() => {
    if (!isGuest) {
      setNicknameError(false);
    }
  }, [isGuest]);

  const updateGuestNickname = (value) => {
    const nickname = value.slice(0, 80);
    setGuestNickname(nickname);
    setNicknameError(false);
    window.sessionStorage.setItem("munetios.meet.guestNickname", nickname);
  };

  const hasRequiredNickname = () => {
    if (!isGuest || guestNickname.trim()) {
      return true;
    }

    setNicknameError(true);
    nicknameInputRef.current?.focus();
    return false;
  };

  const createMeeting = () => {
    if (sessionLoading || !hasRequiredNickname()) {
      return;
    }
    prepareMeetAudio();
    onStartMeeting({
      action: "create",
      nickname: isGuest ? guestNickname.trim() : "",
    });
  };

  const joinMeeting = (event) => {
    event.preventDefault();
    const { e2eeKey, roomId } = getMeetingDetails(meetingCode);
    if (!roomId || sessionLoading || !hasRequiredNickname()) {
      return;
    }
    prepareMeetAudio();
    onStartMeeting({
      action: rejoinMode ? "rejoin" : "join",
      e2eeKey,
      nickname: isGuest ? guestNickname.trim() : "",
      roomId,
    });
  };

  const weekStart = useMemo(
    () => startOfWeek(anchorDate, weekStartsOnMonday),
    [anchorDate, weekStartsOnMonday],
  );
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const historyByDate = useMemo(() => {
    const groupedHistory = new Map();

    for (const meeting of history) {
      const key = instantDateKey(meeting.joinedAt, dateTimePreferences);
      if (!key) continue;
      groupedHistory.set(key, [...(groupedHistory.get(key) || []), meeting]);
    }

    return groupedHistory;
  }, [dateTimePreferences, history]);
  const weekMeetingCount = weekDays.reduce(
    (count, day) =>
      count + (historyByDate.get(calendarDateKey(day))?.length || 0),
    0,
  );
  const weekdayFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "short",
  });
  const monthFormatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  });
  const yearFormatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const weekEnd = weekDays[6];
  const weekRange = `${monthFormatter.format(weekStart)} – ${yearFormatter.format(weekEnd)}`;

  const userWeekRange = `${formatUserDate(weekStart, {
    locale,
    preferences: dateTimePreferences,
  })} - ${formatUserDate(weekEnd, {
    locale,
    preferences: dateTimePreferences,
  })}`;
  void weekRange;

  return (
    <section aria-labelledby="meetHomeTitle" className="meet-home">
      <div className="meet-home-hero">
        <div className="meet-home-intro">
          <p className="meet-home-eyebrow">
            <icon>videocam</icon>
            {copy.meetAppName}
          </p>
          <h1 id="meetHomeTitle">{copy.meetAppName}</h1>
          <p className="meet-home-description">{copy.meetHomeDescription}</p>

          {isGuest
            ? <div className="meet-guest-nickname liquid-glass">
                <span className="meet-guest-nickname-icon">
                  <icon>person</icon>
                </span>
                <label htmlFor="meetGuestNickname">
                  <strong>{copy.meetGuestNickname}</strong>
                  <small>{copy.meetGuestNicknameDescription}</small>
                </label>
                <input
                  aria-describedby={
                    nicknameError ? "meetNicknameError" : undefined
                  }
                  aria-invalid={nicknameError}
                  autoComplete="nickname"
                  id="meetGuestNickname"
                  maxLength={80}
                  onChange={(event) => updateGuestNickname(event.target.value)}
                  placeholder={copy.meetGuestNicknamePlaceholder}
                  ref={nicknameInputRef}
                  required
                  type="text"
                  value={guestNickname}
                />
                {nicknameError
                  ? <p id="meetNicknameError" role="alert">
                      {copy.meetNicknameRequired}
                    </p>
                  : null}
              </div>
            : null}

          <div className="meet-home-actions">
            <button
              className="meet-new-meeting liquid-glass"
              disabled={sessionLoading}
              onClick={createMeeting}
              type="button"
            >
              <icon className="meet-new-meeting-icon">video_call</icon>
              <span>{copy.meetNewMeeting}</span>
            </button>

            <form
              className="meet-join-meeting liquid-glass"
              onSubmit={joinMeeting}
            >
              <label htmlFor="meetCode">{copy.meetJoinMeeting}</label>
              <div>
                <icon>link</icon>
                <input
                  disabled={sessionLoading}
                  id="meetCode"
                  onChange={(event) => setMeetingCode(event.target.value)}
                  placeholder={copy.meetMeetingCodePlaceholder}
                  required
                  type="text"
                  value={meetingCode}
                />
                <button
                  aria-label={copy.meetJoinMeeting}
                  disabled={sessionLoading || !meetingCode.trim()}
                  type="submit"
                >
                  <icon>arrow_forward</icon>
                </button>
              </div>
            </form>
          </div>
        </div>

        <div aria-hidden="true" className="meet-home-visual">
          <span className="meet-home-orbit meet-home-orbit-one" />
          <span className="meet-home-orbit meet-home-orbit-two" />
          <span className="meet-home-video-symbol liquid-glass">
            <icon className="meet-home-video-icon">video_camera_front</icon>
          </span>
          <span className="meet-home-person meet-home-person-one liquid-glass">
            <icon className="meet-home-person-icon">person</icon>
          </span>
          <span className="meet-home-person meet-home-person-two liquid-glass">
            <icon className="meet-home-person-icon">person</icon>
          </span>
        </div>
      </div>

      <section
        aria-labelledby="meetWeekCalendarTitle"
        className="meet-week-calendar liquid-glass"
      >
        <header className="meet-calendar-header">
          <div>
            <p>{copy.meetAppName}</p>
            <h2 id="meetWeekCalendarTitle">{copy.meetWeekCalendar}</h2>
            <span aria-live="polite">{userWeekRange}</span>
          </div>
          <div className="meet-calendar-actions">
            <button
              aria-label={copy.meetPreviousWeek}
              onClick={() => setAnchorDate(addDays(weekStart, -7))}
              type="button"
            >
              <icon>chevron_left</icon>
            </button>
            <button onClick={() => setAnchorDate(new Date())} type="button">
              {copy.meetToday}
            </button>
            <button
              aria-label={copy.meetNextWeek}
              onClick={() => setAnchorDate(addDays(weekStart, 7))}
              type="button"
            >
              <icon>chevron_right</icon>
            </button>
          </div>
        </header>

        <div className="meet-calendar-scroll">
          <div className="meet-calendar-grid">
            {weekDays.map((day) => {
              const meetings = historyByDate.get(calendarDateKey(day)) || [];
              return (
                <article
                  className={
                    isToday(day, dateTimePreferences) ? "is-today" : undefined
                  }
                  key={calendarDateKey(day)}
                >
                  <header>
                    <span>{weekdayFormatter.format(day)}</span>
                    <strong className="meet-calendar-day-number">
                      {day.getDate()}
                    </strong>
                  </header>
                  <div className="meet-calendar-day-content">
                    {meetings.map((meeting, meetingIndex) => (
                      <div
                        className="meet-calendar-event"
                        key={
                          meeting.id ||
                          `${meeting.joinedAt || calendarDateKey(day)}-${meetingIndex}`
                        }
                      >
                        <icon className="meet-calendar-event-icon">
                          videocam
                        </icon>
                        <span>
                          <strong className="meet-calendar-event-title">
                            {meeting.title || copy.meetJoinedMeeting}
                          </strong>
                          <small>
                            {formatUserTime(meeting.joinedAt, {
                              locale,
                              preferences: dateTimePreferences,
                            })}
                          </small>
                        </span>
                      </div>
                    ))}
                    {!historyLoading && meetings.length === 0
                      ? <div className="meet-calendar-day-empty">
                          <icon className="meet-calendar-empty-icon">
                            event_available
                          </icon>
                          <span>{copy.meetNoMeetings}</span>
                        </div>
                      : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <footer className="meet-calendar-footer">
          <div>
            <icon className="meet-calendar-summary-icon">
              {weekMeetingCount ? "event_note" : "event_available"}
            </icon>
            <span>
              <strong className="meet-calendar-summary-title">
                {weekMeetingCount ? copy.meetHistory : copy.meetNoMeetings}
              </strong>
              <small>
                {weekMeetingCount
                  ? copy.meetOpenCallHistory
                  : copy.meetNoMeetingsDescription}
              </small>
            </span>
          </div>
          <Link href="/apps/meet/history">
            <icon>history</icon>
            {copy.meetOpenCallHistory}
          </Link>
        </footer>
      </section>
      <footer className="meet-site-footer">
        <Link
          className="meet-site-footer-brand"
          href="/apps/meet"
          rel="noopener noreferrer"
          target="_blank"
        >
          <icon className="meet-site-footer-icon">videocam</icon>
          <span>{copy.meetAppName}</span>
        </Link>
        <nav aria-label={copy.meetNavigation}>
          <Link href="/help" rel="noopener noreferrer" target="_blank">
            {copy.meetHelp}
          </Link>
          <Link href="/privacy" rel="noopener noreferrer" target="_blank">
            {copy.privacyPolicyTitle}
          </Link>
          <Link href="/terms" rel="noopener noreferrer" target="_blank">
            {copy.termsTitle}
          </Link>
          <Link href="/cookies" rel="noopener noreferrer" target="_blank">
            {copy.cookiePolicyTitle}
          </Link>
        </nav>
        <small>© {new Date().getFullYear()} Munetios</small>
      </footer>
    </section>
  );
}
