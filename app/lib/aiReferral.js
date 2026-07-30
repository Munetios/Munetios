import { createHmac, timingSafeEqual } from "node:crypto";
import { getAccountData, setAccountData } from "./authSecurity.js";

function getSecret() {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "munetios-development-referral-secret"
  );
}

function signature(value) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

export function createAiReferralToken(accountId) {
  const payload = Buffer.from(
    JSON.stringify({ accountId, createdAt: Date.now() }),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function redeemAiReferralToken(token, newAccountId) {
  const [payload, suppliedSignature] = String(token || "").split(".");
  if (!payload || !suppliedSignature) return false;
  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return false;
  }

  let referral;
  try {
    referral = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (
    !referral.accountId ||
    referral.accountId === newAccountId ||
    Date.now() - Number(referral.createdAt) > 90 * 24 * 60 * 60 * 1000 ||
    getAccountData(newAccountId, "ai-referral-redeemed", false)
  ) {
    return false;
  }

  for (const accountId of [referral.accountId, newAccountId]) {
    const usage = getAccountData(accountId, "ai-usage", {});
    setAccountData(accountId, "ai-usage", {
      ...usage,
      usageResets:
        (Number.isFinite(usage.usageResets)
          ? Math.max(0, usage.usageResets)
          : 3) + 1,
    });
  }
  setAccountData(newAccountId, "ai-referral-redeemed", true);
  return true;
}
