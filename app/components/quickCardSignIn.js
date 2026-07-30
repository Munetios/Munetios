"use client";

import { useEffect, useState } from "react";
import { t } from "../i18n";
import LoadingSpinner from "./loadingSpinner";

export default function QuickCardSignIn({ businessId, token }) {
  const copy = t();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(
      `/api/business/quickcard/${encodeURIComponent(businessId)}/${encodeURIComponent(token)}`,
      { credentials: "include", method: "POST" },
    )
      .then((response) => {
        if (!response.ok) throw new Error("quickcard_failed");
        window.location.replace("/apps");
      })
      .catch(() => setFailed(true));
  }, [businessId, token]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--app-background)] p-4 text-[var(--foreground)]">
      <section className="liquid-glass w-full max-w-md rounded-3xl border border-white/10 bg-purple-950/30! p-7 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-500/25!">
          <icon>{failed ? "error" : "qr_code_scanner"}</icon>
        </div>
        <h1 className="mt-5 text-2xl font-bold">
          {failed ? copy.adminQuickCardInvalid : copy.adminQuickCardSigningIn}
        </h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          {failed
            ? copy.adminQuickCardInvalidDescription
            : copy.adminQuickCardSigningInDescription}
        </p>
        {!failed
          ? <div className="mt-5 flex justify-center">
              <LoadingSpinner label={copy.accountProcessing} />
            </div>
          : null}
      </section>
    </main>
  );
}
