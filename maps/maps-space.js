/*
 * Munetios Maps: Earth from space, the Moon, and self-hosted satellite imagery with day and night.
 *
 * Runs in <head> right after MapLibre so the satellite tile protocol exists before the map is created.
 * Everything that needs the map waits for the "maps-ready" event.
 */
(() => {
  "use strict";
  if (!window.maplibregl) return;

  /* ------------------------------------------------------------ astronomy */
  const RAD = Math.PI / 180;
  const daysSinceJ2000 = (date) => (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const norm360 = (deg) => ((deg % 360) + 360) % 360;
  const norm180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
  const gmstDeg = (d) => norm360(280.46061837 + 360.98564736629 * d);
  function eclipticToGround(lambdaDeg, betaDeg, d) {
    const e = (23.439 - 0.00000036 * d) * RAD;
    const l = lambdaDeg * RAD;
    const b = betaDeg * RAD;
    const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) / RAD;
    const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) / RAD;
    return { lat: dec, lng: norm180(ra - gmstDeg(d)) };
  }
  // Point on Earth where the Sun is overhead.
  function subsolar(date) {
    const d = daysSinceJ2000(date);
    const g = norm360(357.529 + 0.98560028 * d) * RAD;
    const q = norm360(280.459 + 0.98564736 * d);
    const lambda = q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
    return eclipticToGround(lambda, 0, d);
  }
  // Point on Earth where the Moon is overhead (low-precision lunar theory, good to a fraction of a degree).
  function sublunar(date) {
    const d = daysSinceJ2000(date);
    const L = norm360(218.316 + 13.176396 * d);
    const M = norm360(134.963 + 13.064993 * d) * RAD;
    const F = norm360(93.272 + 13.22935 * d) * RAD;
    const D = norm360(297.85 + 12.190749 * d) * RAD;
    const lambda = L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D);
    const beta = 5.128 * Math.sin(F);
    return eclipticToGround(lambda, beta, d);
  }
  const toVec = (lat, lng) => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  /* ------------------------------------------------------------ settings */
  const readExtras = () => { try { return JSON.parse(localStorage.getItem("munetios-maps-extras") || "{}"); } catch { return {}; } };
  const satNightOn = () => readExtras().satNight !== false;

  /* ------------------------------------------------------------ satellite: day and night */
  // Tiles come from the local tile server; the night side (city lights) is blended in for the current time.
  const SAT = { maxzoom: 14, nightMaxzoom: 8, bucketMs: 5 * 60 * 1000 };
  const bucket = () => Math.floor(Date.now() / SAT.bucketMs) * SAT.bucketMs;
  let currentBucket = bucket();
  const tileUrl = (layer, z, x, y) => `${location.origin}/api/maps/tiles/${layer}/${z}/${x}/${y}`;
  // The same open-data imagery the local tile server uses. The browser only asks these directly
  // when this site's tile server isn't available (for example, a server started before it existed).
  const DIRECT = {
    day: [
      (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
      (z, x, y) => (z <= 8 ? `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg` : null),
    ],
    night: [(z, x, y) => (z <= 8 ? `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png` : null)],
  };
  let localTiles = null; // null: unknown, true: this site serves tiles, false: it doesn't
  const isAbort = (err) => err && err.name === "AbortError";
  async function fetchTileBlob(layer, z, x, y, signal) {
    if (localTiles !== false) {
      try {
        const res = await fetch(tileUrl(layer, z, x, y), { signal, credentials: "same-origin" });
        const type = res.headers.get("content-type") || "";
        if (res.ok && type.startsWith("image/")) { localTiles = true; return await res.blob(); }
        // An HTML 404 means this server has no tile routes at all.
        if (res.status === 404 && type.includes("text/html")) localTiles = false;
      } catch (err) {
        if (isAbort(err)) throw err;
      }
    }
    for (const make of DIRECT[layer] || []) {
      const url = make(z, x, y);
      if (!url) continue;
      try {
        const res = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" });
        if (res.ok) return await res.blob();
      } catch (err) {
        if (isAbort(err)) throw err;
      }
    }
    throw new Error("tile unavailable");
  }
  async function fetchBitmap(layer, z, x, y, signal) {
    return createImageBitmap(await fetchTileBlob(layer, z, x, y, signal));
  }
  function tileLatLng(z, x, y, px, py) {
    const n = 2 ** z;
    const lng = ((x + px) / n) * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI - (2 * Math.PI * (y + py)) / n)) / RAD;
    return [lat, lng];
  }
  // How strongly the night side shows: full from space, softer close up so streets stay readable.
  const nightStrength = (z) => (z <= 6 ? 1 : z >= 10 ? 0 : 1 - (z - 6) / 4);
  function sunCos(lat, lng, sun) {
    return Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lng - sun.lng) * RAD);
  }
  const TWILIGHT_LOW = -0.12; // about 7 degrees below the horizon
  const TWILIGHT_HIGH = 0.06;
  function classify(z, x, y, sun) {
    let day = 0;
    let night = 0;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const [lat, lng] = tileLatLng(z, x, y, i / steps, j / steps);
        const c = sunCos(lat, lng, sun);
        if (c > TWILIGHT_HIGH + 0.04) day++;
        else if (c < TWILIGHT_LOW - 0.04) night++;
      }
    }
    const total = (steps + 1) ** 2;
    if (z > 2 && day === total) return "day";
    if (z > 2 && night === total) return "night";
    return "mixed";
  }
  async function satelliteTile(params, abort) {
    const m = /munetios-sat:\/\/(\d+)\/(\d+)\/(\d+)(?:\?t=(\d+))?/.exec(params.url);
    if (!m) throw new Error("bad tile url");
    const z = Number(m[1]);
    const x = Number(m[2]);
    const y = Number(m[3]);
    const time = new Date(Number(m[4]) || Date.now());
    const signal = abort?.signal;
    const dayBlob = await fetchTileBlob("day", z, x, y, signal);
    if (!satNightOn() || nightStrength(z) <= 0) return { data: await dayBlob.arrayBuffer() };
    const sun = subsolar(time);
    const kind = classify(z, x, y, sun);
    if (kind === "day") return { data: await dayBlob.arrayBuffer() };
    // Night lights only go to zoom 8; deeper tiles use the matching part of their zoom-8 ancestor.
    const nz = Math.min(z, SAT.nightMaxzoom);
    const scale = 2 ** (z - nz);
    const nx = Math.floor(x / scale);
    const ny = Math.floor(y / scale);
    const [dayImg, nightImg] = await Promise.all([createImageBitmap(dayBlob), fetchBitmap("night", nz, nx, ny, signal).catch(() => null)]);
    const size = 256;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(dayImg, 0, 0, size, size);
    const dayData = ctx.getImageData(0, 0, size, size);
    ctx.clearRect(0, 0, size, size);
    if (nightImg) {
      const sub = 256 / scale;
      ctx.drawImage(nightImg, (x - nx * scale) * sub, (y - ny * scale) * sub, sub, sub, 0, 0, size, size);
    } else {
      ctx.fillStyle = "#05070f";
      ctx.fillRect(0, 0, size, size);
    }
    const nightData = ctx.getImageData(0, 0, size, size);
    const strength = nightStrength(z);
    const out = dayData.data;
    const nd = nightData.data;
    // Per-row latitude and per-column longitude terms keep this to a handful of operations per pixel.
    const sinD = Math.sin(sun.lat * RAD);
    const cosD = Math.cos(sun.lat * RAD);
    const colCos = new Float32Array(size);
    for (let i = 0; i < size; i++) colCos[i] = Math.cos((tileLatLng(z, x, y, (i + 0.5) / size, 0)[1] - sun.lng) * RAD);
    for (let j = 0; j < size; j++) {
      const lat = tileLatLng(z, x, y, 0, (j + 0.5) / size)[0] * RAD;
      const a = Math.sin(lat) * sinD;
      const b = Math.cos(lat) * cosD;
      for (let i = 0; i < size; i++) {
        const c = a + b * colCos[i];
        let k;
        if (c >= TWILIGHT_HIGH) k = 0;
        else if (c <= TWILIGHT_LOW) k = 1;
        else { const t = (TWILIGHT_HIGH - c) / (TWILIGHT_HIGH - TWILIGHT_LOW); k = t * t * (3 - 2 * t); }
        if (!k) continue;
        k *= strength;
        const p = (j * size + i) * 4;
        // The day image dims toward night; city lights are added on top.
        const dim = 1 - k * 0.92;
        out[p] = Math.min(255, out[p] * dim + nd[p] * k);
        out[p + 1] = Math.min(255, out[p + 1] * dim + nd[p + 1] * k);
        out[p + 2] = Math.min(255, out[p + 2] * dim + nd[p + 2] * k);
      }
    }
    ctx.putImageData(dayData, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return { data: await blob.arrayBuffer() };
  }
  try { maplibregl.addProtocol("munetios-sat", satelliteTile); } catch {}

  window.MunetiosSpace = {
    satelliteTiles: () => [`munetios-sat://{z}/{x}/{y}?t=${currentBucket}`],
    satelliteMaxZoom: () => SAT.maxzoom,
    subsolar,
    sublunar,
  };
  fetch(`${location.origin}/api/maps/tiles/info`, { credentials: "same-origin" })
    .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null))
    .then((info) => {
      if (!info?.layers) { localTiles = false; return; }
      localTiles = true;
      SAT.maxzoom = info.layers.day?.maxzoom || SAT.maxzoom;
      SAT.nightMaxzoom = info.layers.night?.maxzoom || SAT.nightMaxzoom;
    })
    .catch(() => {});

  /* ------------------------------------------------------------ everything that needs the map */
  function start() {
    const api = window._mapsApi;
    const map = api?.map;
    if (!map || map.__munetiosSpace) return;
    map.__munetiosSpace = true;
    const T = (key, fallback) => { try { const v = window.MapsFeatures?.t(key); return v && v !== key ? v : fallback; } catch { return fallback; } };
    const isMoon = () => document.body.classList.contains("mf-moon-mode");

    // Markers on the far side of the globe are hidden instead of showing through the Earth.
    const MarkerProto = maplibregl.Marker.prototype;
    if (!MarkerProto.__mfCovered) {
      MarkerProto.__mfCovered = true;
      const addTo = MarkerProto.addTo;
      MarkerProto.addTo = function (target) {
        try { this.setOpacity?.("1", "0"); } catch {}
        return addTo.call(this, target);
      };
    }
    try { api.refreshCustomMarkers(); } catch {}

    map.setMinZoom(Math.max(map.getMinZoom(), 0));

    // Refresh satellite tiles as the night side moves (every 5 minutes).
    setInterval(() => {
      const next = bucket();
      if (next === currentBucket) return;
      currentBucket = next;
      const source = map.getSource("munetios-satellite");
      if (source?.setTiles && !isMoon()) source.setTiles(window.MunetiosSpace.satelliteTiles());
    }, 30000);
    window.addEventListener("storage", (e) => { if (e.key === "munetios-maps-extras") refreshSatellite(); });

    /* -------------------------------------------- stars */
    const starCanvas = document.createElement("canvas");
    starCanvas.width = 1024;
    starCanvas.height = 1024;
    const sctx = starCanvas.getContext("2d");
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 900; i++) {
      const r = rand() < 0.94 ? rand() * 0.9 + 0.3 : rand() * 1.1 + 1;
      const a = 0.25 + rand() * 0.75;
      const tint = rand();
      sctx.fillStyle = tint < 0.15 ? `rgba(180,200,255,${a})` : tint < 0.25 ? `rgba(255,228,196,${a})` : `rgba(255,255,255,${a})`;
      sctx.beginPath();
      sctx.arc(rand() * 1024, rand() * 1024, r, 0, Math.PI * 2);
      sctx.fill();
    }
    const container = map.getContainer();
    container.style.setProperty("--mf-stars", `url(${starCanvas.toDataURL("image/png")})`);
    container.classList.add("mf-space");

    /* -------------------------------------------- globe size on screen */
    function globeRadius() {
      const c = map.getCenter();
      const dir = c.lat > 0 ? -1 : 1;
      const lat2 = c.lat + dir * 80;
      const p0 = map.project([c.lng, c.lat]);
      const p1 = map.project([c.lng, lat2]);
      return Math.hypot(p1.x - p0.x, p1.y - p0.y) / Math.sin(80 * RAD);
    }

    /* -------------------------------------------- glow around the globe */
    const halo = document.createElement("div");
    halo.className = "mf-halo";
    halo.setAttribute("aria-hidden", "true");
    container.insertBefore(halo, container.querySelector(".maplibregl-canvas-container"));
    function renderHalo() {
      const zoom = map.getZoom();
      if (map.getProjection?.()?.type !== "globe" || zoom > 5 || map.getPitch() > 30) { halo.hidden = true; return; }
      const R = globeRadius();
      if (!Number.isFinite(R) || R <= 0) { halo.hidden = true; return; }
      const rect = container.getBoundingClientRect();
      halo.hidden = false;
      halo.style.width = halo.style.height = `${R * 2}px`;
      halo.style.transform = `translate(${rect.width / 2 - R}px, ${rect.height / 2 - R}px)`;
      halo.style.setProperty("--mf-glow", `${Math.max(10, R * 0.09)}px`);
      halo.style.opacity = String(Math.max(0, Math.min(1, (5 - zoom) / 1.5)));
      halo.classList.toggle("is-moon", isMoon());
    }

    /* -------------------------------------------- the Moon in space */
    const moonTexture = new Image();
    moonTexture.src = "./moon/moon-1k.jpg";
    let texData = null;
    moonTexture.onload = () => {
      const c = document.createElement("canvas");
      c.width = moonTexture.naturalWidth;
      c.height = moonTexture.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(moonTexture, 0, 0);
      texData = g.getImageData(0, 0, c.width, c.height);
      renderMoon(true);
    };
    const moonBtn = document.createElement("button");
    moonBtn.type = "button";
    moonBtn.className = "mf-moon";
    moonBtn.hidden = true;
    const moonCanvas = document.createElement("canvas");
    moonBtn.append(moonCanvas);
    container.append(moonBtn);
    moonBtn.addEventListener("click", () => enterMoon());
    function phaseName(fraction, waxing) {
      if (fraction < 0.03) return T("moonNew", "New moon");
      if (fraction > 0.97) return T("moonFull", "Full moon");
      if (Math.abs(fraction - 0.5) < 0.06) return waxing ? T("moonFirstQuarter", "First quarter") : T("moonLastQuarter", "Last quarter");
      if (fraction < 0.5) return waxing ? T("moonWaxingCrescent", "Waxing crescent") : T("moonWaningCrescent", "Waning crescent");
      return waxing ? T("moonWaxingGibbous", "Waxing gibbous") : T("moonWaningGibbous", "Waning gibbous");
    }
    function moonState(now = new Date()) {
      const ml = sublunar(now);
      const sl = subsolar(now);
      const m = toVec(ml.lat, ml.lng);
      const s = toVec(sl.lat, sl.lng);
      const elongation = Math.acos(Math.max(-1, Math.min(1, dot(m, s))));
      const fraction = (1 - Math.cos(elongation)) / 2;
      const later = sublunar(new Date(now.getTime() + 6 * 3600e3));
      const sLater = subsolar(new Date(now.getTime() + 6 * 3600e3));
      const elongLater = Math.acos(Math.max(-1, Math.min(1, dot(toVec(later.lat, later.lng), toVec(sLater.lat, sLater.lng)))));
      return { m, s, fraction, waxing: elongLater > elongation, name: phaseName(fraction, elongLater > elongation) };
    }
    let lastMoonSize = 0;
    let lastMoonKey = "";
    function paintMoonDisc(size, state) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = Math.round(size * dpr);
      moonCanvas.width = px;
      moonCanvas.height = px;
      moonCanvas.style.width = size + "px";
      moonCanvas.style.height = size + "px";
      const g = moonCanvas.getContext("2d");
      const img = g.createImageData(px, px);
      // View frame: looking from Earth toward the Moon, celestial north up.
      const f = state.m;
      let up = unit([-f[0] * f[2], -f[1] * f[2], 1 - f[2] * f[2]]);
      if (!Number.isFinite(up[0])) up = [0, 1, 0];
      const right = unit(cross(up, f));
      const sun = state.s;
      const tw = texData?.width || 1;
      const th = texData?.height || 1;
      for (let j = 0; j < px; j++) {
        const b = 1 - ((j + 0.5) / px) * 2;
        for (let i = 0; i < px; i++) {
          const a = ((i + 0.5) / px) * 2 - 1;
          const rr = a * a + b * b;
          if (rr > 1) continue;
          const c = Math.sqrt(1 - rr);
          // Surface normal facing Earth (toward -f).
          const n = [a * right[0] + b * up[0] - c * f[0], a * right[1] + b * up[1] - c * f[1], a * right[2] + b * up[2] - c * f[2]];
          const light = Math.max(0, dot(n, sun));
          const shade = Math.min(1, 0.05 + 1.05 * Math.pow(light, 0.75));
          // The near side always faces Earth: lunar longitude 0 is the disc center.
          const lat = Math.asin(b);
          const lng = Math.atan2(a, c);
          let r = 200;
          let gr = 200;
          let bl = 200;
          if (texData) {
            const tx = Math.min(tw - 1, Math.max(0, Math.floor((lng / (2 * Math.PI) + 0.5) * tw)));
            const ty = Math.min(th - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * th)));
            const q = (ty * tw + tx) * 4;
            r = texData.data[q];
            gr = texData.data[q + 1];
            bl = texData.data[q + 2];
          }
          const edge = Math.min(1, (1 - Math.sqrt(rr)) * px * 0.5); // soft rim
          const p = (j * px + i) * 4;
          img.data[p] = r * shade;
          img.data[p + 1] = gr * shade;
          img.data[p + 2] = bl * shade;
          img.data[p + 3] = 255 * edge;
        }
      }
      g.putImageData(img, 0, 0);
    }
    let moonInfo = moonState();
    function renderMoon(force) {
      if (isMoon() || map.getProjection?.()?.type !== "globe") { moonBtn.hidden = true; return; }
      const zoom = map.getZoom();
      const fade = Math.max(0, Math.min(1, (3.6 - zoom) / 1));
      if (fade <= 0 || map.getPitch() > 45) { moonBtn.hidden = true; return; }
      const R = globeRadius();
      if (!Number.isFinite(R) || R <= 0) { moonBtn.hidden = true; return; }
      const size = Math.round(Math.max(28, Math.min(120, R * 0.2727 * 2)));
      const key = size + ":" + Math.round(moonInfo.fraction * 200) + ":" + Boolean(texData);
      if (force || key !== lastMoonKey) { paintMoonDisc(size, moonInfo); lastMoonKey = key; lastMoonSize = size; }
      // Direction of the Moon as seen over the globe, rotated with the map.
      const c = map.getCenter();
      const C = toVec(c.lat, c.lng);
      const E = unit(cross([0, 0, 1], C));
      const N = cross(C, E);
      let x = dot(moonInfo.m, E);
      let y = dot(moonInfo.m, N);
      if (Math.hypot(x, y) < 0.15) { x = 0.7; y = 0.5; }
      const bearing = map.getBearing() * RAD;
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const margin = size / 2 + 16;
      // Place the Moon in its real direction; on narrow screens fall back to the open space above or below the Earth.
      const fit = (ang) => {
        const dx = Math.cos(ang);
        const dy = -Math.sin(ang);
        const maxX = Math.abs(dx) > 1e-6 ? Math.abs((dx > 0 ? rect.width - margin - cx : cx - margin) / dx) : Infinity;
        const maxY = Math.abs(dy) > 1e-6 ? Math.abs((dy > 0 ? rect.height - margin - cy : cy - margin) / dy) : Infinity;
        const dist = Math.min(R * 1.45 + size * 0.75, maxX, maxY);
        return dist >= R + size * 0.6 ? { dx, dy, dist } : null;
      };
      const real = Math.atan2(y, x) + bearing;
      // Below the Earth first: the top of the screen holds the search bar and buttons.
      const spot = fit(real) || fit(Math.cos(real) >= 0 ? -Math.PI / 2 + 0.35 : -Math.PI / 2 - 0.35) || fit(Math.PI / 2 - 0.35);
      if (!spot) { moonBtn.hidden = true; return; }
      const { dx, dy, dist } = spot;
      moonBtn.hidden = false;
      moonBtn.style.opacity = String(fade);
      moonBtn.style.transform = `translate(${cx + dx * dist - lastMoonSize / 2}px, ${cy + dy * dist - lastMoonSize / 2}px) rotate(${map.getBearing()}deg)`;
      const label = `${T("moon", "Moon")} · ${moonInfo.name} · ${Math.round(moonInfo.fraction * 100)}%`;
      moonBtn.setAttribute("aria-label", `${label}. ${T("visitMoon", "Visit the Moon")}`);
      moonBtn.title = label;
    }
    let raf = 0;
    const queueMoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderMoon(false); renderHalo(); }); };
    map.on("move", queueMoon);
    map.on("resize", queueMoon);
    map.on("style.load", () => setTimeout(() => { renderMoon(true); renderHalo(); }, 50));
    setInterval(() => { moonInfo = moonState(); renderMoon(true); }, 60000);
    renderMoon(true);

    /* -------------------------------------------- Moon view */
    const MOON_FEATURES = [
      ["Mare Tranquillitatis", 8.5, 31.4], ["Mare Serenitatis", 28, 17.5], ["Mare Imbrium", 32.8, -15.6], ["Oceanus Procellarum", 18.4, -57.4],
      ["Mare Crisium", 17, 59.1], ["Mare Fecunditatis", -7.8, 51.3], ["Mare Nubium", -21.3, -16.6], ["Mare Frigoris", 56, 1.4],
      ["Mare Nectaris", -15.2, 35.5], ["Mare Humorum", -24.4, -38.6], ["Mare Moscoviense", 27.3, 147.9], ["Tycho", -43.3, -11.2],
      ["Copernicus", 9.6, -20.1], ["Kepler", 8.1, -38], ["Aristarchus", 23.7, -47.4], ["Plato", 51.6, -9.4], ["Tsiolkovskiy", -20.4, 129.1],
      ["South Pole–Aitken", -53, -169],
    ];
    const MOON_SITES = [
      ["Apollo 11", 0.674, 23.473], ["Apollo 12", -3.012, -23.422], ["Apollo 14", -3.645, -17.471], ["Apollo 15", 26.132, 3.634],
      ["Apollo 16", -8.973, 15.498], ["Apollo 17", 20.191, 30.772], ["Luna 9", 7.08, -64.37], ["Chang'e 4", -45.445, 177.599],
    ];
    const MARS_FEATURES = [
      ["Olympus Mons", 18.65, -133.8], ["Valles Marineris", -13.9, -59.2], ["Hellas Planitia", -42.4, 70.5], ["Argyre Planitia", -49.7, -43.4],
      ["Utopia Planitia", 46.7, 117.5], ["Tharsis Montes", 1.6, -112.5], ["Elysium Mons", 25.02, 147.21], ["Syrtis Major", 8.4, 69.5], ["Acidalia Planitia", 46.7, -22],
    ];
    const MARS_SITES = [
      ["Curiosity", -4.59, 137.44], ["Perseverance", 18.44, 77.45], ["Viking 1", 22.27, -47.95], ["Viking 2", 47.67, 134.28],
      ["Zhurong", 25.07, 109.93], ["Opportunity", -1.95, -5.53], ["Spirit", -14.57, 175.47], ["Pathfinder", 19.13, -33.22],
    ];
    const fc = (list, kind) => ({ type: "FeatureCollection", features: list.map(([name, lat, lng]) => ({ type: "Feature", properties: { name, kind }, geometry: { type: "Point", coordinates: [lng, lat] } })) });
    const PLANET_CREDIT = 'Planet imagery: <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener noreferrer">Solar System Scope</a> (CC BY 4.0), based on NASA data';
    const MOON_ATTRIBUTION = 'Moon imagery: <a href="https://svs.gsfc.nasa.gov/4720" target="_blank" rel="noopener noreferrer">NASA Scientific Visualization Studio, LRO (LROC and LOLA)</a>';
    // Bodies you can visit as a globe. The surface source is always called "moon" so the rest of
    // Maps knows the map is showing another world.
    const VISITS = {
      moon: { tiles: "/maps/moon/{z}/{x}/{y}.jpg", maxzoom: 4, icon: "bedtime", features: MOON_FEATURES, sites: MOON_SITES, credit: MOON_ATTRIBUTION },
      sun: { tiles: "/maps/planets/sun/{z}/{x}/{y}.jpg", maxzoom: 3, icon: "sunny", credit: PLANET_CREDIT },
      mercury: { tiles: "/maps/planets/mercury/{z}/{x}/{y}.jpg", maxzoom: 3, icon: "public", credit: PLANET_CREDIT },
      venus: { tiles: "/maps/planets/venus/{z}/{x}/{y}.jpg", maxzoom: 3, icon: "public", credit: PLANET_CREDIT },
      mars: { tiles: "/maps/planets/mars/{z}/{x}/{y}.jpg", maxzoom: 3, icon: "public", features: MARS_FEATURES, sites: MARS_SITES, credit: PLANET_CREDIT },
      jupiter: { tiles: "/maps/planets/jupiter/{z}/{x}/{y}.jpg", maxzoom: 3, icon: "public", credit: PLANET_CREDIT },
      saturn: { tiles: "/maps/planets/saturn/{z}/{x}/{y}.jpg", maxzoom: 3, icon: "public", credit: PLANET_CREDIT },
      uranus: { tiles: "/maps/planets/uranus/{z}/{x}/{y}.jpg", maxzoom: 2, icon: "public", credit: PLANET_CREDIT },
      neptune: { tiles: "/maps/planets/neptune/{z}/{x}/{y}.jpg", maxzoom: 2, icon: "public", credit: PLANET_CREDIT },
    };
    let currentBody = null;
    function bodyStyle(id) {
      const body = VISITS[id];
      const style = {
        version: 8,
        projection: { type: "globe" },
        sources: { moon: { type: "raster", tiles: [location.origin + body.tiles], tileSize: 256, maxzoom: body.maxzoom } },
        layers: [{ id: "moon-surface", type: "raster", source: "moon", paint: { "raster-fade-duration": 0 } }],
      };
      if (body.sites) {
        style.sources["moon-sites"] = { type: "geojson", data: fc(body.sites, "site") };
        style.layers.push({ id: "moon-sites-dot", type: "circle", source: "moon-sites", paint: { "circle-radius": 5, "circle-color": "#ffd166", "circle-stroke-color": "#1b1030", "circle-stroke-width": 2 } });
      }
      if (body.features) {
        style.sources["moon-features"] = { type: "geojson", data: fc(body.features, "feature") };
        style.layers.push({
          id: "moon-feature-labels", type: "symbol", source: "moon-features",
          layout: { "text-field": ["get", "name"], "text-font": ["Munetios UI v4 Font"], "text-size": 18, "text-max-width": 8 },
          paint: { "text-color": "#f4f1ff", "text-halo-color": "rgba(10, 6, 24, 0.85)", "text-halo-width": 2 },
        });
      }
      if (body.sites) {
        style.layers.push({
          id: "moon-site-labels", type: "symbol", source: "moon-sites",
          layout: { "text-field": ["get", "name"], "text-font": ["Munetios UI v4 Font"], "text-size": 18, "text-offset": [0, 1.2], "text-anchor": "top" },
          paint: { "text-color": "#ffd166", "text-halo-color": "rgba(10, 6, 24, 0.9)", "text-halo-width": 2 },
        });
      }
      return style;
    }
    let earthView = null;
    const bar = document.createElement("div");
    bar.className = "mf-moon-bar";
    bar.hidden = true;
    bar.setAttribute("role", "status");
    bar.innerHTML = `<span class="mu-icon mf-moon-icon" aria-hidden="true">bedtime</span><div class="mf-moon-bar-text"><span class="mf-moon-title"></span><span class="mf-moon-sub"></span></div><button type="button" class="mu-btn mf-moon-solar"><span class="mu-icon" aria-hidden="true">brightness_low</span><span class="mf-moon-solar-label"></span></button><button type="button" class="mu-btn mu-btn-primary mf-moon-back"><span class="mu-icon" aria-hidden="true">public</span><span class="mf-moon-back-label"></span></button>`;
    document.body.append(bar);
    bar.querySelector(".mf-moon-back").addEventListener("click", () => exitMoon());
    bar.querySelector(".mf-moon-solar").addEventListener("click", () => window.MunetiosSolar?.open?.({ focus: currentBody }));
    function paintBar() {
      const id = currentBody || "moon";
      bar.querySelector(".mf-moon-icon").textContent = VISITS[id]?.icon || "public";
      bar.querySelector(".mf-moon-title").textContent = T(id, id);
      bar.querySelector(".mf-moon-sub").textContent = id === "moon"
        ? `${moonInfo.name} · ${Math.round(moonInfo.fraction * 100)}%`
        : window.MunetiosSolar?.distanceText?.(id) || "";
      bar.querySelector(".mf-moon-back-label").textContent = T("backToEarth", "Back to Earth");
      bar.querySelector(".mf-moon-solar-label").textContent = T("solarSystem", "Solar system");
      bar.querySelector(".mf-moon-solar").hidden = !window.MunetiosSolar;
    }
    const attribution = document.getElementById("attributionMaps");
    let earthAttribution = "";
    // The address keeps the Earth view while another world is open.
    const replaceState = history.replaceState.bind(history);
    history.replaceState = function (state, title, url) {
      if (isMoon() && earthView && typeof url === "string" && url.includes("cord=")) url = earthView.hash || location.pathname;
      return replaceState(state, title, url);
    };
    function enterBody(id) {
      if (!VISITS[id]) return;
      if (!isMoon()) {
        earthView = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), hash: location.hash };
        if (attribution) earthAttribution = attribution.innerHTML;
      }
      currentBody = id;
      if (attribution) attribution.innerHTML = VISITS[id].credit;
      document.body.classList.add("mf-moon-mode");
      moonBtn.hidden = true;
      paintBar();
      bar.hidden = false;
      map.once("style.load", () => {
        try { map.setProjection({ type: "globe" }); } catch {}
        try { map.setSky({ "sky-color": "#000000", "horizon-color": "#000000", "sky-horizon-blend": 0, "atmosphere-blend": 0 }); } catch {}
      });
      map.setStyle(bodyStyle(id), { diff: false });
      map.jumpTo({ center: [id === "moon" ? 10 : 0, 5], zoom: 1.3, bearing: 0, pitch: 0 });
      setTimeout(() => bar.querySelector(".mf-moon-back").focus(), 60);
    }
    const enterMoon = () => enterBody("moon");
    function leaveMoonUi() {
      document.body.classList.remove("mf-moon-mode");
      bar.hidden = true;
      currentBody = null;
      if (attribution && earthAttribution) attribution.innerHTML = earthAttribution;
    }
    function exitMoon(view = earthView) {
      if (!isMoon()) return;
      leaveMoonUi();
      if (typeof window._refreshMapStyle === "function") window._refreshMapStyle();
      if (view && view.center) {
        map.jumpTo({ center: view.center, zoom: view.zoom, bearing: view.bearing, pitch: view.pitch });
        try { history.replaceState(null, "", view.hash || location.pathname); } catch {}
      }
      setTimeout(() => renderMoon(true), 300);
    }
    // Anything else that swaps the map style (theme, layer) also ends the Moon view.
    map.on("style.load", () => { if (isMoon() && !map.getSource("moon")) leaveMoonUi(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isMoon() && !document.querySelector(".mu-modal:not([hidden])") && !document.querySelector(".mf-solar:not([hidden])")) exitMoon(); });

    function refreshSatellite() {
      const source = map.getSource("munetios-satellite");
      if (!source?.setTiles) return;
      currentBucket = bucket();
      source.setTiles([`munetios-sat://{z}/{x}/{y}?t=${currentBucket}&n=${satNightOn() ? 1 : 0}`]);
    }

    Object.assign(window.MunetiosSpace, { enterMoon, enterBody, exitMoon: () => exitMoon(), isMoon, currentBody: () => currentBody, earthView: () => earthView, canVisit: (id) => Boolean(VISITS[id]), refreshSatellite, moonState: () => moonInfo, globeRadius, paintBar });
    document.dispatchEvent(new CustomEvent("maps-space-ready"));
  }
  if (window._mapsApi) start();
  else document.addEventListener("maps-ready", start, { once: true });
})();
