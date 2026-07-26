"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import SignInButton from "./signInButton";

const navLinks = [
  { href: "#productsSection", labelKey: "navProducts" },
  { href: "#featuresSection", labelKey: "navFeatures" },
  { href: "#pricingSection", labelKey: "navPricing" },
  { href: "#privacySection", labelKey: "navPrivacy" },
  { href: "#aboutSection", labelKey: "navAbout" },
];

export default function LandingTopbar() {
  const copy = t("en");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const topbarRef = useRef(null);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return undefined;
    }

    const closeOnOutsidePointer = (event) => {
      if (topbarRef.current?.contains(event.target)) {
        return;
      }

      setMobileMenuOpen(false);
    };

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  return (
    <header
      className="landing-topbar fixed top-0 z-[1000] w-full flex items-start justify-between p-2 md:items-center md:p-4"
      ref={topbarRef}
    >
      <div className=" flex items-center gap-2">
        <button
          aria-controls="mobileLandingNavigation"
          aria-expanded={mobileMenuOpen}
          aria-label={copy.dropdownToggle}
          className="h-14 w-14 liquid-glass flex md:hidden items-center justify-center cursor-pointer transition-all hover:bg-purple-600/50!"
          data-translate-aria-label="dropdownToggle"
          onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
          type="button"
        >
          <icon>{mobileMenuOpen ? "close" : "menu"}</icon>
        </button>
        <div className="h-14 p-4 liquid-glass flex items-center gap-2">
          <a href="/" className="flex items-center gap-2">
            <img
              src="https://www.munetios.com/apple-touch-icon-new.png"
              alt={copy.landingLogoAlt}
              data-translate-alt="landingLogoAlt"
              width="40"
              height="40"
            />
            <div className="text-xl logo font-bold hidden sm:flex!">
              Munetios
            </div>
          </a>
        </div>
      </div>
      <div className="h-14 p-4 liquid-glass flex items-center gap-2">
        <div id="linksContainer" className="hidden md:flex! items-center gap-4">
          {navLinks.map((link) => (
            <a
              href={link.href}
              className="hover:underline"
              data-translate={link.labelKey}
              key={link.href}
            >
              {copy[link.labelKey]}
            </a>
          ))}
        </div>
        <SignInButton
          id="sign-in-button"
          className="liquid-glass hover:bg-purple-600! transition-all cursor-pointer text-white py-2 px-4 rounded-br-xl bg-purple-800/90!"
        />
      </div>
      {mobileMenuOpen
        ? <nav
            aria-label={copy.landingNavigationLabel}
            className="munetios-dropdown-enter liquid-glass absolute left-2 right-2 top-[4.75rem] flex flex-col gap-1 rounded-2xl border border-white/10 bg-purple-950/70! p-2 text-white shadow-2xl md:hidden"
            data-translate-aria-label="landingNavigationLabel"
            id="mobileLandingNavigation"
          >
            {navLinks.map((link) => (
              <a
                className="rounded-xl px-3 py-2 text-sm font-semibold transition hover:bg-purple-700/50!"
                data-translate={link.labelKey}
                href={link.href}
                key={link.href}
                onClick={closeMobileMenu}
              >
                {copy[link.labelKey]}
              </a>
            ))}
          </nav>
        : null}
    </header>
  );
}
