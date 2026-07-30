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

export function proxy(request) {
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const locale = segments[0];
  const hasLocale = localePattern.test(locale || "");
  const canonicalLocale = hasLocale ? canonicalLocales[locale] || locale : null;
  const routeSegments = hasLocale ? segments.slice(1) : segments;

  if (!hasLocale) return NextResponse.next();

  // Help routes have native locale-aware App Router pages.
  if (routeSegments[0] === "help") {
    const response = NextResponse.next();
    response.cookies.set("munetios_locale", canonicalLocale, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    });
    return response;
  }

  const destination = request.nextUrl.clone();
  destination.pathname = `/${routeSegments.join("/")}`;
  const response = NextResponse.rewrite(destination);
  response.cookies.set("munetios_locale", canonicalLocale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
