import express from 'express';
import { Buffer } from 'node:buffer';

const TTL = 900;
const allowedPushHost = host => host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
    host === 'web.push.apple.com' || host.endsWith('.web.push.apple.com') || host.endsWith('.notify.windows.com');
const publicKey = env => /^B[A-Za-z0-9_-]{86}$/.test(env.CALENDAR_PUSH_PUBLIC_KEY || '') && env.CALENDAR_PUSH_PRIVATE_JWK
    ? env.CALENDAR_PUSH_PUBLIC_KEY : null;

function validateEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.length > 4096) return null;
    try {
        const url = new URL(endpoint);
        if (url.protocol === 'https:' && !url.port && !url.username && !url.password &&
            !url.hash && allowedPushHost(url.hostname) && url.pathname !== '/') return url;
    } catch {}
    return null;
}

export function calendarReminderRouter({ env, requireBrowserSession }) {
    const router = express.Router();
    const db = env.ACCOUNTS_DB;
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    router.get('/key', requireBrowserSession, (req, res) => {
        const key = publicKey(env);
        if (!key) return res.status(503).json({ error: 'unavailable' });
        res.json({ key });
    });
    router.post('/schedule', requireBrowserSession, express.json({ limit: '512kb' }), async (req, res) => {
        const endpoint = validateEndpoint(req.body?.endpoint)?.href;
        const accountId = req.account.id;
        const times = req.body?.times;
        if (!endpoint || !Array.isArray(times) || times.some(due => !Number.isSafeInteger(due) || due <= 0)) {
            return res.status(400).json({ error: 'invalidRequest' });
        }
        if (!times.length && req.body.disable === true) {
            await db.prepare('DELETE FROM munetios_calendar_push_devices WHERE endpoint = ? AND account_id = ?')
                .bind(endpoint, accountId).run();
            return res.json({ ok: true });
        }
        if (!publicKey(env)) return res.status(503).json({ error: 'unavailable' });
        const future = [...new Set(times.filter(due => due > Date.now() - 60_000))];
        const insert = db.prepare('INSERT INTO munetios_calendar_push_devices (endpoint, account_id) VALUES (?, ?) ON CONFLICT(endpoint) DO NOTHING')
            .bind(endpoint, accountId);
        const owned = 'EXISTS (SELECT 1 FROM munetios_calendar_push_devices WHERE endpoint = ? AND account_id = ?)';
        const clear = db.prepare('DELETE FROM munetios_calendar_push_times WHERE endpoint = ? AND ' + owned)
            .bind(endpoint, endpoint, accountId);
        const schedule = db.prepare('INSERT INTO munetios_calendar_push_times (endpoint, due_at) SELECT ?, value FROM json_each(?) WHERE ' + owned)
            .bind(endpoint, JSON.stringify(future), endpoint, accountId);
        const owner = db.prepare('SELECT account_id FROM munetios_calendar_push_devices WHERE endpoint = ?').bind(endpoint);
        const results = await db.batch([insert, clear, schedule, owner]);
        if (String(results[3].results[0]?.account_id) !== String(accountId)) return res.status(409).json({ error: 'endpointInUse' });
        res.json({ ok: true });
    });
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error.status === 400 || error.status === 413) return res.status(error.status).json({ error: 'invalidRequest' });
        res.status(503).json({ error: 'unavailable' });
    });
    return router;
}

const segment = value => Buffer.from(JSON.stringify(value)).toString('base64url');

async function vapidAuthorization({ origin, now, key, publicKey, subject }) {
    const unsigned = segment({ typ: 'JWT', alg: 'ES256' }) + '.' +
        segment({ aud: origin, exp: Math.floor(now / 1000) + 3600, sub: subject });
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
    return `vapid t=${unsigned}.${Buffer.from(signature).toString('base64url')}, k=${publicKey}`;
}

export async function sendCalendarReminders(env, now = Date.now(), push = fetch) {
    const configured = publicKey(env);
    if (!configured) return;
    const db = env.ACCOUNTS_DB;
    const key = await crypto.subtle.importKey('jwk', JSON.parse(env.CALENDAR_PUSH_PRIVATE_JWK),
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const cutoff = now - TTL * 1000;
    await db.prepare('DELETE FROM munetios_calendar_push_times WHERE due_at < ?').bind(cutoff).run();
    const { results } = await db.prepare(
        'SELECT endpoint, MAX(due_at) AS due FROM munetios_calendar_push_times WHERE due_at <= ? ' +
        'GROUP BY endpoint ORDER BY MIN(due_at) LIMIT 40'
    ).bind(now).all();
    const authorizations = new Map();
    for (let index = 0; index < results.length; index += 5) {
        await Promise.all(results.slice(index, index + 5).map(async ({ endpoint, due }) => {
            const url = validateEndpoint(endpoint);
            if (!url) return;
            if (!authorizations.has(url.origin)) authorizations.set(url.origin, vapidAuthorization({
                origin: url.origin, now, key, publicKey: configured, subject: env.PUBLIC_ORIGIN
            }));
            let response;
            try {
                response = await push(url, {
                    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
                    headers: { TTL: String(TTL), Authorization: await authorizations.get(url.origin) }
                });
            } catch { return; }
            await response.body?.cancel().catch(() => {});
            if (response.ok) {
                await db.prepare('DELETE FROM munetios_calendar_push_times WHERE endpoint = ? AND due_at <= ?')
                    .bind(endpoint, due).run();
            } else if (response.status === 404 || response.status === 410) {
                await db.prepare('DELETE FROM munetios_calendar_push_devices WHERE endpoint = ?').bind(endpoint).run();
            }
        }));
    }
}
