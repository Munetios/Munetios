"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import {
  developerSettingsChangeEvent,
  loadDeveloperSettings,
  saveDeveloperSettings,
} from "../lib/developerSettings";
import { hasSignedInCookie } from "../lib/signedInCookie";
import AccountAdvancedSection from "./accountAdvancedSection";
import AccountAppearanceSection from "./accountAppearanceSection";
import AccountAvatar from "./accountAvatar";
import AccountBusinessAdminSection from "./accountBusinessAdminSection";
import AccountConnectorsSection from "./accountConnectorsSection";
import AccountDataControlsSection from "./accountDataControlsSection";
import AccountFamiliesSection from "./accountFamiliesSection";
import AccountLanguageTimeSection from "./accountLanguageTimeSection";
import AccountPrivacySection from "./accountPrivacySection";
import AccountProfileSection from "./accountProfileSection";
import AccountSecuritySection from "./accountSecuritySection";
import AccountStorageSection from "./accountStorageSection";
import AccountStudentsSection from "./accountStudentsSection";
import AccountWrapper from "./accountwraper";
import AppLauncherWrapper from "./appLauncherWrapper";
import CommerceComingSoon from "./commerceComingSoon";
import { showToast } from "./toast";

const showOrder1 = 1;
const showOrder2 = 2;
const eligibleSidebarItemsUrl = "/api/account/eligible-items";
const guestSidebarItemNames = new Set([
  "Appearance",
  "Language & Time",
  "Data Controls",
  "Privacy",
]);
const settingsPathPrefix = "/account/settings";
const settingsPageSlugs = {
  Admin: "admin",
  "Admin Controls": "admin-controls",
  Advanced: "advanced",
  Appearance: "appearance",
  Billing: "billing",
  Connectors: "connectors",
  "Data Controls": "data-controls",
  Families: "families",
  "Fake/Unused": "fake-unused",
  "Language & Time": "language-time",
  "Age Verification": "age-verification",
  Privacy: "privacy",
  Profile: "profile",
  Security: "security",
  Storage: "storage",
  Students: "students",
  "Trusted People": "trusted-people",
};
const deletedAccountPageNames = new Set([
  "Profile",
  "Appearance",
  "Language & Time",
  "Security",
  "Storage",
  "Connectors",
  "Data Controls",
  "Privacy",
  "Advanced",
]);
const hiddenDeveloperItems = [
  {
    icon: "verified_user",
    labelKey: "developerAgeVerification",
    name: "Age Verification",
  },
];

function addHiddenDeveloperItems(items) {
  const visibleItems = items.filter(
    (item) => !hiddenDeveloperItems.some((hidden) => hidden.name === item.name),
  );
  const privacyIndex = visibleItems.findIndex(
    (item) => item.name === "Privacy",
  );
  const insertionIndex =
    privacyIndex >= 0 ? privacyIndex + 1 : visibleItems.length;
  return [
    ...visibleItems.slice(0, insertionIndex),
    ...hiddenDeveloperItems,
    ...visibleItems.slice(insertionIndex),
  ];
}

function UnavailableDeveloperPanel({ actionLabel, copy, description, title }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-sm leading-6 text-white/65">{description}</p>
      <button
        className="rounded-xl border border-purple-200/20 bg-purple-600/45! px-4 py-2 text-sm font-bold"
        onClick={() =>
          showToast({
            message: copy.developerHiddenActionFailed,
            type: "error",
          })
        }
        type="button"
      >
        {actionLabel || copy.developerVerifyAge}
      </button>
    </div>
  );
}

function DeletedAccountProfile({ copy }) {
  const storageKey = "munetios.deleted-account.local-workspaces";
  const [workspaces, setWorkspaces] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    } catch {
      return [];
    }
  });
  const createWorkspace = () => {
    const next = [
      ...workspaces,
      {
        id: crypto.randomUUID(),
        name: `${copy.workspaceFallback} ${workspaces.length + 1}`,
      },
    ];
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    setWorkspaces(next);
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{copy.accountSettingsProfile}</h1>
      <p className="rounded-xl border border-rose-200/20 bg-rose-500/10! p-4 text-sm text-rose-50">
        {copy.accountNotFoundMessage}
      </p>
      <section className="rounded-2xl border border-white/10 bg-white/5! p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{copy.accountProfileWorkspaces}</h2>
          <button
            className="rounded-xl bg-purple-600/55! px-3 py-2 text-sm font-bold"
            onClick={createWorkspace}
            type="button"
          >
            {copy.developerCreateWorkspace}
          </button>
        </div>
        {workspaces.length
          ? <div className="mt-3 space-y-2">
              {workspaces.map((workspace) => (
                <div
                  className="rounded-xl border border-white/10 bg-black/10! p-3 text-sm"
                  key={workspace.id}
                >
                  {workspace.name}
                </div>
              ))}
            </div>
          : <p className="mt-3 text-sm text-white/60">{copy.noWorkspaces}</p>}
        <p className="mt-2 text-xs text-white/45">{copy.developerLocalOnly}</p>
      </section>
    </div>
  );
}
const settingsPageNames = new Map(
  Object.entries(settingsPageSlugs).map(([name, slug]) => [slug, name]),
);

function getSettingsPageName(page) {
  if (typeof page !== "string") {
    return null;
  }

  return settingsPageNames.get(page.trim().toLowerCase()) || null;
}

function getSettingsPagePath(name) {
  return `${settingsPathPrefix}/${settingsPageSlugs[name] || "profile"}`;
}

const accountItems = [
  {
    icon: "account_circle",
    labelKey: "accountSettingsProfile",
    name: "Profile",
  },
  {
    icon: "palette",
    labelKey: "accountSettingsAppearance",
    name: "Appearance",
  },
  {
    icon: "language",
    labelKey: "accountSettingsLanguageTime",
    name: "Language & Time",
  },
  {
    icon: "security",
    labelKey: "accountSettingsSecurity",
    name: "Security",
  },
  {
    icon: "credit_card",
    labelKey: "accountSettingsBilling",
    name: "Billing",
  },
  {
    icon: "cloud",
    labelKey: "accountSettingsStorage",
    name: "Storage",
  },
  {
    ifElligbeItem: showOrder2,
  },
  {
    icon: "extension",
    labelKey: "accountSettingsConnectors",
    name: "Connectors",
  },
  {
    ifElligbeItem: showOrder1,
  },
  {
    icon: "database",
    labelKey: "accountSettingsDataControls",
    name: "Data Controls",
  },
  {
    icon: "shield",
    labelKey: "accountSettingsPrivacy",
    name: "Privacy",
  },
  {
    icon: "build",
    labelKey: "accountSettingsAdvanced",
    name: "Advanced",
  },
];

const sidebarItems = accountItems.map((item) => ({ ...item }));

const loadingSidebarItems = sidebarItems.filter(
  (item) =>
    !item.ifElligbeItem && !new Set(["Billing", "Storage"]).has(item.name),
);

const fetchItemsThatElligbe = [
  {
    icon: "ward",
    labelKey: "accountSettingsTrustedPeople",
    name: "Trusted People",
    order: 1,
  },
  {
    icon: "family_group",
    labelKey: "accountSettingsFamilies",
    name: "Families",
    order: 2,
  },
];
const ElligbeErrorToast = { toast: "ElligbeError" };
const UnauthorizedErrorToast = { toast: "401UnauthorizedError" };

function getArchivedAccountPreview() {
  if (typeof window === "undefined") return null;
  try {
    const account = JSON.parse(
      window.localStorage.getItem("munetios.archivedAccount") || "null",
    );
    return account?.id ? { ...account, archived: true } : null;
  } catch {
    return null;
  }
}

export {
  accountItems,
  sidebarItems,
  fetchItemsThatElligbe,
  ElligbeErrorToast,
  UnauthorizedErrorToast,
};

function normalizeEligibleSidebarItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  if (Array.isArray(payload?.eligibleItems)) {
    return payload.eligibleItems;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
}

function buildSidebarItems(eligibleItems = [], isGuest = false) {
  const eligibleByOrder = new Map(
    eligibleItems
      .filter((item) => Number.isFinite(Number(item?.order)))
      .map((item) => [Number(item.order), item]),
  );

  return sidebarItems.flatMap((item) => {
    if (!item.ifElligbeItem) {
      return !isGuest || guestSidebarItemNames.has(item.name)
        ? [{ ...item }]
        : [];
    }

    const eligibleItem = eligibleByOrder.get(Number(item.ifElligbeItem));

    return eligibleItem ? [{ ...eligibleItem, eligible: true }] : [];
  });
}

function getSidebarItemLabel(item, copy) {
  return copy[item.labelKey] || item.name || copy.accountItemFallback;
}

function showElligbeErrorToast(status, copy) {
  if (status === 401 && hasSignedInCookie()) {
    return;
  }

  const translatedMessage =
    copy[ElligbeErrorToast.toast] || ElligbeErrorToast.toast;

  showToast({
    message: status ? `${translatedMessage} ${status} error` : undefined,
    messageKey: ElligbeErrorToast.toast,
    type: "error",
  });
}

export function AccountManagerTopbar({
  copy = t(),
  hidden = false,
  initialLoggedIn = false,
}) {
  const accountTriggerRef = useRef(null);
  const appLauncherTriggerRef = useRef(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [appLauncherOpen, setAppLauncherOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [topbarAccount, setTopbarAccount] = useState(() =>
    initialLoggedIn ? { avatarLetter: "M" } : null,
  );
  const [panelTop, setPanelTop] = useState(72);

  const updateAccountPanelPosition = useCallback(() => {
    const trigger = accountTriggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    setPanelTop(Math.max(10, rect.bottom + 10));
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const refreshAccount = () => {
      if (!hasSignedInCookie()) {
        setTopbarAccount(null);
        setAccountPanelOpen(false);
        return;
      }

      setTopbarAccount((current) => current || { avatarLetter: "M" });
      fetch("/api/account", { credentials: "include" })
        .then((response) => (response.ok ? response.json() : null))
        .then((account) => {
          if (account) setTopbarAccount(account);
        })
        .catch(() => {});
    };

    refreshAccount();
    const syncProfile = (event) => {
      if (!event.detail) return;
      setTopbarAccount((current) => ({
        ...(current || {}),
        avatar: event.detail.avatar,
        avatarLetter: event.detail.avatar?.value || current?.avatarLetter,
        avatarUrl: event.detail.profilePictureUrl || null,
        profilePictureUrl: event.detail.profilePictureUrl || null,
      }));
    };
    window.addEventListener("munetios:authchange", refreshAccount);
    window.addEventListener("munetios:profilechange", syncProfile);
    return () => {
      window.removeEventListener("munetios:authchange", refreshAccount);
      window.removeEventListener("munetios:profilechange", syncProfile);
    };
  }, []);

  useEffect(() => {
    if (!accountPanelOpen) {
      return undefined;
    }

    updateAccountPanelPosition();

    const onPointerDown = (event) => {
      if (
        event.target.closest?.("[data-munetios-account-wrapper='true']") ||
        accountTriggerRef.current?.contains(event.target) ||
        event.target.closest?.("[data-munetios-dropdown-portal='true']")
      ) {
        return;
      }

      setAccountPanelOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setAccountPanelOpen(false);
        accountTriggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateAccountPanelPosition);
    window.addEventListener("scroll", updateAccountPanelPosition, true);
    window.addEventListener(
      "munetios:localechange",
      updateAccountPanelPosition,
    );

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateAccountPanelPosition);
      window.removeEventListener("scroll", updateAccountPanelPosition, true);
      window.removeEventListener(
        "munetios:localechange",
        updateAccountPanelPosition,
      );
    };
  }, [accountPanelOpen, updateAccountPanelPosition]);

  return (
    <header
      aria-hidden={hidden}
      className="account-manager-topbar fixed top-0 z-[1000] left-0 w-full flex items-start justify-between p-2 md:items-center"
      data-munetios-reusable-account-controls="true"
      hidden={hidden}
    >
      <div className="flex items-center gap-2">
        <div className="h-12 px-3 liquid-glass flex items-center gap-2">
          <a href="/" className="flex items-center gap-2">
            <icon>settings</icon>
            <div
              className="text-xl logo font-bold hidden sm:flex!"
              data-translate="settings"
            >
              Settings
            </div>
          </a>
        </div>
      </div>
      <div className="liquid-glass flex h-12 items-center gap-1.5 rounded-2xl px-2">
        <button
          aria-label={copy.openAppLauncher}
          aria-controls={appLauncherOpen ? "appsWrapper" : undefined}
          aria-expanded={appLauncherOpen}
          data-translate-aria-label="openAppLauncher"
          id="appsBtn"
          className="flex h-9 min-h-9 w-9 min-w-9 cursor-pointer items-center justify-center rounded-xl text-white transition-all hover:bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]!"
          onClick={() => {
            setAppLauncherOpen((open) => !open);
          }}
          ref={appLauncherTriggerRef}
          type="button"
        >
          <icon>apps</icon>
        </button>
        {topbarAccount
          ? <button
              aria-label={copy.openAccountMenu}
              aria-controls={
                accountPanelOpen ? "accountWrapperPanel" : undefined
              }
              aria-expanded={accountPanelOpen}
              id="accountProfilePicture"
              className="flex h-9 min-h-9 w-9 min-w-9 cursor-pointer items-center justify-center rounded-xl text-white transition-all hover:bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]!"
              onClick={() => {
                updateAccountPanelPosition();
                setAccountPanelOpen((open) => !open);
              }}
              ref={accountTriggerRef}
              type="button"
            >
              <AccountAvatar
                account={topbarAccount || { avatarLetter: "M" }}
                alt={copy.accountProfileAlt}
                className="h-9 w-9 rounded-xl"
              />
            </button>
          : <button
              id="sign-in-button"
              className="liquid-glass hover:bg-[var(--accent)]! transition-all cursor-pointer text-white py-2 px-4 rounded-br-xl bg-[var(--accent)]/80!"
              data-translate="signIn"
              onClick={() => {
                window.location.assign("/signin");
              }}
              type="button"
            >
              {copy.signIn}
            </button>}
      </div>
      {mounted && accountPanelOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[1100]"
              data-munetios-account-wrapper="true"
              id="accountWrapperPanel"
              style={{
                right: "10px",
                top: `${panelTop}px`,
                zIndex: 1100,
              }}
            >
              <AccountWrapper />
            </div>,
            document.body,
            "accountWrapperPanel",
          )
        : null}
      {appLauncherOpen
        ? <AppLauncherWrapper
            copy={copy}
            onClose={() => setAppLauncherOpen(false)}
            open
            panelId="appsWrapper"
            triggerRef={appLauncherTriggerRef}
          />
        : null}
    </header>
  );
}

export const accountManagerTopbar = AccountManagerTopbar;

export default function AccountSettings({
  initialLoggedIn = false,
  initialLocale = "en",
  initialPage = "profile",
}) {
  const [copy, setCopy] = useState(() => t(initialLocale));
  const [activeSidebarItem, setActiveSidebarItem] = useState(
    () => getSettingsPageName(initialPage) || "Profile",
  );
  const [resolvedSidebarItems, setResolvedSidebarItems] = useState(() =>
    buildSidebarItems([]),
  );
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [eligibilityRefresh, setEligibilityRefresh] = useState(0);
  const [isGuest, setIsGuest] = useState(() =>
    initialLoggedIn ? false : null,
  );
  const [selfParentalControls, setSelfParentalControls] = useState(null);
  const [developerSettings, setDeveloperSettings] = useState(null);
  const refreshAccount = useCallback(async () => {
    setAccountLoading(true);
    try {
      const response = await fetch("/api/account", {
        credentials: "include",
      });
      const authState = response.headers.get("X-Munetios-Auth-State");
      const responsePayload = await response.json().catch(() => null);
      const payload = response.ok ? responsePayload : null;

      if (payload) {
        setAccount(payload);
        setIsGuest(false);
        return;
      }

      if (response.status === 404 && responsePayload?.deletedAccount) {
        setAccount({
          accountNotFound: true,
          deleted: true,
          email: "",
          name: "",
        });
        setIsGuest(false);
        return;
      }

      const archivedPreview = getArchivedAccountPreview();
      if (archivedPreview) {
        setAccount(archivedPreview);
        setIsGuest(false);
        return;
      }

      const invalidSession = authState === "invalid-session";
      const shouldShowRequestFailure =
        invalidSession || response.status === 429 || response.status >= 500;

      setAccount(null);
      setIsGuest(!hasSignedInCookie());

      if (shouldShowRequestFailure) {
        showToast({
          messageKey: "accountDataRequestFailed",
          toastId: "account-settings-request-failed",
          type: "error",
        });
      }
    } catch {
      const archivedPreview = getArchivedAccountPreview();
      if (archivedPreview) {
        setAccount(archivedPreview);
        setIsGuest(false);
      } else {
        setAccount(null);
        setIsGuest(!hasSignedInCookie());
        showToast({
          messageKey: "accountDataRequestFailed",
          toastId: "account-settings-request-failed",
          type: "error",
        });
      }
    } finally {
      setAccountLoading(false);
    }
  }, []);

  useEffect(() => {
    const refreshDeveloperSettings = (event) =>
      setDeveloperSettings(event?.detail || loadDeveloperSettings());
    refreshDeveloperSettings();
    window.addEventListener(
      developerSettingsChangeEvent,
      refreshDeveloperSettings,
    );
    return () =>
      window.removeEventListener(
        developerSettingsChangeEvent,
        refreshDeveloperSettings,
      );
  }, []);

  const sidebarItemsToRender = useMemo(() => {
    if (accountLoading) {
      return loadingSidebarItems;
    }

    if (isGuest) {
      return buildSidebarItems([], true);
    }

    const items =
      resolvedSidebarItems.length > 0
        ? resolvedSidebarItems
        : buildSidebarItems([]);
    if (account?.deleted) {
      const visible = items.filter((item) =>
        deletedAccountPageNames.has(item.name),
      );
      return developerSettings?.developerMode &&
        developerSettings?.showHiddenItems
        ? addHiddenDeveloperItems(visible)
        : visible;
    }
    if (account?.archived) {
      return items.filter((item) =>
        ["Profile", "Appearance", "Language & Time"].includes(item.name),
      );
    }
    const adminAware =
      account?.accountType === "business" &&
      account?.businessRole === "administrator"
        ? [
            ...items.filter((item) => item.name !== "Admin"),
            {
              icon: "admin_panel_settings",
              labelKey: "accountSettingsAdmin",
              name: "Admin",
            },
          ]
        : items.filter((item) => item.name !== "Admin");

    const educationAware =
      account?.education?.role === "teacher"
        ? [
            ...adminAware,
            {
              icon: "groups",
              labelKey: "accountSettingsStudents",
              name: "Students",
            },
          ]
        : adminAware;
    const educationRestricted = account?.education
      ? educationAware.filter(
          (item) =>
            item.name !== "Advanced" &&
            (account.education.role !== "student" || item.name !== "Billing"),
        )
      : educationAware;

    const filtered =
      selfParentalControls?.allowConnectors === false
        ? educationRestricted.filter((item) => item.name !== "Connectors")
        : educationRestricted;
    return !account?.education &&
      developerSettings?.developerMode &&
      developerSettings?.showHiddenItems
      ? addHiddenDeveloperItems(filtered)
      : filtered;
  }, [
    account,
    accountLoading,
    isGuest,
    resolvedSidebarItems,
    selfParentalControls,
    developerSettings,
  ]);

  const setSettingsPage = useCallback((name, { replace = false } = {}) => {
    setActiveSidebarItem(name);

    if (typeof window === "undefined") {
      return;
    }

    const nextUrl = `${getSettingsPagePath(name)}${window.location.search}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
    }
  }, []);

  useEffect(() => {
    const refreshCopy = () => {
      setCopy(t());
    };

    window.addEventListener("languagechange", refreshCopy);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);

    return () => {
      window.removeEventListener("languagechange", refreshCopy);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  useEffect(() => {
    refreshAccount();
    const refreshDemoSettings = () => {
      refreshAccount();
      setEligibilityRefresh((value) => value + 1);
    };
    window.addEventListener(
      "munetios:demo-settingschange",
      refreshDemoSettings,
    );
    return () =>
      window.removeEventListener(
        "munetios:demo-settingschange",
        refreshDemoSettings,
      );
  }, [refreshAccount]);

  useEffect(() => {
    if (!account?.education) return;
    const current = loadDeveloperSettings();
    if (!current.developerMode && !current.showHiddenItems) return;
    saveDeveloperSettings({
      ...current,
      developerMode: false,
      showHiddenItems: false,
    });
  }, [account?.education]);

  useEffect(() => {
    if (isGuest !== false || account?.deleted) {
      setSelfParentalControls(null);
      return;
    }
    fetch("/api/account/family", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        setSelfParentalControls(payload?.self?.parentalControls || null);
      })
      .catch(() => {});
  }, [account?.deleted, isGuest]);

  useEffect(() => {
    const syncSettingsPageFromLocation = () => {
      const page = window.location.pathname
        .slice(settingsPathPrefix.length)
        .replace(/^\/+/, "")
        .split("/")[0];

      setActiveSidebarItem(getSettingsPageName(page) || "Profile");
    };

    window.addEventListener("popstate", syncSettingsPageFromLocation);
    return () =>
      window.removeEventListener("popstate", syncSettingsPageFromLocation);
  }, []);

  useEffect(() => {
    if (
      !accountLoading &&
      isGuest &&
      !guestSidebarItemNames.has(activeSidebarItem)
    ) {
      setSettingsPage("Appearance", { replace: true });
    }
  }, [activeSidebarItem, accountLoading, isGuest, setSettingsPage]);

  useEffect(() => {
    if (!accountLoading && account === null && isGuest === false) {
      setResolvedSidebarItems(buildSidebarItems([]));
    }
  }, [account, accountLoading, isGuest]);

  useEffect(() => {
    if (
      !accountLoading &&
      activeSidebarItem === "Admin" &&
      account?.accountType === "business" &&
      account?.businessRole === "administrator"
    ) {
      window.location.replace("/apps/admin");
    }
  }, [account, accountLoading, activeSidebarItem]);

  useEffect(() => {
    if (
      activeSidebarItem === "Connectors" &&
      selfParentalControls?.allowConnectors === false
    ) {
      setSettingsPage("Appearance", { replace: true });
    }
  }, [activeSidebarItem, selfParentalControls, setSettingsPage]);

  useEffect(() => {
    if (
      account?.education &&
      (activeSidebarItem === "Advanced" ||
        (account.education.role === "student" &&
          activeSidebarItem === "Billing"))
    ) {
      setSettingsPage("Profile", { replace: true });
    }
  }, [account?.education, activeSidebarItem, setSettingsPage]);

  useEffect(() => {
    if (accountLoading || isGuest === null) {
      return undefined;
    }

    if (isGuest) {
      setResolvedSidebarItems(buildSidebarItems([], true));
      return undefined;
    }

    if (account?.deleted) {
      setResolvedSidebarItems(
        buildSidebarItems([]).filter((item) =>
          deletedAccountPageNames.has(item.name),
        ),
      );
      return undefined;
    }

    if (account?.archived) {
      setResolvedSidebarItems(
        buildSidebarItems([]).filter((item) =>
          ["Profile", "Appearance", "Language & Time"].includes(item.name),
        ),
      );
      return undefined;
    }

    let isMounted = true;

    const fetchEligibleSidebarItems = async () => {
      try {
        const response = await fetch(
          `${eligibleSidebarItemsUrl}?refresh=${eligibilityRefresh}`,
          {
            credentials: "include",
            headers: {
              Accept: "application/json",
            },
          },
        );

        if (!response.ok) {
          const error = new Error(`Elligbe fetch failed: ${response.status}`);
          error.status = response.status;
          throw error;
        }

        const payload = await response.json();
        const nextSidebarItems = buildSidebarItems(
          normalizeEligibleSidebarItems(payload),
        );

        if (!isMounted) {
          return;
        }

        setResolvedSidebarItems(nextSidebarItems);
        setActiveSidebarItem((currentItem) =>
          nextSidebarItems.some((item) => item.name === currentItem) ||
          (currentItem === "Admin" &&
            account?.accountType === "business" &&
            account?.businessRole === "administrator")
            ? currentItem
            : nextSidebarItems[0]?.name || currentItem,
        );
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setResolvedSidebarItems(buildSidebarItems());
        showElligbeErrorToast(error?.status, copy);
      }
    };

    fetchEligibleSidebarItems();

    return () => {
      isMounted = false;
    };
  }, [account, accountLoading, copy, eligibilityRefresh, isGuest]);

  return (
    <main className="min-h-dvh px-3 pb-5 pt-20 text-white md:px-4">
      <AccountManagerTopbar copy={copy} initialLoggedIn={initialLoggedIn} />
      <div
        className="flex w-full flex-col gap-3 md:flex-row md:gap-4"
        id="accountmanagercontentcontainer"
      >
        <aside
          aria-label={copy.accountSettings}
          className="account-settings-sidebar liquid-glass h-auto w-full shrink-0 rounded-2xl border border-white/10 bg-purple-950/20! p-1 shadow-2xl shadow-purple-950/20 md:w-[80px] lg:w-[300px]!"
          id="sidebar"
        >
          <nav
            aria-label={copy.accountSettings}
            className="flex h-full w-full flex-row gap-1 overflow-x-auto md:flex-col md:overflow-x-visible md:overflow-y-auto"
            id="accountSettingsNavigation"
          >
            <a
              className="flex h-10 min-w-fit items-center justify-center gap-2 rounded-xl px-2 text-sm text-white/72 transition hover:bg-[color-mix(in_srgb,var(--accent)_35%,transparent)]! hover:text-white md:w-10 md:min-w-10 md:px-0 lg:w-full lg:justify-start lg:px-2"
              href="/"
            >
              <icon>arrow_back</icon>
              <span className="md:hidden lg:inline">
                {copy.accountSettingsBackHome}
              </span>
            </a>
            {sidebarItemsToRender
              .filter((item) => !account?.archived || item.name !== "Billing")
              .map((item) => {
                const label = getSidebarItemLabel(item, copy);
                const isActive = activeSidebarItem === item.name;

                return (
                  <button
                    aria-label={label}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex h-10 min-w-fit items-center justify-center gap-2 rounded-xl px-2 text-left text-sm transition md:w-10 md:min-w-10 md:px-0 lg:w-full lg:justify-start lg:px-2 ${item.name === "Admin" ? "md:mt-auto" : ""} ${
                      isActive
                        ? "border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_35%,transparent)]! text-white"
                        : "text-white/72 hover:bg-[color-mix(in_srgb,var(--accent)_35%,transparent)]! hover:text-white"
                    }`}
                    key={`${item.name}-${item.order || item.icon}`}
                    onClick={() => {
                      if (item.name === "Admin") {
                        window.location.assign("/apps/admin");
                        return;
                      }
                      setSettingsPage(item.name);
                    }}
                    type="button"
                  >
                    <icon>{item.icon}</icon>
                    <span className="min-w-0 truncate md:hidden lg:inline">
                      {label}
                    </span>
                  </button>
                );
              })}
          </nav>
        </aside>
        <section
          aria-label={copy.accountSettings}
          className="liquid-glass min-h-[calc(100dvh-13rem)] w-full flex-1 rounded-2xl border border-white/10 bg-purple-950/20! md:min-h-[calc(100dvh-7rem)]"
          style={{ padding: "var(--account-settings-padding, 16px)" }}
        >
          {account?.archived
            ? <p className="mb-4 rounded-xl border border-amber-200/25 bg-amber-500/15! px-4 py-3 text-sm font-semibold text-amber-50">
                {copy.demoArchivedBanner}
              </p>
            : null}
          {account?.deleted
            ? <p className="mb-4 rounded-xl border border-rose-200/25 bg-rose-500/15! px-4 py-3 text-sm font-semibold text-rose-50">
                {copy.accountNotFoundMessage}
              </p>
            : null}
          {account?.accountType === "business" &&
          account?.businessVerified === false
            ? <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200/25 bg-amber-500/15! px-4 py-3 text-amber-50">
                <icon>warning</icon>
                <div>
                  <p className="font-bold">{copy.businessUnverified}</p>
                  <p className="mt-1 text-sm leading-6 text-amber-50/75">
                    {copy.businessVerificationRequired}
                  </p>
                </div>
              </div>
            : null}
          {isGuest === false
            ? <div
                aria-hidden={activeSidebarItem !== "Profile"}
                data-account-settings-panel="Profile"
                hidden={activeSidebarItem !== "Profile"}
                inert={activeSidebarItem !== "Profile"}
              >
                {account?.deleted
                  ? <DeletedAccountProfile copy={copy} />
                  : account?.archived
                    ? <div className="mx-auto max-w-3xl space-y-4">
                        <h1 className="text-2xl font-bold">
                          {copy.accountSettingsProfile}
                        </h1>
                        <p className="rounded-xl border border-amber-200/25 bg-amber-500/15! px-4 py-3 text-sm font-semibold text-amber-50">
                          {copy.archivedProfilePreview}
                        </p>
                        <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5! p-5">
                          <AccountAvatar
                            account={account}
                            className="h-16 w-16 rounded-2xl"
                          />
                          <div className="min-w-0">
                            <h2 className="truncate text-xl font-bold">
                              {account.name}
                            </h2>
                            <p className="truncate text-sm text-white/55">
                              {account.email}
                            </p>
                          </div>
                        </div>
                      </div>
                    : <AccountProfileSection
                        copy={copy}
                        managedStudent={account?.education?.role === "student"}
                      />}
              </div>
            : null}
          <div
            aria-hidden={activeSidebarItem !== "Appearance"}
            data-account-settings-panel="Appearance"
            hidden={activeSidebarItem !== "Appearance"}
            inert={activeSidebarItem !== "Appearance"}
          >
            <AccountAppearanceSection copy={copy} />
          </div>
          <div
            aria-hidden={activeSidebarItem !== "Language & Time"}
            data-account-settings-panel="Language & Time"
            hidden={activeSidebarItem !== "Language & Time"}
            inert={activeSidebarItem !== "Language & Time"}
          >
            <AccountLanguageTimeSection copy={copy} />
          </div>
          <div
            aria-hidden={activeSidebarItem !== "Privacy"}
            data-account-settings-panel="Privacy"
            hidden={activeSidebarItem !== "Privacy"}
            inert={activeSidebarItem !== "Privacy"}
          >
            <AccountPrivacySection
              copy={copy}
              managedStudent={account?.education?.role === "student"}
            />
          </div>
          {!account?.education
            ? <div
                aria-hidden={activeSidebarItem !== "Advanced"}
                data-account-settings-panel="Advanced"
                hidden={activeSidebarItem !== "Advanced"}
                inert={activeSidebarItem !== "Advanced"}
              >
                <AccountAdvancedSection copy={copy} />
              </div>
            : null}
          {isGuest === false
            ? <>
                <div
                  aria-hidden={activeSidebarItem !== "Security"}
                  data-account-settings-panel="Security"
                  hidden={activeSidebarItem !== "Security"}
                  inert={activeSidebarItem !== "Security"}
                >
                  <AccountSecuritySection
                    copy={copy}
                    managedStudent={account?.education?.role === "student"}
                  />
                </div>
                {account?.education?.role !== "student"
                  ? <div
                      aria-hidden={activeSidebarItem !== "Billing"}
                      data-account-settings-panel="Billing"
                      hidden={activeSidebarItem !== "Billing"}
                      inert={activeSidebarItem !== "Billing"}
                    >
                      <CommerceComingSoon
                        copy={copy}
                        title={copy.accountSettingsBilling}
                      />
                    </div>
                  : null}
                <div
                  aria-hidden={activeSidebarItem !== "Storage"}
                  data-account-settings-panel="Storage"
                  hidden={activeSidebarItem !== "Storage"}
                  inert={activeSidebarItem !== "Storage"}
                >
                  <AccountStorageSection
                    copy={copy}
                    deletedAccount={account?.deleted}
                    managedStudent={account?.education?.role === "student"}
                  />
                </div>
                <div
                  aria-hidden={activeSidebarItem !== "Connectors"}
                  data-account-settings-panel="Connectors"
                  hidden={activeSidebarItem !== "Connectors"}
                  inert={activeSidebarItem !== "Connectors"}
                >
                  <AccountConnectorsSection
                    copy={copy}
                    deletedAccount={account?.deleted}
                  />
                </div>
                {!account?.deleted
                  ? <div
                      aria-hidden={activeSidebarItem !== "Families"}
                      data-account-settings-panel="Families"
                      hidden={activeSidebarItem !== "Families"}
                      inert={activeSidebarItem !== "Families"}
                    >
                      <AccountFamiliesSection copy={copy} />
                    </div>
                  : null}
                {account?.education?.role === "teacher"
                  ? <div
                      aria-hidden={activeSidebarItem !== "Students"}
                      data-account-settings-panel="Students"
                      hidden={activeSidebarItem !== "Students"}
                      inert={activeSidebarItem !== "Students"}
                    >
                      <AccountStudentsSection copy={copy} />
                    </div>
                  : null}
                {account?.accountType === "business" &&
                account?.businessRole === "administrator"
                  ? <div
                      aria-hidden={activeSidebarItem !== "Admin"}
                      data-account-settings-panel="Admin"
                      hidden={activeSidebarItem !== "Admin"}
                      inert={activeSidebarItem !== "Admin"}
                    >
                      <AccountBusinessAdminSection
                        account={account}
                        copy={copy}
                      />
                    </div>
                  : null}
              </>
            : null}
          <div
            aria-hidden={activeSidebarItem !== "Data Controls"}
            data-account-settings-panel="Data Controls"
            hidden={activeSidebarItem !== "Data Controls"}
            inert={activeSidebarItem !== "Data Controls"}
          >
            {isGuest === null
              ? <p className="p-4 text-sm text-white/60">
                  {copy.accountProcessing}
                </p>
              : <AccountDataControlsSection
                  account={account}
                  copy={copy}
                  isGuest={isGuest}
                  managedStudent={account?.education?.role === "student"}
                />}
          </div>
          <div
            aria-hidden={activeSidebarItem !== "Age Verification"}
            hidden={activeSidebarItem !== "Age Verification"}
            inert={activeSidebarItem !== "Age Verification"}
          >
            <UnavailableDeveloperPanel
              actionLabel={copy.accountSettingsAdmin}
              copy={copy}
              description={copy.developerAgeVerificationDescription}
              title={copy.developerAgeVerification}
            />
          </div>
          <div
            aria-hidden={activeSidebarItem !== "Admin Controls"}
            hidden={activeSidebarItem !== "Admin Controls"}
            inert={activeSidebarItem !== "Admin Controls"}
          >
            <UnavailableDeveloperPanel
              copy={copy}
              description={copy.developerAdminControlsDescription}
              title={copy.developerAdminControls}
            />
          </div>
          <div
            aria-hidden={activeSidebarItem !== "Fake/Unused"}
            hidden={activeSidebarItem !== "Fake/Unused"}
            inert={activeSidebarItem !== "Fake/Unused"}
          >
            <div className="mx-auto max-w-2xl space-y-4">
              <h1 className="text-2xl font-bold">{copy.developerFakeUnused}</h1>
              <p className="text-sm text-white/65">
                {copy.developerFakeUnusedDescription}
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-rose-500/20! px-3 py-1 text-xs">
                  {copy.storageFullWarning}
                </span>
                <span className="rounded-full bg-purple-500/20! px-3 py-1 text-xs">
                  {copy.developerHiddenBadge}
                </span>
                <span className="rounded-full bg-amber-500/20! px-3 py-1 text-xs">
                  {copy.developerUnusedBadge}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
