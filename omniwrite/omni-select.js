/*
 * OmniWrite custom select
 *
 * Replaces the look of every native <select> with a liquid-glass dropdown that
 * matches the redesigned UI. The native <select> stays in the DOM (visually
 * hidden) and remains the source of truth, so existing code that reads
 * .value, sets .value/.selectedIndex, or listens for "change" keeps working.
 *
 * - Works for selects added later (modals are built on demand).
 * - Keyboard: Enter/Space/ArrowDown opens, arrows move, Enter picks,
 *   Escape closes, typing jumps to a matching option.
 * - Opt out with data-native-select on a <select>.
 */
(function () {
    'use strict';
    if (window.OmniSelect) return;

    const enhanced = new WeakMap(); // select -> { button, label }
    let openState = null;           // { select, menu, button, index }
    let uid = 0;

    const optionLabel = option => (option ? (option.label || option.textContent || '').trim() : '');

    function syncLabel(select) {
        const state = enhanced.get(select);
        if (!state) return;
        const option = select.options[select.selectedIndex];
        state.label.textContent = optionLabel(option) || ' ';
        state.button.disabled = select.disabled;
        state.button.classList.toggle('is-disabled', select.disabled);
    }

    function closeMenu(returnFocus) {
        if (!openState) return;
        const { menu, button } = openState;
        menu.remove();
        button.setAttribute('aria-expanded', 'false');
        button.classList.remove('is-open');
        if (returnFocus) button.focus();
        openState = null;
        document.removeEventListener('mousedown', onOutside, true);
        window.removeEventListener('resize', onReposition);
        document.removeEventListener('scroll', onReposition, true);
    }

    function onOutside(event) {
        if (!openState) return;
        if (openState.menu.contains(event.target) || openState.button.contains(event.target)) return;
        closeMenu(false);
    }

    function onReposition(event) {
        if (!openState) return;
        if (event && event.type === 'scroll' && openState.menu.contains(event.target)) return;
        position(openState.button, openState.menu);
    }

    function position(button, menu) {
        const rect = button.getBoundingClientRect();
        const gap = 8;
        const edge = 12;
        menu.style.minWidth = Math.max(rect.width, 200) + 'px';
        menu.style.maxHeight = '';
        const natural = menu.scrollHeight;
        const below = window.innerHeight - rect.bottom - gap - edge;
        const above = rect.top - gap - edge;
        const openBelow = natural <= below || below >= above;
        const room = Math.max(140, openBelow ? below : above);
        menu.style.maxHeight = room + 'px';
        const height = Math.min(natural, room);
        const width = menu.offsetWidth;
        menu.style.left = Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge) + 'px';
        menu.style.top = (openBelow ? rect.bottom + gap : rect.top - gap - height) + 'px';
    }

    function setActive(index, scroll) {
        if (!openState) return;
        const items = openState.menu.querySelectorAll('.omni-select-option');
        if (!items.length) return;
        const clamped = Math.max(0, Math.min(items.length - 1, index));
        items.forEach((item, i) => item.classList.toggle('is-active', i === clamped));
        openState.index = clamped;
        openState.button.setAttribute('aria-activedescendant', items[clamped].id);
        if (scroll) items[clamped].scrollIntoView({ block: 'nearest' });
    }

    function choose(index) {
        if (!openState) return;
        const { select } = openState;
        const item = openState.menu.querySelectorAll('.omni-select-option')[index];
        if (!item || item.getAttribute('aria-disabled') === 'true') return;
        const optionIndex = Number(item.dataset.index);
        const changed = select.selectedIndex !== optionIndex;
        select.selectedIndex = optionIndex;
        syncLabel(select);
        closeMenu(true);
        if (changed) {
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function openMenu(select) {
        const state = enhanced.get(select);
        if (!state || select.disabled) return;
        if (openState && openState.select === select) { closeMenu(true); return; }
        closeMenu(false);
        const menu = document.createElement('div');
        const menuId = 'omniSelectMenu' + (++uid);
        menu.id = menuId;
        menu.className = 'omni-select-menu';
        if (select.closest('.omni-collab-modal')) menu.classList.add('omni-collab-select-menu');
        menu.setAttribute('role', 'listbox');
        const labelledBy = state.button.getAttribute('aria-labelledby');
        if (labelledBy) menu.setAttribute('aria-labelledby', labelledBy);
        else if (state.button.getAttribute('aria-label')) menu.setAttribute('aria-label', state.button.getAttribute('aria-label'));
        let html = '';
        let visibleIndex = 0;
        const addOption = (option, optionIndex) => {
            const selected = optionIndex === select.selectedIndex;
            const disabled = option.disabled;
            html += '<div class="omni-select-option' + (selected ? ' is-selected' : '') + '" role="option" id="' + menuId + '-o' + visibleIndex
                + '" data-index="' + optionIndex + '" aria-selected="' + selected + '"' + (disabled ? ' aria-disabled="true"' : '') + '>'
                + '<span class="omni-select-option-label"></span>'
                + '<icon class="omni-select-check" aria-hidden="true">check</icon></div>';
            visibleIndex += 1;
        };
        Array.from(select.children).forEach(child => {
            if (child.tagName === 'OPTGROUP') {
                html += '<div class="omni-select-group" role="presentation"></div>';
                Array.from(child.children).forEach(opt => addOption(opt, opt.index));
            } else if (child.tagName === 'OPTION' && !child.hidden) {
                addOption(child, child.index);
            }
        });
        menu.innerHTML = html;
        // Fill labels as text (never as HTML).
        menu.querySelectorAll('.omni-select-option').forEach(item => {
            item.querySelector('.omni-select-option-label').textContent = optionLabel(select.options[Number(item.dataset.index)]);
        });
        let groupIndex = 0;
        const groups = Array.from(select.querySelectorAll('optgroup'));
        menu.querySelectorAll('.omni-select-group').forEach(g => { g.textContent = groups[groupIndex++]?.label || ''; });
        document.body.appendChild(menu);
        state.button.setAttribute('aria-expanded', 'true');
        state.button.setAttribute('aria-controls', menuId);
        state.button.classList.add('is-open');
        openState = { select, menu, button: state.button, index: 0 };
        position(state.button, menu);
        const items = Array.from(menu.querySelectorAll('.omni-select-option'));
        const selectedPos = Math.max(0, items.findIndex(i => i.classList.contains('is-selected')));
        setActive(selectedPos, true);
        menu.addEventListener('mousedown', event => event.preventDefault());
        menu.addEventListener('click', event => {
            const item = event.target.closest('.omni-select-option');
            if (item) choose(items.indexOf(item));
        });
        menu.addEventListener('mousemove', event => {
            const item = event.target.closest('.omni-select-option');
            if (item) setActive(items.indexOf(item), false);
        });
        document.addEventListener('mousedown', onOutside, true);
        window.addEventListener('resize', onReposition);
        document.addEventListener('scroll', onReposition, true);
    }

    let typeBuffer = '';
    let typeTimer = 0;
    function onButtonKey(event, select) {
        const isOpen = openState && openState.select === select;
        const key = event.key;
        if (!isOpen && (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp')) {
            event.preventDefault();
            openMenu(select);
            return;
        }
        if (!isOpen) return;
        const count = openState.menu.querySelectorAll('.omni-select-option').length;
        if (key === 'ArrowDown') { event.preventDefault(); setActive(openState.index + 1, true); }
        else if (key === 'ArrowUp') { event.preventDefault(); setActive(openState.index - 1, true); }
        else if (key === 'Home') { event.preventDefault(); setActive(0, true); }
        else if (key === 'End') { event.preventDefault(); setActive(count - 1, true); }
        else if (key === 'Enter' || key === ' ') { event.preventDefault(); choose(openState.index); }
        else if (key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
        else if (key === 'Tab') { closeMenu(false); }
        else if (key.length === 1) {
            clearTimeout(typeTimer);
            typeBuffer += key.toLowerCase();
            typeTimer = setTimeout(() => { typeBuffer = ''; }, 600);
            const items = Array.from(openState.menu.querySelectorAll('.omni-select-option-label'));
            const match = items.findIndex(l => l.textContent.toLowerCase().startsWith(typeBuffer));
            if (match >= 0) setActive(match, true);
        }
    }

    function enhance(select) {
        if (enhanced.has(select) || select.multiple || select.size > 1 || select.matches('.mu-select, [data-native-select]')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'omni-select-button';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        const label = document.createElement('span');
        label.className = 'omni-select-label';
        const chevron = document.createElement('icon');
        chevron.className = 'omni-select-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = 'expand_more';
        button.append(label, chevron);
        // Carry over the accessible name.
        const id = select.id;
        const labelEl = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : select.closest('label');
        if (select.getAttribute('aria-label')) button.setAttribute('aria-label', select.getAttribute('aria-label'));
        else if (labelEl) {
            if (!labelEl.id) labelEl.id = 'omniSelectLabel' + (++uid);
            button.setAttribute('aria-labelledby', labelEl.id);
        }
        // Keep layout hints from the original element.
        if (select.style.width) button.style.width = select.style.width;
        if (select.style.minWidth) button.style.minWidth = select.style.minWidth;
        if (select.style.maxWidth) button.style.maxWidth = select.style.maxWidth;
        select.classList.add('omni-select-native');
        select.setAttribute('tabindex', '-1');
        select.setAttribute('aria-hidden', 'true');
        select.after(button);
        enhanced.set(select, { button, label });
        button.addEventListener('click', () => openMenu(select));
        button.addEventListener('keydown', event => onButtonKey(event, select));
        select.addEventListener('change', () => syncLabel(select));
        // Clicking the original <label> should focus the new control.
        if (labelEl) labelEl.addEventListener('click', event => { if (event.target === labelEl) { event.preventDefault(); button.focus(); } });
        syncLabel(select);
    }

    // Keep the label right when code sets .value / .selectedIndex directly.
    ['value', 'selectedIndex'].forEach(prop => {
        const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
        if (!desc || !desc.set) return;
        Object.defineProperty(HTMLSelectElement.prototype, prop, Object.assign({}, desc, {
            set(value) {
                desc.set.call(this, value);
                if (enhanced.has(this)) syncLabel(this);
            }
        }));
    });

    function scan(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.tagName === 'SELECT') enhance(root);
        root.querySelectorAll && root.querySelectorAll('select').forEach(enhance);
    }

    function start() {
        scan(document.body);
        new MutationObserver(records => {
            records.forEach(record => {
                record.addedNodes.forEach(node => scan(node));
                // Options added or removed later: refresh the label.
                if (record.target && record.target.tagName === 'SELECT') syncLabel(record.target);
                else if (record.target && record.target.parentElement && record.target.parentElement.tagName === 'SELECT') syncLabel(record.target.parentElement);
            });
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.OmniSelect = Object.freeze({ enhance, refresh: syncLabel, close: () => closeMenu(false) });
})();
