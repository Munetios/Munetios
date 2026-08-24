"use client";

import { useEffect, useState } from "react";
import { t } from "../i18n";

export const openCreateChildStorageKey = "munetios:open-create-child";

export default function ChildAccountSignIn() {
  const [copy, setCopy] = useState(() => t());
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const refreshCopy = () => setCopy(t());
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);

    fetch("/api/account", {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) return;
        window.sessionStorage.setItem(openCreateChildStorageKey, "true");
        window.location.replace("/account/settings/families");
      })
      .catch(() => {})
      .finally(() => setCheckingSession(false));

    return () => {
      controller.abort();
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  return (
    <main className="signin-background flex min-h-dvh items-center justify-center p-4 text-white">
      <section className="liquid-glass w-full max-w-lg rounded-3xl border border-white/10 bg-purple-950/35! p-6 shadow-2xl shadow-purple-950/35 sm:p-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-purple-200/20 bg-purple-500/20! text-purple-100">
          <icon className="text-3xl">child_care</icon>
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em]">
          {copy.familyCreateChildAction}
        </h1>
        <p className="mt-3 text-sm leading-6 text-white/70">
          {copy.familyChildSignInDescription}
        </p>
        {checkingSession
          ? <p className="mt-6 text-sm font-semibold text-white/60">
              {copy.accountProcessing}
            </p>
          : <a
              className="liquid-glass mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border border-purple-200/20 bg-purple-600/75! px-5 py-2.5 text-sm font-bold text-white transition hover:bg-purple-500/85!"
              href="/signin?returnTo=%2Fsignin%2Fchild"
            >
              {copy.signIn}
            </a>}
      </section>
    </main>
  );
}
