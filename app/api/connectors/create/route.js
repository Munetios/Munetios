import { randomUUID } from "node:crypto";
import { auth, unauthorizedResponse } from "../../../../auth.js";
import { assertSameOrigin } from "../../../lib/authSecurity.js";
import { createPrivateConnector } from "../../../lib/connectorDatabase.js";
import { saveDurableCustomConnector } from "../../../lib/durableAuthStore.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session) return unauthorizedResponse();
  const payload = await request.json().catch(() => null);
  const text = (key, maximum) =>
    typeof payload?.[key] === "string"
      ? payload[key].trim().slice(0, maximum)
      : "";
  const safeUrl = (key, { required = true } = {}) => {
    const input = text(key, 2000);
    if (!input && !required) return "";
    try {
      const url = new URL(input);
      return url.protocol === "https:" ? url.toString() : "";
    } catch {
      return "";
    }
  };
  const name = text("name", 100);
  const description = text("description", 1000);
  const developer = text("developer", 100);
  const websiteUrl = safeUrl("websiteUrl");
  const termsUrl = safeUrl("termsUrl");
  const privacyUrl = safeUrl("privacyUrl");
  const iconUrl = text("iconUrl", 2000);
  if (
    name.length < 2 ||
    description.length < 10 ||
    developer.length < 2 ||
    !websiteUrl ||
    !termsUrl ||
    !privacyUrl ||
    (iconUrl && !iconUrl.startsWith("/api/connectors/icons/"))
  ) {
    return Response.json({ error: "invalid_connector" }, { status: 400 });
  }
  const id = randomUUID();
  const connector = {
    connected: false,
    description,
    developer,
    iconUrl,
    id,
    name,
    privacyUrl,
    slug: `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")}-${id.slice(0, 8)}`,
    status: payload.visibility === "public" ? "pending" : "private",
    termsUrl,
    visibility: payload.visibility === "public" ? "public" : "private",
    websiteUrl,
  };
  const savedDurably = await saveDurableCustomConnector(
    session.user.id,
    connector,
  );
  const savedConnector = savedDurably
    ? connector
    : createPrivateConnector(session.user.id, connector);
  return Response.json(
    { connector: savedConnector },
    { headers: { "Cache-Control": "no-store" }, status: 201 },
  );
}
