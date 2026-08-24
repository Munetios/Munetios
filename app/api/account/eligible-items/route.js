import { requireAuth } from "../../../../auth.js";
import { getAccountData } from "../../../lib/authSecurity.js";
import { getEducationProfile } from "../../../lib/education.js";
import { getOrganizationContext } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

const eligibleSidebarItems = [
  {
    icon: "ward",
    labelKey: "accountSettingsTrustedPeople",
    name: "Trusted People",
    order: 1,
  },
  {
    icon: "family_group",
    labelKey: "accountSettingsFamilies",
    name: "Families",
    order: 2,
  },
];

export async function GET(request) {
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }

  const isBusinessAccount =
    Boolean(getAccountData(session.user.id, "business", null)) ||
    Boolean(getOrganizationContext(session.user));
  const isEducationAccount = Boolean(getEducationProfile(session.user.id));
  const items =
    isBusinessAccount || isEducationAccount
      ? []
      : eligibleSidebarItems.filter((item) => item.name === "Families");
  return Response.json(
    {
      items,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
