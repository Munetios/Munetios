import { auth, unauthorizedResponse } from "../../../../auth.js";
import {
  assertSameOrigin,
  listAccountPasskeys,
} from "../../../lib/authSecurity.js";
import {
  createPrivateConnector,
  getDeveloperBusiness,
} from "../../../lib/connectorDatabase.js";

export const dynamic = "force-dynamic";

function validUrl(value) {
  try {
    return new URL(String(value || "")).toString();
  } catch {
    return "";
  }
}

function validIcon(value) {
  const icon = String(value || "");
  if (!icon) return "/favicon.ico";
  if (/^\/api\/connectors\/icons\/[a-f0-9-]{36}$/u.test(icon)) {
    return icon;
  }
  return validUrl(icon);
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session) return unauthorizedResponse();
  const payload = await request.json().catch(() => ({}));
  const visibility = payload.visibility === "public" ? "public" : "private";
  if (
    visibility === "public" &&
    (listAccountPasskeys(session.user.id).length === 0 ||
      getDeveloperBusiness(session.user.id)?.status !== "verified")
  ) {
    return Response.json({ error: "publisher_verification_required" }, { status: 403 });
  }
  const input = {
    description: String(payload.description || "").trim(),
    developer: String(payload.developer || "").trim(),
    iconUrl: validIcon(payload.iconUrl) || "/favicon.ico",
    name: String(payload.name || "").trim(),
    privacyUrl: validUrl(payload.privacyUrl),
    termsUrl: validUrl(payload.termsUrl),
    visibility,
    websiteUrl: validUrl(payload.websiteUrl),
  };
  if (
    input.name.length < 2 ||
    input.description.length < 20 ||
    !input.developer ||
    !input.privacyUrl ||
    !input.termsUrl ||
    !input.websiteUrl
  ) {
    return Response.json({ error: "invalid_connector_details" }, { status: 400 });
  }
  return Response.json(
    { connector: createPrivateConnector(session.user.id, input) },
    { status: 201 },
  );
}
