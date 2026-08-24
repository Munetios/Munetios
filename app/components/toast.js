"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale, t } from "../i18n";
import { TOAST_STACKING_LAYER } from "./layering";

const listeners = new Set();
const pendingToasts = [];
const defaultDuration = 4200;
let errorToastSequence = 0;

function getToastLocale(locale) {
  if (locale) {
    return locale;
  }

  if (typeof window === "undefined") {
    return "en";
  }

  return getCurrentLocale();
}

function getTranslatedMessage(toast) {
  if (toast.message) {
    return toast.message;
  }

  const messageKey = toast.messageKey || toast.translationKey || toast.id;
  const copy = t(getToastLocale(toast.locale || toast.language));

  return (
    copy[messageKey] ||
    copy.errorOccurredToast ||
    t("en").errorOccurredToast ||
    "An error occured"
  );
}

function getToastId(toast) {
  const baseId = toast.toastId || "toast";
  return `${baseId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createToast(input, options = {}) {
  const toast =
    typeof input === "string"
      ? { message: input, ...options }
      : { ...input, ...options };

  return {
    createdAt: Date.now(),
    id: getToastId(toast),
    duration:
      typeof toast.duration === "number" ? toast.duration : defaultDuration,
    message: getTranslatedMessage(toast),
    title: toast.title || "",
    type: toast.type || "info",
  };
}

function isFetchFailureToast(input, options = {}) {
  const toast =
    typeof input === "string"
      ? { message: input, ...options }
      : { ...input, ...options };
  const messageKey = toast.messageKey || toast.translationKey || toast.id;
  if (messageKey === "fetchError") return true;

  return (
    typeof toast.message === "string" &&
    toast.message
      .trim()
      .replace(/[.!]+$/u, "")
      .toLowerCase() === "failed to fetch"
  );
}

export function showToast(input, options) {
  if (isFetchFailureToast(input, options)) return null;

  const toast = createToast(input, options);
  if (toast.type === "error") errorToastSequence += 1;

  if (listeners.size === 0) {
    pendingToasts.push(toast);
    return toast.id;
  }

  for (const listener of listeners) {
    listener(toast);
  }

  return toast.id;
}

export function getErrorToastSequence() {
  return errorToastSequence;
}

function subscribe(listener) {
  listeners.add(listener);

  while (pendingToasts.length > 0) {
    listener(pendingToasts.shift());
  }

  return () => {
    listeners.delete(listener);
  };
}

function getToastIcon(type) {
  if (type === "success") return "check_circle";
  if (type === "error") return "error";
  if (type === "warning") return "warning";

  return "info";
}

function getToastTone(type) {
  if (type === "success") return "text-emerald-200";
  if (type === "error") return "text-rose-200";
  if (type === "warning") return "text-amber-200";

  return "text-purple-100";
}

function getToastContainerStyle(type) {
  if (type === "success") {
    return "border-emerald-300/20 bg-emerald-950/80!";
  }
  if (type === "error") {
    return "border-rose-300/20 bg-rose-950/80!";
  }
  if (type === "warning") {
    return "border-amber-300/20 bg-amber-950/80!";
  }

  return "border-purple-200/15 bg-purple-950/80!";
}

function getToastIconStyle(type) {
  if (type === "success") {
    return "bg-emerald-400/15!";
  }
  if (type === "error") {
    return "bg-rose-400/15!";
  }
  if (type === "warning") {
    return "bg-amber-400/15!";
  }

  return "bg-purple-400/15!";
}

export function ToastMessage({ message, title = "", type = "info" }) {
  return (
    <div
      className={`munetios-toast-enter liquid-glass pointer-events-auto flex w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-white shadow-2xl ${getToastContainerStyle(type)}`}
    >
      <div
        className={`munetios-toast-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${getToastIconStyle(type)} ${getToastTone(type)}`}
      >
        <icon>{getToastIcon(type)}</icon>
      </div>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-bold leading-5">{title}</p> : null}
        {message
          ? <p className="text-sm leading-5 text-white/75">{message}</p>
          : null}
      </div>
    </div>
  );
}

export default function ToastProvider() {
  const copy = useMemo(() => t("en"), []);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    window.showToast = showToast;

    return subscribe((toast) => {
      setToasts((currentToasts) => [...currentToasts, toast]);
    });
  }, []);

  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.duration > 0)
      .map((toast) =>
        window.setTimeout(
          () => {
            setToasts((currentToasts) =>
              currentToasts.filter(
                (currentToast) => currentToast.id !== toast.id,
              ),
            );
          },
          Math.max(0, toast.duration - (Date.now() - toast.createdAt)),
        ),
      );

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [toasts]);

  return (
    <output
      aria-label={copy.toastRegionLabel}
      aria-live="polite"
      className="pointer-events-none fixed right-3 top-3 flex w-[calc(100vw-1.5rem)] flex-col items-end gap-2 sm:w-80"
      style={{ zIndex: TOAST_STACKING_LAYER }}
    >
      {toasts.map((toast) => (
        <ToastMessage
          key={toast.id}
          message={toast.message}
          title={toast.title}
          type={toast.type}
        />
      ))}
    </output>
  );
}
