'use strict';
/*
 * Munetios Maps local server
 *
 *  Tiles   GET  /api/maps/tiles/info                    layers, zoom ranges, attribution
 *          GET  /api/maps/tiles/:layer/:z/:x/:y         self-hosted imagery tiles
 *  Traffic GET  /api/maps/traffic?bbox=w,s,e,n          live traffic as GeoJSON
 *          POST /api/maps/traffic/samples               anonymous speed samples (opt-in in the app)
 *
 * Tiles are served from a folder on this machine (MAPS_TILE_DIR, default maps-server/tiles/<layer>/z/x/y.ext).
 * Put your own imagery there to serve it; tiles that aren't there yet are downloaded once from an
 * open-data source (NASA Blue Marble and Black Marble, Sentinel-2 cloudless 2016) and saved, so
 * the server keeps working from its own copy afterwards. Set MAPS_TILES_OFFLINE=1 to never download.
 *
 * Traffic is built from speed samples that Munetios Maps users choose to share. A sample is two points
 * and a speed — no account, device, or trip identifier. Samples are grouped into ~150 m road cells by
 * direction, kept for 15 minutes, and a cell is only shown after it has several reports. Only the
 * long-run free-flow speed per cell is saved to disk.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const LAYERS = {
  // Daytime imagery: Sentinel-2 cloudless 2016 (CC BY 4.0), Blue Marble (public domain) as a fallback.
  day: {
    ext: 'jpg',
    type: 'image/jpeg',
    minzoom: 0,
    maxzoom: 14,
    upstream: [
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
    ],
    attribution: 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016) | NASA Blue Marble',
  },
  // City lights at night: NASA Black Marble 2016 (public domain).
  night: {
    ext: 'png',
    type: 'image/png',
    minzoom: 0,
    maxzoom: 8,
    upstream: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'],
    attribution: 'NASA Black Marble',
  },
};

const MAX_TILE_BYTES = 2 * 1024 * 1024;
const TRAFFIC_WINDOW_MS = 15 * 60 * 1000;
const CELL_DEG = 0.0015; // about 150 m
const HEADING_BUCKETS = 16;
const MAX_SPEED_MPS = 70;

function createMapsRouter({ env = process.env, fetchUpstream = fetch, dataDir = path.join(__dirname, 'data') } = {}) {
  const router = express.Router();
  const tileDir = env.MAPS_TILE_DIR || path.join(__dirname, 'tiles');
  const offline = env.MAPS_TILES_OFFLINE === '1';
  const minReports = Math.max(1, Number(env.MAPS_TRAFFIC_MIN_REPORTS) || 2);
  const layers = JSON.parse(JSON.stringify(LAYERS));
  // Optional overrides, e.g. MAPS_DAY_UPSTREAM=https://example.org/{z}/{x}/{y}.jpg and MAPS_DAY_MAXZOOM=18.
  for (const [name, layer] of Object.entries(layers)) {
    const key = name.toUpperCase();
    if (env[`MAPS_${key}_UPSTREAM`]) layer.upstream = String(env[`MAPS_${key}_UPSTREAM`]).split(',').map((u) => u.trim()).filter((u) => /^https:\/\//.test(u));
    if (Number(env[`MAPS_${key}_MAXZOOM`]) > 0) layer.maxzoom = Math.min(22, Number(env[`MAPS_${key}_MAXZOOM`]));
  }

  router.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  /* ---------------------------------------------------------------- tiles */
  const inflight = new Map();
  const tilePath = (name, z, x, y) => path.join(tileDir, name, String(z), String(x), `${y}.${layers[name].ext}`);
  const isImage = (buf) => buf.length > 8 && ((buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47));

  async function download(name, z, x, y) {
    let lastError = new Error('no upstream');
    for (const template of layers[name].upstream) {
      const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      try {
        const response = await fetchUpstream(url, {
          headers: { 'User-Agent': 'MunetiosMapsTileServer/1.0', Accept: 'image/*' },
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) { lastError = new Error('upstream ' + response.status); continue; }
        const buf = Buffer.from(await response.arrayBuffer());
        if (buf.length > MAX_TILE_BYTES || !isImage(buf)) { lastError = new Error('not an image'); continue; }
        return buf;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  async function getTile(name, z, x, y) {
    const file = tilePath(name, z, x, y);
    try { return await fs.promises.readFile(file); } catch {}
    if (offline) return null;
    const key = `${name}/${z}/${x}/${y}`;
    if (!inflight.has(key)) {
      inflight.set(key, (async () => {
        try {
          const buf = await download(name, z, x, y);
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
          await fs.promises.writeFile(tmp, buf);
          await fs.promises.rename(tmp, file).catch(() => fs.promises.unlink(tmp).catch(() => {}));
          return buf;
        } finally {
          inflight.delete(key);
        }
      })());
    }
    return inflight.get(key);
  }

  router.get('/tiles/info', (req, res) => {
    res.set('Cache-Control', 'no-cache').json({
      layers: Object.fromEntries(Object.entries(layers).map(([name, l]) => [name, { minzoom: l.minzoom, maxzoom: l.maxzoom, attribution: l.attribution }])),
      offline,
    });
  });

  router.get('/tiles/:layer/:z/:x/:y', async (req, res) => {
    const name = req.params.layer;
    const layer = Object.prototype.hasOwnProperty.call(layers, name) ? layers[name] : null;
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(String(req.params.y).replace(/\.(jpe?g|png)$/i, ''));
    if (!layer || ![z, x, y].every(Number.isInteger) || z < layer.minzoom || z > layer.maxzoom || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
      return res.status(404).set('Cache-Control', 'no-store').end();
    }
    try {
      const buf = await getTile(name, z, x, y);
      if (!buf) return res.status(404).set('Cache-Control', 'no-store').end();
      res.set({ 'Content-Type': layer.type, 'Cache-Control': 'public, max-age=2592000, immutable' }).send(buf);
    } catch {
      res.status(502).set('Cache-Control', 'no-store').end();
    }
  });

  /* ---------------------------------------------------------------- traffic */
  const cells = new Map(); // key -> { line, samples: [{t, v}], ff }
  const freeflowFile = path.join(dataDir, 'traffic-freeflow.json');
  let freeflow = {};
  try { freeflow = JSON.parse(fs.readFileSync(freeflowFile, 'utf8')) || {}; } catch {}
  let freeflowDirty = false;
  const saveTimer = setInterval(() => {
    if (!freeflowDirty) return;
    freeflowDirty = false;
    fs.promises.mkdir(dataDir, { recursive: true })
      .then(() => fs.promises.writeFile(freeflowFile + '.tmp', JSON.stringify(freeflow)))
      .then(() => fs.promises.rename(freeflowFile + '.tmp', freeflowFile))
      .catch(() => { freeflowDirty = true; });
  }, 60000);
  saveTimer.unref?.();

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
  function prune(now) {
    for (const [key, cell] of cells) {
      cell.samples = cell.samples.filter((s) => now - s.t < TRAFFIC_WINDOW_MS);
      if (!cell.samples.length) cells.delete(key);
    }
  }
  const pruneTimer = setInterval(() => prune(Date.now()), 60000);
  pruneTimer.unref?.();

  // Simple per-address budget so one client can't flood the aggregator.
  const budget = new Map();
  function allow(ip) {
    const now = Date.now();
    const entry = budget.get(ip) || { start: now, count: 0 };
    if (now - entry.start > 60000) { entry.start = now; entry.count = 0; }
    entry.count += 1;
    budget.set(ip, entry);
    if (budget.size > 5000) for (const [k, v] of budget) if (now - v.start > 60000) budget.delete(k);
    return entry.count <= 12;
  }

  router.post('/traffic/samples', express.json({ limit: '16kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!allow(req.ip)) return res.status(429).json({ error: 'slow_down' });
    const list = Array.isArray(req.body?.s) ? req.body.s : null;
    if (!list) return res.status(400).json({ error: 'invalid' });
    const now = Date.now();
    const seen = new Set();
    let accepted = 0;
    for (const item of list.slice(0, 120)) {
      if (!Array.isArray(item) || item.length !== 5 || !item.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
      const [lng1, lat1, lng2, lat2, speed] = item;
      if (Math.abs(lat1) > 85 || Math.abs(lat2) > 85 || Math.abs(lng1) > 180 || Math.abs(lng2) > 180) continue;
      if (speed < 0 || speed > MAX_SPEED_MPS) continue;
      const a = [lng1, lat1];
      const b = [lng2, lat2];
      const len = distance(a, b);
      if (len < 10 || len > 600) continue;
      const mid = [(lng1 + lng2) / 2, (lat1 + lat2) / 2];
      const head = Math.floor(((bearing(a, b) + 360 / HEADING_BUCKETS / 2) % 360) / (360 / HEADING_BUCKETS));
      const key = `${Math.round(mid[1] / CELL_DEG)}:${Math.round(mid[0] / CELL_DEG)}:${head}`;
      if (seen.has(key)) continue; // one report per cell per upload
      seen.add(key);
      const round = (n) => Math.round(n * 1e5) / 1e5;
      const cell = cells.get(key) || { line: null, samples: [] };
      cell.line = [round(lng1), round(lat1), round(lng2), round(lat2)];
      cell.samples.push({ t: now, v: speed });
      cells.set(key, cell);
      // Free-flow speed: rises quickly toward fast samples, decays slowly toward slow ones.
      const ff = freeflow[key];
      freeflow[key] = Math.round((ff === undefined ? Math.max(speed, 8) : speed > ff ? ff + 0.3 * (speed - ff) : ff - 0.01 * (ff - speed)) * 100) / 100;
      freeflowDirty = true;
      accepted += 1;
    }
    res.json({ accepted });
  });

  router.get('/traffic', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const box = String(req.query.bbox || '').split(',').map(Number);
    if (box.length !== 4 || !box.every(Number.isFinite)) return res.status(400).json({ error: 'bbox' });
    const [w, s, e, n] = box;
    const now = Date.now();
    prune(now);
    const features = [];
    for (const [key, cell] of cells) {
      const [lng1, lat1, lng2, lat2] = cell.line;
      const lng = (lng1 + lng2) / 2;
      const lat = (lat1 + lat2) / 2;
      if (lat < s || lat > n || (w <= e ? lng < w || lng > e : lng < w && lng > e)) continue;
      if (cell.samples.length < minReports) continue;
      // Reports from the last 5 minutes count when there are enough; otherwise the whole 15-minute window.
      const recent = cell.samples.filter((x) => now - x.t < 5 * 60 * 1000);
      const speeds = (recent.length >= minReports ? recent : cell.samples).map((x) => x.v).sort((p, q) => p - q);
      const median = speeds[Math.floor((speeds.length - 1) / 2)];
      const ff = Math.max(freeflow[key] || median, 1);
      const ratio = Math.max(0, Math.min(1.2, median / ff));
      const level = ratio >= 0.75 ? 'free' : ratio >= 0.5 ? 'moderate' : ratio >= 0.25 ? 'heavy' : 'standstill';
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[lng1, lat1], [lng2, lat2]] },
        properties: { level, ratio: Math.round(ratio * 100) / 100, speed: Math.round(median * 3.6), reports: cell.samples.length, updated: Math.max(...cell.samples.map((x) => x.t)) },
      });
    }
    res.json({ type: 'FeatureCollection', generated: now, minReports, features });
  });

  router.close = () => { clearInterval(saveTimer); clearInterval(pruneTimer); };
  return router;
}

module.exports = { createMapsRouter, LAYERS };
