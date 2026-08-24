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

function githubHeaders(accessToken) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "Munetios",
    "X-GitHub-Api-Version": "2022-11-28",
  };
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

  const connector = getConnector("github");
  const connection = connector
    ? getConnectorConnection(session.user.id, connector.id)
    : null;

  if (!connection?.access_token) {
    return json({ connected: false, repositories: [] });
  }

  try {
    const response = await fetch(
      "https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated",
      {
        cache: "no-store",
        headers: githubHeaders(connection.access_token),
        signal: AbortSignal.timeout(12_000),
      },
    );
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload)) {
      return json(
        {
          connected: true,
          error: "repositories_load_failed",
          repositories: [],
        },
        { status: 502 },
      );
    }

    return json({
      connected: true,
      repositories: payload.map((repository) => ({
        defaultBranch: String(repository.default_branch || "main"),
        description: String(repository.description || ""),
        fullName: String(repository.full_name || repository.name || ""),
        id: String(repository.id || repository.full_name || repository.name),
        name: String(repository.name || ""),
        owner: String(repository.owner?.login || ""),
        private: Boolean(repository.private),
        updatedAt: String(repository.updated_at || ""),
      })),
    });
  } catch {
    return json(
      {
        connected: true,
        error: "repositories_load_failed",
        repositories: [],
      },
      { status: 502 },
    );
  }
}
