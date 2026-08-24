import { requireAuth } from "../../../auth.js";
import { hasDatabaseStaffAccess } from "../../lib/databaseStaffAccess.js";
import {
  hasDurableAuthStore,
  listDurableAccounts,
  listDurableFeedback,
} from "../../lib/durableAuthStore.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function denied() {
  return Response.json(
    { error: "not_found" },
    { headers: { "Cache-Control": "no-store" }, status: 404 },
  );
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response || !hasDatabaseStaffAccess(session)) return denied();
  if (!hasDurableAuthStore()) {
    return Response.json(
      { error: "database_unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 },
    );
  }
  const [accounts, feedback] = await Promise.all([
    listDurableAccounts({ limit: 500 }),
    listDurableFeedback({ limit: 500 }),
  ]);
  return Response.json(
    { accounts, feedback },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
