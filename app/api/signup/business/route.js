import { auth } from "../../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountData,
  getRequestFingerprint,
  normalizeEmail,
  setAccountData,
  updateAccountPlan,
} from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const allowedCompanies = new Set([
  "startup",
  "small-business",
  "medium-business",
  "enterprise",
]);
const allowedCurrencies = new Set(["AUD", "CAD", "EUR", "GBP", "USD"]);
const allowedPaymentMethods = new Set(["card", "paypal"]);
const allowedPlans = new Set(["business-free", "business-pro"]);
const allowedTeamSizes = new Set(["1-5", "6-25", "26-100", "100+"]);

function jsonResponse(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function normalizeWebsite(value) {
  const website = String(value || "").trim();
  if (!website) return "";

  try {
    const url = new URL(website);
    return ["http:", "https:"].includes(url.protocol) && website.length <= 2048
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function validatePayload(payload) {
  const businessName = String(payload?.businessName || "").trim();
  const businessWebsite = normalizeWebsite(payload?.businessWebsite);
  const company = String(payload?.company || "");
  const currency = String(payload?.currency || "USD").toUpperCase();
  const email = normalizeEmail(payload?.email);
  const paymentMethod = String(payload?.paymentMethod || "card");
  const plan = String(payload?.plan || "business-free");
  const team = String(payload?.team || "");

  if (
    businessName.length < 2 ||
    businessName.length > 120 ||
    businessWebsite === null ||
    !allowedCompanies.has(company) ||
    !allowedCurrencies.has(currency) ||
    !email ||
    !allowedPaymentMethods.has(paymentMethod) ||
    !allowedPlans.has(plan) ||
    !allowedTeamSizes.has(team)
  ) {
    return null;
  }

  return {
    businessName,
    businessWebsite,
    company,
    currency,
    email,
    paymentMethod,
    plan,
    team,
  };
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return jsonResponse({ error: "signin_required" }, { status: 401 });
  }

  return jsonResponse({
    business: getAccountData(session.user.id, "business", null),
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return jsonResponse({ error: "invalid_origin" }, { status: 403 });
  }

  const session = await auth(request);
  if (!session || session.demo) {
    return jsonResponse({ error: "signin_required" }, { status: 401 });
  }

  const rateLimit = consumeRateLimit({
    key: `business-signup:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return jsonResponse({ error: "rate_limited" }, { status: 429 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }

  const details = validatePayload(payload);
  if (!details) {
    return jsonResponse({ error: "invalid_business_details" }, { status: 400 });
  }

  const previousBusiness = getAccountData(session.user.id, "business", {});
  const now = new Date().toISOString();
  const business = {
    ...details,
    accountId: session.user.id,
    createdAt: previousBusiness?.createdAt || now,
    status: details.plan === "business-pro" ? "pending_payment" : "active",
    updatedAt: now,
  };
  setAccountData(session.user.id, "business", business);

  if (details.plan === "business-free") {
    updateAccountPlan(session.user.id, "business-free");
    return jsonResponse({
      business,
      redirectUrl: "/account/settings",
      success: true,
    });
  }

  const checkoutParams = new URLSearchParams({
    currency: details.currency,
    paymentMethod: details.paymentMethod,
    plan: details.plan,
  });
  return jsonResponse({
    business,
    checkoutUrl: `/payments?${checkoutParams.toString()}`,
    success: true,
  });
}
