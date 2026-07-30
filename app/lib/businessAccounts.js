export const businessVerificationStatuses = Object.freeze({
  UNVERIFIED: "unverified",
  VERIFIED: "verified",
});

export const businessRoles = Object.freeze({
  ADMINISTRATOR: "administrator",
  MEMBER: "member",
});

export function normalizeBusinessAccount(business, accountId = "") {
  if (!business || typeof business !== "object") {
    return null;
  }

  const verificationStatus =
    business.verified === true ||
    business.verificationStatus === businessVerificationStatuses.VERIFIED
      ? businessVerificationStatuses.VERIFIED
      : businessVerificationStatuses.UNVERIFIED;
  const role =
    business.role === businessRoles.MEMBER
      ? businessRoles.MEMBER
      : businessRoles.ADMINISTRATOR;

  return {
    ...business,
    accountId: business.accountId || accountId,
    role,
    verificationStatus,
    verified: verificationStatus === businessVerificationStatuses.VERIFIED,
  };
}

export function getBusinessCapabilities(business) {
  const normalizedBusiness = normalizeBusinessAccount(business);
  const verified = Boolean(normalizedBusiness?.verified);

  return {
    canCreateCustomSignInPage: verified,
    canMakeMoney: verified,
    canUpgradeBusinessPlan: verified,
    canUseCustomEmailDomains: verified,
  };
}

export function isBusinessAdministrator(business) {
  return (
    normalizeBusinessAccount(business)?.role === businessRoles.ADMINISTRATOR
  );
}
