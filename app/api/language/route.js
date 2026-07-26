import { requireAuth } from "../../../auth.js";
import { translations } from "../../i18n.js";

export const dynamic = "force-dynamic";

const languagePreferenceStore =
  globalThis.__munetiosLanguagePreferenceStore || new Map();
const localeCookieName = "munetios_locale";
const localeCookieMaxAge = 31_536_000;

globalThis.__munetiosLanguagePreferenceStore = languagePreferenceStore;

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

function normalizeLanguage(language) {
  if (typeof language !== "string" || !language.trim()) {
    return null;
  }

  const candidate = language.trim().replaceAll("_", "-");
  const exactLocale = Object.keys(translations).find(
    (locale) => locale.toLowerCase() === candidate.toLowerCase(),
  );

  if (exactLocale) {
    return exactLocale;
  }

  return null;
}

function localeCookie(language) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `${localeCookieName}=${encodeURIComponent(language)}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax${secure}`;
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

  const accountLanguage = languagePreferenceStore.get(getProfileKey(session));
  const cookieLanguage = normalizeLanguage(
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

  const language = normalizeLanguage(payload?.language);

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

  languagePreferenceStore.set(getProfileKey(session), language);

  return jsonResponse(
    {
      language,
      source: "account",
    },
    language,
  );
}
