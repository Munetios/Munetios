import { t } from "../i18n";
import LandingFooter from "./landingFooter";
import LandingTopbar from "./landingTopbar";

const pageDefinitions = {
  cookies: {
    descriptionKey: "cookiePolicyDescription",
    sections: [
      ["cookieEssentialTitle", "cookieEssentialBody"],
      ["cookiePreferencesTitle", "cookiePreferencesBody"],
      ["cookieNoTrackingTitle", "cookieNoTrackingBody"],
      ["cookieControlsTitle", "cookieControlsBody"],
      ["legalChangesTitle", "legalChangesBody"],
      ["legalContactTitle", "legalContactBody"],
    ],
    titleKey: "cookiePolicyTitle",
  },
  privacy: {
    descriptionKey: "privacyPolicyDescription",
    sections: [
      ["privacyDataCollectedTitle", "privacyDataCollectedBody"],
      ["privacyUseTitle", "privacyUseBody"],
      ["privacyNoSaleTitle", "privacyNoSaleBody"],
      ["privacyProvidersTitle", "privacyProvidersBody"],
      ["privacyLegalBasesTitle", "privacyLegalBasesBody"],
      ["privacyCookiesTitle", "privacyCookiesBody"],
      ["privacyAiTitle", "privacyAiBody"],
      ["privacyRetentionTitle", "privacyRetentionBody"],
      ["privacySecurityTitle", "privacySecurityBody"],
      ["privacyInternationalTitle", "privacyInternationalBody"],
      ["privacyGdprTitle", "privacyGdprBody"],
      ["privacyCoppaTitle", "privacyCoppaBody"],
      ["privacyParentRightsTitle", "privacyParentRightsBody"],
      ["privacyRightsTitle", "privacyRightsBody"],
      ["legalContactTitle", "legalContactBody"],
    ],
    titleKey: "privacyPolicyTitle",
  },
  terms: {
    descriptionKey: "termsDescription",
    sections: [
      ["termsEligibilityTitle", "termsEligibilityBody"],
      ["termsAccountsTitle", "termsAccountsBody"],
      ["termsUseTitle", "termsUseBody"],
      ["termsPaymentsTitle", "termsPaymentsBody"],
      ["termsPrivacyTitle", "termsPrivacyBody"],
      ["termsContentTitle", "termsContentBody"],
      ["termsMunetiosContentTitle", "termsMunetiosContentBody"],
      ["termsAiTitle", "termsAiBody"],
      ["termsThirdPartyTitle", "termsThirdPartyBody"],
      ["termsUpdatesTitle", "termsUpdatesBody"],
      ["termsTerminationTitle", "termsTerminationBody"],
      ["termsWarrantyTitle", "termsWarrantyBody"],
      ["termsLawTitle", "termsLawBody"],
      ["legalChangesTitle", "legalChangesBody"],
      ["legalContactTitle", "legalContactBody"],
    ],
    titleKey: "termsTitle",
  },
};

export default function LegalPageShell({ page }) {
  const copy = t("en");
  const definition = pageDefinitions[page] || pageDefinitions.privacy;

  return (
    <main className="min-h-dvh text-white">
      <LandingTopbar />
      <article className="mx-auto w-full max-w-5xl px-3 pb-8 pt-24 sm:px-6">
        <header className="liquid-glass rounded-3xl border border-white/10 bg-purple-950/45! p-6 sm:p-9">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-purple-200">
            Munetios
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
            {copy[definition.titleKey]}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-white/70">
            {copy[definition.descriptionKey]}
          </p>
          <p className="mt-4 text-xs text-white/45">
            {copy.legalEffectiveDate}
          </p>
        </header>
        <div className="mt-5 grid gap-4">
          {definition.sections.map(([titleKey, bodyKey]) => (
            <section
              className="liquid-glass rounded-2xl border border-white/10 bg-white/5! p-5 sm:p-7"
              key={titleKey}
            >
              <h2 className="text-xl font-semibold text-white">
                {copy[titleKey]}
              </h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-7 text-white/72">
                {copy[bodyKey]}
              </p>
            </section>
          ))}
        </div>
        {page === "privacy"
          ? <aside className="mt-5 rounded-2xl border border-purple-200/15 bg-purple-500/10! p-5 text-sm leading-6 text-purple-50">
              {copy.privacyOfficialGuidance}{" "}
              <a
                className="underline"
                href="https://www.ftc.gov/business-guidance/privacy-security/childrens-privacy"
                rel="noreferrer"
                target="_blank"
              >
                COPPA
              </a>
              {" · "}
              <a
                className="underline"
                href="https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en"
                rel="noreferrer"
                target="_blank"
              >
                GDPR
              </a>
            </aside>
          : null}
      </article>
      <LandingFooter copy={copy} />
    </main>
  );
}
