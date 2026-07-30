import { requireAuth } from "../../../../auth.js";
import { createAiReferralToken } from "../../../lib/aiReferral.js";
import {
  getAccountData,
  normalizeEmail,
  setAccountData,
} from "../../../lib/authSecurity.js";
import { sendAiInvitationEmail } from "../../../lib/nodemailerVerificationEmail.js";
import { enforceOrganizationAppAccess } from "../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";

const models = {
  "munet-1-advanced-plus": { free: 8, pro: 1, proLite: 3 },
  "munet-1-code-advanced-plus": { free: 8, pro: 1, proLite: 3 },
  "munet-1-instant": { free: 0, pro: 0, proLite: 0 },
  "munet-1-mini": { free: 0, pro: 0, proLite: 0 },
  "munet-1-pro": { free: 2, pro: 0, proLite: 1 },
  "munet-1-thinking": { free: 1, pro: 0, proLite: 1 },
};
const planLimits = {
  free: { daily: 500, hourly: 200 },
  pro: { daily: null, hourly: null },
  proLite: { daily: 5000, hourly: 2000 },
};

function getPlan(plan) {
  const normalized = String(plan || "").toLowerCase();
  if (
    normalized.includes("pro lite") ||
    normalized.includes("pro-lite") ||
    normalized.includes("munetios ai plus") ||
    normalized.includes("munetios-ai-plus")
  ) {
    return "proLite";
  }
  if (normalized.includes("pro")) return "pro";
  return "free";
}

function windowStart(date, type) {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  if (type === "day") next.setUTCHours(0);
  return next.toISOString();
}

function normalizeUsage(saved = {}) {
  const now = new Date();
  const hourStart = windowStart(now, "hour");
  const dayStart = windowStart(now, "day");
  return {
    dailyUsed: saved.dayStart === dayStart ? Number(saved.dailyUsed) || 0 : 0,
    dayStart,
    hourlyUsed:
      saved.hourStart === hourStart ? Number(saved.hourlyUsed) || 0 : 0,
    hourStart,
    usageResets: Number.isFinite(saved.usageResets)
      ? Math.max(0, Math.floor(saved.usageResets))
      : 3,
  };
}

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function usagePayload(session, usage) {
  const plan = getPlan(session.user.plan);
  const limits = planLimits[plan];
  const hourResetAt = new Date(
    new Date(usage.hourStart).getTime() + 60 * 60 * 1000,
  ).toISOString();
  const dayResetAt = new Date(
    new Date(usage.dayStart).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    ...usage,
    dayResetAt,
    extendedRequests: Boolean(
      getAccountData(session.user.id, "ai-settings", {})?.extendedRequests,
    ),
    hourResetAt,
    limits,
    modelCosts: Object.fromEntries(
      Object.entries(models).map(([id, costs]) => [id, costs[plan]]),
    ),
    plan,
  };
}

function getStoredUsage(session) {
  if (session.demo) {
    globalThis.__munetiosAiUsageStore ||= new Map();
    return globalThis.__munetiosAiUsageStore.get(session.user.id) || {};
  }
  return getAccountData(session.user.id, "ai-usage", {});
}

function saveUsage(session, usage) {
  if (session.demo) {
    globalThis.__munetiosAiUsageStore ||= new Map();
    globalThis.__munetiosAiUsageStore.set(session.user.id, usage);
  } else {
    setAccountData(session.user.id, "ai-usage", usage);
  }
}

export async function GET(request) {
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return authResponse;
  const policyResponse = enforceOrganizationAppAccess(session, "ai");
  if (policyResponse) return policyResponse;
  return response(
    usagePayload(session, normalizeUsage(getStoredUsage(session))),
  );
}

export async function POST(request) {
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return authResponse;
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, { status: 400 });
  }

  const usage = normalizeUsage(getStoredUsage(session));
  const plan = getPlan(session.user.plan);
  const limits = planLimits[plan];

  if (payload.action === "invite") {
    const email = normalizeEmail(payload.email);
    if (!email) {
      return response({ error: "invalid_email" }, { status: 400 });
    }
    const token = createAiReferralToken(session.user.id);
    const inviteUrl = `${new URL(request.url).origin}/signin?signup=true&ref=${encodeURIComponent(token)}`;
    const delivery = await sendAiInvitationEmail(
      email,
      inviteUrl,
      session.user.name || "A friend",
    );
    if (!delivery?.delivered) {
      return response(
        { error: delivery?.reason || "email_delivery_unavailable" },
        { status: 503 },
      );
    }
    return response({ delivered: true });
  }

  if (payload.action === "reset") {
    if (usage.usageResets < 1) {
      return response({ error: "no_usage_resets" }, { status: 409 });
    }
    usage.dailyUsed = 0;
    usage.hourlyUsed = 0;
    usage.usageResets -= 1;
    saveUsage(session, usage);
    return response(usagePayload(session, usage));
  }

  if (payload.action !== "consume" || !models[payload.model]) {
    return response({ error: "invalid_action" }, { status: 400 });
  }

  const cost = models[payload.model][plan];
  const limitReached =
    (limits.hourly !== null && usage.hourlyUsed + cost > limits.hourly) ||
    (limits.daily !== null && usage.dailyUsed + cost > limits.daily);
  if (limitReached && plan === "free") {
    return response({
      ...usagePayload(session, usage),
      allowed: true,
      cost: 0,
      fallbackModel: "munet-1-instant",
      limitReached: true,
    });
  }
  if (limitReached) {
    return response(
      { ...usagePayload(session, usage), error: "usage_limit_reached" },
      { status: 429 },
    );
  }

  usage.dailyUsed += cost;
  usage.hourlyUsed += cost;
  saveUsage(session, usage);
  return response({
    ...usagePayload(session, usage),
    allowed: true,
    cost,
    fallbackModel: null,
    limitReached: false,
  });
}
