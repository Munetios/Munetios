import {
  getRegionalLocale,
  resolvePreferenceCountry,
  resolvePreferenceCurrency,
} from "./regionPreferences.js";

export const dateTimePreferenceStorageKey = "munetios.accountLanguageTime";

export const defaultDateTimePreferences = Object.freeze({
  amSymbol: "",
  country: "auto",
  currency: "auto",
  customDateFormat: "MM/DD/YYYY",
  dateFormat: "auto",
  detectedCountry: "US",
  numberFormat: "auto",
  pmSymbol: "",
  timeFormat: "auto",
  timezone: "auto",
  weekStarts: "sunday",
});

export function loadDateTimePreferences() {
  if (typeof window === "undefined") {
    return { ...defaultDateTimePreferences };
  }
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(dateTimePreferenceStorageKey) || "{}",
    );
    return { ...defaultDateTimePreferences, ...stored };
  } catch {
    return { ...defaultDateTimePreferences };
  }
}

export function getUserLocale(locale) {
  if (locale) return locale;
  if (typeof document !== "undefined" && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  return typeof navigator !== "undefined"
    ? navigator.language || "en-US"
    : "en-US";
}

export function getTimeZone(preferences) {
  return preferences.timezone && preferences.timezone !== "auto"
    ? preferences.timezone
    : undefined;
}

export function getFormattingLocale(locale, preferences) {
  const userLocale = getUserLocale(locale);
  return preferences.numberFormat === "auto"
    ? getRegionalLocale(userLocale, preferences)
    : userLocale;
}

export function getUserCountry(preferences = loadDateTimePreferences()) {
  return resolvePreferenceCountry(preferences);
}

export function getUserCurrency(preferences = loadDateTimePreferences()) {
  return resolvePreferenceCurrency(preferences);
}

export function formatUserNumber(value, options = {}) {
  const preferences = options.preferences || loadDateTimePreferences();
  const locale = getFormattingLocale(options.locale, preferences);
  return new Intl.NumberFormat(locale, options.formatOptions).format(value);
}

export function getUserHour12(locale, preferences) {
  if (preferences.timeFormat === "12-hour") return true;
  if (preferences.timeFormat === "24-hour") return false;
  return new Intl.DateTimeFormat(getUserLocale(locale), {
    hour: "numeric",
  }).resolvedOptions().hour12;
}

function formatCustomDate(date, locale, preferences, timeZoneOverride) {
  const timeZone = timeZoneOverride || getTimeZone(preferences);
  const numericParts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  })
    .formatToParts(date)
    .reduce((parts, part) => {
      if (part.type !== "literal") parts[part.type] = part.value;
      return parts;
    }, {});
  const monthLong = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone,
  }).format(date);
  const monthShort = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone,
  }).format(date);
  const weekdayLong = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
  }).format(date);
  const weekdayShort = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
  }).format(date);
  const replacements = {
    D: String(Number(numericParts.day)),
    DD: numericParts.day,
    M: String(Number(numericParts.month)),
    MM: numericParts.month,
    MMM: monthShort,
    MMMM: monthLong,
    YY: String(numericParts.year).slice(-2),
    YYYY: numericParts.year,
    ddd: weekdayShort,
    dddd: weekdayLong,
  };
  const pattern =
    String(preferences.customDateFormat || "").trim() || "MM/DD/YYYY";
  return pattern.replace(
    /YYYY|MMMM|dddd|MMM|ddd|YY|MM|DD|M|D/g,
    (token) => replacements[token],
  );
}

export function formatUserDate(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const preferences = options.preferences || loadDateTimePreferences();
  const locale =
    preferences.dateFormat === "auto"
      ? getRegionalLocale(getUserLocale(options.locale), preferences)
      : getUserLocale(options.locale);
  const timeZone = options.timeZone || getTimeZone(preferences);
  if (preferences.dateFormat === "custom") {
    return formatCustomDate(date, locale, preferences, timeZone);
  }
  if (preferences.dateFormat && preferences.dateFormat !== "auto") {
    return formatCustomDate(
      date,
      locale,
      {
        ...preferences,
        customDateFormat: preferences.dateFormat,
      },
      timeZone,
    );
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: options.dateStyle || "medium",
    timeZone,
  }).format(date);
}

export function formatUserTime(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const preferences = options.preferences || loadDateTimePreferences();
  const locale =
    preferences.timeFormat === "auto"
      ? getRegionalLocale(getUserLocale(options.locale), preferences)
      : getUserLocale(options.locale);
  const hour12 = getUserHour12(locale, preferences);
  const timeZone = options.timeZone || getTimeZone(preferences);
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    hour12,
    minute: "2-digit",
    second: options.includeSeconds ? "2-digit" : undefined,
    timeZone,
  });
  const amSymbol = String(preferences.amSymbol || "").trim();
  const pmSymbol = String(preferences.pmSymbol || "").trim();
  if (!hour12 || (!amSymbol && !pmSymbol)) return formatter.format(date);
  return formatter
    .formatToParts(date)
    .map((part) => {
      if (part.type !== "dayPeriod") return part.value;
      return Number(
        new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          hour12: false,
          timeZone,
        })
          .formatToParts(date)
          .find((entry) => entry.type === "hour")?.value,
      ) >= 12
        ? pmSymbol || part.value
        : amSymbol || part.value;
    })
    .join("");
}

export function formatUserDateTime(value, options = {}) {
  const date = formatUserDate(value, options);
  const time = formatUserTime(value, options);
  return [date, time].filter(Boolean).join(" ");
}
