const partSize = 256 * 1024;

export function createWebFilterDurableStore(storage) {
    const sql = storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS parts (file TEXT NOT NULL, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (file, part))');

    function read(file) {
        const parts = sql.exec('SELECT bytes FROM parts WHERE file = ? ORDER BY part', file).toArray();
        return parts.length ? Buffer.concat(parts.map(part => Buffer.from(part.bytes))) : null;
    }

    function replace(file, data) {
        sql.exec('DELETE FROM parts WHERE file = ?', file);
        for (let start = 0, part = 0; start < data.length; start += partSize, part++) {
            const bytes = Uint8Array.from(data.subarray(start, start + partSize)).buffer;
            sql.exec('INSERT INTO parts (file, part, bytes) VALUES (?, ?, ?)', file, part, bytes);
        }
    }

    const snapshot = read('store.json');
    const data = snapshot ? JSON.parse(snapshot.toString('utf8')) : { orgs: {} };
    const saveState = () => replace('store.json', Buffer.from(JSON.stringify(data)));
    return {
        data,
        persist() { storage.transactionSync(saveState); },
        savePackage(orgId, body) {
            storage.transactionSync(() => {
                replace(orgId + '.crx', body);
                saveState();
            });
        },
        readPackage(orgId) { return read(orgId + '.crx'); },
    };
}
