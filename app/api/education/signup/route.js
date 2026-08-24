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
  normalizeEmail,
  verifyCaptcha,
  verifyContact,
} from "../../../lib/authSecurity.js";
import { isDatabaseStaffEmail } from "../../../lib/databaseStaffAccess.js";
import {
  durableAuthRequired,
  durableIdentifierUsed,
  hasDurableAuthStore,
  saveDurableAccount,
  saveDurableSession,
} from "../../../lib/durableAuthStore.js";
import { setEducationProfile } from "../../../lib/education.js";
import { getSignedInCookie } from "../../../lib/signedInCookie.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  if (!assertSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  if (durableAuthRequired() && !hasDurableAuthStore()) {
    return Response.json(
      { error: "account_storage_unavailable" },
      { status: 503 },
    );
  }
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const fingerprint = getRequestFingerprint(request);
  if (
    !verifyCaptcha({
      answer: payload?.captchaAnswer,
      challengeId: payload?.captchaChallengeId,
      fingerprint,
    })
  ) {
    return Response.json({ error: "invalid_captcha" }, { status: 400 });
  }
  const email = normalizeEmail(payload?.email);
  const firstName = String(payload?.firstName || "").trim();
  const lastName = String(payload?.lastName || "").trim();
  const age = getAge(payload?.birthDate);
  if (isDatabaseStaffEmail(email)) {
    return Response.json({ error: "email_taken" }, { status: 409 });
  }
  if (
    !email ||
    !firstName ||
    firstName.length > 60 ||
    lastName.length > 60 ||
    age === null ||
    age < 18 ||
    !["woman", "man", "nonbinary", "other"].includes(payload?.gender) ||
    !isStrongPassword(payload?.password) ||
    payload?.password !== payload?.confirmPassword
  ) {
    return Response.json({ error: "invalid_account_details" }, { status: 400 });
  }
  if (isContactUsed(email) || (await durableIdentifierUsed(email))) {
    return Response.json({ error: "email_taken" }, { status: 409 });
  }
  const usesExternalEmail = !email.endsWith("@munetios.com");
  const limit = consumeRateLimit({
    key: `education-signup:v2:${fingerprint}`,
    limit: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.allowed) {
    return Response.json(
      { error: "rate_limited", retryAfter: limit.retryAfter },
      {
        headers: { "Retry-After": String(limit.retryAfter) },
        status: 429,
      },
    );
  }
  if (
    usesExternalEmail &&
    !verifyContact({
      code: payload?.verificationCode,
      fingerprint,
      identifier: email,
      verificationId: payload?.verificationId,
    })
  ) {
    return Response.json({ error: "verification_required" }, { status: 400 });
  }
  const username = createAvailableUsername(email.split("@")[0]);
  const account = await createAccount({
    birthDate: payload.birthDate,
    contact: email,
    contactType: "email",
    email,
    firstName,
    gender: payload?.gender,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    password: payload.password,
    username,
  });
  if (!account) {
    return Response.json({ error: "email_taken" }, { status: 409 });
  }
  const educationProfile = {
    role: "teacher",
    schoolAddress: "",
    schoolAddressPromptDismissed: false,
  };
  setEducationProfile(account.id, educationProfile);
  account.durableData = { "education-profile-v1": educationProfile };
  await saveDurableAccount(account);
  const metadata = getSessionMetadata(request);
  const session = createAccountSession(
    account,
    getRequestCookie(request, accountCollectionCookieName),
    metadata,
  );
  await saveDurableSession({ account, metadata, session });
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", getSessionCookie(request, session.token));
  headers.append("Set-Cookie", getSignedInCookie(request));
  headers.append(
    "Set-Cookie",
    getAccountCollectionCookie(request, session.accountCollectionToken),
  );
  return Response.json(
    { authenticated: true, role: "teacher" },
    { headers, status: 201 },
  );
}
