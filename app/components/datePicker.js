"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale } from "../i18n";
import DropdownWrapper from "./dropdownwrapper";

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? { day: Number(match[3]), month: Number(match[2]), year: Number(match[1]) }
    : { day: null, month: null, year: null };
}

function Selector({ ariaLabel, label, onSelect, options, value }) {
  return (
    <DropdownWrapper
      align="left"
      ariaLabel={ariaLabel}
      buttonClassName="h-12 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left hover:border-purple-200/35 hover:bg-white/15!"
      className="min-w-0"
      panelClassName="max-h-72 w-[min(18rem,calc(100vw-1rem))] overflow-y-auto"
      triggerAs="div"
      trigger={
        <>
          <span className="truncate">{label}</span>
          <icon>expand_more</icon>
        </>
      }
    >
      <div className="space-y-1">
        {options.map((option) => (
          <button
            aria-checked={option.value === value}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10!"
            key={option.value}
            onClick={() => onSelect(option.value)}
            role="menuitemradio"
            type="button"
          >
            <span>{option.label}</span>
            {option.value === value ? <icon>check</icon> : null}
          </button>
        ))}
      </div>
    </DropdownWrapper>
  );
}

export default function DatePicker({
  copy,
  label,
  maximumYear,
  minimumYear = 1900,
  onChange,
  value,
}) {
  const [selected, setSelected] = useState(() => parseDate(value));
  const currentYear = new Date().getFullYear();
  const lastYear = Math.max(minimumYear, maximumYear || currentYear);
  const locale = getCurrentLocale();
  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        label: new Intl.DateTimeFormat(locale, {
          month: "long",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(2024, index, 1))),
        value: index + 1,
      })),
    [locale],
  );
  const yearOptions = useMemo(
    () =>
      Array.from({ length: lastYear - minimumYear + 1 }, (_, index) => ({
        label: String(lastYear - index),
        value: lastYear - index,
      })),
    [lastYear, minimumYear],
  );
  const daysInMonth = selected.month
    ? new Date(selected.year || currentYear, selected.month, 0).getDate()
    : 31;
  const dayOptions = Array.from({ length: daysInMonth }, (_, index) => ({
    label: String(index + 1),
    value: index + 1,
  }));

  useEffect(() => {
    if (value) setSelected(parseDate(value));
  }, [value]);

  const updateDate = (part, nextValue) => {
    const next = { ...selected, [part]: nextValue };
    if (part === "month" || part === "year") {
      const maximumDay = new Date(
        next.year || currentYear,
        next.month || 1,
        0,
      ).getDate();
      if (next.day > maximumDay) next.day = maximumDay;
    }
    setSelected(next);
    if (next.year && next.month && next.day) {
      onChange(
        `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`,
      );
      return;
    }
  };

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-white/80">
        {label}
      </legend>
      <div className="grid grid-cols-[1.35fr_0.8fr_1fr] gap-2">
        <Selector
          ariaLabel={copy.datePickerMonth}
          label={
            selected.month
              ? monthOptions[selected.month - 1].label
              : copy.datePickerMonth
          }
          onSelect={(month) => updateDate("month", month)}
          options={monthOptions}
          value={selected.month}
        />
        <Selector
          ariaLabel={copy.datePickerDay}
          label={selected.day || copy.datePickerDay}
          onSelect={(day) => updateDate("day", day)}
          options={dayOptions}
          value={selected.day}
        />
        <Selector
          ariaLabel={copy.datePickerYear}
          label={selected.year || copy.datePickerYear}
          onSelect={(year) => updateDate("year", year)}
          options={yearOptions}
          value={selected.year}
        />
      </div>
    </fieldset>
  );
}
