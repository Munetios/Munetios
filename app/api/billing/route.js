import { auth } from "../../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getAccountData,
  getRequestFingerprint,
  setAccountData,
} from "../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stripeApiUrl = "https://api.stripe.com/v1";
const stripeCustomerPattern = /^cus_[A-Za-z0-9]{8,200}$/;
const stripePaymentMethodPattern = /^pm_[A-Za-z0-9]{8,200}$/;
const stripeSubscriptionPattern = /^sub_[A-Za-z0-9]{8,200}$/;

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

async function stripeRequest(stripeSecret, path, options = {}) {
  const stripeResponse = await fetch(`${stripeApiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      ...(options.headers || {}),
    },
  });
  const stripePayload = await stripeResponse.json().catch(() => ({}));
  if (!stripeResponse.ok) {
    const error = new Error(
      stripePayload.error?.message || "stripe_request_failed",
    );
    error.status = stripeResponse.status;
    throw error;
  }
  return stripePayload;
}

async function findStripeCustomer(
  stripeSecret,
  session,
  { createIfMissing = false } = {},
) {
  const storedBilling = getAccountData(session.user.id, "billing", {});
  if (stripeCustomerPattern.test(storedBilling.stripeCustomerId || "")) {
    try {
      const storedCustomer = await stripeRequest(
        stripeSecret,
        `/customers/${encodeURIComponent(storedBilling.stripeCustomerId)}`,
      );
      if (!storedCustomer.deleted) return storedBilling.stripeCustomerId;
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    const { stripeCustomerId: _removedCustomerId, ...billingWithoutCustomer } =
      storedBilling;
    setAccountData(session.user.id, "billing", billingWithoutCustomer);
  }

  const parameters = new URLSearchParams({
    email: session.user.email,
    limit: "10",
  });
  const stripePayload = await stripeRequest(
    stripeSecret,
    `/customers?${parameters.toString()}`,
  );
  const customer = stripePayload.data?.find(
    (entry) => entry.email?.toLowerCase() === session.user.email.toLowerCase(),
  );
  let customerId = customer?.id || "";
  if (!customerId && createIfMissing) {
    const customerPayload = new URLSearchParams({
      email: session.user.email,
      "metadata[munetios_account_id]": session.user.id,
    });
    if (session.user.name) customerPayload.set("name", session.user.name);
    const createdCustomer = await stripeRequest(stripeSecret, "/customers", {
      body: customerPayload,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `munetios-billing-customer-${session.user.id}`,
      },
      method: "POST",
    });
    customerId = createdCustomer.id || "";
  }
  if (!stripeCustomerPattern.test(customerId)) return "";

  setAccountData(session.user.id, "billing", {
    ...storedBilling,
    stripeCustomerId: customerId,
    updatedAt: new Date().toISOString(),
  });
  return customerId;
}

function getSubscriptionPeriodEnd(subscription) {
  return (
    subscription.current_period_end ||
    subscription.items?.data?.reduce(
      (latest, item) => Math.max(latest, item.current_period_end || 0),
      0,
    ) ||
    null
  );
}

function mapSubscription(subscription) {
  const item = subscription.items?.data?.[0] || {};
  const price = item.price || {};
  const product = price.product || {};
  return {
    amount: price.unit_amount,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: subscription.canceled_at,
    currency: price.currency || subscription.currency,
    currentPeriodEnd: getSubscriptionPeriodEnd(subscription),
    id: subscription.id,
    interval: price.recurring?.interval || "month",
    name:
      (typeof product === "object" ? product.name : "") ||
      subscription.metadata?.munetios_plan_id ||
      "Munetios",
    status: subscription.status,
  };
}

function mapPaymentMethod(paymentMethod) {
  return {
    brand:
      paymentMethod.type === "paypal"
        ? "PayPal"
        : paymentMethod.card?.brand || "card",
    email:
      paymentMethod.billing_details?.email ||
      paymentMethod.paypal?.payer_email ||
      "",
    expMonth: paymentMethod.card?.exp_month || null,
    expYear: paymentMethod.card?.exp_year || null,
    id: paymentMethod.id,
    last4: paymentMethod.card?.last4 || "",
    type: paymentMethod.type || "card",
    wallet: paymentMethod.card?.wallet?.type || "",
  };
}

function mapInvoice(invoice) {
  return {
    amount: invoice.amount_paid || invoice.amount_due || 0,
    created: invoice.created,
    currency: invoice.currency,
    hostedInvoiceUrl: invoice.hosted_invoice_url || "",
    id: invoice.id,
    invoicePdf: invoice.invoice_pdf || "",
    number: invoice.number || "",
    status: invoice.status,
  };
}

async function loadBillingDetails(stripeSecret, customerId) {
  const subscriptionParameters = new URLSearchParams({
    customer: customerId,
    limit: "20",
    status: "all",
  });
  subscriptionParameters.set("expand[0]", "data.items.data.price.product");
  const cardParameters = new URLSearchParams({
    customer: customerId,
    limit: "20",
    type: "card",
  });
  const paypalParameters = new URLSearchParams({
    customer: customerId,
    limit: "20",
    type: "paypal",
  });
  const invoiceParameters = new URLSearchParams({
    customer: customerId,
    limit: "20",
  });
  const results = await Promise.allSettled([
    stripeRequest(
      stripeSecret,
      `/subscriptions?${subscriptionParameters.toString()}`,
    ),
    stripeRequest(
      stripeSecret,
      `/payment_methods?${cardParameters.toString()}`,
    ),
    stripeRequest(
      stripeSecret,
      `/payment_methods?${paypalParameters.toString()}`,
    ),
    stripeRequest(stripeSecret, `/invoices?${invoiceParameters.toString()}`),
  ]);
  const valueOrEmpty = (result) =>
    result.status === "fulfilled" ? result.value : { data: [] };
  const subscriptions = valueOrEmpty(results[0]);
  const cards = valueOrEmpty(results[1]);
  const paypalMethods = valueOrEmpty(results[2]);
  const invoices = valueOrEmpty(results[3]);
  return {
    invoices: (invoices.data || []).map(mapInvoice),
    paymentMethods: [...(cards.data || []), ...(paypalMethods.data || [])].map(
      mapPaymentMethod,
    ),
    subscriptions: (subscriptions.data || []).map(mapSubscription),
  };
}

function getReturnOrigin(request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  return forwardedHost && forwardedProtocol
    ? `${forwardedProtocol}://${forwardedHost}`
    : requestUrl.origin;
}

async function ensurePortalConfiguration(stripeSecret, origin) {
  const configuredId = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;
  if (/^bpc_[A-Za-z0-9]{8,200}$/.test(configuredId || "")) {
    return configuredId;
  }

  const configurations = await stripeRequest(
    stripeSecret,
    "/billing_portal/configurations?active=true&limit=100",
  );
  const existingConfiguration = configurations.data?.find(
    (configuration) =>
      configuration.active && configuration.metadata?.munetios === "true",
  );
  if (existingConfiguration?.id) return existingConfiguration.id;

  const configurationPayload = new URLSearchParams({
    "business_profile[headline]": "Manage your Munetios billing",
    "business_profile[privacy_policy_url]": `${origin}/privacy`,
    "business_profile[terms_of_service_url]": `${origin}/terms`,
    default_return_url: `${origin}/account/settings/billing`,
    "features[customer_update][allowed_updates][0]": "email",
    "features[customer_update][allowed_updates][1]": "address",
    "features[customer_update][allowed_updates][2]": "phone",
    "features[customer_update][allowed_updates][3]": "tax_id",
    "features[customer_update][enabled]": "true",
    "features[invoice_history][enabled]": "true",
    "features[payment_method_update][enabled]": "true",
    "features[subscription_cancel][cancellation_reason][enabled]": "true",
    "features[subscription_cancel][cancellation_reason][options][0]":
      "too_expensive",
    "features[subscription_cancel][cancellation_reason][options][1]":
      "missing_features",
    "features[subscription_cancel][cancellation_reason][options][2]": "unused",
    "features[subscription_cancel][cancellation_reason][options][3]": "other",
    "features[subscription_cancel][enabled]": "true",
    "features[subscription_cancel][mode]": "at_period_end",
    "features[subscription_cancel][proration_behavior]": "none",
    "metadata[munetios]": "true",
  });
  const configuration = await stripeRequest(
    stripeSecret,
    "/billing_portal/configurations",
    {
      body: configurationPayload,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    },
  );
  return configuration.id;
}

async function createPortalSession({
  action,
  customerId,
  origin,
  stripeSecret,
}) {
  const returnUrl = `${origin}/account/settings/billing`;
  const stripePayload = new URLSearchParams({
    customer: customerId,
    return_url: returnUrl,
  });
  const configurationId = await ensurePortalConfiguration(stripeSecret, origin);
  stripePayload.set("configuration", configurationId);
  if (action === "payment_method_update") {
    stripePayload.set("flow_data[type]", "payment_method_update");
    stripePayload.set("flow_data[after_completion][type]", "redirect");
    stripePayload.set(
      "flow_data[after_completion][redirect][return_url]",
      returnUrl,
    );
  }
  return stripeRequest(stripeSecret, "/billing_portal/sessions", {
    body: stripePayload,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return response({ error: "stripe_unavailable" }, { status: 503 });
  }

  try {
    const customerId = await findStripeCustomer(stripeSecret, session);
    if (!customerId) {
      return response({
        invoices: [],
        paymentMethods: [],
        plan: session.user.plan || "Free",
        portalAvailable: false,
        subscriptions: [],
      });
    }
    const details = await loadBillingDetails(stripeSecret, customerId);
    return response({
      ...details,
      plan: session.user.plan || "Free",
      portalAvailable: true,
    });
  } catch {
    return response({ error: "billing_load_failed" }, { status: 502 });
  }
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
    return response({ error: "signin_required" }, { status: 401 });
  }
  const rateLimit = consumeRateLimit({
    key: `billing:${session.user.id}:${getRequestFingerprint(request)}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return response(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      { headers: { "Retry-After": String(rateLimit.retryAfter) }, status: 429 },
    );
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return response({ error: "stripe_unavailable" }, { status: 503 });
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {}
  const action = [
    "portal",
    "payment_method_update",
    "setup_payment_method",
    "detach_payment_method",
    "cancel_subscription",
    "resume_subscription",
  ].includes(payload.action)
    ? payload.action
    : "portal";

  try {
    const customerId = await findStripeCustomer(stripeSecret, session, {
      createIfMissing: true,
    });
    if (!customerId) {
      return response(
        { error: "billing_customer_create_failed" },
        { status: 502 },
      );
    }

    if (action === "setup_payment_method") {
      const stripePublishableKey =
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
        process.env.STRIPE_PUBLISHABLE_KEY;
      if (!stripePublishableKey?.startsWith("pk_")) {
        return response({ error: "stripe_unavailable" }, { status: 503 });
      }
      const setupPayload = new URLSearchParams({
        "automatic_payment_methods[enabled]": "true",
        customer: customerId,
        usage: "off_session",
      });
      const setupIntent = await stripeRequest(stripeSecret, "/setup_intents", {
        body: setupPayload,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      });
      if (!setupIntent.client_secret) {
        throw new Error("setup_intent_failed");
      }
      return response({
        clientSecret: setupIntent.client_secret,
        publishableKey: stripePublishableKey,
      });
    }

    if (action === "detach_payment_method") {
      const paymentMethodId = String(payload.paymentMethodId || "");
      if (!stripePaymentMethodPattern.test(paymentMethodId)) {
        return response({ error: "invalid_payment_method" }, { status: 400 });
      }
      const paymentMethod = await stripeRequest(
        stripeSecret,
        `/payment_methods/${encodeURIComponent(paymentMethodId)}`,
      );
      if (paymentMethod.customer !== customerId) {
        return response({ error: "payment_method_forbidden" }, { status: 403 });
      }
      await stripeRequest(
        stripeSecret,
        `/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`,
        { method: "POST" },
      );
      return response({ removed: true });
    }

    if (action === "cancel_subscription" || action === "resume_subscription") {
      const subscriptionId = String(payload.subscriptionId || "");
      if (!stripeSubscriptionPattern.test(subscriptionId)) {
        return response({ error: "invalid_subscription" }, { status: 400 });
      }
      const subscription = await stripeRequest(
        stripeSecret,
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      );
      if (subscription.customer !== customerId) {
        return response({ error: "subscription_forbidden" }, { status: 403 });
      }
      if (!["active", "trialing", "past_due"].includes(subscription.status)) {
        return response(
          { error: "subscription_not_manageable" },
          { status: 409 },
        );
      }
      const updatePayload = new URLSearchParams({
        cancel_at_period_end:
          action === "cancel_subscription" ? "true" : "false",
      });
      const updatedSubscription = await stripeRequest(
        stripeSecret,
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
        {
          body: updatePayload,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        },
      );
      return response({
        subscription: mapSubscription(updatedSubscription),
        updated: true,
      });
    }

    const portalSession = await createPortalSession({
      action,
      customerId,
      origin: getReturnOrigin(request),
      stripeSecret,
    });
    if (!portalSession.url) throw new Error("billing_portal_failed");
    return response({ url: portalSession.url });
  } catch (error) {
    return response(
      { error: "billing_portal_failed" },
      { status: error.status === 429 ? 429 : 502 },
    );
  }
}
