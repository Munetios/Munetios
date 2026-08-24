"use client";

import { useEffect, useState } from "react";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import {
  ensureAccountVaultUnlocked,
  getTasksWorkspaceData,
  getUnlockedAccountData,
  saveUnlockedAccountData,
  withTasksWorkspaceData,
} from "../lib/encryptedVault";

const defaultSettings = {
  autoArchiveCompleted: false,
  autoArchivePastDue: false,
  suggestCategories: true,
};

function saveSettings(settings) {
  window.dispatchEvent(
    new CustomEvent("munetios:taskssettingschange", { detail: settings }),
  );
}

function announceTasks(tasks, action) {
  window.dispatchEvent(
    new CustomEvent("munetios:taskschange", {
      detail: { action, tasks },
    }),
  );
}

async function updateEncryptedTasks(transform, action) {
  const data = getUnlockedAccountData() || (await ensureAccountVaultUnlocked());
  const scopedData = getTasksWorkspaceData(data);
  const tasks = transform(scopedData.tasks);
  const nextData = withTasksWorkspaceData(data, { ...scopedData, tasks });
  await saveUnlockedAccountData(nextData);
  announceTasks(tasks, action);
}

async function archiveAllTasks() {
  const archivedAt = new Date().toISOString();
  await updateEncryptedTasks(
    (tasks) =>
      tasks.map((task) => ({
        ...task,
        archived: true,
        archivedAt: task.archivedAt || archivedAt,
      })),
    "archive-all",
  );
}

async function deleteAllTasks() {
  await updateEncryptedTasks(() => [], "delete-all");
}

function TasksActionConfirmation({ close, copy, destructive, onConfirm }) {
  const [working, setWorking] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-white/75">
        {destructive ? copy.tasksDeleteAllWarning : copy.tasksArchiveAllWarning}
      </p>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-full border border-white/10 bg-white/5! px-4 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/10! hover:text-white"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className={`rounded-full border px-4 py-2 text-sm font-semibold text-white transition ${destructive ? "border-rose-200/25 bg-rose-500/70! hover:bg-rose-400/80!" : "border-purple-200/25 bg-purple-500/80! hover:bg-purple-400/90!"}`}
          disabled={working}
          onClick={async () => {
            setWorking(true);
            if (await onConfirm()) close();
            else setWorking(false);
          }}
          type="button"
        >
          {copy.confirm}
        </button>
      </div>
    </div>
  );
}

function PreferenceSwitch({ checked, label, onChange }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5! px-4 py-3">
      <span className="text-sm font-semibold text-white/85">{label}</span>
      <button
        aria-checked={checked}
        aria-label={label}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition ${checked ? "border-purple-200/35 bg-purple-500!" : "border-white/15 bg-white/10!"}`}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
        />
      </button>
    </label>
  );
}

function TasksSettings({ copy }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      const accountData = getUnlockedAccountData();
      if (accountData?.settings) {
        active &&
          setSettings((current) => ({ ...current, ...accountData.settings }));
        return;
      }

      try {
        const syncedAccountData = await ensureAccountVaultUnlocked();
        if (syncedAccountData?.settings) {
          active &&
            setSettings((current) => ({
              ...current,
              ...syncedAccountData.settings,
            }));
          return;
        }
      } catch {
        // fall back to local encrypted data when account vault is not available yet
      }

      // Settings are account-backed and remain at their defaults until sign-in
      // makes the encrypted account vault available.
    };
    void loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const updateSetting = async (key, value) => {
    const nextSettings = { ...settings, [key]: value };

    try {
      const accountData =
        getUnlockedAccountData() || (await ensureAccountVaultUnlocked());
      await saveUnlockedAccountData({ ...accountData, settings: nextSettings });
      setSettings(nextSettings);
      saveSettings(nextSettings);
    } catch {
      showToast({ message: copy.tasksSyncRequiresSignIn, type: "error" });
    }
  };

  const openActionConfirmation = (action) => {
    const destructive = action === "delete";
    showModal(
      ({ close }) => (
        <TasksActionConfirmation
          close={close}
          copy={copy}
          destructive={destructive}
          onConfirm={async () => {
            try {
              if (destructive) {
                await deleteAllTasks();
                setStatus(copy.tasksDeleteAllComplete);
              } else {
                await archiveAllTasks();
                setStatus(copy.tasksArchiveAllComplete);
              }
              return true;
            } catch {
              showToast({ messageKey: "accountRequestFailed", type: "error" });
              return false;
            }
          }}
        />
      ),
      {
        ariaLabel: destructive ? copy.tasksDeleteAll : copy.tasksArchiveAll,
        title: destructive ? copy.tasksDeleteAll : copy.tasksArchiveAll,
        zIndex: 100000002,
      },
    );
  };

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3 border-0 p-0">
        <legend className="mb-3 text-sm font-bold text-white">
          {copy.tasksSettingsGeneral}
        </legend>
        <PreferenceSwitch
          checked={settings.autoArchiveCompleted}
          label={copy.tasksAutoArchiveCompleted}
          onChange={(value) => updateSetting("autoArchiveCompleted", value)}
        />
        <PreferenceSwitch
          checked={settings.autoArchivePastDue}
          label={copy.tasksAutoArchivePastDue}
          onChange={(value) => updateSetting("autoArchivePastDue", value)}
        />
        <PreferenceSwitch
          checked={settings.suggestCategories}
          label={copy.tasksSuggestCategories}
          onChange={(value) => updateSetting("suggestCategories", value)}
        />
      </fieldset>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          className="rounded-2xl border border-purple-200/20 bg-purple-500/20! px-4 py-3 text-sm font-semibold text-white transition hover:bg-purple-500/30!"
          onClick={() => openActionConfirmation("archive")}
          type="button"
        >
          {copy.tasksArchiveAll}
        </button>
        <button
          className="rounded-2xl border border-rose-200/20 bg-rose-500/15! px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/25!"
          onClick={() => openActionConfirmation("delete")}
          type="button"
        >
          {copy.tasksDeleteAll}
        </button>
      </div>

      {status
        ? <output
            aria-live="polite"
            className="block rounded-xl border border-purple-200/20 bg-purple-500/15! px-3 py-2 text-sm text-purple-50"
          >
            {status}
          </output>
        : null}
    </div>
  );
}

export function openTasksSettingsModal({ copy }) {
  return showModal(<TasksSettings copy={copy} />, {
    ariaLabel: copy.settings,
    className: "tasks-settings-modal",
    title: copy.settings,
    width: "620px",
    zIndex: 100000001,
  });
}
