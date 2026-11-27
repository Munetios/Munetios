// Standards-compliant MIME generation (RFC 5322, 2045-2047, 2231) for exports and archived copies.
// Bcc is never written to generated messages.
const encoder = new TextEncoder();

export function base64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

const wrap = (value, width = 76) => value.replace(new RegExp(`(.{${width}})`, "g"), "$1\r\n").replace(/\r\n$/, "");
const ascii = value => /^[\x20-\x7e]*$/.test(value);

// Encoded-word for non-ASCII header text, split so each word stays under 75 characters.
export function encodeWord(value) {
    const text = String(value ?? "");
    if (ascii(text)) return text;
    const words = [];
    let chunk = "";
    for (const character of text) {
        if (encoder.encode(chunk + character).length > 45) { words.push(chunk); chunk = ""; }
        chunk += character;
    }
    if (chunk) words.push(chunk);
    return words.map(word => `=?UTF-8?B?${base64(encoder.encode(word))}?=`).join("\r\n ");
}

export function formatAddress({ email, name }) {
    if (!name) return email;
    const display = ascii(name) ? `"${name.replace(/["\\]/g, "\\$&")}"` : encodeWord(name);
    return `${display} <${email}>`;
}

const foldList = list => list.map(formatAddress).join(",\r\n ");

function paramFilename(name) {
    const clean = String(name || "attachment").replace(/[\r\n"\\]/g, "_");
    if (ascii(clean)) return `filename="${clean}"`;
    return `filename*=UTF-8''${encodeURIComponent(clean).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

const boundary = () => "=_munetios_" + crypto.randomUUID().replace(/-/g, "");

export function rfc2822Date(ms) {
    const date = new Date(ms);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = n => String(n).padStart(2, "0");
    return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

function textPart(type, content) {
    return `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(base64(encoder.encode(content)))}\r\n`;
}

function attachmentPart(attachment) {
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(attachment.mimeType || "") ? attachment.mimeType : "application/octet-stream";
    const lines = [
        `Content-Type: ${type}; name="${String(attachment.filename || "attachment").replace(/[\r\n"\\]/g, "_")}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: ${attachment.disposition === "inline" ? "inline" : "attachment"}; ${paramFilename(attachment.filename)}`,
    ];
    if (attachment.contentId) lines.push(`Content-ID: <${String(attachment.contentId).replace(/[<>\r\n]/g, "")}>`);
    return lines.join("\r\n") + "\r\n\r\n" + wrap(base64(attachment.content)) + "\r\n";
}

function multipart(type, parts) {
    const b = boundary();
    return `Content-Type: ${type}; boundary="${b}"\r\n\r\n` + parts.map(part => `--${b}\r\n${part}`).join("") + `--${b}--\r\n`;
}

export function buildMime(message) {
    const headers = [
        `From: ${formatAddress(message.from)}`,
        message.to?.length ? `To: ${foldList(message.to)}` : null,
        message.cc?.length ? `Cc: ${foldList(message.cc)}` : null,
        message.replyTo ? `Reply-To: ${message.replyTo}` : null,
        `Subject: ${encodeWord(message.subject || "")}`,
        `Date: ${rfc2822Date(message.date || Date.now())}`,
        `Message-ID: ${message.messageId || `<${crypto.randomUUID()}@munetios.com>`}`,
        message.inReplyTo ? `In-Reply-To: ${message.inReplyTo}` : null,
        message.references ? `References: ${message.references}` : null,
        message.priority === "high" ? "Importance: high\r\nX-Priority: 1" : message.priority === "low" ? "Importance: low\r\nX-Priority: 5" : null,
        "MIME-Version: 1.0",
    ].filter(Boolean);
    const text = message.text || "";
    const html = message.html || "";
    let body = html ? multipart("multipart/alternative", [textPart("text/plain", text), textPart("text/html", html)]) : textPart("text/plain", text);
    const attachments = message.attachments || [];
    const inline = attachments.filter(item => item.disposition === "inline" && item.contentId);
    const regular = attachments.filter(item => !(item.disposition === "inline" && item.contentId));
    if (inline.length) body = multipart("multipart/related", [body, ...inline.map(attachmentPart)]);
    if (regular.length) body = multipart("multipart/mixed", [body, ...regular.map(attachmentPart)]);
    return headers.join("\r\n") + "\r\n" + body;
}

// mbox (mboxrd) entry: "From " separator plus quoted From-lines.
export function mboxEntry(sender, date, raw) {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const quoted = text.replace(/\r\n/g, "\n").replace(/^(>*From )/gm, ">$1");
    return `From ${sender || "MAILER-DAEMON"} ${new Date(date).toUTCString().replace(/^\w+, /, "")}\n${quoted}${quoted.endsWith("\n") ? "" : "\n"}\n`;
}
