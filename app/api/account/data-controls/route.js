import { requireAuth } from "../../../../auth.js";
import {
  deleteAllRecordings,
  getDataControlSettings,
  updateDataControlSettings,
} from "../../../lib/accountDataControls.js";
import {
  assertSameOrigin,
  getAccountById,
  setAccountData,
  verifyAccountPassword,
} from "../../../lib/authSecurity.js";
import { isStudentAccount } from "../../../lib/education.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function GET(request) {
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const settings = getDataControlSettings(session.user.id);
  return json({
    settings: isStudentAccount(session.user.id)
      ? { ...settings, personalizeAi: false }
      : settings,
  });
}

export async function PATCH(request) {
  if (!assertSameOrigin(request))
    return json({ error: "invalid_origin" }, { status: 403 });
  const { response, session } = await requireAuth(request);
  if (response) return response;
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object")
    return json({ error: "invalid_request" }, { status: 400 });
  if (
    isStudentAccount(session.user.id) &&
    Object.hasOwn(payload, "personalizeAi")
  ) {
    return json({ error: "education_account_restricted" }, { status: 403 });
  }
  if (
    Object.hasOwn(payload, "encryptionType") &&
    !["end_to_end", "encrypted_at_rest"].includes(payload.encryptionType)
  ) {
    return json({ error: "invalid_encryption_type" }, { status: 400 });
  }
  return json({
    settings: updateDataControlSettings(session.user.id, payload),
  });
}

export async function DELETE(request) {
  if (!assertSameOrigin(request))
    return json({ error: "invalid_origin" }, { status: 403 });
  const { response, session } = await requireAuth(request);
  if (response) return response;
  if (isStudentAccount(session.user.id)) {
    return json({ error: "education_account_restricted" }, { status: 403 });
  }
  const payload = await request.json().catch(() => null);
  const action = String(payload?.action || "");
  if (action === "recordings") {
    return json({ deleted: deleteAllRecordings(session.user.id) });
  }
  if (action === "call_history") {
    setAccountData(session.user.id, "meet-history-v1", []);
    return json({ deleted: true });
  }
  if (action === "workspaces") {
    const verified = await verifyAccountPassword(
      getAccountById(session.user.id),
      payload?.password,
    );
    if (!verified)
      return json({ error: "password_verification_failed" }, { status: 400 });
    setAccountData(session.user.id, "workspaces", []);
    return json({ deleted: true });
  }
  return json({ error: "invalid_action" }, { status: 400 });
}
