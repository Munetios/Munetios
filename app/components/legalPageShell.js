"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentLocale, t } from "../i18n";
import { hasSignedInCookie } from "../lib/signedInCookie";
import AccountAvatar from "./accountAvatar";
import AccountWrapper from "./accountwraper";
import AppLauncherWrapper from "./appLauncherWrapper";
import AppTopbarRight from "./appTopbarRight";

export const pageDefinitions = {
  cookies: {
    descriptionKey: "cookiePolicyDescription",
    icon: "cookie",
    sections: [
      ["cookieEssentialTitle", "cookieEssentialBody"],
      ["cookiePreferencesTitle", "cookiePreferencesBody"],
      ["cookieNoTrackingTitle", "cookieNoTrackingBody"],
      ["cookieControlsTitle", "cookieControlsBody"],
      ["legalChangesTitle", "legalChangesBody"],
      ["legalContactTitle", "legalContactBody"],
    ],
    titleKey: "cookiePolicyTitle",
  },
  privacy: {
    descriptionKey: "privacyPolicyDescription",
    icon: "shield_lock",
    sections: [
      ["privacyDataCollectedTitle", "privacyDataCollectedBody"],
      ["privacyUseTitle", "privacyUseBody"],
      ["privacyNoSaleTitle", "privacyNoSaleBody"],
      ["privacyProvidersTitle", "privacyProvidersBody"],
      ["privacyLegalBasesTitle", "privacyLegalBasesBody"],
      ["privacyCookiesTitle", "privacyCookiesBody"],
      ["privacyAiTitle", "privacyAiBody"],
      ["privacyRetentionTitle", "privacyRetentionBody"],
      ["privacySecurityTitle", "privacySecurityBody"],
      ["privacyInternationalTitle", "privacyInternationalBody"],
      ["privacyGdprTitle", "privacyGdprBody"],
      ["privacyCoppaTitle", "privacyCoppaBody"],
      ["privacyParentRightsTitle", "privacyParentRightsBody"],
      ["privacyRightsTitle", "privacyRightsBody"],
      ["legalContactTitle", "legalContactBody"],
    ],
    titleKey: "privacyPolicyTitle",
  },
  terms: {
    descriptionKey: "termsDescription",
    icon: "gavel",
    sections: [
      ["termsEligibilityTitle", "termsEligibilityBody"],
      ["termsAccountsTitle", "termsAccountsBody"],
      ["termsUseTitle", "termsUseBody"],
      ["termsPaymentsTitle", "termsPaymentsBody"],
      ["termsPrivacyTitle", "termsPrivacyBody"],
      ["termsContentTitle", "termsContentBody"],
      ["termsMunetiosContentTitle", "termsMunetiosContentBody"],
      ["termsAiTitle", "termsAiBody"],
      ["termsThirdPartyTitle", "termsThirdPartyBody"],
      ["termsUpdatesTitle", "termsUpdatesBody"],
      ["termsTerminationTitle", "termsTerminationBody"],
      ["termsWarrantyTitle", "termsWarrantyBody"],
      ["termsLawTitle", "termsLawBody"],
      ["legalChangesTitle", "legalChangesBody"],
      ["legalContactTitle", "legalContactBody"],
    ],
    titleKey: "termsTitle",
  },
};

const wordmarkDontKeys = [
  "brandingDontWordmarkFont",
  "brandingDontStretch",
  "brandingDontRotate",
  "brandingDontRecolor",
  "brandingDontEffects",
  "brandingDontOutline",
  "brandingDontRearrange",
  "brandingDontCrop",
  "brandingDontLowContrast",
  "brandingDontCrowd",
];

const markDontKeys = [
  "brandingDontMarkStretch",
  "brandingDontMarkRotate",
  "brandingDontMarkRecolor",
  "brandingDontMarkEffects",
  "brandingDontMarkOutline",
  "brandingDontMarkEdit",
  "brandingDontMarkCrop",
  "brandingDontMarkContainer",
  "brandingDontMarkPattern",
  "brandingDontMarkReplace",
];

const brandingDoKeys = [
  ["brandingDoApprovedArtwork", "wordmark"],
  ["brandingDoClearSpace", "wordmark-space"],
  ["brandingDoReadableContrast", "wordmark-contrast"],
  ["brandingDoApprovedMark", "mark"],
];

function localePrefix(locale) {
  return locale === "en" ? "" : `/${locale}`;
}

function PoliciesTopbar({ copy, locale }) {
  const [appsOpen, setAppsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [user, setUser] = useState(null);
  const appsRef = useRef(null);

  useEffect(() => {
    if (hasSignedInCookie()) {
      setUser({ name: "Munetios" });
    }
    fetch("/api/signedin", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.authenticated && payload?.signedIn) {
          setUser(payload.user);
        } else if (!hasSignedInCookie()) {
          setUser(null);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <>
      <header className="topbar mcontainer fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-between gap-3 bg-transparent px-3 sm:px-5">
        <div className="topbar-left liquid-glass flex h-14 items-center rounded-2xl border border-white/10 bg-white/10! px-3 backdrop-blur-[3px]">
          <Link
            className="flex items-center gap-2.5 font-semibold tracking-[-0.02em]"
            href={`${localePrefix(locale)}/policies`}
          >
            <img alt="" className="h-8 w-8 rounded-xl" src="/favicon.ico" />
            <span className="hidden sm:inline">{copy.policiesTitle}</span>
            <span className="sm:hidden">{copy.policiesShortTitle}</span>
          </Link>
        </div>
        <AppTopbarRight className="topbar-right rounded-2xl border border-white/10 bg-white/10! backdrop-blur-[3px]">
          <a
            aria-label={copy.search}
            className="grid h-10 w-10 place-items-center rounded-xl hover:bg-white/10!"
            href="#policy-search"
          >
            <icon>search</icon>
          </a>
          <button
            aria-label={copy.apps}
            className="grid h-10 w-10 place-items-center rounded-xl hover:bg-white/10!"
            onClick={() => setAppsOpen((open) => !open)}
            ref={appsRef}
            type="button"
          >
            <icon>apps</icon>
          </button>
          <button
            aria-expanded={accountOpen}
            aria-label={copy.account}
            className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl hover:bg-white/10!"
            onClick={() => {
              if (!user) {
                window.location.assign("/signin");
                return;
              }
              setAccountOpen((open) => !open);
            }}
            type="button"
          >
            {user ? (
              <AccountAvatar account={user} className="h-9 w-9 rounded-xl" />
            ) : (
              <icon>account_circle</icon>
            )}
          </button>
        </AppTopbarRight>
      </header>
      <AppLauncherWrapper
        copy={copy}
        onClose={() => setAppsOpen(false)}
        open={appsOpen}
        triggerRef={appsRef}
      />
      {accountOpen ? (
        <div className="fixed inset-0 z-[1090]" role="presentation">
          <button
            aria-label={copy.close}
            className="absolute inset-0 bg-black/20!"
            onClick={() => setAccountOpen(false)}
            type="button"
          />
          <div className="absolute right-3 top-20 w-[min(30rem,calc(100vw-1.5rem))]">
            <AccountWrapper appContext legalLinksInNewTab={false} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function PoliciesSidebar({ copy, locale, page }) {
  const prefix = localePrefix(locale);
  const links = [
    ["terms", "gavel", copy.termsTitle, `${prefix}/terms`],
    ["privacy", "shield_lock", copy.privacyPolicyTitle, `${prefix}/privacy`],
    ["cookies", "cookie", copy.cookiePolicyTitle, `${prefix}/cookies`],
    [
      "branding",
      "brand_awareness",
      copy.brandingGuidelinesTitle,
      `${prefix}/policies/branding`,
    ],
  ];

  return (
    <aside className="liquid-glass sticky top-24 h-fit rounded-3xl border border-white/10 bg-white/8! p-2 backdrop-blur-[3px]">
      <p className="px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
        {copy.policiesNavigation}
      </p>
      <nav aria-label={copy.policiesNavigation} className="grid gap-1">
        {links.map(([id, icon, label, href]) => (
          <Link
            aria-current={page === id ? "page" : undefined}
            className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition ${
              page === id
                ? "bg-purple-500/35! font-semibold text-white"
                : "text-white/68 hover:bg-white/10! hover:text-white"
            }`}
            href={href}
            key={id}
          >
            <icon>{icon}</icon>
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function BrandingPreview({ index = 0, type }) {
  const isMark = type === "mark";
  const source = isMark
    ? "/favicon.ico"
    : "/wordmarkwithoutprivacyfocusedtagline.png";
  const imageClass = isMark
    ? "h-16 w-16 rounded-2xl object-contain"
    : "max-h-14 w-[82%] object-contain";
  const variations = [
    "",
    "scale-x-150",
    "rotate-12",
    "hue-rotate-90",
    "drop-shadow-[0_8px_7px_rgba(244,63,94,0.8)]",
    "opacity-35",
    "-translate-x-8",
    "translate-x-16",
    "contrast-50",
    "scale-125",
  ];

  return (
    <figure
      aria-hidden="true"
      className="relative grid min-h-32 place-items-center overflow-hidden rounded-2xl border border-rose-200/12 bg-[linear-gradient(135deg,rgba(255,255,255,.10),rgba(244,63,94,.10))]"
    >
      <span className="absolute left-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-rose-500/80! text-sm font-black text-white">
        ×
      </span>
      {index === 0 && !isMark ? (
        <span className="text-4xl font-serif tracking-tight text-purple-300">
          Munetios
        </span>
      ) : index === 5 ? (
        <div className="grid place-items-center text-purple-300 [filter:drop-shadow(0_0_1px_white)]">
          <img
            alt=""
            className={`${imageClass} opacity-20`}
            src={source}
          />
        </div>
      ) : index === 7 ? (
        <div className="h-20 w-20 overflow-hidden rounded-full border border-rose-200/30">
          <img
            alt=""
            className={`${imageClass} translate-x-8`}
            src={source}
          />
        </div>
      ) : index === 9 ? (
        <div className="grid h-20 w-[86%] place-items-center border border-dashed border-rose-300/35">
          <img alt="" className={`${imageClass} scale-125`} src={source} />
        </div>
      ) : (
        <img
          alt=""
          className={`${imageClass} ${variations[index] || ""}`}
          src={source}
        />
      )}
    </figure>
  );
}

function BrandingDoPreview({ type }) {
  const isMark = type === "mark";
  const isContrast = type === "wordmark-contrast";
  const hasClearSpace = type === "wordmark-space";

  return (
    <figure
      aria-hidden="true"
      className={`relative grid min-h-36 place-items-center overflow-hidden rounded-2xl border border-emerald-200/15 ${
        isContrast
          ? "bg-[#f5efff]!"
          : "bg-[linear-gradient(135deg,rgba(255,255,255,.10),rgba(16,185,129,.12))]"
      }`}
    >
      <span className="absolute left-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-emerald-500/80! text-sm font-black text-white">
        ✓
      </span>
      <div
        className={
          hasClearSpace
            ? "grid h-24 w-[88%] place-items-center border border-dashed border-emerald-200/40 p-6"
            : "grid w-full place-items-center p-6"
        }
      >
        <img
          alt=""
          className={
            isMark
              ? "h-16 w-16 rounded-2xl object-contain"
              : `max-h-16 w-[85%] object-contain ${isContrast ? "drop-shadow-[0_1px_0_rgba(0,0,0,.18)]" : ""}`
          }
          src={isMark ? "/favicon.ico" : "/wordmark-munetios.png"}
        />
      </div>
    </figure>
  );
}

function BrandingDownloadButton({ copy, fileName, href }) {
  return (
    <a
      className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-purple-200/20 bg-purple-500/35! px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500/50!"
      download={fileName}
      href={href}
    >
      <icon>download</icon>
      <span>{copy.brandingDownloadLogo}</span>
    </a>
  );
}

function BrandingGuidelines({ copy }) {
  return (
    <article className="space-y-5">
      <header className="liquid-glass overflow-hidden rounded-[2rem] border border-white/10 bg-purple-500/15! p-6 backdrop-blur-[3px] sm:p-9">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-purple-200">
          Munetios
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
          {copy.brandingGuidelinesTitle}
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-white/70">
          {copy.brandingGuidelinesDescription}
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="liquid-glass rounded-3xl border border-white/10 bg-white/8! p-6 backdrop-blur-[3px]">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/45">
            {copy.brandingPrimaryMark}
          </p>
          <div className="mt-5 grid min-h-52 place-items-center rounded-3xl bg-white/10!">
            <img alt={copy.brandingPrimaryMark} className="h-28 w-28" src="/favicon.ico" />
          </div>
          <p className="mt-4 text-sm leading-6 text-white/65">
            {copy.brandingMarkDescription}
          </p>
          <BrandingDownloadButton
            copy={copy}
            fileName="munetios-m.ico"
            href="/favicon.ico"
          />
        </div>
        <div className="liquid-glass rounded-3xl border border-white/10 bg-white/8! p-6 backdrop-blur-[3px]">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/45">
            {copy.brandingWordmark}
          </p>
          <div className="mt-5 grid min-h-52 place-items-center rounded-3xl bg-white/10! p-6">
            <img
              alt={copy.brandingWordmark}
              className="max-h-28 max-w-full object-contain"
              src="/wordmark-munetios.png"
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-white/65">
            {copy.brandingWordmarkDescription}
          </p>
          <BrandingDownloadButton
            copy={copy}
            fileName="munetios-wordmark-privacy-focused.png"
            href="/wordmark-munetios.png"
          />
        </div>
      </section>

      <section className="liquid-glass rounded-3xl border border-white/10 bg-white/8! p-6 backdrop-blur-[3px] sm:p-8">
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-200">
              {copy.brandingTransparentPng}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
              {copy.brandingWordmarkWithoutTagline}
            </h2>
            <p className="mt-3 text-sm leading-7 text-white/65">
              {copy.brandingWordmarkWithoutTaglineDescription}
            </p>
            <BrandingDownloadButton
              copy={copy}
              fileName="munetios-wordmark-transparent.png"
              href="/wordmarkwithoutprivacyfocusedtagline.png"
            />
          </div>
          <div className="grid min-h-52 place-items-center rounded-3xl border border-white/8 bg-[conic-gradient(rgba(255,255,255,.10)_25%,rgba(124,58,237,.10)_0_50%,rgba(255,255,255,.10)_0_75%,rgba(124,58,237,.10)_0)] bg-[length:24px_24px] p-8">
            <img
              alt={copy.brandingWordmarkWithoutTagline}
              className="max-h-32 max-w-full object-contain"
              src="/wordmarkwithoutprivacyfocusedtagline.png"
            />
          </div>
        </div>
      </section>

      <section className="liquid-glass rounded-3xl border border-rose-200/15 bg-rose-500/10! p-6 backdrop-blur-[3px] sm:p-8">
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-rose-200">
              {copy.brandingDoNot}
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              {copy.brandingUnapprovedTitle}
            </h2>
            <p className="mt-3 text-sm leading-7 text-white/65">
              {copy.brandingUnapprovedDescription}
            </p>
          </div>
          <img
            alt={copy.brandingUnapprovedAlt}
            className="w-full rounded-2xl border border-rose-200/15"
            src="/unapprovedwordmark.png"
          />
        </div>
      </section>

      <section className="liquid-glass rounded-3xl border border-emerald-200/15 bg-emerald-500/8! p-6 backdrop-blur-[3px] sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-200">
          {copy.brandingDo}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
          {copy.brandingDosTitle}
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {brandingDoKeys.map(([key, type]) => (
            <article
              className="rounded-3xl border border-white/8 bg-white/6! p-3"
              key={key}
            >
              <BrandingDoPreview type={type} />
              <p className="px-2 pb-2 pt-4 text-sm leading-6 text-white/72">
                {copy[key]}
              </p>
            </article>
          ))}
        </div>
      </section>

      {[
        [
          copy.brandingWordmarkWithoutTaglineDonts,
          wordmarkDontKeys,
          "wordmark-plain",
        ],
        [copy.brandingMarkDonts, markDontKeys, "mark"],
      ].map(([title, keys, type]) => (
        <section
          className="liquid-glass rounded-3xl border border-white/10 bg-white/8! p-6 backdrop-blur-[3px] sm:p-8"
          key={type}
        >
          <h2 className="text-2xl font-semibold tracking-[-0.025em]">{title}</h2>
          <ol className="mt-5 grid gap-4 sm:grid-cols-2">
            {keys.map((key, index) => (
              <li
                className="rounded-3xl border border-white/8 bg-white/6! p-3 text-sm leading-6 text-white/72"
                key={key}
              >
                <BrandingPreview index={index} type={type} />
                <div className="flex gap-3 px-2 pb-2 pt-4">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-rose-500/25! font-bold text-rose-100">
                    {index + 1}
                  </span>
                  <span>{copy[key]}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </article>
  );
}

export default function LegalPageShell({ page = "privacy" }) {
  const [locale, setLocale] = useState("en");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const updateLocale = () => setLocale(getCurrentLocale());
    updateLocale();
    window.addEventListener("munetios:localechange", updateLocale);
    window.addEventListener("munetios:languagechange", updateLocale);
    return () => {
      window.removeEventListener("munetios:localechange", updateLocale);
      window.removeEventListener("munetios:languagechange", updateLocale);
    };
  }, []);

  const copy = useMemo(() => t(locale), [locale]);
  const definition = pageDefinitions[page] || pageDefinitions.privacy;
  const sections = useMemo(() => {
    if (!query.trim()) return definition.sections;
    const needle = query.trim().toLocaleLowerCase(locale);
    return definition.sections.filter(([titleKey, bodyKey]) =>
      `${copy[titleKey]} ${copy[bodyKey]}`.toLocaleLowerCase(locale).includes(needle),
    );
  }, [copy, definition.sections, locale, query]);

  return (
    <main className="min-h-dvh text-white">
      <PoliciesTopbar copy={copy} locale={locale} />
      <div className="mx-auto grid w-full max-w-[96rem] gap-5 px-3 pb-12 pt-24 lg:grid-cols-[17rem_minmax(0,1fr)] lg:px-5">
        <PoliciesSidebar copy={copy} locale={locale} page={page} />
        {page === "branding" ? (
          <BrandingGuidelines copy={copy} />
        ) : (
          <article className="min-w-0">
            <header className="liquid-glass rounded-[2rem] border border-white/10 bg-purple-500/15! p-6 backdrop-blur-[3px] sm:p-9">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.16em] text-purple-200">
                    {copy.policiesTitle}
                  </p>
                  <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
                    {copy[definition.titleKey]}
                  </h1>
                </div>
                <span className="hidden h-14 w-14 place-items-center rounded-2xl bg-purple-500/25! text-purple-100 sm:grid">
                  <icon>{definition.icon}</icon>
                </span>
              </div>
              <p className="mt-4 max-w-3xl text-base leading-7 text-white/70">
                {copy[definition.descriptionKey]}
              </p>
              <p className="mt-4 text-xs text-white/45">{copy.legalEffectiveDate}</p>
              <label className="mt-6 flex max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-white/10! px-4">
                <icon>search</icon>
                <input
                  className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-white/40"
                  id="policy-search"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.policiesSearchPlaceholder}
                  type="search"
                  value={query}
                />
              </label>
            </header>
            <div className="mt-5 grid gap-4">
              {sections.map(([titleKey, bodyKey]) => (
                <section
                  className="liquid-glass scroll-mt-24 rounded-3xl border border-white/10 bg-white/8! p-5 backdrop-blur-[3px] sm:p-7"
                  id={titleKey}
                  key={titleKey}
                >
                  <h2 className="text-xl font-semibold text-white">{copy[titleKey]}</h2>
                  <p className="mt-3 whitespace-pre-line text-sm leading-7 text-white/72">
                    {copy[bodyKey]}
                  </p>
                </section>
              ))}
              {sections.length === 0 ? (
                <p className="rounded-3xl border border-white/10 bg-white/5! p-8 text-center text-white/60">
                  {copy.policiesNoResults}
                </p>
              ) : null}
            </div>
          </article>
        )}
      </div>
    </main>
  );
}
