import { t } from "../i18n";
import IgnoreElementErrorBoundary from "./ignoreElementErrorBoundary";
import LandingFooter from "./landingFooter";
import LandingTopbar from "./landingTopbar";
import LandingContent from "./landingContent";

export default function LandingShell() {
  const copy = t("en");

  return (
    <main
      className="munetios-app-render"
      data-munetios-app-render="true"
      aria-label={copy.landingAriaLabel}
    >
      <IgnoreElementErrorBoundary>
        <LandingTopbar />
      </IgnoreElementErrorBoundary>
      <IgnoreElementErrorBoundary>
        <LandingContent />
      </IgnoreElementErrorBoundary>
      <IgnoreElementErrorBoundary>
        <LandingFooter copy={copy} />
      </IgnoreElementErrorBoundary>
    </main>
  );
}
