export const aiAccountCacheKey = "munetios.ai.accountCache.v1";

const cachedFields = [
  "avatar",
  "avatarLetter",
  "avatarUrl",
  "birthDate",
  "birthday",
  "email",
  "name",
  "plan",
  "profilePictureUrl",
];

function sanitizeAccount(account) {
  if (!account || typeof account !== "object") return null;
  const cachedAccount = {};
  for (const field of cachedFields) {
    const value = account[field];
    if (
      typeof value === "string" ||
      (field === "avatar" && value && typeof value === "object")
    ) {
      cachedAccount[field] = value;
    }
  }
  return Object.keys(cachedAccount).length ? cachedAccount : null;
}

export function loadAiAccountCache() {
  if (typeof window === "undefined") return null;
  try {
    return sanitizeAccount(
      JSON.parse(window.localStorage.getItem(aiAccountCacheKey) || "null"),
    );
  } catch {
    return null;
  }
}

export function saveAiAccountCache(account) {
  if (typeof window === "undefined") return;
  const cachedAccount = sanitizeAccount(account);
  if (!cachedAccount) return;
  window.localStorage.setItem(aiAccountCacheKey, JSON.stringify(cachedAccount));
  window.dispatchEvent(
    new CustomEvent("munetios:ai-account-cache", { detail: cachedAccount }),
  );
}
