"use client";

import { useCallback, useEffect, useState } from "react";
import CustomToggle from "./customToggle";
import LoadingSpinner from "./loadingSpinner";
import { showToast } from "./toast";

const emptySettings = {
  customEmailDomain: "",
  customSignIn: {
    enabled: false,
    heading: "",
    message: "",
  },
  monetizationEnabled: false,
};

function CapabilityRow({ description, enabled, icon, title }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5! p-4">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
          enabled
            ? "border-emerald-200/20 bg-emerald-500/20! text-emerald-100"
            : "border-amber-200/20 bg-amber-500/15! text-amber-100"
        }`}
      >
        <icon>{enabled ? icon : "lock"}</icon>
      </span>
      <div className="min-w-0">
        <h3 className="font-bold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-white/60">{description}</p>
      </div>
    </div>
  );
}

export default function AccountBusinessAdminSection({ account, copy }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(emptySettings);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/business/admin", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("business_admin_load_failed");
      const payload = await response.json();
      setData(payload);
      setSettings(payload.settings || emptySettings);
    } catch {
      showToast({ messageKey: "accountCheckFailed", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const verified = Boolean(data?.business?.verified);
  const updateSignIn = (key, value) => {
    setSettings((current) => ({
      ...current,
      customSignIn: { ...current.customSignIn, [key]: value },
    }));
  };

  const save = async () => {
    if (!verified || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/business/admin", {
        body: JSON.stringify(settings),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "save_failed");
      setSettings(payload.settings);
      setData((current) => ({
        ...current,
        signInPageUrl: payload.signInPageUrl,
      }));
      showToast({ messageKey: "accountSettingsSaved", type: "success" });
    } catch {
      showToast({ messageKey: "aiSettingsSaveFailed", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <LoadingSpinner label={copy.accountLoading} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{copy.accountSettingsAdmin}</h1>
        <p className="mt-1 text-sm leading-6 text-white/65">
          {copy.businessAdminDescription}
        </p>
      </div>

      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-200">
              {copy.businessAdminRole}
            </p>
            <p className="mt-2 text-lg font-bold">
              {copy.businessAdministrator}
            </p>
            <p className="mt-1 text-sm text-white/60">
              {account?.business?.name || data?.business?.name}
            </p>
          </div>
          <span
            className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold ${
              verified
                ? "border-emerald-200/20 bg-emerald-500/20! text-emerald-100"
                : "border-amber-200/20 bg-amber-500/15! text-amber-100"
            }`}
          >
            <icon>{verified ? "verified" : "pending"}</icon>
            {verified ? copy.businessVerified : copy.businessUnverified}
          </span>
        </div>
        {!verified
          ? <div className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-500/12! p-4">
              <h2 className="font-bold">
                {copy.businessVerificationComingSoon}
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/68">
                {copy.businessVerificationRequired}
              </p>
            </div>
          : null}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <CapabilityRow
          description={copy.businessCustomEmailDomainDescription}
          enabled={verified}
          icon="alternate_email"
          title={copy.businessCustomEmailDomain}
        />
        <CapabilityRow
          description={copy.businessCustomSignInDescription}
          enabled={verified}
          icon="login"
          title={copy.businessCustomSignIn}
        />
        <CapabilityRow
          description={copy.businessMonetizationDescription}
          enabled={verified}
          icon="payments"
          title={copy.businessMonetization}
        />
        <CapabilityRow
          description={
            verified
              ? copy.pricingBusinessProDescription
              : copy.businessUpgradeLocked
          }
          enabled={verified}
          icon="workspace_premium"
          title={copy.businessPlans}
        />
      </section>

      <section className="liquid-glass space-y-5 rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">{copy.businessCustomSignIn}</h2>
            <p className="mt-1 text-sm text-white/60">
              {copy.businessCustomSignInDescription}
            </p>
          </div>
          <CustomToggle
            checked={settings.customSignIn.enabled}
            disabled={!verified}
            label={copy.businessCustomSignIn}
            onChange={(value) => updateSignIn("enabled", value)}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-white/80">
            {copy.businessCustomSignInHeading}
            <input
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/10! px-3 outline-none focus:border-purple-300/60 disabled:opacity-50"
              disabled={!verified}
              maxLength={100}
              onChange={(event) => updateSignIn("heading", event.target.value)}
              value={settings.customSignIn.heading}
            />
          </label>
          <label className="text-sm font-semibold text-white/80">
            {copy.businessCustomEmailDomain}
            <input
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/10! px-3 outline-none focus:border-purple-300/60 disabled:opacity-50"
              disabled={!verified}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  customEmailDomain: event.target.value,
                }))
              }
              placeholder="business.munetios.com"
              value={settings.customEmailDomain}
            />
          </label>
        </div>
        <label className="block text-sm font-semibold text-white/80">
          {copy.businessCustomSignInMessage}
          <textarea
            className="mt-2 min-h-24 w-full resize-y rounded-xl border border-white/10 bg-white/10! p-3 outline-none focus:border-purple-300/60 disabled:opacity-50"
            disabled={!verified}
            maxLength={300}
            onChange={(event) => updateSignIn("message", event.target.value)}
            value={settings.customSignIn.message}
          />
        </label>
        {verified && settings.customSignIn.enabled && data?.signInPageUrl
          ? <a
              className="inline-flex items-center gap-2 text-sm font-semibold text-purple-200 underline-offset-4 hover:underline"
              href={data.signInPageUrl}
            >
              <icon>open_in_new</icon>
              {copy.businessOpenSignInPage}
            </a>
          : null}
      </section>

      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">{copy.businessMonetization}</h2>
            <p className="mt-1 text-sm leading-6 text-white/60">
              {copy.businessMonetizationDescription}
            </p>
          </div>
          <CustomToggle
            checked={settings.monetizationEnabled}
            disabled={!verified}
            label={copy.businessMonetization}
            onChange={(value) =>
              setSettings((current) => ({
                ...current,
                monetizationEnabled: value,
              }))
            }
          />
        </div>
      </section>

      <button
        className="liquid-glass flex min-h-11 items-center justify-center gap-2 rounded-xl border border-purple-200/20 bg-[var(--accent)]/50! px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!verified || saving}
        onClick={save}
        type="button"
      >
        {saving
          ? <LoadingSpinner label={copy.accountProcessing} />
          : <>
              <icon>save</icon>
              {copy.aiChatSave}
            </>}
      </button>
    </div>
  );
}
