import { DurableObject } from 'cloudflare:workers';
import photosRoutes from './assets/photos/routes.js';
import { takeWeatherRequest, weatherApiPath, weatherResponse, weatherWindowMs } from './weather-api.mjs';

const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const appRoots = new Map([
    ['write.munetios.com', '/omniwrite'],
    ['accounts.munetios.com', '/signin'],
    ['calendar.munetios.com', '/calendar'],
    ['photos.munetios.com', '/photos'],
    ['notes.munetios.com', '/supanotes'],
    ['tasks.munetios.com', '/tasks'],
]);
const sharedAssets = /^\/(?:signin|omniwrite|account|fonts|munetios-ui|shared|blocked|mail|calendar|photos|webfilter)(?:\/|$)|^\/(?:tone\.js|ganetios-logo-icon\.png|munetios-logo(?:-icon)?\.png|404(?:\.html|\.css|-i18n\.js)?)$/;
const weatherAssets = /^\/(?:weather|fonts|munetios-ui)(?:\/|$)|^\/404(?:\.html|\.css|-i18n\.js)?$/;
const siteFiles = new Set(['/sitemap.xml', '/robots.txt']);

export class WeatherRateLimiter extends DurableObject {
    async fetch() {
        const storage = this.ctx.storage;
        const timestamps = storage.kv.get('requests') || [];
        const { recent, retryAfter } = takeWeatherRequest(timestamps, Date.now());
        if (recent) {
            storage.kv.put('requests', recent);
            if (!timestamps.length) await storage.setAlarm(recent[0] + weatherWindowMs);
        }
        return Response.json({ retryAfter: retryAfter || 0 });
    }

    async alarm() {
        const storage = this.ctx.storage;
        const timestamps = storage.kv.get('requests') || [];
        const expires = timestamps.at(-1) + weatherWindowMs;
        if (expires > Date.now()) await storage.setAlarm(expires);
        else storage.kv.delete('requests');
    }
}

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
        const isWeather = url.hostname === 'weather.munetios.com';
        const isWebFilter = url.hostname === 'webfilter.munetios.com';
        if ((isWeather || url.hostname === 'beta.munetios.com') && weatherApiPath.test(pathname)) {
            url.pathname = pathname;
            return weatherResponse(url, request.method, async () => {
                const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
                const limiter = env.WEATHER_RATE_LIMITER.getByName(ip);
                const result = await limiter.fetch('https://weather-limiter/take', { method: 'POST' });
                if (!result.ok) throw new Error('Weather rate limiter is unavailable');
                return (await result.json()).retryAfter;
            });
        }
        if ((isWeather || isWebFilter) && (pathname === '/index.html' || (isWeather && /^\/weather(?:\/index\.html|\/)?$/.test(pathname)))) {
            url.pathname = '/';
            return Response.redirect(url.href, 308);
        }
        if (isWeather && !weatherAssets.test(pathname) && !siteFiles.has(pathname) && pathname !== '/') {
            return new Response('Not found', { status: 404, headers: noStore });
        }
        if (url.hostname === 'calendar.munetios.com' && (pathname === '/new' || pathname === '/new/')) {
            url.pathname = '/';
            return Response.redirect(url.href, 308);
        }
        if (url.hostname === 'write.munetios.com' && (pathname === '/overview/' || pathname === '/overview.html')) {
            url.pathname = '/overview';
            return Response.redirect(url.href, 308);
        }
        const isApi = /^\/api(?:\/|$)/i.test(pathname);
        const isProtectedPage = /^\/(?:account|mail|webfilter)(?:\/index\.html|\/)?$/i.test(pathname);
        if (!isApi && !isProtectedPage) {
            const root = appRoots.get(url.hostname);
            const target = new URL(request.url);
            if ((isWeather || isWebFilter) && siteFiles.has(pathname)) target.pathname = (isWeather ? '/weather' : '/webfilter') + pathname;
            else if (isWeather && pathname === '/') target.pathname = '/weather/';
            else if (isWebFilter && pathname === '/') target.pathname = '/webfilter/welcome';
            else if (photosRoutes.pathPattern.test(pathname) && ['GET', 'HEAD'].includes(request.method)) target.pathname = '/photos/';
            else if (root && !sharedAssets.test(pathname) && pathname !== root && !pathname.startsWith(root + '/')) target.pathname = root + (pathname === '/index.html' ? '/' : pathname);
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
