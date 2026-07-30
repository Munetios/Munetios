import {
  getAccountById,
  getAccountByIdentifier,
  getAccountData,
  setAccountData,
  updateAccountPlan,
} from "./authSecurity.js";

const stripeApiUrl = "https://api.stripe.com/v1";
const activeSubscriptionStatuses = new Set(["active", "trialing"]);
const stripeCustomerPattern = /^cus_[A-Za-z0-9]{8,200}$/;
const syncIntervalMs = 60 * 1000;

const planLabels = {
  "business-free": "Business Free",
  "business-pro": "Business Pro",
  free: "Free",
  pro: "Pro",
  "pro-lite": "Pro Lite",
};

const planPriority = {
  "business-pro": 3,
  pro: 2,
  "pro-lite": 1,
};

function normalizePlanId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/\s+/g, "-");
  if (
    normalized === "business-pro" ||
    normalized.includes("munetios-business-pro")
  ) {
    return "business-pro";
  }
  if (
    normalized === "pro-lite" ||
    normalized === "prolite" ||
    normalized === "plus" ||
    normalized === "munetios-ai-plus" ||
    normalized.includes("munetios-ai-plus") ||
    normalized.includes("munetios-ai-pro-lite")
  ) {
    return "pro-lite";
  }
  if (normalized === "pro" || normalized.includes("munetios-ai-pro")) {
    return "pro";
  }
  return "";
}

function configuredPricePlan(priceId) {
  if (!priceId) return "";
  for (const [planId, environmentPrefix] of [
    ["business-pro", "STRIPE_PRICE_BUSINESS_PRO"],
    ["pro-lite", "STRIPE_PRICE_PRO_LITE"],
    ["pro", "STRIPE_PRICE_PRO"],
  ]) {
    for (const [key, value] of Object.entries(process.env)) {
      if (
        (key === environmentPrefix || key.startsWith(`${environmentPrefix}_`)) &&
        value === priceId
      ) {
        return planId;
      }
    }
  }
  return "";
}

function getSubscriptionPlan(subscription) {
  const candidates = [
    subscription?.metadata?.munetios_plan_id,
    subscription?.description,
  ];
  for (const item of subscription?.items?.data || []) {
    const price = item.price || {};
    const product =
      typeof price.product === "object" && price.product
        ? price.product
        : {};
    const configuredPlan = configuredPricePlan(price.id);
    if (configuredPlan) return configuredPlan;
    candidates.push(
      price.metadata?.munetios_plan_id,
      product.metadata?.munetios_plan_id,
      price.lookup_key,
      price.nickname,
      product.name,
    );
  }
  for (const candidate of candidates) {
    const planId = normalizePlanId(candidate);
    if (planId) return planId;
  }
  return "";
}

async function stripeRequest(stripeSecret, path) {
  const response = await fetch(`${stripeApiUrl}${path}`, {
    headers: { Authorization: `Bearer ${stripeSecret}` },
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "stripe_request_failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function findCustomer(stripeSecret, account, preferredCustomerId = "") {
  const storedBilling = getAccountData(account.id, "billing", {});
  const customerId = stripeCustomerPattern.test(preferredCustomerId)
    ? preferredCustomerId
    : stripeCustomerPattern.test(storedBilling.stripeCustomerId || "")
      ? storedBilling.stripeCustomerId
      : "";
  if (customerId) {
    try {
      const customer = await stripeRequest(
        stripeSecret,
        `/customers/${encodeURIComponent(customerId)}`,
      );
      if (!customer.deleted) return customer;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }

  const parameters = new URLSearchParams({
    email: account.email,
    limit: "100",
  });
  const customers = await stripeRequest(
    stripeSecret,
    `/customers?${parameters.toString()}`,
  );
  return (
    customers.data?.find(
      (customer) =>
        !customer.deleted &&
        customer.email?.toLowerCase() === account.email.toLowerCase(),
    ) || null
  );
}

async function listSubscriptions(stripeSecret, customerId) {
  const parameters = new URLSearchParams({
    customer: customerId,
    limit: "100",
    status: "all",
  });
  const payload = await stripeRequest(
    stripeSecret,
    `/subscriptions?${parameters.toString()}`,
  );
  const subscriptions = payload.data || [];
  const productIds = new Set();
  for (const subscription of subscriptions) {
    for (const item of subscription.items?.data || []) {
      if (typeof item.price?.product === "string") {
        productIds.add(item.price.product);
      }
    }
  }
  const products = new Map(
    await Promise.all(
      [...productIds].map(async (productId) => [
        productId,
        await stripeRequest(
          stripeSecret,
          `/products/${encodeURIComponent(productId)}`,
        ),
      ]),
    ),
  );
  return subscriptions.map((subscription) => ({
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
  }));
}

function updateBusinessPlan(accountId, planId, status) {
  const business = getAccountData(accountId, "business", {});
  if (
    planId !== "business-pro" &&
    business.plan !== "business-pro" &&
    business.status !== "active"
  ) {
    return;
  }
  setAccountData(accountId, "business", {
    ...business,
    plan: planId === "business-pro" ? "business-pro" : "business-free",
    status,
    updatedAt: new Date().toISOString(),
  });
}

export function findAccountForStripeCustomer(customer) {
  const metadataAccountId = customer?.metadata?.munetios_account_id;
  if (metadataAccountId) {
    const account = getAccountById(metadataAccountId);
    if (account) return account;
  }
  return customer?.email ? getAccountByIdentifier(customer.email) : null;
}

export async function syncStripeSubscriptionForAccount(
  account,
  { customerId = "", force = false } = {},
) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret || !account?.id || !account?.email) {
    return { plan: account?.plan || "Free", synced: false };
  }

  const storedBilling = getAccountData(account.id, "billing", {});
  const lastSyncedAt = Date.parse(storedBilling.stripeSubscriptionSyncedAt);
  if (
    !force &&
    Number.isFinite(lastSyncedAt) &&
    Date.now() - lastSyncedAt < syncIntervalMs
  ) {
    return {
      plan:
        planLabels[storedBilling.stripePlanId] || account.plan || "Free",
      synced: false,
    };
  }

  const customer = await findCustomer(stripeSecret, account, customerId);
  if (!customer?.id) {
    setAccountData(account.id, "billing", {
      ...storedBilling,
      stripeSubscriptionSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { plan: account.plan || "Free", synced: true };
  }

  const subscriptions = await listSubscriptions(stripeSecret, customer.id);
  const recognizedActiveSubscriptions = subscriptions
    .filter((subscription) =>
      activeSubscriptionStatuses.has(subscription.status),
    )
    .map((subscription) => ({
      id: subscription.id,
      planId: getSubscriptionPlan(subscription),
      status: subscription.status,
    }))
    .filter(({ planId }) => planId)
    .sort(
      (left, right) =>
        (planPriority[right.planId] || 0) - (planPriority[left.planId] || 0),
    );
  const activeSubscription = recognizedActiveSubscriptions[0] || null;
  const previousStripePlanId = normalizePlanId(storedBilling.stripePlanId);
  const nextPlanId =
    activeSubscription?.planId ||
    (previousStripePlanId === "business-pro" ? "business-free" : "free");
  const shouldUpdatePlan = Boolean(
    activeSubscription || previousStripePlanId,
  );

  if (shouldUpdatePlan) {
    updateAccountPlan(account.id, nextPlanId);
    updateBusinessPlan(
      account.id,
      nextPlanId,
      activeSubscription ? "active" : "inactive",
    );
  }
  setAccountData(account.id, "billing", {
    ...storedBilling,
    stripeCustomerId: customer.id,
    stripePlanId: activeSubscription?.planId || "",
    stripeSubscriptionId: activeSubscription?.id || "",
    stripeSubscriptionStatus: activeSubscription?.status || "inactive",
    stripeSubscriptionSyncedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return {
    plan: shouldUpdatePlan
      ? planLabels[nextPlanId] || account.plan || "Free"
      : account.plan || "Free",
    planId: shouldUpdatePlan ? nextPlanId : "",
    subscriptionId: activeSubscription?.id || "",
    synced: true,
  };
}

export async function syncStripeSubscriptionForCustomer(customerId) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret || !stripeCustomerPattern.test(customerId || "")) {
    return { synced: false };
  }
  const customer = await stripeRequest(
    stripeSecret,
    `/customers/${encodeURIComponent(customerId)}`,
  );
  if (customer.deleted) return { synced: false };
  const account = findAccountForStripeCustomer(customer);
  if (!account) return { synced: false };
  return syncStripeSubscriptionForAccount(account, {
    customerId: customer.id,
    force: true,
  });
}
