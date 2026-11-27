'use strict';
/*
 * Munetios Cloud API for Calendar and Photos, mounted at /api/cloud.
 *
 *  - Spaces: shared calendars (kind "calendar") and shared albums (kind "album").
 *    Content is encrypted in the browser. The space key is kept so collaborators
 *    added by their Munetios Account email can open the space.
 *  - Roles: owner, edit (can make changes), view (can see everything).
 *  - Uploads: photos and videos go up in encrypted chunks (PUT one chunk per request),
 *    so large files never hit request size limits and interrupted uploads can resume.
 *  - Live updates use Server-Sent Events.
 *  - Calendar helpers: time zones and holidays come from the server.
 */
const express = require('express');
const { randomBytes } = require('node:crypto');
const { expectedBrowserOrigin } = require('../auth/public-hosts');
const { COUNTRIES, holidaysFor } = require('./holidays');
const { listTimeZones } = require('./timezones');

const KINDS = ['calendar', 'album'];
const ROLES = ['edit', 'view'];
const RANK = { view: 1, edit: 2, owner: 3 };
const ID = /^[A-Za-z0-9_-]{22}$/;
const ACCOUNT_ID = /^\d{1,20}$/;
const IV = /^[A-Za-z0-9+/]{16}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const CIPHERTEXT = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_CHUNK = 64 * 1024;
const MAX_CHUNK = 8 * 1024 * 1024;
const HEARTBEAT_MS = 25000;
const DEFAULT_QUOTA = 50_000_000_000;

const newId = () => randomBytes(16).toString('base64url').slice(0, 22);
const displayName = account => account?.displayName || String(account?.email || '').split('@')[0] || '';

function createCalendarHelpersRouter() {
    const router = express.Router();
    router.get('/calendar/timezones', (req, res) => {
        res.set({ 'Cache-Control': 'public, max-age=600', 'X-Content-Type-Options': 'nosniff' }).json(listTimeZones());
    });
    router.get('/calendar/holidays/countries', (req, res) => {
        res.set({ 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).json({ countries: COUNTRIES });
    });
    router.get('/calendar/holidays', (req, res) => {
        res.set('X-Content-Type-Options', 'nosniff');
        const country = String(req.query.country || '').toUpperCase();
        const year = Number(req.query.year);
        const holidays = /^[A-Z]{2}$/.test(country) ? holidaysFor(country, year) : null;
        if (!holidays) return res.set('Cache-Control', 'no-store').status(400).json({ error: 'invalidRequest' });
        res.set('Cache-Control', 'public, max-age=86400').json({ country, year, holidays });
    });
    return router;
}

function createCloudRouter({ store, resolveAccount, lookupAccountByEmail, allocateId = newId, env = process.env, rateLimit = (req, res, next) => next() }) {
    const router = express.Router();
    const rooms = new Map();
    const quota = Number(env.CLOUD_STORAGE_QUOTA) > 0 ? Number(env.CLOUD_STORAGE_QUOTA) : DEFAULT_QUOTA;
    const fail = (res, status, code) => res.status(status).json({ error: code });
    const small = express.json({ limit: '64kb', strict: true });
    const large = express.json({ limit: '64mb', strict: true });
    const raw = express.raw({ type: 'application/octet-stream', limit: MAX_CHUNK + 1024 });
    router.use(createCalendarHelpersRouter());

    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            let expected;
            try { expected = expectedBrowserOrigin(req, env); }
            catch { return fail(res, 503, 'unavailable'); }
            if (req.get('origin') !== expected) return fail(res, 403, 'forbidden');
            const chunkUpload = req.method === 'PUT' && /\/chunks\/\d+$/.test(req.path);
            if (chunkUpload ? !req.is('application/octet-stream') : (req.method !== 'DELETE' && !req.is('application/json'))) return fail(res, 415, 'invalidRequest');
        }
        next();
    });

    const wrap = handler => async (req, res, next) => {
        try { await handler(req, res, next); } catch (error) { next(error); }
    };
    async function account(req, res) {
        if (req.cloudAccount !== undefined) return req.cloudAccount;
        req.cloudAccount = (await resolveAccount(req, res)) || null;
        return req.cloudAccount;
    }
    async function signedIn(req, res) {
        const viewer = await account(req, res);
        if (!viewer) fail(res, 401, 'signedOut');
        return viewer;
    }
    async function roleFor(space, viewer) {
        if (!viewer) return null;
        if (String(viewer.id) === space.ownerId) return 'owner';
        return store.getMemberRole(space.id, String(viewer.id));
    }
    async function load(req, res, minimum = 'view') {
        if (!ID.test(req.params.id || '')) { fail(res, 404, 'notFound'); return null; }
        const viewer = await signedIn(req, res);
        if (!viewer) return null;
        const space = await store.getSpace(req.params.id);
        if (!space) { fail(res, 404, 'notFound'); return null; }
        const role = await roleFor(space, viewer);
        if (!role) { fail(res, 403, 'noAccess'); return null; }
        if (RANK[role] < RANK[minimum]) { fail(res, 403, 'noAccess'); return null; }
        return { space, viewer, role };
    }
    const validContent = body => body && typeof body.iv === 'string' && IV.test(body.iv)
        && typeof body.ciphertext === 'string' && body.ciphertext.length > 0 && CIPHERTEXT.test(body.ciphertext);
    const ownerJson = async space => {
        const [owner] = await store.people([space.ownerId]);
        return owner ? { accountId: owner.accountId, name: owner.displayName || owner.email.split('@')[0], email: owner.email } : null;
    };

    /* ---------- live updates ---------- */
    function send(connection, event) {
        if (connection.res.writableEnded || connection.res.destroyed) return;
        try { connection.res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
    }
    function broadcast(id, event, filter = () => true) {
        for (const connection of rooms.get(id) || []) if (filter(connection)) send(connection, event);
    }
    function leave(connection) {
        const room = rooms.get(connection.spaceId);
        if (!room) return;
        room.delete(connection);
        if (!room.size) rooms.delete(connection.spaceId);
    }
    function disconnect(connection, event) {
        send(connection, event);
        leave(connection);
        try { connection.res.end(); } catch {}
    }
    async function refreshAccess(id) {
        const room = rooms.get(id);
        if (!room) return;
        const space = await store.getSpace(id);
        for (const connection of [...room]) {
            if (!space) { disconnect(connection, { type: 'deleted' }); continue; }
            const role = await roleFor(space, connection.viewer);
            if (!role) disconnect(connection, { type: 'revoked' });
            else if (role !== connection.role) { connection.role = role; send(connection, { type: 'role', role }); }
        }
        broadcast(id, { type: 'members' });
    }

    /* ---------- spaces ---------- */
    router.get('/spaces', wrap(async (req, res) => {
        const viewer = await signedIn(req, res);
        if (!viewer) return;
        const kind = String(req.query.kind || '');
        if (!KINDS.includes(kind)) return fail(res, 400, 'invalidRequest');
        const spaces = await store.listSpaces(String(viewer.id), kind);
        const owners = new Map((await store.people(spaces.map(space => space.ownerId))).map(person => [person.accountId, person]));
        res.json({
            spaces: spaces.map(space => {
                const owner = owners.get(space.ownerId);
                return { id: space.id, kind: space.kind, role: space.role, version: space.version, updatedAt: space.updatedAt, owner: owner ? { accountId: owner.accountId, name: owner.displayName || owner.email.split('@')[0] } : null };
            }),
        });
    }));

    router.post('/spaces', rateLimit, large, wrap(async (req, res) => {
        const viewer = await signedIn(req, res);
        if (!viewer) return;
        const { kind, key } = req.body || {};
        if (!KINDS.includes(kind) || typeof key !== 'string' || !KEY.test(key) || !validContent(req.body)) return fail(res, 400, 'invalidRequest');
        const id = allocateId();
        await store.createSpace({ id, ownerId: String(viewer.id), kind, iv: req.body.iv, ciphertext: req.body.ciphertext, key });
        res.status(201).json({ id, kind, role: 'owner', version: 1 });
    }));

    router.get('/spaces/:id', wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        const { space, role, viewer } = access;
        res.json({
            id: space.id, kind: space.kind, role, version: space.version, key: space.key, iv: space.iv,
            ciphertext: await store.getContent(space.id), owner: await ownerJson(space),
            me: { accountId: String(viewer.id), name: displayName(viewer) },
        });
    }));

    router.put('/spaces/:id/content', rateLimit, large, wrap(async (req, res) => {
        const access = await load(req, res, 'edit');
        if (!access) return;
        const baseVersion = Number(req.body?.baseVersion);
        if (!Number.isSafeInteger(baseVersion) || baseVersion < 1 || !validContent(req.body)) return fail(res, 400, 'invalidRequest');
        const version = await store.updateContent(access.space.id, baseVersion, req.body.iv, req.body.ciphertext);
        if (version === null) {
            const latest = await store.getSpace(access.space.id);
            if (!latest) return fail(res, 404, 'notFound');
            return res.status(409).json({ error: 'conflict', version: latest.version, iv: latest.iv, ciphertext: await store.getContent(latest.id) });
        }
        broadcast(access.space.id, { type: 'content', version, by: String(access.viewer.id) });
        res.json({ version });
    }));

    // Owners delete the space. Collaborators leave it.
    router.delete('/spaces/:id', wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        if (access.role === 'owner') await store.deleteSpace(access.space.id);
        else await store.removeMember(access.space.id, String(access.viewer.id));
        await refreshAccess(access.space.id);
        res.json({ ok: true });
    }));

    router.get('/spaces/:id/members', wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        res.json({ owner: await ownerJson(access.space), members: await store.listMembers(access.space.id), role: access.role });
    }));

    router.post('/spaces/:id/members', small, wrap(async (req, res) => {
        const access = await load(req, res, 'owner');
        if (!access) return;
        const email = String(req.body?.email || '').trim().toLowerCase();
        const role = req.body?.role;
        if (!ROLES.includes(role) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail(res, 400, 'invalidRequest');
        const person = await lookupAccountByEmail(email);
        if (!person) return fail(res, 404, 'noAccount');
        if (String(person.id) === access.space.ownerId) return fail(res, 409, 'isOwner');
        await store.upsertMember(access.space.id, String(person.id), role);
        await refreshAccess(access.space.id);
        res.status(201).json({ ok: true, accountId: String(person.id) });
    }));

    router.patch('/spaces/:id/members/:accountId', small, wrap(async (req, res) => {
        const access = await load(req, res, 'owner');
        if (!access) return;
        const role = req.body?.role;
        if (!ACCOUNT_ID.test(req.params.accountId) || !ROLES.includes(role)) return fail(res, 400, 'invalidRequest');
        if (!(await store.getMemberRole(access.space.id, req.params.accountId))) return fail(res, 404, 'notFound');
        await store.upsertMember(access.space.id, req.params.accountId, role);
        await refreshAccess(access.space.id);
        res.json({ ok: true });
    }));

    router.delete('/spaces/:id/members/:accountId', wrap(async (req, res) => {
        if (!ACCOUNT_ID.test(req.params.accountId || '')) return fail(res, 400, 'invalidRequest');
        const access = await load(req, res);
        if (!access) return;
        const self = req.params.accountId === String(access.viewer.id);
        if (access.role !== 'owner' && !self) return fail(res, 403, 'noAccess');
        if (!(await store.removeMember(access.space.id, req.params.accountId))) return fail(res, 404, 'notFound');
        await refreshAccess(access.space.id);
        res.json({ ok: true });
    }));

    router.get('/spaces/:id/events', wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        res.set({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders?.();
        const connection = { spaceId: access.space.id, viewer: access.viewer, role: access.role, res };
        if (!rooms.has(connection.spaceId)) rooms.set(connection.spaceId, new Set());
        rooms.get(connection.spaceId).add(connection);
        send(connection, { type: 'ready', version: access.space.version, role: access.role });
        const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, HEARTBEAT_MS);
        heartbeat.unref?.();
        req.on('close', () => { clearInterval(heartbeat); leave(connection); });
    }));

    // Shared albums: link an uploaded photo or video so the album's people can download it.
    router.post('/spaces/:id/blobs', small, wrap(async (req, res) => {
        const access = await load(req, res, 'edit');
        if (!access) return;
        if (access.space.kind !== 'album') return fail(res, 400, 'invalidRequest');
        const blobId = String(req.body?.blobId || '');
        if (!ID.test(blobId)) return fail(res, 400, 'invalidRequest');
        const blob = await store.getBlob(blobId);
        if (!blob || blob.status !== 'ready') return fail(res, 404, 'notFound');
        if (blob.ownerId !== String(access.viewer.id)) return fail(res, 403, 'noAccess');
        await store.linkBlob(access.space.id, blobId, String(access.viewer.id));
        res.status(201).json({ ok: true });
    }));

    router.delete('/spaces/:id/blobs/:blobId', wrap(async (req, res) => {
        const access = await load(req, res, 'edit');
        if (!access) return;
        if (!ID.test(req.params.blobId || '')) return fail(res, 400, 'invalidRequest');
        const addedBy = await store.spaceBlobOwner(access.space.id, req.params.blobId);
        if (!addedBy) return fail(res, 404, 'notFound');
        if (access.role !== 'owner' && addedBy !== String(access.viewer.id)) return fail(res, 403, 'noAccess');
        await store.unlinkBlob(access.space.id, req.params.blobId);
        res.json({ ok: true });
    }));

    /* ---------- chunked uploads and downloads ---------- */
    router.get('/storage', wrap(async (req, res) => {
        const viewer = await signedIn(req, res);
        if (!viewer) return;
        const usage = await store.usage(String(viewer.id));
        res.json({ quota, used: usage.used, items: usage.items, ...(store.sharedCapacity ? { sharedCapacity: true } : {}) });
    }));

    router.post('/uploads', small, wrap(async (req, res) => {
        const viewer = await signedIn(req, res);
        if (!viewer) return;
        const size = Number(req.body?.size), chunkSize = Number(req.body?.chunkSize), chunkCount = Number(req.body?.chunkCount);
        if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(chunkSize) || chunkSize < MIN_CHUNK || chunkSize > MAX_CHUNK
            || !Number.isSafeInteger(chunkCount) || chunkCount !== Math.ceil(size / chunkSize)) {
            return fail(res, 400, 'invalidRequest');
        }
        const usage = await store.usage(String(viewer.id));
        if (usage.used + size > quota) return fail(res, 413, 'storageFull');
        const id = allocateId();
        if (await store.createBlob({ id, ownerId: String(viewer.id), size, chunkSize, chunkCount, quota }) === false) {
            return fail(res, 413, 'storageFull');
        }
        res.status(201).json({ id, chunkSize, chunkCount });
    }));

    async function ownBlob(req, res) {
        const viewer = await signedIn(req, res);
        if (!viewer) return null;
        if (!ID.test(req.params.id || '')) { fail(res, 404, 'notFound'); return null; }
        const blob = await store.getBlob(req.params.id);
        if (!blob || blob.ownerId !== String(viewer.id)) { fail(res, 404, 'notFound'); return null; }
        return { blob, viewer };
    }

    router.get('/uploads/:id', wrap(async (req, res) => {
        const owned = await ownBlob(req, res);
        if (!owned) return;
        res.json({ id: owned.blob.id, status: owned.blob.status, received: (await store.listChunks(owned.blob.id)).map(chunk => chunk.index) });
    }));

    router.put('/uploads/:id/chunks/:index', raw, wrap(async (req, res) => {
        const owned = await ownBlob(req, res);
        if (!owned) return;
        const { blob } = owned;
        const index = Number(req.params.index);
        if (blob.status !== 'uploading') return fail(res, 409, 'alreadyComplete');
        if (!Number.isSafeInteger(index) || index < 0 || index >= blob.chunkCount) return fail(res, 400, 'invalidRequest');
        const body = Buffer.isBuffer(req.body) ? req.body : null;
        if (!body || !body.length || body.length > blob.chunkSize) return fail(res, 400, 'invalidRequest');
        if (store.putChunk) {
            if (!(await store.putChunk(blob.id, index, body))) return fail(res, 409, 'alreadyComplete');
        } else {
            await store.chunks.put(blob.id, index, body);
            await store.markChunk(blob.id, index, body.length);
        }
        res.json({ ok: true, index });
    }));

    router.post('/uploads/:id/complete', small, wrap(async (req, res) => {
        const owned = await ownBlob(req, res);
        if (!owned) return;
        const { blob } = owned;
        if (blob.status === 'ready') return res.json({ id: blob.id, status: 'ready' });
        const chunks = await store.listChunks(blob.id);
        const received = new Set(chunks.map(chunk => chunk.index));
        const missing = [];
        for (let index = 0; index < blob.chunkCount; index++) if (!received.has(index)) missing.push(index);
        if (missing.length) return res.status(409).json({ error: 'incomplete', missing });
        const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
        if (total !== blob.size) return fail(res, 409, 'sizeMismatch');
        if (await store.completeBlob(blob.id) === false) return fail(res, 409, 'sizeMismatch');
        res.json({ id: blob.id, status: 'ready' });
    }));

    router.delete('/uploads/:id', wrap(async (req, res) => {
        const owned = await ownBlob(req, res);
        if (!owned) return;
        await store.deleteBlob(owned.blob.id);
        res.json({ ok: true });
    }));
    router.delete('/blobs/:id', wrap(async (req, res) => {
        const owned = await ownBlob(req, res);
        if (!owned) return;
        await store.deleteBlob(owned.blob.id);
        res.json({ ok: true });
    }));

    async function readableBlob(req, res) {
        const viewer = await signedIn(req, res);
        if (!viewer) return null;
        if (!ID.test(req.params.id || '')) { fail(res, 404, 'notFound'); return null; }
        const blob = await store.getBlob(req.params.id);
        if (!blob || blob.status !== 'ready') { fail(res, 404, 'notFound'); return null; }
        if (blob.ownerId !== String(viewer.id) && !(await store.canReadBlob(blob.id, String(viewer.id)))) { fail(res, 404, 'notFound'); return null; }
        return blob;
    }
    router.get('/blobs/:id', wrap(async (req, res) => {
        const blob = await readableBlob(req, res);
        if (!blob) return;
        res.json({ id: blob.id, size: blob.size, chunkSize: blob.chunkSize, chunkCount: blob.chunkCount });
    }));
    router.get('/blobs/:id/chunks/:index', wrap(async (req, res) => {
        const blob = await readableBlob(req, res);
        if (!blob) return;
        const index = Number(req.params.index);
        if (!Number.isSafeInteger(index) || index < 0 || index >= blob.chunkCount) return fail(res, 400, 'invalidRequest');
        const data = await store.chunks.get(blob.id, index);
        if (!data) return fail(res, 404, 'notFound');
        res.set('Content-Type', 'application/octet-stream').send(data);
    }));

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error?.type === 'entity.too.large') return fail(res, 413, 'tooLarge');
        if (error?.type === 'entity.parse.failed') return fail(res, 400, 'invalidRequest');
        return fail(res, 503, 'unavailable');
    });

    return router;
}

module.exports = { createCloudRouter, createCalendarHelpersRouter };
