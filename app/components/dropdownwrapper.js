"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { DROPDOWN_STACKING_LAYER } from "./layering";

const openDropdowns = new Map();

function isDropdownInteractionTarget(target) {
  return Boolean(
    target?.closest?.(
      "[data-munetios-dropdown-root='true'], [data-munetios-dropdown-portal='true']",
    ),
  );
}

function getLatestOpenDropdown() {
  return Array.from(openDropdowns.values()).at(-1);
}

function closeStackedDropdowns(currentDropdownId) {
  for (const [dropdownId, dropdown] of openDropdowns) {
    if (dropdownId !== currentDropdownId) {
      dropdown.close?.();
      openDropdowns.delete(dropdownId);
    }
  }
}

function getDropdownStackIndex(dropdownId) {
  return Math.max(0, Array.from(openDropdowns.keys()).indexOf(dropdownId));
}

export default function DropdownWrapper({
  align = "right",
  ariaLabel,
  buttonClassName = "",
  children = null,
  className = "",
  icon = "expand_more",
  label,
  openOnHover = false,
  panelClassName = "",
  persistent = false,
  placement = "bottom",
  trigger = null,
  triggerAs = "div",
  triggerGlass = true,
  triggerId,
  translationKey,
  zIndex = DROPDOWN_STACKING_LAYER,
}) {
  const copy = t("en");
  const dropdownId = useId();
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const closeTimerRef = useRef(null);
  const panelRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [persistentOpenCount, setPersistentOpenCount] = useState(0);
  const [panelPosition, setPanelPosition] = useState({
    left: 8,
    maxHeight: null,
    right: null,
    top: 48,
  });
  const isOpen = persistent ? persistentOpenCount > 0 : open;

  const updatePanelPosition = useCallback(() => {
    const triggerElement = rootRef.current;
    if (!triggerElement) {
      return;
    }

    const rect = triggerElement.getBoundingClientRect();
    const viewportPadding = 8;
    const fallbackPanelWidth = placement === "side" ? 352 : 240;
    const fallbackPanelHeight = placement === "side" ? 320 : 288;
    const viewportHeight = window.innerHeight;
    const panelWidth = Math.min(
      panelRef.current?.offsetWidth || fallbackPanelWidth,
      window.innerWidth - viewportPadding * 2,
    );
    const panelHeight = Math.min(
      panelRef.current?.offsetHeight || fallbackPanelHeight,
      Math.max(120, viewportHeight - viewportPadding * 2),
    );
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - panelWidth - viewportPadding,
    );
    const maxTop = Math.max(
      viewportPadding,
      viewportHeight - panelHeight - viewportPadding,
    );
    const isRtl = document.documentElement.dir === "rtl";
    const clampLeft = (left) =>
      Math.min(Math.max(viewportPadding, left), maxLeft);
    const clampTop = (top) => Math.min(Math.max(viewportPadding, top), maxTop);

    if (placement === "side") {
      const openAfterTrigger = align === "left" || (align === "right" && isRtl);
      const preferredLeft = openAfterTrigger
        ? rect.right + viewportPadding
        : rect.left - panelWidth - viewportPadding;
      const nextTop = clampTop(rect.top);
      setPanelPosition({
        left: clampLeft(preferredLeft),
        maxHeight: Math.max(120, viewportHeight - nextTop - viewportPadding),
        right: null,
        top: nextTop,
      });
      return;
    }

    const preferredLeft =
      align === "left" ? rect.left : rect.right - panelWidth;
    const availableBelow = viewportHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove =
      availableBelow < panelHeight && availableAbove > availableBelow;
    const nextTop = clampTop(
      openAbove
        ? rect.top - panelHeight - viewportPadding
        : rect.bottom + viewportPadding,
    );
    setPanelPosition({
      left: clampLeft(preferredLeft),
      maxHeight: Math.max(
        120,
        openAbove
          ? rect.top - viewportPadding * 2
          : viewportHeight - nextTop - viewportPadding,
      ),
      right: null,
      top: nextTop,
    });
  }, [align, placement]);

  useEffect(() => {
    setMounted(true);

    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      openDropdowns.delete(dropdownId);
      return;
    }

    openDropdowns.delete(dropdownId);
    openDropdowns.set(dropdownId, {
      buttonRef,
      close: () => {
        if (persistent) {
          setPersistentOpenCount((currentCount) =>
            Math.max(0, currentCount - 1),
          );
          return;
        }

        setOpen(false);
      },
      id: dropdownId,
      openCount: persistentOpenCount,
      panelRef,
      rootRef,
    });
    updatePanelPosition();

    const onPointerDown = (event) => {
      if (isDropdownInteractionTarget(event.target)) {
        return;
      }

      setOpen(false);
    };

    const onKeyDown = (event) => {
      if (
        event.key === "Escape" &&
        getLatestOpenDropdown()?.id === dropdownId
      ) {
        if (persistent) {
          setPersistentOpenCount((currentCount) =>
            Math.max(0, currentCount - 1),
          );
        } else {
          setOpen(false);
        }
        buttonRef.current?.focus();
      }
    };

    if (!persistent) {
      window.addEventListener("pointerdown", onPointerDown);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    window.addEventListener("munetios:localechange", updatePanelPosition);

    return () => {
      openDropdowns.delete(dropdownId);
      if (!persistent) {
        window.removeEventListener("pointerdown", onPointerDown);
      }
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      window.removeEventListener("munetios:localechange", updatePanelPosition);
    };
  }, [
    dropdownId,
    isOpen,
    persistent,
    persistentOpenCount,
    updatePanelPosition,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      updatePanelPosition();
      panelRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isOpen, updatePanelPosition]);

  const openDropdown = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    updatePanelPosition();
    if (persistent) {
      setPersistentOpenCount((currentCount) => currentCount + 1);
      return;
    }

    closeStackedDropdowns(dropdownId);
    setOpen(true);
  };

  const closeDropdown = () => {
    if (persistent) {
      return;
    }

    if (openOnHover) {
      closeTimerRef.current = window.setTimeout(() => {
        setOpen(false);
      }, 350);
      return;
    }

    setOpen(false);
  };

  const toggleDropdown = () => {
    updatePanelPosition();
    if (persistent) {
      setPersistentOpenCount((currentCount) => currentCount + 1);
      return;
    }

    if (open) {
      setOpen(false);
      return;
    }

    closeStackedDropdowns(dropdownId);
    setOpen(true);
  };

  const onTriggerKeyDown = (event) => {
    if (
      triggerAs !== "button" &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      toggleDropdown();
    }
  };

  const shouldCloseAfterMenuAction = (target) => {
    if (
      target?.closest?.(
        "[data-dropdown-keep-open='true'], [data-munetios-dropdown-root='true']",
      )
    ) {
      return false;
    }

    return Boolean(
      target?.closest?.("[role='menuitem'], [data-dropdown-close]"),
    );
  };

  const closeAfterMenuAction = () => {
    if (persistent) {
      setPersistentOpenCount((currentCount) => Math.max(0, currentCount - 1));
    } else {
      setOpen(false);
    }
    buttonRef.current?.focus();
  };

  const closeOnMenuItemClick = (event) => {
    if (shouldCloseAfterMenuAction(event.target)) {
      closeAfterMenuAction();
    }
  };

  const closeOnMenuItemKeyDown = (event) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      shouldCloseAfterMenuAction(event.target)
    ) {
      window.setTimeout(() => {
        closeAfterMenuAction();
      }, 0);
    }
  };

  const TriggerElement = triggerAs === "button" ? "button" : "div";
  const triggerSurfaceClassName = triggerGlass
    ? "liquid-glass border border-white/10 bg-purple-900/50!"
    : "";
  const triggerClassName =
    triggerAs === "button"
      ? `${triggerSurfaceClassName} flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white transition ${buttonClassName}`
      : `${triggerSurfaceClassName} flex h-10 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white transition ${buttonClassName}`;
  const renderedPanelCount = persistent ? persistentOpenCount : isOpen ? 1 : 0;
  const controlledPanelId = persistent
    ? `${dropdownId}-${Math.max(1, persistentOpenCount)}`
    : dropdownId;

  return (
    <fieldset
      className={`relative inline-flex border-0 p-0 ${className}`}
      data-munetios-dropdown-root="true"
      onMouseEnter={openOnHover && !persistent ? openDropdown : undefined}
      onMouseLeave={openOnHover && !persistent ? closeDropdown : undefined}
      ref={rootRef}
    >
      <TriggerElement
        aria-controls={isOpen ? controlledPanelId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={ariaLabel || label || copy.dropdownToggle}
        className={triggerClassName}
        data-tooltip-translate={translationKey}
        data-translate-aria-label={translationKey}
        id={triggerId}
        onClick={toggleDropdown}
        onKeyDown={onTriggerKeyDown}
        ref={buttonRef}
        role={triggerAs === "button" ? undefined : "button"}
        tabIndex={triggerAs === "button" ? undefined : 0}
        type={triggerAs === "button" ? "button" : undefined}
      >
        {trigger || (
          <>
            {label ? <span>{label}</span> : null}
            <icon>{icon}</icon>
          </>
        )}
      </TriggerElement>

      {mounted
        ? Array.from({ length: renderedPanelCount }, (_, panelIndex) => {
            const panelId = persistent
              ? `${dropdownId}-${panelIndex + 1}`
              : dropdownId;

            return createPortal(
              <div
                className={`munetios-dropdown-enter liquid-glass fixed z-[100000003] min-w-48 rounded-xl border border-white/10 bg-purple-950/10! p-2 text-white shadow-2xl ${panelClassName}`}
                data-munetios-dropdown-portal="true"
                id={panelId}
                onClick={closeOnMenuItemClick}
                onKeyDown={closeOnMenuItemKeyDown}
                onMouseEnter={
                  openOnHover && !persistent ? openDropdown : undefined
                }
                onMouseLeave={
                  openOnHover && !persistent ? closeDropdown : undefined
                }
                ref={
                  !persistent || panelIndex === renderedPanelCount - 1
                    ? panelRef
                    : undefined
                }
                role="menu"
                style={{
                  left:
                    typeof panelPosition.left === "number"
                      ? `${panelPosition.left}px`
                      : undefined,
                  right:
                    typeof panelPosition.right === "number"
                      ? `${panelPosition.right}px`
                      : undefined,
                  maxHeight:
                    typeof panelPosition.maxHeight === "number"
                      ? `${panelPosition.maxHeight}px`
                      : undefined,
                  overflowY:
                    typeof panelPosition.maxHeight === "number"
                      ? "auto"
                      : undefined,
                  top: `${panelPosition.top}px`,
                  zIndex:
                    Math.max(DROPDOWN_STACKING_LAYER, zIndex) +
                    getDropdownStackIndex(dropdownId) * 100 +
                    panelIndex,
                }}
                tabIndex={-1}
              >
                {children}
              </div>,
              document.body,
              panelId,
            );
          })
        : null}
    </fieldset>
  );
}
