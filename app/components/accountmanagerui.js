"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { hasSignedInCookie } from "../lib/signedInCookie";
import AccountAppearanceSection from "./accountAppearanceSection";
import AccountAvatar from "./accountAvatar";
import AccountBillingSection from "./accountBillingSection";
import AccountBusinessAdminSection from "./accountBusinessAdminSection";
import AccountConnectorsSection from "./accountConnectorsSection";
import AccountLanguageTimeSection from "./accountLanguageTimeSection";
import AccountProfileSection from "./accountProfileSection";
import AccountSecuritySection from "./accountSecuritySection";
import AccountWrapper from "./accountwraper";
import AppLauncherWrapper from "./appLauncherWrapper";
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
  Advanced: "advanced",
  Appearance: "appearance",
  Billing: "billing",
  Connectors: "connectors",
  "Data Controls": "data-controls",
  Families: "families",
  "Language & Time": "language-time",
  Privacy: "privacy",
  Profile: "profile",
  Security: "security",
  "Trusted People": "trusted-people",
};
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
  (item) => !item.ifElligbeItem && item.name !== "Billing",
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
  const translatedMessage =
    copy[ElligbeErrorToast.toast] || ElligbeErrorToast.toast;

  showToast({
    message: status ? `${translatedMessage} ${status} error` : undefined,
    messageKey: ElligbeErrorToast.toast,
    type: "error",
  });
}

export function AccountManagerTopbar({ copy = t() }) {
  const accountPanelRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const appLauncherTriggerRef = useRef(null);
  const [accountWrapperOpen, setAccountWrapperOpen] = useState(false);
  const [appLauncherOpen, setAppLauncherOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [topbarAccount, setTopbarAccount] = useState(null);
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
    fetch("/api/account", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((account) => {
        if (account) setTopbarAccount(account);
      })
      .catch(() => {});
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
    window.addEventListener("munetios:profilechange", syncProfile);
    return () =>
      window.removeEventListener("munetios:profilechange", syncProfile);
  }, []);

  useEffect(() => {
    if (!accountWrapperOpen) {
      return undefined;
    }

    updateAccountPanelPosition();

    const onPointerDown = (event) => {
      if (
        accountPanelRef.current?.contains(event.target) ||
        accountTriggerRef.current?.contains(event.target) ||
        event.target.closest?.("[data-munetios-dropdown-portal='true']")
      ) {
        return;
      }

      setAccountWrapperOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setAccountWrapperOpen(false);
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
  }, [accountWrapperOpen, updateAccountPanelPosition]);

  return (
    <header className="account-manager-topbar fixed top-0 z-[1000] left-0 w-full flex items-start justify-between p-2 md:items-center md:p-4">
      <div className="flex items-center gap-2">
        <div className="h-14 p-4 liquid-glass flex items-center gap-2">
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
      <div className="liquid-glass flex h-14 items-center gap-2 rounded-2xl px-3">
        <button
          aria-label={copy.openAppLauncher}
          aria-controls="appsWrapper"
          aria-expanded={appLauncherOpen}
          data-translate-aria-label="openAppLauncher"
          id="appsBtn"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-white transition-all hover:bg-purple-700/50!"
          onClick={() => {
            setAccountWrapperOpen(false);
            setAppLauncherOpen(true);
          }}
          ref={appLauncherTriggerRef}
          type="button"
        >
          <icon>apps</icon>
        </button>
        {topbarAccount
          ? <button
              aria-label={copy.openAccountMenu}
              aria-controls="accountWrapperPanel"
              aria-expanded={accountWrapperOpen}
              id="accountProfilePicture"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-white transition-all hover:bg-purple-700/50!"
              onClick={() => {
                updateAccountPanelPosition();
                setAppLauncherOpen(false);
                setAccountWrapperOpen(true);
              }}
              ref={accountTriggerRef}
              type="button"
            >
              <AccountAvatar
                account={topbarAccount || { avatarLetter: "M" }}
                alt={copy.accountProfileAlt}
                className="h-10 w-10 rounded-xl"
              />
            </button>
          : <button
              id="sign-in-button"
              className="liquid-glass hover:bg-purple-600! transition-all cursor-pointer text-white py-2 px-4 rounded-br-xl bg-purple-800/90!"
              data-translate="signIn"
              onClick={() => {
                window.location.assign("/signin");
              }}
              type="button"
            >
              {copy.signIn}
            </button>}
      </div>
      {mounted && accountWrapperOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[1100]"
              id="accountWrapperPanel"
              ref={accountPanelRef}
              style={{
                right: "10px",
                top: `${panelTop}px`,
              }}
            >
              <AccountWrapper />
            </div>,
            document.body,
          )
        : null}
      <AppLauncherWrapper
        copy={copy}
        onClose={() => setAppLauncherOpen(false)}
        open={appLauncherOpen}
        triggerRef={appLauncherTriggerRef}
      />
    </header>
  );
}

export const accountManagerTopbar = AccountManagerTopbar;

export default function AccountSettings({ initialPage = "profile" }) {
  const [copy, setCopy] = useState(() => t());
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
    hasSignedInCookie() ? false : null,
  );
  const refreshAccount = useCallback(() => {
    setAccountLoading(true);
    fetch("/api/account", { credentials: "include" })
      .then(async (response) => ({
        invalidSession:
          response.headers.get("X-Munetios-Auth-State") === "invalid-session",
        payload: response.ok ? await response.json() : null,
      }))
      .then(({ invalidSession, payload }) => {
        if (payload) {
          setAccount(payload);
        }
        setIsGuest(!hasSignedInCookie() && !payload && !invalidSession);
        setAccountLoading(false);
      })
      .catch(() => {
        if (!hasSignedInCookie()) {
          setAccount(null);
          setIsGuest(true);
        } else {
          setIsGuest(false);
        }
        setAccountLoading(false);
      });
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
    return account?.accountType === "business" &&
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
  }, [account, accountLoading, isGuest, resolvedSidebarItems]);

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
    if (accountLoading || isGuest === null) {
      return undefined;
    }

    if (isGuest) {
      setResolvedSidebarItems(buildSidebarItems([], true));
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
    <main className="min-h-dvh  px-3 pb-6 pt-24 text-white md:px-4">
      <AccountManagerTopbar copy={copy} />
      <div
        className="flex w-full flex-col gap-3 md:flex-row md:gap-4"
        id="accountmanagercontentcontainer"
      >
        <aside
          aria-label={copy.accountSettings}
          className="liquid-glass h-auto w-full shrink-0 rounded-2xl border border-white/10 bg-purple-950/20! p-2 shadow-2xl shadow-purple-950/20 md:h-[calc(100dvh-7rem)] md:w-[80px] lg:w-[300px]!"
          id="sidebar"
        >
          <nav
            aria-label={copy.accountSettings}
            className="flex h-full w-full flex-row gap-1 overflow-x-auto md:flex-col md:overflow-x-visible md:overflow-y-auto"
            id="accountSettingsNavigation"
          >
            <a
              className="flex h-12 min-w-fit items-center justify-center gap-3 rounded-xl px-3 text-sm font-semibold text-white/72 transition hover:bg-purple-700/35! hover:text-white md:w-12 md:min-w-12 md:px-0 lg:w-full lg:justify-start lg:px-3"
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
                    className={`flex h-12 min-w-fit items-center justify-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition md:w-12 md:min-w-12 md:px-0 lg:w-full lg:justify-start lg:px-3 ${item.name === "Admin" ? "md:mt-auto" : ""} ${
                      isActive
                        ? "border border-purple-200/30 bg-purple-500/35! text-white"
                        : "text-white/72 hover:bg-purple-700/35! hover:text-white"
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
          className="liquid-glass min-h-[calc(100dvh-13rem)] w-full flex-1 rounded-2xl border border-white/10 bg-purple-950/20! p-4 md:min-h-[calc(100dvh-7rem)]"
        >
          {account?.archived
            ? <p className="mb-4 rounded-xl border border-amber-200/25 bg-amber-500/15! px-4 py-3 text-sm font-semibold text-amber-50">
                {copy.demoArchivedBanner}
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
                <AccountProfileSection copy={copy} />
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
          {isGuest === false
            ? <>
                <div
                  aria-hidden={activeSidebarItem !== "Security"}
                  data-account-settings-panel="Security"
                  hidden={activeSidebarItem !== "Security"}
                  inert={activeSidebarItem !== "Security"}
                >
                  <AccountSecuritySection copy={copy} />
                </div>
                <div
                  aria-hidden={activeSidebarItem !== "Billing"}
                  data-account-settings-panel="Billing"
                  hidden={activeSidebarItem !== "Billing"}
                  inert={activeSidebarItem !== "Billing"}
                >
                  <AccountBillingSection copy={copy} />
                </div>
                <div
                  aria-hidden={activeSidebarItem !== "Connectors"}
                  data-account-settings-panel="Connectors"
                  hidden={activeSidebarItem !== "Connectors"}
                  inert={activeSidebarItem !== "Connectors"}
                >
                  <AccountConnectorsSection copy={copy} />
                </div>
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
        </section>
      </div>
    </main>
  );
}
