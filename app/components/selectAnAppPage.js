"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale, t } from "../i18n";
import IgnoreElementErrorBoundary from "./ignoreElementErrorBoundary";
import SelectAnAppTopbar from "./selectAnAppTopbar";

const _products = [
  {
    id: 1,
    name: "Munetios Mail",
    nameKey: "productMailName",
    image: "/mail.png",
    descriptionKey: "productMailDescription",
    url: "https://mail.munetios.com",
  },
  {
    id: 2,
    name: "Munetios AI",
    nameKey: "productAiName",
    image: "/ai.png",
    descriptionKey: "productAiDescription",
    url: "/apps/ai",
  },
  {
    id: 3,
    name: "Munetios Calendar",
    nameKey: "productCalendarName",
    image: "/calendar.png",
    descriptionKey: "productCalendarDescription",
    url: "/apps/calendar",
  },
  {
    id: 4,
    name: "Munetios OmniWrite",
    nameKey: "productOmniWriteName",
    image: "/omniwrite.png",
    descriptionKey: "productOmniWriteDescription",
    url: "/apps/omniwrite",
  },
  {
    id: 5,
    name: "Munetios Drive",
    nameKey: "productDriveName",
    image: "/drive.png",
    descriptionKey: "productDriveDescription",
    url: "https://drive.munetios.com",
  },
  {
    id: 6,
    name: "Munetios Meet",
    nameKey: "productMeetName",
    image: "/meet.png",
    descriptionKey: "productMeetDescription",
    url: "https://meet.munetios.com",
  },
  {
    id: 7,
    name: "Munetios Chat",
    nameKey: "productChatName",
    image: "/chat.png",
    descriptionKey: "productChatDescription",
    url: "https://chat.munetios.com",
  },
  {
    id: 8,
    name: "Munetios Sheets",
    nameKey: "productSheetsName",
    image: "/sheets.png",
    descriptionKey: "productSheetsDescription",
    url: "https://sheets.munetios.com",
  },
  {
    id: 9,
    name: "Munetios Slides",
    nameKey: "productSlidesName",
    image: "/slides.png",
    descriptionKey: "productSlidesDescription",
    url: "https://slides.munetios.com",
  },
  {
    id: 13,
    name: "Munetios SupaNotes",
    nameKey: "productSupaNotesName",
    image: "https://notes.munetios.com/apple-touch-icon.png",
    descriptionKey: "productSupaNotesDescription",
    url: "/apps/notes",
  },
  {
    id: 14,
    name: "Munetios Tasks",
    nameKey: "productTasksName",
    image: "https://tasks.munetios.com/apple-touch-icon.png",
    descriptionKey: "productTasksDescription",
    url: "/apps/tasks",
  },
];

export default function SelectAnAppPage({ active = true }) {
  const [locale, setLocale] = useState("en");
  const [archived, setArchived] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const copy = useMemo(() => t(locale), [locale]);

  useEffect(() => {
    const refreshLocale = () => {
      setLocale(getCurrentLocale());
    };

    refreshLocale();
    window.addEventListener("languagechange", refreshLocale);
    window.addEventListener("munetios:languagechange", refreshLocale);
    window.addEventListener("munetios:localechange", refreshLocale);

    return () => {
      window.removeEventListener("languagechange", refreshLocale);
      window.removeEventListener("munetios:languagechange", refreshLocale);
      window.removeEventListener("munetios:localechange", refreshLocale);
    };
  }, []);

  useEffect(() => {
    fetch("/api/account", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((account) => setArchived(Boolean(account?.archived)))
      .catch(() => setArchived(false));
  }, []);

  useEffect(() => {
    if (!archived || offlineMode) return undefined;
    const continueOffline = (event) => {
      if (event.key === "Escape") setOfflineMode(true);
    };
    window.addEventListener("keydown", continueOffline);
    return () => window.removeEventListener("keydown", continueOffline);
  }, [archived, offlineMode]);

  return (
    <main
      aria-label={copy.selectAppPageAriaLabel}
      className="munetios-app-render flex min-h-dvh flex-col overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(126,34,206,0.4),transparent_34rem),linear-gradient(135deg,#150627,#23083f_48%,#10031e)] text-white"
      data-munetios-app-render="true"
    >
      <IgnoreElementErrorBoundary>
        <SelectAnAppTopbar active={active} />
      </IgnoreElementErrorBoundary>
      <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center px-4 pb-8 pt-20 sm:px-6 lg:px-8">
        <div className="w-full text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-violet-200">
            {copy.selectAppKicker}
          </p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
            {copy.selectAppHeading}
          </h1>
          <p className="mt-2 text-sm text-violet-200">
            {copy.selectAppLaunchDescription}
          </p>
        </div>
        <div className="mt-10 grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {_products.map((product) => (
            <button
              className="flex h-full flex-col items-start rounded-3xl border border-white/10 bg-white/5 p-6 text-left transition hover:border-violet-300/40 hover:bg-white/10"
              key={product.id}
              onClick={() =>
                window.open(product.url, "_self", "noopener,noreferrer")
              }
              type="button"
            >
              <img
                alt={copy[product.nameKey] || product.name}
                className="mb-5 w-14 rounded-2xl object-contain"
                src={product.image}
              />
              <h2 className="text-xl font-semibold text-white">
                {copy[product.nameKey] || product.name}
              </h2>
              <p className="mt-2 text-sm leading-6 text-violet-200">
                {copy[product.descriptionKey] || copy.selectAppCardDescription}
              </p>
            </button>
          ))}
        </div>
      </section>
      <footer className="border-t border-white/10 py-4 text-center text-sm text-white/70">
        {"\u00a9"} 2026 Munetios
      </footer>
      {archived && !offlineMode ? (
        <div
          aria-live="assertive"
          aria-modal="true"
          className="fixed inset-0 z-[3000] flex min-h-dvh items-center justify-center bg-purple-950/95! p-4 text-white"
          role="dialog"
        >
          <section className="liquid-glass w-full max-w-xl rounded-3xl border border-amber-200/25 bg-purple-950/75! p-6 shadow-2xl sm:p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15! text-amber-100">
              <icon>domain_disabled</icon>
            </div>
            <h2 className="mt-5 text-2xl font-bold">
              {copy.demoArchivedSessionTitle}
            </h2>
            <p className="mt-4 text-sm leading-7 text-white/80">
              {copy.demoArchivedSessionMessage}
            </p>
            <p className="mt-4 rounded-xl border border-white/10 bg-white/5! p-3 text-sm leading-6 text-white/65">
              {copy.demoArchivedOfflineHint}
            </p>
            <button
              className="mt-5 rounded-xl border border-purple-200/25 bg-purple-500/80! px-4 py-2 text-sm font-bold text-white"
              onClick={() => setOfflineMode(true)}
              type="button"
            >
              {copy.demoContinueOffline}
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
