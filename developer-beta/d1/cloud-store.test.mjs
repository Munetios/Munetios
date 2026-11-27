import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import cloud from '../../cloud/router.js';
import { copyLegacyCloudChunks, createCloudStore, removeExpiredCloudObjects } from './cloud-store.mjs';

test('D1 backs resumable encrypted media with atomic writes and account isolation', async () => {
    const database = new DatabaseSync(':memory:');
    for (const file of ['0001_accounts.sql', '0006_profile_picture_privacy.sql', '0008_cloud_media.sql', '0009_cloud_objects.sql']) {
        database.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
    }
    database.exec(`INSERT INTO munetios_accounts (email, password_hash)
        VALUES ('owner@example.com', 'fixture'), ('other@example.com', 'fixture')`);
    const db = {
        prepare(text) {
            const statement = database.prepare(text);
            return { bind: (...values) => ({
                first: async () => statement.get(...values) ?? null,
                all: async () => ({ results: statement.all(...values) }),
                run: async () => ({ meta: statement.run(...values) }),
            }) };
        },
        async batch(statements) {
            database.exec('BEGIN');
            try {
                const results = [];
                for (const statement of statements) results.push(await statement.run());
                database.exec('COMMIT');
                return results;
            } catch (error) {
                database.exec('ROLLBACK');
                throw error;
            }
        },
    };
    const chunkSize = 4 * 1024 * 1024 + 16;
    const size = chunkSize + 777;
    const store = createCloudStore(db, size);
    const app = express();
    app.use('/api/cloud', cloud.createCloudRouter({
        store,
        resolveAccount: req => req.get('X-Account') ? { id: req.get('X-Account') } : null,
        lookupAccountByEmail: async () => null,
        env: { CLOUD_STORAGE_QUOTA: String(size) },
    }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    const request = (path, { method = 'GET', account = '1', data, json } = {}) => fetch(origin + '/api/cloud' + path, {
        method,
        headers: {
            Origin: origin,
            ...(account ? { 'X-Account': account } : {}),
            ...(data ? { 'Content-Type': 'application/octet-stream' } : {}),
            ...(json ? { 'Content-Type': 'application/json' } : {}),
        },
        body: data || (json && JSON.stringify(json)),
    });
    try {
        assert.equal((await request('/storage', { account: null })).status, 401);
        assert.deepEqual(await (await request('/storage')).json(), { quota: size, used: 0, items: 0, sharedCapacity: true });
        const created = await request('/uploads', { method: 'POST', json: { size, chunkSize, chunkCount: 2 } });
        assert.equal(created.status, 201);
        const { id } = await created.json();
        const upload = '/uploads/' + id;
        const blob = '/blobs/' + id;
        const firstChunk = randomBytes(chunkSize);
        assert.equal((await request(upload + '/chunks/0', { method: 'PUT', data: firstChunk })).status, 200);
        assert.deepEqual((await (await request(upload)).json()).received, [0]);
        const incomplete = await request(upload + '/complete', { method: 'POST', json: {} });
        assert.equal(incomplete.status, 409);
        assert.deepEqual((await incomplete.json()).missing, [1]);
        assert.equal((await request(upload + '/chunks/1', { method: 'PUT', data: randomBytes(777) })).status, 200);
        assert.equal((await request(upload + '/complete', { method: 'POST', json: {} })).status, 200);
        assert.equal((await request(upload + '/chunks/0', { method: 'PUT', data: firstChunk })).status, 409);
        assert.equal((await request(blob + '/chunks/0', { account: '2' })).status, 404);
        const downloaded = await request(blob + '/chunks/0');
        assert.equal(downloaded.status, 200);
        assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), firstChunk);
        const objects = new Map();
        const bucket = {
            async put(key, bytes, options) {
                if (options?.sha256) assert.equal(options.sha256, createHash('sha256').update(bytes).digest('hex'));
                objects.set(key, Buffer.from(bytes));
            },
            async get(key) { return objects.has(key) ? new Blob([objects.get(key)]) : null; },
            async delete(keys) { for (const key of keys) objects.delete(key); },
        };
        const r2 = createCloudStore(db, null, bucket);
        assert.deepEqual(await r2.chunks.get(id, 0), firstChunk);
        await copyLegacyCloudChunks(db, bucket);
        await copyLegacyCloudChunks(db, bucket);
        assert.equal(objects.size, 2);
        assert.deepEqual(await r2.chunks.get(id, 0), firstChunk);
        assert.deepEqual(await store.chunks.get(id, 0), firstChunk);
        assert.deepEqual(await (await request('/storage')).json(), { quota: size, used: size, items: 1, sharedCapacity: true });
        assert.equal((await request('/uploads', {
            method: 'POST', account: '2', json: { size: 5, chunkSize, chunkCount: 1 },
        })).status, 413);
        const deleted = await request(blob, { method: 'DELETE' });
        assert.equal(deleted.status, 200);
        await removeExpiredCloudObjects(db, bucket);
        assert.equal(objects.size, 0);
        assert.deepEqual(await (await request('/storage')).json(), { quota: size, used: 0, items: 0, sharedCapacity: true });
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM munetios_cloud_blob_parts').get().count, 0);

        const quota = 20_000_000_000;
        const large = { id: 'r2-upload', ownerId: '2', size: quota, chunkSize, chunkCount: Math.ceil(quota / chunkSize), quota };
        assert.equal(await r2.createBlob(large), true);
        assert.equal(await r2.createBlob({ ...large, id: 'excess-r2-upload', size: 1, chunkCount: 1 }), false);
        const replacement = randomBytes(chunkSize);
        assert.equal(await r2.putChunk(large.id, 0, firstChunk), true);
        assert.equal(await r2.putChunk(large.id, 0, replacement), true);
        assert.deepEqual(await r2.chunks.get(large.id, 0), replacement);
        assert.equal(objects.size, 2);
        await removeExpiredCloudObjects(db, bucket);
        assert.equal(objects.size, 1);
        database.exec('DELETE FROM munetios_accounts WHERE id = 2');
        await removeExpiredCloudObjects(db, bucket);
        assert.equal(objects.size, 0);
    } finally {
        server.close();
        database.close();
    }
});
