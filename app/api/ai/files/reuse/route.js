import { auth } from "../../../../../auth.js";
import { listAccountFiles } from "../../../../lib/accountStorage.js";
import { enforceParentalAiAccess } from "../../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function filePayload(file) {
  const metadata = file.metadata || {};
  return {
    contentType: file.contentType,
    createdAt: file.createdAt,
    id: file.id,
    name: file.name,
    size: file.size,
    endToEndEncrypted: metadata.endToEndEncrypted === true,
    encryption:
      metadata.endToEndEncrypted === true ? metadata.clientEncryption : null,
    url: `/api/ai/files/${encodeURIComponent(file.id)}`,
  };
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const policyResponse = enforceOrganizationAppAccess(session, "ai");
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return parentalResponse;

  const url = new URL(request.url);
  const fingerprint = String(url.searchParams.get("fingerprint") || "").slice(
    0,
    128,
  );
  if (!/^[\da-f]{64}$/u.test(fingerprint)) {
    return response({ error: "invalid_fingerprint" }, { status: 400 });
  }
  const category =
    url.searchParams.get("scope") === "library"
      ? "ai-library-file"
      : "ai-prompt-file";
  const reusableFile = listAccountFiles(session.user.id, category).find(
    (file) =>
      file.metadata?.clientFingerprint === fingerprint &&
      file.metadata?.endToEndEncrypted === true,
  );
  return reusableFile
    ? response({ file: filePayload(reusableFile), reused: true })
    : response({ error: "file_not_found" }, { status: 404 });
}
