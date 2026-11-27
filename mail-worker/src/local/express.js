// Mounts the Munetios Mail API in the local Express server with local D1/R2/Queue adapters.
// Sessions come from the existing auth router; legacy mailbox data comes from its database.
// Outgoing mail needs the Cloudflare Email Service binding, so local sends report that delivery is unavailable.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lookup } from "node:dns/promises";
import { LocalD1, LocalR2, LocalQueue } from "./adapters.js";
import { handleApi } from "../api.js";
import { runJob } from "../../worker.js";
import { processDeliveryEvent } from "../outbound.js";
import { everyMinute, hourly } from "../maintenance.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

function legacyAdapter(auth) {
    const query = async (sql, params) => {
        try { const [rows] = await (await auth.database()).execute(sql, params); return rows; }
        catch { return []; }
    };
    return {
        async hasMailbox(accountId) { return (await query("SELECT 1 AS x FROM munetios_mailboxes WHERE account_id = ?", [accountId])).length > 0; },
        async aliasFor(accountId) { return (await query("SELECT address FROM munetios_mail_aliases WHERE account_id = ?", [accountId]))[0]?.address || null; },
        async messages(accountId, afterId, limit) {
            return query("SELECT m.id, m.direction, m.message_key, m.sender, m.recipient, m.subject, m.body, m.created_at, h.html FROM munetios_mail_messages m " +
                "LEFT JOIN munetios_mail_html h ON h.message_id = m.id WHERE m.account_id = ? AND m.id > ? ORDER BY m.id LIMIT " + Math.max(1, Math.min(500, Number(limit) || 100)), [accountId, Number(afterId) || 0]);
        },
        async addressTaken(address) {
            const rows = await query("SELECT 1 AS x FROM munetios_accounts WHERE email = ? UNION SELECT 1 FROM munetios_mail_aliases WHERE address = ?", [address, address]);
            return rows.length > 0;
        },
        async accountForAddress(address) {
            const rows = await query("SELECT a.id, a.email, p.display_name FROM munetios_accounts a JOIN munetios_mailboxes m ON m.account_id = a.id LEFT JOIN munetios_profiles p ON p.account_id = a.id WHERE a.email = ?", [address]);
            return rows[0] ? { id: String(rows[0].id), email: rows[0].email, displayName: rows[0].display_name || "" } : null;
        },
    };
}

export function createLocalMail({ auth, env = process.env, dataDir = join(root, ".local-mail") } = {}) {
    const db = new LocalD1(join(dataDir, "mail.sqlite"));
    db.migrate(join(root, "migrations", "0001_mail.sql"));
    const queue = new LocalQueue();
    const base = {
        MAIL_DB: db, MAIL_STORE: new LocalR2(join(dataDir, "r2")), MAIL_JOBS: queue,
        LEGACY: legacyAdapter(auth), LOOKUP: host => lookup(host, { all: true }),
        MAIL_QUOTA_BYTES: env.MAIL_QUOTA_BYTES, MAIL_SENDS_PER_HOUR: env.MAIL_SENDS_PER_HOUR, MAIL_RECIPIENTS_PER_DAY: env.MAIL_RECIPIENTS_PER_DAY, MAIL_UPLOADS_PER_HOUR: env.MAIL_UPLOADS_PER_HOUR, MUNETIOS_RESERVED_MAILBOXES: env.MUNETIOS_RESERVED_MAILBOXES,
        MAIL_VERIFICATION_FROM: env.MAIL_VERIFICATION_FROM || "verify@munetios.com", MAIL_DOMAIN: "munetios.com", MAIL_ALLOWED_ORIGINS: env.PUBLIC_ORIGIN || "",
    };
    queue.handler = async batch => {
        for (const message of batch.messages) {
            if (String(message.body?.type || "").startsWith("cf.email.sending.")) { await processDeliveryEvent(base, message.body); continue; }
            const result = await runJob(message.body, base);
            if (result?.retryDelaySeconds) message.retry({ delaySeconds: result.retryDelaySeconds });
        }
    };
    const minute = setInterval(() => everyMinute(base).catch(() => {}), 60_000);
    const hour = setInterval(() => hourly(base).catch(() => {}), 3_600_000);
    minute.unref?.(); hour.unref?.();

    async function handler(req, res, next) {
        try {
            const session = await auth.sessionAccounts(req, res);
            const env = { ...base, resolveSession: async () => session };
            const origin = `${req.protocol}://${req.get("host")}`;
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
            const hasBody = !["GET", "HEAD"].includes(req.method);
            const request = new Request(origin + req.originalUrl, { method: req.method, headers, body: hasBody ? req : undefined, duplex: hasBody ? "half" : undefined });
            const response = await handleApi(request, env, { waitUntil: promise => promise?.catch?.(() => {}) });
            res.status(response.status);
            response.headers.forEach((value, key) => res.setHeader(key, value));
            if (!response.body) return res.end();
            const reader = response.body.getReader();
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
            res.end();
        } catch (error) { next(error); }
    }
    handler.env = base;
    handler.close = () => { clearInterval(minute); clearInterval(hour); queue.close(); };
    return handler;
}
