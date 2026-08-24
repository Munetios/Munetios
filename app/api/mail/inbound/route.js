import { timingSafeEqual } from "node:crypto";
import {
  getMailSettings,
  normalizeMailAddress,
  resolveMunetiosRecipient,
  storeMessage,
} from "../../../lib/mail.js";
import { sendUserEmail } from "../../../lib/nodemailerVerificationEmail.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request) {
  const secret = String(process.env.MUNETIOS_MAIL_INBOUND_SECRET || "");
  const supplied = String(request.headers.get("authorization") || "").replace(
    /^Bearer\s+/iu,
    "",
  );
  if (!secret || secret.length < 24 || supplied.length !== secret.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

export async function POST(request) {
  if (!process.env.MUNETIOS_MAIL_INBOUND_SECRET) {
    return Response.json(
      { error: "inbound_gateway_not_configured" },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const payload = await request.json().catch(() => null);
  const to = normalizeMailAddress(payload?.to);
  const from = normalizeMailAddress(payload?.from);
  const recipient = resolveMunetiosRecipient(to);
  if (!recipient || !from) {
    return Response.json({ error: "recipient_not_found" }, { status: 404 });
  }
  const message = storeMessage(recipient.id, {
    from,
    html: payload?.html,
    read: false,
    subject: payload?.subject,
    text: payload?.text,
    to,
  });
  const settings = getMailSettings(recipient.id, recipient.email);
  await Promise.allSettled(
    settings.notificationEmails.map((notificationEmail) =>
      sendUserEmail({
        fromName: "Munetios Mail",
        subject: `New Munetios Mail from ${from}`,
        text: "A new external email arrived in your Munetios Mail inbox.",
        to: notificationEmail,
      }),
    ),
  );
  return Response.json(
    { accepted: true, folder: message.folder, id: message.id },
    { status: 202 },
  );
}
