import { getAccountSession } from "./app/lib/authSecurity.js";

const authCookieNames = ["munetios_session"];
const demoCookieName = "munetios_demo";

function hasUsefulValue(value) {
  if (!value || typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  return ![
    "",
    "0",
    "false",
    "null",
    "undefined",
    "signedout",
    "loggedout",
  ].includes(normalized);
}

function parseCookieHeader(headerValue) {
  if (!headerValue) {
    return new Map();
  }

  return new Map(
    headerValue
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separatorIndex = cookie.indexOf("=");
        const name =
          separatorIndex === -1 ? cookie : cookie.slice(0, separatorIndex);
        const value =
          separatorIndex === -1 ? "" : cookie.slice(separatorIndex + 1);

        return [name, decodeURIComponent(value)];
      }),
  );
}

function getCookieValue(request, name) {
  if (request?.cookies?.get) {
    return request.cookies.get(name)?.value || null;
  }

  return parseCookieHeader(request?.headers?.get?.("cookie")).get(name) || null;
}

export function hasAccountSessionCookie(request) {
  return authCookieNames.some(
    (cookieName) => getCookieValue(request, cookieName) !== null,
  );
}

function stableHash(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function createDemoSession(value) {
  const id = `demo-${stableHash(value)}`;

  return {
    authenticated: true,
    demo: true,
    source: demoCookieName,
    sessionKey: id,
    user: {
      avatarLetter: "M",
      avatarUrl: null,
      email: "demo@munetios.com",
      id,
      name: "Example Account",
      profilePictureUrl: null,
    },
  };
}

export async function auth(request) {
  const demoToken = getCookieValue(request, demoCookieName);

  if (hasUsefulValue(demoToken) && /^[a-z\d-]{8,128}$/i.test(demoToken)) {
    return createDemoSession(demoToken);
  }

  for (const cookieName of authCookieNames) {
    const cookieValue = getCookieValue(request, cookieName);

    if (hasUsefulValue(cookieValue)) {
      return getAccountSession(cookieValue, request);
    }
  }

  return null;
}

export async function requireAuth(request) {
  const session = await auth(request);

  if (!session) {
    return {
      response: unauthorizedResponse("Unauthorized", {
        invalidSession: hasAccountSessionCookie(request),
      }),
      session: null,
    };
  }

  return {
    response: null,
    session,
  };
}

export function unauthorizedResponse(
  message = "Unauthorized",
  { invalidSession = false } = {},
) {
  return Response.json(
    {
      error: "unauthorized",
      message,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Munetios-Auth-State": invalidSession ? "invalid-session" : "guest",
      },
      status: 401,
    },
  );
}
