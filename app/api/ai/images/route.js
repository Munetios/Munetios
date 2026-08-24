import { auth } from "../../../../auth.js";
import { listAccountFiles } from "../../../lib/accountStorage.js";
import { enforceStudentAiCapability } from "../../../lib/education.js";
import { enforceParentalAiAccess } from "../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function imagePayload(file, type) {
  return {
    createdAt: file.createdAt,
    id: file.id,
    name: file.name,
    prompt: String(file.metadata?.prompt || "").slice(0, 500),
    type,
    url: `/api/ai/files/${encodeURIComponent(file.id)}`,
  };
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return Response.json({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "ai");
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;
  const educationResponse = enforceStudentAiCapability(session, "images");
  if (educationResponse) return educationResponse;

  const images = [
    ...listAccountFiles(session.user.id, "ai-generated-image").map((file) =>
      imagePayload(file, "generated"),
    ),
    ...listAccountFiles(session.user.id, "ai-edited-image").map((file) =>
      imagePayload(file, "edited"),
    ),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return Response.json(
    { images },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
