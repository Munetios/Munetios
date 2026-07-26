"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { t } from "../i18n";
import DropdownWrapper from "./dropdownwrapper";
import { openFeedbackModal as showFeedbackModal } from "./feedbackModal";
import LanguageSelector from "./languageSelector";
import { showToast } from "./toast";

const businessSignupEndpoint = "/api/signup/business";
const businessCurrencyStorageKey = "munetios.businessCurrency";
const businessDraftStorageKey = "munetios.businessSignupDraft";

const planOptions = [
  { key: "pricingBusinessFreeTitle", value: "business-free" },
  { key: "pricingBusinessProTitle", value: "business-pro" },
];

const companyOptions = [
  { key: "businessCompanyStartup", value: "startup" },
  { key: "businessCompanySmall", value: "small-business" },
  { key: "businessCompanyMedium", value: "medium-business" },
  { key: "businessCompanyEnterprise", value: "enterprise" },
];

const teamOptions = [
  { key: "businessTeam1to5", value: "1-5" },
  { key: "businessTeam6to25", value: "6-25" },
  { key: "businessTeam26to100", value: "26-100" },
  { key: "businessTeam100Plus", value: "100+" },
];

const paymentOptions = [
  { key: "businessPaymentCreditDebitCard", value: "card" },
  { key: "businessPaymentPaypal", value: "paypal" },
];

const currencyOptions = [
  { key: "currencyUsd", value: "USD" },
  { key: "currencyEur", value: "EUR" },
  { key: "currencyGbp", value: "GBP" },
  { key: "currencyCad", value: "CAD" },
  { key: "currencyAud", value: "AUD" },
];

const previewCards = [
  {
    descriptionKey: "businessPreviewWorkspaceDescription",
    icon: "groups",
    titleKey: "businessPreviewWorkspaceTitle",
  },
  {
    descriptionKey: "businessPreviewSecurityDescription",
    icon: "shield_lock",
    titleKey: "businessPreviewSecurityTitle",
  },
  {
    descriptionKey: "businessPreviewAppsDescription",
    icon: "apps",
    titleKey: "businessPreviewAppsTitle",
  },
  {
    descriptionKey: "businessPreviewBillingDescription",
    icon: "payments",
    titleKey: "businessPreviewBillingTitle",
  },
];

function normalizePlan(plan) {
  return plan === "business-pro" ? "business-pro" : "business-free";
}

function normalizeCurrency(currency) {
  const normalizedCurrency = String(currency || "").toUpperCase();
  return currencyOptions.some((option) => option.value === normalizedCurrency)
    ? normalizedCurrency
    : "USD";
}

function getPlanLabelKey(plan) {
  return plan === "business-pro"
    ? "pricingBusinessProTitle"
    : "pricingBusinessFreeTitle";
}

function useTranslatedCopy(providedCopy) {
  const [copy, setCopy] = useState(providedCopy || t("en"));

  useEffect(() => {
    const updateCopy = () => {
      setCopy(t());
    };

    updateCopy();
    window.addEventListener("languagechange", updateCopy);
    window.addEventListener("munetios:languagechange", updateCopy);
    window.addEventListener("munetios:localechange", updateCopy);

    return () => {
      window.removeEventListener("languagechange", updateCopy);
      window.removeEventListener("munetios:languagechange", updateCopy);
      window.removeEventListener("munetios:localechange", updateCopy);
    };
  }, []);

  return copy;
}

export function BusinessDropdown({
  copy,
  labelKey,
  onChange,
  options,
  value,
  zIndex,
}) {
  const selectedOption = options.find((option) => option.value === value);
  const selectedKey = selectedOption?.key || labelKey;

  return (
    <div>
      <div className="mb-2 block text-sm font-semibold text-white/80">
        <span data-translate={labelKey}>{copy[labelKey]}</span>
      </div>
      <DropdownWrapper
        align="left"
        ariaLabel={copy[labelKey]}
        buttonClassName="h-11 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left hover:border-purple-200/35 hover:bg-white/15!"
        className="w-full"
        panelClassName="w-[min(22rem,calc(100vw-1rem))]"
        trigger={
          <>
            <span className="min-w-0 truncate" data-translate={selectedKey}>
              {copy[selectedKey]}
            </span>
            <icon>expand_more</icon>
          </>
        }
        zIndex={zIndex}
      >
        <div className="space-y-1">
          {options.map((option) => (
            <button
              className="flex w-full items-center justify-between rounded-lg border border-transparent bg-transparent px-3 py-2 text-left text-sm text-white transition hover:border-white/10 hover:bg-white/10!"
              data-translate={option.key}
              key={option.value}
              onClick={() => onChange(option.value)}
              role="menuitem"
              type="button"
            >
              <span className="min-w-0 flex-1">{copy[option.key]}</span>
              <span
                aria-hidden="true"
                className={`ml-2 shrink-0 transition ${option.value === value ? "text-purple-200" : "invisible opacity-0"}`}
              >
                <icon>check</icon>
              </span>
            </button>
          ))}
        </div>
      </DropdownWrapper>
    </div>
  );
}

function CurrencySelector({ copy, onChange, value }) {
  const selectedOption =
    currencyOptions.find((option) => option.value === value) ||
    currencyOptions[0];

  return (
    <DropdownWrapper
      align="right"
      ariaLabel={copy.businessCurrency}
      buttonClassName="h-11 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left hover:border-purple-200/35 hover:bg-white/15!"
      className="w-full sm:w-52"
      panelClassName="w-[min(20rem,calc(100vw-1rem))]"
      trigger={
        <>
          <span className="inline-flex min-w-0 flex-1 items-center gap-2">
            <icon>payments</icon>
            <span className="truncate" data-translate="businessCurrency">
              {copy.businessCurrency}
            </span>
          </span>
          <span className="shrink-0 text-white/60">{selectedOption.value}</span>
          <icon>expand_more</icon>
        </>
      }
    >
      <div className="space-y-1">
        {currencyOptions.map((option) => (
          <button
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent bg-transparent px-3 py-2 text-left text-sm text-white transition hover:border-white/10 hover:bg-white/10!"
            key={option.value}
            onClick={() => onChange(option.value)}
            role="menuitem"
            type="button"
          >
            <span
              className="min-w-0 flex-1 truncate"
              data-translate={option.key}
            >
              {copy[option.key]}
            </span>
            <span className="shrink-0 text-xs font-semibold text-white/45">
              {option.value}
            </span>
            <span
              aria-hidden="true"
              className={`shrink-0 transition ${option.value === value ? "text-purple-200" : "invisible opacity-0"}`}
            >
              <icon>check</icon>
            </span>
          </button>
        ))}
      </div>
    </DropdownWrapper>
  );
}

export function BusinessPaymentBrandLogo({ label, method }) {
  const asset =
    method === "paypal"
      ? {
          className: "business-payment-brand-image",
          height: 32,
          src: "/paypal.svg",
          width: 112,
        }
      : {
          className:
            "business-payment-brand-image business-payment-brand-image--cashapp",
          height: 28,
          src: "/cashapp.svg",
          width: 28,
        };

  return (
    <span className="inline-flex min-h-9 items-center justify-center">
      <Image
        alt=""
        aria-hidden="true"
        className={asset.className}
        height={asset.height}
        src={asset.src}
        unoptimized
        width={asset.width}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function BusinessPaymentLoadingSpinner() {
  return (
    <span aria-hidden="true" className="business-payment-spinner">
      <svg aria-hidden="true" focusable="false" viewBox="0 0 50 50">
        <circle
          className="business-payment-spinner-circle"
          cx="25"
          cy="25"
          fill="none"
          r="20"
          strokeWidth="5"
        />
      </svg>
    </span>
  );
}

export function BusinessProviderPaymentButton({
  ariaLabel,
  loading,
  method,
  onClick,
}) {
  const label =
    ariaLabel ||
    (method === "paypal" ? "Pay with PayPal" : "Pay with Cash App");

  return (
    <button
      aria-busy={loading}
      aria-label={label}
      className={`liquid-glass flex h-14 min-h-14 w-full items-center justify-center gap-3 rounded-xl border px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-80 ${
        method === "paypal"
          ? "border-orange-100/45 bg-orange-400/80! hover:bg-yellow-400/80!"
          : "border-emerald-100/45 bg-[#00d632]/80! hover:bg-emerald-400/80!"
      }`}
      disabled={loading}
      onClick={onClick}
      type="button"
    >
      <BusinessPaymentBrandLogo label={label} method={method} />
      {loading ? <BusinessPaymentLoadingSpinner /> : null}
    </button>
  );
}

export function BusinessCheckoutButton({
  children,
  disabled = false,
  onClick,
  type = "button",
}) {
  return (
    <button
      className="liquid-glass mt-4 w-full rounded-xl border border-purple-200/25 bg-white/10! px-3 py-3 text-sm font-bold text-white transition hover:border-purple-100/40 hover:bg-purple-500/18! disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export default function SignUpForBusiness({
  copy: providedCopy,
  initialPlan = "business-free",
}) {
  const copy = useTranslatedCopy(providedCopy);
  const [form, setForm] = useState({
    businessName: "",
    businessWebsite: "",
    company: "startup",
    email: "",
    paymentMethod: "card",
    plan: normalizePlan(initialPlan),
    team: "1-5",
  });
  const [submitting, setSubmitting] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState("USD");
  const isBusinessPro = form.plan === "business-pro";
  const selectedPlanKey = getPlanLabelKey(form.plan);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedCurrency = normalizeCurrency(
      window.localStorage.getItem(businessCurrencyStorageKey),
    );
    setSelectedCurrency(savedCurrency);

    try {
      const draft = JSON.parse(
        window.sessionStorage.getItem(businessDraftStorageKey) || "null",
      );
      if (draft && typeof draft === "object") {
        setForm((currentForm) => ({
          ...currentForm,
          ...draft,
          paymentMethod: draft.paymentMethod === "paypal" ? "paypal" : "card",
          plan: normalizePlan(draft.plan || currentForm.plan),
        }));
      }
    } catch {
      window.sessionStorage.removeItem(businessDraftStorageKey);
    }
  }, []);

  const updateForm = (key, value) => {
    setForm((currentForm) => ({ ...currentForm, [key]: value }));
  };

  const saveCurrency = (currency) => {
    const normalizedCurrency = normalizeCurrency(currency);
    setSelectedCurrency(normalizedCurrency);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        businessCurrencyStorageKey,
        normalizedCurrency,
      );
    }
  };

  const hasBusinessDetails = () =>
    form.businessName.trim() && form.company && form.team && form.email.trim();

  const buildPayload = () => ({
    businessName: form.businessName.trim(),
    businessWebsite: form.businessWebsite.trim(),
    company: form.company,
    currency: selectedCurrency,
    email: form.email.trim(),
    paymentMethod: form.paymentMethod,
    plan: form.plan,
    team: form.team,
  });

  const openFeedbackModal = () => {
    showFeedbackModal({
      context: "business-signup",
      initialEmail: form.email,
    });
  };

  const submitBusinessSignup = async (event) => {
    event.preventDefault();

    if (!hasBusinessDetails()) {
      showToast({ messageKey: "businessSignupFillDetails", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(businessSignupEndpoint, {
        body: JSON.stringify(buildPayload()),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        window.sessionStorage.setItem(
          businessDraftStorageKey,
          JSON.stringify(form),
        );
        const returnTo = `${window.location.pathname}${window.location.search}`;
        window.location.assign(
          `/signin?returnTo=${encodeURIComponent(returnTo)}`,
        );
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error || "business_signup_failed");
      }

      window.sessionStorage.removeItem(businessDraftStorageKey);
      showToast({ messageKey: "businessSignupSaved", type: "success" });
      window.dispatchEvent(new Event("munetios:authchange"));
      window.location.assign(
        payload.checkoutUrl || payload.redirectUrl || "/account/settings",
      );
    } catch {
      showToast({ messageKey: "businessSignupFailed", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      aria-label={copy.businessSignupTitle}
      className="munetios-app-render min-h-dvh w-full overflow-x-hidden px-3 pb-5 pt-24 text-white md:px-5"
      data-endpoint="signup/business"
      data-munetios-app-render="true"
      style={{ background: "var(--app-background)" }}
    >
      <header className="fixed left-0 top-0 z-[1200] flex w-full items-center justify-between gap-2 bg-transparent p-2 md:p-4">
        <div className="liquid-glass flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 bg-purple-950/35! px-4 shadow-xl shadow-purple-950/20">
          <icon>business_center</icon>
          <h1
            className="text-sm font-bold leading-5 sm:text-base"
            data-translate="businessSignupTopbarTitle"
          >
            {copy.businessSignupTopbarTitle}
          </h1>
        </div>
        <button
          className="liquid-glass flex min-h-14 items-center gap-2 rounded-2xl border border-white/10 bg-purple-950/35! px-4 text-sm font-bold text-white shadow-xl shadow-purple-950/20 transition hover:border-purple-200/30 hover:bg-purple-700/45!"
          data-translate-aria-label="businessFeedback"
          onClick={openFeedbackModal}
          type="button"
        >
          <icon>feedback</icon>
          <span className="hidden md:block!" data-translate="businessFeedback">
            {copy.businessFeedback}
          </span>
        </button>
      </header>

      <section className="grid min-h-[calc(100dvh-7rem)] w-full gap-4 lg:grid-cols-[0.92fr_1.08fr]">
        <aside className="liquid-glass hidden min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-purple-950/24! p-4 shadow-2xl shadow-purple-950/25 md:p-5 lg:flex!">
          <div className="flex flex-col gap-4  lg:justify-between">
            <div>
              <p
                className="text-sm font-semibold uppercase tracking-[0.16em] text-purple-200"
                data-translate="businessSignupPreviewKicker"
              >
                {copy.businessSignupPreviewKicker}
              </p>
              <h2
                className="mt-2 text-2xl font-bold leading-tight md:text-3xl"
                data-translate="businessSignupPreviewTitle"
              >
                {copy.businessSignupPreviewTitle}
              </h2>
              <p
                className="mt-3 max-w-2xl text-sm leading-6 text-white/72"
                data-translate="businessSignupPreviewSubtitle"
              >
                {copy.businessSignupPreviewSubtitle}
              </p>
            </div>
            <div className="rounded-2xl border border-purple-200/20 bg-purple-500/18! px-4 py-3">
              <p
                className="text-xs font-semibold uppercase tracking-[0.14em] text-purple-100/80"
                data-translate="businessSignupSelectedPlan"
              >
                {copy.businessSignupSelectedPlan}
              </p>
              <p
                className="mt-1 text-lg font-bold"
                data-translate={selectedPlanKey}
              >
                {copy[selectedPlanKey]}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {previewCards.map((previewCard) => (
              <div
                className="rounded-2xl border border-white/10 bg-white/5! p-4"
                key={previewCard.titleKey}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-purple-200/20 bg-purple-500/18! text-purple-100">
                  <icon>{previewCard.icon}</icon>
                </div>
                <h3 className="font-bold" data-translate={previewCard.titleKey}>
                  {copy[previewCard.titleKey]}
                </h3>
                <p
                  className="mt-2 text-sm leading-6 text-white/68"
                  data-translate={previewCard.descriptionKey}
                >
                  {copy[previewCard.descriptionKey]}
                </p>
              </div>
            ))}
          </div>
        </aside>

        <form
          className="liquid-glass min-h-[34rem] w-full overflow-hidden rounded-2xl border border-white/10 bg-purple-950/24! p-4 text-white shadow-2xl shadow-purple-950/25 md:p-5"
          onSubmit={submitBusinessSignup}
        >
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2
                className="mt-2 text-2xl font-bold leading-tight"
                data-translate="businessSignupDetailsTitle"
              >
                {copy.businessSignupDetailsTitle}
              </h2>
            </div>
            <div className="w-full sm:w-60">
              <BusinessDropdown
                copy={copy}
                labelKey="businessSignupPlan"
                onChange={(value) => {
                  updateForm("plan", value);
                }}
                options={planOptions}
                value={form.plan}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm font-semibold text-white/80">
              <span data-translate="businessSignupBusinessName">
                {copy.businessSignupBusinessName}
              </span>
              <input
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/10! px-3 text-white outline-none transition placeholder:text-white/40 focus:border-purple-300/60"
                onChange={(event) =>
                  updateForm("businessName", event.target.value)
                }
                required
                type="text"
                value={form.businessName}
              />
            </label>
            <label className="block text-sm font-semibold text-white/80">
              <span data-translate="businessSignupBusinessWebsite">
                {copy.businessSignupBusinessWebsite}
              </span>
              <input
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/10! px-3 text-white outline-none transition placeholder:text-white/40 focus:border-purple-300/60"
                data-translate-placeholder="businessSignupOptional"
                onChange={(event) =>
                  updateForm("businessWebsite", event.target.value)
                }
                placeholder={copy.businessSignupOptional}
                type="url"
                value={form.businessWebsite}
              />
            </label>
            <BusinessDropdown
              copy={copy}
              labelKey="businessSignupCompany"
              onChange={(value) => updateForm("company", value)}
              options={companyOptions}
              value={form.company}
            />
            <BusinessDropdown
              copy={copy}
              labelKey="businessSignupTeam"
              onChange={(value) => updateForm("team", value)}
              options={teamOptions}
              value={form.team}
            />
            <label className="block text-sm font-semibold text-white/80 md:col-span-2">
              <span data-translate="businessSignupEmail">
                {copy.businessSignupEmail}
              </span>
              <input
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/10! px-3 text-white outline-none transition placeholder:text-white/40 focus:border-purple-300/60"
                onChange={(event) => updateForm("email", event.target.value)}
                required
                type="email"
                value={form.email}
              />
            </label>
          </div>

          {isBusinessPro
            ? <section className="mt-5 rounded-2xl border border-white/10 bg-white/5! p-4">
                <h3
                  className="text-lg font-bold"
                  data-translate="businessPaymentsTitle"
                >
                  {copy.businessPaymentsTitle}
                </h3>
                <p
                  className="mt-2 text-sm leading-6 text-white/65"
                  data-translate="businessStripeInfo"
                >
                  {copy.businessStripeInfo}
                </p>
                <div className="mt-4">
                  <BusinessDropdown
                    copy={copy}
                    labelKey="businessPaymentMethod"
                    onChange={(value) => updateForm("paymentMethod", value)}
                    options={paymentOptions}
                    value={form.paymentMethod}
                  />
                </div>
              </section>
            : null}

          <button
            className="liquid-glass mt-5 w-full rounded-xl border border-purple-200/25 bg-white/10! px-4 py-3 text-sm font-bold text-white transition hover:border-purple-100/40 hover:bg-purple-500/18! disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            <span
              data-translate={
                submitting
                  ? "businessSignupSubmitting"
                  : isBusinessPro
                    ? "businessCheckout"
                    : "businessSignupSubmit"
              }
            >
              {submitting
                ? copy.businessSignupSubmitting
                : isBusinessPro
                  ? copy.businessCheckout
                  : copy.businessSignupSubmit}
            </span>
          </button>
        </form>
      </section>

      <footer className="liquid-glass mt-4 w-full rounded-2xl border border-white/10 bg-purple-950/24! p-3 shadow-xl shadow-purple-950/20">
        <nav
          aria-label={copy.businessSignupFooterLabel}
          className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <Link
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10! px-3 text-sm font-bold text-white transition hover:border-purple-200/35 hover:bg-purple-500/18!"
            href="/"
          >
            <icon>home</icon>
            <span data-translate="businessSignupLanding">
              {copy.businessSignupLanding}
            </span>
          </Link>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <LanguageSelector
              align="right"
              buttonClassName="h-11 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left hover:border-purple-200/35 hover:bg-white/15!"
              className="w-full sm:w-64"
              copy={copy}
              panelClassName="max-h-80 w-[min(22rem,calc(100vw-1rem))] overflow-y-auto"
            />
            <CurrencySelector
              copy={copy}
              onChange={saveCurrency}
              value={selectedCurrency}
            />
          </div>
        </nav>
      </footer>
    </main>
  );
}
