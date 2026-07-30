import { auth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountData,
  getRequestFingerprint,
  setAccountData,
} from "../../../lib/authSecurity.js";
import {
  getBusinessCapabilities,
  isBusinessAdministrator,
  normalizeBusinessAccount,
} from "../../../lib/businessAccounts.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function getBusinessAdminState(accountId) {
  const business = normalizeBusinessAccount(
    getAccountData(accountId, "business", null),
    accountId,
  );
  if (!business) {
    return { error: "business_account_required", status: 404 };
  }
  if (!isBusinessAdministrator(business)) {
    return { error: "business_administrator_required", status: 403 };
  }

  const settings = getAccountData(accountId, "business-admin", {});
  return {
    business,
    capabilities: getBusinessCapabilities(business),
    settings: {
      customEmailDomain: String(settings.customEmailDomain || ""),
      customSignIn: {
        enabled: Boolean(settings.customSignIn?.enabled),
        heading: String(
          settings.customSignIn?.heading ||
            `Sign in to ${business.businessName || "Munetios"}`,
        ).slice(0, 100),
        message: String(settings.customSignIn?.message || "").slice(0, 300),
      },
      monetizationEnabled: Boolean(settings.monetizationEnabled),
    },
  };
}

function normalizeDomain(value) {
  const domain = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return /^(?=.{4,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/.test(
    domain,
  )
    ? domain
    : "";
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }

  const state = getBusinessAdminState(session.user.id);
  if (state.error) {
    return response({ error: state.error }, { status: state.status });
  }

  return response({
    business: {
      name: state.business.businessName,
      role: state.business.role,
      verificationStatus: state.business.verificationStatus,
      verified: state.business.verified,
    },
    capabilities: state.capabilities,
    settings: state.settings,
    signInPageUrl: `/business/signin/${encodeURIComponent(session.user.id)}`,
  });
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
    key: `business-admin:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return response(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      {
        headers: { "Retry-After": String(rateLimit.retryAfter) },
        status: 429,
      },
    );
  }

  const state = getBusinessAdminState(session.user.id);
  if (state.error) {
    return response({ error: state.error }, { status: state.status });
  }
  if (!state.business.verified) {
    return response(
      { error: "business_verification_required" },
      { status: 403 },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, { status: 400 });
  }

  const heading = String(payload?.customSignIn?.heading || "").trim();
  const message = String(payload?.customSignIn?.message || "").trim();
  const customEmailDomain = payload?.customEmailDomain
    ? normalizeDomain(payload.customEmailDomain)
    : "";
  if (
    heading.length > 100 ||
    message.length > 300 ||
    (payload?.customEmailDomain && !customEmailDomain)
  ) {
    return response({ error: "invalid_business_settings" }, { status: 400 });
  }

  const settings = {
    customEmailDomain,
    customSignIn: {
      enabled: Boolean(payload?.customSignIn?.enabled),
      heading:
        heading || `Sign in to ${state.business.businessName || "Munetios"}`,
      message,
    },
    monetizationEnabled: Boolean(payload?.monetizationEnabled),
    updatedAt: new Date().toISOString(),
  };
  setAccountData(session.user.id, "business-admin", settings);

  return response({
    saved: true,
    settings,
    signInPageUrl: `/business/signin/${encodeURIComponent(session.user.id)}`,
  });
}
