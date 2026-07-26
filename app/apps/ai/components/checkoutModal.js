"use client";

import CheckoutFrame from "../../../checkout/checkoutFrame";
import { showModal } from "../../../components/modal";

export function AiCheckoutModal({ copy, currency, planId }) {
  return (
    <div className="relative h-full min-h-[34rem] overflow-hidden rounded-2xl border border-white/10 bg-purple-950/35!">
      <CheckoutFrame copy={copy} currency={currency} planId={planId} />
    </div>
  );
}

export function openAiCheckoutModal({ copy, currency, planId }) {
  return showModal(
    <AiCheckoutModal copy={copy} currency={currency} planId={planId} />,
    {
      ariaLabel: copy.aiCheckoutTitle,
      fullViewport: true,
      height: "100vh",
      style: { maxHeight: "100vh", maxWidth: "100%" },
      title: copy.aiCheckoutTitle,
      width: "100%",
    },
  );
}
