import { auth } from "../../../../auth.js";
import {
  accountCollectionCookieName,
  createAccountSession,
  createOAuthAccount,
  getAccountByIdentifier,
  getAccountByOAuthIdentity,
  getAccountCollectionCookie,
  getAccountData,
  getRequestCookie,
  getSessionCookie,
  getSessionMetadata,
  linkOAuthIdentity,
  setAccountData,
} from "../../../lib/authSecurity.js";
import {
  connectConnector,
  consumeOAuthState,
  getConnector,
} from "../../../lib/connectorDatabase.js";
import { isStudentAccount } from "../../../lib/education.js";
import { isParentalConnectorBlocked } from "../../../lib/family.js";
import {
  clearGithubAuthCookie,
  getGithubAuthConfiguration,
  readGithubAuthRequest,
} from "../../../lib/githubAuth.js";
import { getSignedInCookie } from "../../../lib/signedInCookie.js";
import {
  createSignInChallenge,
  getTwoFactorState,
} from "../../../lib/twoFactorSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const githubOrigin = "http://localhost:3000";
const githubCallbackUrl = `${githubOrigin}/api/callback/github`;

function redirect(location, headers = new Headers()) {
  headers.set("Cache-Control", "no-store");
  headers.set("Location", location);
  return new Response(null, { headers, status: 302 });
}

function getSignInDestination(authRequest, failed = false) {
  const destination = new URL("/signin", githubOrigin);
  destination.searchParams.set("returnTo", authRequest?.returnTo || "/");
  if (authRequest?.addAccount) {
    destination.searchParams.set("addAccount", "true");
  }
  if (authRequest?.embedded) {
    destination.searchParams.set("embedded", "true");
  }
  if (failed) {
    destination.searchParams.set("oauthError", "github");
  } else {
    destination.searchParams.set("oauthComplete", "true");
  }
  return destination;
}

async function exchangeGithubCode(code, clientId, clientSecret) {
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: githubCallbackUrl,
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error("token_failed");
  }
  return tokenPayload.access_token;
}

async function getGithubProfile(accessToken, includeEmails = false) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "Munetios",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const profileResponse = await fetch("https://api.github.com/user", {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  const profile = await profileResponse.json();
  if (!profileResponse.ok) throw new Error("profile_failed");

  if (!includeEmails) return { emails: [], profile };

  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  const emails = await emailResponse.json();
  if (!emailResponse.ok || !Array.isArray(emails)) {
    throw new Error("email_failed");
  }
  return { emails, profile };
}

async function completeGithubSignIn(request, code, state, authRequest) {
  const failureDestination = getSignInDestination(authRequest, true);
  const failureHeaders = new Headers();
  failureHeaders.append("Set-Cookie", clearGithubAuthCookie(request));

  if (!code || !state || state !== authRequest.state) {
    return redirect(failureDestination.toString(), failureHeaders);
  }

  try {
    const { clientId, clientSecret } = getGithubAuthConfiguration();
    if (!clientId || !clientSecret) throw new Error("oauth_unavailable");
    const accessToken = await exchangeGithubCode(code, clientId, clientSecret);
    const { emails, profile } = await getGithubProfile(accessToken, true);
    const verifiedEmails = emails.filter(
      (email) => email?.verified === true && email?.email,
    );
    const verifiedEmail =
      verifiedEmails.find((email) => email.primary === true)?.email ||
      verifiedEmails[0]?.email;
    const githubId = String(profile.id || "");
    let account = githubId
      ? getAccountByOAuthIdentity("github", githubId)
      : null;
    if (!account && verifiedEmail) {
      account = getAccountByIdentifier(verifiedEmail);
    }
    if (!account && verifiedEmail && githubId) {
      account = await createOAuthAccount({
        email: verifiedEmail,
        name: profile.name || profile.login,
        provider: "github",
        providerAccountId: githubId,
        username: profile.login,
      });
    }
    if (!account) throw new Error("account_not_found");
    if (
      !linkOAuthIdentity(account.id, {
        email: verifiedEmail,
        provider: "github",
        providerAccountId: githubId,
      })
    ) {
      throw new Error("identity_link_failed");
    }

    setAccountData(account.id, "githubAuth", {
      githubId,
      login: String(profile.login || ""),
      verifiedEmail,
    });
    if (profile.avatar_url) {
      const storedProfile = getAccountData(account.id, "profile", {});
      setAccountData(account.id, "profile", {
        ...storedProfile,
        profilePictureUrl: String(profile.avatar_url),
      });
    }
    const githubConnector = getConnector("github");
    if (githubConnector) {
      connectConnector(
        account.id,
        githubConnector.id,
        profile.login || "",
        accessToken,
      );
    }
    const twoFactor = getTwoFactorState(account.id);
    if (twoFactor.enabled) {
      const challengeId = createSignInChallenge(account.id);
      const destination = new URL("/signin", githubOrigin);
      destination.searchParams.set("twoFactorChallenge", challengeId);
      destination.searchParams.set(
        "returnTo",
        String(authRequest.returnTo || "/"),
      );
      if (authRequest.addAccount)
        destination.searchParams.set("addAccount", "true");
      if (authRequest.embedded)
        destination.searchParams.set("embedded", "true");
      const headers = new Headers();
      headers.append("Set-Cookie", clearGithubAuthCookie(request));
      return redirect(destination.toString(), headers);
    }
    const session = createAccountSession(
      account,
      getRequestCookie(request, accountCollectionCookieName),
      getSessionMetadata(request),
    );
    const headers = new Headers();
    headers.append("Set-Cookie", getSessionCookie(request, session.token));
    headers.append("Set-Cookie", getSignedInCookie(request));
    headers.append(
      "Set-Cookie",
      getAccountCollectionCookie(request, session.accountCollectionToken),
    );
    headers.append("Set-Cookie", clearGithubAuthCookie(request));

    const destination =
      authRequest.addAccount && authRequest.embedded
        ? getSignInDestination(authRequest)
        : new URL(authRequest.returnTo || "/", githubOrigin);
    return redirect(destination.toString(), headers);
  } catch {
    return redirect(failureDestination.toString(), failureHeaders);
  }
}

export async function GET(request, { params }) {
  const { connectorName } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const githubAuthRequest =
    connectorName === "github" ? readGithubAuthRequest(request) : null;

  if (githubAuthRequest && state === githubAuthRequest.state) {
    return completeGithubSignIn(request, code, state, githubAuthRequest);
  }

  const connector = getConnector(connectorName);
  const session = await auth(request);
  const oauthState =
    session && connector && state
      ? consumeOAuthState(state, connector.id)
      : null;
  const destination = new URL("/account/settings/connectors", githubOrigin);

  if (
    !session ||
    !connector ||
    connector.slug !== "github" ||
    !code ||
    !oauthState ||
    oauthState.account_id !== session.user.id ||
    isStudentAccount(session.user.id) ||
    isParentalConnectorBlocked(session.user.id, "github")
  ) {
    destination.searchParams.set("connectorError", "connect");
    return redirect(destination.toString());
  }

  try {
    const { clientId, clientSecret } = getGithubAuthConfiguration();
    if (!clientId || !clientSecret) throw new Error("oauth_unavailable");
    const accessToken = await exchangeGithubCode(code, clientId, clientSecret);
    const { profile } = await getGithubProfile(accessToken);
    connectConnector(
      oauthState.account_id,
      connector.id,
      profile.login || "",
      accessToken,
    );
    destination.searchParams.set("connectorConnected", "github");
  } catch {
    destination.searchParams.set("connectorError", "connect");
  }
  const returnDestination = new URL(
    oauthState.return_to || "/account/settings/connectors",
    githubOrigin,
  );
  for (const [key, value] of destination.searchParams) {
    returnDestination.searchParams.set(key, value);
  }
  return redirect(returnDestination.toString());
}
