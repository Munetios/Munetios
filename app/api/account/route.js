import {
  auth,
  hasAccountSessionCookie,
  unauthorizedResponse,
} from "../../../auth.js";
import {
  accountCollectionCookieName,
  attachSessionToAccountCollection,
  ensureAccountCollection,
  getAccountCollectionAccounts,
  getAccountCollectionCookie,
  getAccountData,
  getAccountLifecycle,
  getAvatarLetter,
  getRequestCookie,
  isDeletedAccountSessionToken,
} from "../../lib/authSecurity.js";
import {
  getBusinessCapabilities,
  normalizeBusinessAccount,
} from "../../lib/businessAccounts.js";
import { demoPlanLabel, getDemoSettings } from "../../lib/demoSettings.js";
import { getEducationProfile } from "../../lib/education.js";
import { getOrganizationContext } from "../../lib/organizationPolicies.js";
import { getSignedInCookie } from "../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = await auth(request);

  if (!session) {
    const sessionToken = getRequestCookie(request, "munetios_session");
    if (sessionToken && isDeletedAccountSessionToken(sessionToken)) {
      return Response.json(
        {
          deletedAccount: true,
          error: "account_not_found",
          message: "Account is not found. Please sign in to a valid account.",
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Munetios-Auth-State": "account-not-found",
          },
          status: 404,
        },
      );
    }
    return unauthorizedResponse(
      "Your session token is invalid. Please sign in and try again.",
      { invalidSession: hasAccountSessionCookie(request) },
    );
  }

  const syncedPlan = session.demo ? "" : session.user.plan || "Free";
  const storedBusiness = session.demo
    ? null
    : getAccountData(session.user.id, "business", null);
  const business = normalizeBusinessAccount(storedBusiness, session.user.id);
  const organization = session.demo
    ? null
    : getOrganizationContext(session.user);
  const education = session.demo ? null : getEducationProfile(session.user.id);
  const isBusinessAccount =
    Boolean(storedBusiness) ||
    /^business\b/i.test(String(syncedPlan || session.user.plan || ""));

  const storedProfile = session.demo
    ? globalThis.__munetiosAccountProfileStore?.get(session.user.id) || {}
    : getAccountData(session.user.id, "profile", {});
  const profilePictureUrl = Object.hasOwn(storedProfile, "profilePictureUrl")
    ? storedProfile.profilePictureUrl
    : session.user.profilePictureUrl;
  const demoSettings = getDemoSettings(session);
  const lifecycle = session.demo ? null : getAccountLifecycle(session.user.id);
  const name = storedProfile.name || session.user.name;
  const avatar = storedProfile.avatar || {
    color: "#7c3aed",
    font: "googleSansFlex",
    type: "letter",
    value: getAvatarLetter(name || session.user.email),
  };
  const existingCollectionToken = getRequestCookie(
    request,
    accountCollectionCookieName,
  );
  const collection = session.demo
    ? null
    : ensureAccountCollection(session.user.id, existingCollectionToken);
  const accounts = collection
    ? getAccountCollectionAccounts(collection.token)
    : [];
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", getSignedInCookie(request));
  if (collection && collection.token !== existingCollectionToken) {
    headers.append(
      "Set-Cookie",
      getAccountCollectionCookie(request, collection.token),
    );
  }
  if (collection) {
    attachSessionToAccountCollection(
      getRequestCookie(request, "munetios_session"),
      collection.token,
    );
  }

  return Response.json(
    {
      authenticated: true,
      accountCount: session.demo ? 1 : Math.max(1, accounts.length),
      accountType: session.demo
        ? "demo"
        : education
          ? "education"
          : isBusinessAccount || organization
            ? "business"
            : "personal",
      business: business
        ? {
            capabilities: getBusinessCapabilities(business),
            name: business.businessName,
            role: business.role,
            verificationStatus: business.verificationStatus,
            verified: business.verified,
          }
        : undefined,
      businessRole: business?.role || organization?.roleId,
      businessVerified: Boolean(business?.verified || organization?.verified),
      avatar,
      avatarLetter: session.user.avatarLetter || getAvatarLetter(name),
      avatarUrl: profilePictureUrl || session.user.avatarUrl,
      demo: Boolean(session.demo),
      email: storedProfile.email || session.user.email,
      education: education || undefined,
      gender: Object.hasOwn(storedProfile, "gender")
        ? storedProfile.gender
        : session.user.gender || "",
      id: session.user.id,
      name,
      birthday: Object.hasOwn(storedProfile, "birthday")
        ? storedProfile.birthday
        : session.user.birthDate || "",
      birthDate: Object.hasOwn(storedProfile, "birthday")
        ? storedProfile.birthday
        : session.user.birthDate || "",
      archived: Boolean(demoSettings?.archived || lifecycle?.archived),
      demoSettings: demoSettings || undefined,
      plan: session.demo
        ? demoPlanLabel(demoSettings.plan)
        : education
          ? "Education"
          : syncedPlan || session.user.plan || "Free",
      profilePictureUrl,
      organization: organization || undefined,
    },
    {
      headers,
    },
  );
}
