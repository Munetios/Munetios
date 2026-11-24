/* Shared service-worker shell for the local-first apps. */
(() => {
  const scope = new URL(self.registration.scope);
  const resolve = (path) => new URL(path, scope).href;
  const staticAsset = /\.(?:css|js|json|webmanifest|woff2?|ttf|ico|png|svg|txt)$/i;

  self.installMunetiosOfflineShell = ({ cacheName, obsolete, required, optional = [], documentFor }) => {
    const external = new Set(optional.map(resolve).filter((href) => new URL(href).origin !== scope.origin));
    self.addEventListener("install", (event) => {
      event.waitUntil((async () => {
        const cache = await caches.open(cacheName);
        await cache.addAll(required.map((path) => new Request(resolve(path), { cache: "reload" })));
        await Promise.allSettled(optional.map((path) => cache.add(new Request(resolve(path), { signal: AbortSignal.timeout(8000) }))));
        await self.skipWaiting();
      })());
    });
    self.addEventListener("activate", (event) => {
      event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name !== cacheName && obsolete(name)).map((name) => caches.delete(name)));
        await self.clients.claim();
      })());
    });
    self.addEventListener("fetch", (event) => {
      const { request } = event;
      if (request.method !== "GET" || request.headers.has("range")) return;
      const url = new URL(request.url);
      const sameOrigin = url.origin === scope.origin;
      if (sameOrigin && /^\/(?:api|cdn-cgi)(?:\/|$)/i.test(url.pathname)) return;
      const navigation = request.mode === "navigate" || request.destination === "document";
      const fallback = navigation && sameOrigin && documentFor(url.pathname);
      if (navigation ? !fallback : !(sameOrigin ? staticAsset.test(url.pathname) : external.has(url.href))) return;
      event.respondWith((async () => {
        const cache = await caches.open(cacheName);
        const cached = await cache.match(fallback ? resolve(fallback) : request);
        try {
          const response = cached ? await fetch(request, { signal: AbortSignal.timeout(2500) }) : await fetch(request);
          if (response.status >= 500 && cached) return cached;
          const html = (response.headers.get("content-type") || "").includes("text/html");
          const canonical = fallback && !url.search && url.href === resolve(fallback);
          if (response.ok && response.type !== "opaque" && (canonical ? html : !navigation && !html)) {
            await cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        } catch {
          return cached || Response.error();
        }
      })());
    });
  };
})();
