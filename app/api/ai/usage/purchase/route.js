import { requireAuth } from "../../../../../auth.js";
import {
  assertSameOrigin,
  getAccountData,
  setAccountData,
} from "../../../../lib/authSecurity.js";
import { enforceOrganizationAppAccess } from "../../../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stripeApiUrl = "https://api.stripe.com/v1";

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return authResponse;
  const policyResponse = enforceOrganizationAppAccess(session, "ai", {
    mutating: true,
  });
  if (policyResponse) return policyResponse;
  if (session.demo) {
    return response({ error: "purchase_unavailable" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({}));
  const kind = payload.kind === "extended" ? "extended" : "usage-reset";
  const quantity =
    kind === "extended"
      ? 1
      : Math.min(20, Math.max(1, Math.floor(payload.quantity) || 1));
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return response({ error: "stripe_unavailable" }, { status: 503 });
  }

  const requestUrl = new URL(request.url);
  const stripePayload = new URLSearchParams();
  stripePayload.set("mode", "payment");
  stripePayload.set(
    "success_url",
    `${requestUrl.origin}/apps/ai?usage_purchase={CHECKOUT_SESSION_ID}`,
  );
  stripePayload.set("cancel_url", `${requestUrl.origin}/apps/ai`);
  stripePayload.set("client_reference_id", session.user.id);
  stripePayload.set("customer_email", session.user.email);
  stripePayload.set("line_items[0][price_data][currency]", "usd");
  stripePayload.set(
    "line_items[0][price_data][unit_amount]",
    kind === "extended" ? "399" : "499",
  );
  stripePayload.set(
    "line_items[0][price_data][product_data][name]",
    kind === "extended"
      ? "Munetios AI extended requests"
      : "Munetios AI usage reset",
  );
  stripePayload.set("line_items[0][quantity]", String(quantity));
  stripePayload.set("metadata[munetios_account_id]", session.user.id);
  stripePayload.set("metadata[purchase_kind]", kind);
  stripePayload.set("metadata[usage_reset_quantity]", String(quantity));

  const stripeResponse = await fetch(`${stripeApiUrl}/checkout/sessions`, {
    body: stripePayload,
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  }).catch(() => null);
  const stripeSession = await stripeResponse?.json().catch(() => ({}));
  if (!stripeResponse?.ok || !stripeSession?.url) {
    return response({ error: "checkout_failed" }, { status: 502 });
  }
  return response({ checkoutUrl: stripeSession.url });
}

export async function GET(request) {
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return authResponse;
  const sessionId = new URL(request.url).searchParams.get("sessionId") || "";
  if (!/^cs_[A-Za-z0-9_]{12,200}$/.test(sessionId)) {
    return response({ error: "invalid_session" }, { status: 400 });
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return response({ error: "stripe_unavailable" }, { status: 503 });
  }

  const stripeResponse = await fetch(
    `${stripeApiUrl}/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${stripeSecret}` } },
  ).catch(() => null);
  const checkout = await stripeResponse?.json().catch(() => ({}));
  if (
    !stripeResponse?.ok ||
    checkout.status !== "complete" ||
    checkout.payment_status !== "paid" ||
    checkout.client_reference_id !== session.user.id ||
    checkout.metadata?.munetios_account_id !== session.user.id
  ) {
    return response({ error: "payment_not_complete" }, { status: 409 });
  }

  const processed = getAccountData(session.user.id, "ai-usage-purchases", []);
  if (!processed.includes(sessionId)) {
    const kind =
      checkout.metadata?.purchase_kind === "extended"
        ? "extended"
        : "usage-reset";
    const quantity = Math.min(
      20,
      Math.max(
        1,
        Math.floor(Number(checkout.metadata?.usage_reset_quantity)) || 1,
      ),
    );
    if (kind === "extended") {
      const settings = getAccountData(session.user.id, "ai-settings", {});
      setAccountData(session.user.id, "ai-settings", {
        ...settings,
        extendedRequests: true,
      });
    } else {
      const usage = getAccountData(session.user.id, "ai-usage", {});
      setAccountData(session.user.id, "ai-usage", {
        ...usage,
        usageResets:
          (Number.isFinite(usage.usageResets)
            ? Math.max(0, usage.usageResets)
            : 3) + quantity,
      });
    }
    setAccountData(
      session.user.id,
      "ai-usage-purchases",
      [...processed, sessionId].slice(-100),
    );
  }

  return response({ credited: true });
}
