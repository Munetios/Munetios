import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";

const defaultTimeoutMs = 12_000;
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function isAllowedSmtpHost(host) {
  const hostname = String(host || "")
    .trim()
    .toLowerCase();
  return (
    hostname === "smtp.resend.com" ||
    hostname === "munetios.com" ||
    hostname.endsWith(".munetios.com") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

function firstEnvironmentValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseEmailServerUrl() {
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

function smtpConfiguration() {
  const serverUrl = parseEmailServerUrl();
  const host =
    firstEnvironmentValue(
      "MUNETIOS_SMTP_HOST",
      "SMTP_HOST",
      "EMAIL_SERVER_HOST",
    ) || serverUrl?.host;
  const password =
    firstEnvironmentValue(
      "MUNETIOS_SMTP_PASSWORD",
      "SMTP_PASSWORD",
      "EMAIL_SERVER_PASSWORD",
    ) || serverUrl?.password;
  const user =
    firstEnvironmentValue(
      "MUNETIOS_SMTP_USER",
      "SMTP_USER",
      "EMAIL_SERVER_USER",
    ) || serverUrl?.user;
  const from =
    firstEnvironmentValue("MUNETIOS_SMTP_FROM", "SMTP_FROM", "EMAIL_FROM") ||
    user;
  const secureValue = firstEnvironmentValue(
    "MUNETIOS_SMTP_SECURE",
    "SMTP_SECURE",
  );
  const configuredPort = Number(
    firstEnvironmentValue(
      "MUNETIOS_SMTP_PORT",
      "SMTP_PORT",
      "EMAIL_SERVER_PORT",
    ) || serverUrl?.port,
  );
  const secure = secureValue
    ? secureValue.toLowerCase() !== "false"
    : (serverUrl?.secure ?? configuredPort === 465);
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
    !isAllowedSmtpHost(host) ||
    !(
      emailPattern.test(user || "") ||
      (host === "smtp.resend.com" && user === "resend")
    ) ||
    !emailPattern.test(from || "") ||
    !password ||
    (!secure && !startTls && host !== "localhost" && host !== "127.0.0.1")
  ) {
    return null;
  }

  return { from, host, password, port, secure, startTls, user };
}

export function isVerificationEmailConfigured() {
  return smtpConfiguration() !== null;
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secureSocket = connectTls({ servername: host, socket });
    const onError = (error) => {
      secureSocket.destroy();
      reject(error);
    };
    secureSocket.once("error", onError);
    secureSocket.once("secureConnect", () => {
      secureSocket.off("error", onError);
      resolve(secureSocket);
    });
  });
}

function connectSocket(configuration) {
  return new Promise((resolve, reject) => {
    const options = {
      host: configuration.host,
      port: configuration.port,
    };
    const socket = configuration.secure
      ? connectTls({ ...options, servername: configuration.host })
      : connectTcp(options);
    const readyEvent = configuration.secure ? "secureConnect" : "connect";
    const onError = (error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(defaultTimeoutMs, () => {
      socket.destroy(new Error("SMTP connection timed out."));
    });
    socket.once("error", onError);
    socket.once(readyEvent, () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

function createResponseReader(socket) {
  let buffer = "";
  let currentResponse = [];
  let terminalError = null;
  const responses = [];
  const waiters = [];

  const settle = () => {
    while (responses.length && waiters.length) {
      waiters.shift().resolve(responses.shift());
    }
    if (terminalError) {
      while (waiters.length) waiters.shift().reject(terminalError);
    }
  };
  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    let lineEnd = buffer.indexOf("\r\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 2);
      currentResponse.push(line);
      if (/^\d{3} /.test(line)) {
        responses.push(currentResponse.join("\n"));
        currentResponse = [];
      }
      lineEnd = buffer.indexOf("\r\n");
    }
    settle();
  };
  const onError = (error) => {
    terminalError = error;
    settle();
  };
  const onClose = () => {
    if (!terminalError) terminalError = new Error("SMTP connection closed.");
    settle();
  };

  socket.on("data", onData);
  socket.on("error", onError);
  socket.on("close", onClose);

  return {
    dispose() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    },
    read() {
      if (responses.length) return Promise.resolve(responses.shift());
      if (terminalError) return Promise.reject(terminalError);
      return new Promise((resolve, reject) =>
        waiters.push({ reject, resolve }),
      );
    },
  };
}

function responseCode(response) {
  const lines = String(response || "").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^\d{3} /.test(lines[index])) return Number(lines[index].slice(0, 3));
  }
  return 0;
}

async function expectResponse(reader, allowedCodes) {
  const response = await reader.read();
  const code = responseCode(response);
  if (!allowedCodes.includes(code)) {
    throw new Error(
      `SMTP rejected the request with status ${code || "unknown"}.`,
    );
  }
  return response;
}

async function sendCommand(socket, reader, command, allowedCodes) {
  socket.write(`${command}\r\n`);
  return expectResponse(reader, allowedCodes);
}

function getAuthenticationMethods(ehloResponse) {
  const methods = new Set();
  for (const line of String(ehloResponse || "").split("\n")) {
    const match = line.match(/^250[- ]AUTH\s+(.+)$/i);
    if (!match) continue;
    for (const method of match[1].trim().split(/\s+/)) {
      methods.add(method.toUpperCase());
    }
  }
  return methods;
}

async function authenticate(socket, reader, configuration, ehloResponse) {
  const methods = getAuthenticationMethods(ehloResponse);
  if (methods.has("PLAIN")) {
    await sendCommand(
      socket,
      reader,
      `AUTH PLAIN ${Buffer.from(`\0${configuration.user}\0${configuration.password}`).toString("base64")}`,
      [235],
    );
    return;
  }

  if (methods.has("LOGIN")) {
    await sendCommand(socket, reader, "AUTH LOGIN", [334]);
    await sendCommand(
      socket,
      reader,
      Buffer.from(configuration.user).toString("base64"),
      [334],
    );
    await sendCommand(
      socket,
      reader,
      Buffer.from(configuration.password).toString("base64"),
      [235],
    );
    return;
  }

  throw new Error("SMTP server does not advertise a supported login method.");
}

function buildMessage({ code, from, recipient }) {
  const messageId = `${crypto.randomUUID()}@munetios.com`;
  const lines = [
    `From: Munetios <${from}>`,
    `To: ${recipient}`,
    "Subject: Your Munetios verification code",
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "Auto-Submitted: auto-generated",
    "",
    `${code} is your Munetios verification code.`,
    "",
    "This code expires in 10 minutes. If you did not request it, you can ignore this email.",
  ];
  return lines
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function getFailureReason(stage, error) {
  if (stage === "connection") {
    if (error?.code === "ENOTFOUND" || error?.code === "EAI_AGAIN") {
      return "smtp_host_not_found";
    }
    if (error?.code === "ECONNREFUSED") return "smtp_connection_refused";
    if (error?.code === "ETIMEDOUT") return "smtp_connection_timed_out";
  }
  if (
    stage === "tls" &&
    typeof error?.code === "string" &&
    error.code.includes("CERT")
  ) {
    return "smtp_tls_certificate_failed";
  }
  return `smtp_${stage}_failed`;
}

export async function sendVerificationEmail(recipient, code) {
  const configuration = smtpConfiguration();
  if (!configuration) return null;
  if (!emailPattern.test(recipient || "") || !/^\d{6}$/.test(code || "")) {
    return { delivered: false, reason: "smtp_invalid_message" };
  }

  let socket;
  let reader;
  let failureStage = "connection";
  try {
    socket = await connectSocket(configuration);
    reader = createResponseReader(socket);
    failureStage = "greeting";
    await expectResponse(reader, [220]);
    failureStage = "handshake";
    let ehloResponse = await sendCommand(
      socket,
      reader,
      "EHLO app.munetios.com",
      [250],
    );
    if (configuration.startTls) {
      failureStage = "tls";
      await sendCommand(socket, reader, "STARTTLS", [220]);
      reader.dispose();
      socket = await upgradeToTls(socket, configuration.host);
      reader = createResponseReader(socket);
      ehloResponse = await sendCommand(
        socket,
        reader,
        "EHLO app.munetios.com",
        [250],
      );
    }
    failureStage = "authentication";
    await authenticate(socket, reader, configuration, ehloResponse);
    failureStage = "sender";
    await sendCommand(
      socket,
      reader,
      `MAIL FROM:<${configuration.from}>`,
      [250],
    );
    failureStage = "recipient";
    await sendCommand(socket, reader, `RCPT TO:<${recipient}>`, [250, 251]);
    failureStage = "message";
    await sendCommand(socket, reader, "DATA", [354]);
    socket.write(
      `${buildMessage({ code, from: configuration.from, recipient })}\r\n.\r\n`,
    );
    failureStage = "delivery";
    await expectResponse(reader, [250]);
    try {
      await sendCommand(socket, reader, "QUIT", [221]);
    } catch {
      // The server already accepted the message; QUIT failure does not undo it.
    }
    return { delivered: true, reason: null };
  } catch (error) {
    return {
      delivered: false,
      reason: getFailureReason(failureStage, error),
    };
  } finally {
    reader?.dispose();
    socket?.destroy();
  }
}
