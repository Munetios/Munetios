import { requireAuth } from "../../../../auth.js";
import { getAccountData } from "../../../lib/authSecurity.js";
import { enforceParentalAiAccess } from "../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

function text(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "ai");
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;

  const stored = session.demo
    ? []
    : getAccountData(session.user.id, "ai-notifications-v1", []);
  const notifications = Array.isArray(stored)
    ? stored
        .map((notification) => ({
          createdAt: text(notification?.createdAt, 40),
          id: text(notification?.id, 100),
          message: text(notification?.message, 500),
          read: notification?.read === true,
        }))
        .filter((notification) => notification.id && notification.message)
        .slice(0, 50)
    : [];

  return Response.json(
    { notifications },
    { headers: { "Cache-Control": "no-store" } },
  );
}
