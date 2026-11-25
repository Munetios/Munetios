/*!
 * Ganetios Weather: location picker map.
 * MapLibre GL with OpenMapTiles vector tiles (served by OpenFreeMap), restyled in
 * Ganetios purple. Labels use Munetios UI v4 Font: glyphs are rendered as signed
 * distance fields in the browser from the local font file, so no third-party
 * font server is contacted.
 */
(function () {
  "use strict";
  const MAPLIBRE = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";
  const TILES = "https://tiles.openfreemap.org/planet";
  const FONT = "Munetios UI v4 Font";
  const FONTSTACK = ["Munetios UI v4 Font Regular"];
  let loading = null;

  function loadLibrary() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = MAPLIBRE + ".css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = MAPLIBRE + ".js";
      s.async = true;
      s.onload = () => { registerGlyphs(window.maplibregl); resolve(window.maplibregl); };
      s.onerror = () => { loading = null; reject(new Error("map")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // ------------------------------------------------------------ SDF glyphs (TinySDF algorithm)
  const INF = 1e20;
  const SIZE = 24;
  const BUFFER = 3;
  const RADIUS = 8;
  const CUTOFF = 0.25;
  let sdf = null;
  function sdfRenderer() {
    if (sdf) return sdf;
    const size = SIZE + BUFFER * 4;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.font = `400 ${SIZE}px "${FONT}", system-ui, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "black";
    const n = size * 2 + 2;
    sdf = { size, ctx, outer: new Float64Array(n * n), inner: new Float64Array(n * n), f: new Float64Array(n), z: new Float64Array(n + 1), v: new Uint16Array(n) };
    return sdf;
  }
  function edt1d(grid, offset, stride, length, f, v, z) {
    v[0] = 0; z[0] = -INF; z[1] = INF; f[0] = grid[offset];
    for (let q = 1, k = 0, s = 0; q < length; q++) {
      f[q] = grid[offset + q * stride];
      const q2 = q * q;
      do { const r = v[k]; s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2; } while (s <= z[k] && --k > -1);
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    for (let q = 0, k = 0; q < length; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k]; const qr = q - r;
      grid[offset + q * stride] = f[r] + qr * qr;
    }
  }
  function edt(data, x0, y0, width, height, gridSize, f, v, z) {
    for (let x = x0; x < x0 + width; x++) edt1d(data, y0 * gridSize + x, gridSize, height, f, v, z);
    for (let y = y0; y < y0 + height; y++) edt1d(data, y * gridSize + x0, 1, width, f, v, z);
  }
  function drawGlyph(char) {
    const s = sdfRenderer();
    const m = s.ctx.measureText(char);
    const advance = Math.round(m.width);
    const top = Math.ceil(m.actualBoundingBoxAscent);
    const gw = Math.max(0, Math.min(s.size - BUFFER, Math.ceil(m.actualBoundingBoxRight + m.actualBoundingBoxLeft)));
    const gh = Math.max(0, Math.min(s.size - BUFFER, top + Math.ceil(m.actualBoundingBoxDescent)));
    const left = Math.round(-m.actualBoundingBoxLeft);
    const width = gw + 2 * BUFFER;
    const height = gh + 2 * BUFFER;
    if (!gw || !gh) return { advance, width: 0, height: 0, left: 0, top: 0, data: null };
    const len = width * height;
    const { ctx, outer, inner, f, v, z } = s;
    ctx.clearRect(0, 0, s.size, s.size);
    ctx.fillText(char, BUFFER + m.actualBoundingBoxLeft, BUFFER + top);
    const img = ctx.getImageData(BUFFER, BUFFER, gw, gh).data;
    outer.fill(INF, 0, len);
    inner.fill(0, 0, len);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const a = img[4 * (y * gw + x) + 3] / 255;
        if (a === 0) continue;
        const j = (y + BUFFER) * width + x + BUFFER;
        if (a === 1) { outer[j] = 0; inner[j] = INF; }
        else { const d = 0.5 - a; outer[j] = d > 0 ? d * d : 0; inner[j] = d < 0 ? d * d : 0; }
      }
    }
    edt(outer, 0, 0, width, height, width, f, v, z);
    edt(inner, BUFFER, BUFFER, gw, gh, width, f, v, z);
    const data = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
      data[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / RADIUS + CUTOFF))));
    }
    // Same baseline calibration MapLibre uses for locally drawn glyphs.
    return { advance, width: gw, height: gh, left, top: top - 27, data };
  }

  // Minimal protobuf writer for the glyph PBF format.
  function writer() {
    const bytes = [];
    const w = {
      bytes,
      varint(n) { n >>>= 0; while (n > 127) { bytes.push((n & 127) | 128); n >>>= 7; } bytes.push(n); return w; },
      tag(field, type) { return w.varint((field << 3) | type); },
      uint(field, n) { return w.tag(field, 0).varint(n); },
      sint(field, n) { return w.tag(field, 0).varint((n << 1) ^ (n >> 31)); },
      buf(field, arr) { w.tag(field, 2).varint(arr.length); for (let i = 0; i < arr.length; i++) bytes.push(arr[i]); return w; },
      str(field, s) { return w.buf(field, new TextEncoder().encode(s)); },
    };
    return w;
  }
  const glyphCache = new Map();
  function glyphRange(name, start, end) {
    const key = start + "-" + end;
    if (glyphCache.has(key)) return glyphCache.get(key);
    const stack = writer().str(1, name).str(2, key);
    for (let id = start; id <= end; id++) {
      // Skip surrogates and control characters.
      if ((id >= 0xd800 && id <= 0xdfff) || id < 32) continue;
      const g = drawGlyph(String.fromCodePoint(id));
      const gwr = writer().uint(1, id);
      if (g.data) gwr.buf(2, g.data);
      gwr.uint(3, g.width).uint(4, g.height).sint(5, g.left).sint(6, g.top).uint(7, g.advance);
      stack.buf(3, gwr.bytes);
    }
    const out = new Uint8Array(writer().buf(1, stack.bytes).bytes).buffer;
    glyphCache.set(key, out);
    return out;
  }
  function registerGlyphs(ml) {
    ml.addProtocol("gwglyphs", async (params) => {
      const m = params.url.match(/gwglyphs:\/\/([^/]+)\/(\d+)-(\d+)/);
      if (!m) throw new Error("glyph");
      if (document.fonts && document.fonts.load) await document.fonts.load(`400 ${SIZE}px "${FONT}"`).catch(() => {});
      return { data: glyphRange(decodeURIComponent(m[1]), Number(m[2]), Number(m[3])) };
    });
  }

  // ------------------------------------------------------------ purple style
  const PALETTES = {
    dark: {
      bg: "#1a0f3d", water: "#2c1a73", wood: "#22134c", grass: "#251650", residential: "#1e1146", ice: "#3b2c7a",
      building: "#2d1c60", buildingLine: "#3a2774", minor: "#35256e", major: "#5b42b0", motorway: "#9a78ff", casing: "#130a30", rail: "#4a3a88",
      boundary: "#b39cff", text: "#f3edff", textMuted: "#cbbcff", halo: "#140a33", waterText: "#b8a6ff",
    },
    light: {
      bg: "#f5f1ff", water: "#c6b2ff", wood: "#e5d9ff", grass: "#e9dfff", residential: "#efe8ff", ice: "#ffffff",
      building: "#e6dcfb", buildingLine: "#d5c6f5", minor: "#ffffff", major: "#dccbff", motorway: "#b190ff", casing: "#cdbcf2", rail: "#bba8e8",
      boundary: "#7a52e0", text: "#2c1773", textMuted: "#5a43a8", halo: "#ffffff", waterText: "#5a3fc0",
    },
  };
  function nameExpr(lang) {
    const base = (lang || "en").split("-")[0];
    return ["coalesce", ["get", "name:" + base], ["get", "name_int"], ["get", "name"]];
  }
  function style(theme, lang) {
    const c = PALETTES[theme] || PALETTES.dark;
    const name = nameExpr(lang);
    const roadWidth = (base) => ["interpolate", ["exponential", 1.4], ["zoom"], 5, base * 0.3, 10, base, 14, base * 3, 18, base * 10];
    const textBase = { "text-font": FONTSTACK, "text-field": name, "text-max-width": 8 };
    const paintText = (col) => ({ "text-color": col, "text-halo-color": c.halo, "text-halo-width": 1.6, "text-halo-blur": 0.4 });
    return {
      version: 8,
      glyphs: "gwglyphs://{fontstack}/{range}",
      sources: { omt: { type: "vector", url: TILES } },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": c.bg } },
        { id: "landcover-wood", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", ["get", "class"], "wood"], paint: { "fill-color": c.wood, "fill-opacity": 0.8 } },
        { id: "landcover-grass", type: "fill", source: "omt", "source-layer": "landcover", filter: ["in", ["get", "class"], ["literal", ["grass", "farmland"]]], paint: { "fill-color": c.grass, "fill-opacity": 0.6 } },
        { id: "landcover-ice", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", ["get", "class"], "ice"], paint: { "fill-color": c.ice, "fill-opacity": 0.7 } },
        { id: "landuse-residential", type: "fill", source: "omt", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["residential", "suburb", "neighbourhood"]]], paint: { "fill-color": c.residential, "fill-opacity": 0.7 } },
        { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": c.grass, "fill-opacity": 0.7 } },
        { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": c.water } },
        { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": c.water, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2.5] } },
        { id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 13, paint: { "fill-color": c.building, "fill-outline-color": c.buildingLine } },
        { id: "road-minor", type: "line", source: "omt", "source-layer": "transportation", minzoom: 11, filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.minor, "line-width": roadWidth(0.8) } },
        { id: "road-path", type: "line", source: "omt", "source-layer": "transportation", minzoom: 14, filter: ["in", ["get", "class"], ["literal", ["path"]]], paint: { "line-color": c.minor, "line-width": 1, "line-dasharray": [2, 2] } },
        { id: "rail", type: "line", source: "omt", "source-layer": "transportation", minzoom: 10, filter: ["==", ["get", "class"], "rail"], paint: { "line-color": c.rail, "line-width": 1.2, "line-dasharray": [3, 2] } },
        { id: "road-major-casing", type: "line", source: "omt", "source-layer": "transportation", minzoom: 7, filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "trunk"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.casing, "line-width": roadWidth(1.6) } },
        { id: "road-major", type: "line", source: "omt", "source-layer": "transportation", minzoom: 7, filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "trunk"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.major, "line-width": roadWidth(1.1) } },
        { id: "road-motorway", type: "line", source: "omt", "source-layer": "transportation", minzoom: 5, filter: ["==", ["get", "class"], "motorway"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.motorway, "line-width": roadWidth(1.4) } },
        { id: "boundary-state", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]], paint: { "line-color": c.boundary, "line-opacity": 0.45, "line-width": 1, "line-dasharray": [3, 2] } },
        { id: "boundary-country", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]], paint: { "line-color": c.boundary, "line-opacity": 0.8, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1, 8, 2] } },
        { id: "water-name", type: "symbol", source: "omt", "source-layer": "water_name", layout: { ...textBase, "text-size": 18, "text-letter-spacing": 0.08 }, paint: paintText(c.waterText) },
        { id: "road-name", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 13, layout: { ...textBase, "symbol-placement": "line", "text-size": 18 }, paint: paintText(c.textMuted) },
        { id: "place-village", type: "symbol", source: "omt", "source-layer": "place", minzoom: 10, filter: ["in", ["get", "class"], ["literal", ["village", "hamlet", "suburb", "neighbourhood"]]], layout: { ...textBase, "text-size": 18 }, paint: paintText(c.textMuted) },
        { id: "place-town", type: "symbol", source: "omt", "source-layer": "place", minzoom: 7, filter: ["==", ["get", "class"], "town"], layout: { ...textBase, "text-size": ["interpolate", ["linear"], ["zoom"], 7, 18, 12, 22] }, paint: paintText(c.text) },
        { id: "place-city", type: "symbol", source: "omt", "source-layer": "place", minzoom: 3, filter: ["==", ["get", "class"], "city"], layout: { ...textBase, "text-size": ["interpolate", ["linear"], ["zoom"], 3, 18, 8, 24, 12, 28], "symbol-sort-key": ["get", "rank"] }, paint: paintText(c.text) },
        { id: "place-state", type: "symbol", source: "omt", "source-layer": "place", minzoom: 4, maxzoom: 8, filter: ["==", ["get", "class"], "state"], layout: { ...textBase, "text-size": 18, "text-letter-spacing": 0.06 }, paint: paintText(c.textMuted) },
        { id: "place-country", type: "symbol", source: "omt", "source-layer": "place", maxzoom: 7, filter: ["==", ["get", "class"], "country"], layout: { ...textBase, "text-size": ["interpolate", ["linear"], ["zoom"], 1, 18, 6, 26] }, paint: paintText(c.text) },
      ],
    };
  }

  /**
   * Create a picker map.
   * opts: { container, center:[lon,lat], zoom, theme, lang, locale, attribution, onPick(lngLat, point) }
   * onPick fires on right click and on a long press (touch or pen).
   */
  async function create(opts) {
    const ml = await loadLibrary();
    if (document.fonts && document.fonts.load) await document.fonts.load(`400 ${SIZE}px "${FONT}"`).catch(() => {});
    const map = new ml.Map({
      container: opts.container,
      style: style(opts.theme, opts.lang),
      locale: opts.locale,
      center: opts.center || [0, 20],
      zoom: opts.zoom ?? 2,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    });
    map.touchZoomRotate.disableRotation();
    map.on("error", (e) => console.warn("Ganetios map:", e && e.error ? e.error.message : e));
    map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
    // OpenFreeMap's TileJSON supplies the OpenMapTiles and OpenStreetMap attribution.
    map.addControl(new ml.AttributionControl({ compact: true }), "bottom-left");

    let marker = null;
    const api = {
      map,
      setTheme(theme, lang) { map.setStyle(style(theme, lang)); },
      flyTo(lon, lat, zoom) { map.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(map.getZoom(), 9), essential: true }); },
      mark(lon, lat) {
        if (!marker) {
          const el = document.createElement("div");
          el.className = "gw-map-pin";
          el.innerHTML = '<span class="mu-icon mu-icon-filled" aria-hidden="true">location_on</span>';
          marker = new ml.Marker({ element: el, anchor: "bottom" });
        }
        marker.setLngLat([lon, lat]).addTo(map);
      },
      resize() { map.resize(); },
      destroy() { map.remove(); },
    };

    map.on("contextmenu", (e) => { e.preventDefault(); opts.onPick?.(e.lngLat, e.point); });
    // Long press for touch and pen.
    let timer = null;
    let startPt = null;
    const cancel = () => { clearTimeout(timer); timer = null; };
    map.on("touchstart", (e) => {
      if (e.originalEvent.touches.length !== 1) return cancel();
      startPt = e.point;
      const ll = e.lngLat;
      const pt = e.point;
      timer = setTimeout(() => { timer = null; navigator.vibrate?.(20); opts.onPick?.(ll, pt); }, 550);
    });
    map.on("touchmove", (e) => { if (startPt && Math.hypot(e.point.x - startPt.x, e.point.y - startPt.y) > 10) cancel(); });
    map.on("touchend", cancel);
    map.on("touchcancel", cancel);
    map.on("movestart", (e) => { if (e.originalEvent && e.originalEvent.type !== "touchstart") cancel(); });
    return api;
  }

  window.GanetiosMap = Object.freeze({ create, loadLibrary });
})();
