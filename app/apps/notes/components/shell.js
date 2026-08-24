"use client";

import { useCallback, useEffect, useState } from "react";
import { showToast } from "../../../components/toast";
import { t } from "../../../i18n";
import { createResponsiveMediaQuery } from "../../../lib/responsiveMediaQuery";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import NotesSidebar from "./sidebar";
import NotesTopbar from "./topbar";
import NotesWorkspace from "./workspace";

const sidebarOverlayQuery = "(max-width: 1149.98px)";
const notesSettingsStorageKey = "munetios.supanotes.settings";

function getSidebarMode() {
  try {
    return JSON.parse(
      window.localStorage.getItem(notesSettingsStorageKey) || "{}",
    ).sidebarMode;
  } catch {
    return "auto";
  }
}

export default function NotesShell({ children = null }) {
  const [copy, setCopy] = useState(() => t("en"));
  const [sessionState, setSessionState] = useState("loading");
  const [notes, setNotes] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarOverlayMode, setSidebarOverlayMode] = useState(true);
  const [storage, setStorage] = useState(null);
  const [user, setUser] = useState(null);

  const refreshSession = useCallback(async (signal) => {
    const signedIn = hasSignedInCookie();
    setSessionState(signedIn ? "active" : "inactive");
    if (!signedIn) {
      setStorage(null);
      setUser(null);
      return false;
    }

    try {
      const response = await fetch("/api/account", {
        cache: "no-store",
        credentials: "include",
        signal,
      });
      if (response.ok) setUser(await response.json());
      return true;
    } catch (error) {
      if (error?.name !== "AbortError" && !hasSignedInCookie()) {
        setStorage(null);
        setUser(null);
        setSessionState("inactive");
      }
      return hasSignedInCookie();
    }
  }, []);

  const refreshStorage = useCallback(async (signal) => {
    try {
      const response = await fetch("/api/storage", {
        cache: "no-store",
        credentials: "include",
        signal,
      });
      if (!response.ok) return;
      const payload = await response.json();
      const usedBytes = Math.max(0, Number(payload.usedBytes) || 0);
      const totalBytes = Math.max(0, Number(payload.totalBytes) || 0);
      setStorage({
        display: `${payload.usedLabel || "0B"} / ${payload.totalLabel || "96GB"}`,
        percent:
          totalBytes > 0
            ? Math.max(0, Math.min(100, (usedBytes / totalBytes) * 100))
            : 0,
      });
    } catch (error) {
      if (error?.name !== "AbortError") setStorage(null);
    }
  }, []);

  const refreshNotes = useCallback(async (signedIn, signal) => {
    try {
      if (signedIn) {
        const response = await fetch("/api/supanotes/notes", {
          cache: "no-store",
          credentials: "include",
          signal,
        });
        if (!response.ok) throw new Error("Notes load failed");
        const payload = await response.json();
        setNotes(Array.isArray(payload.notes) ? payload.notes : []);
        return;
      }
      const saved = JSON.parse(
        window.localStorage.getItem("munetios.supanotes.notes") || "[]",
      );
      if (!Array.isArray(saved)) throw new Error("Invalid local notes");
      setNotes(saved);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setNotes([]);
        showToast({ messageKey: "notesLoadFailed", type: "error" });
      }
    }
  }, []);

  useEffect(() => {
    const mediaQuery = createResponsiveMediaQuery(sidebarOverlayQuery);
    const syncSidebarMode = (event, preferredMode) => {
      const overlayMode = event.matches;
      const sidebarMode = preferredMode || getSidebarMode();
      setSidebarOverlayMode(overlayMode);
      setSidebarOpen(
        sidebarMode === "expanded"
          ? true
          : sidebarMode === "collapsed"
            ? false
            : !overlayMode,
      );
    };
    const applyNotesSettings = (event) =>
      syncSidebarMode(mediaQuery, event.detail?.sidebarMode);
    const refreshCopy = () => setCopy(t());

    refreshCopy();
    syncSidebarMode(mediaQuery);
    mediaQuery.addEventListener("change", syncSidebarMode);
    window.addEventListener(
      "munetios:notes-settings-change",
      applyNotesSettings,
    );
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    return () => {
      mediaQuery.removeEventListener("change", syncSidebarMode);
      window.removeEventListener(
        "munetios:notes-settings-change",
        applyNotesSettings,
      );
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      const signedIn = await refreshSession(controller.signal);
      if (signedIn) await refreshStorage(controller.signal);
    };
    void refresh();

    const handleAuthChange = () => void refresh();
    const handleProfileChange = (event) => {
      if (!event.detail) return;
      setUser((current) => ({
        ...(current || {}),
        avatar: event.detail.avatar,
        avatarUrl: event.detail.profilePictureUrl || null,
        profilePictureUrl: event.detail.profilePictureUrl || null,
      }));
    };
    window.addEventListener("munetios:authchange", handleAuthChange);
    window.addEventListener("munetios:profilechange", handleProfileChange);
    return () => {
      controller.abort();
      window.removeEventListener("munetios:authchange", handleAuthChange);
      window.removeEventListener("munetios:profilechange", handleProfileChange);
    };
  }, [refreshSession, refreshStorage]);

  useEffect(() => {
    if (sessionState === "loading") return undefined;
    const controller = new AbortController();
    const signedIn = sessionState === "active";
    void refreshNotes(signedIn, controller.signal);
    const handleNotesChange = (event) => {
      if (Array.isArray(event.detail)) setNotes(event.detail);
      else void refreshNotes(signedIn);
    };
    window.addEventListener(
      "munetios:supanotes-notes-change",
      handleNotesChange,
    );
    return () => {
      controller.abort();
      window.removeEventListener(
        "munetios:supanotes-notes-change",
        handleNotesChange,
      );
    };
  }, [refreshNotes, sessionState]);

  useEffect(() => {
    if (!sidebarOpen || !sidebarOverlayMode) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen, sidebarOverlayMode]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarOpen((current) => !current);
      } else if (event.key === "/") {
        event.preventDefault();
        window.dispatchEvent(new Event("munetios:notesopenshortcuts"));
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const toggleSidebar = () => setSidebarOpen((current) => !current);

  return (
    <div
      className={`notes-shell ${sidebarOpen ? "notes-sidebar-open" : "notes-sidebar-closed"} ${sidebarOverlayMode ? "notes-sidebar-overlay-mode" : "notes-sidebar-docked-mode"}`}
    >
      <NotesTopbar
        copy={copy}
        onSidebarToggle={toggleSidebar}
        sessionState={sessionState}
        sidebarOpen={sidebarOpen}
        user={user}
      />
      <button
        aria-hidden={!sidebarOpen || !sidebarOverlayMode}
        aria-label={copy.tasksCloseSidebar}
        className="notes-sidebar-overlay"
        onClick={() => setSidebarOpen(false)}
        tabIndex={sidebarOpen && sidebarOverlayMode ? 0 : -1}
        type="button"
      />
      <NotesSidebar
        copy={copy}
        expanded={sidebarOpen}
        notes={notes}
        onClose={() => setSidebarOpen(false)}
        sessionState={sessionState}
        storage={storage}
      />
      <main aria-label={copy.notesAppName} className="notes-main">
        {children || (
          <NotesWorkspace
            copy={copy}
            notes={notes}
            sessionState={sessionState}
          />
        )}
      </main>
    </div>
  );
}
