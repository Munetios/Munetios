import { requireAuth } from "../../../../../auth.js";
import {
  createOAuthState,
  getConnector,
} from "../../../../lib/connectorDatabase.js";
import { enforceOrganizationConnectorAccess } from "../../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

const githubOrigin = "https://localhost:3000";
const githubCallbackUrl = `${githubOrigin}/api/callback/github`;

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationConnectorAccess(session, {
    connectorId: "github",
  });
  if (policyResponse) return policyResponse;

  const acceptsJson = request.headers
    .get("accept")
    ?.toLowerCase()
    .includes("application/json");
  const connector = getConnector("github");
  const clientId = process.env.GITHUB_CONNECTOR_CLIENT_ID;
  if (!connector || !clientId) {
    if (acceptsJson) {
      return Response.json({ error: "connector_unavailable" }, { status: 503 });
    }
    return Response.redirect(
      new URL(
        "/account/settings/connectors?connectorError=connect",
        githubOrigin,
      ),
    );
  }
  const state = createOAuthState(session.user.id, connector.id);
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", githubCallbackUrl);
  authorizeUrl.searchParams.set("scope", "read:user user:email repo");
  authorizeUrl.searchParams.set("state", state);
  if (acceptsJson) {
    return Response.json(
      { authorizeUrl: authorizeUrl.toString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.redirect(authorizeUrl);
}
