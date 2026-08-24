import { redeemAiReferralToken } from "../../../lib/aiReferral.js";
import {
  accountCollectionCookieName,
  assertSameOrigin,
  consumeRateLimit,
  createAccount,
  createAccountSession,
  createAvailableUsername,
  getAccountCollectionCookie,
  getAge,
  getRequestCookie,
  getRequestFingerprint,
  getSessionCookie,
  getSessionMetadata,
  isContactUsed,
  isStrongPassword,
  isUsernameUsed,
  normalizeEmail,
  normalizePhone,
  normalizeUsername,
  verifyCaptcha,
  verifyContact,
} from "../../../lib/authSecurity.js";
import {
  durableAuthRequired,
  durableIdentifierUsed,
  hasDurableAuthStore,
  saveDurableAccount,
  saveDurableSession,
} from "../../../lib/durableAuthStore.js";
import { getSignedInCookie } from "../../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, {
    ...init,
    headers,
  });
}

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return response({ error: "invalid_origin" }, { status: 403 });
  }

  if (durableAuthRequired() && !hasDurableAuthStore()) {
    return response({ error: "account_storage_unavailable" }, { status: 503 });
  }

  const fingerprint = getRequestFingerprint(request);
  const rateLimit = consumeRateLimit({
    key: `signup:${fingerprint}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return response(
      { error: "rate_limited", retryAfter: rateLimit.retryAfter },
      { status: 429 },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, { status: 400 });
  }

  const requestedContactType =
    payload?.contactType === "phone" ? "phone" : "email";
  if (requestedContactType === "phone") {
    return response(
      { error: "phone_verification_coming_soon" },
      { status: 503 },
    );
  }

  if (
    !verifyCaptcha({
      answer: payload?.captchaAnswer,
      challengeId: payload?.captchaChallengeId,
      fingerprint,
    })
  ) {
    return response({ error: "invalid_captcha" }, { status: 400 });
  }

  const age = getAge(payload?.birthDate);
  if (age === null) {
    return response({ error: "invalid_birth_date" }, { status: 400 });
  }
  if (age < 13) {
    return response({ error: "parent_required" }, { status: 403 });
  }

  let username = normalizeUsername(payload?.username);
  const contactType = requestedContactType;
  const contact =
    contactType === "phone"
      ? normalizePhone(payload?.contact)
      : normalizeEmail(payload?.contact);
  const firstName = String(payload?.firstName || "").trim();
  const lastName = String(payload?.lastName || "").trim();
  const usesExistingEmail =
    contactType === "email" &&
    Boolean(contact) &&
    !contact.endsWith("@munetios.com");
  if (usesExistingEmail) {
    username = createAvailableUsername(
      username || String(contact).split("@")[0],
    );
  }
  if (
    !username ||
    !contact ||
    !firstName ||
    firstName.length > 60 ||
    lastName.length > 60 ||
    !isStrongPassword(payload?.password)
  ) {
    return response({ error: "invalid_account_details" }, { status: 400 });
  }
  if (
    contactType === "email" &&
    contact.endsWith("@munetios.com") &&
    contact !== `${username}@munetios.com`
  ) {
    return response({ error: "invalid_account_details" }, { status: 400 });
  }
  if (isContactUsed(contact) || (await durableIdentifierUsed(contact))) {
    return response(
      { error: contactType === "phone" ? "phone_taken" : "email_taken" },
      { status: 409 },
    );
  }
  if (
    !usesExistingEmail &&
    (isUsernameUsed(username) || (await durableIdentifierUsed(username)))
  ) {
    return response({ error: "email_taken" }, { status: 409 });
  }

  const usesExternalContact =
    contactType === "phone" || !contact.endsWith("@munetios.com");
  if (
    usesExternalContact &&
    !verifyContact({
      code: payload?.verificationCode,
      fingerprint,
      identifier: contact,
      verificationId: payload?.verificationId,
    })
  ) {
    return response({ error: "verification_required" }, { status: 400 });
  }

  const account = await createAccount({
    birthDate: payload.birthDate,
    contact,
    contactType,
    email: usesExistingEmail ? contact : null,
    firstName,
    gender: payload?.gender,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    password: payload.password,
    username,
  });
  if (!account) {
    return response(
      { error: contactType === "phone" ? "phone_taken" : "email_taken" },
      { status: 409 },
    );
  }

  try {
    redeemAiReferralToken(payload?.referralToken, account.id);
  } catch {
    // A stale referral must never prevent a valid account from being created.
  }

  await saveDurableAccount(account);
  const metadata = getSessionMetadata(request);
  const session = createAccountSession(
    account,
    getRequestCookie(request, accountCollectionCookieName),
    metadata,
  );
  await saveDurableSession({ account, metadata, session });
  const headers = new Headers();
  headers.append("Set-Cookie", getSessionCookie(request, session.token));
  headers.append("Set-Cookie", getSignedInCookie(request));
  headers.append(
    "Set-Cookie",
    getAccountCollectionCookie(request, session.accountCollectionToken),
  );
  return response(
    {
      authenticated: true,
      user: { email: account.email, id: account.id, name: account.name },
    },
    { headers, status: 201 },
  );
}
