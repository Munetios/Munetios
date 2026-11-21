/*
 * OmniWrite UI behavior shared with Munetios UI v4:
 * - Google-style ripple on clickable controls
 * - Filled track for every range slider (--omni-fill)
 * Mirrors munetios-ui/munetios-ui-v4.js so OmniWrite works when deployed on its own.
 */
(function () {
    'use strict';
    if (window.OmniUI) return;
    const RIPPLE_SELECTOR = [
        'button', '.toolbar-item', '.sidebarnav__item', '.dropdown-item', '.menu-btn', '.settings-sidebar-item',
        '.omni-format-tile', '.omni-icon-tile', '.omni-font-option', '.controler-action', '.omni-select-option',
        '.navbar__right > icon', '.sidebar__header-right icon', '.omni-pick-list .folder-doc-checkbox',
        '.omni-download-option', '.omni-recovery-action', '.settings-select-btn', '.omni-fs-ss', '[data-omni-ripple]'
    ].join(',');
    const SKIP = 'input, textarea, select, [contenteditable="true"], .editor-surface, .omni-panel-resize-handle, .omni-media-resize-handle, [data-omni-no-ripple]';
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    document.addEventListener('pointerdown', event => {
        if (event.button !== 0 || (reduceMotion && reduceMotion.matches)) return;
        if (!event.target.closest) return;
        const host = event.target.closest(RIPPLE_SELECTOR);
        if (!host || host.disabled || event.target.closest(SKIP) || host.closest('.editor-surface')) return;
        const rect = host.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) return;
        const cs = getComputedStyle(host);
        if (cs.position === 'static') host.style.position = 'relative';
        let layer = host.querySelector(':scope > .omni-ripple-layer');
        if (!layer) {
            layer = document.createElement('span');
            layer.className = 'omni-ripple-layer';
            layer.setAttribute('aria-hidden', 'true');
            host.appendChild(layer);
        }
        const size = Math.hypot(rect.width, rect.height) * 2;
        const dot = document.createElement('span');
        dot.className = 'omni-ripple';
        dot.style.width = dot.style.height = size + 'px';
        dot.style.left = (event.clientX - rect.left - size / 2) + 'px';
        dot.style.top = (event.clientY - rect.top - size / 2) + 'px';
        layer.appendChild(dot);
        const release = () => {
            dot.classList.add('is-out');
            setTimeout(() => dot.remove(), 600);
            document.removeEventListener('pointerup', release, true);
            document.removeEventListener('pointercancel', release, true);
        };
        document.addEventListener('pointerup', release, true);
        document.addEventListener('pointercancel', release, true);
    }, { capture: true, passive: true });

    function paint(input) {
        const min = Number(input.min || 0), max = Number(input.max || 100), val = Number(input.value);
        input.style.setProperty('--omni-fill', (max > min ? ((val - min) / (max - min)) * 100 : 0) + '%');
    }
    document.addEventListener('input', e => { if (e.target && e.target.type === 'range') paint(e.target); }, true);
    const scan = root => { if (root && root.querySelectorAll) root.querySelectorAll('input[type="range"]').forEach(paint); if (root && root.type === 'range') paint(root); };
    function start() {
        scan(document.body);
        new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => n.nodeType === 1 && scan(n)))).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.OmniUI = Object.freeze({ paintRange: paint });
})();
