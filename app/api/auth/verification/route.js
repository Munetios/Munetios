import {
  assertSameOrigin,
  consumeRateLimit,
  createContactVerification,
  deleteContactVerification,
  getRequestFingerprint,
  isContactUsed,
  normalizeEmail,
  normalizePhone,
} from "../../../lib/authSecurity.js";
import {
  isVerificationEmailConfigured,
  sendVerificationEmail,
} from "../../../lib/nodemailerVerificationEmail.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const deliveryTimeoutMs = 12_000;

function isAllowedDeliveryEndpoint(value) {
  try {
    const endpoint = new URL(value);
    const hostname = endpoint.hostname.toLowerCase();
    return (
      (endpoint.protocol === "https:" &&
        (hostname === "munetios.com" || hostname.endsWith(".munetios.com"))) ||
      (endpoint.protocol === "http:" &&
        (hostname === "localhost" || hostname === "127.0.0.1"))
    );
  } catch {
    return false;
  }
}

function getDeliveryEndpoint(channel) {
  if (channel === "sms") {
    return {
      token:
        process.env.MUNETIOS_SMS_DELIVERY_TOKEN ||
        process.env.MUNETIOS_VERIFICATION_DELIVERY_TOKEN,
      url:
        process.env.MUNETIOS_SMS_DELIVERY_URL ||
        process.env.MUNETIOS_VERIFICATION_DELIVERY_URL,
    };
  }
  return {
    token: process.env.MUNETIOS_VERIFICATION_DELIVERY_TOKEN,
    url: process.env.MUNETIOS_VERIFICATION_DELIVERY_URL,
  };
}

function isMunetiosDeliveryEndpointConfigured(channel) {
  const endpoint = getDeliveryEndpoint(channel);
  return Boolean(endpoint.token && isAllowedDeliveryEndpoint(endpoint.url));
}

async function deliverWithMunetiosEndpoint(identifier, verification) {
  const channel = identifier.includes("@") ? "email" : "sms";
  const endpoint = getDeliveryEndpoint(channel);
  if (!isMunetiosDeliveryEndpointConfigured(channel)) {
    return null;
  }

  const response = await fetch(endpoint.url, {
    body: JSON.stringify({
      channel,
      code: verification.code,
      identifier,
      message: `${verification.code} is your Munetios verification code. It expires in 10 minutes.`,
    }),
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": verification.verificationId,
    },
    method: "POST",
    signal: AbortSignal.timeout(deliveryTimeoutMs),
  });
  return response.ok;
}

async function deliverVerification(identifier, verification) {
  if (identifier.includes("@")) {
    const emailResult = await sendVerificationEmail(
      identifier,
      verification.code,
    );
    if (emailResult?.delivered) {
      return emailResult;
    }

    const endpointResult = await deliverWithMunetiosEndpoint(
      identifier,
      verification,
    );
    if (endpointResult !== null) {
      return {
        delivered: endpointResult,
        reason: endpointResult ? null : "delivery_endpoint_failed",
      };
    }
    if (emailResult !== null) {
      return emailResult;
    }
  }

  const endpointResult = await deliverWithMunetiosEndpoint(
    identifier,
    verification,
  );
  return {
    delivered: endpointResult === true,
    reason:
      endpointResult === null
        ? "delivery_not_configured"
        : endpointResult
          ? null
          : "delivery_endpoint_failed",
  };
}

export function GET(request) {
  return Response.redirect(new URL("/signup", request.url), 303);
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const identifier =
    normalizeEmail(payload?.identifier) || normalizePhone(payload?.identifier);
  if (!identifier || identifier.endsWith?.("@munetios.com")) {
    return Response.json({ error: "invalid_or_used_contact" }, { status: 409 });
  }

  const emailDeliveryAvailable =
    identifier.includes("@") && isVerificationEmailConfigured();
  const deliveryChannel = identifier.includes("@") ? "email" : "sms";
  if (
    !emailDeliveryAvailable &&
    !isMunetiosDeliveryEndpointConfigured(deliveryChannel)
  ) {
    return Response.json(
      {
        error: "verification_unavailable",
        reason:
          deliveryChannel === "sms"
            ? "sms_delivery_not_configured"
            : "email_delivery_not_configured",
      },
      {
        headers: { "Cache-Control": "no-store" },
        status: 503,
      },
    );
  }

  const fingerprint = getRequestFingerprint(request);
  const rateLimit = consumeRateLimit({
    key: `verification:v2:${fingerprint}`,
    limit: 6,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      {
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rateLimit.retryAfter),
        },
        status: 429,
      },
    );
  }
  if (isContactUsed(identifier)) {
    return Response.json(
      { error: identifier.includes("@") ? "email_taken" : "phone_taken" },
      { status: 409 },
    );
  }

  const verification = createContactVerification(identifier, fingerprint);
  if (!verification) {
    return Response.json({ error: "invalid_contact" }, { status: 400 });
  }

  let delivery = { delivered: false, reason: "delivery_failed" };
  try {
    delivery = await deliverVerification(identifier, verification);
  } catch {
    delivery = { delivered: false, reason: "delivery_failed" };
  }

  if (!delivery.delivered) {
    deleteContactVerification(verification.verificationId);
    return Response.json(
      {
        error: "verification_unavailable",
        reason: delivery.reason,
      },
      {
        headers: { "Cache-Control": "no-store" },
        status: 503,
      },
    );
  }

  return Response.json(
    {
      expiresAt: new Date(verification.expiresAt).toISOString(),
      verificationId: verification.verificationId,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
