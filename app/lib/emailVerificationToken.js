import { createHmac, timingSafeEqual } from "node:crypto";

function tokenSecret() {
  return (
    process.env.MUNETIOS_EMAIL_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.RESEND_API_KEY ||
    ""
  );
}

function signature(value) {
  const secret = tokenSecret();
  return secret
    ? createHmac("sha256", secret).update(value).digest("base64url")
    : "";
}

export function createEmailVerificationToken(payload) {
  const encoded = Buffer.from(
    JSON.stringify({
      code: payload.code,
      expiresAt: payload.expiresAt,
      identifier: payload.identifier,
      verificationId: payload.verificationId,
    }),
    "utf8",
  ).toString("base64url");
  const signed = signature(encoded);
  return signed ? `${encoded}.${signed}` : "";
}

export function readEmailVerificationToken(token) {
  const [encoded, providedSignature, extra] = String(token || "").split(".");
  const expectedSignature = signature(encoded);
  if (!encoded || !providedSignature || extra || !expectedSignature)
    return null;
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (
      !/^\d{6}$/u.test(payload.code) ||
      !payload.identifier ||
      !payload.verificationId ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
