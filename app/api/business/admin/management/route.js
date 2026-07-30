import { createHash, randomBytes, randomUUID } from "node:crypto";
import { auth } from "../../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountByIdentifier,
  getAccountData,
  getRequestFingerprint,
  setAccountData,
} from "../../../../lib/authSecurity.js";
import {
  isBusinessAdministrator,
  normalizeBusinessAccount,
} from "../../../../lib/businessAccounts.js";
import {
  getBusinessPlanCapabilities,
  normalizeBusinessPlan,
} from "../../../../lib/organizationPolicies.js";
import {
  getDefaultOrganizationPolicies,
  organizationPolicyCatalog,
} from "../../../../lib/organizationPolicyCatalog.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const memberStatuses = new Set(["active", "archived", "suspended"]);
const roleNamePattern = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,59}$/u;

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function defaultRoles() {
  const policies = getDefaultOrganizationPolicies();
  return [
    {
      id: "administrator",
      name: "Administrator",
      policies,
      system: true,
    },
    {
      id: "member",
      name: "Member",
      policies,
      system: true,
    },
  ];
}

function getState(accountId) {
  const business = normalizeBusinessAccount(
    getAccountData(accountId, "business", null),
    accountId,
  );
  if (!business) return { error: "business_account_required", status: 404 };
  if (!isBusinessAdministrator(business)) {
    return { error: "business_administrator_required", status: 403 };
  }
  const settings = getAccountData(accountId, "business-admin", {});
  return {
    business,
    settings: {
      ...settings,
      customSignIn: {
        accentColor: "#a855f7",
        backgroundColor: "#16052b",
        enabled: false,
        heading: `Sign in to ${business.businessName || "Munetios"}`,
        message: "",
        oauthProviders: {
          github: true,
          google: false,
          microsoft: false,
        },
        quickCardsEnabled: true,
        title: business.businessName || "Munetios",
        ...(settings.customSignIn || {}),
      },
      domains: Array.isArray(settings.domains) ? settings.domains : [],
      members: Array.isArray(settings.members) ? settings.members : [],
      monetization: {
        enabled: Boolean(
          settings.monetization?.enabled || settings.monetizationEnabled,
        ),
        payoutLabel: String(settings.monetization?.payoutLabel || ""),
      },
      quickCards: Array.isArray(settings.quickCards) ? settings.quickCards : [],
      roles:
        Array.isArray(settings.roles) && settings.roles.length
          ? settings.roles
          : defaultRoles(),
    },
  };
}

function safeMember(member) {
  return {
    accountId: member.accountId || null,
    createdAt: member.createdAt,
    email: member.email,
    id: member.id,
    name: member.name || member.email,
    roleId: member.roleId,
    status: member.status,
  };
}

function publicState(state) {
  const plan = normalizeBusinessPlan(
    state.business.plan || state.settings.plan || "business-free",
  );
  return {
    business: {
      name: state.business.businessName,
      plan,
      verificationStatus: state.business.verificationStatus,
      verified: state.business.verified,
    },
    capabilities: getBusinessPlanCapabilities(plan, state.business.verified),
    policyCatalog: organizationPolicyCatalog,
    settings: {
      ...state.settings,
      members: state.settings.members
        .filter((member) => member.status !== "deleted")
        .map(safeMember),
      quickCards: state.settings.quickCards.map((card) => ({
        createdAt: card.createdAt,
        id: card.id,
        label: card.label,
        memberId: card.memberId,
        url: card.url,
      })),
    },
  };
}

function saveState(accountId, state) {
  state.settings.updatedAt = new Date().toISOString();
  setAccountData(accountId, "business-admin", state.settings);
}

function normalizePolicies(policies) {
  const allowed = new Set(organizationPolicyCatalog.map((entry) => entry.key));
  return Object.fromEntries(
    Object.entries(policies || {})
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, Boolean(value)]),
  );
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const state = getState(session.user.id);
  return state.error
    ? response({ error: state.error }, { status: state.status })
    : response(publicState(state));
}

export async function PATCH(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const rateLimit = consumeRateLimit({
    key: `business-management:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 80,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return response({ error: "rate_limited" }, { status: 429 });
  }
  const state = getState(session.user.id);
  if (state.error) {
    return response({ error: state.error }, { status: state.status });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, { status: 400 });
  }
  const action = String(payload?.action || "");
  const capabilities = getBusinessPlanCapabilities(
    state.business.plan || state.settings.plan,
    state.business.verified,
  );

  if (action === "add_member") {
    const email = String(payload.email || "")
      .trim()
      .toLowerCase();
    const roleId = String(payload.roleId || "member");
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !state.settings.roles.some((role) => role.id === roleId) ||
      state.settings.members.some(
        (member) =>
          member.status !== "deleted" && member.email.toLowerCase() === email,
      )
    ) {
      return response({ error: "invalid_member" }, { status: 400 });
    }
    const account = getAccountByIdentifier(email);
    state.settings.members.push({
      accountId: account?.id || null,
      createdAt: new Date().toISOString(),
      email,
      id: randomUUID(),
      name: account?.name || email.split("@")[0],
      roleId,
      status: "active",
    });
  } else if (action === "update_member") {
    const member = state.settings.members.find(
      (entry) => entry.id === payload.memberId,
    );
    if (!member)
      return response({ error: "member_not_found" }, { status: 404 });
    if (payload.status && memberStatuses.has(payload.status)) {
      member.status = payload.status;
    }
    if (
      payload.roleId &&
      state.settings.roles.some((role) => role.id === payload.roleId)
    ) {
      member.roleId = payload.roleId;
    }
  } else if (action === "delete_member") {
    const member = state.settings.members.find(
      (entry) => entry.id === payload.memberId,
    );
    if (!member)
      return response({ error: "member_not_found" }, { status: 404 });
    member.status = "deleted";
  } else if (action === "save_role") {
    const name = String(payload.name || "").trim();
    const roleId = String(payload.roleId || "");
    if (!roleNamePattern.test(name)) {
      return response({ error: "invalid_role" }, { status: 400 });
    }
    const policies = {
      ...getDefaultOrganizationPolicies(),
      ...normalizePolicies(payload.policies),
    };
    const existing = state.settings.roles.find((role) => role.id === roleId);
    if (existing) {
      if (existing.system && existing.id === "administrator") {
        return response(
          { error: "administrator_role_locked" },
          { status: 403 },
        );
      }
      existing.name = name;
      existing.policies = policies;
      existing.managedWorkspaces = Array.isArray(payload.managedWorkspaces)
        ? payload.managedWorkspaces
            .map((workspace) => String(workspace).trim().slice(0, 80))
            .filter(Boolean)
            .slice(0, 100)
        : [];
    } else {
      state.settings.roles.push({
        id: `role-${randomUUID()}`,
        managedWorkspaces: Array.isArray(payload.managedWorkspaces)
          ? payload.managedWorkspaces
              .map((workspace) => String(workspace).trim().slice(0, 80))
              .filter(Boolean)
              .slice(0, 100)
          : [],
        name,
        policies,
        system: false,
      });
    }
  } else if (action === "save_custom_signin") {
    if (!capabilities.customSignIn) {
      return response(
        { error: "business_verification_required" },
        { status: 403 },
      );
    }
    const next = payload.customSignIn || {};
    const colorPattern = /^#[\da-f]{6}$/i;
    state.settings.customSignIn = {
      ...state.settings.customSignIn,
      accentColor: colorPattern.test(next.accentColor)
        ? next.accentColor
        : state.settings.customSignIn.accentColor,
      backgroundColor: colorPattern.test(next.backgroundColor)
        ? next.backgroundColor
        : state.settings.customSignIn.backgroundColor,
      backgroundImage:
        capabilities.animatedSignInBackgrounds &&
        /^\/api\/business\/admin\/assets\/[\da-f-]{36}$/i.test(
          next.backgroundImage || "",
        )
          ? next.backgroundImage
          : "",
      enabled: Boolean(next.enabled),
      heading: String(next.heading || "")
        .trim()
        .slice(0, 100),
      html:
        capabilities.customHtmlSignIn && typeof next.html === "string"
          ? next.html.slice(0, 20000)
          : "",
      message: String(next.message || "")
        .trim()
        .slice(0, 300),
      oauthProviders: {
        github: Boolean(next.oauthProviders?.github),
        google: Boolean(next.oauthProviders?.google),
        microsoft: Boolean(next.oauthProviders?.microsoft),
      },
      quickCardsEnabled: Boolean(next.quickCardsEnabled),
      title: String(next.title || "")
        .trim()
        .slice(0, 80),
    };
  } else if (action === "add_domain") {
    if (!capabilities.customDomains) {
      return response(
        { error: "business_verification_required" },
        { status: 403 },
      );
    }
    const domain = String(payload.domain || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (
      !/^(?=.{4,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/.test(
        domain,
      )
    ) {
      return response({ error: "invalid_domain" }, { status: 400 });
    }
    if (!state.settings.domains.some((entry) => entry.domain === domain)) {
      state.settings.domains.push({
        createdAt: new Date().toISOString(),
        domain,
        id: randomUUID(),
        status: "pending_dns",
      });
    }
  } else if (action === "remove_domain") {
    state.settings.domains = state.settings.domains.filter(
      (entry) => entry.id !== payload.domainId,
    );
  } else if (action === "save_monetization") {
    if (!capabilities.monetization) {
      return response({ error: "plan_feature_unavailable" }, { status: 403 });
    }
    state.settings.monetization = {
      enabled: Boolean(payload.enabled),
      payoutLabel: String(payload.payoutLabel || "")
        .trim()
        .slice(0, 100),
    };
  } else if (action === "create_quickcard") {
    const member = state.settings.members.find(
      (entry) =>
        entry.id === payload.memberId &&
        entry.status === "active" &&
        entry.accountId,
    );
    if (!member) {
      return response(
        { error: "quickcard_requires_active_account" },
        { status: 400 },
      );
    }
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const url = `/business/quickcard/${encodeURIComponent(session.user.id)}/${token}`;
    state.settings.quickCards.push({
      createdAt: new Date().toISOString(),
      id,
      label: String(payload.label || member.name)
        .trim()
        .slice(0, 80),
      memberId: member.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      url,
    });
    saveState(session.user.id, state);
    return response({ ...publicState(state), createdQuickCard: { id, url } });
  } else if (action === "delete_quickcard") {
    state.settings.quickCards = state.settings.quickCards.filter(
      (card) => card.id !== payload.quickCardId,
    );
  } else {
    return response({ error: "unsupported_action" }, { status: 400 });
  }

  saveState(session.user.id, state);
  return response({ saved: true, ...publicState(state) });
}
