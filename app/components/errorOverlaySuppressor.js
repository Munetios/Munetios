"use client";

import { useEffect } from "react";
import { showErrorToast } from "./errorToast";

const overlaySelectors = [
  "nextjs-portal",
  "script[data-nextjs-dev-overlay]",
  "[data-nextjs-dev-overlay]",
  "[data-nextjs-dialog-overlay]",
  "[data-nextjs-error-overlay-nav]",
  "[data-nextjs-toast]",
];

const injectedScriptMarkers = [
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  "ms-browser-extension://",
  "extension://",
  "userscript",
  "user-script",
  "tampermonkey",
  "violentmonkey",
  "greasemonkey",
  "content_script",
  "content-script",
  "injected",
];

const appSourceMarkers = [
  "/_next/",
  "webpack-internal:///(app-pages-browser)",
  "webpack-internal:///(pages-dir-browser)",
  "next/dist/",
  "react-dom",
];

function hideElement(element) {
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("hidden", "");
  element.style.display = "none";
  element.style.pointerEvents = "none";
  element.style.visibility = "hidden";
}

function suppressNextOverlay() {
  if (!document.body) {
    return;
  }

  for (const selector of overlaySelectors) {
    for (const element of document.querySelectorAll(selector)) {
      hideElement(element);
    }
  }

  for (const element of document.body.children) {
    const tagName = element.tagName.toLowerCase();

    if (
      tagName.includes("nextjs") ||
      element.matches("[data-nextjs-dev-overlay]")
    ) {
      hideElement(element);
    }
  }
}

function getErrorText(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return [
    value.message,
    value.stack,
    value.fileName,
    value.filename,
    value.sourceURL,
    value.name,
  ]
    .filter(Boolean)
    .join("\n");
}

function getEventErrorText(event) {
  if (event instanceof ErrorEvent) {
    return [event.message, event.filename, getErrorText(event.error)]
      .filter(Boolean)
      .join("\n");
  }

  return getErrorText(event.reason);
}

function hasMarker(value, markers) {
  const normalized = value.toLowerCase();

  return markers.some((marker) => normalized.includes(marker));
}

function isSameOriginSource(source) {
  if (!source || typeof window === "undefined") {
    return false;
  }

  try {
    return (
      new URL(source, window.location.href).origin === window.location.origin
    );
  } catch {
    return source.startsWith("/") || source.startsWith(".");
  }
}

function isInjectedScriptFailure(event) {
  if (event instanceof ErrorEvent) {
    const source = event.filename || "";
    const text = getEventErrorText(event);

    if (event.message === "Script error." && !source && !event.error) {
      return true;
    }

    if (source && !isSameOriginSource(source)) {
      return true;
    }

    if (source === window.location.href && !hasMarker(text, appSourceMarkers)) {
      return true;
    }

    return hasMarker(text, injectedScriptMarkers);
  }

  return hasMarker(getEventErrorText(event), injectedScriptMarkers);
}

function isAppRuntimeFailure(event) {
  if (event instanceof ErrorEvent) {
    if (event.target !== window || !(event.error || event.message)) {
      return false;
    }

    const source = event.filename || "";
    const text = getEventErrorText(event);

    return (
      hasMarker(text, appSourceMarkers) ||
      (source && isSameOriginSource(source) && source !== window.location.href)
    );
  }

  if (!("reason" in event) || !event.reason) {
    return false;
  }

  return hasMarker(getEventErrorText(event), appSourceMarkers);
}

export default function ErrorOverlaySuppressor() {
  useEffect(() => {
    suppressNextOverlay();

    const observer = new MutationObserver(suppressNextOverlay);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const showErrorPage = (event) => {
      if (isInjectedScriptFailure(event)) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        showErrorToast();
        suppressNextOverlay();
        return;
      }

      if (!isAppRuntimeFailure(event)) {
        suppressNextOverlay();
        return;
      }

      const isRouterError =
        event?.error?.digest === "NEXT_REDIRECT" ||
        event?.error?.digest === "NEXT_NOT_FOUND" ||
        event?.reason?.digest === "NEXT_REDIRECT" ||
        event?.reason?.digest === "NEXT_NOT_FOUND";

      if (!isRouterError) showErrorToast();

      suppressNextOverlay();
    };

    window.addEventListener("error", showErrorPage, true);
    window.addEventListener("unhandledrejection", showErrorPage, true);

    return () => {
      window.removeEventListener("error", showErrorPage, true);
      window.removeEventListener("unhandledrejection", showErrorPage, true);
    };
  }, []);

  return null;
}
