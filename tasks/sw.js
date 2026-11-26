const CACHE_NAME = "munetios-tasks-v7";
const localAssets = [
  "./index.html", "./manifest.webmanifest", "./favicon.ico", "./favicon-16x16.png",
  "./favicon-32x32.png", "./android-chrome-192x192.png", "./android-chrome-512x512.png",
  "./apple-touch-icon.png", "./tasks-sync.js", "./tasks-account-i18n.js",
  "./tasks.css", "./tasks-features.css", "./tasks-features.js", "./tasks-features-i18n.js", "./tasks-locales.js", "/shared/munetios-locales.js",
  "/munetios-ui/munetios-ui-v4.css", "/munetios-ui/munetios-ui-v4.js",
  "/account/account-menu.css", "/account/account-i18n.js", "/account/account-core.js", "/account/account-menu.js",
  "/fonts/google-sans-flex/munetios-ui-v4-font.ttf",
].map((path) => new URL(path, self.registration.scope).href);
const optionalAssets = [
  "https://api.munetios.com/beautiful-css/beautiful.css",
  "/fonts/google-sans-flex/googlesansflex.ttf",
  "https://api.munetios.com/fonts/material-symbols/MaterialSymbolsRounded-VariableFont_FILL,GRAD,opsz,wght.ttf",
  "https://api.munetios.com/fonts/inter/inter.ttf",
  "https://api.munetios.com/fonts/open-sans/opensans.ttf",
  "https://api.munetios.com/fonts/roboto/roboto.ttf",
  "https://api.munetios.com/fonts/google-sans/googlesans.ttf",
  "https://api.munetios.com/fonts/lexend/lexend.ttf",
  "https://api.munetios.com/fonts/poppins/Poppins-Regular.ttf",
];
const assets = new Set([...localAssets, ...optionalAssets]);
const home = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(localAssets);
    await Promise.allSettled(optionalAssets.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("munetios-tasks-") && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.mode === "navigate" && request.url.startsWith(self.registration.scope)) {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE_NAME)).match(home)));
    return;
  }
  if (!assets.has(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    return cached || fetch(request);
  })());
});
