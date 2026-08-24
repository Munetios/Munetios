"use client";

import { useEffect, useState } from "react";
import {
  developerSettingsDefaults,
  loadDeveloperSettings,
  saveDeveloperSettings,
} from "../lib/developerSettings";
import CustomToggle from "./customToggle";
import DropdownWrapper from "./dropdownwrapper";
import { showToast } from "./toast";

function SettingRow({ checked, description, label, onChange }) {
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
      <CustomToggle checked={checked} label={label} onChange={onChange} />
    </div>
  );
}

export default function AccountAdvancedSection({ copy }) {
  const [settings, setSettings] = useState(developerSettingsDefaults);
  const [provider, setProvider] = useState({ apiKey: "", name: "", url: "" });

  useEffect(() => setSettings(loadDeveloperSettings()), []);

  const update = (patch) => {
    setSettings((current) => saveDeveloperSettings({ ...current, ...patch }));
  };
  const encryptionOptions = [
    ["managed", copy.accountAdvancedPrivacyManagedEncryption],
    ["end-to-end", copy.accountAdvancedEndToEndEncrypted],
  ];
  const addProvider = () => {
    let normalizedUrl;
    try {
      normalizedUrl = new URL(provider.url);
    } catch {
      showToast({ message: copy.developerByokInvalid, type: "error" });
      return;
    }
    if (
      !/^https?:$/.test(normalizedUrl.protocol) ||
      !provider.name.trim() ||
      !provider.apiKey.trim()
    ) {
      showToast({ message: copy.developerByokInvalid, type: "error" });
      return;
    }
    const entry = {
      apiKey: provider.apiKey.trim(),
      id: `byok-${crypto.randomUUID()}`,
      name: provider.name.trim(),
      url: normalizedUrl.toString(),
    };
    update({ byokProviders: [...settings.byokProviders, entry] });
    setProvider({ apiKey: "", name: "", url: "" });
    showToast({ message: copy.developerByokAdded, type: "success" });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{copy.accountSettingsAdvanced}</h1>
        <p className="mt-1 text-sm leading-6 text-white/70">
          {copy.accountSettingsAdvancedDescription}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SettingRow
          checked={settings.developerMode}
          description={copy.developerModeDescription}
          label={copy.accountAdvancedDeveloperMode}
          onChange={(developerMode) => update({ developerMode })}
        />
        {settings.developerMode
          ? <SettingRow
              checked={settings.showHiddenItems}
              description={copy.developerShowHiddenDescription}
              label={copy.developerShowHiddenItems}
              onChange={(showHiddenItems) => update({ showHiddenItems })}
            />
          : null}
        <div className="rounded-2xl border border-white/10 bg-white/5! p-3 sm:col-span-2">
          <span className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {copy.accountAdvancedEncryptionType}
          </span>
          <DropdownWrapper
            align="left"
            ariaLabel={copy.accountAdvancedEncryptionType}
            buttonClassName="w-full justify-between"
            label={
              encryptionOptions.find(
                ([value]) => value === settings.encryption,
              )?.[1]
            }
          >
            {encryptionOptions.map(([value, label]) => (
              <button
                aria-checked={settings.encryption === value}
                data-dropdown-close
                key={value}
                onClick={() => update({ encryption: value })}
                role="menuitemradio"
                type="button"
              >
                <span>{label}</span>
                {settings.encryption === value ? <icon>check</icon> : null}
              </button>
            ))}
          </DropdownWrapper>
        </div>
      </div>
      {settings.developerMode
        ? <section className="liquid-glass space-y-3 rounded-2xl border border-purple-200/15 bg-purple-950/20! p-4">
            <div>
              <h2 className="text-lg font-bold">{copy.developerByokTitle}</h2>
              <p className="mt-1 text-xs leading-5 text-white/60">
                {copy.developerByokDescription}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="rounded-xl border border-white/10 bg-black/20! px-3 py-2 text-sm"
                onChange={(event) =>
                  setProvider((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder={copy.developerProviderName}
                value={provider.name}
              />
              <input
                className="rounded-xl border border-white/10 bg-black/20! px-3 py-2 text-sm"
                inputMode="url"
                onChange={(event) =>
                  setProvider((current) => ({
                    ...current,
                    url: event.target.value,
                  }))
                }
                placeholder={copy.developerProviderUrl}
                value={provider.url}
              />
              <input
                autoComplete="off"
                className="rounded-xl border border-white/10 bg-black/20! px-3 py-2 text-sm sm:col-span-2"
                onChange={(event) =>
                  setProvider((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder={copy.developerApiKey}
                type="password"
                value={provider.apiKey}
              />
            </div>
            <button
              className="rounded-xl bg-purple-600/60! px-4 py-2 text-sm font-bold"
              onClick={addProvider}
              type="button"
            >
              {copy.developerAddModel}
            </button>
            {settings.byokProviders.map((entry) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5! p-3"
                key={entry.id}
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm">
                    {entry.name}
                  </strong>
                  <small className="block truncate text-white/55">
                    {entry.url}
                  </small>
                </span>
                <button
                  aria-label={`${copy.delete} ${entry.name}`}
                  className="rounded-lg p-2 text-rose-200 hover:bg-rose-500/15!"
                  onClick={() =>
                    update({
                      byokProviders: settings.byokProviders.filter(
                        (item) => item.id !== entry.id,
                      ),
                    })
                  }
                  type="button"
                >
                  <icon>delete</icon>
                </button>
              </div>
            ))}
          </section>
        : null}
    </div>
  );
}
