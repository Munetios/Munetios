"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AccountAvatar from "../../../components/accountAvatar";
import AccountWrapper from "../../../components/accountwraper";
import AppTopbarRight from "../../../components/appTopbarRight";

export default function NotesTopbar({
  copy,
  onSidebarToggle,
  sessionState,
  sidebarOpen,
  user,
}) {
  const accountPanelRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelTop, setPanelTop] = useState(72);

  const positionAccountPanel = useCallback(() => {
    const trigger = accountTriggerRef.current;
    if (!trigger) return;
    setPanelTop(Math.max(10, trigger.getBoundingClientRect().bottom + 10));
  }, []);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (sessionState !== "active") setAccountPanelOpen(false);
  }, [sessionState]);

  useEffect(() => {
    if (!accountPanelOpen) return undefined;
    positionAccountPanel();
    const closeOnPointerDown = (event) => {
      if (
        accountPanelRef.current?.contains(event.target) ||
        accountTriggerRef.current?.contains(event.target) ||
        event.target.closest?.("[data-munetios-dropdown-portal='true']")
      ) {
        return;
      }
      setAccountPanelOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setAccountPanelOpen(false);
    };
    window.addEventListener("resize", positionAccountPanel);
    window.addEventListener("scroll", positionAccountPanel, true);
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", positionAccountPanel);
      window.removeEventListener("scroll", positionAccountPanel, true);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountPanelOpen, positionAccountPanel]);

  return (
    <>
      <header className="notes-topbar">
        <button
          aria-hidden={sidebarOpen}
          aria-label={copy.tasksOpenSidebar}
          className={`notes-topbar-menu liquid-glass flex h-14 w-14 cursor-pointer items-center justify-center ${sidebarOpen ? "is-hidden" : ""}`}
          onClick={onSidebarToggle}
          tabIndex={sidebarOpen ? -1 : undefined}
          title={copy.tasksOpenSidebar}
          type="button"
        >
          <icon className="text-[28px]">menu</icon>
        </button>
        <AppTopbarRight className="notes-topbar-right">
          {sessionState === "active"
            ? <button
                aria-expanded={accountPanelOpen}
                aria-label={copy.openAccountMenu}
                className="notes-account-button"
                onClick={() => {
                  positionAccountPanel();
                  setAccountPanelOpen((current) => !current);
                }}
                ref={accountTriggerRef}
                type="button"
              >
                <AccountAvatar
                  account={user}
                  alt={copy.accountProfileAlt}
                  className="h-10 w-10 rounded-full"
                />
              </button>
            : sessionState === "inactive"
              ? <a className="notes-sign-in" href="/signin">
                  {copy.notesSignIn}
                </a>
              : <output
                  aria-label={copy.accountProfileLoading}
                  className="notes-account-loading"
                />}
        </AppTopbarRight>
      </header>
      {mounted && sessionState === "active" && accountPanelOpen
        ? createPortal(
            <div
              className="fixed z-100000000"
              ref={accountPanelRef}
              style={{ right: "10px", top: `${panelTop}px` }}
            >
              <AccountWrapper appContext="notes" persistentDropdowns />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
