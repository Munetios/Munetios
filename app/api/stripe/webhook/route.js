import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getAccountData,
  setAccountData,
  updateAccountPlan,
} from "../../../lib/authSecurity.js";
import { normalizeBusinessAccount } from "../../../lib/businessAccounts.js";
import { syncStripeSubscriptionForCustomer } from "../../../lib/stripeSubscriptionSync.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const signatureToleranceSeconds = 300;

function verifyStripeSignature(body, signatureHeader, secret) {
  const entries = String(signatureHeader || "").split(",");
  const timestamp = entries.find((entry) => entry.startsWith("t="))?.slice(2);
  const signatures = entries
    .filter((entry) => entry.startsWith("v1="))
    .map((entry) => entry.slice(3));
  const timestampNumber = Number(timestamp);
  if (
    !Number.isInteger(timestampNumber) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) >
      signatureToleranceSeconds ||
    signatures.length === 0
  ) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest();
  return signatures.some((signature) => {
    if (!/^[a-f\d]{64}$/i.test(signature)) return false;
    const received = Buffer.from(signature, "hex");
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  });
}

export async function POST(request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json({ error: "webhook_unavailable" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (
    !verifyStripeSignature(
      rawBody,
      request.headers.get("stripe-signature"),
      webhookSecret,
    )
  ) {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const object = event?.data?.object;
  const accountId = object?.metadata?.munetios_account_id;
  const planId = object?.metadata?.munetios_plan_id;
  const updateBusinessState = (status) => {
    if (!accountId || !planId?.startsWith("business-")) return;
    const business = normalizeBusinessAccount(
      getAccountData(accountId, "business", null),
      accountId,
    );
    if (!business?.verified) return;
    setAccountData(accountId, "business", {
      ...business,
      plan: status === "active" ? planId : "business-free",
      status,
      updatedAt: new Date().toISOString(),
    });
  };
  if (event?.type === "checkout.session.completed") {
    if (
      planId?.startsWith("business-") &&
      !normalizeBusinessAccount(
        getAccountData(accountId, "business", null),
        accountId,
      )?.verified
    ) {
      return Response.json(
        {
          ignored: true,
          reason: "business_verification_required",
          received: true,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    updateAccountPlan(accountId, planId);
    if (accountId && object?.customer) {
      const billing = getAccountData(accountId, "billing", {});
      setAccountData(accountId, "billing", {
        ...billing,
        stripeCustomerId: object.customer,
        updatedAt: new Date().toISOString(),
      });
    }
    updateBusinessState("active");
  } else if (
    new Set([
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed",
      "customer.subscription.updated",
    ]).has(event?.type)
  ) {
    try {
      const customerId =
        typeof object?.customer === "object"
          ? object.customer?.id
          : object?.customer;
      await syncStripeSubscriptionForCustomer(String(customerId || ""));
    } catch {
      return Response.json(
        { error: "subscription_sync_failed" },
        { status: 503 },
      );
    }
  }

  return Response.json(
    { received: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
