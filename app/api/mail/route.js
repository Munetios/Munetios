import { requireAuth } from "../../../auth.js";
import { assertSameOrigin } from "../../lib/authSecurity.js";
import {
  createDraft,
  deleteMailMessage,
  getMailMessage,
  getMailPublicKey,
  getMailSettings,
  listMail,
  mailAsEml,
  mailPlainText,
  normalizeMailAddress,
  resolveMunetiosRecipient,
  sanitizeMailHtml,
  setMailPublicKey,
  storeMessage,
  updateMailMessage,
  updateMailSettings,
} from "../../lib/mail.js";
import { sendUserEmail } from "../../lib/nodemailerVerificationEmail.js";
import { enforceOrganizationAppAccess } from "../../lib/organizationPolicies.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init.headers || {}) },
  });
}

async function authenticated(request, mutating = false) {
  if (mutating && !assertSameOrigin(request)) {
    return { response: response({ error: "invalid_origin" }, { status: 403 }) };
  }
  const { response: authResponse, session } = await requireAuth(request);
  if (authResponse) return { response: authResponse };
  const policyResponse = enforceOrganizationAppAccess(session, "mail", {
    mutating,
  });
  return policyResponse ? { response: policyResponse } : { session };
}

export async function GET(request) {
  const result = await authenticated(request);
  if (result.response) return result.response;
  const url = new URL(request.url);
  const messageId = String(url.searchParams.get("id") || "").slice(0, 100);
  const keyFor = normalizeMailAddress(url.searchParams.get("keyFor"));
  if (keyFor) {
    const account = resolveMunetiosRecipient(keyFor);
    const publicKey = account ? getMailPublicKey(account.id) : null;
    return publicKey
      ? response({ local: true, publicKey })
      : response({ error: "mail_key_unavailable" }, { status: 404 });
  }
  if (messageId) {
    const message = getMailMessage(result.session.user.id, messageId);
    if (!message)
      return response({ error: "message_not_found" }, { status: 404 });
    if (url.searchParams.get("download") === "true") {
      return new Response(mailAsEml(message), {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${message.subject.replace(/[^a-z0-9 _-]/giu, "_").slice(0, 80) || "message"}.eml"`,
          "Content-Type": "message/rfc822; charset=utf-8",
        },
      });
    }
    return response({ message });
  }
  return response({
    messages: listMail(result.session.user.id, {
      folder: String(url.searchParams.get("folder") || "inbox"),
      query: String(url.searchParams.get("q") || ""),
    }),
    settings: getMailSettings(
      result.session.user.id,
      result.session.user.email,
    ),
  });
}

export async function POST(request) {
  const result = await authenticated(request, true);
  if (result.response) return result.response;
  const payload = await request.json().catch(() => null);
  if (!payload) return response({ error: "invalid_request" }, { status: 400 });
  const sender = normalizeMailAddress(result.session.user.email);

  if (payload.action === "register_key") {
    const publicKey = setMailPublicKey(
      result.session.user.id,
      payload.publicKey,
    );
    return publicKey
      ? response({ publicKey })
      : response({ error: "invalid_public_key" }, { status: 400 });
  }

  if (payload.action === "draft") {
    const draft = createDraft(result.session.user.id, {
      from: sender,
      html: payload.html,
      id: payload.id,
      subject: payload.subject,
      to: payload.to,
    });
    return response({ message: draft }, { status: 201 });
  }

  if (payload.action !== "send") {
    return response({ error: "invalid_action" }, { status: 400 });
  }
  const recipientEmail = normalizeMailAddress(payload.to);
  const html = sanitizeMailHtml(payload.html);
  const plainText = mailPlainText(html);
  if (!recipientEmail || (!plainText && !html)) {
    return response({ error: "required_details" }, { status: 400 });
  }
  const recipient = resolveMunetiosRecipient(recipientEmail);
  let delivery = {
    delivered: false,
    local: false,
    reason: "email_not_configured",
  };
  if (recipient) {
    if (!payload.zeroKnowledgeEnvelope) {
      return response({ error: "mail_encryption_required" }, { status: 409 });
    }
    const received = storeMessage(recipient.id, {
      from: sender,
      html,
      read: false,
      replyToId: payload.replyToId,
      subject: payload.subject,
      text: plainText,
      threadId: payload.threadId,
      to: recipientEmail,
      zeroKnowledgeEnvelope: payload.zeroKnowledgeEnvelope,
    });
    delivery = { delivered: true, local: true, messageId: received.id };
    const recipientSettings = getMailSettings(recipient.id, recipient.email);
    await Promise.allSettled(
      recipientSettings.notificationEmails.map((to) =>
        sendUserEmail({
          fromName: "Munetios Mail",
          subject: `New Munetios Mail: ${received.subject}`,
          text: `You received encrypted Munetios Mail from ${sender}. Sign in to Munetios Mail to read it.`,
          to,
        }),
      ),
    );
  } else {
    delivery = await sendUserEmail({
      fromName: result.session.user.name || "Munetios Mail user",
      html,
      replyTo: sender,
      subject: payload.subject,
      text: plainText,
      to: recipientEmail,
    });
  }
  if (!delivery?.delivered) {
    return response(
      { error: delivery?.reason || "delivery_failed" },
      { status: 503 },
    );
  }
  return response(
    { delivered: true, local: delivery.local === true },
    { status: 201 },
  );
}

export async function PATCH(request) {
  const result = await authenticated(request, true);
  if (result.response) return result.response;
  const payload = await request.json().catch(() => null);
  if (!payload) return response({ error: "invalid_request" }, { status: 400 });
  if (payload.action === "settings") {
    return response({
      settings: updateMailSettings(
        result.session.user.id,
        result.session.user.email,
        payload.settings || {},
      ),
    });
  }
  const message = updateMailMessage(
    result.session.user.id,
    String(payload.id || ""),
    payload.patch || {},
  );
  return message
    ? response({ message })
    : response({ error: "message_not_found" }, { status: 404 });
}

export async function DELETE(request) {
  const result = await authenticated(request, true);
  if (result.response) return result.response;
  const payload = await request.json().catch(() => null);
  return payload?.id &&
    deleteMailMessage(result.session.user.id, String(payload.id))
    ? response({ deleted: true })
    : response({ error: "message_not_found" }, { status: 404 });
}
