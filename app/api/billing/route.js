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
} from "../../lib/authSecurity.js";
import { syncStripeSubscriptionForAccount } from "../../lib/stripeSubscriptionSync.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stripeApiUrl = "https://api.stripe.com/v1";
const stripeCustomerPattern = /^cus_[A-Za-z0-9]{8,200}$/;
const stripePaymentMethodPattern = /^pm_[A-Za-z0-9]{8,200}$/;
const stripeSubscriptionPattern = /^sub_[A-Za-z0-9]{8,200}$/;
const changeablePlanIds = new Set(["pro", "pro-lite"]);

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
    amountDue: invoice.amount_due || 0,
    amountPaid: invoice.amount_paid || 0,
    created: invoice.created,
    currency: invoice.currency,
    customerAddress: invoice.customer_address || null,
    customerEmail: invoice.customer_email || "",
    customerName: invoice.customer_name || "",
    description: invoice.description || "",
    dueDate: invoice.due_date || null,
    id: invoice.id,
    lines: (invoice.lines?.data || []).map((line) => ({
      amount: line.amount || 0,
      currency: line.currency || invoice.currency,
      description: line.description || "Munetios subscription",
      id: line.id,
      periodEnd: line.period?.end || null,
      periodStart: line.period?.start || null,
      quantity: line.quantity || 1,
    })),
    number: invoice.number || "",
    status: invoice.status,
    subtotal: invoice.subtotal || 0,
    tax: invoice.tax || 0,
    total: invoice.total || 0,
  };
}

async function getOrCreatePlanPrice(stripeSecret, planId, currency) {
  const normalizedCurrency = normalizeCurrency(currency).toLowerCase();
  const configuredPriceId = getConfiguredPriceId(planId, normalizedCurrency);
  if (configuredPriceId) return configuredPriceId;

  const lookupKey = `munetios-ai-${planId}-${normalizedCurrency}-monthly`;
  const query = new URLSearchParams({ active: "true", limit: "1" });
  query.append("lookup_keys[]", lookupKey);
  const existing = await stripeRequest(
    stripeSecret,
    `/prices?${query.toString()}`,
  );
  if (existing.data?.[0]?.id) return existing.data[0].id;

  const plan = getPlan(planId);
  const productPayload = new URLSearchParams({
    name: `Munetios AI ${planId === "pro" ? "Pro" : "Pro Lite"}`,
    "metadata[munetios_plan_id]": planId,
  });
  const product = await stripeRequest(stripeSecret, "/products", {
    body: productPayload,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `munetios-product-${planId}`,
    },
    method: "POST",
  });
  const pricePayload = new URLSearchParams({
    currency: normalizedCurrency,
    lookup_key: lookupKey,
    product: product.id,
    "recurring[interval]": "month",
    unit_amount: String(
      Math.round(getPlanPrice(plan, normalizedCurrency) * 100),
    ),
  });
  const price = await stripeRequest(stripeSecret, "/prices", {
    body: pricePayload,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": lookupKey,
    },
    method: "POST",
  });
  return price.id;
}

async function loadBillingDetails(stripeSecret, customerId) {
  const subscriptionParameters = new URLSearchParams({
    customer: customerId,
    limit: "20",
    status: "all",
  });
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
  const productIds = new Set();
  for (const subscription of subscriptions.data || []) {
    for (const item of subscription.items?.data || []) {
      if (typeof item.price?.product === "string") {
        productIds.add(item.price.product);
      }
    }
  }
  const productResults = await Promise.allSettled(
    [...productIds].map(async (productId) => [
      productId,
      await stripeRequest(
        stripeSecret,
        `/products/${encodeURIComponent(productId)}`,
      ),
    ]),
  );
  const products = new Map(
    productResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value),
  );
  const hydratedSubscriptions = (subscriptions.data || []).map(
    (subscription) => ({
      ...subscription,
      items: {
        ...subscription.items,
        data: (subscription.items?.data || []).map((item) => ({
          ...item,
          price: {
            ...item.price,
            product:
              typeof item.price?.product === "string"
                ? products.get(item.price.product) || item.price.product
                : item.price?.product,
          },
        })),
      },
    }),
  );
  const cards = valueOrEmpty(results[1]);
  const paypalMethods = valueOrEmpty(results[2]);
  const invoices = valueOrEmpty(results[3]);
  return {
    invoices: (invoices.data || []).map(mapInvoice),
    paymentMethods: [...(cards.data || []), ...(paypalMethods.data || [])].map(
      mapPaymentMethod,
    ),
    subscriptions: hydratedSubscriptions.map(mapSubscription),
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
  if (existingConfiguration?.id) {
    if (existingConfiguration.features?.invoice_history?.enabled) {
      const updatePayload = new URLSearchParams({
        "features[invoice_history][enabled]": "false",
      });
      await stripeRequest(
        stripeSecret,
        `/billing_portal/configurations/${encodeURIComponent(existingConfiguration.id)}`,
        {
          body: updatePayload,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        },
      );
    }
    return existingConfiguration.id;
  }

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
    "features[invoice_history][enabled]": "false",
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
    const subscriptionSync = await syncStripeSubscriptionForAccount(
      session.user,
      { customerId, force: true },
    );
    const details = await loadBillingDetails(stripeSecret, customerId);
    return response({
      ...details,
      plan: subscriptionSync.plan || session.user.plan || "Free",
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
    "change_subscription",
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

    if (action === "change_subscription") {
      const subscriptionId = String(payload.subscriptionId || "");
      const planId = String(payload.planId || "");
      if (
        !stripeSubscriptionPattern.test(subscriptionId) ||
        !changeablePlanIds.has(planId)
      ) {
        return response({ error: "invalid_subscription_change" }, { status: 400 });
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
      const item = subscription.items?.data?.[0];
      if (!item?.id) {
        return response({ error: "subscription_item_missing" }, { status: 409 });
      }
      const currency =
        item.price?.currency || subscription.currency || "usd";
      const priceId = await getOrCreatePlanPrice(
        stripeSecret,
        planId,
        currency,
      );
      const updatePayload = new URLSearchParams({
        "items[0][id]": item.id,
        "items[0][price]": priceId,
        "metadata[munetios_account_id]": session.user.id,
        "metadata[munetios_plan_id]": planId,
        payment_behavior: "pending_if_incomplete",
        proration_behavior: "create_prorations",
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
      updateAccountPlan(session.user.id, planId);
      await syncStripeSubscriptionForAccount(session.user, {
        customerId,
        force: true,
      });
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
