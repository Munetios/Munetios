"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale } from "../i18n";
import {
  formatUserTime,
  getTimeZone,
  loadDateTimePreferences,
} from "../lib/dateTimePreferences";
import DropdownWrapper from "./dropdownwrapper";

function TimeSelector({ label, onSelect, options, value }) {
  return (
    <DropdownWrapper
      align="left"
      ariaLabel={label}
      buttonClassName="h-12 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left"
      className="min-w-0 flex-1"
      panelClassName="max-h-72 w-40 overflow-y-auto"
      trigger={
        <>
          <span>
            {options.find((option) => option.value === value)?.label || label}
          </span>
          <icon>expand_more</icon>
        </>
      }
      triggerAs="div"
    >
      {options.map((option) => (
        <button
          aria-checked={option.value === value}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm"
          data-dropdown-close
          key={option.value}
          onClick={() => onSelect(option.value)}
          role="menuitemradio"
          type="button"
        >
          {option.label}
          {option.value === value ? <icon>check</icon> : null}
        </button>
      ))}
    </DropdownWrapper>
  );
}

export default function TimePicker({
  copy,
  label,
  minuteStep = 5,
  onChange,
  value,
}) {
  const [hour = "", minute = ""] = String(value || "").split(":");
  const [locale, setLocale] = useState(() => getCurrentLocale());
  const [preferences, setPreferences] = useState(() =>
    loadDateTimePreferences(),
  );
  useEffect(() => {
    const refreshLocale = () => setLocale(getCurrentLocale());
    const refreshPreferences = () => setPreferences(loadDateTimePreferences());
    window.addEventListener("munetios:languagechange", refreshLocale);
    window.addEventListener("munetios:localechange", refreshLocale);
    window.addEventListener(
      "munetios:language-time-change",
      refreshPreferences,
    );
    window.addEventListener("storage", refreshPreferences);
    return () => {
      window.removeEventListener("munetios:languagechange", refreshLocale);
      window.removeEventListener("munetios:localechange", refreshLocale);
      window.removeEventListener(
        "munetios:language-time-change",
        refreshPreferences,
      );
      window.removeEventListener("storage", refreshPreferences);
    };
  }, []);
  const hours = useMemo(
    () =>
      Array.from({ length: 24 }, (_, index) => ({
        label: formatUserTime(new Date(Date.UTC(2024, 0, 1, index)), {
          locale,
          preferences,
          timeZone: "UTC",
        }),
        value: String(index).padStart(2, "0"),
      })),
    [locale, preferences],
  );
  const resolvedMinuteStep = Math.max(1, Math.min(60, Number(minuteStep) || 5));
  const currentHour = useMemo(() => {
    const hourPart = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: getTimeZone(preferences),
    })
      .formatToParts(new Date())
      .find((part) => part.type === "hour")?.value;
    return String(hourPart || "00").padStart(2, "0");
  }, [preferences]);
  const minutes = Array.from(
    {
      length: Math.ceil(60 / resolvedMinuteStep),
    },
    (_, index) => ({
      label: String(index * resolvedMinuteStep).padStart(2, "0"),
      value: String(index * resolvedMinuteStep).padStart(2, "0"),
    }),
  );

  return (
    <fieldset className="calendar-time-picker">
      <legend>{label}</legend>
      <div>
        <TimeSelector
          label={copy.tasksHour}
          onSelect={(nextHour) => onChange(`${nextHour}:${minute || "00"}`)}
          options={hours}
          value={hour}
        />
        <span>:</span>
        <TimeSelector
          label={copy.tasksMinute}
          onSelect={(nextMinute) =>
            onChange(`${hour || currentHour}:${nextMinute}`)
          }
          options={minutes}
          value={minute}
        />
      </div>
    </fieldset>
  );
}
