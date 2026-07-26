"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentLocale, t } from "../i18n";
import AccountAvatar from "./accountAvatar";
import { openAccountSettingsModal } from "./accountSettingsModal";
import { confirmBrowserSignOut, openAccountSwitcher } from "./accountSwitcher";
import LanguageSelector from "./languageSelector";
import { showModal } from "./modal";
import UpgradePlans from "./upgradePlans";

const accountFetchUrl = "/api/account";
const accountManagerUrl = "/api/accountmanager";
const storageUrl = "/api/storage";
const workspacesUrl = "/api/workspaces";
const retryIntervalMs = 1000;
const retryTimeoutMs = 10000;

function showToastMessage(messageKey, type = "error") {
  const payload = { messageKey, type };

  if (typeof window !== "undefined" && typeof window.showToast === "function") {
    window.showToast(payload);
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeWorkspaces(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.workspaces)) {
    return payload.workspaces;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
}

function getWorkspaceName(workspace, index, fallbackName) {
  return (
    workspace?.name ||
    workspace?.title ||
    workspace?.displayName ||
    `${fallbackName} ${index + 1}`
  );
}

function getWorkspaceId(workspace, index) {
  return workspace?.id || workspace?.workspaceId || workspace?.slug || index;
}

function VerifyWorkspaceForm({ close, copy, onVerified }) {
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        try {
          await fetchJson("/api/account/security", {
            body: JSON.stringify({ action: "verify_password", password }),
            method: "POST",
          });
          onVerified();
          close();
        } catch {
          showToastMessage("failedCheckAccount");
          setWorking(false);
        }
      }}
    >
      <p className="text-sm leading-6 text-white/70">
        {copy.workspaceLockedSwitchDescription}
      </p>
      <label className="block text-sm font-semibold">
        {copy.accountSecurityCurrentPassword}
        <input
          autoComplete="current-password"
          className="mt-2 w-full rounded-xl border border-white/10 bg-purple-950/35! px-3 py-2.5 text-white outline-none focus:border-purple-300/55"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <button
        className="liquid-glass w-full rounded-xl bg-purple-600/75! px-4 py-3 text-sm font-bold disabled:opacity-55"
        disabled={!password || working}
        type="submit"
      >
        {copy.authRecoveryVerify}
      </button>
    </form>
  );
}

function getAccountName(account, fallbackName) {
  return (
    account?.name ||
    account?.displayName ||
    account?.fullName ||
    account?.username ||
    fallbackName
  );
}

function getAccountEmail(account, fallbackEmail) {
  return (
    account?.email || account?.mail || account?.accountEmail || fallbackEmail
  );
}

function formatStorageValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${Number(size.toFixed(size >= 10 ? 0 : 1))}${units[unitIndex]}`;
}

function normalizeStorage(payload, fallback) {
  const used = formatStorageValue(
    payload?.usedLabel ||
      payload?.usedFormatted ||
      payload?.used ||
      payload?.storageUsed,
  );
  const total = formatStorageValue(
    payload?.totalLabel ||
      payload?.totalFormatted ||
      payload?.total ||
      payload?.storageTotal ||
      payload?.limit,
  );

  if (!used || !total) {
    return fallback;
  }

  return `${used} / ${total}`;
}

function storagePercent(value) {
  const [used, total] = String(value || "")
    .split("/")
    .map((part) => part.trim());
  const toGb = (part) => {
    const match = /([\d.]+)\s*(TB|GB|MB|KB|B)/i.exec(part || "");
    if (!match) return 0;
    const amount = Number(match[1]);
    const unit = match[2].toUpperCase();
    return (
      amount *
      ({ TB: 1024, GB: 1, MB: 1 / 1024, KB: 1 / 1048576, B: 1 / 1073741824 }[
        unit
      ] || 0)
    );
  };
  const maximum = toGb(total);
  return maximum ? Math.min(100, Math.round((toGb(used) / maximum) * 100)) : 0;
}

function getSavedLanguage() {
  if (typeof window === "undefined") {
    return "en";
  }

  return getCurrentLocale();
}

function resolveLanguage(language) {
  return getCurrentLocale(language);
}

function clearDemoState() {
  // biome-ignore lint/suspicious/noDocumentCookie: Clearing the temporary demo cookie must support every target browser.
  document.cookie = "munetios_demo=; Path=/; Max-Age=0; SameSite=Lax";
  window.localStorage.removeItem("munetiosDemoActive");
  window.sessionStorage.removeItem("munetiosDemoActive");
}

function LoadingSpinner({ label }) {
  return (
    <output className="spinner-container" aria-label={label}>
      <svg className="google-spinner" viewBox="0 0 50 50" aria-hidden="true">
        <circle
          className="spinner-circle"
          cx="25"
          cy="25"
          fill="none"
          r="20"
          strokeWidth="5"
        />
      </svg>
    </output>
  );
}

function _AccountManagerModal() {
  const copy = t("en");
  const [state, setState] = useState({
    error: "",
    html: "",
    loading: true,
    url: "",
  });

  useEffect(() => {
    let isMounted = true;
    let intervalId = null;
    let timeoutId = null;

    const loadAccountManager = async () => {
      try {
        const response = await fetch(accountManagerUrl, {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error("Account manager failed");
        }

        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const payload = await response.json();
          if (!isMounted) return true;

          setState({
            error: "",
            html: payload.html || "",
            loading: false,
            url: payload.url || payload.src || "",
          });
          return true;
        }

        const html = await response.text();
        if (!isMounted) return true;

        setState({
          error: "",
          html,
          loading: false,
          url: "",
        });
        return true;
      } catch {
        return false;
      }
    };

    const startLoading = async () => {
      if (await loadAccountManager()) {
        return;
      }

      intervalId = window.setInterval(async () => {
        if (await loadAccountManager()) {
          window.clearInterval(intervalId);
          window.clearTimeout(timeoutId);
        }
      }, retryIntervalMs);

      timeoutId = window.setTimeout(() => {
        window.clearInterval(intervalId);
        if (!isMounted) return;

        setState({
          error: copy.accountManagerFailed,
          html: "",
          loading: false,
          url: "",
        });
      }, retryTimeoutMs);
    };

    startLoading();

    return () => {
      isMounted = false;
      if (intervalId) window.clearInterval(intervalId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [copy.accountManagerFailed]);

  if (state.loading) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center">
        <LoadingSpinner label={copy.loadingAccountManager} />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center text-center text-sm leading-6 text-white/75">
        {state.error}
      </div>
    );
  }

  return (
    <iframe
      aria-label={copy.accountSettings}
      className="h-full w-full rounded-xl border border-white/10 bg-white!"
      src={state.url || undefined}
      srcDoc={state.url ? undefined : state.html}
      title={copy.accountSettings}
    />
  );
}

function AddWorkspaceForm({ close, onCreated }) {
  const copy = t("en");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      const workspace = await fetchJson(workspacesUrl, {
        body: JSON.stringify({ name: trimmedName }),
        method: "POST",
      });
      onCreated(workspace);
      showToastMessage("workspaceCreated", "success");
      close();
    } catch {
      showToastMessage("workspaceCreateFailed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <label className="block text-sm font-medium text-white/80">
        {copy.workspaceName}
        <input
          autoComplete="off"
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/10! px-3 py-2 text-white outline-none transition placeholder:text-white/40 focus:border-purple-300/60"
          onChange={(event) => setName(event.target.value)}
          placeholder={copy.workspaceNamePlaceholder}
          required
          type="text"
          value={name}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-sm text-white/70 transition hover:border-white/20 hover:bg-white/10! hover:text-white"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="rounded-xl border border-purple-200/25 bg-purple-500/80! px-3 py-2 text-sm font-semibold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90! disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
          type="submit"
        >
          {submitting ? copy.addingWorkspace : copy.addWorkspace}
        </button>
      </div>
    </form>
  );
}

function _DemoSettings({ close, copy, onSaved }) {
  const [settings, setSettings] = useState({
    archived: false,
    eligibleFamilies: true,
    eligibleTrustedPeople: true,
    plan: "business-pro",
    storagePreset: "business-pro",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJson("/api/demo/settings")
      .then(setSettings)
      .catch(() => {});
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      await fetchJson("/api/demo/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      onSaved();
      close();
    } catch {
      showToastMessage("fetchError");
    } finally {
      setSaving(false);
    }
  };
  const options = [
    ["personal", copy.demoPlanPersonal],
    ["business-free", copy.demoPlanBusinessFree],
    ["business-standard", copy.demoPlanBusinessStandard],
    ["business-pro", copy.demoPlanBusinessPro],
  ];
  const visibleOptions = settings.parentSupervision
    ? options.filter(([value]) => value === "personal")
    : options;
  return (
    <div className="space-y-5 text-sm text-white/80">
      <p>{copy.demoSettingsDescription}</p>
      <fieldset className="space-y-2">
        <legend className="font-semibold">{copy.demoPlan}</legend>
        <div className="flex flex-wrap gap-2">
          {visibleOptions.map(([value, label]) => (
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
      <fieldset className="space-y-2">
        <legend className="font-semibold">{copy.demoStoragePreset}</legend>
        <div className="flex flex-wrap gap-2">
          {[
            ["personal", "48GB"],
            ["business-free", "100GB"],
            ["business-standard", "400GB"],
            ["business-pro", "10TB"],
            ["full", "10TB (full)"],
          ].map(([value, label]) => (
            <button
              className={`rounded-xl border px-3 py-2 ${settings.storagePreset === value ? "border-purple-200/50 bg-purple-500/60! text-white" : "border-white/10 bg-white/5!"}`}
              key={value}
              onClick={() =>
                setSettings((current) => ({ ...current, storagePreset: value }))
              }
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {[
        ["eligibleTrustedPeople", copy.demoTrustedPeopleEligible],
        ["eligibleFamilies", copy.demoFamiliesEligible],
        ["parentSupervision", copy.demoParentSupervision],
        ["archived", copy.demoArchivedUser],
      ].map(([key, label]) => (
        <label
          className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5! px-3 py-2"
          key={key}
        >
          <span>{label}</span>
          <button
            aria-pressed={settings[key]}
            className={`h-7 w-12 rounded-full p-1 transition ${settings[key] ? "bg-purple-500!" : "bg-white/15!"}`}
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
          className="rounded-xl bg-purple-500! px-3 py-2 font-bold text-white disabled:opacity-60"
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

export default function AccountWrapper({
  appContext = false,
  legalLinksInNewTab = false,
  persistentDropdowns = false,
}) {
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    getCurrentLocale(),
  );
  const copy = useMemo(() => t(selectedLanguage), [selectedLanguage]);
  const [account, setAccount] = useState(null);
  const [accountFailed, setAccountFailed] = useState(false);
  const [storageDisplay, setStorageDisplay] = useState(copy.storageFallback);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesFailed, setWorkspacesFailed] = useState(false);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [demoSigningOut, setDemoSigningOut] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);

  useEffect(() => {
    setStorageDisplay((currentStorageDisplay) =>
      currentStorageDisplay === "-- / 96GB"
        ? copy.storageFallback
        : currentStorageDisplay,
    );
  }, [copy.storageFallback]);

  const loadWorkspaces = useCallback(async () => {
    setWorkspacesLoading(true);
    setWorkspacesFailed(false);

    try {
      const payload = await fetchJson(workspacesUrl);
      const nextWorkspaces = normalizeWorkspaces(payload);
      const savedWorkspaceId = window.localStorage.getItem(
        "munetiosActiveWorkspace",
      );
      setWorkspaces(nextWorkspaces);
      setActiveWorkspaceId((current) => {
        const savedStillExists = nextWorkspaces.some(
          (workspace, index) =>
            String(getWorkspaceId(workspace, index)) ===
            String(savedWorkspaceId),
        );
        const currentStillExists = nextWorkspaces.some(
          (workspace, index) =>
            String(getWorkspaceId(workspace, index)) === String(current),
        );
        const nextActiveId = savedStillExists
          ? savedWorkspaceId
          : currentStillExists
            ? current
            : nextWorkspaces[0]
              ? getWorkspaceId(nextWorkspaces[0], 0)
              : null;
        if (nextActiveId !== null) {
          window.localStorage.setItem(
            "munetiosActiveWorkspace",
            String(nextActiveId),
          );
          if (String(nextActiveId) !== String(current)) {
            const nextIndex = nextWorkspaces.findIndex(
              (workspace, index) =>
                String(getWorkspaceId(workspace, index)) ===
                String(nextActiveId),
            );
            window.dispatchEvent(
              new CustomEvent("munetios:workspacechange", {
                detail: {
                  id: nextActiveId,
                  name:
                    nextIndex >= 0
                      ? getWorkspaceName(
                          nextWorkspaces[nextIndex],
                          nextIndex,
                          copy.workspaceName,
                        )
                      : copy.workspaceName,
                },
              }),
            );
          }
        }
        return nextActiveId;
      });
    } catch {
      setWorkspacesFailed(true);
    } finally {
      setWorkspacesLoading(false);
    }
  }, [copy.workspaceName]);

  const loadStorage = useCallback(async () => {
    try {
      const payload = await fetchJson(storageUrl);
      setStorageDisplay(normalizeStorage(payload, copy.storageFallback));
    } catch {
      setStorageDisplay(copy.storageFallback);
    }
  }, [copy.storageFallback]);

  useEffect(() => {
    const refreshLanguage = () => {
      setSelectedLanguage(resolveLanguage(getSavedLanguage()));
    };

    refreshLanguage();
    window.addEventListener("languagechange", refreshLanguage);
    window.addEventListener("munetios:languagechange", refreshLanguage);
    window.addEventListener("munetios:localechange", refreshLanguage);

    return () => {
      window.removeEventListener("languagechange", refreshLanguage);
      window.removeEventListener("munetios:languagechange", refreshLanguage);
      window.removeEventListener("munetios:localechange", refreshLanguage);
    };
  }, []);

  useEffect(() => {
    const syncProfile = (event) => {
      const profile = event.detail;

      if (!profile || typeof profile !== "object") {
        return;
      }

      setAccount((currentAccount) => ({
        ...(currentAccount || {}),
        avatar: profile.avatar,
        avatarLetter: profile.avatar?.value || currentAccount?.avatarLetter,
        avatarUrl: profile.profilePictureUrl || null,
        email: profile.email,
        name: profile.name,
        profilePictureUrl: profile.profilePictureUrl || null,
      }));
      setAccountFailed(false);
    };

    window.addEventListener("munetios:profilechange", syncProfile);

    return () => {
      window.removeEventListener("munetios:profilechange", syncProfile);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let intervalId = null;
    let timeoutId = null;

    const checkAccount = async () => {
      try {
        const accountPayload = await fetchJson(accountFetchUrl);
        if (isMounted) {
          setAccount(accountPayload);
          setAccountFailed(false);
        }
        return true;
      } catch {
        return false;
      }
    };

    const startAccountCheck = async () => {
      if (await checkAccount()) {
        return;
      }

      intervalId = window.setInterval(async () => {
        if (await checkAccount()) {
          window.clearInterval(intervalId);
          window.clearTimeout(timeoutId);
        }
      }, retryIntervalMs);

      timeoutId = window.setTimeout(() => {
        window.clearInterval(intervalId);
        if (isMounted) {
          setAccountFailed(true);
          setWorkspacesFailed(true);
          setWorkspacesLoading(false);
        }
      }, retryTimeoutMs);
    };

    startAccountCheck();
    loadWorkspaces();
    loadStorage();
    const refreshForAccountChange = () => {
      void checkAccount();
      void loadWorkspaces();
      void loadStorage();
    };
    window.addEventListener("munetios:authchange", refreshForAccountChange);

    return () => {
      isMounted = false;
      window.removeEventListener(
        "munetios:authchange",
        refreshForAccountChange,
      );
      if (intervalId) window.clearInterval(intervalId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [loadStorage, loadWorkspaces]);

  useEffect(() => {
    const refreshDemo = () => {
      loadWorkspaces();
      loadStorage();
      fetchJson(accountFetchUrl)
        .then(setAccount)
        .catch(() => {});
    };
    window.addEventListener("munetios:demo-settingschange", refreshDemo);
    return () =>
      window.removeEventListener("munetios:demo-settingschange", refreshDemo);
  }, [loadStorage, loadWorkspaces]);

  const activateWorkspace = (workspace, index) => {
    const id = getWorkspaceId(workspace, index);
    setActiveWorkspaceId(id);
    window.localStorage.setItem("munetiosActiveWorkspace", String(id));
    window.dispatchEvent(
      new CustomEvent("munetios:workspacechange", {
        detail: {
          id,
          name: getWorkspaceName(workspace, index, copy.workspaceName),
        },
      }),
    );
  };

  const selectWorkspace = (workspace, index) => {
    if (!workspace.locked) {
      activateWorkspace(workspace, index);
      return;
    }
    showModal(
      ({ close }) => (
        <VerifyWorkspaceForm
          close={close}
          copy={copy}
          onVerified={() => activateWorkspace(workspace, index)}
        />
      ),
      {
        ariaLabel: copy.securityVerifyTitle,
        title: copy.securityVerifyTitle,
        zIndex: 100000002,
      },
    );
  };

  const openAddWorkspace = () => {
    showModal(
      ({ close }) => (
        <AddWorkspaceForm
          close={close}
          onCreated={(workspace) => {
            const normalized = normalizeWorkspaces(workspace);
            setWorkspaces((currentWorkspaces) => [
              ...currentWorkspaces,
              normalized[0] || workspace,
            ]);
            setWorkspacesFailed(false);
          }}
        />
      ),
      {
        ariaLabel: copy.addWorkspace,
        title: copy.addWorkspace,
      },
    );
  };

  const openAccountManager = () => {
    if (appContext || window.location.pathname.startsWith("/apps/")) {
      openAccountSettingsModal({ demo: Boolean(account?.demo) });
      return;
    }

    window.location.assign(
      account?.demo ? "/account/settings?demo=true" : "/account/settings",
    );
  };

  const openUpgrade = () => {
    showModal(
      ({ close }) => (
        <UpgradePlans
          archived={Boolean(account?.archived)}
          close={close}
          copy={copy}
          demo={Boolean(account?.demo)}
        />
      ),
      {
        ariaLabel: copy.demoUpgradeTitle,
        fullViewport: true,
        height: "100vh",
        style: { maxHeight: "100vh", maxWidth: "100%" },
        title: copy.demoUpgradeTitle,
        width: "100%",
      },
    );
  };

  const openAddAccount = () => {
    openAccountSwitcher({ addAccount: true, copy });
  };

  const openSignOutConfirm = () => {
    if (account?.demo) {
      setDemoSigningOut(true);

      Promise.allSettled([
        fetch("/api/demo", {
          credentials: "include",
          method: "DELETE",
        }),
        new Promise((resolve) => window.setTimeout(resolve, 900)),
      ]).then(() => {
        clearDemoState();

        if (window.parent !== window) {
          window.parent.postMessage(
            { type: "munetios:demo-exit" },
            window.location.origin,
          );
          return;
        }

        window.location.assign("/");
      });
      return;
    }

    confirmBrowserSignOut({ copy });
  };

  const languageSelector = (
    <LanguageSelector
      align="right"
      copy={copy}
      openOnHover={!persistentDropdowns}
      persistent={persistentDropdowns}
      placement="side"
    />
  );
  const accountSettingsLabel =
    appContext === "tasks" ? copy.tasksManageAccount : copy.settings;
  const usedStoragePercent = storagePercent(storageDisplay);
  const legalLinkProps = legalLinksInNewTab
    ? { rel: "noopener noreferrer", target: "_blank" }
    : {};

  return (
    <>
      {demoSigningOut
        ? createPortal(
            <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-purple-950/90! p-4 text-white">
              <div className="liquid-glass flex min-w-[min(24rem,calc(100vw-2rem))] flex-col items-center gap-4 rounded-2xl border border-white/10 bg-purple-950/75! p-6 text-center shadow-2xl shadow-purple-950/50">
                <LoadingSpinner label={copy.demoSigningOut} />
                <h2 className="text-lg font-bold">{copy.demoSigningOut}</h2>
              </div>
            </div>,
            document.body,
          )
        : null}
      <div className="flex w-[min(calc(100vw-1rem),24rem)] items-start justify-end">
        <section
          aria-label={copy.accountWrapperLabel}
          className="liquid-glass max-h-[calc(100dvh-5rem)] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-white/10 bg-purple-950/20! p-3 text-white"
        >
          <div className="flex max-h-[calc(100dvh-6rem)] min-h-[28rem] flex-col space-y-4 overflow-y-auto">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5! p-3">
              <AccountAvatar
                account={account}
                alt={copy.accountProfileAlt}
                className="h-12 w-12 rounded-2xl"
              />
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold leading-6">
                  {getAccountName(account, copy.accountNameFallback)}
                </h2>
                <p className="truncate text-sm text-white/60">
                  {getAccountEmail(account, copy.accountEmailFallback)}
                </p>
                {account?.demo
                  ? <span className="mt-1.5 inline-flex rounded-full border border-purple-200/25 bg-purple-500/25! px-2 py-0.5 text-xs font-bold text-purple-50">
                      {account.plan || copy.demoBusinessPro}
                    </span>
                  : null}
                {!account?.demo
                  ? <span className="mt-1.5 inline-flex rounded-full border border-purple-200/20 bg-purple-500/20! px-2 py-0.5 text-xs font-bold text-purple-100">
                      {copy.personalAccountBadge}
                    </span>
                  : null}
                {account?.demoSettings?.parentSupervision
                  ? <span className="mt-1 block text-xs font-semibold text-amber-100">
                      {copy.demoManagedByParent}
                    </span>
                  : null}
              </div>
            </div>

            {!account?.archived
              ? <section
                  aria-labelledby="workspacesHeading"
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3
                      className="text-sm font-bold leading-6"
                      id="workspacesHeading"
                    >
                      {copy.workspaces}
                    </h3>
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-purple-200/25 bg-purple-500/80! px-3 text-sm font-semibold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90!"
                      onClick={openAddWorkspace}
                      type="button"
                    >
                      <icon>add</icon>
                      {copy.addWorkspace}
                    </button>
                  </div>

                  {workspacesLoading
                    ? <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5! p-3 text-sm text-white/70">
                        <LoadingSpinner label={copy.loadingWorkspaces} />
                        {copy.loadingWorkspaces}
                      </div>
                    : null}

                  {!workspacesLoading && (accountFailed || workspacesFailed)
                    ? <p className="rounded-xl border border-rose-300/20 bg-rose-950/30! p-3 text-sm text-rose-100">
                        {copy.failedLoadWorkspaces}
                      </p>
                    : null}

                  {!workspacesLoading &&
                  !accountFailed &&
                  !workspacesFailed &&
                  workspaces.length === 0
                    ? <p className="rounded-xl border border-white/10 bg-white/5! p-3 text-sm text-white/70">
                        {copy.noWorkspaces}
                      </p>
                    : null}

                  {!workspacesLoading &&
                  !accountFailed &&
                  !workspacesFailed &&
                  workspaces.length > 0
                    ? <ul className="space-y-2">
                        {workspaces.map((workspace, index) => (
                          <li key={getWorkspaceId(workspace, index)}>
                            <button
                              aria-pressed={
                                activeWorkspaceId ===
                                getWorkspaceId(workspace, index)
                              }
                              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${activeWorkspaceId === getWorkspaceId(workspace, index) ? "border-purple-200/45 bg-purple-500/30!" : "border-white/10 bg-white/5! hover:border-white/20 hover:bg-white/10!"}`}
                              onClick={() => selectWorkspace(workspace, index)}
                              type="button"
                            >
                              <span className="min-w-0 truncate text-sm font-medium text-white">
                                {getWorkspaceName(
                                  workspace,
                                  index,
                                  copy.workspaceFallback,
                                )}
                              </span>
                              <icon>
                                {workspace.locked
                                  ? "lock"
                                  : activeWorkspaceId ===
                                      getWorkspaceId(workspace, index)
                                    ? "check"
                                    : "chevron_right"}
                              </icon>
                            </button>
                          </li>
                        ))}
                      </ul>
                    : null}
                </section>
              : null}

            {!account?.archived
              ? <section aria-labelledby="storageHeading" className="space-y-3">
                  <h3
                    className="text-sm font-bold leading-6"
                    id="storageHeading"
                  >
                    {copy.storage}
                  </h3>
                  <div className="rounded-xl border border-white/10 bg-white/5! p-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-white/60">{copy.storageUsed}</span>
                      <span className="font-semibold text-white">
                        {storageDisplay}
                      </span>
                    </div>
                    <div
                      aria-label={`${usedStoragePercent}%`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={usedStoragePercent}
                      className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"
                      role="progressbar"
                    >
                      <span
                        className={`block h-full rounded-full transition-all ${usedStoragePercent >= 100 ? "bg-rose-400!" : usedStoragePercent >= 90 ? "bg-amber-300!" : "bg-purple-400!"}`}
                        style={{ width: `${usedStoragePercent}%` }}
                      />
                    </div>
                    {usedStoragePercent >= 100
                      ? <p className="mt-3 text-xs font-semibold text-rose-200">
                          {copy.storageFullWarning}
                        </p>
                      : usedStoragePercent >= 90
                        ? <p className="mt-3 text-xs font-semibold text-amber-100">
                            {copy.storageAlmostFullWarning}
                          </p>
                        : null}
                  </div>
                </section>
              : null}

            <div className="mt-auto space-y-2 pt-2">
              {languageSelector}
              {account?.demo &&
              ["Business Free", "Business Standard"].includes(account.plan)
                ? <button
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-purple-200/25 bg-purple-500/80! px-3 py-2 text-sm font-semibold text-white"
                    onClick={openUpgrade}
                    type="button"
                  >
                    <icon>upgrade</icon>
                    {copy.demoUpgradeButton}
                  </button>
                : null}
              <button
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-purple-200/25 bg-purple-500/80! px-3 py-2 text-sm font-semibold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90!"
                onClick={openAccountManager}
                type="button"
              >
                <icon>settings</icon>
                {accountSettingsLabel}
              </button>
              <button
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10! px-3 py-2 text-sm font-semibold text-white transition hover:border-purple-200/30 hover:bg-purple-500/20!"
                onClick={() => openAccountSwitcher({ copy })}
                type="button"
              >
                <icon>switch_account</icon>
                {copy.switchAccount}
              </button>
              <button
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10! px-3 py-2 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/15!"
                onClick={openAddAccount}
                type="button"
              >
                <icon>person_add</icon>
                {copy.addAccount}
              </button>
              <button
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200/20 bg-rose-500/20! px-3 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-100/35 hover:bg-rose-500/30!"
                onClick={openSignOutConfirm}
                type="button"
              >
                <icon>logout</icon>
                {copy.signOut}
              </button>
              <nav
                aria-label={`${copy.footerTerms} ${copy.authAnd} ${copy.footerPrivacy}`}
                className="flex items-center justify-center gap-2 pt-1 text-[0.68rem]"
                style={{
                  color:
                    "color-mix(in srgb, var(--foreground) 52%, transparent)",
                }}
              >
                <a
                  className="hover:underline"
                  href="/terms"
                  {...legalLinkProps}
                >
                  {copy.footerTerms}
                </a>
                <span aria-hidden="true">&bull;</span>
                <a
                  className="hover:underline"
                  href="/privacy"
                  {...legalLinkProps}
                >
                  {copy.footerPrivacy}
                </a>
              </nav>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
