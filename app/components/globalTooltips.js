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
  const tooltipTranslationKey = target.getAttribute("data-tooltip-translate");
  const translatedTooltip = tooltipTranslationKey
    ? t()[tooltipTranslationKey]
    : null;
  const currentLabel =
    target.getAttribute("aria-label") ||
    target.getAttribute("data-tooltip") ||
    target.getAttribute("title");
  const fallbackTranslationKey =
    target.getAttribute("data-translate-aria-label") ||
    target.getAttribute("data-translate-title");
  const translatedFallback = fallbackTranslationKey
    ? t()[fallbackTranslationKey]
    : null;

  return translatedTooltip || currentLabel || translatedFallback;
}

export default function GlobalTooltips() {
  const observerRef = useRef(null);
  const targetRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const showTooltip = useCallback((target) => {
    if (!target || !window.location.pathname.startsWith("/apps/")) return;
    const label = getTooltipLabel(target);
    if (!label) return;

    const rect = target.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const showAbove = window.innerHeight - rect.bottom < 72 && rect.top > 72;
    observerRef.current?.disconnect();
    targetRef.current = target;
    observerRef.current = new MutationObserver(() => {
      if (targetRef.current !== target) return;
      const currentLabel = getTooltipLabel(target);
      if (!currentLabel) {
        observerRef.current?.disconnect();
        targetRef.current = null;
        setTooltip(null);
        return;
      }
      setTooltip((current) =>
        current ? { ...current, label: currentLabel } : current,
      );
    });
    observerRef.current.observe(target, {
      attributeFilter: [
        "aria-label",
        "data-tooltip",
        "data-tooltip-translate",
        "data-translate-aria-label",
        "data-translate-title",
        "title",
      ],
      attributes: true,
    });
    setTooltip({
      label,
      left: Math.min(Math.max(center, 64), window.innerWidth - 64),
      top: showAbove ? rect.top - 8 : rect.bottom + 8,
      above: showAbove,
    });
  }, []);

  const hideTooltip = useCallback((target) => {
    if (!target || targetRef.current !== target) return;
    observerRef.current?.disconnect();
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
      observerRef.current?.disconnect();
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
      observerRef.current?.disconnect();
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
      window.removeEventListener("languagechange", refreshTranslation);
      window.removeEventListener("munetios:languagechange", refreshTranslation);
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
