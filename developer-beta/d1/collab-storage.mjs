import { publicPicturePredicate } from '../../collab/store.js';
import { createHash, randomUUID } from 'node:crypto';

const partSize = 256 * 1024;
const validId = id => /^[0-9]{1,20}$/.test(id);

export function createCollabDirectory(accounts) {
    return {
        async listShared(accountId) {
            const { results } = await accounts.prepare(
                'SELECT i.document_id AS id, i.kind, i.role, o.email, p.display_name AS name ' +
                'FROM munetios_collab_invitations i JOIN munetios_accounts o ON o.id = i.owner_id ' +
                'LEFT JOIN munetios_profiles p ON p.account_id = i.owner_id WHERE i.account_id = ? ORDER BY i.added_at DESC'
            ).bind(accountId).all();
            return results.map(({ id, kind, role, email, name }) => ({ id, kind, role, owner: name || email.split('@')[0] }));
        },
        upsert(doc, accountId, role) {
            return accounts.prepare(
                'INSERT INTO munetios_collab_invitations (account_id, document_id, owner_id, kind, role) VALUES (?, ?, ?, ?, ?) ' +
                'ON CONFLICT(account_id, document_id) DO UPDATE SET role = excluded.role'
            ).bind(accountId, doc.id, doc.ownerId, doc.kind, role).run();
        },
        indexExisting(doc, members) {
            return accounts.prepare(
                'INSERT INTO munetios_collab_invitations (account_id, document_id, owner_id, kind, role) ' +
                "SELECT a.id, ?, ?, ?, json_extract(m.value, '$.role') FROM json_each(?) m " +
                "JOIN munetios_accounts a ON a.id = json_extract(m.value, '$.accountId') WHERE 1 " +
                'ON CONFLICT(account_id, document_id) DO UPDATE SET role = excluded.role'
            ).bind(doc.id, doc.ownerId, doc.kind, JSON.stringify(members)).run();
        },
        remove(id, accountId) {
            return accounts.prepare('DELETE FROM munetios_collab_invitations WHERE document_id = ? AND account_id = ?').bind(id, accountId).run();
        },
        removeDocument(id) {
            return accounts.prepare('DELETE FROM munetios_collab_invitations WHERE document_id = ?').bind(id).run();
        }
    };
}

export function createCollabStore(storage, accounts, documentId, bucket) {
    const directory = createCollabDirectory(accounts);
    const { sql } = storage;
    sql.exec('CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID');
    sql.exec("INSERT INTO records VALUES ('collab-id', ?) ON CONFLICT(key) DO NOTHING", JSON.stringify(documentId));
    const read = key => sql.exec('SELECT value FROM records WHERE key = ?', key).toArray()[0]?.value;
    const write = (key, value) => sql.exec('INSERT INTO records VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
    const remove = key => sql.exec('DELETE FROM records WHERE key = ?', key).rowsWritten > 0;
    const scan = prefix => sql.exec('SELECT key, value FROM records WHERE key >= ? AND key < ? ORDER BY key', prefix, prefix + '\uffff').toArray();
    const clear = prefix => sql.exec('DELETE FROM records WHERE key >= ? AND key < ?', prefix, prefix + '\uffff');
    const get = key => JSON.parse(read(key) ?? 'null');
    const put = (key, value) => write(key, JSON.stringify(value));
    const list = prefix => scan(prefix).map(row => JSON.parse(row.value));
    const atomic = work => storage.transactionSync(work);
    const document = id => id === documentId ? get('document') : null;
    let membershipUpdates = Promise.resolve();
    function updateMembership(work) {
        const result = membershipUpdates.then(work);
        membershipUpdates = result.catch(() => {});
        return result;
    }
    const nextId = type => {
        const next = (get('sequence:' + type) || 0) + 1;
        put('sequence:' + type, next);
        return String(next);
    };
    function writeParts(prefix, text) {
        clear(prefix);
        for (let offset = 0; offset < text.length; offset += partSize) {
            write(prefix + String(offset).padStart(10, '0'), text.slice(offset, offset + partSize));
        }
    }
    const readParts = prefix => scan(prefix).map(row => row.value).join('');
    const documentParts = 'part:document:';
    const garbage = 'r2-delete:';
    const grace = 10 * 60 * 1000;
    async function scheduleObjectCleanup(at) {
        const alarm = await storage.getAlarm();
        if (alarm === null || alarm > at) await storage.setAlarm(at);
    }
    async function stageDocument(ciphertext) {
        const key = `collab/${documentId}/${randomUUID()}`;
        const at = Date.now() + 60 * 60 * 1000;
        put(garbage + key, at);
        await scheduleObjectCleanup(at);
        await bucket.put(key, ciphertext, { sha256: createHash('sha256').update(ciphertext, 'ascii').digest('hex') });
        return key;
    }
    function storeContent(doc, priorKey, objectKey, ciphertext) {
        if (objectKey && !remove(garbage + objectKey)) throw new Error('Pending collaboration upload expired');
        if (priorKey) put(garbage + priorKey, Date.now() + grace);
        put('document', { ...doc, ...(objectKey ? { objectKey } : {}) });
        if (objectKey) clear(documentParts);
        else writeParts(documentParts, ciphertext);
    }
    async function moveInlineDocument(doc, ciphertext) {
        const key = await stageDocument(ciphertext);
        return atomic(() => {
            const latest = document(doc.id);
            if (!latest || latest.version !== doc.version || latest.objectKey) return false;
            storeContent(latest, null, key);
            return true;
        });
    }
    async function readDocumentContent(doc) {
        if (doc.objectKey) {
            const object = await bucket?.get(doc.objectKey);
            if (!object) throw new Error('Missing collaboration document object');
            return object.text();
        }
        const ciphertext = readParts(documentParts);
        if (bucket && ciphertext) {
            try {
                await moveInlineDocument(doc, ciphertext);
            } catch {
                // The inline copy remains authoritative until the object is committed.
            }
        }
        return ciphertext;
    }
    async function people(ids) {
        const unique = [...new Set(ids)].filter(validId);
        const found = [];
        for (let offset = 0; offset < unique.length; offset += 90) {
            const batch = unique.slice(offset, offset + 90);
            const rows = await accounts.prepare(
                'SELECT CAST(a.id AS TEXT) AS accountId, a.email, p.display_name AS displayName, (v.account_id IS NOT NULL) AS hasPicture ' +
                'FROM munetios_accounts a LEFT JOIN munetios_profiles p ON p.account_id = a.id ' +
                'LEFT JOIN munetios_profile_pictures v ON v.account_id = a.id AND ' + publicPicturePredicate +
                ' WHERE a.id IN (' + batch.map(() => '?').join(', ') + ')'
            ).bind(...batch).all();
            found.push(...rows.results.map(row => ({ ...row, hasPicture: Boolean(row.hasPicture) })));
        }
        return found;
    }
    const personMap = async records => new Map((await people(records.map(row => row.accountId).filter(Boolean))).map(row => [row.accountId, row]));

    return {
        async createDocument({ id, ownerId, kind, iv, ciphertext }) {
            const objectKey = bucket ? await stageDocument(ciphertext) : null;
            atomic(() => {
                if (document(id)) throw new Error('Document already exists');
                storeContent({ id, ownerId, kind, iv, version: 1, linkAccess: 'off', locked: false, updatedAt: Date.now() },
                    null, objectKey, ciphertext);
                put('member-directory-ready', true);
            });
        },
        async getDocument(id) {
            const doc = document(id);
            if (!doc) return null;
            const owner = await accounts.prepare('SELECT 1 FROM munetios_accounts WHERE id = ?').bind(doc.ownerId).first();
            return owner ? document(id) : null;
        },
        getContent(id) {
            const doc = document(id);
            return doc ? readDocumentContent(doc) : '';
        },
        async getContentSnapshot(id) {
            const doc = document(id);
            return doc && { version: doc.version, iv: doc.iv, locked: doc.locked, ciphertext: doc.locked ? '' : await readDocumentContent(doc) };
        },
        async updateContent(id, baseVersion, iv, ciphertext) {
            const initial = document(id);
            if (!initial || initial.locked || initial.version !== baseVersion) return null;
            const objectKey = bucket ? await stageDocument(ciphertext) : null;
            if (initial.objectKey && !objectKey) throw new Error('Collaboration media bucket is unavailable');
            if (bucket) await scheduleObjectCleanup(Date.now() + grace);
            return atomic(() => {
                const doc = document(id);
                if (!doc || doc.locked || doc.version !== baseVersion) return null;
                const version = baseVersion + 1;
                storeContent({ ...doc, iv, version, updatedAt: Date.now() }, doc.objectKey, objectKey, ciphertext);
                return version;
            });
        },
        async cleanObjects() {
            if (!bucket) return;
            const now = Date.now();
            const pending = scan(garbage).map(row => ({ key: row.key, at: JSON.parse(row.value) }));
            const expired = pending.filter(row => row.at <= now);
            for (let index = 0; index < expired.length; index += 250) {
                const batch = expired.slice(index, index + 250);
                await bucket.delete(batch.map(row => row.key.slice(garbage.length)));
                for (const row of batch) if (get(row.key) === row.at) remove(row.key);
            }
            const next = scan(garbage).reduce((at, row) => Math.min(at, JSON.parse(row.value)), Infinity);
            if (Number.isFinite(next)) await scheduleObjectCleanup(next);
        },
        updateSettings(id, { linkAccess, locked, contentKey }) {
            return atomic(() => {
                const doc = document(id);
                if (!doc) return false;
                put('document', { ...doc, linkAccess: linkAccess ?? doc.linkAccess, locked: locked ?? doc.locked, updatedAt: Date.now() });
                if (linkAccess === 'off') {
                    const linkKey = get('link-key');
                    if (linkKey && !get('invitation-key') && scan('member:').length) put('invitation-key', linkKey);
                    remove('link-key');
                }
                else if (contentKey) put('link-key', contentKey);
                return true;
            });
        },
        getInvitationKey(id, accountId) {
            const doc = document(id);
            if (!doc || doc.locked || !get('member:' + accountId)) return null;
            return get('invitation-key') || (doc.linkAccess === 'off' ? null : get('link-key'));
        },
        prepareInvitationKey(id, key) {
            return atomic(() => {
                const doc = document(id);
                if (!doc || doc.locked || !scan('member:').length) return false;
                if (get('invitation-key') !== key) put('invitation-key', key);
                return true;
            });
        },
        deleteDocument(id) {
            return updateMembership(async () => {
                if (!document(id)) return;
                await directory.removeDocument(id);
                await scheduleObjectCleanup(Date.now() + grace);
                atomic(() => {
                    const key = document(id)?.objectKey;
                    if (key) put(garbage + key, Date.now() + grace);
                    remove('document');
                    remove('link-key');
                    remove('invitation-key');
                    for (const prefix of ['part:', 'member:', 'suggestion:', 'comment:']) clear(prefix);
                });
            });
        },
        people,
        async listMembers(id) {
            const members = document(id) ? list('member:') : [];
            const profiles = await personMap(members);
            return members.sort((a, b) => a.addedAt - b.addedAt).flatMap(member => {
                const profile = profiles.get(member.accountId);
                return profile ? [{ ...profile, role: member.role }] : [];
            });
        },
        getMemberRole(id, accountId) {
            return document(id) ? get('member:' + accountId)?.role || null : null;
        },
        indexLegacyMembers(id) {
            if (get('member-directory-ready')) return;
            return updateMembership(async () => {
                const doc = document(id);
                if (!doc || get('member-directory-ready')) return;
                const members = list('member:');
                if (members.length) await directory.indexExisting(doc, members);
                put('member-directory-ready', true);
            });
        },
        upsertMember(id, accountId, role, invitationKey) {
            return updateMembership(async () => {
                const doc = document(id);
                if (!doc || doc.locked) return false;
                const key = 'member:' + accountId;
                await directory.upsert(doc, accountId, role);
                atomic(() => {
                    put(key, { accountId, role, addedAt: get(key)?.addedAt ?? Date.now() });
                    if (invitationKey) put('invitation-key', invitationKey);
                });
                return true;
            });
        },
        removeMember(id, accountId) {
            return updateMembership(async () => {
                await directory.remove(id, accountId);
                return atomic(() => {
                    if (!document(id) || !remove('member:' + accountId)) return false;
                    if (!scan('member:').length) remove('invitation-key');
                    return true;
                });
            });
        },
        async getPicture(accountId) {
            const row = await accounts.prepare('SELECT v.picture FROM munetios_profile_pictures v WHERE v.account_id = ? AND ' + publicPicturePredicate).bind(accountId).first();
            return row?.picture ?? null;
        },
        saveSuggestion({ documentId: id, accountId, tokenHash, baseVersion, iv, ciphertext }) {
            return atomic(() => {
                if (!document(id)) return null;
                const current = list('suggestion:').find(row => row.status === 'open' &&
                    (accountId ? row.accountId === accountId : row.tokenHash === tokenHash));
                const suggestionId = current?.id ?? nextId('suggestion');
                put('suggestion:' + suggestionId, { id: suggestionId, accountId, tokenHash, baseVersion, iv, status: 'open', updatedAt: Date.now() });
                writeParts('part:suggestion:' + suggestionId + ':', ciphertext);
                return suggestionId;
            });
        },
        async listSuggestions(id, accountId, tokenHash) {
            if (!document(id)) return [];
            const suggestions = list('suggestion:').filter(row => row.status === 'open' &&
                (!accountId || row.accountId === accountId) && (!tokenHash || row.tokenHash === tokenHash));
            const authors = await personMap(suggestions);
            return suggestions.sort((a, b) => b.updatedAt - a.updatedAt || Number(b.id) - Number(a.id)).flatMap(row => {
                const author = authors.get(row.accountId);
                return author || row.tokenHash ? [{ ...row, author: author ?? null }] : [];
            });
        },
        getSuggestion(id, suggestionId) {
            const row = document(id) && get('suggestion:' + suggestionId);
            if (!row || row.status !== 'open') return null;
            return { id: row.id, accountId: row.accountId, tokenHash: row.tokenHash, baseVersion: row.baseVersion, iv: row.iv, ciphertext: readParts('part:suggestion:' + suggestionId + ':') };
        },
        resolveSuggestion(id, suggestionId, status) {
            return atomic(() => {
                const key = 'suggestion:' + suggestionId;
                const row = document(id) && get(key);
                if (!row || row.status !== 'open') return false;
                put(key, { ...row, status });
                clear('part:suggestion:' + suggestionId + ':');
                return true;
            });
        },
        async listComments(id) {
            if (!document(id)) return [];
            const comments = list('comment:');
            const authors = await personMap(comments);
            return comments.sort((a, b) => Number(a.id) - Number(b.id)).map(row => ({ ...row, author: authors.get(row.accountId) ?? null }));
        },
        addComment({ documentId: id, parentId, accountId, tokenHash, iv, ciphertext }) {
            return atomic(() => {
                if (!document(id)) return null;
                if (parentId) {
                    const parentKey = 'comment:' + parentId;
                    const parent = get(parentKey);
                    if (!parent || parent.parentId) return null;
                    if (parent.resolved) put(parentKey, { ...parent, resolved: false, resolvedAt: null });
                }
                const commentId = nextId('comment');
                put('comment:' + commentId, { id: commentId, parentId, accountId, tokenHash, iv, ciphertext, createdAt: Date.now() });
                return commentId;
            });
        },
        getComment(id, commentId) {
            return document(id) ? get('comment:' + commentId) : null;
        },
        setCommentResolved(id, commentId, resolved) {
            const key = 'comment:' + commentId;
            const comment = document(id) && get(key);
            if (!comment || comment.parentId) return false;
            put(key, { ...comment, resolved, resolvedAt: resolved ? Date.now() : null });
            return true;
        },
        deleteComment(id, commentId) {
            if (!document(id)) return false;
            return atomic(() => {
                if (!remove('comment:' + commentId)) return false;
                for (const comment of list('comment:')) if (comment.parentId === commentId) remove('comment:' + comment.id);
                return true;
            });
        },
        isCommentAuthor(id, accountId) {
            return Boolean(document(id) && list('comment:').some(comment => comment.accountId === accountId));
        },
        createReport(report) {
            return atomic(() => {
                const id = nextId('report');
                put('report:' + id, { ...report, status: 'open', createdAt: Date.now() });
                return id;
            });
        },
    };
}

