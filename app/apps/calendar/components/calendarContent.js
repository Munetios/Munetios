"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingSpinner from "../../../components/loadingSpinner";
import { getCurrentLocale, t } from "../../../i18n";
import {
  dateTimePreferenceStorageKey,
  defaultDateTimePreferences,
  formatUserDate,
  formatUserTime,
  getTimeZone,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import { loadCalendarSettings } from "../lib/calendarSettings";
import { CalendarEventsProvider, useCalendarEvents } from "./calendarEvents";

const HOUR_VALUES = Array.from({ length: 24 }, (_, hour) => hour);

const LIST_VIEW_STYLES = `
  .calendar-list-empty { margin:0; padding:clamp(2.5rem,9vh,6rem) 1rem; color:color-mix(in srgb,var(--foreground) 52%,transparent); font-size:.88rem; text-align:center; }
  .calendar-period-events { display:grid; min-width:0; gap:.4rem; }
  .calendar-period-event { display:grid; width:100%; min-width:0; min-height:2.65rem; cursor:pointer; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:.65rem; border:1px solid color-mix(in srgb,var(--foreground) 10%,transparent); border-radius:.8rem; padding:.55rem .75rem; color:var(--foreground); background:color-mix(in srgb,var(--foreground) 4%,transparent); font:inherit; text-align:start; }
  .calendar-period-event:hover { background:color-mix(in srgb,#9333ea 16%,transparent); }
  .calendar-period-event:focus-visible { outline:2px solid rgb(216 180 254 / 80%); outline-offset:1px; }
  .calendar-period-event > i { width:.65rem; height:.65rem; border-radius:50%; }
  .calendar-period-event > span { overflow:hidden; font-size:.84rem; font-weight:680; text-overflow:ellipsis; white-space:nowrap; }
  .calendar-period-event > time { color:color-mix(in srgb,var(--foreground) 62%,transparent); font-size:.75rem; }
  .calendar-timeline-row { grid-template-columns:8rem minmax(0,1fr); align-items:start; gap:.75rem; padding:.75rem; }
  .calendar-time-cell-grid { display:grid; grid-template-columns:1fr; grid-template-rows:repeat(24,3rem); min-width:0; }
  .calendar-time-cell-grid.is-week { grid-template-columns:repeat(7,minmax(5.5rem,1fr)); }
  .calendar-time-cell { min-width:0; min-height:3rem; cursor:pointer; border:1px solid transparent; border-inline-end-color:color-mix(in srgb,var(--foreground) 9%,transparent); border-bottom-color:color-mix(in srgb,var(--foreground) 9%,transparent); background:transparent; }
  .calendar-time-cell:hover { background:rgb(126 34 206 / .12); }
  .calendar-time-cell[aria-pressed="true"] { border-color:rgb(216 180 254 / .5); background:rgb(126 34 206 / .5); }
  .calendar-time-cell:focus-visible { position:relative; z-index:1; outline:2px solid rgb(216 180 254 / .5); outline-offset:-2px; }
  @media (max-width:720px) {
    .calendar-timeline-row { grid-template-columns:1fr; }
  }
`;

function createCivilDate(year, month, day) {
  return new Date(year, month, day, 12, 0, 0, 0);
}

function createCivilFormattingDate(date) {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12),
  );
}

function toCivilIsoDate(date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatCalendarDate(
  date,
  { dateStyle = "medium", locale, preferences },
) {
  return formatUserDate(createCivilFormattingDate(date), {
    dateStyle,
    locale,
    preferences: { ...preferences, timezone: "UTC" },
  });
}

function startOfDay(date) {
  return createCivilDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  return createCivilDate(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + amount,
  );
}

function addMonths(date, amount) {
  const day = date.getDate();
  const target = createCivilDate(
    date.getFullYear(),
    date.getMonth() + amount,
    1,
  );
  const finalDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  return createCivilDate(
    target.getFullYear(),
    target.getMonth(),
    Math.min(day, finalDay),
  );
}

function getToday(preferences) {
  const timeZone = getTimeZone(preferences);
  if (!timeZone) return startOfDay(new Date());
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    timeZone,
    year: "numeric",
  })
    .formatToParts(new Date())
    .reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = Number(part.value);
      return result;
    }, {});
  return createCivilDate(parts.year, parts.month - 1, parts.day);
}

function isSameDay(first, second) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function startOfWeek(date, weekStarts) {
  const offset = (date.getDay() - weekStarts + 7) % 7;
  return addDays(date, -offset);
}

function getMonthWeeks(date, weekStarts) {
  const first = createCivilDate(date.getFullYear(), date.getMonth(), 1);
  const gridStart = startOfWeek(first, weekStarts);
  return Array.from({ length: 6 }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) =>
      addDays(gridStart, weekIndex * 7 + dayIndex),
    ),
  );
}

function getIsoWeekNumber(date) {
  const utcDate = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const weekday = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
}

function formatMonthYear(date, locale) {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(
    createCivilFormattingDate(
      createCivilDate(date.getFullYear(), date.getMonth(), 15),
    ),
  );
}

function formatWeekRange(start, locale, preferences) {
  const end = addDays(start, 6);
  const startLabel = formatCalendarDate(start, {
    dateStyle: "medium",
    locale,
    preferences,
  });
  const endLabel = formatCalendarDate(end, {
    dateStyle: "medium",
    locale,
    preferences,
  });
  return `${startLabel} – ${endLabel}`;
}

function PeriodHeader({ copy, label, onNext, onPrevious }) {
  return (
    <header className="calendar-period-header">
      <div className="calendar-period-navigation liquid-glass">
        <button
          aria-label={copy.calendarContentPreviousPeriod}
          onClick={onPrevious}
          type="button"
        >
          <icon>chevron_left</icon>
        </button>
        <h1>{label}</h1>
        <button
          aria-label={copy.calendarContentNextPeriod}
          onClick={onNext}
          type="button"
        >
          <icon>chevron_right</icon>
        </button>
      </div>
    </header>
  );
}

function MonthView({ anchorDate, copy, locale, preferences, today }) {
  const {
    eventsForDate,
    isFavoriteDate,
    isSelectedDate,
    onDayClick,
    onDayContext,
    openDetails,
  } = useCalendarEvents();
  const weekStarts = preferences.weekStarts === "monday" ? 1 : 0;
  const weeks = useMemo(
    () => getMonthWeeks(anchorDate, weekStarts),
    [anchorDate, weekStarts],
  );
  const weekdays = useMemo(() => {
    const start = startOfWeek(createCivilDate(2024, 0, 7), weekStarts);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      return {
        long: new Intl.DateTimeFormat(locale, {
          timeZone: "UTC",
          weekday: "long",
        }).format(createCivilFormattingDate(date)),
        short: new Intl.DateTimeFormat(locale, {
          timeZone: "UTC",
          weekday: "short",
        }).format(createCivilFormattingDate(date)),
      };
    });
  }, [locale, weekStarts]);

  return (
    <section
      aria-label={copy.calendarToolbarMonth}
      className="calendar-month-view"
    >
      <div className="calendar-month-weekdays">
        <span
          className="calendar-week-number-heading"
          title={copy.calendarContentWeekNumber}
        >
          {copy.calendarContentWeekShort}
        </span>
        {weekdays.map((weekday) => (
          <span key={weekday.long} title={weekday.long}>
            <span className="calendar-weekday-long">{weekday.long}</span>
            <span className="calendar-weekday-short">{weekday.short}</span>
          </span>
        ))}
      </div>
      <div className="calendar-month-grid">
        {weeks.map((week) => (
          <div className="calendar-month-row" key={week[0].toISOString()}>
            <span
              className="calendar-week-number"
              title={`${copy.calendarContentWeekNumber} ${getIsoWeekNumber(week[0])}`}
            >
              {getIsoWeekNumber(week[0])}
            </span>
            {week.map((date) => {
              const outside = date.getMonth() !== anchorDate.getMonth();
              const isoDate = toCivilIsoDate(date);
              const dayEvents = eventsForDate(isoDate);
              return (
                <div
                  className={`calendar-month-day${outside ? " is-outside" : ""}${isSelectedDate(isoDate) ? " is-selected" : ""}`}
                  key={date.toISOString()}
                >
                  <button
                    aria-label={`${copy.calendarToolbarCreateEvent}: ${formatCalendarDate(
                      date,
                      {
                        dateStyle: "full",
                        locale,
                        preferences,
                      },
                    )}`}
                    className="calendar-day-hit"
                    aria-pressed={isSelectedDate(isoDate)}
                    onClick={(event) =>
                      onDayClick(
                        isoDate,
                        event.currentTarget.getBoundingClientRect(),
                      )
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onDayContext(isoDate, event.clientX, event.clientY);
                    }}
                    type="button"
                  />
                  <time
                    aria-current={isSameDay(date, today) ? "date" : undefined}
                    title={formatCalendarDate(date, {
                      dateStyle: "full",
                      locale,
                      preferences,
                    })}
                    dateTime={toCivilIsoDate(date)}
                  >
                    {date.getDate()}
                  </time>
                  {isFavoriteDate(isoDate)
                    ? <icon
                        aria-label={copy.calendarFavoriteDate}
                        className="calendar-date-favorite"
                      >
                        star
                      </icon>
                    : null}
                  <div className="calendar-day-events">
                    {dayEvents.slice(0, 3).map((calendarEvent) => (
                      <button
                        className="calendar-event-chip"
                        key={calendarEvent.id}
                        onClick={() => openDetails(calendarEvent)}
                        type="button"
                      >
                        <i style={{ backgroundColor: calendarEvent.color }} />
                        <span>{calendarEvent.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function TimeColumn({ copy, locale, preferences }) {
  return (
    <fieldset className="calendar-time-column">
      <legend className="sr-only">{copy.calendarContentTimes}</legend>
      {HOUR_VALUES.map((hour) => (
        <time key={hour}>
          {formatUserTime(Date.UTC(2024, 0, 1, hour, 0, 0, 0), {
            locale,
            preferences,
            timeZone: "UTC",
          })}
        </time>
      ))}
    </fieldset>
  );
}

function TimeCellGrid({ copy, dates, locale, preferences }) {
  const { isSelectedDate, onDayClick, selectedTimeCell, selectionMode } =
    useCalendarEvents();
  const week = dates.length > 1;

  return (
    <div className={`calendar-time-cell-grid${week ? " is-week" : ""}`}>
      {HOUR_VALUES.flatMap((hour) =>
        dates.map((date) => {
          const isoDate = toCivilIsoDate(date);
          const time = `${String(hour).padStart(2, "0")}:00`;
          const selected = selectionMode
            ? isSelectedDate(isoDate)
            : selectedTimeCell?.date === isoDate &&
              selectedTimeCell?.time === time;
          const dateLabel = formatUserDate(createCivilFormattingDate(date), {
            dateStyle: "full",
            locale,
            preferences,
            timeZone: "UTC",
          });
          const timeLabel = formatUserTime(
            Date.UTC(2024, 0, 1, hour, 0, 0, 0),
            { locale, preferences, timeZone: "UTC" },
          );
          return (
            <button
              aria-label={`${copy.calendarToolbarCreateEvent}: ${dateLabel}, ${timeLabel}`}
              aria-pressed={selected}
              className="calendar-time-cell"
              key={`${isoDate}-${time}`}
              onClick={(event) =>
                onDayClick(
                  isoDate,
                  event.currentTarget.getBoundingClientRect(),
                  time,
                )
              }
              type="button"
            />
          );
        }),
      )}
    </div>
  );
}

function DayView({ anchorDate, copy, locale, preferences, today }) {
  return (
    <section
      aria-label={copy.calendarToolbarDay}
      className="calendar-time-view calendar-day-view"
    >
      <div className="calendar-day-heading">
        <span>
          {new Intl.DateTimeFormat(locale, {
            timeZone: "UTC",
            weekday: "long",
          }).format(createCivilFormattingDate(anchorDate))}
        </span>
        <strong
          aria-current={isSameDay(anchorDate, today) ? "date" : undefined}
        >
          {anchorDate.getDate()}
        </strong>
      </div>
      <div className="calendar-time-body">
        <TimeColumn copy={copy} locale={locale} preferences={preferences} />
        <TimeCellGrid
          copy={copy}
          dates={[anchorDate]}
          locale={locale}
          preferences={preferences}
        />
      </div>
    </section>
  );
}

function WeekView({
  anchorDate,
  copy,
  locale,
  preferences,
  timeline = false,
  today,
}) {
  const { listEventsForDate, openDetails } = useCalendarEvents();
  const weekStarts = preferences.weekStarts === "monday" ? 1 : 0;
  const start = startOfWeek(anchorDate, weekStarts);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

  if (timeline) {
    const yearStart = createCivilDate(anchorDate.getFullYear(), 0, 1);
    const nextYear = createCivilDate(anchorDate.getFullYear() + 1, 0, 1);
    const dayCount = Math.round((nextYear - yearStart) / 86_400_000);
    const populatedDays = Array.from({ length: dayCount }, (_, index) =>
      addDays(yearStart, index),
    )
      .map((date) => ({
        date,
        events: listEventsForDate(toCivilIsoDate(date)),
      }))
      .filter(({ events }) => events.length > 0);

    return (
      <section
        aria-label={copy.calendarToolbarTimeline}
        className="calendar-timeline-view"
      >
        {populatedDays.length
          ? populatedDays.map(({ date, events }) => (
              <article
                className="calendar-timeline-row"
                key={date.toISOString()}
              >
                <time
                  aria-current={isSameDay(date, today) ? "date" : undefined}
                >
                  <span>
                    {new Intl.DateTimeFormat(locale, {
                      timeZone: "UTC",
                      weekday: "short",
                    }).format(createCivilFormattingDate(date))}
                  </span>
                  <strong>{date.getDate()}</strong>
                </time>
                <CalendarEventList
                  events={events}
                  locale={locale}
                  onOpen={openDetails}
                  preferences={preferences}
                />
              </article>
            ))
          : <p className="calendar-list-empty">
              {copy.calendarContentNoEvents}
            </p>}
      </section>
    );
  }

  return (
    <section
      aria-label={copy.calendarToolbarWeek}
      className="calendar-time-view calendar-week-view"
    >
      <div className="calendar-week-headings">
        <span aria-hidden="true" />
        {days.map((date) => (
          <time
            aria-current={isSameDay(date, today) ? "date" : undefined}
            dateTime={toCivilIsoDate(date)}
            key={date.toISOString()}
          >
            <span>
              {new Intl.DateTimeFormat(locale, {
                timeZone: "UTC",
                weekday: "short",
              }).format(createCivilFormattingDate(date))}
            </span>
            <strong>{date.getDate()}</strong>
          </time>
        ))}
      </div>
      <div className="calendar-time-body">
        <TimeColumn copy={copy} locale={locale} preferences={preferences} />
        <TimeCellGrid
          copy={copy}
          dates={days}
          locale={locale}
          preferences={preferences}
        />
      </div>
    </section>
  );
}

function YearView({ anchorDate, locale, preferences, today }) {
  const weekStarts = preferences.weekStarts === "monday" ? 1 : 0;
  return (
    <section className="calendar-year-view">
      {Array.from({ length: 12 }, (_, month) => {
        const monthDate = createCivilDate(anchorDate.getFullYear(), month, 1);
        const weeks = getMonthWeeks(monthDate, weekStarts);
        return (
          <article
            className="calendar-year-month"
            key={monthDate.toISOString()}
          >
            <h2>
              {new Intl.DateTimeFormat(locale, {
                month: "long",
                timeZone: "UTC",
              }).format(createCivilFormattingDate(monthDate))}
            </h2>
            <div className="calendar-year-days">
              {weeks.flat().map((date) => (
                <time
                  aria-current={isSameDay(date, today) ? "date" : undefined}
                  className={date.getMonth() === month ? "" : "is-outside"}
                  dateTime={toCivilIsoDate(date)}
                  key={date.toISOString()}
                >
                  {date.getDate()}
                </time>
              ))}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function CalendarEventList({ events, locale, onOpen, preferences }) {
  return (
    <div className="calendar-period-events">
      {events.map((calendarEvent) => (
        <button
          className="calendar-period-event"
          key={calendarEvent.id}
          onClick={() => onOpen(calendarEvent)}
          type="button"
        >
          <i style={{ backgroundColor: calendarEvent.color }} />
          <span>{calendarEvent.name}</span>
          {calendarEvent.time
            ? <time>
                {formatUserTime(
                  Date.UTC(
                    2024,
                    0,
                    1,
                    ...calendarEvent.time.split(":").map(Number),
                    0,
                    0,
                  ),
                  {
                    locale,
                    preferences,
                    timeZone: "UTC",
                  },
                )}
              </time>
            : null}
        </button>
      ))}
    </div>
  );
}

function AgendaView({ anchorDate, copy, locale, preferences, today }) {
  const { listEventsForDate, openDetails } = useCalendarEvents();
  const monthStart = createCivilDate(
    anchorDate.getFullYear(),
    anchorDate.getMonth(),
    1,
  );
  const nextMonth = createCivilDate(
    anchorDate.getFullYear(),
    anchorDate.getMonth() + 1,
    1,
  );
  const dayCount = Math.round((nextMonth - monthStart) / 86_400_000);
  const populatedDays = Array.from({ length: dayCount }, (_, index) =>
    addDays(monthStart, index),
  )
    .map((date) => ({
      date,
      events: listEventsForDate(toCivilIsoDate(date)),
    }))
    .filter(({ events }) => events.length > 0);

  return (
    <section
      aria-label={copy.calendarToolbarAgenda}
      className="calendar-agenda-view"
    >
      {populatedDays.length
        ? populatedDays.map(({ date, events }) => (
            <article className="calendar-agenda-day" key={date.toISOString()}>
              <time aria-current={isSameDay(date, today) ? "date" : undefined}>
                <strong>{date.getDate()}</strong>
                <span>
                  {new Intl.DateTimeFormat(locale, {
                    month: "short",
                    timeZone: "UTC",
                    weekday: "long",
                  }).format(createCivilFormattingDate(date))}
                </span>
              </time>
              <CalendarEventList
                events={events}
                locale={locale}
                onOpen={openDetails}
                preferences={preferences}
              />
            </article>
          ))
        : <p className="calendar-list-empty">{copy.calendarContentNoEvents}</p>}
    </section>
  );
}

function CustomCalendarView({
  anchorDate,
  copy,
  locale,
  preferences,
  today,
  view,
}) {
  const { listEventsForDate, openDetails } = useCalendarEvents();
  const parseDate = (value) => {
    const [year, month, day] = String(value || "")
      .split("-")
      .map(Number);
    return createCivilDate(year, month - 1, day);
  };
  const start =
    view.mode === "range" ? parseDate(view.start) : startOfDay(anchorDate);
  const end =
    view.mode === "range"
      ? parseDate(view.end)
      : addDays(start, Math.max(1, Number(view.days) || 1) - 1);
  const dayCount = Math.min(
    366,
    Math.max(1, Math.round((end - start) / 86_400_000) + 1),
  );
  const populatedDays = Array.from({ length: dayCount }, (_, index) =>
    addDays(start, index),
  )
    .map((date) => ({ date, events: listEventsForDate(toCivilIsoDate(date)) }))
    .filter(({ events }) => events.length > 0);
  return (
    <section
      aria-label={view.name}
      className="calendar-agenda-view calendar-custom-view"
    >
      {populatedDays.length
        ? populatedDays.map(({ date, events }) => (
            <article className="calendar-agenda-day" key={date.toISOString()}>
              <time aria-current={isSameDay(date, today) ? "date" : undefined}>
                <strong>{date.getDate()}</strong>
                <span>
                  {formatCalendarDate(date, {
                    dateStyle: "full",
                    locale,
                    preferences,
                  })}
                </span>
              </time>
              <CalendarEventList
                events={events}
                locale={locale}
                onOpen={openDetails}
                preferences={preferences}
              />
            </article>
          ))
        : <p className="calendar-list-empty">{copy.calendarContentNoEvents}</p>}
    </section>
  );
}

function getPeriodLabel(view, anchorDate, locale, preferences) {
  if (view === "day") {
    return formatCalendarDate(anchorDate, {
      dateStyle: "full",
      locale,
      preferences,
    });
  }
  if (view === "week") {
    const weekStarts = preferences.weekStarts === "monday" ? 1 : 0;
    return formatWeekRange(
      startOfWeek(anchorDate, weekStarts),
      locale,
      preferences,
    );
  }
  if (["timeline", "year"].includes(view)) {
    return String(anchorDate.getFullYear());
  }
  return formatMonthYear(anchorDate, locale);
}

function CalendarContentBody() {
  const [activePage, setActivePage] = useState("calendar");
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const [calendarView, setCalendarView] = useState("month");
  const [customView, setCustomView] = useState(null);
  const [copy, setCopy] = useState(() => t("en"));
  const [locale, setLocale] = useState("en");
  const [preferences, setPreferences] = useState(defaultDateTimePreferences);
  const { loading } = useCalendarEvents();
  const preferencesRef = useRef(defaultDateTimePreferences);
  const today = useMemo(() => getToday(preferences), [preferences]);
  const periodLabel = useMemo(
    () =>
      customView?.name ||
      getPeriodLabel(calendarView, anchorDate, locale, preferences),
    [anchorDate, calendarView, customView, locale, preferences],
  );

  const movePeriod = useCallback(
    (offset) => {
      setAnchorDate((current) => {
        if (calendarView === "day") return addDays(current, offset);
        if (customView?.mode === "days") {
          return addDays(
            current,
            offset * Math.max(1, Number(customView.days) || 1),
          );
        }
        if (calendarView === "week") {
          return addDays(current, offset * 7);
        }
        if (["timeline", "year"].includes(calendarView)) {
          return createCivilDate(
            current.getFullYear() + offset,
            current.getMonth(),
            current.getDate(),
          );
        }
        return addMonths(current, offset);
      });
    },
    [calendarView, customView],
  );

  useEffect(() => {
    const refreshCopy = () => {
      setCopy(t());
      setLocale(getCurrentLocale());
    };
    const refreshPreferences = (event) => {
      const next = event?.detail || loadDateTimePreferences();
      const previousToday = getToday(preferencesRef.current);
      const nextToday = getToday(next);
      setAnchorDate((current) =>
        isSameDay(current, previousToday) ? nextToday : current,
      );
      preferencesRef.current = next;
      setPreferences(next);
    };
    const handleStorage = (event) => {
      if (event.key === dateTimePreferenceStorageKey) refreshPreferences();
    };
    const handlePageChange = (event) =>
      setActivePage(event.detail?.view || "calendar");
    const handleViewChange = (event) => {
      setCalendarView(event.detail?.view || "month");
      const nextCustomView = event.detail?.customView || null;
      setCustomView(nextCustomView);
      if (nextCustomView?.mode === "range" && nextCustomView.start) {
        const [year, month, day] = nextCustomView.start.split("-").map(Number);
        const start = createCivilDate(year, month - 1, day);
        if (!Number.isNaN(start.getTime())) setAnchorDate(start);
      }
    };
    const handleNavigate = (event) =>
      movePeriod(event.detail?.months < 0 ? -1 : 1);
    const handleDateChange = (event) => {
      const next = new Date(event.detail);
      if (!Number.isNaN(next.getTime())) setAnchorDate(startOfDay(next));
    };
    const goToday = () => setAnchorDate(getToday(loadDateTimePreferences()));

    refreshCopy();
    refreshPreferences();
    window.addEventListener(
      "munetios:calendarcontentviewchange",
      handlePageChange,
    );
    window.addEventListener("munetios:calendarviewchange", handleViewChange);
    window.addEventListener("munetios:calendarviewnavigate", handleNavigate);
    window.addEventListener("munetios:calendardatechange", handleDateChange);
    window.addEventListener("munetios:calendartoday", goToday);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener(
      "munetios:language-time-change",
      refreshPreferences,
    );
    window.addEventListener("storage", handleStorage);
    const savedPage = window.localStorage.getItem("munetios.calendar.page");
    const savedView = window.localStorage.getItem("munetios.calendar.view");
    const savedCustomView = loadCalendarSettings().customViews.find(
      (view) => `custom:${view.id}` === savedView,
    );
    if (["calendar", "tasks", "meals"].includes(savedPage)) {
      setActivePage(savedPage);
    }
    if (
      ["day", "week", "month", "year", "agenda", "timeline"].includes(
        savedView,
      ) ||
      savedCustomView
    ) {
      setCalendarView(savedView);
      setCustomView(savedCustomView || null);
      if (savedCustomView?.mode === "range" && savedCustomView.start) {
        const [year, month, day] = savedCustomView.start.split("-").map(Number);
        const start = createCivilDate(year, month - 1, day);
        if (!Number.isNaN(start.getTime())) setAnchorDate(start);
      }
    }
    return () => {
      window.removeEventListener(
        "munetios:calendarcontentviewchange",
        handlePageChange,
      );
      window.removeEventListener(
        "munetios:calendarviewchange",
        handleViewChange,
      );
      window.removeEventListener(
        "munetios:calendarviewnavigate",
        handleNavigate,
      );
      window.removeEventListener(
        "munetios:calendardatechange",
        handleDateChange,
      );
      window.removeEventListener("munetios:calendartoday", goToday);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener(
        "munetios:language-time-change",
        refreshPreferences,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [movePeriod]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("munetios:calendarperiodchange", {
        detail: { year: anchorDate.getFullYear() },
      }),
    );
  }, [anchorDate]);

  if (activePage === "tasks") {
    return (
      <section
        aria-label={copy.calendarContentEmbeddedTasks}
        className="calendar-embedded-panel"
      >
        <iframe
          className="calendar-tasks-frame"
          loading="lazy"
          src="/apps/tasks?embedded=calendar"
          title={copy.calendarContentEmbeddedTasks}
        />
      </section>
    );
  }

  if (activePage === "meals") {
    return (
      <section className="calendar-coming-soon liquid-glass">
        <icon>restaurant</icon>
        <div>
          <h1>{copy.calendarContentMealsComingSoon}</h1>
          <p>{copy.calendarContentMealsComingSoonDescription}</p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section
        aria-busy="true"
        aria-label={copy.calendarContentLabel}
        className="calendar-main-content calendar-loading-content liquid-glass"
      >
        <LoadingSpinner label={`${copy.loading}...`} />
      </section>
    );
  }

  return (
    <section
      aria-label={copy.calendarContentLabel}
      className="calendar-main-content liquid-glass"
    >
      <PeriodHeader
        copy={copy}
        label={periodLabel}
        onNext={() => movePeriod(1)}
        onPrevious={() => movePeriod(-1)}
      />
      {calendarView === "day"
        ? <DayView
            anchorDate={anchorDate}
            copy={copy}
            locale={locale}
            preferences={preferences}
            today={today}
          />
        : null}
      {calendarView === "week"
        ? <WeekView
            anchorDate={anchorDate}
            copy={copy}
            locale={locale}
            preferences={preferences}
            today={today}
          />
        : null}
      {calendarView === "month"
        ? <MonthView
            anchorDate={anchorDate}
            copy={copy}
            locale={locale}
            preferences={preferences}
            today={today}
          />
        : null}
      {calendarView === "year"
        ? <YearView
            anchorDate={anchorDate}
            locale={locale}
            preferences={preferences}
            today={today}
          />
        : null}
      {calendarView === "agenda"
        ? <AgendaView
            anchorDate={anchorDate}
            copy={copy}
            locale={locale}
            preferences={preferences}
            today={today}
          />
        : null}
      {calendarView === "timeline"
        ? <WeekView
            anchorDate={anchorDate}
            copy={copy}
            locale={locale}
            preferences={preferences}
            timeline
            today={today}
          />
        : null}
      {customView
        ? <CustomCalendarView
            anchorDate={anchorDate}
            copy={copy}
            locale={locale}
            preferences={preferences}
            today={today}
            view={customView}
          />
        : null}
    </section>
  );
}

export default function CalendarContent() {
  const [copy, setCopy] = useState(() => t("en"));
  useEffect(() => {
    const refresh = () => setCopy(t());
    refresh();
    window.addEventListener("munetios:languagechange", refresh);
    window.addEventListener("munetios:localechange", refresh);
    return () => {
      window.removeEventListener("munetios:languagechange", refresh);
      window.removeEventListener("munetios:localechange", refresh);
    };
  }, []);
  return (
    <CalendarEventsProvider copy={copy}>
      <style>{LIST_VIEW_STYLES}</style>
      <CalendarContentBody />
    </CalendarEventsProvider>
  );
}
