'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { codeAt, verifyCode, securityVault } = require('./security');
const { createHash } = require('node:crypto');
const { createAuthRouter, hashPassword, verifyPassword, deviceLabel } = require('./router');
const { createWebFilterRouter } = require('../webfilter-api/router');

const sha = value => createHash('sha256').update(value).digest('hex');
const KEYS = { salt: 'a'.repeat(32), iv: 'b'.repeat(24), wrapped: 'Q'.repeat(64) };
const acceptedFixtureCode = { consume: async (_db, _email, code) => code === '123456' };

// In-memory stand-in for the MySQL tables the router uses.
function fixtureDatabase() {
    const emailCodes = new Map(), mailboxes = new Set(), messages = [], aliases = new Map();
    const state = { parts: new Map(), security: new Map(), accounts: [], sessions: new Map(), keys: new Map(), profiles: new Map(), pictures: new Map(), picturePrivacy: new Map(), devices: new Map(), items: new Map() };
    let snapshot;
    const live = session => session && session.expires > new Date();
    const clone = () => ({ parts: new Map(state.parts), security: new Map([...state.security].map(([k,v]) => [k,{...v}])), accounts: state.accounts.map(a => ({ ...a })), sessions: new Map(state.sessions), keys: new Map([...state.keys].map(([k, v]) => [k, { ...v }])), profiles: new Map(state.profiles), pictures: new Map(state.pictures), picturePrivacy: new Map(state.picturePrivacy), devices: new Map(state.devices), items: new Map(state.items) });
    const accountRow = token => {
        const session = state.sessions.get(token);
        const account = live(session) && state.accounts.find(a => a.id === session.accountId);
        return account ? [{ id: account.id, email: account.email, created_at: account.created, display_name: state.profiles.get(account.id) || '', picture: state.pictures.get(account.id) || null, show_picture: state.picturePrivacy.get(account.id) ?? 1, key_owner: state.keys.has(account.id) ? account.id : null }] : [];
    };
    const storedBytes = (accountId, item) => item.bytes ?? (item.ciphertext?.length || [...state.parts].filter(([key]) => key.startsWith(`${accountId}|${item.key}|`)).reduce((sum, [, value]) => sum + value.length, 0));
    const db = {
        ...state,
        emailCodes,
        async query(sql) {
            // Schema setup: table creation plus the recovery_codes column check (the fixture already has that column).
            if (sql.startsWith('SHOW COLUMNS FROM munetios_account_security')) return [[{ Field: 'recovery_codes' }]];
            assert.match(sql, /^CREATE TABLE IF NOT EXISTS/, 'unexpected schema statement: ' + sql.slice(0, 120));
            return [[]];
        },
        async getConnection() { return db; },
        async beginTransaction() { snapshot = clone(); },
        async commit() { snapshot = null; },
        async rollback() { if (snapshot) { Object.assign(state, snapshot); Object.assign(db, snapshot); snapshot = null; } },
        release() {},
        async execute(sql, args = []) {
            const id = value => Number(value);
            if (sql.startsWith('INSERT INTO munetios_email_codes')) {
                const [email, codeHash] = args;
                const old = emailCodes.get(email);
                if (!old || Date.now() - old.sent >= 60000) emailCodes.set(email, { code_hash: codeHash, attempts: 0, sent: Date.now(), expires: Date.now() + 600000 });
                return [{ affectedRows: 1 }];
            }
            if (sql.startsWith('SELECT code_hash FROM munetios_email_codes')) return [[emailCodes.get(args[0])].filter(Boolean)];
            if (sql.startsWith('DELETE FROM munetios_email_codes')) {
                const row = emailCodes.get(args[0]);
                const match = row?.code_hash === args[1] && (!sql.includes('expires_at') || (row.expires > Date.now() && row.attempts < 5));
                if (match) emailCodes.delete(args[0]);
                return [{ affectedRows: Number(match) }];
            }
            if (sql.startsWith('UPDATE munetios_email_codes')) {
                const row = emailCodes.get(args[0]);
                if (row && row.code_hash !== args[1] && row.expires > Date.now() && row.attempts < 5) row.attempts++;
                return [{}];
            }
            if (sql.startsWith('INSERT INTO munetios_mailboxes')) { mailboxes.add(id(args[0])); return [{}]; }
            if (sql.startsWith('SELECT address FROM munetios_mail_aliases')) return [aliases.has(id(args[0])) ? [{ address: aliases.get(id(args[0])) }] : []];
            if (sql.startsWith('INSERT INTO munetios_mail_aliases')) { aliases.set(id(args[0]), args[1]); return [{}]; }
            if (sql.startsWith('SELECT h.html FROM munetios_mail_html')) return [[]];
            if (sql.startsWith('SELECT email FROM munetios_retired_addresses') || sql.startsWith('SELECT email FROM munetios_verified_recovery')) return [[]];
            if (sql.startsWith('SELECT account_id FROM munetios_mailboxes')) return [mailboxes.has(id(args[0])) ? [{ account_id: args[0] }] : []];
            if (sql.startsWith('SELECT m.account_id FROM munetios_mailboxes')) {
                const mailbox = state.accounts.find(account => account.email === args[0] && mailboxes.has(account.id));
                return [mailbox ? [{ account_id: mailbox.id }] : []];
            }
            if (sql.startsWith('INSERT INTO munetios_mail_messages')) {
                const inbound = sql.includes("'inbox'");
                const account = inbound ? state.accounts.find(account => account.email === args[5] && mailboxes.has(account.id))?.id : id(args[0]);
                const [key, sender, recipient, subject, body] = inbound ? args : args.slice(1);
                const direction = inbound ? 'inbox' : 'sent';
                if (!account || messages.some(item => item.account === account && item.direction === direction && item.key === key)) return [{ affectedRows: 0 }];
                messages.push({ id: messages.length + 1, account, direction, key, sender, recipient, subject, body, createdAt: new Date() });
                return [{ affectedRows: 1 }];
            }
            if (sql.startsWith('SELECT id, sender')) {
                return [messages.filter(item => item.account === id(args[0]) && item.direction === args[1]).slice().reverse()
                    .map(({ id, sender, recipient, subject, createdAt }) => ({ id, sender, recipient, subject, createdAt }))];
            }
            if (sql.startsWith('SELECT sender, recipient')) {
                return [messages.filter(item => item.account === id(args[0]) && item.id === id(args[1]))
                    .map(({ sender, recipient, subject, body, createdAt }) => ({ sender, recipient, subject, body, createdAt }))];
            }
            if (sql.startsWith('INSERT INTO munetios_accounts')) {
                if (state.accounts.some(a => a.email === args[0])) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
                const account = { id: state.accounts.length + 1, email: args[0], password_hash: args[1], created: new Date() };
                state.accounts.push(account);
                return [{ insertId: account.id }];
            }
            if (sql.startsWith('SELECT * FROM munetios_account_security')) { const row = state.security.get(id(args[0])); return [row ? [{ ...row }] : []]; }
            if (sql.startsWith('INSERT INTO munetios_account_security')) {
                const accountId = id(args[0]); const row = state.security.get(accountId) || { account_id: accountId, totp_enabled: 0, last_counter: -1 };
                if (sql.includes('recovery_email')) row.recovery_email = args[1];
                else if (!row.totp_enabled) { row.totp_secret = args[1]; row.setup_expires = new Date(Date.now() + 600000); }
                state.security.set(accountId, row); return [{ affectedRows: 1 }];
            }
            if (sql.startsWith('UPDATE munetios_account_security SET last_counter')) {
                const row = state.security.get(id(args[1])); if (row.last_counter >= args[2]) return [{ affectedRows: 0 }]; row.last_counter = args[0]; return [{ affectedRows: 1 }];
            }
            if (sql.startsWith('UPDATE munetios_account_security SET totp_enabled = 1')) {
                const row = state.security.get(id(args[2]));
                if (row.totp_enabled || row.totp_secret !== args[3] || row.setup_expires <= new Date()) return [{ affectedRows: 0 }];
                Object.assign(row, { totp_enabled: 1, last_counter: args[0], setup_expires: null, recovery_codes: args[1] });
                return [{ affectedRows: 1 }];
            }
            if (sql.startsWith('UPDATE munetios_account_security SET recovery_codes')) {
                const row = state.security.get(id(args[1]));
                const expected = sql.endsWith('recovery_codes = ?') ? row?.recovery_codes : row?.totp_secret;
                if (!row?.totp_enabled || expected !== args[2]) return [{ affectedRows: 0 }];
                row.recovery_codes = args[0];
                return [{ affectedRows: 1 }];
            }
            if (sql.startsWith('UPDATE munetios_account_security SET totp_enabled = 0')) {
                const row = state.security.get(id(args[0])); if (!row.totp_enabled || row.last_counter >= args[1]) return [{ affectedRows: 0 }]; row.totp_enabled = 0; row.totp_secret = null; row.last_counter = -1; return [{ affectedRows: 1 }];
            }
            if (sql.startsWith('SELECT COALESCE(SUM(bytes)')) return [[{ bytes: [...state.items].filter(([key,item]) => key.startsWith(`${id(args[0])}|`) && !item.deleted).reduce((sum,[key,item]) => sum + storedBytes(id(args[0]), item),0) }]];
            if (sql.startsWith('SELECT item_key, OCTET_LENGTH(ciphertext) AS bytes')) return [[...state.items].filter(([key,item]) => key.startsWith(`${id(args[0])}|`) && !item.deleted).map(([key,item]) => ({ item_key: item.key, bytes: storedBytes(id(args[0]), item) }))];
            if (sql.startsWith('SELECT a.id, a.email, a.password_hash')) {
                const account = state.accounts.find(a => a.email === args[0]);
                const keys = account && state.keys.get(account.id);
                return [account ? [{ ...account, kdf_salt: keys?.salt, wrap_iv: keys?.iv, wrapped_key: keys?.wrapped }] : []];
            }
            if (sql.startsWith('SELECT a.id, a.email, a.created_at')) return [accountRow(args[0])];
            if (sql.startsWith('SELECT id, email FROM munetios_accounts')) return [state.accounts.filter(a => a.email === args[0]).map(({ id, email }) => ({ id, email }))];
            if (sql.startsWith('UPDATE munetios_accounts SET password_hash')) { state.accounts.find(a => a.id === id(args[1])).password_hash = args[0]; return [{}]; }
            if (sql.startsWith('SELECT password_hash FROM munetios_accounts')) return [state.accounts.filter(a => a.id === id(args[0]))];
            if (sql.startsWith('DELETE FROM munetios_accounts WHERE id')) {
                const accountId = id(args[0]);
                state.accounts.splice(state.accounts.findIndex(a => a.id === accountId), 1);
                for (const [key, value] of state.sessions) if (value.accountId === accountId) state.sessions.delete(key);
                state.keys.delete(accountId); state.profiles.delete(accountId); state.pictures.delete(accountId); state.picturePrivacy.delete(accountId);
                for (const key of state.items.keys()) if (key.startsWith(`${accountId}|`)) state.items.delete(key);
                for (const key of state.parts.keys()) if (key.startsWith(`${accountId}|`)) state.parts.delete(key);
                return [{}];
            }
            if (sql.startsWith('INSERT INTO munetios_sessions')) { state.sessions.set(args[0], { accountId: id(args[1]), expires: args[2], created: new Date() }); return [{}]; }
            if (sql.startsWith('INSERT INTO munetios_session_devices')) { state.devices.set(args[0], args[1]); return [{}]; }
            if (sql.startsWith('DELETE FROM munetios_sessions WHERE token_hash')) { state.sessions.delete(args[0]); return [{}]; }
            if (sql.startsWith('DELETE FROM munetios_sessions WHERE expires_at')) { for (const [key, value] of state.sessions) if (value.expires < new Date()) state.sessions.delete(key); return [{}]; }
            if (sql.startsWith('DELETE FROM munetios_sessions WHERE account_id = ? AND token_hash LIKE')) {
                for (const [key, value] of state.sessions) if (value.accountId === id(args[0]) && key.startsWith(args[1]) && key !== args[2]) state.sessions.delete(key);
                return [{}];
            }
            if (sql.startsWith('DELETE FROM munetios_sessions WHERE account_id = ? AND token_hash <>')) {
                for (const [key, value] of state.sessions) if (value.accountId === id(args[0]) && key !== args[1]) state.sessions.delete(key);
                return [{}];
            }
            if (sql.startsWith('SELECT s.token_hash, s.created_at, d.device')) {
                return [[...state.sessions].filter(([, value]) => value.accountId === id(args[0]) && live(value)).map(([key, value]) => ({ token_hash: key, created_at: value.created, device: state.devices.get(key) }))];
            }
            if (sql.startsWith('INSERT INTO munetios_account_keys')) {
                const accountId = id(args[0]);
                if (state.keys.has(accountId) && !sql.includes('ON DUPLICATE KEY')) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
                state.keys.set(accountId, { salt: args[1], iv: args[2], wrapped: args[3], seq: state.keys.get(accountId)?.seq || 0n });
                return [{}];
            }
            if (sql.startsWith('SELECT kdf_salt, wrap_iv, wrapped_key')) { const k = state.keys.get(id(args[0])); return [k ? [{ kdf_salt: k.salt, wrap_iv: k.iv, wrapped_key: k.wrapped }] : []]; }
            if (sql.startsWith('SELECT sync_seq FROM munetios_account_keys')) { const k = state.keys.get(id(args[0])); return [k ? [{ sync_seq: String(k.seq) }] : []]; }
            if (sql.startsWith('UPDATE munetios_account_keys SET sync_seq = ? ')) { state.keys.get(id(args[1])).seq = BigInt(args[0]); return [{}]; }
            if (sql.startsWith('UPDATE munetios_account_keys SET sync_seq = 0')) { state.keys.get(id(args[0])).seq = 0n; return [{}]; }
            if (sql.startsWith('INSERT INTO munetios_profile_pictures')) { state.pictures.set(id(args[0]), args[1]); return [{}]; }
            if (sql.startsWith('INSERT INTO munetios_profile_picture_privacy')) { state.picturePrivacy.set(id(args[0]), args[1]); return [{}]; }
            if (sql.startsWith('DELETE FROM munetios_profile_pictures')) { state.pictures.delete(id(args[0])); return [{}]; }
            if (sql.startsWith('INSERT INTO munetios_profiles')) { state.profiles.set(id(args[0]), args[1]); return [{}]; }
            if (sql.startsWith('SELECT version, COALESCE(OCTET_LENGTH(ciphertext)')) { const item = state.items.get(`${id(args[0])}|${args[1]}`); return [item ? [{ version: item.version, bytes: storedBytes(id(args[0]), item) }] : []]; }
            if (sql.startsWith('INSERT INTO munetios_sync_items')) { state.items.set(`${id(args[0])}|${args[1]}`, { key: args[1], version: args[2], deleted: args[3], iv: args[4], ciphertext: args[5] }); return [{}]; }
            if (sql.startsWith('SELECT i.item_key, i.version, i.deleted, i.iv, i.ciphertext')) {
                const prefix = args[2].slice(0, -1).replace(/\\(.)/g, '$1');
                return [[...state.items].filter(([key, item]) => key.startsWith(`${id(args[0])}|`) && BigInt(item.version) > BigInt(args[1]) && item.key.startsWith(prefix))
                    .map(([, item]) => ({ item_key: item.key, version: item.version, deleted: item.deleted, iv: item.iv, ciphertext: item.ciphertext }))
                    .sort((a, b) => Number(BigInt(a.version) - BigInt(b.version))).slice(0, sql.includes(" LIMIT 8") ? 8 : undefined)
                    .flatMap(item => {
                        const parts = [...state.parts].filter(([key]) => key.startsWith(`${id(args[0])}|${item.item_key}|`)).sort(([a], [b]) => Number(a.split('|').at(-1)) - Number(b.split('|').at(-1)));
                        return parts.length ? parts.map(([key, value]) => ({ ...item, part_index: Number(key.split('|').at(-1)), part_ciphertext: value })) : [{ ...item, part_index: null, part_ciphertext: null }];
                    })];
            }
            if (sql.startsWith('DELETE FROM munetios_sync_item_chunks')) { for (const key of state.parts.keys()) if (key.startsWith(`${id(args[0])}|${args[1]}|`)) state.parts.delete(key); return [{}]; }
            if (sql.startsWith('INSERT INTO munetios_sync_item_chunks')) { state.parts.set(`${id(args[0])}|${args[1]}|${args[2]}`, args[3]); return [{}]; }
            if (sql.startsWith('DELETE FROM munetios_sync_items')) { for (const key of state.items.keys()) if (key.startsWith(`${id(args[0])}|`)) state.items.delete(key); for (const key of state.parts.keys()) if (key.startsWith(`${id(args[0])}|`)) state.parts.delete(key); return [{}]; }
            // Optional birthdays (stored only; the account row lookup in this fixture doesn't join them).
            if (sql.startsWith('INSERT INTO munetios_profile_birthdays')) { (state.birthdays ||= new Map()).set(id(args[0]), args[1]); return [{ affectedRows: 1 }]; }
            if (sql.startsWith('DELETE FROM munetios_profile_birthdays')) { state.birthdays?.delete(id(args[0])); return [{ affectedRows: 1 }]; }
            throw new Error(`Unexpected statement: ${sql}`);
        }
    };
    return db;
}
async function serve(t, options) {
    const app = express();
    if (options.trustFixtureProxy) {
        app.set('trust proxy', 'loopback');
        app.use((req, res, next) => { req.headers.host = req.get('X-Fixture-Host') || req.headers.host; next(); });
    }
    app.use('/api/auth', createAuthRouter({ emailVerification: acceptedFixtureCode, ...options }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return async (route, body, extra = {}) => {
        // Signup now asks for a display name; tests that don't care about it get a default.
        if (route === 'signup' && body && typeof body === 'object') body = { emailCode: '123456', displayName: 'Test User', ...body };
        const response = await fetch(`${origin}/api/auth/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
        return { status: response.status, cookies: response.headers.getSetCookie(), cookie: response.headers.get('set-cookie'), body: await response.json() };
    };
}
test('custom accounts and write hosts share a session without using the beta cookie', async t => {
    const request = await serve(t, { database: fixtureDatabase(), trustFixtureProxy: true,
        env: { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://beta.munetios.com', AUTH_SHARE_MUNETIOS_SESSION: 'true' } });
    const via = host => ({ 'X-Fixture-Host': host, Origin: 'https://' + host, 'X-Forwarded-Proto': 'https' });
    const accountHost = via('accounts.munetios.com'), writeHost = via('write.munetios.com');
    const response = await request('signup', { email: 'shared@example.com', password: 'test shared login password' }, accountHost);
    assert.equal(response.status, 201);
    const active = response.cookies.find(line => line.startsWith('__Secure-munetios-shared-session='));
    assert.match(active, /Domain=munetios\.com.*HttpOnly.*Secure/);
    const Cookie = active.split(';')[0];
    assert.equal((await request('session', undefined, { ...writeHost, Cookie })).body.account.email, 'shared@example.com');
    // Every https *.munetios.com host shares the session, the beta host included.
    assert.equal((await request('session', undefined, { ...via('beta.munetios.com'), Cookie })).body.account.email, 'shared@example.com');
    assert.equal((await request('signout', {}, { ...writeHost, Origin: 'https://unrelated.munetios.com', Cookie })).status, 403);
    const signout = await request('signout', {}, { ...writeHost, Cookie });
    assert.ok(signout.cookies.some(line => line.startsWith('__Secure-munetios-shared-session=;') && line.includes('Domain=munetios.com')));
});
// Keeps a browser-like cookie jar for the two session cookies.
function jar() {
    const values = {};
    return {
        update(response) { for (const line of response.cookies) { const [pair, ...attrs] = line.split(';'); const [name, value] = pair.split('='); if (attrs.some(a => /Expires=Thu, 01 Jan 1970/i.test(a)) || !value) delete values[name]; else values[name] = value; } return response; },
        get header() { return { Cookie: Object.entries(values).map(([k, v]) => `${k}=${v}`).join('; ') }; },
        values
    };
}

test('password hashes are salted and passwords verify without storing plaintext', async () => {
    const first = await hashPassword('a sufficiently long password');
    const second = await hashPassword('a sufficiently long password');
    assert.notEqual(first, second);
    assert(!first.includes('sufficiently'));
    assert(await verifyPassword('a sufficiently long password', first));
    assert.equal(await verifyPassword('incorrect', first), false);
    assert.equal(await verifyPassword('incorrect', 'invalid'), false);
});
test('device labels keep only the browser and operating system', () => {
    assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'), 'Chrome|Windows');
    assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari|iOS');
    assert.equal(deviceLabel(''), 'Browser|Unknown');
});

test('external signup consumes a code and new Munetios personal accounts can sign up and use Mail', async t => {
    const app = express();
    const sent = [];
    const database = fixtureDatabase();
    const env = { MAIL_BRIDGE_SECRET: 'test-bridge-secret', MUNETIOS_RESERVED_MAILBOXES: 'team@munetios.com' };
    const auth = createAuthRouter({
        database, env,
        async mailTransport(action, data) { sent.push({ action, data }); return { id: 'fixture-message' }; },
    });
    app.post('/api/mail/inbound', express.json(), auth.mailInbound);
    app.use('/api/auth', auth);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const call = (route, body, headers = {}) => fetch(origin + route, {
        method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const signup = (email, extra = {}) => call('/api/auth/signup', { email, password: 'fixture account password', keys: KEYS, displayName: 'Test User', ...extra });
    const email = 'student@example.org';
    assert.equal((await (await signup(email)).json()).error, 'emailCodeRequired');
    assert.equal((await call('/api/auth/email-code', { email })).status, 200);
    assert.equal((await call('/api/auth/email-code', { email })).status, 429);
    const { code } = sent[0].data;
    assert.match(code, /^\d{6}$/);
    assert.equal((await (await signup(email, { emailCode: code === '123456' ? '654321' : '123456' })).json()).error, 'emailCodeInvalid');
    const external = await signup(email, { emailCode: code });
    assert.equal(external.status, 201);
    assert.equal((await signup(email, { emailCode: code })).status, 400);
    const externalSession = { Cookie: external.headers.getSetCookie()[0].split(';')[0] };
    const externalMailbox = await (await call('/api/auth/mail/messages', undefined, externalSession)).json();
    assert.equal(externalMailbox.forwarding, true);
    assert.match(externalMailbox.email, /^inbox-[a-f0-9]{32}@munetios\.com$/);
    assert.equal((await (await call('/api/auth/mail/messages', undefined, externalSession)).json()).email, externalMailbox.email);
    const expiredEmail = 'expired@example.org';
    assert.equal((await call('/api/auth/email-code', { email: expiredEmail })).status, 200);
    database.emailCodes.get(expiredEmail).expires = Date.now() - 1;
    assert.equal((await (await signup(expiredEmail, { emailCode: sent.at(-1).data.code })).json()).error, 'emailCodeInvalid');

    const internal = 'owner@munetios.com';
    assert.equal((await signup('TEAM+test@munetios.com')).status, 409);
    const registered = await signup(internal);
    assert.equal(registered.status, 201);
    assert.equal((await signup(internal)).status, 409);
    const session = { Cookie: registered.headers.getSetCookie()[0].split(';')[0] };
    assert.equal((await call('/api/auth/email-code', { email: internal })).status, 400);
    const inbound = { key: 'b'.repeat(64), sender: email, recipient: internal, subject: 'Inbox fixture', body: 'Plain text' };
    assert.equal((await call('/api/mail/inbound', inbound)).status, 401);
    for (let i = 0; i < 2; i++) assert.equal((await call('/api/mail/inbound', inbound, { Authorization: 'Bearer ' + env.MAIL_BRIDGE_SECRET })).status, 200);
    const inbox = await (await call('/api/auth/mail/messages', undefined, session)).json();
    assert.equal(inbox.messages.length, 1);
    assert.equal((await (await call('/api/auth/mail/messages/' + inbox.messages[0].id, undefined, session)).json()).message.body, inbound.body);
    const otherAddress = 'another@munetios.com';
    const other = await signup(otherAddress);
    const otherSession = { Cookie: other.headers.getSetCookie()[0].split(';')[0] };
    assert.equal((await call('/api/auth/mail/messages/' + inbox.messages[0].id, undefined, otherSession)).status, 404);
    assert.equal((await call('/api/auth/mail/send', { sender: otherAddress, recipient: email, subject: 'Outbox fixture', body: 'Reply' }, session)).status, 200);
    assert.equal(sent.at(-1).data.sender, internal);
    assert.equal((await (await call('/api/auth/mail/messages?folder=sent', undefined, session)).json()).messages.length, 1);
});

test('the WebFilter dashboard and its admin requests require a valid Munetios session', async t => {
    const app = express();
    const auth = createAuthRouter({ database: fixtureDatabase(), env: {}, emailVerification: acceptedFixtureCode });
    app.use('/api/auth', auth);
    app.use('/api/webfilter', createWebFilterRouter({ requireDashboardSession: auth.requireBrowserSession }));
    app.get(['/webfilter/', '/webfilter/index.html'], auth.requireBrowserPage('/webfilter/'), (req, res) => res.send('dashboard'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const open = (route, options = {}) => fetch(origin + route, { redirect: 'manual', ...options });
    const post = (route, body, headers = {}) => open(route, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    const dashboard = await open('/webfilter/index.html?hl=fr');
    assert.equal(dashboard.status, 302);
    assert.equal(new URL(dashboard.headers.get('location'), origin).searchParams.get('continue'), '/webfilter/?hl=fr');
    assert.equal((await post('/api/webfilter/orgs', {})).status, 401);

    const account = await post('/api/auth/signup', { email: 'webfilter@example.com', password: 'fixture account password', keys: KEYS, emailCode: '123456', displayName: 'Test User' });
    const session = { Cookie: account.headers.getSetCookie()[0].split(';')[0] };
    const page = await open('/webfilter/', { headers: session });
    assert.equal(await page.text(), 'dashboard');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const created = await (await post('/api/webfilter/orgs', { name: 'School' }, session)).json();
    const root = '/api/webfilter/orgs/' + created.orgId;
    const bearer = { Authorization: 'Bearer ' + created.adminKey };
    assert.equal((await open(root + '/devices', { headers: bearer })).status, 401);
    assert.equal((await open(root + '/devices', { headers: { ...session, ...bearer } })).status, 200);
    assert.equal((await post(root + '/devices/heartbeat', { deviceId: 'test-device' }, { 'X-WebFilter-Enroll': created.enrollToken })).status, 200);
    assert.equal((await open(root + '/update.xml')).status, 200);

    await post('/api/auth/signout', {}, session);
    assert.equal((await open('/webfilter/', { headers: session })).status, 302);
    assert.equal((await open(root + '/devices', { headers: { ...session, ...bearer } })).status, 401);
});

test('WebFilter assigns permissions to signed-in accounts and enforces teacher classroom scope', async t => {
    const app = express();
    const auth = createAuthRouter({ database: fixtureDatabase(), env: {}, emailVerification: acceptedFixtureCode });
    app.use('/api/auth', auth);
    app.use('/api/webfilter', createWebFilterRouter({ requireDashboardSession: auth.requireBrowserSession, lookupAccountByEmail: auth.lookupAccountByEmail }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const call = (route, headers = {}, method = 'GET', body) => fetch(origin + route, {
        method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    async function account(email) {
        const response = await call('/api/auth/signup', {}, 'POST', { email, password: 'fixture account password', keys: KEYS, emailCode: '123456', displayName: 'Test User' });
        assert.equal(response.status, 201);
        return { id: (await response.json()).account.id, headers: { Cookie: response.headers.getSetCookie()[0].split(';')[0] } };
    }
    const owner = await account('owner@example.com');
    const teacher = await account('teacher@example.com');
    const other = await account('unassigned@example.com');
    const base = '/api/webfilter/orgs';
    const created = await (await call(base, owner.headers, 'POST', { name: 'School' })).json();
    const org = base + '/' + created.orgId;
    const enroll = { 'X-WebFilter-Enroll': created.enrollToken };
    const policy = { global: { blockedYouTubeVideos: ['AbCdEf12345'] }, classes: [{ id: 'class-a', name: 'Class A' }, { id: 'class-b', name: 'Class B' }] };
    assert.equal((await call(org + '/policy', owner.headers, 'PUT', { policy, expectedVersion: 0 })).status, 200);
    const added = await call(org + '/members', owner.headers, 'POST', { email: 'Teacher@Example.com', role: 'teacher', classIds: ['class-a'], name: 'Teacher' });
    assert.equal(added.status, 201);
    assert.ok((await added.json()).members.some(member => member.id === teacher.id && member.role === 'teacher'));

    const teacherList = await (await call(base, teacher.headers)).json();
    assert.deepEqual(teacherList.organizations.map(workspace => workspace.orgId), [created.orgId]);
    assert.deepEqual((await (await call(base, other.headers)).json()).organizations, []);
    assert.equal((await call(org + '/status', { ...other.headers, Authorization: 'Bearer ' + created.adminKey })).status, 403);
    assert.equal((await call(org + '/members', teacher.headers, 'POST', { email: 'unassigned@example.com', name: 'Other', role: 'admin', classIds: [] })).status, 403);
    const teacherStatus = await (await call(org + '/status', teacher.headers)).json();
    assert.equal(teacherStatus.member.id, teacher.id);
    assert.deepEqual(teacherStatus.policy.classes.map(klass => klass.id), ['class-a']);
    assert.equal((await call(org + '/policy', teacher.headers, 'PUT', { policy, expectedVersion: 1 })).status, 403);
    const classroomEdit = { global: {}, classes: [{ id: 'class-a', name: 'Forged rename', allowedYouTubeVideos: ['AbCdEf12345'], blockedYouTubeVideos: ['ZYxWV_1234A'] }] };
    assert.equal((await call(org + '/policy', teacher.headers, 'PUT', { policy: classroomEdit, expectedVersion: 0 })).status, 409);
    assert.equal((await call(org + '/policy', teacher.headers, 'PUT', { policy: classroomEdit, expectedVersion: 1 })).status, 200);
    const saved = (await (await call(org + '/policy', enroll)).json()).policy;
    assert.deepEqual(saved.global, policy.global);
    assert.equal(saved.classes[0].name, 'Class A');
    assert.deepEqual(saved.classes[0].allowedYouTubeVideos, ['AbCdEf12345']);
    assert.deepEqual(saved.classes[0].blockedYouTubeVideos, ['ZYxWV_1234A']);
    assert.deepEqual(saved.classes[1], policy.classes[1]);

    for (const [deviceId, classId] of [['device-class-a', 'class-a'], ['device-class-b', 'class-b'], ['device-no-class', '']]) {
        assert.equal((await call(org + '/devices/heartbeat', enroll, 'POST', { deviceId, classId, screen: 'data:image/jpeg;base64,/9gB/9k=' })).status, 200);
    }
    const devices = (await (await call(org + '/devices', teacher.headers)).json()).devices;
    assert.deepEqual(devices.map(device => device.id).sort(), ['device-class-a', 'device-no-class']);
    assert.equal(devices.find(device => device.id === 'device-no-class').hasScreen, undefined);
    assert.equal((await call(org + '/devices/device-class-b/screen', teacher.headers)).status, 404);
    assert.equal((await call(org + '/devices/device-class-b/commands', teacher.headers, 'POST', { type: 'unlock' })).status, 404);
    assert.equal((await call(org + '/devices/device-class-a/commands', teacher.headers, 'POST', { type: 'unlock' })).status, 201);
    const assignment = await call(org + '/devices/device-no-class', teacher.headers, 'PUT', {
        classId: 'class-a', assignedBy: owner.id, teacher: { id: owner.id, classIds: ['class-b'] },
    });
    assert.equal(assignment.status, 200);
    assert.equal((await assignment.json()).device.assignedBy, teacher.id);
    assert.equal((await call(org + '/members/' + owner.id, owner.headers, 'DELETE')).status, 403);
    assert.equal((await call(org + '/members/' + teacher.id, owner.headers, 'DELETE')).status, 200);
    assert.equal((await call(org + '/status', teacher.headers)).status, 403);
});
test('account creation, normalized login, rotation, expired sessions, and sign out', async t => {
    const database = fixtureDatabase();
    const request = await serve(t, { database, env: { NODE_ENV: 'production' } });
    const credentials = { email: 'Person@Example.com', password: 'long unique password 123' };
    assert.equal((await request('signup', { ...credentials, password: 'short' })).body.error, 'passwordWeak');
    const created = await request('signup', { ...credentials, keys: KEYS });
    assert.equal(created.status, 201);
    assert.equal(created.body.account.email, 'person@example.com');
    assert.deepEqual(created.body.keys, KEYS);
    assert.match(created.cookie, /HttpOnly/); assert.match(created.cookie, /Secure/); assert.match(created.cookie, /SameSite=Lax/);
    assert.match(created.cookie, /(?:^|;\s*)Max-Age=2592000(?:;|$)/);
    const firstCookie = created.cookie.split(';')[0];
    const token = firstCookie.split('=')[1];
    assert(!database.sessions.has(token));
    assert(database.sessions.has(sha(token)));
    const stored = database.sessions.get(sha(token));
    assert.equal(Math.round((stored.expires - stored.created) / 1000), 2592000);
    const expires = stored.expires.getTime();
    assert.equal(database.devices.get(sha(token)), 'Browser|Unknown');
    const session = (await request('session', undefined, { Cookie: firstCookie })).body;
    assert.equal(session.account.email, 'person@example.com');
    assert.equal(session.account.hasKeys, true);
    assert.equal(stored.expires.getTime(), expires);
    assert.equal((await request('signup', credentials)).status, 409);
    assert.equal(database.accounts.length, 1);
    const wrong = await request('signin', { ...credentials, password: 'wrong password' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.upgradeAvailable, undefined, 'modern accounts never ask for the real password');
    assert.equal((await request('signin', { ...credentials, email: 'missing@example.com' })).body.error, 'invalidCredentials');
    const signedIn = await request('signin', credentials, { Cookie: firstCookie });
    assert.equal(signedIn.status, 200);
    assert.deepEqual(signedIn.body.keys, KEYS);
    const secondCookie = signedIn.cookie.split(';')[0];
    assert.notEqual(firstCookie, secondCookie);
    assert.equal((await request('session', undefined, { Cookie: firstCookie })).body.account, null);
    assert.equal((await request('signout', {}, { Cookie: secondCookie })).status, 200);
    assert.equal((await request('session', undefined, { Cookie: secondCookie })).body.account, null);
    const fresh = await request('signin', credentials);
    for (const value of database.sessions.values()) value.expires = new Date(0);
    assert.equal((await request('session', undefined, { Cookie: fresh.cookie.split(';')[0] })).body.account, null);
    assert.equal((await request('signup', { email: 'x@example.com', password: 'long unique password 123', keys: { salt: 'nope' } })).status, 400);
});
test('several accounts can be signed in, switched, and signed out one at a time', async t => {
    const database = fixtureDatabase();
    const request = await serve(t, { database, env: {} });
    const browser = jar();
    browser.update(await request('signup', { email: 'one@example.com', password: 'long unique password 1', keys: KEYS }));
    browser.update(await request('signup', { email: 'two@example.com', password: 'long unique password 2', keys: KEYS, add: true }, browser.header));
    let session = (await request('session', undefined, browser.header)).body;
    assert.equal(session.account.email, 'two@example.com');
    assert.deepEqual(session.accounts.map(a => a.email), ['one@example.com']);
    // Adding an account that is already signed in replaces its old session instead of duplicating it.
    browser.update(await request('signin', { email: 'one@example.com', password: 'long unique password 1', add: true }, browser.header));
    session = (await request('session', undefined, browser.header)).body;
    assert.equal(session.account.email, 'one@example.com');
    assert.deepEqual(session.accounts.map(a => a.email), ['two@example.com']);
    const switched = browser.update(await request('switch', { accountId: session.accounts[0].id }, browser.header));
    assert.equal(switched.body.account.email, 'two@example.com');
    assert.equal((await request('switch', { accountId: '999' }, browser.header)).status, 404);
    const out = browser.update(await request('signout', {}, browser.header));
    assert.equal(out.body.account.email, 'one@example.com');
    assert.deepEqual(out.body.accounts, []);
    const last = browser.update(await request('signout', {}, browser.header));
    assert.equal(last.body.account, null);
    assert.equal((await request('session', undefined, browser.header)).body.account, null);
});
test('accounts created before end-to-end encryption upgrade once, then refuse the old password', async t => {
    const database = fixtureDatabase();
    const request = await serve(t, { database, env: {} });
    database.accounts.push({ id: 1, email: 'legacy@example.com', password_hash: await hashPassword('old raw password 123'), created: new Date() });
    const derived = 'c'.repeat(64);
    const first = await request('signin', { email: 'legacy@example.com', password: derived });
    assert.deepEqual([first.status, first.body.upgradeAvailable], [401, true]);
    const upgraded = await request('signin', { email: 'legacy@example.com', password: 'old raw password 123', upgrade: derived });
    assert.equal(upgraded.status, 200);
    assert.equal(upgraded.body.keys, null);
    const cookie = { Cookie: upgraded.cookie.split(';')[0] };
    assert.equal((await request('keys', { keys: KEYS }, cookie)).status, 201);
    assert.equal((await request('keys', { keys: KEYS }, cookie)).status, 409);
    assert.deepEqual((await request('keys', undefined, cookie)).body.keys, KEYS);
    assert.equal((await request('signin', { email: 'legacy@example.com', password: 'old raw password 123' })).status, 401);
    assert.equal((await request('signin', { email: 'legacy@example.com', password: derived, upgrade: 'd'.repeat(64) })).status, 401);
    assert.equal((await request('signin', { email: 'legacy@example.com', password: derived })).status, 200);
});
test('profile pictures persist, replace and remove without accepting remote URLs or SVG', async t => {
    const database = fixtureDatabase();
    const request = await serve(t, { database, env: {} });
    const account = jar();
    account.update(await request('signup', { email: 'picture@example.com', password: 'long unique password 1', keys: KEYS }));
    const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
    assert.equal((await request('profile-picture', { picture })).status, 401);
    assert.equal((await request('profile-picture', { picture }, account.header)).status, 200);
    assert.equal((await request('session', undefined, account.header)).body.account.picture, picture);
    for (const invalid of ['https://example.com/avatar.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,YmFk', undefined]) {
        assert.equal((await request('profile-picture', { picture: invalid }, account.header)).status, 400);
    }
    const oversized = Buffer.from(picture.split(',')[1], 'base64'); oversized.writeUInt32BE(4000, 16);
    assert.equal((await request('profile-picture', { picture: 'data:image/png;base64,' + oversized.toString('base64') }, account.header)).status, 400);
    assert.equal((await request('profile-picture', { picture: null }, account.header)).body.account.picture, null);
    assert.equal((await request('session', undefined, account.header)).body.account.picture, null);
});

test('picture privacy is account scoped, defaults to visible, and keeps the owner picture', async t => {
    const request = await serve(t, { database: fixtureDatabase(), env: {} });
    const owner = jar(), other = jar();
    owner.update(await request('signup', { email: 'owner@munetios.com', password: 'long unique password 1', keys: KEYS }));
    other.update(await request('signup', { email: 'other@munetios.com', password: 'long unique password 2', keys: KEYS }));
    const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
    await request('profile-picture', { picture }, owner.header);
    const preference = async (session) => (await request('session', undefined, session.header)).body.account.showProfilePictureToEveryone;
    assert.equal(await preference(owner), true);
    assert.equal((await request('profile-picture/privacy', { showProfilePictureToEveryone: false })).status, 401);
    assert.equal((await request('profile-picture/privacy', { showProfilePictureToEveryone: 'false' }, owner.header)).status, 400);
    assert.equal((await request('profile-picture/privacy', { showProfilePictureToEveryone: false }, owner.header)).status, 200);
    assert.equal(await preference(owner), false);
    assert.equal(await preference(other), true);
    assert.equal((await request('session', undefined, owner.header)).body.account.picture, picture);
    assert.equal((await request('profile-picture/privacy', { showProfilePictureToEveryone: true }, owner.header)).status, 200);
    assert.equal(await preference(owner), true);
});

test('profile, password change, signed-in devices, and account deletion', async t => {
    const database = fixtureDatabase();
    const request = await serve(t, { database, env: {} });
    const a = jar(), b = jar();
    a.update(await request('signup', { email: 'me@example.com', password: 'long unique password 1', keys: KEYS }));
    b.update(await request('signin', { email: 'me@example.com', password: 'long unique password 1' }));
    assert.equal((await request('profile', { displayName: '  Munetios\u0007  ' }, a.header)).body.account.displayName, 'Munetios');
    assert.equal((await request('profile', { displayName: 'x'.repeat(81) }, a.header)).status, 400);
    assert.equal((await request('session', undefined, a.header)).body.account.displayName, 'Munetios');
    const devices = (await request('sessions', undefined, a.header)).body.sessions;
    assert.equal(devices.length, 2);
    assert.equal(devices.filter(d => d.current).length, 1);
    const other = devices.find(d => !d.current);
    assert.equal((await request('sessions/revoke', { id: devices.find(d => d.current).id }, a.header)).status, 400);
    assert.equal((await request('sessions/revoke', { id: other.id }, a.header)).status, 200);
    assert.deepEqual((await request('session', undefined, b.header)).body, { account: null, accounts: [], sessionRevoked: true });
    b.update(await request('signin', { email: 'me@example.com', password: 'long unique password 1' }));
    const newKeys = { ...KEYS, salt: 'e'.repeat(32) };
    assert.equal((await request('password', { currentPassword: 'wrong', newPassword: 'another long password', keys: newKeys }, a.header)).status, 403);
    assert.equal((await request('password', { currentPassword: 'long unique password 1', newPassword: 'short', keys: newKeys }, a.header)).status, 400);
    assert.equal((await request('password', { currentPassword: 'long unique password 1', newPassword: 'another long password', keys: newKeys }, a.header)).status, 200);
    assert.equal((await request('session', undefined, b.header)).body.account, null, 'other devices are signed out');
    assert.equal((await request('session', undefined, a.header)).body.account.email, 'me@example.com');
    assert.deepEqual((await request('keys', undefined, a.header)).body.keys, newKeys);
    assert.equal((await request('delete', { password: 'long unique password 1', confirmation: 'DELETE' }, a.header)).status, 403);
    const deleted = a.update(await request('delete', { password: 'another long password', confirmation: 'DELETE' }, a.header));
    assert.equal(deleted.body.account, null);
    assert.equal(database.accounts.length, 0);
    assert.equal(database.keys.size, 0);
});
test('sync stores only ciphertext, detects conflicts, and resets', async t => {
    const database = fixtureDatabase();
    const request = await serve(t, { database, env: {} });
    const a = jar();
    a.update(await request('signup', { email: 'sync@example.com', password: 'long unique password 1' }));
    const item = { key: 'ls:appearance', baseVersion: '0', iv: 'f'.repeat(24), ciphertext: 'AAAA' };
    assert.equal((await request('sync/batch', { items: [item] }, a.header)).status, 409, 'keys are required before syncing');
    await request('keys', { keys: KEYS }, a.header);
    assert.equal((await request('sync/batch', { items: [{ ...item, ciphertext: 'not base64!' }] }, a.header)).status, 400);
    const first = (await request('sync/batch', { items: [item, { ...item, key: 'omniwrite:doc:1' }] }, a.header)).body.results;
    assert.deepEqual(first.map(r => [r.status, r.version]), [['ok', '1'], ['ok', '2']]);
    const stale = (await request('sync/batch', { items: [{ ...item, baseVersion: '0' }] }, a.header)).body.results[0];
    assert.deepEqual([stale.status, stale.version], ['conflict', '1']);
    const removed = (await request('sync/batch', { items: [{ key: 'omniwrite:doc:1', baseVersion: '2', deleted: true }] }, a.header)).body.results[0];
    assert.equal(removed.version, '3');
    const all = (await request('sync/items?prefix=omniwrite:&since=0', undefined, a.header)).body;
    assert.equal(all.seq, '3');
    assert.deepEqual(all.items.map(i => [i.key, i.version, i.deleted]), [['omniwrite:doc:1', '3', true]]);
    assert.equal((await request('sync/items?since=1', undefined, a.header)).body.items.length, 1);
    assert.equal((await request('sync/items?prefix=bad%20prefix', undefined, a.header)).status, 400);
    assert.equal((await request('sync/reset', {}, a.header)).status, 200);
    const empty = (await request('sync/items?since=0', undefined, a.header)).body;
    assert.deepEqual([empty.seq, empty.items.length], ['0', 0]);
    assert.equal((await request('sync/items', undefined, {})).status, 401);
});
test('rejects cross-origin and malformed requests and fails closed without MySQL', async t => {
    const request = await serve(t, { env: {} });
    assert.equal((await request('session')).body.account, null);
    assert.equal((await request('signin', {}, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await request('signin', '{')).status, 400);
    assert.equal((await request('signin', { email: 'a@@b.com', password: 'test' })).status, 400);
    assert.equal((await request('signin', { email: 'a@example.com', password: 'long password' })).status, 503);
});
test('limits repeated authentication attempts', async t => {
    const request = await serve(t, { env: {} });
    for (let attempt = 0; attempt < 15; attempt++) await request('signin', { email: 'a@example.com', password: 'incorrect' });
    assert.equal((await request('signin', { email: 'a@example.com', password: 'incorrect' })).status, 429);
});

test('TOTP uses standard counters, rejects replay, and encrypts secrets per account', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(codeAt(secret, 1), '287082');
    assert.equal(verifyCode(secret, '287082', -1, 59000), 1);
    assert.equal(verifyCode(secret, '287082', 1, 59000), null);
    assert.equal(verifyCode(secret, 'x', -1, 59000), null);
    const vault = securityVault({ AUTH_SECURITY_KEY: 'ab'.repeat(32) });
    const sealed = vault.seal(secret, '1');
    assert.equal(vault.open(sealed, '1'), secret);
    assert.throws(() => vault.open(sealed, '2'));
    assert.throws(() => securityVault({ NODE_ENV: 'production' }).seal(secret, '1'));
});
test('2FA requires password and verified setup, guards sign-in and rejects reused codes', async t => {
    const database = fixtureDatabase();
    const request = await serve(t, { database, env: { AUTH_SECURITY_KEY: 'ab'.repeat(32) } });
    const a = jar(); const credentials = { email: 'secure@example.com', password: 'long unique password 1' };
    a.update(await request('signup', credentials));
    assert.equal((await request('security/setup', { password: 'wrong' }, a.header)).status, 403);
    const setup = await request('security/setup', { password: credentials.password }, a.header);
    assert.equal(setup.status, 200);
    assert.match(setup.body.secret, /^[A-Z2-7]{32}$/);
    assert.match(setup.body.qr, /^data:image\/gif;base64,/);
    assert.equal(new URL(setup.body.uri).searchParams.get('secret'), setup.body.secret);
    assert.notEqual(database.security.get(1).totp_secret, setup.body.secret);
    const counter = Math.floor(Date.now()/30000);
    const code = n => codeAt(setup.body.secret,n);
    assert.equal((await request('security/enable', { password: credentials.password, code: 'bad' }, a.header)).status, 400);
    const enabled = await request('security/enable', { password: credentials.password, code: code(counter-1) }, a.header);
    assert.equal(enabled.status, 200);
    assert.equal(new Set(enabled.body.recoveryCodes).size, 10);
    const [recovery, previous] = enabled.body.recoveryCodes;
    assert.match(recovery, /^[a-f0-9]{8}-[a-f0-9]{8}$/);
    assert.ok(!database.security.get(1).recovery_codes.includes(recovery.replace('-', '')));
    assert.equal((await request('signin', credentials)).body.error, 'twoFactorRequired');
    assert.equal((await request('signin', { ...credentials, code: code(counter-1) })).body.error, 'twoFactorRequired');
    assert.equal((await request('signin', { ...credentials, code: code(counter) })).status, 200);
    assert.equal((await request('signin', { ...credentials, code: code(counter) })).body.error, 'twoFactorRequired');
    assert.equal((await request('signin', { ...credentials, code: recovery })).status, 200);
    assert.equal((await request('signin', { ...credentials, code: recovery })).body.error, 'twoFactorRequired');
    const rotated = await request('security/recovery-codes', { password: credentials.password, code: previous }, a.header);
    assert.equal(rotated.status, 200);
    assert.equal(new Set(rotated.body.recoveryCodes).size, 10);
    assert.equal((await request('signin', { ...credentials, code: enabled.body.recoveryCodes[2] })).body.error, 'twoFactorRequired');
    assert.equal((await request('security/disable', { password: credentials.password, code: code(counter+1) }, a.header)).status, 200);
    assert.equal((await request('delete', { password: credentials.password, confirmation: 'DELETE' }, a.header)).status, 200);
});
test('50 GB quota partially accepts batches, retains old copies, and allows deletions to free space', async t => {
    const database = fixtureDatabase(); const request = await serve(t, { database, env: {} }); const a = jar();
    a.update(await request('signup', { email: 'quota@example.com', password: 'long unique password', keys: KEYS }));
    database.items.set('1|omniwrite:doc:large', { key: 'omniwrite:doc:large', version: '0', bytes: 49999999996, ciphertext: 'AAAA', deleted: 0 });
    const item = { key: 'ls:appearance', baseVersion: '0', iv: 'f'.repeat(24), ciphertext: 'AAAAAAAA' };
    const results = (await request('sync/batch', { items: [item, { ...item, key: 'ls:settings', ciphertext: 'AAAA' }] }, a.header)).body.results;
    assert.deepEqual(results.map(r=>r.status), ['quotaExceeded','ok']);
    const storage = (await request('sync/storage', undefined, a.header)).body;
    assert.equal(storage.quota, 50000000000); assert.equal(storage.used, storage.quota); assert.equal(storage.groups.documents,49999999996);
    assert.equal(database.items.has('1|ls:appearance'), false);
    assert.equal((await request('sync/batch', { items: [{ key: 'omniwrite:doc:large', baseVersion: '0', deleted: true }] }, a.header)).body.results[0].status, 'ok');
    assert.equal((await request('sync/batch', { items: [item] }, a.header)).body.results[0].status, 'ok');
});

test('media sync pages preserve version order and storage categories remain separate', async t => {
    const database = fixtureDatabase(); const request = await serve(t, { database, env: {} }); const a = jar();
    a.update(await request('signup', { email: 'media@example.com', password: 'long unique password', keys: KEYS }));
    const items = Array.from({ length: 11 }, (_, index) => ({ key: `omniwrite-media:${index < 9 ? 'video' : index === 9 ? 'image' : 'audio'}:asset:${index}`, iv: 'f'.repeat(24), baseVersion: '0', ciphertext: 'AAAA' }));
    assert.equal((await request('sync/batch', { items }, a.header)).status, 200);
    const page = (await request('sync/items?prefix=omniwrite-media:&since=0&paged=1', undefined, a.header)).body;
    assert.equal(page.items.length, 8); assert.equal(page.hasMore, true);
    const next = (await request(`sync/items?prefix=omniwrite-media:&since=${page.items.at(-1).version}&paged=1`, undefined, a.header)).body;
    assert.equal(next.items.length, 3); assert.equal(next.hasMore, false); assert.equal(next.items[0].version, '9');
    const storage = (await request('sync/storage', undefined, a.header)).body;
    assert.deepEqual(storage.groups, { videos: 36, images: 4, audio: 4 });
});

test('large encrypted items use bounded database packets and round-trip unchanged', async t => {
    const database = fixtureDatabase(); const request = await serve(t, { database, env: {} }); const a = jar();
    a.update(await request('signup', { email: 'packets@example.com', password: 'long unique password', keys: KEYS }));
    const ciphertext = 'A'.repeat(4 * 1024 * 1024) + 'BBBB';
    const item = { key: 'omniwrite-media:video:large:0', baseVersion: '0', iv: 'f'.repeat(24), ciphertext };
    assert.equal((await request('sync/batch', { items: [item] }, a.header)).status, 200);
    assert.equal(database.items.get('1|' + item.key).ciphertext, null);
    assert.equal(database.parts.size, 17);
    assert.ok([...database.parts.values()].every(part => part.length <= 256 * 1024));
    const pulled = (await request('sync/items?prefix=omniwrite-media:&since=0&paged=1', undefined, a.header)).body;
    assert.equal(pulled.items.length, 1); assert.equal(pulled.hasMore, false);
    assert.equal(pulled.items[0].ciphertext, ciphertext);
    assert.equal((await request('sync/storage', undefined, a.header)).body.used, ciphertext.length);
    assert.equal((await request('sync/batch', { items: [{ ...item, baseVersion: '1', ciphertext: 'AAAA' }] }, a.header)).status, 200);
    assert.equal(database.parts.size, 0);
    assert.equal((await request('sync/storage', undefined, a.header)).body.used, 4);
    await request('sync/batch', { items: [{ ...item, baseVersion: '2' }] }, a.header);
    assert.equal(database.parts.size, 17);
    await request('sync/batch', { items: [{ key: item.key, baseVersion: '3', deleted: true }] }, a.header);
    assert.equal(database.parts.size, 0);
    assert.equal((await request('sync/storage', undefined, a.header)).body.used, 0);
});

test('a failed multipart write rolls back both its item version and database parts', async t => {
    const database = fixtureDatabase(); const original = database.execute.bind(database); let failPart = true;
    database.execute = async (sql, args) => {
        if (failPart && sql.startsWith('INSERT INTO munetios_sync_item_chunks') && args[2] === 1) { failPart = false; throw Object.assign(new Error('test write failure'), { code: 'TEST_WRITE_FAILURE' }); }
        return original(sql, args);
    };
    const request = await serve(t, { database, env: {} }); const a = jar();
    a.update(await request('signup', { email: 'atomic-parts@example.com', password: 'long unique password', keys: KEYS }));
    const item = { key: 'omniwrite:doc:large', baseVersion: '0', iv: 'f'.repeat(24), ciphertext: 'A'.repeat(1024 * 1024) };
    assert.equal((await request('sync/batch', { items: [item] }, a.header)).status, 503);
    assert.equal(database.items.size, 0); assert.equal(database.parts.size, 0); assert.equal(database.keys.get(1).seq, 0n);
    assert.equal((await request('sync/batch', { items: [item] }, a.header)).status, 200);
    assert.equal((await request('sync/items?since=0', undefined, a.header)).body.items[0].ciphertext, item.ciphertext);
});

// An invalid session keeps the user in place (sessionRevoked, protected pages open); only signing out completely
// (no account left) returns the plain signed-out state that sends apps to the sign-in page.
test('invalid sessions are reported as revoked until the user signs out completely', async t => {
    const database = fixtureDatabase();
    const env = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://beta.munetios.com', AUTH_SHARE_MUNETIOS_SESSION: 'true' };
    const request = await serve(t, { database, trustFixtureProxy: true, env });
    const via = host => ({ 'X-Fixture-Host': host, Origin: 'https://' + host, 'X-Forwarded-Proto': 'https' });
    const signup = await request('signup', { email: 'revoked@example.com', password: 'test revoked login password', displayName: 'Revoked Tester', birthday: '2000-01-01' }, via('accounts.munetios.com'));
    assert.equal(signup.status, 201, JSON.stringify(signup.body));
    const pick = (response, name) => response.cookies.find(line => line.startsWith(name + '='));
    assert.match(pick(signup, 'munetios_seen'), /Domain=munetios\.com/);
    const session = pick(signup, '__Secure-munetios-shared-session').split(';')[0];
    const seen = pick(signup, 'munetios_seen').split(';')[0];

    // The session becomes invalid (signed out elsewhere, password changed, device removed).
    database.sessions.clear();
    const invalid = await request('session', undefined, { ...via('mail.munetios.com'), Cookie: `${session}; ${seen}` });
    assert.equal(invalid.body.account, null);
    assert.equal(invalid.body.sessionRevoked, true);
    assert.ok(!invalid.cookies.some(line => line.startsWith('munetios_seen=;')), 'the seen cookie survives an invalid session');
    // Later checks, after the dead session cookie is gone, still report the invalid session.
    assert.equal((await request('session', undefined, { ...via('webfilter.munetios.com'), Cookie: seen })).body.sessionRevoked, true);

    // Signing out completely clears the seen cookie, so the next check is plainly signed out.
    const again = await request('signin', { email: 'revoked@example.com', password: 'test revoked login password' }, via('accounts.munetios.com'));
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const fresh = pick(again, '__Secure-munetios-shared-session').split(';')[0];
    const signout = await request('signout', {}, { ...via('mail.munetios.com'), Cookie: `${fresh}; ${seen}` });
    assert.ok(signout.cookies.some(line => line.startsWith('munetios_seen=;') && line.includes('Domain=munetios.com')));
    const out = await request('session', undefined, via('mail.munetios.com'));
    assert.equal(out.body.account, null);
    assert.equal(out.body.sessionRevoked, undefined);
});

test('host-only sessions from before sharing are upgraded to the shared cookie', async t => {
    const database = fixtureDatabase();
    const env = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://beta.munetios.com', AUTH_SHARE_MUNETIOS_SESSION: 'true' };
    const request = await serve(t, { database, trustFixtureProxy: true, env });
    const via = host => ({ 'X-Fixture-Host': host, Origin: 'https://' + host, 'X-Forwarded-Proto': 'https' });
    const signup = await request('signup', { email: 'legacy@example.com', password: 'test legacy login password', displayName: 'Legacy Tester', birthday: '2000-01-01' }, via('accounts.munetios.com'));
    assert.equal(signup.status, 201, JSON.stringify(signup.body));
    const token = signup.cookies.find(line => line.startsWith('__Secure-munetios-shared-session=')).split(';')[0].split('=')[1];
    const upgraded = await request('session', undefined, { ...via('beta.munetios.com'), Cookie: `munetios_session=${token}` });
    assert.equal(upgraded.body.account.email, 'legacy@example.com');
    assert.ok(upgraded.cookies.some(line => line.startsWith('__Secure-munetios-shared-session=' + token) && line.includes('Domain=munetios.com')));
    assert.ok(upgraded.cookies.some(line => line.startsWith('munetios_session=;')), 'the old host-only cookie is removed');
});

test('protected pages open for an invalid session and redirect only when signed out completely', async t => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use((req, res, next) => { req.headers.host = req.get('X-Fixture-Host') || req.headers.host; next(); });
    const auth = createAuthRouter({ database: fixtureDatabase(), env: { NODE_ENV: 'production', AUTH_SHARE_MUNETIOS_SESSION: 'true' } });
    app.get('/mail/', auth.requireBrowserPage('/mail/'), (req, res) => res.send('mail page'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/mail/`;
    const headers = { 'X-Fixture-Host': 'mail.munetios.com', 'X-Forwarded-Proto': 'https' };
    const invalid = await fetch(url, { headers: { ...headers, Cookie: 'munetios_seen=1; __Secure-munetios-shared-session=' + 'a'.repeat(64) }, redirect: 'manual' });
    assert.equal(invalid.status, 200);
    const never = await fetch(url, { headers, redirect: 'manual' });
    assert.equal(never.status, 302);
    assert.match(never.headers.get('location'), /^\/signin\?continue=/);
});
