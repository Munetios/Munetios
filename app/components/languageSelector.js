"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale, t, translations } from "../i18n";
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

function getAutoLanguageLabel() {
  const detectedLocale = getDetectedLocale();
  const detectedLanguageName =
    translations[detectedLocale]?.languageName || detectedLocale;

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

function getLanguageOptions(preferences) {
  const suggestedLocales = getSuggestedLocales(
    resolvePreferenceCountry(preferences),
  );
  const localeEntries = Object.entries(translations).map(
    ([locale, localeCopy]) => ({
      locale,
      name: localeCopy.languageName || locale,
      suggested: suggestedLocales.includes(locale),
    }),
  );
  return [
    {
      locale: "auto",
      name: getAutoLanguageLabel(),
    },
    ...localeEntries.sort(
      (firstLanguage, secondLanguage) =>
        Number(secondLanguage.suggested) - Number(firstLanguage.suggested) ||
        firstLanguage.name.localeCompare(secondLanguage.name, "en", {
          sensitivity: "base",
        }),
    ),
  ];
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
      window.localStorage.setItem("munetiosLanguage", savedLanguage);
      window.localStorage.setItem("munetios.locale", savedLanguage);
      return savedLanguage;
    }
  } catch {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("munetiosLanguage", resolvedLanguage);
      window.localStorage.setItem("munetios.locale", resolvedLanguage);
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
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    getSavedLanguage(),
  );
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
      : translations[selectedLanguage]?.languageName || selectedLanguage;

  useEffect(() => {
    let isMounted = true;

    const refreshLanguage = () => {
      setSelectedLanguage(getSavedLanguage());
    };

    refreshLanguage();
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
        if (
          savedLanguage !==
          getCurrentLocale(window.document.documentElement.lang)
        ) {
          window.location.reload();
          return;
        }
        setSelectedLanguage(savedLanguage);
      })
      .catch(() => undefined);
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
    if (savingLanguage || language === selectedLanguage) {
      return;
    }

    setSavingLanguage(true);
    await saveLanguagePreference(language);

    if (language === "auto") {
      const detectedLocale = getDetectedLocale();
      window.document.documentElement.lang = detectedLocale;
      window.document.documentElement.dir = ["ar-SA", "he-IL"].includes(
        detectedLocale,
      )
        ? "rtl"
        : "ltr";

      const destination = getAutoLanguageDestination();
      if (destination.href !== window.location.href) {
        window.location.replace(destination.href);
        return;
      }
    }

    window.location.reload();
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
        {languageOptions.map((languageOption) => (
          <button
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent bg-transparent px-3 py-2 text-left text-sm text-white transition hover:border-white/10 hover:bg-white/10!"
            key={languageOption.locale}
            disabled={savingLanguage}
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
          </button>
        ))}
      </div>
    </DropdownWrapper>
  );
}
