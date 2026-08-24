import { requireAuth } from "../../../../../auth.js";
import {
  getConnector,
  getConnectorConnection,
} from "../../../../lib/connectorDatabase.js";
import { enforceStudentRestriction } from "../../../../lib/education.js";
import { enforceParentalConnectorAccess } from "../../../../lib/family.js";
import { enforceOrganizationConnectorAccess } from "../../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const educationResponse = enforceStudentRestriction(session, "github");
  if (educationResponse) return educationResponse;

  const policyResponse = enforceOrganizationConnectorAccess(session, {
    connectorId: "github",
  });
  if (policyResponse) return policyResponse;
  const parentalResponse = enforceParentalConnectorAccess(session, {
    connectorId: "github",
  });
  if (parentalResponse) return parentalResponse;

  const repository = new URL(request.url).searchParams.get("repo") || "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    return json({ error: "invalid_repository" }, { status: 400 });
  }

  const connector = getConnector("github");
  const connection = connector
    ? getConnectorConnection(session.user.id, connector.id)
    : null;
  if (!connection?.access_token) {
    return json({ error: "github_not_connected" }, { status: 409 });
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/branches?per_page=100`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${connection.access_token}`,
          "User-Agent": "Munetios",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(12_000),
      },
    );
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload)) {
      return json({ error: "branches_load_failed" }, { status: 502 });
    }
    return json({
      branches: payload.map((branch) => ({
        name: String(branch.name || ""),
        protected: Boolean(branch.protected),
      })),
    });
  } catch {
    return json({ error: "branches_load_failed" }, { status: 502 });
  }
}
