import { requireAuth } from "../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountById,
  getAccountData,
  getRequestFingerprint,
  setAccountData,
  verifyAccountPassword,
} from "../../lib/authSecurity.js";
import { getDemoSettings } from "../../lib/demoSettings.js";
import { getOrganizationContext } from "../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

const workspaceStore = globalThis.__munetiosWorkspaceStore || new Map();

globalThis.__munetiosWorkspaceStore = workspaceStore;

function isBusinessAccount(session) {
  if (session.demo) {
    return /^business\b/i.test(
      String(getDemoSettings(session)?.plan || session.user.plan || ""),
    );
  }

  const account = getAccountById(session.user.id);
  const business = getAccountData(session.user.id, "business", null);

  return (
    Boolean(business) ||
    Boolean(getOrganizationContext(session.user)) ||
    /^business\b/i.test(String(account?.plan || ""))
  );
}

function organizationWorkspaceRestriction(session, action, workspace = null) {
  const organization = getOrganizationContext(session.user);
  if (!organization) return null;
  if (organization.archived) {
    return jsonResponse(
      { error: "organization_account_archived" },
      { status: 403 },
    );
  }
  const policyKey = {
    create: "AllowWorkspaceCreation",
    delete: "AllowWorkspaceDeletion",
    rename: "AllowWorkspaceRename",
  }[action];
  if (policyKey && organization.policies?.[policyKey] === false) {
    return jsonResponse(
      { error: "organization_workspace_action_blocked" },
      { status: 403 },
    );
  }
  const managed = organization.managedWorkspaces || [];
  if (
    workspace &&
    organization.policies?.ManagedWorkspaces &&
    (managed.includes("*") ||
      managed.includes(workspace.id) ||
      managed.includes(workspace.name))
  ) {
    return jsonResponse(
      { error: "organization_workspace_managed" },
      { status: 403 },
    );
  }
  return null;
}

function saveUserWorkspaces(session, workspaces) {
  if (session.demo) {
    workspaceStore.set(session.sessionKey, workspaces);
    return;
  }

  setAccountData(session.user.id, "workspaces", workspaces);
}

function getUserWorkspaces(session) {
  let workspaces;

  if (session.demo) {
    if (!workspaceStore.has(session.sessionKey)) {
      const defaultWorkspaceName = isBusinessAccount(session)
        ? "Business"
        : "Personal";
      workspaceStore.set(
        session.sessionKey,
        [defaultWorkspaceName, "Work", "School"].map((name, index) =>
          createWorkspace(name, session.user.id, { primary: index === 0 }),
        ),
      );
    }
    workspaces = workspaceStore.get(session.sessionKey);
  } else {
    const storedWorkspaces = getAccountData(session.user.id, "workspaces", []);
    workspaces = Array.isArray(storedWorkspaces) ? storedWorkspaces : [];
  }

  if (workspaces.length === 0) {
    workspaces = [
      createWorkspace(
        isBusinessAccount(session) ? "Business" : "Personal",
        session.user.id,
        { primary: true },
      ),
    ];
    saveUserWorkspaces(session, workspaces);
    return workspaces;
  }

  const markedPrimaryIndex = workspaces.findIndex(
    (workspace) => workspace?.primary === true,
  );
  const primaryIndex = markedPrimaryIndex >= 0 ? markedPrimaryIndex : 0;
  let changed = false;
  const normalizedWorkspaces = workspaces.map((workspace, index) => {
    const primary = index === primaryIndex;
    if (workspace?.primary === primary) {
      return workspace;
    }
    changed = true;
    return { ...workspace, primary };
  });

  if (changed) {
    saveUserWorkspaces(session, normalizedWorkspaces);
  }

  return normalizedWorkspaces;
}

function jsonResponse(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function createWorkspace(name, ownerId, { primary = false } = {}) {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    id: `workspace-${crypto.randomUUID()}`,
    name,
    ownerId,
    primary,
    title: name,
    updatedAt: now,
  };
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }
  if (getDemoSettings(session)?.archived)
    return jsonResponse({ workspaces: [] });

  return jsonResponse({
    workspaces: getUserWorkspaces(session),
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return jsonResponse({ error: "invalid_origin" }, { status: 403 });
  }

  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }
  const policyResponse = organizationWorkspaceRestriction(session, "create");
  if (policyResponse) return policyResponse;

  let payload = null;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      {
        error: "invalid_json",
        message: "Invalid request body.",
      },
      { status: 400 },
    );
  }

  const name = typeof payload?.name === "string" ? payload.name.trim() : "";

  if (!name || name.length > 80) {
    return jsonResponse(
      {
        error: "invalid_workspace_name",
        message:
          "Workspace name is required and must be 80 characters or less.",
      },
      { status: 400 },
    );
  }

  const workspace = createWorkspace(name, session.user.id);
  const workspaces = getUserWorkspaces(session);

  workspaces.push(workspace);
  saveUserWorkspaces(session, workspaces);

  return jsonResponse(workspace, { status: 201 });
}

export async function PATCH(request) {
  if (!assertSameOrigin(request)) {
    return jsonResponse({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  const action =
    payload?.action === "rename" || payload?.action === "lock"
      ? payload.action
      : typeof payload?.locked === "boolean"
        ? "lock"
        : "";
  if (!action) {
    return jsonResponse({ error: "invalid_workspace_action" }, { status: 400 });
  }
  const rateLimit = consumeRateLimit({
    key: `workspace-${action}:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: "rate_limited" },
      {
        headers: { "Retry-After": String(rateLimit.retryAfter) },
        status: 429,
      },
    );
  }
  const workspaceId = String(payload.workspaceId || "");
  const workspaces = getUserWorkspaces(session);
  const index = workspaces.findIndex(
    (workspace) => workspace.id === workspaceId,
  );
  if (index < 0) {
    return jsonResponse({ error: "workspace_not_found" }, { status: 404 });
  }
  const policyResponse = organizationWorkspaceRestriction(
    session,
    action,
    workspaces[index],
  );
  if (policyResponse) return policyResponse;

  if (action === "rename") {
    const name = typeof payload?.name === "string" ? payload.name.trim() : "";
    if (!name || name.length > 80) {
      return jsonResponse({ error: "invalid_workspace_name" }, { status: 400 });
    }
    workspaces[index] = {
      ...workspaces[index],
      name,
      title: name,
      updatedAt: new Date().toISOString(),
    };
    saveUserWorkspaces(session, workspaces);
    return jsonResponse({ workspace: workspaces[index] });
  }

  if (!session.demo) {
    const verified = await verifyAccountPassword(
      getAccountById(session.user.id),
      payload.password,
    );
    if (!verified) {
      return jsonResponse(
        { error: "password_verification_failed" },
        { status: 400 },
      );
    }
  }

  workspaces[index] = {
    ...workspaces[index],
    locked: payload.locked === true,
    updatedAt: new Date().toISOString(),
  };
  saveUserWorkspaces(session, workspaces);
  return jsonResponse({ workspace: workspaces[index] });
}

export async function DELETE(request) {
  if (!assertSameOrigin(request)) {
    return jsonResponse({ error: "invalid_origin" }, { status: 403 });
  }

  const { response, session } = await requireAuth(request);
  if (response) return response;

  const rateLimit = consumeRateLimit({
    key: `workspace-delete:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: "rate_limited" },
      {
        headers: { "Retry-After": String(rateLimit.retryAfter) },
        status: 429,
      },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const workspaceId = String(payload?.workspaceId || "");
  const workspaces = getUserWorkspaces(session);
  const workspace = workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    return jsonResponse({ error: "workspace_not_found" }, { status: 404 });
  }
  const policyResponse = organizationWorkspaceRestriction(
    session,
    "delete",
    workspace,
  );
  if (policyResponse) return policyResponse;
  if (workspace.primary) {
    return jsonResponse(
      { error: "primary_workspace_protected" },
      { status: 403 },
    );
  }

  const nextWorkspaces = workspaces.filter((item) => item.id !== workspaceId);
  saveUserWorkspaces(session, nextWorkspaces);

  return jsonResponse({
    deleted: true,
    workspaceId,
    workspaces: nextWorkspaces,
  });
}
