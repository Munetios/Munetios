"use client";

import { showModal } from "./modal";

function KeyboardShortcuts({ shortcuts }) {
  return (
    <div className="grid gap-1">
      {shortcuts.map((shortcut) => (
        <div
          className="flex items-center justify-between gap-6 rounded-xl px-3 py-2.5 odd:bg-white/5"
          key={`${shortcut.label}-${shortcut.keys.join("-")}`}
        >
          <span className="text-sm text-white/85">{shortcut.label}</span>
          <span className="flex shrink-0 items-center gap-1">
            {shortcut.keys.map((key) => (
              <kbd
                className="min-w-7 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-center text-xs font-semibold text-white shadow-sm"
                key={key}
              >
                {key}
              </kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export const tasksKeyboardShortcuts = [
  { keys: ["Ctrl", "Shift", "O"], label: "Create task" },
  { keys: ["Ctrl", "/"], label: "Keyboard shortcuts" },
  { keys: ["Ctrl", "K"], label: "Search tasks" },
  { keys: ["Ctrl", "Shift", "I"], label: "Open in-progress tasks" },
  { keys: ["Ctrl", "Shift", "C"], label: "Open completed tasks" },
  { keys: ["Ctrl", "Shift", "F"], label: "Open favorites" },
  { keys: ["Ctrl", "Shift", "D"], label: "Open drafts" },
  { keys: ["Ctrl", "Shift", "S"], label: "Open shared tasks" },
  { keys: ["Ctrl", "Shift", "A"], label: "Open archived tasks" },
  { keys: ["Ctrl", "Shift", "T"], label: "Open trash" },
  { keys: ["Ctrl", "Shift", "G"], label: "Open categories" },
  { keys: ["Ctrl", ","], label: "Open Tasks settings" },
];

export const aiKeyboardShortcuts = [
  { keys: ["Ctrl", "Shift", "O"], label: "New chat" },
  { keys: ["Ctrl", "Shift", "S"], label: "Start voice input" },
  { keys: ["Ctrl", "/"], label: "Keyboard shortcuts" },
];

export function openKeyboardShortcutsModal({
  shortcuts,
  title = "Keyboard shortcuts",
}) {
  showModal(<KeyboardShortcuts shortcuts={shortcuts} />, {
    ariaLabel: title,
    title,
    width: "620px",
  });
}
