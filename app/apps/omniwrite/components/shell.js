"use client";

import { useEffect, useState } from "react";
import { createResponsiveMediaQuery } from "../../../lib/responsiveMediaQuery";
import OmniWriteSidebar from "./sidebar";
import OmniWriteTopbar from "./topbar";

const sidebarOverlayQuery = "(max-width: 1149.98px)";

const loadingCss = `
  .omniwrite-shell[data-shell-loading="true"] .omniwrite-main {
    position: relative;
  }

  .omniwrite-shell[data-shell-loading="true"] .omniwrite-main::after {
    animation: omniwrite-loading-pulse 1s ease-in-out infinite alternate;
    background: rgb(168 85 247 / .72);
    border-radius: 999px;
    content: "";
    height: 3px;
    left: 10%;
    position: absolute;
    right: 10%;
    top: 4.75rem;
  }

  @keyframes omniwrite-loading-pulse {
    from { opacity: .35; transform: scaleX(.35); }
    to { opacity: 1; transform: scaleX(1); }
  }
`;

export default function OmniWriteShell({ loading = false }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarOverlayMode, setSidebarOverlayMode] = useState(true);

  useEffect(() => {
    const mediaQuery = createResponsiveMediaQuery(sidebarOverlayQuery);
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
      data-shell-loading={loading ? "true" : "false"}
    >
      {loading ? <style>{loadingCss}</style> : null}
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
