"use client";

import { useEffect } from "react";
import { t } from "../i18n";
import { showModal } from "./modal";

export default function BusinessSignupComingSoon() {
  useEffect(() => {
    const copy = t();
    showModal(
      () => (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-white/70">
            {copy.businessSignupComingSoonBody}
          </p>
          <a
            className="liquid-glass inline-flex rounded-xl bg-purple-600/75! px-4 py-2 text-sm font-bold"
            href="/"
          >
            {copy.accountSettingsBackHome}
          </a>
        </div>
      ),
      {
        ariaLabel: copy.businessSignupComingSoonTitle,
        dismissible: false,
        title: copy.businessSignupComingSoonTitle,
      },
    );
  }, []);
  return <main className="min-h-dvh bg-purple-950/50!" />;
}
