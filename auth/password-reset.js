'use strict';

const { createHmac, randomBytes, randomInt } = require('node:crypto');
const { normalizeEmail, validEmail, isInternalEmail, secureEqual } = require('./mail');

function passwordReset({ router, env, db, small, throttle, fail, hashPassword, mailTransport, verifySecondFactor }) {
    const hash = (email, value) => createHmac('sha256', env.MAIL_BRIDGE_SECRET).update(`reset:${email}:${value}`).digest('hex');
    const active = 'email = ? AND expires_at > UTC_TIMESTAMP() AND attempts < 5';
    router.post('/password-reset/request', small, throttle, async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        if (!validEmail(email)) return fail(res, 400, 'invalidRequest');
        if (!env.MAIL_BRIDGE_SECRET) return fail(res, 503, 'emailDeliveryUnavailable');
        if (isInternalEmail(email)) return res.json({ ok: true });
        const connection = await db();
        const [[account]] = await connection.execute('SELECT id FROM munetios_accounts WHERE email = ?', [email]);
        if (!account) return res.json({ ok: true });
        const code = String(randomInt(0, 1000000)).padStart(6, '0');
        const token = randomBytes(32).toString('hex');
        const codeHash = hash(email, code), tokenHash = hash(email, token);
        const now = new Date();
        const expires = new Date(now.getTime() + 600000);
        await connection.execute('DELETE FROM munetios_password_resets WHERE email = ? AND sent_at <= ?', [email, new Date(now.getTime() - 60000)]);
        try {
            await connection.execute('INSERT INTO munetios_password_resets (email, code_hash, token_hash, expires_at, sent_at) VALUES (?, ?, ?, ?, ?)', [email, codeHash, tokenHash, expires, now]);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.json({ ok: true });
            throw error;
        }
        try {
            await mailTransport('password-reset', { recipient: email, code, token });
        } catch {
            await connection.execute('DELETE FROM munetios_password_resets WHERE email = ? AND token_hash = ?', [email, tokenHash]);
            return fail(res, 503, 'emailDeliveryUnavailable');
        }
        res.json({ ok: true });
    });

    router.post('/password-reset/complete', small, throttle, async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        const { proof, password, factor } = req.body || {};
        if (!env.MAIL_BRIDGE_SECRET || !validEmail(email) || isInternalEmail(email) || typeof proof !== 'string' ||
            !/^(?:\d{6}|[a-f0-9]{64})$/.test(proof) || !/^[a-f0-9]{64}$/.test(password || '')) return fail(res, 400, 'invalidRequest');
        const connection = await db();
        const [[account]] = await connection.execute('SELECT id, password_hash FROM munetios_accounts WHERE email = ?', [email]);
        const [[reset]] = await connection.execute('SELECT code_hash, token_hash FROM munetios_password_resets WHERE ' + active, [email]);
        const proofHash = hash(email, proof);
        if (!account || !reset || !secureEqual(proofHash, proof.length === 6 ? reset.code_hash : reset.token_hash)) {
            if (proof.length === 6) await connection.execute('UPDATE munetios_password_resets SET attempts = attempts + 1 WHERE ' + active, [email]);
            return fail(res, 400, 'emailCodeInvalid');
        }
        const second = await verifySecondFactor(connection, account.id, factor);
        if (!second.ok) return fail(res, 401, 'twoFactorRequired');
        const newHash = await hashPassword(password);
        const guard = 'EXISTS(SELECT 1 FROM munetios_password_resets WHERE ' + active + ' AND token_hash = ?)';
        const writes = [
            ['UPDATE munetios_accounts SET password_hash = ? WHERE id = ?', [newHash, account.id]],
            ['DELETE FROM munetios_sessions WHERE account_id = ?', [account.id]],
            ['DELETE FROM munetios_password_resets WHERE email = ? AND token_hash = ?', [email, reset.token_hash]],
        ];
        if (connection.atomic) {
            try {
                await connection.atomic([
                    ['INSERT INTO munetios_write_check (value) SELECT ' + guard, [email, reset.token_hash]],
                    ...writes,
                    ['DELETE FROM munetios_write_check'],
                ]);
            } catch (error) {
                if (error.code === 'D1_WRITE_CONFLICT') return fail(res, 400, 'emailCodeInvalid');
                throw error;
            }
        } else {
            const transaction = await connection.getConnection();
            try {
                await transaction.beginTransaction();
                const [[live]] = await transaction.execute('SELECT token_hash FROM munetios_password_resets WHERE ' + active + ' FOR UPDATE', [email]);
                if (!live || !secureEqual(live.token_hash, reset.token_hash)) {
                    await transaction.rollback();
                    return fail(res, 400, 'emailCodeInvalid');
                }
                for (const statement of writes) await transaction.execute(...statement);
                await transaction.commit();
            } catch (error) { await transaction.rollback(); throw error; }
            finally { transaction.release(); }
        }
        res.json({ ok: true });
    });
}

module.exports = { passwordReset };
