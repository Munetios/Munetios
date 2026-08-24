"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DropdownWrapper from "./dropdownwrapper";
import { showModal } from "./modal";
import { showToast } from "./toast";

const buttonClass =
  "liquid-glass inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-purple-700/45! px-4 py-2.5 text-sm font-bold text-white transition hover:bg-purple-600/60! disabled:cursor-not-allowed disabled:opacity-50";
const dangerButtonClass =
  "liquid-glass inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/20 bg-rose-700/35! px-4 py-2.5 text-sm font-bold text-rose-50 transition hover:bg-rose-600/50! disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
  "liquid-glass mt-2 w-full rounded-xl border border-white/10 bg-purple-950/35! px-3 py-2.5 text-sm text-white outline-none focus:border-purple-300/55";
const guestDataControlsKey = "munetios.guestDataControls";
const appLauncherLinksNewTabKey = "munetios.openAppLauncherLinksInNewTab";
const guestMeetingHistoryKey = "munetios.meet.history";
const guestRecordingKeys = ["munetios.meet.recordings", "meet-recordings-v1"];

function getGuestSettings() {
  if (typeof window === "undefined") {
    return {
      encryptionType: "end_to_end",
      openAppLauncherLinksInNewTab: true,
      personalizeAi: true,
    };
  }
  try {
    const settings = JSON.parse(
      window.localStorage.getItem(guestDataControlsKey) || "{}",
    );
    return {
      encryptionType:
        settings.encryptionType === "encrypted_at_rest"
          ? "encrypted_at_rest"
          : "end_to_end",
      personalizeAi: settings.personalizeAi !== false,
      openAppLauncherLinksInNewTab:
        settings.openAppLauncherLinksInNewTab !== false,
    };
  } catch {
    return {
      encryptionType: "end_to_end",
      openAppLauncherLinksInNewTab: true,
      personalizeAi: true,
    };
  }
}

function syncAppLauncherPreference(settings) {
  window.localStorage.setItem(
    appLauncherLinksNewTabKey,
    String(settings.openAppLauncherLinksInNewTab !== false),
  );
}

function saveGuestSettings(settings) {
  window.localStorage.setItem(guestDataControlsKey, JSON.stringify(settings));
  window.dispatchEvent(new Event("munetios:guestdatacontrolschange"));
}

function deleteGuestMeetingData(action) {
  if (action === "call_history") {
    window.localStorage.removeItem(guestMeetingHistoryKey);
    window.dispatchEvent(new Event("munetios:meethistorychange"));
    return;
  }
  for (const key of guestRecordingKeys) window.localStorage.removeItem(key);
  window.dispatchEvent(new Event("munetios:meetrecordingschange"));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "request_failed");
  return payload;
}

function SettingsRow({ action, description, icon, title }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5! p-4 sm:flex-row sm:items-center">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/15! text-purple-100">
        <icon>{icon}</icon>
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-bold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-white/55">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function importEndpoint() {
  const workspaceId =
    window.localStorage.getItem("munetiosActiveWorkspace") || "default";
  return `/api/account/import?workspaceId=${encodeURIComponent(workspaceId)}`;
}

function ConfirmAction({
  action,
  close,
  copy,
  description,
  passwordRequired = false,
}) {
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        try {
          await action(password);
          close();
        } catch {
          showToast({ messageKey: "accountDataRequestFailed", type: "error" });
          setWorking(false);
        }
      }}
    >
      <p className="text-sm leading-6 text-white/70">{description}</p>
      {passwordRequired
        ? <label className="block text-sm font-semibold">
            {copy.accountSecurityCurrentPassword}
            <input
              autoComplete="current-password"
              className={inputClass}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
        : null}
      <div className="flex justify-end gap-2">
        <button className={buttonClass} onClick={close} type="button">
          {copy.cancel}
        </button>
        <button
          className={dangerButtonClass}
          disabled={working || (passwordRequired && !password)}
          type="submit"
        >
          {working ? copy.accountProcessing : copy.confirm}
        </button>
      </div>
    </form>
  );
}

function WorkspaceDeleteWizard({ close, copy, onDeleted }) {
  const [step, setStep] = useState(1);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const descriptions = [
    copy.accountDeleteWorkspacesMessage,
    copy.dataControlsDeleteWorkspacesStepTwo,
    copy.dataControlsDeleteWorkspacesPassword,
  ];
  return (
    <div className="space-y-4">
      <p className="text-xs font-bold uppercase tracking-widest text-purple-200/70">
        {copy.dataControlsStep
          .replace("{current}", step)
          .replace("{total}", "3")}
      </p>
      <p className="text-sm leading-6 text-white/70">
        {descriptions[step - 1]}
      </p>
      {step === 3
        ? <label className="block text-sm font-semibold">
            {copy.accountSecurityCurrentPassword}
            <input
              autoComplete="current-password"
              className={inputClass}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
        : null}
      <div className="flex justify-between gap-2">
        <button
          className={buttonClass}
          onClick={step === 1 ? close : () => setStep(step - 1)}
          type="button"
        >
          {step === 1 ? copy.cancel : copy.accountBack}
        </button>
        <button
          className={step === 3 ? dangerButtonClass : buttonClass}
          disabled={working || (step === 3 && !password)}
          onClick={async () => {
            if (step < 3) return setStep(step + 1);
            setWorking(true);
            try {
              await requestJson("/api/account/data-controls", {
                body: JSON.stringify({ action: "workspaces", password }),
                method: "DELETE",
              });
              onDeleted();
              close();
            } catch {
              showToast({
                messageKey: "accountDataRequestFailed",
                type: "error",
              });
              setWorking(false);
            }
          }}
          type="button"
        >
          {working
            ? copy.accountProcessing
            : step === 3
              ? copy.deleteAllWorkspaces
              : copy.continue}
        </button>
      </div>
    </div>
  );
}

function ArchiveWizard({ account, close, copy }) {
  const [step, setStep] = useState(1);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-xs font-bold uppercase tracking-widest text-amber-200/80">
        {copy.dataControlsStep
          .replace("{current}", step)
          .replace("{total}", "2")}
      </p>
      <div className="rounded-xl border border-amber-300/20 bg-amber-500/10! p-4 text-sm leading-6 text-amber-50/85">
        {step === 1
          ? copy.archiveAccountLongWarning
          : copy.archiveAccountPasswordDescription}
      </div>
      {step === 2
        ? <label className="block text-sm font-semibold">
            {copy.accountSecurityCurrentPassword}
            <input
              autoComplete="current-password"
              className={inputClass}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
        : null}
      <div className="flex justify-between gap-2">
        <button
          className={buttonClass}
          onClick={step === 1 ? close : () => setStep(1)}
          type="button"
        >
          {step === 1 ? copy.cancel : copy.accountBack}
        </button>
        <button
          className={dangerButtonClass}
          disabled={working || (step === 2 && !password)}
          onClick={async () => {
            if (step === 1) return setStep(2);
            setWorking(true);
            try {
              const payload = await requestJson("/api/account/archive", {
                body: JSON.stringify({ password }),
                method: "POST",
              });
              window.localStorage.setItem(
                "munetios.archivedAccount",
                JSON.stringify(payload.account || account),
              );
              window.dispatchEvent(new Event("munetios:authchange"));
              close();
              window.location.assign("/apps");
            } catch {
              showToast({
                messageKey: "accountDataRequestFailed",
                type: "error",
              });
              setWorking(false);
            }
          }}
          type="button"
        >
          {working
            ? copy.accountProcessing
            : step === 1
              ? copy.continue
              : copy.archiveAccount}
        </button>
      </div>
    </div>
  );
}

function DeleteAccountWizard({ close, copy }) {
  const [step, setStep] = useState(1);
  const [checks, setChecks] = useState([false, false, false, false, false]);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const warnings = [
    copy.deleteAccountWarningOne,
    copy.deleteAccountWarningTwo,
    copy.deleteAccountWarningThree,
    copy.deleteAccountWarningFour,
    copy.deleteAccountWarningFive,
    copy.deleteAccountWarningSix,
    copy.deleteAccountWarningSeven,
    copy.deleteAccountWarningEight,
    copy.deleteAccountWarningNine,
    copy.deleteAccountWarningTen,
  ];
  const checklist = [
    copy.accountDangerWarning1,
    copy.accountDangerWarning2,
    copy.accountDangerWarning4,
    copy.accountDangerWarning7,
    copy.accountDangerWarning9,
  ];
  const ready = checks.every(Boolean) && Boolean(password);
  return (
    <div className="space-y-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-200">
        {copy.dataControlsStep
          .replace("{current}", step)
          .replace("{total}", "10")}
      </p>
      <div className="rounded-2xl border border-rose-300/25 bg-rose-950/35! p-4">
        <div className="flex items-start gap-3">
          <icon className="text-rose-200">warning</icon>
          <p className="text-sm leading-7 text-rose-50/85">
            {warnings[step - 1]}
          </p>
        </div>
      </div>
      {step === 10
        ? <div className="space-y-3">
            {checklist.map((label, index) => (
              <label
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5! p-3 text-sm leading-6"
                key={label}
              >
                <input
                  checked={checks[index]}
                  className="mt-1 h-4 w-4 accent-rose-500"
                  onChange={(event) =>
                    setChecks((current) =>
                      current.map((value, itemIndex) =>
                        itemIndex === index ? event.target.checked : value,
                      ),
                    )
                  }
                  type="checkbox"
                />
                <span>{label}</span>
              </label>
            ))}
            <label className="block text-sm font-semibold">
              {copy.accountSecurityCurrentPassword}
              <input
                autoComplete="current-password"
                className={inputClass}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
          </div>
        : null}
      <div className="flex justify-between gap-2">
        <button
          className={buttonClass}
          onClick={step === 1 ? close : () => setStep(step - 1)}
          type="button"
        >
          {step === 1 ? copy.cancel : copy.accountBack}
        </button>
        <button
          className={step === 10 ? dangerButtonClass : buttonClass}
          disabled={working || (step === 10 && !ready)}
          onClick={async () => {
            if (step < 10) return setStep(step + 1);
            setWorking(true);
            try {
              const payload = await requestJson("/api/account/delete", {
                body: JSON.stringify({ confirmations: checks, password }),
                method: "POST",
              });
              window.localStorage.setItem(
                "munetios.deletedAccount",
                JSON.stringify({ purgeAt: payload.purgeAt }),
              );
              window.dispatchEvent(new Event("munetios:authchange"));
              close();
              window.location.assign("/signin");
            } catch {
              showToast({
                messageKey: "accountDataRequestFailed",
                type: "error",
              });
              setWorking(false);
            }
          }}
          type="button"
        >
          {working
            ? copy.accountProcessing
            : step === 10
              ? copy.deleteAccount
              : copy.continue}
        </button>
      </div>
    </div>
  );
}

function EncryptionDropdown({ copy, onChange, value }) {
  const options = [
    ["end_to_end", copy.encryptionEndToEnd],
    ["encrypted_at_rest", copy.encryptionAtRest],
  ];
  const selectedLabel = options.find(([id]) => id === value)?.[1];
  return (
    <DropdownWrapper
      align="right"
      ariaLabel={copy.encryptionType}
      buttonClassName="min-h-11 h-auto"
      label={selectedLabel}
      panelClassName="min-w-64"
      triggerAs="button"
    >
      {options.map(([id, label]) => (
        <button
          aria-checked={id === value}
          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-purple-600/30!"
          key={id}
          onClick={() => {
            if (id !== value) onChange(id);
          }}
          role="menuitemradio"
          type="button"
        >
          {label}
          {id === value ? <icon>check</icon> : null}
        </button>
      ))}
    </DropdownWrapper>
  );
}

export default function AccountDataControlsSection({
  account,
  copy,
  isGuest = false,
  managedStudent = false,
}) {
  const [settings, setSettings] = useState({
    encryptionType: "end_to_end",
    openAppLauncherLinksInNewTab: true,
    personalizeAi: true,
  });
  const [exportsList, setExportsList] = useState([]);
  const [showExports, setShowExports] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const takeoutInputRef = useRef(null);

  const load = useCallback(async () => {
    if (isGuest) {
      const guestSettings = getGuestSettings();
      setSettings(guestSettings);
      syncAppLauncherPreference(guestSettings);
      setExportsList([]);
      setShowExports(false);
      setLoading(false);
      return;
    }
    try {
      const [settingsPayload, exportsPayload] = await Promise.all([
        requestJson("/api/account/data-controls", { cache: "no-store" }),
        requestJson("/api/account/export", { cache: "no-store" }),
      ]);
      const nextSettings = managedStudent
        ? { ...settingsPayload.settings, personalizeAi: false }
        : settingsPayload.settings;
      setSettings(nextSettings);
      syncAppLauncherPreference(nextSettings);
      setExportsList(exportsPayload.exports || []);
    } catch {
      showToast({ messageKey: "accountDataRequestFailed", type: "error" });
    } finally {
      setLoading(false);
    }
  }, [isGuest, managedStudent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!exportsList.some((item) => item.status === "processing"))
      return undefined;
    const timer = window.setInterval(async () => {
      try {
        const payload = await requestJson("/api/account/export", {
          cache: "no-store",
        });
        setExportsList(payload.exports || []);
      } catch {}
    }, 2000);
    return () => window.clearInterval(timer);
  }, [exportsList]);

  const saveSetting = async (patch) => {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    syncAppLauncherPreference(next);
    if (isGuest) {
      try {
        saveGuestSettings(next);
      } catch {
        setSettings(previous);
        syncAppLauncherPreference(previous);
        showToast({ messageKey: "accountSettingsUpdateFailed", type: "error" });
      }
      return;
    }
    try {
      const payload = await requestJson("/api/account/data-controls", {
        body: JSON.stringify(patch),
        method: "PATCH",
      });
      setSettings(payload.settings);
      syncAppLauncherPreference(payload.settings);
    } catch {
      setSettings(previous);
      syncAppLauncherPreference(previous);
      showToast({ messageKey: "accountSettingsUpdateFailed", type: "error" });
    }
  };

  if (loading)
    return (
      <p className="p-4 text-sm text-white/60">{copy.accountProcessing}</p>
    );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-purple-200/65">
          {copy.accountSettings}
        </p>
        <h1 className="mt-2 text-2xl font-bold">
          {showExports
            ? copy.exportedDataTitle
            : copy.accountSettingsDataControls}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
          {showExports
            ? copy.exportedDataDescription
            : copy.accountSettingsDataControlsDescription}
        </p>
      </header>

      {showExports
        ? <section className="space-y-3">
            <button
              className={buttonClass}
              onClick={() => setShowExports(false)}
              type="button"
            >
              <icon>arrow_back</icon>
              {copy.accountBack}
            </button>
            {exportsList.length === 0
              ? <p className="rounded-2xl border border-white/10 bg-white/5! p-5 text-sm text-white/60">
                  {copy.exportedDataEmpty}
                </p>
              : exportsList.map((item) => (
                  <article
                    className="rounded-2xl border border-white/10 bg-white/5! p-4"
                    key={item.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="font-bold">{item.fileName}</h2>
                        <p className="mt-1 text-xs text-white/50">
                          {new Date(item.createdAt).toLocaleString()}
                        </p>
                      </div>
                      {item.status === "complete"
                        ? <a
                            className={buttonClass}
                            href={`/api/account/export?id=${encodeURIComponent(item.id)}`}
                          >
                            <icon>download</icon>
                            {copy.download}
                          </a>
                        : null}
                    </div>
                    <div
                      className="mt-4 h-2 overflow-hidden rounded-full bg-white/10!"
                      role="progressbar"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow={item.progress}
                    >
                      <div
                        className={`h-full rounded-full ${item.status === "failed" ? "bg-rose-500!" : "bg-purple-400!"}`}
                        style={{ width: `${Math.max(2, item.progress || 0)}%` }}
                      />
                    </div>
                    <p
                      className={`mt-2 text-xs font-semibold ${item.status === "failed" ? "text-rose-200" : "text-purple-100/70"}`}
                    >
                      {item.status === "complete"
                        ? copy.exportStatusComplete
                        : item.status === "failed"
                          ? copy.exportStatusFailed
                          : copy.exportStatusProcessing}
                    </p>
                  </article>
                ))}
          </section>
        : <>
            {!isGuest
              ? <section
                  className="space-y-3"
                  aria-labelledby="dataTransferTitle"
                >
                  <h2 className="text-lg font-bold" id="dataTransferTitle">
                    {copy.dataTransferTitle}
                  </h2>
                  <SettingsRow
                    action={
                      <button
                        className={buttonClass}
                        disabled={exporting}
                        onClick={async () => {
                          setExporting(true);
                          try {
                            const payload = await requestJson(
                              "/api/account/export",
                              { method: "POST" },
                            );
                            setExportsList((current) => [
                              payload.export,
                              ...current,
                            ]);
                            showToast({
                              messageKey: "exportDataQueuedSuccess",
                              type: "success",
                              duration: 8000,
                            });
                          } catch {
                            showToast({
                              messageKey: "exportDataFailed",
                              type: "error",
                            });
                          } finally {
                            setExporting(false);
                          }
                        }}
                        type="button"
                      >
                        <icon>archive</icon>
                        {copy.exportData}
                      </button>
                    }
                    description={copy.exportDataDescription}
                    icon="download"
                    title={copy.exportData}
                  />
                  <SettingsRow
                    action={
                      <div className="flex flex-wrap justify-end gap-2">
                        <input
                          accept=".zip,.mcalendar,.ics,application/zip,application/json,text/calendar"
                          className="hidden"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            setImporting(true);
                            try {
                              await requestJson(importEndpoint(), {
                                body: file,
                                headers: {
                                  "Content-Type":
                                    file.type ||
                                    (file.name.toLowerCase().endsWith(".ics")
                                      ? "text/calendar"
                                      : file.name
                                            .toLowerCase()
                                            .endsWith(".mcalendar")
                                        ? "application/json"
                                        : "application/zip"),
                                },
                                method: "POST",
                              });
                              showToast({
                                messageKey: "importDataSuccess",
                                type: "success",
                              });
                            } catch {
                              showToast({
                                messageKey: "importDataFailed",
                                type: "error",
                              });
                            } finally {
                              event.target.value = "";
                              setImporting(false);
                            }
                          }}
                          ref={fileInputRef}
                          type="file"
                        />
                        <input
                          className="hidden"
                          directory=""
                          multiple
                          onChange={async (event) => {
                            const files = Array.from(event.target.files || []);
                            if (!files.length) return;
                            setImporting(true);
                            try {
                              const form = new FormData();
                              for (const file of files) {
                                form.append("files", file, file.name);
                                form.append(
                                  "paths",
                                  file.webkitRelativePath || file.name,
                                );
                              }
                              await requestJson(importEndpoint(), {
                                body: form,
                                method: "POST",
                              });
                              showToast({
                                messageKey: "importDataSuccess",
                                type: "success",
                              });
                            } catch {
                              showToast({
                                messageKey: "importDataFailed",
                                type: "error",
                              });
                            } finally {
                              event.target.value = "";
                              setImporting(false);
                            }
                          }}
                          ref={takeoutInputRef}
                          type="file"
                          webkitdirectory=""
                        />
                        <button
                          className={buttonClass}
                          disabled={importing}
                          onClick={() => fileInputRef.current?.click()}
                          type="button"
                        >
                          <icon>upload</icon>
                          {copy.importData}
                        </button>
                        <button
                          className={buttonClass}
                          disabled={importing}
                          onClick={() => takeoutInputRef.current?.click()}
                          type="button"
                        >
                          <icon>drive_folder_upload</icon>
                          {copy.importGoogleTakeout}
                        </button>
                      </div>
                    }
                    description={copy.importDataDescription}
                    icon="upload_file"
                    title={copy.importData}
                  />
                  <p className="rounded-2xl border border-purple-300/15 bg-purple-500/8! p-4 text-sm leading-6 text-purple-100/75">
                    {copy.calendarDataTransferFormats}
                  </p>
                  <div className="rounded-2xl border border-purple-300/15 bg-purple-500/8! p-4">
                    <h3 className="font-bold text-purple-100">
                      {copy.importDataSecurityTitle}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-white/60">
                      {copy.importDataSecurityDescription}
                    </p>
                  </div>
                  <SettingsRow
                    action={
                      <button
                        className={buttonClass}
                        onClick={() => setShowExports(true)}
                        type="button"
                      >
                        <icon>folder_zip</icon>
                        {copy.exportedData}
                      </button>
                    }
                    description={copy.exportedDataDescription}
                    icon="folder_zip"
                    title={copy.exportedData}
                  />
                </section>
              : null}

            <section className="space-y-3" aria-labelledby="preferencesTitle">
              <h2 className="text-lg font-bold" id="preferencesTitle">
                {copy.dataPreferencesTitle}
              </h2>
              {!managedStudent
                ? <SettingsRow
                    action={
                      <button
                        aria-checked={settings.personalizeAi}
                        className={`relative h-7 w-12 rounded-full border border-white/15 transition ${settings.personalizeAi ? "bg-purple-500!" : "bg-white/10!"}`}
                        onClick={() =>
                          saveSetting({
                            personalizeAi: !settings.personalizeAi,
                          })
                        }
                        role="switch"
                        type="button"
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white! transition ${settings.personalizeAi ? "left-6" : "left-1"}`}
                        />
                      </button>
                    }
                    description={copy.personalizeAiDescription}
                    icon="auto_awesome"
                    title={copy.personalizeAi}
                  />
                : null}
              <SettingsRow
                action={
                  <button
                    aria-label={copy.appLauncherLinksNewTab}
                    aria-checked={settings.openAppLauncherLinksInNewTab}
                    className={`relative h-7 w-12 rounded-full border border-white/15 transition ${settings.openAppLauncherLinksInNewTab ? "bg-purple-500!" : "bg-white/10!"}`}
                    onClick={() =>
                      saveSetting({
                        openAppLauncherLinksInNewTab:
                          !settings.openAppLauncherLinksInNewTab,
                      })
                    }
                    role="switch"
                    type="button"
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white! transition ${settings.openAppLauncherLinksInNewTab ? "left-6" : "left-1"}`}
                    />
                  </button>
                }
                description={copy.appLauncherLinksNewTabDescription}
                icon="open_in_new"
                title={copy.appLauncherLinksNewTab}
              />
              <SettingsRow
                action={
                  <EncryptionDropdown
                    copy={copy}
                    onChange={(value) =>
                      showModal({
                        title: copy.encryptionChangeTitle,
                        content: ({ close }) => (
                          <ConfirmAction
                            action={async () => {
                              await saveSetting({ encryptionType: value });
                            }}
                            close={close}
                            copy={copy}
                            description={copy.encryptionChangeWarning}
                          />
                        ),
                      })
                    }
                    value={settings.encryptionType}
                  />
                }
                description={copy.encryptionTypeDescription}
                icon="encrypted"
                title={copy.encryptionType}
              />
            </section>

            <section className="space-y-3" aria-labelledby="meetingDataTitle">
              <h2 className="text-lg font-bold" id="meetingDataTitle">
                {copy.meetingDataTitle}
              </h2>
              {[
                [
                  "recordings",
                  "movie",
                  copy.deleteAllRecordings,
                  copy.deleteAllRecordingsDescription,
                ],
                [
                  "call_history",
                  "call",
                  copy.deleteAllCallHistory,
                  copy.deleteAllCallHistoryDescription,
                ],
              ].map(([action, icon, title, description]) => (
                <SettingsRow
                  key={action}
                  icon={icon}
                  title={title}
                  description={description}
                  action={
                    <button
                      className={dangerButtonClass}
                      onClick={() =>
                        showModal({
                          title,
                          content: ({ close }) => (
                            <ConfirmAction
                              action={async () => {
                                if (isGuest) {
                                  deleteGuestMeetingData(action);
                                } else {
                                  await requestJson(
                                    "/api/account/data-controls",
                                    {
                                      body: JSON.stringify({ action }),
                                      method: "DELETE",
                                    },
                                  );
                                }
                                showToast({
                                  messageKey: "accountDataDeleteSuccess",
                                  type: "success",
                                });
                              }}
                              close={close}
                              copy={copy}
                              description={description}
                            />
                          ),
                        })
                      }
                      type="button"
                    >
                      {title}
                    </button>
                  }
                />
              ))}
            </section>

            {!isGuest && !managedStudent
              ? <section
                  className="space-y-3"
                  aria-labelledby="workspaceDataTitle"
                >
                  <h2 className="text-lg font-bold" id="workspaceDataTitle">
                    {copy.workspaceDataTitle}
                  </h2>
                  <SettingsRow
                    action={
                      <button
                        className={dangerButtonClass}
                        onClick={() =>
                          showModal({
                            title: copy.deleteAllWorkspaces,
                            content: ({ close }) => (
                              <WorkspaceDeleteWizard
                                close={close}
                                copy={copy}
                                onDeleted={() =>
                                  showToast({
                                    messageKey: "accountDataDeleteSuccess",
                                    type: "success",
                                  })
                                }
                              />
                            ),
                          })
                        }
                        type="button"
                      >
                        {copy.deleteAllWorkspaces}
                      </button>
                    }
                    description={copy.accountDeleteWorkspacesMessage}
                    icon="workspaces"
                    title={copy.deleteAllWorkspaces}
                  />
                </section>
              : null}

            {!isGuest && !managedStudent
              ? <section
                  className="space-y-3 rounded-2xl border border-rose-300/20 bg-rose-950/20! p-4"
                  aria-labelledby="dangerZoneTitle"
                >
                  <div>
                    <h2
                      className="text-lg font-bold text-rose-100"
                      id="dangerZoneTitle"
                    >
                      {copy.dangerZone}
                    </h2>
                    <p className="mt-1 text-sm text-rose-100/60">
                      {copy.dangerZoneDescription}
                    </p>
                  </div>
                  <SettingsRow
                    action={
                      <button
                        className={dangerButtonClass}
                        onClick={() =>
                          showModal({
                            title: copy.archiveAccount,
                            content: ({ close }) => (
                              <ArchiveWizard
                                account={account}
                                close={close}
                                copy={copy}
                              />
                            ),
                          })
                        }
                        type="button"
                      >
                        {copy.archiveAccount}
                      </button>
                    }
                    description={copy.archiveAccountDescription}
                    icon="archive"
                    title={copy.archiveAccount}
                  />
                  <SettingsRow
                    action={
                      <button
                        className={dangerButtonClass}
                        onClick={() =>
                          showModal({
                            dismissible: false,
                            title: copy.deleteAccount,
                            width: "42rem",
                            content: ({ close }) => (
                              <DeleteAccountWizard close={close} copy={copy} />
                            ),
                          })
                        }
                        type="button"
                      >
                        {copy.deleteAccount}
                      </button>
                    }
                    description={copy.accountDeleteAccountMessage}
                    icon="delete_forever"
                    title={copy.deleteAccount}
                  />
                </section>
              : null}
          </>}
    </div>
  );
}
