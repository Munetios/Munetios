"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale } from "../i18n";
import {
  dateTimePreferenceStorageKey,
  defaultDateTimePreferences,
  formatUserDate,
  formatUserTime,
  loadDateTimePreferences,
} from "../lib/dateTimePreferences";
import { getCountryCurrency } from "../lib/regionPreferences";
import DropdownWrapper from "./dropdownwrapper";
import LanguageSelector from "./languageSelector";
import { showToast } from "./toast";

function PreferenceDropdown({ label, onChange, options, value }) {
  const selected =
    options.find((option) => option.value === value) || options[0];

  return (
    <div className="min-w-0">
      <span className="mb-2 block text-sm font-semibold text-white/80">
        {label}
      </span>
      <DropdownWrapper
        align="left"
        ariaLabel={label}
        buttonClassName="h-11 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left hover:border-purple-200/35 hover:bg-white/15!"
        className="w-full"
        panelClassName="max-h-80 w-[min(28rem,calc(100vw-1rem))] overflow-y-auto"
        trigger={
          <>
            <span className="min-w-0 truncate">{selected?.label}</span>
            <icon className="shrink-0 text-white/60">expand_more</icon>
          </>
        }
      >
        <div className="space-y-1">
          {options.map((option) => (
            <button
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent bg-transparent px-3 py-2 text-left text-sm text-white transition hover:border-white/10 hover:bg-white/10!"
              key={option.value}
              onClick={() => onChange(option.value)}
              role="menuitem"
              type="button"
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {option.value === value ? <icon>check</icon> : null}
            </button>
          ))}
        </div>
      </DropdownWrapper>
    </div>
  );
}

function getCountryName(country, locale) {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(country);
  } catch {
    return country;
  }
}

function getTimezoneLabel(timezone) {
  return timezone.replaceAll("_", " ").replaceAll("/", " / ");
}

function getWeekdayOptions(locale) {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
  });
  const values = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  return values.map((value, index) => ({
    label: formatter.format(new Date(Date.UTC(2024, 0, 7 + index))),
    value,
  }));
}

export default function AccountLanguageTimeSection({ copy }) {
  const [preferences, setPreferences] = useState(loadDateTimePreferences);
  const [location, setLocation] = useState({
    countries: ["US"],
    detectedCountry: "US",
    detectedRegion: null,
    detectedTimezone: "UTC",
    timezones: ["UTC"],
  });
  const locale = getCurrentLocale();

  useEffect(() => {
    let active = true;

    Promise.all([
      fetch("/api/timezone", {
        headers: { Accept: "application/json" },
      }),
      fetch("/api/country", {
        headers: { Accept: "application/json" },
      }),
    ])
      .then(async ([timezoneResponse, countryResponse]) => {
        if (!timezoneResponse.ok || !countryResponse.ok) {
          throw new Error("Location preference request failed");
        }

        const [timezonePayload, countryPayload] = await Promise.all([
          timezoneResponse.json(),
          countryResponse.json(),
        ]);

        if (!active) return;
        const detectedCountry = countryPayload.detectedCountry || "US";
        setLocation({
          countries: Array.isArray(countryPayload.countries)
            ? countryPayload.countries
            : ["US"],
          detectedCountry,
          detectedRegion: countryPayload.detectedRegion || null,
          detectedTimezone: timezonePayload.detectedTimezone || "UTC",
          timezones: Array.isArray(timezonePayload.timezones)
            ? timezonePayload.timezones
            : ["UTC"],
        });
        setPreferences((currentPreferences) => {
          if (currentPreferences.detectedCountry === detectedCountry) {
            return currentPreferences;
          }
          const nextPreferences = {
            ...currentPreferences,
            detectedCountry,
          };
          window.localStorage.setItem(
            dateTimePreferenceStorageKey,
            JSON.stringify(nextPreferences),
          );
          window.dispatchEvent(
            new CustomEvent("munetios:language-time-change", {
              detail: nextPreferences,
            }),
          );
          return nextPreferences;
        });
      })
      .catch(() => {
        if (active) {
          showToast({
            message: copy.accountLanguageLocationFetchFailed,
            type: "error",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [copy.accountLanguageLocationFetchFailed]);

  const updatePreference = (key, value) => {
    setPreferences((currentPreferences) => {
      const nextPreferences = { ...currentPreferences, [key]: value };
      window.localStorage.setItem(
        dateTimePreferenceStorageKey,
        JSON.stringify(nextPreferences),
      );
      window.dispatchEvent(
        new CustomEvent("munetios:language-time-change", {
          detail: nextPreferences,
        }),
      );
      return nextPreferences;
    });
  };

  const countryOptions = useMemo(() => {
    const detectedCountryName = getCountryName(
      location.detectedCountry,
      locale,
    );
    const detectedLocation = location.detectedRegion
      ? `${detectedCountryName} · ${location.detectedRegion}`
      : detectedCountryName;
    const autoLabel = copy.accountLanguageAutoCountry.replace(
      "{country}",
      detectedLocation,
    );

    return [
      { label: autoLabel, value: "auto" },
      ...location.countries
        .map((country) => ({
          label: getCountryName(country, locale),
          value: country,
        }))
        .sort((first, second) =>
          first.label.localeCompare(second.label, locale, {
            sensitivity: "base",
          }),
        ),
    ];
  }, [copy.accountLanguageAutoCountry, locale, location]);

  const timezoneOptions = useMemo(
    () => [
      {
        label: `${copy.accountLanguageAuto} (${getTimezoneLabel(location.detectedTimezone)})`,
        value: "auto",
      },
      ...location.timezones.map((timezone) => ({
        label: getTimezoneLabel(timezone),
        value: timezone,
      })),
    ],
    [copy.accountLanguageAuto, location.detectedTimezone, location.timezones],
  );

  const dateFormatOptions = [
    { label: copy.accountLanguageAuto, value: "auto" },
    { label: "MM/DD/YYYY", value: "MM/DD/YYYY" },
    { label: "DD/MM/YYYY", value: "DD/MM/YYYY" },
    { label: "YYYY-MM-DD", value: "YYYY-MM-DD" },
    { label: `${copy.accountLanguageDateFormat}…`, value: "custom" },
  ];
  const timeFormatOptions = [
    { label: copy.accountLanguageAuto, value: "auto" },
    { label: copy.accountLanguage12Hour, value: "12-hour" },
    { label: copy.accountLanguage24Hour, value: "24-hour" },
  ];
  const effectiveCountry =
    preferences.country === "auto"
      ? location.detectedCountry
      : preferences.country;
  const currencyOptions = [
    {
      label: `${copy.accountLanguageAuto} (${getCountryCurrency(effectiveCountry)})`,
      value: "auto",
    },
    { label: "USD", value: "USD" },
    { label: "EUR", value: "EUR" },
    { label: "GBP", value: "GBP" },
    { label: "CAD", value: "CAD" },
    { label: "AUD", value: "AUD" },
  ];
  const numberFormatOptions = [
    {
      label: `${copy.accountLanguageAuto} (${getCountryName(effectiveCountry, locale)})`,
      value: "auto",
    },
    { label: copy.accountLanguageUiLanguage, value: "language" },
  ];
  const weekOptions = getWeekdayOptions(locale);
  const previewDate = new Date(2026, 6, 30, 17, 45);
  const previewPreferences = {
    ...defaultDateTimePreferences,
    ...preferences,
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">
          {copy.accountSettingsLanguageTime}
        </h1>
        <p className="mt-2 text-sm leading-6 text-white/65">
          {copy.accountLanguagePreferencesDescription}
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="mb-2 block text-sm font-semibold text-white/80">
            {copy.accountLanguageUiLanguage}
          </span>
          <LanguageSelector
            buttonClassName="h-11 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 hover:border-purple-200/35 hover:bg-white/15!"
            copy={copy}
          />
        </div>
        <PreferenceDropdown
          label={copy.accountLanguageTimezone}
          onChange={(value) => updatePreference("timezone", value)}
          options={timezoneOptions}
          value={preferences.timezone}
        />
        <PreferenceDropdown
          label={copy.accountLanguageDateFormat}
          onChange={(value) => updatePreference("dateFormat", value)}
          options={dateFormatOptions}
          value={preferences.dateFormat}
        />
        <PreferenceDropdown
          label={copy.accountLanguageTimeFormat}
          onChange={(value) => updatePreference("timeFormat", value)}
          options={timeFormatOptions}
          value={preferences.timeFormat}
        />
        <PreferenceDropdown
          label={copy.accountLanguageCountry}
          onChange={(value) => updatePreference("country", value)}
          options={countryOptions}
          value={preferences.country}
        />
        <PreferenceDropdown
          label={copy.accountLanguageCurrency}
          onChange={(value) => updatePreference("currency", value)}
          options={currencyOptions}
          value={preferences.currency}
        />
        <PreferenceDropdown
          label={copy.accountLanguageNumberFormat}
          onChange={(value) => updatePreference("numberFormat", value)}
          options={numberFormatOptions}
          value={preferences.numberFormat}
        />
        <PreferenceDropdown
          label={copy.accountLanguageWeekStarts}
          onChange={(value) => updatePreference("weekStarts", value)}
          options={weekOptions}
          value={preferences.weekStarts}
        />
        {preferences.dateFormat === "custom"
          ? <label className="min-w-0 sm:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-white/80">
                {copy.accountLanguageDateFormat}
              </span>
              <input
                className="h-11 w-full rounded-xl border border-white/10 bg-white/10! px-3 text-white outline-none transition placeholder:text-white/35 focus:border-purple-200/45"
                maxLength={80}
                onChange={(event) =>
                  updatePreference("customDateFormat", event.target.value)
                }
                placeholder="dddd, MMMM D, YYYY"
                type="text"
                value={preferences.customDateFormat}
              />
              <small className="mt-2 block text-xs leading-5 text-white/55">
                YYYY · YY · MMMM · MMM · MM · M · DD · D · dddd · ddd
              </small>
            </label>
          : null}
        <label className="min-w-0">
          <span className="mb-2 block text-sm font-semibold text-white/80">
            AM
          </span>
          <input
            className="h-11 w-full rounded-xl border border-white/10 bg-white/10! px-3 text-white outline-none transition placeholder:text-white/35 focus:border-purple-200/45"
            maxLength={20}
            onChange={(event) =>
              updatePreference("amSymbol", event.target.value)
            }
            placeholder="AM"
            type="text"
            value={preferences.amSymbol}
          />
        </label>
        <label className="min-w-0">
          <span className="mb-2 block text-sm font-semibold text-white/80">
            PM
          </span>
          <input
            className="h-11 w-full rounded-xl border border-white/10 bg-white/10! px-3 text-white outline-none transition placeholder:text-white/35 focus:border-purple-200/45"
            maxLength={20}
            onChange={(event) =>
              updatePreference("pmSymbol", event.target.value)
            }
            placeholder="PM"
            type="text"
            value={preferences.pmSymbol}
          />
        </label>
      </div>
      <div className="liquid-glass mt-4 rounded-2xl border border-white/10 p-4">
        <strong className="mt-2 block text-base text-white">
          {formatUserDate(previewDate, {
            locale,
            preferences: previewPreferences,
          })}
          {" · "}
          {formatUserTime(previewDate, {
            locale,
            preferences: previewPreferences,
          })}
        </strong>
      </div>
      <p className="mt-4 text-xs leading-5 text-white/55">
        Your IP address is used to detect your country automatically. IP
        addresses are not shown.
      </p>
    </div>
  );
}
