'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');
const { createCloudRouter } = require('./router');
const { createMemoryStore, createDiskChunks } = require('./store');
const { holidaysFor, easterSunday } = require('./holidays');
const { listTimeZones, offsetMinutes } = require('./timezones');

const accounts = {
    owner: { id: '1', email: 'owner@example.com', displayName: 'Olivia' },
    editor: { id: '2', email: 'editor@example.com', displayName: 'Eli' },
    viewer: { id: '3', email: 'viewer@example.com', displayName: '' },
    stranger: { id: '4', email: 'stranger@example.com', displayName: 'Stan' },
};

async function setup(env = {}) {
    const store = createMemoryStore({ accounts: Object.values(accounts) });
    const app = express();
    app.use('/api/cloud', createCloudRouter({
        store,
        resolveAccount: async req => accounts[req.get('x-test-account')] || null,
        lookupAccountByEmail: async email => Object.values(accounts).find(a => a.email === email) || null,
        env,
    }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function call(method, url, { as, body, bytes, headers: extra = {} } = {}) {
        const headers = { origin, ...extra };
        if (as) headers['x-test-account'] = as;
        if (body !== undefined) headers['content-type'] = 'application/json';
        if (bytes !== undefined) headers['content-type'] = 'application/octet-stream';
        const response = await fetch(origin + '/api/cloud' + url, { method, headers, body: bytes ?? (body === undefined ? undefined : JSON.stringify(body)) });
        const type = response.headers.get('content-type') || '';
        return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
    }
    return { store, call, origin, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }) };
}

const content = { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'c2VjcmV0' };
const key = 'k'.repeat(43);

async function shareCalendar(t) {
    const created = await t.call('POST', '/spaces', { as: 'owner', body: { kind: 'calendar', key, ...content } });
    assert.equal(created.status, 201);
    return created.body.id;
}

test('owners share a calendar with Munetios Accounts and roles control edits', async () => {
    const t = await setup();
    try {
        const id = await shareCalendar(t);
        assert.equal((await t.call('GET', `/spaces/${id}`, { as: 'stranger' })).status, 403);
        assert.equal((await t.call('GET', `/spaces/${id}`)).status, 401);

        assert.equal((await t.call('POST', `/spaces/${id}/members`, { as: 'owner', body: { email: 'nobody@example.com', role: 'view' } })).body.error, 'noAccount');
        assert.equal((await t.call('POST', `/spaces/${id}/members`, { as: 'owner', body: { email: 'owner@example.com', role: 'view' } })).body.error, 'isOwner');
        assert.equal((await t.call('POST', `/spaces/${id}/members`, { as: 'owner', body: { email: 'editor@example.com', role: 'edit' } })).status, 201);
        assert.equal((await t.call('POST', `/spaces/${id}/members`, { as: 'owner', body: { email: 'VIEWER@example.com', role: 'view' } })).status, 201);
        assert.equal((await t.call('POST', `/spaces/${id}/members`, { as: 'editor', body: { email: 'stranger@example.com', role: 'view' } })).status, 403);

        const seen = await t.call('GET', `/spaces/${id}`, { as: 'viewer' });
        assert.equal(seen.body.role, 'view');
        assert.equal(seen.body.key, key);
        assert.equal(seen.body.owner.name, 'Olivia');

        const listed = await t.call('GET', '/spaces?kind=calendar', { as: 'editor' });
        assert.deepEqual(listed.body.spaces.map(space => [space.id, space.role]), [[id, 'edit']]);
        assert.equal((await t.call('GET', '/spaces?kind=album', { as: 'editor' })).body.spaces.length, 0);

        const update = { baseVersion: 1, iv: 'BBBBBBBBBBBBBBBB', ciphertext: 'bmV3' };
        assert.equal((await t.call('PUT', `/spaces/${id}/content`, { as: 'viewer', body: update })).status, 403);
        assert.equal((await t.call('PUT', `/spaces/${id}/content`, { as: 'editor', body: update })).body.version, 2);
        const stale = await t.call('PUT', `/spaces/${id}/content`, { as: 'owner', body: { ...update, ciphertext: 'b2xk' } });
        assert.equal(stale.status, 409);
        assert.equal(stale.body.ciphertext, 'bmV3');
        assert.equal(stale.body.version, 2);

        const members = await t.call('GET', `/spaces/${id}/members`, { as: 'viewer' });
        assert.deepEqual(members.body.members.map(m => [m.email, m.role]), [['editor@example.com', 'edit'], ['viewer@example.com', 'view']]);
        assert.equal((await t.call('PATCH', `/spaces/${id}/members/3`, { as: 'owner', body: { role: 'edit' } })).status, 200);
        assert.equal((await t.call('GET', `/spaces/${id}`, { as: 'viewer' })).body.role, 'edit');

        // Collaborators can leave. Only owners remove other people.
        assert.equal((await t.call('DELETE', `/spaces/${id}/members/2`, { as: 'viewer' })).status, 403);
        assert.equal((await t.call('DELETE', `/spaces/${id}`, { as: 'viewer' })).status, 200);
        assert.equal((await t.call('GET', `/spaces/${id}`, { as: 'viewer' })).status, 403);
        assert.equal((await t.call('DELETE', `/spaces/${id}`, { as: 'owner' })).status, 200);
        assert.equal((await t.call('GET', `/spaces/${id}`, { as: 'editor' })).status, 404);
    } finally { await t.close(); }
});

test('writes need the page origin and the right content type', async () => {
    const t = await setup();
    try {
        const response = await fetch(t.origin + '/api/cloud/spaces', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json', 'x-test-account': 'owner' }, body: JSON.stringify({ kind: 'calendar', key, ...content }) });
        assert.equal(response.status, 403);
        assert.equal((await t.call('POST', '/spaces', { as: 'owner', body: { kind: 'notes', key, ...content } })).status, 400);
        assert.equal((await t.call('POST', '/spaces', { as: 'owner', body: { kind: 'calendar', key: 'short', ...content } })).status, 400);
        const upload = await t.call('POST', '/uploads', { as: 'owner', body: { size: 70000, chunkSize: 65536, chunkCount: 2 } });
        const wrongType = await t.call('PUT', `/uploads/${upload.body.id}/chunks/0`, { as: 'owner', body: { data: 'x' } });
        assert.equal(wrongType.status, 415);
    } finally { await t.close(); }
});

test('large media uploads in chunks, resumes, and completes only when every byte arrived', async () => {
    const t = await setup();
    try {
        const chunkSize = 64 * 1024;
        const data = Buffer.alloc(chunkSize * 2 + 100, 7);
        const created = await t.call('POST', '/uploads', { as: 'owner', body: { size: data.length, chunkSize, chunkCount: 3 } });
        assert.equal(created.status, 201);
        const id = created.body.id;
        assert.equal((await t.call('POST', '/uploads', { as: 'owner', body: { size: data.length, chunkSize, chunkCount: 9 } })).status, 400);
        assert.equal((await t.call('POST', '/uploads', { as: 'owner', body: { size: data.length, chunkSize: 1024, chunkCount: 200 } })).status, 400);

        assert.equal((await t.call('PUT', `/uploads/${id}/chunks/0`, { as: 'owner', bytes: data.subarray(0, chunkSize) })).status, 200);
        assert.equal((await t.call('PUT', `/uploads/${id}/chunks/0`, { as: 'stranger', bytes: data.subarray(0, chunkSize) })).status, 404);
        assert.equal((await t.call('PUT', `/uploads/${id}/chunks/5`, { as: 'owner', bytes: data.subarray(0, 10) })).status, 400);
        assert.equal((await t.call('PUT', `/uploads/${id}/chunks/1`, { as: 'owner', bytes: Buffer.alloc(chunkSize + 1) })).status, 400);

        const incomplete = await t.call('POST', `/uploads/${id}/complete`, { as: 'owner', body: {} });
        assert.equal(incomplete.status, 409);
        assert.deepEqual(incomplete.body.missing, [1, 2]);
        assert.deepEqual((await t.call('GET', `/uploads/${id}`, { as: 'owner' })).body.received, [0]);
        assert.equal((await t.call('GET', `/blobs/${id}`, { as: 'owner' })).status, 404, 'unfinished uploads cannot be downloaded');

        await t.call('PUT', `/uploads/${id}/chunks/2`, { as: 'owner', bytes: data.subarray(chunkSize * 2) });
        await t.call('PUT', `/uploads/${id}/chunks/1`, { as: 'owner', bytes: data.subarray(chunkSize, chunkSize * 2) });
        assert.equal((await t.call('POST', `/uploads/${id}/complete`, { as: 'owner', body: {} })).body.status, 'ready');
        assert.equal((await t.call('PUT', `/uploads/${id}/chunks/1`, { as: 'owner', bytes: data.subarray(0, 5) })).status, 409);

        const parts = [];
        for (let index = 0; index < 3; index++) parts.push((await t.call('GET', `/blobs/${id}/chunks/${index}`, { as: 'owner' })).body);
        assert.deepEqual(Buffer.concat(parts), data);
        const storage = await t.call('GET', '/storage', { as: 'owner' });
        assert.equal(storage.body.used, data.length);
        assert.equal(storage.body.items, 1);
    } finally { await t.close(); }
});

test('uploads stop at the storage quota', async () => {
    const t = await setup({ CLOUD_STORAGE_QUOTA: '100000' });
    try {
        assert.equal((await t.call('POST', '/uploads', { as: 'owner', body: { size: 99000, chunkSize: 65536, chunkCount: 2 } })).status, 201);
        const full = await t.call('POST', '/uploads', { as: 'owner', body: { size: 2000, chunkSize: 65536, chunkCount: 1 } });
        assert.equal(full.status, 413);
        assert.equal(full.body.error, 'storageFull');
    } finally { await t.close(); }
});

test('shared album collaborators download linked photos and nothing else', async () => {
    const t = await setup();
    try {
        const album = (await t.call('POST', '/spaces', { as: 'owner', body: { kind: 'album', key, ...content } })).body.id;
        await t.call('POST', `/spaces/${album}/members`, { as: 'owner', body: { email: 'editor@example.com', role: 'edit' } });
        await t.call('POST', `/spaces/${album}/members`, { as: 'owner', body: { email: 'viewer@example.com', role: 'view' } });
        const upload = async as => {
            const id = (await t.call('POST', '/uploads', { as, body: { size: 10, chunkSize: 65536, chunkCount: 1 } })).body.id;
            await t.call('PUT', `/uploads/${id}/chunks/0`, { as, bytes: Buffer.alloc(10, 1) });
            await t.call('POST', `/uploads/${id}/complete`, { as, body: {} });
            return id;
        };
        const ownerPhoto = await upload('owner');
        const privatePhoto = await upload('owner');
        const editorPhoto = await upload('editor');

        assert.equal((await t.call('POST', `/spaces/${album}/blobs`, { as: 'owner', body: { blobId: ownerPhoto } })).status, 201);
        assert.equal((await t.call('POST', `/spaces/${album}/blobs`, { as: 'editor', body: { blobId: ownerPhoto } })).status, 403, 'only the uploader links a photo');
        assert.equal((await t.call('POST', `/spaces/${album}/blobs`, { as: 'editor', body: { blobId: editorPhoto } })).status, 201);
        assert.equal((await t.call('POST', `/spaces/${album}/blobs`, { as: 'viewer', body: { blobId: editorPhoto } })).status, 403);

        assert.equal((await t.call('GET', `/blobs/${ownerPhoto}/chunks/0`, { as: 'viewer' })).status, 200);
        assert.equal((await t.call('GET', `/blobs/${editorPhoto}`, { as: 'owner' })).status, 200);
        assert.equal((await t.call('GET', `/blobs/${privatePhoto}`, { as: 'viewer' })).status, 404);
        assert.equal((await t.call('GET', `/blobs/${ownerPhoto}`, { as: 'stranger' })).status, 404);

        assert.equal((await t.call('DELETE', `/spaces/${album}/blobs/${ownerPhoto}`, { as: 'editor' })).status, 403);
        assert.equal((await t.call('DELETE', `/spaces/${album}/blobs/${editorPhoto}`, { as: 'editor' })).status, 200);
        assert.equal((await t.call('DELETE', `/spaces/${album}/blobs/${ownerPhoto}`, { as: 'owner' })).status, 200);
        assert.equal((await t.call('GET', `/blobs/${ownerPhoto}`, { as: 'viewer' })).status, 404);

        const calendar = await shareCalendar(t);
        assert.equal((await t.call('POST', `/spaces/${calendar}/blobs`, { as: 'owner', body: { blobId: privatePhoto } })).status, 400);
    } finally { await t.close(); }
});

test('live updates tell collaborators about new versions and removed access', async () => {
    const t = await setup();
    try {
        const id = await shareCalendar(t);
        await t.call('POST', `/spaces/${id}/members`, { as: 'owner', body: { email: 'viewer@example.com', role: 'view' } });
        const controller = new AbortController();
        const response = await fetch(`${t.origin}/api/cloud/spaces/${id}/events`, { headers: { 'x-test-account': 'viewer' }, signal: controller.signal });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const next = async () => {
            while (!buffer.includes('\n\n')) {
                const { value, done } = await reader.read();
                if (done) return null;
                buffer += decoder.decode(value);
            }
            const at = buffer.indexOf('\n\n');
            const frame = buffer.slice(0, at); buffer = buffer.slice(at + 2);
            return frame.startsWith('data: ') ? JSON.parse(frame.slice(6)) : next();
        };
        assert.equal((await next()).type, 'ready');
        await t.call('PUT', `/spaces/${id}/content`, { as: 'owner', body: { baseVersion: 1, iv: 'BBBBBBBBBBBBBBBB', ciphertext: 'bmV3' } });
        assert.deepEqual(await next(), { type: 'content', version: 2, by: '1' });
        await t.call('DELETE', `/spaces/${id}/members/3`, { as: 'owner' });
        assert.equal((await next()).type, 'revoked');
        controller.abort();
    } finally { await t.close(); }
});

test('holidays and time zones come from the server', async () => {
    const t = await setup();
    try {
        const us = await t.call('GET', '/calendar/holidays?country=us&year=2026');
        assert.equal(us.status, 200);
        const find = name => us.body.holidays.find(h => h.name === name)?.date;
        assert.equal(find('Thanksgiving Day'), '2026-11-26');
        assert.equal(find('Black Friday'), '2026-11-27');
        assert.equal(find('Cyber Monday'), '2026-11-30');
        assert.equal(find('Memorial Day'), '2026-05-25');
        assert.equal(find('Election Day'), '2026-11-03');
        assert.equal(find('Easter'), '2026-04-05');
        assert.match(us.headers.get('cache-control'), /max-age/);
        assert.equal((await t.call('GET', '/calendar/holidays?country=ZZ&year=2026')).status, 400);
        assert.equal((await t.call('GET', '/calendar/holidays?country=US&year=abc')).status, 400);
        assert.ok((await t.call('GET', '/calendar/holidays/countries')).body.countries.includes('MX'));

        const zones = await t.call('GET', '/calendar/timezones');
        assert.ok(zones.body.zones.some(zone => zone.id === 'UTC' && zone.offset === 0 && zone.label === 'UTC+00:00'));
        assert.ok(zones.body.zones.length > 20);
    } finally { await t.close(); }
});

test('holiday and offset math', () => {
    assert.equal(easterSunday(2025).toISOString().slice(0, 10), '2025-04-20');
    assert.equal(holidaysFor('GB', 2026).find(h => h.name === 'Spring bank holiday').date, '2026-05-25');
    assert.equal(holidaysFor('US', 1200), null);
    assert.equal(offsetMinutes('Asia/Kolkata', new Date('2026-01-15T00:00:00Z')), 330);
    assert.equal(offsetMinutes('America/New_York', new Date('2026-07-01T12:00:00Z')), -240);
    assert.equal(offsetMinutes('America/New_York', new Date('2026-01-01T12:00:00Z')), -300);
    assert.ok(listTimeZones().zones.length > 20);
});

test('chunk bytes on disk survive a round trip and are removed with the blob', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'munetios-cloud-'));
    try {
        const chunks = createDiskChunks(dir);
        const id = 'A'.repeat(22);
        await chunks.put(id, 0, Buffer.from('hello'));
        assert.equal(String(await chunks.get(id, 0)), 'hello');
        assert.equal(await chunks.get(id, 1), null);
        await chunks.remove(id);
        assert.equal(await chunks.get(id, 0), null);
        await assert.rejects(chunks.put('../escape', 0, Buffer.from('x')));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rate limiter allows the configured requests per window, then answers 429 with Retry-After', () => {
    const { createRateLimit } = require('../auth/rate-limit');
    let clock = 0;
    const limit = createRateLimit({ limit: 3, windowMs: 600000, keyFor: req => req.key, now: () => clock });
    const run = key => {
        const res = { headers: {}, statusCode: 200, body: null, set(h) { Object.assign(this.headers, h); return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
        let passed = false;
        limit({ key }, res, () => { passed = true; });
        return { passed, res };
    };
    assert.deepEqual([1, 2, 3].map(() => run('a').passed), [true, true, true]);
    const blocked = run('a');
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.equal(blocked.res.body.error, 'rateLimited');
    assert.equal(blocked.res.headers['Retry-After'], '600');
    assert.equal(run('b').passed, true, 'each session has its own budget');
    assert.equal(run(null).passed, true, 'requests without a session are left to the route');
    clock = 600001;
    assert.equal(run('a').passed, true, 'the budget resets after the window');
    assert.equal(require('../auth/rate-limit').DEFAULT_LIMIT, 400);
});

test('shared calendar and album updates share the per-session sync budget', async () => {
    const { createRateLimit } = require('../auth/rate-limit');
    const store = createMemoryStore({ accounts: Object.values(accounts) });
    const app = express();
    app.use('/api/cloud', createCloudRouter({
        store, resolveAccount: async req => accounts[req.get('x-test-account')] || null, lookupAccountByEmail: async () => null, env: {},
        rateLimit: createRateLimit({ limit: 2, windowMs: 600000, keyFor: req => req.get('x-test-account') }),
    }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const call = (method, url, body) => fetch(origin + '/api/cloud' + url, { method, headers: { origin, 'content-type': 'application/json', 'x-test-account': 'owner' }, body: JSON.stringify(body) });
    try {
        const created = await (await call('POST', '/spaces', { kind: 'calendar', key, ...content })).json();
        assert.equal((await call('PUT', `/spaces/${created.id}/content`, { baseVersion: 1, iv: 'BBBBBBBBBBBBBBBB', ciphertext: 'bmV3' })).status, 200);
        const limited = await call('PUT', `/spaces/${created.id}/content`, { baseVersion: 2, iv: 'BBBBBBBBBBBBBBBB', ciphertext: 'bmV3' });
        assert.equal(limited.status, 429);
        assert.ok(Number(limited.headers.get('retry-after')) > 0);
        assert.equal(limited.headers.get('ratelimit-limit'), '2');
        const read = await fetch(origin + `/api/cloud/spaces/${created.id}`, { headers: { 'x-test-account': 'owner' } });
        assert.equal(read.status, 200, 'reading is not limited');
    } finally { await new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }); }
});
