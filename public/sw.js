const CACHE_VERSION = "v7";
const SHELL_CACHE = `munetios-omniwrite-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `munetios-omniwrite-runtime-${CACHE_VERSION}`;
const ACCOUNT_CACHE = `munetios-omniwrite-account-${CACHE_VERSION}`;
const CACHE_PREFIX = "munetios-omniwrite-";
const APP_ROUTE = "/apps/omniwrite";
const BEAUTIFUL_CSS_URL =
  "https://api.munetios.com/beautiful-css/beautiful.css";

const PRECACHE_URLS = [
  APP_ROUTE,
  "/omniwrite.webmanifest",
  "/omniwrite.png",
  "/omniwrite-192.png",
  "/omniwrite-512.png",
  "/omniwrite-maskable-192.png",
  "/omniwrite-maskable-512.png",
  "/ai.png",
  "/feedbacksubmitted.png",
  "/favicon.ico",
  BEAUTIFUL_CSS_URL,
];

const OFFLINE_API_PATHS = new Set(["/api/account", "/api/signedin"]);
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
        const isSameOrigin = url.origin === self.location.origin;
        const isBeautifulCss = url.href === BEAUTIFUL_CSS_URL;

        if (isDevelopmentOnlyAsset(url)) {
          continue;
        }

        if (
          isBeautifulCss ||
          (isSameOrigin &&
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

  if (!response.ok && response.type !== "opaque") {
    return new Set();
  }

  let nestedAssets = new Set();
  const contentType = response.headers.get("Content-Type") || "";
  if (
    response.type !== "opaque" &&
    (contentType.includes("text/html") || contentType.includes("text/css"))
  ) {
    const source = await response.clone().text();
    nestedAssets = extractAssetUrls(source, parsedUrl.href);
  }

  await cache.put(request, response);
  return nestedAssets;
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const discoveredAssets = new Set();
  const initialResults = await Promise.allSettled(
    PRECACHE_URLS.map((url) => fetchAndCacheShellAsset(cache, url)),
  );

  for (const result of initialResults) {
    if (result.status === "fulfilled") {
      for (const assetUrl of result.value) {
        discoveredAssets.add(assetUrl);
      }
    }
  }

  const nestedResults = await Promise.allSettled(
    Array.from(discoveredAssets, (url) => fetchAndCacheShellAsset(cache, url)),
  );

  const secondLevelAssets = new Set();
  for (const result of nestedResults) {
    if (result.status === "fulfilled") {
      for (const assetUrl of result.value) {
        secondLevelAssets.add(assetUrl);
      }
    }
  }

  await Promise.allSettled(
    Array.from(secondLevelAssets, (url) => fetchAndCacheShellAsset(cache, url)),
  );
}

async function networkFirst(request, cacheName, fallbackRequest = request) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);

    if (response.ok) {
      await cacheResponse(cacheName, request, response);
    } else if (cacheName === ACCOUNT_CACHE) {
      await cache.delete(request);
    }

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

function offlineApiResponse() {
  return Response.json(
    {
      authenticated: false,
      offline: true,
      signedIn: false,
    },
    {
      headers: { "Content-Type": "application/json; charset=utf-8" },
      status: 503,
    },
  );
}

function offlineDevelopmentScriptResponse() {
  return new Response("/* Development-only script disabled offline. */", {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/javascript; charset=utf-8",
    },
    status: 200,
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
                ![SHELL_CACHE, RUNTIME_CACHE, ACCOUNT_CACHE].includes(
                  cacheName,
                ),
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isNextAsset = sameOrigin && url.pathname.startsWith("/_next/");

  if (sameOrigin && isDevelopmentOnlyAsset(url)) {
    event.respondWith(
      fetch(request).catch(() => offlineDevelopmentScriptResponse()),
    );
    return;
  }

  if (isNextAsset) {
    event.respondWith(
      networkFirst(request, RUNTIME_CACHE).then(
        (response) => response || Response.error(),
      ),
    );
    return;
  }

  if (sameOrigin && OFFLINE_API_PATHS.has(url.pathname)) {
    event.respondWith(
      networkFirst(request, ACCOUNT_CACHE).then(
        (response) => response || offlineApiResponse(),
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
          new Response("OmniWrite is unavailable offline.", {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            status: 503,
          }),
      ),
    );
    return;
  }

  const isBeautifulCss = url.href === BEAUTIFUL_CSS_URL;
  const isKnownAsset = PRECACHE_URLS.includes(
    sameOrigin ? url.pathname : url.href,
  );
  const isStaticAsset =
    STATIC_DESTINATIONS.has(request.destination) ||
    isBeautifulCss ||
    isKnownAsset;

  if (isStaticAsset) {
    event.respondWith(
      staleWhileRevalidate(request, event).then(
        (response) => response || Response.error(),
      ),
    );
  }
});
