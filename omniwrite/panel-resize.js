/*
 * Resizable floating panels (used by the Read aloud panel).
 *
 * Adds a corner grip that resizes the panel with mouse, touch, or keyboard
 * (arrow keys, Shift for bigger steps). The size is remembered in this
 * browser only. Phones keep the panel full width, so the grip is hidden there.
 */
(function () {
    'use strict';
    if (window.OmniPanelResize) return;

    const t = (key, fallback) => {
        try { const v = typeof window._t === 'function' ? window._t(key) : ''; return v && v !== key ? v : fallback; } catch (e) { return fallback; }
    };
    const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} };

    function attach(panel, options) {
        if (!panel || panel.dataset.omniResizable === 'true') return;
        panel.dataset.omniResizable = 'true';
        const opts = Object.assign({ minWidth: 320, minHeight: 360, storageKey: '' }, options || {});
        const handle = document.createElement('div');
        handle.className = 'omni-panel-resize-handle';
        handle.tabIndex = 0;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'horizontal');
        handle.setAttribute('aria-label', t('resize_panel', 'Resize panel'));
        handle.innerHTML = '<icon aria-hidden="true">drag_handle</icon>';
        panel.appendChild(handle);

        const edge = 12;
        const apply = (width, height, save) => {
            const w = Math.round(Math.min(window.innerWidth - edge * 2, Math.max(opts.minWidth, width)));
            const h = Math.round(Math.min(window.innerHeight - edge * 2, Math.max(opts.minHeight, height)));
            panel.style.width = w + 'px';
            panel.style.height = h + 'px';
            panel.style.maxHeight = 'none';
            // Near the screen edge, slide the panel back so it keeps growing on screen.
            const rect = panel.getBoundingClientRect();
            if (rect.right > window.innerWidth - edge) panel.style.left = Math.max(edge, window.innerWidth - edge - w) + 'px';
            if (rect.bottom > window.innerHeight - edge) panel.style.top = Math.max(edge, window.innerHeight - edge - h) + 'px';
            if (save && opts.storageKey) write(opts.storageKey, { width: w, height: h });
        };
        const saved = opts.storageKey ? read(opts.storageKey) : null;
        if (saved && saved.width && saved.height && window.innerWidth > 760) {
            panel.style.width = saved.width + 'px';
            panel.style.height = saved.height + 'px';
            panel.style.maxHeight = 'none';
        }

        handle.addEventListener('pointerdown', event => {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const start = panel.getBoundingClientRect();
            // Pin the panel's top-left so it grows toward the grip.
            panel.style.left = start.left + 'px';
            panel.style.top = start.top + 'px';
            panel.style.right = 'auto';
            panel.style.transform = 'none';
            const startX = event.clientX;
            const startY = event.clientY;
            panel.classList.add('is-resizing');
            handle.setPointerCapture?.(event.pointerId);
            const move = e => apply(start.width + e.clientX - startX, start.height + e.clientY - startY, false);
            const up = e => {
                handle.releasePointerCapture?.(e.pointerId);
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
                panel.classList.remove('is-resizing');
                const r = panel.getBoundingClientRect();
                apply(r.width, r.height, true);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
        });
        handle.addEventListener('keydown', event => {
            const step = event.shiftKey ? 64 : 16;
            const r = panel.getBoundingClientRect();
            let w = r.width, h = r.height;
            if (event.key === 'ArrowRight') w += step;
            else if (event.key === 'ArrowLeft') w -= step;
            else if (event.key === 'ArrowDown') h += step;
            else if (event.key === 'ArrowUp') h -= step;
            else return;
            event.preventDefault();
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            panel.style.right = 'auto';
            panel.style.transform = 'none';
            apply(w, h, true);
        });
        window.addEventListener('resize', () => {
            if (!panel.style.width || window.innerWidth <= 760) return;
            const r = panel.getBoundingClientRect();
            apply(r.width, r.height, false);
        });
    }

    function setup() {
        attach(document.getElementById('readingModePanel'), { minWidth: 320, minHeight: 380, storageKey: 'omniwrite-reading-panel-size' });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();

    window.OmniPanelResize = Object.freeze({ attach });
})();
