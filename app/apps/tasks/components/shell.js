"use client";

import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import TasksSidebar from "./sidebar";
import TasksPwaRegistration from "./tasksPwaRegistration";
import TasksTopbar from "./topbar";

const sidebarOverlayQuery = "(max-width: 1149.98px)";

export default function TasksShell({ children = null }) {
  const [copy, setCopy] = useState(() => t("en"));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarOverlayMode, setSidebarOverlayMode] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia(sidebarOverlayQuery);
    const syncSidebarMode = (event) => {
      setSidebarOverlayMode(event.matches);
      setSidebarOpen(!event.matches);
    };
    const refreshCopy = () => setCopy(t());

    refreshCopy();
    syncSidebarMode(mediaQuery);
    mediaQuery.addEventListener("change", syncSidebarMode);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);

    return () => {
      mediaQuery.removeEventListener("change", syncSidebarMode);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  useEffect(() => {
    if (!sidebarOpen || !sidebarOverlayMode) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen, sidebarOverlayMode]);

  return (
    <div
      className={`tasks-shell ${sidebarOpen ? "tasks-sidebar-open" : "tasks-sidebar-closed"} ${sidebarOverlayMode ? "tasks-sidebar-overlay-mode" : "tasks-sidebar-docked-mode"}`}
    >
      <TasksTopbar
        copy={copy}
        onSidebarToggle={() => setSidebarOpen((current) => !current)}
        sidebarOpen={sidebarOpen}
      />
      <button
        aria-hidden={!sidebarOpen || !sidebarOverlayMode}
        aria-label={copy.tasksCloseSidebar}
        className="tasks-sidebar-overlay"
        onClick={() => setSidebarOpen(false)}
        tabIndex={sidebarOpen && sidebarOverlayMode ? 0 : -1}
        type="button"
      />
      <TasksSidebar
        copy={copy}
        expanded={sidebarOpen}
        onNavigate={() => {
          if (sidebarOverlayMode) setSidebarOpen(false);
        }}
      />
      <main aria-label={copy.tasksWorkspaceLabel} className="tasks-main">
        {children}
      </main>
      <TasksPwaRegistration copy={copy} />
    </div>
  );
}
