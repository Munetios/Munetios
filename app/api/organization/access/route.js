import { auth } from "../../../../auth.js";
import { getOrganizationContext } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return Response.json(
      { managed: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const organization = getOrganizationContext(session.user);
  return Response.json(
    {
      managed: Boolean(organization),
      organization,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
