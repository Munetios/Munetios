(() => {
    'use strict';
    // Keep the signed-out account action last in each top-right navbar.
    document.querySelectorAll('.navbar').forEach(navbar => {
        if (navbar.querySelector('[data-munetios-account]')) return;
        let right = navbar.querySelector(':scope > .navbar__right');
        if (!right) {
            right = document.createElement('div');
            right.className = 'navbar__right';
            navbar.appendChild(right);
        }
        const slot = document.createElement('div');
        slot.className = 'munetios-account-slot';
        slot.setAttribute('data-munetios-account', '');
        const link = document.createElement('a');
        link.href = '/signin?continue=' + encodeURIComponent(location.pathname + location.search + location.hash);
        link.className = 'account-sign-in liquid-glass';
        link.dataset.i18n = 'auth_sign_in';
        const label = typeof _t === 'function' ? _t('auth_sign_in') : '';
        link.textContent = label && label !== 'auth_sign_in' ? label : 'Sign in';
        slot.appendChild(link);
        right.appendChild(slot);
        new MutationObserver(() => {
            if (right.lastElementChild !== slot) right.appendChild(slot);
        }).observe(right, { childList: true });
    });
    // The account menu uses Munetios UI v4 tokens: follow OmniWrite's light/dark mode.
    const root = document.documentElement;
    const systemLight = matchMedia('(prefers-color-scheme: light)');
    const syncTheme = () => {
        const preference = document.body.dataset.omniTheme || 'system';
        const mode = preference === 'light' || (preference === 'system' && systemLight.matches) ? 'light' : 'dark';
        if (root.getAttribute('data-mu-theme') !== mode) root.setAttribute('data-mu-theme', mode);
    };
    syncTheme();
    systemLight.addEventListener('change', syncTheme);
    new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['data-omni-theme'] });
    new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-mu-theme'] });
    window.MunetiosAccountMenu?.render();
})();
