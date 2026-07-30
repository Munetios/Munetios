"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale, t } from "../i18n";
import IgnoreElementErrorBoundary from "./ignoreElementErrorBoundary";
import SelectAnAppTopbar from "./selectAnAppTopbar";

const _products = [
  {
    app: "mail",
    id: 1,
    name: "Munetios Mail",
    nameKey: "productMailName",
    image: "/mail.png",
    descriptionKey: "productMailDescription",
    url: "https://mail.munetios.com",
  },
  {
    app: "ai",
    id: 2,
    name: "Munetios AI",
    nameKey: "productAiName",
    image: "/ai.png",
    descriptionKey: "productAiDescription",
    url: "/apps/ai",
  },
  {
    app: "calendar",
    id: 3,
    name: "Munetios Calendar",
    nameKey: "productCalendarName",
    image: "/calendar.png",
    descriptionKey: "productCalendarDescription",
    url: "/apps/calendar",
  },
  {
    app: "omniwrite",
    id: 4,
    name: "Munetios OmniWrite",
    nameKey: "productOmniWriteName",
    image: "/omniwrite.png",
    descriptionKey: "productOmniWriteDescription",
    url: "/apps/omniwrite",
  },
  {
    app: "drive",
    id: 5,
    name: "Munetios Drive",
    nameKey: "productDriveName",
    image: "/drive.png",
    descriptionKey: "productDriveDescription",
    url: "https://drive.munetios.com",
  },
  {
    app: "meet",
    id: 6,
    name: "Munetios Meet",
    nameKey: "productMeetName",
    image: "/meet.png",
    descriptionKey: "productMeetDescription",
    url: "/apps/meet",
  },
  {
    app: "chat",
    id: 7,
    name: "Munetios Chat",
    nameKey: "productChatName",
    image: "/chat.png",
    descriptionKey: "productChatDescription",
    url: "https://chat.munetios.com",
  },
  {
    app: "sheets",
    id: 8,
    name: "Munetios Sheets",
    nameKey: "productSheetsName",
    image: "/sheets.png",
    descriptionKey: "productSheetsDescription",
    url: "https://sheets.munetios.com",
  },
  {
    app: "slides",
    id: 9,
    name: "Munetios Slides",
    nameKey: "productSlidesName",
    image: "/slides.png",
    descriptionKey: "productSlidesDescription",
    url: "https://slides.munetios.com",
  },
  {
    app: "notes",
    id: 13,
    name: "Munetios SupaNotes",
    nameKey: "productSupaNotesName",
    image: "https://notes.munetios.com/apple-touch-icon.png",
    descriptionKey: "productSupaNotesDescription",
    url: "/apps/notes",
  },
  {
    app: "tasks",
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
  const [organization, setOrganization] = useState(null);
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
    fetch("/api/organization/access", {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setOrganization(payload?.organization || null))
      .catch(() => setOrganization(null));
  }, []);

  const visibleProducts = useMemo(() => {
    const products = _products.filter(
      (product) => organization?.appAccess?.[product.app] !== false,
    );
    if (organization?.administrator) {
      products.push({
        app: "admin",
        descriptionKey: "adminDashboardDescriptionShort",
        id: 99,
        image: "/favicon.ico",
        name: "Munetios Admin",
        nameKey: "adminTitle",
        url: "/apps/admin",
      });
    }
    return products;
  }, [organization]);

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
      className="munetios-app-render flex min-h-dvh flex-col overflow-x-hidden bg-[var(--app-background)] text-[var(--foreground)] [font-family:var(--app-font)]"
      data-munetios-app-render="true"
    >
      <IgnoreElementErrorBoundary>
        <SelectAnAppTopbar active={active} />
      </IgnoreElementErrorBoundary>
      <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center px-4 pb-8 pt-20 sm:px-6 lg:px-8">
        <div className="w-full text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-[var(--accent)]">
            {copy.selectAppKicker}
          </p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
            {copy.selectAppHeading}
          </h1>
          <p className="mt-2 text-sm text-[color-mix(in_srgb,var(--foreground)_68%,transparent)]">
            {copy.selectAppLaunchDescription}
          </p>
        </div>
        <div className="mt-10 grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProducts.map((product) => (
            <button
              className="liquid-glass flex h-full flex-col items-start border border-[color-mix(in_srgb,var(--foreground)_14%,transparent)] bg-[color-mix(in_srgb,var(--theme-surface-container)_45%,transparent)]! p-6 text-left text-[var(--foreground)] transition hover:border-[color-mix(in_srgb,var(--accent)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--theme-surface-container-high)_50%,transparent)]! hover:[transform:translateY(var(--theme-hover-y))] [border-radius:var(--theme-container-radius)] [transition-duration:var(--theme-transition)]"
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
              <h2 className="text-xl font-semibold text-[var(--foreground)]">
                {copy[product.nameKey] || product.name}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[color-mix(in_srgb,var(--foreground)_68%,transparent)]">
                {copy[product.descriptionKey] || copy.selectAppCardDescription}
              </p>
            </button>
          ))}
        </div>
      </section>
      <footer className="border-t border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] py-4 text-center text-sm text-[color-mix(in_srgb,var(--foreground)_70%,transparent)]">
        {"\u00a9"} 2026 Munetios
      </footer>
      {archived && !offlineMode
        ? <div
            aria-live="assertive"
            aria-modal="true"
            className="fixed inset-0 z-[3000] flex min-h-dvh items-center justify-center bg-black/50! p-4 text-[var(--foreground)]"
            role="dialog"
          >
            <section className="liquid-glass w-full max-w-xl border border-[color-mix(in_srgb,var(--foreground)_14%,transparent)] bg-[color-mix(in_srgb,var(--theme-surface-container)_50%,transparent)]! p-6 shadow-2xl [border-radius:var(--theme-container-radius)] sm:p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15! text-amber-100">
                <icon>domain_disabled</icon>
              </div>
              <h2 className="mt-5 text-2xl font-bold">
                {copy.demoArchivedSessionTitle}
              </h2>
              <p className="mt-4 text-sm leading-7 text-[color-mix(in_srgb,var(--foreground)_80%,transparent)]">
                {copy.demoArchivedSessionMessage}
              </p>
              <p className="mt-4 border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]! p-3 text-sm leading-6 text-[color-mix(in_srgb,var(--foreground)_65%,transparent)] [border-radius:var(--theme-radius)]">
                {copy.demoArchivedOfflineHint}
              </p>
              <button
                className="mt-5 border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-4 py-2 text-sm font-bold text-[var(--theme-on-primary)] [border-radius:var(--theme-radius)]"
                onClick={() => setOfflineMode(true)}
                type="button"
              >
                {copy.demoContinueOffline}
              </button>
            </section>
          </div>
        : null}
    </main>
  );
}
