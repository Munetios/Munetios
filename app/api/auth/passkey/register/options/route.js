import { generateRegistrationOptions } from "@simplewebauthn/server";
import { auth } from "../../../../../../auth.js";
import {
  assertSameOrigin,
  createPasskeyChallenge,
  listAccountPasskeys,
} from "../../../../../lib/authSecurity.js";
import { enforceStudentRestriction } from "../../../../../lib/education.js";
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
  const educationResponse = enforceStudentRestriction(session, "passkeys");
  if (educationResponse) return educationResponse;
  const { rpID } = getPasskeyRequestContext(request);
  const passkeys = listAccountPasskeys(session.user.id);
  const options = await generateRegistrationOptions({
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports,
    })),
    rpID,
    rpName: "Munetios",
    timeout: 60_000,
    userDisplayName: session.user.name,
    userID: new TextEncoder().encode(session.user.id),
    userName: session.user.email,
  });
  const challengeId = createPasskeyChallenge({
    accountId: session.user.id,
    challenge: options.challenge,
    purpose: "register",
  });
  return Response.json(
    { challengeId, options },
    { headers: { "Cache-Control": "no-store" } },
  );
}
