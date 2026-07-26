"use client";

import { useEffect, useState } from "react";
import OmniWriteSidebar from "./sidebar";
import OmniWriteTopbar from "./topbar";

const sidebarOverlayQuery = "(max-width: 1149.98px)";

export default function OmniWriteShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarOverlayMode, setSidebarOverlayMode] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia(sidebarOverlayQuery);
    const syncSidebarMode = (event) => {
      setSidebarOverlayMode(event.matches);
      setSidebarOpen(!event.matches);
    };

    syncSidebarMode(mediaQuery);
    mediaQuery.addEventListener("change", syncSidebarMode);

    return () => {
      mediaQuery.removeEventListener("change", syncSidebarMode);
    };
  }, []);

  useEffect(() => {
    if (!sidebarOpen || !sidebarOverlayMode) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarOpen, sidebarOverlayMode]);

  const toggleSidebar = () => {
    setSidebarOpen((currentValue) => !currentValue);
  };

  return (
    <munetios-app-container
      className={`omniwrite-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"} ${sidebarOverlayMode ? "sidebar-overlay-mode" : "sidebar-docked-mode"}`}
    >
      <button
        aria-hidden={!sidebarOpen || !sidebarOverlayMode}
        aria-label="Close sidebar"
        className="omniwrite-sidebar-overlay"
        data-translate-aria-label="omniWriteCloseSidebar"
        onClick={() => setSidebarOpen(false)}
        tabIndex={sidebarOpen && sidebarOverlayMode ? 0 : -1}
        type="button"
      />
      <OmniWriteSidebar open={sidebarOpen} onToggle={toggleSidebar} />
      <main className="omniwrite-main">
        <OmniWriteTopbar
          sidebarOpen={sidebarOpen}
          onSidebarToggle={toggleSidebar}
        />
      </main>
    </munetios-app-container>
  );
}
