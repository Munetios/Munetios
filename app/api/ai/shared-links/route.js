import { auth, requireAuth } from "../../../../auth.js";
import {
  createAiSharedLink,
  deleteAiSharedLink,
  getAiSharedLink,
  listAiSharedLinks,
  updateAiSharedLink,
  updateAiSharedLinkMembers,
} from "../../../lib/aiSharedLinks.js";
import { getAccountByIdentifier } from "../../../lib/authSecurity.js";
import { enforceStudentAiCapability } from "../../../lib/education.js";
import { enforceParentalAiAccess } from "../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
const encryptedPayloadPattern = /^e2ee1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/u;

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function text(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

async function authenticate(request, mutating = false) {
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return { response: authResponse };
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating,
  });
  if (policyResponse) return { response: policyResponse };
  const parentalResponse = enforceParentalAiAccess(session);
  if (parentalResponse) return { response: parentalResponse };
  const educationResponse = enforceStudentAiCapability(session, "sharing");
  return educationResponse ? { response: educationResponse } : { session };
}

function tokenFrom(url) {
  return text(url.searchParams.get("token"), 200);
}

export async function GET(request) {
  const url = new URL(request.url);
  const id = text(url.searchParams.get("id"), 100);
  if (id) {
    const session = await auth(request);
    const educationResponse = enforceStudentAiCapability(session, "sharing");
    if (educationResponse) return educationResponse;
    const link = getAiSharedLink(id, tokenFrom(url), session?.user?.id || "");
    return link
      ? response({ link })
      : response({ error: "link_not_found" }, { status: 404 });
  }
  const authenticated = await authenticate(request);
  if (authenticated.response) return authenticated.response;
  return response({ links: listAiSharedLinks(authenticated.session.user.id) });
}

export async function POST(request) {
  const authenticated = await authenticate(request, true);
  if (authenticated.response) return authenticated.response;
  const payload = await request.json().catch(() => ({}));
  const encryptedPayload = text(payload.encryptedPayload, 10_000_000);
  if (!encryptedPayloadPattern.test(encryptedPayload)) {
    return response(
      { error: "invalid_encrypted_conversation" },
      { status: 400 },
    );
  }
  const link = createAiSharedLink({
    conversationId: text(payload.conversationId, 100),
    encryptedPayload,
    origin: new URL(request.url).origin,
    ownerId: authenticated.session.user.id,
    title: text(payload.title, 120) || "Voice mode conversation",
  });
  return response({ link }, { status: 201 });
}

export async function PATCH(request) {
  const optionalSession = await auth(request);
  const educationResponse = enforceStudentAiCapability(
    optionalSession,
    "sharing",
  );
  if (educationResponse) return educationResponse;
  const payload = await request.json().catch(() => ({}));
  const id = text(payload.id, 100);
  if (payload.action === "add-member" || payload.action === "remove-member") {
    const authenticated = await authenticate(request, true);
    if (authenticated.response) return authenticated.response;
    const current = getAiSharedLink(id, "", authenticated.session.user.id);
    if (!current?.isOwner)
      return response({ error: "owner_required" }, { status: 403 });
    const email = text(payload.email, 320).toLowerCase();
    let members = Array.isArray(current.members) ? current.members : [];
    if (payload.action === "add-member") {
      const account = getAccountByIdentifier(email);
      if (!account || account.id === authenticated.session.user.id) {
        return response({ error: "account_not_found" }, { status: 404 });
      }
      members = [
        ...members.filter((member) => member.accountId !== account.id),
        {
          accountId: account.id,
          email: account.email,
          name: account.name || account.email,
        },
      ].slice(-50);
    } else {
      members = members.filter(
        (member) => member.email.toLowerCase() !== email,
      );
    }
    const link = updateAiSharedLinkMembers(
      authenticated.session.user.id,
      id,
      members,
    );
    return link
      ? response({ link })
      : response({ error: "link_not_found" }, { status: 404 });
  }

  const encryptedPayload = text(payload.encryptedPayload, 10_000_000);
  if (!id || !encryptedPayloadPattern.test(encryptedPayload)) {
    return response(
      { error: "invalid_encrypted_conversation" },
      { status: 400 },
    );
  }
  const result = updateAiSharedLink({
    encryptedPayload,
    id,
    token: text(payload.token, 200),
    version: Math.max(1, Number(payload.version) || 1),
  });
  if (result.error === "version_conflict")
    return response(result, { status: 409 });
  if (result.error) return response(result, { status: 404 });
  return response(result);
}

export async function DELETE(request) {
  const authenticated = await authenticate(request, true);
  if (authenticated.response) return authenticated.response;
  const payload = await request.json().catch(() => ({}));
  const id = text(payload.id, 100);
  if (!id) return response({ error: "invalid_link" }, { status: 400 });
  return deleteAiSharedLink(authenticated.session.user.id, id)
    ? response({ deleted: true })
    : response({ error: "link_not_found" }, { status: 404 });
}
