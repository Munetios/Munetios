"use client";

import { showToast } from "./toast";

export default function UpgradePlans({ archived, close, copy, demo }) {
  const purchase = async (plan) => {
    if (!demo) {
      window.location.assign("/payments");
      return;
    }

    if (archived) {
      showToast({
        message: copy.demoPaymentFailedMessage,
        title: copy.demoPaymentFailedTitle,
        type: "error",
      });
      return;
    }

    try {
      const response = await fetch("/api/demo/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, storagePreset: plan }),
      });

      if (!response.ok) throw new Error("Payment request failed");

      window.dispatchEvent(new Event("munetios:demo-settingschange"));
      close();
      showToast({ message: copy.demoPaymentThankYou, type: "success" });
    } catch {
      showToast({ messageKey: "fetchError", type: "error" });
    }
  };

  return (
    <div className="grid gap-4 p-3 sm:grid-cols-2 sm:p-6">
      {[
        [
          "business-standard",
          copy.demoUpgradeStandard,
          copy.demoUpgradeStandardDescription,
        ],
        ["business-pro", copy.demoUpgradePro, copy.demoUpgradeProDescription],
      ].map(([plan, name, description]) => (
        <section
          className="flex min-h-72 flex-col rounded-3xl border border-white/10 bg-white/5! p-6 shadow-xl shadow-purple-950/20"
          key={plan}
        >
          <h3 className="text-xl font-bold text-white">{name}</h3>
          <p className="mt-3 min-h-16 text-sm leading-6 text-white/70">
            {description}
          </p>
          <button
            className="mt-auto w-full rounded-xl bg-purple-500! px-4 py-3 font-bold text-white"
            onClick={() => purchase(plan)}
            type="button"
          >
            {copy.demoPurchase}
          </button>
        </section>
      ))}
    </div>
  );
}
