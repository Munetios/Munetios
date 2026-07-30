"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";

const tooltipSelector =
  "[data-tooltip]:not([data-tooltip='']), button[aria-label]:not([aria-label='']), a[aria-label]:not([aria-label='']), [role='button'][aria-label]:not([aria-label=''])";

function getTooltipTarget(node) {
  const target = node?.closest?.(tooltipSelector);
  if (!target || !target.closest("munetios-app")) return null;
  return target;
}

function getTooltipLabel(target) {
  const translationKey =
    target.getAttribute("data-tooltip-translate") ||
    target.getAttribute("data-translate-aria-label") ||
    target.getAttribute("data-translate-title");
  const translatedLabel = translationKey ? t()[translationKey] : null;

  return (
    translatedLabel ||
    target.getAttribute("data-tooltip") ||
    target.getAttribute("aria-label") ||
    target.getAttribute("title")
  );
}

export default function GlobalTooltips() {
  const targetRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const showTooltip = useCallback((target) => {
    if (!target || !window.location.pathname.startsWith("/apps/")) return;
    const label = getTooltipLabel(target);
    if (!label) return;

    const rect = target.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const showAbove = window.innerHeight - rect.bottom < 72 && rect.top > 72;
    targetRef.current = target;
    setTooltip({
      label,
      left: Math.min(Math.max(center, 64), window.innerWidth - 64),
      top: showAbove ? rect.top - 8 : rect.bottom + 8,
      above: showAbove,
    });
  }, []);

  const hideTooltip = useCallback((target) => {
    if (!target || targetRef.current !== target) return;
    targetRef.current = null;
    setTooltip(null);
  }, []);

  useEffect(() => {
    const onMouseOver = (event) => {
      const target = getTooltipTarget(event.target);
      if (target && !target.contains(event.relatedTarget)) showTooltip(target);
    };
    const onMouseOut = (event) => {
      const target = getTooltipTarget(event.target);
      if (target && !target.contains(event.relatedTarget)) hideTooltip(target);
    };
    const onFocusIn = (event) => showTooltip(getTooltipTarget(event.target));
    const onFocusOut = (event) => hideTooltip(getTooltipTarget(event.target));
    const clear = () => {
      targetRef.current = null;
      setTooltip(null);
    };
    const refreshTranslation = () => {
      if (targetRef.current) showTooltip(targetRef.current);
    };

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    window.addEventListener("languagechange", refreshTranslation);
    window.addEventListener("munetios:languagechange", refreshTranslation);
    window.addEventListener("munetios:localechange", refreshTranslation);

    return () => {
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
      window.removeEventListener("languagechange", refreshTranslation);
      window.removeEventListener(
        "munetios:languagechange",
        refreshTranslation,
      );
      window.removeEventListener("munetios:localechange", refreshTranslation);
    };
  }, [hideTooltip, showTooltip]);

  if (!tooltip) return null;

  return createPortal(
    <div
      className={`munetios-global-tooltip ${tooltip.above ? "is-above" : ""}`}
      role="tooltip"
      style={{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }}
    >
      {tooltip.label}
    </div>,
    document.body,
  );
}
