"use client";

import { supportedCountryCodes } from "../../../lib/supportedCountries";

export const calendarSettingsStorageKey = "munetios.calendar.settings.v1";
export const calendarSettingsChangeEvent = "munetios:calendarsettingschange";

export const calendarSettingsDefaults = Object.freeze({
  allHolidayCountries: false,
  autoAcceptShares: false,
  customViews: [],
  holidayCountries: [],
  notificationsEnabled: true,
  reminderMinutes: 15,
  snoozeMinutes: 10,
  worldClocks: [],
});

const availableCalendarCountries = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["MX", "Mexico"],
  ["BR", "Brazil"],
  ["AR", "Argentina"],
  ["GB", "United Kingdom"],
  ["IE", "Ireland"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["CH", "Switzerland"],
  ["IT", "Italy"],
  ["ES", "Spain"],
  ["PT", "Portugal"],
  ["NL", "Netherlands"],
  ["BE", "Belgium"],
  ["DK", "Denmark"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["FI", "Finland"],
  ["PL", "Poland"],
  ["GR", "Greece"],
  ["TR", "Türkiye"],
  ["RU", "Russia"],
  ["SA", "Saudi Arabia"],
  ["IL", "Israel"],
  ["IN", "India"],
  ["TH", "Thailand"],
  ["MY", "Malaysia"],
  ["ID", "Indonesia"],
  ["VN", "Vietnam"],
  ["CN", "China"],
  ["TW", "Taiwan"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
];

const calendarCountryNames = new Map(availableCalendarCountries);
export const calendarCountries = supportedCountryCodes.map((code) => [
  code,
  calendarCountryNames.get(code) || code,
]);

function normalizeView(view, index) {
  const days = Math.max(1, Math.min(366, Number(view?.days) || 1));
  return {
    days,
    end: /^\d{4}-\d{2}-\d{2}$/u.test(view?.end || "") ? view.end : "",
    id: String(view?.id || `custom-view-${index + 1}`).slice(0, 100),
    mode: view?.mode === "range" ? "range" : "days",
    name: String(view?.name || "")
      .trim()
      .slice(0, 80),
    start: /^\d{4}-\d{2}-\d{2}$/u.test(view?.start || "") ? view.start : "",
  };
}

export function loadCalendarSettings() {
  if (typeof window === "undefined") return { ...calendarSettingsDefaults };
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(calendarSettingsStorageKey) || "{}",
    );
    return {
      ...calendarSettingsDefaults,
      ...stored,
      customViews: Array.isArray(stored.customViews)
        ? stored.customViews
            .slice(0, 30)
            .map(normalizeView)
            .filter((view) => view.name)
        : [],
      holidayCountries: Array.isArray(stored.holidayCountries)
        ? [
            ...new Set(
              stored.holidayCountries.filter((country) =>
                calendarCountries.some(([code]) => code === country),
              ),
            ),
          ]
        : [],
      worldClocks: Array.isArray(stored.worldClocks)
        ? [
            ...new Set(
              stored.worldClocks.filter((zone) => typeof zone === "string"),
            ),
          ].slice(0, 12)
        : [],
    };
  } catch {
    return { ...calendarSettingsDefaults };
  }
}

export function saveCalendarSettings(settings) {
  const normalized = { ...calendarSettingsDefaults, ...settings };
  window.localStorage.setItem(
    calendarSettingsStorageKey,
    JSON.stringify(normalized),
  );
  window.dispatchEvent(
    new CustomEvent(calendarSettingsChangeEvent, { detail: normalized }),
  );
  return normalized;
}

export function getTimeZones() {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Paris",
      "Asia/Tokyo",
      "Australia/Sydney",
    ];
  }
}
