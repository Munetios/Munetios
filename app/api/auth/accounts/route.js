import { auth, unauthorizedResponse } from "../../../../auth.js";
import {
  accountCollectionCookieName,
  attachSessionToAccountCollection,
  ensureAccountCollection,
  getAccountCollectionAccounts,
  getAccountCollectionCookie,
  getAccountData,
  getAvatarLetter,
  getRequestCookie,
} from "../../../lib/authSecurity.js";
import { getEducationProfile } from "../../../lib/education.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getCollectionScopedProfilePictureUrl(profilePictureUrl, accountId) {
  if (
    typeof profilePictureUrl !== "string" ||
    !profilePictureUrl.startsWith("/api/account/profile?")
  ) {
    return profilePictureUrl || null;
  }

  const separator = profilePictureUrl.includes("?") ? "&" : "?";
  return `${profilePictureUrl}${separator}accountId=${encodeURIComponent(accountId)}`;
}

export async function GET(request) {
  const session = await auth(request);
  if (!session || session.demo) return unauthorizedResponse();

  const existingToken = getRequestCookie(request, accountCollectionCookieName);
  const collection = ensureAccountCollection(session.user.id, existingToken);
  attachSessionToAccountCollection(
    getRequestCookie(request, "munetios_session"),
    collection.token,
  );
  const accounts = getAccountCollectionAccounts(collection.token).map(
    (account) => {
      const storedProfile = getAccountData(account.id, "profile", {});
      const education = getEducationProfile(account.id);
      return {
        accountType: education ? "education" : "personal",
        active: account.id === session.user.id,
        avatar: storedProfile.avatar || {
          color: "#7c3aed",
          font: "googleSansFlex",
          type: "letter",
          value: getAvatarLetter(storedProfile.name || account.name),
        },
        avatarLetter: getAvatarLetter(storedProfile.name || account.name),
        email: storedProfile.email || account.email,
        id: account.id,
        name: storedProfile.name || account.name,
        education: education || undefined,
        personal: !education,
        plan: education ? "Education" : account.plan || "Free",
        profilePictureUrl: getCollectionScopedProfilePictureUrl(
          storedProfile.profilePictureUrl,
          account.id,
        ),
      };
    },
  );
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (collection.token !== existingToken) {
    headers.append(
      "Set-Cookie",
      getAccountCollectionCookie(request, collection.token),
    );
  }
  return Response.json({ accounts }, { headers });
}
