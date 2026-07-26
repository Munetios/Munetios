import { getRequestLocation } from "../../lib/requestLocation.js";

export const dynamic = "force-dynamic";

const fallbackTimezones = [
  "UTC",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Pacific/Auckland",
];

export async function GET(request) {
  const { timezone } = getRequestLocation(request);
  const supportedTimezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : fallbackTimezones;
  const timezones = Array.from(
    new Set(["UTC", timezone, ...supportedTimezones]),
  ).sort((first, second) => first.localeCompare(second));

  return Response.json(
    { detectedTimezone: timezone, timezones },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
