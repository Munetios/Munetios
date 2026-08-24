"use client";

import { useEffect, useRef, useState } from "react";
import LoadingSpinner from "../components/loadingSpinner";
import { BusinessDropdown } from "../components/signUpForBusiness";
import { showToast } from "../components/toast";
import { getCurrentLocale, t } from "../i18n";
import {
  getUserCurrency,
  loadDateTimePreferences,
} from "../lib/dateTimePreferences";
import { isParentalErrorPayload } from "../lib/parentalControlsClient";
import { formatPlanPrice, getPlan, normalizeCurrency } from "../lib/pricing";
import {
  getAvailablePaymentMethods,
  resolvePreferenceCountry,
} from "../lib/regionPreferences";

const paymentOptions = [
  { key: "businessPaymentCreditDebitCard", value: "card" },
  { key: "businessPaymentApplePay", value: "apple_pay" },
  { key: "businessPaymentPaypal", value: "paypal" },
  { key: "businessPaymentCashApp", value: "cashapp" },
];
const paypalCurrencies = new Set([
  "AUD",
  "CAD",
  "CHF",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "SGD",
  "USD",
]);
const stripeScriptUrl = "https://js.stripe.com/clover/stripe.js";
let stripeConstructorPromise;

function loadCheckoutStripe(publishableKey, options) {
  if (!stripeConstructorPromise) {
    stripeConstructorPromise = new Promise((resolve, reject) => {
      const resolveStripe = () => {
        if (window.Stripe) {
          resolve(window.Stripe);
        } else {
          reject(new Error("stripe_checkout_unavailable"));
        }
      };
      const existingScript = document.querySelector(
        `script[src="${stripeScriptUrl}"]`,
      );
      if (existingScript) {
        if (window.Stripe) {
          resolveStripe();
          return;
        }
        existingScript.addEventListener("load", resolveStripe, { once: true });
        existingScript.addEventListener(
          "error",
          () => reject(new Error("stripe_checkout_unavailable")),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      script.src = stripeScriptUrl;
      script.async = true;
      script.addEventListener("load", resolveStripe, { once: true });
      script.addEventListener(
        "error",
        () => reject(new Error("stripe_checkout_unavailable")),
        { once: true },
      );
      document.head.append(script);
    }).catch((error) => {
      stripeConstructorPromise = undefined;
      throw error;
    });
  }

  return stripeConstructorPromise.then((Stripe) =>
    Stripe(publishableKey, options),
  );
}

function CheckoutSummary({ copy, currency, plan }) {
  return (
    <aside className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-purple-950/24! p-5">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-purple-200">
        {copy.aiCheckoutSummary}
      </p>
      <h2 className="mt-3 text-2xl font-bold text-white">
        {copy[plan.nameKey]}
      </h2>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">
        {formatPlanPrice(plan, currency)}
      </p>
      <ul className="mt-5 space-y-3 text-sm text-white/75">
        {plan.featureKeys.map((featureKey) => (
          <li className="flex gap-2" key={featureKey}>
            <icon className="text-purple-200">check</icon>
            <span data-translate={featureKey}>{copy[featureKey]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto rounded-2xl border border-purple-200/20 bg-purple-500/18! px-4 py-3 text-sm text-purple-50">
        <p className="font-semibold">{copy[plan.nameKey]}</p>
        <p className="mt-1 text-xs text-purple-100/75">
          {copy[plan.descriptionKey]}
        </p>
      </div>
    </aside>
  );
}

export default function CheckoutFrame({
  copy: providedCopy,
  currency,
  initialPaymentMethod = "card",
  planId,
  sessionId,
}) {
  const [copy, setCopy] = useState(providedCopy || t("en"));
  const [accountLocale, setAccountLocale] = useState(getCurrentLocale);
  const [paypalAvailable, setPaypalAvailable] = useState(false);
  const [checkoutState, setCheckoutState] = useState("loading");
  const [retryCount, setRetryCount] = useState(0);
  const checkoutContainerRef = useRef(null);
  const checkoutActionsRef = useRef(null);
  const checkoutElementRef = useRef(null);
  const checkoutSessionIdRef = useRef("");
  const plan = getPlan(planId);
  const [regionalPreferences, setRegionalPreferences] = useState(
    loadDateTimePreferences,
  );
  const normalizedCurrency = normalizeCurrency(
    currency || getUserCurrency(regionalPreferences),
  );
  const availableMethodNames = getAvailablePaymentMethods(
    resolvePreferenceCountry(regionalPreferences),
  );
  const normalizePaymentMethod = (method) => {
    if (!availableMethodNames.includes(method)) return "card";
    if (method === "apple_pay") return "apple_pay";
    if (method === "paypal") return "paypal";
    if (
      method === "cashapp" &&
      normalizedCurrency === "USD" &&
      plan.category !== "business"
    ) {
      return "cashapp";
    }
    return "card";
  };
  const [paymentMethod, setPaymentMethod] = useState(() =>
    normalizePaymentMethod(initialPaymentMethod),
  );
  const availablePaymentOptions = paymentOptions.filter(
    (option) =>
      availableMethodNames.includes(option.value) &&
      !(
        option.value === "cashapp" &&
        (normalizedCurrency !== "USD" || plan.category === "business")
      ) &&
      !(
        option.value === "paypal" &&
        (!paypalAvailable || !paypalCurrencies.has(normalizedCurrency))
      ),
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/checkout?capabilities=1", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then((result) => (result.ok ? result.json() : {}))
      .then((capabilities) => setPaypalAvailable(capabilities.paypal === true))
      .catch((error) => {
        if (error?.name !== "AbortError") setPaypalAvailable(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (
      !availablePaymentOptions.some((option) => option.value === paymentMethod)
    ) {
      setPaymentMethod("card");
    }
  }, [availablePaymentOptions, paymentMethod]);

  useEffect(() => {
    const refreshCopy = () => {
      setCopy(t());
      setAccountLocale(getCurrentLocale());
    };
    const refreshRegion = () =>
      setRegionalPreferences(loadDateTimePreferences());

    refreshCopy();
    window.addEventListener("languagechange", refreshCopy);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener("munetios:language-time-change", refreshRegion);

    return () => {
      window.removeEventListener("languagechange", refreshCopy);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener(
        "munetios:language-time-change",
        refreshRegion,
      );
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const mountCheckout = async () => {
      if (!accountLocale) return;
      checkoutElementRef.current?.destroy();
      checkoutElementRef.current = null;
      checkoutActionsRef.current = null;
      checkoutSessionIdRef.current = "";
      setCheckoutState("loading");

      try {
        if (sessionId) {
          const statusResponse = await fetch(
            `/api/checkout?sessionId=${encodeURIComponent(sessionId)}`,
            {
              cache: "no-store",
              credentials: "include",
              signal: controller.signal,
            },
          );
          const statusPayload = await statusResponse.json().catch(() => ({}));
          if (statusResponse.ok && statusPayload.status === "complete") {
            setCheckoutState("complete");
            window.parent?.postMessage(
              {
                planId: statusPayload.planId || plan.id,
                type: "munetios:checkout-complete",
              },
              window.location.origin,
            );
            return;
          }
        }

        const response = await fetch("/api/checkout", {
          body: JSON.stringify({
            attempt: retryCount,
            currency: normalizedCurrency,
            paymentMethod,
            planId: plan.id,
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (payload.complete) {
          setCheckoutState("complete");
          return;
        }
        if (!response.ok || !payload.clientSecret || !payload.publishableKey) {
          const checkoutError = new Error(
            payload.error || "stripe_checkout_failed",
          );
          checkoutError.parentalMessage = isParentalErrorPayload(payload)
            ? payload.message
            : null;
          throw checkoutError;
        }

        const stripe = await loadCheckoutStripe(payload.publishableKey, {
          developerTools: { assistant: { enabled: false } },
          locale: payload.locale || "en",
        });
        if (!stripe || !active || !checkoutContainerRef.current) return;

        if (!stripe.initCheckout) {
          throw new Error("stripe_elements_checkout_unavailable");
        }
        const checkout = stripe.initCheckout({
          clientSecret: payload.clientSecret,
          elementsOptions: {
            appearance: {
              rules: {
                ".Input": {
                  backgroundColor: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.14)",
                  boxShadow: "none",
                },
                ".Input:focus": {
                  border: "1px solid rgba(196, 181, 253, 0.7)",
                  boxShadow: "0 0 0 1px rgba(139, 92, 246, 0.25)",
                },
              },
              theme: "night",
              variables: {
                borderRadius: "12px",
                colorBackground: "rgba(36, 8, 63, 0.46)",
                colorDanger: "#fda4af",
                colorPrimary: "#a855f7",
                colorText: "#ffffff",
                colorTextPlaceholder: "rgba(255, 255, 255, 0.45)",
                fontFamily: "Google Sans Flex, Arial, sans-serif",
                spacingUnit: "4px",
              },
            },
            savedPaymentMethod: {
              enableRedisplay: "never",
              enableSave: "never",
            },
          },
        });
        const actionsResult = await checkout.loadActions();
        if (actionsResult.type === "error") {
          throw new Error(actionsResult.error.message);
        }
        const paymentElement = checkout.createPaymentElement({
          layout: { type: "tabs" },
          paymentMethodOrder: [
            paymentMethod === "apple_pay" ? "card" : paymentMethod,
          ],
        });
        if (!active || !checkoutContainerRef.current) {
          paymentElement.destroy();
          return;
        }
        checkoutActionsRef.current = actionsResult.actions;
        checkoutElementRef.current = paymentElement;
        checkoutSessionIdRef.current = payload.sessionId;
        paymentElement.mount(checkoutContainerRef.current);
        setCheckoutState("ready");
      } catch (error) {
        if (!active || error?.name === "AbortError") return;
        setCheckoutState("failed");
        if (error?.parentalMessage) {
          showToast({ message: error.parentalMessage, type: "info" });
        } else {
          showToast({ messageKey: "aiCheckoutPaymentFailed", type: "error" });
        }
      }
    };

    void mountCheckout();
    return () => {
      active = false;
      controller.abort();
      checkoutElementRef.current?.destroy();
      checkoutElementRef.current = null;
      checkoutActionsRef.current = null;
      checkoutSessionIdRef.current = "";
    };
  }, [
    accountLocale,
    normalizedCurrency,
    paymentMethod,
    plan.id,
    retryCount,
    sessionId,
  ]);

  const selectPaymentMethod = (method) => setPaymentMethod(method);
  const confirmPayment = async () => {
    const actions = checkoutActionsRef.current;
    const checkoutSessionId = checkoutSessionIdRef.current;
    if (!actions || !checkoutSessionId || checkoutState !== "ready") return;

    setCheckoutState("processing");
    const returnPath = plan.category === "business" ? "/payments" : "/checkout";
    const returnUrl = new URL(returnPath, window.location.origin);
    returnUrl.searchParams.set("plan", plan.id);
    returnUrl.searchParams.set("currency", normalizedCurrency);
    returnUrl.searchParams.set("paymentMethod", paymentMethod);
    returnUrl.searchParams.set("session_id", checkoutSessionId);

    try {
      const validationResult = await actions.validateElements();
      if (validationResult.type === "error") {
        setCheckoutState("ready");
        showToast({
          messageKey: "businessSignupFillDetails",
          type: "warning",
        });
        return;
      }
      const result = await actions.confirm({
        redirect: "if_required",
        returnUrl: returnUrl.toString(),
      });
      if (result.type === "error") {
        if (result.error?.code === "validation_error") {
          setCheckoutState("ready");
          showToast({
            messageKey: "businessSignupFillDetails",
            type: "warning",
          });
          return;
        }
        throw new Error(result.error.message);
      }
      if (result.session.status.type === "complete") {
        setCheckoutState("complete");
        window.parent?.postMessage(
          { planId: plan.id, type: "munetios:checkout-complete" },
          window.location.origin,
        );
        return;
      }
      setCheckoutState("ready");
    } catch {
      setCheckoutState("ready");
      showToast({ messageKey: "aiCheckoutPaymentFailed", type: "error" });
    }
  };
  return (
    <main className="relative min-h-dvh overflow-y-auto bg-transparent p-3 text-white sm:p-4">
      {checkoutState === "loading"
        ? <div className="ai-checkout-status-overlay absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-white">
            <LoadingSpinner label={copy.aiCheckoutLoading} />
            <span className="text-sm font-semibold">
              {copy.aiCheckoutLoading}
            </span>
          </div>
        : null}
      <div className="grid min-h-full gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="min-h-0 rounded-2xl border border-white/10 p-3 md:p-4">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-purple-200">
            {copy[plan.nameKey]}
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            {plan.category === "business"
              ? copy.businessPaymentsTitle
              : copy.aiCheckoutPayment}
          </h1>
          <div className="mt-5">
            <BusinessDropdown
              copy={copy}
              labelKey="businessPaymentMethod"
              onChange={selectPaymentMethod}
              options={availablePaymentOptions}
              value={paymentMethod}
              zIndex={1700}
            />
          </div>
          <div className="relative mt-4 min-h-64 overflow-hidden rounded-2xl border border-white/10 p-3">
            {checkoutState === "failed"
              ? <div className="ai-checkout-status-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
                  <p className="max-w-md text-sm text-white/75">
                    {copy.aiCheckoutFrameFailed}
                  </p>
                  <button
                    className="liquid-glass rounded-xl bg-purple-600/75! px-5 py-2.5 text-sm font-semibold hover:bg-purple-500/85!"
                    onClick={() => setRetryCount((current) => current + 1)}
                    type="button"
                  >
                    {copy.retry}
                  </button>
                </div>
              : null}
            {checkoutState === "complete"
              ? <div className="ai-checkout-status-overlay absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-lg font-semibold text-white">
                  {copy.demoPaymentThankYou}
                </div>
              : null}
            <div
              className="liquid-glass rounded-xl"
              ref={checkoutContainerRef}
            />
          </div>
          <button
            className="liquid-glass mt-4 w-full rounded-xl border border-purple-200/25 bg-purple-600/70! px-4 py-3 text-sm font-bold text-white transition hover:bg-purple-500/80! disabled:cursor-not-allowed disabled:opacity-60"
            disabled={checkoutState !== "ready"}
            onClick={confirmPayment}
            type="button"
          >
            {checkoutState === "processing"
              ? copy.businessPaymentProcessing
              : copy.businessCheckout}
          </button>
          <p className="mt-3 text-center text-xs leading-5 text-white/60">
            {copy.checkoutTermsPrefix}{" "}
            <a className="text-purple-200 underline" href="/terms">
              {copy.footerTerms}
            </a>
            .
          </p>
        </section>
        <CheckoutSummary
          copy={copy}
          currency={normalizedCurrency}
          plan={plan}
        />
      </div>
    </main>
  );
}
