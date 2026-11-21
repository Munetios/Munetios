/*
 * OmniWrite command palette (Munetios UI v4 design)
 *
 * Ctrl+K / Cmd+K opens a search box that
 * runs app commands and opens documents. Commands reuse the app's own buttons
 * and functions, so they behave exactly like clicking them.
 * - Type to filter; Up/Down to move; Enter to run; Escape to close.
 * - Document commands only appear while a document is open.
 * - Recently used commands are remembered in this browser only.
 */
(function () {
    'use strict';
    if (window.OmniCommandPalette) return;

    const RECENT_KEY = 'omniwrite-palette-recent';
    const t = (key, fallback) => {
        try { const v = typeof window._t === 'function' ? window._t(key) : ''; return v && v !== key ? v : fallback; } catch (e) { return fallback; }
    };
    const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const byId = id => document.getElementById(id);
    const editorOpen = () => !!document.querySelector('#editorContent.active');
    const press = (el, type) => {
        if (!el) return false;
        if (type === 'mousedown') ['mousedown', 'mouseup'].forEach(ev => el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true })));
        else el.click();
        return true;
    };
    const go = page => {
        const prefix = typeof getWorkspaceHashPrefix === 'function' ? getWorkspaceHashPrefix() : '#';
        window.location.hash = page ? prefix + '/' + page : '';
    };
    const setTheme = value => {
        try { localStorage.setItem('omniwrite-theme', value); } catch (e) {}
        if (typeof applyTheme === 'function') applyTheme(value);
    };

    function commands() {
        const doc = editorOpen();
        return [
            { id: 'new-doc', group: 'create', icon: 'note_add', label: t('New Document', 'New document'), run: () => press(byId('createNewDocumentBtn')) },
            { id: 'new-project', group: 'create', icon: 'create_new_folder', label: t('new_folder', 'New project'), run: () => press(byId('createNewFolderBtn')) },
            { id: 'import', group: 'create', icon: 'upload_file', label: t('import_file', 'Import file'), run: () => press(byId('createImportFileBtn')) },

            { id: 'go-home', group: 'go', icon: 'home', label: t('home', 'Home'), run: () => go('') },
            { id: 'go-templates', group: 'go', icon: 'browse', label: t('templates', 'Templates'), run: () => go('templates') },
            { id: 'go-images', group: 'go', icon: 'filter', label: t('images', 'Images'), run: () => go('images') },
            { id: 'go-notes', group: 'go', icon: 'edit_note', label: t('notes', 'Notes'), run: () => go('notes') },
            { id: 'go-tasks', group: 'go', icon: 'task_alt', label: t('tasks', 'Tasks'), run: () => go('tasks') },
            { id: 'go-charts', group: 'go', icon: 'bar_chart', label: t('charts', 'Charts'), run: () => go('charts') },
            { id: 'go-projects', group: 'go', icon: 'folder_open', label: t('folders', 'Folders'), run: () => go('folders') },
            { id: 'go-trash', group: 'go', icon: 'delete', label: t('trash', 'Trash'), run: () => go('trash') },

            doc && { id: 'find', group: 'document', icon: 'search', label: t('palette_cmd_find', 'Find in document'), keys: ['Ctrl', 'F'], run: () => (typeof openFindBar === 'function' ? openFindBar() : press(byId('findInDocumentBtn'))) },
            doc && { id: 'replace', group: 'document', icon: 'find_replace', label: t('find_replace', 'Find and replace'), keys: ['Ctrl', 'H'], run: () => (typeof openFindReplaceBar === 'function' ? openFindReplaceBar() : press(byId('replaceInDocumentBtn'))) },
            doc && { id: 'formatting', group: 'document', icon: 'style', label: t('formatting_menu', 'Formatting'), run: () => window.OmniFormatting && window.OmniFormatting.open() },
            doc && { id: 'icon', group: 'document', icon: 'interests', label: t('insert_icon', 'Insert icon'), run: () => (window.OmniIconPicker ? window.OmniIconPicker.open() : press(byId('insertIconBtn'), 'mousedown')) },
            doc && { id: 'preview', group: 'document', icon: 'visibility', label: t('Preview', 'Preview'), run: () => press(byId('previewBtn')) },
            doc && { id: 'reading', group: 'document', icon: 'auto_stories', label: t('reading_mode', 'Reading mode'), run: () => press(byId('readingModeBtn')) },
            doc && { id: 'split', group: 'document', icon: 'vertical_split', label: t('palette_cmd_split', 'Split view'), run: () => press(byId('splitScreenBtn')) },
            doc && { id: 'history', group: 'document', icon: 'history', label: t('Version History', 'Version history'), run: () => press(byId('versionHistoryBtn')) },
            doc && { id: 'info', group: 'document', icon: 'info', label: t('document_info', 'Document info'), run: () => press(byId('documentInfoMoreOptionsBtn')) },
            doc && { id: 'rename', group: 'document', icon: 'edit', label: t('palette_cmd_rename', 'Rename document'), run: () => press(byId('renameMoreOptionsBtn'), 'mousedown') },
            doc && { id: 'duplicate', group: 'document', icon: 'content_copy', label: t('palette_cmd_duplicate', 'Duplicate document'), run: () => press(byId('duplicateMoreOptionsBtn'), 'mousedown') },
            doc && { id: 'pin', group: 'document', icon: 'push_pin', label: t('pin_document', 'Pin document'), run: () => press(byId('pinDocumentMoreOptionsBtn'), 'mousedown') },
            doc && { id: 'lock', group: 'document', icon: 'lock', label: t('lock_document', 'Lock document'), run: () => press(byId('lockDocumentMoreOptionsBtn'), 'mousedown') },
            doc && { id: 'download', group: 'document', icon: 'download', label: t('Download', 'Download'), run: () => press(byId('downloadMoreOptionsBtn'), 'mousedown') },
            doc && { id: 'share', group: 'document', icon: 'share', label: t('Share', 'Share'), run: () => press(byId('shareDocumentBtn')) },
            doc && { id: 'print', group: 'document', icon: 'print', label: t('print', 'Print'), run: () => press(byId('printMoreOptionsBtn'), 'mousedown') },

            { id: 'search', group: 'app', icon: 'search', label: t('search_documents', 'Search documents'), run: () => press(byId('searchBtn')) },
            { id: 'settings', group: 'app', icon: 'settings', label: t('settings', 'Settings'), run: () => press(document.querySelector('.settings-item')) },
            { id: 'help', group: 'app', icon: 'help', label: t('help', 'Help'), run: () => press(document.querySelector('.help-item')) },
            { id: 'theme-light', group: 'app', icon: 'light_mode', label: t('palette_cmd_theme', 'Theme: {name}').replace('{name}', t('sidebar_theme_light', 'Light')), run: () => setTheme('light') },
            { id: 'theme-dark', group: 'app', icon: 'dark_mode', label: t('palette_cmd_theme', 'Theme: {name}').replace('{name}', t('sidebar_theme_dark', 'Dark')), run: () => setTheme('dark') },
            { id: 'theme-system', group: 'app', icon: 'contrast', label: t('palette_cmd_theme', 'Theme: {name}').replace('{name}', t('sidebar_theme_system', 'System')), run: () => setTheme('system') }
        ].filter(Boolean);
    }

    function documentResults(query) {
        let list = [];
        try {
            list = typeof getWorkspaceDocuments === 'function' ? getWorkspaceDocuments() : (typeof documents !== 'undefined' ? documents : []);
        } catch (e) { list = []; }
        const q = query.toLowerCase();
        return list
            .filter(d => d && !d.trashedAt && String(d.title || '').toLowerCase().includes(q))
            .slice(0, 8)
            .map(d => ({ id: 'doc:' + d.id, group: 'documents', icon: 'description', label: d.title || t('untitled_document', 'Untitled document'), run: () => (typeof openDocument === 'function' ? openDocument(d.id) : null) }));
    }

    const GROUPS = { recent: ['palette_group_recent', 'Recent'], create: ['palette_group_create', 'Create'], documents: ['documents_section', 'Documents'], go: ['palette_group_go', 'Go to'], document: ['palette_group_document', 'This document'], app: ['palette_group_app', 'App'] };
    const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } };
    const remember = id => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id].concat(readRecent().filter(x => x !== id)).slice(0, 5))); } catch (e) {} };

    function score(label, q) {
        const l = label.toLowerCase();
        if (l === q) return 0;
        if (l.startsWith(q)) return 1;
        if (l.split(/\s+/).some(w => w.startsWith(q))) return 2;
        if (l.includes(q)) return 3;
        return -1;
    }

    let root = null;
    let items = [];
    let active = 0;
    let lastFocus = null;

    function results(query) {
        const all = commands();
        const q = query.trim().toLowerCase();
        if (!q) {
            const recentIds = readRecent();
            const recent = recentIds.map(id => all.find(c => c.id === id)).filter(Boolean).map(c => Object.assign({}, c, { group: 'recent' }));
            const rest = all.filter(c => !recentIds.includes(c.id));
            return recent.concat(rest);
        }
        const matched = all.map(c => [score(c.label, q), c]).filter(x => x[0] >= 0).sort((a, b) => a[0] - b[0]).map(x => x[1]);
        return documentResults(q).concat(matched);
    }

    function render() {
        const list = root.querySelector('.omni-palette-list');
        const query = root.querySelector('.omni-palette-input').value;
        items = results(query);
        active = Math.min(active, Math.max(0, items.length - 1));
        if (!items.length) {
            list.innerHTML = '<div class="omni-palette-empty">' + escapeHtml(t('palette_no_results', 'No matching commands')) + '</div>';
            root.querySelector('.omni-palette-input').removeAttribute('aria-activedescendant');
            return;
        }
        let html = '';
        let group = '';
        items.forEach((item, i) => {
            if (item.group !== group) {
                group = item.group;
                html += '<div class="omni-palette-group" role="presentation">' + escapeHtml(t(GROUPS[group][0], GROUPS[group][1])) + '</div>';
            }
            const keys = item.keys ? '<span class="omni-palette-keys">' + item.keys.map(k => '<span class="omni-fmt-kbd">' + k + '</span>').join(' ') + '</span>' : '';
            html += '<div class="omni-palette-item' + (i === active ? ' is-active' : '') + '" role="option" id="omniPaletteOpt' + i + '" data-index="' + i + '" aria-selected="' + (i === active) + '">'
                + '<span class="omni-palette-icon" aria-hidden="true"><icon>' + item.icon + '</icon></span>'
                + '<span class="omni-palette-label">' + escapeHtml(item.label) + '</span>' + keys + '</div>';
        });
        list.innerHTML = html;
        root.querySelector('.omni-palette-input').setAttribute('aria-activedescendant', 'omniPaletteOpt' + active);
    }

    function setActive(index) {
        if (!items.length) return;
        active = (index + items.length) % items.length;
        root.querySelectorAll('.omni-palette-item').forEach(el => {
            const on = Number(el.dataset.index) === active;
            el.classList.toggle('is-active', on);
            el.setAttribute('aria-selected', String(on));
            if (on) el.scrollIntoView({ block: 'nearest' });
        });
        root.querySelector('.omni-palette-input').setAttribute('aria-activedescendant', 'omniPaletteOpt' + active);
    }

    function runAt(index) {
        const item = items[index];
        if (!item) return;
        if (!String(item.id).startsWith('doc:')) remember(item.id);
        close(false);
        // Let the palette close before the command opens its own UI.
        setTimeout(() => { try { item.run(); } catch (e) { console.error('Command failed:', e); } }, 0);
    }

    function open() {
        if (root) { root.querySelector('.omni-palette-input').focus(); return; }
        lastFocus = document.activeElement;
        root = document.createElement('div');
        root.className = 'omni-palette-overlay';
        root.innerHTML = '<div class="omni-palette" role="dialog" aria-modal="true" aria-label="' + escapeHtml(t('palette_title', 'Command palette')) + '">'
            + '<label class="omni-palette-search"><icon aria-hidden="true">search</icon>'
            + '<input class="omni-palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="omniPaletteList" autocomplete="off" spellcheck="false" placeholder="' + escapeHtml(t('palette_placeholder', 'Type a command or search documents')) + '" aria-label="' + escapeHtml(t('palette_title', 'Command palette')) + '">'
            + '<span class="omni-palette-keys" aria-hidden="true"><span class="omni-fmt-kbd">Esc</span></span></label>'
            + '<div class="omni-palette-list" id="omniPaletteList" role="listbox"></div></div>';
        document.body.appendChild(root);
        const input = root.querySelector('.omni-palette-input');
        active = 0;
        render();
        input.addEventListener('input', () => { active = 0; render(); });
        input.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
            else if (e.key === 'Enter') { e.preventDefault(); runAt(active); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        });
        root.addEventListener('mousedown', e => { if (e.target === root) { e.preventDefault(); close(true); } });
        root.addEventListener('mousemove', e => { const el = e.target.closest('.omni-palette-item'); if (el && Number(el.dataset.index) !== active) setActive(Number(el.dataset.index)); });
        root.addEventListener('click', e => { const el = e.target.closest('.omni-palette-item'); if (el) runAt(Number(el.dataset.index)); });
        input.focus();
    }

    function close(returnFocus) {
        if (!root) return;
        root.remove();
        root = null;
        if (returnFocus && lastFocus && lastFocus.focus && lastFocus.isConnected) lastFocus.focus();
    }

    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            e.stopPropagation();
            if (root) close(true); else open();
        } else if (e.key === 'Escape' && root) {
            e.preventDefault();
            e.stopPropagation();
            close(true);
        }
    }, true);

    window.OmniCommandPalette = Object.freeze({ open, close: () => close(true) });
})();
