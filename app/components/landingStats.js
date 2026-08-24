"use client";

import { useEffect, useState } from "react";

export default function LandingStats({ copy }) {
  const [counts, setCounts] = useState({ signups: 0, visitors: 0 });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/stats", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload) {
          setCounts({
            signups: Math.max(0, Number(payload.signups) || 0),
            visitors: Math.max(0, Number(payload.visitors) || 0),
          });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <dl className="mt-3 grid grid-cols-2 gap-2" aria-live="polite">
      <div className="rounded-xl border border-white/10 bg-white/5! p-3">
        <dt
          className="text-xs text-white/60"
          data-translate="landingSignupsCount"
        >
          {copy.landingSignupsCount}
        </dt>
        <dd className="mt-1 text-2xl font-bold">{counts.signups}</dd>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/5! p-3">
        <dt
          className="text-xs text-white/60"
          data-translate="landingVisitorsCount"
        >
          {copy.landingVisitorsCount}
        </dt>
        <dd className="mt-1 text-2xl font-bold">{counts.visitors}</dd>
      </div>
    </dl>
  );
}
