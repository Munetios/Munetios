"use client";

import { useEffect, useState } from "react";
import DropdownWrapper from "../../../components/dropdownwrapper";
import {
  getUserCurrency,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import { currencyOptions, formatPlanPrice, plans } from "../lib/pricing";
import { openAiCheckoutModal } from "./checkoutModal";

export default function PricingOverlay({ close, copy, signedIn = true }) {
  const [currency, setCurrency] = useState(() => getUserCurrency());
  const [currencyIsAutomatic, setCurrencyIsAutomatic] = useState(true);
  const selectedCurrency =
    currencyOptions.find((option) => option.value === currency) ||
    currencyOptions[0];

  useEffect(() => {
    const refreshAutomaticCurrency = () => {
      if (currencyIsAutomatic) {
        setCurrency(getUserCurrency(loadDateTimePreferences()));
      }
    };
    window.addEventListener(
      "munetios:language-time-change",
      refreshAutomaticCurrency,
    );
    return () =>
      window.removeEventListener(
        "munetios:language-time-change",
        refreshAutomaticCurrency,
      );
  }, [currencyIsAutomatic]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-2 py-6 sm:px-6">
        <div className="mb-8 text-center">
          <h3 className="text-3xl font-semibold tracking-[-0.03em] text-white">
            {copy.aiPricingTitle}
          </h3>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <section
              className="liquid-glass relative flex min-h-72 flex-col rounded-3xl border border-white/10 bg-white/5! p-6 shadow-xl shadow-purple-950/20"
              key={plan.nameKey}
            >
              {plan.popular
                ? <div
                    className="absolute! right-5! top-5! z-10! inline-flex! w-auto! shrink-0 rounded-full bg-purple-400/90! px-2.5 py-1 text-xs leading-none font-semibold whitespace-nowrap text-white shadow-sm shadow-purple-950/30"
                    data-testid="ai-pricing-popular-badge"
                  >
                    {copy.aiPricingPopular}
                  </div>
                : null}
              <h4 className="pr-24 text-xl font-semibold text-white">
                {copy[plan.nameKey]}
              </h4>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">
                {formatPlanPrice(plan, currency)}
              </p>
              <p className="mt-3 flex-1 text-sm leading-6 text-white/70">
                {copy[plan.descriptionKey]}
              </p>
              {plan.featureKeys.length > 0
                ? <ul className="mt-4 space-y-2 text-sm text-white/75">
                    {plan.featureKeys.map((featureKey) => (
                      <li className="flex gap-2" key={featureKey}>
                        <icon className="text-purple-200">check</icon>
                        <span data-translate={featureKey}>
                          {copy[featureKey]}
                        </span>
                      </li>
                    ))}
                  </ul>
                : null}
              <button
                className="mt-6 w-full rounded-xl bg-purple-500/80! px-4 py-3 text-sm font-medium text-white transition hover:bg-purple-400/90!"
                onClick={() => {
                  if (plan.category === "business") {
                    window.location.assign(
                      `/business/signup?plan=${encodeURIComponent(plan.id)}`,
                    );
                    return;
                  }
                  if (!signedIn) {
                    window.location.assign(
                      `/checkout?plan=${encodeURIComponent(plan.id)}&currency=${encodeURIComponent(currency)}`,
                    );
                    return;
                  }
                  close();
                  openAiCheckoutModal({ copy, currency, planId: plan.id });
                }}
                type="button"
              >
                {copy[plan.actionKey]}
              </button>
            </section>
          ))}
        </div>
      </div>
      <div className="flex justify-end px-2 pb-2 sm:px-6 sm:pb-6">
        <DropdownWrapper
          ariaLabel={copy.aiPricingCurrency}
          buttonClassName="bg-purple-900/40!"
          label={selectedCurrency.value}
          panelClassName="w-36"
          zIndex={4500}
        >
          <div className="space-y-1">
            {currencyOptions.map((option) => (
              <button
                aria-checked={currency === option.value}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-white transition hover:bg-white/10!"
                data-dropdown-close
                key={option.value}
                onClick={() => {
                  setCurrencyIsAutomatic(false);
                  setCurrency(option.value);
                }}
                role="menuitemradio"
                type="button"
              >
                <span>{copy[option.key]}</span>
                <icon
                  className={
                    currency === option.value
                      ? "text-purple-200"
                      : "invisible opacity-0"
                  }
                >
                  check
                </icon>
              </button>
            ))}
          </div>
        </DropdownWrapper>
      </div>
    </div>
  );
}
