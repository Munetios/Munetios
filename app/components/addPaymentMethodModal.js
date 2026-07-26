"use client";

import { showModal } from "./modal";
import {
  BusinessCheckoutButton,
  BusinessPaymentBrandLogo,
} from "./signUpForBusiness";

export function AddPaymentMethodModal({ copy, method, paymentUrl }) {
  const isPayPal = method === "paypal";
  const providerName = isPayPal ? "PayPal" : "Cash App";
  return (
    <div className="flex flex-col items-center px-2 py-4 text-center text-white">
      <div
        className={`flex h-20 min-w-28 items-center justify-center rounded-2xl border px-4 ${isPayPal ? "border-orange-100/30 bg-orange-400/75!" : "border-emerald-100/30 bg-[#00d632]/75!"}`}
      >
        <BusinessPaymentBrandLogo label={providerName} method={method} />
      </div>
      <h2 className="mt-5 text-2xl font-semibold">
        {isPayPal ? copy.addPayPalToMunetios : copy.addCashAppToMunetios}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-white/70">
        {copy.addPaymentMethodDescription.replace("{provider}", providerName)}
      </p>
      {paymentUrl
        ? <div className="mt-2 w-full max-w-sm">
            <BusinessCheckoutButton
              onClick={() => window.location.assign(paymentUrl)}
            >
              {copy.continueToProvider.replace("{provider}", providerName)}
            </BusinessCheckoutButton>
          </div>
        : null}
    </div>
  );
}

export function openAddPaymentMethodModal({ copy, method, paymentUrl = "" }) {
  const title =
    method === "paypal" ? copy.addPayPalToMunetios : copy.addCashAppToMunetios;
  return showModal(
    <AddPaymentMethodModal
      copy={copy}
      method={method}
      paymentUrl={paymentUrl}
    />,
    { ariaLabel: title, title, width: "min(34rem, calc(100vw - 1rem))" },
  );
}
