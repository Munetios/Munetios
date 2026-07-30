import { auth } from "../../../auth.js";
import {
  getPlan,
  getPlanPrice,
  normalizeCurrency,
} from "../../apps/ai/lib/pricing.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountData,
  getRequestFingerprint,
  setAccountData,
  updateAccountPlan,
} from "../../lib/authSecurity.js";
import { normalizeBusinessAccount } from "../../lib/businessAccounts.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stripeApiUrl = "https://api.stripe.com/v1";
const supportedPaymentMethods = new Set([
  "apple_pay",
  "card",
  "paypal",
  "cashapp",
]);
const checkoutRateLimit = 30;
const checkoutRateLimitWindowMs = 5 * 60 * 1000;

function getConfiguredPriceId(planId, currency) {
  const planKey = planId.toUpperCase().replaceAll("-", "_");
  const currencyKey = currency.toUpperCase();
  const priceId =
    process.env[`STRIPE_PRICE_${planKey}_${currencyKey}`] ||
    (currencyKey === "USD" ? process.env[`STRIPE_PRICE_${planKey}`] : "") ||
    "";

  return /^price_[A-Za-z0-9_]{8,200}$/.test(priceId) ? priceId : "";
}

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }

  const checkoutSessionId = new URL(request.url).searchParams.get("sessionId");
  if (!/^cs_[A-Za-z0-9_]{12,200}$/.test(checkoutSessionId || "")) {
    return response({ error: "invalid_checkout_session" }, { status: 400 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return response({ error: "stripe_unavailable" }, { status: 503 });
  }

  let stripeResponse;
  try {
    stripeResponse = await fetch(
      `${stripeApiUrl}/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`,
      {
        headers: { Authorization: `Bearer ${stripeSecret}` },
        method: "GET",
      },
    );
  } catch {
    return response({ error: "stripe_checkout_failed" }, { status: 502 });
  }
  const stripeSession = await stripeResponse.json().catch(() => ({}));
  if (!stripeResponse.ok) {
    return response({ error: "stripe_checkout_failed" }, { status: 502 });
  }
  if (
    stripeSession.client_reference_id !== session.user.id ||
    stripeSession.metadata?.munetios_account_id !== session.user.id
  ) {
    return response({ error: "checkout_session_forbidden" }, { status: 403 });
  }

  const completedPlanId = stripeSession.metadata?.munetios_plan_id || "";
  if (stripeSession.status === "complete") {
    if (completedPlanId.startsWith("business-")) {
      const business = normalizeBusinessAccount(
        getAccountData(session.user.id, "business", null),
        session.user.id,
      );
      if (!business?.verified) {
        return response(
          { error: "business_verification_required" },
          { status: 403 },
        );
      }
    }
    updateAccountPlan(session.user.id, completedPlanId);
    if (stripeSession.customer) {
      setAccountData(session.user.id, "billing", {
        stripeCustomerId: stripeSession.customer,
        updatedAt: new Date().toISOString(),
      });
    }
    if (completedPlanId.startsWith("business-")) {
      const business = getAccountData(session.user.id, "business", {});
      setAccountData(session.user.id, "business", {
        ...business,
        plan: completedPlanId,
        status: "active",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return response({
    paymentStatus: stripeSession.payment_status,
    planId: completedPlanId,
    status: stripeSession.status,
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }

  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }

  const fingerprint = getRequestFingerprint(request);
  const rateLimit = consumeRateLimit({
    key: `stripe-checkout:${session.user.id}:${fingerprint}`,
    limit: checkoutRateLimit,
    windowMs: checkoutRateLimitWindowMs,
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

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, { status: 400 });
  }

  const plan = getPlan(payload?.planId);
  if (plan.category === "business") {
    const business = normalizeBusinessAccount(
      getAccountData(session.user.id, "business", null),
      session.user.id,
    );
    if (!business?.verified) {
      return response(
        { error: "business_verification_required" },
        { status: 403 },
      );
    }
  }
  const currency = normalizeCurrency(payload?.currency).toLowerCase();
  const requestedPaymentMethod = supportedPaymentMethods.has(
    payload?.paymentMethod,
  )
    ? payload.paymentMethod
    : "card";
  const paymentMethod =
    requestedPaymentMethod === "apple_pay" ? "card" : requestedPaymentMethod;
  if (plan.category === "business" && paymentMethod === "cashapp") {
    return response({ error: "payment_method_unsupported" }, { status: 400 });
  }
  if (paymentMethod === "cashapp" && currency !== "usd") {
    return response(
      { error: "payment_method_currency_unsupported" },
      { status: 400 },
    );
  }
  if (plan.id === "free") {
    return response({ complete: true, planId: plan.id });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const stripePublishableKey =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY;
  if (!stripeSecret || !stripePublishableKey?.startsWith("pk_")) {
    return response({ error: "stripe_unavailable" }, { status: 503 });
  }

  const amount = Math.round(getPlanPrice(plan, currency) * 100);
  const configuredPriceId = getConfiguredPriceId(plan.id, currency);
  const storedBilling = getAccountData(session.user.id, "billing", {});
  const stripeCustomerId = /^cus_[A-Za-z0-9]{8,200}$/.test(
    storedBilling.stripeCustomerId || "",
  )
    ? storedBilling.stripeCustomerId
    : "";
  const stripePayload = new URLSearchParams();
  stripePayload.set("mode", "subscription");
  stripePayload.set("ui_mode", "elements");
  const requestUrl = new URL(request.url);
  const returnUrl = new URL(
    plan.category === "business" ? "/payments" : "/checkout",
    requestUrl.origin,
  );
  returnUrl.searchParams.set("plan", plan.id);
  returnUrl.searchParams.set("currency", currency.toUpperCase());
  returnUrl.searchParams.set("paymentMethod", requestedPaymentMethod);
  returnUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  stripePayload.set("return_url", returnUrl.toString());
  if (stripeCustomerId) {
    stripePayload.set("customer", stripeCustomerId);
  } else {
    stripePayload.set("customer_email", session.user.email);
  }
  stripePayload.set("client_reference_id", session.user.id);
  stripePayload.set("payment_method_types[0]", paymentMethod);
  if (configuredPriceId) {
    stripePayload.set("line_items[0][price]", configuredPriceId);
  } else {
    stripePayload.set("line_items[0][price_data][currency]", currency);
    stripePayload.set("line_items[0][price_data][unit_amount]", String(amount));
    stripePayload.set(
      "line_items[0][price_data][recurring][interval]",
      "month",
    );
    stripePayload.set(
      "line_items[0][price_data][product_data][name]",
      plan.category === "business"
        ? `Munetios ${plan.nameKey === "demoPlanBusinessStandard" ? "Business Standard" : "Business Pro"}`
        : `Munetios AI ${plan.id === "pro" ? "Pro" : "Pro Lite"}`,
    );
  }
  stripePayload.set("line_items[0][quantity]", "1");
  stripePayload.set("metadata[munetios_account_id]", session.user.id);
  stripePayload.set("metadata[munetios_plan_id]", plan.id);
  stripePayload.set(
    "subscription_data[metadata][munetios_account_id]",
    session.user.id,
  );
  stripePayload.set("subscription_data[metadata][munetios_plan_id]", plan.id);

  let stripeResponse;
  try {
    stripeResponse = await fetch(`${stripeApiUrl}/checkout/sessions`, {
      body: stripePayload,
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `munetios-${session.user.id}-${crypto.randomUUID()}`,
      },
      method: "POST",
    });
  } catch {
    return response({ error: "stripe_checkout_failed" }, { status: 502 });
  }
  const stripeSession = await stripeResponse.json().catch(() => ({}));
  if (!stripeResponse.ok || !stripeSession?.client_secret) {
    return response({ error: "stripe_checkout_failed" }, { status: 502 });
  }

  return response({
    clientSecret: stripeSession.client_secret,
    publishableKey: stripePublishableKey,
    sessionId: stripeSession.id,
  });
}
