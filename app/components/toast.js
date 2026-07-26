"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentLocale, t } from "../i18n";

const listeners = new Set();
const pendingToasts = [];
const defaultDuration = 4200;

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

  return copy[messageKey] || "";
}

function getToastId(toast) {
  return (
    toast.toastId ||
    `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );
}

function createToast(input, options = {}) {
  const toast =
    typeof input === "string"
      ? { message: input, ...options }
      : { ...input, ...options };

  return {
    id: getToastId(toast),
    duration:
      typeof toast.duration === "number" ? toast.duration : defaultDuration,
    message: getTranslatedMessage(toast),
    title: toast.title || "",
    type: toast.type || "info",
  };
}

export function showToast(input, options) {
  const toast = createToast(input, options);

  if (listeners.size === 0) {
    pendingToasts.push(toast);
    return toast.id;
  }

  for (const listener of listeners) {
    listener(toast);
  }

  return toast.id;
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
        window.setTimeout(() => {
          setToasts((currentToasts) =>
            currentToasts.filter(
              (currentToast) => currentToast.id !== toast.id,
            ),
          );
        }, toast.duration),
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
      className="pointer-events-none fixed right-3 top-3 z-[2147483647] flex w-[calc(100vw-1.5rem)] flex-col items-end gap-2 sm:w-80"
    >
      {toasts.map((toast) => (
        <div
          className={`munetios-toast-enter liquid-glass pointer-events-auto flex w-full items-center gap-2 rounded-xl border p-2 text-white shadow-2xl ${getToastContainerStyle(toast.type)}`}
          key={toast.id}
        >
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${getToastIconStyle(toast.type)} ${getToastTone(toast.type)}`}
          >
            <icon>{getToastIcon(toast.type)}</icon>
          </div>
          <div className="min-w-0 flex-1">
            {toast.title
              ? <p className="text-sm font-bold leading-5">{toast.title}</p>
              : null}
            {toast.message
              ? <p className="text-sm leading-6 text-white/75">
                  {toast.message}
                </p>
              : null}
          </div>
        </div>
      ))}
    </output>
  );
}
