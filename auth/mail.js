'use strict';

const { createHmac, randomInt, timingSafeEqual } = require('node:crypto');

const EMAIL = /^[!-~]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = email => email.length <= 254 && EMAIL.test(email) && !/[<>(),;:"\[\]\\]/.test(email) && email.indexOf('@') === email.lastIndexOf('@');
const isInternalEmail = email => email.endsWith('@munetios.com');
const digest = (secret, message) => createHmac('sha256', secret).update(message).digest('hex');
const systemMailboxes = [
    'abuse', 'admin', 'administrator', 'billing', 'contact', 'hostmaster', 'info', 'mail', 'mailer-daemon',
    'accounts', 'compliance', 'customer-service', 'dmarc', 'feedback', 'help', 'helpdesk', 'legal', 'no-reply', 'noreply',
    'notifications', 'postmaster', 'press', 'privacy', 'report', 'reports', 'root', 'safety', 'sales', 'security',
    'service', 'support', 'trust', 'verify', 'webmaster',
];

function isReservedMailbox(email, names) {
    if (!isInternalEmail(email)) return false;
    const local = email.split('@')[0].split('+')[0];
    return local.startsWith('inbox-') || names.has(local) || [...names].some(name => name.replace(/[._-]/g, '') === local.replace(/[._-]/g, ''));
}

function reservedPersonalMailboxes(env) {
    return new Set([
        ...systemMailboxes,
        ...String(env.MUNETIOS_RESERVED_MAILBOXES || '').split(','),
        env.MAIL_VERIFICATION_FROM,
    ].map(value => normalizeEmail(value).replace(/@munetios\.com$/, '').split('+')[0]).filter(Boolean));
}

function secureEqual(left, right) {
    const a = Buffer.from(typeof left === 'string' ? left : '');
    const b = Buffer.from(typeof right === 'string' ? right : '');
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function createMailTransport(env) {
    return async (action, payload) => {
        if (!env.MAIL_BRIDGE_SECRET || !env.MAIL_WORKER_URL) throw new Error('MAIL_NOT_CONFIGURED');
        const url = new URL('/' + action, env.MAIL_WORKER_URL);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
            throw new Error('MAIL_INSECURE_ORIGIN');
        }
        const transport = env.MUNETIOS_MAIL ? env.MUNETIOS_MAIL.fetch.bind(env.MUNETIOS_MAIL) : fetch;
        const response = await transport(url, {
            method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(12000),
            headers: { Authorization: 'Bearer ' + env.MAIL_BRIDGE_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('MAIL_DELIVERY_FAILED');
        return response.json();
    };
}

function createEmailVerification(env, send, purpose = 'signup') {
    const codeHash = (email, code) => digest(env.MAIL_BRIDGE_SECRET, purpose + ':' + email + ':' + code);
    const storageKey = email => purpose === 'signup' ? email : `${purpose.split(':')[0]}:${digest(env.MAIL_BRIDGE_SECRET, purpose + ':' + email)}`;
    return {
        async issue(connection, email) {
            if (!env.MAIL_BRIDGE_SECRET) throw new Error('MAIL_NOT_CONFIGURED');
            const code = String(randomInt(0, 1000000)).padStart(6, '0');
            const hash = codeHash(email, code);
            const key = storageKey(email);
            await connection.execute(
                'INSERT INTO munetios_email_codes (email, code_hash, attempts, expires_at, sent_at) VALUES (?, ?, 0, UTC_TIMESTAMP() + INTERVAL 10 MINUTE, UTC_TIMESTAMP()) ' +
                'ON DUPLICATE KEY UPDATE code_hash = IF(sent_at <= UTC_TIMESTAMP() - INTERVAL 60 SECOND, VALUES(code_hash), code_hash), ' +
                'attempts = IF(sent_at <= UTC_TIMESTAMP() - INTERVAL 60 SECOND, 0, attempts), ' +
                'expires_at = IF(sent_at <= UTC_TIMESTAMP() - INTERVAL 60 SECOND, VALUES(expires_at), expires_at), ' +
                'sent_at = IF(sent_at <= UTC_TIMESTAMP() - INTERVAL 60 SECOND, VALUES(sent_at), sent_at)', [key, hash]);
            const [[current]] = await connection.execute('SELECT code_hash FROM munetios_email_codes WHERE email = ?', [key]);
            if (!current || !secureEqual(current.code_hash, hash)) return false;
            try {
                await send('verification', { recipient: email, code });
            } catch (error) {
                await connection.execute('DELETE FROM munetios_email_codes WHERE email = ? AND code_hash = ?', [key, hash]);
                throw error;
            }
            return true;
        },
        async consume(connection, email, code) {
            if (!env.MAIL_BRIDGE_SECRET || typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
            const hash = codeHash(email, code);
            const key = storageKey(email);
            const [used] = await connection.execute(
                'DELETE FROM munetios_email_codes WHERE email = ? AND code_hash = ? AND expires_at > UTC_TIMESTAMP() AND attempts < 5', [key, hash]);
            if (used.affectedRows === 1) return true;
            await connection.execute(
                'UPDATE munetios_email_codes SET attempts = attempts + 1 WHERE email = ? AND code_hash <> ? AND expires_at > UTC_TIMESTAMP() AND attempts < 5', [key, hash]);
            return false;
        },
    };
}

module.exports = { normalizeEmail, validEmail, isInternalEmail, secureEqual, reservedPersonalMailboxes, isReservedMailbox, createMailTransport, createEmailVerification };
