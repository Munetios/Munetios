"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorPickerWrapper } from "../../components/accountAppearanceSection";
import AccountAvatar from "../../components/accountAvatar";
import AccountWrapper from "../../components/accountwraper";
import AppLauncherWrapper from "../../components/appLauncherWrapper";
import CustomToggle from "../../components/customToggle";
import DropdownWrapper from "../../components/dropdownwrapper";
import LoadingSpinner from "../../components/loadingSpinner";
import { showModal } from "../../components/modal";
import { showToast } from "../../components/toast";
import { getCurrentLocale, t } from "../../i18n";

const endpoint = "/api/business/admin/management";

const baseNavigation = [
  ["dashboard", "dashboard", "adminDashboard"],
  ["users", "group", "adminUsers"],
  ["policies", "policy", "adminPolicies"],
  ["analytics", "analytics", "adminAnalytics"],
  ["custom-signin", "login", "adminCustomSignIn"],
  ["domains", "language", "adminDomains"],
  ["connectors", "extension", "adminConnectors"],
  ["quickcards", "qr_code_2", "adminQuickCards"],
];

function Input({ label, ...props }) {
  return (
    <label className="block text-sm font-semibold text-[var(--foreground)]">
      {label}
      <input
        {...props}
        className="mt-2 h-11 w-full rounded-xl border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[color-mix(in_srgb,var(--theme-surface-container)_35%,transparent)]! px-3 text-[var(--foreground)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_60%,transparent)]"
      />
    </label>
  );
}

function ImageDropPicker({ copy, onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file) => {
    if (!file?.type?.startsWith("image/") || file.size > 500 * 1024 * 1024) {
      showToast({ messageKey: "adminImageUploadFailed", type: "error" });
      return;
    }
    setUploading(true);
    try {
      const response = await fetch("/api/business/admin/assets", {
        body: file,
        credentials: "include",
        headers: { "Content-Type": file.type },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("upload_failed");
      onUploaded(payload.assetUrl);
    } catch {
      showToast({ messageKey: "adminImageUploadFailed", type: "error" });
    } finally {
      setUploading(false);
    }
  };
  return (
    <button
      className="liquid-glass flex min-h-28 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-white/5! p-4 text-center"
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void upload(event.dataTransfer.files?.[0]);
      }}
      type="button"
    >
      <icon>{uploading ? "progress_activity" : "add_photo_alternate"}</icon>
      <span className="mt-2 text-sm font-bold">
        {uploading ? copy.accountProcessing : copy.adminDropImage}
      </span>
      <span className="mt-1 text-xs opacity-55">
        {copy.adminImageMaximumSize}
      </span>
      <input
        accept="image/gif,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => void upload(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />
    </button>
  );
}

function PlanBadge({ copy, plan }) {
  const label = {
    enterprise: copy.adminPlanEnterprise,
    free: copy.adminPlanFree,
    pro: copy.adminPlanPro,
    standard: copy.adminPlanStandard,
  }[plan];
  return (
    <span className="rounded-full border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_25%,transparent)]! px-3 py-1 text-xs font-bold">
      {label}
    </span>
  );
}

function RoleDropdown({ copy, onChange, roles, value }) {
  const selected = roles.find((role) => role.id === value) || roles[0];
  return (
    <DropdownWrapper
      align="right"
      ariaLabel={copy.adminRole}
      buttonClassName="liquid-glass h-10 min-w-36 justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-sm"
      panelClassName="w-64"
      trigger={
        <>
          <span className="truncate">{selected?.name || copy.adminRole}</span>
          <icon>expand_more</icon>
        </>
      }
    >
      <div className="space-y-1">
        {roles.map((role) => (
          <button
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-white/10!"
            data-dropdown-close
            key={role.id}
            onClick={() => onChange(role.id)}
            type="button"
          >
            {role.name}
            {role.id === value ? <icon>check</icon> : null}
          </button>
        ))}
      </div>
    </DropdownWrapper>
  );
}

function Dashboard({ copy, data }) {
  const { business, capabilities, settings } = data;
  const activeUsers = settings.members.filter(
    (member) => member.status === "active",
  ).length;
  const cards = [
    [copy.adminUsers, activeUsers, "group"],
    [
      copy.adminStorage,
      `${capabilities.storageGb.toLocaleString()} GB`,
      "cloud",
    ],
    [copy.adminRoles, settings.roles.length, "badge"],
    [copy.adminQuickCards, settings.quickCards.length, "qr_code_2"],
  ];
  const features = {
    free: [
      copy.adminFeature96Gb,
      copy.adminFeatureStandardControls,
      copy.adminFeatureCustomSignIn,
      copy.adminFeatureCustomDomains,
      copy.adminFeatureAiFree,
      copy.adminFeatureCustomConnectors,
    ],
    standard: [
      copy.adminFeature500Gb,
      copy.adminFeatureAiProLite,
      copy.adminFeatureAnimatedSignin,
      copy.adminFeatureBasicMonetization,
      copy.adminFeatureAdvancedAnalytics,
    ],
    pro: [
      copy.adminFeatureAdvancedMonetization,
      copy.adminFeature5Tb,
      copy.adminFeatureAdvancedControls,
      copy.adminFeatureHtmlSignin,
      copy.adminFeatureHigherLimits,
    ],
    enterprise: [
      copy.adminFeatureAdvancedMonetization,
      copy.adminFeature5Tb,
      copy.adminFeatureAdvancedControls,
      copy.adminFeatureHtmlSignin,
      copy.adminFeatureHigherLimits,
    ],
  }[business.plan];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{copy.adminDashboard}</h1>
          <p className="mt-2 text-sm text-[color-mix(in_srgb,var(--foreground)_65%,transparent)]">
            {copy.adminDashboardDescription.replace(
              "{business}",
              business.name,
            )}
          </p>
        </div>
        <PlanBadge copy={copy} plan={business.plan} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, icon]) => (
          <section
            className="liquid-glass rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[color-mix(in_srgb,var(--theme-surface-container)_35%,transparent)]! p-4"
            key={label}
          >
            <icon className="text-[var(--accent)]">{icon}</icon>
            <p className="mt-5 text-2xl font-bold">{value}</p>
            <p className="mt-1 text-sm opacity-65">{label}</p>
          </section>
        ))}
      </div>
      <section className="liquid-glass rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[color-mix(in_srgb,var(--theme-surface-container)_35%,transparent)]! p-5">
        <h2 className="text-xl font-bold">{copy.adminIncludedFeatures}</h2>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {features.map((feature) => (
            <div
              className="flex items-center gap-3 rounded-xl bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]! px-3 py-2 text-sm"
              key={feature}
            >
              <icon className="text-emerald-300">check_circle</icon>
              {feature}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Users({ copy, data, mutate }) {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("member");
  const { members, roles } = data.settings;

  const confirmDelete = (member) => {
    showModal(
      ({ close }) => (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-white/70">
            {copy.adminDeleteUserConfirm.replace("{user}", member.name)}
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="rounded-xl border border-white/10 px-4 py-2"
              onClick={close}
              type="button"
            >
              {copy.cancel}
            </button>
            <button
              className="rounded-xl bg-rose-500/50! px-4 py-2 font-bold"
              onClick={async () => {
                await mutate({ action: "delete_member", memberId: member.id });
                close();
              }}
              type="button"
            >
              {copy.adminDeleteUser}
            </button>
          </div>
        </div>
      ),
      { title: copy.adminDeleteUser },
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{copy.adminUsers}</h1>
        <p className="mt-2 text-sm opacity-65">{copy.adminUsersDescription}</p>
      </div>
      <form
        className="liquid-glass grid gap-3 rounded-2xl border border-white/10 bg-white/5! p-4 md:grid-cols-[1fr_auto_auto] md:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!email.trim()) return;
          const succeeded = await mutate({
            action: "add_member",
            email,
            roleId,
          });
          if (succeeded) setEmail("");
        }}
      >
        <Input
          label={copy.adminUserEmail}
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
        <RoleDropdown
          copy={copy}
          onChange={setRoleId}
          roles={roles}
          value={roleId}
        />
        <button
          className="liquid-glass h-11 rounded-xl bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-4 font-bold"
          type="submit"
        >
          <icon>person_add</icon> {copy.adminAddUser}
        </button>
      </form>
      <div className="space-y-2">
        {members.map((member) => (
          <article
            className="liquid-glass flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5! p-4 lg:flex-row lg:items-center"
            key={member.id}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_25%,transparent)]! font-bold">
                {member.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-bold">{member.name}</h2>
                <p className="truncate text-sm opacity-60">{member.email}</p>
                <span className="text-xs font-semibold uppercase tracking-wide opacity-55">
                  {
                    copy[
                      `adminStatus${member.status[0].toUpperCase()}${member.status.slice(1)}`
                    ]
                  }
                </span>
              </div>
            </div>
            <RoleDropdown
              copy={copy}
              onChange={(nextRoleId) =>
                mutate({
                  action: "update_member",
                  memberId: member.id,
                  roleId: nextRoleId,
                })
              }
              roles={roles}
              value={member.roleId}
            />
            <div className="flex flex-wrap gap-2">
              {member.status !== "archived"
                ? <button
                    className="rounded-xl border border-white/10 px-3 py-2 text-sm"
                    onClick={() =>
                      mutate({
                        action: "update_member",
                        memberId: member.id,
                        status: "archived",
                      })
                    }
                    type="button"
                  >
                    {copy.adminArchiveUser}
                  </button>
                : <button
                    className="rounded-xl border border-white/10 px-3 py-2 text-sm"
                    onClick={() =>
                      mutate({
                        action: "update_member",
                        memberId: member.id,
                        status: "active",
                      })
                    }
                    type="button"
                  >
                    {copy.adminRestoreUser}
                  </button>}
              <button
                className="rounded-xl border border-amber-200/20 px-3 py-2 text-sm"
                onClick={() =>
                  mutate({
                    action: "update_member",
                    memberId: member.id,
                    status:
                      member.status === "suspended" ? "active" : "suspended",
                  })
                }
                type="button"
              >
                {member.status === "suspended"
                  ? copy.adminUnsuspendUser
                  : copy.adminSuspendUser}
              </button>
              <button
                className="rounded-xl border border-rose-200/20 px-3 py-2 text-sm text-rose-200"
                onClick={() => confirmDelete(member)}
                type="button"
              >
                {copy.adminDeleteUser}
              </button>
            </div>
          </article>
        ))}
        {!members.length
          ? <p className="rounded-2xl border border-white/10 p-6 text-center text-sm opacity-60">
              {copy.adminNoUsers}
            </p>
          : null}
      </div>
    </div>
  );
}

function Policies({ copy, data, mutate }) {
  const editableRoles = data.settings.roles.filter(
    (role) => role.id !== "administrator",
  );
  const [roleId, setRoleId] = useState(editableRoles[0]?.id || "member");
  const selected =
    editableRoles.find((role) => role.id === roleId) || editableRoles[0];
  const [roleName, setRoleName] = useState(selected?.name || "");
  const [policies, setPolicies] = useState(selected?.policies || {});
  const [managedWorkspaces, setManagedWorkspaces] = useState(
    (selected?.managedWorkspaces || []).join(", "),
  );
  const [search, setSearch] = useState("");

  useEffect(() => {
    setRoleName(selected?.name || "");
    setPolicies(selected?.policies || {});
    setManagedWorkspaces((selected?.managedWorkspaces || []).join(", "));
  }, [selected]);

  const catalog = data.policyCatalog.filter((policy) =>
    `${policy.label} ${policy.key} ${policy.category}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{copy.adminPolicies}</h1>
        <p className="mt-2 text-sm opacity-65">
          {copy.adminPoliciesDescription.replace(
            "{count}",
            String(data.policyCatalog.length),
          )}
        </p>
      </div>
      <section className="liquid-glass space-y-4 rounded-2xl border border-white/10 bg-white/5! p-4">
        <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-end">
          <RoleDropdown
            copy={copy}
            onChange={setRoleId}
            roles={editableRoles}
            value={roleId}
          />
          <Input
            label={copy.adminRoleName}
            onChange={(event) => setRoleName(event.target.value)}
            value={roleName}
          />
          <button
            className="liquid-glass h-11 rounded-xl bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-4 font-bold"
            onClick={() =>
              mutate({
                action: "save_role",
                name: roleName,
                policies,
                roleId,
                managedWorkspaces: managedWorkspaces
                  .split(",")
                  .map((workspace) => workspace.trim())
                  .filter(Boolean),
              })
            }
            type="button"
          >
            {copy.aiChatSave}
          </button>
        </div>
        <button
          className="rounded-xl border border-dashed border-white/20 px-3 py-2 text-sm font-bold"
          onClick={async () => {
            const succeeded = await mutate({
              action: "save_role",
              name: copy.adminNewRole,
              policies: {},
            });
            if (succeeded) setRoleId("");
          }}
          type="button"
        >
          <icon>add</icon> {copy.adminCreateRole}
        </button>
        <Input
          label={copy.adminManagedWorkspaces}
          onChange={(event) => setManagedWorkspaces(event.target.value)}
          placeholder={copy.adminManagedWorkspacesPlaceholder}
          value={managedWorkspaces}
        />
      </section>
      <Input
        label={copy.adminSearchPolicies}
        onChange={(event) => setSearch(event.target.value)}
        type="search"
        value={search}
      />
      <div className="grid max-h-[60dvh] gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
        {catalog.map((policy) => (
          <div
            className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/5! p-4"
            key={policy.key}
          >
            <div className="min-w-0">
              <h3 className="font-semibold">{policy.label}</h3>
              <p className="mt-1 truncate text-xs opacity-50">{policy.key}</p>
              <p className="mt-1 text-xs text-[var(--accent)]">
                {policy.category}
              </p>
            </div>
            <CustomToggle
              checked={policies[policy.key] !== false}
              label={policy.label}
              onChange={(checked) =>
                setPolicies((current) => ({
                  ...current,
                  [policy.key]: checked,
                }))
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Analytics({ copy, data }) {
  const active = data.settings.members.filter(
    (member) => member.status === "active",
  ).length;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{copy.adminAnalytics}</h1>
        <p className="mt-2 text-sm opacity-65">
          {copy.adminAnalyticsDescription}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [copy.adminActiveUsers, active],
          [
            copy.adminArchivedUsers,
            data.settings.members.filter(
              (member) => member.status === "archived",
            ).length,
          ],
          [copy.adminRoles, data.settings.roles.length],
        ].map(([label, value]) => (
          <section
            className="liquid-glass rounded-2xl border border-white/10 bg-white/5! p-5"
            key={label}
          >
            <p className="text-3xl font-bold">{value}</p>
            <p className="mt-2 text-sm opacity-60">{label}</p>
          </section>
        ))}
      </div>
      {data.capabilities.advancedAnalytics
        ? <section className="liquid-glass rounded-2xl border border-white/10 bg-white/5! p-5">
            <h2 className="text-xl font-bold">{copy.adminAdvancedAnalytics}</h2>
            <div className="mt-5 grid h-56 grid-cols-12 items-end gap-2">
              {[
                ["jan", 31],
                ["feb", 48],
                ["mar", 38],
                ["apr", 62],
                ["may", 55],
                ["jun", 71],
                ["jul", 69],
                ["aug", 82],
                ["sep", 76],
                ["oct", 91],
                ["nov", 84],
                ["dec", 96],
              ].map(([month, height]) => (
                <div
                  className="rounded-t-xl bg-[color-mix(in_srgb,var(--accent)_45%,transparent)]!"
                  key={month}
                  style={{ height: `${height}%` }}
                  title={`${height}%`}
                />
              ))}
            </div>
          </section>
        : null}
    </div>
  );
}

function CustomSignIn({ copy, data, mutate }) {
  const [settings, setSettings] = useState(data.settings.customSignIn);
  const update = (next) => setSettings((current) => ({ ...current, ...next }));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{copy.adminCustomSignIn}</h1>
        <p className="mt-2 text-sm opacity-65">
          {copy.adminCustomSignInDescription}
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <section className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5! p-4">
            <span className="font-bold">{copy.adminEnableCustomSignIn}</span>
            <CustomToggle
              checked={settings.enabled}
              label={copy.adminEnableCustomSignIn}
              onChange={(enabled) => update({ enabled })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={copy.adminSignInName}
              onChange={(event) => update({ title: event.target.value })}
              value={settings.title}
            />
            <Input
              label={copy.adminSignInTitle}
              onChange={(event) => update({ heading: event.target.value })}
              value={settings.heading}
            />
          </div>
          <label className="block text-sm font-semibold">
            {copy.adminWelcomeMessage}
            <textarea
              className="mt-2 min-h-24 w-full rounded-xl border border-white/10 bg-white/5! p-3 outline-none"
              maxLength={300}
              onChange={(event) => update({ message: event.target.value })}
              value={settings.message}
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <ColorPickerWrapper
              copy={copy}
              customColors={[]}
              onAddColor={() => undefined}
              onPrimaryChange={(accentColor) => update({ accentColor })}
              primary={settings.accentColor}
              title={copy.accountAppearanceAccentColor}
            />
            <ColorPickerWrapper
              copy={copy}
              customColors={[]}
              onAddColor={() => undefined}
              onPrimaryChange={(backgroundColor) => update({ backgroundColor })}
              primary={settings.backgroundColor}
              title={copy.accountAppearanceBackgroundColor}
            />
          </div>
          {data.capabilities.animatedSignInBackgrounds
            ? <div>
                <h2 className="mb-2 font-bold">{copy.adminBackgroundImage}</h2>
                <ImageDropPicker
                  copy={copy}
                  onUploaded={(backgroundImage) => update({ backgroundImage })}
                />
              </div>
            : null}
          <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5! p-4">
            <h2 className="font-bold">{copy.adminOauthSignIns}</h2>
            {["github", "google", "microsoft"].map((provider) => (
              <div
                className="flex items-center justify-between gap-3"
                key={provider}
              >
                <span className="capitalize">{provider}</span>
                <CustomToggle
                  checked={settings.oauthProviders?.[provider]}
                  label={provider}
                  onChange={(checked) =>
                    update({
                      oauthProviders: {
                        ...settings.oauthProviders,
                        [provider]: checked,
                      },
                    })
                  }
                />
              </div>
            ))}
          </section>
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5! p-4">
            <div>
              <h2 className="font-bold">{copy.adminQuickCards}</h2>
              <p className="mt-1 text-xs opacity-60">
                {copy.adminQuickCardCustomSignInHint}
              </p>
            </div>
            <CustomToggle
              checked={settings.quickCardsEnabled}
              label={copy.adminQuickCards}
              onChange={(quickCardsEnabled) => update({ quickCardsEnabled })}
            />
          </div>
          {data.capabilities.customHtmlSignIn
            ? <label className="block text-sm font-semibold">
                {copy.adminCustomHtml}
                <textarea
                  className="mt-2 min-h-48 w-full rounded-xl border border-white/10 bg-black/20! p-3 font-mono text-sm outline-none"
                  onChange={(event) => update({ html: event.target.value })}
                  value={settings.html || ""}
                />
              </label>
            : null}
          <button
            className="liquid-glass h-11 rounded-xl bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-5 font-bold"
            onClick={() =>
              mutate({
                action: "save_custom_signin",
                customSignIn: settings,
              })
            }
            type="button"
          >
            {copy.aiChatSave}
          </button>
        </section>
        <section
          className="liquid-glass flex min-h-[34rem] items-center justify-center rounded-3xl border border-white/10 p-5"
          style={{
            backgroundColor: settings.backgroundColor,
            backgroundImage: settings.backgroundImage
              ? `url("${settings.backgroundImage}")`
              : undefined,
            backgroundPosition: "center",
            backgroundSize: "cover",
          }}
        >
          <div className="liquid-glass w-full max-w-sm rounded-3xl border border-white/10 bg-white/10! p-6 text-white">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ backgroundColor: settings.accentColor }}
            >
              <icon>business</icon>
            </span>
            <p className="mt-5 text-sm opacity-65">{settings.title}</p>
            <h2 className="mt-1 text-2xl font-bold">{settings.heading}</h2>
            <p className="mt-2 text-sm opacity-65">{settings.message}</p>
            <div className="mt-6 h-11 rounded-xl border border-white/10 bg-white/10!" />
            <div className="mt-3 h-11 rounded-xl border border-white/10 bg-white/10!" />
            <button
              className="mt-4 h-11 w-full rounded-xl font-bold"
              style={{ backgroundColor: settings.accentColor }}
              type="button"
            >
              {copy.signIn}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Domains({ copy, data, mutate }) {
  const [domain, setDomain] = useState("");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{copy.adminDomains}</h1>
        <p className="mt-2 text-sm opacity-65">
          {copy.adminDomainsDescription}
        </p>
      </div>
      <form
        className="liquid-glass flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5! p-4 sm:flex-row sm:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          const succeeded = await mutate({ action: "add_domain", domain });
          if (succeeded) setDomain("");
        }}
      >
        <div className="flex-1">
          <Input
            label={copy.adminDomain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="business.munetios.com"
            value={domain}
          />
        </div>
        <button
          className="liquid-glass h-11 rounded-xl bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-4 font-bold"
          type="submit"
        >
          {copy.add}
        </button>
      </form>
      {data.settings.domains.map((entry) => (
        <div
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5! p-4"
          key={entry.id}
        >
          <icon>language</icon>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{entry.domain}</p>
            <p className="text-xs opacity-55">{copy.adminPendingDns}</p>
          </div>
          <button
            className="rounded-xl border border-rose-200/20 px-3 py-2 text-rose-200"
            onClick={() =>
              mutate({ action: "remove_domain", domainId: entry.id })
            }
            type="button"
          >
            {copy.remove}
          </button>
        </div>
      ))}
    </div>
  );
}

function Connectors({ copy }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{copy.adminConnectors}</h1>
        <p className="mt-2 text-sm opacity-65">
          {copy.adminConnectorsDescription}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[
          ["extension", copy.adminFeatureCustomConnectors],
          ["rule", copy.adminConnectorPolicies],
        ].map(([icon, label]) => (
          <section
            className="liquid-glass rounded-2xl border border-white/10 bg-white/5! p-5"
            key={label}
          >
            <icon>{icon}</icon>
            <h2 className="mt-5 text-lg font-bold">{label}</h2>
            <p className="mt-2 text-sm opacity-60">
              {copy.adminConnectorPoliciesDescription}
            </p>
          </section>
        ))}
      </div>
      <a
        className="liquid-glass inline-flex h-11 items-center gap-2 rounded-xl bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-4 font-bold"
        href="/account/settings/connectors"
      >
        <icon>open_in_new</icon>
        {copy.accountSettingsConnectors}
      </a>
    </div>
  );
}

function QuickCards({ copy, data, mutate }) {
  const [memberId, setMemberId] = useState(
    data.settings.members.find(
      (member) => member.status === "active" && member.accountId,
    )?.id || "",
  );
  const eligible = data.settings.members.filter(
    (member) => member.status === "active" && member.accountId,
  );
  const selected = eligible.find((member) => member.id === memberId);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{copy.adminQuickCards}</h1>
        <p className="mt-2 text-sm opacity-65">
          {copy.adminQuickCardsDescription}
        </p>
      </div>
      <section className="liquid-glass flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5! p-4">
        <DropdownWrapper
          align="left"
          ariaLabel={copy.adminUsers}
          buttonClassName="liquid-glass h-11 min-w-64 justify-between rounded-xl border border-white/10 px-3"
          trigger={
            <>
              <span>{selected?.name || copy.adminChooseUser}</span>
              <icon>expand_more</icon>
            </>
          }
        >
          {eligible.map((member) => (
            <button
              className="w-full rounded-xl px-3 py-2 text-left hover:bg-white/10!"
              data-dropdown-close
              key={member.id}
              onClick={() => setMemberId(member.id)}
              type="button"
            >
              {member.name}
            </button>
          ))}
        </DropdownWrapper>
        <button
          className="liquid-glass h-11 rounded-xl bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-4 font-bold disabled:opacity-50"
          disabled={!memberId}
          onClick={() =>
            mutate({
              action: "create_quickcard",
              label: selected?.name,
              memberId,
            })
          }
          type="button"
        >
          <icon>qr_code_2</icon> {copy.adminCreateQuickCard}
        </button>
        <button
          className="h-11 rounded-xl border border-white/10 px-4 font-bold"
          onClick={() => window.print()}
          type="button"
        >
          <icon>print</icon> {copy.adminPrintQuickCards}
        </button>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.settings.quickCards.map((card) => {
          const absoluteUrl =
            typeof window === "undefined"
              ? card.url
              : new URL(card.url, window.location.origin).toString();
          return (
            <article
              className="admin-quickcard liquid-glass rounded-3xl border border-white/10 bg-white/5! p-5 text-center"
              key={card.id}
            >
              <Image
                alt={copy.adminQuickCardQrAlt.replace("{user}", card.label)}
                className="mx-auto aspect-square w-52 rounded-2xl bg-white p-2"
                height={208}
                src={`/api/business/quickcard/qr?data=${encodeURIComponent(absoluteUrl)}`}
                unoptimized
                width={208}
              />
              <h2 className="mt-4 text-lg font-bold">{card.label}</h2>
              <p className="mt-1 break-all text-xs opacity-50">{card.url}</p>
              <button
                className="mt-4 rounded-xl border border-rose-200/20 px-3 py-2 text-sm text-rose-200"
                onClick={() =>
                  mutate({
                    action: "delete_quickcard",
                    quickCardId: card.id,
                  })
                }
                type="button"
              >
                {copy.remove}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Monetization({ copy, data, mutate }) {
  const [settings, setSettings] = useState(data.settings.monetization);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{copy.adminMonetization}</h1>
        <p className="mt-2 text-sm opacity-65">
          {copy.adminMonetizationDescription}
        </p>
      </div>
      <section className="liquid-glass space-y-4 rounded-2xl border border-white/10 bg-white/5! p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold">{copy.adminEnableMonetization}</span>
          <CustomToggle
            checked={settings.enabled}
            label={copy.adminEnableMonetization}
            onChange={(enabled) =>
              setSettings((current) => ({ ...current, enabled }))
            }
          />
        </div>
        <Input
          label={copy.adminPayoutLabel}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              payoutLabel: event.target.value,
            }))
          }
          value={settings.payoutLabel}
        />
        <button
          className="liquid-glass h-11 rounded-xl bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-4 font-bold"
          onClick={() =>
            mutate({
              action: "save_monetization",
              ...settings,
            })
          }
          type="button"
        >
          {copy.aiChatSave}
        </button>
      </section>
    </div>
  );
}

function Upgrade({ copy, data }) {
  const plans =
    data.business.plan === "free"
      ? [
          ["business-standard", copy.adminPlanStandard],
          ["business-pro", copy.adminPlanPro],
        ]
      : [["business-pro", copy.adminPlanPro]];
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold">{copy.adminUpgradePlan}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {plans.map(([plan, label]) => (
          <section
            className="liquid-glass rounded-3xl border border-white/10 bg-white/5! p-6"
            key={plan}
          >
            <h2 className="text-2xl font-bold">{label}</h2>
            <p className="mt-3 text-sm opacity-65">
              {plan === "business-standard"
                ? copy.adminStandardDescription
                : copy.pricingBusinessProDescription}
            </p>
            <a
              className="liquid-glass mt-6 inline-flex h-11 items-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-4 font-bold"
              href={`/payments?plan=${plan}`}
            >
              {copy.adminChoosePlan}
            </a>
          </section>
        ))}
      </div>
    </div>
  );
}

function AdminTopbar({ account, copy }) {
  const [appsOpen, setAppsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const appsRef = useRef(null);
  const accountRef = useRef(null);
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[1000] flex items-center justify-between bg-transparent p-2 md:p-3">
        <div className="topbar-left liquid-glass flex h-13 items-center gap-3 rounded-2xl border border-white/10 bg-[color-mix(in_srgb,var(--theme-surface-container)_35%,transparent)]! px-4">
          <a className="flex items-center" href="/apps">
            <icon>arrow_back</icon>
          </a>
          <icon>admin_panel_settings</icon>
          <span className="font-bold">{copy.adminTitle}</span>
        </div>
        <div className="topbar-right liquid-glass flex h-13 items-center gap-1 rounded-2xl border border-white/10 bg-[color-mix(in_srgb,var(--theme-surface-container)_35%,transparent)]! p-1.5">
          <button
            aria-label={copy.openAppLauncher}
            className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/10!"
            onClick={() => setAppsOpen(true)}
            ref={appsRef}
            type="button"
          >
            <icon>apps</icon>
          </button>
          <button
            aria-label={copy.openAccountMenu}
            className="flex h-10 w-10 items-center justify-center"
            onClick={() => setAccountOpen((open) => !open)}
            ref={accountRef}
            type="button"
          >
            <AccountAvatar
              account={account || { avatarLetter: "M" }}
              className="h-9 w-9 rounded-xl"
            />
          </button>
        </div>
      </header>
      {accountOpen
        ? <div className="fixed right-2 top-17 z-[1100]">
            <AccountWrapper appContext="admin" />
          </div>
        : null}
      <AppLauncherWrapper
        copy={copy}
        onClose={() => setAppsOpen(false)}
        open={appsOpen}
        triggerRef={appsRef}
      />
    </>
  );
}

export default function AdminConsole() {
  const [copy, setCopy] = useState(() => t());
  const [data, setData] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    const refresh = () => setCopy(t(getCurrentLocale()));
    window.addEventListener("munetios:localechange", refresh);
    return () => window.removeEventListener("munetios:localechange", refresh);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [adminResponse, accountResponse] = await Promise.all([
        fetch(endpoint, { cache: "no-store", credentials: "include" }),
        fetch("/api/account", { cache: "no-store", credentials: "include" }),
      ]);
      if (adminResponse.status === 401) {
        window.location.replace(
          `/signin?returnTo=${encodeURIComponent("/apps/admin")}`,
        );
        return;
      }
      if (adminResponse.status === 403 || adminResponse.status === 404) {
        window.location.replace("/account/settings");
        return;
      }
      if (!adminResponse.ok) throw new Error("admin_load_failed");
      setData(await adminResponse.json());
      if (accountResponse.ok) setAccount(await accountResponse.json());
    } catch {
      showToast({ messageKey: "adminLoadFailed", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (payload) => {
    if (saving) return false;
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify(payload),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error || "save_failed");
      setData(next);
      showToast({ messageKey: "accountSettingsSaved", type: "success" });
      return true;
    } catch (error) {
      showToast({
        messageKey:
          error.message === "business_verification_required"
            ? "businessVerificationRequired"
            : "adminSaveFailed",
        type: "error",
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const navigation = useMemo(() => {
    if (!data) return [];
    const items = baseNavigation.filter(([id]) => {
      if (id === "custom-signin") return data.capabilities.customSignIn;
      if (id === "domains") return data.capabilities.customDomains;
      return true;
    });
    if (data.capabilities.monetization) {
      items.push(["monetization", "payments", "adminMonetization"]);
    }
    if (
      data.business.verified &&
      ["free", "standard"].includes(data.business.plan)
    ) {
      items.push(["upgrade", "workspace_premium", "adminUpgradePlan"]);
    }
    return items;
  }, [data]);

  const panel = data
    ? {
        analytics: <Analytics copy={copy} data={data} />,
        connectors: <Connectors copy={copy} data={data} />,
        "custom-signin": (
          <CustomSignIn copy={copy} data={data} mutate={mutate} />
        ),
        dashboard: <Dashboard copy={copy} data={data} />,
        domains: <Domains copy={copy} data={data} mutate={mutate} />,
        monetization: <Monetization copy={copy} data={data} mutate={mutate} />,
        policies: <Policies copy={copy} data={data} mutate={mutate} />,
        quickcards: <QuickCards copy={copy} data={data} mutate={mutate} />,
        upgrade: <Upgrade copy={copy} data={data} />,
        users: <Users copy={copy} data={data} mutate={mutate} />,
      }[page]
    : null;

  return (
    <main className="min-h-dvh bg-[var(--app-background)] px-3 pb-4 pt-20 text-[var(--foreground)] [font-family:var(--app-font)] md:px-4">
      <AdminTopbar account={account} copy={copy} />
      {loading
        ? <div className="flex min-h-[70dvh] items-center justify-center">
            <LoadingSpinner label={copy.loading} />
          </div>
        : null}
      {!loading && data
        ? <>
            {!data.business.verified
              ? <div className="liquid-glass mb-3 flex items-start gap-3 rounded-2xl border border-amber-200/20 bg-amber-500/15! p-4 text-amber-50">
                  <icon>warning</icon>
                  <div>
                    <h2 className="font-bold">{copy.businessUnverified}</h2>
                    <p className="mt-1 text-sm opacity-75">
                      {copy.businessVerificationRequired}
                    </p>
                  </div>
                </div>
              : null}
            <div className="grid gap-3 md:grid-cols-[17rem_1fr]">
              <aside className="liquid-glass h-fit rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[color-mix(in_srgb,var(--theme-surface-container)_35%,transparent)]! p-2 md:sticky md:top-20 md:max-h-[calc(100dvh-6rem)] md:overflow-y-auto">
                <div className="mb-2 px-3 py-2">
                  <p className="truncate font-bold">{data.business.name}</p>
                  <PlanBadge copy={copy} plan={data.business.plan} />
                </div>
                <nav
                  aria-label={copy.adminNavigation}
                  className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
                >
                  {navigation.map(([id, icon, key]) => (
                    <button
                      aria-current={page === id ? "page" : undefined}
                      className={`flex min-h-11 min-w-fit items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold md:w-full ${
                        page === id
                          ? "bg-[color-mix(in_srgb,var(--accent)_40%,transparent)]! text-[var(--theme-on-primary)]"
                          : "hover:bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]!"
                      }`}
                      key={id}
                      onClick={() => setPage(id)}
                      type="button"
                    >
                      <icon>{icon}</icon>
                      {copy[key]}
                    </button>
                  ))}
                </nav>
              </aside>
              <section className="liquid-glass min-h-[calc(100dvh-6rem)] min-w-0 rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[color-mix(in_srgb,var(--theme-surface-container)_30%,transparent)]! p-4 md:p-6">
                {saving
                  ? <div className="mb-3 flex items-center gap-2 text-sm opacity-65">
                      <LoadingSpinner label={copy.accountProcessing} />
                    </div>
                  : null}
                {panel}
              </section>
            </div>
          </>
        : null}
    </main>
  );
}
