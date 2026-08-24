import { getAccountData, setAccountData } from "./authSecurity.js";

const notesKey = "supanotes-notes-v1";
const settingsKey = "supanotes-settings-v1";

const demoNotes = globalThis.__munetiosSupaNotesNotes || new Map();
const demoSettings = globalThis.__munetiosSupaNotesSettings || new Map();
globalThis.__munetiosSupaNotesNotes = demoNotes;
globalThis.__munetiosSupaNotesSettings = demoSettings;

export const supaNotesAllowedFonts = new Set([
  "account-default",
  "Google Sans Flex",
  "Google Sans",
  "Inter",
  "Open Sans",
  "Poppins",
  "Roboto",
  "system-ui",
]);

export const supaNotesDefaultSettings = {
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

const allowedValues = {
  defaultAlignment: new Set(["left", "center", "right"]),
  editorWidth: new Set(["focused", "comfortable", "wide"]),
  fontSize: new Set(["14", "16", "18"]),
  lineHeight: new Set(["1.4", "1.6", "1.8"]),
  paragraphSpacing: new Set(["compact", "normal", "relaxed"]),
  pasteFormatting: new Set(["keep", "plain"]),
  sidebarMode: new Set(["auto", "expanded", "collapsed"]),
  tabSize: new Set(["2", "4", "8"]),
};

const booleanSettingKeys = [
  "autoCapitalize",
  "autoCorrect",
  "autoPairBrackets",
  "autoPairQuotes",
  "autoSave",
  "characterCount",
  "confirmBeforeTrash",
  "focusMode",
  "highlightCurrentLine",
  "linkDetection",
  "markdownShortcuts",
  "offlineAccess",
  "readingTime",
  "showLineNumbers",
  "showNotePreviews",
  "smartQuotes",
  "spellcheck",
  "typewriterScrolling",
  "wordCount",
];

function text(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safeDate(value, fallback) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function getDemoKey(session) {
  return session.sessionKey || session.user.id;
}

export function normalizeSupaNotesSettings(value = {}) {
  const settings = { ...supaNotesDefaultSettings };
  for (const key of booleanSettingKeys) {
    settings[key] =
      value[key] === undefined
        ? supaNotesDefaultSettings[key]
        : Boolean(value[key]);
  }
  for (const [key, values] of Object.entries(allowedValues)) {
    settings[key] = values.has(String(value[key]))
      ? String(value[key])
      : supaNotesDefaultSettings[key];
  }
  settings.editorFont = supaNotesAllowedFonts.has(value.editorFont)
    ? value.editorFont
    : supaNotesDefaultSettings.editorFont;
  return settings;
}

export function normalizeSupaNotesNotes(value) {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  const notes = value
    .slice(0, 5000)
    .filter((note) => note && typeof note === "object")
    .map((note) => ({
      content:
        typeof note.content === "string" ? note.content.slice(0, 200000) : "",
      createdAt: safeDate(note.createdAt, now),
      favorite: Boolean(note.favorite),
      folderId: text(note.folderId, 100) || null,
      folderName: text(note.folderName, 120) || null,
      id: text(note.id, 100) || crypto.randomUUID(),
      tags: Array.isArray(note.tags)
        ? [
            ...new Set(note.tags.map((tag) => text(tag, 60)).filter(Boolean)),
          ].slice(0, 50)
        : [],
      title: text(note.title, 200),
      trashed: Boolean(note.trashed),
      updatedAt: safeDate(note.updatedAt, now),
    }));
  return notes.filter(
    (note, index) =>
      notes.findIndex((candidate) => candidate.id === note.id) === index,
  );
}

export function getSupaNotesSettings(session) {
  const saved = session.demo
    ? demoSettings.get(getDemoKey(session))
    : getAccountData(session.user.id, settingsKey, null);
  return normalizeSupaNotesSettings(saved || {});
}

export function setSupaNotesSettings(session, value) {
  const settings = normalizeSupaNotesSettings(value);
  if (session.demo) demoSettings.set(getDemoKey(session), settings);
  else setAccountData(session.user.id, settingsKey, settings);
  return settings;
}

export function mergeSupaNotesSettings(session, value) {
  return setSupaNotesSettings(session, {
    ...getSupaNotesSettings(session),
    ...value,
  });
}

export function getSupaNotesNotes(session) {
  const saved = session.demo
    ? demoNotes.get(getDemoKey(session))
    : getAccountData(session.user.id, notesKey, []);
  return normalizeSupaNotesNotes(saved);
}

export function setSupaNotesNotes(session, value) {
  const notes = normalizeSupaNotesNotes(value);
  if (session.demo) demoNotes.set(getDemoKey(session), notes);
  else setAccountData(session.user.id, notesKey, notes);
  return notes;
}

export function mergeSupaNotesNotes(currentValue, importedValue) {
  const current = normalizeSupaNotesNotes(currentValue);
  const imported = normalizeSupaNotesNotes(importedValue);
  const notes = new Map(current.map((note) => [note.id, note]));
  for (const note of imported) {
    const existing = notes.get(note.id);
    if (
      !existing ||
      Date.parse(note.updatedAt) >= Date.parse(existing.updatedAt)
    ) {
      notes.set(note.id, note);
    }
  }
  return normalizeSupaNotesNotes([...notes.values()]);
}
