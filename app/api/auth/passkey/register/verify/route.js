import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { auth } from "../../../../../../auth.js";
import {
  assertSameOrigin,
  consumePasskeyChallenge,
  savePasskey,
} from "../../../../../lib/authSecurity.js";
import { getPasskeyRequestContext } from "../../../../../lib/passkeys.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth(request);
  if (!session || session.demo) {
    return Response.json({ error: "signin_required" }, { status: 401 });
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const challenge = consumePasskeyChallenge(payload.challengeId, "register");
  if (!challenge || challenge.account_id !== session.user.id) {
    return Response.json(
      { error: "passkey_challenge_invalid" },
      { status: 400 },
    );
  }
  const { origin, rpID } = getPasskeyRequestContext(request);
  try {
    const verification = await verifyRegistrationResponse({
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      response: payload.credential,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("passkey_not_verified");
    }
    savePasskey(
      session.user.id,
      verification.registrationInfo,
      payload.credential?.response?.transports || [],
    );
    return Response.json(
      { registered: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "passkey_setup_failed" }, { status: 400 });
  }
}
