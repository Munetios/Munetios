"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { MODAL_STACKING_LAYER } from "./layering";

const listeners = new Set();
const pendingModals = [];

function createModal(content = null, options = {}) {
  const modal =
    typeof content === "object" && content !== null && !("type" in content)
      ? { content: null, ...content }
      : { content, ...options };
  const isOmniWrite =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/apps/omniwrite");

  return {
    id:
      modal.modalId ||
      `modal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ariaLabel: modal.ariaLabel || "",
    className: modal.className || "",
    closeOnBackdrop: modal.closeOnBackdrop ?? !isOmniWrite,
    content: modal.content || null,
    contentClassName: modal.contentClassName || "",
    dismissible: modal.dismissible !== false,
    fullViewport: modal.fullViewport === true,
    height: modal.height || "",
    style: modal.style || {},
    title: modal.title || "",
    visible: modal.visible !== false,
    width: modal.width || "",
    zIndex: Number.isFinite(modal.zIndex) ? modal.zIndex : null,
  };
}

export function showModal(content, options) {
  const modal = createModal(content, options);

  if (listeners.size === 0) {
    pendingModals.push(modal);
    return modal.id;
  }

  for (const listener of listeners) {
    listener(modal);
  }

  return modal.id;
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

export default function ModalProvider() {
  const [copy, setCopy] = useState(() => t());
  const [modals, setModals] = useState([]);
  const closeButtonRefs = useRef(new Map());

  const closeModal = useCallback((modalId) => {
    setModals((currentModals) =>
      currentModals.filter((modal) => modal.id !== modalId),
    );
    closeButtonRefs.current.delete(modalId);
  }, []);

  useEffect(() => {
    window.showModal = showModal;

    return subscribe((modal) => {
      setModals((currentModals) => {
        const existingModal = currentModals.find(
          (currentModal) => currentModal.id === modal.id,
        );

        if (!existingModal) {
          return [...currentModals, modal];
        }

        return currentModals.map((currentModal) =>
          currentModal.id === modal.id
            ? { ...currentModal, ...modal, visible: true }
            : currentModal,
        );
      });
    });
  }, []);

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
    <div
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: MODAL_STACKING_LAYER }}
    >
      {modals.map((modal, index) => (
        <div
          aria-hidden={!modal.visible}
          className={`absolute inset-0 flex items-center justify-center ${modal.fullViewport ? "p-0" : "p-3"} ${modal.visible ? "pointer-events-auto" : "hidden"}`}
          hidden={!modal.visible}
          key={modal.id}
          style={{ zIndex: modal.zIndex ?? 4000 + index }}
        >
          <button
            aria-label={copy.modalClose}
            className="absolute inset-0 bg-black/15!"
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
            className={`munetios-modal-enter liquid-glass relative flex w-full flex-col overflow-y-auto border border-white/10 bg-purple-950/40! p-3 text-white shadow-2xl ${modal.fullViewport ? "rounded-none" : "rounded-2xl"} ${modal.width ? "" : "sm:w-[34rem]"} ${modal.className}`}
            role="dialog"
            style={{
              maxHeight: "calc(100dvh - 1.5rem)",
              maxWidth: "calc(100vw - 1.5rem)",
              ...(modal.width ? { width: modal.width } : {}),
              ...(modal.height ? { height: modal.height } : {}),
              ...modal.style,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              {modal.title
                ? <h2 className="text-base font-bold leading-6">
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
            </div>
            <div
              className={`min-h-0 flex-1 overflow-y-auto ${modal.title ? "mt-3" : ""} ${modal.contentClassName}`}
              style={{
                maxHeight: modal.height
                  ? undefined
                  : modal.title
                    ? "calc(100dvh - 5.25rem)"
                    : "calc(100dvh - 3rem)",
              }}
            >
              {typeof modal.content === "function"
                ? modal.content({ close: () => closeModal(modal.id) })
                : modal.content}
            </div>
          </section>
        </div>
      ))}
    </div>
  );
}
