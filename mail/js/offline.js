// Encrypted on-device storage (IndexedDB) for offline reading, offline drafts, the offline action queue,
// and mail kept only on this device while the mailbox is full.
// Contents are encrypted with AES-GCM using a non-extractable key generated in this browser. The key never leaves
// the device; it protects against reading the database files directly, not against someone using this browser profile.
// Cached mail, drafts, and queued actions are removed when the account signs out. Device-only mail is the only copy
// of those messages, so it stays until the owner moves it to the mailbox, exports it, or removes it.
const VERSION = 1;
let dbPromise = null;
let dbName = "";
let keyPromise = null;

const requestPromise = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

// Accounts with mail saved on this device (database names are "munetios-mail:<account id>").
export async function savedAccountIds() {
    if (!indexedDB.databases) return [];
    return (await indexedDB.databases()).map(item => item.name || "").filter(name => name.startsWith("munetios-mail:")).map(name => name.slice("munetios-mail:".length)).filter(Boolean);
}

export function openFor(accountId) {
    const name = "munetios-mail:" + accountId;
    if (dbName === name && dbPromise) return dbPromise;
    dbName = name;
    keyPromise = null;
    dbPromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(name, VERSION);
        open.onupgradeneeded = () => {
            const db = open.result;
            for (const store of ["meta", "cache", "drafts", "queue", "device"]) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, store === "queue" ? { keyPath: "seq", autoIncrement: true } : { keyPath: "id" });
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => { dbPromise = null; reject(open.error); };
    });
    return dbPromise;
}

async function tx(store, mode, work) {
    const db = await dbPromise;
    if (!db) throw new Error("offlineUnavailable");
    const transaction = db.transaction(store, mode);
    const result = work(transaction.objectStore(store));
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error); });
    return result instanceof IDBRequest ? result.result : result;
}

async function key() {
    if (!keyPromise) keyPromise = (async () => {
        const stored = await tx("meta", "readonly", store => store.get("key"));
        if (stored?.key) return stored.key;
        const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await tx("meta", "readwrite", store => store.put({ id: "key", key: created }));
        return created;
    })();
    return keyPromise;
}

async function seal(value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(value)));
    return { iv, data };
}
async function unseal(record) {
    if (!record) return null;
    try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, await key(), record.data))); }
    catch { return null; }
}

export async function cachePut(id, value, extra = {}) {
    if (!dbPromise) return;
    const sealed = await seal(value);
    await tx("cache", "readwrite", store => store.put({ id, ...sealed, at: Date.now(), ...extra }));
}
export async function cacheGet(id) {
    if (!dbPromise) return null;
    return unseal(await tx("cache", "readonly", store => store.get(id)).catch(() => null));
}
export async function cachePrune(maxAgeMs) {
    if (!dbPromise) return;
    const cutoff = Date.now() - maxAgeMs;
    const all = await tx("cache", "readonly", store => store.getAll());
    await tx("cache", "readwrite", store => { for (const item of all) if (item.at < cutoff) store.delete(item.id); });
}

export async function draftPut(localId, draft) { if (!dbPromise) return; const sealed = await seal(draft); await tx("drafts", "readwrite", store => store.put({ id: localId, ...sealed, at: Date.now() })); }
export async function draftDelete(localId) { if (dbPromise) await tx("drafts", "readwrite", store => store.delete(localId)).catch(() => {}); }
export async function draftList() {
    if (!dbPromise) return [];
    const all = await tx("drafts", "readonly", store => store.getAll()).catch(() => []);
    const out = [];
    for (const item of all) { const value = await unseal(item); if (value) out.push({ localId: item.id, at: item.at, draft: value }); }
    return out;
}

// Actions taken while offline are replayed in order when the connection returns.
export async function enqueue(action) { if (!dbPromise) return; const sealed = await seal(action); await tx("queue", "readwrite", store => store.add({ ...sealed, at: Date.now() })); }
export async function queued() {
    if (!dbPromise) return [];
    const all = await tx("queue", "readonly", store => store.getAll());
    const out = [];
    for (const item of all) out.push({ seq: item.seq, action: await unseal(item) });
    return out;
}
export async function dequeue(seq) { await tx("queue", "readwrite", store => store.delete(seq)); }

// Device-only mail.
export async function deviceSave(message) {
    const sealed = await seal(message);
    await tx("device", "readwrite", store => store.put({ id: message.id, mailboxId: message.mailboxId, receivedAt: message.receivedAt, ...sealed }));
}
export async function deviceList() {
    if (!dbPromise) return [];
    const all = await tx("device", "readonly", store => store.getAll()).catch(() => []);
    const out = [];
    for (const item of all) { const value = await unseal(item); if (value) out.push(value); }
    return out.sort((a, b) => b.receivedAt - a.receivedAt);
}
export async function deviceDelete(id) { await tx("device", "readwrite", store => store.delete(id)); }

// Signing out removes cached mail, drafts, and queued actions for every account on this browser.
export async function clearPrivateData() {
    const names = indexedDB.databases ? (await indexedDB.databases()).map(item => item.name).filter(name => name?.startsWith("munetios-mail:")) : [dbName].filter(Boolean);
    for (const name of names) {
        try {
            const db = name === dbName && dbPromise ? await dbPromise : await requestPromise(indexedDB.open(name, VERSION));
            const transaction = db.transaction(["cache", "drafts", "queue"], "readwrite");
            for (const store of ["cache", "drafts", "queue"]) transaction.objectStore(store).clear();
            await new Promise(resolve => { transaction.oncomplete = resolve; transaction.onerror = resolve; });
            if (name !== dbName) db.close();
        } catch { /* nothing stored */ }
    }
    if ("caches" in window) for (const name of await caches.keys()) if (name.startsWith("munetios-mail")) await caches.delete(name);
}
