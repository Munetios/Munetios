"use client";

import {
  formatUserTime,
  loadDateTimePreferences,
} from "../lib/dateTimePreferences";
import CustomToggle from "./customToggle";
import DropdownWrapper from "./dropdownwrapper";

const dayOrder = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function timeOptions(locale) {
  const preferences = loadDateTimePreferences();
  return Array.from({ length: 48 }, (_, index) => {
    const hour = Math.floor(index / 2);
    const minute = index % 2 === 0 ? 0 : 30;
    return {
      label: formatUserTime(new Date(2024, 0, 1, hour, minute), {
        locale,
        preferences,
      }),
      value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    };
  });
}

function TimeSelect({ ariaLabel, locale, onChange, value }) {
  const options = timeOptions(locale);
  return (
    <DropdownWrapper
      align="left"
      ariaLabel={ariaLabel}
      buttonClassName="min-w-28 justify-between"
      panelClassName="max-h-72 w-36 overflow-y-auto"
      label={options.find((option) => option.value === value)?.label || value}
    >
      {options.map((option) => (
        <button
          aria-checked={option.value === value}
          data-dropdown-close
          key={option.value}
          onClick={() => onChange(option.value)}
          role="menuitemradio"
          type="button"
        >
          <span>{option.label}</span>
          {option.value === value ? <icon>check</icon> : null}
        </button>
      ))}
    </DropdownWrapper>
  );
}

export default function FamilyTimeSchedulePicker({
  copy,
  locale,
  onChange,
  value,
}) {
  const schedule = value;
  const update = (patch) => onChange({ ...schedule, ...patch });
  const dayLabels = {
    fri: copy.dayFriShort,
    mon: copy.dayMonShort,
    sat: copy.daySatShort,
    sun: copy.daySunShort,
    thu: copy.dayThuShort,
    tue: copy.dayTueShort,
    wed: copy.dayWedShort,
  };

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5! p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">
          {copy.familyAiScheduleRestrict}
        </span>
        <CustomToggle
          checked={schedule.enabled}
          label={copy.familyAiScheduleRestrict}
          onChange={(enabled) => update({ enabled })}
        />
      </div>
      {schedule.enabled
        ? <>
            <div className="flex flex-wrap items-center gap-2">
              {dayOrder.map((day) => {
                const active = schedule.days?.[day] !== false;
                return (
                  <button
                    aria-pressed={active}
                    className={`h-9 w-11 rounded-xl text-xs font-semibold transition ${
                      active
                        ? "border border-purple-200/30 bg-purple-500/35! text-white"
                        : "border border-white/10 bg-white/5! text-white/60 hover:bg-white/10!"
                    }`}
                    key={day}
                    onClick={() =>
                      update({
                        days: { ...schedule.days, [day]: !active },
                      })
                    }
                    type="button"
                  >
                    {dayLabels[day]}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/60">{copy.familyAiScheduleFrom}</span>
              <TimeSelect
                ariaLabel={copy.familyAiScheduleFrom}
                locale={locale}
                onChange={(start) => update({ start })}
                value={schedule.start}
              />
              <span className="text-white/60">{copy.familyAiScheduleTo}</span>
              <TimeSelect
                ariaLabel={copy.familyAiScheduleTo}
                locale={locale}
                onChange={(end) => update({ end })}
                value={schedule.end}
              />
            </div>
          </>
        : null}
    </div>
  );
}
