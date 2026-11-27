'use strict';
/*
 * Per-session request limits for updating and syncing.
 *
 * Default: 200 requests per 10 minutes per session, shared by every route that uses
 * the same limiter (account sync and shared calendar and album updates).
 * Set SYNC_RATE_LIMIT and SYNC_RATE_WINDOW_MS to change it.
 *
 * Counts are kept in memory. On Cloudflare Workers each isolate keeps its own counts,
 * so the limit there is per isolate rather than exact.
 */

const DEFAULT_LIMIT = 200;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

function createRateLimit({ limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS, keyFor, now = () => Date.now() } = {}) {
    if (typeof keyFor !== 'function') throw new Error('keyFor is required');
    const windows = new Map(); // key -> { count, resetAt }
    let lastSweep = 0;

    function sweep(time) {
        if (time - lastSweep < 60000) return;
        lastSweep = time;
        for (const [key, value] of windows) if (value.resetAt <= time) windows.delete(key);
    }

    // Records one request. Returns { allowed, remaining, resetAt }.
    function take(key) {
        const time = now();
        sweep(time);
        let entry = windows.get(key);
        if (!entry || entry.resetAt <= time) {
            entry = { count: 0, resetAt: time + windowMs };
            windows.set(key, entry);
        }
        if (entry.count >= limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
        entry.count++;
        return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
    }

    function middleware(req, res, next) {
        let key;
        try { key = keyFor(req); } catch { key = null; }
        // Requests without a session are rejected by the route itself (signedOut).
        if (!key) return next();
        const result = take(key);
        const resetSeconds = Math.max(1, Math.ceil((result.resetAt - now()) / 1000));
        res.set({ 'RateLimit-Limit': String(limit), 'RateLimit-Remaining': String(result.remaining), 'RateLimit-Reset': String(resetSeconds) });
        if (!result.allowed) {
            res.set({ 'Retry-After': String(resetSeconds), 'Cache-Control': 'no-store' });
            return res.status(429).json({ error: 'rateLimited', retryAfter: resetSeconds });
        }
        next();
    }
    middleware.take = take;
    middleware.limit = limit;
    middleware.windowMs = windowMs;
    return middleware;
}

function syncRateLimitFromEnv(env, keyFor) {
    const limit = Number(env.SYNC_RATE_LIMIT) > 0 ? Math.floor(Number(env.SYNC_RATE_LIMIT)) : DEFAULT_LIMIT;
    const windowMs = Number(env.SYNC_RATE_WINDOW_MS) > 0 ? Math.floor(Number(env.SYNC_RATE_WINDOW_MS)) : DEFAULT_WINDOW_MS;
    return createRateLimit({ limit, windowMs, keyFor });
}

module.exports = { createRateLimit, syncRateLimitFromEnv, DEFAULT_LIMIT, DEFAULT_WINDOW_MS };
