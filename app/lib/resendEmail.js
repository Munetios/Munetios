import { Resend } from "resend";
import { createEmailVerificationToken } from "./emailVerificationToken.js";

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;

function configuration() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(
    process.env.MUNETIOS_EMAIL_FROM || "Munetios <noreply@beta.munetios.com>",
  ).trim();
  const publicUrl = String(
    process.env.MUNETIOS_PUBLIC_URL || "https://beta.munetios.com",
  ).replace(/\/$/u, "");
  return apiKey && from ? { apiKey, from, publicUrl } : null;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailLayout({
  actionHref,
  actionLabel,
  body,
  code,
  preheader,
  title,
}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://api.munetios.com/beautiful-css/beautiful.css">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#12051f;color:#fff;font-family:'Google Sans Flex','Google Sans',Arial,sans-serif;font-feature-settings:'ss01' 1;padding:24px">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>
<main style="max-width:620px;margin:0 auto">
<section class="liquid-glass" style="background:rgba(49,16,76,.88);border:1px solid rgba(255,255,255,.16);border-radius:24px;padding:32px;box-shadow:0 24px 70px rgba(0,0,0,.32)">
<div style="font-size:18px;font-weight:750;color:#e9d5ff">Munetios</div>
<h1 style="font-size:28px;line-height:1.2;margin:24px 0 12px">${escapeHtml(title)}</h1>
<p style="font-size:16px;line-height:1.65;color:#e9ddf3;margin:0 0 22px">${escapeHtml(body)}</p>
${code ? `<div class="liquid-glass" style="background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:18px;padding:18px;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px">${escapeHtml(code)}</div>` : ""}
${actionHref ? `<a href="${escapeHtml(actionHref)}" style="display:block;margin-top:22px;background:#7e22ce;border-radius:14px;color:#fff;text-align:center;text-decoration:none;font-weight:750;padding:14px 18px">${escapeHtml(actionLabel)}</a>` : ""}
<p style="font-size:13px;line-height:1.55;color:#b9a8c7;margin:24px 0 0">This message was sent by Munetios Beta. If you did not request it, you can ignore this email.</p>
</section></main></body></html>`;
}

async function send({ html, subject, text, to }) {
  const config = configuration();
  if (!config) return { delivered: false, reason: "email_not_configured" };
  if (!emailPattern.test(to || "")) {
    return { delivered: false, reason: "email_invalid_message" };
  }
  try {
    const { data, error } = await new Resend(config.apiKey).emails.send({
      from: config.from,
      headers: { "Auto-Submitted": "auto-generated" },
      html,
      subject,
      text,
      to: [to],
    });
    return {
      delivered: Boolean(data?.id) && !error,
      id: data?.id || null,
      reason: error ? "email_delivery_failed" : null,
    };
  } catch {
    return { delivered: false, reason: "email_delivery_failed" };
  }
}

export function isResendEmailConfigured() {
  return configuration() !== null;
}

export async function sendResendVerificationEmail(recipient, verification) {
  const config = configuration();
  if (!config) return { delivered: false, reason: "email_not_configured" };
  const token = createEmailVerificationToken({
    ...verification,
    identifier: recipient,
  });
  const verifyUrl = token
    ? `${config.publicUrl}/verify?token=${encodeURIComponent(token)}`
    : "";
  return send({
    html: emailLayout({
      actionHref: verifyUrl,
      actionLabel: "Verify email",
      body: "Use this code or the secure button to verify your email address. It expires in 10 minutes.",
      code: verification.code,
      preheader: `${verification.code} is your Munetios verification code.`,
      title: "Verify your email",
    }),
    subject: "Verify your Munetios email",
    text: `${verification.code} is your Munetios verification code. It expires in 10 minutes.${verifyUrl ? `\n\nVerify your email: ${verifyUrl}` : ""}`,
    to: recipient,
  });
}

export async function sendResendRecoveryEmail(recipient, recovery) {
  return send({
    html: emailLayout({
      actionHref: "",
      actionLabel: "",
      body:
        recovery.type === "email"
          ? "Use this code to recover your Munetios email address. It expires in 10 minutes."
          : "Use this code to reset your Munetios password. It expires in 10 minutes.",
      code: recovery.code,
      preheader: `${recovery.code} is your Munetios recovery code.`,
      title:
        recovery.type === "email"
          ? "Recover your email"
          : "Reset your password",
    }),
    subject:
      recovery.type === "email"
        ? "Recover your Munetios email"
        : "Reset your Munetios password",
    text: `${recovery.code} is your Munetios recovery code. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
    to: recipient,
  });
}
