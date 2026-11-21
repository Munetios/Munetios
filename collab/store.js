'use strict';
/*
 * MySQL storage for Munetios collaboration. The router only talks to this
 * interface, so tests can use an in-memory store with the same methods.
 * Ciphertext and the keys provided for link sharing are stored separately.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

const PART_BYTES = 256 * 1024;
const docKey = id => 'd:' + id;
const suggestionKey = id => 's:' + id;

function splitParts(ciphertext) {
    const parts = [];
    for (let at = 0; at < ciphertext.length; at += PART_BYTES) parts.push(ciphertext.slice(at, at + PART_BYTES));
    return parts.length ? parts : [''];
}

function createMysqlStore({ database, env = process.env }) {
    let schemaReady;
    async function pool() {
        const connection = await database();
        if (!schemaReady) {
            schemaReady = (async () => {
                if (env.AUTH_AUTO_MIGRATE === 'false') return;
                const statements = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
                    .split(';').map(sql => sql.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
                for (const sql of statements) await connection.query(sql);
            })().catch(error => { schemaReady = null; throw error; });
        }
        await schemaReady;
        return connection;
    }
    async function transaction(work) {
        const db = await pool();
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const result = await work(connection);
            await connection.commit();
            return result;
        } catch (error) {
            try { await connection.rollback(); } catch {}
            throw error;
        } finally {
            connection.release();
        }
    }
    async function writeParts(connection, key, ciphertext) {
        await connection.execute('DELETE FROM munetios_collab_parts WHERE owner_key = ?', [key]);
        const parts = splitParts(ciphertext);
        for (let index = 0; index < parts.length; index++) {
            await connection.execute('INSERT INTO munetios_collab_parts (owner_key, part_index, data) VALUES (?, ?, ?)', [key, index, parts[index]]);
        }
    }
    async function readParts(connection, key) {
        const [rows] = await connection.execute('SELECT data FROM munetios_collab_parts WHERE owner_key = ? ORDER BY part_index', [key]);
        return rows.map(row => row.data).join('');
    }
    const person = row => ({
        accountId: String(row.account_id),
        email: row.email,
        displayName: row.display_name || '',
        hasPicture: Boolean(row.has_picture),
    });
    const documentRow = row => row && ({
        id: row.id,
        ownerId: String(row.owner_id),
        kind: row.kind,
        linkAccess: row.link_access,
        locked: Boolean(row.locked),
        version: Number(row.version),
        iv: row.iv,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(row.updated_at) || Date.now(),
    });

    return {
        async listShared(accountId) {
            const db = await pool();
            const [rows] = await db.execute(
                'SELECT d.id, d.kind, m.role, o.email, p.display_name FROM munetios_collab_members m ' +
                'JOIN munetios_collab_documents d ON d.id = m.document_id JOIN munetios_accounts o ON o.id = d.owner_id ' +
                'LEFT JOIN munetios_profiles p ON p.account_id = d.owner_id WHERE m.account_id = ? ORDER BY m.added_at DESC', [accountId]);
            return rows.map(row => ({ id: row.id, kind: row.kind, role: row.role, owner: row.display_name || row.email.split('@')[0] }));
        },
        async getInvitationKey(id, accountId) {
            const db = await pool();
            const [rows] = await db.execute(
                "SELECT k.content_key FROM munetios_collab_link_keys k JOIN munetios_collab_documents d ON d.id = k.document_id " +
                "JOIN munetios_collab_members m ON m.document_id = d.id WHERE d.id = ? AND m.account_id = ? AND d.locked = 0 AND d.link_access <> 'off'",
                [id, accountId]);
            return rows[0]?.content_key || null;
        },
        async createDocument({ id, ownerId, kind, iv, ciphertext }) {
            await transaction(async connection => {
                await connection.execute('INSERT INTO munetios_collab_documents (id, owner_id, kind, iv) VALUES (?, ?, ?, ?)', [id, ownerId, kind, iv]);
                await writeParts(connection, docKey(id), ciphertext);
            });
        },
        async getDocument(id) {
            const db = await pool();
            const [rows] = await db.execute('SELECT id, owner_id, kind, link_access, locked, version, iv, updated_at FROM munetios_collab_documents WHERE id = ?', [id]);
            return documentRow(rows[0]) || null;
        },
        async getContent(id) {
            return readParts(await pool(), docKey(id));
        },
        // Returns the new version, or null when baseVersion is no longer current.
        async updateContent(id, baseVersion, iv, ciphertext) {
            return transaction(async connection => {
                const [rows] = await connection.execute('SELECT version, locked FROM munetios_collab_documents WHERE id = ? FOR UPDATE', [id]);
                if (!rows[0] || Number(rows[0].version) !== baseVersion || rows[0].locked) return null;
                await connection.execute('UPDATE munetios_collab_documents SET version = version + 1, iv = ? WHERE id = ?', [iv, id]);
                await writeParts(connection, docKey(id), ciphertext);
                return baseVersion + 1;
            });
        },
        async updateSettings(id, { linkAccess, locked, contentKey }) {
            return transaction(async connection => {
                if (linkAccess !== undefined) {
                    const [rows] = await connection.execute('SELECT id FROM munetios_collab_documents WHERE id = ? FOR UPDATE', [id]);
                    if (!rows.length) return false;
                    await connection.execute('UPDATE munetios_collab_documents SET link_access = ? WHERE id = ?', [linkAccess, id]);
                    if (linkAccess === 'off') {
                        await connection.execute('DELETE FROM munetios_collab_link_keys WHERE document_id = ?', [id]);
                    } else if (contentKey) {
                        await connection.execute('INSERT INTO munetios_collab_link_keys (document_id, content_key) VALUES (?, ?) ON DUPLICATE KEY UPDATE content_key = ?', [id, contentKey, contentKey]);
                    }
                }
                if (locked !== undefined) await connection.execute('UPDATE munetios_collab_documents SET locked = ? WHERE id = ?', [locked ? 1 : 0, id]);
                return true;
            });
        },
        async deleteDocument(id) {
            await transaction(async connection => {
                const [suggestions] = await connection.execute('SELECT id FROM munetios_collab_suggestions WHERE document_id = ?', [id]);
                for (const row of suggestions) await connection.execute('DELETE FROM munetios_collab_parts WHERE owner_key = ?', [suggestionKey(row.id)]);
                await connection.execute('DELETE FROM munetios_collab_parts WHERE owner_key = ?', [docKey(id)]);
                await connection.execute('DELETE FROM munetios_collab_documents WHERE id = ?', [id]);
            });
        },
        async people(accountIds) {
            const ids = [...new Set(accountIds.map(String))].filter(id => /^\d+$/.test(id));
            if (!ids.length) return [];
            const db = await pool();
            const [rows] = await db.execute(
                'SELECT a.id AS account_id, a.email, p.display_name, (v.account_id IS NOT NULL) AS has_picture FROM munetios_accounts a ' +
                'LEFT JOIN munetios_profiles p ON p.account_id = a.id LEFT JOIN munetios_profile_pictures v ON v.account_id = a.id ' +
                'WHERE a.id IN (' + ids.map(() => '?').join(', ') + ')', ids);
            return rows.map(person);
        },
        async listMembers(id) {
            const db = await pool();
            const [rows] = await db.execute(
                'SELECT m.account_id, m.role, a.email, p.display_name, (v.account_id IS NOT NULL) AS has_picture FROM munetios_collab_members m ' +
                'JOIN munetios_accounts a ON a.id = m.account_id LEFT JOIN munetios_profiles p ON p.account_id = a.id ' +
                'LEFT JOIN munetios_profile_pictures v ON v.account_id = a.id WHERE m.document_id = ? ORDER BY m.added_at, m.account_id', [id]);
            return rows.map(row => ({ ...person(row), role: row.role }));
        },
        async getMemberRole(id, accountId) {
            const db = await pool();
            const [rows] = await db.execute('SELECT role FROM munetios_collab_members WHERE document_id = ? AND account_id = ?', [id, accountId]);
            return rows[0]?.role || null;
        },
        async upsertMember(id, accountId, role) {
            const db = await pool();
            await db.execute('INSERT INTO munetios_collab_members (document_id, account_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)', [id, accountId, role]);
        },
        async removeMember(id, accountId) {
            const db = await pool();
            const [result] = await db.execute('DELETE FROM munetios_collab_members WHERE document_id = ? AND account_id = ?', [id, accountId]);
            return Boolean(result.affectedRows);
        },
        async getPicture(accountId) {
            const db = await pool();
            const [rows] = await db.execute('SELECT picture FROM munetios_profile_pictures WHERE account_id = ?', [accountId]);
            return rows[0]?.picture || null;
        },
        async saveSuggestion({ documentId, accountId, baseVersion, iv, ciphertext }) {
            return transaction(async connection => {
                const [rows] = await connection.execute("SELECT id FROM munetios_collab_suggestions WHERE document_id = ? AND account_id = ? AND status = 'open' FOR UPDATE", [documentId, accountId]);
                let id = rows[0]?.id;
                if (id) {
                    await connection.execute('UPDATE munetios_collab_suggestions SET base_version = ?, iv = ? WHERE id = ?', [baseVersion, iv, id]);
                } else {
                    const [result] = await connection.execute('INSERT INTO munetios_collab_suggestions (document_id, account_id, base_version, iv) VALUES (?, ?, ?, ?)', [documentId, accountId, baseVersion, iv]);
                    id = result.insertId;
                }
                await writeParts(connection, suggestionKey(id), ciphertext);
                return String(id);
            });
        },
        async listSuggestions(documentId, accountId) {
            const db = await pool();
            const [rows] = await db.execute(
                "SELECT s.id, s.account_id, s.base_version, s.updated_at, a.email, p.display_name, (v.account_id IS NOT NULL) AS has_picture FROM munetios_collab_suggestions s " +
                'JOIN munetios_accounts a ON a.id = s.account_id LEFT JOIN munetios_profiles p ON p.account_id = a.id LEFT JOIN munetios_profile_pictures v ON v.account_id = a.id ' +
                "WHERE s.document_id = ? AND s.status = 'open'" + (accountId ? ' AND s.account_id = ?' : '') + ' ORDER BY s.updated_at DESC, s.id DESC',
                accountId ? [documentId, accountId] : [documentId]);
            return rows.map(row => ({
                id: String(row.id), baseVersion: Number(row.base_version),
                updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(row.updated_at) || Date.now(),
                author: person(row),
            }));
        },
        async getSuggestion(documentId, id) {
            const db = await pool();
            const [rows] = await db.execute("SELECT id, account_id, base_version, iv FROM munetios_collab_suggestions WHERE id = ? AND document_id = ? AND status = 'open'", [id, documentId]);
            if (!rows[0]) return null;
            return { id: String(rows[0].id), accountId: String(rows[0].account_id), baseVersion: Number(rows[0].base_version), iv: rows[0].iv, ciphertext: await readParts(db, suggestionKey(id)) };
        },
        async resolveSuggestion(documentId, id, status) {
            return transaction(async connection => {
                const [result] = await connection.execute("UPDATE munetios_collab_suggestions SET status = ? WHERE id = ? AND document_id = ? AND status = 'open'", [status, id, documentId]);
                if (result.affectedRows) await connection.execute('DELETE FROM munetios_collab_parts WHERE owner_key = ?', [suggestionKey(id)]);
                return Boolean(result.affectedRows);
            });
        },
        async listComments(documentId) {
            const db = await pool();
            const [rows] = await db.execute(
                'SELECT c.id, t.parent_id, t.resolved, t.resolved_at, c.account_id, c.iv, c.ciphertext, c.created_at, a.email, p.display_name, (v.account_id IS NOT NULL) AS has_picture FROM munetios_collab_comments c ' +
                'LEFT JOIN munetios_collab_comment_threads t ON t.comment_id = c.id ' +
                'LEFT JOIN munetios_accounts a ON a.id = c.account_id LEFT JOIN munetios_profiles p ON p.account_id = c.account_id ' +
                'LEFT JOIN munetios_profile_pictures v ON v.account_id = c.account_id WHERE c.document_id = ? ORDER BY c.id', [documentId]);
            const time = value => (value instanceof Date ? value.getTime() : value ? Date.parse(value) || null : null);
            return rows.map(row => ({
                id: String(row.id), parentId: row.parent_id ? String(row.parent_id) : null, iv: row.iv, ciphertext: row.ciphertext,
                resolved: Boolean(row.resolved), resolvedAt: time(row.resolved_at),
                createdAt: time(row.created_at) || Date.now(),
                author: row.account_id && row.email ? person(row) : null,
            }));
        },
        // A reply to a resolved thread reopens it.
        async addComment({ documentId, parentId = null, accountId, tokenHash, iv, ciphertext }) {
            return transaction(async connection => {
                const [result] = await connection.execute('INSERT INTO munetios_collab_comments (document_id, account_id, token_hash, iv, ciphertext) VALUES (?, ?, ?, ?, ?)',
                    [documentId, accountId, tokenHash, iv, ciphertext]);
                if (parentId) {
                    await connection.execute('INSERT INTO munetios_collab_comment_threads (comment_id, parent_id) VALUES (?, ?)', [result.insertId, parentId]);
                    await connection.execute('UPDATE munetios_collab_comment_threads SET resolved = 0, resolved_at = NULL WHERE comment_id = ?', [parentId]);
                }
                return String(result.insertId);
            });
        },
        async getComment(documentId, id) {
            const db = await pool();
            const [rows] = await db.execute('SELECT c.id, t.parent_id, t.resolved, c.account_id, c.token_hash FROM munetios_collab_comments c ' +
                'LEFT JOIN munetios_collab_comment_threads t ON t.comment_id = c.id WHERE c.id = ? AND c.document_id = ?', [id, documentId]);
            const row = rows[0];
            return row ? {
                id: String(row.id), parentId: row.parent_id ? String(row.parent_id) : null, resolved: Boolean(row.resolved),
                accountId: row.account_id ? String(row.account_id) : null, tokenHash: row.token_hash || null,
            } : null;
        },
        // Callers check that id is a thread (not a reply) in documentId.
        async setCommentResolved(documentId, id, resolved) {
            const db = await pool();
            const [result] = await db.execute(
                'INSERT INTO munetios_collab_comment_threads (comment_id, resolved, resolved_at) VALUES (?, ?, ' + (resolved ? 'UTC_TIMESTAMP()' : 'NULL') + ') ' +
                'ON DUPLICATE KEY UPDATE resolved = VALUES(resolved), resolved_at = VALUES(resolved_at)', [id, resolved ? 1 : 0]);
            return Boolean(result.affectedRows);
        },
        // Deleting a thread also deletes its replies.
        async deleteComment(documentId, id) {
            return transaction(async connection => {
                await connection.execute('DELETE c FROM munetios_collab_comments c JOIN munetios_collab_comment_threads t ON t.comment_id = c.id WHERE t.parent_id = ? AND c.document_id = ?', [id, documentId]);
                const [result] = await connection.execute('DELETE FROM munetios_collab_comments WHERE id = ? AND document_id = ?', [id, documentId]);
                return Boolean(result.affectedRows);
            });
        },
        async isCommentAuthor(documentId, accountId) {
            const db = await pool();
            const [rows] = await db.execute('SELECT 1 FROM munetios_collab_comments WHERE document_id = ? AND account_id = ? LIMIT 1', [documentId, accountId]);
            return rows.length > 0;
        },
        async createReport(report) {
            const db = await pool();
            const [result] = await db.execute(
                'INSERT INTO munetios_collab_reports (document_id, document_kind, owner_id, reporter_id, reporter_ip_hash, reason, details, review_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [report.documentId, report.kind, report.ownerId, report.reporterId, report.ipHash, report.reason, report.details, report.reviewKey]);
            return String(result.insertId);
        },
    };
}

module.exports = { createMysqlStore, splitParts, PART_BYTES };
