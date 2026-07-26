"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { getCurrentLocale } from "../i18n";
import DropdownWrapper from "./dropdownwrapper";
import Wrapper from "./wrapper";

const dropdownButtonClassName =
  "flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5! px-3 py-2.5 text-left text-sm text-white outline-none transition hover:border-white/20 focus:border-purple-300/60 focus:bg-purple-950/30! disabled:cursor-not-allowed disabled:opacity-55";

function normalizeOptions(options) {
  return options.map((option) =>
    option && typeof option === "object"
      ? {
          disabled: Boolean(option.disabled),
          label: String(option.label ?? option.value ?? ""),
          value: option.value ?? "",
        }
      : {
          disabled: false,
          label: String(option ?? ""),
          value: option ?? "",
        },
  );
}

function findEnabledOption(options, startIndex, direction) {
  if (options.length === 0) {
    return -1;
  }

  for (let offset = 1; offset <= options.length; offset += 1) {
    const index =
      (startIndex + direction * offset + options.length) % options.length;

    if (!options[index].disabled) {
      return index;
    }
  }

  return -1;
}

function findBoundaryOption(options, fromEnd = false) {
  if (fromEnd) {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index].disabled) {
        return index;
      }
    }

    return -1;
  }

  return options.findIndex((option) => !option.disabled);
}

export function CustomDropdown({
  ariaLabel = "",
  buttonClassName = "",
  className = "",
  copy,
  disabled = false,
  id,
  label = "",
  onChange,
  options = [],
  placeholder = "",
  value = "",
}) {
  const generatedId = useId();
  const dropdownId = id || `account-profile-dropdown-${generatedId}`;
  const listboxId = `${dropdownId}-listbox`;
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef(new Map());
  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const selectedIndex = normalizedOptions.findIndex((option) =>
    Object.is(option.value, value),
  );
  const selectedOption =
    selectedIndex >= 0 ? normalizedOptions[selectedIndex] : null;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const openLabel = copy?.accountProfileOpenDropdown || "Open options";
  const closeLabel = copy?.accountProfileCloseDropdown || "Close options";
  const actionLabel = open ? closeLabel : openLabel;
  const visibleLabel = selectedOption?.label || placeholder;
  const fieldLabel = ariaLabel || label;
  const accessibleLabel = `${fieldLabel || visibleLabel || openLabel}. ${actionLabel}`;

  const closeDropdown = useCallback((restoreFocus = false) => {
    setOpen(false);

    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const openDropdown = useCallback(
    (preferredIndex = selectedIndex) => {
      if (disabled) {
        return;
      }

      const nextIndex =
        preferredIndex >= 0 && !normalizedOptions[preferredIndex]?.disabled
          ? preferredIndex
          : findBoundaryOption(normalizedOptions);

      setActiveIndex(nextIndex);
      setOpen(true);
    },
    [disabled, normalizedOptions, selectedIndex],
  );

  const chooseOption = useCallback(
    (index) => {
      const option = normalizedOptions[index];

      if (!option || option.disabled) {
        return;
      }

      onChange?.(option.value, option);
      closeDropdown(true);
    },
    [closeDropdown, normalizedOptions, onChange],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        closeDropdown(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closeDropdown, open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return;
    }

    optionRefs.current.get(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const moveActiveOption = (direction) => {
    const nextIndex = findEnabledOption(
      normalizedOptions,
      activeIndex >= 0 ? activeIndex : selectedIndex,
      direction,
    );

    if (nextIndex >= 0) {
      setActiveIndex(nextIndex);
    }
  };

  const handleTriggerKeyDown = (event) => {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (open) {
        moveActiveOption(event.key === "ArrowDown" ? 1 : -1);
      } else {
        const boundaryIndex = findBoundaryOption(
          normalizedOptions,
          event.key === "ArrowUp",
        );
        openDropdown(boundaryIndex);
      }

      return;
    }

    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(findBoundaryOption(normalizedOptions));
      return;
    }

    if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(findBoundaryOption(normalizedOptions, true));
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      chooseOption(activeIndex);
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeDropdown(true);
      return;
    }

    if (event.key === "Tab" && open) {
      closeDropdown(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={accessibleLabel}
        className={`${dropdownButtonClassName} ${buttonClassName}`}
        disabled={disabled}
        id={dropdownId}
        onClick={() => {
          if (open) {
            closeDropdown(false);
          } else {
            openDropdown();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        role="combobox"
        title={actionLabel}
        type="button"
      >
        <span
          className={
            selectedOption
              ? "min-w-0 truncate"
              : "min-w-0 truncate text-white/40"
          }
        >
          {visibleLabel}
        </span>
        <icon
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          arrow_drop_down
        </icon>
      </button>

      {open
        ? <div
            aria-label={fieldLabel || placeholder || openLabel}
            className="liquid-glass absolute start-0 top-[calc(100%+0.4rem)] z-[100] max-h-64 w-full min-w-44 overflow-y-auto rounded-xl border border-white/10 bg-purple-950/90! p-1 shadow-2xl shadow-purple-950/40"
            id={listboxId}
            role="listbox"
          >
            {normalizedOptions.map((option, index) => {
              const selected = index === selectedIndex;
              const active = index === activeIndex;

              return (
                <button
                  aria-selected={selected}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? "bg-purple-500/35! text-white"
                      : "text-white/72 hover:bg-white/8! hover:text-white"
                  }`}
                  disabled={option.disabled}
                  id={`${listboxId}-option-${index}`}
                  key={`${String(option.value)}-${index}`}
                  onClick={() => chooseOption(index)}
                  onMouseEnter={() => {
                    if (!option.disabled) {
                      setActiveIndex(index);
                    }
                  }}
                  ref={(node) => {
                    if (node) {
                      optionRefs.current.set(index, node);
                    } else {
                      optionRefs.current.delete(index);
                    }
                  }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {selected
                    ? <icon className="shrink-0 text-purple-100">check</icon>
                    : null}
                </button>
              );
            })}
          </div>
        : null}
    </div>
  );
}

function createDate(year, month, day) {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date;
}

function parseDateValue(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = createDate(year, month, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return { day, month, year };
}

function formatDateValue({ day, month, year }) {
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getTodayParts() {
  const today = new Date();

  return {
    day: today.getDate(),
    month: today.getMonth(),
    year: today.getFullYear(),
  };
}

function getDateNumber({ day, month, year }) {
  return year * 10_000 + (month + 1) * 100 + day;
}

function clampDate(parts, minimum, maximum) {
  if (getDateNumber(parts) < getDateNumber(minimum)) {
    return minimum;
  }

  if (getDateNumber(parts) > getDateNumber(maximum)) {
    return maximum;
  }

  return parts;
}

function getDaysInMonth(year, month) {
  return createDate(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(locale) {
  try {
    const localeInfo = new Intl.Locale(locale);
    const weekInfo =
      typeof localeInfo.getWeekInfo === "function"
        ? localeInfo.getWeekInfo()
        : localeInfo.weekInfo;

    if (weekInfo?.firstDay >= 1 && weekInfo.firstDay <= 7) {
      return weekInfo.firstDay % 7;
    }
  } catch {
    return 0;
  }

  return 0;
}

function formatDateForDisplay(parts, locale) {
  if (!parts) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(createDate(parts.year, parts.month, parts.day));
  } catch {
    return formatDateValue(parts);
  }
}

function getMonthOptions(locale, viewYear, maximum) {
  let formatter;

  try {
    formatter = new Intl.DateTimeFormat(locale, { month: "long" });
  } catch {
    formatter = new Intl.DateTimeFormat("en", { month: "long" });
  }

  return Array.from({ length: 12 }, (_, month) => ({
    disabled: viewYear === maximum.year && month > maximum.month,
    label: formatter.format(createDate(2020, month, 1)),
    value: String(month),
  }));
}

function getWeekdayLabels(locale, firstDayOfWeek) {
  let longFormatter;
  let shortFormatter;

  try {
    longFormatter = new Intl.DateTimeFormat(locale, { weekday: "long" });
    shortFormatter = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  } catch {
    longFormatter = new Intl.DateTimeFormat("en", { weekday: "long" });
    shortFormatter = new Intl.DateTimeFormat("en", { weekday: "narrow" });
  }

  return Array.from({ length: 7 }, (_, index) => {
    const weekday = (firstDayOfWeek + index) % 7;
    const date = createDate(2021, 7, 1 + weekday);

    return {
      long: longFormatter.format(date),
      short: shortFormatter.format(date),
    };
  });
}

function getInitialView(selected, today, minimumYear) {
  if (
    selected &&
    selected.year >= minimumYear &&
    getDateNumber(selected) <= getDateNumber(today)
  ) {
    return { month: selected.month, year: selected.year };
  }

  return { month: today.month, year: today.year };
}

function getFocusableDate(view, selected, today) {
  if (
    selected &&
    selected.year === view.year &&
    selected.month === view.month &&
    getDateNumber(selected) <= getDateNumber(today)
  ) {
    return selected;
  }

  if (today.year === view.year && today.month === view.month) {
    return today;
  }

  return { day: 1, month: view.month, year: view.year };
}

export function BirthdayDatePicker({
  copy,
  disabled = false,
  onChange,
  required = false,
  value,
}) {
  const generatedId = useId();
  const calendarId = `account-profile-birthday-${generatedId}`;
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const dayButtonRefs = useRef(new Map());
  const locale = getCurrentLocale();
  const today = useMemo(() => getTodayParts(), []);
  const minimumYear = today.year - 120;
  const minimumDate = { day: 1, month: 0, year: minimumYear };
  const selectedDate = parseDateValue(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() =>
    getInitialView(selectedDate, today, minimumYear),
  );
  const [focusedDateValue, setFocusedDateValue] = useState(() =>
    formatDateValue(
      getFocusableDate(
        getInitialView(selectedDate, today, minimumYear),
        selectedDate,
        today,
      ),
    ),
  );
  const firstDayOfWeek = useMemo(() => getFirstDayOfWeek(locale), [locale]);
  const weekdayLabels = useMemo(
    () => getWeekdayLabels(locale, firstDayOfWeek),
    [firstDayOfWeek, locale],
  );
  const monthOptions = useMemo(
    () => getMonthOptions(locale, view.year, today),
    [locale, today, view.year],
  );
  const yearOptions = useMemo(
    () =>
      Array.from({ length: 121 }, (_, index) => ({
        label: String(today.year - index),
        value: String(today.year - index),
      })),
    [today.year],
  );
  const birthdayLabel = copy?.accountProfileBirthday || "Birthday";
  const openLabel = copy?.accountProfileOpenDropdown || "Open calendar";
  const closeLabel = copy?.accountProfileCloseDropdown || "Close calendar";
  const previousMonthLabel =
    copy?.accountProfilePreviousMonth || "Previous month";
  const nextMonthLabel = copy?.accountProfileNextMonth || "Next month";
  const todayLabel = copy?.accountProfileToday || "Today";
  const clearLabel = copy?.accountProfileClearDate || "Clear";
  const monthLabel =
    monthOptions.find((option) => option.value === String(view.month))?.label ||
    String(view.month + 1);
  const yearLabel = String(view.year);
  const placeholder =
    copy?.accountProfileSelectDate ||
    copy?.accountProfileNotProvided ||
    birthdayLabel;
  const displayValue = formatDateForDisplay(selectedDate, locale);
  const viewStartsAtMinimum = view.year === minimumYear && view.month === 0;
  const viewEndsAtToday =
    view.year === today.year && view.month === today.month;
  const numberOfDays = getDaysInMonth(view.year, view.month);
  const firstDateWeekday = createDate(view.year, view.month, 1).getDay();
  const leadingDays = (firstDateWeekday - firstDayOfWeek + 7) % 7;
  const calendarCells = Array.from({ length: 42 }, (_, index) => {
    const day = index - leadingDays + 1;
    const cellDate = createDate(view.year, view.month, day);
    const cellDateParts = {
      day: cellDate.getDate(),
      month: cellDate.getMonth(),
      year: cellDate.getFullYear(),
    };

    return {
      day: day >= 1 && day <= numberOfDays ? day : null,
      key: formatDateValue(cellDateParts),
    };
  });
  const calendarWeeks = Array.from({ length: 6 }, (_, weekIndex) => {
    const cells = calendarCells.slice(weekIndex * 7, weekIndex * 7 + 7);

    return { cells, key: cells[0].key };
  });

  const closeCalendar = useCallback((restoreFocus = false) => {
    setOpen(false);

    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const updateView = useCallback(
    (year, month) => {
      const normalizedView = createDate(year, month, 1);
      let nextYear = normalizedView.getFullYear();
      let nextMonth = normalizedView.getMonth();

      if (nextYear < minimumYear) {
        nextYear = minimumYear;
        nextMonth = 0;
      }

      if (
        nextYear > today.year ||
        (nextYear === today.year && nextMonth > today.month)
      ) {
        nextYear = today.year;
        nextMonth = today.month;
      }

      const nextView = { month: nextMonth, year: nextYear };
      setView(nextView);
      setFocusedDateValue(
        formatDateValue(getFocusableDate(nextView, selectedDate, today)),
      );
    },
    [minimumYear, selectedDate, today],
  );

  const openCalendar = () => {
    if (disabled) {
      return;
    }

    const nextView = getInitialView(selectedDate, today, minimumYear);
    setView(nextView);
    setFocusedDateValue(
      formatDateValue(getFocusableDate(nextView, selectedDate, today)),
    );
    setOpen(true);
  };

  const selectDate = (nextValue) => {
    onChange?.(nextValue);
    closeCalendar(true);
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event) => {
      if (
        !containerRef.current?.contains(event.target) &&
        !event.target.closest?.("[data-munetios-dropdown-portal='true']")
      ) {
        closeCalendar(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closeCalendar(true);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeCalendar, open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open || !focusedDateValue) {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      dayButtonRefs.current.get(focusedDateValue)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [focusedDateValue, open]);

  const moveFocusedDate = (dayOffset) => {
    const focusedDate =
      parseDateValue(focusedDateValue) ||
      getFocusableDate(view, selectedDate, today);
    const nextDate = createDate(
      focusedDate.year,
      focusedDate.month,
      focusedDate.day + dayOffset,
    );
    const clampedDate = clampDate(
      {
        day: nextDate.getDate(),
        month: nextDate.getMonth(),
        year: nextDate.getFullYear(),
      },
      minimumDate,
      today,
    );

    setView({ month: clampedDate.month, year: clampedDate.year });
    setFocusedDateValue(formatDateValue(clampedDate));
  };

  const moveFocusedMonth = (monthOffset) => {
    const focusedDate =
      parseDateValue(focusedDateValue) ||
      getFocusableDate(view, selectedDate, today);
    const targetMonth = createDate(
      focusedDate.year,
      focusedDate.month + monthOffset,
      1,
    );
    const targetDay = Math.min(
      focusedDate.day,
      getDaysInMonth(targetMonth.getFullYear(), targetMonth.getMonth()),
    );
    const clampedDate = clampDate(
      {
        day: targetDay,
        month: targetMonth.getMonth(),
        year: targetMonth.getFullYear(),
      },
      minimumDate,
      today,
    );

    setView({ month: clampedDate.month, year: clampedDate.year });
    setFocusedDateValue(formatDateValue(clampedDate));
  };

  const handleDayKeyDown = (event, dateParts) => {
    const weekdayOffset =
      (createDate(dateParts.year, dateParts.month, dateParts.day).getDay() -
        firstDayOfWeek +
        7) %
      7;
    let handled = true;

    if (event.key === "ArrowLeft") {
      moveFocusedDate(-1);
    } else if (event.key === "ArrowRight") {
      moveFocusedDate(1);
    } else if (event.key === "ArrowUp") {
      moveFocusedDate(-7);
    } else if (event.key === "ArrowDown") {
      moveFocusedDate(7);
    } else if (event.key === "Home") {
      moveFocusedDate(-weekdayOffset);
    } else if (event.key === "End") {
      moveFocusedDate(6 - weekdayOffset);
    } else if (event.key === "PageUp") {
      moveFocusedMonth(event.shiftKey ? -12 : -1);
    } else if (event.key === "PageDown") {
      moveFocusedMonth(event.shiftKey ? 12 : 1);
    } else {
      handled = false;
    }

    if (handled) {
      event.preventDefault();
    }
  };

  return (
    <div className="relative mt-2" ref={containerRef}>
      <button
        aria-controls={open ? calendarId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${birthdayLabel}. ${open ? closeLabel : openLabel}`}
        className={dropdownButtonClassName}
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeCalendar(false);
          } else {
            openCalendar();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            openCalendar();
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span className={displayValue ? "truncate" : "truncate text-white/40"}>
          {displayValue || placeholder}
        </span>
        <icon className="shrink-0">calendar_month</icon>
      </button>

      {open
        ? <Wrapper
            ariaLabel={birthdayLabel}
            as="div"
            className="absolute start-0 top-[calc(100%+0.4rem)] z-[70] w-[min(22rem,calc(100vw-2rem))] overflow-visible! shadow-2xl shadow-purple-950/45"
            contentClassName=""
          >
            <div id={calendarId} role="dialog">
              <div className="relative z-10 flex items-center gap-2">
                <button
                  aria-label={previousMonthLabel}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5! text-white/75 transition hover:border-white/20 hover:bg-purple-500/20! hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={viewStartsAtMinimum}
                  onClick={() => updateView(view.year, view.month - 1)}
                  type="button"
                >
                  <icon>chevron_left</icon>
                </button>

                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                  <DropdownWrapper
                    align="left"
                    ariaLabel={monthLabel}
                    buttonClassName="h-10 w-full justify-between bg-white/5! py-2"
                    className="mt-0! w-full"
                    panelClassName="max-h-64 w-[min(18rem,calc(100vw-1rem))] overflow-y-auto"
                    trigger={
                      <>
                        <span className="min-w-0 truncate">{monthLabel}</span>
                        <icon className="shrink-0">expand_more</icon>
                      </>
                    }
                  >
                    <div className="space-y-1">
                      {monthOptions.map((option) => (
                        <button
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-white transition hover:bg-white/10!"
                          key={option.value}
                          onClick={() =>
                            updateView(view.year, Number(option.value))
                          }
                          role="menuitem"
                          type="button"
                        >
                          <span>{option.label}</span>
                          {option.value === String(view.month)
                            ? <icon>check</icon>
                            : null}
                        </button>
                      ))}
                    </div>
                  </DropdownWrapper>
                  <DropdownWrapper
                    align="right"
                    ariaLabel={yearLabel}
                    buttonClassName="h-10 w-full justify-between bg-white/5! py-2"
                    className="mt-0! w-full"
                    panelClassName="max-h-64 w-32 overflow-y-auto"
                    trigger={
                      <>
                        <span className="min-w-0 truncate">{yearLabel}</span>
                        <icon className="shrink-0">expand_more</icon>
                      </>
                    }
                  >
                    <div className="space-y-1">
                      {yearOptions.map((option) => (
                        <button
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-white transition hover:bg-white/10!"
                          key={option.value}
                          onClick={() => {
                            const normalizedYear = Number(option.value);
                            const normalizedMonth =
                              normalizedYear === today.year &&
                              view.month > today.month
                                ? today.month
                                : view.month;

                            updateView(normalizedYear, normalizedMonth);
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <span>{option.label}</span>
                          {option.value === String(view.year)
                            ? <icon>check</icon>
                            : null}
                        </button>
                      ))}
                    </div>
                  </DropdownWrapper>
                </div>

                <button
                  aria-label={nextMonthLabel}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5! text-white/75 transition hover:border-white/20 hover:bg-purple-500/20! hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={viewEndsAtToday}
                  onClick={() => updateView(view.year, view.month + 1)}
                  type="button"
                >
                  <icon>chevron_right</icon>
                </button>
              </div>

              <table className="mt-3 w-full table-fixed border-separate border-spacing-1">
                <caption className="sr-only">
                  {formatDateForDisplay(
                    { day: 1, month: view.month, year: view.year },
                    locale,
                  )}
                </caption>
                <thead>
                  <tr>
                    {weekdayLabels.map((weekday) => (
                      <th
                        abbr={weekday.long}
                        className="py-1 text-center text-xs font-bold uppercase text-white/45"
                        key={weekday.long}
                        scope="col"
                      >
                        {weekday.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calendarWeeks.map((week) => (
                    <tr key={week.key}>
                      {week.cells.map((cell) => {
                        if (cell.day === null) {
                          return <td aria-hidden="true" key={cell.key} />;
                        }

                        const day = cell.day;

                        const dateParts = {
                          day,
                          month: view.month,
                          year: view.year,
                        };
                        const dateValue = formatDateValue(dateParts);
                        const future =
                          getDateNumber(dateParts) > getDateNumber(today);
                        const selected = value === dateValue;
                        const isToday =
                          getDateNumber(dateParts) === getDateNumber(today);

                        return (
                          <td className="p-0" key={dateValue}>
                            <button
                              aria-current={isToday ? "date" : undefined}
                              aria-label={formatDateForDisplay(
                                dateParts,
                                locale,
                              )}
                              aria-pressed={selected}
                              className={`flex h-9 w-full items-center justify-center rounded-lg text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-purple-200/80 disabled:cursor-not-allowed disabled:opacity-25 ${
                                selected
                                  ? "bg-purple-500/85! text-white shadow-lg shadow-purple-950/35"
                                  : isToday
                                    ? "border border-purple-200/45 bg-purple-500/20! text-purple-50"
                                    : "text-white/72 hover:bg-purple-500/20! hover:text-white"
                              }`}
                              disabled={future}
                              onClick={() => selectDate(dateValue)}
                              onFocus={() => setFocusedDateValue(dateValue)}
                              onKeyDown={(event) =>
                                handleDayKeyDown(event, dateParts)
                              }
                              ref={(node) => {
                                if (node) {
                                  dayButtonRefs.current.set(dateValue, node);
                                } else {
                                  dayButtonRefs.current.delete(dateValue);
                                }
                              }}
                              tabIndex={
                                !future && dateValue === focusedDateValue
                                  ? 0
                                  : -1
                              }
                              type="button"
                            >
                              {day}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
                {required
                  ? <span />
                  : <button
                      className="rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-sm font-semibold text-white/65 transition hover:border-white/20 hover:bg-white/10! hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!selectedDate}
                      onClick={() => selectDate("")}
                      type="button"
                    >
                      {clearLabel}
                    </button>}
                <button
                  className="rounded-xl border border-purple-200/25 bg-purple-500/55! px-3 py-2 text-sm font-bold text-white transition hover:border-purple-100/40 hover:bg-purple-400/70!"
                  onClick={() => selectDate(formatDateValue(today))}
                  type="button"
                >
                  {todayLabel}
                </button>
              </div>
            </div>
          </Wrapper>
        : null}
    </div>
  );
}
