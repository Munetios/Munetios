"use client";

import { useEffect } from "react";
import {
  getCurrentLocale,
  getLocaleDirection,
  getUrlLocaleOverride,
  setCurrentLocale,
  t,
  translations,
} from "../i18n";

const translatedAttributes = [
  ["data-translate-alt", "alt"],
  ["data-translate-aria-label", "aria-label"],
  ["data-translate-placeholder", "placeholder"],
  ["data-translate-title", "title"],
];

const translatedSelector = [
  "[data-translate]",
  ...translatedAttributes.map(([attribute]) => `[${attribute}]`),
].join(",");

export default function DataTranslateRuntime() {
  useEffect(() => {
    const getLocale = () => getCurrentLocale();
    const translate = (root = document) => {
      const locale = getLocale();
      const direction = getLocaleDirection(locale);
      const copy = t(locale);
      const elements = new Set();

      if (document.documentElement.lang !== locale) {
        document.documentElement.lang = locale;
      }
      if (document.documentElement.dir !== direction) {
        document.documentElement.dir = direction;
      }

      if (root.matches?.(translatedSelector)) {
        elements.add(root);
      }

      for (const element of root.querySelectorAll?.(translatedSelector) || []) {
        elements.add(element);
      }

      for (const element of elements) {
        const key =
          element.getAttribute("data-translate")?.trim() ||
          element.textContent.trim();
        const value = copy[key] ?? translations.en[key];

        if (element.hasAttribute("data-translate") && value) {
          element.textContent = value;
        }

        for (const [
          keyAttribute,
          translatedAttribute,
        ] of translatedAttributes) {
          const attributeKey = element.getAttribute(keyAttribute)?.trim();
          const attributeValue =
            copy[attributeKey] ?? translations.en[attributeKey];

          if (attributeKey && attributeValue) {
            element.setAttribute(translatedAttribute, attributeValue);
          }
        }
      }
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          translate(mutation.target);
          continue;
        }

        for (const node of mutation.addedNodes) {
          translate(node);
        }
      }
    });
    const refreshTranslations = () => {
      translate();
    };
    const applyUrlLocale = () => {
      const locale = getUrlLocaleOverride();

      if (locale) {
        setCurrentLocale(locale);
      }

      translate();
    };

    applyUrlLocale();
    observer.observe(document.documentElement, {
      attributeFilter: [
        "data-translate",
        ...translatedAttributes.map(([attribute]) => attribute),
      ],
      attributes: true,
      childList: true,
      subtree: true,
    });

    window.addEventListener("languagechange", refreshTranslations);
    window.addEventListener("hashchange", applyUrlLocale);
    window.addEventListener("munetios:languagechange", refreshTranslations);
    window.addEventListener("munetios:localechange", refreshTranslations);

    return () => {
      observer.disconnect();
      window.removeEventListener("languagechange", refreshTranslations);
      window.removeEventListener("hashchange", applyUrlLocale);
      window.removeEventListener(
        "munetios:languagechange",
        refreshTranslations,
      );
      window.removeEventListener("munetios:localechange", refreshTranslations);
    };
  }, []);

  return null;
}
