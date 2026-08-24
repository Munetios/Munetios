import {
  assertSameOrigin,
  consumeRateLimit,
  createRecoveryChallenge,
  getAccountByIdentifier,
  getRequestFingerprint,
} from "../../../lib/authSecurity.js";
import { sendResendRecoveryEmail } from "../../../lib/resendEmail.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  const fingerprint = getRequestFingerprint(request);
  const rateLimit = consumeRateLimit({
    key: `recovery:${fingerprint}`,
    limit: 5,
    windowMs: 30 * 60 * 1000,
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

  const account = getAccountByIdentifier(payload?.identifier);
  const recovery = createRecoveryChallenge({
    account,
    fingerprint,
    type: payload?.type,
  });
  const recoveryRecipient = account?.email || account?.contact;
  if (recoveryRecipient?.includes("@")) {
    await sendResendRecoveryEmail(recoveryRecipient, {
      ...recovery,
      type: payload?.type === "email" ? "email" : "password",
    }).catch(() => undefined);
  }
  const deliveryEndpoint = process.env.MUNETIOS_VERIFICATION_DELIVERY_URL;
  const deliveryToken = process.env.MUNETIOS_VERIFICATION_DELIVERY_TOKEN;
  if (account && deliveryEndpoint && deliveryToken) {
    await fetch(deliveryEndpoint, {
      body: JSON.stringify({
        code: recovery.code,
        identifier: account.contact,
        recoveryId: recovery.recoveryId,
        recoveryType: payload?.type === "email" ? "email" : "password",
      }),
      headers: {
        Authorization: `Bearer ${deliveryToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    }).catch(() => undefined);
  }

  return Response.json(
    {
      accepted: true,
      developmentCode:
        process.env.NODE_ENV !== "production" && account
          ? recovery.code
          : undefined,
      expiresAt: new Date(recovery.expiresAt).toISOString(),
      recoveryId: recovery.recoveryId,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
