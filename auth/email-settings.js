'use strict';

const { normalizeEmail, validEmail, isInternalEmail, createEmailVerification } = require('./mail');
const { verifyCode } = require('./security');

function emailSettings({ router, env, db, small, throttle, fail, requireSession, reauthenticate, verifyPassword, hashPassword, tokenHash, vault, mailTransport, reserved }) {
    const challenge = (purpose, id) => createEmailVerification(env, mailTransport, `${purpose}:${id}`);

    async function available(connection, email) {
        if (reserved(email)) return false;
        const [[account]] = await connection.execute('SELECT id FROM munetios_accounts WHERE email = ?', [email]);
        if (account) return false;
        if (isInternalEmail(email)) {
            const [[retired]] = await connection.execute('SELECT email FROM munetios_retired_addresses WHERE email = ?', [email]);
            if (retired) return false;
        }
        return true;
    }

    router.post('/email-change/code', small, throttle, requireSession, reauthenticate, async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        if (!validEmail(email) || isInternalEmail(email)) return fail(res, 400, 'invalidRequest');
        const { connection, account } = req.session;
        if (!await available(connection, email)) return fail(res, 409, 'createFailed');
        try {
            if (!await challenge('change', account.id).issue(connection, email)) return fail(res, 429, 'emailCodeCooldown');
        } catch { return fail(res, 503, 'emailDeliveryUnavailable'); }
        res.json({ ok: true });
    });

    router.post('/email-change', small, throttle, requireSession, async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        const { password, nextSecret, code, factor } = req.body || {};
        if (!validEmail(email) || typeof password !== 'string' || !/^[a-f0-9]{64}$/.test(password) ||
            typeof nextSecret !== 'string' || !/^[a-f0-9]{64}$/.test(nextSecret)) return fail(res, 400, 'invalidRequest');
        const { account, connection, token } = req.session;
        const [[row]] = await connection.execute('SELECT password_hash FROM munetios_accounts WHERE id = ?', [account.id]);
        if (!row || !await verifyPassword(password, row.password_hash)) return fail(res, 403, 'invalidCredentials');
        if (!await available(connection, email)) return fail(res, 409, 'createFailed');
        const [[security]] = await connection.execute('SELECT * FROM munetios_account_security WHERE account_id = ?', [account.id]);
        const counter = security?.totp_enabled ? verifyCode(vault.open(security.totp_secret, account.id), factor, security.last_counter) : null;
        if (security?.totp_enabled && counter === null) return fail(res, 401, 'twoFactorRequired');
        if (!isInternalEmail(email) && !await challenge('change', account.id).consume(connection, email, code)) return fail(res, 400, 'emailCodeInvalid');
        const newHash = await hashPassword(nextSecret);
        const update = ['UPDATE munetios_accounts SET email = ?, password_hash = ? WHERE id = ? AND email = ? AND password_hash = ?',
            [email, newHash, account.id, account.email, row.password_hash]];
        const writes = [];
        if (isInternalEmail(account.email)) writes.push(['INSERT INTO munetios_retired_addresses (email, account_id) VALUES (?, ?)', [account.email, account.id]]);
        if (isInternalEmail(email)) writes.push(['INSERT INTO munetios_mailboxes (account_id) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM munetios_mailboxes WHERE account_id = ?)', [account.id, account.id]]);
        writes.push(
            ['DELETE FROM munetios_verified_recovery WHERE account_id = ? AND email = ?', [account.id, email]],
            ['DELETE FROM munetios_password_resets WHERE email = ? OR email = ?', [account.email, email]],
            ['DELETE FROM munetios_sessions WHERE account_id = ? AND token_hash <> ?', [account.id, tokenHash(token)]],
        );
        const guard = ['INSERT INTO munetios_write_check (value) SELECT EXISTS(SELECT 1 FROM munetios_accounts WHERE id = ? AND email = ? AND password_hash = ?) AND NOT EXISTS(SELECT 1 FROM munetios_retired_addresses WHERE email = ?)', [account.id, account.email, row.password_hash, email]];
        const factorWrite = ['UPDATE munetios_account_security SET last_counter = ? WHERE account_id = ? AND totp_enabled = 1 AND totp_secret = ? AND last_counter < ?', [counter, account.id, security?.totp_secret || '', counter]];
        try {
            if (connection.atomic) {
                const securityGuard = counter === null
                    ? ['INSERT INTO munetios_write_check (value) SELECT NOT EXISTS(SELECT 1 FROM munetios_account_security WHERE account_id = ? AND totp_enabled = 1)', [account.id]]
                    : ['INSERT INTO munetios_write_check (value) SELECT EXISTS(SELECT 1 FROM munetios_account_security WHERE account_id = ? AND totp_enabled = 1 AND totp_secret = ? AND last_counter < ?)', [account.id, security.totp_secret, counter]];
                await connection.atomic([guard, securityGuard, ...(counter === null ? [] : [factorWrite]), update, ...writes, ['DELETE FROM munetios_write_check']]);
            } else {
                const tx = await connection.getConnection();
                try {
                    await tx.beginTransaction();
                    const [[retired]] = await tx.execute('SELECT email FROM munetios_retired_addresses WHERE email = ? FOR UPDATE', [email]);
                    const [[currentSecurity]] = await tx.execute('SELECT * FROM munetios_account_security WHERE account_id = ? FOR UPDATE', [account.id]);
                    const [updated] = await tx.execute(...update);
                    if (retired || !updated.affectedRows || Boolean(currentSecurity?.totp_enabled) !== (counter !== null) ||
                        (counter !== null && !(await tx.execute(...factorWrite))[0].affectedRows)) throw Object.assign(new Error('Concurrent email change'), { code: 'D1_WRITE_CONFLICT' });
                    for (const write of writes) await tx.execute(...write);
                    await tx.commit();
                } catch (error) { await tx.rollback(); throw error; }
                finally { tx.release(); }
            }
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY' || error.code === 'D1_WRITE_CONFLICT') return fail(res, 409, 'createFailed');
            throw error;
        }
        res.json({ ok: true });
    });

    router.post('/security/recovery-email/code', small, throttle, requireSession, reauthenticate, async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        const { connection, account } = req.session;
        if (!validEmail(email) || isInternalEmail(email) || email === account.email) return fail(res, 400, 'invalidRequest');
        try {
            if (!await challenge('recovery', account.id).issue(connection, email)) return fail(res, 429, 'emailCodeCooldown');
        } catch { return fail(res, 503, 'emailDeliveryUnavailable'); }
        res.json({ ok: true });
    });

    router.post('/security/recovery-email', small, throttle, requireSession, reauthenticate, async (req, res) => {
        const { connection, account } = req.session;
        const email = normalizeEmail(req.body?.email);
        if (req.body?.email === '') {
            await connection.execute('DELETE FROM munetios_verified_recovery WHERE account_id = ?', [account.id]);
            await connection.execute('UPDATE munetios_account_security SET recovery_email = NULL WHERE account_id = ?', [account.id]);
        } else {
            if (!validEmail(email) || isInternalEmail(email) || email === account.email) return fail(res, 400, 'invalidRequest');
            if (!await challenge('recovery', account.id).consume(connection, email, req.body.code)) return fail(res, 400, 'emailCodeInvalid');
            await connection.execute('INSERT INTO munetios_verified_recovery (account_id, email) VALUES (?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email)', [account.id, email]);
            await connection.execute('UPDATE munetios_account_security SET recovery_email = NULL WHERE account_id = ?', [account.id]);
        }
        res.json({ recoveryEmail: email, recoveryVerified: Boolean(email) });
    });

    router.post('/forgot-email', small, throttle, async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        if (!validEmail(email) || isInternalEmail(email)) return fail(res, 400, 'invalidRequest');
        try {
            const connection = await db();
            const [accounts] = await connection.execute('SELECT a.email FROM munetios_verified_recovery r JOIN munetios_accounts a ON a.id = r.account_id WHERE r.email = ? ORDER BY a.id', [email]);
            if (accounts.length) {
                const delivery = createEmailVerification(env, () => mailTransport('forgot-email', { recipient: email, accounts: accounts.map(account => account.email) }), 'forgot');
                await delivery.issue(connection, email);
            }
        } catch (error) { console.warn('[auth] Forgot email delivery failed', error.code || error.name); }
        res.json({ ok: true });
    });
    return { available };
}

module.exports = { emailSettings };
