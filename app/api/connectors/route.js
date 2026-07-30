import { auth, requireAuth } from "../../../auth.js";
import { assertSameOrigin } from "../../lib/authSecurity.js";
import {
  disconnectConnector,
  listAccountConnectors,
  listPublicConnectors,
} from "../../lib/connectorDatabase.js";
import { enforceOrganizationConnectorAccess } from "../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const storeRequest =
    new URL(request.url).searchParams.get("scope") === "store";

  if (storeRequest) {
    const session = await auth(request);
    return Response.json(
      {
        authenticated: Boolean(session),
        connectors: session
          ? listAccountConnectors(session.user.id)
          : listPublicConnectors(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationConnectorAccess(session);
  if (policyResponse) return policyResponse;

  return Response.json(
    {
      authenticated: true,
      connectors: listAccountConnectors(session.user.id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const policyResponse = enforceOrganizationConnectorAccess(session, {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  const connectorId = new URL(request.url).searchParams.get("connectorId");
  if (!connectorId) {
    return Response.json({ error: "invalid_connector" }, { status: 400 });
  }
  disconnectConnector(session.user.id, connectorId);
  return Response.json({ disconnected: true });
}
