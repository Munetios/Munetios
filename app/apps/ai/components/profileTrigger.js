"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import AccountAvatar from "../../../components/accountAvatar";
import { openAccountSettingsModal } from "../../../components/accountSettingsModal";
import {
  confirmBrowserSignOut,
  openAccountSwitcher,
} from "../../../components/accountSwitcher";
import CheckoutModal from "../../../components/checkoutModal";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { openFeedbackModal } from "../../../components/feedbackModal";
import { openKeyboardShortcutsModal } from "../../../components/keyboardShortcutsModal";
import { t } from "../../../i18n";
import {
  getUserCurrency,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import {
  formatPlanPrice,
  getPlan as getPricingPlan,
} from "../../../lib/pricing";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import { loadAiAccountCache, saveAiAccountCache } from "../lib/accountCache";

function getPlan(plan, copy) {
  const normalizedPlan = String(plan || "")
    .trim()
    .toLowerCase();

  if (normalizedPlan === "education") {
    return { label: "Education", tier: "education" };
  }

  if (["pro", "business pro", "business-pro"].includes(normalizedPlan)) {
    return { label: copy.aiPlanPro, tier: "pro" };
  }

  if (
    [
      "pro lite",
      "pro-lite",
      "munetios ai plus",
      "munetios-ai-plus",
      "business standard",
      "business-standard",
    ].includes(normalizedPlan)
  ) {
    return { label: copy.aiPlanProLite, tier: "pro-lite" };
  }

  return { label: copy.aiPlanFree, tier: "free" };
}

function openHelpCenter() {
  const locale = document.documentElement.lang || "en";
  const localizedHelpLocales = new Set([
    "de",
    "en",
    "es",
    "es-MX",
    "es-US",
    "fr",
    "pt-BR",
    "pt-PT",
  ]);
  const helpUrl =
    localizedHelpLocales.has(locale) && locale !== "en"
      ? `/${locale}/help`
      : "/help";

  window.open(helpUrl, "_blank", "noopener,noreferrer");
}

function PlanChooserModal({
  close,
  copy,
  currency,
  onChoose,
  preferences,
  stackIndex,
}) {
  const freePlan = getPricingPlan("free");
  const proLitePlan = getPricingPlan("pro-lite");
  const proPlan = getPricingPlan("pro");
  const formatPrice = (selectedPlan) =>
    formatPlanPrice(selectedPlan, currency, { preferences });

  return createPortal(
    <div
      className="ai-plan-overlay"
      style={{ zIndex: 2147483000 + stackIndex }}
    >
      <section
        aria-label={copy.aiProfileUpgradePlan}
        aria-modal="true"
        className="ai-plan-modal"
        role="dialog"
      >
        <header>
          <h2>{copy.aiProfileUpgradePlan}</h2>
          <button aria-label={copy.close} onClick={close} type="button">
            <icon>close</icon>
          </button>
        </header>
        <div className="ai-plan-options">
          <article>
            <icon>person</icon>
            <h3>{copy.aiPlanFree}</h3>
            <p>{formatPrice(freePlan)}</p>
            <button disabled type="button">
              {copy.aiPlanFree}
            </button>
          </article>
          <article>
            <icon>bolt</icon>
            <h3>{copy.aiPlanProLite}</h3>
            <p>{formatPrice(proLitePlan)}</p>
            <button onClick={() => onChoose("pro-lite")} type="button">
              {copy.aiProfileUpgradePlan}
            </button>
          </article>
          <article>
            <icon>workspace_premium</icon>
            <h3>{copy.aiPlanPro}</h3>
            <p>{formatPrice(proPlan)}</p>
            <button onClick={() => onChoose("pro")} type="button">
              {copy.aiProfileUpgradePlan}
            </button>
          </article>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function ProfileTrigger({ appLoading = false }) {
  const [account, setAccount] = useState(null);
  const [copy, setCopy] = useState(() => t());
  const [sessionState, setSessionState] = useState("loading");
  const [modalStack, setModalStack] = useState([]);
  const [regionalPreferences, setRegionalPreferences] = useState(
    loadDateTimePreferences,
  );
  const modalSequence = useRef(0);

  useLayoutEffect(() => {
    const signedIn = hasSignedInCookie();
    setSessionState(signedIn ? "signed-in" : "guest");
    setAccount(signedIn ? loadAiAccountCache() : null);
  }, []);

  const openModal = useCallback((type, planId = "") => {
    modalSequence.current += 1;
    const modal = { id: modalSequence.current, planId, type };
    setModalStack((current) => [...current, modal]);
  }, []);

  const closeModal = useCallback((id) => {
    setModalStack((current) => current.filter((modal) => modal.id !== id));
  }, []);

  const refreshAccount = useCallback(async (signal) => {
    const cookieSignedIn = hasSignedInCookie();
    setSessionState(cookieSignedIn ? "signed-in" : "guest");
    if (!cookieSignedIn) {
      setAccount(null);
      return;
    }

    const cachedAccount = loadAiAccountCache();
    if (cachedAccount) setAccount(cachedAccount);

    try {
      const response = await fetch("/api/account", {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });

      if (!response.ok) {
        return;
      }

      const authoritativeAccount = await response.json();
      setAccount(authoritativeAccount);
      saveAiAccountCache(authoritativeAccount);
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refreshCopy = () => setCopy(t());
    const refreshProfile = () => void refreshAccount(controller.signal);
    const refreshRegion = () =>
      setRegionalPreferences(loadDateTimePreferences());

    refreshCopy();
    if (!appLoading) void refreshAccount(controller.signal);
    window.addEventListener("munetios:authchange", refreshProfile);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener("munetios:profilechange", refreshProfile);
    window.addEventListener("munetios:language-time-change", refreshRegion);

    return () => {
      controller.abort();
      window.removeEventListener("munetios:authchange", refreshProfile);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener("munetios:profilechange", refreshProfile);
      window.removeEventListener(
        "munetios:language-time-change",
        refreshRegion,
      );
    };
  }, [appLoading, refreshAccount]);

  const guest = sessionState !== "signed-in";
  const guestAccount = { avatarLetter: "G", name: copy.aiGuest };
  const displayedAccount = guest ? guestAccount : account;
  const accountName = guest
    ? copy.aiGuest
    : account?.name || copy.accountNameFallback;
  const plan = getPlan(account?.plan, copy);
  const currency = getUserCurrency(regionalPreferences);
  const shortcuts = [
    { keys: ["Ctrl", "Shift", "O"], label: copy.aiSidebarNewChat },
    { keys: ["Ctrl", "K"], label: copy.aiSidebarSearchChats },
    { keys: ["Ctrl", "Shift", "S"], label: copy.aiPromptMicrophone },
    { keys: ["Ctrl", "/"], label: copy.meetKeyboardShortcuts },
  ];

  const trigger = (
    <>
      <AccountAvatar
        account={displayedAccount}
        alt=""
        className="ai-sidebar-profile-avatar"
        fallbackClassName="ai-sidebar-profile-avatar-fallback"
      />
      <span className="ai-sidebar-profile-details">
        <span className="ai-sidebar-profile-name">{accountName}</span>
        {guest
          ? null
          : <span className="ai-sidebar-profile-plan">{plan.label}</span>}
      </span>
      <icon className="ai-sidebar-profile-menu-icon">more_horiz</icon>
    </>
  );

  return (
    <>
      <DropdownWrapper
        align="left"
        ariaLabel={copy.aiProfileMenu}
        buttonClassName="ai-sidebar-profile-trigger liquid-glass"
        className="ai-sidebar-profile-dropdown"
        panelClassName="ai-sidebar-profile-menu"
        closeOnTriggerClick={false}
        translationKey="aiProfileMenu"
        trigger={trigger}
        triggerAs="button"
        triggerGlass={false}
      >
        <div className="ai-sidebar-profile-menu-account">
          <AccountAvatar
            account={displayedAccount}
            alt=""
            className="ai-sidebar-profile-menu-avatar"
            fallbackClassName="ai-sidebar-profile-avatar-fallback"
          />
          <div className="ai-sidebar-profile-menu-identity">
            <strong>{accountName}</strong>
            {guest ? null : <span>{account?.email || ""}</span>}
          </div>
        </div>
        <div className="ai-sidebar-profile-menu-actions">
          {!guest &&
          account?.education?.role !== "student" &&
          plan.tier !== "pro"
            ? <button
                className="ai-sidebar-profile-menu-item is-upgrade"
                data-dropdown-close
                onClick={() => openModal("plans")}
                role="menuitem"
                type="button"
              >
                <icon>upgrade</icon>
                <span data-translate="aiProfileUpgradePlan">
                  {copy.aiProfileUpgradePlan}
                </span>
              </button>
            : null}
          <button
            className="ai-sidebar-profile-menu-item"
            data-dropdown-close
            onClick={openHelpCenter}
            role="menuitem"
            type="button"
          >
            <icon>help</icon>
            <span data-translate="aiProfileHelp">{copy.aiProfileHelp}</span>
          </button>
          <button
            className="ai-sidebar-profile-menu-item"
            data-dropdown-close
            onClick={() =>
              openFeedbackModal({
                context: "munetios-ai",
                initialEmail: account?.email || "",
              })
            }
            role="menuitem"
            type="button"
          >
            <icon>feedback</icon>
            <span data-translate="businessFeedbackTitle">
              {copy.businessFeedbackTitle}
            </span>
          </button>
          <button
            className="ai-sidebar-profile-menu-item"
            data-dropdown-close
            onClick={() =>
              openKeyboardShortcutsModal({
                shortcuts,
                title: copy.meetKeyboardShortcuts,
              })
            }
            role="menuitem"
            type="button"
          >
            <icon>keyboard</icon>
            <span data-translate="meetKeyboardShortcuts">
              {copy.meetKeyboardShortcuts}
            </span>
          </button>
          {guest
            ? <button
                className="ai-sidebar-profile-menu-item is-sign-in"
                data-dropdown-close
                onClick={() => window.location.assign("/signin")}
                role="menuitem"
                type="button"
              >
                <icon>login</icon>
                <span data-translate="signIn">{copy.signIn}</span>
              </button>
            : <>
                <button
                  className="ai-sidebar-profile-menu-item"
                  data-dropdown-close
                  onClick={() => openAccountSettingsModal()}
                  role="menuitem"
                  type="button"
                >
                  <icon>manage_accounts</icon>
                  <span data-translate="aiProfileManageAccount">
                    {copy.aiProfileManageAccount}
                  </span>
                </button>
                <button
                  className="ai-sidebar-profile-menu-item"
                  data-dropdown-close
                  onClick={() => openAccountSwitcher({ copy })}
                  role="menuitem"
                  type="button"
                >
                  <icon>switch_account</icon>
                  <span data-translate="switchAccount">
                    {copy.switchAccount}
                  </span>
                </button>
                <button
                  className="ai-sidebar-profile-menu-item is-danger"
                  data-dropdown-close
                  onClick={() => confirmBrowserSignOut({ copy })}
                  role="menuitem"
                  type="button"
                >
                  <icon>logout</icon>
                  <span data-translate="aiProfileSignOut">
                    {copy.aiProfileSignOut}
                  </span>
                </button>
              </>}
        </div>
      </DropdownWrapper>
      {modalStack.map((modal, index) =>
        modal.type === "checkout"
          ? <CheckoutModal
              close={() => closeModal(modal.id)}
              copy={copy}
              currency={currency}
              key={modal.id}
              planId={modal.planId}
              stackIndex={index}
            />
          : <PlanChooserModal
              close={() => closeModal(modal.id)}
              copy={copy}
              currency={currency}
              key={modal.id}
              onChoose={(planId) => openModal("checkout", planId)}
              preferences={regionalPreferences}
              stackIndex={index}
            />,
      )}
    </>
  );
}
