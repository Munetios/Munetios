import { notFound } from "next/navigation";
import BusinessCustomSignIn from "../../../components/businessCustomSignIn";
import { getAccountData } from "../../../lib/authSecurity";
import { normalizeBusinessAccount } from "../../../lib/businessAccounts";

export const dynamic = "force-dynamic";

export default async function BusinessSignInPage({ params }) {
  const { businessId } = await params;
  const business = normalizeBusinessAccount(
    getAccountData(businessId, "business", null),
    businessId,
  );
  const settings = getAccountData(businessId, "business-admin", {});
  if (!business?.verified || !settings?.customSignIn?.enabled) {
    notFound();
  }

  return (
    <BusinessCustomSignIn
      business={{
        accentColor: settings.customSignIn.accentColor || "#a855f7",
        backgroundColor:
          settings.customSignIn.backgroundColor || "#16052b",
        backgroundImage: settings.customSignIn.backgroundImage || "",
        heading:
          settings.customSignIn.heading ||
          `Sign in to ${business.businessName}`,
        message: settings.customSignIn.message || "",
        name: business.businessName,
        oauthProviders: settings.customSignIn.oauthProviders || {
          github: true,
        },
        quickCardsEnabled:
          settings.customSignIn.quickCardsEnabled !== false,
        title: settings.customSignIn.title || business.businessName,
      }}
    />
  );
}
