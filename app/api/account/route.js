import {
  auth,
  hasAccountSessionCookie,
  unauthorizedResponse,
} from "../../../auth.js";
import {
  accountCollectionCookieName,
  attachSessionToAccountCollection,
  ensureAccountCollection,
  getAccountCollectionAccounts,
  getAccountCollectionCookie,
  getAccountData,
  getAvatarLetter,
  getRequestCookie,
} from "../../lib/authSecurity.js";
import { demoPlanLabel, getDemoSettings } from "../../lib/demoSettings.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = await auth(request);

  if (!session) {
    return unauthorizedResponse(
      "Your session token was invalid. Please sign in again and try again",
      { invalidSession: hasAccountSessionCookie(request) },
    );
  }

  const storedProfile = session.demo
    ? globalThis.__munetiosAccountProfileStore?.get(session.user.id) || {}
    : getAccountData(session.user.id, "profile", {});
  const profilePictureUrl = Object.hasOwn(storedProfile, "profilePictureUrl")
    ? storedProfile.profilePictureUrl
    : session.user.profilePictureUrl;
  const demoSettings = getDemoSettings(session);
  const name = storedProfile.name || session.user.name;
  const avatar = storedProfile.avatar || {
    color: "#7c3aed",
    font: "googleSansFlex",
    type: "letter",
    value: getAvatarLetter(name || session.user.email),
  };
  const existingCollectionToken = getRequestCookie(
    request,
    accountCollectionCookieName,
  );
  const collection = session.demo
    ? null
    : ensureAccountCollection(session.user.id, existingCollectionToken);
  const accounts = collection
    ? getAccountCollectionAccounts(collection.token)
    : [];
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (collection && collection.token !== existingCollectionToken) {
    headers.append("Set-Cookie", getAccountCollectionCookie(collection.token));
  }
  if (collection) {
    attachSessionToAccountCollection(
      getRequestCookie(request, "munetios_session"),
      collection.token,
    );
  }

  return Response.json(
    {
      authenticated: true,
      accountCount: session.demo ? 1 : Math.max(1, accounts.length),
      accountType: session.demo ? "demo" : "personal",
      avatar,
      avatarLetter: session.user.avatarLetter || getAvatarLetter(name),
      avatarUrl: profilePictureUrl || session.user.avatarUrl,
      demo: Boolean(session.demo),
      email: storedProfile.email || session.user.email,
      id: session.user.id,
      name,
      birthday: Object.hasOwn(storedProfile, "birthday")
        ? storedProfile.birthday
        : session.user.birthDate || "",
      birthDate: Object.hasOwn(storedProfile, "birthday")
        ? storedProfile.birthday
        : session.user.birthDate || "",
      archived: Boolean(demoSettings?.archived),
      demoSettings: demoSettings || undefined,
      plan: session.demo
        ? demoPlanLabel(demoSettings.plan)
        : session.user.plan || "Free",
      profilePictureUrl,
    },
    {
      headers,
    },
  );
}
