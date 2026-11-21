'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const express = require('express');
const { createCollabRouter } = require('./router');
const { splitParts, PART_BYTES } = require('./store');

const accounts = {
    owner: { id: '1', email: 'owner@example.com', displayName: 'Olivia', picture: 'data:image/png;base64,iVBORw0KGgo=' },
    editor: { id: '2', email: 'editor@example.com', displayName: 'Eli', picture: null },
    suggester: { id: '3', email: 'sam@example.com', displayName: '', picture: null },
    stranger: { id: '4', email: 'stranger@example.com', displayName: 'Stan', picture: null },
};

function memoryStore() {
    const docs = new Map(), content = new Map(), members = new Map(), suggestions = new Map(), reports = [];
    let nextSuggestion = 1;
    const person = id => {
        const account = Object.values(accounts).find(item => item.id === String(id));
        return account && { accountId: account.id, email: account.email, displayName: account.displayName, hasPicture: Boolean(account.picture) };
    };
    return {
        reports, docs,
        async createDocument({ id, ownerId, kind, iv, ciphertext }) {
            docs.set(id, { id, ownerId, kind, linkAccess: 'off', locked: false, version: 1, iv, updatedAt: Date.now() });
            content.set(id, ciphertext);
        },
        async getDocument(id) { return docs.has(id) ? { ...docs.get(id) } : null; },
        async getContent(id) { return content.get(id); },
        async updateContent(id, base, iv, ciphertext) {
            const doc = docs.get(id);
            if (!doc || doc.version !== base || doc.locked) return null;
            doc.version++; doc.iv = iv; content.set(id, ciphertext);
            return doc.version;
        },
        async updateSettings(id, { linkAccess, locked, contentKey }) {
            const doc = docs.get(id);
            if (linkAccess !== undefined) doc.linkAccess = linkAccess;
            if (locked !== undefined) doc.locked = locked;
            if (linkAccess === 'off') delete doc.contentKey;
            else if (contentKey) doc.contentKey = contentKey;
        },
        async deleteDocument(id) { docs.delete(id); content.delete(id); },
        async people(ids) { return ids.map(person).filter(Boolean); },
        async listMembers(id) { return [...(members.get(id) || new Map())].map(([accountId, role]) => ({ ...person(accountId), role })); },
        async getMemberRole(id, accountId) { return members.get(id)?.get(String(accountId)) || null; },
        async upsertMember(id, accountId, role) { if (!members.has(id)) members.set(id, new Map()); members.get(id).set(String(accountId), role); },
        async removeMember(id, accountId) { return Boolean(members.get(id)?.delete(String(accountId))); },
        async getPicture(accountId) { return person(accountId) && Object.values(accounts).find(a => a.id === accountId).picture; },
        async saveSuggestion({ documentId, accountId, baseVersion, iv, ciphertext }) {
            const open = [...suggestions.values()].find(s => s.documentId === documentId && s.accountId === accountId && s.status === 'open');
            const item = open || { id: String(nextSuggestion++), documentId, accountId, status: 'open' };
            Object.assign(item, { baseVersion, iv, ciphertext, updatedAt: Date.now() });
            suggestions.set(item.id, item);
            return item.id;
        },
        async listSuggestions(documentId, accountId) {
            return [...suggestions.values()].filter(s => s.documentId === documentId && s.status === 'open' && (!accountId || s.accountId === accountId))
                .map(s => ({ id: s.id, baseVersion: s.baseVersion, updatedAt: s.updatedAt, author: person(s.accountId) }));
        },
        async getSuggestion(documentId, id) {
            const s = suggestions.get(id);
            return s && s.documentId === documentId && s.status === 'open' ? { ...s } : null;
        },
        async resolveSuggestion(documentId, id, status) {
            const s = suggestions.get(id);
            if (!s || s.status !== 'open') return false;
            s.status = status;
            return true;
        },
        async createReport(report) { reports.push(report); return String(reports.length); },
        comments: [],
        nextComment: 1,
        async listComments(documentId) {
            return this.comments.filter(c => c.documentId === documentId).map(c => ({ id: c.id, parentId: c.parentId || null, resolved: !!c.resolved, iv: c.iv, ciphertext: c.ciphertext, createdAt: c.createdAt, author: c.accountId ? person(c.accountId) : null }));
        },
        async addComment(comment) {
            const id = String(this.nextComment++);
            this.comments.push({ ...comment, id, resolved: false, createdAt: Date.now() });
            if (comment.parentId) this.comments.find(c => c.id === comment.parentId).resolved = false;
            return id;
        },
        async getComment(documentId, id) { const c = this.comments.find(item => item.id === id && item.documentId === documentId); return c ? { id: c.id, parentId: c.parentId || null, resolved: !!c.resolved, accountId: c.accountId, tokenHash: c.tokenHash } : null; },
        async setCommentResolved(documentId, id, resolved) { const c = this.comments.find(item => item.id === id && item.documentId === documentId && !item.parentId); if (c) c.resolved = resolved; return !!c; },
        async deleteComment(documentId, id) { const before = this.comments.length; this.comments = this.comments.filter(c => !(c.documentId === documentId && (c.id === id || c.parentId === id))); return this.comments.length < before; },
        async isCommentAuthor(documentId, accountId) { return this.comments.some(c => c.documentId === documentId && c.accountId === accountId); },
    };
}

async function setup() {
    const store = memoryStore();
    const app = express();
    app.set('trust proxy', false);
    app.use('/api/collab', createCollabRouter({
        store,
        resolveAccount: async req => accounts[req.get('x-test-account')] || null,
        lookupAccountByEmail: async email => Object.values(accounts).find(a => a.email === email) || null,
        env: {},
    }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function call(method, path, { as, body, client, headers: extra = {} } = {}) {
        const headers = { origin, ...extra };
        if (as) headers['x-test-account'] = as;
        if (client) headers['x-collab-client'] = client;
        if (body !== undefined) headers['content-type'] = 'application/json';
        const response = await fetch(origin + '/api/collab' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const type = response.headers.get('content-type') || '';
        return { status: response.status, body: type.includes('json') ? await response.json() : null };
    }
    return { store, call, origin, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }) };
}

const content = { iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'c2VjcmV0' };

test('only owners can give the server the file key for link sharing', async () => {
    const t = await setup();
    try {
        const key = randomBytes(32);
        const iv = randomBytes(12);
        const aad = Buffer.from('munetios-collab:document');
        const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(aad);
        const ciphertext = Buffer.concat([cipher.update('Document text'), cipher.final(), cipher.getAuthTag()]).toString('base64');
        const { body: { id } } = await t.call('POST', '/documents', {
            as: 'owner', body: { kind: 'document', iv: iv.toString('base64'), ciphertext },
        });
        const settings = { linkAccess: 'edit', contentKey: key.toString('base64url') };
        const route = `/documents/${id}`;
        assert.equal((await t.call('PATCH', route, { as: 'editor', body: settings })).status, 403);
        assert.equal((await t.call('PATCH', route, { as: 'owner', body: { ...settings, linkAccess: 'off' } })).status, 400);
        assert.equal((await t.call('PATCH', route, { as: 'owner', body: settings })).status, 200);
        const guest = await t.call('GET', route);
        assert.equal(guest.status, 200);
        assert.equal(guest.body.contentKey, undefined);
        const storedKey = Buffer.from(t.store.docs.get(id).contentKey, 'base64url');
        const encrypted = Buffer.from(guest.body.ciphertext, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', storedKey, iv).setAAD(aad).setAuthTag(encrypted.subarray(-16));
        assert.equal(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString(), 'Document text');
        assert.equal((await t.call('PATCH', route, { as: 'owner', body: { linkAccess: 'off' } })).status, 200);
        assert.equal(t.store.docs.get(id).contentKey, undefined);
        assert.equal((await t.call('GET', route)).status, 401);
    } finally { await t.close(); }
});

test('owner shares, roles are enforced, and conflicts return the latest version', async () => {
    const t = await setup();
    try {
        assert.equal((await t.call('POST', '/documents', { body: { kind: 'document', ...content } })).status, 401);
        const created = await t.call('POST', '/documents', { as: 'owner', body: { kind: 'document', ...content } });
        assert.equal(created.status, 201);
        assert.equal(created.body.role, 'owner');
        const id = created.body.id;
        assert.match(id, /^[A-Za-z0-9_-]{22}$/);

        // Restricted by default
        assert.equal((await t.call('GET', `/documents/${id}`, { as: 'stranger' })).status, 403);
        assert.equal((await t.call('GET', `/documents/${id}`)).status, 401);

        assert.equal((await t.call('POST', `/documents/${id}/members`, { as: 'owner', body: { email: 'editor@example.com', role: 'edit' } })).status, 201);
        assert.equal((await t.call('POST', `/documents/${id}/members`, { as: 'owner', body: { email: 'nobody@example.com', role: 'edit' } })).body.error, 'noAccount');
        assert.equal((await t.call('POST', `/documents/${id}/members`, { as: 'editor', body: { email: 'sam@example.com', role: 'edit' } })).status, 403);
        await t.call('POST', `/documents/${id}/members`, { as: 'owner', body: { email: 'sam@example.com', role: 'suggest' } });

        const asEditor = await t.call('GET', `/documents/${id}`, { as: 'editor' });
        assert.equal(asEditor.body.role, 'edit');
        assert.equal(asEditor.body.ciphertext, content.ciphertext);

        const saved = await t.call('PUT', `/documents/${id}/content`, { as: 'editor', body: { baseVersion: 1, iv: 'BBBBBBBBBBBBBBBB', ciphertext: 'bmV3' } });
        assert.deepEqual(saved.body, { version: 2 });
        const stale = await t.call('PUT', `/documents/${id}/content`, { as: 'owner', body: { baseVersion: 1, ...content } });
        assert.equal(stale.status, 409);
        assert.equal(stale.body.version, 2);
        assert.equal(stale.body.ciphertext, 'bmV3');

        // Suggesters cannot edit directly
        assert.equal((await t.call('PUT', `/documents/${id}/content`, { as: 'suggester', body: { baseVersion: 2, ...content } })).status, 403);

        // Members list hides emails from non-editors
        const forSuggester = await t.call('GET', `/documents/${id}/members`, { as: 'suggester' });
        assert.equal(forSuggester.body.people.length, 3);
        assert.ok(forSuggester.body.people.every(p => p.email === undefined));
        const forOwner = await t.call('GET', `/documents/${id}/members`, { as: 'owner' });
        assert.equal(forOwner.body.people[0].role, 'owner');
        assert.equal(forOwner.body.people[1].email, 'editor@example.com');

        // Owner changes and removes roles
        assert.equal((await t.call('PATCH', `/documents/${id}/members/2`, { as: 'owner', body: { role: 'view' } })).status, 200);
        assert.equal((await t.call('GET', `/documents/${id}`, { as: 'editor' })).body.role, 'view');
        assert.equal((await t.call('DELETE', `/documents/${id}/members/2`, { as: 'owner' })).status, 200);
        assert.equal((await t.call('GET', `/documents/${id}`, { as: 'editor' })).status, 403);
    } finally { await t.close(); }
});

test('anyone with the link, signed-out visitors only view, and locked documents stop collaboration', async () => {
    const t = await setup();
    try {
        const { body: { id } } = await t.call('POST', '/documents', { as: 'owner', body: { kind: 'spreadsheet', ...content } });
        assert.equal((await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { linkAccess: 'edit' } })).body.linkAccess, 'edit');
        assert.equal((await t.call('GET', `/documents/${id}`, { as: 'stranger' })).body.role, 'edit');
        assert.equal((await t.call('GET', `/documents/${id}`)).body.role, 'view');
        assert.equal((await t.call('PUT', `/documents/${id}/content`, { body: { baseVersion: 1, ...content } })).status, 403);
        assert.equal((await t.call('PATCH', `/documents/${id}`, { as: 'stranger', body: { linkAccess: 'off' } })).status, 403);

        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { locked: true } });
        assert.equal((await t.call('GET', `/documents/${id}`, { as: 'stranger' })).status, 423);
        const ownerView = await t.call('GET', `/documents/${id}`, { as: 'owner' });
        assert.equal(ownerView.body.locked, true);
        assert.equal(ownerView.body.ciphertext, undefined);
        assert.equal((await t.call('PUT', `/documents/${id}/content`, { as: 'owner', body: { baseVersion: 1, ...content } })).status, 423);
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { locked: false } });
        assert.equal((await t.call('GET', `/documents/${id}`, { as: 'stranger' })).status, 200);

        assert.equal((await t.call('DELETE', `/documents/${id}`, { as: 'owner' })).status, 200);
        assert.equal((await t.call('GET', `/documents/${id}`, { as: 'owner' })).status, 404);
    } finally { await t.close(); }
});

test('suggestions: suggesters submit, editors accept or reject', async () => {
    const t = await setup();
    try {
        const { body: { id } } = await t.call('POST', '/documents', { as: 'owner', body: { kind: 'document', ...content } });
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { linkAccess: 'suggest' } });
        assert.equal((await t.call('POST', `/documents/${id}/suggestions`, { as: 'owner', body: { baseVersion: 1, ...content } })).status, 403);
        const first = await t.call('POST', `/documents/${id}/suggestions`, { as: 'suggester', body: { baseVersion: 1, ...content } });
        const again = await t.call('POST', `/documents/${id}/suggestions`, { as: 'suggester', body: { baseVersion: 1, iv: content.iv, ciphertext: 'dHdv' } });
        assert.equal(first.body.id, again.body.id, 'one open suggestion per person');
        await t.call('POST', `/documents/${id}/suggestions`, { as: 'stranger', body: { baseVersion: 1, ...content } });

        const list = await t.call('GET', `/documents/${id}/suggestions`, { as: 'owner' });
        assert.equal(list.body.suggestions.length, 2);
        assert.equal((await t.call('GET', `/documents/${id}/suggestions`, { as: 'suggester' })).body.suggestions.length, 1);
        assert.equal((await t.call('GET', `/documents/${id}/suggestions/${first.body.id}`, { as: 'stranger' })).status, 404);
        assert.equal((await t.call('GET', `/documents/${id}/suggestions/${first.body.id}`, { as: 'owner' })).body.ciphertext, 'dHdv');

        assert.equal((await t.call('POST', `/documents/${id}/suggestions/${first.body.id}/resolve`, { as: 'stranger', body: { status: 'accepted' } })).status, 403);
        assert.equal((await t.call('POST', `/documents/${id}/suggestions/${first.body.id}/resolve`, { as: 'owner', body: { status: 'accepted' } })).status, 200);
        assert.equal((await t.call('GET', `/documents/${id}/suggestions`, { as: 'owner' })).body.suggestions.length, 1);
    } finally { await t.close(); }
});

test('reports are stored only for link-shared files', async () => {
    const t = await setup();
    try {
        const { body: { id } } = await t.call('POST', '/documents', { as: 'owner', body: { kind: 'document', ...content } });
        assert.equal((await t.call('POST', '/reports', { body: { documentId: id, reason: 'spam', details: '' } })).status, 404);
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { linkAccess: 'view' } });
        assert.equal((await t.call('POST', '/reports', { body: { documentId: id, reason: 'nonsense', details: '' } })).status, 400);
        const key = 'k'.repeat(43);
        const sent = await t.call('POST', '/reports', { as: 'stranger', body: { documentId: id, reason: 'phishing', details: 'Asks for passwords', reviewKey: key } });
        assert.equal(sent.status, 201);
        assert.equal(t.store.reports.length, 1);
        assert.equal(t.store.reports[0].reporterId, '4');
        assert.equal(t.store.reports[0].reviewKey, key);
        assert.match(t.store.reports[0].ipHash, /^[a-f0-9]{64}$/);
    } finally { await t.close(); }
});

test('cross-origin writes are refused', async () => {
    const t = await setup();
    try {
        const response = await fetch(t.origin + '/api/collab/documents', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json', 'x-test-account': 'owner' }, body: JSON.stringify({ kind: 'document', ...content }) });
        assert.equal(response.status, 403);
    } finally { await t.close(); }
});

test('live events deliver presence and content to other collaborators', async () => {
    const t = await setup();
    try {
        const { body: { id } } = await t.call('POST', '/documents', { as: 'owner', body: { kind: 'document', ...content } });
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { linkAccess: 'edit' } });
        const controller = new AbortController();
        const response = await fetch(`${t.origin}/api/collab/documents/${id}/events?client=watcher-0001`, { headers: { 'x-test-account': 'stranger' }, signal: controller.signal });
        assert.equal(response.headers.get('content-type').split(';')[0], 'text/event-stream');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const events = [];
        const next = async type => {
            for (;;) {
                const found = events.findIndex(e => e.type === type);
                if (found >= 0) return events.splice(found, 1)[0];
                const { value, done } = await reader.read();
                if (done) throw new Error('stream ended');
                buffer += decoder.decode(value, { stream: true });
                let at;
                while ((at = buffer.indexOf('\n\n')) >= 0) {
                    const chunk = buffer.slice(0, at); buffer = buffer.slice(at + 2);
                    const data = chunk.split('\n').find(line => line.startsWith('data: '));
                    if (data) events.push(JSON.parse(data.slice(6)));
                }
            }
        };
        assert.equal((await next('hello')).role, 'edit');
        assert.equal((await next('presence')).people[0].name, 'Stan');
        await t.call('PUT', `/documents/${id}/content`, { as: 'owner', client: 'writer-00001', body: { baseVersion: 1, iv: content.iv, ciphertext: 'bGl2ZQ==' } });
        const update = await next('content');
        assert.equal(update.ciphertext, 'bGl2ZQ==');
        assert.equal(update.version, 2);
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { locked: true } });
        assert.equal((await next('locked')).type, 'locked');
        controller.abort();
    } finally { await t.close(); }
});

test('comments: guests comment without signing in when the link allows Suggest or Editor', async () => {
    const t = await setup();
    try {
        const { body: { id } } = await t.call('POST', '/documents', { as: 'owner', body: { kind: 'document', ...content } });
        const token = 'g'.repeat(40);
        // Restricted: signed-out visitors cannot even read
        assert.equal((await t.call('GET', `/documents/${id}/comments`)).status, 401);
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { linkAccess: 'view' } });
        const viewOnly = await t.call('GET', `/documents/${id}/comments`);
        assert.equal(viewOnly.status, 200);
        assert.equal(viewOnly.body.canComment, false);
        assert.equal((await t.call('POST', `/documents/${id}/comments`, { body: { ...content, token } })).status, 403);

        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { linkAccess: 'suggest' } });
        const asGuest = await t.call('GET', `/documents/${id}`);
        assert.equal(asGuest.body.role, 'view');
        assert.equal(asGuest.body.canComment, true);
        assert.equal((await t.call('POST', `/documents/${id}/comments`, { body: { ...content } })).status, 400, 'guests need a token');
        const guest = await t.call('POST', `/documents/${id}/comments`, { body: { ...content, token } });
        assert.equal(guest.status, 201);
        assert.equal(guest.body.author, null);
        const member = await t.call('POST', `/documents/${id}/comments`, { as: 'suggester', body: { ...content } });
        assert.equal(member.body.author.accountId, '3');
        assert.equal((await t.call('GET', `/documents/${id}/comments`, { as: 'owner' })).body.comments.length, 2);

        // Only the author (or the owner) can delete
        assert.equal((await t.call('DELETE', `/documents/${id}/comments/${guest.body.id}`, { headers: { 'x-comment-token': 'h'.repeat(40) } })).status, 403);
        assert.equal((await t.call('DELETE', `/documents/${id}/comments/${guest.body.id}`, { headers: { 'x-comment-token': token } })).status, 200);
        assert.equal((await t.call('DELETE', `/documents/${id}/comments/${member.body.id}`, { as: 'stranger' })).status, 403);
        assert.equal((await t.call('DELETE', `/documents/${id}/comments/${member.body.id}`, { as: 'owner' })).status, 200);

        // Locked files have no comments
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { locked: true } });
        assert.equal((await t.call('GET', `/documents/${id}/comments`, { as: 'owner' })).status, 423);
    } finally { await t.close(); }
});

test('comments: replies thread under a comment, and threads resolve and reopen', async () => {
    const t = await setup();
    try {
        const { body: { id } } = await t.call('POST', '/documents', { as: 'owner', body: { kind: 'spreadsheet', ...content } });
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { linkAccess: 'suggest' } });
        const token = 'r'.repeat(40);
        const thread = (await t.call('POST', `/documents/${id}/comments`, { as: 'suggester', body: { ...content } })).body;
        assert.equal(thread.parentId, null);
        const reply = await t.call('POST', `/documents/${id}/comments`, { body: { ...content, token, parentId: thread.id } });
        assert.equal(reply.status, 201);
        assert.equal(reply.body.parentId, thread.id);
        // Replies cannot nest, and parents must exist
        assert.equal((await t.call('POST', `/documents/${id}/comments`, { as: 'owner', body: { ...content, parentId: reply.body.id } })).status, 404);
        assert.equal((await t.call('POST', `/documents/${id}/comments`, { as: 'owner', body: { ...content, parentId: '999' } })).status, 404);
        assert.equal((await t.call('POST', `/documents/${id}/comments`, { as: 'owner', body: { ...content, parentId: 5 } })).status, 400);

        // Anyone who can comment resolves, including guests on a Suggest link; replies cannot be resolved
        assert.equal((await t.call('PATCH', `/documents/${id}/comments/${thread.id}`, { body: { resolved: true } })).body.resolved, true);
        assert.equal((await t.call('PATCH', `/documents/${id}/comments/${reply.body.id}`, { as: 'owner', body: { resolved: true } })).status, 404);
        assert.equal((await t.call('PATCH', `/documents/${id}/comments/${thread.id}`, { as: 'owner', body: { resolved: 'yes' } })).status, 400);
        let list = (await t.call('GET', `/documents/${id}/comments`, { as: 'owner' })).body.comments;
        assert.equal(list.find(c => c.id === thread.id).resolved, true);

        // Replying reopens the thread
        await t.call('POST', `/documents/${id}/comments`, { as: 'owner', body: { ...content, parentId: thread.id } });
        list = (await t.call('GET', `/documents/${id}/comments`, { as: 'owner' })).body.comments;
        assert.equal(list.find(c => c.id === thread.id).resolved, false);

        // View-only people cannot resolve
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { linkAccess: 'view' } });
        assert.equal((await t.call('PATCH', `/documents/${id}/comments/${thread.id}`, { body: { resolved: true } })).status, 403);

        // Deleting a thread deletes its replies
        await t.call('DELETE', `/documents/${id}/comments/${thread.id}`, { as: 'owner' });
        assert.equal((await t.call('GET', `/documents/${id}/comments`, { as: 'owner' })).body.comments.length, 0);
    } finally { await t.close(); }
});

test('live cursors are relayed to others and replayed to newcomers', async () => {
    const t = await setup();
    try {
        const { body: { id } } = await t.call('POST', '/documents', { as: 'owner', body: { kind: 'document', ...content } });
        await t.call('PATCH', `/documents/${id}`, { as: 'owner', body: { linkAccess: 'edit' } });
        assert.equal((await t.call('POST', `/documents/${id}/cursor`, { as: 'owner', body: { cursor: { page: 0, offset: 1 } } })).status, 400, 'needs a client id');
        const first = new AbortController();
        await fetch(`${t.origin}/api/collab/documents/${id}/events?client=owner-client-1`, { headers: { 'x-test-account': 'owner' }, signal: first.signal });
        assert.equal((await t.call('POST', `/documents/${id}/cursor`, { as: 'owner', client: 'owner-client-1', body: { cursor: { page: 0, offset: 5, length: 2 } } })).status, 200);
        const second = new AbortController();
        const response = await fetch(`${t.origin}/api/collab/documents/${id}/events?client=late-client-1`, { headers: { 'x-test-account': 'stranger' }, signal: second.signal });
        const reader = response.body.getReader();
        let text = '';
        while (!text.includes('"type":"cursor"')) text += new TextDecoder().decode((await reader.read()).value);
        assert.match(text, /"clientId":"owner-client-1","cursor":\{"page":0,"offset":5,"length":2\}/);
        first.abort(); second.abort();
    } finally { await t.close(); }
});

test('ciphertext splits into database-sized parts', () => {
    assert.deepEqual(splitParts(''), ['']);
    const parts = splitParts('a'.repeat(PART_BYTES * 2 + 5));
    assert.equal(parts.length, 3);
    assert.equal(parts.join('').length, PART_BYTES * 2 + 5);
});
