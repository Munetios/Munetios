/*
 * Munetios Maps API on Cloudflare (same routes as maps-server/router.js on the local server).
 *
 *  GET  /api/maps/tiles/info
 *  GET  /api/maps/tiles/:layer/:z/:x/:y      open-data imagery, kept in Cloudflare's cache after the first request
 *  GET  /api/maps/traffic?bbox=w,s,e,n       live traffic (Durable Object)
 *  POST /api/maps/traffic/samples            anonymous, opt-in speed reports
 */
import { DurableObject } from 'cloudflare:workers';

export const mapsApiPath = /^\/api\/maps(?:\/|$)/;

const LAYERS = {
    day: {
        type: 'image/jpeg', minzoom: 0, maxzoom: 14,
        upstream: [
            (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
            (z, x, y) => (z <= 8 ? `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg` : null),
        ],
        attribution: 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016) | NASA Blue Marble',
    },
    night: {
        type: 'image/png', minzoom: 0, maxzoom: 8,
        upstream: [(z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`],
        attribution: 'NASA Black Marble',
    },
};
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...headers, 'Cache-Control': 'no-store', ...extra } });
const isImage = (b) => b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47));

async function tile(layerName, z, x, y) {
    const layer = Object.hasOwn(LAYERS, layerName) ? LAYERS[layerName] : null;
    if (!layer || ![z, x, y].every(Number.isInteger) || z < layer.minzoom || z > layer.maxzoom || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
        return new Response('Not found', { status: 404, headers: { ...headers, 'Cache-Control': 'no-store' } });
    }
    for (const make of layer.upstream) {
        const url = make(z, x, y);
        if (!url) continue;
        try {
            const upstream = await fetch(url, {
                headers: { 'User-Agent': 'MunetiosMapsTileServer/1.0', Accept: 'image/*' },
                cf: { cacheEverything: true, cacheTtl: 30 * 86400 },
                signal: AbortSignal.timeout(15000),
            });
            if (!upstream.ok) continue;
            const bytes = new Uint8Array(await upstream.arrayBuffer());
            if (bytes.length > MAX_TILE_BYTES || !isImage(bytes)) continue;
            return new Response(bytes, { headers: { ...headers, 'Content-Type': layer.type, 'Cache-Control': 'public, max-age=2592000, immutable' } });
        } catch {}
    }
    return new Response('Tile unavailable', { status: 502, headers: { ...headers, 'Cache-Control': 'no-store' } });
}

export async function mapsResponse(request, env, pathname) {
    const url = new URL(request.url);
    if (pathname === '/api/maps/tiles/info' && request.method === 'GET') {
        return json({ layers: Object.fromEntries(Object.entries(LAYERS).map(([k, l]) => [k, { minzoom: l.minzoom, maxzoom: l.maxzoom, attribution: l.attribution }])), offline: false }, 200, { 'Cache-Control': 'no-cache' });
    }
    const t = /^\/api\/maps\/tiles\/(day|night)\/(\d+)\/(\d+)\/(\d+)(?:\.(?:jpe?g|png))?$/.exec(pathname);
    if (t && ['GET', 'HEAD'].includes(request.method)) return tile(t[1], Number(t[2]), Number(t[3]), Number(t[4]));
    if (pathname === '/api/maps/traffic' || pathname === '/api/maps/traffic/samples') {
        if (!env.MAPS_TRAFFIC) return json({ error: 'unavailable' }, 503);
        const stub = env.MAPS_TRAFFIC.getByName('global');
        const forward = new URL(pathname + url.search, 'https://maps-traffic');
        const init = { method: request.method, headers: { 'Content-Type': 'application/json', 'X-Client-IP': request.headers.get('CF-Connecting-IP') || 'unknown' } };
        if (request.method === 'POST') {
            const body = await request.text();
            if (body.length > 16 * 1024) return json({ error: 'too_large' }, 413);
            init.body = body;
        }
        return stub.fetch(forward, init);
    }
    return json({ error: 'not_found' }, 404);
}

/* ------------------------------------------------------------ traffic */
const WINDOW_MS = 15 * 60 * 1000;
const CELL_DEG = 0.0015;
const HEADING_BUCKETS = 16;
const MAX_SPEED_MPS = 70;
const MIN_REPORTS = 2;
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function distance(a, b) {
    const dLat = rad(b[1] - a[1]);
    const dLng = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Recent reports live in memory for 15 minutes; only each road cell's free-flow speed is stored.
export class MapsTraffic extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.cells = new Map();
        this.budget = new Map();
        this.dirty = new Map();
    }

    freeflow(key) {
        if (this.dirty.has(key)) return this.dirty.get(key);
        return this.ctx.storage.kv.get('ff:' + key);
    }

    prune(now) {
        for (const [key, cell] of this.cells) {
            cell.samples = cell.samples.filter((s) => now - s.t < WINDOW_MS);
            if (!cell.samples.length) this.cells.delete(key);
        }
    }

    allow(ip) {
        const now = Date.now();
        const entry = this.budget.get(ip) || { start: now, count: 0 };
        if (now - entry.start > 60000) { entry.start = now; entry.count = 0; }
        entry.count += 1;
        this.budget.set(ip, entry);
        if (this.budget.size > 5000) for (const [k, v] of this.budget) if (now - v.start > 60000) this.budget.delete(k);
        return entry.count <= 12;
    }

    async fetch(request) {
        const url = new URL(request.url);
        const now = Date.now();
        if (url.pathname === '/api/maps/traffic/samples' && request.method === 'POST') {
            if (!this.allow(request.headers.get('X-Client-IP') || 'unknown')) return json({ error: 'slow_down' }, 429);
            let list;
            try { list = (await request.json())?.s; } catch { return json({ error: 'invalid' }, 400); }
            if (!Array.isArray(list)) return json({ error: 'invalid' }, 400);
            const seen = new Set();
            let accepted = 0;
            for (const item of list.slice(0, 120)) {
                if (!Array.isArray(item) || item.length !== 5 || !item.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
                const [lng1, lat1, lng2, lat2, speed] = item;
                if (Math.abs(lat1) > 85 || Math.abs(lat2) > 85 || Math.abs(lng1) > 180 || Math.abs(lng2) > 180 || speed < 0 || speed > MAX_SPEED_MPS) continue;
                const a = [lng1, lat1], b = [lng2, lat2];
                const len = distance(a, b);
                if (len < 10 || len > 600) continue;
                const mid = [(lng1 + lng2) / 2, (lat1 + lat2) / 2];
                const head = Math.floor(((bearing(a, b) + 360 / HEADING_BUCKETS / 2) % 360) / (360 / HEADING_BUCKETS));
                const key = `${Math.round(mid[1] / CELL_DEG)}:${Math.round(mid[0] / CELL_DEG)}:${head}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const round = (n) => Math.round(n * 1e5) / 1e5;
                const cell = this.cells.get(key) || { line: null, samples: [] };
                cell.line = [round(lng1), round(lat1), round(lng2), round(lat2)];
                cell.samples.push({ t: now, v: speed });
                this.cells.set(key, cell);
                const ff = this.freeflow(key);
                this.dirty.set(key, Math.round((ff === undefined ? Math.max(speed, 8) : speed > ff ? ff + 0.3 * (speed - ff) : ff - 0.01 * (ff - speed)) * 100) / 100);
                accepted += 1;
            }
            if (this.dirty.size) {
                for (const [key, value] of this.dirty) this.ctx.storage.kv.put('ff:' + key, value);
                this.dirty.clear();
            }
            return json({ accepted });
        }
        if (url.pathname === '/api/maps/traffic' && request.method === 'GET') {
            const box = String(url.searchParams.get('bbox') || '').split(',').map(Number);
            if (box.length !== 4 || !box.every(Number.isFinite)) return json({ error: 'bbox' }, 400);
            const [w, s, e, n] = box;
            this.prune(now);
            const features = [];
            for (const [key, cell] of this.cells) {
                const [lng1, lat1, lng2, lat2] = cell.line;
                const lng = (lng1 + lng2) / 2, lat = (lat1 + lat2) / 2;
                if (lat < s || lat > n || (w <= e ? lng < w || lng > e : lng < w && lng > e)) continue;
                if (cell.samples.length < MIN_REPORTS) continue;
                const recent = cell.samples.filter((x) => now - x.t < 5 * 60 * 1000);
                const speeds = (recent.length >= MIN_REPORTS ? recent : cell.samples).map((x) => x.v).sort((p, q) => p - q);
                const median = speeds[Math.floor((speeds.length - 1) / 2)];
                const ff = Math.max(this.freeflow(key) || median, 1);
                const ratio = Math.max(0, Math.min(1.2, median / ff));
                const level = ratio >= 0.75 ? 'free' : ratio >= 0.5 ? 'moderate' : ratio >= 0.25 ? 'heavy' : 'standstill';
                features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[lng1, lat1], [lng2, lat2]] }, properties: { level, ratio: Math.round(ratio * 100) / 100, speed: Math.round(median * 3.6), reports: cell.samples.length, updated: Math.max(...cell.samples.map((x) => x.t)) } });
            }
            return json({ type: 'FeatureCollection', generated: now, minReports: MIN_REPORTS, features });
        }
        return json({ error: 'not_found' }, 404);
    }
}
