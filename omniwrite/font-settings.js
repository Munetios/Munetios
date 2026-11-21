/*
 * OmniWrite font settings (font family picker > right pane)
 *
 * - Stylistic sets ss01–ss20 are available for every font (ss01 on by
 *   default). Fonts ignore OpenType sets they do not support.
 * - Sliders for every variation axis a font really has. The axis ranges were
 *   read from the font files OmniWrite loads (api.munetios.com/fonts).
 * - Changes apply to selected text, or to text typed next at the caret.
 *   The Settings picker edits document defaults separately. Per-text settings
 *   are saved as CSS custom properties (--omni-ff / --omni-fv).
 * - A picker with data-font-scope="external" (spreadsheet cells) reads and
 *   writes through picker._fontContext() and picker._applyFont({ font, ff, fv, kind }).
 */
(function () {
    'use strict';
    if (window.OmniFontSettings) return;

    const AXIS = (tag, min, def, max, step) => ({ tag, min, default: def, max, step: step || 1 });
    // Read from the font files' fvar tables.
    const META = {
        'google sans flex': {
            stylisticSets: true,
            axes: [AXIS('wght', 1, 400, 1000), AXIS('wdth', 25, 100, 151), AXIS('opsz', 6, 18, 144), AXIS('GRAD', 0, 0, 100), AXIS('ROND', 0, 0, 100), AXIS('slnt', -10, 0, 0, 0.5)]
        },
        'google sans': { stylisticSets: false, axes: [AXIS('wght', 400, 400, 700), AXIS('opsz', 17, 18, 18, 0.001), AXIS('GRAD', -50, 0, 200)] },
        'inter': { stylisticSets: false, axes: [AXIS('wght', 100, 400, 900), AXIS('opsz', 14, 14, 32)] },
        'open sans': { stylisticSets: false, axes: [AXIS('wght', 300, 400, 800), AXIS('wdth', 75, 100, 100)] },
        'roboto': { stylisticSets: false, axes: [AXIS('wght', 100, 400, 900), AXIS('wdth', 75, 100, 100)] }
    };
    const SS_KEYS = Array.from({ length: 20 }, (_, i) => 'ss' + String(i + 1).padStart(2, '0'));
    const AXIS_LABELS = { wght: ['axis_wght', 'Weight'], wdth: ['axis_wdth', 'Width'], opsz: ['axis_opsz', 'Optical size'], GRAD: ['axis_GRAD', 'Grade'], ROND: ['axis_ROND', 'Roundness'], slnt: ['axis_slnt', 'Slant'] };
    const EDITOR_SELECTOR = '.editor-surface, .document-page-editor, .split-editor, #editorArea';

    const t = (key, fallback) => {
        try { const v = typeof window._t === 'function' ? window._t(key) : ''; return v && v !== key ? v : fallback; } catch (e) { return fallback; }
    };
    const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const primaryFamily = value => String(value || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();

    function metaFor(fontValue) {
        const meta = META[primaryFamily(fontValue)];
        return meta ? { stylisticSets: meta.stylisticSets, axes: meta.axes.map(a => Object.assign({}, a)) } : null;
    }

    // ---------------------------------------------------------------- state
    const pane = { font: '', label: '', targets: [], range: null, editor: null, picker: null, defaults: false, external: false, ff: {}, fv: {} };
    const externalContext = () => { try { return (pane.external && pickerEl()?._fontContext?.()) || {}; } catch (e) { return {}; } };
    let commitFrame = 0;

    function documentDefaultFeatures() {
        const state = {};
        SS_KEYS.forEach(k => { state[k] = k === 'ss01'; });
        try {
            const stored = JSON.parse(localStorage.getItem('omniwrite-document-font-features') || '{}');
            SS_KEYS.forEach(k => { if (typeof stored[k] === 'boolean') state[k] = stored[k]; });
        } catch (e) {}
        return state;
    }

    function parsePairs(text) {
        const out = {};
        String(text || '').replace(/["']([A-Za-z0-9]{4})["']\s+(-?[\d.]+)/g, (_, tag, value) => { out[tag] = Number(value); return ''; });
        return out;
    }

    function editorFor(node) {
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        return el ? el.closest(EDITOR_SELECTOR) : null;
    }

    function pickerEl() { return pane.picker && (pane.picker.isConnected || window.OmniLazyDom?.isParked(pane.picker)) ? pane.picker : document.getElementById('fontFamilyPicker'); }

    function captureContext() {
        pane.targets = [];
        pane.range = null;
        pane.editor = null;
        if (pane.defaults || pane.external) return;
        const picker = pickerEl();
        let range = picker?._savedSelection?.cloneRange() || null;
        if (!range) {
            const selection = window.getSelection();
            if (selection?.rangeCount && editorFor(selection.anchorNode)) range = selection.getRangeAt(0).cloneRange();
        }
        const editor = range ? editorFor(range.startContainer) : null;
        if (!editor?.isConnected || editorFor(range.endContainer) !== editor) return;
        pane.range = range;
        pane.editor = editor;
    }

    function readCurrent(meta) {
        const probe = pane.targets[0] || (pane.range ? (pane.range.startContainer.nodeType === 1 ? pane.range.startContainer : pane.range.startContainer.parentElement) : null);
        // Stylistic sets
        const ffHost = probe && probe.closest ? probe.closest('[data-omni-ff]') : null;
        const defaults = documentDefaultFeatures();
        const ext = externalContext();
        const ffParsed = pane.external ? parsePairs(ext.ff) : ffHost ? parsePairs(ffHost.style.getPropertyValue('--omni-ff')) : {};
        pane.ff = {};
        SS_KEYS.forEach(k => { pane.ff[k] = k in ffParsed ? ffParsed[k] === 1 : defaults[k]; });
        // Axes
        pane.fv = {};
        if (!meta) return;
        const fvHost = probe && probe.closest ? probe.closest('[data-omni-fv]') : null;
        let storedAxes = {};
        if (pane.defaults) { try { storedAxes = JSON.parse(localStorage.getItem('omniwrite-document-font-variations') || '{}')[primaryFamily(pane.font)] || {}; } catch (e) {} }
        const fvParsed = pane.external ? parsePairs(ext.fv) : pane.defaults ? storedAxes : fvHost ? parsePairs(fvHost.style.getPropertyValue('--omni-fv')) : (probe ? parsePairs(getComputedStyle(probe).fontVariationSettings) : {});
        const computedWeight = pane.external ? Number(ext.weight) || 400 : probe ? Number(getComputedStyle(probe).fontWeight) : 400;
        meta.axes.forEach(axis => {
            let value = axis.tag in fvParsed ? fvParsed[axis.tag] : (axis.tag === 'wght' && computedWeight ? computedWeight : axis.default);
            pane.fv[axis.tag] = Math.min(axis.max, Math.max(axis.min, value));
        });
    }

    // ---------------------------------------------------------------- apply
    const ffString = () => SS_KEYS.map(k => '"' + k + '" ' + (pane.ff[k] ? 1 : 0)).join(', ');
    const fvString = () => Object.keys(pane.fv).map(tag => '"' + tag + '" ' + pane.fv[tag]).join(', ');

    function ensureTargets() {
        if (pane.targets.length && pane.targets.every(target => target.isConnected && pane.editor?.contains(target))) return pane.targets;
        const range = pane.range, editor = pane.editor;
        if (!range || !editor?.isConnected || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return [];
        const targets = [];
        const caretOnly = range.collapsed;
        if (caretOnly) {
            const span = document.createElement('span');
            span.dataset.omniFx = '';
            span.textContent = '\u200B';
            range.insertNode(span);
            targets.push(span);
        } else {
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (!node.length || node.parentElement.closest('[contenteditable="false"], script, style')) return NodeFilter.FILTER_REJECT;
                    return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            });
            const portions = [];
            while (walker.nextNode()) {
                const node = walker.currentNode;
                const start = node === range.startContainer ? range.startOffset : 0;
                const end = node === range.endContainer ? range.endOffset : node.length;
                if (end <= start) continue;
                const part = document.createRange(); part.setStart(node, start); part.setEnd(node, end); portions.push(part);
            }
            for (const part of portions.reverse()) {
                const span = document.createElement('span'); span.dataset.omniFx = '';
                span.appendChild(part.extractContents()); part.insertNode(span); targets.unshift(span);
            }
        }
        if (targets.length) {
            const keep = document.createRange();
            if (caretOnly) { keep.selectNodeContents(targets[0]); keep.collapse(false); }
            else { keep.setStart(targets[0], 0); const last = targets[targets.length - 1]; keep.setEnd(last, last.childNodes.length); }
            pane.range = keep;
            pickerEl()._savedSelection = keep.cloneRange();
            pane.targets = targets;
        }
        return targets;
    }

    function commit(kind) {
        if (pane.defaults) {
            pickerEl()?._applyDefaultFont?.({ font: pane.font, ff: { ...pane.ff }, fv: { ...pane.fv }, kind });
            return;
        }
        if (pane.external) {
            pickerEl()?._applyFont?.({ font: pane.font, ff: { ...pane.ff }, fv: { ...pane.fv }, ffString: ffString(), fvString: Object.keys(pane.fv).length ? fvString() : '', kind });
            return;
        }
        const targets = ensureTargets();
        for (const target of targets) {
            if (kind === 'ff' || kind === 'all') {
                target.style.setProperty('--omni-ff', ffString()); target.dataset.omniFf = '';
            }
            if (kind === 'fv' || kind === 'all') {
                target.style.setProperty('--omni-fv', fvString()); target.dataset.omniFv = '';
            }
            target.style.fontFamily = pane.font;
        }
        if (targets.length) {
            const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(pane.range.cloneRange());
            pane.editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatOmniFont' }));
        }
    }

    function reset() {
        cancelAnimationFrame(commitFrame);
        pane.ff = Object.fromEntries(SS_KEYS.map(key => [key, key === 'ss01']));
        pane.fv = Object.fromEntries((metaFor(pane.font)?.axes || []).map(axis => [axis.tag, axis.default]));
        commit('all');
        render();
    }

    // ---------------------------------------------------------------- render
    function previewStyle() {
        const parts = ['font-family:' + pane.font.replace(/"/g, "'")];
        parts.push('--omni-ff:' + ffString());
        parts.push('--omni-fv:' + (Object.keys(pane.fv).length ? fvString() : 'normal'));
        return parts.join(';');
    }

    function render() {
        const host = pickerEl()?.querySelector('.omni-font-settings');
        if (!host) return;
        const meta = metaFor(pane.font);
        const hasAxes = !!(meta && meta.axes.length);
        let html = '<div class="omni-fs-head"><div class="omni-fs-heading">'
            + '<div class="omni-fs-title">' + escapeHtml(t('font_settings', 'Font settings')) + '</div>'
            + '<div class="omni-fs-font">' + escapeHtml(pane.label || primaryFamily(pane.font)) + '</div></div>'
            + '<button type="button" class="omni-fs-reset"><icon aria-hidden="true">restart_alt</icon><span>' + escapeHtml(t('font_settings_reset', 'Reset')) + '</span></button>'
            + '</div>'
            + '<div class="omni-fs-preview" data-omni-ff data-omni-fv style="' + escapeHtml(previewStyle()) + '">' + escapeHtml(t('font_preview_text', 'The quick brown fox jumps over the lazy dog')) + ' 0123</div>';
        html += '<p class="omni-fs-hint">' + escapeHtml((pane.external ? t('font_settings_cells_hint', 'Applies to the selected cells.') : pane.defaults ? t('font_settings_defaults_hint', 'Defaults apply to all documents. Selected-text formatting is preserved.') : t('font_settings_selection_hint', 'Changes apply only to selected text, or to text typed next at the cursor.'))) + '</p>';
        html += '<div class="omni-fs-section">' + escapeHtml(t('font_stylistic_sets', 'Stylistic sets')) + '</div><div class="omni-fs-ss-grid">'
            + SS_KEYS.map(k => '<button type="button" class="omni-fs-ss' + (pane.ff[k] ? ' is-on' : '') + '" data-ss="' + k + '" aria-pressed="' + !!pane.ff[k] + '">' + k + '</button>').join('')
            + '</div>';
        if (hasAxes) {
            html += '<div class="omni-fs-section">' + escapeHtml(t('font_axes', 'Variable axes')) + '</div><div class="omni-fs-axes">'
                + meta.axes.map(axis => {
                    const label = AXIS_LABELS[axis.tag] ? t(AXIS_LABELS[axis.tag][0], AXIS_LABELS[axis.tag][1]) : axis.tag;
                    const value = pane.fv[axis.tag];
                    const id = pickerEl().id + '-omniAxis-' + axis.tag;
                    return '<div class="omni-fs-axis"><label for="' + id + '"><span class="omni-fs-axis-name">' + escapeHtml(label) + '</span>'
                        + '<span class="omni-fs-axis-tag">' + axis.tag + '</span><span class="omni-fs-axis-value" data-value-for="' + axis.tag + '">' + value + '</span></label>'
                        + '<input type="range" id="' + id + '" data-axis="' + axis.tag + '" min="' + axis.min + '" max="' + axis.max + '" step="' + axis.step + '" value="' + value + '"></div>';
                }).join('') + '</div>';
        }
        host.innerHTML = html;
        bind(host);
    }

    function updatePreview(host) {
        const preview = host.querySelector('.omni-fs-preview');
        if (preview) preview.setAttribute('style', previewStyle());
    }

    function bind(host) {
        host.querySelectorAll('button, input').forEach(el => el.addEventListener('mousedown', e => e.stopPropagation()));
        host.querySelector('.omni-fs-reset')?.addEventListener('click', reset);
        host.querySelectorAll('.omni-fs-ss').forEach(btn => {
            btn.addEventListener('mousedown', e => e.preventDefault());
            btn.addEventListener('click', () => {
                const key = btn.dataset.ss;
                pane.ff[key] = !pane.ff[key];
                btn.classList.toggle('is-on', pane.ff[key]);
                btn.setAttribute('aria-pressed', String(pane.ff[key]));
                updatePreview(host);
                commit('ff');
            });
        });
        host.querySelectorAll('input[type="range"][data-axis]').forEach(input => {
            input.addEventListener('input', () => {
                pane.fv[input.dataset.axis] = Number(input.value);
                const out = host.querySelector('[data-value-for="' + input.dataset.axis + '"]');
                if (out) out.textContent = input.value;
                updatePreview(host);
                cancelAnimationFrame(commitFrame);
                commitFrame = requestAnimationFrame(() => commit('fv'));
            });
        });
    }

    function fontOfContext() {
        if (pane.external) return externalContext().font || "'Google Sans Flex'";
        const probe = pane.targets[0] || (pane.range ? (pane.range.startContainer.nodeType === 1 ? pane.range.startContainer : pane.range.startContainer.parentElement) : null);
        const family = probe ? getComputedStyle(probe).fontFamily : "'Google Sans Flex'";
        return family || "'Google Sans Flex'";
    }

    function labelFor(fontValue) {
        const picker = pickerEl();
        const fam = primaryFamily(fontValue);
        const row = picker ? Array.from(picker.querySelectorAll('.omni-font-option[data-font]')).find(r => primaryFamily(r.getAttribute('data-font')) === fam) : null;
        const text = row ? row.querySelector('.menu-text') : null;
        return text ? text.textContent.trim() : String(fontValue).split(',')[0].replace(/['"]/g, '').trim();
    }

    function markCurrent() {
        const picker = pickerEl();
        if (!picker) return;
        const fam = primaryFamily(pane.font);
        picker.querySelectorAll('.omni-font-option[data-font]').forEach(row => {
            const on = primaryFamily(row.getAttribute('data-font')) === fam;
            row.classList.toggle('is-current', on);
            row.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }

    function refresh(fontValue, picker = document.getElementById('fontFamilyPicker')) {
        cancelAnimationFrame(commitFrame);
        pane.picker = picker;
        pane.defaults = picker?.dataset.fontScope === 'default';
        pane.external = picker?.dataset.fontScope === 'external';
        captureContext();
        pane.font = fontValue || (pane.defaults ? localStorage.getItem('omniwrite-default-font') || "'Google Sans Flex'" : fontOfContext());
        pane.label = labelFor(pane.font);
        readCurrent(metaFor(pane.font));
        markCurrent();
        render();
    }

    function setup() {
        // Refresh the pane each time the picker opens (the app's handler stops
        // other listeners on the button, so this listens in the capture phase).
        document.addEventListener('mousedown', event => {
            if (event.target.closest && event.target.closest('#fontFamilyBtn')) setTimeout(() => {
                const picker = document.getElementById('fontFamilyPicker');
                if (picker && picker.style.display === 'block') refresh(undefined, picker);
            }, 0);
        }, true);
        // Tune: apply the font, keep the picker open, and show its settings.
        document.addEventListener('mousedown', event => {
            const tune = event.target.closest && event.target.closest('.omni-font-tune');
            if (!tune) return;
            event.preventDefault();
            event.stopPropagation();
            const row = tune.closest('.omni-font-option');
            const picker = tune.closest('.omni-font-picker-panel');
            if (!row || !picker) return;
            const fontValue = tune.getAttribute('data-tune-font');
            // Let the app apply the font through its normal path, then reopen.
            row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            const sel = window.getSelection();
            if (picker.dataset.fontScope !== 'default' && sel && sel.rangeCount && editorFor(sel.anchorNode)) picker._savedSelection = sel.getRangeAt(0).cloneRange();
            picker.style.display = 'block';
            picker.setAttribute('aria-hidden', 'false');
            refresh(fontValue, picker);
        }, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();

    window.OmniFontSettings = Object.freeze({ metaFor, refresh, stylisticSetKeys: SS_KEYS.slice() });
})();
