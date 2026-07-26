import {
  consumeRateLimit,
  createCaptcha,
  getRequestFingerprint,
} from "../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const fingerprint = getRequestFingerprint(request);
  const rateLimit = consumeRateLimit({
    key: `captcha:${fingerprint}`,
    limit: 20,
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

  const challenge = createCaptcha(fingerprint);
  return Response.json(
    {
      challengeId: challenge.challengeId,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      imageUrl: `/api/auth/captcha/${encodeURIComponent(challenge.challengeId)}?access=${encodeURIComponent(challenge.accessToken)}`,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
