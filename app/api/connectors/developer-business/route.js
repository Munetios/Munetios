import { auth, unauthorizedResponse } from "../../../../auth.js";
import { assertSameOrigin, normalizeEmail } from "../../../lib/authSecurity.js";
import {
  getDeveloperBusiness,
  verifyDeveloperBusiness,
} from "../../../lib/connectorDatabase.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = await auth(request);
  if (!session) return unauthorizedResponse();
  return Response.json({ business: getDeveloperBusiness(session.user.id) });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session) return unauthorizedResponse();
  const payload = await request.json().catch(() => ({}));
  const businessName = String(payload.businessName || "").trim();
  const contactEmail = normalizeEmail(payload.contactEmail);
  const description = String(payload.description || "").trim();
  let website;
  try {
    website = new URL(String(payload.website || "")).toString();
  } catch {
    website = "";
  }
  if (
    businessName.length < 2 ||
    businessName.length > 120 ||
    !contactEmail ||
    description.length < 20 ||
    description.length > 1000 ||
    !website.startsWith("http")
  ) {
    return Response.json({ error: "invalid_business_details" }, { status: 400 });
  }
  return Response.json({
    business: verifyDeveloperBusiness(session.user.id, {
      businessName, contactEmail, description, website,
    }),
    verified: true,
  });
}
