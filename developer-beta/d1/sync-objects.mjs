import { createHash, randomUUID } from 'node:crypto';

const isOmniWrite = key => /^(?:omniwrite|omniwrite-sheets|omniwrite-media):/.test(key);
const legacyWhere = "object_key IS NULL AND deleted = 0 AND (item_key GLOB 'omniwrite:*' OR item_key GLOB 'omniwrite-sheets:*' OR item_key GLOB 'omniwrite-media:*')";

export function createSyncObjects(db, bucket) {
    if (!bucket) return null;
    return {
        appliesTo: isOmniWrite,
        async stage(ciphertext) {
            const key = 'sync/omniwrite/' + randomUUID();
            await db.prepare('INSERT INTO munetios_cloud_objects (object_key, delete_after) VALUES (?, ?)')
                .bind(key, Date.now() + 60 * 60 * 1000).run();
            await bucket.put(key, ciphertext, { sha256: createHash('sha256').update(ciphertext, 'ascii').digest('hex') });
            return key;
        },
        async read(key) {
            const object = await bucket.get(key);
            if (!object) throw new Error('Missing encrypted OmniWrite object');
            return object.text();
        },
    };
}

export async function moveLegacySyncObjects(db, bucket) {
    const objects = createSyncObjects(db, bucket);
    if (!objects) return;
    const expires = Date.now() + 5 * 60 * 1000;
    const lease = await db.prepare(`INSERT INTO munetios_cloud_objects (object_key, delete_after) VALUES ('sync/omniwrite-migration/lease', ?)
        ON CONFLICT(object_key) DO NOTHING`).bind(expires).run();
    if (!lease.meta.changes) return;
    try {
        const { results } = await db.prepare(`SELECT account_id, item_key, CAST(version AS TEXT) AS version
            FROM munetios_sync_items WHERE ${legacyWhere} ORDER BY account_id, item_key LIMIT 144`).all();
        for (let index = 0; index < results.length && Date.now() < expires; index += 4) {
            const completed = await Promise.allSettled(results.slice(index, index + 4).map(async item => {
                const { account_id: account, item_key: key, version } = item;
                const current = await db.prepare(`SELECT ciphertext FROM munetios_sync_items
                    WHERE account_id = ? AND item_key = ? AND version = ? AND object_key IS NULL AND deleted = 0`)
                    .bind(account, key, version).first();
                if (!current) return;
                let ciphertext = current.ciphertext;
                if (ciphertext === null) {
                    const parts = await db.prepare(`SELECT part_index, ciphertext FROM munetios_sync_item_chunks
                        WHERE account_id = ? AND item_key = ? ORDER BY part_index`).bind(account, key).all();
                    if (!parts.results.length || parts.results.some((part, i) => part.part_index !== i)) return;
                    ciphertext = parts.results.map(part => part.ciphertext).join('');
                }
                if (!ciphertext) return;
                const objectKey = await objects.stage(ciphertext);
                await db.batch([
                    db.prepare(`UPDATE munetios_sync_items SET object_key = ?, object_bytes = ?, ciphertext = NULL
                        WHERE account_id = ? AND item_key = ? AND version = ? AND object_key IS NULL AND deleted = 0
                        AND EXISTS (SELECT 1 FROM munetios_cloud_objects WHERE object_key = ? AND delete_after > ?)`)
                        .bind(objectKey, ciphertext.length, account, key, version, objectKey, Date.now()),
                    db.prepare(`UPDATE munetios_cloud_objects SET delete_after = NULL WHERE object_key = ?
                        AND EXISTS (SELECT 1 FROM munetios_sync_items WHERE account_id = ? AND item_key = ? AND object_key = ?)`)
                        .bind(objectKey, account, key, objectKey),
                    db.prepare(`DELETE FROM munetios_sync_item_chunks WHERE account_id = ? AND item_key = ?
                        AND EXISTS (SELECT 1 FROM munetios_sync_items WHERE account_id = ? AND item_key = ? AND object_key = ?)`)
                        .bind(account, key, account, key, objectKey),
                ]);
            }));
            if (completed.some(result => result.status === 'rejected')) {
                console.error('OmniWrite sync migration encountered an object write failure');
                break;
            }
        }
    } finally {
        await db.prepare("DELETE FROM munetios_cloud_objects WHERE object_key = 'sync/omniwrite-migration/lease' AND delete_after = ?")
            .bind(expires).run();
    }
}
