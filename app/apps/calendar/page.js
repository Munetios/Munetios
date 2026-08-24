import { cookies } from "next/headers";
import CalendarContent from "./components/calendarContent";
import CalendarContentToolbar from "./components/calendarContentToolbar";
import CalendarSessionBoundary from "./components/calendarSessionBoundary";
import CalendarSettingsRuntime from "./components/calendarSettingsModal";
import CalendarSidebar from "./components/calendarSidebar";
import CalendarTopbar from "./components/calendarTopbar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CalendarPage() {
  const cookieStore = await cookies();
  const sessionPresent = cookieStore.has("munetios_session");
  return (
    <CalendarSessionBoundary sessionPresent={sessionPresent}>
      <div className="calendar-shell">
        <CalendarSettingsRuntime />
        <CalendarTopbar />
        <CalendarSidebar />
        <main aria-label="Munetios Calendar" className="calendar-canvas">
          <CalendarContentToolbar />
          <CalendarContent />
        </main>
      </div>
    </CalendarSessionBoundary>
  );
}
