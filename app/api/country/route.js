import { getRequestLocation } from "../../lib/requestLocation.js";
import { supportedCountryCodes } from "../../lib/supportedCountries.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { country, countryDetection, region } = getRequestLocation(request);

  return Response.json(
    {
      countries: supportedCountryCodes,
      detectedCountry: country,
      detectedRegion: region,
      detectionMethod: countryDetection,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
