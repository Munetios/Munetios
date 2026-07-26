"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import AccountAvatar from "./accountAvatar";
import AccountWrapper from "./accountwraper";

const _accountFetchUrl = "/api/account";
const _fetchIntervalMs = 1000;
const _fetchTimeoutMs = 10000;

const showToastMessage = (id) => {
  const payload = { messageKey: id, type: "error" };
  if (typeof showToast === "function") {
    showToast(payload);
  } else if (
    typeof window !== "undefined" &&
    typeof window.showToast === "function"
  ) {
    window.showToast(payload);
  }
};

export default function SelectAnAppTopbar({ active = true }) {
  const copy = t("en");
  const accountPanelRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const [accountWrapperOpen, setAccountWrapperOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelTop, setPanelTop] = useState(72);
  const [account, setAccount] = useState(null);

  const updateAccountPanelPosition = useCallback(() => {
    const trigger = accountTriggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    setPanelTop(Math.max(10, rect.bottom + 10));
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let isMounted = true;
    let intervalId = null;
    let timeoutId = null;

    const fetchAccount = async () => {
      try {
        const response = await fetch(_accountFetchUrl);
        if (!response.ok) {
          throw new Error("Account fetch failed");
        }

        return await response.json();
      } catch {
        return null;
      }
    };

    const startFetchLoop = async () => {
      const firstAccount = await fetchAccount();
      if (firstAccount && isMounted) {
        setAccount(firstAccount);
        return;
      }

      intervalId = window.setInterval(async () => {
        if (!isMounted) {
          return;
        }

        const nextAccount = await fetchAccount();
        if (nextAccount && isMounted) {
          window.clearInterval(intervalId);
          window.clearTimeout(timeoutId);
          setAccount(nextAccount);
        }
      }, _fetchIntervalMs);

      timeoutId = window.setTimeout(() => {
        if (!isMounted) {
          return;
        }

        window.clearInterval(intervalId);
        showToastMessage("failedCheckAccount");
      }, _fetchTimeoutMs);
    };

    startFetchLoop();

    return () => {
      isMounted = false;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [active]);

  useEffect(() => {
    const syncProfile = (event) => {
      if (!event.detail) return;
      setAccount((current) => ({
        ...(current || {}),
        avatar: event.detail.avatar,
        avatarLetter: event.detail.avatar?.value || current?.avatarLetter,
        avatarUrl: event.detail.profilePictureUrl || null,
        profilePictureUrl: event.detail.profilePictureUrl || null,
      }));
    };
    window.addEventListener("munetios:profilechange", syncProfile);
    return () =>
      window.removeEventListener("munetios:profilechange", syncProfile);
  }, []);

  useEffect(() => {
    if (!active) {
      setAccountWrapperOpen(false);
      return undefined;
    }

    if (!accountWrapperOpen) {
      return undefined;
    }

    updateAccountPanelPosition();

    const onPointerDown = (event) => {
      if (
        accountPanelRef.current?.contains(event.target) ||
        accountTriggerRef.current?.contains(event.target) ||
        event.target.closest?.("[data-munetios-dropdown-portal='true']")
      ) {
        return;
      }

      setAccountWrapperOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setAccountWrapperOpen(false);
        accountTriggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateAccountPanelPosition);
    window.addEventListener("scroll", updateAccountPanelPosition, true);
    window.addEventListener(
      "munetios:localechange",
      updateAccountPanelPosition,
    );

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateAccountPanelPosition);
      window.removeEventListener("scroll", updateAccountPanelPosition, true);
      window.removeEventListener(
        "munetios:localechange",
        updateAccountPanelPosition,
      );
    };
  }, [accountWrapperOpen, active, updateAccountPanelPosition]);

  return (
    <div className="fixed top-0 z-[1000] flex w-full items-center justify-between bg-transparent p-2">
      <div className="liquid-glass flex h-14 items-center gap-2 rounded-2xl px-4">
        <a href="/" className="flex items-center gap-2">
          <img
            src="https://www.munetios.com/apple-touch-icon-new.png"
            alt={copy.landingLogoAlt}
            width="40"
            height="40"
          />
          <div className="logo text-xl font-rounded! font-bold hidden sm:flex!">
            Munetios
          </div>
        </a>
      </div>

      <div className="liquid-glass flex h-14 items-center gap-2 rounded-2xl px-3">
        <button
          aria-label={copy.openAccountMenu}
          aria-controls="accountWrapperPanel"
          aria-expanded={accountWrapperOpen}
          id="accountProfilePicture"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-white transition-all hover:bg-purple-700/50!"
          onClick={() => {
            updateAccountPanelPosition();
            setAccountWrapperOpen(true);
          }}
          ref={accountTriggerRef}
          type="button"
        >
          <AccountAvatar
            account={account}
            alt={copy.accountProfileAlt}
            className="h-10 w-10 rounded-xl"
          />
        </button>
      </div>
      {mounted && accountWrapperOpen
        ? createPortal(
            <div
              className="fixed z-[1100]"
              id="accountWrapperPanel"
              ref={accountPanelRef}
              style={{
                right: "10px",
                top: `${panelTop}px`,
              }}
            >
              <AccountWrapper />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
