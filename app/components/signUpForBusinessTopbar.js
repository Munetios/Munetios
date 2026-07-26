"use client";

import { t } from "../i18n";

export default function signUpForBusinessTopbar() {
  const copy = t();
  return (
    <header className="complete-payment-topbar fixed top-0 z-[1000] w-full flex items-start justify-between p-2 md:items-center md:p-4">
      <div className="flex items-center gap-2">
        <div className="h-14 p-4 liquid-glass flex items-center gap-2">
          <a href="/" className="flex items-center gap-2">
            <div
              className="text-xl logo font-bold hidden sm:flex!"
              data-translate="businessSignupTopbarTitle"
            >
              {copy.businessSignupTopbarTitle}
            </div>
          </a>
        </div>
      </div>
    </header>
  );
}
