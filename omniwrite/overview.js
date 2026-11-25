(() => {
    'use strict';
    const signIn = document.getElementById('overviewSignIn');
    const appPath = new URL('./', location.href).pathname;
    signIn.href = '/signin?' + new URLSearchParams({ continue: appPath });

    let preference;
    try { preference = localStorage.getItem('omniwrite-lang'); } catch {}
    const requested = (preference || navigator.language || 'en').replaceAll('_', '-');
    if (/^en(?:-|$)/i.test(requested)) return;

    const directory = '/omniwrite/languages/';
    const read = async name => {
        const result = await fetch(directory + encodeURIComponent(name) + '.json');
        if (!result.ok) throw new Error('Language catalog unavailable');
        return result.json();
    };
    async function translate() {
        const { languages, fallbacks } = await read('index');
        const supported = [...new Set([...languages, ...Object.keys(fallbacks)])];
        const locale = supported.find(code => code.toLowerCase() === requested.toLowerCase())
            || supported.find(code => code === requested.split('-')[0].toLowerCase());
        if (!locale) return;
        const resources = [];
        for (let code = locale; code && code !== 'en'; code = fallbacks[code]) {
            if (languages.includes(code)) resources.unshift(code);
        }
        const messages = Object.assign({}, ...await Promise.all(resources.map(read)));
        for (const node of document.querySelectorAll('[data-i18n]')) {
            const text = messages[node.dataset.i18n];
            if (text) node.textContent = text;
        }
        document.documentElement.lang = locale;
        document.documentElement.dir = /^(ar|fa|he|ur)(-|$)/.test(locale) ? 'rtl' : 'ltr';
    }
    translate().catch(() => {});
})();
