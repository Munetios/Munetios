"use client";

import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useRef, useState } from "react";
import {
  formatPlanPrice,
  getPlan,
  normalizeCurrency,
} from "../apps/ai/lib/pricing";
import { BusinessDropdown } from "../components/signUpForBusiness";
import { showToast } from "../components/toast";
import { t } from "../i18n";
import {
  getUserCurrency,
  loadDateTimePreferences,
} from "../lib/dateTimePreferences";
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
  const [checkoutState, setCheckoutState] = useState("loading");
  const [retryCount, setRetryCount] = useState(0);
  const checkoutContainerRef = useRef(null);
  const checkoutActionsRef = useRef(null);
  const checkoutElementRef = useRef(null);
  const expressCheckoutElementRef = useRef(null);
  const checkoutSessionIdRef = useRef("");
  const expressCheckoutContainerRef = useRef(null);
  const confirmPaymentRef = useRef(null);
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
      ),
  );

  useEffect(() => {
    if (
      !availablePaymentOptions.some((option) => option.value === paymentMethod)
    ) {
      setPaymentMethod("card");
    }
  }, [availablePaymentOptions, paymentMethod]);

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
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
      checkoutElementRef.current?.destroy();
      expressCheckoutElementRef.current?.destroy();
      checkoutElementRef.current = null;
      expressCheckoutElementRef.current = null;
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
          throw new Error(payload.error || "stripe_checkout_failed");
        }

        const stripe = await loadStripe(payload.publishableKey, {
          developerTools: { assistant: { enabled: false } },
        });
        if (!stripe || !active || !checkoutContainerRef.current) return;

        if (!stripe.initCheckoutElementsSdk) {
          throw new Error("stripe_elements_checkout_unavailable");
        }
        const checkout = stripe.initCheckoutElementsSdk({
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
                colorBackground: "#24083f",
                colorDanger: "#fda4af",
                colorPrimary: "#a855f7",
                colorText: "#ffffff",
                colorTextPlaceholder: "rgba(255, 255, 255, 0.45)",
                fontFamily: "Google Sans Flex, Arial, sans-serif",
                spacingUnit: "4px",
              },
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
        if (
          ["apple_pay", "card", "paypal"].includes(paymentMethod) &&
          expressCheckoutContainerRef.current
        ) {
          const expressCheckoutElement = checkout.createExpressCheckoutElement({
            buttonHeight: 48,
            buttonTheme: {
              applePay: "black",
              googlePay: "black",
              paypal: "gold",
            },
            buttonType: {
              applePay: "subscribe",
              googlePay: "subscribe",
              paypal: "paypal",
            },
            layout: { maxColumns: 2, maxRows: 1, overflow: "auto" },
            paymentMethodOrder:
              paymentMethod === "paypal"
                ? ["paypal"]
                : ["apple_pay", "google_pay"],
            paymentMethods: {
              applePay: paymentMethod === "paypal" ? "never" : "auto",
              googlePay: paymentMethod === "card" ? "auto" : "never",
              paypal: paymentMethod === "paypal" ? "auto" : "never",
            },
          });
          expressCheckoutElement.on("confirm", (event) => {
            void confirmPaymentRef.current?.(event);
          });
          expressCheckoutElementRef.current = expressCheckoutElement;
          expressCheckoutElement.mount(expressCheckoutContainerRef.current);
        }
        setCheckoutState("ready");
      } catch (error) {
        if (!active || error?.name === "AbortError") return;
        setCheckoutState("failed");
        showToast({ messageKey: "aiCheckoutPaymentFailed", type: "error" });
      }
    };

    void mountCheckout();
    return () => {
      active = false;
      controller.abort();
      checkoutElementRef.current?.destroy();
      expressCheckoutElementRef.current?.destroy();
      checkoutElementRef.current = null;
      expressCheckoutElementRef.current = null;
      checkoutActionsRef.current = null;
      checkoutSessionIdRef.current = "";
    };
  }, [normalizedCurrency, paymentMethod, plan.id, retryCount, sessionId]);

  const selectPaymentMethod = (method) => setPaymentMethod(method);
  const confirmPayment = async (expressCheckoutConfirmEvent) => {
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
      const result = await actions.confirm({
        redirect: "if_required",
        returnUrl: returnUrl.toString(),
        ...(expressCheckoutConfirmEvent ? { expressCheckoutConfirmEvent } : {}),
      });
      if (result.type === "error") {
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
  confirmPaymentRef.current = confirmPayment;

  return (
    <main className="min-h-dvh bg-transparent p-3 text-white sm:p-5">
      <div className="grid min-h-[calc(100dvh-1.5rem)] gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.72fr)]">
        <section className="min-h-0 rounded-2xl border border-white/10 bg-purple-950/24! p-4 md:p-5">
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
          <div className="relative mt-5 min-h-72 overflow-hidden rounded-2xl border border-white/10 bg-purple-950/35! p-4 sm:p-5">
            {checkoutState === "loading"
              ? <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-purple-950/95! text-white">
                  <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/25 border-t-purple-300" />
                  <span className="text-sm font-semibold">
                    {copy.aiCheckoutLoading}
                  </span>
                </div>
              : null}
            {checkoutState === "failed"
              ? <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-purple-950/95! p-6 text-center text-white">
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
              ? <div className="absolute inset-0 z-10 flex items-center justify-center bg-purple-950/95! p-6 text-center text-lg font-semibold text-white">
                  {copy.demoPaymentThankYou}
                </div>
              : null}
            {["apple_pay", "card", "paypal"].includes(paymentMethod)
              ? <div className="mb-4" ref={expressCheckoutContainerRef} />
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
