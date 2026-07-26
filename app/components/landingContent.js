import { t } from "../i18n";
import LandingDemo from "./landingDemo";

const products = [
  {
    id: 1,
    name: "Munetios Mail",
    image: "/mail.png",
    nameKey: "productMailName",
    descriptionKey: "productMailDescription",
  },
  {
    id: 2,
    name: "Munetios AI",
    image: "/ai.png",
    nameKey: "productAiName",
    descriptionKey: "productAiDescription",
  },
  {
    id: 3,
    name: "Munetios Calendar",
    image: "/calendar.png",
    nameKey: "productCalendarName",
    descriptionKey: "productCalendarDescription",
  },
  {
    id: 4,
    name: "Munetios OmniWrite",
    image: "/omniwrite.png",
    nameKey: "productOmniWriteName",
    descriptionKey: "productOmniWriteDescription",
  },
  {
    id: 5,
    name: "Munetios Drive",
    image: "/drive.png",
    nameKey: "productDriveName",
    descriptionKey: "productDriveDescription",
  },
  {
    id: 6,
    name: "Munetios Meet",
    image: "/meet.png",
    nameKey: "productMeetName",
    descriptionKey: "productMeetDescription",
  },
  {
    id: 7,
    name: "Munetios Chat",
    image: "/chat.png",
    nameKey: "productChatName",
    descriptionKey: "productChatDescription",
  },
  {
    id: 8,
    name: "Munetios Sheets",
    image: "/sheets.png",
    nameKey: "productSheetsName",
    descriptionKey: "productSheetsDescription",
  },
  {
    id: 9,
    name: "Munetios Slides",
    image: "/slides.png",
    nameKey: "productSlidesName",
    descriptionKey: "productSlidesDescription",
  },
  {
    id: 13,
    name: "Munetios SupaNotes",
    image: "https://notes.munetios.com/apple-touch-icon.png",
    nameKey: "productSupaNotesName",
    descriptionKey: "productSupaNotesDescription",
  },
  {
    id: 14,
    name: "Munetios Tasks",
    image: "https://tasks.munetios.com/apple-touch-icon.png",
    nameKey: "productTasksName",
    descriptionKey: "productTasksDescription",
  },
];

const features = [
  {
    titleKey: "featurePrivacyTitle",
    descriptionKey: "featurePrivacyDescription",
  },
  {
    titleKey: "featureUnifiedWorkspaceTitle",
    descriptionKey: "featureUnifiedWorkspaceDescription",
  },
  {
    titleKey: "featureAiProductivityTitle",
    descriptionKey: "featureAiProductivityDescription",
  },
  {
    titleKey: "featureOfflineSyncTitle",
    descriptionKey: "featureOfflineSyncDescription",
  },
  {
    titleKey: "featureCollaborationTitle",
    descriptionKey: "featureCollaborationDescription",
  },
  {
    titleKey: "featureCrossPlatformTitle",
    descriptionKey: "featureCrossPlatformDescription",
  },
];

const pricingPlans = [
  {
    ctaId: "personalSignUpButton",
    ctaKey: "pricingSignUpCta",
    descriptionKey: "pricingPersonalDescription",
    priceKey: "pricingPersonalPrice",
    titleKey: "pricingPersonalTitle",
  },
  {
    ctaId: "businessFreeSignUpButton",
    ctaKey: "pricingSignUpCta",
    descriptionKey: "pricingBusinessFreeDescription",
    priceKey: "pricingBusinessFreePrice",
    signupHref: "/business/signup?plan=business-free",
    titleKey: "pricingBusinessFreeTitle",
  },
  {
    ctaId: "getBusinessProButton",
    ctaKey: "pricingBusinessProCta",
    descriptionKey: "pricingBusinessProDescription",
    priceKey: "pricingBusinessProPrice",
    signupHref: "/business/signup?plan=business-pro",
    titleKey: "pricingBusinessProTitle",
  },
  {
    ctaId: "getEnterpriseButton",
    ctaKey: "pricingEnterpriseCta",
    descriptionKey: "pricingEnterpriseDescription",
    priceKey: "pricingEnterprisePrice",
    titleKey: "pricingEnterpriseTitle",
  },
];

const privacyCards = [
  {
    titleKey: "privacyEncryptionTitle",
    descriptionKey: "privacyEncryptionDescription",
  },
  {
    titleKey: "privacyByDesignTitle",
    descriptionKey: "privacyByDesignDescription",
  },
  {
    titleKey: "privacyComplianceTitle",
    descriptionKey: "privacyComplianceDescription",
  },
];

const aboutCards = [
  {
    titleKey: "aboutMissionTitle",
    descriptionKey: "aboutMissionDescription",
  },
  {
    titleKey: "aboutVisionTitle",
    descriptionKey: "aboutVisionDescription",
  },
  {
    titleKey: "aboutValuesTitle",
    descriptionKey: "aboutValuesDescription",
  },
];

export default function LandingContent() {
  const copy = t("en");

  return (
    <div className="landing-content mt-16 p-3  flex items-center justify-center m-auto max-w-6xl flex-col">
      <div
        id="heroSection"
        className="liquid-glass w-full p-2 md:p-4 rounded-2xl mt-4 flex flex-col md:flex-row"
      >
        <div id="leftPanelSection" className="w-full md:w-1/2 p-4">
          <h1
            className="text-2xl md:text-3xl font-bold mb-4"
            data-translate="landingTitle"
          >
            Munetios - Your Privacy, Your Workspace
          </h1>
          <p
            className="text-lg leading-relaxed"
            data-translate="landingSubTitle"
          >
            Munetios is a privacy-focused productivity workspace with built-in
            apps like Mail, AI, Calendar, OmniWrite, Drive, and more.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              className="liquid-glass inline-flex items-center justify-center rounded-5xl bg-purple-800/50! px-4 py-2 text-center font-bold text-white transition duration-300 hover:bg-purple-600"
              data-translate="landingGetStarted"
              href="/signup"
              id="getStartedButton"
            >
              {copy.landingGetStarted}
            </a>
            <LandingDemo />
          </div>
        </div>
        <div id="rightPanelSection" className="w-full md:w-1/2 p-4">
          <img
            src="/hero.png"
            alt={copy.landingHeroImageAlt}
            data-translate-alt="landingHeroImageAlt"
            className="h-full w-full rounded-xl object-contain"
          />
        </div>
      </div>

      <div
        id="productsSection"
        className="liquid-glass w-full scroll-mt-24 p-2 md:p-4 rounded-2xl mt-4 flex flex-col justify-center items-center"
      >
        <h1
          className="text-2xl md:text-3xl font-bold mb-4 mt-4"
          data-translate="productsTitle"
        >
          Our Products
        </h1>
        <p
          className="text-lg leading-relaxed"
          data-translate="productsSubTitle"
        >
          Discover our suite of privacy-first productivity tools designed to
          help you work smarter, not harder.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-4">
          {products.map((product) => (
            <div
              key={product.id}
              className="liquid-glass p-2 md:p-4 rounded-2xl text-center flex flex-col justify-content items-center"
            >
              <img
                src={product.image}
                alt={copy[product.nameKey] || product.name}
                data-translate-alt={product.nameKey}
                className="w-40 h-40 object-cover rounded-xl"
              />
              <h2
                className="text-lg md:text-xl font-bold mb-2"
                data-translate={product.nameKey}
              >
                {copy[product.nameKey] || product.name}
              </h2>
              <p
                className="text-white-600"
                data-translate={product.descriptionKey}
              >
                {copy[product.descriptionKey]}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div
        id="featuresSection"
        className="liquid-glass w-full scroll-mt-24 p-2 md:p-4 rounded-2xl mt-4 flex flex-col justify-center items-center"
      >
        <h1
          className="text-2xl md:text-3xl font-bold mb-4 mt-4"
          data-translate="featuresTitle"
        >
          Key Features
        </h1>
        <p
          className="text-lg leading-relaxed"
          data-translate="featuresSubTitle"
        >
          Discover the powerful features that make Munetios the perfect
          productivity workspace.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-4 w-full">
          {features.map((feature) => (
            <div className="p-4 rounded-xl bg-white/5" key={feature.titleKey}>
              <h3 className="font-bold mb-1" data-translate={feature.titleKey}>
                {copy[feature.titleKey]}
              </h3>
              <p className="text-sm" data-translate={feature.descriptionKey}>
                {copy[feature.descriptionKey]}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div
        id="pricingSection"
        className="liquid-glass w-full scroll-mt-24 p-2 md:p-4 rounded-2xl mt-4"
      >
        <h1
          className="text-2xl md:text-3xl font-bold mb-4 mt-4"
          data-translate="pricingTitle"
        >
          Simple, transparent pricing
        </h1>
        <p className="text-lg leading-relaxed" data-translate="pricingSubTitle">
          Choose the plan that works best for you and your team.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          {pricingPlans.map((plan) => (
            <div className="liquid-glass p-4 rounded-xl" key={plan.titleKey}>
              <h3 className="font-bold mb-1" data-translate={plan.titleKey}>
                {copy[plan.titleKey]}
              </h3>
              <h1
                className="text-2xl md:text-3xl font-bold"
                data-translate={plan.priceKey}
              >
                {copy[plan.priceKey]}
              </h1>
              <p className="text-sm" data-translate={plan.descriptionKey}>
                {copy[plan.descriptionKey]}
              </p>
              {plan.signupHref
                ? <a
                    className="liquid-glass inline-flex bg-purple-800/50! text-white font-bold cursor-pointer py-2 px-4 rounded-5xl hover:bg-purple-600! transition duration-300 mt-3"
                    data-translate={plan.ctaKey}
                    href={plan.signupHref}
                    id={plan.ctaId}
                  >
                    {copy[plan.ctaKey]}
                  </a>
                : <button
                    className="liquid-glass bg-purple-800/50! text-white font-bold cursor-pointer py-2 px-4 rounded-5xl hover:bg-purple-600! transition duration-300 mt-3"
                    data-translate={plan.ctaKey}
                    id={plan.ctaId}
                    type="button"
                  >
                    {copy[plan.ctaKey]}
                  </button>}
            </div>
          ))}
        </div>
      </div>
      <div
        id="privacySection"
        className="liquid-glass w-full scroll-mt-24 p-4 md:p-6 rounded-2xl mt-6 border border-white/10 shadow-xl shadow-violet-950/20"
      >
        <h1
          className="font-semibold text-xl md:text-2xl mb-3 leading-tight text-slate-100"
          data-translate="privacyMainTitle"
        >
          {copy.privacyMainTitle}
        </h1>
        <p
          className="text-sm leading-relaxed text-slate-200 max-w-3xl"
          data-translate="privacyMainDescription"
        >
          {copy.privacyMainDescription}
        </p>
        <div className="grid gap-4 mt-6 md:grid-cols-3">
          {privacyCards.map((privacyCard) => (
            <div
              className="liquid-glass p-4 rounded-xl border border-white/10 bg-slate-950/40"
              key={privacyCard.titleKey}
            >
              <h3
                className="font-semibold mb-2 text-slate-100"
                data-translate={privacyCard.titleKey}
              >
                {copy[privacyCard.titleKey]}
              </h3>
              <p
                className="text-sm text-slate-200 leading-relaxed"
                data-translate={privacyCard.descriptionKey}
              >
                {copy[privacyCard.descriptionKey]}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div
        id="aboutSection"
        className="liquid-glass w-full scroll-mt-24 p-2 md:p-4 rounded-2xl mt-4 flex flex-col justify-center items-center"
      >
        <h1
          className="text-2xl md:text-3xl font-bold mb-4 mt-4"
          data-translate="aboutTitle"
        >
          {copy.aboutTitle}
        </h1>
        <p
          className="text-lg leading-relaxed text-center max-w-3xl"
          data-translate="aboutDescription"
        >
          {copy.aboutDescription}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 w-full">
          {aboutCards.map((aboutCard) => (
            <div className="p-4 rounded-xl bg-white/5" key={aboutCard.titleKey}>
              <h3
                className="font-bold mb-1"
                data-translate={aboutCard.titleKey}
              >
                {copy[aboutCard.titleKey]}
              </h3>
              <p className="text-sm" data-translate={aboutCard.descriptionKey}>
                {copy[aboutCard.descriptionKey]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
