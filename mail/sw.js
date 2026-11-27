// Munetios Mail service worker. It caches only the public application shell (HTML, CSS, scripts, fonts) so Mail
// opens offline. It never caches /api responses, attachments, or anything containing mailbox data; offline mail is
// kept encrypted in IndexedDB by the page and cleared when the account signs out.
const CACHE = "munetios-mail-shell-v9";
const SHELL = [
    "/mail/", "/mail/mail.css", "/mail/manifest.json", "/munetios-ui/munetios-ui-v4.css", "/munetios-ui/munetios-ui-v4.js", "/account/account-menu.css", "/account/account-i18n.js",
    "/account/account-core.js", "/account/account-menu.js", "/account/workspace-scope.js", "/shared/munetios-locales.js", "/shared/cloud-i18n.js", "/shared/munetios-cloud.js", "/mail/strings.js",
    "/mail/i18n/core.js", "/mail/i18n/fr.js", "/mail/i18n/es.js", "/mail/i18n/de.js", "/mail/i18n/it.js", "/mail/i18n/pt.js", "/mail/i18n/zh.js", "/mail/i18n/ko.js", "/mail/i18n/ar.js",
    "/mail/i18n/hi.js", "/mail/js/app.js", "/mail/js/api.js", "/mail/js/state.js", "/mail/js/i18n.js", "/mail/js/ui.js", "/mail/js/theme-schema.js", "/mail/js/customize.js",
    "/mail/js/list.js", "/mail/js/reader.js", "/mail/js/sidebar.js", "/mail/js/actions.js", "/mail/js/sync.js", "/mail/js/offline.js", "/mail/js/search.js", "/mail/js/render-email.js",
    "/mail/js/compose.js", "/mail/js/editor.js", "/mail/js/code-editor.js", "/mail/js/designer.js", "/mail/js/html-tools.js", "/mail/js/photos-picker.js", "/mail/js/settings.js",
    "/mail/js/studio.js", "/mail/js/storage-view.js", "/fonts/google-sans-flex/munetios-ui-v4-font.ttf",
];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => Promise.all(SHELL.map(url => cache.add(new Request(url, { credentials: "same-origin" })).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("munetios-mail") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== location.origin) return;
    if (url.pathname.startsWith("/api/")) return; // mailbox data is never handled here
    if (!SHELL.includes(url.pathname) && !(url.pathname === "/mail/index.html")) return;
    // Network first so updates arrive immediately; the cached shell is the offline fallback.
    event.respondWith(fetch(event.request).then(response => {
        if (response.ok && response.type === "basic" && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
    }).catch(() => caches.match(event.request).then(hit => hit || caches.match("/mail/"))));
});
