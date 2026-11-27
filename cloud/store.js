'use strict';
/*
 * Storage for Munetios Cloud (Calendar and Photos).
 *  - createMysqlStore: spaces, members, and blob records in MySQL, chunk bytes on disk.
 *  - createMemoryStore: the same interface in memory, for tests and local experiments.
 * The router only talks to this interface.
 */
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const PART_BYTES = 256 * 1024;
const BLOB_ID = /^[A-Za-z0-9_-]{22}$/;
const publicPicturePredicate = 'NOT EXISTS (SELECT 1 FROM munetios_profile_picture_privacy q WHERE q.account_id = v.account_id AND q.show_to_everyone = 0)';
const publicPictureJoin = 'LEFT JOIN munetios_profile_pictures v ON v.account_id = a.id AND ' + publicPicturePredicate + ' ';

function splitParts(ciphertext) {
    const parts = [];
    for (let at = 0; at < ciphertext.length; at += PART_BYTES) parts.push(ciphertext.slice(at, at + PART_BYTES));
    return parts.length ? parts : [''];
}

/* Chunk bytes on disk: <dir>/<first two id characters>/<blob id>/<index>.bin */
function createDiskChunks(dir) {
    const folder = id => {
        if (!BLOB_ID.test(id)) throw new Error('invalidBlob');
        return path.join(dir, id.slice(0, 2), id);
    };
    return {
        async put(id, index, buffer) {
            const target = folder(id);
            await fs.mkdir(target, { recursive: true });
            const file = path.join(target, `${index}.bin`);
            const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
            await fs.writeFile(temp, buffer);
            await fs.rename(temp, file);
        },
        async get(id, index) {
            try { return await fs.readFile(path.join(folder(id), `${index}.bin`)); } catch (error) {
                if (error.code === 'ENOENT') return null;
                throw error;
            }
        },
        async remove(id) {
            await fs.rm(folder(id), { recursive: true, force: true });
        },
    };
}

function createMysqlStore({ database, env = process.env, dataDir }) {
    const chunks = createDiskChunks(dataDir || env.CLOUD_DATA_DIR || path.join(__dirname, 'data', 'blobs'));
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
    async function writeParts(connection, id, ciphertext) {
        await connection.execute('DELETE FROM munetios_cloud_parts WHERE space_id = ?', [id]);
        const parts = splitParts(ciphertext);
        for (let index = 0; index < parts.length; index++) {
            await connection.execute('INSERT INTO munetios_cloud_parts (space_id, part_index, data) VALUES (?, ?, ?)', [id, index, parts[index]]);
        }
    }
    const person = row => ({ accountId: String(row.account_id), email: row.email, displayName: row.display_name || '', hasPicture: Boolean(row.has_picture) });
    const spaceRow = row => row && ({
        id: row.id, ownerId: String(row.owner_id), kind: row.kind, version: Number(row.version), iv: row.iv, key: row.space_key,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(row.updated_at) || Date.now(),
    });
    const blobRow = row => row && ({
        id: row.id, ownerId: String(row.owner_id), size: Number(row.size), chunkSize: Number(row.chunk_size),
        chunkCount: Number(row.chunk_count), status: row.status,
    });

    return {
        chunks,
        async listSpaces(accountId, kind) {
            const db = await pool();
            const [rows] = await db.execute(
                "SELECT s.id, s.kind, s.version, s.updated_at, s.owner_id, 'owner' AS role FROM munetios_cloud_spaces s WHERE s.owner_id = ? AND s.kind = ? " +
                'UNION ALL SELECT s.id, s.kind, s.version, s.updated_at, s.owner_id, m.role FROM munetios_cloud_members m JOIN munetios_cloud_spaces s ON s.id = m.space_id WHERE m.account_id = ? AND s.kind = ? ' +
                'ORDER BY updated_at DESC', [accountId, kind, accountId, kind]);
            return rows.map(row => ({ ...spaceRow(row), role: row.role }));
        },
        async createSpace({ id, ownerId, kind, iv, ciphertext, key }) {
            await transaction(async connection => {
                await connection.execute('INSERT INTO munetios_cloud_spaces (id, owner_id, kind, iv, space_key) VALUES (?, ?, ?, ?, ?)', [id, ownerId, kind, iv, key]);
                await writeParts(connection, id, ciphertext);
            });
        },
        async getSpace(id) {
            const db = await pool();
            const [rows] = await db.execute('SELECT * FROM munetios_cloud_spaces WHERE id = ?', [id]);
            return spaceRow(rows[0]);
        },
        async getContent(id) {
            const db = await pool();
            const [rows] = await db.execute('SELECT data FROM munetios_cloud_parts WHERE space_id = ? ORDER BY part_index', [id]);
            return rows.map(row => row.data).join('');
        },
        async updateContent(id, baseVersion, iv, ciphertext) {
            return transaction(async connection => {
                const [result] = await connection.execute('UPDATE munetios_cloud_spaces SET version = version + 1, iv = ? WHERE id = ? AND version = ?', [iv, id, baseVersion]);
                if (!result.affectedRows) return null;
                await writeParts(connection, id, ciphertext);
                return baseVersion + 1;
            });
        },
        async deleteSpace(id) {
            const db = await pool();
            await db.execute('DELETE FROM munetios_cloud_spaces WHERE id = ?', [id]);
        },
        async getMemberRole(id, accountId) {
            const db = await pool();
            const [rows] = await db.execute('SELECT role FROM munetios_cloud_members WHERE space_id = ? AND account_id = ?', [id, accountId]);
            return rows[0]?.role || null;
        },
        async listMembers(id) {
            const db = await pool();
            const [rows] = await db.execute(
                'SELECT m.account_id, m.role, a.email, p.display_name, (v.account_id IS NOT NULL) AS has_picture FROM munetios_cloud_members m ' +
                'JOIN munetios_accounts a ON a.id = m.account_id LEFT JOIN munetios_profiles p ON p.account_id = a.id ' +
                publicPictureJoin + 'WHERE m.space_id = ? ORDER BY m.added_at, m.account_id', [id]);
            return rows.map(row => ({ ...person(row), role: row.role }));
        },
        async people(accountIds) {
            const ids = [...new Set(accountIds.map(String))].filter(id => /^\d+$/.test(id));
            if (!ids.length) return [];
            const db = await pool();
            const [rows] = await db.execute(
                'SELECT a.id AS account_id, a.email, p.display_name, (v.account_id IS NOT NULL) AS has_picture FROM munetios_accounts a ' +
                'LEFT JOIN munetios_profiles p ON p.account_id = a.id ' + publicPictureJoin +
                'WHERE a.id IN (' + ids.map(() => '?').join(', ') + ')', ids);
            return rows.map(person);
        },
        async upsertMember(id, accountId, role) {
            const db = await pool();
            await db.execute('INSERT INTO munetios_cloud_members (space_id, account_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)', [id, accountId, role]);
        },
        async removeMember(id, accountId) {
            const db = await pool();
            const [result] = await db.execute('DELETE FROM munetios_cloud_members WHERE space_id = ? AND account_id = ?', [id, accountId]);
            return Boolean(result.affectedRows);
        },
        async createBlob({ id, ownerId, size, chunkSize, chunkCount }) {
            const db = await pool();
            await db.execute('INSERT INTO munetios_cloud_blobs (id, owner_id, size, chunk_size, chunk_count) VALUES (?, ?, ?, ?, ?)', [id, ownerId, size, chunkSize, chunkCount]);
        },
        async getBlob(id) {
            const db = await pool();
            const [rows] = await db.execute('SELECT * FROM munetios_cloud_blobs WHERE id = ?', [id]);
            return blobRow(rows[0]);
        },
        async markChunk(id, index, bytes) {
            const db = await pool();
            await db.execute('INSERT INTO munetios_cloud_blob_chunks (blob_id, chunk_index, bytes) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE bytes = VALUES(bytes)', [id, index, bytes]);
        },
        async listChunks(id) {
            const db = await pool();
            const [rows] = await db.execute('SELECT chunk_index, bytes FROM munetios_cloud_blob_chunks WHERE blob_id = ? ORDER BY chunk_index', [id]);
            return rows.map(row => ({ index: Number(row.chunk_index), bytes: Number(row.bytes) }));
        },
        async completeBlob(id) {
            const db = await pool();
            await db.execute("UPDATE munetios_cloud_blobs SET status = 'ready', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
        },
        async deleteBlob(id) {
            const db = await pool();
            await db.execute('DELETE FROM munetios_cloud_blobs WHERE id = ?', [id]);
            await chunks.remove(id);
        },
        async usage(accountId) {
            const db = await pool();
            const [[row]] = await db.execute('SELECT COALESCE(SUM(size), 0) AS used, COUNT(*) AS items FROM munetios_cloud_blobs WHERE owner_id = ?', [accountId]);
            return { used: Number(row.used), items: Number(row.items) };
        },
        async canReadBlob(blobId, accountId) {
            const db = await pool();
            const [rows] = await db.execute(
                'SELECT 1 FROM munetios_cloud_space_blobs sb JOIN munetios_cloud_spaces s ON s.id = sb.space_id ' +
                'LEFT JOIN munetios_cloud_members m ON m.space_id = s.id AND m.account_id = ? ' +
                'WHERE sb.blob_id = ? AND (s.owner_id = ? OR m.account_id IS NOT NULL) LIMIT 1', [accountId, blobId, accountId]);
            return rows.length > 0;
        },
        async linkBlob(spaceId, blobId, accountId) {
            const db = await pool();
            await db.execute('INSERT IGNORE INTO munetios_cloud_space_blobs (space_id, blob_id, added_by) VALUES (?, ?, ?)', [spaceId, blobId, accountId]);
        },
        async unlinkBlob(spaceId, blobId) {
            const db = await pool();
            const [result] = await db.execute('DELETE FROM munetios_cloud_space_blobs WHERE space_id = ? AND blob_id = ?', [spaceId, blobId]);
            return Boolean(result.affectedRows);
        },
        async spaceBlobOwner(spaceId, blobId) {
            const db = await pool();
            const [rows] = await db.execute('SELECT added_by FROM munetios_cloud_space_blobs WHERE space_id = ? AND blob_id = ?', [spaceId, blobId]);
            return rows[0] ? String(rows[0].added_by) : null;
        },
    };
}

function createMemoryStore({ accounts = [] } = {}) {
    const spaces = new Map(), members = new Map(), blobs = new Map(), received = new Map(), links = new Map(), bytes = new Map();
    const memberKey = (id, accountId) => `${id}:${accountId}`;
    const people = ids => accounts.filter(account => ids.map(String).includes(String(account.id)))
        .map(account => ({ accountId: String(account.id), email: account.email, displayName: account.displayName || '', hasPicture: false }));
    return {
        accounts,
        chunks: {
            async put(id, index, buffer) { bytes.set(`${id}:${index}`, Buffer.from(buffer)); },
            async get(id, index) { return bytes.get(`${id}:${index}`) || null; },
            async remove(id) { for (const key of [...bytes.keys()]) if (key.startsWith(`${id}:`)) bytes.delete(key); },
        },
        async listSpaces(accountId, kind) {
            const list = [];
            for (const space of spaces.values()) {
                if (space.kind !== kind) continue;
                const role = space.ownerId === String(accountId) ? 'owner' : members.get(memberKey(space.id, accountId))?.role;
                if (role) list.push({ ...space, role });
            }
            return list.sort((a, b) => b.updatedAt - a.updatedAt);
        },
        async createSpace({ id, ownerId, kind, iv, ciphertext, key }) {
            spaces.set(id, { id, ownerId: String(ownerId), kind, version: 1, iv, key, ciphertext, updatedAt: Date.now() });
        },
        async getSpace(id) { const space = spaces.get(id); return space ? { ...space } : null; },
        async getContent(id) { return spaces.get(id)?.ciphertext ?? ''; },
        async updateContent(id, baseVersion, iv, ciphertext) {
            const space = spaces.get(id);
            if (!space || space.version !== baseVersion) return null;
            Object.assign(space, { version: baseVersion + 1, iv, ciphertext, updatedAt: Date.now() });
            return space.version;
        },
        async deleteSpace(id) {
            spaces.delete(id);
            for (const key of [...members.keys()]) if (key.startsWith(`${id}:`)) members.delete(key);
            for (const key of [...links.keys()]) if (key.startsWith(`${id}:`)) links.delete(key);
        },
        async getMemberRole(id, accountId) { return members.get(memberKey(id, accountId))?.role || null; },
        async listMembers(id) {
            return [...members.values()].filter(member => member.spaceId === id)
                .map(member => ({ ...people([member.accountId])[0], role: member.role }));
        },
        async people(ids) { return people(ids); },
        async upsertMember(id, accountId, role) { members.set(memberKey(id, accountId), { spaceId: id, accountId: String(accountId), role }); },
        async removeMember(id, accountId) { return members.delete(memberKey(id, accountId)); },
        async createBlob({ id, ownerId, size, chunkSize, chunkCount }) { blobs.set(id, { id, ownerId: String(ownerId), size, chunkSize, chunkCount, status: 'uploading' }); received.set(id, new Map()); },
        async getBlob(id) { const blob = blobs.get(id); return blob ? { ...blob } : null; },
        async markChunk(id, index, size) { received.get(id)?.set(index, size); },
        async listChunks(id) { return [...(received.get(id) || new Map())].map(([index, size]) => ({ index, bytes: size })).sort((a, b) => a.index - b.index); },
        async completeBlob(id) { const blob = blobs.get(id); if (blob) blob.status = 'ready'; },
        async deleteBlob(id) {
            blobs.delete(id); received.delete(id);
            for (const key of [...links.keys()]) if (key.endsWith(`:${id}`)) links.delete(key);
            for (const key of [...bytes.keys()]) if (key.startsWith(`${id}:`)) bytes.delete(key);
        },
        async usage(accountId) {
            const owned = [...blobs.values()].filter(blob => blob.ownerId === String(accountId));
            return { used: owned.reduce((sum, blob) => sum + blob.size, 0), items: owned.length };
        },
        async canReadBlob(blobId, accountId) {
            for (const link of links.values()) {
                if (link.blobId !== blobId) continue;
                const space = spaces.get(link.spaceId);
                if (space && (space.ownerId === String(accountId) || members.has(memberKey(space.id, accountId)))) return true;
            }
            return false;
        },
        async linkBlob(spaceId, blobId, accountId) { if (!links.has(`${spaceId}:${blobId}`)) links.set(`${spaceId}:${blobId}`, { spaceId, blobId, addedBy: String(accountId) }); },
        async unlinkBlob(spaceId, blobId) { return links.delete(`${spaceId}:${blobId}`); },
        async spaceBlobOwner(spaceId, blobId) { return links.get(`${spaceId}:${blobId}`)?.addedBy || null; },
    };
}

module.exports = { createMysqlStore, createMemoryStore, createDiskChunks, splitParts };
