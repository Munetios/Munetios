"use client";

import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { hasSignedInCookie } from "../lib/signedInCookie";
import LandingShell from "./landingShell";
import SelectAnAppPage from "./selectAnAppPage";
import SignUpForBusiness from "./signUpForBusiness";

function normalizeSignupPlan(plan) {
  return plan === "business-pro" ? "business-pro" : "business-free";
}

function ReusableRouteSlot({ active, children, name }) {
  return (
    <section
      aria-hidden={!active}
      className={active ? "contents" : "hidden"}
      data-munetios-reusable-route={name}
      hidden={!active}
    >
      {children}
    </section>
  );
}

export default function ReusableRouteElements({
  initialLoggedIn = false,
  initialPlan = "business-free",
  route = "home",
}) {
  const [signedIn, setSignedIn] = useState(() => Boolean(initialLoggedIn));
  const businessPlan = normalizeSignupPlan(initialPlan);

  useEffect(() => {
    const refreshSignedInState = () => {
      setSignedIn(hasSignedInCookie());
    };

    if (!initialLoggedIn) refreshSignedInState();
    window.addEventListener("munetios:authchange", refreshSignedInState);

    return () => {
      window.removeEventListener("munetios:authchange", refreshSignedInState);
    };
  }, [initialLoggedIn]);

  const activeRoute = useMemo(() => {
    if (route === "business-signup") {
      return "business-signup";
    }

    if (signedIn) {
      return "apps";
    }

    return "landing";
  }, [route, signedIn]);

  return (
    <div data-munetios-reusable-elements="true">
      <ReusableRouteSlot active={activeRoute === "landing"} name="landing">
        <LandingShell />
      </ReusableRouteSlot>
      <ReusableRouteSlot active={activeRoute === "apps"} name="apps">
        <SelectAnAppPage active={activeRoute === "apps"} />
      </ReusableRouteSlot>
      <ReusableRouteSlot
        active={activeRoute === "business-signup"}
        name="business-signup"
      >
        <SignUpForBusiness
          copy={t("en")}
          initialPlan={businessPlan}
          key={businessPlan}
        />
      </ReusableRouteSlot>
    </div>
  );
}
