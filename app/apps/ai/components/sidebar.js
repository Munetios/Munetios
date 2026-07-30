"use client";

import Image from "next/image";
import AccountAvatar from "../../../components/accountAvatar";
import { openAccountSettingsModal } from "../../../components/accountSettingsModal";
import {
  confirmBrowserSignOut,
  openAccountSwitcher,
} from "../../../components/accountSwitcher";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { openFeedbackModal } from "../../../components/feedbackModal";
import {
  aiKeyboardShortcuts,
  openKeyboardShortcutsModal,
} from "../../../components/keyboardShortcutsModal";
import { showModal } from "../../../components/modal";
import PricingOverlay from "./pricingOverlay";
import { openAiSettingsModal } from "./settingsModal";
import { openUnlockFeaturesModal } from "./unlockFeaturesModal";

const signedInItems = [
  { icon: "edit_square", key: "aiSidebarNewChat" },
  { icon: "search", key: "aiSidebarSearchChats" },
  { icon: "highlight_mouse_cursor", key: "aiSidebarAgent" },
  { icon: "photo_library", key: "aiSidebarImages" },
  { icon: "cards_stack", key: "aiSidebarLibrary" },
  { icon: "extension", key: "aiSidebarPlugins" },
  { icon: "code", key: "aiSidebarCode" },
  { icon: "smart_toy", key: "aiSidebarMyBots" },
  { icon: "menu_book", key: "aiSidebarBooks" },
  { icon: "health_and_safety", key: "aiSidebarHealth" },
];

const guestItems = [
  { icon: "edit_square", key: "aiSidebarNewChat" },
  { icon: "search", key: "aiSidebarSearchChats" },
  { icon: "highlight_mouse_cursor", key: "aiSidebarAgent" },
  { icon: "extension", key: "aiSidebarPlugins" },
  { icon: "health_and_safety", key: "aiSidebarHealth" },
];

const guestMoreItems = [
  { icon: "photo_library", key: "aiSidebarImages" },
  { icon: "cards_stack", key: "aiSidebarLibrary" },
  { icon: "smart_toy", key: "aiSidebarMyBots" },
  { icon: "menu_book", key: "aiSidebarBooks" },
];
const guestRestrictedItems = new Set(["aiSidebarAgent", "aiSidebarPlugins"]);

function getPlan(account, copy) {
  const plan = String(account?.plan || "")
    .trim()
    .toLowerCase();

  if (["pro", "business pro", "business-pro"].includes(plan)) {
    return { key: "aiPlanPro", label: copy.aiPlanPro, tier: "pro" };
  }

  if (
    [
      "pro lite",
      "pro-lite",
      "munetios ai plus",
      "munetios-ai-plus",
      "business standard",
      "business-standard",
    ].includes(plan)
  ) {
    return {
      key: "aiPlanProLite",
      label: copy.aiPlanProLite,
      tier: "pro-lite",
    };
  }

  return { key: "aiPlanFree", label: copy.aiPlanFree, tier: "free" };
}

function SidebarItem({ copy, icon, itemKey, onClick }) {
  return (
    <button
      aria-label={copy[itemKey]}
      className="munetios-ai-sidebar-nav-item group flex w-full cursor-pointer items-center gap-3 text-left"
      data-translate-aria-label={itemKey}
      onClick={onClick}
      type="button"
    >
      <span className="munetios-ai-sidebar-nav-icon flex shrink-0 items-center justify-center">
        <icon>{icon}</icon>
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[0.95rem] font-medium"
        data-translate={itemKey}
      >
        {copy[itemKey]}
      </span>
    </button>
  );
}

function SidebarGroup({ children, copy, itemKey }) {
  return (
    <section className="munetios-ai-sidebar-group">
      <div className="munetios-ai-sidebar-group-header flex items-center gap-2">
        <h2
          className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-[0.12em] text-white/60"
          data-translate={itemKey}
        >
          {copy[itemKey]}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Avatar({ account, guest = false, size = "default" }) {
  const sizeClass = size === "large" ? "munetios-ai-profile-avatar-large" : "";

  return (
    <AccountAvatar
      account={guest ? { avatarLetter: "G", name: "Guest" } : account}
      className={`munetios-ai-profile-avatar ${sizeClass}`}
      fallbackClassName="munetios-ai-profile-avatar-fallback"
    />
  );
}

function openPricingOverlay(copy, signedIn) {
  showModal(
    ({ close }) => (
      <PricingOverlay close={close} copy={copy} signedIn={signedIn} />
    ),
    {
      ariaLabel: copy.aiPricingTitle,
      fullViewport: true,
      height: "100vh",
      style: { maxHeight: "100vh", maxWidth: "100%" },
      title: copy.aiPricingTitle,
      width: "100%",
    },
  );
}

function GuestMoreMenu({ copy }) {
  return (
    <DropdownWrapper
      ariaLabel={copy.aiSidebarMore}
      buttonClassName="munetios-ai-sidebar-nav-item group flex w-full cursor-pointer items-center gap-3 text-left"
      className="w-full"
      panelClassName="w-[min(18rem,calc(100vw-1rem))]"
      trigger={
        <>
          <span className="munetios-ai-sidebar-nav-icon flex shrink-0 items-center justify-center">
            <icon>more_horiz</icon>
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[0.95rem] font-medium"
            data-translate="aiSidebarMore"
          >
            {copy.aiSidebarMore}
          </span>
        </>
      }
      triggerAs="div"
      zIndex={2200}
    >
      <div className="space-y-1">
        {guestMoreItems.map((item) => (
          <div
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white"
            key={item.key}
          >
            <icon>{item.icon}</icon>
            <span data-translate={item.key}>{copy[item.key]}</span>
          </div>
        ))}
      </div>
    </DropdownWrapper>
  );
}

function ProfileMenu({ account, copy, guest, plan }) {
  const signOut = () => confirmBrowserSignOut({ copy });
  const openHelpCenter = () => {
    const locale = document.documentElement.lang || "en";
    const supported = new Set([
      "de",
      "en",
      "es",
      "es-MX",
      "es-US",
      "fr",
      "pt-BR",
      "pt-PT",
    ]);
    window.location.assign(
      supported.has(locale) && locale !== "en" ? `/${locale}/help` : "/help",
    );
  };

  const menuItems = guest
    ? [
        { icon: "help", key: "aiProfileHelp", onClick: openHelpCenter },
        {
          icon: "payments",
          key: "aiProfileViewPricing",
          onClick: () => openPricingOverlay(copy, false),
        },
        {
          icon: "feedback",
          key: "aiProfileFeedback",
          onClick: () => openFeedbackModal({ context: "munetios-ai" }),
        },
      ]
    : [
        ...(plan.tier !== "pro"
          ? [
              {
                icon: "upgrade",
                key: "aiProfileUpgradePlan",
                onClick: () => openPricingOverlay(copy, true),
              },
            ]
          : []),
        { icon: "help", key: "aiProfileHelp", onClick: openHelpCenter },
        {
          icon: "feedback",
          key: "aiProfileFeedback",
          onClick: () => openFeedbackModal({ context: "munetios-ai" }),
        },
        {
          icon: "manage_accounts",
          key: "aiProfileManageAccount",
          onClick: () =>
            openAccountSettingsModal(),
        },
        {
          icon: "switch_account",
          key: "switchAccount",
          onClick: () => openAccountSwitcher({ copy }),
        },
        {
          icon: "person_add",
          key: "addAccount",
          onClick: () => openAccountSwitcher({ addAccount: true, copy }),
        },
        {
          danger: true,
          icon: "logout",
          key: "aiProfileSignOut",
          onClick: signOut,
        },
      ];

  return (
    <div className="space-y-1">
      {!guest
        ? <div className="mb-2 flex items-center gap-3 border-b border-white/10 px-2 pb-3 pt-1">
            <Avatar account={account} size="large" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {account?.name || copy.accountNameFallback}
              </p>
              <p
                className="truncate text-xs text-white/60"
                data-translate={plan.key}
              >
                {plan.label}
              </p>
              <span className="mt-1 inline-flex rounded-full border border-purple-200/20 bg-purple-500/20! px-2 py-0.5 text-[0.68rem] font-bold text-purple-100">
                {copy.personalAccountBadge}
              </span>
            </div>
          </div>
        : null}
      <button
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white transition hover:bg-white/10!"
        data-dropdown-close
        onClick={() =>
          openKeyboardShortcutsModal({
            shortcuts: aiKeyboardShortcuts,
            title: "Munetios AI keyboard shortcuts",
          })}
        role="menuitem"
        type="button"
      >
        <icon>keyboard</icon>
        <span>Keyboard shortcuts</span>
      </button>
      {menuItems.map((item) => (
        <button
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-white/10! ${item.danger ? "text-rose-100 hover:bg-rose-500/20!" : "text-white"}`}
          data-dropdown-close
          key={item.key}
          onClick={item.onClick}
          role="menuitem"
          type="button"
        >
          <icon>{item.icon}</icon>
          <span data-translate={item.key}>{copy[item.key]}</span>
        </button>
      ))}
      <nav
        aria-label={`${copy.footerTerms} ${copy.authAnd} ${copy.footerPrivacy}`}
        className="flex items-center justify-center gap-2 px-2 pt-2 text-[0.68rem]"
        style={{
          color: "color-mix(in srgb, var(--foreground) 52%, transparent)",
        }}
      >
        <a
          className="hover:underline"
          href="/terms"
          rel="noopener noreferrer"
          target="_blank"
        >
          {copy.footerTerms}
        </a>
        <span aria-hidden="true">&bull;</span>
        <a
          className="hover:underline"
          href="/privacy"
          rel="noopener noreferrer"
          target="_blank"
        >
          {copy.footerPrivacy}
        </a>
      </nav>
    </div>
  );
}

export default function AiSidebar({
  account,
  collapsed,
  copy,
  hidden,
  onToggle,
  signedIn,
}) {
  const navigationItems = signedIn ? signedInItems : guestItems;
  const plan = getPlan(account, copy);
  const profileName = signedIn
    ? account?.name || copy.accountNameFallback
    : copy.aiGuest;

  return (
    <aside
      aria-label="Munetios AI"
      aria-hidden={hidden}
      className={`munetios-ai-sidebar liquid-glass flex flex-col ${collapsed ? "is-collapsed" : ""}`}
      data-translate-aria-label="aiAppPageLabel"
    >
      <header className="munetios-ai-sidebar-header flex w-full items-center justify-between gap-3">
        <a
          className="munetios-ai-sidebar-brand flex min-w-0 items-center gap-2.5"
          href="/apps/ai"
        >
          <Image
            alt=""
            aria-hidden="true"
            className="h-8 w-8 shrink-0 rounded-lg object-contain"
            height={32}
            src="/ai.png"
            width={32}
          />
          <span className="truncate text-lg font-semibold tracking-[-0.01em]">
            Munetios AI
          </span>
        </a>
        <button
          aria-label={
            collapsed ? copy.omniWriteOpenSidebar : copy.omniWriteCloseSidebar
          }
          className="munetios-ai-menu-button flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-white/10!"
          data-translate-aria-label={
            collapsed ? "omniWriteOpenSidebar" : "omniWriteCloseSidebar"
          }
          onClick={onToggle}
          type="button"
        >
          <icon>{collapsed ? "left_panel_open" : "left_panel_close"}</icon>
        </button>
      </header>
      <div className="munetios-ai-sidebar-scroll min-h-0 flex-1 overflow-y-auto">
        <nav
          aria-label={copy.aiSidebarNavigation}
          className="munetios-ai-sidebar-navigation flex flex-col"
          data-translate-aria-label="aiSidebarNavigation"
        >
          {navigationItems.map((item) => (
            <SidebarItem
              copy={copy}
              icon={item.icon}
              itemKey={item.key}
              key={item.key}
              onClick={
                !signedIn && guestRestrictedItems.has(item.key)
                  ? () => openUnlockFeaturesModal(copy)
                  : undefined
              }
            />
          ))}
          {!signedIn ? <GuestMoreMenu copy={copy} /> : null}
        </nav>
        <div className="munetios-ai-sidebar-groups flex flex-col">
          {signedIn
            ? <SidebarGroup copy={copy} itemKey="aiSidebarPinned" />
            : null}
          {signedIn
            ? <SidebarGroup copy={copy} itemKey="aiSidebarProjects" />
            : null}
          <SidebarGroup copy={copy} itemKey="aiSidebarChats" />
        </div>
      </div>
      <nav
        aria-label={copy.aiSidebarUtilities}
        className="munetios-ai-sidebar-bottom flex flex-col"
        data-translate-aria-label="aiSidebarUtilities"
      >
        <SidebarItem
          copy={copy}
          icon="settings"
          itemKey="aiSidebarSettings"
          onClick={() =>
            openAiSettingsModal({ plan: account?.plan, signedIn })
          }
        />
        <DropdownWrapper
          ariaLabel={copy.aiProfileMenu}
          buttonClassName="munetios-ai-profile-trigger flex w-full cursor-pointer items-center gap-3 text-left"
          className="w-full"
          panelClassName="w-[min(19rem,calc(100vw-1rem))]"
          trigger={
            <>
              <Avatar account={account} guest={!signedIn} />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-semibold text-white">
                  {profileName}
                </strong>
                <small
                  className="block truncate text-xs text-white/60"
                  data-translate={signedIn ? plan.key : "aiGuest"}
                >
                  {signedIn ? plan.label : copy.aiGuest}
                </small>
              </span>
              <icon className="munetios-ai-profile-menu-icon text-white/55">
                more_horiz
              </icon>
            </>
          }
          triggerAs="div"
          zIndex={2200}
        >
          <ProfileMenu
            account={account}
            copy={copy}
            guest={!signedIn}
            plan={plan}
          />
        </DropdownWrapper>
      </nav>
    </aside>
  );
}
