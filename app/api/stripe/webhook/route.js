import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getAccountData,
  setAccountData,
  updateAccountPlan,
} from "../../../lib/authSecurity.js";

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
    if (!accountId || planId !== "business-pro") return;
    const business = getAccountData(accountId, "business", {});
    setAccountData(accountId, "business", {
      ...business,
      plan: status === "active" ? "business-pro" : "business-free",
      status,
      updatedAt: new Date().toISOString(),
    });
  };
  if (event?.type === "checkout.session.completed") {
    updateAccountPlan(accountId, planId);
    if (accountId && object?.customer) {
      setAccountData(accountId, "billing", {
        stripeCustomerId: object.customer,
        updatedAt: new Date().toISOString(),
      });
    }
    updateBusinessState("active");
  } else if (event?.type === "customer.subscription.deleted") {
    updateAccountPlan(
      accountId,
      planId === "business-pro" ? "business-free" : "free",
    );
    updateBusinessState("canceled");
  } else if (event?.type === "customer.subscription.updated") {
    const active = object?.status === "active" || object?.status === "trialing";
    updateAccountPlan(
      accountId,
      active ? planId : planId === "business-pro" ? "business-free" : "free",
    );
    updateBusinessState(active ? "active" : "inactive");
  }

  return Response.json(
    { received: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
