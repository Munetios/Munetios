import photosRoutes from './assets/photos/routes.js';

const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const appRoots = new Map([
    ['write.munetios.com', '/omniwrite'],
    ['accounts.munetios.com', '/signin'],
    ['photos.munetios.com', '/photos'],
]);
const sharedAssets = /^\/(?:signin|omniwrite|account|fonts|munetios-ui|shared|blocked|mail|photos|webfilter)(?:\/|$)|^\/(?:tone\.js|ganetios-logo-icon\.png|404(?:\.html|\.css|-i18n\.js)?)$/;

function unavailable(isApi) {
    if (isApi) return Response.json({ error: 'unavailable' }, { status: 503, headers: noStore });
    return new Response('The Munetios account server is unavailable.', { status: 503, headers: noStore });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        let pathname;
        try {
            const canonical = new URL(url.origin);
            canonical.pathname = decodeURIComponent(url.pathname).replaceAll('\\', '/').replace(/\/{2,}/g, '/');
            pathname = canonical.pathname;
        } catch {
            return new Response('Bad request', { status: 400, headers: noStore });
        }
        const isApi = /^\/api(?:\/|$)/i.test(pathname);
        const isProtectedPage = /^\/(?:account|mail|webfilter)(?:\/index\.html|\/)?$/i.test(pathname);
        if (!isApi && !isProtectedPage) {
            const root = appRoots.get(url.hostname);
            const target = new URL(request.url);
            if (photosRoutes.pathPattern.test(pathname) && ['GET', 'HEAD'].includes(request.method)) target.pathname = '/photos/';
            else if (root && !sharedAssets.test(pathname)) target.pathname = root + (pathname === '/index.html' ? '/' : pathname);
            const asset = await env.ASSETS.fetch(target.href === request.url ? request : new Request(target, request));
            if (asset.status !== 404 || !['GET', 'HEAD'].includes(request.method)) return asset;
            const accept = request.headers.get('Accept');
            const destination = request.headers.get('Sec-Fetch-Dest');
            if ((accept && !accept.includes('text/html') && !accept.includes('*/*')) ||
                (destination && destination !== 'document' && destination !== 'iframe')) return asset;
            const page = await env.ASSETS.fetch(new URL('/404', url), { method: request.method });
            if (!page.ok) return asset;
            const response = new Response(page.body, { status: 404, headers: page.headers });
            response.headers.set('Cache-Control', 'no-store, no-transform');
            return response;
        }
        try {
            const upstream = await env.BETA_BACKEND.fetch(request);
            const response = new Response(upstream.body, upstream);
            response.headers.set('X-Munetios-Backend', 'd1');
            if (response.headers.get('Content-Type')?.startsWith('text/html')) {
                response.headers.append('Cache-Control', 'no-transform');
            }
            return response;
        } catch {
            return unavailable(isApi);
        }
    },
};
