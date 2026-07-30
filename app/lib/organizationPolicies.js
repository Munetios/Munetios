import { getAccountData, listAccountData } from "./authSecurity.js";
import { businessRoles, normalizeBusinessAccount } from "./businessAccounts.js";

export const organizationApps = Object.freeze({
  ai: "AllowMunetiosAI",
  calendar: "AllowMunetiosCalendar",
  chat: "AllowMunetiosChat",
  connectorstore: "AllowConnectorStore",
  drive: "AllowMunetiosDrive",
  mail: "AllowMunetiosMail",
  meet: "AllowMunetiosMeet",
  omniwrite: "AllowMunetiosOmniWrite",
  sheets: "AllowMunetiosSheets",
  slides: "AllowMunetiosSlides",
  tasks: "AllowMunetiosTasks",
});

export const baseOrganizationPolicies = Object.freeze({
  AIFeaturesEnabled: true,
  AllowConnectorStore: true,
  AllowMunetiosAI: true,
  AllowMunetiosCalendar: true,
  AllowMunetiosChat: true,
  AllowMunetiosDrive: true,
  AllowMunetiosMail: true,
  AllowMunetiosMeet: true,
  AllowMunetiosOmniWrite: true,
  AllowMunetiosSheets: true,
  AllowMunetiosSlides: true,
  AllowMunetiosTasks: true,
  DisallowConnectors: false,
  ForceConnectorsList: false,
  ManagedWorkspaces: false,
});

const planAliases = new Map([
  ["business free", "free"],
  ["business-free", "free"],
  ["business standard", "standard"],
  ["business-standard", "standard"],
  ["business pro", "pro"],
  ["business-pro", "pro"],
  ["business enterprise", "enterprise"],
  ["business-enterprise", "enterprise"],
]);

export function normalizeBusinessPlan(plan) {
  return (
    planAliases.get(
      String(plan || "")
        .trim()
        .toLowerCase(),
    ) || "free"
  );
}

export function getBusinessPlanCapabilities(plan, verified = false) {
  const normalizedPlan = normalizeBusinessPlan(plan);
  const standardOrHigher = ["standard", "pro", "enterprise"].includes(
    normalizedPlan,
  );
  const proOrHigher = ["pro", "enterprise"].includes(normalizedPlan);

  return {
    advancedAdmin: proOrHigher,
    advancedAnalytics: standardOrHigher,
    animatedSignInBackgrounds: standardOrHigher,
    customDomains: verified,
    customHtmlSignIn: verified && proOrHigher,
    customSignIn: verified,
    monetization: verified && standardOrHigher,
    monetizationLevel: !verified
      ? "none"
      : proOrHigher
        ? "advanced"
        : standardOrHigher
          ? "basic"
          : "none",
    plan: normalizedPlan,
    quickCards: true,
    storageGb:
      normalizedPlan === "enterprise" || normalizedPlan === "pro"
        ? 5120
        : normalizedPlan === "standard"
          ? 500
          : 96,
  };
}

function findMember(adminSettings, user) {
  const email = String(user?.email || "").toLowerCase();
  return (adminSettings?.members || []).find(
    (member) =>
      (member.accountId && member.accountId === user?.id) ||
      (email && String(member.email || "").toLowerCase() === email),
  );
}

function resolveRole(adminSettings, roleId) {
  return (
    (adminSettings?.roles || []).find((role) => role.id === roleId) || null
  );
}

function resolvePolicies(role) {
  const policies = {
    ...baseOrganizationPolicies,
    ...(role?.policies || {}),
  };
  if (policies.AllowMunetiosDrive === false) {
    policies.AllowMunetiosOmniWrite = false;
    policies.AllowMunetiosSheets = false;
    policies.AllowMunetiosSlides = false;
  }
  if (policies.AIFeaturesEnabled === false) {
    policies.AllowMunetiosAI = false;
  }
  return policies;
}

function createContext({
  adminSettings,
  business,
  businessAccountId,
  member,
  owner,
}) {
  const role = owner
    ? {
        id: "administrator",
        name: "Administrator",
        policies: baseOrganizationPolicies,
      }
    : resolveRole(adminSettings, member?.roleId);
  const policies = resolvePolicies(role);
  const plan = normalizeBusinessPlan(
    business.plan || adminSettings?.plan || "business-free",
  );

  return {
    administrator: owner || member?.roleId === "administrator",
    appAccess: Object.fromEntries(
      Object.entries(organizationApps).map(([app, policy]) => [
        app,
        member?.status === "suspended" ? false : policies[policy] !== false,
      ]),
    ),
    archived: member?.status === "archived",
    businessAccountId,
    businessName: business.businessName || "Munetios Business",
    capabilities: getBusinessPlanCapabilities(plan, business.verified),
    memberId: member?.id || null,
    memberStatus: owner ? "active" : member?.status || "active",
    managedWorkspaces: Array.isArray(role?.managedWorkspaces)
      ? role.managedWorkspaces
      : [],
    policies,
    role: owner ? businessRoles.ADMINISTRATOR : role?.name || "Member",
    roleId: owner ? "administrator" : member?.roleId || "member",
    suspended: member?.status === "suspended",
    verificationStatus: business.verificationStatus,
    verified: business.verified,
  };
}

export function getOrganizationContext(user) {
  if (!user?.id) return null;

  const ownedBusiness = normalizeBusinessAccount(
    getAccountData(user.id, "business", null),
    user.id,
  );
  if (ownedBusiness) {
    return createContext({
      adminSettings: getAccountData(user.id, "business-admin", {}),
      business: ownedBusiness,
      businessAccountId: user.id,
      owner: true,
    });
  }

  for (const entry of listAccountData("business-admin")) {
    const member = findMember(entry.value, user);
    if (!member || member.status === "deleted") continue;
    const business = normalizeBusinessAccount(
      getAccountData(entry.accountId, "business", null),
      entry.accountId,
    );
    if (!business) continue;
    return createContext({
      adminSettings: entry.value,
      business,
      businessAccountId: entry.accountId,
      member,
      owner: false,
    });
  }
  return null;
}

export function isOrganizationAppAllowed(context, app) {
  if (!context) return true;
  if (context.suspended) return false;
  return context.appAccess?.[app] !== false;
}

export function organizationBlockedResponse(context, app) {
  return Response.json(
    {
      app,
      businessName: context?.businessName || "",
      error: "organization_app_blocked",
      message:
        "Your organization has blocked this app. Please contact your administrator.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Munetios-Organization-Policy": "blocked",
      },
      status: 403,
    },
  );
}

export function enforceOrganizationAppAccess(session, app, options = {}) {
  const context = getOrganizationContext(session?.user);
  if (!context) return null;
  if (context.archived && options.mutating) {
    return Response.json(
      {
        error: "organization_account_archived",
        message: "This managed account is read-only.",
      },
      {
        headers: { "Cache-Control": "no-store" },
        status: 403,
      },
    );
  }
  return isOrganizationAppAllowed(context, app)
    ? null
    : organizationBlockedResponse(context, app);
}

export function enforceOrganizationConnectorAccess(session, options = {}) {
  const context = getOrganizationContext(session?.user);
  if (!context) return null;
  if (
    context.policies?.DisallowConnectors ||
    context.policies?.AllowConnectors === false
  ) {
    return organizationBlockedResponse(context, "connectors");
  }
  return enforceOrganizationAppAccess(session, "connectorstore", options);
}
