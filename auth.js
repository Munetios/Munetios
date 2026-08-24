import {
  getAccountSession,
  getAvatarLetter,
  importDurableAccount,
} from "./app/lib/authSecurity.js";
import { getDurableSession } from "./app/lib/durableAuthStore.js";

const authCookieNames = ["munetios_session"];

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

export async function auth(request) {
  const sessionRequest = request?.headers?.get ? request : null;
  for (const cookieName of authCookieNames) {
    const cookieValue = getCookieValue(request, cookieName);

    if (hasUsefulValue(cookieValue)) {
      const localSession = getAccountSession(cookieValue, sessionRequest);
      if (localSession) return localSession;
      const durable = await getDurableSession(cookieValue);
      if (!durable?.account) return null;
      const account = importDurableAccount(durable.account) || durable.account;
      return {
        authenticated: true,
        sessionKey: durable.tokenHash,
        sessionId: durable.tokenHash,
        source: "munetios_session",
        user: {
          avatarLetter: getAvatarLetter(account.name || account.email),
          avatarUrl: account.avatarUrl || null,
          birthDate: account.birthDate,
          email: account.email,
          firstName: account.firstName,
          gender: account.gender,
          id: account.id,
          lastName: account.lastName,
          name: account.name,
          plan: account.plan || "Free",
          profilePictureUrl: account.profilePictureUrl || null,
          username: account.username,
        },
      };
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
