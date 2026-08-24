"use client";

import { useCallback, useEffect, useState } from "react";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { t } from "../../../i18n";
import {
  calendarSettingsChangeEvent,
  loadCalendarSettings,
} from "../lib/calendarSettings";

const views = [
  {
    icon: "calendar_month",
    id: "calendar",
    labelKey: "calendarToolbarCalendar",
  },
  { icon: "check_circle", id: "tasks", labelKey: "calendarToolbarTasks" },
  { icon: "restaurant", id: "meals", labelKey: "calendarToolbarMeals" },
];

const calendarViewOptions = [
  { id: "day", labelKey: "calendarToolbarDay" },
  { id: "week", labelKey: "calendarToolbarWeek" },
  { id: "month", labelKey: "calendarToolbarMonth" },
  { id: "year", labelKey: "calendarToolbarYear" },
  { id: "agenda", labelKey: "calendarToolbarAgenda" },
  { id: "timeline", labelKey: "calendarToolbarTimeline" },
];
const calendarViewStorageKey = "munetios.calendar.view";
const calendarPageStorageKey = "munetios.calendar.page";

function getSelectedDates(detail) {
  if (Array.isArray(detail)) return detail;
  if (Array.isArray(detail?.dates)) return detail.dates;
  if (Array.isArray(detail?.selectedDates)) return detail.selectedDates;
  if (Number.isFinite(detail?.count)) {
    return Array.from({ length: Math.max(0, detail.count) });
  }
  return [];
}

export default function CalendarContentToolbar() {
  const [activeView, setActiveView] = useState("calendar");
  const [calendarView, setCalendarView] = useState("month");
  const [copy, setCopy] = useState(() => t("en"));
  const [selecting, setSelecting] = useState(false);
  const [selectedDates, setSelectedDates] = useState([]);
  const [customViews, setCustomViews] = useState([]);
  const hasSelectedDates = selectedDates.length > 0;

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    const handleSelectionChange = (event) => {
      setSelectedDates(getSelectedDates(event.detail));
    };

    refreshCopy();
    const savedPage = window.localStorage.getItem(calendarPageStorageKey);
    const savedView = window.localStorage.getItem(calendarViewStorageKey);
    if (views.some((view) => view.id === savedPage)) {
      setActiveView(savedPage);
      window.dispatchEvent(
        new CustomEvent("munetios:calendarcontentviewchange", {
          detail: { view: savedPage },
        }),
      );
    }
    const savedCustomView = loadCalendarSettings().customViews.find(
      (view) => `custom:${view.id}` === savedView,
    );
    if (
      calendarViewOptions.some((view) => view.id === savedView) ||
      savedCustomView
    ) {
      setCalendarView(savedView);
      window.dispatchEvent(
        new CustomEvent("munetios:calendarviewchange", {
          detail: { customView: savedCustomView, view: savedView },
        }),
      );
    }
    const refreshCustomViews = (event) =>
      setCustomViews(
        (event?.detail || loadCalendarSettings()).customViews || [],
      );
    refreshCustomViews();
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener(calendarSettingsChangeEvent, refreshCustomViews);
    window.addEventListener(
      "munetios:calendarselectionchange",
      handleSelectionChange,
    );
    return () => {
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener(
        calendarSettingsChangeEvent,
        refreshCustomViews,
      );
      window.removeEventListener(
        "munetios:calendarselectionchange",
        handleSelectionChange,
      );
    };
  }, []);

  const changeView = useCallback((view) => {
    setActiveView(view);
    window.localStorage.setItem(calendarPageStorageKey, view);
    window.dispatchEvent(
      new CustomEvent("munetios:calendarcontentviewchange", {
        detail: { view },
      }),
    );
  }, []);

  const changeCalendarView = useCallback((view, customView = null) => {
    setCalendarView(view);
    window.localStorage.setItem(calendarViewStorageKey, view);
    window.dispatchEvent(
      new CustomEvent("munetios:calendarviewchange", {
        detail: { customView, view },
      }),
    );
  }, []);

  const runSelectionAction = useCallback(
    (action, requiresSelection = true) => {
      if (requiresSelection && !hasSelectedDates) return;
      window.dispatchEvent(
        new CustomEvent(`munetios:calendar${action}`, {
          detail: { selectedDates },
        }),
      );
    },
    [hasSelectedDates, selectedDates],
  );

  const toggleSelectMode = useCallback(() => {
    const next = !selecting;
    setSelecting(next);
    if (!next) setSelectedDates([]);
    window.dispatchEvent(
      new CustomEvent("munetios:calendarselectmodechange", {
        detail: { active: next },
      }),
    );
  }, [selecting]);

  return (
    <nav
      aria-label={copy.calendarToolbarLabel}
      className="calendar-content-toolbar"
    >
      <div
        aria-label={copy.calendarToolbarViews}
        className="calendar-toolbar-left liquid-glass"
        role="tablist"
      >
        {views.map((view) => (
          <button
            aria-selected={activeView === view.id}
            className="calendar-toolbar-button calendar-toolbar-view"
            key={view.id}
            onClick={() => changeView(view.id)}
            role="tab"
            type="button"
          >
            <icon>{view.icon}</icon>
            <span>{copy[view.labelKey]}</span>
          </button>
        ))}
      </div>

      <div className="calendar-toolbar-right liquid-glass">
        <DropdownWrapper
          align="left"
          ariaLabel={copy.calendarToolbarView}
          buttonClassName="calendar-toolbar-button calendar-view-trigger"
          className="calendar-view-dropdown"
          panelClassName="calendar-view-menu"
          trigger={
            <>
              <icon>view_week</icon>
              <span>{copy.calendarToolbarView}</span>
              <icon>expand_more</icon>
            </>
          }
          triggerAs="button"
          triggerGlass={false}
        >
          <div className="calendar-view-options">
            {calendarViewOptions.map((option) => (
              <button
                aria-checked={calendarView === option.id}
                className="calendar-view-option"
                data-dropdown-close
                data-dropdown-item-style="false"
                key={option.id}
                onClick={() => changeCalendarView(option.id)}
                role="menuitemradio"
                type="button"
              >
                <span>{copy[option.labelKey]}</span>
                {calendarView === option.id ? <icon>check</icon> : null}
              </button>
            ))}
            {customViews.map((view) => {
              const id = `custom:${view.id}`;
              return (
                <button
                  aria-checked={calendarView === id}
                  className="calendar-view-option"
                  data-dropdown-close
                  data-dropdown-item-style="false"
                  key={id}
                  onClick={() => changeCalendarView(id, view)}
                  role="menuitemradio"
                  type="button"
                >
                  <span>{view.name}</span>
                  {calendarView === id ? <icon>check</icon> : null}
                </button>
              );
            })}
          </div>
        </DropdownWrapper>
        <button
          className="calendar-toolbar-button"
          onClick={() => runSelectionAction("createevent", false)}
          type="button"
        >
          <icon>add</icon>
          <span>{copy.calendarToolbarCreateEvent}</span>
        </button>
        <button
          className="calendar-toolbar-button"
          disabled={!hasSelectedDates}
          onClick={() => runSelectionAction("share")}
          type="button"
        >
          <icon>share</icon>
          <span>{copy.calendarToolbarShare}</span>
        </button>
        <button
          className="calendar-toolbar-button"
          disabled={!hasSelectedDates}
          onClick={() => runSelectionAction("print")}
          type="button"
        >
          <icon>print</icon>
          <span>{copy.calendarToolbarPrint}</span>
        </button>
        <button
          aria-pressed={selecting}
          className="calendar-toolbar-button"
          onClick={toggleSelectMode}
          type="button"
        >
          <icon>select_check_box</icon>
          <span>{copy.calendarToolbarSelect}</span>
        </button>
      </div>
    </nav>
  );
}
