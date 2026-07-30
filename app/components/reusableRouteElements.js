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
  initialPlan = "business-free",
  route = "home",
}) {
  const [signedIn, setSignedIn] = useState(() => hasSignedInCookie());
  const businessPlan = normalizeSignupPlan(initialPlan);

  useEffect(() => {
    let active = true;
    const refreshSignedInState = async () => {
      try {
        const response = await fetch("/api/signedin", {
          cache: "no-store",
          credentials: "include",
        });
        const payload = await response.json();
        if (active) {
          setSignedIn(
            hasSignedInCookie() ||
              (response.ok && payload?.authenticated === true),
          );
        }
      } catch {
        if (active && !hasSignedInCookie()) setSignedIn(false);
      }
    };

    void refreshSignedInState();
    window.addEventListener("munetios:authchange", refreshSignedInState);

    return () => {
      active = false;
      window.removeEventListener("munetios:authchange", refreshSignedInState);
    };
  }, []);

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
