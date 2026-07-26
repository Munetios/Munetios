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

export const dynamic = "force-dynamic";

const workspaceStore = globalThis.__munetiosWorkspaceStore || new Map();

globalThis.__munetiosWorkspaceStore = workspaceStore;

function getUserWorkspaces(session) {
  if (!session.demo) {
    return getAccountData(session.user.id, "workspaces", []);
  }
  if (!workspaceStore.has(session.sessionKey)) {
    workspaceStore.set(
      session.sessionKey,
      session.demo
        ? ["Personal", "Work", "School"].map((name) =>
            createWorkspace(name, session.user.id),
          )
        : [],
    );
  }

  return workspaceStore.get(session.sessionKey);
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

function createWorkspace(name, ownerId) {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    id: `workspace-${crypto.randomUUID()}`,
    name,
    ownerId,
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
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }

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
  if (!session.demo) {
    setAccountData(session.user.id, "workspaces", workspaces);
  }

  return jsonResponse(workspace, { status: 201 });
}

export async function PATCH(request) {
  if (!assertSameOrigin(request)) {
    return jsonResponse({ error: "invalid_origin" }, { status: 403 });
  }
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (session.demo) {
    return jsonResponse(
      { error: "demo_workspace_lock_unavailable" },
      { status: 403 },
    );
  }
  const rateLimit = consumeRateLimit({
    key: `workspace-lock:${session.user.id}:${getRequestFingerprint(request)}`,
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
  const workspaceId = String(payload.workspaceId || "");
  const workspaces = getUserWorkspaces(session);
  const index = workspaces.findIndex(
    (workspace) => workspace.id === workspaceId,
  );
  if (index < 0) {
    return jsonResponse({ error: "workspace_not_found" }, { status: 404 });
  }
  workspaces[index] = {
    ...workspaces[index],
    locked: payload.locked === true,
    updatedAt: new Date().toISOString(),
  };
  setAccountData(session.user.id, "workspaces", workspaces);
  return jsonResponse({ workspace: workspaces[index] });
}
