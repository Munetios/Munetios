"use client";

import { useEffect, useMemo } from "react";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { openFeedbackModal } from "../../../components/feedbackModal";
import { openKeyboardShortcutsModal } from "../../../components/keyboardShortcutsModal";
import { openNotesSettingsModal } from "./settingsModal";

const navigationItems = [
  { icon: "home", key: "notesHome", selected: true },
  { icon: "note_add", key: "notesAddNote" },
  { icon: "sell", key: "notesTags" },
  { icon: "star", key: "tasksFavorites" },
  { icon: "delete", key: "omniWriteTrash" },
];

function SidebarItem({ copy, icon, labelKey, selected = false }) {
  return (
    <button
      aria-current={selected ? "page" : undefined}
      className="notes-sidebar-item"
      title={copy[labelKey]}
      type="button"
    >
      <span className="notes-sidebar-icon">
        <icon>{icon}</icon>
      </span>
      <span className="notes-sidebar-label">{copy[labelKey]}</span>
    </button>
  );
}

export default function NotesSidebar({
  copy,
  expanded,
  notes = [],
  onClose,
  sessionState,
  storage,
}) {
  const shortcuts = useMemo(
    () => [
      { keys: ["Ctrl", "B"], label: copy.notesShortcutToggleSidebar },
      { keys: ["Ctrl", "/"], label: copy.notesShortcutOpenHelp },
    ],
    [copy],
  );
  const folders = useMemo(() => {
    const entries = new Map();
    for (const note of notes) {
      if (note.folderId && !entries.has(note.folderId)) {
        entries.set(note.folderId, note.folderName || note.folderId);
      }
    }
    return [...entries.entries()];
  }, [notes]);

  useEffect(() => {
    const openShortcuts = () =>
      openKeyboardShortcutsModal({
        shortcuts,
        title: copy.notesKeyboardShortcutsTitle,
      });
    window.addEventListener("munetios:notesopenshortcuts", openShortcuts);
    return () =>
      window.removeEventListener("munetios:notesopenshortcuts", openShortcuts);
  }, [copy, shortcuts]);

  return (
    <aside
      aria-label={copy.notesSidebarNavigation}
      className="notes-sidebar liquid-glass"
      data-expanded={expanded ? "true" : "false"}
    >
      <header className="notes-sidebar-header">
        <a className="notes-sidebar-brand" href="/apps/notes">
          {/* biome-ignore lint/performance/noImgElement: this is the official deployed SupaNotes logo. */}
          <img
            alt={copy.notesAppName}
            height="38"
            src="https://notes.munetios.com/apple-touch-icon.png"
            width="38"
          />
          <span>{copy.notesAppName}</span>
        </a>
        <button
          aria-label={copy.tasksCloseSidebar}
          className="notes-sidebar-close"
          onClick={onClose}
          title={copy.tasksCloseSidebar}
          type="button"
        >
          <icon>left_panel_close</icon>
        </button>
      </header>

      <div className="notes-sidebar-scroll">
        <nav
          aria-label={copy.notesSidebarNavigation}
          className="notes-sidebar-nav"
        >
          {navigationItems.map((item) => (
            <SidebarItem
              copy={copy}
              icon={item.icon}
              key={item.key}
              labelKey={item.key}
              selected={item.selected}
            />
          ))}
        </nav>

        <section className="notes-sidebar-section">
          <h2>{copy.notesNotesList}</h2>
          {notes.slice(0, 12).map((note) => (
            <button className="notes-sidebar-note" key={note.id} type="button">
              <icon>note</icon>
              <span>{note.title || copy.notesNotesList}</span>
            </button>
          ))}
          {notes.length === 0
            ? <div aria-hidden="true" className="notes-sidebar-empty-line" />
            : null}
        </section>
        <section className="notes-sidebar-section">
          <h2>{copy.omniWriteFolders}</h2>
          {folders.map(([id, name]) => (
            <button className="notes-sidebar-note" key={id} type="button">
              <icon>folder</icon>
              <span>{name}</span>
            </button>
          ))}
          {folders.length === 0
            ? <div aria-hidden="true" className="notes-sidebar-empty-line" />
            : null}
        </section>
      </div>

      <div className="notes-sidebar-bottom">
        {sessionState === "active"
          ? <section
              className="notes-storage-card"
              aria-label={copy.notesCloudStorage}
            >
              <div className="notes-storage-heading">
                <span>
                  <icon>cloud</icon>
                  {copy.notesCloudStorage}
                </span>
                <strong>{copy.storageUsed}</strong>
              </div>
              <div className="notes-storage-track">
                <span style={{ width: `${storage?.percent || 0}%` }} />
              </div>
              <output>{storage?.display || copy.storageFallback}</output>
            </section>
          : null}
        <nav
          aria-label={copy.notesSidebarUtilities}
          className="notes-sidebar-utilities"
        >
          <button
            className="notes-sidebar-item"
            onClick={() =>
              openNotesSettingsModal({
                copy,
                signedIn: sessionState === "active",
              })
            }
            title={copy.settings}
            type="button"
          >
            <span className="notes-sidebar-icon">
              <icon>settings</icon>
            </span>
            <span className="notes-sidebar-label">{copy.settings}</span>
          </button>
          <DropdownWrapper
            align="left"
            ariaLabel={copy.tasksHelp}
            buttonClassName="notes-sidebar-item"
            panelClassName="w-[min(19rem,calc(100vw-1rem))]"
            persistent
            trigger={
              <>
                <span className="notes-sidebar-icon">
                  <icon>help</icon>
                </span>
                <span className="notes-sidebar-label">{copy.tasksHelp}</span>
              </>
            }
            triggerAs="button"
            triggerGlass={false}
            zIndex={100000005}
          >
            <a
              className="notes-help-option"
              data-dropdown-close
              href="/help"
              rel="noopener noreferrer"
              target="_blank"
            >
              <icon>help_center</icon>
              <span>{copy.notesHelpCenter}</span>
            </a>
            <button
              className="notes-help-option"
              data-dropdown-close
              onClick={() =>
                openKeyboardShortcutsModal({
                  shortcuts,
                  title: copy.notesKeyboardShortcutsTitle,
                })
              }
              type="button"
            >
              <icon>keyboard</icon>
              <span>{copy.meetKeyboardShortcuts}</span>
            </button>
          </DropdownWrapper>
          <button
            className="notes-sidebar-item"
            onClick={() => openFeedbackModal({ context: "notes" })}
            title={copy.tasksFeedback}
            type="button"
          >
            <span className="notes-sidebar-icon">
              <icon>feedback</icon>
            </span>
            <span className="notes-sidebar-label">{copy.tasksFeedback}</span>
          </button>
        </nav>
      </div>
    </aside>
  );
}
