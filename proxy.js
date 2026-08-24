import { NextResponse } from "next/server";

const localePattern =
  /^(?:ar|ar-SA|co-FR|da|da-DK|de|de-CH|de-DE|en|en-GB|es|es-419|es-ES|es-MX|es-PR|es-US|fr|fr-FR|fur-IT|gl-ES|he|he-IL|hi|hi-IN|id|id-ID|it|it-CH|it-IT|ja|ja-JP|ko|ko-KR|ms|ms-MY|nl|nl-NL|pl|pl-PL|pt|pt-BR|pt-PT|ru|ru-RU|sv|sv-SE|th|th-TH|tr|tr-TR|vi|vi-VN|zh|zh-CN|zh-TW)$/u;
const canonicalLocales = {
  ar: "ar-SA",
  da: "da-DK",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  he: "he-IL",
  hi: "hi-IN",
  id: "id-ID",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  ms: "ms-MY",
  nl: "nl-NL",
  pl: "pl-PL",
  pt: "pt-BR",
  ru: "ru-RU",
  sv: "sv-SE",
  th: "th-TH",
  tr: "tr-TR",
  vi: "vi-VN",
  zh: "zh-CN",
};
const supportedCountries = new Set([
  "AR",
  "AT",
  "BE",
  "BG",
  "BR",
  "CY",
  "CZ",
  "DE",
  "DK",
  "DO",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IN",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NG",
  "NL",
  "PL",
  "PR",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
  "US",
]);

function setLocaleCookie(response, locale) {
  if (locale) {
    response.cookies.set("munetios_locale", locale, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    });
  }
  return response;
}

export function proxy(request) {
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const locale = segments[0];
  const hasLocale = localePattern.test(locale || "");
  const canonicalLocale = hasLocale ? canonicalLocales[locale] || locale : null;
  const routeSegments = hasLocale ? segments.slice(1) : segments;
  const routeName = routeSegments[0] || "";
  const isLegalRoute = ["privacy", "terms", "policies", "cookies"].includes(
    routeName,
  );
  const country = String(
    request.headers.get("x-vercel-ip-country") ||
      request.headers.get("cf-ipcountry") ||
      "",
  ).toUpperCase();

  if (country && !supportedCountries.has(country) && routeName === "api") {
    return NextResponse.json(
      { error: "country_not_supported" },
      { headers: { "Cache-Control": "no-store" }, status: 451 },
    );
  }

  if (
    country &&
    !supportedCountries.has(country) &&
    !isLegalRoute &&
    routeName !== "unavailable"
  ) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/unavailable";
    destination.search = "";
    return setLocaleCookie(NextResponse.rewrite(destination), canonicalLocale);
  }

  if (!hasLocale) return NextResponse.next();
  if (routeName === "help") {
    return setLocaleCookie(NextResponse.next(), canonicalLocale);
  }

  const destination = request.nextUrl.clone();
  destination.pathname = `/${routeSegments.join("/")}`;
  return setLocaleCookie(NextResponse.rewrite(destination), canonicalLocale);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
