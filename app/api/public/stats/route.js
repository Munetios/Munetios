import { getPublicSignupCount } from "../../../lib/authSecurity.js";
import { recordLandingPageView } from "../../../lib/publicAnalytics.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(
    {
      signups: getPublicSignupCount(),
      visitors: recordLandingPageView(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
