import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import storage from '../../cloud/store.js';

const { splitParts } = storage;
const person = row => ({
    accountId: String(row.account_id),
    email: row.email,
    displayName: row.display_name || '',
    hasPicture: Boolean(row.has_picture),
});
const space = row => row && ({
    id: row.id, ownerId: String(row.owner_id), kind: row.kind,
    version: row.version, iv: row.iv, key: row.space_key, updatedAt: row.updated_at, role: row.role,
});
const blob = row => row && ({
    id: row.id, ownerId: String(row.owner_id), size: row.size,
    chunkSize: row.chunk_size, chunkCount: row.chunk_count, status: row.status,
});
const personFields = 'a.id AS account_id, a.email, p.display_name, (v.account_id IS NOT NULL) AS has_picture';
const personJoins = `LEFT JOIN munetios_profiles p ON p.account_id = a.id
    LEFT JOIN munetios_profile_pictures v ON v.account_id = a.id AND NOT EXISTS (
        SELECT 1 FROM munetios_profile_picture_privacy q WHERE q.account_id = a.id AND q.show_to_everyone = 0
    )`;

export async function removeExpiredCloudObjects(db, bucket, now = Date.now()) {
    const selection = await db.prepare(`SELECT object_key FROM munetios_cloud_objects
        WHERE delete_after <= ? ORDER BY delete_after LIMIT 250`).bind(now).all();
    const keys = selection.results.map(row => row.object_key);
    if (!keys.length) return;
    await bucket.delete(keys);
    await db.prepare(`DELETE FROM munetios_cloud_objects
        WHERE delete_after <= ? AND object_key IN (SELECT value FROM json_each(?))`).bind(now, JSON.stringify(keys)).run();
}

async function readInlineChunk(db, id, index) {
    const { results } = await db.prepare(`SELECT data FROM munetios_cloud_blob_parts
        WHERE blob_id = ? AND chunk_index = ? ORDER BY part_index`).bind(id, index).all();
    return results.length ? Buffer.from(results.map(row => row.data).join(''), 'base64') : null;
}

async function stageCloudObject(db, bucket, id, index, body, options) {
    const key = `media/${id}/${index}/${randomUUID()}`;
    await db.prepare('INSERT INTO munetios_cloud_objects (object_key, delete_after) VALUES (?, ?)')
        .bind(key, Date.now() + 60 * 60 * 1000).run();
    await bucket.put(key, body, options);
    return key;
}

export async function copyLegacyCloudChunks(db, bucket) {
    const { results } = await db.prepare(`SELECT c.blob_id, c.chunk_index, c.bytes
        FROM munetios_cloud_blob_chunks c JOIN munetios_cloud_blobs b ON b.id = c.blob_id
        WHERE c.object_key IS NULL AND b.status = 'ready' ORDER BY c.blob_id, c.chunk_index LIMIT ?`).bind(8).all();
    for (const { blob_id: id, chunk_index: index, bytes } of results) {
        const body = await readInlineChunk(db, id, index);
        if (!body || body.length !== bytes) continue;
        const key = await stageCloudObject(db, bucket, id, index, body, { sha256: createHash('sha256').update(body).digest('hex') });
        await db.batch([
            db.prepare(`UPDATE munetios_cloud_objects SET delete_after = NULL
                WHERE object_key = ? AND delete_after > ? AND EXISTS (
                    SELECT 1 FROM munetios_cloud_blob_chunks WHERE blob_id = ? AND chunk_index = ? AND object_key IS NULL
                )`).bind(key, Date.now(), id, index),
            db.prepare(`UPDATE munetios_cloud_blob_chunks SET object_key = ?
                WHERE blob_id = ? AND chunk_index = ? AND object_key IS NULL AND EXISTS (
                    SELECT 1 FROM munetios_cloud_objects WHERE object_key = ? AND delete_after IS NULL
                )`).bind(key, id, index, key),
        ]);
    }
}

export function createCloudStore(db, capacity, bucket) {
    const sql = (text, ...params) => db.prepare(text).bind(...params);
    const rows = async (text, ...params) => (await sql(text, ...params).all()).results;
    const first = (text, ...params) => sql(text, ...params).first();
    const run = (text, ...params) => sql(text, ...params).run();
    const pack = (text, statement) => splitParts(text).map((part, index) => statement(part, index));
    const active = "EXISTS (SELECT 1 FROM munetios_cloud_blobs WHERE id = ? AND status = 'uploading')";

    async function putObjectChunk(id, index, body) {
        const key = await stageCloudObject(db, bucket, id, index, body);
        const available = 'EXISTS (SELECT 1 FROM munetios_cloud_objects WHERE object_key = ? AND delete_after IS NULL)';
        const result = await db.batch([
            sql('UPDATE munetios_cloud_objects SET delete_after = NULL WHERE object_key = ? AND delete_after > ? AND ' + active,
                key, Date.now(), id),
            sql('DELETE FROM munetios_cloud_blob_chunks WHERE blob_id = ? AND chunk_index = ? AND ' + available,
                id, index, key),
            sql(`INSERT INTO munetios_cloud_blob_chunks (blob_id, chunk_index, bytes, object_key)
                SELECT ?, ?, ?, ? WHERE ` + available, id, index, body.length, key, key),
        ]);
        return Boolean(result[2].meta.changes);
    }

    return {
        sharedCapacity: capacity !== null,
        async listSpaces(accountId, kind) {
            return (await rows(`SELECT s.*, CASE WHEN s.owner_id = ? THEN 'owner' ELSE m.role END AS role
                FROM munetios_cloud_spaces s LEFT JOIN munetios_cloud_members m ON m.space_id = s.id AND m.account_id = ?
                WHERE s.kind = ? AND (s.owner_id = ? OR m.account_id IS NOT NULL) ORDER BY s.updated_at DESC`,
            accountId, accountId, kind, accountId)).map(space);
        },
        async createSpace({ id, ownerId, kind, iv, ciphertext, key }) {
            await db.batch([
                sql('INSERT INTO munetios_cloud_spaces (id, owner_id, kind, iv, space_key, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                    id, ownerId, kind, iv, key, Date.now()),
                ...pack(ciphertext, (part, index) => sql('INSERT INTO munetios_cloud_parts VALUES (?, ?, ?)', id, index, part)),
            ]);
        },
        async getSpace(id) {
            return space(await first('SELECT * FROM munetios_cloud_spaces WHERE id = ?', id));
        },
        async getContent(id) {
            return (await rows('SELECT data FROM munetios_cloud_parts WHERE space_id = ? ORDER BY part_index', id))
                .map(row => row.data).join('');
        },
        async updateContent(id, version, iv, ciphertext) {
            const current = 'EXISTS (SELECT 1 FROM munetios_cloud_spaces WHERE id = ? AND version = ?)';
            const result = await db.batch([
                sql('DELETE FROM munetios_cloud_parts WHERE space_id = ? AND ' + current, id, id, version),
                ...pack(ciphertext, (part, index) => sql('INSERT INTO munetios_cloud_parts SELECT ?, ?, ? WHERE ' + current,
                    id, index, part, id, version)),
                sql('UPDATE munetios_cloud_spaces SET iv = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
                    iv, Date.now(), id, version),
            ]);
            return result.at(-1).meta.changes ? version + 1 : null;
        },
        deleteSpace: id => run('DELETE FROM munetios_cloud_spaces WHERE id = ?', id),
        async getMemberRole(id, accountId) {
            return (await first('SELECT role FROM munetios_cloud_members WHERE space_id = ? AND account_id = ?', id, accountId))?.role ?? null;
        },
        async listMembers(id) {
            return (await rows(`SELECT ${personFields}, m.role FROM munetios_cloud_members m
                JOIN munetios_accounts a ON a.id = m.account_id ${personJoins} WHERE m.space_id = ? ORDER BY m.account_id`, id))
                .map(row => ({ ...person(row), role: row.role }));
        },
        async people(ids) {
            return (await rows(`SELECT ${personFields} FROM munetios_accounts a ${personJoins}
                WHERE a.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`, JSON.stringify([...new Set(ids)]))).map(person);
        },
        upsertMember: (id, accountId, role) => run(`INSERT INTO munetios_cloud_members VALUES (?, ?, ?)
            ON CONFLICT(space_id, account_id) DO UPDATE SET role = excluded.role`, id, accountId, role),
        async removeMember(id, accountId) {
            return Boolean((await run('DELETE FROM munetios_cloud_members WHERE space_id = ? AND account_id = ?', id, accountId)).meta.changes);
        },
        async createBlob({ id, ownerId, size, chunkSize, chunkCount, quota }) {
            const result = await run(`INSERT INTO munetios_cloud_blobs (id, owner_id, size, chunk_size, chunk_count)
                SELECT ?, ?, ?, ?, ?
                WHERE ? + (SELECT COALESCE(SUM(size), 0) FROM munetios_cloud_blobs WHERE owner_id = ?) <= ?
                AND (? IS NULL OR ? + (SELECT COALESCE(SUM(size), 0) FROM munetios_cloud_blobs) <= ?)`,
            id, ownerId, size, chunkSize, chunkCount, size, ownerId, quota, capacity, size, capacity);
            return Boolean(result.meta.changes);
        },
        async getBlob(id) {
            return blob(await first('SELECT * FROM munetios_cloud_blobs WHERE id = ?', id));
        },
        async putChunk(id, index, body) {
            if (bucket) return putObjectChunk(id, index, body);
            const result = await db.batch([
                sql('DELETE FROM munetios_cloud_blob_chunks WHERE blob_id = ? AND chunk_index = ? AND ' + active,
                    id, index, id),
                sql('INSERT INTO munetios_cloud_blob_chunks (blob_id, chunk_index, bytes) SELECT ?, ?, ? WHERE ' + active,
                    id, index, body.length, id),
                ...pack(body.toString('base64'), (part, partIndex) => sql(
                    'INSERT INTO munetios_cloud_blob_parts SELECT ?, ?, ?, ? WHERE ' + active, id, index, partIndex, part, id)),
            ]);
            return Boolean(result[1].meta.changes);
        },
        chunks: {
            async get(id, index) {
                const chunk = await first('SELECT object_key FROM munetios_cloud_blob_chunks WHERE blob_id = ? AND chunk_index = ?', id, index);
                if (!chunk) return null;
                if (chunk.object_key && bucket) {
                    const object = await bucket.get(chunk.object_key);
                    if (object) return Buffer.from(await object.arrayBuffer());
                }
                const inline = await readInlineChunk(db, id, index);
                if (!inline && chunk.object_key && !bucket) throw new Error('Cloud media bucket is unavailable');
                return inline;
            },
        },
        async listChunks(id) {
            return (await rows('SELECT chunk_index, bytes FROM munetios_cloud_blob_chunks WHERE blob_id = ? ORDER BY chunk_index', id))
                .map(row => ({ index: row.chunk_index, bytes: row.bytes }));
        },
        async completeBlob(id) {
            const result = await run(`UPDATE munetios_cloud_blobs SET status = 'ready' WHERE id = ?
                AND chunk_count = (SELECT COUNT(*) FROM munetios_cloud_blob_chunks WHERE blob_id = ?)
                AND size = (SELECT COALESCE(SUM(bytes), 0) FROM munetios_cloud_blob_chunks WHERE blob_id = ?)`, id, id, id);
            return Boolean(result.meta.changes);
        },
        deleteBlob: id => run('DELETE FROM munetios_cloud_blobs WHERE id = ?', id),
        usage: accountId => first('SELECT COALESCE(SUM(size), 0) AS used, COUNT(*) AS items FROM munetios_cloud_blobs WHERE owner_id = ?', accountId),
        async canReadBlob(blobId, accountId) {
            return Boolean(await first(`SELECT 1 FROM munetios_cloud_space_blobs sb JOIN munetios_cloud_spaces s ON s.id = sb.space_id
                LEFT JOIN munetios_cloud_members m ON m.space_id = s.id AND m.account_id = ?
                WHERE sb.blob_id = ? AND (s.owner_id = ? OR m.account_id IS NOT NULL) LIMIT 1`, accountId, blobId, accountId));
        },
        linkBlob: (spaceId, blobId, accountId) => run('INSERT INTO munetios_cloud_space_blobs VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
            spaceId, blobId, accountId),
        async unlinkBlob(spaceId, blobId) {
            return Boolean((await run('DELETE FROM munetios_cloud_space_blobs WHERE space_id = ? AND blob_id = ?', spaceId, blobId)).meta.changes);
        },
        async spaceBlobOwner(spaceId, blobId) {
            const row = await first('SELECT added_by FROM munetios_cloud_space_blobs WHERE space_id = ? AND blob_id = ?', spaceId, blobId);
            return row ? String(row.added_by) : null;
        },
    };
}
