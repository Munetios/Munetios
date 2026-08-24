"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAppearanceSettings } from "../../../components/appearanceRuntime";
import CustomCheckbox from "../../../components/customCheckbox";
import CustomToggle from "../../../components/customToggle";
import DatePicker from "../../../components/datePicker";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { getCurrentLocale, setCurrentLocale, t } from "../../../i18n";
import {
  dateTimePreferenceStorageKey,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import {
  calendarNotificationPermissionGranted,
  requestCalendarNotificationPermission,
} from "../lib/calendarNotifications";
import {
  calendarCountries,
  getTimeZones,
  loadCalendarSettings,
  saveCalendarSettings,
} from "../lib/calendarSettings";
import {
  loadEncryptedCalendarData,
  saveEncryptedCalendarData,
} from "../lib/encryptedCalendarVault";

const localeOptions = [
  ["ar-SA", "العربية"],
  ["co-FR", "Corsu"],
  ["da-DK", "Dansk"],
  ["de-CH", "Deutsch (Schweiz)"],
  ["de-DE", "Deutsch"],
  ["el-GR", "Ελληνικά"],
  ["en-GB", "English (UK)"],
  ["en", "English (US)"],
  ["es-419", "Español (Latinoamérica)"],
  ["es-AR", "Español (Argentina)"],
  ["es-CO", "Español (Colombia)"],
  ["es-DO", "Español (República Dominicana)"],
  ["es-EQ", "Español (Ecuador)"],
  ["es-ES", "Español (España)"],
  ["es-MX", "Español (México)"],
  ["es-PR", "Español (Puerto Rico)"],
  ["es-US", "Español (Estados Unidos)"],
  ["fr-FR", "Français"],
  ["fur-IT", "Furlan"],
  ["gl-ES", "Galego"],
  ["he-IL", "עברית"],
  ["hi-IN", "हिन्दी"],
  ["id-ID", "Bahasa Indonesia"],
  ["it-CH", "Italiano (Svizzera)"],
  ["it-IT", "Italiano"],
  ["ja-JP", "日本語"],
  ["ko-KR", "한국어"],
  ["ms-MY", "Bahasa Melayu"],
  ["nl-NL", "Nederlands"],
  ["pl-PL", "Polski"],
  ["pt-BR", "Português (Brasil)"],
  ["pt-PT", "Português (Portugal)"],
  ["ru-RU", "Русский"],
  ["sv-SE", "Svenska"],
  ["th-TH", "ไทย"],
  ["tr-TR", "Türkçe"],
  ["vi-VN", "Tiếng Việt"],
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁體中文"],
];

const SETTINGS_STYLES = `
  .calendar-settings-layout { display:grid; grid-template-columns:14rem minmax(0,1fr); min-height:min(38rem,75vh); }
  .calendar-settings-nav { border-inline-end:1px solid rgb(255 255 255 / .1); display:grid; align-content:start; gap:5px; padding:10px; }
  .calendar-settings-nav button { align-items:center; border:0; border-radius:11px; display:flex; gap:9px; padding:10px 11px; text-align:start; width:100%; }
  .calendar-settings-nav button[aria-current="page"] { background:rgb(126 34 206 / .4); }
  .calendar-settings-page { display:grid; align-content:start; gap:16px; max-height:75vh; overflow:auto; padding:18px; }
  .calendar-settings-page h3 { font-size:1.15rem; margin:0; }
  .calendar-settings-section { border:1px solid rgb(255 255 255 / .1); border-radius:15px; display:grid; gap:12px; padding:14px; }
  .calendar-settings-row { align-items:center; display:grid; gap:10px; grid-template-columns:minmax(10rem,1fr) minmax(11rem,1fr); }
  .calendar-settings-row > span:first-child { font-weight:650; }
  .calendar-settings-select { width:100%; }
  .calendar-settings-select > button { align-items:center; background:rgb(255 255 255 / .07); border:1px solid rgb(255 255 255 / .12); border-radius:11px; display:flex; justify-content:space-between; padding:10px 11px; width:100%; }
  .calendar-settings-select-menu { max-height:19rem; overflow:auto; width:min(23rem,calc(100vw - 2rem)); }
  .calendar-settings-options { display:grid; gap:3px; }
  .calendar-settings-options button { align-items:center; border-radius:9px; display:flex; justify-content:space-between; padding:8px 10px; text-align:start; width:100%; }
  .calendar-settings-options button:hover { background:rgb(126 34 206 / .3); }
  .calendar-settings-switch { align-items:center; display:flex; gap:10px; justify-content:space-between; }
  .calendar-settings-clocks,.calendar-settings-countries { display:flex; flex-wrap:wrap; gap:7px; }
  .calendar-settings-chip { align-items:center; background:rgb(126 34 206 / .24); border:1px solid rgb(216 180 254 / .18); border-radius:999px; display:inline-flex; gap:5px; padding:6px 8px 6px 11px; }
  .calendar-settings-chip button { border:0; padding:0; }
  .calendar-settings-country-grid { display:grid; gap:6px; grid-template-columns:repeat(2,minmax(0,1fr)); max-height:16rem; overflow:auto; }
  .calendar-settings-country-option { align-items:center; display:flex; gap:8px; }
  .calendar-custom-view-form { display:grid; gap:10px; }
  .calendar-custom-view-form input { background:rgb(255 255 255 / .07); border:1px solid rgb(255 255 255 / .12); border-radius:11px; color:white; padding:10px 11px; width:100%; }
  .calendar-custom-view-actions { display:grid; gap:8px; grid-template-columns:repeat(3,minmax(0,1fr)); }
  .calendar-settings-action { align-items:center; border:1px solid rgb(255 255 255 / .12); border-radius:12px; display:flex; gap:9px; justify-content:center; padding:10px; }
  .calendar-settings-action.primary { background:#7e22ce; }
  @media (max-width:720px) { .calendar-settings-layout { grid-template-columns:1fr; } .calendar-settings-nav { border-block-end:1px solid rgb(255 255 255 / .1); border-inline-end:0; grid-template-columns:repeat(4,minmax(0,1fr)); } .calendar-settings-nav button { justify-content:center; } .calendar-settings-nav button span { display:none; } .calendar-settings-row { grid-template-columns:1fr; } .calendar-custom-view-actions { grid-template-columns:1fr; } }
`;

function GlassSelect({ ariaLabel, onChange, options, value }) {
  const selected = options.find(([option]) => option === value) || options[0];
  return (
    <DropdownWrapper
      align="left"
      ariaLabel={ariaLabel}
      buttonClassName="calendar-settings-select-trigger"
      className="calendar-settings-select"
      panelClassName="calendar-settings-select-menu"
      trigger={
        <>
          <span>{selected?.[1] || value}</span>
          <icon>expand_more</icon>
        </>
      }
      triggerAs="button"
      triggerGlass={false}
    >
      <div className="calendar-settings-options">
        {options.map(([option, label]) => (
          <button
            data-dropdown-close
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            <span>{label}</span>
            {option === value ? <icon>check</icon> : null}
          </button>
        ))}
      </div>
    </DropdownWrapper>
  );
}

function CalendarSettingsTitle() {
  const [locale, setLocale] = useState(() => getCurrentLocale());

  useEffect(() => {
    const refreshLocale = () => setLocale(getCurrentLocale());
    window.addEventListener("munetios:localechange", refreshLocale);
    return () =>
      window.removeEventListener("munetios:localechange", refreshLocale);
  }, []);

  return t(locale).settings;
}

function unescapeIcs(value) {
  return String(value || "")
    .replaceAll("\\n", "\n")
    .replaceAll("\\,", ",")
    .replaceAll("\\;", ";")
    .replaceAll("\\\\", "\\");
}

function parseIcs(text, sourceName) {
  const unfolded = text.replace(/\r?\n[ \t]/gu, "");
  if (!/BEGIN:VCALENDAR/iu.test(unfolded)) throw new Error("invalid_ics");
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/giu) || [];
  const events = blocks
    .map((block, index) => {
      const property = (name) => {
        const match = block.match(
          new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "imu"),
        );
        return unescapeIcs(match?.[1] || "");
      };
      const rawStart = property("DTSTART");
      const compact = rawStart.replace(/[^\dT]/gu, "");
      const date =
        compact.length >= 8
          ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
          : "";
      const time = compact.includes("T")
        ? `${compact.slice(9, 11)}:${compact.slice(11, 13)}`
        : "";
      return {
        color: "#4285f4",
        createdAt: new Date().toISOString(),
        date,
        description: property("DESCRIPTION"),
        favorite: false,
        guests: [...block.matchAll(/^ATTENDEE[^:]*:(?:mailto:)?(.+)$/gimu)].map(
          (match) => match[1].trim(),
        ),
        id: `ics-${crypto.randomUUID()}-${index}`,
        location: property("LOCATION"),
        name: property("SUMMARY") || sourceName,
        sharedWith: [],
        time,
        type: "event",
        updatedAt: new Date().toISOString(),
      };
    })
    .filter((event) => /^\d{4}-\d{2}-\d{2}$/u.test(event.date));
  return events;
}

function escapeIcs(value) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function calendarToIcs(data) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Munetios//Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const calendar of data.calendars || [])
    for (const event of calendar.events || []) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${escapeIcs(event.id)}@calendar.munetios.com`,
        `DTSTART:${event.date.replaceAll("-", "")}${event.time ? `T${event.time.replaceAll(":", "")}00` : ""}`,
        `SUMMARY:${escapeIcs(event.name)}`,
        `DESCRIPTION:${escapeIcs(event.description)}`,
      );
      if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
      for (const guest of event.guests || [])
        lines.push(`ATTENDEE:mailto:${escapeIcs(guest)}`);
      lines.push("END:VEVENT");
    }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function CalendarSettings({ close }) {
  const [page, setPage] = useState("general");
  const [settings, setSettings] = useState(() => loadCalendarSettings());
  const [preferences, setPreferences] = useState(() =>
    loadDateTimePreferences(),
  );
  const [locale, setLocale] = useState(() => getCurrentLocale());
  const [notificationPermissionPending, setNotificationPermissionPending] =
    useState(false);
  const [themeMode, setThemeMode] = useState(
    () => loadAppearanceSettings().themeMode,
  );
  const [clockZone, setClockZone] = useState("America/New_York");
  const [viewDraft, setViewDraft] = useState({
    days: 2,
    end: "",
    mode: "days",
    name: "",
    start: "",
  });
  const importFileRef = useRef(null);
  const copy = t(locale);
  const timeZones = useMemo(
    () => getTimeZones().map((zone) => [zone, zone.replaceAll("_", " ")]),
    [],
  );
  const countryOptions = useMemo(() => {
    let displayNames;
    try {
      displayNames = new Intl.DisplayNames(locale, { type: "region" });
    } catch {
      displayNames = null;
    }
    return calendarCountries.map(([code, fallback]) => [
      code,
      displayNames?.of(code) || fallback,
    ]);
  }, [locale]);
  const updateSettings = useCallback(
    (patch) =>
      setSettings((current) => saveCalendarSettings({ ...current, ...patch })),
    [],
  );
  const updateEventNotifications = async (enabled) => {
    if (!enabled) {
      updateSettings({ notificationsEnabled: false });
      return;
    }
    setNotificationPermissionPending(true);
    try {
      const notificationsEnabled =
        await requestCalendarNotificationPermission();
      updateSettings({ notificationsEnabled });
      if (notificationsEnabled) return;
    } finally {
      setNotificationPermissionPending(false);
    }
    if (!calendarNotificationPermissionGranted()) {
      showToast({
        messageKey: "aiPermissionSteps",
        toastId: "calendar-notification-permission-required",
        type: "warning",
      });
    }
  };
  useEffect(() => {
    if (
      settings.notificationsEnabled &&
      !calendarNotificationPermissionGranted()
    ) {
      updateSettings({ notificationsEnabled: false });
    }
  }, [settings.notificationsEnabled, updateSettings]);
  const updatePreferences = (patch) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    window.localStorage.setItem(
      dateTimePreferenceStorageKey,
      JSON.stringify(next),
    );
    window.dispatchEvent(
      new CustomEvent("munetios:language-time-change", { detail: next }),
    );
  };
  const importFile = async (file, provider) => {
    if (!file) return;
    try {
      const events = parseIcs(
        await file.text(),
        file.name.replace(/\.ics$/iu, ""),
      );
      const data = await loadEncryptedCalendarData(hasSignedInCookie(), {
        workspaceId:
          window.localStorage.getItem("munetiosActiveWorkspace") || "personal",
      });
      const calendar = {
        color: "#4285f4",
        createdAt: new Date().toISOString(),
        events,
        favoriteDates: [],
        id: `import-${crypto.randomUUID()}`,
        name: `${provider} - ${file.name.replace(/\.ics$/iu, "")}`,
        updatedAt: new Date().toISOString(),
        workspaceId:
          window.localStorage.getItem("munetiosActiveWorkspace") || "personal",
      };
      await saveEncryptedCalendarData(
        {
          ...data,
          activeCalendarId: calendar.id,
          calendars: [...data.calendars, calendar],
        },
        hasSignedInCookie(),
      );
      window.dispatchEvent(new Event("munetios:calendarvaultchange"));
      showToast({
        messageKey: "importDataSuccess",
        toastId: "calendar-import-success",
        type: "success",
      });
    } catch {
      showToast({
        messageKey: "importDataFailed",
        toastId: "calendar-import-failed",
        type: "error",
      });
    }
  };
  const exportCalendar = async () => {
    try {
      const data = await loadEncryptedCalendarData(hasSignedInCookie(), {
        workspaceId: "personal",
      });
      const url = URL.createObjectURL(
        new Blob([calendarToIcs(data)], {
          type: "text/calendar;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "Munetios Calendar.ics";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      showToast({
        messageKey: "exportDataFailed",
        toastId: "calendar-export-failed",
        type: "error",
      });
    }
  };
  const nav = [
    ["general", "tune", copy.aiSettingsGeneral],
    ["calendar", "calendar_month", copy.calendarToolbarCalendar],
    ["notifications", "notifications", copy.tasksNotifications],
    ["transfer", "import_export", `${copy.importData} & ${copy.exportData}`],
  ];
  return (
    <div className="calendar-settings-layout">
      <style>{SETTINGS_STYLES}</style>
      <nav aria-label={copy.settings} className="calendar-settings-nav">
        {nav.map(([id, icon, label]) => (
          <button
            aria-current={page === id ? "page" : undefined}
            key={id}
            onClick={() => setPage(id)}
            type="button"
          >
            <icon>{icon}</icon>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <section className="calendar-settings-page">
        {page === "general"
          ? <>
              <h3>{copy.aiSettingsGeneral}</h3>
              <div className="calendar-settings-section">
                <div className="calendar-settings-row">
                  <span>{copy.language}</span>
                  <GlassSelect
                    ariaLabel={copy.language}
                    onChange={(value) => {
                      setLocale(value);
                      setCurrentLocale(value);
                    }}
                    options={localeOptions}
                    value={locale}
                  />
                </div>
                <div className="calendar-settings-row">
                  <span>{copy.accountLanguageCountry}</span>
                  <GlassSelect
                    ariaLabel={copy.accountLanguageCountry}
                    onChange={(country) => updatePreferences({ country })}
                    options={[
                      ["auto", copy.accountLanguageAuto],
                      ...countryOptions,
                    ]}
                    value={preferences.country}
                  />
                </div>
                <div className="calendar-settings-row">
                  <span>{copy.accountLanguageTimezone}</span>
                  <GlassSelect
                    ariaLabel={copy.accountLanguageTimezone}
                    onChange={(timezone) => updatePreferences({ timezone })}
                    options={[["auto", copy.accountLanguageAuto], ...timeZones]}
                    value={preferences.timezone}
                  />
                </div>
                <div className="calendar-settings-row">
                  <span>{copy.accountAppearanceTheme}</span>
                  <GlassSelect
                    ariaLabel={copy.accountAppearanceTheme}
                    onChange={(mode) => {
                      setThemeMode(mode);
                      window.dispatchEvent(
                        new CustomEvent("munetios:appearance-change", {
                          detail: {
                            ...loadAppearanceSettings(),
                            themeMode: mode,
                          },
                        }),
                      );
                    }}
                    options={[
                      ["system", copy.accountAppearanceModeSystem],
                      ["light", copy.accountAppearanceModeLight],
                      ["dark", copy.accountAppearanceModeDark],
                    ]}
                    value={themeMode}
                  />
                </div>
              </div>
              <div className="calendar-settings-section">
                <strong>{copy.calendarWorldClock}</strong>
                <div className="calendar-settings-row">
                  <GlassSelect
                    ariaLabel={copy.calendarWorldClock}
                    onChange={setClockZone}
                    options={timeZones}
                    value={clockZone}
                  />
                  <button
                    className="calendar-settings-action"
                    onClick={() =>
                      updateSettings({
                        worldClocks: [
                          ...new Set([...settings.worldClocks, clockZone]),
                        ],
                      })
                    }
                    type="button"
                  >
                    <icon>add</icon>
                    {copy.calendarWorldClockAdd}
                  </button>
                </div>
                <div className="calendar-settings-clocks">
                  {settings.worldClocks.map((zone) => (
                    <span className="calendar-settings-chip" key={zone}>
                      {zone.replaceAll("_", " ")}
                      <button
                        aria-label={`${copy.delete}: ${zone}`}
                        onClick={() =>
                          updateSettings({
                            worldClocks: settings.worldClocks.filter(
                              (item) => item !== zone,
                            ),
                          })
                        }
                        type="button"
                      >
                        <icon>close</icon>
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </>
          : null}
        {page === "calendar"
          ? <>
              <h3>{copy.calendarToolbarCalendar}</h3>
              <div className="calendar-settings-section">
                <div className="calendar-settings-switch">
                  <span>{copy.calendarAutoAcceptShares}</span>
                  <CustomToggle
                    checked={settings.autoAcceptShares}
                    label={copy.calendarAutoAcceptShares}
                    onChange={(autoAcceptShares) =>
                      updateSettings({ autoAcceptShares })
                    }
                  />
                </div>
              </div>
              <div className="calendar-settings-section">
                <strong>{copy.calendarCustomViews}</strong>
                <div className="calendar-custom-view-form">
                  <input
                    onChange={(event) =>
                      setViewDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder={copy.calendarCustomViewName}
                    value={viewDraft.name}
                  />
                  <GlassSelect
                    ariaLabel={copy.calendarCustomViewType}
                    onChange={(mode) =>
                      setViewDraft((current) => ({ ...current, mode }))
                    }
                    options={[
                      ["days", copy.calendarCustomViewDays],
                      ["range", copy.calendarCustomViewRange],
                    ]}
                    value={viewDraft.mode}
                  />
                  {viewDraft.mode === "days"
                    ? <input
                        min="1"
                        max="366"
                        onChange={(event) =>
                          setViewDraft((current) => ({
                            ...current,
                            days: event.target.value,
                          }))
                        }
                        type="number"
                        value={viewDraft.days}
                      />
                    : <div className="calendar-custom-view-actions">
                        <DatePicker
                          copy={copy}
                          label={copy.calendarCustomViewStart}
                          onChange={(start) =>
                            setViewDraft((current) => ({ ...current, start }))
                          }
                          value={viewDraft.start}
                        />
                        <DatePicker
                          copy={copy}
                          label={copy.calendarCustomViewEnd}
                          onChange={(end) =>
                            setViewDraft((current) => ({ ...current, end }))
                          }
                          value={viewDraft.end}
                        />
                      </div>}
                  <button
                    className="calendar-settings-action"
                    disabled={
                      !viewDraft.name.trim() ||
                      (viewDraft.mode === "range" &&
                        (!viewDraft.start || !viewDraft.end))
                    }
                    onClick={() => {
                      updateSettings({
                        customViews: [
                          ...settings.customViews,
                          { ...viewDraft, id: crypto.randomUUID() },
                        ],
                      });
                      setViewDraft({
                        days: 2,
                        end: "",
                        mode: "days",
                        name: "",
                        start: "",
                      });
                    }}
                    type="button"
                  >
                    <icon>add</icon>
                    {copy.calendarCustomViewAdd}
                  </button>
                </div>
                {settings.customViews.map((view) => (
                  <span className="calendar-settings-chip" key={view.id}>
                    {view.name}
                    <button
                      aria-label={`${copy.delete}: ${view.name}`}
                      onClick={() =>
                        updateSettings({
                          customViews: settings.customViews.filter(
                            (item) => item.id !== view.id,
                          ),
                        })
                      }
                      type="button"
                    >
                      <icon>close</icon>
                    </button>
                  </span>
                ))}
              </div>
              <div className="calendar-settings-section">
                <strong>{copy.calendarHolidayCountries}</strong>
                <div className="calendar-settings-switch">
                  <span>{copy.calendarHolidayAllCountries}</span>
                  <CustomToggle
                    checked={settings.allHolidayCountries}
                    label={copy.calendarHolidayAllCountries}
                    onChange={(allHolidayCountries) =>
                      updateSettings({
                        allHolidayCountries,
                      })
                    }
                  />
                </div>
                <div className="calendar-settings-country-grid">
                  {countryOptions.map(([code, name]) => (
                    <div
                      className="calendar-settings-country-option"
                      key={code}
                    >
                      <CustomCheckbox
                        checked={settings.holidayCountries.includes(code)}
                        disabled={settings.allHolidayCountries}
                        label={name}
                        onChange={(checked) =>
                          updateSettings({
                            holidayCountries: checked
                              ? [...settings.holidayCountries, code]
                              : settings.holidayCountries.filter(
                                  (country) => country !== code,
                                ),
                          })
                        }
                      />
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="calendar-settings-section">
                <div className="calendar-settings-row">
                  <span>{copy.calendarWeekStartsWith}</span>
                  <GlassSelect
                    ariaLabel={copy.calendarWeekStartsWith}
                    onChange={(weekStarts) => updatePreferences({ weekStarts })}
                    options={[
                      ["sunday", copy.weekdaySunday],
                      ["monday", copy.weekdayMonday],
                      ["tuesday", copy.weekdayTuesday],
                      ["wednesday", copy.weekdayWednesday],
                      ["thursday", copy.weekdayThursday],
                      ["friday", copy.weekdayFriday],
                      ["saturday", copy.weekdaySaturday],
                    ]}
                    value={preferences.weekStarts}
                  />
                </div>
              </div>
            </>
          : null}
        {page === "notifications"
          ? <>
              <h3>{copy.tasksNotifications}</h3>
              <div className="calendar-settings-section">
                <div className="calendar-settings-switch">
                  <span>{copy.calendarNotificationsEnabled}</span>
                  <CustomToggle
                    checked={settings.notificationsEnabled}
                    disabled={notificationPermissionPending}
                    label={copy.calendarNotificationsEnabled}
                    onChange={(enabled) =>
                      void updateEventNotifications(enabled)
                    }
                  />
                </div>
                <div className="calendar-settings-row">
                  <span>{copy.calendarReminderMinutes}</span>
                  <GlassSelect
                    ariaLabel={copy.calendarReminderMinutes}
                    onChange={(value) =>
                      updateSettings({ reminderMinutes: Number(value) })
                    }
                    options={[0, 5, 10, 15, 30, 60, 1440].map((value) => [
                      String(value),
                      copy.meetDurationMinutes.replace("{count}", value),
                    ])}
                    value={String(settings.reminderMinutes)}
                  />
                </div>
                <div className="calendar-settings-row">
                  <span>{copy.calendarSnoozeMinutes}</span>
                  <GlassSelect
                    ariaLabel={copy.calendarSnoozeMinutes}
                    onChange={(value) =>
                      updateSettings({ snoozeMinutes: Number(value) })
                    }
                    options={[5, 10, 15, 30, 60].map((value) => [
                      String(value),
                      copy.meetDurationMinutes.replace("{count}", value),
                    ])}
                    value={String(settings.snoozeMinutes)}
                  />
                </div>
              </div>
            </>
          : null}
        {page === "transfer"
          ? <>
              <h3>{`${copy.importData} & ${copy.exportData}`}</h3>
              <div className="calendar-settings-section">
                <strong>{copy.importData}</strong>
                <button
                  className="calendar-settings-action"
                  onClick={() => importFileRef.current?.click()}
                  type="button"
                >
                  <icon>upload_file</icon>
                  <span>{copy.importData}</span>
                  <input
                    accept=".ics,text/calendar"
                    hidden
                    onChange={(event) =>
                      void importFile(event.target.files?.[0], copy.importData)
                    }
                    ref={importFileRef}
                    type="file"
                  />
                </button>
              </div>
              <div className="calendar-settings-section">
                <strong>{copy.exportData}</strong>
                <p>{copy.calendarExportDescription}</p>
                <button
                  className="calendar-settings-action primary"
                  onClick={() => void exportCalendar()}
                  type="button"
                >
                  <icon>download</icon>
                  {copy.calendarExportIcs}
                </button>
              </div>
            </>
          : null}
        <button
          className="calendar-settings-action"
          onClick={close}
          type="button"
        >
          {copy.calendarDone}
        </button>
      </section>
    </div>
  );
}

export default function CalendarSettingsRuntime() {
  useEffect(() => {
    const open = () => {
      const copy = t();
      showModal(({ close }) => <CalendarSettings close={close} />, {
        ariaLabel: copy.settings,
        title: <CalendarSettingsTitle />,
        width: "min(68rem, calc(100vw - 1rem))",
      });
    };
    window.addEventListener("munetios:calendarsettings", open);
    return () => window.removeEventListener("munetios:calendarsettings", open);
  }, []);
  return null;
}
