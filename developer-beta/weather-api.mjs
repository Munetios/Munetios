const requestLimit = 60;
export const weatherWindowMs = 5 * 60 * 1000;
const responseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const providers = new Map([
    ['/forecast', ['https://api.open-meteo.com/v1/forecast', 'latitude longitude timezone timeformat forecast_days current hourly daily minutely_15 forecast_minutely_15 temperature_unit wind_speed_unit precipitation_unit']],
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

    try {
        const upstream = await fetch(target, {
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
            headers: {
                Accept: target.hostname === 'api.weather.gov' ? 'application/geo+json' : 'application/json',
                'User-Agent': 'Munetios Weather (https://weather.munetios.com/)',
            },
        });
        const contentType = upstream.headers.get('Content-Type') || '';
        if ((upstream.status >= 300 && upstream.status < 400) ||
            !/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(contentType)) {
            await upstream.body?.cancel();
            return weatherError('providerUnavailable', 502);
        }
        return new Response(upstream.body, {
            status: upstream.status,
            headers: { ...responseHeaders, 'Content-Type': contentType },
        });
    } catch {
        return weatherError('providerUnavailable', 502);
    }
}
