const CACHE_NAME = "omniwrite-cache-v99";

// Every local path is resolved against the service worker's own scope, so
// OmniWrite works the same at a domain root (write.munetios.com/) and inside
// a folder (localhost:3000/omniwrite/).
const SCOPE = self.registration.scope;
const scoped = (path) => new URL(path, SCOPE).href;
const INDEX_URL = scoped("index.html");
const SHEETS_URL = scoped("sheets/index.html");
// Each app falls back to its own page: OmniWrite to index.html, Sheets to sheets/index.html.
const isSheetsUrl = (url) => new URL(url).href.startsWith(scoped("sheets"));

const urlsToCache = [
  scoped("./"),
  INDEX_URL,
  new URL("../munetios-ui/munetios-ui-v4.css", SCOPE).href,
  new URL("../munetios-ui/media-player-styles.js", SCOPE).href,
  new URL("../munetios-ui/youtube-i18n.js", SCOPE).href,
  new URL("../munetios-ui/youtube-player.js", SCOPE).href,

  scoped("favicon.ico"),
  scoped("site.webmanifest?v=2"),
  scoped("android-chrome-192x192.png?v=2"),
  scoped("android-chrome-512x512.png?v=2"),
  scoped("apple-touch-icon.png?v=2"),
  scoped("favicon-16x16.png"),
  scoped("favicon-32x32.png"),
  scoped("omniwrite.css"),
  scoped("omniwrite-late.css"),
  scoped("omniwrite-v4.css"),
  scoped("omniwrite-v4.js"),
  scoped("lazy-dom.js"),
  scoped("font-settings.js"),
  scoped("mobile-layout.css"),
  scoped("mobile-layout.js"),
  scoped("account-link.js"),
  scoped("local-signin.js"),
  scoped("spellcheck.js"),
  scoped("dictionary.js"),
  scoped("spellcheck-en.txt"),
  new URL("../signin/translations.js", SCOPE).href,
  scoped("video-player.js"),
  scoped("media-sync.js"),
  scoped("omni-ui.js"),
  scoped("omni-select.js"),
  scoped("formatting.js"),
  scoped("panel-resize.js"),
  scoped("icon-picker.js"),
  scoped("command-palette.js"),
  scoped("native-files.js"),
  scoped("collab.js"),
  scoped("material-symbols.json"),

  // English and the language list; other languages are cached when first used.
  scoped("languages/index.json"),
  scoped("languages/en.json"),
  scoped("languages/pt.json"),
  scoped("languages/pt-BR.json"),
  scoped("languages/pt-PT.json"),

  // Sheets runs inside OmniWrite; sheets/ only forwards old links.
  scoped("sheets/"),
  SHEETS_URL,
  scoped("sheets/redirect.js"),
  scoped("sheets/site.webmanifest"),
  scoped("sheets/sheets.css"),
  scoped("sheets/sheets-shell.css"),
  scoped("sheets-favicon.ico"),
  scoped("sheets-apple-touch-icon.png"),
  scoped("sheets-android-chrome-192x192.png"),
  scoped("sheets/sheets-engine.js"),
  scoped("sheets/sheets-files.js"),
  scoped("sheets/sheets.js"),
  new URL("../munetios-ui/munetios-ui-v4.js", SCOPE).href,
  new URL("../account/account-menu.css", SCOPE).href,
  new URL("../account/account-i18n.js", SCOPE).href,
  new URL("../account/account-core.js", SCOPE).href,
  new URL("../account/account-menu.js", SCOPE).href,
  "https://write.munetios.com/chart.js",

  "https://api.munetios.com/beautiful-css/beautiful.css",

  "https://api.munetios.com/fonts/google-sans-flex/googlesansflex.ttf",
  "https://api.munetios.com/fonts/material-symbols/MaterialSymbolsRounded-VariableFont_FILL,GRAD,opsz,wght.ttf",
  "https://api.munetios.com/fonts/inter/inter.ttf",
  "https://api.munetios.com/fonts/open-sans/opensans.ttf",
  "https://api.munetios.com/fonts/roboto/roboto.ttf",
  "https://api.munetios.com/fonts/google-sans/googlesans.ttf",
  "https://api.munetios.com/fonts/lexend/lexend.ttf",
  "https://api.munetios.com/fonts/poppins/Poppins-Regular.ttf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache each asset on its own so one missing file does not discard the rest.
      const results = await Promise.allSettled(
        urlsToCache.map((url) => cache.add(url)),
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed) {
        console.warn("OmniWrite: " + failed + " optional assets were not cached.");
      }
    }),
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            // Only clear older OmniWrite caches; other apps on this origin keep theirs.
            .filter((cacheName) => cacheName.startsWith("omniwrite-cache-") && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        );
      }),
      self.clients.claim(),
    ]),
  );
});

async function offlineDocument(request) {
  return (
    (await caches.match(request, { ignoreSearch: true })) ||
    (await caches.match(isSheetsUrl(request.url) ? SHEETS_URL : INDEX_URL)) ||
    (await caches.match(isSheetsUrl(request.url) ? scoped("sheets/") : scoped("./"))) ||
    new Response("Offline", { status: 503, statusText: "Service Unavailable" })
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  if (
    event.request.mode === "navigate" ||
    event.request.destination === "document"
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            const appClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
              // Refresh the offline copy of the app that was opened, never the other app's page.
              cache.put(isSheetsUrl(event.request.url) ? SHEETS_URL : INDEX_URL, appClone);
            });
          }
          return networkResponse;
        })
        .catch(() => offlineDocument(event.request)),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type !== "opaque"
        ) {
          const responseClone = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }

        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);

        if (cachedResponse) {
          return cachedResponse;
        }

        return new Response("Offline", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }),
  );
});
