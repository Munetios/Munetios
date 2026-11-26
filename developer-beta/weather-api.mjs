const requestLimit = 60;
export const weatherWindowMs = 5 * 60 * 1000;
const responseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const providers = new Map([
    ['/forecast', ['https://api.open-meteo.com/v1/forecast', 'latitude longitude timezone timeformat forecast_days past_days current hourly daily minutely_15 forecast_minutely_15 temperature_unit wind_speed_unit precipitation_unit']],
    ['/air-quality', ['https://air-quality-api.open-meteo.com/v1/air-quality', 'latitude longitude timezone timeformat current hourly forecast_days']],
    ['/search', ['https://photon.komoot.io/api/', 'q layer lang lat lon']],
    ['/reverse', ['https://photon.komoot.io/reverse', 'lat lon layer lang']],
    ['/nws/alerts', ['https://api.weather.gov/alerts/active', 'point']],
]);
const nwsPath = /^\/nws(\/(?:points\/-?\d{1,2}(?:\.\d{1,4})?,-?\d{1,3}(?:\.\d{1,4})?|gridpoints\/[A-Z]{3}\/-?\d{1,3},-?\d{1,3}\/forecast))$/;
export const weatherApiPath = /^\/api\/weather(?:\/|$)/;

export function takeWeatherRequest(timestamps, now) {
    const recent = timestamps.filter(time => time > now - weatherWindowMs);
    if (recent.length >= requestLimit) {
        return { retryAfter: Math.ceil((recent[0] + weatherWindowMs - now) / 1000) };
    }
    recent.push(now);
    return { recent };
}

export function createLocalWeatherLimit() {
    const clients = new Map();
    let sweepAt = 0;
    return ip => {
        const now = Date.now();
        if (now >= sweepAt) {
            for (const [key, timestamps] of clients) {
                if (timestamps.at(-1) <= now - weatherWindowMs) clients.delete(key);
            }
            sweepAt = now + weatherWindowMs;
        }
        const { recent, retryAfter } = takeWeatherRequest(clients.get(ip) || [], now);
        if (recent) clients.set(ip, recent);
        return retryAfter || 0;
    };
}

// Place search fallback: Photon sometimes refuses requests from shared cloud servers, so the same
// search goes to Open-Meteo's geocoder and comes back in Photon's GeoJSON shape (the page needs no changes).
async function searchFallback(url) {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return null;
    const target = new URL('https://geocoding-api.open-meteo.com/v1/search');
    target.searchParams.set('name', q);
    target.searchParams.set('count', '10');
    target.searchParams.set('language', url.searchParams.get('lang') || 'en');
    target.searchParams.set('format', 'json');
    const response = await fetch(target, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json', 'User-Agent': 'Munetios Weather (https://weather.munetios.com/)' },
        cf: { cacheEverything: true, cacheTtl: 3600 },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const features = (Array.isArray(data?.results) ? data.results : [])
        .filter(r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && typeof r.name === 'string')
        .map(r => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] },
            properties: {
                osm_key: 'place',
                osm_value: String(r.feature_code || '').startsWith('PPL') ? 'city' : 'locality',
                type: String(r.feature_code || '').startsWith('PPL') ? 'city' : 'locality',
                name: r.name, state: r.admin1 || '', county: r.admin2 || '', country: r.country || '', countrycode: r.country_code || '',
            },
        }));
    return Response.json({ type: 'FeatureCollection', features }, { headers: { ...responseHeaders, 'Cache-Control': 'public, max-age=3600' } });
}

function weatherError(error, status, headers) {
    return Response.json({ error }, { status, headers: { ...responseHeaders, ...headers } });
}

export async function weatherResponse(url, method, take) {
    if (method !== 'GET') return weatherError('methodNotAllowed', 405, { Allow: 'GET' });
    const path = url.pathname.slice('/api/weather'.length);
    const provider = providers.get(path);
    const match = nwsPath.exec(path);
    if (!provider && !match) return weatherError('notFound', 404);

    const target = new URL(provider ? provider[0] : 'https://api.weather.gov' + match[1]);
    if (provider) {
        for (const name of provider[1].split(' ')) {
            const value = url.searchParams.get(name);
            if (value !== null) target.searchParams.set(name, value);
        }
    }
    try {
        const retryAfter = await take();
        if (retryAfter > 0) {
            return weatherError('rateLimited', 429, { 'Retry-After': String(retryAfter) });
        }
    } catch {
        return weatherError('unavailable', 503);
    }

    const isSearch = path === '/search';
    const fallback = async () => {
        if (!isSearch) return weatherError('providerUnavailable', 502);
        try { return (await searchFallback(url)) || weatherError('providerUnavailable', 502); }
        catch { return weatherError('providerUnavailable', 502); }
    };
    try {
        const upstream = await fetch(target, {
            redirect: 'manual',
            signal: AbortSignal.timeout(isSearch ? 6000 : 10000),
            headers: {
                Accept: target.hostname === 'api.weather.gov' ? 'application/geo+json' : 'application/json',
                'User-Agent': 'Munetios Weather (https://weather.munetios.com/)',
            },
            // Place searches are cached at the edge for an hour, so repeated searches don't reach the provider.
            ...(isSearch ? { cf: { cacheEverything: true, cacheTtl: 3600 } } : {}),
        });
        const contentType = upstream.headers.get('Content-Type') || '';
        if ((upstream.status >= 300 && upstream.status < 400) ||
            !/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(contentType) ||
            (isSearch && !upstream.ok)) {
            await upstream.body?.cancel();
            return fallback();
        }
        return new Response(upstream.body, {
            status: upstream.status,
            headers: { ...responseHeaders, 'Content-Type': contentType },
        });
    } catch {
        return fallback();
    }
}
