import { createHash } from "node:crypto";
import nodemailer from "nodemailer";

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const connectionTimeoutMs = 60_000;
const dnsTimeoutMs = 30_000;
const greetingTimeoutMs = 30_000;
const socketTimeoutMs = 120_000;
const transportVersion = "nodemailer-v4";
const transporterStore = globalThis.__munetiosNodemailerTransporter || {
  signature: "",
  transporter: null,
};

globalThis.__munetiosNodemailerTransporter = transporterStore;

function firstEnvironmentValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isAllowedMailHost(host) {
  const hostname = String(host || "")
    .trim()
    .toLowerCase();
  return (
    hostname === "munetios.com" ||
    hostname.endsWith(".munetios.com") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

function parseTransportUrl() {
  const value = firstEnvironmentValue("MUNETIOS_SMTP_URL", "EMAIL_SERVER");
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "smtp:" && url.protocol !== "smtps:") return null;
    return {
      host: url.hostname,
      password: decodeURIComponent(url.password),
      port: Number(url.port),
      secure: url.protocol === "smtps:",
      user: decodeURIComponent(url.username),
    };
  } catch {
    return null;
  }
}

function getConfiguration() {
  const transportUrl = parseTransportUrl();
  const host =
    firstEnvironmentValue(
      "MUNETIOS_SMTP_HOST",
      "SMTP_HOST",
      "EMAIL_SERVER_HOST",
    ) || transportUrl?.host;
  const user =
    firstEnvironmentValue(
      "MUNETIOS_SMTP_USER",
      "SMTP_USER",
      "EMAIL_SERVER_USER",
    ) || transportUrl?.user;
  const password =
    firstEnvironmentValue(
      "MUNETIOS_SMTP_PASSWORD",
      "SMTP_PASSWORD",
      "EMAIL_SERVER_PASSWORD",
    ) || transportUrl?.password;
  const from =
    firstEnvironmentValue("MUNETIOS_SMTP_FROM", "SMTP_FROM", "EMAIL_FROM") ||
    user;
  const configuredPort = Number(
    firstEnvironmentValue(
      "MUNETIOS_SMTP_PORT",
      "SMTP_PORT",
      "EMAIL_SERVER_PORT",
    ) || transportUrl?.port,
  );
  const secureValue = firstEnvironmentValue(
    "MUNETIOS_SMTP_SECURE",
    "SMTP_SECURE",
  );
  const secure = secureValue
    ? secureValue.toLowerCase() !== "false"
    : (transportUrl?.secure ?? configuredPort === 465);
  const startTlsValue = firstEnvironmentValue(
    "MUNETIOS_SMTP_STARTTLS",
    "SMTP_STARTTLS",
  );
  const startTls = !secure && startTlsValue.toLowerCase() !== "false";
  const port =
    Number.isInteger(configuredPort) && configuredPort > 0
      ? configuredPort
      : secure
        ? 465
        : 587;

  if (
    !isAllowedMailHost(host) ||
    !emailPattern.test(user || "") ||
    !emailPattern.test(from || "") ||
    !password ||
    (!secure && !startTls && host !== "localhost" && host !== "127.0.0.1")
  ) {
    return null;
  }

  return { from, host, password, port, secure, startTls, user };
}

function getTransporter(configuration) {
  const signature = createHash("sha256")
    .update(JSON.stringify({ configuration, transportVersion }))
    .digest("hex");
  if (
    transporterStore.signature === signature &&
    transporterStore.transporter
  ) {
    return transporterStore.transporter;
  }

  transporterStore.transporter?.close();
  transporterStore.signature = signature;
  transporterStore.transporter = nodemailer.createTransport({
    allowInternalNetworkInterfaces:
      configuration.host === "localhost" || configuration.host === "127.0.0.1",
    auth: {
      pass: configuration.password,
      user: configuration.user,
    },
    connectionTimeout: connectionTimeoutMs,
    dnsTimeout: dnsTimeoutMs,
    greetingTimeout: greetingTimeoutMs,
    host: configuration.host,
    ignoreTLS: !configuration.secure && !configuration.startTls,
    port: configuration.port,
    requireTLS: configuration.startTls,
    secure: configuration.secure,
    socketTimeout: socketTimeoutMs,
    tls:
      configuration.host === "localhost" || configuration.host === "127.0.0.1"
        ? undefined
        : { servername: configuration.host },
  });
  return transporterStore.transporter;
}

function resetTransporter() {
  transporterStore.transporter?.close();
  transporterStore.signature = "";
  transporterStore.transporter = null;
}

function getFailureReason(error) {
  const message = String(error?.message || "").toUpperCase();
  if (
    error?.code === "EDNS" ||
    error?.code === "ENOTFOUND" ||
    error?.errno === "ENOTFOUND" ||
    message.includes("ENOTFOUND")
  ) {
    return "email_host_not_found";
  }
  if (
    error?.code === "EAI_AGAIN" ||
    error?.errno === "EAI_AGAIN" ||
    message.includes("EAI_AGAIN")
  ) {
    return "email_dns_temporarily_unavailable";
  }
  if (
    error?.code === "ECONNREFUSED" ||
    error?.errno === "ECONNREFUSED" ||
    message.includes("ECONNREFUSED")
  ) {
    return "email_connection_refused";
  }
  if (
    error?.code === "ECONNRESET" ||
    error?.errno === "ECONNRESET" ||
    message.includes("ECONNRESET") ||
    message.includes("SOCKET HANG UP")
  ) {
    return "email_connection_reset";
  }
  if (message.includes("ENETUNREACH")) return "email_network_unreachable";
  if (message.includes("EHOSTUNREACH")) return "email_host_unreachable";
  if (message.includes("EPIPE")) return "email_connection_closed";
  if (
    message.includes("CERT_") ||
    message.includes("CERTIFICATE") ||
    message.includes("WRONG_VERSION_NUMBER")
  ) {
    return "email_tls_failed";
  }
  if (error?.code === "ESOCKET") return "email_socket_failed";
  if (error?.code === "EPROTOCOL") return "email_not_smtp_server";
  if (error?.code === "ECONFIG") return "email_transport_invalid";
  if (error?.code === "ENOAUTH") return "email_authentication_missing";
  if (error?.code === "EAUTH") return "email_authentication_failed";
  if (error?.code === "ETLS" || error?.code === "EREQUIRETLS") {
    return "email_tls_failed";
  }
  if (error?.code === "EENVELOPE") return "email_recipient_rejected";
  if (error?.code === "ETIMEDOUT") return "email_connection_timed_out";
  if (error?.code === "ECONNECTION") return "email_connection_failed";
  if (error?.code === "EMESSAGE" || error?.code === "ESTREAM") {
    return "email_message_failed";
  }
  return "email_delivery_failed";
}

function canRetryBeforeDelivery(error) {
  const connectionErrorCodes = new Set([
    "ECONNECTION",
    "ECONNREFUSED",
    "ECONNRESET",
    "EDNS",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ESOCKET",
    "ETIMEDOUT",
  ]);
  return (
    connectionErrorCodes.has(error?.code) &&
    (!error?.command || error.command === "CONN")
  );
}

export function isVerificationEmailConfigured() {
  return getConfiguration() !== null;
}

export async function sendVerificationEmail(recipient, code) {
  const configuration = getConfiguration();
  if (!configuration) return null;
  if (configuration.port === 3000) {
    return { delivered: false, reason: "email_http_port_not_smtp" };
  }
  if (!emailPattern.test(recipient || "") || !/^\d{6}$/.test(code || "")) {
    return { delivered: false, reason: "email_invalid_message" };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const transporter = getTransporter(configuration);
      const result = await transporter.sendMail({
        from: { address: configuration.from, name: "Munetios" },
        headers: { "Auto-Submitted": "auto-generated" },
        subject: "Your Munetios verification code",
        text: `${code} is your Munetios verification code.\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.`,
        to: recipient,
      });
      const accepted =
        Array.isArray(result.accepted) && result.accepted.length > 0;
      return {
        delivered: accepted,
        reason: accepted ? null : "email_recipient_rejected",
      };
    } catch (error) {
      if (attempt === 0 && canRetryBeforeDelivery(error)) {
        resetTransporter();
        continue;
      }
      return { delivered: false, reason: getFailureReason(error) };
    }
  }

  return { delivered: false, reason: "email_connection_failed" };
}

export async function sendAiInvitationEmail(
  recipient,
  inviteUrl,
  inviterName = "A friend",
) {
  const configuration = getConfiguration();
  if (!configuration) return null;
  let parsedInviteUrl;
  try {
    parsedInviteUrl = new URL(inviteUrl);
  } catch {
    return { delivered: false, reason: "email_invalid_message" };
  }
  if (
    !emailPattern.test(recipient || "") ||
    !(
      parsedInviteUrl.hostname === "munetios.com" ||
      parsedInviteUrl.hostname.endsWith(".munetios.com") ||
      parsedInviteUrl.hostname === "localhost" ||
      parsedInviteUrl.hostname === "127.0.0.1"
    )
  ) {
    return { delivered: false, reason: "email_invalid_message" };
  }

  try {
    const transporter = getTransporter(configuration);
    const result = await transporter.sendMail({
      from: { address: configuration.from, name: "Munetios" },
      headers: { "Auto-Submitted": "auto-generated" },
      subject: `${inviterName} invited you to try Munetios AI`,
      text: `${inviterName} invited you to try Munetios AI.\n\nCreate your account using this invitation:\n${parsedInviteUrl.href}\n\nAfter you join, you and your friend will each receive one AI usage reset.`,
      to: recipient,
    });
    const accepted =
      Array.isArray(result.accepted) && result.accepted.length > 0;
    return {
      delivered: accepted,
      reason: accepted ? null : "email_recipient_rejected",
    };
  } catch (error) {
    return { delivered: false, reason: getFailureReason(error) };
  }
}
