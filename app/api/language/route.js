import { requireAuth } from "../../../auth.js";
import {
  clearAccountLanguage,
  getAccountLanguage,
  normalizeAccountLanguage,
  setAccountLanguage,
} from "../../lib/accountLanguage.js";

export const dynamic = "force-dynamic";

const localeCookieName = "munetios_locale";
const localeCookieMaxAge = 31_536_000;

function getProfileKey(session) {
  return session.user.id;
}

function getCookieValue(request, name) {
  if (request?.cookies?.get) {
    return request.cookies.get(name)?.value || null;
  }

  const cookieHeader = request?.headers?.get?.("cookie") || "";
  const cookie = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  if (!cookie) {
    return null;
  }

  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return cookie.slice(name.length + 1);
  }
}

function localeCookie(language) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `${localeCookieName}=${encodeURIComponent(language)}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax${secure}`;
}

function clearedLocaleCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `${localeCookieName}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function jsonResponse(payload, language = null, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(language ? { "Set-Cookie": localeCookie(language) } : {}),
      ...(init.headers || {}),
    },
  });
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }

  const accountLanguage = getAccountLanguage(getProfileKey(session));
  const cookieLanguage = normalizeAccountLanguage(
    getCookieValue(request, localeCookieName),
  );
  const language = accountLanguage || cookieLanguage || null;

  return jsonResponse(
    {
      language,
      source: accountLanguage ? "account" : cookieLanguage ? "cookie" : null,
    },
    accountLanguage || null,
  );
}

export async function POST(request) {
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      {
        error: "invalid_json",
        message: "Invalid request body.",
      },
      null,
      { status: 400 },
    );
  }

  if (payload?.language === "auto") {
    clearAccountLanguage(getProfileKey(session));

    return jsonResponse(
      {
        language: null,
        source: null,
      },
      null,
      {
        headers: {
          "Set-Cookie": clearedLocaleCookie(),
        },
      },
    );
  }

  const language = normalizeAccountLanguage(payload?.language);

  if (!language) {
    return jsonResponse(
      {
        error: "invalid_language",
        message: "Choose a supported language.",
      },
      null,
      { status: 400 },
    );
  }

  setAccountLanguage(getProfileKey(session), language);

  return jsonResponse(
    {
      language,
      source: "account",
    },
    language,
  );
}
