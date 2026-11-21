(() => {
    'use strict';
    const viewport = window.visualViewport;
    const mobile = window.matchMedia('(max-width: 760px)');
    const toolbar = document.querySelector('#editorContent .toolbar');
    const bottom = document.getElementById('mobileEditorToolbar');
    const voice = document.getElementById('voiceTypingBtn');
    const primary = new Set(['fontStylesBtn', 'fontFamilyBtn', 'fontSizeDecreaseBtn', 'fontSizeBtn', 'fontSizeIncreaseBtn', 'undoBtn', 'redoBtn', 'moreItemGroupMobileBtn']);
    const quick = new Set(['boldBtn', 'italicBtn', 'underlineBtn', 'textColorBtn', 'listGroupBtn', 'alignGroupBtn']);
    const moreTools = document.createElement('div');
    moreTools.id = 'mobileEditorMoreTools';
    moreTools.hidden = true;
    bottom?.after(moreTools);
    const toolsButton = document.createElement('button');
    toolsButton.id = 'mobileEditorToolsBtn';
    toolsButton.type = 'button';
    toolsButton.className = 'omni-fab-icon';
    toolsButton.setAttribute('aria-haspopup', 'dialog');
    toolsButton.setAttribute('aria-expanded', 'false');
    toolsButton.setAttribute('data-i18n-aria-label', 'mobile_formatting_tools');
    toolsButton.innerHTML = '<icon aria-hidden="true">tune</icon><span data-i18n="mobile_formatting_tools"></span>';
    bottom?.insertBefore(toolsButton, voice);
    let sheet = null;
    const translate = key => typeof _t === 'function' ? _t(key) : key;
    toolsButton.setAttribute('aria-label', translate('mobile_formatting_tools'));
    toolsButton.querySelector('span').textContent = translate('mobile_formatting_tools');

    function closeSheet() {
        if (sheet?.open) sheet.close();
    }
    function openSheet() {
        if (sheet && !sheet.open) {
            sheet.remove();
            sheet = null;
        }
        if (sheet || !mobile.matches) return;
        const editor = typeof getActiveEditorSurface === 'function' ? getActiveEditorSurface() : null;
        const selection = window.getSelection();
        const range = selection?.rangeCount && editor?.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
        if (typeof cacheCurrentEditorSelection === 'function') cacheCurrentEditorSelection();
        const dialog = document.createElement('dialog');
        sheet = dialog;
        dialog.id = 'mobileEditorToolsSheet';
        dialog.className = 'liquid-glass';
        dialog.setAttribute('aria-labelledby', 'mobileEditorToolsTitle');
        const header = document.createElement('header');
        const title = document.createElement('h2');
        title.id = 'mobileEditorToolsTitle';
        title.textContent = translate('mobile_formatting_tools');
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'omni-fab-icon';
        close.setAttribute('aria-label', translate('close'));
        close.innerHTML = '<icon aria-hidden="true">close</icon>';
        close.onclick = closeSheet;
        header.append(title, close);
        const list = document.createElement('div');
        list.className = 'mobile-editor-tools-list';
        const controls = [...moreTools.querySelectorAll(':scope > .toolbar-item, :scope > button')];
        const seen = new Set();
        for (const control of controls) {
            if (seen.has(control.id) || primary.has(control.id) || quick.has(control.id) || control.style.display === 'none') continue;
            seen.add(control.id);
            const proxy = document.createElement('button');
            proxy.type = 'button';
            proxy.className = 'dropdown-item';
            proxy.dataset.mobileTool = control.id;
            const icon = document.createElement('icon');
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = control.querySelector('icon')?.textContent.trim() || 'tune';
            const label = document.createElement('span');
            label.textContent = control.id === 'virtualKeyboardBtn' ? translate('virtual_keyboard') : control.id === 'emojiPickerBtn' ? translate('insert_emoji') : getToolbarOverflowItemLabel(control);
            proxy.append(icon, label);
            proxy.onclick = () => {
                const rect = proxy.getBoundingClientRect();
                const anchor = document.createElement('span');
                anchor.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;`;
                document.body.appendChild(anchor);
                closeSheet();
                if (editor?.isConnected) {
                    editor.focus({ preventScroll: true });
                    if (range && editor.contains(range.commonAncestorContainer)) {
                        const current = window.getSelection();
                        current.removeAllRanges();
                        current.addRange(range);
                    }
                }
                triggerToolbarOverflowItem(control, anchor);
                setTimeout(() => anchor.remove(), 250);
            };
            list.appendChild(proxy);
        }
        dialog.append(header, list);
        dialog.addEventListener('close', () => {
            toolsButton.setAttribute('aria-expanded', 'false');
            dialog.remove();
            if (sheet === dialog) sheet = null;
        }, { once: true });
        dialog.addEventListener('click', event => {
            if (event.target !== dialog) return;
            const rect = dialog.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSheet();
        });
        document.body.appendChild(dialog);
        toolsButton.setAttribute('aria-expanded', 'true');
        dialog.showModal();
    }
    toolsButton.addEventListener('pointerdown', event => {
        if (event.button === 0) event.preventDefault();
    });
    toolsButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openSheet();
    }, true);
    let frame = 0;
    function updateHeight() {
        frame = 0;
        if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
        const height = viewport ? viewport.height : window.innerHeight;
        const top = viewport ? viewport.offsetTop : 0;
        document.documentElement.style.setProperty('--omni-mobile-height', height + 'px');
        document.documentElement.style.setProperty('--omni-mobile-bottom', Math.max(0, window.innerHeight - height - top) + 'px');
    }
    function schedule() {
        if (!frame) frame = requestAnimationFrame(updateHeight);
    }
    function layoutTools() {
        if (!toolbar || !bottom) return;
        if (mobile.matches) {
            for (const item of [...toolbar.children, ...bottom.querySelectorAll(':scope > .toolbar-item')]) {
                if (!item.classList.contains('toolbar-item') || primary.has(item.id)) continue;
                if (quick.has(item.id)) bottom.insertBefore(item, toolsButton);
                else moreTools.appendChild(item);
            }
            for (const id of ['virtualKeyboardBtn', 'emojiPickerBtn']) {
                const item = document.getElementById(id);
                if (item) moreTools.appendChild(item);
            }
            bottom.appendChild(voice);
        } else {
            closeSheet();
            const items = [...bottom.querySelectorAll(':scope > .toolbar-item'), ...moreTools.querySelectorAll(':scope > .toolbar-item')];
            items.forEach(item => toolbar.appendChild(item));
            if (items.length && typeof applyToolbarCustomization === 'function') applyToolbarCustomization();
        }
        schedule();
    }
    document.addEventListener('omni-toolbar-layout', layoutTools);
    new MutationObserver(() => {
        if (!document.getElementById('editorContent')?.classList.contains('active')) closeSheet();
    }).observe(document.getElementById('editorContent'), { attributes: true, attributeFilter: ['class'] });
    mobile.addEventListener('change', layoutTools);
    viewport?.addEventListener('resize', schedule, { passive: true });
    viewport?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    if (bottom && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
            document.documentElement.style.setProperty('--omni-mobile-tools-height', bottom.getBoundingClientRect().height + 'px');
        }).observe(bottom);
    }
    document.addEventListener('keydown', event => {
        if (mobile.matches || event.repeat || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'd') return;
        const editor = event.target.closest?.('.document-page-editor, .split-editor');
        if (!editor || !editor.isContentEditable || !document.getElementById('editorContent')?.classList.contains('active')) return;
        event.preventDefault();
        event.stopPropagation();
        markEditorActive(editor);
        toggleVoiceTyping();
    }, true);
    layoutTools();
    updateHeight();
})();
