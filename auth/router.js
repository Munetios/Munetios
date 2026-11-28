'use strict';
const express = require('express');
const mysql = require('mysql2/promise');
const qrcode = require('qrcode-generator');
const { randomBytes, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { securityVault, verifyCode } = require('./security');
const { passwordReset } = require('./password-reset');
const { googleAuth } = require('./google');
const { emailSettings } = require('./email-settings');
const { sharedDomain, usesSharedSession, expectedBrowserOrigin } = require('./public-hosts');
const { syncRateLimitFromEnv } = require('./rate-limit');
const { normalizeEmail, validEmail, isInternalEmail, secureEqual, reservedPersonalMailboxes, isReservedMailbox, createMailTransport, createEmailVerification } = require('./mail');
const SYNC_QUOTA = 50_000_000_000;
const SYNC_DB_PART_BYTES = 256 * 1024;
const derive = promisify(scrypt);
const COOKIE = 'munetios_session';
const OTHERS_COOKIE = 'munetios_others'; // other signed-in accounts on this browser
// Holds no secret: it only records that this browser has signed in, so an expired or revoked session opens the app
// with the "You've been signed out" dialog (and offline data) instead of redirecting. Signing out clears it.
const SEEN_COOKIE = 'munetios_seen';
const SEEN_MS = 400 * 24 * 60 * 60 * 1000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HEX64 = /^[a-f0-9]{64}$/;
const ITEM_KEY = /^[A-Za-z0-9:._-]{1,191}$/;

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const key = await derive(password, salt, 64, SCRYPT_OPTIONS);
    return `scrypt$${salt}$${key.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
    const [algorithm, salt, digest] = String(encoded).split('$');
    if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(digest || '')) return false;
    const key = await derive(password, salt, 64, SCRYPT_OPTIONS);
    return timingSafeEqual(key, Buffer.from(digest, 'hex'));
}
const tokenHash = token => createHash('sha256').update(token).digest('hex');
function readCookie(req, name) {
    return (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
// Coarse "Browser|OS" label for the signed-in devices list. Nothing else from the User-Agent is kept.
function deviceLabel(ua = '') {
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    return `${browser}|${os}`;
}
function validKeys(keys) {
    if (!keys || typeof keys !== 'object') return null;
    const { salt, iv, wrapped } = keys;
    if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{24}$/.test(iv || '') || !/^[A-Za-z0-9+/]{40,124}={0,2}$/.test(wrapped || '')) return null;
    return { salt, iv, wrapped };
}
const keysOf = row => row && row.kdf_salt ? { salt: row.kdf_salt, iv: row.wrap_iv, wrapped: row.wrapped_key } : null;

function createAuthRouter({ env = process.env, database, syncObjects, onBrowserSessionChange, mailTransport = createMailTransport(env), emailVerification = createEmailVerification(env, mailTransport) } = {}) {
    const router = express.Router();
    const vault = securityVault(env);
    const reservedMailboxes = reservedPersonalMailboxes(env);
    const reserved = email => isReservedMailbox(email, reservedMailboxes);
    let pool = database;
    let schemaReady;
    let dummyHash;
    const attempts = new Map();
    const secure = env.NODE_ENV === 'production' || env.AUTH_COOKIE_SECURE === 'true';
    const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: SESSION_MS };
    const sharedCookie = '__Secure-munetios-shared-session';
    const sharedOthers = '__Secure-munetios-shared-others';
    // On shared hosts the host-only cookie from before sessions were shared still counts, until it is upgraded.
    function sessionToken(req, share = usesSharedSession(req, env)) {
        const value = readCookie(req, share ? sharedCookie : COOKIE) || (share ? readCookie(req, COOKIE) : null);
        return HEX64.test(value || '') ? value : null;
    }
    const hasLegacyCookies = req => Boolean(readCookie(req, COOKIE) || readCookie(req, OTHERS_COOKIE));
    // Updating and syncing share one per-session budget (default 400 requests per 10 minutes).
    const syncLimit = syncRateLimitFromEnv(env, req => { const token = sessionToken(req); return token ? tokenHash(token) : null; });
    function otherTokens(req, share = usesSharedSession(req, env)) {
        const raw = share ? [readCookie(req, sharedOthers), readCookie(req, OTHERS_COOKIE)] : [readCookie(req, OTHERS_COOKIE)];
        return [...new Set(raw.filter(Boolean).join('.').split('.').filter(token => HEX64.test(token)))];
    }
    const fail = (res, status, code) => res.status(status).json({ error: code });
    // Display names: no control characters, 1–80 characters after trimming.
    const cleanDisplayName = value => {
        if (typeof value !== 'string') return '';
        const name = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
        return name && [...name].length <= 80 ? name : '';
    };
    // Birthdays: a real calendar date (YYYY-MM-DD) from 1900 up to today.
    const validBirthday = value => {
        const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) return false;
        const [year, month, day] = match.slice(1).map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
        if (year < 1900 || date.getTime() > Date.now()) return false;
        return value;
    };
    const small = express.json({ limit: '16kb', strict: true });
    const large = express.json({ limit: '64mb', strict: true }); // encrypted documents can be large

    async function db() {
        if (!pool) {
            if (!env.MYSQL_HOST || !env.MYSQL_USER || !env.MYSQL_DATABASE) throw new Error('AUTH_NOT_CONFIGURED');
            pool = mysql.createPool({
                host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT || 3306),
                user: env.MYSQL_USER, password: env.MYSQL_PASSWORD || '', database: env.MYSQL_DATABASE,
                charset: 'utf8mb4', timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true,
                connectionLimit: 5, connectTimeout: 5000,
                ...(env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true, ...(env.MYSQL_SSL_CA_FILE ? { ca: readFileSync(env.MYSQL_SSL_CA_FILE, 'utf8') } : {}) } } : {})
            });
            // Timestamps are read as UTC ('Z'), so each connection must also work in UTC;
            // otherwise TIMESTAMP columns come back shifted by the server's time zone.
            pool.pool?.on('connection', connection => connection.query("SET time_zone = '+00:00'"));
        }
        if (!schemaReady) {
            schemaReady = (async () => {
                if (env.AUTH_AUTO_MIGRATE === 'false') return;
                const statements = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').split(';').map(sql => sql.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
                for (const sql of statements) await pool.query(sql);
                if (pool.pool) {
                    const [columns] = await pool.query("SHOW COLUMNS FROM munetios_account_security WHERE Field = 'recovery_codes'");
                    if (!columns.length) {
                        try { await pool.query('ALTER TABLE munetios_account_security ADD COLUMN recovery_codes VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL'); }
                        catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
                    }
                }
            })().catch(error => { schemaReady = null; throw error; });
        }
        await schemaReady;
        return pool;
    }
    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        if (req.method !== 'GET') {
            let expected;
            try { expected = expectedBrowserOrigin(req, env); }
            catch { return fail(res, 503, 'unavailable'); }
            if (req.headers.origin !== expected) return fail(res, 403, 'forbidden');
            if (!req.is('application/json')) return fail(res, 415, 'invalidRequest');
        }
        next();
    });
    function throttle(req, res, next) {
        const now = Date.now();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        const email = String(req.body?.email || '').trim().toLowerCase();
        const keys = [`ip:${req.ip}`, ...(email ? [`email:${tokenHash(email)}`] : [])];
        if (keys.some(key => (attempts.get(key)?.count || 0) >= 15)) {
            res.set('Retry-After', '900');
            return fail(res, 429, 'tooManyAttempts');
        }
        for (const key of keys) {
            const value = attempts.get(key) || { count: 0, until: now + 900000 };
            value.count++;
            attempts.set(key, value);
        }
        next();
    }
    function credentials(req, res, next) {
        const { email, password } = req.body || {};
        if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !/^[\x21-\x7e]+$/.test(email.trim()) || !password || Buffer.byteLength(password) > 1024) return fail(res, 400, 'invalidCredentials');
        req.accountCredentials = { email: email.trim().toLowerCase(), password };
        next();
    }
    const secret = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 1024;

    /* ---------- sessions ---------- */
    async function accountFor(connection, token) {
        if (!token) return null;
        const [rows] = await connection.execute(
            'SELECT a.id, a.email, a.created_at, p.display_name, b.birthday, v.picture, k.account_id AS key_owner, COALESCE(q.show_to_everyone, 1) AS show_picture ' +
            'FROM munetios_accounts a JOIN munetios_sessions s ON s.account_id = a.id LEFT JOIN munetios_profiles p ON p.account_id = a.id ' +
            'LEFT JOIN munetios_profile_birthdays b ON b.account_id = a.id ' +
            'LEFT JOIN munetios_profile_pictures v ON v.account_id = a.id LEFT JOIN munetios_account_keys k ON k.account_id = a.id ' +
            'LEFT JOIN munetios_profile_picture_privacy q ON q.account_id = a.id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()',
            [tokenHash(token)]);
        const row = rows[0];
        return row ? { id: String(row.id), email: row.email, displayName: row.display_name || '', birthday: row.birthday || null, picture: row.picture || null, showProfilePictureToEveryone: Boolean(row.show_picture), createdAt: row.created_at, hasKeys: Boolean(row.key_owner) } : null;
    }
    async function issueSession(connection, accountId, req) {
        const token = randomBytes(32).toString('hex');
        const writes = [
            newSessionStatement(token, '?', accountId, req),
            ['INSERT INTO munetios_session_devices (token_hash, device) VALUES (?, ?)', [tokenHash(token), deviceLabel(req.get('user-agent'))]],
            ['DELETE FROM munetios_sessions WHERE expires_at < UTC_TIMESTAMP()'],
        ];
        if (connection.atomic) await connection.atomic(writes);
        else for (const write of writes) await connection.execute(...write);
        return token;
    }
    const endSession = (connection, token) => connection.execute('DELETE FROM munetios_sessions WHERE token_hash = ?', [tokenHash(token)]);
    function writeCookies(res, active, others, share = usesSharedSession(res.req, env)) {
        const activeName = share ? sharedCookie : COOKIE;
        const othersName = share ? sharedOthers : OTHERS_COOKIE;
        const options = share ? { ...cookieOptions, secure: true, domain: sharedDomain } : cookieOptions;
        const clear = { ...options, maxAge: undefined };
        if (active) res.cookie(activeName, active, options); else res.clearCookie(activeName, clear);
        if (others.length) res.cookie(othersName, others.join('.'), options); else res.clearCookie(othersName, clear);
        if (active) res.cookie(SEEN_COOKIE, '1', { ...options, maxAge: SEEN_MS });
        // Moving to the shared cookie: drop this host's old host-only cookies.
        if (share && hasLegacyCookies(res.req)) {
            res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
            res.clearCookie(OTHERS_COOKIE, { ...cookieOptions, maxAge: undefined });
        }
        onBrowserSessionChange?.(res);
    }
    function newSessionStatement(token, accountExpression, accountValue, req) {
        return [
            'INSERT INTO munetios_sessions (token_hash, account_id, expires_at) VALUES (?, ' + accountExpression + ', ?)',
            [tokenHash(token), accountValue, new Date(Date.now() + SESSION_MS)],
        ];
    }
    // Resolves the other signed-in accounts and drops expired or duplicate ones.
    async function resolveOthers(connection, tokens, excludeAccountId) {
        const list = [];
        for (const token of tokens) {
            const account = await accountFor(connection, token);
            if (account && account.id !== excludeAccountId && !list.some(item => item.account.id === account.id)) list.push({ token, account });
        }
        return list;
    }
    // Signs a new session in. With add=true the current account stays signed in as another account.
    async function startSession(connection, req, accountId, add, share = usesSharedSession(req, env)) {
        const previous = sessionToken(req, share);
        const token = await issueSession(connection, accountId, req);
        const id = String(accountId);
        let keep = await resolveOthers(connection, otherTokens(req, share), id);
        if (previous) {
            const previousAccount = await accountFor(connection, previous);
            if (add && previousAccount && previousAccount.id !== id) keep = [{ token: previous, account: previousAccount }, ...keep.filter(item => item.account.id !== previousAccount.id)];
            else await endSession(connection, previous);
        }
        return { token, others: keep.map(item => item.token) };
    }
    async function createD1Account(database, req, email, passwordHash, keys, internal, profile = {}) {
        const token = randomBytes(32).toString('hex');
        const previous = sessionToken(req);
        let others = await resolveOthers(database, otherTokens(req));
        const previousAccount = previous && req.body.add === true ? await accountFor(database, previous) : null;
        if (previousAccount) {
            others = [{ token: previous, account: previousAccount }, ...others.filter(item => item.account.id !== previousAccount.id)];
        }
        const account = '(SELECT id FROM munetios_accounts WHERE email = ?)';
        const statements = [['INSERT INTO munetios_accounts (email, password_hash) VALUES (?, ?)', [email, passwordHash]]];
        if (internal) statements.push(
            ['INSERT INTO munetios_write_check (value) SELECT NOT EXISTS(SELECT 1 FROM munetios_retired_addresses WHERE email = ?)', [email]],
            ['DELETE FROM munetios_write_check'],
        );
        if (keys) statements.push([
            'INSERT INTO munetios_account_keys (account_id, kdf_salt, wrap_iv, wrapped_key) VALUES (' + account + ', ?, ?, ?)',
            [email, keys.salt, keys.iv, keys.wrapped],
        ]);
        if (internal) statements.push(['INSERT INTO munetios_mailboxes (account_id) VALUES (' + account + ')', [email]]);
        if (profile.displayName) statements.push(['INSERT INTO munetios_profiles (account_id, display_name) VALUES (' + account + ', ?)', [email, profile.displayName]]);
        if (profile.birthday) statements.push(['INSERT INTO munetios_profile_birthdays (account_id, birthday) VALUES (' + account + ', ?)', [email, profile.birthday]]);
        statements.push(
            newSessionStatement(token, account, email, req),
            ['INSERT INTO munetios_session_devices (token_hash, device) VALUES (?, ?)', [tokenHash(token), deviceLabel(req.get('user-agent'))]],
            ['DELETE FROM munetios_sessions WHERE expires_at < UTC_TIMESTAMP()'],
        );
        if (previous && !previousAccount) statements.push(['DELETE FROM munetios_sessions WHERE token_hash = ?', [tokenHash(previous)]]);
        const [{ insertId }] = await database.atomic(statements);
        return { id: String(insertId), token, others: others.map(item => item.token) };
    }
    async function requireSession(req, res, next) {
        try {
            const token = sessionToken(req);
            const connection = await db();
            const account = await accountFor(connection, token);
            if (!account) return fail(res, 401, 'signedOut');
            req.session = { token, account, connection };
            next();
        } catch (error) { next(error); }
    }
    // After the active session ends, the next signed-in account (if any) becomes active.
    async function promoteNext(req, res, connection, excludeToken) {
        const others = await resolveOthers(connection, otherTokens(req).filter(token => token !== excludeToken));
        const [next, ...rest] = others;
        writeCookies(res, next?.token || null, rest.map(item => item.token));
        // No account left (sign-out of the last account, or account deletion): signed out completely.
        if (!next) res.clearCookie(SEEN_COOKIE, { ...seenOptions(req), maxAge: undefined });
        return { account: next?.account || null, accounts: rest.map(item => item.account) };
    }

    // "Signed out completely" (a deliberate sign-out of every account) clears the seen cookie. While it is still
    // present without a valid session, the session is only invalid: apps keep the user in place with the
    // "You've been signed out" dialog instead of sending them to the sign-in page.
    const seenOptions = req => usesSharedSession(req, env) ? { ...cookieOptions, secure: true, domain: sharedDomain, maxAge: SEEN_MS } : { ...cookieOptions, maxAge: SEEN_MS };
    async function browserSession(req, res) {
        const token = sessionToken(req);
        const others = otherTokens(req);
        const seen = Boolean(readCookie(req, SEEN_COOKIE));
        if (!token && !others.length) return { account: null, accounts: [], ...(seen ? { sessionRevoked: true } : {}) };
        const connection = await db();
        let account = await accountFor(connection, token);
        const sessionRevoked = Boolean(token && !account) || (!account && seen);
        let list = await resolveOthers(connection, others, account?.id);
        if (!account && list.length) { // the active session expired: switch to the next account
            const [next, ...rest] = list;
            account = next.account; list = rest;
            writeCookies(res, next.token, rest.map(item => item.token));
        } else if (!account) {
            writeCookies(res, null, []);
        } else if (list.length !== others.length || (usesSharedSession(req, env) && hasLegacyCookies(req))) {
            writeCookies(res, token, list.map(item => item.token));
        }
        // Sessions that started before the seen cookie existed get it now, so a later invalid session is recognized.
        if (account && !seen) res.cookie(SEEN_COOKIE, '1', seenOptions(req));
        return { account, accounts: list.map(item => item.account), ...(sessionRevoked ? { sessionRevoked: true } : {}) };
    }

    router.requireBrowserSession = async (req, res, next) => {
        try {
            const { account } = await browserSession(req, res);
            if (!account) return fail(res, 401, 'signedOut');
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                const expected = expectedBrowserOrigin(req, env);
                if (req.get('origin') !== expected) return fail(res, 403, 'forbidden');
            }
            req.account = account;
            next();
        } catch (error) {
            return handleAuthError(error, req, res, next);
        }
    };

    // Signed-in account or null, for APIs that also serve signed-out visitors (shared links).
    router.optionalAccount = async (req, res) => (await browserSession(req, res)).account;
    // Active account plus the other accounts signed in on this browser (Munetios Mail's unified inbox).
    router.sessionAccounts = (req, res) => browserSession(req, res);
    router.database = db;
    router.syncRateLimit = syncLimit;

    router.lookupAccountByEmail = async email => {
        const connection = await db();
        const [[row]] = await connection.execute('SELECT id, email FROM munetios_accounts WHERE email = ?', [email]);
        return row ? { id: String(row.id), email: row.email } : null;
    };

    router.requireBrowserPage = returnPath => async (req, res, next) => {
        res.set('Cache-Control', 'no-store').vary('Cookie');
        try {
            if (!(await browserSession(req, res)).account) {
                // Signed in on this browser before: open the page; it shows the signed-out dialog and offline data.
                if (readCookie(req, SEEN_COOKIE)) return next();
                const queryAt = req.originalUrl.indexOf('?');
                const returnTo = returnPath + (queryAt < 0 ? '' : req.originalUrl.slice(queryAt));
                return res.redirect('/signin?continue=' + encodeURIComponent(returnTo));
            }
            next();
        } catch (error) {
            return handleAuthError(error, req, res, next);
        }
    };

    router.get('/appearance', requireSession, async (req, res) => {
        const { account, connection } = req.session;
        const [[appearance]] = await connection.execute(
            'SELECT font_family, accent_color FROM munetios_account_appearance WHERE account_id = ?', [account.id]);
        res.json({ accountId: account.id, fontFamily: appearance?.font_family || '', accentColor: appearance?.accent_color || '' });
    });
    router.post('/appearance', small, requireSession, async (req, res) => {
        const { account, connection } = req.session;
        const { accountId, fontFamily, accentColor } = req.body || {};
        const family = typeof fontFamily === 'string' ? fontFamily.trim() : null;
        if (String(accountId) !== String(account.id)) return fail(res, 409, 'accountChanged');
        if (family === null || (family && !/^[\p{L}\p{M}\p{N} _.-]+$/u.test(family)) ||
            [...family].length > 255 || typeof accentColor !== 'string' ||
            (accentColor !== '' && !/^#[0-9a-f]{6}$/i.test(accentColor))) {
            return fail(res, 400, 'invalidRequest');
        }
        const accent = accentColor.toLowerCase();
        await connection.execute(
            'INSERT INTO munetios_account_appearance (account_id, font_family, accent_color) VALUES (?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE font_family = VALUES(font_family), accent_color = VALUES(accent_color)',
            [account.id, family, accent]);
        res.json({ accountId: account.id, fontFamily: family, accentColor: accent });
    });

    router.get('/session', async (req, res) => {
        res.json(await browserSession(req, res));
    });
    async function consumeSecondFactor(connection, id, security, factor) {
        const code = String(factor || '').trim();
        if (/^\d{6}$/.test(code)) {
            const counter = verifyCode(vault.open(security.totp_secret, id), code, security.last_counter);
            if (counter === null) return false;
            const [result] = await connection.execute('UPDATE munetios_account_security SET last_counter = ? WHERE account_id = ? AND last_counter < ? AND totp_enabled = 1 AND totp_secret = ?', [counter, id, counter, security.totp_secret]);
            return Boolean(result.affectedRows);
        }
        if (!/^[a-f0-9]{8}(?:-?[a-f0-9]{8})$/i.test(code)) return false;
        const hash = vault.recoveryHash(code.replace('-', '').toLowerCase(), id);
        for (let attempt = 0; attempt < 3; attempt++) {
            const hashes = JSON.parse(security?.recovery_codes || '[]');
            if (!security?.totp_enabled || !hashes.includes(hash)) return false;
            const [result] = await connection.execute(
                'UPDATE munetios_account_security SET recovery_codes = ? WHERE account_id = ? AND totp_enabled = 1 AND recovery_codes = ?',
                [JSON.stringify(hashes.filter(value => value !== hash)), id, security.recovery_codes]);
            if (result.affectedRows) return true;
            [[security]] = await connection.execute('SELECT * FROM munetios_account_security WHERE account_id = ?', [id]);
        }
        return false;
    }
    function generateRecoveryCodes(id) {
        const raw = Array.from({ length: 10 }, () => randomBytes(8).toString('hex'));
        return {
            codes: raw.map(code => code.slice(0, 8) + '-' + code.slice(8)),
            hashes: JSON.stringify(raw.map(code => vault.recoveryHash(code, id))),
        };
    }
    googleAuth({ router, env, db, small, fail, throttle, requireSession, reauthenticate, readCookie, startSession, writeCookies, consumeSecondFactor });
    emailSettings({ router, env, db, small, throttle, fail, requireSession, reauthenticate, verifyPassword, hashPassword, tokenHash, vault, mailTransport, reserved });
    passwordReset({ router, env, db, small, throttle, fail, hashPassword, mailTransport,
        async verifySecondFactor(connection, id, factor) {
            const [[security]] = await connection.execute('SELECT * FROM munetios_account_security WHERE account_id = ?', [id]);
            if (!security?.totp_enabled) return { ok: true };
            return { ok: await consumeSecondFactor(connection, id, security, factor) };
        },
    });
    router.post('/email-code', small, throttle, async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        if (!validEmail(email) || isInternalEmail(email)) return fail(res, 400, 'invalidRequest');
        try {
            if (!await emailVerification.issue(await db(), email)) return fail(res, 429, 'emailCodeCooldown');
        } catch {
            return fail(res, 503, 'emailDeliveryUnavailable');
        }
        res.json({ ok: true });
    });
    router.post('/signin', small, throttle, credentials, async (req, res) => {
        const connection = await db();
        const { email, password } = req.accountCredentials;
        const [rows] = await connection.execute('SELECT a.id, a.email, a.password_hash, k.kdf_salt, k.wrap_iv, k.wrapped_key FROM munetios_accounts a LEFT JOIN munetios_account_keys k ON k.account_id = a.id WHERE a.email = ?', [email]);
        const row = rows[0];
        const valid = await verifyPassword(password, row?.password_hash || await (dummyHash ||= hashPassword(randomBytes(32).toString('hex'))));
        const { upgrade } = req.body;
        if (!row || !valid) {
            // Tells the browser a one-time upgrade is possible, so it only ever sends the real
            // password for accounts created before end-to-end encryption (sign-up already reveals
            // whether an email is registered, so this adds no new information).
            return res.status(401).json({ error: 'invalidCredentials', ...(row && !row.kdf_salt && upgrade === undefined ? { upgradeAvailable: true } : {}) });
        }
        const [[security]] = await connection.execute('SELECT * FROM munetios_account_security WHERE account_id = ?', [row.id]);
        if (security?.totp_enabled && !await consumeSecondFactor(connection, row.id, security, req.body.code)) return fail(res, 401, 'twoFactorRequired');
        if (upgrade !== undefined) {
            // One-time move to end-to-end encryption: only for accounts that never set up keys.
            if (!HEX64.test(String(upgrade)) || row.kdf_salt) return fail(res, 401, 'invalidCredentials');
            await connection.execute('UPDATE munetios_accounts SET password_hash = ? WHERE id = ?', [await hashPassword(upgrade), row.id]);
        }
        const { token, others } = await startSession(connection, req, row.id, req.body.add === true);
        writeCookies(res, token, others);
        res.json({ account: await accountFor(connection, token), keys: keysOf(row) });
    });
    router.post('/signup', small, throttle, credentials, async (req, res) => {
        const { email, password } = req.accountCredentials;
        if (!validEmail(email)) return fail(res, 400, 'invalidCredentials');
        if ([...password].length < 12) return fail(res, 400, 'passwordWeak');
        // New accounts need a display name so nobody appears without a name; earlier accounts keep theirs.
        const displayName = cleanDisplayName(req.body.displayName);
        if (!displayName) return fail(res, 400, 'displayNameRequired');
        const birthday = req.body.birthday === undefined || req.body.birthday === null || req.body.birthday === '' ? null : validBirthday(req.body.birthday);
        if (birthday === false) return fail(res, 400, 'birthdayInvalid');
        const keys = req.body.keys === undefined ? null : validKeys(req.body.keys);
        if (req.body.keys !== undefined && !keys) return fail(res, 400, 'invalidRequest');
        const internal = isInternalEmail(email);
        if (reserved(email)) return fail(res, 409, 'createFailed');
        if (!internal && !req.body.emailCode) return fail(res, 400, 'emailCodeRequired');
        const pooled = await db();
        if (!internal && !await emailVerification.consume(pooled, email, req.body.emailCode)) return fail(res, 400, 'emailCodeInvalid');
        const passwordHash = await hashPassword(password);
        if (pooled.atomic) {
            try {
                const { id, token, others } = await createD1Account(pooled, req, email, passwordHash, keys, internal, { displayName, birthday });
                writeCookies(res, token, others);
                return res.status(201).json({ account: { id, email, displayName, birthday, hasKeys: Boolean(keys) }, keys });
            } catch (error) {
                if (error.code === 'ER_DUP_ENTRY' || error.code === 'D1_WRITE_CONFLICT') return fail(res, 409, 'createFailed');
                throw error;
            }
        }
        const connection = await pooled.getConnection();
        try {
            await connection.beginTransaction();
            if (internal) {
                const [[retired]] = await connection.execute('SELECT email FROM munetios_retired_addresses WHERE email = ? FOR UPDATE', [email]);
                if (retired) { await connection.rollback(); return fail(res, 409, 'createFailed'); }
            }
            const [result] = await connection.execute('INSERT INTO munetios_accounts (email, password_hash) VALUES (?, ?)', [email, passwordHash]);
            if (keys) await connection.execute('INSERT INTO munetios_account_keys (account_id, kdf_salt, wrap_iv, wrapped_key) VALUES (?, ?, ?, ?)', [result.insertId, keys.salt, keys.iv, keys.wrapped]);
            if (internal) await connection.execute('INSERT INTO munetios_mailboxes (account_id) VALUES (?)', [result.insertId]);
            await connection.execute('INSERT INTO munetios_profiles (account_id, display_name) VALUES (?, ?)', [result.insertId, displayName]);
            if (birthday) await connection.execute('INSERT INTO munetios_profile_birthdays (account_id, birthday) VALUES (?, ?)', [result.insertId, birthday]);
            const { token, others } = await startSession(connection, req, result.insertId, req.body.add === true);
            await connection.commit();
            writeCookies(res, token, others);
            res.status(201).json({ account: { id: String(result.insertId), email, displayName, birthday, hasKeys: Boolean(keys) }, keys });
        } catch (error) {
            await connection.rollback();
            if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'createFailed');
            throw error;
        } finally { connection.release(); }
    });

    function mailMessage(body) {
        const sender = normalizeEmail(body?.sender);
        const recipient = normalizeEmail(body?.recipient);
        const subject = typeof body?.subject === 'string' ? body.subject : '';
        const message = typeof body?.body === 'string' ? body.body : null;
        if (!validEmail(sender) || !validEmail(recipient) || /[\r\n\0]/.test(subject) ||
            [...subject].length > 500 || message === null || Buffer.byteLength(message) > 256 * 1024) return null;
        return { sender, recipient, subject, message };
    }

    async function requireMailbox(req, res, next) {
        const { account, connection } = req.session;
        const [[row]] = await connection.execute('SELECT account_id FROM munetios_mailboxes WHERE account_id = ?', [account.id]);
        if (!isInternalEmail(account.email)) {
            if (!row) {
                try { await connection.execute('INSERT INTO munetios_mailboxes (account_id) VALUES (?)', [account.id]); }
                catch (error) { if (error.code !== 'ER_DUP_ENTRY') throw error; }
            }
            const find = async () => (await connection.execute('SELECT address FROM munetios_mail_aliases WHERE account_id = ?', [account.id]))[0][0];
            let address = (await find())?.address;
            if (!address) {
                address = `inbox-${randomBytes(16).toString('hex')}@munetios.com`;
                try { await connection.execute('INSERT INTO munetios_mail_aliases (account_id, address) VALUES (?, ?)', [account.id, address]); }
                catch (error) {
                    if (error.code !== 'ER_DUP_ENTRY') throw error;
                    address = (await find())?.address;
                    if (!address) throw error;
                }
            }
            req.mailboxAddress = address;
            return next();
        }
        if (!row) return fail(res, 403, 'mailboxUnavailable');
        req.mailboxAddress = account.email;
        next();
    }

    router.mailInbound = async (req, res) => {
        if (!env.MAIL_BRIDGE_SECRET || !secureEqual(req.get('authorization'), 'Bearer ' + env.MAIL_BRIDGE_SECRET)) {
            return fail(res, 401, 'unauthorized');
        }
        const item = mailMessage(req.body);
        if (!item || !isInternalEmail(item.recipient) || !HEX64.test(req.body?.key || '')) return fail(res, 400, 'invalidRequest');
        const html = typeof req.body.html === 'string' && Buffer.byteLength(req.body.html) <= 256 * 1024 ? req.body.html : '';
        try {
            const connection = await db();
            const isAlias = /^inbox-[a-f0-9]{32}@munetios\.com$/.test(item.recipient);
            const source = isAlias ? 'FROM munetios_mail_aliases m WHERE m.address = ?' : 'FROM munetios_mailboxes m JOIN munetios_accounts a ON a.id = m.account_id WHERE a.email = ? OR EXISTS(SELECT 1 FROM munetios_retired_addresses r WHERE r.email = ? AND r.account_id = m.account_id)';
            const addresses = isAlias ? [item.recipient] : [item.recipient, item.recipient];
            const [result] = await connection.execute(
                "INSERT INTO munetios_mail_messages (account_id, direction, message_key, sender, recipient, subject, body) " +
                "SELECT m.account_id, 'inbox', ?, ?, ?, ?, ? " + source + ' ' +
                "ON DUPLICATE KEY UPDATE message_key = munetios_mail_messages.message_key",
                [req.body.key, item.sender, item.recipient, item.subject, item.message, ...addresses]);
            if (!result.affectedRows) {
                const [[row]] = await connection.execute('SELECT m.account_id ' + source, addresses);
                if (!row) return fail(res, 404, 'mailboxUnavailable');
            }
            if (html) await connection.execute(
                "INSERT INTO munetios_mail_html (message_id, html) SELECT id, ? FROM munetios_mail_messages WHERE direction = 'inbox' AND message_key = ? AND recipient = ? " +
                'ON DUPLICATE KEY UPDATE html = VALUES(html)', [html, req.body.key, item.recipient]);
            res.json({ ok: true });
        } catch (error) { return handleAuthError(error, req, res); }
    };

    router.get('/mail/messages', requireSession, requireMailbox, async (req, res) => {
        const folder = req.query.folder === 'sent' ? 'sent' : 'inbox';
        const before = req.query.before;
        if (before !== undefined && !/^\d{1,20}$/.test(before)) return fail(res, 400, 'invalidRequest');
        const [rows] = await req.session.connection.execute(
            'SELECT id, sender, recipient, subject, created_at AS createdAt FROM munetios_mail_messages WHERE account_id = ? AND direction = ?' +
            (before ? ' AND id < ?' : '') + ' ORDER BY id DESC LIMIT 51', [req.session.account.id, folder, ...(before ? [before] : [])]);
        const messages = rows.slice(0, 50).map(row => ({ ...row, id: String(row.id) }));
        res.json({ email: req.mailboxAddress, forwarding: req.mailboxAddress !== req.session.account.email, messages, next: rows.length > 50 ? messages.at(-1).id : null });
    });

    router.get('/mail/messages/:id', requireSession, requireMailbox, async (req, res) => {
        if (!/^\d{1,20}$/.test(req.params.id)) return fail(res, 400, 'invalidRequest');
        const [[message]] = await req.session.connection.execute(
            'SELECT sender, recipient, subject, body, created_at AS createdAt FROM munetios_mail_messages WHERE account_id = ? AND id = ?',
            [req.session.account.id, req.params.id]);
        if (!message) return fail(res, 404, 'mailNotFound');
        const [[rich]] = await req.session.connection.execute('SELECT h.html FROM munetios_mail_html h JOIN munetios_mail_messages m ON m.id = h.message_id WHERE m.account_id = ? AND h.message_id = ?', [req.session.account.id, req.params.id]);
        if (rich) message.html = rich.html;
        res.json({ message });
    });

    router.post('/mail/send', express.json({ limit: '2mb' }), requireSession, requireMailbox, throttle, async (req, res) => {
        const { account, connection } = req.session;
        const item = mailMessage({ sender: req.mailboxAddress, recipient: req.body?.recipient, subject: req.body?.subject, body: req.body?.body });
        if (!item || !item.message.trim()) return fail(res, 400, 'invalidRequest');
        let result;
        try {
            result = await mailTransport('send', { sender: item.sender, recipient: item.recipient, subject: item.subject, body: item.message });
        } catch { return fail(res, 503, 'emailDeliveryUnavailable'); }
        try {
            await connection.execute(
                "INSERT INTO munetios_mail_messages (account_id, direction, message_key, sender, recipient, subject, body) VALUES (?, 'sent', ?, ?, ?, ?, ?)",
                [account.id, tokenHash(String(result.id || randomBytes(16).toString('hex'))), item.sender, item.recipient, item.subject, item.message]);
        } catch {
            return res.json({ ok: true, saved: false });
        }
        res.json({ ok: true, saved: true });
    });
    router.post('/switch', small, async (req, res) => {
        const accountId = String(req.body?.accountId || '');
        const connection = await db();
        const active = sessionToken(req);
        const others = await resolveOthers(connection, otherTokens(req));
        const target = others.find(item => item.account.id === accountId);
        if (!target) return fail(res, 404, 'notSignedIn');
        const current = await accountFor(connection, active);
        const rest = others.filter(item => item !== target).map(item => item.token);
        writeCookies(res, target.token, current ? [active, ...rest] : rest);
        res.json({ account: target.account, accounts: [...(current ? [current] : []), ...others.filter(item => item !== target).map(item => item.account)] });
    });
    router.post('/signout', small, async (req, res) => {
        const token = sessionToken(req);
        const connection = await db();
        if (token) await endSession(connection, token);
        res.json(await promoteNext(req, res, connection, token));
    });

    /* ---------- encryption keys ---------- */
    router.get('/keys', requireSession, async (req, res) => {
        const [rows] = await req.session.connection.execute('SELECT kdf_salt, wrap_iv, wrapped_key FROM munetios_account_keys WHERE account_id = ?', [req.session.account.id]);
        res.json({ keys: keysOf(rows[0]) });
    });
    router.post('/keys', small, requireSession, async (req, res) => {
        const keys = validKeys(req.body?.keys);
        if (!keys) return fail(res, 400, 'invalidRequest');
        try {
            await req.session.connection.execute('INSERT INTO munetios_account_keys (account_id, kdf_salt, wrap_iv, wrapped_key) VALUES (?, ?, ?, ?)', [req.session.account.id, keys.salt, keys.iv, keys.wrapped]);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'keysExist');
            throw error;
        }
        res.status(201).json({ keys });
    });

    /* ---------- account ---------- */
    router.post('/profile-picture/privacy', small, requireSession, async (req, res) => {
        const { showProfilePictureToEveryone } = req.body || {};
        if (typeof showProfilePictureToEveryone !== 'boolean') return fail(res, 400, 'invalidRequest');
        await req.session.connection.execute(
            'INSERT INTO munetios_profile_picture_privacy (account_id, show_to_everyone) VALUES (?, ?) ON DUPLICATE KEY UPDATE show_to_everyone = VALUES(show_to_everyone)',
            [req.session.account.id, showProfilePictureToEveryone ? 1 : 0]);
        res.json({ showProfilePictureToEveryone });
    });

    router.post('/profile-picture', express.json({ limit: '768kb', strict: true }), requireSession, async (req, res) => {
        const picture = req.body?.picture;
        if (picture !== null) {
            if (typeof picture !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(picture)) return fail(res, 400, 'invalidRequest');
            const bytes = Buffer.from(picture.slice('data:image/png;base64,'.length), 'base64');
            if (bytes.length < 33 || bytes.length > 512 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return fail(res, 400, 'invalidRequest');
            const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
            if (!width || !height || width > 512 || height > 512) return fail(res, 400, 'invalidRequest');
            await req.session.connection.execute('INSERT INTO munetios_profile_pictures (account_id, picture) VALUES (?, ?) ON DUPLICATE KEY UPDATE picture = VALUES(picture)', [req.session.account.id, picture]);
        } else {
            await req.session.connection.execute('DELETE FROM munetios_profile_pictures WHERE account_id = ?', [req.session.account.id]);
        }
        res.json({ account: { ...req.session.account, picture } });
    });
    router.post('/profile', small, requireSession, async (req, res) => {
        const name = typeof req.body?.displayName === 'string' ? req.body.displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim() : null;
        if (name === null || [...name].length > 80) return fail(res, 400, 'invalidRequest');
        const hasBirthday = Object.prototype.hasOwnProperty.call(req.body, 'birthday');
        const birthday = !hasBirthday || req.body.birthday === null || req.body.birthday === '' ? null : validBirthday(req.body.birthday);
        if (birthday === false) return fail(res, 400, 'birthdayInvalid');
        await req.session.connection.execute('INSERT INTO munetios_profiles (account_id, display_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)', [req.session.account.id, name]);
        if (hasBirthday) {
            if (birthday) await req.session.connection.execute('INSERT INTO munetios_profile_birthdays (account_id, birthday) VALUES (?, ?) ON DUPLICATE KEY UPDATE birthday = VALUES(birthday)', [req.session.account.id, birthday]);
            else await req.session.connection.execute('DELETE FROM munetios_profile_birthdays WHERE account_id = ?', [req.session.account.id]);
        }
        res.json({ account: { ...req.session.account, displayName: name, birthday: hasBirthday ? birthday : req.session.account.birthday ?? null } });
    });
    router.post('/password', small, throttle, requireSession, async (req, res) => {
        const { currentPassword, newPassword } = req.body || {};
        const keys = validKeys(req.body?.keys);
        if (!secret(currentPassword) || !secret(newPassword) || !keys) return fail(res, 400, 'invalidRequest');
        if ([...newPassword].length < 12) return fail(res, 400, 'passwordWeak');
        const { connection: pooled, account, token } = req.session;
        const [rows] = await pooled.execute('SELECT password_hash FROM munetios_accounts WHERE id = ?', [account.id]);
        if (!rows[0] || !await verifyPassword(currentPassword, rows[0].password_hash)) return fail(res, 403, 'invalidCredentials');
        const passwordHash = await hashPassword(newPassword);
        const writes = [
            ['UPDATE munetios_accounts SET password_hash = ? WHERE id = ?', [passwordHash, account.id]],
            ['INSERT INTO munetios_account_keys (account_id, kdf_salt, wrap_iv, wrapped_key) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE kdf_salt = VALUES(kdf_salt), wrap_iv = VALUES(wrap_iv), wrapped_key = VALUES(wrapped_key)', [account.id, keys.salt, keys.iv, keys.wrapped]],
            ['DELETE FROM munetios_sessions WHERE account_id = ? AND token_hash <> ?', [account.id, tokenHash(token)]],
        ];
        if (pooled.atomic) {
            try {
                await pooled.atomic([
                    ['INSERT INTO munetios_write_check (value) SELECT EXISTS(SELECT 1 FROM munetios_accounts WHERE id = ? AND password_hash = ?)', [account.id, rows[0].password_hash]],
                    ...writes,
                    ['DELETE FROM munetios_write_check'],
                ]);
                return res.json({ ok: true });
            } catch (error) {
                if (error.code === 'D1_WRITE_CONFLICT') return fail(res, 403, 'invalidCredentials');
                throw error;
            }
        }
        const connection = await pooled.getConnection();
        try {
            await connection.beginTransaction();
            for (const write of writes) await connection.execute(...write);
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
        finally { connection.release(); }
        res.json({ ok: true });
    });
    router.get('/sessions', requireSession, async (req, res) => {
        const { connection, account, token } = req.session;
        const current = tokenHash(token);
        const [rows] = await connection.execute('SELECT s.token_hash, s.created_at, d.device FROM munetios_sessions s LEFT JOIN munetios_session_devices d ON d.token_hash = s.token_hash WHERE s.account_id = ? AND s.expires_at > UTC_TIMESTAMP() ORDER BY s.created_at DESC', [account.id]);
        res.json({ sessions: rows.map(row => ({ id: row.token_hash.slice(0, 16), device: row.device || 'Browser|Unknown', createdAt: row.created_at, current: row.token_hash === current })) });
    });
    router.post('/sessions/revoke', small, requireSession, async (req, res) => {
        const id = String(req.body?.id || '');
        if (!/^[a-f0-9]{16}$/.test(id)) return fail(res, 400, 'invalidRequest');
        const { connection, account, token } = req.session;
        if (tokenHash(token).startsWith(id)) return fail(res, 400, 'invalidRequest'); // use sign out for this device
        await connection.execute("DELETE FROM munetios_sessions WHERE account_id = ? AND token_hash LIKE CONCAT(?, '%') AND token_hash <> ?", [account.id, id, tokenHash(token)]);
        res.json({ ok: true });
    });
    router.post('/sessions/revoke-others', small, requireSession, async (req, res) => {
        const { connection, account, token } = req.session;
        await connection.execute('DELETE FROM munetios_sessions WHERE account_id = ? AND token_hash <> ?', [account.id, tokenHash(token)]);
        res.json({ ok: true });
    });
    router.post('/delete', small, throttle, requireSession, async (req, res) => {
        const { password } = req.body || {};
        if (!secret(password) || req.body.confirmation !== 'DELETE') return fail(res, 400, 'invalidRequest');
        const { connection, account, token } = req.session;
        const [rows] = await connection.execute('SELECT password_hash FROM munetios_accounts WHERE id = ?', [account.id]);
        if (!rows[0] || !await verifyPassword(password, rows[0].password_hash)) return fail(res, 403, 'invalidCredentials');
        await connection.execute('DELETE FROM munetios_accounts WHERE id = ?', [account.id]); // sessions, keys, profile and sync items cascade
        res.json(await promoteNext(req, res, connection, token));
    });

    router.get('/security', requireSession, async (req, res) => {
        const [[row]] = await req.session.connection.execute('SELECT * FROM munetios_account_security WHERE account_id = ?', [req.session.account.id]);
        const [[verified]] = await req.session.connection.execute('SELECT email FROM munetios_verified_recovery WHERE account_id = ?', [req.session.account.id]);
        res.json({ twoFactor: Boolean(row?.totp_enabled), recoveryEmail: verified?.email || row?.recovery_email || '', recoveryVerified: Boolean(verified) });
    });
    async function reauthenticate(req, res, next) {
        if (!secret(req.body?.password)) return fail(res, 400, 'invalidRequest');
        const [[row]] = await req.session.connection.execute('SELECT password_hash FROM munetios_accounts WHERE id = ?', [req.session.account.id]);
        if (!row || !await verifyPassword(req.body.password, row.password_hash)) return fail(res, 403, 'invalidCredentials');
        next();
    }
    router.post('/security/setup', small, throttle, requireSession, reauthenticate, async (req, res) => {
        const { connection, account } = req.session;
        const secret = vault.create();
        const sealed = vault.seal(secret, account.id);
        await connection.execute('INSERT INTO munetios_account_security (account_id, totp_secret, setup_expires) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)) ON DUPLICATE KEY UPDATE totp_secret = IF(totp_enabled = 0, VALUES(totp_secret), totp_secret), setup_expires = IF(totp_enabled = 0, VALUES(setup_expires), setup_expires)', [account.id, sealed]);
        const [[row]] = await connection.execute('SELECT * FROM munetios_account_security WHERE account_id = ?', [account.id]);
        if (row.totp_enabled || row.totp_secret !== sealed) return fail(res, 409, 'invalidRequest');
        const uri = `otpauth://totp/${encodeURIComponent('Munetios:' + account.email)}?secret=${secret}&issuer=Munetios&algorithm=SHA1&digits=6&period=30`;
        const qr = qrcode(0, 'M');
        qr.addData(uri);
        qr.make();
        res.json({ secret, uri, qr: qr.createDataURL(5, 20) });
    });
    router.post('/security/enable', small, throttle, requireSession, reauthenticate, async (req, res) => {
        const { connection, account } = req.session;
        const [[row]] = await connection.execute('SELECT * FROM munetios_account_security WHERE account_id = ?', [account.id]);
        if (!row?.totp_secret || row.totp_enabled || !row.setup_expires || new Date(row.setup_expires).getTime() <= Date.now()) return fail(res, 400, 'invalidRequest');
        const counter = verifyCode(vault.open(row.totp_secret, account.id), req.body.code);
        if (counter === null) return fail(res, 400, 'twoFactorRequired');
        const recovery = generateRecoveryCodes(account.id);
        const [result] = await connection.execute('UPDATE munetios_account_security SET totp_enabled = 1, last_counter = ?, setup_expires = NULL, recovery_codes = ? WHERE account_id = ? AND totp_enabled = 0 AND totp_secret = ? AND setup_expires > UTC_TIMESTAMP()', [counter, recovery.hashes, account.id, row.totp_secret]);
        if (!result.affectedRows) return fail(res, 409, 'invalidRequest');
        await connection.execute('DELETE FROM munetios_sessions WHERE account_id = ? AND token_hash <> ?', [account.id, tokenHash(req.session.token)]);
        res.json({ ok: true, recoveryCodes: recovery.codes });
    });
    router.post('/security/recovery-codes', small, throttle, requireSession, reauthenticate, async (req, res) => {
        const { connection, account } = req.session;
        const [[row]] = await connection.execute('SELECT * FROM munetios_account_security WHERE account_id = ?', [account.id]);
        if (!row?.totp_enabled || !await consumeSecondFactor(connection, account.id, row, req.body.code)) return fail(res, 400, 'twoFactorRequired');
        const recovery = generateRecoveryCodes(account.id);
        const [result] = await connection.execute('UPDATE munetios_account_security SET recovery_codes = ? WHERE account_id = ? AND totp_enabled = 1 AND totp_secret = ?', [recovery.hashes, account.id, row.totp_secret]);
        if (!result.affectedRows) return fail(res, 409, 'invalidRequest');
        res.json({ recoveryCodes: recovery.codes });
    });
    router.post('/security/disable', small, throttle, requireSession, reauthenticate, async (req, res) => {
        const { connection, account } = req.session;
        const [[row]] = await connection.execute('SELECT * FROM munetios_account_security WHERE account_id = ?', [account.id]);
        const counter = row?.totp_enabled ? verifyCode(vault.open(row.totp_secret, account.id), req.body.code, row.last_counter) : null;
        if (counter === null) return fail(res, 400, 'twoFactorRequired');
        const [result] = await connection.execute('UPDATE munetios_account_security SET totp_enabled = 0, totp_secret = NULL, last_counter = -1, recovery_codes = NULL WHERE account_id = ? AND totp_enabled = 1 AND last_counter < ?', [account.id, counter]);
        if (!result.affectedRows) return fail(res, 409, 'twoFactorRequired');
        res.json({ ok: true });
    });
    const syncUsageRows = 'SELECT item_key, ' + (syncObjects ? 'COALESCE(object_bytes, OCTET_LENGTH(ciphertext))' : 'OCTET_LENGTH(ciphertext)') +
        ' AS bytes FROM munetios_sync_items WHERE account_id = ? AND deleted = 0 UNION ALL SELECT c.item_key, OCTET_LENGTH(c.ciphertext) AS bytes FROM munetios_sync_item_chunks c JOIN munetios_sync_items i ON i.account_id = c.account_id AND i.item_key = c.item_key WHERE c.account_id = ? AND i.deleted = 0';
    router.get('/sync/storage', syncLimit, requireSession, async (req, res) => {
        const [rows] = await req.session.connection.execute(syncUsageRows, [req.session.account.id, req.session.account.id]);
        const groups = {};
        for (const row of rows) {
            const key = row.item_key.startsWith('omniwrite-media:image:') ? 'images' : row.item_key.startsWith('omniwrite-media:video:') ? 'videos' : row.item_key.startsWith('omniwrite-media:audio:') ? 'audio' : row.item_key.startsWith('omniwrite:') ? 'documents' : row.item_key.startsWith('omniwrite-sheets:') ? 'spreadsheets' : row.item_key.split(':').slice(0, 2).join(':');
            groups[key] = (groups[key] || 0) + Number(row.bytes || 0);
        }
        res.json({ quota: SYNC_QUOTA, used: Object.values(groups).reduce((sum, n) => sum + n, 0), groups });
    });

    /* ---------- end-to-end encrypted sync ---------- */
    // One cheap request that tells a device whether anything changed since its last sync.
    router.get('/sync/state', syncLimit, requireSession, async (req, res) => {
        const [[keyRow]] = await req.session.connection.execute('SELECT sync_seq FROM munetios_account_keys WHERE account_id = ?', [req.session.account.id]);
        res.json({ seq: String(keyRow?.sync_seq ?? 0) });
    });
    router.get('/sync/items', syncLimit, requireSession, async (req, res) => {
        const prefix = String(req.query.prefix || '');
        const since = String(req.query.since || '0');
        if (!/^[A-Za-z0-9:._-]{0,100}$/.test(prefix) || !/^\d{1,19}$/.test(since)) return fail(res, 400, 'invalidRequest');
        const { connection, account } = req.session;
        const [[keyRow]] = await connection.execute('SELECT sync_seq FROM munetios_account_keys WHERE account_id = ?', [account.id]);
        const like = prefix.replace(/[\\%_]/g, character => `\\${character}`) + '%';
        const pageSize = connection.atomic ? 4 : req.query.paged === '1' ? 8 : 0;
        const [rows] = await connection.execute('SELECT i.item_key, i.version, i.deleted, i.iv, i.ciphertext, c.part_index, c.ciphertext AS part_ciphertext' +
            (syncObjects ? ', i.object_key' : '') + ' FROM (SELECT account_id, item_key, version, deleted, iv, ciphertext' +
            (syncObjects ? ', object_key' : '') + ' FROM munetios_sync_items WHERE account_id = ? AND version > ? AND item_key LIKE ? ORDER BY version' +
            (pageSize ? ' LIMIT ' + pageSize : '') + ') i LEFT JOIN munetios_sync_item_chunks c ON c.account_id = i.account_id AND c.item_key = i.item_key ORDER BY i.version, c.part_index', [account.id, since, like]);
        const found = new Map();
        for (const row of rows) {
            let item = found.get(row.item_key);
            if (!item) {
                item = { key: row.item_key, version: String(row.version), deleted: Boolean(row.deleted), iv: row.iv, ciphertext: row.ciphertext, objectKey: row.object_key, parts: [] };
                found.set(row.item_key, item);
            }
            if (row.part_index !== null && row.part_index !== undefined) {
                if (Number(row.part_index) !== item.parts.length || typeof row.part_ciphertext !== 'string') throw Object.assign(new Error('Incomplete encrypted sync item'), { code: 'SYNC_ITEM_INCOMPLETE' });
                item.parts.push(row.part_ciphertext);
            }
        }
        const items = [];
        for (const { parts, objectKey, ...item } of found.values()) {
            if (!item.deleted && objectKey) {
                item.ciphertext = await syncObjects.read(objectKey);
            } else if (!item.deleted && item.ciphertext === null) {
                if (!parts.length) throw Object.assign(new Error('Missing encrypted sync item'), { code: 'SYNC_ITEM_INCOMPLETE' });
                item.ciphertext = parts.join('');
            }
            items.push(item);
        }
        res.json({ seq: String(keyRow?.sync_seq ?? 0), ...(pageSize ? { hasMore: items.length === pageSize } : {}), items });
    });
    const syncUsageSql = 'SELECT COALESCE(SUM(bytes), 0) AS bytes FROM (' + syncUsageRows + ') usage_bytes';
    const syncItemSql = 'SELECT version, COALESCE(' + (syncObjects ? 'object_bytes, ' : '') + 'OCTET_LENGTH(ciphertext), (SELECT SUM(OCTET_LENGTH(c.ciphertext)) FROM munetios_sync_item_chunks c WHERE c.account_id = munetios_sync_items.account_id AND c.item_key = munetios_sync_items.item_key), 0) AS bytes FROM munetios_sync_items WHERE account_id = ? AND item_key = ?';

    function syncItemWrites(accountId, item, version, size, objectKey = null) {
        const deleted = item.deleted === true;
        const split = !objectKey && size > SYNC_DB_PART_BYTES;
        const writes = [
            ['INSERT INTO munetios_sync_items (account_id, item_key, version, deleted, iv, ciphertext) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version), deleted = VALUES(deleted), iv = VALUES(iv), ciphertext = VALUES(ciphertext)',
                [accountId, item.key, version, Number(deleted), deleted ? null : item.iv, deleted || split || objectKey ? null : item.ciphertext]],
            ['DELETE FROM munetios_sync_item_chunks WHERE account_id = ? AND item_key = ?', [accountId, item.key]],
        ];
        if (syncObjects) {
            if (objectKey) writes.push(
                ['INSERT INTO munetios_write_check (value) SELECT EXISTS(SELECT 1 FROM munetios_cloud_objects WHERE object_key = ? AND delete_after > ?)', [objectKey, Date.now()]],
                ['UPDATE munetios_cloud_objects SET delete_after = NULL WHERE object_key = ?', [objectKey]],
            );
            writes.push(['UPDATE munetios_sync_items SET object_key = ?, object_bytes = ? WHERE account_id = ? AND item_key = ?',
                [objectKey, objectKey ? size : null, accountId, item.key]]);
        }
        if (split) {
            for (let offset = 0, index = 0; offset < size; offset += SYNC_DB_PART_BYTES, index++) {
                writes.push(['INSERT INTO munetios_sync_item_chunks (account_id, item_key, part_index, ciphertext) VALUES (?, ?, ?, ?)',
                    [accountId, item.key, index, item.ciphertext.slice(offset, offset + SYNC_DB_PART_BYTES)]]);
            }
        }
        return writes;
    }

    async function saveD1SyncBatch(database, accountId, items) {
        const keys = [...new Set(items.map(item => item.key))];
        const staged = new Map();
        for (let attempt = 0; attempt < 3; attempt++) {
            const [[key], [usage], ...records] = await database.atomic([
                ['SELECT sync_seq, sync_revision FROM munetios_account_keys WHERE account_id = ?', [accountId]],
                [syncUsageSql, [accountId, accountId]],
                ...keys.map(key => [syncItemSql, [accountId, key]]),
            ]);
            if (!key) return null;
            const currentItems = new Map(keys.map((key, index) => [key, records[index][0]]));
            const writes = [];
            const results = [];
            let sequence = BigInt(key.sync_seq);
            let used = Number(usage.bytes);
            for (const item of items) {
                const current = currentItems.get(item.key);
                const version = String(current?.version ?? '0');
                if (version !== String(item.baseVersion)) {
                    results.push({ key: item.key, status: 'conflict', version });
                    continue;
                }
                const size = item.deleted === true ? 0 : Buffer.byteLength(item.ciphertext, 'ascii');
                const next = used - Number(current?.bytes || 0) + size;
                if (next > SYNC_QUOTA && next > used) {
                    results.push({ key: item.key, status: 'quotaExceeded', version });
                    continue;
                }
                used = next;
                const nextVersion = String(++sequence);
                currentItems.set(item.key, { version: nextVersion, bytes: size });
                if (size && syncObjects?.appliesTo(item.key) && !staged.has(item)) {
                    staged.set(item, await syncObjects.stage(item.ciphertext));
                }
                writes.push(...syncItemWrites(accountId, item, nextVersion, size, staged.get(item)));
                results.push({ key: item.key, status: 'ok', version: nextVersion });
            }
            try {
                await database.atomic([
                    ['INSERT INTO munetios_write_check (value) SELECT EXISTS(SELECT 1 FROM munetios_account_keys WHERE account_id = ? AND sync_revision = ?)', [accountId, key.sync_revision]],
                    ...writes,
                    ['UPDATE munetios_account_keys SET sync_seq = ?, sync_revision = sync_revision + 1, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?', [String(sequence), accountId]],
                    ['DELETE FROM munetios_write_check'],
                ]);
                return results;
            } catch (error) {
                if (error.code !== 'D1_WRITE_CONFLICT' || attempt === 2) throw error;
            }
        }
    }
    router.post('/sync/batch', syncLimit, large, requireSession, async (req, res) => {
        const items = Array.isArray(req.body?.items) ? req.body.items : null;
        if (!items) return fail(res, 400, 'invalidRequest');
        for (const item of items) {
            const okShape = item && ITEM_KEY.test(item.key || '') && /^\d{1,19}$/.test(String(item.baseVersion ?? '')) &&
                (item.deleted === true ? true : /^[a-f0-9]{24}$/.test(item.iv || '') && typeof item.ciphertext === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(item.ciphertext));
            if (!okShape) return fail(res, 400, 'invalidRequest');
        }
        const { connection: pooled, account } = req.session;
        if (pooled.atomic) {
            try {
                const results = await saveD1SyncBatch(pooled, account.id, items);
                return results ? res.json({ results }) : fail(res, 409, 'keysRequired');
            } catch (error) {
                if (error.code === 'D1_WRITE_CONFLICT') return fail(res, 409, 'conflict');
                throw error;
            }
        }
        const connection = await pooled.getConnection();
        const results = [];
        try {
            await connection.beginTransaction();
            const [[keyRow]] = await connection.execute('SELECT sync_seq FROM munetios_account_keys WHERE account_id = ? FOR UPDATE', [account.id]);
            if (!keyRow) { await connection.rollback(); return fail(res, 409, 'keysRequired'); }
            let seq = BigInt(keyRow.sync_seq);
            const [[usage]] = await connection.execute(syncUsageSql, [account.id, account.id]);
            let used = Number(usage.bytes);
            for (const item of items) {
                const [[existing]] = await connection.execute(syncItemSql + ' FOR UPDATE', [account.id, item.key]);
                const current = String(existing?.version ?? '0');
                if (current !== String(item.baseVersion)) { results.push({ key: item.key, status: 'conflict', version: current }); continue; }
                const nextBytes = item.deleted === true ? 0 : Buffer.byteLength(item.ciphertext, 'ascii');
                const nextUsed = used - Number(existing?.bytes || 0) + nextBytes;
                if (nextUsed > SYNC_QUOTA && nextUsed > used) { results.push({ key: item.key, status: 'quotaExceeded', version: current }); continue; }
                used = nextUsed;
                seq += 1n;
                for (const write of syncItemWrites(account.id, item, seq.toString(), nextBytes)) await connection.execute(...write);
                results.push({ key: item.key, status: 'ok', version: seq.toString() });
            }
            await connection.execute('UPDATE munetios_account_keys SET sync_seq = ? WHERE account_id = ?', [seq.toString(), account.id]);
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
        finally { connection.release(); }
        res.json({ results });
    });
    router.post('/sync/reset', syncLimit, small, requireSession, async (req, res) => {
        const { connection, account } = req.session;
        if (connection.atomic) {
            await connection.atomic([
                ['DELETE FROM munetios_sync_items WHERE account_id = ?', [account.id]],
                ['UPDATE munetios_account_keys SET sync_seq = 0, sync_revision = sync_revision + 1, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?', [account.id]],
            ]);
            return res.json({ ok: true });
        }
        await connection.execute('DELETE FROM munetios_sync_items WHERE account_id = ?', [account.id]);
        await connection.execute('UPDATE munetios_account_keys SET sync_seq = 0 WHERE account_id = ?', [account.id]);
        res.json({ ok: true });
    });

    function handleAuthError(error, req, res, next) {
        if (res.headersSent) return next(error);
        if (error.type === 'entity.too.large' && req.path === '/sync/batch') return fail(res, 413, 'payloadTooLarge');
        if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') return fail(res, 400, 'invalidRequest');
        // Log only the error code (never credentials or request data) so a
        // stopped database or wrong .env setting is visible to the operator.
        const reason = error.code || error.message;
        const hints = {
            ECONNREFUSED: 'MySQL is not running or MYSQL_HOST/MYSQL_PORT is wrong',
            ER_ACCESS_DENIED_ERROR: 'MYSQL_USER/MYSQL_PASSWORD in .env do not match the database user',
            ER_BAD_DB_ERROR: 'MYSQL_DATABASE in .env does not exist',
            ER_DBACCESS_DENIED_ERROR: 'MYSQL_USER has no rights on MYSQL_DATABASE',
            ER_TABLEACCESS_DENIED_ERROR: 'MYSQL_USER cannot create or use the account tables',
            AUTH_NOT_CONFIGURED: 'set MYSQL_HOST, MYSQL_USER, and MYSQL_DATABASE in .env'
        };
        console.error(`[auth] ${req.method} ${req.path} failed: ${reason}${hints[reason] ? ` (${hints[reason]})` : ''}`);
        return fail(res, 503, 'unavailable');
    }
    router.use(handleAuthError);
    return router;
}
module.exports = { createAuthRouter, hashPassword, verifyPassword, deviceLabel };
