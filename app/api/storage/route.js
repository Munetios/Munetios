import { requireAuth } from "../../../auth.js";
import { getDemoSettings, getDemoStorage } from "../../lib/demoSettings.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }

  return Response.json(
    session.demo
      ? getDemoStorage(getDemoSettings(session))
      : {
          totalLabel: "96GB",
          usedLabel: "0B",
        },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
