"use client";

import { useEffect, useState } from "react";
import { t } from "../i18n";
import { showModal } from "./modal";

const frameLoadTimeoutMs = 15000;

function AccountSettingsFrame({ frameUrl }) {
  const copy = t();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!loading) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setLoading(false);
      setFailed(true);
    }, frameLoadTimeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [loading]);

  const reloadFrame = () => {
    setFailed(false);
    setLoading(true);
    setReloadKey((currentKey) => currentKey + 1);
  };

  return (
    <div className="relative h-full min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-purple-950/15!">
      {loading
        ? <div
            aria-live="polite"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-purple-950/35! text-center text-white"
          >
            <output
              aria-label={copy.accountSettingsFrameLoading}
              className="spinner-container"
            >
              <svg
                aria-hidden="true"
                className="google-spinner"
                viewBox="0 0 50 50"
              >
                <circle
                  className="spinner-circle"
                  cx="25"
                  cy="25"
                  fill="none"
                  r="20"
                  strokeWidth="4"
                />
              </svg>
            </output>
            <span
              className="text-sm font-semibold text-white/75"
              data-translate="accountSettingsFrameLoading"
            >
              {copy.accountSettingsFrameLoading}
            </span>
          </div>
        : null}

      {failed
        ? <div
            aria-live="assertive"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-purple-950/45! p-6 text-center text-white"
            role="alert"
          >
            <icon className="text-4xl text-purple-200">cloud_off</icon>
            <p
              className="max-w-lg text-sm leading-6 text-white/75"
              data-translate="accountSettingsFrameLoadFailed"
            >
              {copy.accountSettingsFrameLoadFailed}
            </p>
            <button
              className="rounded-full border border-purple-200/25 bg-purple-500/80! px-5 py-2.5 text-sm font-semibold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90!"
              data-translate="accountSettingsFrameReload"
              onClick={reloadFrame}
              type="button"
            >
              {copy.accountSettingsFrameReload}
            </button>
          </div>
        : null}

      <iframe
        className={`h-full w-full border-0 bg-transparent transition-opacity ${loading || failed ? "opacity-0" : "opacity-100"}`}
        key={reloadKey}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        onLoad={() => {
          setFailed(false);
          setLoading(false);
        }}
        src={frameUrl}
        title={copy.accountSettings}
      />
    </div>
  );
}

export function openAccountSettingsModal({ page = "" } = {}) {
  const copy = t();
  const normalizedPage = String(page || "")
    .trim()
    .replace(/[^a-z0-9-]/giu, "");
  const frameUrl = normalizedPage
    ? `/account/settings/${encodeURIComponent(normalizedPage)}`
    : "/account/settings";

  return showModal(<AccountSettingsFrame frameUrl={frameUrl} />, {
    ariaLabel: copy.accountSettings,
    className: "munetios-modal-wide flex flex-col",
    contentClassName: "min-h-0 flex-1",
    height: "1100px",
    maxHeight: "min(1100px, calc(100dvh - 28px))",
    maxWidth: "min(1000px, calc(100vw - 28px))",
    title: copy.accountSettings,
    width: "1000px",
    zIndex: 100000001,
  });
}
