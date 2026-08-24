"use client";

import LoadingSpinner from "../../components/loadingSpinner";
import { t } from "../../i18n";
import CalendarContentToolbar from "./components/calendarContentToolbar";
import CalendarSidebar from "./components/calendarSidebar";
import CalendarTopbar from "./components/calendarTopbar";

const loadingCss = `
  .calendar-loading-shell {
    min-height: 100dvh;
  }

  .calendar-loading-canvas {
    display: flex;
    flex-direction: column;
  }

  .calendar-loading-content {
    align-items: center;
    display: flex;
    flex: 1;
    justify-content: center;
    width: 100%;
  }
`;

export default function CalendarLoading() {
  const copy = t();

  return (
    <div className="calendar-shell calendar-loading-shell">
      <style>{loadingCss}</style>
      <CalendarTopbar />
      <CalendarSidebar />
      <main className="calendar-canvas calendar-loading-canvas">
        <CalendarContentToolbar />
        <section
          aria-busy="true"
          aria-label={copy.calendarContentLabel}
          className="calendar-main-content calendar-loading-content liquid-glass"
        >
          <LoadingSpinner label={`${copy.loading}...`} />
        </section>
      </main>
    </div>
  );
}
