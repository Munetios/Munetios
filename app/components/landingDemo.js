"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { showModal } from "./modal";

const demoUrl = "/api/demo";
const demoCookieName = "munetios_demo";

function saveFallbackDemoCookie() {
  const demoId = crypto.randomUUID();

  // biome-ignore lint/suspicious/noDocumentCookie: The non-sensitive demo cookie enables the same-origin embedded demo.
  document.cookie = `${demoCookieName}=${encodeURIComponent(demoId)}; Path=/; Max-Age=7200; SameSite=Lax`;
}

function clearDemoCookie() {
  // biome-ignore lint/suspicious/noDocumentCookie: Clearing the demo cookie must work without Cookie Store API support.
  document.cookie = `${demoCookieName}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function DemoHeaderSettings({ close, copy, onSaved }) {
  const [settings, setSettings] = useState({
    archived: false,
    eligibleFamilies: true,
    eligibleTrustedPeople: true,
    plan: "business-pro",
    storageTotalGb: 10240,
    storageUsedGb: 12.5,
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/demo/settings", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((next) => {
        if (next) setSettings(next);
      })
      .catch(() => {});
  }, []);
  const format = (value) =>
    value >= 1024
      ? `${Number((value / 1024).toFixed(1))}TB`
      : `${Number(value.toFixed(1))}GB`;
  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/demo/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error("settings_failed");
      onSaved();
      close();
    } catch {
      window.showToast?.({ messageKey: "fetchError", type: "error" });
    } finally {
      setSaving(false);
    }
  };
  const plans = [
    ["personal", copy.demoPlanPersonal],
    ["business-free", copy.demoPlanBusinessFree],
    ["business-standard", copy.demoPlanBusinessStandard],
    ["business-pro", copy.demoPlanBusinessPro],
  ];
  const visiblePlans = settings.parentSupervision
    ? plans.filter(([value]) => value === "personal")
    : plans;
  return (
    <div className="space-y-5 text-sm text-white/80">
      <p>{copy.demoSettingsDescription}</p>
      <fieldset className="space-y-2">
        <legend className="font-semibold">{copy.demoPlan}</legend>
        <div className="flex flex-wrap gap-2">
          {visiblePlans.map(([value, label]) => (
            <button
              className={`rounded-xl border px-3 py-2 ${settings.plan === value ? "border-purple-200/50 bg-purple-500/60! text-white" : "border-white/10 bg-white/5!"}`}
              key={value}
              onClick={() =>
                setSettings((current) => ({ ...current, plan: value }))
              }
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-semibold">{copy.demoStoragePreset}</legend>
        <label className="block">
          {copy.demoStorageTotal}:{" "}
          <strong>{format(settings.storageTotalGb)}</strong>
          <input
            aria-label={copy.demoStorageTotal}
            className="mt-2 w-full accent-purple-400"
            max="10240"
            min="1"
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                storageTotalGb: Number(event.target.value),
                storageUsedGb: Math.min(
                  current.storageUsedGb,
                  Number(event.target.value),
                ),
              }))
            }
            step="1"
            type="range"
            value={settings.storageTotalGb}
          />
        </label>
        <label className="block">
          {copy.demoStorageUsed}:{" "}
          <strong>{format(settings.storageUsedGb)}</strong>
          <input
            aria-label={copy.demoStorageUsed}
            className="mt-2 w-full accent-purple-400"
            max={settings.storageTotalGb}
            min="0"
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                storageUsedGb: Number(event.target.value),
              }))
            }
            step="0.5"
            type="range"
            value={settings.storageUsedGb}
          />
        </label>
      </fieldset>
      {[
        ["eligibleTrustedPeople", copy.demoTrustedPeopleEligible],
        ["eligibleFamilies", copy.demoFamiliesEligible],
        ["parentSupervision", copy.demoParentSupervision],
        ["archived", copy.demoArchivedUser],
      ].map(([key, label]) => (
        <label
          className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5! px-3 py-2"
          key={key}
        >
          <span>{label}</span>
          <button
            aria-pressed={settings[key]}
            className={`h-7 w-12 rounded-full p-1 ${settings[key] ? "bg-purple-500!" : "bg-white/15!"}`}
            onClick={() =>
              setSettings((current) => {
                const parentSupervision =
                  key === "parentSupervision"
                    ? !current.parentSupervision
                    : current.parentSupervision;
                return {
                  ...current,
                  [key]: !current[key],
                  ...(parentSupervision ? { plan: "personal" } : {}),
                };
              })
            }
            type="button"
          >
            <span
              className={`block h-5 w-5 rounded-full bg-white transition ${settings[key] ? "translate-x-5" : ""}`}
            />
          </button>
        </label>
      ))}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 bg-white/5! px-3 py-2"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="rounded-xl bg-purple-500! px-3 py-2 font-bold text-white"
          disabled={saving}
          onClick={save}
          type="button"
        >
          {copy.demoSaveSettings}
        </button>
      </div>
    </div>
  );
}

export default function LandingDemo() {
  const [copy, setCopy] = useState(() => t());
  const [demoOpen, setDemoOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [iframeVersion, setIframeVersion] = useState(0);

  useEffect(() => {
    setMounted(true);

    const refreshCopy = () => setCopy(t());

    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);

    return () => {
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  useEffect(() => {
    if (!demoOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setDemoOpen(false);
        fetch(demoUrl, { credentials: "include", method: "DELETE" }).catch(
          () => undefined,
        );
        clearDemoCookie();
      }
    };
    const onBeforeUnload = () => {
      clearDemoCookie();
    };
    const onMessage = (event) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === "munetios:demo-exit"
      ) {
        clearDemoCookie();
        setDemoOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("message", onMessage);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [demoOpen]);

  const startDemo = async () => {
    if (starting) {
      return;
    }

    setStarting(true);

    try {
      const response = await fetch(demoUrl, {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Demo start failed: ${response.status}`);
      }
    } catch {
      saveFallbackDemoCookie();
    } finally {
      setDemoOpen(true);
      setStarting(false);
    }
  };

  const closeDemo = () => {
    fetch(demoUrl, { credentials: "include", method: "DELETE" }).catch(
      () => undefined,
    );
    clearDemoCookie();
    setDemoOpen(false);
  };

  const openDemoSettings = () =>
    showModal(
      ({ close }) => (
        <DemoHeaderSettings
          close={close}
          copy={copy}
          onSaved={() => setIframeVersion((value) => value + 1)}
        />
      ),
      { ariaLabel: copy.demoSettings, title: copy.demoSettings },
    );

  return (
    <>
      <button
        className="liquid-glass inline-flex items-center gap-2 rounded-5xl border border-purple-200/25 bg-white/10! px-4 py-2 font-bold text-white transition duration-300 hover:border-purple-100/40 hover:bg-purple-600/35! disabled:cursor-not-allowed disabled:opacity-60"
        disabled={starting}
        onClick={startDemo}
        type="button"
      >
        <icon>{starting ? "progress_activity" : "play_arrow"}</icon>
        {starting ? copy.demoStarting : copy.landingTryDemo}
      </button>

      {mounted && demoOpen
        ? createPortal(
            <section
              aria-label={copy.demoTitle}
              aria-modal="true"
              className="fixed inset-0 z-[2500] flex min-h-dvh flex-col bg-purple-950! text-white"
              role="dialog"
            >
              <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-purple-950/85! px-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/25! text-purple-100">
                    <icon>play_circle</icon>
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-bold sm:text-lg">
                      {copy.demoTitle}
                    </h2>
                    <p className="truncate text-xs text-white/50">
                      demo@munetios.com
                    </p>
                  </div>
                </div>
                <button
                  aria-label={copy.demoClose}
                  className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5! px-3 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/10! hover:text-white"
                  onClick={closeDemo}
                  type="button"
                >
                  <icon>close</icon>
                  <span>{copy.demoClose}</span>
                </button>
                <button
                  aria-label={copy.demoSettings}
                  className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5! px-3 text-white/75 transition hover:bg-white/10! hover:text-white"
                  onClick={openDemoSettings}
                  type="button"
                >
                  <icon>tune</icon>
                  <span>{copy.demoSettings}</span>
                </button>
              </header>

              <div className="min-h-0 flex-1 bg-purple-950!">
                <iframe
                  allow="clipboard-read; clipboard-write; fullscreen"
                  className="h-full w-full border-0 bg-purple-950!"
                  key={iframeVersion}
                  src="/apps?demo=true"
                  title={copy.demoFrameTitle}
                />
              </div>

              <footer className="liquid-glass shrink-0 border-t border-white/10 bg-purple-950/85! px-3 py-3 sm:px-5">
                <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold">{copy.demoEnjoyingTitle}</p>
                    <p className="text-sm leading-6 text-white/60">
                      {copy.demoEnjoyingMessage}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      className="rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/10! hover:text-white"
                      href="/signin?signup=true"
                      onClick={closeDemo}
                    >
                      {copy.demoPersonalSignup}
                    </a>
                    <a
                      className="rounded-xl border border-purple-200/25 bg-purple-500/80! px-3 py-2 text-sm font-semibold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90!"
                      href="/business/signup?plan=business-free"
                      onClick={closeDemo}
                    >
                      {copy.demoBusinessSignup}
                    </a>
                  </div>
                </div>
              </footer>
            </section>,
            document.body,
          )
        : null}
    </>
  );
}
