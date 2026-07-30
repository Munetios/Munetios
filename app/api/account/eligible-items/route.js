import { requireAuth } from "../../../../auth.js";
import { getAccountData } from "../../../lib/authSecurity.js";
import { getDemoSettings } from "../../../lib/demoSettings.js";
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

  const settings = getDemoSettings(session);
  const isBusinessAccount =
    Boolean(getAccountData(session.user.id, "business", null)) ||
    Boolean(getOrganizationContext(session.user));
  const items =
    settings?.archived || isBusinessAccount
      ? []
      : eligibleSidebarItems.filter((item) =>
          item.name === "Trusted People"
            ? settings?.eligibleTrustedPeople !== false
            : settings?.eligibleFamilies !== false,
        );
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
