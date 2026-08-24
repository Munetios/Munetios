"use client";

import { useEffect, useState } from "react";
import CustomToggle from "./customToggle";
import DropdownWrapper from "./dropdownwrapper";

const storageKey = "munetios.account.privacy";
const defaults = {
  aiLocation: false,
  crashReports: false,
  monitor: true,
  personalizeAi: false,
  rememberHistory: false,
  telemetry: "low",
};

function loadSettings() {
  try {
    return {
      ...defaults,
      ...JSON.parse(window.localStorage.getItem(storageKey) || "{}"),
    };
  } catch {
    return defaults;
  }
}

function PrivacyToggle({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5! p-3">
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {label}
        </span>
        <span className="mt-1 block text-xs leading-5 text-white/60">
          {description}
        </span>
      </span>
      <CustomToggle
        checked={checked}
        disabled={disabled}
        label={label}
        onChange={onChange}
      />
    </div>
  );
}

export default function AccountPrivacySection({
  copy,
  managedStudent = false,
}) {
  const [settings, setSettings] = useState(defaults);
  useEffect(() => {
    const loaded = loadSettings();
    const next = managedStudent
      ? {
          ...loaded,
          aiLocation: false,
          personalizeAi: false,
          rememberHistory: false,
          telemetry: "low",
        }
      : loaded;
    setSettings(next);
    if (managedStudent) {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    }
  }, [managedStudent]);

  const update = (patch) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(
        new CustomEvent("munetios:privacy-settings-change", { detail: next }),
      );
      return next;
    });
  };

  const updateLocation = (enabled) => {
    if (!enabled) {
      update({ aiLocation: false });
      return;
    }
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => update({ aiLocation: true }),
      () => update({ aiLocation: false }),
      { maximumAge: 300000, timeout: 10000 },
    );
  };
  const telemetryOptions = [
    ["low", copy.meetRecordingEncodingChunksLow],
    ["medium", copy.meetRecordingEncodingChunksMedium],
    ["high", copy.meetRecordingEncodingChunksHigh],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div>
        <h1 className="text-2xl font-bold">{copy.accountSettingsPrivacy}</h1>
        <p className="mt-1 text-sm leading-6 text-white/70">
          {copy.accountSettingsPrivacyDescription}
        </p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5! p-3">
        <span className="mb-2 flex items-center gap-2 text-sm font-semibold">
          {copy.accountPrivacyTelemetry}
        </span>
        {managedStudent
          ? <button
              className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-left opacity-60"
              disabled
              type="button"
            >
              {telemetryOptions[0][1]}
            </button>
          : <DropdownWrapper
              align="left"
              ariaLabel={copy.accountPrivacyTelemetry}
              buttonClassName="w-full justify-between"
              label={
                telemetryOptions.find(
                  ([value]) => value === settings.telemetry,
                )?.[1]
              }
            >
              {telemetryOptions.map(([value, label]) => (
                <button
                  aria-checked={settings.telemetry === value}
                  data-dropdown-close
                  key={value}
                  onClick={() => update({ telemetry: value })}
                  role="menuitemradio"
                  type="button"
                >
                  <span>{label}</span>
                  {settings.telemetry === value ? <icon>check</icon> : null}
                </button>
              ))}
            </DropdownWrapper>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PrivacyToggle
          checked={settings.aiLocation}
          description={copy.aiSettingsLocationDescription}
          disabled={managedStudent}
          label={`${copy.accountPrivacyLocation} - Munetios AI`}
          onChange={updateLocation}
        />
        <PrivacyToggle
          checked={settings.crashReports}
          description={copy.accountSettingsPrivacyDescription}
          label={copy.accountPrivacyCrashReports}
          onChange={(crashReports) => update({ crashReports })}
        />
        <PrivacyToggle
          checked={settings.monitor}
          description={copy.accountSettingsPrivacyDescription}
          label={copy.accountPrivacyMonitor}
          onChange={(monitor) => update({ monitor })}
        />
        <PrivacyToggle
          checked={settings.personalizeAi}
          description={copy.personalizeAiDescription}
          disabled={managedStudent}
          label={copy.personalizeAi}
          onChange={(personalizeAi) => update({ personalizeAi })}
        />
        <PrivacyToggle
          checked={settings.rememberHistory}
          description={copy.aiForYouHistoryDescription}
          disabled={managedStudent}
          label={copy.aiSettingsRememberHistory}
          onChange={(rememberHistory) => update({ rememberHistory })}
        />
      </div>
    </div>
  );
}
