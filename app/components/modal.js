"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { MODAL_STACKING_LAYER } from "./layering";

const listeners = new Set();
const dismissListeners = new Set();
const pendingModals = [];

function createModal(content = null, options = {}) {
  const modal =
    typeof content === "object" && content !== null && !("type" in content)
      ? { content: null, ...content }
      : { content, ...options };
  const isOmniWrite =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/apps/omniwrite");
  const isMunetiosAi =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/apps/ai");
  const isAiStyled = modal.aiStyled === true || isMunetiosAi;
  const clickThrough = modal.clickThrough === true || isMunetiosAi;
  const modalGroupId = modal.modalId || "";

  return {
    id: `${modalGroupId || "modal"}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ariaLabel: modal.ariaLabel || "",
    className:
      `${isAiStyled ? "ai-shared-modal" : ""} ${modal.className || ""}`.trim(),
    clickThrough,
    closeOnBackdrop: modal.closeOnBackdrop ?? (!isOmniWrite && !clickThrough),
    content: modal.content || null,
    contentClassName: modal.contentClassName || "",
    dismissible: modal.dismissible !== false,
    fullViewport: modal.fullViewport === true,
    height: modal.height || "",
    maxHeight: modal.maxHeight || (isAiStyled ? "calc(100dvh - 2rem)" : ""),
    maxWidth: modal.maxWidth || "",
    modalGroupId,
    modalType:
      modal.modalType ||
      modal.ariaLabel ||
      modal.title ||
      modal.contentClassName ||
      "default-modal",
    onClose: typeof modal.onClose === "function" ? modal.onClose : null,
    style: modal.style || {},
    title: modal.title || "",
    visible: modal.visible !== false,
    width: modal.width || (isAiStyled ? "min(42rem, 100%)" : ""),
    zIndex: Number.isFinite(modal.zIndex) ? modal.zIndex : null,
  };
}

export function showModal(content, options) {
  const modal = createModal(content, options);
  if (!modal.visible) return modal.id;

  if (listeners.size === 0) {
    pendingModals.push(modal);
    return modal.id;
  }

  for (const listener of listeners) {
    listener(modal);
  }

  return modal.id;
}

export function dismissModal(modalId) {
  if (!modalId) return;
  for (const listener of dismissListeners) listener(modalId);
}

function subscribe(listener) {
  listeners.add(listener);

  while (pendingModals.length > 0) {
    listener(pendingModals.shift());
  }

  return () => {
    listeners.delete(listener);
  };
}

function subscribeToDismissals(listener) {
  dismissListeners.add(listener);
  return () => dismissListeners.delete(listener);
}

export default function ModalProvider() {
  const [copy, setCopy] = useState(() => t());
  const [modals, setModals] = useState([]);
  const modalsRef = useRef([]);
  const closeButtonRefs = useRef(new Map());
  const closeCallbacksRef = useRef(new Map());

  const closeModal = useCallback((modalId) => {
    const onClose = closeCallbacksRef.current.get(modalId);
    closeCallbacksRef.current.delete(modalId);
    onClose?.();
    const nextModals = modalsRef.current.filter(
      (modal) => modal.id !== modalId,
    );
    modalsRef.current = nextModals;
    setModals(nextModals);
    closeButtonRefs.current.delete(modalId);
  }, []);

  const closeModalGroup = useCallback((modalId) => {
    if (!modalId) return;
    const matchingModals = modalsRef.current.filter(
      (modal) => modal.id === modalId || modal.modalGroupId === modalId,
    );

    for (const modal of matchingModals) {
      const onClose = closeCallbacksRef.current.get(modal.id);
      closeCallbacksRef.current.delete(modal.id);
      closeButtonRefs.current.delete(modal.id);
      onClose?.();
    }

    const nextModals = modalsRef.current.filter(
      (modal) => modal.id !== modalId && modal.modalGroupId !== modalId,
    );
    modalsRef.current = nextModals;
    setModals(nextModals);
  }, []);

  useEffect(() => {
    window.showModal = showModal;

    return subscribe((modal) => {
      if (modal.onClose) closeCallbacksRef.current.set(modal.id, modal.onClose);
      const nextModals = [...modalsRef.current, modal];
      modalsRef.current = nextModals;
      setModals(nextModals);
    });
  }, []);

  useEffect(() => subscribeToDismissals(closeModalGroup), [closeModalGroup]);

  useEffect(() => {
    const refreshCopy = () => {
      setCopy(t());
    };

    window.addEventListener("languagechange", refreshCopy);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);

    return () => {
      window.removeEventListener("languagechange", refreshCopy);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  useEffect(() => {
    const latestModal = modals.filter((modal) => modal.visible).at(-1);
    if (!latestModal) {
      return;
    }

    closeButtonRefs.current.get(latestModal.id)?.focus();
  }, [modals]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      const latestModal = modals.filter((modal) => modal.visible).at(-1);
      if (latestModal?.dismissible) {
        closeModal(latestModal.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modals, closeModal]);

  return (
    <>
      {modals
        .filter((modal) => modal.visible)
        .map((modal) => (
          <div
            aria-hidden={!modal.visible}
            className={`fixed inset-0 flex items-center justify-center ${modal.fullViewport ? "p-0" : "p-3"} ${modal.visible ? (modal.clickThrough ? "pointer-events-none" : "pointer-events-auto") : "hidden"}`}
            hidden={!modal.visible}
            key={modal.id}
            style={{ zIndex: modal.zIndex ?? MODAL_STACKING_LAYER }}
          >
            <button
              aria-label={copy.modalClose}
              className={`absolute inset-0 bg-black/15! ${modal.clickThrough ? "pointer-events-none" : ""}`}
              onClick={() => {
                if (modal.dismissible && modal.closeOnBackdrop) {
                  closeModal(modal.id);
                }
              }}
              tabIndex={-1}
              type="button"
            />
            <section
              aria-label={modal.ariaLabel || modal.title || copy.modalTitle}
              aria-modal="true"
              className={`${modal.clickThrough ? "ai-modal-panel-enter relative flex w-full flex-col text-white pointer-events-auto" : `munetios-modal-enter liquid-glass relative flex w-full flex-col overflow-hidden border border-white/10 text-white shadow-2xl ${modal.fullViewport ? "rounded-none" : "rounded-2xl"}`} ${modal.className}`}
              role="dialog"
              style={{
                width: modal.width || "min(649px, 100%)",
                ...(modal.height ? { height: modal.height } : {}),
                ...modal.style,
                maxHeight:
                  modal.maxHeight ||
                  (modal.fullViewport
                    ? "var(--app-responsive-viewport-height, 100dvh)"
                    : "min(720px, calc(var(--app-responsive-viewport-height, 100dvh) - 28px))"),
                maxWidth:
                  modal.maxWidth ||
                  (modal.fullViewport
                    ? "var(--app-responsive-viewport-width, 100vw)"
                    : "min(920px, calc(var(--app-responsive-viewport-width, 100vw) - 28px))"),
              }}
            >
              <header className="munetios-modal-header flex items-start justify-between gap-3 px-4 pb-2 pt-4">
                {modal.title
                  ? <h2 className="text-xl font-bold leading-7 tracking-[-0.02em]">
                      {modal.title}
                    </h2>
                  : <span aria-hidden="true" />}
                {modal.dismissible
                  ? <button
                      aria-label={copy.modalClose}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10! hover:text-white"
                      onClick={() => closeModal(modal.id)}
                      ref={(node) => {
                        if (node) {
                          closeButtonRefs.current.set(modal.id, node);
                        }
                      }}
                      type="button"
                    >
                      <icon>close</icon>
                    </button>
                  : null}
              </header>
              <div
                className={`munetios-modal-content min-h-0 flex-1 overflow-y-auto px-4 pb-4 ${modal.title ? "pt-2" : "pt-4"} ${modal.contentClassName}`}
                style={{
                  maxHeight: modal.height
                    ? undefined
                    : modal.title
                      ? "calc(var(--app-responsive-viewport-height, 100dvh) - 5.25rem)"
                      : "calc(var(--app-responsive-viewport-height, 100dvh) - 3rem)",
                }}
              >
                {typeof modal.content === "function"
                  ? modal.content({ close: () => closeModal(modal.id) })
                  : modal.content}
              </div>
            </section>
          </div>
        ))}
    </>
  );
}
