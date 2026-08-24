import { requireAuth } from "../../../../auth.js";
import { getAccountData } from "../../../lib/authSecurity.js";
import {
  enforceParentalAiAccess,
  getEffectiveAiParentalControls,
} from "../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

function isUnderEighteen(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""))) return false;
  const birthday = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(birthday.getTime())) return false;
  const today = new Date();
  let age = today.getUTCFullYear() - birthday.getUTCFullYear();
  if (
    today.getUTCMonth() < birthday.getUTCMonth() ||
    (today.getUTCMonth() === birthday.getUTCMonth() &&
      today.getUTCDate() < birthday.getUTCDate())
  ) {
    age -= 1;
  }
  return age < 18;
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "ai");
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;
  const parentalControls = getEffectiveAiParentalControls(session.user.id);
  if (parentalControls) {
    if (parentalControls.allowHealthAi !== true) {
      return Response.json(
        { error: "health_not_available" },
        { headers: { "Cache-Control": "no-store" }, status: 403 },
      );
    }
  } else {
    const profile = session.demo
      ? globalThis.__munetiosAccountProfileStore?.get(session.user.id) || {}
      : getAccountData(session.user.id, "profile", {});
    const birthday = profile.birthday || session.user.birthDate || "";
    if (isUnderEighteen(birthday)) {
      return Response.json(
        { error: "health_not_available" },
        { headers: { "Cache-Control": "no-store" }, status: 403 },
      );
    }
  }
  return Response.json(
    { available: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
