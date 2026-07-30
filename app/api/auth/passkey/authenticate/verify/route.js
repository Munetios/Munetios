import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import {
  accountCollectionCookieName,
  assertSameOrigin,
  consumePasskeyChallenge,
  createAccountSession,
  getAccountById,
  getAccountCollectionCookie,
  getPasskey,
  getRequestCookie,
  getSessionCookie,
  getSessionMetadata,
  updatePasskeyCounter,
} from "../../../../../lib/authSecurity.js";
import { getPasskeyRequestContext } from "../../../../../lib/passkeys.js";
import { getSignedInCookie } from "../../../../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const challenge = consumePasskeyChallenge(
    payload.challengeId,
    "authenticate",
  );
  const passkey = getPasskey(payload.credential?.id);
  if (!challenge || !passkey) {
    return Response.json({ error: "passkey_signin_failed" }, { status: 400 });
  }
  const { origin, rpID } = getPasskeyRequestContext(request);
  try {
    const verification = await verifyAuthenticationResponse({
      credential: {
        backedUp: passkey.backedUp,
        counter: passkey.counter,
        deviceType: passkey.deviceType,
        id: passkey.credentialId,
        publicKey: passkey.publicKey,
        transports: passkey.transports,
      },
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      response: payload.credential,
    });
    if (!verification.verified) throw new Error("passkey_not_verified");
    updatePasskeyCounter(
      passkey.credentialId,
      verification.authenticationInfo.newCounter,
    );
    const account = getAccountById(passkey.accountId);
    if (!account) throw new Error("account_not_found");
    const session = createAccountSession(
      account,
      getRequestCookie(request, accountCollectionCookieName),
      getSessionMetadata(request),
    );
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", getSessionCookie(request, session.token));
    headers.append("Set-Cookie", getSignedInCookie(request));
    headers.append(
      "Set-Cookie",
      getAccountCollectionCookie(request, session.accountCollectionToken),
    );
    return Response.json({ authenticated: true }, { headers });
  } catch {
    return Response.json({ error: "passkey_signin_failed" }, { status: 400 });
  }
}
