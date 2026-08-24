import { requireAuth } from "../../../../auth.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";
import { getSupaNotesNotes } from "../../../lib/supaNotesData.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationAppAccess(session, "notes");
  if (policyResponse) return policyResponse;
  const exportedAt = new Date().toISOString();
  const filename = `Munetios-SupaNotes-${exportedAt.slice(0, 10)}.json`;
  return new Response(
    JSON.stringify(
      {
        exportedAt,
        notes: getSupaNotesNotes(session),
        product: "Munetios SupaNotes",
        version: 1,
      },
      null,
      2,
    ),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}
