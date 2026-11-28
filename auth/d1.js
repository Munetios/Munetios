'use strict';

const conflictColumns = {
    munetios_account_keys: 'account_id',
    munetios_account_security: 'account_id',
    munetios_verified_recovery: 'account_id',
    munetios_profiles: 'account_id',
    munetios_account_appearance: 'account_id',
    munetios_profile_birthdays: 'account_id',
    munetios_profile_pictures: 'account_id',
    munetios_profile_picture_privacy: 'account_id',
    munetios_sync_items: 'account_id, item_key',
};

function sqliteSql(sql) {
    if (sql.startsWith('INSERT INTO munetios_email_codes')) {
        return "INSERT INTO munetios_email_codes (email, code_hash, attempts, expires_at, sent_at) VALUES (?, ?, 0, datetime('now', '+10 minutes'), CURRENT_TIMESTAMP) " +
            "ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at, sent_at = excluded.sent_at " +
            "WHERE munetios_email_codes.sent_at <= datetime('now', '-60 seconds')";
    }
    if (sql.endsWith('ON DUPLICATE KEY UPDATE message_key = munetios_mail_messages.message_key')) {
        return sql.replace('ON DUPLICATE KEY UPDATE message_key = munetios_mail_messages.message_key',
            'ON CONFLICT (account_id, direction, message_key) DO NOTHING');
    }
    if (sql.endsWith('ON DUPLICATE KEY UPDATE html = VALUES(html)')) {
        return sql.replace('ON DUPLICATE KEY UPDATE html = VALUES(html)', 'ON CONFLICT (message_id) DO UPDATE SET html = excluded.html');
    }
    if (sql.includes('DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)')) {
        return "INSERT INTO munetios_account_security (account_id, totp_secret, setup_expires) VALUES (?, ?, datetime('now', '+10 minutes')) " +
            'ON CONFLICT (account_id) DO UPDATE SET totp_secret = excluded.totp_secret, setup_expires = excluded.setup_expires WHERE totp_enabled = 0';
    }
    let query = sql.replaceAll('UTC_TIMESTAMP()', 'CURRENT_TIMESTAMP')
        .replace("CONCAT(?, '%')", "(? || '%')")
        // D1 rejects LIKE/GLOB patterns over 50 characters (workspace sync prefixes are longer),
        // so a prefix is matched as a key range instead: exact and able to use the primary key.
        .replace('item_key LIKE ? ORDER BY', 'item_key >= ? AND item_key < ? ORDER BY');
    if (query.includes('ON DUPLICATE KEY UPDATE')) {
        const table = /^INSERT INTO (\w+)/.exec(query)?.[1];
        const columns = conflictColumns[table];
        if (!columns) throw new Error('Missing D1 conflict target');
        query = query.replace('ON DUPLICATE KEY UPDATE', 'ON CONFLICT (' + columns + ') DO UPDATE SET')
            .replace(/VALUES\((\w+)\)/g, 'excluded.$1');
        if (['munetios_account_keys', 'munetios_profiles', 'munetios_profile_pictures', 'munetios_sync_items'].includes(table)) {
            query += ', updated_at = CURRENT_TIMESTAMP';
        }
    }
    return query;
}

function sqlParam(value) {
    return value instanceof Date ? value.toISOString().slice(0, 19).replace('T', ' ') : value;
}

function output(sql, result) {
    if (/^SELECT\b/.test(sql)) {
        return [result.results.map(row => {
            for (const field of ['created_at', 'createdAt', 'setup_expires']) {
                if (typeof row[field] === 'string') row[field] = new Date(row[field].replace(' ', 'T') + 'Z');
            }
            return row;
        })];
    }
    return [{ affectedRows: result.meta.changes, insertId: result.meta.last_row_id }];
}

function normalizeError(error) {
    if (/UNIQUE constraint failed/.test(error.message)) error.code = 'ER_DUP_ENTRY';
    else if (/CHECK constraint failed: munetios_expected_write/.test(error.message)) error.code = 'D1_WRITE_CONFLICT';
    return error;
}

function createD1AuthDatabase(binding) {
    const prepare = (sql, values = []) => {
        const statement = binding.prepare(sqliteSql(sql));
        const params = values.map(sqlParam);
        if (sql.includes('item_key LIKE ? ORDER BY')) {
            // The router sends an escaped LIKE pattern ("prefix%"); turn it back into the plain prefix.
            const prefix = params[2].slice(0, -1).replace(/\\([\\%_])/g, '$1');
            params.splice(2, 1, prefix, prefix + '\uffff');
        }
        return params.length ? statement.bind(...params) : statement;
    };
    return {
        async execute(sql, values) {
            try { return output(sql, await prepare(sql, values).run()); }
            catch (error) { throw normalizeError(error); }
        },
        async atomic(statements) {
            try {
                const results = await binding.batch(statements.map(([sql, values]) => prepare(sql, values)));
                return results.map((result, index) => output(statements[index][0], result)[0]);
            } catch (error) {
                throw normalizeError(error);
            }
        },
    };
}

module.exports = { createD1AuthDatabase };
