import { requireAuth } from "../../../../auth.js";
import {
  assertSameOrigin,
  getAccountData,
  setAccountData,
} from "../../../lib/authSecurity.js";
import { enforceParentalAiAccess } from "../../../lib/family.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

const storageKey = "ai-projects-v1";

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function text(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

async function authenticated(request, mutating = false) {
  if (mutating && !assertSameOrigin(request)) {
    return { response: json({ error: "invalid_origin" }, { status: 403 }) };
  }
  const { response, session } = await requireAuth(request);
  if (response) return { response };
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating,
  });
  if (policyResponse) return { response: policyResponse };
  const parentalResponse = enforceParentalAiAccess(session);
  return parentalResponse ? { response: parentalResponse } : { session };
}

function readProjects(session) {
  const projects = getAccountData(session.user.id, storageKey, []);
  return Array.isArray(projects) ? projects.slice(0, 100) : [];
}

function writeProjects(session, projects) {
  setAccountData(session.user.id, storageKey, projects.slice(0, 100));
}

export async function GET(request) {
  const auth = await authenticated(request);
  return auth.response || json({ projects: readProjects(auth.session) });
}

export async function POST(request) {
  const auth = await authenticated(request, true);
  if (auth.response) return auth.response;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_payload" }, { status: 400 });
  }
  const name = text(payload?.name, 120);
  if (!name) return json({ error: "name_required" }, { status: 400 });
  const now = new Date().toISOString();
  const project = {
    color: /^#[\da-f]{6}$/iu.test(payload?.color) ? payload.color : "#9b5cff",
    createdAt: now,
    description: text(payload?.description, 500),
    id: crypto.randomUUID(),
    name,
    pinned: false,
    sources: [],
    updatedAt: now,
  };
  writeProjects(auth.session, [project, ...readProjects(auth.session)]);
  return json({ created: true, project }, { status: 201 });
}

export async function PATCH(request) {
  const auth = await authenticated(request, true);
  if (auth.response) return auth.response;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_payload" }, { status: 400 });
  }
  const id = text(payload?.id, 100);
  const projects = readProjects(auth.session);
  const current = projects.find((project) => project.id === id);
  if (!current) return json({ error: "project_not_found" }, { status: 404 });
  const project = {
    ...current,
    ...(typeof payload.name === "string"
      ? { name: text(payload.name, 120) }
      : {}),
    ...(typeof payload.description === "string"
      ? { description: text(payload.description, 500) }
      : {}),
    ...(typeof payload.pinned === "boolean" ? { pinned: payload.pinned } : {}),
    updatedAt: new Date().toISOString(),
  };
  writeProjects(
    auth.session,
    projects.map((item) => (item.id === id ? project : item)),
  );
  return json({ project, saved: true });
}

export async function DELETE(request) {
  const auth = await authenticated(request, true);
  if (auth.response) return auth.response;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_payload" }, { status: 400 });
  }
  const id = text(payload?.id, 100);
  const projects = readProjects(auth.session);
  if (!projects.some((project) => project.id === id)) {
    return json({ error: "project_not_found" }, { status: 404 });
  }
  writeProjects(
    auth.session,
    projects.filter((project) => project.id !== id),
  );
  return json({ deleted: true });
}
