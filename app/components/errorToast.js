"use client";

import { useEffect, useState } from "react";
import { t } from "../i18n";
import { TOAST_STACKING_LAYER } from "./layering";
import { showToast, ToastMessage } from "./toast";

let lastErrorToastAt = 0;
const errorToastDelayMs = 1500;

export function showErrorToast() {
  const now = Date.now();
  if (now - lastErrorToastAt < errorToastDelayMs) return;
  lastErrorToastAt = now;
  showToast({
    messageKey: "errorOccurredToast",
    toastId: "app-error",
    type: "error",
  });
}

export default function ErrorToast({ error }) {
  const [visible, setVisible] = useState(true);
  const [copy, setCopy] = useState(() => t());

  useEffect(() => {
    void error;
    const timeout = window.setTimeout(() => setVisible(false), 4200);
    const refreshCopy = () => setCopy(t());
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, [error]);

  if (!visible) return null;

  return (
    <output
      aria-label={copy.toastRegionLabel}
      aria-live="polite"
      className="pointer-events-none fixed right-3 top-3 flex w-[calc(100vw-1.5rem)] flex-col items-end gap-2 sm:w-80"
      style={{ zIndex: TOAST_STACKING_LAYER }}
    >
      <ToastMessage message={copy.errorOccurredToast} type="error" />
    </output>
  );
}
