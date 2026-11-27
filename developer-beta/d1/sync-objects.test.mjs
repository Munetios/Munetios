import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSyncObjects, moveLegacySyncObjects } from './sync-objects.mjs';
import { createCollabStore } from './collab-storage.mjs';

function fixtures() {
    const db = new DatabaseSync(':memory:');
    const folder = new URL('./', import.meta.url);
    for (const file of readdirSync(folder).filter(name => /^00\d\d_.*\.sql$/.test(name)).sort()) {
        db.exec(readFileSync(new URL(file, folder), 'utf8'));
    }
    db.exec("INSERT INTO munetios_accounts (email, password_hash) VALUES ('fixture@example.com', 'fixture')");
    function prepared(text, bindings = []) {
        const statement = db.prepare(text);
        return {
            bind: (...values) => prepared(text, values),
            runSync: () => ({ meta: statement.run(...bindings) }),
            async run() { return this.runSync(); },
            async first() { return statement.get(...bindings) || null; },
            async all() { return { results: statement.all(...bindings) }; },
        };
    }
    const d1 = {
        prepare: prepared,
        async batch(statements) {
            db.exec('BEGIN');
            try {
                const results = statements.map(statement => statement.runSync());
                db.exec('COMMIT');
                return results;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },
    };
    const contents = new Map();
    const bucket = {
        async put(key, value, options) {
            assert.equal(options.sha256, createHash('sha256').update(value, 'ascii').digest('hex'));
            contents.set(key, value);
        },
        async get(key) { return contents.has(key) ? new Response(contents.get(key)) : null; },
        async delete(keys) { for (const key of keys) contents.delete(key); },
    };
    return { db, d1, bucket, contents };
}

test('OmniWrite migration preserves versions, accounting and ciphertext for inline and multipart records', async () => {
    const { db, d1, bucket, contents } = fixtures();
    try {
        const insert = db.prepare('INSERT INTO munetios_sync_items(account_id, item_key, version, iv, ciphertext) VALUES (1, ?, ?, ?, ?)');
        insert.run('omniwrite:doc:original', 3, 'a'.repeat(24), 'ABCD');
        insert.run('omniwrite-media:video:sample:0', 4, 'b'.repeat(24), null);
        insert.run('munetios-calendar:events', 5, 'c'.repeat(24), 'QRST');
        db.exec(`INSERT INTO munetios_sync_item_chunks VALUES
            (1, 'omniwrite-media:video:sample:0', 0, 'EFGH'),
            (1, 'omniwrite-media:video:sample:0', 1, 'IJKL')`);
        await moveLegacySyncObjects(d1, bucket);
        await moveLegacySyncObjects(d1, bucket);
        const objects = createSyncObjects(d1, bucket);
        const rows = db.prepare('SELECT item_key, version, object_key, object_bytes, ciphertext FROM munetios_sync_items ORDER BY version').all();
        assert.equal(contents.size, 2);
        assert.deepEqual(rows.map(row => row.version), [3, 4, 5]);
        assert.deepEqual(rows.map(row => row.object_bytes), [4, 8, null]);
        assert.deepEqual(rows.map(row => row.ciphertext), [null, null, 'QRST']);
        assert.equal(await objects.read(rows[0].object_key), 'ABCD');
        assert.equal(await objects.read(rows[1].object_key), 'EFGHIJKL');
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM munetios_sync_item_chunks').get().count, 0);
    } finally { db.close(); }
});

test('shared documents lazily move to R2 and keep consistent revisions during competing saves', async () => {
    const { db, d1, bucket, contents } = fixtures();
    const local = new DatabaseSync(':memory:');
    let alarm = null;
    const storage = {
        sql: { exec(query, ...values) {
            const statement = local.prepare(query);
            if (/^SELECT/.test(query)) return { toArray: () => statement.all(...values) };
            return { rowsWritten: statement.run(...values).changes };
        } },
        transactionSync(work) {
            local.exec('BEGIN');
            try { const result = work(); local.exec('COMMIT'); return result; }
            catch (error) { local.exec('ROLLBACK'); throw error; }
        },
        async getAlarm() { return alarm; },
        async setAlarm(at) { alarm = at; },
    };
    try {
        const id = 'a'.repeat(22);
        const iv = 'b'.repeat(16);
        const legacy = createCollabStore(storage, d1, id);
        await legacy.createDocument({ id, ownerId: '1', kind: 'document', iv, ciphertext: 'WXYZ' });
        const r2 = createCollabStore(storage, d1, id, bucket);
        assert.equal((await r2.getContentSnapshot(id)).ciphertext, 'WXYZ');
        assert.deepEqual([...contents.values()], ['WXYZ']);
        const [first, second] = await Promise.all([r2.updateContent(id, 1, iv, 'ABCD'), r2.updateContent(id, 1, iv, 'EFGH')]);
        assert.deepEqual([first, second].sort(), [2, null]);
        const current = await r2.getContentSnapshot(id);
        assert.equal(current.version, 2);
        assert.equal(current.ciphertext, first === 2 ? 'ABCD' : 'EFGH');
        assert.ok(alarm);
    } finally { local.close(); db.close(); }
});
