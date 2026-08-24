import { requireAuth } from "../../../../../auth.js";
import {
  createOAuthState,
  getConnector,
} from "../../../../lib/connectorDatabase.js";
import { enforceStudentRestriction } from "../../../../lib/education.js";
import { enforceParentalConnectorAccess } from "../../../../lib/family.js";
import { getGithubAuthConfiguration } from "../../../../lib/githubAuth.js";
import { enforceOrganizationConnectorAccess } from "../../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

const githubOrigin = "http://localhost:3000";
const githubCallbackUrl = `${githubOrigin}/api/callback/github`;

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

  const acceptsJson = request.headers
    .get("accept")
    ?.toLowerCase()
    .includes("application/json");
  const connector = getConnector("github");
  const { clientId } = getGithubAuthConfiguration();
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
  const requestedReturnTo = new URL(request.url).searchParams.get("returnTo");
  const returnTo =
    requestedReturnTo?.startsWith("/") && !requestedReturnTo.startsWith("//")
      ? requestedReturnTo
      : "/account/settings/connectors";
  const state = createOAuthState(session.user.id, connector.id, returnTo);
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
