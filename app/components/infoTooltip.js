"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";

const viewportPadding = 8;
const tooltipWidth = 352;

export default function InfoTooltip({ label, text }) {
  const triggerRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({
    bottom: "auto",
    left: 8,
    right: "auto",
    top: 8,
  });
  const [tooltips, setTooltips] = useState([
    { id: `info-template-${label}`, visible: false },
  ]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(
      tooltipWidth,
      window.innerWidth - viewportPadding * 2,
    );
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const estimatedHeight = 168;
    const openAbove =
      window.innerHeight - rect.bottom < estimatedHeight + viewportPadding &&
      rect.top > estimatedHeight;
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - estimatedHeight - viewportPadding)
      : Math.min(
          rect.bottom + viewportPadding,
          window.innerHeight - estimatedHeight - viewportPadding,
        );
    setPosition({ bottom: "auto", left, right: "auto", top });
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!tooltips.some((tooltip) => tooltip.visible)) return undefined;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [tooltips, updatePosition]);

  if (!text) return null;

  const closeTooltip = (tooltipId) => {
    setTooltips((current) =>
      current.map((tooltip) =>
        tooltip.id === tooltipId ? { ...tooltip, visible: false } : tooltip,
      ),
    );
  };

  return (
    <span className="munetios-info-tooltip-root">
      <button
        aria-label={label}
        className="munetios-info-tooltip-trigger liquid-glass"
        onClick={() => {
          updatePosition();
          setTooltips((current) => [
            ...current,
            {
              id:
                globalThis.crypto?.randomUUID?.() ||
                `info-${Date.now()}-${Math.random()}`,
              visible: true,
            },
          ]);
        }}
        ref={triggerRef}
        type="button"
      >
        <icon>info</icon>
      </button>
      {mounted
        ? tooltips.map((tooltip) =>
            createPortal(
              <span
                className="munetios-info-tooltip liquid-glass"
                hidden={!tooltip.visible}
                key={tooltip.id}
                role="tooltip"
                style={position}
              >
                <span>{text}</span>
                <button
                  aria-label={t().modalClose}
                  onClick={() => closeTooltip(tooltip.id)}
                  type="button"
                >
                  <icon>close</icon>
                </button>
              </span>,
              document.body,
              tooltip.id,
            ),
          )
        : null}
    </span>
  );
}
