"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";

const viewportPadding = 8;
const wrapperWidth = 500;
const wrapperHeight = 767;

export function AppLauncherFrame({
  copy = t("en"),
  src = "/applauncher.html",
  title = copy.appLauncherFrameTitle || copy.appLauncherTitle,
}) {
  return (
    <div
      className="munetios-dropdown-enter liquid-glass h-[min(767px,calc(100dvh-5rem))] w-[min(500px,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-white/10 bg-purple-950/35! text-white shadow-2xl shadow-purple-950/25"
      data-munetios-app-launcher-frame="true"
    >
      <iframe
        className="h-full w-full border-0 bg-transparent"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={src}
        title={title}
      />
    </div>
  );
}

export default function AppLauncherWrapper({
  copy = t("en"),
  onClose,
  open = false,
  panelId = "appsWrapper",
  src = "/applauncher.html",
  triggerRef,
}) {
  const panelRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [panelPosition, setPanelPosition] = useState({
    left: viewportPadding,
    top: 72,
  });

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef?.current;

    if (!trigger || typeof window === "undefined") {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(
      window.innerWidth - viewportPadding * 2,
      wrapperWidth,
    );
    const panelHeight = Math.min(
      window.innerHeight - viewportPadding * 2,
      wrapperHeight,
    );
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - panelWidth - viewportPadding,
    );
    const maxTop = Math.max(
      viewportPadding,
      window.innerHeight - panelHeight - viewportPadding,
    );
    const isRtl = document.documentElement.dir === "rtl";
    const preferredLeft = isRtl ? rect.left : rect.right - panelWidth;
    const preferredTop = rect.bottom + viewportPadding;

    setPanelPosition({
      left: Math.min(Math.max(viewportPadding, preferredLeft), maxLeft),
      top: Math.min(Math.max(viewportPadding, preferredTop), maxTop),
    });
  }, [triggerRef]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updatePanelPosition();

    const closePanel = () => {
      onClose?.();
    };

    const onPointerDown = (event) => {
      if (
        panelRef.current?.contains(event.target) ||
        triggerRef?.current?.contains(event.target) ||
        event.target.closest?.("[data-munetios-dropdown-portal='true']")
      ) {
        return;
      }

      closePanel();
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closePanel();
        triggerRef?.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    window.addEventListener("munetios:localechange", updatePanelPosition);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      window.removeEventListener("munetios:localechange", updatePanelPosition);
    };
  }, [onClose, open, triggerRef, updatePanelPosition]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed z-[1100]"
      data-munetios-app-launcher-wrapper="true"
      id={panelId}
      ref={panelRef}
      style={{
        left: `${panelPosition.left}px`,
        top: `${panelPosition.top}px`,
      }}
    >
      <AppLauncherFrame copy={copy} src={src} />
    </div>,
    document.body,
  );
}
