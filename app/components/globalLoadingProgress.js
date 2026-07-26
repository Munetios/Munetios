"use client";

import { Suspense, useEffect, useRef, useState } from "react";

function GlobalLoadingProgressContent() {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const [locationKey, setLocationKey] = useState(() => {
    if (typeof window === "undefined") {
      return "__initial__";
    }

    const { pathname, search } = window.location;
    return search ? `${pathname}${search}` : pathname;
  });
  const intervalRef = useRef(null);
  const stepTimerRef = useRef(null);
  const finishTimerRef = useRef(null);
  const hideTimerRef = useRef(null);

  const clearTimers = () => {
    window.clearTimeout(stepTimerRef.current);
    window.clearInterval(intervalRef.current);
    window.clearTimeout(finishTimerRef.current);
    window.clearTimeout(hideTimerRef.current);
    stepTimerRef.current = null;
    intervalRef.current = null;
    finishTimerRef.current = null;
    hideTimerRef.current = null;
  };

  const startProgress = (customDuration) => {
    clearTimers();

    const baseDuration = customDuration ?? 1200;
    const navigationSpeed =
      typeof window !== "undefined" && "performance" in window
        ? Math.min(1.6, Math.max(0.4, window.performance?.now?.() / 12000 || 1))
        : 1;
    const effectiveDuration = Math.max(900, baseDuration / navigationSpeed);

    setVisible(true);
    setProgress(10);

    stepTimerRef.current = window.setTimeout(() => setProgress(36), 140);
    intervalRef.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 90) return current;
        const delta =
          current < 28 ? 6 + Math.random() * 5 : 2 + Math.random() * 4;
        const speedFactor = current < 55 ? 1.05 : 0.8;
        return Math.min(90, Number((current + delta * speedFactor).toFixed(1)));
      });
    }, 180);

    finishTimerRef.current = window.setTimeout(() => {
      setProgress(100);
      hideTimerRef.current = window.setTimeout(() => setVisible(false), 320);
    }, effectiveDuration);
  };

  useEffect(() => {
    const updateLocationKey = () => {
      if (typeof window === "undefined") {
        return;
      }

      const { pathname, search } = window.location;
      const nextKey = search ? `${pathname}${search}` : pathname;
      setLocationKey((current) => (current === nextKey ? current : nextKey));
    };

    updateLocationKey();

    const baseDuration = 1200;
    const navigationSpeed =
      typeof window !== "undefined" && "performance" in window
        ? Math.min(1.6, Math.max(0.4, window.performance?.now?.() / 12000 || 1))
        : 1;
    const effectiveDuration = Math.max(900, baseDuration / navigationSpeed);

    startProgress(effectiveDuration);

    const handlePopState = () => {
      updateLocationKey();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      clearTimers();
    };
  }, [locationKey]);

  useEffect(() => {
    const handleInteraction = (event) => {
      const trigger =
        event.target instanceof Element
          ? event.target.closest("a, button, [role='button']")
          : null;

      if (!trigger || trigger.closest("[data-no-loading]")) return;

      const isLink = trigger.tagName === "A";
      const duration = isLink ? 1100 : 900;
      startProgress(duration);
    };

    const handleSubmit = (event) => {
      const form =
        event.target instanceof HTMLFormElement ? event.target : null;
      if (!form || form.closest("[data-no-loading]")) return;
      startProgress(1000);
    };

    document.addEventListener("click", handleInteraction, true);
    document.addEventListener("submit", handleSubmit, true);

    return () => {
      document.removeEventListener("click", handleInteraction, true);
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`global-loading-progress-shell ${visible ? "is-visible" : ""}`}
    >
      <div
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(progress)}
        className="global-loading-progress-bar"
        role="progressbar"
        style={{ width: `${Math.max(progress, 8)}%` }}
      />
    </div>
  );
}

export default function GlobalLoadingProgress() {
  return (
    <Suspense fallback={null}>
      <GlobalLoadingProgressContent />
    </Suspense>
  );
}
