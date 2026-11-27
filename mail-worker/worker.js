import PostalMime from "postal-mime";
import { mailHtml } from "./template.js";
import { handleApi, API_PREFIX } from "./src/api.js";
import { deliverInbound } from "./src/inbound.js";
import { processSend, processDeliveryEvent, processForward } from "./src/outbound.js";
import { processExport } from "./src/transfer.js";
import { processBlobDeletions } from "./src/storage.js";
import { everyMinute, hourly, deleteMailboxJob } from "./src/maintenance.js";
import { opsLog } from "./src/util.js";

export { MailboxHub } from "./src/hub.js";

const EMAIL = /^[!-~]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const internal = email => email.endsWith("@munetios.com");
const normalize = value => typeof value === "string" ? value.trim().toLowerCase() : "";
const valid = email => email.length <= 254 && EMAIL.test(email) && !/[<>(),;:"\[\]\\]/.test(email) && email.indexOf("@") === email.lastIndexOf("@");
const bytes = new TextEncoder();
const MAX_BODY = 256 * 1024;

async function authorized(request, secret) {
  if (!secret) return false;
  const authorization = request.headers.get("Authorization") || "";
  const [a, b] = await Promise.all([authorization, "Bearer " + secret].map(value => crypto.subtle.digest("SHA-256", bytes.encode(value))));
  const expected = new Uint8Array(b);
  return new Uint8Array(a).reduce((difference, byte, index) => difference | (byte ^ expected[index]), 0) === 0;
}

function messageFor(pathname, data, env) {
  const recipient = normalize(data?.recipient);
  if (!valid(recipient)) return null;
  if (pathname === "/forgot-email") {
    const sender = normalize(env.MAIL_VERIFICATION_FROM);
    if (!valid(sender) || !internal(sender) || internal(recipient) || !Array.isArray(data.accounts) || !data.accounts.length || !data.accounts.every(address => typeof address === "string" && valid(address))) return null;
    const subject = "Your Munetios sign-in email";
    const body = "Use one of these email addresses to sign in to Munetios:\n\n" + data.accounts.join("\n") + "\n\nIf you did not request this email, you can ignore it.";
    return { to: recipient, from: { email: sender, name: "Munetios" }, subject, text: body, html: mailHtml({ title: subject, body }) };
  }
  if (pathname === "/verification" || pathname === "/password-reset") {
    const sender = normalize(env.MAIL_VERIFICATION_FROM);
    if (!valid(sender) || !internal(sender) || internal(recipient) || typeof data.code !== "string" || !/^\d{6}$/.test(data.code)) return null;
    const reset = pathname === "/password-reset";
    let link;
    if (reset) {
      if (!/^[a-f0-9]{64}$/.test(data.token || "") || !env.MAIL_APP_ORIGIN) return null;
      const url = new URL("/signin/", env.MAIL_APP_ORIGIN);
      if (url.protocol !== "https:") return null;
      url.hash = new URLSearchParams({ reset: data.token, email: recipient }).toString();
      link = url.href;
    }
    const subject = reset ? "Reset your Munetios password" : "Your Munetios verification code";
    const instructions = "This code expires in 10 minutes. If you did not request it, you can ignore this message.";
    return {
      to: recipient,
      from: { email: sender, name: "Munetios" },
      subject,
      text: subject + ": " + data.code + ". " + instructions + (link ? "\n\n" + link : ""),
      html: mailHtml({ title: subject, body: instructions, code: data.code, link, linkLabel: "Reset password" }),
    };
  }
  const sender = normalize(data?.sender);
  if (!valid(sender) || !internal(sender) || typeof data?.subject !== "string" ||
    /[\r\n\0]/.test(data.subject) || [...data.subject].length > 500 ||
    typeof data?.body !== "string" || !data.body.trim() || bytes.encode(data.body).length > MAX_BODY) return null;
  return { to: recipient, from: sender, subject: data.subject, text: data.body,
    html: mailHtml({ title: data.subject || "Munetios Mail", body: data.body }) };
}

// Queue jobs from the Mail API, inbound processing, and cron. Transient failures retry with exponential backoff.
export async function runJob(body, env) {
  switch (body?.type) {
    case "send": return processSend(env, body.outboundId);
    case "forward": await processForward(env, body); return {};
    case "export": {
      const result = await processExport(env, body.exportId);
      if (result.continue) await env.MAIL_JOBS.send({ type: "export", exportId: body.exportId });
      return {};
    }
    case "blob-deletions": await processBlobDeletions(env, 500); return {};
    case "delete-mailbox": return deleteMailboxJob(env, body.mailboxId);
    default: return {};
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/health" && request.method === "GET") return Response.json({ ok: true });
    if (pathname === API_PREFIX || pathname.startsWith(API_PREFIX + "/")) {
      if (!env.MAIL_DB || !env.MAIL_STORE) return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
      return handleApi(request, env, ctx);
    }
    if (request.method !== "POST" || !["/send", "/verification", "/password-reset", "/forgot-email"].includes(pathname)) return new Response(null, { status: 404 });
    if (!await authorized(request, env.MAIL_BRIDGE_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (Number(request.headers.get("Content-Length")) > 2 * 1024 * 1024) return Response.json({ error: "tooLarge" }, { status: 413 });
    const data = await request.json().catch(() => null);
    const outgoing = messageFor(pathname, data, env);
    if (!outgoing) return Response.json({ error: "invalidRequest" }, { status: 400 });
    try {
      const result = await env.EMAIL.send(outgoing);
      return Response.json({ ok: true, id: result?.messageId || result?.id || null });
    } catch {
      return Response.json({ error: "deliveryUnavailable" }, { status: 502 });
    }
  },

  async email(message, env, ctx) {
    if (env.MAIL_DB && env.MAIL_STORE) {
      // Munetios Mail storage: parse, check quota and rules, and store; otherwise reject with an SMTP error.
      await deliverInbound(env, {
        from: message.from, to: message.to, rawSize: message.rawSize,
        raw: async () => new Uint8Array(await new Response(message.raw).arrayBuffer()),
        reject: reason => message.setReject(reason),
      }, ctx);
      return;
    }
    const recipient = normalize(message.to);
    const sender = normalize(message.from);
    if (!valid(recipient) || !internal(recipient) || !valid(sender) || message.rawSize > 5 * 1024 * 1024) {
      message.setReject("This mailbox cannot accept the message.");
      return;
    }
    if (!env.MAIL_APP_ORIGIN || !env.MAIL_BRIDGE_SECRET) throw new Error("Mail inbound bridge unavailable");
    const endpoint = new URL("/api/mail/inbound", env.MAIL_APP_ORIGIN);
    if (endpoint.protocol !== "https:") throw new Error("Mail inbound origin must use HTTPS");
    const raw = await new Response(message.raw).arrayBuffer();
    const mail = await PostalMime.parse(raw);
    const key = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)), b => b.toString(16).padStart(2, "0")).join("");
    const subject = [...(mail.subject || "").replace(/[\r\n\0]/g, " ")].slice(0, 500).join("");
    const body = new TextDecoder().decode(bytes.encode(mail.text || "").subarray(0, MAX_BODY - 4));
    const html = typeof mail.html === "string" && bytes.encode(mail.html).length <= MAX_BODY ? mail.html : "";
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: { Authorization: "Bearer " + env.MAIL_BRIDGE_SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient, sender, subject, body, key, ...(html ? { html } : {}) }),
    });
    if (response.status === 404) message.setReject("Mailbox unavailable.");
    else if (!response.ok) throw new Error("Mail delivery to the inbox failed");
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const body = message.body;
        // Cloudflare Email Sending events (delivered, bounced, ...) arrive on the events queue.
        if (typeof body?.type === "string" && body.type.startsWith("cf.email.sending.")) {
          await processDeliveryEvent(env, body);
          message.ack();
          continue;
        }
        const result = await runJob(body, env);
        if (result?.retryDelaySeconds) message.retry({ delaySeconds: Math.min(43200, result.retryDelaySeconds) });
        else message.ack();
      } catch (error) {
        await opsLog(env.MAIL_DB, "queue", error?.name || "error");
        message.retry({ delaySeconds: Math.min(3600, 15 * 2 ** Math.min(8, message.attempts || 1)) });
      }
    }
  },

  async scheduled(controller, env, ctx) {
    if (!env.MAIL_DB || !env.MAIL_STORE) return;
    ctx.waitUntil(controller.cron === "17 * * * *" ? hourly(env) : everyMinute(env));
  },
};
