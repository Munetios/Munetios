import { t } from "../i18n";

const copyrightYear = 2026;

export default function LandingFooter({ copy = t("en") }) {
  return (
    <footer
      id="privacy"
      className="px-4 pb-10 pt-6 sm:px-6 lg:px-8 mt-8 liquid-glass"
    >
      <div className="max-w-6xl mx-auto">
        <p className="text-center text-sm text-gray-500 mb-4">
          &copy; {copyrightYear} Munetios.
        </p>
        <nav
          className="flex flex-row items-center justify-center gap-2"
          aria-label={copy.landingFooterLinksLabel}
          data-translate-aria-label="landingFooterLinksLabel"
        >
          <a
            href="/terms"
            className="text-center text-sm text-purple-500 hover:underline"
            data-translate="footerTerms"
          >
            Terms of Service
          </a>
          <a
            href="/privacy"
            className="text-center text-sm text-purple-500 hover:underline"
            data-translate="footerPrivacy"
          >
            Privacy Policy
          </a>
          <a
            href="/cookies"
            className="text-center text-sm text-purple-500 hover:underline"
            data-translate="footerCookies"
          >
            {copy.footerCookies}
          </a>
          <a
            href="/about"
            className="text-center text-sm text-purple-500 hover:underline"
            data-translate="footerAbout"
          >
            About
          </a>
          <a
            href="/account/settings"
            className="text-center text-sm text-purple-500 hover:underline"
            data-translate="settings"
          >
            {copy.settings}
          </a>
        </nav>
      </div>
    </footer>
  );
}
