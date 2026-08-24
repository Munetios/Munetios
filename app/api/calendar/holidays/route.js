import Holidays from "date-holidays";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const minimumYear = 1970;
const maximumYear = 2100;
const earthDayNames = {
  ar: "يوم الأرض",
  co: "Ghjornu di a Terra",
  da: "Jordens dag",
  de: "Tag der Erde",
  el: "Ημέρα της Γης",
  en: "Earth Day",
  es: "Día de la Tierra",
  fr: "Jour de la Terre",
  fur: "Zornade de Tiere",
  gl: "Día da Terra",
  he: "יום כדור הארץ",
  hi: "पृथ्वी दिवस",
  id: "Hari Bumi",
  it: "Giornata della Terra",
  ja: "アースデイ",
  ko: "지구의 날",
  ms: "Hari Bumi",
  nl: "Dag van de Aarde",
  pl: "Dzień Ziemi",
  pt: "Dia da Terra",
  ru: "День Земли",
  sv: "Jordens dag",
  th: "วันคุ้มครองโลก",
  tr: "Dünya Günü",
  vi: "Ngày Trái Đất",
  zh: "世界地球日",
};

function normalizeCountry(value) {
  const country = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function normalizeRegion(value) {
  const region = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z0-9-]{1,12}$/.test(region) ? region : null;
}

function normalizeLocale(value) {
  const locale = String(value || "en").trim();
  return /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(locale)
    ? locale.replaceAll("_", "-")
    : "en";
}

function holidayEngine(country, region, locale) {
  const base = new Holidays(country);
  const states = base.getStates(country, locale) || {};
  const engine =
    region && states[region] ? new Holidays(country, region) : base;
  engine.setLanguages([locale, locale.split("-")[0], "en"]);
  return engine;
}

function localizeHolidayName(name, country, locale) {
  if (country === "US" && locale.toLowerCase() === "en-us") {
    return name.replaceAll("Labour", "Labor");
  }
  return name;
}

function supplementalHolidays(year, locale) {
  const language = locale.split("-")[0].toLowerCase();
  return [
    {
      date: `${year}-04-22`,
      name: earthDayNames[language] || earthDayNames.en,
      note: "",
      substitute: false,
      type: "observance",
    },
  ];
}

export async function GET(request) {
  const url = new URL(request.url);
  const country = normalizeCountry(url.searchParams.get("country"));
  const region = normalizeRegion(url.searchParams.get("region"));
  const locale = normalizeLocale(url.searchParams.get("locale"));
  const requestedYear = Number(url.searchParams.get("year"));
  const year = Number.isInteger(requestedYear) ? requestedYear : NaN;

  if (!country || year < minimumYear || year > maximumYear) {
    return Response.json({ error: "invalid_holiday_request" }, { status: 400 });
  }

  try {
    const engine = holidayEngine(country, region, locale);
    const holidays = engine
      .getHolidays(year)
      .slice(0, 1_000)
      .map((holiday) => ({
        date: String(holiday.date || "").slice(0, 10),
        name: localizeHolidayName(
          String(holiday.name || ""),
          country,
          locale,
        ).slice(0, 160),
        note: String(holiday.note || "").slice(0, 500),
        substitute: holiday.substitute === true,
        type: String(holiday.type || "observance").slice(0, 30),
      }));
    for (const supplemental of supplementalHolidays(year, locale)) {
      if (
        !holidays.some(
          (holiday) =>
            holiday.date === supplemental.date &&
            holiday.name === supplemental.name,
        )
      ) {
        holidays.push(supplemental);
      }
    }

    return Response.json(
      { country, holidays, region: region || null, year },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch {
    return Response.json(
      {
        country,
        holidays: [],
        region: region || null,
        unsupported: true,
        year,
      },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  }
}
