"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale, setCurrentLocale, t, translations } from "../i18n";
import DropdownWrapper from "./dropdownwrapper";

const languageUrl = "/api/language";

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

function getLanguageOptions() {
  return [
    {
      locale: "auto",
      name: getAutoLanguageLabel(),
    },
    ...Object.entries(translations)
      .map(([locale, localeCopy]) => ({
        locale,
        name: localeCopy.languageName || locale,
      }))
      .sort((firstLanguage, secondLanguage) =>
        firstLanguage.name.localeCompare(secondLanguage.name, "en", {
          sensitivity: "base",
        }),
      ),
  ];
}

async function saveLanguagePreference(language) {
  if (language === "auto") {
    if (typeof window !== "undefined") {
      const detectedLocale = getDetectedLocale();
      setCurrentLocale(detectedLocale);

      window.localStorage.removeItem("munetiosLanguage");
      window.localStorage.removeItem("munetios.locale");
      window.document.cookie =
        "munetios_locale=; Path=/; Max-Age=0; SameSite=Lax";
    }

    return "auto";
  }

  const resolvedLanguage = setCurrentLocale(language);

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
      return setCurrentLocale(payload.language);
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
  const copy =
    providedCopy ||
    t(selectedLanguage === "auto" ? getDetectedLocale() : selectedLanguage);
  const languageOptions = useMemo(() => getLanguageOptions(), []);
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

        setSelectedLanguage(setCurrentLocale(language));
      })
      .catch(() => undefined);
    window.addEventListener("languagechange", refreshLanguage);
    window.addEventListener("munetios:languagechange", refreshLanguage);
    window.addEventListener("munetios:localechange", refreshLanguage);

    return () => {
      isMounted = false;
      window.removeEventListener("languagechange", refreshLanguage);
      window.removeEventListener("munetios:languagechange", refreshLanguage);
      window.removeEventListener("munetios:localechange", refreshLanguage);
    };
  }, []);

  const saveLanguage = async (language) => {
    const resolvedLanguage = await saveLanguagePreference(language);
    setSelectedLanguage(resolvedLanguage);
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
            onClick={() => saveLanguage(languageOption.locale)}
            role="menuitem"
            type="button"
          >
            <span className="min-w-0 truncate">{languageOption.name}</span>
            {languageOption.locale === selectedLanguage ? (
              <icon>check</icon>
            ) : null}
          </button>
        ))}
      </div>
    </DropdownWrapper>
  );
}
