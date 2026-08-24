import { getPublicSignupCount } from "../../../lib/authSecurity.js";
import {
  countDurableAccounts,
  incrementDurableMetric,
} from "../../../lib/durableAuthStore.js";
import { recordLandingPageView } from "../../../lib/publicAnalytics.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let durableSignups = null;
  let durableVisitors = null;
  try {
    [durableSignups, durableVisitors] = await Promise.all([
      countDurableAccounts(),
      incrementDurableMetric("landing-page-views"),
    ]);
  } catch {
    // Keep public aggregate counts available if remote storage is interrupted.
  }
  return Response.json(
    {
      signups: durableSignups ?? getPublicSignupCount(),
      visitors: durableVisitors ?? recordLandingPageView(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
