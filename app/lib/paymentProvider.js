import { auth } from "../../auth.js";
import {
  assertSameOrigin,
  consumeRateLimit,
  getRequestFingerprint,
} from "./authSecurity.js";

export async function createProviderPayment(request, provider) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  const session = await auth(request);
  if (!session || session.demo) {
    return Response.json({ error: "signin_required" }, { status: 401 });
  }

  const fingerprint = getRequestFingerprint(request);
  const rateLimit = consumeRateLimit({
    key: `${provider}-payment:${session.user.id}:${fingerprint}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const providerKey = provider === "paypal" ? "PAYPAL" : "CASHAPP";
  const endpoint = process.env[`MUNETIOS_${providerKey}_API_URL`];
  const token = process.env[`MUNETIOS_${providerKey}_API_TOKEN`];
  if (!endpoint || !token) {
    return Response.json({ error: "provider_unavailable" }, { status: 503 });
  }

  const providerResponse = await fetch(endpoint, {
    body: JSON.stringify({
      accountId: session.user.id,
      currency: payload?.currency,
      email: session.user.email,
      planId: payload?.planId,
      provider,
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const providerPayload = await providerResponse.json().catch(() => ({}));
  if (!providerResponse.ok) {
    return Response.json({ error: "provider_failed" }, { status: 502 });
  }

  return Response.json(
    {
      checkoutUrl:
        providerPayload.checkoutUrl ||
        providerPayload.url ||
        providerPayload.approvalUrl ||
        "",
      connected: Boolean(providerPayload.connected),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
