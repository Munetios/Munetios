import {
  assertSameOrigin,
  consumeRateLimit,
  getRequestFingerprint,
  isStrongPassword,
  updateAccountPassword,
  verifyRecoveryChallenge,
} from "../../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  const fingerprint = getRequestFingerprint(request);
  const rateLimit = consumeRateLimit({
    key: `recovery-verify:${fingerprint}`,
    limit: 10,
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

  const type = payload?.type === "email" ? "email" : "password";
  if (type === "password" && !isStrongPassword(payload?.newPassword)) {
    return Response.json({ error: "weak_password" }, { status: 400 });
  }

  const account = verifyRecoveryChallenge({
    code: payload?.code,
    fingerprint,
    recoveryId: payload?.recoveryId,
    type,
  });
  if (!account) {
    return Response.json({ error: "invalid_or_expired_code" }, { status: 400 });
  }

  if (type === "password") {
    const updated = await updateAccountPassword(
      account.id,
      payload.newPassword,
    );
    if (!updated) {
      return Response.json(
        { error: "password_update_failed" },
        { status: 500 },
      );
    }
    return Response.json(
      { passwordUpdated: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { email: account.email, recovered: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
