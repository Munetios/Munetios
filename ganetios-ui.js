(() => {
    'use strict';
    const root = document.documentElement;
    const dialogSelector = '.modal, .settings-modal, .confirm-modal, .captcha-modal-overlay, .bookmarks-overlay, .apps-wrapper, .video-player-dialog, #videoCloseConfirm';
    const mappings = [
        ['.liquid-glass', 'mu-glass'],
        ['.dropdown-wrapper, .dropdown-menu', 'mu-menu'],
        ['.dropdown-item, .dropdown-option', 'mu-menu-item'],
        ['.settings-sidebar-item, .left-sidebar .sidebar-item', 'mu-nav-item'],
        ['.button-groups', 'mu-segmented'],
        ['.settings-page input[type="text"], .settings-page input[type="url"], .settings-page input[type="number"], .modal-content input[type="text"], .modal-content input[type="url"], .modal-content input[type="number"], .url-input, .captcha-input', 'mu-input'],
        ['.topbar-left-item > a[href^="#/"]', 'mu-nav-item mu-nav-inline'],
        ['.search-bar, .videos-searchbar, .wiki-searchbar, .books-searchbar, .news-searchbar, .map-searchbar, .bookmarks-searchbar', 'mu-search'],
        ['.topbar-container .apps-btn, #labsLinkDesktop', 'mu-icon-btn'],
        ['.search-bar > icon[role="button"]', 'mu-icon-btn mu-icon-inline'],
        ['.search-button, .voice-mode-btn, .modal-button, .action-button, .settings-item > button, .confirm-btn, .cancel-btn, .book-action-btn, .captcha-submit, .page-block-btn, .account-sign-in, #bgImageUploadBtn, #bgImageClearBtn, #fontFamilyButton, #detectLocalFontsBtn', 'mu-btn'],
        ['#doSearch, .account-sign-in, .modal-button.confirm, .confirm-btn, .captcha-submit', 'mu-btn-primary'],
        ['.action-button.danger', 'mu-btn-danger-outline'],
        ['#videoCloseConfirm button', 'mu-btn'],
        ['#videoCloseConfirm [data-close-confirm]', 'mu-btn-primary'],
        ['.settings-modal-close, #captchaClose, #closeVoiceMode, #closeAppsWrapper, #bookmarksCloseBtn', 'mu-icon-btn']
    ];
    function enhance(node) {
        if (!(node instanceof Element)) return;
        for (const [selector, className] of mappings) {
            if (node.matches(selector)) node.classList.add(...className.split(' '));
            node.querySelectorAll(selector).forEach(element => element.classList.add(...className.split(' ')));
        }
        const selects = [...(node.matches('select') ? [node] : []), ...node.querySelectorAll('select')];
        selects.forEach(select => { select.classList.add('mu-select'); window.MunetiosUI?.enhanceSelect(select); });
        const dialogs = [...(node.matches(dialogSelector) ? [node] : []), ...node.querySelectorAll(dialogSelector)];
        dialogs.forEach(dialog => {
            const panel = dialog.querySelector(':scope > .modal-content, :scope > .settings-modal-content, :scope > .confirm-modal-content, :scope > .wiki-read-modal, :scope > .captcha-modal, :scope > .bookmarks-panel, :scope > .apps-container, :scope > .video-player-panel, :scope > .advanced-modal-card, :scope > section');
            if (!panel) return;
            panel.classList.add('mu-dialog-surface');
            window.MunetiosUI?.enhanceDialogLayer(dialog);
        });
    }
    function syncNavigation() {
        document.querySelectorAll('.topbar-left-item > a.mu-nav-inline').forEach(link => {
            if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        document.querySelectorAll('.settings-sidebar-item.mu-nav-item').forEach(item => {
            if (item.classList.contains('active')) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
    }
    function syncTheme() {
        const theme = root.getAttribute('data-theme');
        const mode = theme === 'light-mode' ? 'light' : 'dark';
        if (root.getAttribute('data-mu-theme') !== mode) root.setAttribute('data-mu-theme', mode);
    }
    /* Toasts: route Ganetios' showToast through the v4 toast (top center by
       default, newest on top, close button only for longer-than-normal
       toasts). The saved toast color and position (Appearance) still apply. */
    const GANETIOS_DEFAULT_DURATION = 3000;
    const DEFAULT_TOAST_COLOR = '#6a00ff';
    const ERROR_PATTERN = /\b(fail(ed|ure)?|error|unable|could ?n[o']t|invalid|denied|not supported|unavailable)\b/i;
    const readSetting = key => { try { return localStorage.getItem(key); } catch { return null; } };
    function showToast(message, duration = GANETIOS_DEFAULT_DURATION, type) {
        const text = String(message ?? '');
        if (!window.MunetiosUI?.toast) return null;
        const longer = typeof duration === 'number' && duration > GANETIOS_DEFAULT_DURATION;
        const toast = window.MunetiosUI.toast(text, {
            duration: longer ? duration : undefined,
            type: type || (ERROR_PATTERN.test(text) ? 'error' : 'info')
        });
        const color = readSetting('munetiosToastColor');
        if (color && color.toLowerCase() !== DEFAULT_TOAST_COLOR) {
            toast.classList.add('g-tinted');
            toast.style.setProperty('--g-toast', color);
        }
        const position = readSetting('munetiosToastPosition') || 'top-center';
        const stack = toast.parentElement;
        if (stack) {
            if (position === 'top-center') stack.removeAttribute('data-g-position');
            else stack.setAttribute('data-g-position', position);
        }
        return toast;
    }
    window.showToast = showToast;

    /* Account sync: settings, appearance, history, shortcuts and favorites from
       another device (or another account after switching) apply on the next
       load, so reload once when they change. Never more than once per 20 s. */
    document.addEventListener('munetios-sync-applied', event => {
        const relevant = event.detail.providers.some(id => id.startsWith('ls:') && id !== 'ls:workspaces');
        if (!relevant) return;
        // Never interrupt typing; the changes are already saved and apply on the next visit.
        if (document.activeElement?.matches('input, textarea, [contenteditable="true"]')) return;
        let last = 0;
        try { last = Number(sessionStorage.getItem('ganetios-sync-reload')) || 0; } catch {}
        if (Date.now() - last < 20000) return;
        try { sessionStorage.setItem('ganetios-sync-reload', String(Date.now())); } catch {}
        location.reload();
    });

    function start() {
        document.body.classList.add('ganetios-v4');
        syncTheme();
        enhance(document.body);
        syncNavigation();
        window.addEventListener('hashchange', syncNavigation);
        new MutationObserver(records => {
            const nodes = new Set();
            for (const record of records) {
                if (record.type === 'attributes') {
                    if (record.target.matches('.settings-sidebar-item, .topbar-left-item > a')) syncNavigation();
                    continue;
                }
                for (const node of record.addedNodes) if (node instanceof Element && node.isConnected) nodes.add(node);
            }
            for (const node of nodes) if (![...nodes].some(parent => parent !== node && parent.contains(node))) enhance(node);
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-mu-theme', 'style'] });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
