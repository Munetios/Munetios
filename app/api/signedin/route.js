import { auth } from "../../../auth.js";
import { getAccountData, getAvatarLetter } from "../../lib/authSecurity.js";

export const dynamic = "force-dynamic";

function jsonResponse(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export async function GET(request) {
  const session = await auth(request);

  if (!session) {
    return jsonResponse({
      authenticated: false,
      signedIn: false,
      user: null,
    });
  }
  const storedProfile = session.demo
    ? globalThis.__munetiosAccountProfileStore?.get(session.user.id) || {}
    : getAccountData(session.user.id, "profile", {});
  const name = storedProfile.name || session.user.name;
  const profilePictureUrl = Object.hasOwn(storedProfile, "profilePictureUrl")
    ? storedProfile.profilePictureUrl
    : session.user.profilePictureUrl;
  const avatar = storedProfile.avatar || {
    color: "#7c3aed",
    font: "googleSansFlex",
    type: "letter",
    value: getAvatarLetter(name || session.user.email),
  };

  return jsonResponse({
    authenticated: true,
    signedIn: true,
    user: {
      accountType: session.demo ? "demo" : "personal",
      avatar,
      avatarLetter: getAvatarLetter(name || session.user.email),
      avatarUrl: profilePictureUrl || session.user.avatarUrl,
      birthDate: session.user.birthDate || "",
      email: storedProfile.email || session.user.email,
      id: session.user.id,
      name,
      profilePictureUrl,
    },
  });
}
