"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getCurrentLocale,
  getUrlLocaleOverride,
  t,
  translations,
} from "../i18n";
import { britishEnglishLocaleCountries } from "../languages/index";
import { loadDateTimePreferences } from "../lib/dateTimePreferences";
import {
  getSuggestedLocales,
  resolvePreferenceCountry,
} from "../lib/regionPreferences";
import DropdownWrapper from "./dropdownwrapper";

const languageUrl = "/api/language";
const localePathSegments = new Set([
  ...Object.keys(translations).map((locale) => locale.toLowerCase()),
  ...Object.keys(translations).map((locale) =>
    locale.split("-")[0].toLowerCase(),
  ),
  "en-us",
]);

function getSavedLanguage() {
  if (typeof window === "undefined") {
    return "auto";
  }

  const storedLanguage =
    window.localStorage.getItem("munetiosLanguage") ||
    window.localStorage.getItem("munetios.locale") ||
    null;

  if (storedLanguage) {
    return storedLanguage;
  }

  const localeCookie = window.document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("munetios_locale="));

  if (!localeCookie) {
    return "auto";
  }

  try {
    return decodeURIComponent(localeCookie.slice("munetios_locale=".length));
  } catch {
    return localeCookie.slice("munetios_locale=".length);
  }
}

function getDetectedLocale() {
  if (typeof navigator === "undefined") {
    return "en";
  }

  return getCurrentLocale(navigator.language || navigator.userLanguage || "en");
}

function getLocaleDisplayName(locale) {
  const britishEnglishCountry = britishEnglishLocaleCountries[locale];
  if (britishEnglishCountry) {
    return `British English (${britishEnglishCountry})`;
  }
  return translations[locale]?.languageName || locale;
}

function getAutoLanguageLabel() {
  const detectedLocale = getDetectedLocale();
  const detectedLanguageName = getLocaleDisplayName(detectedLocale);

  return `Auto (${detectedLanguageName})`;
}

function removeHashLocaleOverride(hash) {
  const hashValue = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!hashValue) {
    return "";
  }

  const queryStart = hashValue.indexOf("?");
  const hashPath = queryStart >= 0 ? hashValue.slice(0, queryStart) : "";
  const hashQuery =
    queryStart >= 0
      ? hashValue.slice(queryStart + 1)
      : hashValue.startsWith("hl=")
        ? hashValue
        : "";

  if (!hashQuery) {
    return hash;
  }

  const parameters = new URLSearchParams(hashQuery);
  parameters.delete("hl");
  const nextQuery = parameters.toString();

  if (!hashPath) {
    return nextQuery ? `#${nextQuery}` : "";
  }

  return nextQuery ? `#${hashPath}?${nextQuery}` : `#${hashPath}`;
}

function getAutoLanguageDestination() {
  const destination = new URL(window.location.href);
  const pathSegments = destination.pathname.split("/");
  const firstPathSegment = decodeURIComponent(pathSegments[1] || "")
    .replaceAll("_", "-")
    .toLowerCase();

  if (localePathSegments.has(firstPathSegment)) {
    destination.pathname = `/${pathSegments.slice(2).join("/")}`;
  }

  destination.searchParams.delete("hl");
  destination.hash = removeHashLocaleOverride(destination.hash);

  return destination;
}

function getDestinationWithoutLocaleOverride() {
  const destination = new URL(window.location.href);
  destination.searchParams.delete("hl");
  destination.hash = removeHashLocaleOverride(destination.hash);
  return destination;
}

function getDisplayedLanguage() {
  return getUrlLocaleOverride() || getSavedLanguage();
}

function getLanguageOptions(preferences) {
  const suggestedLocales = getSuggestedLocales(
    resolvePreferenceCountry(preferences),
  );
  const localeEntries = Object.entries(translations)
    .map(([locale, localeCopy]) => ({
      locale,
      name: localeCopy.languageName || locale,
      suggested: suggestedLocales.includes(locale),
    }))
    .filter(({ locale }) => !britishEnglishLocaleCountries[locale]);
  const britishEnglishOptions = Object.entries(britishEnglishLocaleCountries)
    .map(([locale, country]) => ({
      country,
      locale,
      name: `British English (${country})`,
      suggested: suggestedLocales.includes(locale),
    }))
    .sort((firstLanguage, secondLanguage) =>
      firstLanguage.country.localeCompare(secondLanguage.country, "en", {
        sensitivity: "base",
      }),
    );

  const orderedOptions = [
    ...localeEntries,
    {
      group: "british-english",
      name: "British English",
    },
  ].sort((firstLanguage, secondLanguage) =>
    firstLanguage.name.localeCompare(secondLanguage.name, "en", {
      sensitivity: "base",
    }),
  );

  return {
    autoOption: {
      locale: "auto",
      name: getAutoLanguageLabel(),
    },
    britishEnglishOptions,
    orderedOptions,
  };
}

function BritishEnglishGroup({
  copy,
  disabled,
  onSelect,
  options,
  selectedLanguage,
}) {
  const [open, setOpen] = useState(false);
  const selectedBritishEnglish = Boolean(
    britishEnglishLocaleCountries[selectedLanguage],
  );

  return (
    <fieldset
      aria-label={copy.languageBritishEnglishCountries}
      className="m-0 min-w-0 rounded-lg border border-transparent p-0"
      data-dropdown-keep-open="true"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center justify-between gap-3 rounded-lg bg-transparent px-3 py-2 text-left text-sm text-white transition hover:bg-white/10!"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        role="menuitem"
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <icon>language</icon>
          <span className="truncate">British English</span>
        </span>
        <span className="flex items-center gap-2">
          {selectedBritishEnglish ? <icon>check</icon> : null}
          <icon>{open ? "expand_less" : "expand_more"}</icon>
        </span>
      </button>
      {open
        ? <div className="mt-1 grid gap-1 border-t border-white/10 pt-1 sm:grid-cols-2">
            {options.map((option) => (
              <button
                aria-checked={option.locale === selectedLanguage}
                className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-transparent px-3 py-2 text-left text-xs text-white transition hover:bg-white/10!"
                disabled={disabled}
                key={option.locale}
                onClick={() => onSelect(option.locale)}
                role="menuitemradio"
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2 truncate">
                  {option.suggested
                    ? <icon
                        className="text-purple-200"
                        title={copy.accountLanguageCountry}
                      >
                        location_on
                      </icon>
                    : null}
                  <span className="truncate">{option.country}</span>
                </span>
                {option.locale === selectedLanguage ? <icon>check</icon> : null}
              </button>
            ))}
          </div>
        : null}
    </fieldset>
  );
}

function saveLocalLanguage(language) {
  window.localStorage.setItem("munetiosLanguage", language);
  window.localStorage.setItem("munetios.locale", language);
  // biome-ignore lint/suspicious/noDocumentCookie: The locale is a non-sensitive preference cookie.
  window.document.cookie = `munetios_locale=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

async function saveLanguagePreference(language) {
  if (language === "auto") {
    try {
      const response = await fetch(languageUrl, {
        body: JSON.stringify({ language: "auto" }),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Language update failed: ${response.status}`);
      }
    } catch {
      // The local preference can still be cleared while signed out or offline.
    }

    if (typeof window !== "undefined") {
      window.localStorage.removeItem("munetiosLanguage");
      window.localStorage.removeItem("munetios.locale");
      // biome-ignore lint/suspicious/noDocumentCookie: Clear the non-sensitive locale preference for Auto mode.
      window.document.cookie =
        "munetios_locale=; Path=/; Max-Age=0; SameSite=Lax";
    }

    return "auto";
  }

  const resolvedLanguage = getCurrentLocale(language);

  try {
    const response = await fetch(languageUrl, {
      body: JSON.stringify({ language: resolvedLanguage }),
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Language update failed: ${response.status}`);
    }

    const payload = await response.json();

    if (typeof payload?.language === "string") {
      const savedLanguage = getCurrentLocale(payload.language);
      saveLocalLanguage(savedLanguage);
      return savedLanguage;
    }
  } catch {
    if (typeof window !== "undefined") {
      saveLocalLanguage(resolvedLanguage);
    }
  }

  return resolvedLanguage;
}

async function loadLanguagePreference() {
  const response = await fetch(languageUrl, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Language load failed: ${response.status}`);
  }

  const payload = await response.json();

  return typeof payload?.language === "string" ? payload.language : null;
}

export default function LanguageSelector({
  align = "left",
  buttonClassName = "h-auto w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 py-2 hover:border-white/20 hover:bg-white/15!",
  className = "w-full",
  copy: providedCopy = null,
  openOnHover = false,
  panelClassName = "max-h-80 w-[min(22rem,calc(100vw-1rem))] overflow-y-auto",
  persistent = false,
  placement = "bottom",
}) {
  const [selectedLanguage, setSelectedLanguage] = useState("auto");
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [regionalPreferences, setRegionalPreferences] = useState(
    loadDateTimePreferences,
  );
  const copy =
    providedCopy ||
    t(selectedLanguage === "auto" ? getDetectedLocale() : selectedLanguage);
  const languageOptions = useMemo(
    () => getLanguageOptions(regionalPreferences),
    [regionalPreferences],
  );
  const selectedLanguageName =
    selectedLanguage === "auto"
      ? getAutoLanguageLabel()
      : getLocaleDisplayName(selectedLanguage);

  useEffect(() => {
    let isMounted = true;

    const refreshLanguage = () => {
      setSelectedLanguage(getDisplayedLanguage());
    };

    refreshLanguage();
    if (!getUrlLocaleOverride()) {
      loadLanguagePreference()
        .then((language) => {
          if (!isMounted) {
            return;
          }

          if (!language) {
            setSelectedLanguage("auto");
            return;
          }

          const savedLanguage = getCurrentLocale(language);
          setSelectedLanguage(savedLanguage);
        })
        .catch(() => undefined);
    }
    window.addEventListener("languagechange", refreshLanguage);
    window.addEventListener("munetios:languagechange", refreshLanguage);
    window.addEventListener("munetios:localechange", refreshLanguage);
    const refreshRegion = () =>
      setRegionalPreferences(loadDateTimePreferences());
    window.addEventListener("munetios:language-time-change", refreshRegion);

    return () => {
      isMounted = false;
      window.removeEventListener("languagechange", refreshLanguage);
      window.removeEventListener("munetios:languagechange", refreshLanguage);
      window.removeEventListener("munetios:localechange", refreshLanguage);
      window.removeEventListener(
        "munetios:language-time-change",
        refreshRegion,
      );
    };
  }, []);

  const saveLanguage = async (language) => {
    if (
      savingLanguage ||
      (language === selectedLanguage && !getUrlLocaleOverride())
    ) {
      return;
    }

    setSavingLanguage(true);
    try {
      await saveLanguagePreference(language);

      if (language === "auto") {
        const destination = getAutoLanguageDestination();
        if (destination.href !== window.location.href) {
          window.location.replace(destination.href);
          return;
        }
        window.location.reload();
        return;
      }

      if (getUrlLocaleOverride()) {
        const destination = getDestinationWithoutLocaleOverride();
        window.location.replace(destination.href);
        return;
      }
      window.location.reload();
    } finally {
      setSavingLanguage(false);
    }
  };

  return (
    <DropdownWrapper
      align={align}
      ariaLabel={copy.selectLanguage}
      buttonClassName={buttonClassName}
      className={className}
      openOnHover={openOnHover}
      panelClassName={panelClassName}
      persistent={persistent}
      placement={placement}
      trigger={
        <>
          <span className="inline-flex min-w-0 items-center gap-2">
            <icon>translate</icon>
            <span className="truncate" data-translate="language">
              {copy.language}
            </span>
          </span>
          <span className="min-w-0 truncate text-white/60">
            {selectedLanguageName}
          </span>
        </>
      }
    >
      <div className="space-y-1">
        <button
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent bg-transparent px-3 py-2 text-left text-sm text-white transition hover:border-white/10 hover:bg-white/10!"
          disabled={savingLanguage}
          onClick={() => saveLanguage(languageOptions.autoOption.locale)}
          role="menuitem"
          type="button"
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            <span className="truncate">{languageOptions.autoOption.name}</span>
          </span>
          {languageOptions.autoOption.locale === selectedLanguage
            ? <icon>check</icon>
            : null}
        </button>
        {languageOptions.orderedOptions.map((languageOption) =>
          languageOption.group === "british-english"
            ? <BritishEnglishGroup
                copy={copy}
                disabled={savingLanguage}
                key={languageOption.group}
                onSelect={saveLanguage}
                options={languageOptions.britishEnglishOptions}
                selectedLanguage={selectedLanguage}
              />
            : <button
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent bg-transparent px-3 py-2 text-left text-sm text-white transition hover:border-white/10 hover:bg-white/10!"
                disabled={savingLanguage}
                key={languageOption.locale}
                onClick={() => saveLanguage(languageOption.locale)}
                role="menuitem"
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2 truncate">
                  {languageOption.suggested
                    ? <icon
                        className="text-purple-200"
                        title={copy.accountLanguageCountry}
                      >
                        location_on
                      </icon>
                    : null}
                  <span className="truncate">{languageOption.name}</span>
                </span>
                {languageOption.locale === selectedLanguage
                  ? <icon>check</icon>
                  : null}
              </button>,
        )}
      </div>
    </DropdownWrapper>
  );
}
