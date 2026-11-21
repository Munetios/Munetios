'use strict';
/*
 * Munetios real-time collaboration API for OmniWrite documents and spreadsheets.
 *
 *  - The browser encrypts content. Owners provide the key when enabling
 *    link access so the server can read those files.
 *  - Roles: owner, edit (Editor), suggest (Suggest), view (View only).
 *  - General access: off (only people added), or anyone with the link (view, suggest, or edit).
 *    Signed-out visitors with the link can only view.
 *  - Locked documents cannot be used for collaboration: only the owner can reach
 *    them (to unlock), and content updates are refused.
 *  - Live updates and presence use Server-Sent Events (no extra dependencies).
 *  - Reports for link-shared files are stored in munetios_collab_reports.
 */
const express = require('express');
const { randomBytes, createHash } = require('node:crypto');
const { expectedBrowserOrigin } = require('../auth/public-hosts');

const ROLES = ['edit', 'suggest', 'view'];
const LINK_ACCESS = ['off', 'view', 'suggest', 'edit'];
const KINDS = ['document', 'spreadsheet'];
const REASONS = ['spam', 'harassment', 'hate', 'violence', 'sexual', 'illegal', 'phishing', 'privacy', 'copyright', 'other'];
const RANK = { view: 1, suggest: 2, edit: 3, owner: 4 };
const DOC_ID = /^[A-Za-z0-9_-]{22}$/;
const ACCOUNT_ID = /^\d{1,20}$/;
const IV = /^[A-Za-z0-9+/]{16}$/;
const CIPHERTEXT = /^[A-Za-z0-9+/]+={0,2}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,40}$/;
const COMMENT_TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const REVIEW_KEY = /^[A-Za-z0-9_-]{43}$/;
const HEARTBEAT_MS = 25000;

const newDocumentId = () => randomBytes(16).toString('base64url').slice(0, 22);
const higher = (a, b) => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);
const displayName = account => (account?.displayName || String(account?.email || '').split('@')[0] || '');

function sharedDirectoryHandler(store, resolveAccount) {
    return async (req, res) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        try {
            const viewer = await resolveAccount(req, res);
            if (!viewer) return res.status(401).json({ error: 'signedOut' });
            res.json({ files: await store.listShared(String(viewer.id)) });
        } catch {
            res.status(503).json({ error: 'unavailable' });
        }
    };
}

function createCollabRouter({ store, resolveAccount, lookupAccountByEmail, allocateDocumentId = newDocumentId, env = process.env }) {
    const router = express.Router();
    const rooms = new Map(); // document id -> Set of live connections
    const fail = (res, status, code) => res.status(status).json({ error: code });
    const small = express.json({ limit: '64kb', strict: true });
    const large = express.json({ limit: '64mb', strict: true });

    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            let expected;
            try { expected = expectedBrowserOrigin(req, env); }
            catch { return fail(res, 503, 'unavailable'); }
            if (req.get('origin') !== expected) return fail(res, 403, 'forbidden');
            if (req.method !== 'DELETE' && !req.is('application/json')) return fail(res, 415, 'invalidRequest');
        }
        next();
    });

    const wrap = handler => async (req, res, next) => {
        try { await handler(req, res, next); } catch (error) { next(error); }
    };

    async function account(req, res) {
        if (req.collabAccount !== undefined) return req.collabAccount;
        req.collabAccount = (await resolveAccount(req, res)) || null;
        return req.collabAccount;
    }

    // Works out the caller's role. Owners keep access to locked documents so they can unlock them.
    async function roleFor(doc, viewer) {
        if (viewer && viewer.id === doc.ownerId) return 'owner';
        if (doc.locked) return null;
        let role = viewer ? await store.getMemberRole(doc.id, viewer.id) : null;
        if (doc.linkAccess !== 'off') role = higher(role, viewer ? doc.linkAccess : 'view');
        return role;
    }

    // Commenting: owners, Editors, and Suggest. Signed-out visitors can comment (as guests)
    // when the link gives Suggest or Editor, even though they can only view the content.
    const canComment = (doc, viewer, role) => !doc.locked && (['owner', 'edit', 'suggest'].includes(role) || (!viewer && ['suggest', 'edit'].includes(doc.linkAccess)));

    // Loads :id and the caller's role, and answers the request itself when access is denied.
    async function load(req, res, minimum = 'view') {
        if (!DOC_ID.test(req.params.id || '')) { fail(res, 404, 'notFound'); return null; }
        const doc = await store.getDocument(req.params.id);
        if (!doc) { fail(res, 404, 'notFound'); return null; }
        const viewer = await account(req, res);
        const role = await roleFor(doc, viewer);
        if (!role) {
            if (doc.locked) fail(res, 423, 'locked');
            else fail(res, viewer ? 403 : 401, viewer ? 'noAccess' : 'signedOut');
            return null;
        }
        if (RANK[role] < RANK[minimum]) { fail(res, 403, 'noAccess'); return null; }
        return { doc, viewer, role };
    }

    /* ---------- live connections ---------- */
    function send(connection, event) {
        if (connection.res.writableEnded || connection.res.destroyed) return;
        try { connection.res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
    }
    function leave(connection) {
        const room = rooms.get(connection.docId);
        if (!room || !room.delete(connection)) return false;
        if (!room.size) rooms.delete(connection.docId);
        return true;
    }
    function presence(id) {
        return [...(rooms.get(id) || [])].map(connection => ({
            clientId: connection.clientId,
            accountId: connection.viewer?.id || null,
            name: connection.viewer ? displayName(connection.viewer) : null,
            hasPicture: Boolean(connection.viewer?.picture),
            role: connection.role,
        }));
    }
    function broadcast(id, event, filter = () => true) {
        for (const connection of rooms.get(id) || []) if (filter(connection)) send(connection, event);
    }
    function close(connection, event) {
        send(connection, event);
        leave(connection);
        try { connection.res.end(); } catch {}
    }
    // Re-checks everyone connected after access changes: roles update live, removed people disconnect.
    async function refreshAccess(id) {
        const room = rooms.get(id);
        if (!room || !room.size) return;
        const doc = await store.getDocument(id);
        for (const connection of [...room]) {
            const role = doc ? await roleFor(doc, connection.viewer) : null;
            if (!doc) close(connection, { type: 'deleted' });
            else if (!role) close(connection, { type: doc.locked ? 'locked' : 'revoked' });
            else {
                const comment = canComment(doc, connection.viewer, role);
                if (role !== connection.role || comment !== connection.canComment) {
                    connection.role = role;
                    connection.canComment = comment;
                    send(connection, { type: 'role', role, canComment: comment });
                }
            }
        }
        if (doc) broadcast(id, { type: 'settings', linkAccess: doc.linkAccess, locked: doc.locked });
        broadcast(id, { type: 'presence', people: presence(id) });
    }

    const documentJson = async (doc, role, viewer, withContent) => {
        const snapshot = withContent && store.getContentSnapshot ? await store.getContentSnapshot(doc.id) : null;
        const content = withContent && !snapshot?.locked
            ? { iv: snapshot?.iv ?? doc.iv, ciphertext: snapshot?.ciphertext ?? await store.getContent(doc.id) }
            : {};
        const [owner] = await store.people([doc.ownerId]);
        return {
            id: doc.id, kind: doc.kind, role, linkAccess: doc.linkAccess, locked: snapshot?.locked ?? doc.locked,
            version: snapshot?.version ?? doc.version, canComment: !snapshot?.locked && canComment(doc, viewer, role),
            owner: owner ? { accountId: owner.accountId, name: owner.displayName || owner.email.split('@')[0], hasPicture: owner.hasPicture } : null,
            me: viewer ? { accountId: viewer.id, name: displayName(viewer), hasPicture: Boolean(viewer.picture) } : null,
            ...content,
        };
    };
    const validContent = body => body && typeof body.iv === 'string' && IV.test(body.iv) && typeof body.ciphertext === 'string' && body.ciphertext.length > 0 && CIPHERTEXT.test(body.ciphertext);
    const clientOf = req => (CLIENT_ID.test(req.get('x-collab-client') || '') ? req.get('x-collab-client') : null);

    /* ---------- documents ---------- */
    if (store.listShared) router.get('/shared', sharedDirectoryHandler(store, resolveAccount));
    router.post('/documents', large, wrap(async (req, res) => {
        const viewer = await account(req, res);
        if (!viewer) return fail(res, 401, 'signedOut');
        const { kind } = req.body || {};
        if (!KINDS.includes(kind) || !validContent(req.body)) return fail(res, 400, 'invalidRequest');
        const id = allocateDocumentId();
        await store.createDocument({ id, ownerId: viewer.id, kind, iv: req.body.iv, ciphertext: req.body.ciphertext });
        const doc = await store.getDocument(id);
        res.status(201).json(await documentJson(doc, 'owner', viewer, false));
    }));

    router.get('/documents/:id', wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        const { doc, role, viewer } = access;
        if (viewer && (role === 'owner' || await store.getMemberRole(doc.id, String(viewer.id)))) {
            await store.indexLegacyMembers?.(doc.id);
        }
        // A locked document only answers its owner, and without content.
        res.json(await documentJson(doc, role, viewer, !doc.locked));
    }));

    router.get('/documents/:id/invitation-key', wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        const { doc, viewer } = access;
        if (!viewer || doc.ownerId === String(viewer.id) || !await store.getMemberRole(doc.id, String(viewer.id))) {
            return fail(res, 403, 'noAccess');
        }
        if (doc.locked) return fail(res, 423, 'locked');
        const key = await store.getInvitationKey?.(doc.id, String(viewer.id));
        res.json({ key: key || null });
    }));

    router.put('/documents/:id/content', large, wrap(async (req, res) => {
        const access = await load(req, res, 'edit');
        if (!access) return;
        const { doc } = access;
        if (doc.locked) return fail(res, 423, 'locked');
        const baseVersion = Number(req.body?.baseVersion);
        if (!Number.isSafeInteger(baseVersion) || baseVersion < 1 || !validContent(req.body)) return fail(res, 400, 'invalidRequest');
        const version = await store.updateContent(doc.id, baseVersion, req.body.iv, req.body.ciphertext);
        if (version === null) {
            const latest = store.getContentSnapshot ? await store.getContentSnapshot(doc.id) : await store.getDocument(doc.id);
            if (!latest) return fail(res, 404, 'notFound');
            if (latest.locked) return fail(res, 423, 'locked');
            return res.status(409).json({ error: 'conflict', version: latest.version, iv: latest.iv, ciphertext: latest.ciphertext ?? await store.getContent(doc.id) });
        }
        const by = clientOf(req);
        broadcast(doc.id, { type: 'content', version, iv: req.body.iv, ciphertext: req.body.ciphertext, by }, connection => connection.clientId !== by);
        res.json({ version });
    }));

    router.patch('/documents/:id', small, wrap(async (req, res) => {
        const access = await load(req, res, 'owner');
        if (!access) return;
        const { linkAccess, locked, contentKey } = req.body || {};
        if (linkAccess !== undefined && !LINK_ACCESS.includes(linkAccess)) return fail(res, 400, 'invalidRequest');
        if (locked !== undefined && typeof locked !== 'boolean') return fail(res, 400, 'invalidRequest');
        if (linkAccess === undefined && locked === undefined) return fail(res, 400, 'invalidRequest');
        if (contentKey !== undefined && (
            !linkAccess || linkAccess === 'off' || typeof contentKey !== 'string' || !REVIEW_KEY.test(contentKey) ||
            Buffer.from(contentKey, 'base64url').toString('base64url') !== contentKey
        )) return fail(res, 400, 'invalidRequest');
        if (await store.updateSettings(access.doc.id, { linkAccess, locked, contentKey }) === false) return fail(res, 404, 'notFound');
        await refreshAccess(access.doc.id);
        const doc = await store.getDocument(access.doc.id);
        if (!doc) return fail(res, 404, 'notFound');
        res.json({ linkAccess: doc.linkAccess, locked: doc.locked });
    }));

    router.delete('/documents/:id', wrap(async (req, res) => {
        const access = await load(req, res, 'owner');
        if (!access) return;
        await store.deleteDocument(access.doc.id);
        for (const connection of [...(rooms.get(access.doc.id) || [])]) close(connection, { type: 'deleted' });
        rooms.delete(access.doc.id);
        res.json({ ok: true });
    }));

    /* ---------- people ---------- */
    router.get('/documents/:id/members', wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        const { doc, role } = access;
        // Email addresses are only shown to people who manage or edit the file.
        const showEmail = RANK[role] >= RANK.edit;
        const [owner] = await store.people([doc.ownerId]);
        const members = await store.listMembers(doc.id);
        const shape = (person, personRole) => ({
            accountId: person.accountId, name: person.displayName || person.email.split('@')[0], hasPicture: person.hasPicture,
            role: personRole, ...(showEmail ? { email: person.email } : {}),
        });
        res.json({ people: [...(owner ? [shape(owner, 'owner')] : []), ...members.map(member => shape(member, member.role))] });
    }));

    router.post('/documents/:id/members', small, wrap(async (req, res) => {
        const access = await load(req, res, 'owner');
        if (!access) return;
        const email = String(req.body?.email || '').trim().toLowerCase();
        const role = req.body?.role;
        if (!ROLES.includes(role) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail(res, 400, 'invalidRequest');
        const person = await lookupAccountByEmail(email);
        if (!person) return fail(res, 404, 'noAccount');
        if (String(person.id) === access.doc.ownerId) return fail(res, 409, 'isOwner');
        if (await store.upsertMember(access.doc.id, String(person.id), role) === false) return fail(res, 404, 'notFound');
        await refreshAccess(access.doc.id);
        res.status(201).json({ ok: true });
    }));

    router.patch('/documents/:id/members/:accountId', small, wrap(async (req, res) => {
        const access = await load(req, res, 'owner');
        if (!access) return;
        const role = req.body?.role;
        if (!ACCOUNT_ID.test(req.params.accountId) || !ROLES.includes(role)) return fail(res, 400, 'invalidRequest');
        if (!(await store.getMemberRole(access.doc.id, req.params.accountId))) return fail(res, 404, 'notFound');
        if (await store.upsertMember(access.doc.id, req.params.accountId, role) === false) return fail(res, 404, 'notFound');
        await refreshAccess(access.doc.id);
        res.json({ ok: true });
    }));

    router.delete('/documents/:id/members/:accountId', wrap(async (req, res) => {
        if (!ACCOUNT_ID.test(req.params.accountId || '')) return fail(res, 400, 'invalidRequest');
        const access = await load(req, res);
        if (!access) return;
        // Owners remove anyone; everyone else can only leave.
        if (access.role !== 'owner' && access.viewer?.id !== req.params.accountId) return fail(res, 403, 'noAccess');
        if (!(await store.removeMember(access.doc.id, req.params.accountId))) return fail(res, 404, 'notFound');
        await refreshAccess(access.doc.id);
        res.json({ ok: true });
    }));

    // Profile pictures of the owner, members, suggestion authors, and people currently here.
    router.get('/documents/:id/people/:accountId/picture', wrap(async (req, res) => {
        if (!ACCOUNT_ID.test(req.params.accountId || '')) return fail(res, 404, 'notFound');
        const access = await load(req, res);
        if (!access) return;
        const target = req.params.accountId;
        const { doc } = access;
        const related = target === doc.ownerId
            || presence(doc.id).some(person => person.accountId === target)
            || Boolean(await store.getMemberRole(doc.id, target))
            || (await store.listSuggestions(doc.id, target)).length > 0
            || (await store.isCommentAuthor(doc.id, target));
        if (!related) return fail(res, 404, 'notFound');
        const picture = await store.getPicture(target);
        if (!picture || !picture.startsWith('data:image/png;base64,')) return fail(res, 404, 'notFound');
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' });
        res.send(Buffer.from(picture.slice('data:image/png;base64,'.length), 'base64'));
    }));

    /* ---------- live updates and presence ---------- */
    router.get('/documents/:id/events', wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        const { doc, viewer, role } = access;
        if (doc.locked) return fail(res, 423, 'locked');
        const clientId = CLIENT_ID.test(String(req.query.client || '')) ? String(req.query.client) : randomBytes(12).toString('base64url');
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write('retry: 3000\n\n');
        const connection = { res, clientId, viewer, role, docId: doc.id, canComment: canComment(doc, viewer, role) };
        if (!rooms.has(doc.id)) rooms.set(doc.id, new Set());
        rooms.get(doc.id).add(connection);
        send(connection, { type: 'hello', clientId, role, version: doc.version, linkAccess: doc.linkAccess, canComment: connection.canComment });
        // Bring the newcomer up to date with where everyone else is working.
        for (const other of rooms.get(doc.id)) if (other !== connection && other.cursor) send(connection, { type: 'cursor', clientId: other.clientId, cursor: other.cursor });
        broadcast(doc.id, { type: 'presence', people: presence(doc.id) });
        const heartbeat = setInterval(() => { if (!res.writableEnded) try { res.write(': ping\n\n'); } catch {} }, HEARTBEAT_MS);
        heartbeat.unref?.();
        res.on('error', () => {});
        req.on('close', () => {
            clearInterval(heartbeat);
            if (leave(connection)) broadcast(doc.id, { type: 'presence', people: presence(doc.id) });
        });
    }));

    // Live cursors: where each person's caret, selection, or selected cell is.
    router.post('/documents/:id/cursor', small, wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        const by = clientOf(req);
        const cursor = req.body?.cursor ?? null;
        if (!by || (cursor !== null && (typeof cursor !== 'object' || Array.isArray(cursor) || JSON.stringify(cursor).length > 4096))) return fail(res, 400, 'invalidRequest');
        const own = [...(rooms.get(access.doc.id) || [])].find(connection => connection.clientId === by);
        if (own) own.cursor = cursor;
        broadcast(access.doc.id, { type: 'cursor', clientId: by, cursor }, connection => connection.clientId !== by);
        res.json({ ok: true });
    }));

    /* ---------- comments ---------- */
    const commentJson = item => ({
        id: item.id, parentId: item.parentId || null, resolved: Boolean(item.resolved), resolvedAt: item.resolvedAt || null,
        iv: item.iv, ciphertext: item.ciphertext, createdAt: item.createdAt,
        author: item.author ? { accountId: item.author.accountId, name: item.author.displayName || item.author.email.split('@')[0], hasPicture: item.author.hasPicture } : null,
    });
    const tokenHashOf = token => createHash('sha256').update('munetios-collab-comment:' + token).digest('hex');

    router.get('/documents/:id/comments', wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        if (access.doc.locked) return fail(res, 423, 'locked');
        res.json({ comments: (await store.listComments(access.doc.id)).map(commentJson), canComment: canComment(access.doc, access.viewer, access.role) });
    }));

    router.post('/documents/:id/comments', small, wrap(async (req, res) => {
        const access = await load(req, res);
        if (!access) return;
        const { doc, viewer, role } = access;
        if (doc.locked) return fail(res, 423, 'locked');
        if (!canComment(doc, viewer, role)) return fail(res, 403, 'noAccess');
        const token = req.body?.token;
        const parentId = req.body?.parentId ?? null;
        if (!validContent(req.body) || (!viewer && (typeof token !== 'string' || !COMMENT_TOKEN.test(token)))
            || (parentId !== null && (typeof parentId !== 'string' || !ACCOUNT_ID.test(parentId)))) return fail(res, 400, 'invalidRequest');
        // Replies go to a thread (a top-level comment) in the same file.
        let parent = null;
        if (parentId) {
            parent = await store.getComment(doc.id, parentId);
            if (!parent || parent.parentId) return fail(res, 404, 'notFound');
        }
        const id = await store.addComment({
            documentId: doc.id, parentId: parent ? parent.id : null, accountId: viewer ? viewer.id : null, tokenHash: viewer ? null : tokenHashOf(token),
            iv: req.body.iv, ciphertext: req.body.ciphertext,
        });
        if (!id) return fail(res, 404, 'notFound');
        const comment = (await store.listComments(doc.id)).find(item => item.id === id);
        if (!comment) return fail(res, 404, 'notFound');
        const json = commentJson(comment);
        const by = clientOf(req);
        broadcast(doc.id, { type: 'comment', comment: json }, connection => connection.clientId !== by);
        if (parent && parent.resolved) broadcast(doc.id, { type: 'comment-resolved', id: parent.id, resolved: false }); // replying reopens
        res.status(201).json(json);
    }));

    // Anyone who can comment can resolve or reopen a thread.
    router.patch('/documents/:id/comments/:commentId', small, wrap(async (req, res) => {
        if (!ACCOUNT_ID.test(req.params.commentId || '')) return fail(res, 404, 'notFound');
        const access = await load(req, res);
        if (!access) return;
        const { doc, viewer, role } = access;
        if (doc.locked) return fail(res, 423, 'locked');
        if (!canComment(doc, viewer, role)) return fail(res, 403, 'noAccess');
        const resolved = req.body?.resolved;
        if (typeof resolved !== 'boolean') return fail(res, 400, 'invalidRequest');
        const comment = await store.getComment(doc.id, req.params.commentId);
        if (!comment || comment.parentId) return fail(res, 404, 'notFound');
        await store.setCommentResolved(doc.id, comment.id, resolved);
        broadcast(doc.id, { type: 'comment-resolved', id: comment.id, resolved }, connection => connection.clientId !== clientOf(req));
        res.json({ id: comment.id, resolved });
    }));

    // Authors delete their own comments (guests prove it with their browser token). Owners delete any.
    router.delete('/documents/:id/comments/:commentId', wrap(async (req, res) => {
        if (!ACCOUNT_ID.test(req.params.commentId || '')) return fail(res, 404, 'notFound');
        const access = await load(req, res);
        if (!access) return;
        const comment = await store.getComment(access.doc.id, req.params.commentId);
        if (!comment) return fail(res, 404, 'notFound');
        const token = req.get('x-comment-token') || '';
        const allowed = access.role === 'owner'
            || (access.viewer && comment.accountId === access.viewer.id)
            || (comment.tokenHash && COMMENT_TOKEN.test(token) && comment.tokenHash === tokenHashOf(token));
        if (!allowed) return fail(res, 403, 'noAccess');
        await store.deleteComment(access.doc.id, comment.id);
        broadcast(access.doc.id, { type: 'comment-deleted', id: comment.id });
        res.json({ ok: true });
    }));

    /* ---------- suggestions ---------- */
    router.post('/documents/:id/suggestions', large, wrap(async (req, res) => {
        const access = await load(req, res, 'suggest');
        if (!access) return;
        if (access.doc.locked) return fail(res, 423, 'locked');
        if (access.role !== 'suggest' || !access.viewer) return fail(res, 403, 'noAccess');
        const baseVersion = Number(req.body?.baseVersion);
        if (!Number.isSafeInteger(baseVersion) || baseVersion < 1 || !validContent(req.body)) return fail(res, 400, 'invalidRequest');
        const id = await store.saveSuggestion({ documentId: access.doc.id, accountId: access.viewer.id, baseVersion, iv: req.body.iv, ciphertext: req.body.ciphertext });
        if (!id) return fail(res, 404, 'notFound');
        broadcast(access.doc.id, { type: 'suggestions' }, connection => RANK[connection.role] >= RANK.edit || connection.viewer?.id === access.viewer.id);
        res.status(201).json({ id });
    }));

    router.get('/documents/:id/suggestions', wrap(async (req, res) => {
        const access = await load(req, res, 'suggest');
        if (!access) return;
        const own = RANK[access.role] < RANK.edit;
        if (own && !access.viewer) return res.json({ suggestions: [] });
        const suggestions = await store.listSuggestions(access.doc.id, own ? access.viewer.id : null);
        res.json({
            suggestions: suggestions.map(item => ({
                id: item.id, baseVersion: item.baseVersion, updatedAt: item.updatedAt,
                author: { accountId: item.author.accountId, name: item.author.displayName || item.author.email.split('@')[0], hasPicture: item.author.hasPicture },
            })),
        });
    }));

    router.get('/documents/:id/suggestions/:suggestionId', wrap(async (req, res) => {
        const access = await load(req, res, 'suggest');
        if (!access) return;
        if (!ACCOUNT_ID.test(req.params.suggestionId || '')) return fail(res, 404, 'notFound');
        const suggestion = await store.getSuggestion(access.doc.id, req.params.suggestionId);
        if (!suggestion || (RANK[access.role] < RANK.edit && suggestion.accountId !== access.viewer?.id)) return fail(res, 404, 'notFound');
        res.json(suggestion);
    }));

    // Editors accept or reject. Authors can withdraw their own suggestion (stored as rejected).
    router.post('/documents/:id/suggestions/:suggestionId/resolve', small, wrap(async (req, res) => {
        const access = await load(req, res, 'suggest');
        if (!access) return;
        const status = req.body?.status;
        if (!ACCOUNT_ID.test(req.params.suggestionId || '') || !['accepted', 'rejected'].includes(status)) return fail(res, 400, 'invalidRequest');
        const suggestion = await store.getSuggestion(access.doc.id, req.params.suggestionId);
        if (!suggestion) return fail(res, 404, 'notFound');
        const editor = RANK[access.role] >= RANK.edit;
        if (!editor && !(status === 'rejected' && suggestion.accountId === access.viewer?.id)) return fail(res, 403, 'noAccess');
        if (!(await store.resolveSuggestion(access.doc.id, suggestion.id, status))) return fail(res, 404, 'notFound');
        broadcast(access.doc.id, { type: 'suggestions', resolved: suggestion.id, status, author: suggestion.accountId });
        res.json({ ok: true });
    }));

    /* ---------- reports ---------- */
    router.post('/reports', small, wrap(async (req, res) => {
        const { documentId, reason } = req.body || {};
        const details = typeof req.body?.details === 'string' ? req.body.details.trim() : '';
        const reviewKey = req.body?.reviewKey ?? null;
        if (!DOC_ID.test(documentId || '') || !REASONS.includes(reason) || (reviewKey !== null && !REVIEW_KEY.test(reviewKey))) return fail(res, 400, 'invalidRequest');
        const doc = await store.getDocument(documentId);
        // Only files shared with anyone who has the link can be reported.
        if (!doc || doc.linkAccess === 'off') return fail(res, 404, 'notFound');
        const viewer = await account(req, res);
        await store.createReport({
            documentId: doc.id, kind: doc.kind, ownerId: doc.ownerId, reporterId: viewer?.id || null,
            ipHash: createHash('sha256').update('munetios-collab-report:' + (req.ip || '')).digest('hex'),
            reason, details, reviewKey,
        });
        res.status(201).json({ ok: true });
    }));

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') return fail(res, 400, 'invalidRequest');
        console.error(`[collab] ${req.method} ${req.path} failed: ${error.code || error.message}`);
        fail(res, 503, 'unavailable');
    });

    router.rooms = rooms;
    return router;
}

module.exports = { createCollabRouter, sharedDirectoryHandler, REASONS, ROLES, LINK_ACCESS };
