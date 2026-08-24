"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale, t } from "../i18n";

export default function CountryUnavailablePage() {
  const [locale, setLocale] = useState("en");
  const copy = useMemo(() => t(locale), [locale]);

  useEffect(() => {
    const refresh = () => setLocale(getCurrentLocale());
    refresh();
    window.addEventListener("munetios:languagechange", refresh);
    return () => window.removeEventListener("munetios:languagechange", refresh);
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] p-4 text-[var(--foreground)]">
      <section className="liquid-glass w-full max-w-2xl rounded-3xl border border-purple-200/20 bg-purple-950/35! p-7 text-center backdrop-blur-[3px]">
        <icon className="text-4xl text-purple-200">public_off</icon>
        <h1 className="mt-3 text-2xl font-bold">
          {copy.countryUnavailableTitle}
        </h1>
        <p className="mt-3 leading-7 text-white/70">
          {copy.countryUnavailableBody}
        </p>
        <p className="mt-3 text-sm text-white/55">
          {copy.countryUnavailableSupported}
        </p>
        <Link
          className="liquid-glass mt-5 inline-flex rounded-xl border border-purple-200/20 bg-purple-600/35! px-4 py-2 font-bold"
          href="/"
        >
          {copy.accountBack}
        </Link>
      </section>
    </main>
  );
}
