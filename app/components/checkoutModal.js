"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import LoadingSpinner from "./loadingSpinner";

export default function CheckoutModal({
  close,
  copy,
  currency,
  planId,
  stackIndex = 0,
  title,
}) {
  const [loading, setLoading] = useState(true);
  const checkoutUrl = `/checkout?plan=${encodeURIComponent(planId)}&currency=${encodeURIComponent(currency)}`;
  const modalTitle = title || copy.aiProfileUpgradePlan;

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="ai-plan-overlay"
      style={{ zIndex: 2147483000 + stackIndex }}
    >
      <section
        aria-label={modalTitle}
        aria-modal="true"
        className="ai-checkout-modal liquid-glass"
        role="dialog"
      >
        <header className="ai-checkout-modal-header">
          <h2>{modalTitle}</h2>
          <button
            aria-label={copy.close}
            className="ai-checkout-modal-close"
            onClick={close}
            type="button"
          >
            <icon>close</icon>
          </button>
        </header>
        {loading
          ? <div className="ai-checkout-modal-loading">
              <LoadingSpinner label={copy.aiCheckoutLoading} />
              <p>{copy.aiCheckoutLoading}</p>
            </div>
          : null}
        <iframe
          allow="payment *"
          onLoad={() => setLoading(false)}
          src={checkoutUrl}
          title={modalTitle}
        />
      </section>
    </div>,
    document.body,
  );
}
