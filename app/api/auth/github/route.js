import {
  createGithubAuthRequest,
  getGithubAuthConfiguration,
} from "../../../lib/githubAuth.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const githubOrigin = "http://localhost:3000";
const githubCallbackUrl = `${githubOrigin}/api/callback/github`;

function getSafeReturnTo(value) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function redirect(location, headers = {}) {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: location,
      ...headers,
    },
    status: 302,
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const returnTo = getSafeReturnTo(url.searchParams.get("returnTo"));
  const addAccount = url.searchParams.get("addAccount") === "true";
  const embedded = url.searchParams.get("embedded") === "true";
  const { clientId } = getGithubAuthConfiguration();
  const authRequest = createGithubAuthRequest(request, {
    addAccount,
    embedded,
    returnTo,
  });

  if (!clientId || !authRequest) {
    const destination = new URL("/signin", githubOrigin);
    destination.searchParams.set("oauthError", "github");
    destination.searchParams.set("returnTo", returnTo);
    return redirect(destination.toString());
  }

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", githubCallbackUrl);
  authorizeUrl.searchParams.set("scope", "read:user user:email repo");
  authorizeUrl.searchParams.set("state", authRequest.state);

  return redirect(authorizeUrl.toString(), {
    "Set-Cookie": authRequest.cookie,
  });
}
