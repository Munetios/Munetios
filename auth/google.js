'use strict';

const { createHash, createHmac, createPublicKey, randomBytes, verify } = require('node:crypto');
const { normalizeEmail, validEmail, isInternalEmail, secureEqual } = require('./mail');
const { sharedDomain, sharedOrigins, requestOrigin, usesSharedSession } = require('./public-hosts');
const authEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const keysEndpoint = 'https://www.googleapis.com/oauth2/v3/certs';
const profileEndpoint = 'https://openidconnect.googleapis.com/v1/userinfo';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = value => JSON.parse(Buffer.from(value, 'base64url').toString());
const random = () => randomBytes(32).toString('base64url');
const cookie = 'munetios_google_state';
const sharedCookie = '__Secure-munetios-shared-google-state';
const cookieAge = 600000;
const failLocation = '/signin/?google=failed';

function configuration(env) {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    try {
        const redirect = new URL(env.GOOGLE_CLIENT_URL || '/api/auth/google/callback', env.PUBLIC_ORIGIN);
        if (!(redirect.protocol === 'https:' || (redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname))) ||
            redirect.pathname !== '/api/auth/google/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) return null;
        return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET, redirect };
    } catch { return null; }
}

function returnPath(value) {
    return typeof value === 'string' && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : '/';
}

function sharedReturnPath(value, origin) {
    const path = returnPath(value);
    if (path === value && origin !== 'https://accounts.munetios.com') return origin + path;
    if (typeof value === 'string' && /^https:\/\/write\.munetios\.com(?:\/|$)/.test(value) && !/[\s\\]/.test(value)) return value;
    return 'https://write.munetios.com' + path;
}

async function json(url, options) {
    const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('googleRequestFailed');
    return response.json();
}

async function profile(config, state, code) {
    const tokens = await json(tokenEndpoint, { method: 'POST', body: new URLSearchParams({
        code, client_id: config.id, client_secret: config.secret, redirect_uri: config.redirect.href,
        code_verifier: state.verifier, grant_type: 'authorization_code',
    }) });
    const parts = typeof tokens.id_token === 'string' ? tokens.id_token.split('.') : [];
    if (parts.length !== 3) throw new Error('invalidGoogleToken');
    const [header, claims] = parts.slice(0, 2).map(decode);
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
        claims.aud !== config.id || (claims.azp && claims.azp !== config.id) || !Number.isFinite(claims.exp) || claims.exp <= now ||
        claims.nonce !== state.nonce || claims.email_verified !== true || typeof claims.sub !== 'string' || !/^[\w-]{1,255}$/.test(claims.sub)) throw new Error('invalidGoogleToken');
    const { keys } = await json(keysEndpoint);
    const key = keys.find(item => item.kid === header.kid && item.kty === 'RSA');
    if (!key || !verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('invalidGoogleSignature');
    const email = normalizeEmail(claims.email);
    if (!validEmail(email) || isInternalEmail(email) || (!email.endsWith('@gmail.com') && !claims.hd)) throw new Error('unsupportedGoogleEmail');
    let extra;
    if ((!claims.name || !claims.picture) && typeof tokens.access_token === 'string') {
        try {
            const details = await json(profileEndpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
            if (details.sub === claims.sub) extra = details;
        } catch {}
    }
    const name = [...String(claims.name || extra?.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 80).join('');
    return { email, subject: claims.sub, name, picture: claims.picture || extra?.picture };
}

async function avatar(source) {
    try {
        const url = new URL(source);
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com') || url.port || url.username || url.password) return null;
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        const type = response.headers.get('content-type');
        if (!response.ok || !/^image\/(?:jpeg|png|webp|gif)$/.test(type || '') || !response.body) return null;
        const reader = response.body.getReader();
        let size = 0;
        const parts = [];
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 384 * 1024) { await reader.cancel(); return null; }
            parts.push(value);
        }
        return size ? `data:${type};base64,${Buffer.concat(parts).toString('base64')}` : null;
    } catch { return null; }
}

function googleAuth({ router, env, db, small, fail, requireSession, reauthenticate, readCookie, startSession, writeCookies }) {
    const config = configuration(env);
    const shared = env.GOOGLE_SHARED_CLIENT_URL ? configuration({ ...env, GOOGLE_CLIENT_URL: env.GOOGLE_SHARED_CLIENT_URL }) : config;
    const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config?.redirect.protocol === 'https:', path: '/api/auth/google' };
    const sharedOptions = { ...cookieOptions, secure: true, domain: sharedDomain };
    const sign = value => createHmac('sha256', config.secret).update('google-state:' + value).digest('base64url');
    router.get('/google/config', (req, res) => res.json({ enabled: Boolean(config) }));
    router.get('/google/start', (req, res, next) => req.query.unlock === '1' ? requireSession(req, res, next) : next(), (req, res) => {
        const share = usesSharedSession(req, env);
        const oauth = share ? shared : config;
        if (!oauth || req.query.link !== undefined) return res.redirect(failLocation);
        const unlockAccountId = req.query.unlock === '1' ? String(req.session.account.id) : null;
        const origin = share ? requestOrigin(req) : null;
        const state = { id: random(), verifier: random(), nonce: random(), expires: Date.now() + cookieAge,
            continueTo: share ? sharedReturnPath(req.query.continue, origin) : returnPath(req.query.continue),
            add: !unlockAccountId && req.query.add === '1', unlockAccountId, share, origin };
        const value = encode(state);
        res.cookie(share ? sharedCookie : cookie, `${value}.${sign(value)}`, { ...(share ? sharedOptions : cookieOptions), maxAge: cookieAge });
        const url = new URL(authEndpoint);
        url.search = new URLSearchParams({ client_id: oauth.id, redirect_uri: oauth.redirect.href, response_type: 'code',
            scope: 'openid email profile', prompt: 'select_account', state: state.id, nonce: state.nonce,
            code_challenge: createHash('sha256').update(state.verifier).digest('base64url'), code_challenge_method: 'S256' });
        res.redirect(url.href);
    });

    router.get('/google/callback', async (req, res) => {
        if (!config) return res.redirect(failLocation);
        res.set('Referrer-Policy', 'no-referrer');
        try {
            const state = [cookie, sharedCookie].map(name => {
                const [value, signature] = (readCookie(req, name) || '').split('.');
                if (!value || !secureEqual(signature, sign(value))) return null;
                const candidate = decode(value);
                return Boolean(candidate.share) === (name === sharedCookie) && secureEqual(req.query.state, candidate.id) ? candidate : null;
            }).find(Boolean);
            if (!state || state.linking || Date.now() >= state.expires || typeof req.query.code !== 'string') return res.redirect(failLocation);
            const oauth = state.share ? shared : config;
            if (!oauth || (state.share && (env.AUTH_SHARE_MUNETIOS_SESSION !== 'true' || !sharedOrigins.has(state.origin) ||
                requestOrigin(req) !== oauth.redirect.origin))) return res.redirect(failLocation);
            res.clearCookie(state.share ? sharedCookie : cookie, state.share ? sharedOptions : cookieOptions);
            const identity = await profile(oauth, state, req.query.code);
            const connection = await db();
            const [[linked]] = await connection.execute('SELECT account_id FROM munetios_google_identities WHERE subject = ?', [identity.subject]);
            if (state.unlockAccountId && String(linked?.account_id) !== state.unlockAccountId) return res.redirect(failLocation);
            let accountId = linked?.account_id;
            if (!linked) {
                const [[existing]] = await connection.execute('SELECT id FROM munetios_accounts WHERE email = ?', [identity.email]);
                if (existing) return res.redirect(failLocation);
                const picture = await avatar(identity.picture);
                const lookup = '(SELECT id FROM munetios_accounts WHERE email = ?)';
                const writes = [
                    ['INSERT INTO munetios_accounts (email, password_hash) VALUES (?, ?)', [identity.email, 'google-only']],
                    [`INSERT INTO munetios_google_identities (account_id, subject) VALUES (${lookup}, ?)`, [identity.email, identity.subject]],
                    [`INSERT INTO munetios_profiles (account_id, display_name) VALUES (${lookup}, ?)`, [identity.email, identity.name]],
                ];
                if (picture) writes.push([`INSERT INTO munetios_profile_pictures (account_id, picture) VALUES (${lookup}, ?)`, [identity.email, picture]]);
                if (connection.atomic) await connection.atomic(writes);
                else {
                    const transaction = await connection.getConnection();
                    try {
                        await transaction.beginTransaction();
                        for (const statement of writes) await transaction.execute(...statement);
                        await transaction.commit();
                    } catch (error) { await transaction.rollback(); throw error; }
                    finally { transaction.release(); }
                }
                const [[created]] = await connection.execute('SELECT account_id FROM munetios_google_identities WHERE subject = ?', [identity.subject]);
                accountId = created.account_id;
            }
            const [[security]] = await connection.execute('SELECT totp_enabled FROM munetios_account_security WHERE account_id = ?', [accountId]);
            if (security?.totp_enabled) return res.redirect(failLocation);
            const session = await startSession(connection, req, accountId, state.add, Boolean(state.share));
            writeCookies(res, session.token, session.others, Boolean(state.share));
            res.cookie(state.share ? 'munetios-shared-google-sync' : 'munetios-google-sync', String(accountId), {
                sameSite: 'lax', secure: cookieOptions.secure, path: '/', maxAge: cookieAge,
                ...(state.share ? { domain: sharedDomain } : {})
            });
            res.redirect(state.share ? state.continueTo : returnPath(state.continueTo));
        } catch { res.redirect(failLocation); }
    });

    router.get('/google/connection', requireSession, async (req, res) => {
        const { account, connection } = req.session;
        const [[row]] = await connection.execute('SELECT g.subject, a.password_hash FROM munetios_accounts a LEFT JOIN munetios_google_identities g ON g.account_id = a.id WHERE a.id = ?', [account.id]);
        res.json({ enabled: Boolean(config), linked: Boolean(row?.subject), hasPassword: Boolean(row && row.password_hash !== 'google-only') });
    });
    router.post('/google/disconnect', small, requireSession, reauthenticate, async (req, res) => {
        const { account, connection } = req.session;
        const [removed] = await connection.execute("DELETE FROM munetios_google_identities WHERE account_id = ? AND EXISTS(SELECT 1 FROM munetios_accounts WHERE id = ? AND password_hash <> 'google-only')", [account.id, account.id]);
        if (!removed.affectedRows) return fail(res, 409, 'invalidRequest');
        res.json({ ok: true });
    });
}

module.exports = { googleAuth };
