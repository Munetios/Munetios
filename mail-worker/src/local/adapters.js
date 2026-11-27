// Local adapters with the same surface as the Cloudflare bindings the Mail Worker uses.
// They back `npm start` (Express) and the test suite; production uses the real D1, R2, Queues,
// and Durable Object bindings. Requires Node.js 22.5+ for node:sqlite.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const toParam = value => value === undefined ? null : typeof value === "boolean" ? Number(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : value;

class Statement {
    constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.db, this.sql, params.map(toParam)); }
    execute() {
        const statement = this.db.sqlite.prepare(this.sql);
        if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
            const results = statement.all(...this.params).map(row => ({ ...row }));
            return { results, success: true, meta: { changes: 0, last_row_id: 0, rows_read: results.length } };
        }
        const info = statement.run(...this.params);
        return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    }
    async run() { return this.execute(); }
    async all() { return this.execute(); }
    async first(column) {
        const row = this.execute().results[0];
        if (!row) return null;
        return column ? row[column] : row;
    }
    async raw() { return this.execute().results.map(row => Object.values(row)); }
}

export class LocalD1 {
    constructor(file = ":memory:") {
        if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
        this.sqlite = new DatabaseSync(file);
        this.sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
        this.queue = Promise.resolve();
    }
    prepare(sql) { return new Statement(this, sql); }
    async exec(sql) { this.sqlite.exec(sql); return { count: 1 }; }
    // D1 runs a batch as a single transaction.
    async batch(statements) {
        const run = () => {
            this.sqlite.exec("BEGIN IMMEDIATE");
            try {
                const results = statements.map(statement => statement.execute());
                this.sqlite.exec("COMMIT");
                return results;
            } catch (error) {
                this.sqlite.exec("ROLLBACK");
                throw error;
            }
        };
        const result = this.queue.then(run);
        this.queue = result.catch(() => {});
        return result;
    }
    migrate(sqlFile) {
        const done = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mailboxes'").get();
        if (!done) this.sqlite.exec(readFileSync(sqlFile, "utf8"));
    }
}

class LocalObject {
    constructor(key, bytes, meta) { this.key = key; this.bytes = bytes; this.size = bytes.byteLength; this.httpMetadata = meta?.httpMetadata || {}; this.customMetadata = meta?.customMetadata || {}; this.uploaded = meta?.uploaded ? new Date(meta.uploaded) : new Date(); }
    get body() { const bytes = this.bytes; return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }); }
    async arrayBuffer() { return this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength); }
    async text() { return new TextDecoder().decode(this.bytes); }
    async json() { return JSON.parse(await this.text()); }
    writeHttpMetadata(headers) { if (this.httpMetadata.contentType) headers.set("Content-Type", this.httpMetadata.contentType); }
}

async function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (typeof value === "string") return new TextEncoder().encode(value);
    if (value instanceof ReadableStream || value?.getReader) return new Uint8Array(await new Response(value).arrayBuffer());
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    return new Uint8Array();
}

// R2 on the local filesystem (or in memory when no directory is given).
export class LocalR2 {
    constructor(directory = null) { this.directory = directory; this.memory = new Map(); this.uploads = new Map(); }
    path(key) {
        if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid key");
        return join(this.directory, ...key.split("/"));
    }
    async put(key, value, options = {}) {
        const bytes = await toBytes(value);
        const meta = { httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {}, uploaded: Date.now() };
        if (this.directory) {
            const file = this.path(key);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, bytes);
            writeFileSync(file + ".meta.json", JSON.stringify(meta));
        } else this.memory.set(key, { bytes: new Uint8Array(bytes), meta });
        return { key, size: bytes.byteLength };
    }
    async get(key) {
        if (this.directory) {
            const file = this.path(key);
            if (!existsSync(file)) return null;
            const meta = existsSync(file + ".meta.json") ? JSON.parse(readFileSync(file + ".meta.json", "utf8")) : {};
            return new LocalObject(key, new Uint8Array(readFileSync(file)), meta);
        }
        const item = this.memory.get(key);
        return item ? new LocalObject(key, item.bytes, item.meta) : null;
    }
    async head(key) { return this.get(key); }
    async delete(keys) {
        for (const key of [].concat(keys)) {
            if (this.directory) { const file = this.path(key); rmSync(file, { force: true }); rmSync(file + ".meta.json", { force: true }); }
            else this.memory.delete(key);
        }
    }
    async list({ prefix = "", limit = 1000, cursor } = {}) {
        let keys;
        if (this.directory) {
            keys = [];
            const walk = folder => {
                if (!existsSync(folder)) return;
                for (const name of readdirSync(folder)) {
                    const full = join(folder, name);
                    if (statSync(full).isDirectory()) walk(full);
                    else if (!name.endsWith(".meta.json")) keys.push(relative(this.directory, full).split(sep).join("/"));
                }
            };
            walk(this.directory);
        } else keys = [...this.memory.keys()];
        keys = keys.filter(key => key.startsWith(prefix)).sort();
        const start = cursor ? Number(cursor) : 0;
        const page = keys.slice(start, start + limit);
        const objects = await Promise.all(page.map(key => this.get(key)));
        return { objects: objects.filter(Boolean), truncated: start + limit < keys.length, cursor: String(start + limit) };
    }
    async createMultipartUpload(key, options) {
        const uploadId = crypto.randomUUID();
        this.uploads.set(uploadId, { key, options, parts: new Map() });
        return this.resumeMultipartUpload(key, uploadId);
    }
    resumeMultipartUpload(key, uploadId) {
        const r2 = this;
        return {
            key, uploadId,
            async uploadPart(number, value) {
                const upload = r2.uploads.get(uploadId) || { key, parts: new Map() };
                r2.uploads.set(uploadId, upload);
                upload.parts.set(number, await toBytes(value));
                return { partNumber: number, etag: String(number) };
            },
            async complete(parts) {
                const upload = r2.uploads.get(uploadId);
                const chunks = parts.map(part => upload.parts.get(part.partNumber));
                const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
                const out = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
                r2.uploads.delete(uploadId);
                return r2.put(key, out, upload.options);
            },
            async abort() { r2.uploads.delete(uploadId); },
        };
    }
}

// Queue producer that delivers messages to the Worker's queue() handler in-process.
export class LocalQueue {
    constructor() { this.handler = null; this.timers = new Set(); this.closed = false; }
    async send(body, options = {}) {
        if (this.closed) return;
        const deliver = (attempts, delayMs) => {
            const timer = setTimeout(async () => {
                this.timers.delete(timer);
                if (!this.handler || this.closed) return;
                let retry = null;
                const message = { id: crypto.randomUUID(), body, attempts, ack() {}, retry(opts = {}) { retry = opts; } };
                try { await this.handler({ queue: "local", messages: [message], retryAll(opts = {}) { retry = opts; }, ackAll() {} }); }
                catch { retry = {}; }
                if (retry && attempts < 8) deliver(attempts + 1, Math.max(1, Number(retry.delaySeconds) || 1) * 1000);
            }, delayMs);
            timer.unref?.();
            this.timers.add(timer);
        };
        deliver(1, Math.max(0, Number(options.delaySeconds) || 0) * 1000);
    }
    async sendBatch(messages) { for (const message of messages) await this.send(message.body, message); }
    close() { this.closed = true; for (const timer of this.timers) clearTimeout(timer); }
}

// Real-time hub stand-in: local clients use the polling fallback.
export const localHub = {
    idFromName: name => name,
    get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    getByName: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
};
