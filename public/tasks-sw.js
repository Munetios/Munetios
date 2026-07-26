const CACHE_VERSION = "v1";
const SHELL_CACHE = `munetios-tasks-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `munetios-tasks-runtime-${CACHE_VERSION}`;
const CACHE_PREFIX = "munetios-tasks-";
const APP_ROUTE = "/apps/tasks";
const BEAUTIFUL_CSS_URL =
  "https://api.munetios.com/beautiful-css/beautiful.css";
const TASKS_LOGO_URL = "https://tasks.munetios.com/apple-touch-icon.png";

const PRECACHE_URLS = [
  APP_ROUTE,
  `${APP_ROUTE}/categories`,
  "/tasks.webmanifest",
  BEAUTIFUL_CSS_URL,
  TASKS_LOGO_URL,
];

const STATIC_DESTINATIONS = new Set([
  "font",
  "image",
  "manifest",
  "script",
  "style",
  "worker",
]);

function isDevelopmentOnlyAsset(url) {
  let pathname = url.pathname.toLowerCase();
  try {
    pathname = decodeURIComponent(pathname);
  } catch {}
  return pathname.includes("hmr-client") || pathname.includes("webpack-hmr");
}

async function cacheResponse(cacheName, request, response) {
  if (!response || (!response.ok && response.type !== "opaque")) {
    return response;
  }
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

function extractAssetUrls(source, baseUrl) {
  const assetUrls = new Set();
  const patterns = [
    /(?:src|href)=["']([^"'#]+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      try {
        const url = new URL(match[1], baseUrl);
        if (isDevelopmentOnlyAsset(url)) continue;
        if (
          url.href === BEAUTIFUL_CSS_URL ||
          url.href === TASKS_LOGO_URL ||
          (url.origin === self.location.origin &&
            (url.pathname.startsWith("/_next/static/") ||
              /\.(?:avif|css|gif|ico|jpe?g|js|json|png|svg|webp|woff2?|ttf|otf)$/i.test(
                url.pathname,
              )))
        ) {
          assetUrls.add(url.href);
        }
      } catch {}
    }
  }
  return assetUrls;
}

async function fetchAndCacheShellAsset(cache, url) {
  const parsedUrl = new URL(url, self.location.origin);
  const crossOrigin = parsedUrl.origin !== self.location.origin;
  const request = new Request(parsedUrl.href, {
    cache: "reload",
    credentials: crossOrigin ? "omit" : "same-origin",
    mode: crossOrigin ? "no-cors" : "cors",
  });
  const response = await fetch(request);

  if (!response.ok && response.type !== "opaque") return new Set();

  let nestedAssets = new Set();
  const contentType = response.headers.get("Content-Type") || "";
  if (
    response.type !== "opaque" &&
    (contentType.includes("text/html") || contentType.includes("text/css"))
  ) {
    nestedAssets = extractAssetUrls(
      await response.clone().text(),
      parsedUrl.href,
    );
  }

  await cache.put(request, response);
  return nestedAssets;
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const results = await Promise.allSettled(
    PRECACHE_URLS.map((url) => fetchAndCacheShellAsset(cache, url)),
  );
  const discoveredAssets = new Set();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const assetUrl of result.value) discoveredAssets.add(assetUrl);
  }

  await Promise.allSettled(
    Array.from(discoveredAssets, (url) => fetchAndCacheShellAsset(cache, url)),
  );
}

async function networkFirst(request, cacheName, fallbackRequest = request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cacheResponse(cacheName, request, response);
    return response.ok ? response : (await cache.match(request)) || response;
  } catch {
    return (
      (await cache.match(request)) ||
      (fallbackRequest ? await cache.match(fallbackRequest) : null) ||
      null
    );
  }
}

async function staleWhileRevalidate(request, event) {
  const cachedResponse = await caches.match(request);
  const networkResponse = fetch(request)
    .then((response) => cacheResponse(RUNTIME_CACHE, request, response))
    .catch(() => null);
  event.waitUntil(networkResponse);
  return cachedResponse || (await networkResponse);
}

function signedOutOfflineResponse() {
  return Response.json({
    authenticated: false,
    offline: true,
    signedIn: false,
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith(CACHE_PREFIX) &&
                ![SHELL_CACHE, RUNTIME_CACHE].includes(cacheName),
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && isDevelopmentOnlyAsset(url)) return;

  if (sameOrigin && url.pathname === "/api/signedin") {
    event.respondWith(fetch(request).catch(() => signedOutOfflineResponse()));
    return;
  }

  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  if (sameOrigin && url.pathname.startsWith("/_next/")) {
    event.respondWith(
      networkFirst(request, RUNTIME_CACHE).then(
        (response) => response || Response.error(),
      ),
    );
    return;
  }

  if (
    request.mode === "navigate" &&
    sameOrigin &&
    url.pathname.startsWith(APP_ROUTE)
  ) {
    event.respondWith(
      networkFirst(request, SHELL_CACHE, APP_ROUTE).then(
        (response) =>
          response ||
          new Response("Munetios Tasks is unavailable offline.", {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            status: 503,
          }),
      ),
    );
    return;
  }

  if (
    STATIC_DESTINATIONS.has(request.destination) ||
    PRECACHE_URLS.includes(sameOrigin ? url.pathname : url.href)
  ) {
    event.respondWith(
      staleWhileRevalidate(request, event).then(
        (response) => response || Response.error(),
      ),
    );
  }
});
