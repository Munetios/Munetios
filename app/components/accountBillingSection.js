"use client";

import { loadStripe } from "@stripe/stripe-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUserDate, formatUserNumber } from "../lib/dateTimePreferences";
import DropdownWrapper from "./dropdownwrapper";
import LoadingSpinner from "./loadingSpinner";
import { showModal } from "./modal";
import { showToast } from "./toast";

function formatMoney(amount, currency) {
  if (!Number.isFinite(amount) || !currency) return "—";
  try {
    return formatUserNumber(amount / 100, {
      formatOptions: {
        currency: currency.toUpperCase(),
        style: "currency",
      },
    });
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(timestamp) {
  const preferredDate = timestamp
    ? formatUserDate(new Date(timestamp * 1000))
    : "";
  if (preferredDate) return preferredDate;
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(timestamp * 1000));
}

function getStatusLabel(status, copy) {
  const key = {
    active: "billingStatusActive",
    canceled: "billingStatusCanceled",
    draft: "billingStatusDraft",
    incomplete: "billingStatusIncomplete",
    open: "billingStatusOpen",
    paid: "billingStatusPaid",
    past_due: "billingStatusPastDue",
    trialing: "billingStatusTrialing",
    uncollectible: "billingStatusUncollectible",
    unpaid: "billingStatusUnpaid",
    void: "billingStatusVoid",
  }[status];
  return copy[key] || status || "—";
}

async function billingAction(payload) {
  const response = await fetch("/api/billing", {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(responsePayload.error || "billing_action_failed");
  }
  return responsePayload;
}

function BillingConfirmation({ close, copy, description, onConfirm, title }) {
  const [working, setWorking] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-white/70">{description}</p>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/10!"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="liquid-glass rounded-xl bg-rose-600/70! px-4 py-2 text-sm font-bold disabled:opacity-55"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            const succeeded = await onConfirm();
            if (succeeded) close();
            else setWorking(false);
          }}
          type="button"
        >
          {working ? copy.billingUpdating : title}
        </button>
      </div>
    </div>
  );
}

function PaymentMethodEditor({ close, copy, onChanged, paymentMethods }) {
  const [consent, setConsent] = useState(false);
  const [elements, setElements] = useState(null);
  const [loading, setLoading] = useState(true);
  const [methods, setMethods] = useState(paymentMethods);
  const [removingId, setRemovingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [stripe, setStripe] = useState(null);
  const paymentElementContainerRef = useRef(null);

  useEffect(() => {
    let active = true;
    let paymentElement;

    const mountPaymentEditor = async () => {
      try {
        const setup = await billingAction({ action: "setup_payment_method" });
        const stripeInstance = await loadStripe(setup.publishableKey, {
          developerTools: { assistant: { enabled: false } },
        });
        if (!stripeInstance || !active) return;
        const elementsInstance = stripeInstance.elements({
          appearance: {
            theme: "night",
            variables: {
              borderRadius: "12px",
              colorBackground: "#24083f",
              colorDanger: "#fda4af",
              colorPrimary: "#a855f7",
              colorText: "#ffffff",
              colorTextPlaceholder: "rgba(255, 255, 255, 0.45)",
              fontFamily: "Google Sans Flex, Arial, sans-serif",
            },
          },
          clientSecret: setup.clientSecret,
        });
        paymentElement = elementsInstance.create("payment", {
          layout: { type: "tabs" },
        });
        if (!paymentElementContainerRef.current) return;
        paymentElement.mount(paymentElementContainerRef.current);
        setElements(elementsInstance);
        setStripe(stripeInstance);
      } catch {
        showToast({
          messageKey: "billingPaymentMethodSaveFailed",
          type: "error",
        });
      } finally {
        if (active) setLoading(false);
      }
    };

    void mountPaymentEditor();
    return () => {
      active = false;
      paymentElement?.destroy();
    };
  }, []);

  const savePaymentMethod = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || !consent) return;
    setSaving(true);
    try {
      const result = await stripe.confirmSetup({
        confirmParams: {
          return_url: `${window.location.origin}/account/settings/billing`,
        },
        elements,
        redirect: "if_required",
      });
      if (result.error) throw result.error;
      showToast({
        messageKey: "billingPaymentMethodSaved",
        type: "success",
      });
      await onChanged();
      close();
    } catch {
      showToast({
        messageKey: "billingPaymentMethodSaveFailed",
        type: "error",
      });
      setSaving(false);
    }
  };

  const removePaymentMethod = async (paymentMethodId) => {
    setRemovingId(paymentMethodId);
    try {
      await billingAction({
        action: "detach_payment_method",
        paymentMethodId,
      });
      showToast({
        messageKey: "billingPaymentMethodRemoved",
        type: "success",
      });
      setMethods((current) =>
        current.filter((method) => method.id !== paymentMethodId),
      );
      await onChanged();
    } catch {
      showToast({
        messageKey: "billingPaymentMethodRemoveFailed",
        type: "error",
      });
    } finally {
      setRemovingId("");
    }
  };

  return (
    <form className="space-y-5" onSubmit={savePaymentMethod}>
      <p className="text-sm leading-6 text-white/70">
        {copy.billingPaymentMethodModalDescription}
      </p>
      {methods.length > 0
        ? <div className="space-y-2">
            {methods.map((paymentMethod) => (
              <div
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5! p-3"
                key={paymentMethod.id}
              >
                <icon className="text-purple-200">
                  {paymentMethod.type === "paypal"
                    ? "account_balance_wallet"
                    : "credit_card"}
                </icon>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold capitalize">
                    {paymentMethod.type === "paypal"
                      ? `PayPal · ${paymentMethod.email}`
                      : `${paymentMethod.wallet || paymentMethod.brand} ···· ${paymentMethod.last4}`}
                  </p>
                </div>
                <button
                  className="rounded-lg border border-rose-200/20 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-50"
                  disabled={Boolean(removingId)}
                  onClick={() => removePaymentMethod(paymentMethod.id)}
                  type="button"
                >
                  {removingId === paymentMethod.id
                    ? copy.billingRemovingPaymentMethod
                    : copy.billingRemovePaymentMethod}
                </button>
              </div>
            ))}
          </div>
        : null}
      <div className="rounded-2xl border border-white/10 bg-purple-950/35! p-4">
        <h3 className="mb-3 text-sm font-bold">
          {copy.billingAddPaymentMethod}
        </h3>
        {loading
          ? <div className="flex min-h-32 items-center justify-center gap-3 text-sm text-white/65">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-purple-300" />
              {copy.accountBillingLoading}
            </div>
          : null}
        <div ref={paymentElementContainerRef} />
      </div>
      <label className="flex items-start gap-3 text-xs leading-5 text-white/65">
        <input
          checked={consent}
          className="mt-0.5 accent-purple-500"
          onChange={(event) => setConsent(event.target.checked)}
          type="checkbox"
        />
        <span>{copy.billingPaymentMethodConsent}</span>
      </label>
      <button
        className="liquid-glass w-full rounded-xl bg-purple-600/75! px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={loading || saving || !stripe || !elements || !consent}
        type="submit"
      >
        {saving
          ? copy.billingSavingPaymentMethod
          : copy.billingSavePaymentMethod}
      </button>
    </form>
  );
}

function ChangeSubscriptionForm({ close, copy, onChanged, subscriptions }) {
  const manageable = subscriptions.filter((subscription) =>
    ["active", "trialing", "past_due"].includes(subscription.status),
  );
  const [subscriptionId, setSubscriptionId] = useState(manageable[0]?.id || "");
  const selectedSubscription = manageable.find(
    (subscription) => subscription.id === subscriptionId,
  );
  const [planId, setPlanId] = useState(() =>
    String(manageable[0]?.name || "")
      .toLowerCase()
      .includes("pro lite")
      ? "pro"
      : "pro-lite",
  );
  const [saving, setSaving] = useState(false);
  const plans = [
    { id: "pro-lite", label: copy.aiPricingProLite },
    { id: "pro", label: copy.aiPricingPro },
  ];
  const selectedPlan = plans.find((plan) => plan.id === planId);

  return (
    <form
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!subscriptionId || !planId || saving) return;
        setSaving(true);
        try {
          await billingAction({
            action: "change_subscription",
            planId,
            subscriptionId,
          });
          await onChanged();
          showToast({
            messageKey: "billingSubscriptionChanged",
            type: "success",
          });
          close();
        } catch {
          showToast({
            messageKey: "billingSubscriptionUpdateFailed",
            type: "error",
          });
          setSaving(false);
        }
      }}
    >
      <p className="text-sm leading-6 text-white/65">
        {copy.billingChangeSubscriptionDescription}
      </p>
      <div className="grid gap-2 text-sm font-bold">
        <span>{copy.billingChooseSubscription}</span>
        <DropdownWrapper
          align="left"
          ariaLabel={copy.billingChooseSubscription}
          buttonClassName="liquid-glass flex w-full items-center justify-between rounded-xl border border-white/10 px-4 py-3 text-left"
          panelClassName="w-[min(30rem,calc(100vw-2rem))]"
          trigger={
            <>
              <span>
                {selectedSubscription?.name || copy.billingNoSubscriptions}
              </span>
              <icon>expand_more</icon>
            </>
          }
        >
          {manageable.map((subscription) => (
            <button
              className="flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-white hover:bg-white/10!"
              data-dropdown-close
              key={subscription.id}
              onClick={() => setSubscriptionId(subscription.id)}
              role="menuitem"
              type="button"
            >
              <icon>
                {subscription.id === subscriptionId
                  ? "radio_button_checked"
                  : "radio_button_unchecked"}
              </icon>
              <span>{subscription.name}</span>
            </button>
          ))}
        </DropdownWrapper>
      </div>
      <div className="grid gap-2 text-sm font-bold">
        <span>{copy.billingChooseNewPlan}</span>
        <DropdownWrapper
          align="left"
          ariaLabel={copy.billingChooseNewPlan}
          buttonClassName="liquid-glass flex w-full items-center justify-between rounded-xl border border-white/10 px-4 py-3 text-left"
          panelClassName="w-[min(30rem,calc(100vw-2rem))]"
          trigger={
            <>
              <span>{selectedPlan?.label}</span>
              <icon>expand_more</icon>
            </>
          }
        >
          {plans.map((plan) => (
            <button
              className="flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-white hover:bg-white/10!"
              data-dropdown-close
              key={plan.id}
              onClick={() => setPlanId(plan.id)}
              role="menuitem"
              type="button"
            >
              <icon>
                {plan.id === planId
                  ? "radio_button_checked"
                  : "radio_button_unchecked"}
              </icon>
              <span>{plan.label}</span>
            </button>
          ))}
        </DropdownWrapper>
      </div>
      <button
        className="liquid-glass w-full rounded-xl bg-[var(--accent)]! px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
        disabled={saving || !subscriptionId}
        type="submit"
      >
        {saving
          ? <LoadingSpinner label={copy.accountProcessing} />
          : copy.billingChangeSubscription}
      </button>
    </form>
  );
}

export default function AccountBillingSection({ copy }) {
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openingAction, setOpeningAction] = useState("");

  const loadBilling = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/billing", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("billing_load_failed");
      setBilling(await response.json());
    } catch {
      // The shared API watcher presents the translated subscription failure toast.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const openPortal = async (action = "portal") => {
    setOpeningAction(action);
    try {
      const payload = await billingAction({ action });
      if (!payload.url) throw new Error("billing_portal_failed");
      window.location.assign(payload.url);
    } catch {
      showToast({ messageKey: "billingPortalFailed", type: "error" });
      setOpeningAction("");
    }
  };

  const updateSubscription = async (subscription, action) => {
    try {
      await billingAction({
        action,
        subscriptionId: subscription.id,
      });
      showToast({
        messageKey:
          action === "cancel_subscription"
            ? "billingCancellationScheduled"
            : "billingSubscriptionResumed",
        type: "success",
      });
      await loadBilling();
      return true;
    } catch {
      showToast({
        messageKey: "billingSubscriptionUpdateFailed",
        type: "error",
      });
      return false;
    }
  };

  const confirmCancellation = (subscription) => {
    showModal(
      ({ close }) => (
        <BillingConfirmation
          close={close}
          copy={copy}
          description={copy.billingCancelConfirm.replace(
            "{date}",
            formatDate(subscription.currentPeriodEnd),
          )}
          onConfirm={() =>
            updateSubscription(subscription, "cancel_subscription")
          }
          title={copy.billingCancelSubscription}
        />
      ),
      {
        ariaLabel: copy.billingCancelSubscription,
        title: copy.billingCancelSubscription,
      },
    );
  };

  const openPaymentMethodEditor = () => {
    showModal(
      ({ close }) => (
        <PaymentMethodEditor
          close={close}
          copy={copy}
          onChanged={loadBilling}
          paymentMethods={billing?.paymentMethods || []}
        />
      ),
      {
        ariaLabel: copy.billingEditPaymentMethods,
        title: copy.billingEditPaymentMethods,
        width: "min(42rem, calc(100vw - 1rem))",
      },
    );
  };

  const openSubscriptionChanger = () => {
    showModal(
      ({ close }) => (
        <ChangeSubscriptionForm
          close={close}
          copy={copy}
          onChanged={loadBilling}
          subscriptions={billing?.subscriptions || []}
        />
      ),
      {
        ariaLabel: copy.billingChangeSubscription,
        title: copy.billingChangeSubscription,
        width: "min(38rem, calc(100vw - 1rem))",
      },
    );
  };

  const subscriptions = billing?.subscriptions || [];
  const paymentMethods = billing?.paymentMethods || [];
  const invoices = billing?.invoices || [];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{copy.accountSettingsBilling}</h1>
        <p className="mt-1 text-sm text-white/65">
          {copy.accountSettingsBillingDescription}
        </p>
      </div>

      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-200">
              {copy.billingCurrentPlan}
            </p>
            <p className="mt-2 text-xl font-bold">
              {loading
                ? copy.accountBillingLoading
                : billing?.plan || copy.aiPlanFree}
            </p>
          </div>
          <a
            className="liquid-glass rounded-xl border border-purple-200/20 bg-purple-600/65! px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-purple-500/80!"
            href="/apps/ai/pricing"
          >
            {copy.aiProfileUpgradePlan}
          </a>
        </div>
      </section>

      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{copy.billingSubscriptions}</h2>
            <p className="mt-1 text-sm text-white/60">
              {copy.billingSubscriptionsDescription}
            </p>
          </div>
          <button
            className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/10! disabled:opacity-55"
            disabled={loading}
            onClick={() => loadBilling()}
            type="button"
          >
            {copy.retry}
          </button>
          <button
            className="liquid-glass rounded-xl bg-[var(--accent)]! px-3 py-2 text-sm font-bold text-white disabled:opacity-55"
            disabled={
              loading ||
              !subscriptions.some((subscription) =>
                ["active", "trialing", "past_due"].includes(
                  subscription.status,
                ),
              )
            }
            onClick={openSubscriptionChanger}
            type="button"
          >
            {copy.billingChangeSubscription}
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {subscriptions.map((subscription) => (
            <article
              className="rounded-xl border border-white/10 bg-white/5! p-4"
              key={subscription.id}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold">{subscription.name}</h3>
                    <span className="rounded-full bg-purple-500/20! px-2 py-1 text-xs font-semibold text-purple-100">
                      {getStatusLabel(subscription.status, copy)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-white/70">
                    {formatMoney(subscription.amount, subscription.currency)} /{" "}
                    {copy.billingIntervalMonth}
                  </p>
                  <p className="mt-1 text-xs text-white/50">
                    {subscription.cancelAtPeriodEnd
                      ? copy.billingEndsOn.replace(
                          "{date}",
                          formatDate(subscription.currentPeriodEnd),
                        )
                      : copy.billingRenewsOn.replace(
                          "{date}",
                          formatDate(subscription.currentPeriodEnd),
                        )}
                  </p>
                </div>
                {["active", "trialing", "past_due"].includes(
                  subscription.status,
                )
                  ? subscription.cancelAtPeriodEnd
                    ? <button
                        className="rounded-xl border border-emerald-200/20 bg-emerald-700/25! px-3 py-2 text-sm font-semibold"
                        onClick={() =>
                          updateSubscription(
                            subscription,
                            "resume_subscription",
                          )
                        }
                        type="button"
                      >
                        {copy.billingResumeSubscription}
                      </button>
                    : <button
                        className="rounded-xl border border-rose-200/20 bg-rose-700/25! px-3 py-2 text-sm font-semibold"
                        onClick={() => confirmCancellation(subscription)}
                        type="button"
                      >
                        {copy.billingCancelSubscription}
                      </button>
                  : null}
              </div>
            </article>
          ))}
          {!loading && subscriptions.length === 0
            ? <p className="rounded-xl border border-white/10 bg-white/5! p-4 text-sm text-white/60">
                {copy.billingNoSubscriptions}
              </p>
            : null}
        </div>
      </section>

      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{copy.billingPaymentMethods}</h2>
            <p className="mt-1 text-sm text-white/60">
              {copy.billingPaymentMethodsDescription}
            </p>
          </div>
          <button
            className="liquid-glass rounded-xl bg-purple-700/55! px-3 py-2 text-sm font-bold disabled:opacity-55"
            disabled={loading}
            onClick={openPaymentMethodEditor}
            type="button"
          >
            {copy.billingEditPaymentMethods}
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {paymentMethods.map((paymentMethod) => (
            <article
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5! p-4"
              key={paymentMethod.id}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20!">
                <icon>
                  {paymentMethod.type === "paypal"
                    ? "account_balance_wallet"
                    : "credit_card"}
                </icon>
              </div>
              <div>
                <p className="font-semibold capitalize">
                  {paymentMethod.type === "paypal"
                    ? `PayPal · ${paymentMethod.email}`
                    : `${paymentMethod.wallet || paymentMethod.brand} ···· ${paymentMethod.last4}`}
                </p>
                {paymentMethod.type === "card"
                  ? <p className="text-xs text-white/50">
                      {copy.billingExpires} {paymentMethod.expMonth}/
                      {paymentMethod.expYear}
                    </p>
                  : null}
              </div>
            </article>
          ))}
          {!loading && paymentMethods.length === 0
            ? <p className="text-sm text-white/60">
                {copy.billingNoPaymentMethods}
              </p>
            : null}
        </div>
      </section>

      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <h2 className="text-lg font-bold">{copy.billingInvoices}</h2>
        <p className="mt-1 text-sm text-white/60">
          {copy.billingInvoicesDescription}
        </p>
        <div className="mt-4 space-y-2">
          {invoices.map((invoice) => (
            <article
              className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5! p-3 sm:flex-row sm:items-center"
              key={invoice.id}
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {invoice.number || copy.billingInvoice} ·{" "}
                  {formatMoney(invoice.amount, invoice.currency)}
                </p>
                <p className="text-xs text-white/50">
                  {formatDate(invoice.created)} ·{" "}
                  {getStatusLabel(invoice.status, copy)}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/10!"
                  href={`/account/invoices/${encodeURIComponent(invoice.id)}`}
                >
                  {copy.billingViewInvoice}
                </a>
                <a
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/10!"
                  href={`/account/invoices/${encodeURIComponent(invoice.id)}?print=1`}
                >
                  {copy.billingDownloadInvoice}
                </a>
              </div>
            </article>
          ))}
          {!loading && invoices.length === 0
            ? <p className="text-sm text-white/60">{copy.billingNoInvoices}</p>
            : null}
        </div>
      </section>

      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <h2 className="text-lg font-bold">{copy.billingManageTitle}</h2>
        <p className="mt-2 text-sm leading-6 text-white/65">
          {copy.billingManageDescription}
        </p>
        <button
          className="liquid-glass mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-purple-700/55! px-4 py-2.5 text-sm font-bold transition hover:bg-purple-600/70! disabled:opacity-55"
          disabled={loading || Boolean(openingAction)}
          onClick={() => openPortal("portal")}
          type="button"
        >
          <icon>open_in_new</icon>
          {openingAction === "portal"
            ? copy.billingOpeningPortal
            : copy.billingOpenPortal}
        </button>
      </section>
    </div>
  );
}
