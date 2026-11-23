/*
 * Munetios real-time collaboration for OmniWrite documents and spreadsheets.
 *
 *  - Share opens this dialog (Munetios UI v4). "More ways to share" opens the previous dialog.
 *  - Sharing needs a Munetios account. Files shared with "Anyone with the link" can be viewed
 *    by anyone, signed in or not; the owner chooses the link's role (View only, Suggest, Editor),
 *    and signed-out visitors always get View only.
 *  - Content is encrypted with AES-GCM. The owner supplies the key to the server
 *    while anyone-with-the-link sharing is enabled.
 *  - Locked documents and spreadsheets cannot be used for collaboration.
 *  - Link-shared files get a Report item in More.
 *
 * Talks to OmniWrite through window.OmniCollabHost (index.html) and to Sheets through
 * window.OmniSheets.collab (sheets/sheets.js). Server: /api/collab (collab/router.js).
 */
(() => {
    'use strict';
    const API = '/api/collab';
    const TICK_MS = 400;
    const PUSH_DELAY_MS = 300;
    const SUGGEST_DELAY_MS = 1200;
    const RETRY_MS = 30000;
    const REASONS = ['spam', 'harassment', 'hate', 'violence', 'sexual', 'illegal', 'phishing', 'privacy', 'copyright', 'other'];
    const ROLES = ['edit', 'suggest', 'view'];

    /* ================================================================ i18n
       Strings live in languages/<locale>.json; English below is only a fallback. */
    const EN = {
        collab_share_title: 'Share “{name}”', collab_intro_title: 'Collaborate in real time',
        collab_intro_desc: 'Edit together and see who is here.',
        collab_link_server_access: 'Munetios can read files shared with anyone who has the link.',
        collab_start: 'Start collaborating', collab_sign_in_required: 'Sign in to your Munetios account to share and collaborate.',
        auth_sign_in: 'Sign in', collab_add_people: 'Add people', collab_email: 'Email address', collab_invite: 'Invite',
        collab_people: 'People with access', collab_here_now: 'Here now', collab_general_access: 'General access',
        collab_restricted: 'Restricted', collab_restricted_desc: 'Only people you add can open it.',
        collab_anyone_link: 'Anyone with the link', collab_anyone_link_desc: 'Anyone with the link can open it, even without an account. Signed-out visitors can only view.',
        collab_role: 'Role', collab_role_owner: 'Owner', collab_role_edit: 'Editor', collab_role_suggest: 'Suggest', collab_role_view: 'View only',
        collab_suggesting: 'Suggesting', collab_remove: 'Remove access', collab_copy_link: 'Copy link', collab_link_copied: 'Link copied.',
        collab_more_ways: 'More ways to share', collab_stop_sharing: 'Stop sharing',
        collab_add_to_documents: 'Add to my documents', collab_shared_empty: 'No shared files yet.',
        collab_shared_load_failed: "Couldn't load shared files.",
        collab_shared_original_link: 'Open the original share link to access this file.',
        collab_stop_confirm: 'Stop sharing? Collaborators lose access, and your copy stays on this device.',
        collab_stopped: 'Sharing stopped.', collab_leave: 'Leave', collab_you: 'You', collab_anonymous: 'Anonymous',
        collab_suggestions: 'Suggestions', collab_suggestion_from: 'Suggested changes from {name}', collab_show_changes: 'Show changes',
        collab_accept: 'Accept', collab_reject: 'Reject', collab_withdraw: 'Withdraw', collab_no_suggestions: 'No suggestions yet.',
        collab_suggestion_pending: 'Your suggested changes are waiting for review.', collab_suggestion_accepted: 'Suggestion accepted.',
        collab_suggestion_rejected: 'Suggestion rejected.', collab_live: 'Live', collab_offline: 'Offline. Changes sync when you reconnect.',
        collab_view_only_toast: 'You have view-only access.',
        collab_link_locked: 'This file is locked by its owner, so it can’t be opened right now.',
        collab_link_no_access: 'You don’t have access to this file. Ask the owner to add you.',
        collab_link_sign_in: 'Sign in to open this file.', collab_link_not_found: 'This file doesn’t exist or is no longer shared.',
        collab_open_share_failed: "Couldn't open share dialog.", collab_failed: "Couldn't update sharing.",
        collab_link_failed: "Couldn't open the shared file.", collab_changes_failed: "Couldn't load suggested changes.",
        collab_no_account: 'No Munetios account uses this email.',
        collab_invited: 'Added {email}.', collab_access_removed: 'Your access to this file was removed.',
        collab_stopped_remote: 'The owner stopped sharing this file.', collab_locked_paused: 'Collaboration is paused while this file is locked.',
        collab_role_changed: 'Your role is now {role}.', collab_report: 'Report', collab_report_title: 'Report this file',
        collab_report_desc: 'Tell us what’s wrong. The owner won’t see who reported it.', collab_reason: 'Reason',
        collab_reason_spam: 'Spam', collab_reason_harassment: 'Harassment or bullying', collab_reason_hate: 'Hate speech',
        collab_reason_violence: 'Violence or threats', collab_reason_sexual: 'Sexual content', collab_reason_illegal: 'Illegal activity',
        collab_reason_phishing: 'Phishing, scams, or malware', collab_reason_privacy: 'Personal information', collab_reason_copyright: 'Copyright infringement',
        collab_reason_other: 'Something else', collab_report_details: 'Details (optional)', collab_report_include: 'Let reviewers open this file',
        collab_report_include_desc: 'Shares the link’s key with Munetios reviewers so they can check the content.',
        collab_report_submit: 'Submit report', collab_report_thanks: 'Thank you for reporting.',
        collab_report_failed: "We couldn't submit reports. Try again.", collab_cancel: 'Cancel', collab_close: 'Close',
        comments_title: 'Comments', comment_add: 'Add comment', comment_placeholder: 'Add a comment', comment_post: 'Comment',
        comment_your_name: 'Your name', comment_guest: 'Guest', comment_delete: 'Delete comment', comment_deleted: 'Comment deleted.',
        comment_added: 'Comment added.', comment_failed: "Couldn't post the comment. Try again.",
        comments_empty: 'No comments yet. Select text or cells to comment on them.', comment_cell: 'Cell {cell}',
        comment_general: 'Comment on the whole file', comment_show: 'Show in file', comment_orphaned: 'The commented text was changed or removed.',
        comments_view_only: 'Only people who can suggest or edit can add comments.', comment_name_required: 'Enter your name to comment.',
        comments_locked: 'Comments are hidden while this file is locked.', comments_unavailable: "Comments aren't available right now. Try again when you're online.",
        comment_reply: 'Reply', comment_reply_placeholder: 'Write a reply', comment_resolve: 'Resolve', comment_reopen: 'Reopen',
        comment_resolved: 'Comment resolved.', comment_reopened: 'Comment reopened.', comment_resolved_badge: 'Resolved',
        comments_filter_open: 'Open', comments_filter_resolved: 'Resolved', comments_resolved_empty: 'No resolved comments.',
        comments_open_empty: 'No open comments. Resolved comments are under Resolved.'
    };
    function t(key, vars) {
        let text = typeof window._t === 'function' ? window._t(key) : key;
        if (!text || text === key) text = EN[key] ?? key;
        return vars ? String(text).replace(/\{(\w+)\}/g, (match, name) => (vars[name] ?? match)) : text;
    }
    const lang = () => { try { return localStorage.getItem('omniwrite-lang') || navigator.language || 'en'; } catch { return 'en'; } };
    function formatTime(ms) {
        try {
            const text = new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
            return text.replace(/\bAM\b/g, 'NM').replace(/\bPM\b/g, 'AN');
        } catch { return new Date(ms).toISOString(); }
    }
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const toast = (message, type = 'info') => {
        if (window.MunetiosUI) window.MunetiosUI.toast(message, { type });
        else if (typeof window.showToast === 'function') window.showToast(message, { type });
    };

    /* ================================================================ encoding, crypto */
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    function toBase64(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(binary);
    }
    function fromBase64(text) {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    const toBase64Url = bytes => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fromBase64Url = text => fromBase64(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    const randomId = bytes => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
    const clientId = randomId(12);
    const keyCache = new Map();
    function cryptoKey(keyText) {
        if (!keyCache.has(keyText)) keyCache.set(keyText, crypto.subtle.importKey('raw', fromBase64Url(keyText), 'AES-GCM', false, ['encrypt', 'decrypt']));
        return keyCache.get(keyText);
    }
    const aad = kind => encoder.encode('munetios-collab:' + kind);
    async function seal(keyText, kind, value) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = encoder.encode(JSON.stringify({ v: 1, value }));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(kind) }, await cryptoKey(keyText), data);
        return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(cipher)) };
    }
    async function unseal(keyText, kind, iv, ciphertext) {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: aad(kind) }, await cryptoKey(keyText), fromBase64(ciphertext));
        return JSON.parse(decoder.decode(plain)).value;
    }
    // Small non-cryptographic hash: remembers which local state was last in sync.
    function hash(text) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i++) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
    }

    /* ================================================================ API */
    async function api(method, path, body, extraHeaders = {}) {
        const headers = { 'X-Collab-Client': clientId, ...extraHeaders };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(API + path, {
            method, credentials: 'same-origin', cache: 'no-store', headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let data = null;
        try { data = await response.json(); } catch {}
        if (!response.ok) throw Object.assign(new Error(data?.error || 'unavailable'), { status: response.status, code: data?.error || 'unavailable', data });
        return data;
    }
    const signedIn = () => !!(window.MunetiosAccount && window.MunetiosAccount.state && window.MunetiosAccount.state.account);
    const signInUrl = () => '/signin?continue=' + encodeURIComponent(location.pathname + location.search + location.hash);
    const shareLink = (id, key) => location.origin + location.pathname.replace(/index\.html$/, '') + '#/shared/' + id + '/' + key;
    const pictureUrl = (docId, accountId) => `${API}/documents/${encodeURIComponent(docId)}/people/${encodeURIComponent(accountId)}/picture`;

    /* ================================================================ adapters: documents and spreadsheets */
    const sheetsBridge = () => (window.OmniSheets && window.OmniSheets.collab) || null;
    const adapters = {
        document: {
            current: () => (window.OmniCollabHost ? window.OmniCollabHost.current() : null),
            all: () => (window.OmniCollabHost ? window.OmniCollabHost.all() : []),
            isLocked: item => window.OmniCollabHost.isLocked(item),
            // Remote changes wait while an IME composition is in progress.
            isEditing: () => !!window.__omniComposing,
            snapshot: item => window.OmniCollabHost.snapshot(item),
            apply: (item, snap) => (window.__omniComposing ? false : window.OmniCollabHost.apply(item, snap)),
            setReadOnly: (item, readOnly) => window.OmniCollabHost.setReadOnly(item, readOnly),
            create: data => window.OmniCollabHost.create(data),
            open: item => window.OmniCollabHost.open(item.id),
            save: item => window.OmniCollabHost.save(item),
            refreshLibrary: () => window.OmniCollabHost.refreshLibrary(),
            addToLibrary: item => window.OmniCollabHost.addToLibrary(item),
            legacyShare: () => window.OmniCollabHost.legacyShare(),
            navbar: () => document.querySelector('#editorContent .navbar__right'),
            shareButton: () => document.getElementById('shareDocumentBtn')
        },
        spreadsheet: {
            current: () => sheetsBridge()?.current() || null,
            all: () => sheetsBridge()?.all() || [],
            isLocked: item => sheetsBridge().isLocked(item),
            isEditing: item => sheetsBridge().isEditing(item),
            snapshot: item => sheetsBridge().snapshot(item),
            apply: (item, snap) => sheetsBridge().apply(item, snap),
            setReadOnly: (item, readOnly) => sheetsBridge().setReadOnly(item, readOnly),
            create: data => sheetsBridge().create(data),
            open: item => sheetsBridge().open(item.id),
            save: item => sheetsBridge().save(item),
            refreshLibrary: () => sheetsBridge().refreshLibrary(),
            addToLibrary: item => sheetsBridge().addToLibrary(item),
            legacyShare: () => window.OmniSheets && window.OmniSheets.legacyShare(),
            navbar: () => document.querySelector('#sheetEditorApp .navbar__right'),
            shareButton: () => document.getElementById('shShareDocumentBtn')
        }
    };
    document.addEventListener('compositionstart', () => { window.__omniComposing = true; }, true);
    document.addEventListener('compositionend', () => { window.__omniComposing = false; }, true);
    const titleOf = item => String(item?.title || '');
    const collabOf = item => (item && item.collab && item.collab.localId === item.id && item.collab.id ? item.collab : null);
    function activeItem() {
        for (const kind of ['document', 'spreadsheet']) {
            const item = adapters[kind].current();
            if (item) return { kind, item };
        }
        return null;
    }

    /* ================================================================ merging
       Concurrent edits are combined with a three-way merge against the last synced version.
       Documents merge by block, then by character inside a block both people changed.
       Spreadsheets merge by cell and by sheet setting. On a true conflict, the local edit wins
       for this person; the merged result is pushed, so everyone converges. */
    function matches(base, other) {
        // LCS index pairs after trimming the common prefix and suffix.
        const pairs = [];
        let head = 0;
        while (head < base.length && head < other.length && base[head] === other[head]) { pairs.push([head, head]); head++; }
        let tail = 0;
        while (tail < base.length - head && tail < other.length - head && base[base.length - 1 - tail] === other[other.length - 1 - tail]) tail++;
        const a = base.slice(head, base.length - tail), b = other.slice(head, other.length - tail);
        if (a.length && b.length) {
            const width = b.length + 1;
            const table = new Uint32Array((a.length + 1) * width);
            for (let i = a.length - 1; i >= 0; i--) {
                for (let j = b.length - 1; j >= 0; j--) {
                    table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
                }
            }
            let i = 0, j = 0;
            while (i < a.length && j < b.length) {
                if (a[i] === b[j]) { pairs.push([head + i, head + j]); i++; j++; }
                else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
                else j++;
            }
        }
        for (let k = tail; k > 0; k--) pairs.push([base.length - k, other.length - k]);
        return pairs;
    }
    const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
    function merge3(base, mine, theirs, conflict) {
        const toMine = new Map(matches(base, mine));
        const toTheirs = new Map(matches(base, theirs));
        const out = [];
        let o = 0, m = 0, th = 0;
        const flush = (oEnd, mEnd, tEnd) => {
            const chunkO = base.slice(o, oEnd), chunkM = mine.slice(m, mEnd), chunkT = theirs.slice(th, tEnd);
            if (sameList(chunkM, chunkO)) out.push(...chunkT);
            else if (sameList(chunkT, chunkO) || sameList(chunkM, chunkT)) out.push(...chunkM);
            else out.push(...conflict(chunkO, chunkM, chunkT));
        };
        for (let i = 0; i < base.length; i++) {
            if (!toMine.has(i) || !toTheirs.has(i)) continue;
            const mi = toMine.get(i), ti = toTheirs.get(i);
            if (mi < m || ti < th) continue;
            flush(i, mi, ti);
            out.push(base[i]);
            o = i + 1; m = mi + 1; th = ti + 1;
        }
        flush(base.length, mine.length, theirs.length);
        return out;
    }
    const PAGE_BREAK = '\u0000page';
    function documentTokens(content) {
        const template = document.createElement('template');
        template.innerHTML = String(content || '');
        const top = Array.from(template.content.childNodes).filter(node => node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim()));
        const paged = top.length > 0 && top.every(node => node.nodeType === 1 && node.matches('section.omniwrite-page'));
        const tokens = [];
        const push = nodes => Array.from(nodes).forEach(node => {
            if (node.nodeType === 1) tokens.push(node.outerHTML);
            else if (node.nodeType === 3) tokens.push(esc(node.textContent));
        });
        if (paged) top.forEach((page, index) => { if (index) tokens.push(PAGE_BREAK); push(page.childNodes); });
        else push(template.content.childNodes);
        return { paged, tokens };
    }
    function documentContent(tokens, paged) {
        if (!paged) return tokens.filter(token => token !== PAGE_BREAK).join('');
        const pages = [[]];
        tokens.forEach(token => (token === PAGE_BREAK ? pages.push([]) : pages[pages.length - 1].push(token)));
        return pages.map((page, index) => '<section class="omniwrite-page" data-page-index="' + (index + 1) + '">' + page.join('') + '</section>').join('');
    }
    function mergeText(base, mine, theirs) {
        return merge3(Array.from(base), Array.from(mine), Array.from(theirs), (o, m) => m).join('');
    }
    function blockConflict(chunkO, chunkM, chunkT) {
        if (chunkO.length === chunkM.length && chunkM.length === chunkT.length) return chunkO.map((block, index) => mergeText(block, chunkM[index], chunkT[index]));
        return [...chunkT, ...chunkM.filter(block => !chunkT.includes(block))];
    }
    function mergeDocuments(base, mine, theirs) {
        const pick = (b, m, th) => (m === b ? th : m);
        const m = documentTokens(mine.content), th = documentTokens(theirs.content);
        // Without a synced base (both sides changed while apart), the blocks they share act as the base.
        const b = base ? documentTokens(base.content) : { tokens: matches(m.tokens, th.tokens).map(([i]) => m.tokens[i]) };
        const tokens = merge3(b.tokens, m.tokens, th.tokens, blockConflict);
        return { title: pick(base ? base.title : theirs.title, mine.title, theirs.title), content: documentContent(tokens, m.paged || th.paged) };
    }
    const json = value => JSON.stringify(value === undefined ? null : value);
    function pickValue(b, m, th) {
        const jb = json(b), jm = json(m), jt = json(th);
        if (jm === jb) return th;
        if (jt === jb || jt === jm) return m;
        return m;
    }
    function mergeSheet(b, m, th) {
        const out = {};
        const keys = new Set([...Object.keys(b || {}), ...Object.keys(m || {}), ...Object.keys(th || {})]);
        keys.delete('cells');
        keys.forEach(key => {
            const value = pickValue(b?.[key], m?.[key], th?.[key]);
            if (value !== undefined) out[key] = value;
        });
        out.cells = {};
        const cells = new Set([...Object.keys(b?.cells || {}), ...Object.keys(m?.cells || {}), ...Object.keys(th?.cells || {})]);
        cells.forEach(key => {
            const value = pickValue(b?.cells?.[key], m?.cells?.[key], th?.cells?.[key]);
            if (value !== undefined && value !== null) out.cells[key] = value;
        });
        return out;
    }
    function mergeSpreadsheets(base, mine, theirs) {
        const byId = list => new Map((list || []).map(sheet => [sheet.id, sheet]));
        const b = byId(base?.sheets), m = byId(mine.sheets), th = byId(theirs.sheets);
        const order = [...(theirs.sheets || []).map(sheet => sheet.id), ...(mine.sheets || []).map(sheet => sheet.id).filter(id => !th.has(id))];
        const sheets = [];
        order.forEach(id => {
            const inBase = b.has(id), inMine = m.has(id), inTheirs = th.has(id);
            if (inBase && (!inMine || !inTheirs)) return; // deleted by someone
            if (!inBase && inMine && !inTheirs) return sheets.push(m.get(id));
            if (!inBase && !inMine && inTheirs) return sheets.push(th.get(id));
            sheets.push(mergeSheet(b.get(id), m.get(id), th.get(id)));
        });
        if (!sheets.length) sheets.push(...(theirs.sheets || []));
        return { title: pickValue(base ? base.title : theirs.title, mine.title, theirs.title), sheets };
    }
    const merge = (kind, base, mine, theirs) => (kind === 'document' ? mergeDocuments(base, mine, theirs) : mergeSpreadsheets(base, mine, theirs));

    // Readable list of what a suggestion changes, for the Suggestions section.
    function describeChanges(kind, base, proposed) {
        const changes = [];
        if (base.title !== proposed.title) changes.push({ removed: base.title, added: proposed.title });
        if (kind === 'document') {
            const text = html => { const div = document.createElement('div'); div.innerHTML = html; return div.textContent.trim(); };
            const b = documentTokens(base.content).tokens, p = documentTokens(proposed.content).tokens;
            const kept = new Set(matches(b, p).map(([i]) => i));
            const keptProposed = new Set(matches(b, p).map(([, j]) => j));
            const removed = b.filter((token, i) => !kept.has(i) && token !== PAGE_BREAK).map(text).filter(Boolean);
            const added = p.filter((token, j) => !keptProposed.has(j) && token !== PAGE_BREAK).map(text).filter(Boolean);
            removed.forEach(value => changes.push({ removed: value }));
            added.forEach(value => changes.push({ added: value }));
        } else {
            const baseSheets = new Map((base.sheets || []).map(sheet => [sheet.id, sheet]));
            (proposed.sheets || []).forEach(sheet => {
                const before = baseSheets.get(sheet.id);
                const keys = new Set([...Object.keys(before?.cells || {}), ...Object.keys(sheet.cells || {})]);
                keys.forEach(key => {
                    const was = before?.cells?.[key]?.v ?? '', now = sheet.cells?.[key]?.v ?? '';
                    if (String(was) === String(now)) return;
                    const [r, c] = key.split(':').map(Number);
                    let col = '', n = c + 1;
                    while (n > 0) { const rem = (n - 1) % 26; col = String.fromCharCode(65 + rem) + col; n = Math.floor((n - 1) / 26); }
                    changes.push({ label: sheet.name + '!' + col + (r + 1), removed: String(was), added: String(now) });
                });
            });
        }
        return changes;
    }

    /* ================================================================ sessions */
    let session = null;
    const blockedUntil = new Map(); // collab id -> time before trying again (locked, signed out, offline)
    const unlockRequests = new Map();

    function persist(s) {
        const meta = collabOf(s.item);
        if (!meta) return;
        meta.version = s.version;
        meta.role = s.role;
        meta.linkAccess = s.linkAccess;
        meta.syncedHash = hash(s.baseJson);
        adapters[s.kind].save(s.item);
    }
    function setBase(s, snap) {
        s.base = snap;
        s.baseJson = JSON.stringify(snap);
    }
    const run = (s, task) => (s.chain = s.chain.then(() => (session === s ? task() : undefined)).catch(error => console.warn('[collab]', error)));
    const canEdit = s => s.role === 'owner' || s.role === 'edit';

    function applyRemote(s, snap) {
        const adapter = adapters[s.kind];
        const mine = adapter.snapshot(s.item);
        if (adapter.apply(s.item, snap) === false) {
            s.deferred = { mine, target: snap };
            return false;
        }
        s.deferred = null;
        return true;
    }
    function retryDeferred(s) {
        if (!s.deferred || adapters[s.kind].isEditing(s.item)) return;
        const { mine, target } = s.deferred;
        const now = adapters[s.kind].snapshot(s.item);
        const next = JSON.stringify(now) === JSON.stringify(mine) ? target : merge(s.kind, mine, now, target);
        if (applyRemote(s, next) && canEdit(s)) schedulePush(s);
    }

    async function start(kind, item) {
        const meta = collabOf(item);
        const s = session = {
            kind, item, id: meta.id, key: meta.key, role: meta.role || 'view', version: meta.version || 0, linkAccess: meta.linkAccess || 'off',
            ready: false, status: 'connecting', people: [], chain: Promise.resolve(), base: null, baseJson: '', source: null,
            comments: [], commentsLoaded: false, cursors: new Map(), canComment: false
        };
        renderChrome();
        try {
            const data = await api('GET', `/documents/${s.id}`);
            if (session !== s) return;
            if (data.locked) throw Object.assign(new Error('locked'), { status: 423, code: 'locked' });
            const remote = await unseal(s.key, kind, data.iv, data.ciphertext);
            if (session !== s) return;
            Object.assign(s, { role: data.role, linkAccess: data.linkAccess, owner: data.owner, me: data.me, canComment: !!data.canComment });
            const adapter = adapters[kind];
            const local = adapter.snapshot(item);
            const localChanged = hash(JSON.stringify(local)) !== meta.syncedHash;
            const remoteChanged = data.version !== meta.version;
            s.version = data.version;
            setBase(s, remote);
            if (remoteChanged && !localChanged) {
                if (applyRemote(s, remote)) setBase(s, adapter.snapshot(item));
            } else if (remoteChanged && localChanged) {
                applyRemote(s, merge(kind, null, local, remote));
            }
            s.ready = true;
            s.status = 'live';
            persist(s);
            connect(s);
            detectLocal(s, true);
            renderChrome();
            refreshShareDialog();
            renderComments();
        } catch (error) {
            if (session === s) handleAccessError(s, error);
        }
    }
    function stop() {
        const s = session;
        if (!s) return;
        session = null;
        clearTimeout(s.pushTimer); clearTimeout(s.suggestTimer); clearTimeout(s.reconnectTimer);
        if (s.source) s.source.close();
        try { adapters[s.kind].setReadOnly(s.item, false); } catch {}
        s.cursors.clear();
        renderChrome();
        refreshShareDialog();
        scheduleCursorRender();
        renderComments();
    }
    function forget(item) {
        if (item && item.collab) {
            delete item.collab;
            const kind = adapters.spreadsheet.all().includes(item) ? 'spreadsheet' : 'document';
            adapters[kind].save(item);
        }
    }
    function handleAccessError(s, error) {
        const meta = collabOf(s.item);
        const item = s.item;
        stop();
        if (!meta) return;
        if (error.status === 423) {
            blockedUntil.set(meta.id, Date.now() + RETRY_MS);
            toast(t('collab_locked_paused'));
        } else if (error.status === 403 || error.status === 404) {
            if (meta.viewerAccountId !== undefined && meta.role !== 'owner') {
                meta.inaccessible = true;
                adapters[s.kind].save(item);
                adapters[s.kind].refreshLibrary();
            } else {
                forget(item);
            }
            toast(t(error.status === 404 ? 'collab_stopped_remote' : 'collab_access_removed'));
        } else if (error.status === 401) {
            blockedUntil.set(meta.id, Date.now() + RETRY_MS);
            toast(t('collab_link_sign_in'));
        } else {
            blockedUntil.set(meta.id, Date.now() + 5000); // offline: try again soon
        }
        renderChrome();
    }

    function connect(s) {
        if (session !== s) return;
        if (s.source) s.source.close();
        const source = new EventSource(`${API}/documents/${encodeURIComponent(s.id)}/events?client=${encodeURIComponent(clientId)}`, { withCredentials: true });
        s.source = source;
        source.onopen = () => { if (session === s) { s.status = 'live'; renderChrome(); } };
        source.onmessage = message => {
            if (session !== s) return;
            let event;
            try { event = JSON.parse(message.data); } catch { return; }
            onEvent(s, event);
        };
        source.onerror = () => {
            if (session !== s) return;
            s.status = 'offline';
            s.people = [];
            s.cursors.clear();
            scheduleCursorRender();
            renderChrome();
            if (source.readyState === EventSource.CLOSED) {
                // The server refused the stream: find out why (locked, removed) or reconnect later.
                clearTimeout(s.reconnectTimer);
                s.reconnectTimer = setTimeout(() => {
                    if (session !== s) return;
                    api('GET', `/documents/${s.id}`).then(data => {
                        if (data.locked) handleAccessError(s, { status: 423 });
                        else connect(s);
                    }).catch(error => (error.status ? handleAccessError(s, error) : connect(s)));
                }, 3000);
            }
        };
    }
    function onEvent(s, event) {
        switch (event.type) {
            case 'hello':
                s.status = 'live';
                if (event.role) s.role = event.role;
                if (event.linkAccess) s.linkAccess = event.linkAccess;
                if (typeof event.canComment === 'boolean') s.canComment = event.canComment;
                if (event.version > s.version) run(s, () => resync(s));
                loadComments(s); // catch up on comments missed while disconnected
                sendCursorSoon(true);
                break;
            case 'content':
                run(s, () => receive(s, event));
                break;
            case 'presence': {
                const wasAlone = !otherParticipants(s).length;
                s.people = Array.isArray(event.people) ? event.people : [];
                const others = otherParticipants(s);
                for (const id of s.cursors.keys()) if (!others.some(person => person.clientId === id)) s.cursors.delete(id);
                if (wasAlone && others.length) sendCursorSoon(true);
                scheduleCursorRender();
                break;
            }
            case 'role': {
                const changed = s.role !== event.role;
                s.role = event.role;
                if (typeof event.canComment === 'boolean') s.canComment = event.canComment;
                persist(s);
                if (changed) toast(t('collab_role_changed', { role: roleLabel(event.role) }));
                renderComments();
                break;
            }
            case 'comment':
                addRemoteComment(s, event.comment);
                return;
            case 'comment-deleted':
                s.comments = s.comments.filter(comment => comment.id !== event.id && comment.parentId !== event.id);
                renderComments();
                return;
            case 'comment-resolved': {
                const thread = s.comments.find(comment => comment.id === event.id);
                if (thread) { thread.resolved = !!event.resolved; renderComments(); }
                return;
            }
            case 'cursor':
                if (event.clientId === clientId) return;
                if (event.cursor) s.cursors.set(event.clientId, event.cursor); else s.cursors.delete(event.clientId);
                scheduleCursorRender();
                return;
            case 'settings':
                s.linkAccess = event.linkAccess;
                persist(s);
                break;
            case 'suggestions':
                if (event.author && s.me && event.author === s.me.accountId && event.status && event.resolved !== s.lastResolved) {
                    if (event.status === 'rejected') { applyRemote(s, s.base); toast(t('collab_suggestion_rejected')); }
                    else toast(t('collab_suggestion_accepted'), 'success');
                }
                refreshShareDialog(true);
                break;
            case 'revoked': handleAccessError(s, { status: 403 }); return;
            case 'locked': handleAccessError(s, { status: 423 }); return;
            case 'deleted': handleAccessError(s, { status: 404 }); return;
        }
        renderChrome();
        refreshShareDialog();
    }
    async function resync(s) {
        const data = await api('GET', `/documents/${s.id}`);
        if (data.version > s.version) await receive(s, data);
    }
    async function receive(s, event) {
        if (session !== s || event.version <= s.version) return;
        const theirs = await unseal(s.key, s.kind, event.iv, event.ciphertext);
        if (session !== s) return;
        const adapter = adapters[s.kind];
        const mine = adapter.snapshot(s.item);
        const unchanged = JSON.stringify(mine) === s.baseJson;
        const next = unchanged ? theirs : merge(s.kind, s.base, mine, theirs);
        s.version = event.version;
        setBase(s, theirs);
        const applied = applyRemote(s, next);
        if (applied && unchanged) setBase(s, adapter.snapshot(s.item));
        persist(s);
        if (!unchanged) {
            if (canEdit(s)) schedulePush(s);
            else if (s.role === 'suggest') scheduleSuggest(s);
        }
    }

    // Local changes: editors push, suggesters save a suggestion, View only ignores them.
    function detectLocal(s, force = false) {
        if (!s.ready || session !== s) return;
        const item = s.item;
        if (s.kind === 'document' && !force && item.content === s.lastContent && item.title === s.lastTitle) return;
        if (s.kind === 'spreadsheet' && !force && !s.dirty) return;
        s.dirty = false;
        s.lastContent = item.content; s.lastTitle = item.title;
        const current = JSON.stringify(adapters[s.kind].snapshot(item));
        if (current === s.baseJson) return;
        if (canEdit(s)) schedulePush(s);
        else if (s.role === 'suggest') scheduleSuggest(s);
    }
    function schedulePush(s, delay = PUSH_DELAY_MS) {
        if (s.pushTimer) return;
        s.pushTimer = setTimeout(() => { s.pushTimer = null; run(s, () => push(s)); }, delay);
    }
    async function push(s) {
        if (session !== s || !canEdit(s)) return;
        const adapter = adapters[s.kind];
        const snap = adapter.snapshot(s.item);
        const text = JSON.stringify(snap);
        if (text === s.baseJson) return;
        const sealed = await seal(s.key, s.kind, snap);
        try {
            const result = await api('PUT', `/documents/${s.id}/content`, { baseVersion: s.version, ...sealed });
            if (session !== s) return;
            s.version = result.version;
            setBase(s, snap);
            s.status = 'live';
            persist(s);
        } catch (error) {
            if (session !== s) return;
            if (error.status === 409 && error.data) {
                const theirs = await unseal(s.key, s.kind, error.data.iv, error.data.ciphertext);
                const mine = adapter.snapshot(s.item);
                const merged = merge(s.kind, s.base, mine, theirs);
                s.version = error.data.version;
                setBase(s, theirs);
                if (JSON.stringify(merged) !== JSON.stringify(mine)) applyRemote(s, merged);
                persist(s);
                schedulePush(s, 0);
            } else if ([401, 403, 404, 423].includes(error.status)) {
                handleAccessError(s, error);
            } else {
                s.status = 'offline';
                schedulePush(s, 3000);
            }
            renderChrome();
        }
    }
    function scheduleSuggest(s) {
        clearTimeout(s.suggestTimer);
        s.suggestTimer = setTimeout(() => run(s, () => suggest(s)), SUGGEST_DELAY_MS);
    }
    async function suggest(s) {
        if (session !== s || s.role !== 'suggest' || !signedIn()) return;
        const proposed = adapters[s.kind].snapshot(s.item);
        if (JSON.stringify(proposed) === s.baseJson) return;
        try {
            await api('POST', `/documents/${s.id}/suggestions`, { baseVersion: s.version, ...(await seal(s.key, s.kind, { base: s.base, proposed })) });
            s.status = 'live';
            refreshShareDialog(true);
        } catch (error) {
            if ([401, 403, 404, 423].includes(error.status)) handleAccessError(s, error);
            else { s.status = 'offline'; scheduleSuggest(s); }
        }
        renderChrome();
    }
    window.addEventListener('omni-sheets-changed', () => { if (session && session.kind === 'spreadsheet') session.dirty = true; });
    document.addEventListener('input', () => setTimeout(() => session && detectLocal(session), 30), true);

    // Locking: locked files stop collaborating; owners also lock the shared copy on the server.
    function syncLock(kind, item, meta, locked) {
        if (meta.role !== 'owner' || !!meta.serverLocked === locked || unlockRequests.has(meta.id)) return;
        const request = api('PATCH', `/documents/${meta.id}`, { locked })
            .then(() => { meta.serverLocked = locked; adapters[kind].save(item); blockedUntil.delete(meta.id); })
            .catch(error => { if (error.status === 404) forget(item); })
            .finally(() => unlockRequests.delete(meta.id));
        unlockRequests.set(meta.id, request);
    }

    function tick() {
        const active = activeItem();
        if (active && active.item.collab && !collabOf(active.item)) forget(active.item); // a copy of a shared file
        const meta = active ? collabOf(active.item) : null;
        if (!meta) { if (session) stop(); renderChrome(); return; }
        if (meta.inaccessible || (meta.viewerAccountId !== undefined && meta.viewerAccountId !== viewerId())) {
            if (session) stop();
            return;
        }
        const locked = adapters[active.kind].isLocked(active.item);
        syncLock(active.kind, active.item, meta, locked);
        if (locked || unlockRequests.has(meta.id) || (meta.serverLocked && meta.role === 'owner')) {
            if (session) stop();
            renderChrome();
            return;
        }
        if (session && session.item !== active.item) stop();
        if (!session) {
            if ((blockedUntil.get(meta.id) || 0) > Date.now()) { renderChrome(); return; }
            blockedUntil.delete(meta.id);
            start(active.kind, active.item);
            return;
        }
        if (session.ready) {
            adapters[session.kind].setReadOnly(session.item, session.role === 'view');
            retryDeferred(session);
            detectLocal(session);
        }
        renderChrome();
    }

    /* ================================================================ topbar: who is here, role */
    const COLORS = ['#8f5cff', '#e9618a', '#2f9e8f', '#e0812b', '#3f7be0', '#b04fd1', '#5a9e2f', '#d4483c'];
    const colorIndexFor = text => parseInt(hash(String(text)).slice(-4), 36) % COLORS.length;
    const colorFor = text => COLORS[colorIndexFor(text)];
    const initials = name => (String(name || '?').trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2) || '?').toUpperCase();
    function avatarHtml(docId, person, extraClass = '') {
        const name = person.name || t('collab_anonymous');
        const picture = person.hasPicture && person.accountId ? `<img src="${esc(pictureUrl(docId, person.accountId))}" alt="" loading="lazy" decoding="async">` : esc(initials(name));
        return `<span class="mu-avatar ${extraClass}" style="background:${colorFor(person.accountId || person.clientId || name)}" title="${esc(name)}" aria-hidden="true">${picture}</span>`;
    }
    const otherParticipants = s => (s.people || []).filter(person =>
        person.clientId !== clientId && (!s.me?.accountId || String(person.accountId) !== String(s.me.accountId)));
    const roleLabel = role => t(role === 'owner' ? 'collab_role_owner' : role === 'edit' ? 'collab_role_edit' : role === 'suggest' ? 'collab_suggesting' : 'collab_role_view');
    function renderChrome() {
        const s = session;
        for (const kind of Object.keys(adapters)) {
            const navbar = adapters[kind].navbar();
            if (!navbar) continue;
            let chrome = navbar.querySelector(':scope > .omni-collab-chrome');
            const show = s && s.kind === kind && adapters[kind].current() === s.item;
            if (!show) { if (chrome) chrome.remove(); continue; }
            if (!chrome) {
                chrome = document.createElement('div');
                chrome.className = 'omni-collab-chrome';
                chrome.innerHTML = '<span class="mu-badge omni-collab-role"></span><div class="mu-avatar-group omni-collab-presence" role="group"></div>';
            }
            const share = adapters[kind].shareButton();
            if (share && share.parentElement === navbar && chrome.nextElementSibling !== share) navbar.insertBefore(chrome, share);
            else if (!chrome.isConnected) navbar.prepend(chrome);
            const badge = chrome.querySelector('.omni-collab-role');
            const offline = s.status === 'offline';
            const role = s.role === 'owner' ? '' : roleLabel(s.role);
            badge.hidden = !role && !offline;
            badge.classList.toggle('mu-badge-warning', offline);
            badge.title = offline ? t('collab_offline') : t('collab_live');
            const badgeHtml = `<icon aria-hidden="true">${offline ? 'cloud_off' : s.role === 'view' ? 'visibility' : s.role === 'suggest' ? 'rate_review' : 'edit'}</icon><span>${esc(role || t('collab_offline'))}</span>`;
            if (badge.innerHTML !== badgeHtml) badge.innerHTML = badgeHtml;
            const group = chrome.querySelector('.omni-collab-presence');
            const others = otherParticipants(s);
            group.hidden = !others.length;
            chrome.hidden = badge.hidden && group.hidden;
            group.setAttribute('aria-label', t('collab_here_now') + ': ' + others.map(person => person.name || t('collab_anonymous')).join(', '));
            const html = others.map(person => avatarHtml(s.id, person, 'is-live')).join('');
            if (group.dataset.html !== html) { group.innerHTML = html; group.dataset.html = html; }
        }
        // Report in the document More menu, only for link-shared documents someone else owns.
        const report = document.getElementById('reportMoreOptionsBtn');
        if (report) {
            const doc = adapters.document.current();
            report.hidden = !canReport('document', doc);
        }
    }

    /* ================================================================ dialogs */
    function modalShell(id, icon, titleHtml, bodyHtml, { large = false } = {}) {
        let modal = document.getElementById(id);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = id;
            modal.className = 'mu-modal omni-collab-modal';
            modal.hidden = true;
            document.body.appendChild(modal);
        }
        modal.innerHTML = `<div class="mu-dialog${large ? ' mu-dialog-md' : ''}" role="dialog" aria-labelledby="${id}Title">
            <div class="mu-dialog-header"><div class="mu-dialog-heading"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${icon}</span></span><h2 id="${id}Title">${titleHtml}</h2></div>
            <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-close aria-label="${esc(t('collab_close'))}"><span class="mu-icon" aria-hidden="true">close</span></button></div>
            ${bodyHtml}</div>`;
        return modal;
    }
    function showModal(modal) {
        if (!modal.hidden) return;
        if (window.MunetiosUI) window.MunetiosUI.openModal(modal.id);
        else modal.hidden = false;
    }
    function closeModal(modal) {
        if (!modal || modal.hidden) return;
        if (window.MunetiosUI) window.MunetiosUI.closeModal(modal);
        else modal.hidden = true;
    }
    function messageDialog(icon, message, { signIn = false } = {}) {
        const modal = modalShell('omniCollabMessageModal', icon, esc(t('Share')), `<p>${esc(message)}</p>
            <div class="mu-dialog-actions">${signIn ? `<a class="mu-btn mu-btn-primary" href="${esc(signInUrl())}">${esc(t('auth_sign_in'))}</a>` : ''}<button type="button" class="mu-btn" data-mu-close>${esc(t('collab_close'))}</button></div>`);
        showModal(modal);
    }
    function confirmDialog(message, confirmLabel) {
        return new Promise(resolve => {
            const modal = modalShell('omniCollabConfirmModal', 'help', esc(confirmLabel), `<p>${esc(message)}</p>
                <div class="mu-dialog-actions"><button type="button" class="mu-btn" data-mu-close data-answer="no">${esc(t('collab_cancel'))}</button>
                <button type="button" class="mu-btn mu-btn-danger" data-answer="yes">${esc(confirmLabel)}</button></div>`);
            const done = answer => { modal.removeEventListener('click', onClick); observer.disconnect(); resolve(answer); };
            const onClick = event => {
                const button = event.target.closest('[data-answer]');
                if (!button) return;
                if (button.dataset.answer === 'yes') closeModal(modal);
                done(button.dataset.answer === 'yes');
            };
            const observer = new MutationObserver(() => { if (modal.hidden) done(false); });
            observer.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
            modal.addEventListener('click', onClick);
            showModal(modal);
        });
    }

    /* ---------- Share dialog ---------- */
    let shareState = null; // { kind, item, people, suggestions, open: Set of expanded suggestion ids }
    const SHARE_ID = 'omniCollabShareModal';
    function roleOptions(selected, includeOwner = false) {
        return (includeOwner ? ['owner', ...ROLES] : ROLES).map(role => `<option value="${role}"${role === selected ? ' selected' : ''}>${esc(t(role === 'owner' ? 'collab_role_owner' : 'collab_role_' + role))}</option>`).join('');
    }
    async function openShare(kind) {
        try {
            const adapter = adapters[kind];
            const item = adapter.current();
            if (!item) return;
            // Locked files cannot collaborate: the previous dialog explains and offers to unlock.
            if (adapter.isLocked(item)) { adapter.legacyShare(); return; }
            shareState = { kind, item, people: null, suggestions: null, expanded: new Set() };
            renderShare();
            showModal(document.getElementById(SHARE_ID));
            await loadShareData({ opening: true });
        } catch {
            toast(t('collab_open_share_failed'), 'error');
        }
    }
    async function loadShareData({ opening = false } = {}) {
        const state = shareState;
        const meta = state && collabOf(state.item);
        if (!meta) return;
        try {
            const [people, suggestions] = await Promise.all([
                api('GET', `/documents/${meta.id}/members`),
                ['owner', 'edit', 'suggest'].includes(session?.role || meta.role) && signedIn() ? api('GET', `/documents/${meta.id}/suggestions`) : Promise.resolve({ suggestions: [] })
            ]);
            if (shareState !== state) return;
            state.people = people.people;
            state.suggestions = suggestions.suggestions;
            renderShareSections();
        } catch (error) {
            if (shareState !== state) return;
            if (error.status) state.error = error.code;
            if (opening) toast(t('collab_open_share_failed'), 'error');
        }
    }
    function renderShare() {
        const { kind, item } = shareState;
        const meta = collabOf(item);
        const title = t('collab_share_title', { name: titleOf(item) });
        let body;
        if (!meta) {
            body = `<div class="mu-alert omni-collab-intro"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">groups</span></span><div class="mu-alert-body">
                    <span class="mu-alert-title">${esc(t('collab_intro_title'))}</span><span>${esc(t('collab_intro_desc'))}</span></div></div>
                ${signedIn() ? '' : `<p class="mu-muted">${esc(t('collab_sign_in_required'))}</p>`}
                <div class="mu-dialog-actions">
                    <button type="button" class="mu-btn mu-btn-ghost" data-action="more"><span class="mu-icon" aria-hidden="true">ios_share</span>${esc(t('collab_more_ways'))}</button>
                    ${signedIn()
                        ? `<button type="button" class="mu-btn mu-btn-primary" data-action="start"><span class="mu-icon" aria-hidden="true">group_add</span>${esc(t('collab_start'))}</button>`
                        : `<a class="mu-btn mu-btn-primary" href="${esc(signInUrl())}"><span class="mu-icon" aria-hidden="true">login</span>${esc(t('auth_sign_in'))}</a>`}
                </div>`;
        } else {
            const owner = meta.role === 'owner';
            body = `${owner ? `<form class="omni-collab-invite" data-action="invite" novalidate>
                    <label class="mu-field"><span class="mu-field-label">${esc(t('collab_add_people'))}</span><input class="mu-input" type="email" name="email" autocomplete="email" required placeholder="${esc(t('collab_email'))}"></label>
                    <label class="mu-field"><span class="mu-field-label">${esc(t('collab_role'))}</span><select name="role" aria-label="${esc(t('collab_role'))}">${roleOptions('edit')}</select></label>
                    <button type="submit" class="mu-btn mu-btn-primary">${esc(t('collab_invite'))}</button></form>` : ''}
                <section data-section="here"></section>
                <section data-section="people"></section>
                <section data-section="general"></section>
                <section data-section="suggestions"></section>
                <div class="mu-dialog-actions">
                    ${owner ? `<button type="button" class="mu-btn mu-btn-danger-outline" data-action="stop"><span class="mu-icon" aria-hidden="true">link_off</span>${esc(t('collab_stop_sharing'))}</button>` : ''}
                    <button type="button" class="mu-btn mu-btn-ghost" data-action="more"><span class="mu-icon" aria-hidden="true">ios_share</span>${esc(t('collab_more_ways'))}</button>
                    <button type="button" class="mu-btn mu-btn-primary" data-action="copy"><span class="mu-icon" aria-hidden="true">link</span>${esc(t('collab_copy_link'))}</button>
                </div>`;
        }
        const modal = modalShell(SHARE_ID, 'share', esc(title), body, { large: true });
        modal.dataset.kind = kind;
        renderShareSections();
    }
    function sectionHtml(label, inner) {
        return `<h3 class="mu-section-label">${esc(label)}</h3>${inner}`;
    }
    function renderShareSections() {
        const modal = document.getElementById(SHARE_ID);
        if (!modal || !shareState) return;
        const meta = collabOf(shareState.item);
        if (!meta) return;
        const s = session && session.item === shareState.item ? session : null;
        const owner = meta.role === 'owner';
        const myId = s?.me?.accountId || window.MunetiosAccount?.state?.account?.id || null;
        const set = (name, html) => { const el = modal.querySelector(`[data-section="${name}"]`); if (el && el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } };

        const here = s ? otherParticipants(s) : [];
        set('here', here.length ? sectionHtml(t('collab_here_now'), `<div class="omni-collab-here">${here.map(person => `<span class="omni-collab-here-person">${avatarHtml(meta.id, person, 'is-live')}<span>${esc(person.clientId === clientId ? t('collab_you') : person.name || t('collab_anonymous'))}</span></span>`).join('')}</div>`) : '');

        const people = shareState.people || [];
        set('people', sectionHtml(t('collab_people'), `<div class="mu-group">${people.map(person => {
            const you = person.accountId === myId;
            const name = esc(person.name) + (you ? ` (${esc(t('collab_you'))})` : '');
            const controls = person.role === 'owner'
                ? `<span class="mu-badge">${esc(t('collab_role_owner'))}</span>`
                : owner
                    ? `<div class="omni-collab-row-controls omni-collab-member-controls"><select data-member="${esc(person.accountId)}" aria-label="${esc(t('collab_role'))}">${roleOptions(person.role)}</select>
                       <button type="button" class="mu-icon-btn" data-remove="${esc(person.accountId)}" aria-label="${esc(t('collab_remove'))}" title="${esc(t('collab_remove'))}"><span class="mu-icon" aria-hidden="true">person_remove</span></button></div>`
                    : you
                        ? `<div class="omni-collab-row-controls"><span class="mu-badge">${esc(t('collab_role_' + person.role))}</span><button type="button" class="mu-btn mu-btn-ghost" data-remove="${esc(person.accountId)}">${esc(t('collab_leave'))}</button></div>`
                        : `<span class="mu-badge">${esc(t('collab_role_' + person.role))}</span>`;
            return `<div class="mu-row">${avatarHtml(meta.id, person)}<div class="mu-row-info"><span class="mu-row-title">${name}</span>${person.email ? `<span class="mu-row-subtitle">${esc(person.email)}</span>` : ''}</div>${controls}</div>`;
        }).join('')}</div>`));

        const linkAccess = s ? s.linkAccess : meta.linkAccess || 'off';
        const shared = linkAccess !== 'off';
        set('general', sectionHtml(t('collab_general_access'), `<div class="mu-group"><div class="mu-row">
            <span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${shared ? 'public' : 'lock'}</span></span>
            <div class="mu-row-info"><span class="mu-row-title">${esc(t(shared ? 'collab_anyone_link' : 'collab_restricted'))}</span><span class="mu-row-subtitle">${esc(t(shared ? 'collab_anyone_link_desc' : 'collab_restricted_desc'))}</span></div>
            ${owner ? `<div class="omni-collab-row-controls"><select data-general="scope" aria-label="${esc(t('collab_general_access'))}">
                    <option value="off"${shared ? '' : ' selected'}>${esc(t('collab_restricted'))}</option><option value="link"${shared ? ' selected' : ''}>${esc(t('collab_anyone_link'))}</option></select>
                ${shared ? `<select data-general="role" aria-label="${esc(t('collab_role'))}">${roleOptions(linkAccess)}</select>` : ''}</div>`
                : shared ? `<span class="mu-badge">${esc(t('collab_role_' + linkAccess))}</span>` : ''}
        </div></div>${shared || owner ? `<p class="mu-muted">${esc(t('collab_link_server_access'))}</p>` : ''}`));

        const role = s?.role || meta.role;
        const suggestions = shareState.suggestions || [];
        let suggestionHtml = '';
        if (role === 'owner' || role === 'edit') {
            suggestionHtml = sectionHtml(t('collab_suggestions'), suggestions.length ? `<div class="mu-group">${suggestions.map(item => `
                <div class="mu-row omni-collab-suggestion">${avatarHtml(meta.id, item.author)}
                    <div class="mu-row-info"><span class="mu-row-title">${esc(t('collab_suggestion_from', { name: item.author.name }))}</span><span class="mu-row-subtitle">${esc(formatTime(item.updatedAt))}</span></div>
                    <div class="omni-collab-row-controls">
                        <button type="button" class="mu-btn mu-btn-ghost" data-preview="${esc(item.id)}" aria-expanded="${shareState.expanded.has(item.id)}">${esc(t('collab_show_changes'))}</button>
                        <button type="button" class="mu-btn" data-resolve="rejected" data-suggestion="${esc(item.id)}">${esc(t('collab_reject'))}</button>
                        <button type="button" class="mu-btn mu-btn-primary" data-resolve="accepted" data-suggestion="${esc(item.id)}">${esc(t('collab_accept'))}</button>
                    </div></div>
                <div class="omni-collab-changes" data-changes="${esc(item.id)}" ${shareState.expanded.has(item.id) ? '' : 'hidden'}></div>`).join('')}</div>`
                : `<p class="mu-muted">${esc(t('collab_no_suggestions'))}</p>`);
        } else if (role === 'suggest' && suggestions.length) {
            suggestionHtml = sectionHtml(t('collab_suggestions'), `<div class="mu-group"><div class="mu-row"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">rate_review</span></span>
                <div class="mu-row-info"><span class="mu-row-title">${esc(t('collab_suggestion_pending'))}</span><span class="mu-row-subtitle">${esc(formatTime(suggestions[0].updatedAt))}</span></div>
                <button type="button" class="mu-btn" data-resolve="rejected" data-suggestion="${esc(suggestions[0].id)}">${esc(t('collab_withdraw'))}</button></div></div>`);
        }
        set('suggestions', suggestionHtml);
        shareState.expanded.forEach(id => fillChanges(id));
    }
    function refreshShareDialog(reload = false) {
        const modal = document.getElementById(SHARE_ID);
        if (!modal || modal.hidden || !shareState) return;
        if (reload) loadShareData(); else renderShareSections();
    }
    async function suggestionPayload(meta, id) {
        const data = await api('GET', `/documents/${meta.id}/suggestions/${id}`);
        return unseal(meta.key, shareState.kind, data.iv, data.ciphertext);
    }
    async function fillChanges(id) {
        const modal = document.getElementById(SHARE_ID);
        const box = modal && modal.querySelector(`[data-changes="${CSS.escape(id)}"]`);
        if (!box || box.dataset.filled) return;
        box.dataset.filled = 'true';
        try {
            const payload = await suggestionPayload(collabOf(shareState.item), id);
            const changes = describeChanges(shareState.kind, payload.base, payload.proposed);
            box.innerHTML = changes.map(change => `<div class="omni-collab-change">${change.label ? `<span class="mu-badge">${esc(change.label)}</span>` : ''}
                ${change.removed ? `<del>${esc(change.removed)}</del>` : ''}${change.added ? `<ins>${esc(change.added)}</ins>` : ''}</div>`).join('') || `<p class="mu-muted">${esc(t('collab_no_suggestions'))}</p>`;
        } catch {
            delete box.dataset.filled;
            box.innerHTML = `<p class="mu-muted">${esc(t('collab_changes_failed'))}</p>`;
        }
    }

    async function startSharing() {
        const { kind, item } = shareState;
        const adapter = adapters[kind];
        if (adapter.isLocked(item)) { adapter.legacyShare(); return; }
        if (!signedIn()) { messageDialog('login', t('collab_sign_in_required'), { signIn: true }); return; }
        const key = randomId(32);
        const snap = adapter.snapshot(item);
        const created = await api('POST', '/documents', { kind, ...(await seal(key, kind, snap)) });
        // Comments made before sharing move to the shared file with their replies, authors' names, and resolved state.
        const moveComment = async (comment, parentId) => {
            const payload = { anchor: comment.anchor || null, text: comment.text, name: comment.author?.name || '', originalAuthor: comment.author?.name || '', createdAt: comment.createdAt };
            return api('POST', `/documents/${created.id}/comments`, { ...(await seal(key, kind + ':comment', payload)), token: guestToken(), ...(parentId ? { parentId } : {}) });
        };
        for (const comment of item.comments || []) {
            const thread = await moveComment(comment, null);
            for (const reply of comment.replies || []) await moveComment(reply, thread.id);
            if (comment.resolved) await api('PATCH', `/documents/${created.id}/comments/${thread.id}`, { resolved: true });
        }
        delete item.comments;
        item.collab = { id: created.id, key, role: 'owner', version: created.version, linkAccess: created.linkAccess, localId: item.id, syncedHash: hash(JSON.stringify(snap)) };
        adapter.save(item);
        renderShare();
        loadShareData();
        tick();
    }
    async function onShareClick(event) {
        const button = event.target.closest('button, a');
        if (!button || !shareState) return;
        const meta = collabOf(shareState.item);
        const action = button.dataset.action;
        try {
            if (action === 'start') {
                button.disabled = true;
                await startSharing().finally(() => { button.disabled = false; });
            } else if (action === 'more') {
                closeModal(document.getElementById(SHARE_ID));
                adapters[shareState.kind].legacyShare();
            } else if (action === 'copy' && meta) {
                await navigator.clipboard.writeText(shareLink(meta.id, meta.key));
                toast(t('collab_link_copied'), 'success');
            } else if (action === 'stop' && meta) {
                if (!(await confirmDialog(t('collab_stop_confirm'), t('collab_stop_sharing')))) return;
                await api('DELETE', `/documents/${meta.id}`);
                const item = shareState.item;
                // Keep the comments on this device as private comments.
                if (session && session.item === item && session.comments.length) item.comments = nestComments(session.comments);
                if (session && session.item === item) stop();
                forget(item);
                closeModal(document.getElementById(SHARE_ID));
                toast(t('collab_stopped'), 'success');
            } else if (button.dataset.remove && meta) {
                const accountId = button.dataset.remove;
                await api('DELETE', `/documents/${meta.id}/members/${accountId}`);
                if (meta.role !== 'owner') {
                    // Leaving keeps a private copy on this device.
                    const item = shareState.item;
                    if (session && session.item === item) stop();
                    forget(item);
                    closeModal(document.getElementById(SHARE_ID));
                    return;
                }
                loadShareData();
            } else if (button.dataset.preview) {
                const id = button.dataset.preview;
                if (shareState.expanded.has(id)) shareState.expanded.delete(id); else shareState.expanded.add(id);
                const box = document.getElementById(SHARE_ID).querySelector(`[data-changes="${CSS.escape(id)}"]`);
                if (box) box.hidden = !shareState.expanded.has(id);
                button.setAttribute('aria-expanded', String(shareState.expanded.has(id)));
                if (shareState.expanded.has(id)) fillChanges(id);
            } else if (button.dataset.resolve && meta) {
                await resolveSuggestion(meta, button.dataset.suggestion, button.dataset.resolve);
            }
        } catch (error) {
            const key = error.code === 'noAccount' ? 'collab_no_account'
                : action === 'start' || action === 'more' ? 'collab_open_share_failed' : 'collab_failed';
            toast(t(key), 'error');
        }
    }
    async function resolveSuggestion(meta, id, status) {
        const s = session && session.item === shareState.item ? session : null;
        if (s) s.lastResolved = id;
        if (status === 'accepted') {
            if (!s || !canEdit(s)) throw new Error('unavailable');
            const payload = await suggestionPayload(meta, id);
            await run(s, async () => {
                const mine = adapters[s.kind].snapshot(s.item);
                applyRemote(s, merge(s.kind, payload.base, mine, payload.proposed));
                await push(s);
            });
        }
        await api('POST', `/documents/${meta.id}/suggestions/${id}/resolve`, { status });
        if (status === 'rejected' && s && s.role === 'suggest') applyRemote(s, s.base);
        toast(t(status === 'accepted' ? 'collab_suggestion_accepted' : 'collab_suggestion_rejected'), status === 'accepted' ? 'success' : 'info');
        shareState.expanded.delete(id);
        loadShareData();
    }
    async function onShareChange(event) {
        if (!shareState) return;
        const meta = collabOf(shareState.item);
        const target = event.target;
        if (!meta || meta.role !== 'owner') return;
        try {
            if (target.dataset.member) {
                await api('PATCH', `/documents/${meta.id}/members/${target.dataset.member}`, { role: target.value });
                loadShareData();
            } else if (target.dataset.general) {
                const modal = document.getElementById(SHARE_ID);
                const scope = modal.querySelector('[data-general="scope"]').value;
                const roleSelect = modal.querySelector('[data-general="role"]');
                const linkAccess = scope === 'off' ? 'off' : (roleSelect ? roleSelect.value : 'view');
                const result = await api('PATCH', `/documents/${meta.id}`, {
                    linkAccess,
                    ...(linkAccess === 'off' ? {} : { contentKey: meta.key }),
                });
                meta.linkAccess = result.linkAccess;
                if (session && session.item === shareState.item) session.linkAccess = result.linkAccess;
                adapters[shareState.kind].save(shareState.item);
                renderShareSections();
                renderChrome();
            }
        } catch {
            toast(t('collab_failed'), 'error');
            renderShareSections();
        }
    }
    async function onShareSubmit(event) {
        const form = event.target.closest('form[data-action="invite"]');
        if (!form || !shareState) return;
        event.preventDefault();
        const meta = collabOf(shareState.item);
        const email = form.elements.email.value.trim();
        if (!meta || !form.elements.email.checkValidity() || !email) { form.elements.email.focus(); return; }
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            await api('POST', `/documents/${meta.id}/members`, { email, role: form.elements.role.value });
            form.elements.email.value = '';
            toast(t('collab_invited', { email }), 'success');
            loadShareData();
        } catch (error) {
            toast(t(error.code === 'noAccount' ? 'collab_no_account' : 'collab_failed'), 'error');
        } finally {
            submit.disabled = false;
        }
    }
    document.addEventListener('click', event => { if (event.target.closest('#' + SHARE_ID)) onShareClick(event); });
    document.addEventListener('change', event => { if (event.target.closest('#' + SHARE_ID)) onShareChange(event); });
    document.addEventListener('submit', event => { if (event.target.closest('#' + SHARE_ID)) onShareSubmit(event); });

    /* ---------- Report ---------- */
    function canReport(kind, item) {
        const meta = collabOf(item);
        if (!meta || meta.role === 'owner') return false;
        const linkAccess = session && session.item === item ? session.linkAccess : meta.linkAccess;
        return !!linkAccess && linkAccess !== 'off';
    }
    const REPORT_ID = 'omniCollabReportModal';
    function openReport(kind) {
        const item = adapters[kind].current();
        if (!canReport(kind, item)) return;
        const modal = modalShell(REPORT_ID, 'flag', esc(t('collab_report_title')), `<form class="omni-collab-report" novalidate>
            <p class="mu-muted">${esc(t('collab_report_desc'))}</p>
            <label class="mu-field"><span class="mu-field-label">${esc(t('collab_reason'))}</span>
                <select class="mu-select" name="reason">${REASONS.map(reason => `<option value="${reason}">${esc(t('collab_reason_' + reason))}</option>`).join('')}</select></label>
            <label class="mu-field"><span class="mu-field-label">${esc(t('collab_report_details'))}</span><textarea class="mu-textarea" name="details" rows="4"></textarea></label>
            <div class="mu-group"><div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t('collab_report_include'))}</span><span class="mu-row-subtitle">${esc(t('collab_report_include_desc'))}</span></div>
                <label class="mu-switch"><input type="checkbox" name="include" checked aria-label="${esc(t('collab_report_include'))}"><span class="mu-switch-track"></span></label></div></div>
            <div class="mu-dialog-actions"><button type="button" class="mu-btn" data-mu-close>${esc(t('collab_cancel'))}</button>
                <button type="submit" class="mu-btn mu-btn-primary"><span class="mu-icon" aria-hidden="true">flag</span>${esc(t('collab_report_submit'))}</button></div>
        </form>`);
        modal.dataset.item = collabOf(item).id;
        showModal(modal);
    }
    document.addEventListener('submit', async event => {
        const form = event.target.closest('#' + REPORT_ID + ' form');
        if (!form) return;
        event.preventDefault();
        const modal = document.getElementById(REPORT_ID);
        const item = [...adapters.document.all(), ...adapters.spreadsheet.all()].find(entry => collabOf(entry)?.id === modal.dataset.item);
        const meta = collabOf(item);
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            if (!meta) throw new Error('unavailable');
            await api('POST', '/reports', {
                documentId: meta.id,
                reason: form.elements.reason.value,
                details: form.elements.details.value,
                reviewKey: form.elements.include.checked ? meta.key : null
            });
            closeModal(modal);
            toast(t('collab_report_thanks'), 'success');
        } catch {
            toast(t('collab_report_failed'), 'error');
        } finally {
            submit.disabled = false;
        }
    });
    document.addEventListener('mousedown', event => {
        if (!event.target.closest('#reportMoreOptionsBtn')) return;
        event.preventDefault();
        const menu = document.getElementById('editorMoreOptions');
        if (menu) menu.style.display = 'none';
        openReport('document');
    });

    /* ---------- Shared files ---------- */
    const viewerId = () => String(window.MunetiosAccount?.state?.account?.id || '');
    const storedShares = () => Object.entries(adapters).flatMap(([kind, adapter]) => adapter.all()
        .filter(item => {
            const meta = collabOf(item);
            return meta && meta.role !== 'owner' && !item.trashed &&
                (meta.viewerAccountId === undefined || meta.viewerAccountId === viewerId());
        }).map(item => ({ kind, item, id: item.collab.id })));
    let sharedFiles = [];
    let sharedViewer = '';
    let libraryViewer = viewerId();
    let sharedError = false;
    let sharedLoading = false;
    let sharedRequest = 0;
    const sharedActions = new Set();

    function paintSharedFiles() {
        const grid = document.getElementById('sharedFilesGrid');
        const status = document.getElementById('sharedFilesStatus');
        if (!grid || !status) return;
        // The Shared tab is an invitation inbox, not a history of links opened locally.
        // Only server-confirmed invitations for the signed-in account belong here.
        const invited = sharedViewer === viewerId() && viewerId() ? sharedFiles : [];
        const files = new Map(invited.map(file => [file.id, file]));
        for (const local of storedShares()) {
            if (files.has(local.id)) files.set(local.id, { ...files.get(local.id), ...local });
        }
        status.hidden = files.size > 0 && !sharedError;
        status.textContent = t(sharedError ? 'collab_shared_load_failed' : sharedLoading ? 'loading' : 'collab_shared_empty');
        grid.innerHTML = [...files.values()].map(file => {
            const saved = file.item && !file.item.collab.inaccessible && file.item.collab.savedToDocuments !== false;
            const label = titleOf(file.item) || (file.kind === 'spreadsheet' ? t('sheets_grid') : t('template_document_title', { template: t('shared') }));
            const busy = sharedActions.has(file.id) ? ' disabled' : '';
            return `<article class="mu-tile omni-shared-file" data-shared-id="${esc(file.id)}">
                <span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${file.kind === 'spreadsheet' ? 'table_view' : 'share'}</span></span>
                <div class="mu-file-info"><h2 class="mu-file-name" title="${esc(label)}">${esc(label)}</h2>
                ${file.owner ? `<span class="mu-file-meta">${esc(file.owner)}</span>` : ''}</div>
                <div class="omni-shared-actions">
                    <button type="button" class="mu-btn mu-btn-ghost" data-shared-action="open"${busy}>${esc(t('open'))}</button>
                    ${saved ? '' : `<button type="button" class="mu-btn mu-btn-primary" data-shared-action="add"${busy}>${esc(t('collab_add_to_documents'))}</button>`}
                </div></article>`;
        }).join('');
    }

    async function renderSharedFiles() {
        const viewer = viewerId();
        const request = ++sharedRequest;
        if (sharedViewer !== viewer) {
            sharedFiles = [];
            sharedViewer = viewer;
        }
        sharedError = false;
        sharedLoading = Boolean(viewer);
        paintSharedFiles();
        if (!viewer) return;
        try {
            const result = await api('GET', '/shared');
            if (request !== sharedRequest || viewer !== viewerId()) return;
            sharedFiles = Array.isArray(result.files) ? result.files : [];
        } catch {
            if (request !== sharedRequest || viewer !== viewerId()) return;
            sharedError = true;
        }
        sharedLoading = false;
        paintSharedFiles();
    }

    document.addEventListener('munetios-account', () => {
        const viewer = viewerId();
        if (libraryViewer !== viewer) {
            libraryViewer = viewer;
            window.OmniCollabHost?.refreshLibrary();
            sheetsBridge()?.refreshLibrary();
            tick();
        }
        if (document.getElementById('sharedApp')?.classList.contains('active') && viewerId() !== sharedViewer) renderSharedFiles();
    });
    document.addEventListener('click', async event => {
        const button = event.target.closest('#sharedFilesGrid [data-shared-action]');
        if (!button) return;
        const { sharedId } = button.closest('[data-shared-id]').dataset;
        if (sharedActions.has(sharedId)) return;
        sharedActions.add(sharedId);
        paintSharedFiles();
        try {
            await openLink(sharedId, null, { add: button.dataset.sharedAction === 'add' });
        } finally {
            sharedActions.delete(sharedId);
            paintSharedFiles();
        }
    });

    /* ---------- Opening a shared link ---------- */
    async function openLink(id, key, { add = false } = {}) {
        if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return;
        const viewer = viewerId();
        const own = Object.entries(adapters).flatMap(([kind, adapter]) => adapter.all().map(item => ({ kind, item })))
            .find(({ item }) => collabOf(item)?.id === id && collabOf(item)?.role === 'owner' && !item.trashed);
        if (own && !add) {
            blockedUntil.delete(id);
            adapters[own.kind].open(own.item);
            return;
        }
        try {
            const existing = storedShares().find(file => file.id === id);
            key ||= existing?.item.collab.key;
            const data = await api('GET', `/documents/${id}`);
            if (data.locked) throw Object.assign(new Error('locked'), { status: 423 });
            if (!key && viewer) key = (await api('GET', `/documents/${id}/invitation-key`)).key;
            if (viewer !== viewerId()) return;
            if (!key) {
                messageDialog('link', t('collab_shared_original_link'));
                return;
            }
            const snap = await unseal(key, data.kind, data.iv, data.ciphertext);
            if (viewer !== viewerId()) return;
            const current = storedShares().find(file => file.id === id);
            if (current) {
                blockedUntil.delete(id);
                if (current.item.collab.inaccessible || add) {
                    if (add && !adapters[current.kind].addToLibrary(current.item)) return;
                    delete current.item.collab.inaccessible;
                    adapters[current.kind].save(current.item);
                    adapters[current.kind].refreshLibrary();
                }
                if (!add) adapters[current.kind].open(current.item);
                return;
            }
            const collab = { id, key, role: data.role, version: data.version, linkAccess: data.linkAccess, viewerAccountId: viewer,
                savedToDocuments: add || data.role === 'owner', syncedHash: hash(JSON.stringify(snap)) };
            const item = await adapters[data.kind].create({ title: snap.title, sheets: snap.sheets, content: snap.content, collab, open: !add });
            if (item && add) adapters[data.kind].refreshLibrary();
        } catch (error) {
            if (error.status === 401) messageDialog('login', t('collab_link_sign_in'), { signIn: true });
            else if (error.status === 403) messageDialog('lock_person', t('collab_link_no_access'), { signIn: !signedIn() });
            else if (error.status === 423) messageDialog('lock', t('collab_link_locked'));
            else if (error.status === 404) messageDialog('link_off', t('collab_link_not_found'));
            else messageDialog('error', t('collab_link_failed'));
        }
    }

    /* ================================================================ comments
       Select text (documents) or cells (spreadsheets) and comment on it, or comment on the whole file.
       No account is needed: guests type a name, signed-in people show their account name and picture.
       Private files keep comments with the file on this device. Shared files keep them on the server,
       encrypted with the file key. Owners, Editors, and Suggest can comment; guests can
       when the link gives Suggest or Editor. */
    const COMMENT_NAME_KEY = 'munetios-comment-name';
    const COMMENT_TOKEN_KEY = 'munetios-comment-token';
    const COMMENT_MINE_KEY = 'munetios-comment-mine';
    const PANEL_ID = 'omniCommentsPanel';
    const local = {
        get(key) { try { return localStorage.getItem(key); } catch { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch {} }
    };
    function guestToken() {
        let token = local.get(COMMENT_TOKEN_KEY);
        if (!/^[A-Za-z0-9_-]{32,64}$/.test(token || '')) { token = randomId(32); local.set(COMMENT_TOKEN_KEY, token); }
        return token;
    }
    function mineIds() { try { return new Set(JSON.parse(local.get(COMMENT_MINE_KEY) || '[]')); } catch { return new Set(); } }
    function rememberMine(id) { const ids = mineIds(); ids.add(id); local.set(COMMENT_MINE_KEY, JSON.stringify([...ids])); }
    function currentAccount() {
        const account = window.MunetiosAccount && window.MunetiosAccount.state && window.MunetiosAccount.state.account;
        return account ? { accountId: String(account.id), name: account.displayName || String(account.email || '').split('@')[0], picture: account.picture || null } : null;
    }

    let panelKind = null, panelItem = null, pendingAnchor = null, activeCommentId = null, commentsVersion = 0;
    let commentFilter = 'open', replyOpenId = null; // Open or Resolved threads, and the thread being replied to
    const threadsOf = list => (list || []).filter(comment => !comment.parentId);
    const repliesOf = (list, id) => (list || []).filter(comment => comment.parentId === id);
    const openThreads = list => threadsOf(list).filter(thread => !thread.resolved);

    async function decodeComment(s, raw) {
        try {
            const payload = await unseal(s.key, s.kind + ':comment', raw.iv, raw.ciphertext);
            const author = raw.author;
            const moved = !!payload.originalAuthor; // made before the file was shared
            return {
                id: raw.id, parentId: raw.parentId || null, resolved: !!raw.resolved,
                anchor: raw.parentId ? null : payload.anchor || null, text: String(payload.text || ''), createdAt: payload.createdAt || raw.createdAt,
                name: (moved ? payload.originalAuthor : author ? author.name : payload.name) || t('collab_anonymous'),
                accountId: !moved && author ? author.accountId : null, hasPicture: !moved && !!(author && author.hasPicture),
                guest: !moved && !author, remote: true
            };
        } catch { return null; }
    }
    async function loadComments(s) {
        try {
            const data = await api('GET', `/documents/${s.id}/comments`);
            if (session !== s) return;
            s.canComment = !!data.canComment;
            s.comments = (await Promise.all(data.comments.map(raw => decodeComment(s, raw)))).filter(Boolean);
            if (session === s) renderComments();
        } catch {}
    }
    async function addRemoteComment(s, raw) {
        if (s.comments.some(comment => comment.id === raw.id)) return;
        const comment = await decodeComment(s, raw);
        if (!comment || session !== s || s.comments.some(item => item.id === raw.id)) return;
        s.comments.push(comment);
        s.comments.sort((a, b) => a.createdAt - b.createdAt);
        if (comment.parentId) { const thread = s.comments.find(item => item.id === comment.parentId); if (thread) thread.resolved = false; } // a reply reopens
        renderComments();
    }
    // Private files store threads with their replies: [{ ...comment, resolved, replies: [...] }].
    // The panel works on a flat list where replies carry parentId.
    const localCopyOf = comment => ({ id: comment.id, anchor: comment.anchor, text: comment.text, createdAt: comment.createdAt, author: { name: comment.name, accountId: comment.accountId || null } });
    function nestComments(flat) {
        return flat.filter(comment => !comment.parentId).map(thread => ({
            ...localCopyOf(thread), resolved: !!thread.resolved,
            replies: flat.filter(reply => reply.parentId === thread.id).map(localCopyOf)
        }));
    }
    function localComments(item) {
        const account = currentAccount();
        const shape = (comment, parentId, resolved) => ({
            id: comment.id, parentId, resolved, anchor: parentId ? null : comment.anchor || null, text: String(comment.text || ''), createdAt: comment.createdAt,
            name: (comment.author && comment.author.name) || t('collab_anonymous'), accountId: (comment.author && comment.author.accountId) || null,
            picture: account && comment.author && comment.author.accountId === account.accountId ? account.picture : null,
            guest: !(comment.author && comment.author.accountId), remote: false
        });
        const flat = [];
        (item.comments || []).forEach(thread => {
            flat.push(shape(thread, null, !!thread.resolved));
            (thread.replies || []).forEach(reply => flat.push(shape(reply, thread.id, false)));
        });
        return flat;
    }
    // The open file and what its comments allow.
    function commentContext() {
        const active = activeItem();
        if (!active) return null;
        const meta = collabOf(active.item);
        const live = meta && session && session.item === active.item ? session : null;
        const locked = adapters[active.kind].isLocked(active.item);
        return {
            ...active, meta, live, locked,
            comments: locked ? null : meta ? (live ? live.comments : null) : localComments(active.item),
            canAdd: !locked && (meta ? !!(live && live.canComment) : true)
        };
    }
    function canDelete(ctx, comment) {
        if (!comment.remote) return true;
        const account = currentAccount();
        return (ctx.live && ctx.live.role === 'owner') || (account && comment.accountId === account.accountId) || (comment.guest && mineIds().has(comment.id));
    }
    // parentId set: a reply to that thread (replying reopens a resolved thread).
    async function postComment(ctx, { anchor, text, guestName, parentId = null }) {
        const account = currentAccount();
        if (!ctx.meta) {
            const entry = { id: randomId(9), text, createdAt: Date.now(), author: account ? { name: account.name, accountId: account.accountId } : { name: guestName } };
            const threads = ctx.item.comments = ctx.item.comments || [];
            if (parentId) {
                const thread = threads.find(item => item.id === parentId);
                if (!thread) throw new Error('notFound');
                (thread.replies = thread.replies || []).push(entry);
                thread.resolved = false;
            } else {
                threads.push({ ...entry, anchor, resolved: false, replies: [] });
            }
            adapters[ctx.kind].save(ctx.item);
            return;
        }
        const s = ctx.live;
        const payload = { anchor: parentId ? null : anchor, text, name: account ? account.name : guestName, createdAt: Date.now() };
        const raw = await api('POST', `/documents/${s.id}/comments`, { ...(await seal(s.key, s.kind + ':comment', payload)), token: guestToken(), ...(parentId ? { parentId } : {}) });
        if (!raw.author) rememberMine(raw.id);
        await addRemoteComment(s, raw);
    }
    async function resolveThread(ctx, id, resolved) {
        try {
            if (!ctx.meta) {
                const thread = (ctx.item.comments || []).find(item => item.id === id);
                if (!thread) return;
                thread.resolved = resolved;
                adapters[ctx.kind].save(ctx.item);
            } else {
                await api('PATCH', `/documents/${ctx.meta.id}/comments/${id}`, { resolved });
                const thread = ctx.live.comments.find(item => item.id === id);
                if (thread) thread.resolved = resolved;
            }
            if (resolved && activeCommentId === id) activeCommentId = null;
            if (replyOpenId === id) replyOpenId = null;
            toast(t(resolved ? 'comment_resolved' : 'comment_reopened'), 'success');
            renderComments();
        } catch {
            toast(t('collab_failed'), 'error');
        }
    }
    async function deleteComment(ctx, id) {
        try {
            if (!ctx.meta) {
                const threads = ctx.item.comments || [];
                ctx.item.comments = threads.filter(thread => thread.id !== id);
                ctx.item.comments.forEach(thread => { if (thread.replies) thread.replies = thread.replies.filter(reply => reply.id !== id); });
                adapters[ctx.kind].save(ctx.item);
            } else {
                await api('DELETE', `/documents/${ctx.meta.id}/comments/${id}`, undefined, { 'X-Comment-Token': guestToken() });
                ctx.live.comments = ctx.live.comments.filter(comment => comment.id !== id && comment.parentId !== id);
            }
            if (activeCommentId === id) activeCommentId = null;
            if (replyOpenId === id) replyOpenId = null;
            toast(t('comment_deleted'));
            renderComments();
        } catch {
            toast(t('collab_failed'), 'error');
        }
    }

    /* ---------- text anchors (documents) ---------- */
    function textOf(editor) {
        let text = '';
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) text += node.data;
        return text;
    }
    function rangeAt(editor, start, end) {
        const range = document.createRange();
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let position = 0, node, started = false, last = null;
        while ((node = walker.nextNode())) {
            const length = node.data.length;
            last = node;
            if (!started && start <= position + length) { range.setStart(node, start - position); started = true; }
            if (started && end <= position + length) { range.setEnd(node, end - position); return range; }
            position += length;
        }
        if (!started) { range.selectNodeContents(editor); range.collapse(false); return range; }
        if (last) range.setEnd(last, last.data.length);
        return range;
    }
    function offsetsOf(editor, range) {
        const before = document.createRange();
        before.selectNodeContents(editor);
        before.setEnd(range.startContainer, range.startOffset);
        const start = before.toString().length;
        return { start, end: start + range.toString().length };
    }
    // The selection inside the open document's pages, if any.
    function pageSelection(doc) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || !window.OmniCollabHost) return null;
        const range = selection.getRangeAt(0);
        const pages = window.OmniCollabHost.pages(doc);
        const page = pages.findIndex(editor => editor.contains(range.startContainer));
        if (page < 0 || !pages[page].contains(range.endContainer)) return null;
        return { range, page, editor: pages[page], collapsed: selection.isCollapsed };
    }
    function selectionAnchor() {
        const active = activeItem();
        if (!active) return null;
        if (active.kind === 'spreadsheet') {
            const selection = sheetsBridge() && sheetsBridge().selection();
            return selection ? { type: 'cell', sheetId: selection.sheetId, r: selection.r1, c: selection.c1, r2: selection.r2, c2: selection.c2 } : null;
        }
        const picked = pageSelection(active.item);
        if (!picked || picked.collapsed) return null;
        const { start, end } = offsetsOf(picked.editor, picked.range);
        const text = textOf(picked.editor);
        const quote = text.slice(start, end);
        if (!quote.trim()) return null;
        return { type: 'text', page: picked.page, start, quote, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) };
    }
    // Finds the commented text again after edits: same place first, then the best-matching copy.
    function resolveTextAnchor(doc, anchor, cache) {
        const pages = window.OmniCollabHost ? window.OmniCollabHost.pages(doc) : [];
        const order = [anchor.page, ...pages.map((_, index) => index).filter(index => index !== anchor.page)].filter(index => pages[index]);
        let best = null;
        for (const index of order) {
            const editor = pages[index];
            if (!cache.has(editor)) cache.set(editor, textOf(editor));
            const text = cache.get(editor);
            for (let at = text.indexOf(anchor.quote); at >= 0; at = text.indexOf(anchor.quote, at + 1)) {
                let score = (index === anchor.page ? 2 : 0) + (at === anchor.start ? 4 : 0) - Math.min(1, Math.abs(at - anchor.start) / 100000);
                if (anchor.prefix && text.slice(Math.max(0, at - anchor.prefix.length), at) === anchor.prefix) score += 3;
                if (anchor.suffix && text.slice(at + anchor.quote.length, at + anchor.quote.length + anchor.suffix.length) === anchor.suffix) score += 3;
                if (!best || score > best.score) best = { score, editor, start: at };
            }
        }
        return best ? rangeAt(best.editor, best.start, best.start + anchor.quote.length) : null;
    }
    // Highlights use the CSS Custom Highlight API, so the document's HTML is never changed.
    const highlightSupported = () => !!(window.CSS && CSS.highlights && window.Highlight);
    const highlightState = {};
    function refreshHighlights(force) {
        const ctx = commentContext();
        const doc = ctx && ctx.kind === 'document' && ctx.comments ? ctx.item : null;
        const pages = doc && window.OmniCollabHost ? window.OmniCollabHost.pages(doc) : [];
        if (!force && doc && doc.content === highlightState.content && pages[0] === highlightState.page && pages.length === highlightState.pages
            && highlightState.version === commentsVersion && highlightState.active === activeCommentId) return;
        Object.assign(highlightState, { content: doc && doc.content, page: pages[0], pages: pages.length, version: commentsVersion, active: activeCommentId });
        const active = [];
        if (doc) {
            const cache = new Map();
            ctx.comments.forEach(comment => {
                if (!comment.anchor || comment.anchor.type !== 'text') return;
                const range = resolveTextAnchor(doc, comment.anchor, cache);
                comment.orphaned = !range;
                // Resolved threads stay out of the way: no highlight unless selected in the panel.
                if (range && panelOpen() && comment.id === activeCommentId) active.push(range);
            });
            const live = session && session.item === doc ? session.comments : null;
            if (live) live.forEach(item => { const match = ctx.comments.find(comment => comment.id === item.id); if (match) item.orphaned = match.orphaned; });
        }
        if (!highlightSupported()) return;
        if (active.length) CSS.highlights.set('omni-comment-active', new Highlight(...active)); else CSS.highlights.delete('omni-comment-active');
    }

    /* ---------- cell anchors (spreadsheets) ---------- */
    function anchorText(ctx, anchor) {
        if (!anchor) return t('comment_general');
        if (anchor.type === 'text') return anchor.quote;
        const bridge = sheetsBridge();
        if (!bridge) return '';
        const single = anchor.r2 === undefined || (anchor.r2 === anchor.r && anchor.c2 === anchor.c);
        const ref = bridge.cellName(anchor.r, anchor.c) + (single ? '' : ':' + bridge.cellName(anchor.r2, anchor.c2));
        const sheet = bridge.sheetName(ctx.item, anchor.sheetId);
        return t('comment_cell', { cell: (sheet ? sheet + '!' : '') + ref });
    }
    function renderSheetMarks(ctx) {
        const bridge = sheetsBridge();
        const layer = bridge && bridge.overlayLayer();
        const show = ctx && ctx.kind === 'spreadsheet' && layer && ctx.comments;
        document.querySelectorAll('.omni-sheet-comment-mark').forEach(el => { if (!show || el.parentElement !== layer) el.remove(); });
        if (!show) return;
        const sheetId = bridge.activeSheetId();
        const seen = new Set();
        openThreads(ctx.comments).forEach(comment => {
            const anchor = comment.anchor;
            if (!anchor || anchor.type !== 'cell' || anchor.sheetId !== sheetId) return;
            const key = anchor.r + ':' + anchor.c;
            if (seen.has(key)) return;
            const box = bridge.cellBox(anchor.r, anchor.c);
            if (!box) return;
            seen.add(key);
            let mark = layer.querySelector(`.omni-sheet-comment-mark[data-cell="${key}"]`);
            if (!mark) {
                mark = document.createElement('button');
                mark.type = 'button';
                mark.className = 'omni-sheet-comment-mark';
                mark.dataset.cell = key;
                layer.appendChild(mark);
            }
            mark.dataset.comment = comment.id;
            mark.setAttribute('aria-label', t('comments_title') + ': ' + anchorText(ctx, anchor));
            mark.style.left = (box.x + box.w - 16) + 'px';
            mark.style.top = box.y + 'px';
        });
        layer.querySelectorAll('.omni-sheet-comment-mark').forEach(mark => { if (!seen.has(mark.dataset.cell)) mark.remove(); });
    }
    document.addEventListener('pointerdown', event => { if (event.target.closest('.omni-sheet-comment-mark')) event.stopPropagation(); }, true);
    document.addEventListener('click', event => {
        const mark = event.target.closest('.omni-sheet-comment-mark');
        if (!mark) return;
        event.stopPropagation();
        openComments('spreadsheet', { focusId: mark.dataset.comment });
    }, true);

    /* ---------- panel (right side, bottom sheet on phones) ---------- */
    function panel() {
        let el = document.getElementById(PANEL_ID);
        if (el) return el;
        el = document.createElement('aside');
        el.id = PANEL_ID;
        el.className = 'mu-side-panel omni-comments-panel';
        el.hidden = true;
        el.setAttribute('aria-labelledby', PANEL_ID + 'Title');
        el.innerHTML = `<div class="mu-sheet-grip" aria-hidden="true"></div>
            <div class="mu-side-panel-header"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">forum</span></span>
                <h2 id="${PANEL_ID}Title"></h2><span class="mu-badge" data-count hidden></span>
                <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-action="close"><span class="mu-icon" aria-hidden="true">close</span></button></div>
            <form class="omni-comment-composer" novalidate>
                <div class="omni-comment-anchor" data-anchor hidden><span class="mu-icon" aria-hidden="true">format_quote</span><span class="omni-comment-anchor-text"></span>
                    <button type="button" class="mu-icon-btn mu-icon-btn-sm" data-action="clear-anchor"><span class="mu-icon" aria-hidden="true">close</span></button></div>
                <label class="mu-field" data-guest hidden><span class="mu-field-label"></span><input class="mu-input" name="name" autocomplete="name"></label>
                <textarea class="mu-textarea" name="text" rows="3"></textarea>
                <div class="mu-dialog-actions"><button type="submit" class="mu-btn mu-btn-primary"><span class="mu-icon" aria-hidden="true">send</span><span data-label></span></button></div>
            </form>
            <p class="mu-muted omni-comments-note" data-section="note" hidden></p>
            <div class="mu-segmented omni-comments-filter" role="group">
                <button type="button" data-filter="open" aria-pressed="true"><span data-filter-label></span></button>
                <button type="button" data-filter="resolved" aria-pressed="false"><span data-filter-label></span></button>
            </div>
            <div class="mu-comments omni-comments-list" data-section="list"></div>`;
        document.body.appendChild(el);
        el.addEventListener('click', onPanelClick);
        el.querySelector('form.omni-comment-composer').addEventListener('submit', onComposerSubmit);
        el.addEventListener('submit', event => { if (event.target.matches('.omni-reply-form')) onReplySubmit(event); });
        el.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                if (event.target.closest('.omni-reply-form')) { replyOpenId = null; renderComments(); } else closeComments();
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.target.name === 'text' && event.target.form) {
                event.preventDefault();
                event.target.form.requestSubmit();
            }
        });
        return el;
    }
    const panelOpen = () => { const el = document.getElementById(PANEL_ID); return !!(el && !el.hidden); };
    function openComments(kind, options = {}) {
        const ctx = commentContext();
        if (!ctx || (kind && ctx.kind !== kind)) return;
        const el = panel();
        panelKind = ctx.kind;
        panelItem = ctx.item;
        if (options.anchor !== undefined) pendingAnchor = options.anchor;
        else if (options.compose) pendingAnchor = selectionAnchor();
        const wasOpen = !el.hidden;
        const editor = document.querySelector((ctx.kind === 'spreadsheet' ? '#sheetEditorApp' : '#editorContent') + ' .editor-content-editor');
        if (!editor) return;
        if (el.parentElement !== editor) editor.prepend(el);
        el.hidden = false;
        document.body.classList.add('omni-comments-open');
        if (!wasOpen) window.dispatchEvent(new Event('resize'));
        if (options.focusId) {
            // Focus the thread (a reply focuses its thread), switching to Resolved if needed.
            const target = ctx.comments && ctx.comments.find(comment => comment.id === options.focusId);
            const thread = target && target.parentId ? ctx.comments.find(comment => comment.id === target.parentId) : target;
            if (thread) { activeCommentId = thread.id; commentFilter = thread.resolved ? 'resolved' : 'open'; options.focusId = thread.id; }
        }
        renderComments();
        if (options.focusId) {
            const article = el.querySelector(`[data-comment="${CSS.escape(options.focusId)}"]`);
            if (article) article.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (options.compose && ctx.canAdd) {
            const account = currentAccount();
            const field = !account && !el.querySelector('input[name="name"]').value ? el.querySelector('input[name="name"]') : el.querySelector('textarea');
            field.focus();
        }
    }
    function closeComments() {
        const el = document.getElementById(PANEL_ID);
        if (!el || el.hidden) return;
        el.hidden = true;
        document.body.classList.remove('omni-comments-open');
        pendingAnchor = null;
        activeCommentId = null;
        replyOpenId = null;
        refreshHighlights(true);
        syncCommentsButton();
        window.dispatchEvent(new Event('resize'));
    }
    const toggleComments = kind => (panelOpen() ? closeComments() : openComments(kind, { compose: true }));
    function commentHtml(ctx, comment, { reply = false } = {}) {
        let avatar;
        if (comment.picture) avatar = `<span class="mu-avatar" title="${esc(comment.name)}" aria-hidden="true"><img src="${esc(comment.picture)}" alt=""></span>`;
        else avatar = avatarHtml(ctx.meta ? ctx.meta.id : '', { name: comment.name, accountId: comment.accountId, hasPicture: comment.remote && comment.hasPicture, clientId: comment.id });
        const anchor = comment.anchor ? `<button type="button" class="omni-comment-quote" data-jump="${esc(comment.id)}" title="${esc(t('comment_show'))}">${esc(anchorText(ctx, comment.anchor))}</button>` : '';
        const orphan = comment.orphaned ? `<p class="mu-muted omni-comment-orphan">${esc(t('comment_orphaned'))}</p>` : '';
        const remove = canDelete(ctx, comment) ? `<button type="button" class="mu-icon-btn mu-icon-btn-sm omni-comment-delete" data-delete="${esc(comment.id)}" aria-label="${esc(t('comment_delete'))}" title="${esc(t('comment_delete'))}"><span class="mu-icon" aria-hidden="true">delete</span></button>` : '';
        const resolvedBadge = !reply && comment.resolved ? `<span class="mu-badge mu-badge-success"><span class="mu-icon" aria-hidden="true">check_circle</span>${esc(t('comment_resolved_badge'))}</span>` : '';
        return `<article class="mu-comment omni-comment${reply ? ' omni-comment-reply' : ''}${comment.id === activeCommentId ? ' is-active' : ''}" data-comment="${esc(comment.id)}">${avatar}<div class="mu-comment-bubble">
            <div class="mu-comment-meta"><span class="omni-comment-name">${esc(comment.name)}</span>${comment.guest ? `<span class="mu-badge">${esc(t('comment_guest'))}</span>` : ''}${resolvedBadge}
                <time class="mu-muted" datetime="${esc(new Date(comment.createdAt).toISOString())}">${esc(formatTime(comment.createdAt))}</time>${remove}</div>
            ${anchor}${orphan}<p class="omni-comment-text">${esc(comment.text)}</p></div></article>`;
    }
    // A thread: the comment, its replies, Reply and Resolve/Reopen, and the reply box when open.
    function threadHtml(ctx, thread, list) {
        const replies = repliesOf(list, thread.id);
        const account = currentAccount();
        const replying = replyOpenId === thread.id && ctx.canAdd;
        const actions = ctx.canAdd ? `<div class="omni-thread-actions">
                ${thread.resolved ? '' : `<button type="button" class="mu-btn mu-btn-ghost" data-reply="${esc(thread.id)}" aria-expanded="${replying}"><span class="mu-icon" aria-hidden="true">reply</span>${esc(t('comment_reply'))}</button>`}
                <button type="button" class="mu-btn mu-btn-ghost" data-resolve="${esc(thread.id)}" data-resolved="${thread.resolved ? 'false' : 'true'}"><span class="mu-icon" aria-hidden="true">${thread.resolved ? 'replay' : 'check_circle'}</span>${esc(t(thread.resolved ? 'comment_reopen' : 'comment_resolve'))}</button>
            </div>` : '';
        const form = replying ? `<form class="omni-reply-form" data-reply-form="${esc(thread.id)}" novalidate>
                ${account ? '' : `<label class="mu-field"><span class="mu-field-label">${esc(t('comment_your_name'))}</span><input class="mu-input" name="name" autocomplete="name" value="${esc(local.get(COMMENT_NAME_KEY) || '')}"></label>`}
                <textarea class="mu-textarea" name="text" rows="2" placeholder="${esc(t('comment_reply_placeholder'))}" aria-label="${esc(t('comment_reply_placeholder'))}"></textarea>
                <div class="mu-dialog-actions"><button type="button" class="mu-btn" data-reply-cancel>${esc(t('collab_cancel'))}</button>
                    <button type="submit" class="mu-btn mu-btn-primary"><span class="mu-icon" aria-hidden="true">send</span>${esc(t('comment_reply'))}</button></div>
            </form>` : '';
        return `<section class="omni-thread${thread.resolved ? ' is-resolved' : ''}" data-thread="${esc(thread.id)}">${commentHtml(ctx, thread)}
            ${replies.length ? `<div class="omni-thread-replies">${replies.map(reply => commentHtml(ctx, reply, { reply: true })).join('')}</div>` : ''}
            ${actions}${form}</section>`;
    }
    function renderComments() {
        commentsVersion++;
        refreshHighlights(true);
        syncCommentsButton();
        const el = document.getElementById(PANEL_ID);
        if (!el || el.hidden) return;
        const ctx = commentContext();
        if (!ctx) { closeComments(); return; }
        const list = ctx.comments;
        el.querySelector('h2').textContent = t('comments_title');
        el.querySelector('[data-action="close"]').setAttribute('aria-label', t('collab_close'));
        const openCount = openThreads(list).length;
        const count = el.querySelector('[data-count]');
        count.hidden = !list || !openCount;
        count.textContent = list ? new Intl.NumberFormat(lang()).format(openCount) : '';
        const form = el.querySelector('form.omni-comment-composer');
        form.hidden = !ctx.canAdd || !list;
        const account = currentAccount();
        const guest = form.querySelector('[data-guest]');
        guest.hidden = !!account;
        guest.querySelector('.mu-field-label').textContent = t('comment_your_name');
        const nameInput = guest.querySelector('input');
        if (!nameInput.value) nameInput.value = local.get(COMMENT_NAME_KEY) || '';
        const textarea = form.querySelector('textarea');
        textarea.placeholder = t('comment_placeholder');
        textarea.setAttribute('aria-label', t('comment_placeholder'));
        form.querySelector('[data-label]').textContent = t('comment_post');
        const anchorBox = form.querySelector('[data-anchor]');
        anchorBox.hidden = !pendingAnchor;
        anchorBox.querySelector('.omni-comment-anchor-text').textContent = pendingAnchor ? anchorText(ctx, pendingAnchor) : '';
        anchorBox.querySelector('button').setAttribute('aria-label', t('comment_general'));
        anchorBox.querySelector('button').title = t('comment_general');
        const note = el.querySelector('[data-section="note"]');
        const noteText = ctx.locked ? t('comments_locked') : !list ? t('comments_unavailable') : !ctx.canAdd ? t('comments_view_only') : '';
        note.hidden = !noteText;
        note.textContent = noteText;
        // Open / Resolved filter
        const filter = el.querySelector('.omni-comments-filter');
        filter.hidden = !list;
        filter.setAttribute('aria-label', t('comments_title'));
        const resolvedCount = threadsOf(list).length - openCount;
        filter.querySelectorAll('[data-filter]').forEach(button => {
            const isOpen = button.dataset.filter === 'open';
            const amount = isOpen ? openCount : resolvedCount;
            button.setAttribute('aria-pressed', String(button.dataset.filter === commentFilter));
            button.querySelector('[data-filter-label]').textContent = t(isOpen ? 'comments_filter_open' : 'comments_filter_resolved') + (amount ? ' · ' + new Intl.NumberFormat(lang()).format(amount) : '');
        });
        const shown = threadsOf(list).filter(thread => (commentFilter === 'resolved') === !!thread.resolved);
        const empty = !threadsOf(list).length ? t('comments_empty') : commentFilter === 'resolved' ? t('comments_resolved_empty') : t('comments_open_empty');
        const container = el.querySelector('[data-section="list"]');
        const html = !list ? '' : !shown.length ? `<p class="mu-muted omni-comments-empty">${esc(empty)}</p>` : shown.map(thread => threadHtml(ctx, thread, list)).join('');
        if (container.dataset.html !== html) {
            // Keep a reply that is being typed when new comments arrive.
            const draft = container.querySelector('.omni-reply-form');
            const kept = draft && { id: draft.dataset.replyForm, text: draft.elements.text.value, name: draft.elements.name ? draft.elements.name.value : null, focused: draft.contains(document.activeElement) ? document.activeElement.name : null };
            container.innerHTML = html;
            container.dataset.html = html;
            const form = kept && container.querySelector(`.omni-reply-form[data-reply-form="${CSS.escape(kept.id)}"]`);
            if (form) {
                form.elements.text.value = kept.text;
                if (kept.name !== null && form.elements.name) form.elements.name.value = kept.name;
                if (kept.focused && form.elements[kept.focused]) form.elements[kept.focused].focus();
            }
        }
    }
    function jumpTo(id) {
        const ctx = commentContext();
        const comment = ctx && ctx.comments && ctx.comments.find(item => item.id === id);
        if (!comment || !comment.anchor) return;
        activeCommentId = id;
        if (comment.anchor.type === 'cell') {
            sheetsBridge() && sheetsBridge().select(comment.anchor.sheetId, comment.anchor.r, comment.anchor.c);
        } else {
            const range = resolveTextAnchor(ctx.item, comment.anchor, new Map());
            const node = range && (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement);
            if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        renderComments();
    }
    function onPanelClick(event) {
        const ctx = commentContext();
        const target = event.target.closest('button, article');
        if (!target || !ctx) return;
        if (target.dataset.action === 'close') closeComments();
        else if (target.dataset.action === 'clear-anchor') { pendingAnchor = null; renderComments(); }
        else if (target.dataset.filter) { commentFilter = target.dataset.filter; replyOpenId = null; activeCommentId = null; renderComments(); }
        else if (target.dataset.delete) deleteComment(ctx, target.dataset.delete);
        else if (target.dataset.jump) jumpTo(target.dataset.jump);
        else if (target.dataset.resolve) resolveThread(ctx, target.dataset.resolve, target.dataset.resolved === 'true');
        else if (target.dataset.reply) {
            replyOpenId = replyOpenId === target.dataset.reply ? null : target.dataset.reply;
            renderComments();
            const form = replyOpenId && document.querySelector(`#${PANEL_ID} .omni-reply-form[data-reply-form="${CSS.escape(replyOpenId)}"]`);
            if (form) (form.elements.name && !form.elements.name.value ? form.elements.name : form.elements.text).focus();
        } else if (target.matches('[data-reply-cancel]')) { replyOpenId = null; renderComments(); }
        else if (target.matches('article')) {
            const thread = target.closest('[data-thread]');
            const id = thread ? thread.dataset.thread : target.dataset.comment;
            if (activeCommentId !== id) { activeCommentId = id; renderComments(); }
        }
    }
    async function onReplySubmit(event) {
        event.preventDefault();
        const ctx = commentContext();
        const form = event.target;
        if (!ctx || !ctx.canAdd) return;
        const text = form.elements.text.value.trim();
        if (!text) { form.elements.text.focus(); return; }
        let guestName = '';
        if (!currentAccount()) {
            guestName = (form.elements.name ? form.elements.name.value : local.get(COMMENT_NAME_KEY) || '').trim();
            if (!guestName) { toast(t('comment_name_required'), 'error'); if (form.elements.name) form.elements.name.focus(); return; }
            local.set(COMMENT_NAME_KEY, guestName);
        }
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            await postComment(ctx, { text, guestName, parentId: form.dataset.replyForm });
            replyOpenId = null;
            toast(t('comment_added'), 'success');
            renderComments();
        } catch {
            toast(t('comment_failed'), 'error');
            submit.disabled = false;
        }
    }
    async function onComposerSubmit(event) {
        event.preventDefault();
        const ctx = commentContext();
        if (!ctx || !ctx.canAdd) return;
        const form = event.target;
        const text = form.elements.text.value.trim();
        if (!text) { form.elements.text.focus(); return; }
        const account = currentAccount();
        let guestName = '';
        if (!account) {
            guestName = form.elements.name.value.trim();
            if (!guestName) { toast(t('comment_name_required'), 'error'); form.elements.name.focus(); return; }
            local.set(COMMENT_NAME_KEY, guestName);
        }
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            await postComment(ctx, { anchor: pendingAnchor, text, guestName });
            form.elements.text.value = '';
            pendingAnchor = null;
            toast(t('comment_added'), 'success');
            renderComments();
        } catch {
            toast(t('comment_failed'), 'error');
        } finally {
            submit.disabled = false;
        }
    }

    /* ---------- topbar Comments button and the selection's Add comment button ---------- */
    function syncCommentsButton() {
        const ctx = commentContext();
        for (const kind of Object.keys(adapters)) {
            const navbar = adapters[kind].navbar();
            if (!navbar) continue;
            let button = navbar.querySelector(':scope > .omni-comments-btn');
            if (!ctx || ctx.kind !== kind) { if (button) button.hidden = true; continue; }
            if (!button) {
                button = document.createElement('icon');
                button.className = 'omni-comments-btn';
                button.setAttribute('role', 'button');
                button.tabIndex = 0;
                button.textContent = 'comment';
                button.addEventListener('click', () => toggleComments(kind));
                button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleComments(kind); } });
            }
            const before = navbar.querySelector(':scope > .omni-collab-chrome') || adapters[kind].shareButton();
            if (before && before.parentElement === navbar) { if (button.nextElementSibling !== before) navbar.insertBefore(button, before); }
            else if (!button.isConnected) navbar.prepend(button);
            button.hidden = false;
            const count = openThreads(ctx.comments).length; // open threads only
            const open = panelOpen();
            button.setAttribute('aria-pressed', String(open));
            button.classList.toggle('active', open);
            const label = t('comments_title');
            button.setAttribute('aria-label', count ? label + ' (' + count + ')' : label);
            button.setAttribute('data-tooltip', label);
            if (count) button.dataset.count = new Intl.NumberFormat(lang()).format(count); else delete button.dataset.count;
        }
    }
    let floatButton = null, floatFrame = 0;
    function updateFloatButton() {
        floatFrame = 0;
        const ctx = commentContext();
        const picked = ctx && ctx.kind === 'document' && ctx.canAdd && ctx.comments ? pageSelection(ctx.item) : null;
        const rects = picked && !picked.collapsed && picked.range.toString().trim() ? picked.range.getClientRects() : [];
        const rect = rects[rects.length - 1];
        if (!rect) { if (floatButton) floatButton.hidden = true; return; }
        if (!floatButton) {
            floatButton = document.createElement('button');
            floatButton.type = 'button';
            floatButton.className = 'mu-icon-btn mu-icon-btn-primary omni-comment-float';
            floatButton.innerHTML = '<span class="mu-icon" aria-hidden="true">add_comment</span>';
            floatButton.addEventListener('mousedown', event => event.preventDefault()); // keep the selection
            floatButton.addEventListener('click', () => { openComments('document', { anchor: selectionAnchor() }); floatButton.hidden = true; panel().querySelector('textarea').focus(); });
            document.body.appendChild(floatButton);
        }
        floatButton.setAttribute('aria-label', t('comment_add'));
        floatButton.title = t('comment_add');
        floatButton.hidden = false;
        floatButton.style.left = Math.max(8, Math.min(window.innerWidth - 60, rect.right + 8)) + 'px';
        floatButton.style.top = Math.max(8, rect.top - 56) + 'px';
    }
    const scheduleFloat = () => { if (!floatFrame) floatFrame = requestAnimationFrame(updateFloatButton); };
    // Ctrl+Alt+M (⌘⌥M) adds a comment on the selection.
    document.addEventListener('keydown', event => {
        if (!((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'KeyM')) return;
        const ctx = commentContext();
        if (!ctx) return;
        event.preventDefault();
        openComments(ctx.kind, { compose: true });
    });
    // Clicking commented text selects that comment in the open panel.
    document.addEventListener('click', event => {
        if (!panelOpen() || !event.target.closest('.document-page-editor')) return;
        setTimeout(() => {
            const ctx = commentContext();
            const selection = window.getSelection();
            if (!ctx || ctx.kind !== 'document' || !ctx.comments || !selection || !selection.rangeCount) return;
            const cache = new Map();
            const hit = openThreads(ctx.comments).find(comment => {
                if (!comment.anchor || comment.anchor.type !== 'text') return false;
                const range = resolveTextAnchor(ctx.item, comment.anchor, cache);
                try { return range && range.isPointInRange(selection.anchorNode, selection.anchorOffset); } catch { return false; }
            });
            if (hit) openComments('document', { focusId: hit.id });
        }, 0);
    });

    /* ================================================================ live cursors
       Everyone in a shared file sees where the others are: a named caret and selection in
       documents, and a named outline around the selected cells in spreadsheets. */
    let cursorFrame = 0, cursorTimer = 0, cursorInFlight = false, cursorPending = false, lastCursorJson = '';
    function scheduleCursorRender() { if (!cursorFrame) cursorFrame = requestAnimationFrame(() => { cursorFrame = 0; renderCursors(); }); }
    function cursorLayer() {
        let layer = document.getElementById('omniCursorLayer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'omniCursorLayer';
            layer.className = 'omni-cursor-layer';
            layer.setAttribute('aria-hidden', 'true');
            document.body.appendChild(layer);
        }
        return layer;
    }
    function cursorElement(container, clientId, className) {
        let el = container.querySelector(`:scope > .${className}[data-client="${CSS.escape(clientId)}"]`);
        if (!el) {
            el = document.createElement('div');
            el.className = className;
            el.dataset.client = clientId;
            el.innerHTML = '<span class="omni-cursor-label"></span>';
            container.appendChild(el);
        }
        return el;
    }
    function renderCursors() {
        const s = session;
        const layer = cursorLayer();
        const used = new Set();
        const selections = new Map();
        if (s && s.kind === 'document' && adapters.document.current() === s.item && window.OmniCollabHost) {
            const pages = window.OmniCollabHost.pages(s.item);
            const area = pages[0] && (pages[0].closest('.editor-content-editor') || document.getElementById('editorContent'));
            const clip = area ? area.getBoundingClientRect() : null;
            for (const person of otherParticipants(s)) {
                const { clientId } = person;
                const cursor = s.cursors.get(clientId);
                const editor = cursor && cursor.kind === 'text' ? pages[cursor.page] : null;
                if (!editor) continue;
                const index = colorIndexFor(person.accountId || person.clientId || person.name);
                const caret = rangeAt(editor, cursor.end, cursor.end);
                let rect = caret.getClientRects()[0] || caret.getBoundingClientRect();
                if (!rect || (!rect.top && !rect.left && !rect.height)) {
                    const box = editor.getBoundingClientRect();
                    rect = { left: box.left + 4, top: box.top + 4, height: 24 };
                }
                const el = cursorElement(layer, clientId, 'omni-cursor');
                used.add(clientId);
                el.hidden = !!clip && (rect.top < clip.top - 2 || rect.top > clip.bottom || rect.left < clip.left || rect.left > clip.right);
                el.style.setProperty('--omni-cursor-color', COLORS[index]);
                el.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
                el.style.height = Math.max(20, Math.round(rect.height || 24)) + 'px';
                el.firstChild.textContent = person.name || t('collab_anonymous');
                if (cursor.end > cursor.start) {
                    if (!selections.has(index)) selections.set(index, []);
                    selections.get(index).push(rangeAt(editor, cursor.start, cursor.end));
                }
            }
        }
        layer.querySelectorAll(':scope > .omni-cursor').forEach(el => { if (!used.has(el.dataset.client)) el.remove(); });
        if (highlightSupported()) {
            for (let i = 0; i < COLORS.length; i++) {
                const ranges = selections.get(i);
                if (ranges) CSS.highlights.set('omni-cursor-' + i, new Highlight(...ranges)); else CSS.highlights.delete('omni-cursor-' + i);
            }
        }
        renderSheetCursors(s && s.kind === 'spreadsheet' && adapters.spreadsheet.current() === s.item ? s : null);
    }
    function renderSheetCursors(s) {
        const bridge = sheetsBridge();
        const layer = bridge && bridge.overlayLayer();
        document.querySelectorAll('.omni-sheet-cursor').forEach(el => { if (!s || el.parentElement !== layer) el.remove(); });
        if (!s || !layer) return;
        const sheetId = bridge.activeSheetId();
        const used = new Set();
        for (const person of otherParticipants(s)) {
            const { clientId } = person;
            const cursor = s.cursors.get(clientId);
            if (!cursor || cursor.kind !== 'cell' || cursor.sheetId !== sheetId) continue;
            const a = bridge.cellBox(cursor.r1, cursor.c1), b = bridge.cellBox(cursor.r2, cursor.c2);
            if (!a || !b) continue;
            const el = cursorElement(layer, clientId, 'omni-sheet-cursor');
            used.add(clientId);
            el.style.setProperty('--omni-cursor-color', colorFor(person.accountId || person.clientId || person.name));
            Object.assign(el.style, { left: a.x + 'px', top: a.y + 'px', width: Math.max(0, b.x + b.w - a.x) + 'px', height: Math.max(0, b.y + b.h - a.y) + 'px' });
            el.firstChild.textContent = person.name || t('collab_anonymous');
        }
        layer.querySelectorAll(':scope > .omni-sheet-cursor').forEach(el => { if (!used.has(el.dataset.client)) el.remove(); });
    }
    // Where this person is working: undefined means "nothing to report".
    function currentCursor() {
        const s = session;
        if (!s || !s.ready) return undefined;
        if (s.kind === 'document') {
            if (adapters.document.current() !== s.item) return undefined;
            const picked = pageSelection(s.item);
            if (!picked) return undefined;
            const { start, end } = offsetsOf(picked.editor, picked.range);
            return { kind: 'text', page: picked.page, start, end };
        }
        const selection = adapters.spreadsheet.current() === s.item && sheetsBridge() ? sheetsBridge().selection() : null;
        return selection ? { kind: 'cell', sheetId: selection.sheetId, r1: selection.r1, c1: selection.c1, r2: selection.r2, c2: selection.c2 } : undefined;
    }
    function sendCursorSoon(force) {
        clearTimeout(cursorTimer);
        cursorTimer = setTimeout(() => sendCursor(force), 120);
    }
    async function sendCursor(force) {
        const s = session;
        const cursor = currentCursor();
        if (!s || !otherParticipants(s).length || cursor === undefined) return;
        const text = JSON.stringify(cursor);
        if (!force && text === lastCursorJson) return;
        if (cursorInFlight) { cursorPending = true; return; }
        lastCursorJson = text;
        cursorInFlight = true;
        try { await api('POST', `/documents/${s.id}/cursor`, { cursor }); }
        catch { lastCursorJson = ''; }
        finally {
            cursorInFlight = false;
            if (cursorPending) { cursorPending = false; sendCursor(); }
        }
    }
    document.addEventListener('selectionchange', () => { if (session && session.kind === 'document') sendCursorSoon(); scheduleFloat(); });
    document.addEventListener('scroll', () => { scheduleCursorRender(); scheduleFloat(); }, true);
    window.addEventListener('resize', scheduleCursorRender);

    function commentsTick() {
        const ctx = commentContext();
        if (panelOpen()) {
            if (!ctx) closeComments();
            else if (ctx.item !== panelItem) { panelKind = ctx.kind; panelItem = ctx.item; pendingAnchor = null; activeCommentId = null; renderComments(); }
        }
        syncCommentsButton();
        refreshHighlights(false);
        renderSheetMarks(ctx);
        scheduleCursorRender();
        if (session && session.kind === 'spreadsheet') sendCursor();
    }
    setInterval(commentsTick, TICK_MS);

    window.OmniCollab = Object.freeze({ openShare, openReport, openLink, canReport, merge, describeChanges, openComments, closeComments,
        renderSharedFiles, get session() { return session; } });
    if (document.getElementById('sharedApp')?.classList.contains('active')) renderSharedFiles();
    setInterval(tick, TICK_MS);
    window.addEventListener('hashchange', () => setTimeout(tick, 50));
    window.addEventListener('online', () => { blockedUntil.clear(); tick(); });
})();
