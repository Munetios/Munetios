"use client";

import { useEffect, useRef, useState } from "react";
import CustomToggle from "../../../components/customToggle";
import DropdownWrapper from "../../../components/dropdownwrapper";
import LanguageSelector from "../../../components/languageSelector";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";

const settingsStorageKey = "munetios.supanotes.settings";
const notesStorageKey = "munetios.supanotes.notes";

const defaultSettings = {
  autoCapitalize: true,
  autoCorrect: true,
  autoPairBrackets: true,
  autoPairQuotes: true,
  autoSave: true,
  characterCount: false,
  confirmBeforeTrash: true,
  defaultAlignment: "left",
  editorFont: "account-default",
  editorWidth: "comfortable",
  focusMode: false,
  fontSize: "16",
  highlightCurrentLine: false,
  lineHeight: "1.6",
  linkDetection: true,
  markdownShortcuts: true,
  offlineAccess: true,
  paragraphSpacing: "normal",
  pasteFormatting: "keep",
  readingTime: false,
  showLineNumbers: false,
  showNotePreviews: true,
  sidebarMode: "auto",
  smartQuotes: true,
  spellcheck: true,
  tabSize: "4",
  typewriterScrolling: false,
  wordCount: true,
};

const sections = [
  { icon: "tune", key: "notesSettingsGeneral", value: "general" },
  { icon: "edit_note", key: "notesSettingsEditor", value: "editor" },
  { icon: "settings_suggest", key: "notesSettingsAdvanced", value: "advanced" },
];

function getLocalSettings() {
  const saved = JSON.parse(
    window.localStorage.getItem(settingsStorageKey) || "{}",
  );
  return { ...defaultSettings, ...saved };
}

function getLocalNotes() {
  const notes = JSON.parse(
    window.localStorage.getItem(notesStorageKey) || "[]",
  );
  if (!Array.isArray(notes)) throw new Error("Invalid local notes");
  return notes;
}

function publishSettings(settings) {
  window.dispatchEvent(
    new CustomEvent("munetios:notes-settings-change", { detail: settings }),
  );
}

function publishNotes(notes) {
  window.dispatchEvent(
    new CustomEvent("munetios:supanotes-notes-change", { detail: notes }),
  );
}

function downloadJson(payload, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function mergeNotes(current, imported) {
  const notes = new Map(current.map((note) => [note.id, note]));
  for (const note of imported) {
    if (!note || typeof note !== "object") continue;
    const id = String(note.id || crypto.randomUUID()).slice(0, 100);
    notes.set(id, { ...note, id });
  }
  return [...notes.values()].slice(0, 5000);
}

function SettingsToggle({ checked, label, onChange }) {
  return (
    <div className="notes-settings-control-row">
      <span className="ai-settings-toggle-label">{label}</span>
      <CustomToggle checked={checked} label={label} onChange={onChange} />
    </div>
  );
}

function SettingsDropdown({ label, onChange, options, value }) {
  const selected =
    options.find((option) => option.value === value) || options[0];
  return (
    <div className="notes-settings-field">
      <span>{label}</span>
      <DropdownWrapper
        align="right"
        ariaLabel={label}
        buttonClassName="notes-settings-dropdown-trigger"
        className="w-full"
        panelClassName="w-[min(22rem,calc(100vw-1rem))]"
        persistent
        trigger={
          <>
            <span>{selected.label}</span>
            <icon>expand_more</icon>
          </>
        }
        triggerAs="button"
        triggerGlass={false}
        zIndex={100000006}
      >
        {options.map((option) => (
          <button
            aria-checked={option.value === value}
            className="notes-settings-dropdown-option"
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
    </div>
  );
}

function DeleteAllNotesConfirmation({ close, copy, signedIn }) {
  const [working, setWorking] = useState(false);
  const deleteAll = async () => {
    setWorking(true);
    try {
      if (signedIn) {
        const response = await fetch("/api/supanotes/notes", {
          credentials: "include",
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Delete failed");
      } else {
        window.localStorage.setItem(notesStorageKey, "[]");
      }
      publishNotes([]);
      close();
    } catch {
      showToast({ messageKey: "notesDeleteAllFailed", type: "error" });
      setWorking(false);
    }
  };
  return (
    <div className="notes-settings-confirmation">
      <p>{copy.notesDeleteAllConfirmBody}</p>
      <div>
        <button onClick={close} type="button">
          {copy.cancel}
        </button>
        <button disabled={working} onClick={deleteAll} type="button">
          {copy.notesDeleteAllConfirm}
        </button>
      </div>
    </div>
  );
}

function openDeleteAllNotesConfirmation({ copy, signedIn }) {
  showModal(
    ({ close }) => (
      <DeleteAllNotesConfirmation
        close={close}
        copy={copy}
        signedIn={signedIn}
      />
    ),
    {
      ariaLabel: copy.notesDeleteAllConfirmTitle,
      closeOnBackdrop: false,
      title: copy.notesDeleteAllConfirmTitle,
      width: "32rem",
      zIndex: 100000003,
    },
  );
}

function ImportNotesDialog({ close, copy, signedIn }) {
  const [file, setFile] = useState(null);
  const [working, setWorking] = useState(false);
  const importNotes = async (event) => {
    event.preventDefault();
    if (!file || working) return;
    setWorking(true);
    try {
      if (file.size > 5_000_000) throw new Error("File too large");
      const payload = JSON.parse(await file.text());
      const imported = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.notes)
          ? payload.notes
          : null;
      if (!imported) throw new Error("Invalid import");
      let notes;
      if (signedIn) {
        const response = await fetch("/api/supanotes/import", {
          body: JSON.stringify({ notes: imported }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) throw new Error("Import failed");
        notes = (await response.json()).notes;
      } else {
        notes = mergeNotes(getLocalNotes(), imported);
        window.localStorage.setItem(notesStorageKey, JSON.stringify(notes));
      }
      publishNotes(notes);
      showToast({ messageKey: "notesImportSuccess", type: "success" });
      close();
    } catch {
      showToast({ messageKey: "notesTransferFailed", type: "error" });
      setWorking(false);
    }
  };
  return (
    <form className="notes-import-form" onSubmit={importNotes}>
      <label>
        <icon>upload_file</icon>
        <span>{file?.name || copy.notesChooseImportFile}</span>
        <input
          accept="application/json,.json"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
          type="file"
        />
      </label>
      <div>
        <button onClick={close} type="button">
          {copy.cancel}
        </button>
        <button disabled={!file || working} type="submit">
          {copy.notesImportNotes}
        </button>
      </div>
    </form>
  );
}

function openImportNotesDialog({ copy, signedIn }) {
  showModal(
    ({ close }) => (
      <ImportNotesDialog close={close} copy={copy} signedIn={signedIn} />
    ),
    {
      ariaLabel: copy.notesImportNotes,
      closeOnBackdrop: false,
      title: copy.notesImportNotes,
      width: "34rem",
      zIndex: 100000003,
    },
  );
}

function NotesSettings({ copy, signedIn }) {
  const [activeSection, setActiveSection] = useState("general");
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(defaultSettings);
  const savedSettingsRef = useRef(defaultSettings);
  const settingsRef = useRef(defaultSettings);
  const updateQueuesRef = useRef({});
  const updateVersionsRef = useRef({});

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const nextSettings = signedIn
          ? await fetch("/api/supanotes/settings", {
              cache: "no-store",
              credentials: "include",
            }).then(async (response) => {
              if (!response.ok) throw new Error("Settings load failed");
              return (await response.json()).settings;
            })
          : getLocalSettings();
        if (active) {
          const loadedSettings = { ...defaultSettings, ...nextSettings };
          savedSettingsRef.current = loadedSettings;
          settingsRef.current = loadedSettings;
          setSettings(loadedSettings);
          publishSettings(loadedSettings);
        }
      } catch {
        showToast({ messageKey: "notesSettingsLoadFailed", type: "error" });
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [signedIn]);

  const updateSetting = async (key, value) => {
    const next = { ...settingsRef.current, [key]: value };
    const updateVersion = (updateVersionsRef.current[key] || 0) + 1;
    updateVersionsRef.current[key] = updateVersion;
    settingsRef.current = next;
    setSettings(next);
    try {
      if (signedIn) {
        const previousRequest =
          updateQueuesRef.current[key] || Promise.resolve();
        const request = previousRequest
          .catch(() => undefined)
          .then(() =>
            fetch("/api/supanotes/settings", {
              body: JSON.stringify({ settings: { [key]: value } }),
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              method: "PATCH",
            }),
          );
        updateQueuesRef.current[key] = request;
        const response = await request;
        if (!response.ok) throw new Error("Settings update failed");
        const payload = await response.json();
        savedSettingsRef.current = {
          ...savedSettingsRef.current,
          [key]: payload.settings[key],
        };
        if (updateVersionsRef.current[key] !== updateVersion) return;
        const saved = {
          ...settingsRef.current,
          [key]: payload.settings[key],
        };
        settingsRef.current = saved;
        setSettings(saved);
        publishSettings(saved);
        return;
      }
      window.localStorage.setItem(settingsStorageKey, JSON.stringify(next));
      savedSettingsRef.current = next;
      publishSettings(next);
    } catch {
      if (updateVersionsRef.current[key] !== updateVersion) return;
      const restored = {
        ...settingsRef.current,
        [key]: savedSettingsRef.current[key],
      };
      settingsRef.current = restored;
      setSettings(restored);
      publishSettings(restored);
      showToast({ messageKey: "notesSettingsUpdateFailed", type: "error" });
    }
  };

  const exportNotes = async () => {
    try {
      const exportedAt = new Date().toISOString();
      const filename = `Munetios-SupaNotes-${exportedAt.slice(0, 10)}.json`;
      if (signedIn) {
        const response = await fetch("/api/supanotes/export", {
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) throw new Error("Export failed");
        downloadJson(await response.json(), filename);
      } else {
        downloadJson(
          {
            exportedAt,
            notes: getLocalNotes(),
            product: "Munetios SupaNotes",
            version: 1,
          },
          filename,
        );
      }
      showToast({ messageKey: "notesExportSuccess", type: "success" });
    } catch {
      showToast({ messageKey: "notesTransferFailed", type: "error" });
    }
  };

  const dropdown = (label, key, options) => (
    <SettingsDropdown
      label={label}
      onChange={(value) => updateSetting(key, value)}
      options={options}
      value={settings[key]}
    />
  );
  const toggle = (label, key) => (
    <SettingsToggle
      checked={settings[key]}
      label={label}
      onChange={(value) => updateSetting(key, value)}
    />
  );

  return (
    <div className="notes-settings-layout">
      <nav
        aria-label={copy.notesSettingsNavigation}
        className="notes-settings-sidebar"
      >
        {sections.map((section) => (
          <button
            aria-current={activeSection === section.value ? "page" : undefined}
            key={section.value}
            onClick={() => setActiveSection(section.value)}
            type="button"
          >
            <icon>{section.icon}</icon>
            <span>{copy[section.key]}</span>
          </button>
        ))}
      </nav>

      <section className="notes-settings-content">
        <h2>
          {
            copy[
              sections.find((section) => section.value === activeSection)
                ?.key || "notesSettingsGeneral"
            ]
          }
        </h2>
        {loading
          ? <output
              className="notes-settings-loading"
              aria-label={copy.loading}
            >
              <span className="spinner-container">
                <svg
                  aria-hidden="true"
                  className="google-spinner"
                  viewBox="0 0 50 50"
                >
                  <circle
                    className="spinner-circle"
                    cx="25"
                    cy="25"
                    fill="none"
                    r="20"
                    strokeWidth="4"
                  />
                </svg>
              </span>
            </output>
          : null}

        {!loading && activeSection === "general"
          ? <div className="notes-settings-controls">
              <div className="notes-settings-language-field">
                <LanguageSelector
                  align="right"
                  buttonClassName="notes-settings-language-trigger"
                  copy={copy}
                  panelClassName="max-h-80 w-[min(24rem,calc(100vw-1rem))] overflow-y-auto"
                  persistent
                />
              </div>
              {dropdown(copy.notesSidebarMode, "sidebarMode", [
                { label: copy.notesSidebarModeAuto, value: "auto" },
                { label: copy.notesSidebarModeExpanded, value: "expanded" },
                { label: copy.notesSidebarModeCollapsed, value: "collapsed" },
              ])}
              {toggle(copy.notesShowNotePreviews, "showNotePreviews")}
            </div>
          : null}

        {!loading && activeSection === "editor"
          ? <div className="notes-settings-controls">
              {dropdown(copy.notesDefaultFont, "editorFont", [
                {
                  label: copy.notesFontAccountDefault,
                  value: "account-default",
                },
                { label: "Google Sans Flex", value: "Google Sans Flex" },
                { label: "Google Sans", value: "Google Sans" },
                { label: "Inter", value: "Inter" },
                { label: "Open Sans", value: "Open Sans" },
                { label: "Poppins", value: "Poppins" },
                { label: "Roboto", value: "Roboto" },
                { label: copy.notesFontSystem, value: "system-ui" },
              ])}
              {dropdown(copy.notesEditorWidth, "editorWidth", [
                { label: copy.notesEditorWidthFocused, value: "focused" },
                {
                  label: copy.notesEditorWidthComfortable,
                  value: "comfortable",
                },
                { label: copy.notesEditorWidthWide, value: "wide" },
              ])}
              {toggle(copy.notesSpellcheck, "spellcheck")}
              {toggle(copy.notesAutoSave, "autoSave")}
              {dropdown(copy.notesFontSize, "fontSize", [
                { label: "14 px", value: "14" },
                { label: "16 px", value: "16" },
                { label: "18 px", value: "18" },
              ])}
              {dropdown(copy.notesLineHeight, "lineHeight", [
                { label: "1.4", value: "1.4" },
                { label: "1.6", value: "1.6" },
                { label: "1.8", value: "1.8" },
              ])}
              {dropdown(copy.notesParagraphSpacing, "paragraphSpacing", [
                { label: copy.notesSpacingCompact, value: "compact" },
                { label: copy.notesSpacingNormal, value: "normal" },
                { label: copy.notesSpacingRelaxed, value: "relaxed" },
              ])}
              {dropdown(copy.notesTabSize, "tabSize", [
                { label: "2", value: "2" },
                { label: "4", value: "4" },
                { label: "8", value: "8" },
              ])}
              {dropdown(copy.notesDefaultAlignment, "defaultAlignment", [
                { label: copy.notesAlignmentLeft, value: "left" },
                { label: copy.notesAlignmentCenter, value: "center" },
                { label: copy.notesAlignmentRight, value: "right" },
              ])}
              {dropdown(copy.notesPasteFormatting, "pasteFormatting", [
                { label: copy.notesPasteKeepFormatting, value: "keep" },
                { label: copy.notesPastePlainText, value: "plain" },
              ])}
              {toggle(copy.notesMarkdownShortcuts, "markdownShortcuts")}
              {toggle(copy.notesSmartQuotes, "smartQuotes")}
              {toggle(copy.notesAutoCapitalize, "autoCapitalize")}
              {toggle(copy.notesAutoCorrect, "autoCorrect")}
              {toggle(copy.notesHighlightCurrentLine, "highlightCurrentLine")}
              {toggle(copy.notesShowLineNumbers, "showLineNumbers")}
              {toggle(copy.notesFocusMode, "focusMode")}
              {toggle(copy.notesTypewriterScrolling, "typewriterScrolling")}
              {toggle(copy.notesAutoPairBrackets, "autoPairBrackets")}
              {toggle(copy.notesAutoPairQuotes, "autoPairQuotes")}
              {toggle(copy.notesLinkDetection, "linkDetection")}
              {toggle(copy.notesWordCount, "wordCount")}
              {toggle(copy.notesCharacterCount, "characterCount")}
              {toggle(copy.notesReadingTime, "readingTime")}
            </div>
          : null}

        {!loading && activeSection === "advanced"
          ? <div className="notes-settings-controls">
              {toggle(copy.notesOfflineAccess, "offlineAccess")}
              {toggle(copy.notesConfirmBeforeTrash, "confirmBeforeTrash")}
              <div className="notes-settings-actions">
                <button onClick={exportNotes} type="button">
                  <icon>download</icon>
                  <span>{copy.notesExportAll}</span>
                </button>
                <button
                  onClick={() => openImportNotesDialog({ copy, signedIn })}
                  type="button"
                >
                  <icon>upload</icon>
                  <span>{copy.notesImportNotes}</span>
                </button>
                <button
                  className="is-danger"
                  onClick={() =>
                    openDeleteAllNotesConfirmation({ copy, signedIn })
                  }
                  type="button"
                >
                  <icon>delete_forever</icon>
                  <span>{copy.notesDeleteAll}</span>
                </button>
              </div>
            </div>
          : null}
      </section>
    </div>
  );
}

export function openNotesSettingsModal({ copy, signedIn = false }) {
  return showModal(<NotesSettings copy={copy} signedIn={signedIn} />, {
    ariaLabel: copy.settings,
    closeOnBackdrop: false,
    contentClassName: "min-h-0 flex-1",
    height: "min(46rem, calc(100dvh - 1rem))",
    title: copy.settings,
    width: "920px",
    zIndex: 100000001,
  });
}
