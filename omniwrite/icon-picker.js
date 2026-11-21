/*
 * OmniWrite Icon picker
 *
 * Inserts any Material Symbols Rounded icon into the document.
 * - The icon list (material-symbols.json) was read from the same font file
 *   OmniWrite already loads, so every listed name renders. It loads locally;
 *   no third-party request is made.
 * - Search matches icon names and their alternate names.
 * - Icons are inserted with execCommand('insertHTML'), so Ctrl+Z undoes them.
 * - All icons are reachable: the grid renders in batches while you scroll.
 * - Recently used icons are remembered in this browser only.
 */
(function () {
    'use strict';
    if (window.OmniIconPicker) return;

    const DATA_URL = 'material-symbols.json';
    const RECENT_KEY = 'omniwrite-recent-icons';
    const FILL_KEY = 'omniwrite-icon-fill';
    const BATCH = 240;
    const EDITOR_SELECTOR = '.editor-surface, .document-page-editor, .split-editor, #editorArea';

    const t = (key, fallback) => {
        try {
            const value = typeof window._t === 'function' ? window._t(key) : '';
            return value && value !== key ? value : fallback;
        } catch (e) {
            return fallback;
        }
    };
    const toast = (message, type) => { try { window.showToast && window.showToast(message, { type: type || 'info' }); } catch (e) {} };
    const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const readStore = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
    const writeStore = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} };

    let icons = null;          // [{ name, aliases, search }]
    let loading = null;
    let savedRange = null;
    const instances = new Set();
    let titleSequence = 0;

    function loadIcons() {
        if (icons) return Promise.resolve(icons);
        if (loading) return loading;
        loading = fetch(DATA_URL, { credentials: 'same-origin' })
            .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .then(data => {
                icons = (data.icons || []).map(entry => {
                    const [name, ...aliases] = String(entry).split('|');
                    return { name, aliases, search: [name].concat(aliases).map(n => n.replace(/_/g, ' ')).join(' | ') };
                });
                // Alphabetical, with number icons (10k, 4mp, ...) after the lettered ones.
                icons.sort((a, b) => (/^\d/.test(a.name) - /^\d/.test(b.name)) || a.name.localeCompare(b.name));
                return icons;
            })
            .catch(error => { loading = null; throw error; });
        return loading;
    }

    // ---------------------------------------------------------------- search
    function score(icon, tokens, phrase) {
        const name = icon.name.replace(/_/g, ' ');
        if (name === phrase) return 0;
        if (name.startsWith(phrase)) return 1;
        if (icon.aliases.some(a => a.replace(/_/g, ' ') === phrase)) return 2;
        if (tokens.every(tok => name.split(' ').some(w => w.startsWith(tok)))) return 3;
        if (tokens.every(tok => icon.search.includes(tok))) return 4;
        return -1;
    }

    function search(query) {
        const phrase = String(query || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!phrase) return icons.slice();
        const tokens = phrase.split(' ');
        const matches = [];
        icons.forEach(icon => {
            const s = score(icon, tokens, phrase);
            if (s >= 0) matches.push([s, icon]);
        });
        matches.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name));
        return matches.map(m => m[1]);
    }

    function recentIcons() {
        const names = readStore(RECENT_KEY, []);
        const byName = new Map(icons.map(i => [i.name, i]));
        return names.map(n => byName.get(n)).filter(Boolean);
    }

    function remember(name) {
        const names = readStore(RECENT_KEY, []).filter(n => n !== name);
        names.unshift(name);
        writeStore(RECENT_KEY, names);
    }

    // ---------------------------------------------------------------- selection
    function editorFor(node) {
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        return el ? el.closest(EDITOR_SELECTOR) : null;
    }

    function captureRange() {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && editorFor(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
    }

    function insertIcon(name, targetRange = savedRange, filled = !!readStore(FILL_KEY, false)) {
        let range = targetRange?.cloneRange() || null;
        let editor = range ? editorFor(range.startContainer) : null;
        if (!editor?.isConnected) {
            // No caret yet: place it at the end of the open document.
            editor = document.querySelector('#editorContent.active #editorArea') || document.getElementById('editorArea');
            if (!editor || !editor.isConnected || !editor.closest('#editorContent.active')) {
                toast(t('please_open_document', 'Open a document first'), 'info');
                return false;
            }
            range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
        }
        editor.focus({ preventScroll: true });
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const label = name.replace(/_/g, ' ');
        const marker = 'omni-icon-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        // Inserted as a normal span so Chrome keeps it inside the paragraph (a
        // contenteditable="false" span gets pushed out of the block); it is made
        // non-editable right after. insertHTML keeps Ctrl+Z working.
        const html = '<span class="omni-doc-icon' + (filled ? ' omni-doc-icon-filled' : '') + '" role="img" data-omni-new="' + marker + '"'
            + ' aria-label="' + escapeHtml(label) + '" data-icon="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>&nbsp;';
        document.execCommand('insertHTML', false, html);
        const inserted = editor.querySelector('[data-omni-new="' + marker + '"]');
        if (inserted) {
            inserted.removeAttribute('data-omni-new');
            inserted.setAttribute('contenteditable', 'false');
            // Chrome copies the editor's inline theme colors onto inserted HTML;
            // drop them so the icon follows the text color in light and dark mode.
            inserted.removeAttribute('style');
            const next = inserted.nextSibling;
            if (next && next.nodeType === 1 && next.tagName === 'SPAN' && !next.className && next.textContent === ' ') {
                const space = document.createTextNode(' ');
                next.replaceWith(space);
                const caret = document.createRange();
                caret.setStartAfter(space);
                caret.collapse(true);
                const s = window.getSelection();
                s.removeAllRanges();
                s.addRange(caret);
            }
        }
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertOmniIcon' }));
        const after = window.getSelection();
        if (after && after.rangeCount) savedRange = after.getRangeAt(0).cloneRange();
        remember(name);
        return true;
    }

    // ---------------------------------------------------------------- modal
    function tileHtml(icon) {
        const label = icon.name.replace(/_/g, ' ');
        return '<button type="button" class="omni-icon-tile" data-icon="' + icon.name + '" tabindex="-1" title="' + escapeHtml(label) + '">'
            + '<span class="omni-icon-glyph" aria-hidden="true">' + icon.name + '</span>'
            + '<span class="omni-icon-name">' + escapeHtml(label) + '</span></button>';
    }

    function createPicker(initialRange) {
        let modal = null, observer = null, timer = 0;
        const lifecycle = new AbortController();
        let results = [], rendered = 0, tab = 'all';
        const instanceRange = initialRange?.cloneRange() || null;
        const insert = name => insertIcon(name, instanceRange, modal.querySelector('.omni-icon-fill-input').checked);
        const api = { open: show, close };

        function renderBatch() {
            if (!modal?.isConnected) return;
            const grid = modal.querySelector('.omni-icon-grid');
            if (rendered >= results.length) return;
            const next = results.slice(rendered, rendered + BATCH);
            grid.insertAdjacentHTML('beforeend', next.map(tileHtml).join(''));
            if (rendered === 0) {
                const first = grid.querySelector('.omni-icon-tile');
                if (first) first.tabIndex = 0;
            }
            rendered += next.length;
            const sentinel = modal.querySelector('.omni-icon-sentinel');
            sentinel.hidden = rendered >= results.length;
        }

        function showResults(list) {
            results = list;
            rendered = 0;
            if (!modal?.isConnected) return;
            const grid = modal.querySelector('.omni-icon-grid');
            grid.innerHTML = '';
            modal.querySelector('.omni-icon-scroll').scrollTop = 0;
            const empty = modal.querySelector('.omni-icon-empty');
            const query = modal.querySelector('.omni-icon-search-input').value.trim();
            const count = modal.querySelector('.omni-icon-count');
            count.textContent = t('icon_count', '{count} icons').replace('{count}', list.length.toLocaleString());
            if (!list.length) {
                empty.hidden = false;
                empty.textContent = tab === 'recent' && !query
                    ? t('icon_recent_empty', 'Icons you insert will appear here.')
                    : t('icon_no_results', 'No icons match "{query}"').replace('{query}', query);
            } else {
                empty.hidden = true;
            }
            renderBatch();
        }

        function refresh() {
            if (!modal?.isConnected || !icons) return;
            const query = modal.querySelector('.omni-icon-search-input').value;
            const base = tab === 'recent' ? recentIcons() : icons;
            if (!query.trim()) { showResults(base.slice()); return; }
            const matched = search(query);
            if (tab === 'recent') {
                const recent = new Set(base.map(i => i.name));
                showResults(matched.filter(i => recent.has(i.name)));
            } else {
                showResults(matched);
            }
        }

        function moveFocus(from, key) {
            const tiles = Array.from(modal.querySelectorAll('.omni-icon-tile'));
            const index = tiles.indexOf(from);
            if (index < 0) return;
            let columns = 1;
            const top = tiles[0].offsetTop;
            while (columns < tiles.length && tiles[columns].offsetTop === top) columns += 1;
            let next = index;
            if (key === 'ArrowRight') next = index + 1;
            else if (key === 'ArrowLeft') next = index - 1;
            else if (key === 'ArrowDown') next = index + columns;
            else if (key === 'ArrowUp') next = index - columns;
            else if (key === 'Home') next = 0;
            else if (key === 'End') next = tiles.length - 1;
            if (next >= tiles.length && rendered < results.length) { renderBatch(); return moveFocus(from, key); }
            next = Math.max(0, Math.min(tiles.length - 1, next));
            from.tabIndex = -1;
            tiles[next].tabIndex = 0;
            tiles[next].focus();
            tiles[next].scrollIntoView({ block: 'nearest' });
        }

        function close() {
            clearTimeout(timer);
            lifecycle.abort();
            instances.delete(api);
            if (observer) { observer.disconnect(); observer = null; }
            if (modal) { modal.remove(); modal = null; }
            const button = document.getElementById('insertIconBtn');
            if (button) button.setAttribute('aria-expanded', String(instances.size > 0));
        }

        function buildModal() {
            const filled = !!readStore(FILL_KEY, false);
            const titleId = 'omniIconTitle-' + (++titleSequence);
            const el = document.createElement('div');
            el.className = 'modal omni-icon-modal';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-modal', 'false');
            el.setAttribute('aria-labelledby', titleId);
            el.innerHTML = `
                <div class="modal-content omni-icon-dialog${filled ? ' is-filled' : ''}">
                    <div class="omni-icon-header">
                        <h2 id="${titleId}">${escapeHtml(t('insert_icon', 'Insert icon'))}</h2>
                        <button type="button" class="omni-icon-close" aria-label="${escapeHtml(t('close', 'Close'))}"><span aria-hidden="true">&times;</span></button>
                    </div>
                    <div class="omni-icon-controls">
                        <label class="omni-icon-search">
                            <icon aria-hidden="true">search</icon>
                            <input type="search" class="omni-icon-search-input" autocomplete="off" spellcheck="false" autofocus
                                   placeholder="${escapeHtml(t('icon_search_placeholder', 'Search icons'))}"
                                   aria-label="${escapeHtml(t('icon_search_placeholder', 'Search icons'))}">
                        </label>
                        <label class="omni-icon-fill">
                            <span>${escapeHtml(t('icon_filled', 'Filled'))}</span>
                            <span class="setting-toggle"><input type="checkbox" class="omni-icon-fill-input"${filled ? ' checked' : ''}><span class="setting-toggle-track"></span></span>
                        </label>
                    </div>
                    <div class="omni-icon-tabs" role="tablist">
                        <button type="button" role="tab" class="omni-icon-tab is-active" data-tab="all" aria-selected="true">${escapeHtml(t('icon_all', 'All icons'))}</button>
                        <button type="button" role="tab" class="omni-icon-tab" data-tab="recent" aria-selected="false">${escapeHtml(t('icon_recent', 'Recent'))}</button>
                        <span class="omni-icon-count" aria-live="polite"></span>
                    </div>
                    <div class="omni-icon-scroll">
                        <div class="omni-icon-grid" role="listbox" aria-label="${escapeHtml(t('insert_icon', 'Insert icon'))}"></div>
                        <p class="omni-icon-empty" hidden></p>
                        <div class="omni-icon-sentinel" aria-hidden="true"></div>
                    </div>
                </div>`;
            document.body.appendChild(el);
            return el;
        }

        async function show() {
            modal = buildModal();
            instances.add(api);
            modal.addEventListener('omni-modal-close', close);
            const position = () => {
                if (!modal) return;
                const trigger = document.getElementById('insertIconBtn');
                const rect = trigger?.getBoundingClientRect();
                const top = rect?.height && innerWidth > 760 && innerHeight - rect.bottom > 360 ? rect.bottom + 12 : 0;
                modal.style.alignItems = top ? 'flex-start' : '';
                modal.style.paddingTop = top ? top + 'px' : '';
                modal.querySelector('.omni-icon-dialog').style.height = top ? 'min(860px, calc(100dvh - ' + (top + 12) + 'px))' : '';
            };
            window.addEventListener('resize', position, { signal: lifecycle.signal });
            document.fonts?.ready.then(() => { if (modal) position(); });
            position();
            const button = document.getElementById('insertIconBtn');
            if (button) button.setAttribute('aria-expanded', 'true');
            const input = modal.querySelector('.omni-icon-search-input');
            if (!modal?.isConnected) return;
            const grid = modal.querySelector('.omni-icon-grid');
            modal.querySelector('.omni-icon-close').onclick = close;
            modal.addEventListener('mousedown', event => { if (event.target === modal) close(); });
            modal.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
                const tile = event.target.closest && event.target.closest('.omni-icon-tile');
                if (tile && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    moveFocus(tile, event.key);
                } else if (event.target === input && event.key === 'ArrowDown') {
                    event.preventDefault();
                    grid.querySelector('.omni-icon-tile')?.focus();
                } else if (event.target === input && event.key === 'Enter') {
                    event.preventDefault();
                    const first = grid.querySelector('.omni-icon-tile');
                    if (first && insert(first.dataset.icon)) close();
                }
            });
            grid.addEventListener('click', event => {
                const tile = event.target.closest('.omni-icon-tile');
                if (!tile) return;
                if (insert(tile.dataset.icon)) close();
            });
            modal.querySelector('.omni-icon-fill-input').addEventListener('change', event => {
                writeStore(FILL_KEY, event.target.checked);
                modal.querySelector('.omni-icon-dialog').classList.toggle('is-filled', event.target.checked);
            });
            modal.querySelectorAll('.omni-icon-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    tab = btn.dataset.tab;
                    modal.querySelectorAll('.omni-icon-tab').forEach(b => {
                        const on = b === btn;
                        b.classList.toggle('is-active', on);
                        b.setAttribute('aria-selected', on ? 'true' : 'false');
                    });
                    refresh();
                });
            });
            input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 80); });
            input.focus();
            modal.querySelector('.omni-icon-count').textContent = t('icon_loading', 'Loading icons…');
            try {
                await loadIcons();
            } catch (error) {
                console.error('Icon list failed to load:', error);
                toast(t('icon_load_failed', "Couldn't load the icon list. Please try again."), 'error');
                close();
                return;
            }
            if (!modal?.isConnected) return;
            refresh();
            const scroller = modal.querySelector('.omni-icon-scroll');
            // Keep loading while the end of the grid is near the visible area.
            const fillToView = () => {
                let guard = 0;
                while (modal && rendered < results.length && scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 900 && guard++ < 50) {
                    renderBatch();
                }
            };
            observer = new IntersectionObserver(entries => {
                if (entries.some(e => e.isIntersecting)) fillToView();
            }, { root: scroller, rootMargin: '600px' });
            observer.observe(modal.querySelector('.omni-icon-sentinel'));
            scroller.addEventListener('scroll', fillToView, { passive: true });
        }

        return api;
    }

    function open() {
        captureRange();
        return createPicker(savedRange).open();
    }

    function close() {
        Array.from(instances).pop()?.close();
    }

    function setup() {
        const button = document.getElementById('insertIconBtn');
        if (!button || button.dataset.omniIconReady === 'true') return;
        button.dataset.omniIconReady = 'true';
        // mousedown keeps the editor's caret where it is.
        button.addEventListener('mousedown', event => { event.preventDefault(); captureRange(); open(); });
        button.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
        });
        document.addEventListener('selectionchange', captureRange);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();

    window.OmniIconPicker = Object.freeze({ open, close, insert: insertIcon, load: loadIcons });
})();
