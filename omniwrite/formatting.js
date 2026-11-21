/*
 * OmniWrite Formatting panel
 *
 * 20 document formats grouped into Text and Paragraph, opened from the
 * toolbar's Formatting button (#formattingBtn).
 *
 * - Text formats use execCommand('insertHTML') so Ctrl+Z undoes them and any
 *   bold/italic/links inside the selection are kept.
 * - Paragraph formats toggle a class (or dir="rtl") on the selected blocks.
 * - Every change dispatches an input event on the editor, which runs
 *   OmniWrite's normal save path.
 * - Formats are plain classes (omni-fmt-*), so they survive saving and
 *   sanitizing; their look lives in index.html (see "Document formats").
 */
(function () {
    'use strict';
    if (window.OmniFormatting) return;

    const t = (key, fallback) => {
        try {
            const value = typeof window._t === 'function' ? window._t(key) : '';
            return value && value !== key ? value : fallback;
        } catch (e) {
            return fallback;
        }
    };
    const toast = (message, type) => {
        try { if (typeof window.showToast === 'function') window.showToast(message, { type: type || 'info' }); } catch (e) {}
    };

    const EDITOR_SELECTOR = '.editor-surface, .document-page-editor, .split-editor, #editorArea';
    const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, div:not(.editor-surface):not(.document-page-editor):not(.split-editor)';

    const TEXT_FORMATS = [
        { id: 'title-case', icon: 'match_case', key: 'fmt_title_case', label: 'Title Case', type: 'case' },
        { id: 'sentence-case', icon: 'title', key: 'fmt_sentence_case', label: 'Sentence case', type: 'case' },
        { id: 'small-caps', icon: 'format_size', key: 'fmt_small_caps', label: 'Small caps', type: 'wrap' },
        { id: 'wide', icon: 'format_letter_spacing', key: 'fmt_letter_spacing', label: 'Wide spacing', type: 'wrap' },
        { id: 'double-underline', icon: 'border_bottom', key: 'fmt_double_underline', label: 'Double underline', type: 'wrap' },
        { id: 'wavy-underline', icon: 'format_underlined_squiggle', key: 'fmt_wavy_underline', label: 'Wavy underline', type: 'wrap' },
        { id: 'overline', icon: 'format_overline', key: 'fmt_overline', label: 'Overline', type: 'wrap' },
        { id: 'marker', icon: 'ink_highlighter', key: 'fmt_marker', label: 'Marker', type: 'wrap' },
        { id: 'gradient', icon: 'gradient', key: 'fmt_gradient', label: 'Gradient text', type: 'wrap' },
        { id: 'kbd', icon: 'keyboard', key: 'fmt_keyboard', label: 'Keyboard key', type: 'wrap' },
        { id: 'spoiler', icon: 'visibility_off', key: 'fmt_spoiler', label: 'Spoiler', type: 'wrap' },
        { id: 'redact', icon: 'ink_eraser', key: 'fmt_redact', label: 'Redact', type: 'redact' },
        { id: 'badge', icon: 'sell', key: 'fmt_badge', label: 'Badge', type: 'wrap' }
    ];
    const PARAGRAPH_FORMATS = [
        { id: 'dropcap', icon: 'text_increase', key: 'fmt_drop_cap', label: 'Drop cap', type: 'block' },
        { id: 'lead', icon: 'article', key: 'fmt_lead', label: 'Lead paragraph', type: 'block' },
        { id: 'pullquote', icon: 'speaker_notes', key: 'fmt_pull_quote', label: 'Pull quote', type: 'block' },
        { id: 'card', icon: 'web_asset', key: 'fmt_card', label: 'Card', type: 'block' },
        { id: 'hanging', icon: 'keyboard_tab', key: 'fmt_hanging_indent', label: 'Hanging indent', type: 'block' },
        { id: 'rtl', icon: 'format_textdirection_r_to_l', key: 'fmt_rtl', label: 'Right to left', type: 'dir' },
        { id: 'ornament', icon: 'diamond', key: 'fmt_ornament', label: 'Ornament divider', type: 'insert' }
    ];
    const ALL_FORMATS = TEXT_FORMATS.concat(PARAGRAPH_FORMATS);
    const cls = id => 'omni-fmt-' + id;

    let savedRange = null;
    let panel = null;

    // ---------------------------------------------------------------- selection helpers
    function editorFor(node) {
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        return el ? el.closest(EDITOR_SELECTOR) : null;
    }

    function currentRange() {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && editorFor(sel.anchorNode)) return sel.getRangeAt(0);
        return savedRange;
    }

    function restoreRange(range) {
        if (!range) return false;
        const editor = editorFor(range.startContainer);
        if (!editor) return false;
        editor.focus({ preventScroll: true });
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
    }

    function notifyChange(editor) {
        if (!editor) return;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatOmni' }));
    }

    function rangeHtml(range) {
        const holder = document.createElement('div');
        holder.appendChild(range.cloneContents());
        // A range inside a font span clones its text, without the ancestor
        // that supplied the font. Keep each selected run's inherited settings.
        const common = range.commonAncestorContainer;
        const original = [];
        const collect = node => {
            const start = node === range.startContainer ? range.startOffset : 0;
            const end = node === range.endContainer ? range.endOffset : node.length;
            if (end > start && range.intersectsNode(node) && !node.parentElement?.closest('icon, .omni-doc-icon, [contenteditable="false"]')) original.push(node);
        };
        if (common.nodeType === Node.TEXT_NODE) collect(common);
        else {
            const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) collect(walker.currentNode);
        }
        const copies = [];
        const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.length && !node.parentElement?.closest('icon, .omni-doc-icon, [contenteditable="false"]')) copies.push(node);
        }
        copies.forEach((node, index) => {
            const source = original[index];
            if (!source?.parentElement) return;
            const style = getComputedStyle(source.parentElement);
            const span = document.createElement('span');
            span.style.fontFamily = style.fontFamily;
            span.style.fontFeatureSettings = style.fontFeatureSettings;
            span.style.fontVariationSettings = style.fontVariationSettings;
            for (const key of ['--omni-ff', '--omni-fv']) {
                const value = style.getPropertyValue(key);
                if (value.trim()) span.style.setProperty(key, value);
            }
            node.replaceWith(span); span.append(node);
        });
        return holder;
    }

    function ancestorWithClass(node, className, editor) {
        let el = node && (node.nodeType === 1 ? node : node.parentElement);
        while (el && el !== editor) {
            if (el.classList && el.classList.contains(className)) return el;
            el = el.parentElement;
        }
        return null;
    }

    function blocksInRange(range, editor) {
        const blocks = new Set();
        const pick = node => {
            let el = node && (node.nodeType === 1 ? node : node.parentElement);
            while (el && el !== editor && !el.matches(BLOCK_SELECTOR)) el = el.parentElement;
            if (el && el !== editor) blocks.add(el);
        };
        pick(range.startContainer);
        pick(range.endContainer);
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT, {
            acceptNode: n => (n.matches(BLOCK_SELECTOR) && range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
        });
        while (walker.nextNode()) {
            const n = walker.currentNode;
            // Prefer the innermost blocks: skip containers that hold other picked blocks.
            if (!n.querySelector(BLOCK_SELECTOR)) blocks.add(n);
        }
        return Array.from(blocks).filter(b => !Array.from(blocks).some(o => o !== b && b.contains(o)));
    }

    // ---------------------------------------------------------------- text transforms
    function transformTextNodes(holder, fn) {
        const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        let state = { first: true, sentenceStart: true };
        nodes.forEach(node => { node.textContent = fn(node.textContent, state); });
    }

    const toTitleCase = (text, state) => text.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (word, offset, all) => {
        const prev = offset > 0 ? all[offset - 1] : (state.first ? ' ' : state.lastChar || ' ');
        state.first = false;
        if (/[\p{L}\p{N}]/u.test(prev)) return word.toLocaleLowerCase();
        return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
    });

    function toSentenceCase(text, state) {
        let result = '';
        for (const ch of text.toLocaleLowerCase()) {
            if (state.sentenceStart && /\p{L}/u.test(ch)) {
                result += ch.toLocaleUpperCase();
                state.sentenceStart = false;
            } else {
                result += ch;
                if (/[.!?。！？]/u.test(ch)) state.sentenceStart = true;
            }
        }
        return result;
    }

    // ---------------------------------------------------------------- apply formats
    function applyCase(format, range, editor) {
        const holder = rangeHtml(range);
        if (!holder.textContent.trim()) return false;
        transformTextNodes(holder, format.id === 'title-case'
            ? (text, state) => { const out = toTitleCase(text, state); state.lastChar = text.slice(-1); return out; }
            : toSentenceCase);
        document.execCommand('insertHTML', false, holder.innerHTML);
        return true;
    }

    function applyRedact(range) {
        const holder = rangeHtml(range);
        if (!holder.textContent.trim()) return false;
        // The text is replaced, not hidden: redacted words are gone from the document.
        transformTextNodes(holder, text => text.replace(/\S/gu, '█'));
        document.execCommand('insertHTML', false, '<span class="' + cls('redact') + '">' + holder.innerHTML + '</span>');
        return true;
    }

    function applyWrap(format, range, editor) {
        const className = cls(format.id);
        const existing = ancestorWithClass(range.commonAncestorContainer, className, editor);
        if (existing) {
            // Toggle off: replace the wrapper with its contents and keep them selected.
            // (insertHTML would re-apply the wrapper's styling, so this edits the DOM directly.)
            const first = existing.firstChild;
            const last = existing.lastChild;
            existing.replaceWith(...existing.childNodes);
            if (first && last) {
                const keep = document.createRange();
                keep.setStartBefore(first);
                keep.setEndAfter(last);
                restoreRange(keep);
            }
            return true;
        }
        const holder = rangeHtml(range);
        if (!holder.textContent.trim()) return false;
        holder.querySelectorAll('.' + className).forEach(el => el.replaceWith(...el.childNodes));
        const extra = format.id === 'spoiler' ? ' tabindex="0"' : '';
        document.execCommand('insertHTML', false, '<span class="' + className + '"' + extra + '>' + holder.innerHTML + '</span>');
        return true;
    }

    function ensureBlock(range, editor) {
        let blocks = blocksInRange(range, editor);
        if (!blocks.length) {
            document.execCommand('formatBlock', false, 'p');
            const fresh = currentRange();
            blocks = fresh ? blocksInRange(fresh, editor) : [];
        }
        return blocks;
    }

    function applyBlock(format, range, editor) {
        const blocks = ensureBlock(range, editor);
        if (!blocks.length) return false;
        if (format.type === 'dir') {
            const turnOn = !blocks.every(b => b.getAttribute('dir') === 'rtl');
            blocks.forEach(b => { if (turnOn) b.setAttribute('dir', 'rtl'); else b.removeAttribute('dir'); });
            return true;
        }
        const className = cls(format.id);
        const turnOn = !blocks.every(b => b.classList.contains(className));
        blocks.forEach(b => {
            b.classList.toggle(className, turnOn);
            if (!b.classList.length) b.removeAttribute('class');
        });
        return true;
    }

    function insertOrnament(range, editor) {
        const blocks = blocksInRange(range, editor);
        const anchor = blocks.length ? blocks[blocks.length - 1] : null;
        const ornament = document.createElement('div');
        ornament.className = cls('ornament');
        ornament.setAttribute('contenteditable', 'false');
        ornament.setAttribute('role', 'separator');
        ornament.textContent = '✦ ✦ ✦';
        const after = document.createElement('p');
        after.appendChild(document.createElement('br'));
        if (anchor && anchor.parentNode) {
            anchor.after(ornament, after);
        } else {
            range.collapse(false);
            range.insertNode(after);
            range.insertNode(ornament);
        }
        const caret = document.createRange();
        caret.setStart(after, 0);
        caret.collapse(true);
        restoreRange(caret);
        return true;
    }

    function apply(formatId) {
        const format = ALL_FORMATS.find(f => f.id === formatId);
        const range = currentRange();
        if (!format || !range) {
            toast(t('please_open_document', 'Open a document first'), 'info');
            return;
        }
        restoreRange(range);
        const live = currentRange() || range;
        const editor = editorFor(live.startContainer);
        if (!editor) return;
        const needsSelection = format.type === 'wrap' || format.type === 'case' || format.type === 'redact';
        const existingWrap = format.type === 'wrap' && ancestorWithClass(live.commonAncestorContainer, cls(format.id), editor);
        if (needsSelection && live.collapsed && !existingWrap) {
            toast(t('formatting_select_text', 'Select some text first'), 'info');
            return;
        }
        let changed = false;
        if (format.type === 'case') changed = applyCase(format, live, editor);
        else if (format.type === 'redact') changed = applyRedact(live);
        else if (format.type === 'wrap') changed = applyWrap(format, live, editor);
        else if (format.type === 'block' || format.type === 'dir') changed = applyBlock(format, live, editor);
        else if (format.type === 'insert') changed = insertOrnament(live, editor);
        if (changed) {
            notifyChange(editor);
            const after = currentRange();
            if (after) savedRange = after.cloneRange();
            refreshActiveStates();
        }
    }

    // ---------------------------------------------------------------- panel
    function isActive(format, range) {
        if (!range) return false;
        const editor = editorFor(range.startContainer);
        if (!editor) return false;
        if (format.type === 'wrap' || format.type === 'redact') return !!ancestorWithClass(range.commonAncestorContainer, cls(format.id), editor);
        if (format.type === 'block') {
            const blocks = blocksInRange(range, editor);
            return blocks.length > 0 && blocks.every(b => b.classList.contains(cls(format.id)));
        }
        if (format.type === 'dir') {
            const blocks = blocksInRange(range, editor);
            return blocks.length > 0 && blocks.every(b => b.getAttribute('dir') === 'rtl');
        }
        return false;
    }

    function refreshActiveStates() {
        if (!panel) return;
        const range = currentRange();
        panel.querySelectorAll('.omni-format-tile').forEach(tile => {
            const format = ALL_FORMATS.find(f => f.id === tile.dataset.format);
            const on = isActive(format, range);
            tile.classList.toggle('is-active', on);
            tile.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function tileHtml(format) {
        const label = t(format.key, format.label);
        const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        return '<button type="button" class="omni-format-tile" data-format="' + format.id + '" aria-pressed="false">'
            + '<icon aria-hidden="true">' + format.icon + '</icon>'
            + '<span class="omni-format-tile-label">' + escapeHtml(label) + '</span></button>';
    }

    function buildPanel() {
        const el = document.createElement('div');
        el.id = 'omniFormattingPanel';
        el.className = 'dropdown-wrapper omni-format-panel';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', t('formatting_menu', 'Formatting'));
        el.style.display = 'none';
        el.innerHTML =
            '<div class="omni-format-section-title">' + t('formatting_section_text', 'Text') + '</div>'
            + '<div class="omni-format-grid">' + TEXT_FORMATS.map(tileHtml).join('') + '</div>'
            + '<div class="omni-format-section-title">' + t('formatting_section_paragraph', 'Paragraph') + '</div>'
            + '<div class="omni-format-grid">' + PARAGRAPH_FORMATS.map(tileHtml).join('') + '</div>';
        // Keep the editor selection while clicking tiles.
        el.addEventListener('mousedown', event => event.preventDefault());
        el.addEventListener('click', event => {
            const tile = event.target.closest('.omni-format-tile');
            if (!tile) return;
            apply(tile.dataset.format);
        });
        el.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(true); }
        });
        document.body.appendChild(el);
        return el;
    }

    function position(button) {
        const rect = button.getBoundingClientRect();
        const gap = 10;
        const edge = 12;
        panel.style.position = 'fixed';
        panel.style.margin = '0';
        panel.style.maxHeight = '';
        const width = panel.offsetWidth;
        const natural = panel.scrollHeight;
        const below = window.innerHeight - rect.bottom - gap - edge;
        const above = rect.top - gap - edge;
        // Open on the side with more room; scroll inside if it still doesn't fit.
        const openBelow = natural <= below || below >= above;
        const room = Math.max(160, openBelow ? below : above);
        const height = Math.min(natural, room);
        panel.style.maxHeight = room + 'px';
        const left = Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge);
        const top = openBelow ? rect.bottom + gap : rect.top - gap - height;
        panel.style.left = left + 'px';
        panel.style.top = Math.max(edge, top) + 'px';
    }

    function open(button) {
        const range = currentRange();
        if (range) savedRange = range.cloneRange();
        if (!panel || !panel.isConnected) panel = buildPanel();
        panel.style.display = 'block';
        panel.setAttribute('aria-hidden', 'false');
        position(button);
        refreshActiveStates();
        button.setAttribute('aria-expanded', 'true');
        button.classList.add('active');
    }

    function close(returnFocus) {
        const button = document.getElementById('formattingBtn');
        if (panel) {
            panel.style.display = 'none';
            panel.setAttribute('aria-hidden', 'true');
        }
        if (button) {
            button.setAttribute('aria-expanded', 'false');
            button.classList.remove('active');
            if (returnFocus) button.focus();
        }
    }

    const isOpen = () => !!(panel && panel.isConnected && panel.style.display === 'block');

    function setup() {
        const button = document.getElementById('formattingBtn');
        if (!button || button.dataset.omniFormattingReady === 'true') return;
        button.dataset.omniFormattingReady = 'true';
        button.addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();
            if (isOpen()) close(false); else open(button);
        });
        button.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            if (isOpen()) { close(false); return; }
            open(button);
            panel.querySelector('.omni-format-tile')?.focus();
        });
        document.addEventListener('mousedown', event => {
            if (!isOpen()) return;
            if (panel.contains(event.target) || button.contains(event.target)) return;
            close(false);
        });
        document.addEventListener('selectionchange', () => {
            const sel = window.getSelection();
            if (sel && sel.rangeCount && editorFor(sel.anchorNode)) {
                savedRange = sel.getRangeAt(0).cloneRange();
                if (isOpen()) refreshActiveStates();
            }
        });
        window.addEventListener('resize', () => { if (isOpen()) position(button); });
        // Spoilers reveal on click or Enter as well as hover/focus.
        document.addEventListener('click', event => {
            const spoiler = event.target.closest && event.target.closest('.omni-fmt-spoiler');
            if (spoiler) spoiler.classList.toggle('is-revealed');
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();

    window.OmniFormatting = Object.freeze({
        formats: ALL_FORMATS.map(f => f.id),
        apply,
        open: () => { const b = document.getElementById('formattingBtn'); if (b) open(b); },
        close: () => close(false)
    });
})();
