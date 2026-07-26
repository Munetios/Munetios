import { generateAuthenticationOptions } from "@simplewebauthn/server";
import {
  consumeRateLimit,
  createPasskeyChallenge,
  getRequestFingerprint,
} from "../../../../../lib/authSecurity.js";
import { getPasskeyRequestContext } from "../../../../../lib/passkeys.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const rateLimit = consumeRateLimit({
    key: `passkey-authentication:${getRequestFingerprint(request)}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      { headers: { "Retry-After": String(rateLimit.retryAfter) }, status: 429 },
    );
  }
  const { rpID } = getPasskeyRequestContext(request);
  const options = await generateAuthenticationOptions({
    allowCredentials: [],
    rpID,
    timeout: 60_000,
    userVerification: "required",
  });
  const challengeId = createPasskeyChallenge({
    challenge: options.challenge,
    purpose: "authenticate",
  });
  return Response.json(
    { challengeId, options },
    { headers: { "Cache-Control": "no-store" } },
  );
}
