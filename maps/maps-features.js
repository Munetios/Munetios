/*
 * Munetios Maps features on Munetios UI v4.
 * Uses window._mapsApi (exposed by the main Maps script) and MapLibre through api.map.
 * Saved views and map options live in "munetios-maps-extras", which syncs end to end.
 */
(() => {
  "use strict";

  const STR = window.MapsFeatureStrings || { en: {} };
  const UI = () => window.MunetiosUI;
  const langCode = () => {
    let code = "en";
    try { code = _getLang(); } catch { try { code = localStorage.getItem("munetios_lang") || navigator.language || "en"; } catch {} }
    if (code === "auto") code = navigator.language || "en";
    return code;
  };
  const lang = () => {
    const code = langCode();
    if (/^zh-(TW|HK|MO)$/i.test(code)) return STR["zh-Hant"] ? "zh-Hant" : "zh";
    const base = code.split("-")[0].toLowerCase();
    return STR[base] ? base : "en";
  };
  // Words Maps already translates in every locale are reused instead of duplicated.
  const ALIASES = { cancel: "confirm_cancel", delete: "confirm_delete", copied: "ctx_copied", copyCoordinates: "ctx_copy_coords", markers: "markers", bookmarks: "bookmarks" };
  function t(key, vars) {
    if (ALIASES[key] && window._mapsApi) {
      const own = window._mapsApi.t(ALIASES[key]);
      if (own && own !== ALIASES[key]) return own;
    }
    let value = (STR[lang()] && STR[lang()][key]) ?? STR.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) value = value.split("{" + k + "}").join(String(v));
    return value;
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
  }
  const icon = (name, extra = "") => h("span", { class: "mu-icon " + extra, "aria-hidden": "true", text: name });
  const toast = (msg, type = "success") => (UI()?.toast ? UI().toast(msg, { type }) : window._mapsApi?.toast(msg));
  const nmAn = (text) => String(text).replace(/\b[Aa]\.?\s?[Mm]\.?(?=$|[\s,)])/g, "NM").replace(/\b[Pp]\.?\s?[Mm]\.?(?=$|[\s,)])/g, "AN");
  const fmtTime = (d) => nmAn(d.toLocaleTimeString(langCode(), { hour: "numeric", minute: "2-digit" }));
  const fmtNum = (n, digits = 1) => new Intl.NumberFormat(langCode(), { maximumFractionDigits: digits }).format(n);
  const isoDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const imperial = () => (localStorage.getItem("munetios_units") || "imperial") === "imperial";

  /* ------------------------------------------------------------ extras store (synced) */
  const EXTRAS_KEY = "munetios-maps-extras";
  const DEFAULTS = { savedViews: [], autoDark: false, grid: false, dayNight: false, coordFormat: "dec", satNight: true, traffic: false, trafficShare: false };
  const readExtras = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(EXTRAS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } };
  let extras = readExtras();
  const saveExtras = (patch) => { extras = { ...extras, ...patch }; try { localStorage.setItem(EXTRAS_KEY, JSON.stringify(extras)); } catch {} };

  /* ------------------------------------------------------------ geometry */
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  function haversine(a, b) {
    const dLat = rad(b[1] - a[1]);
    const dLng = rad(b[0] - a[0]);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  function ringArea(coords) {
    // Spherical polygon area (square meters).
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[(i + 1) % coords.length];
      area += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
    }
    return Math.abs((area * R * R) / 2);
  }
  // Unit symbols are international, so they are not translated.
  function fmtDistance(m) {
    if (imperial()) {
      const ft = m * 3.28084;
      return ft < 1000 ? fmtNum(ft, 0) + " ft" : fmtNum(m / 1609.344, 2) + " mi";
    }
    return m < 1000 ? fmtNum(m, 0) + " m" : fmtNum(m / 1000, 2) + " km";
  }
  function fmtArea(m2) {
    if (imperial()) {
      const acres = m2 / 4046.856;
      return acres < 640 ? fmtNum(acres, 2) + " ac" : fmtNum(m2 / 2589988.11, 2) + " mi²";
    }
    return m2 < 1e6 ? fmtNum(m2 / 10000, 2) + " ha" : fmtNum(m2 / 1e6, 2) + " km²";
  }
  const COMPASS = ["dirN", "dirNE", "dirE", "dirSE", "dirS", "dirSW", "dirW", "dirNW"];
  const compassWord = (b) => t(COMPASS[Math.round(b / 45) % 8]);

  /* ------------------------------------------------------------ coordinate formats + Plus Codes */
  function toDMS(value, pos, neg) {
    const abs = Math.abs(value);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = ((mFloat - m) * 60).toFixed(1);
    return `${d}°${String(m).padStart(2, "0")}′${String(s).padStart(4, "0")}″${value >= 0 ? pos : neg}`;
  }
  const OLC = "23456789CFGHJMPQRVWX";
  function plusEncode(lat, lng, length = 10) {
    lat = Math.min(90 - 1e-10, Math.max(-90, lat)) + 90;
    lng = ((((lng + 180) % 360) + 360) % 360);
    let code = "";
    let res = 20;
    for (let i = 0; i < 5; i++) {
      const la = Math.floor(lat / res);
      const ln = Math.floor(lng / res);
      lat -= la * res;
      lng -= ln * res;
      code += OLC[la] + OLC[ln];
      res /= 20;
      if (code.length === 8) code += "+";
    }
    return code.slice(0, length + 1);
  }
  function plusDecode(code) {
    const clean = code.toUpperCase().replace(/\s/g, "");
    if (!/^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,}$/.test(clean)) return null;
    const digits = clean.replace("+", "").slice(0, 10);
    let lat = -90;
    let lng = -180;
    let res = 20;
    for (let i = 0; i < digits.length; i += 2) {
      lat += OLC.indexOf(digits[i]) * res;
      lng += OLC.indexOf(digits[i + 1]) * res;
      if (i + 2 < digits.length) res /= 20;
    }
    return [lat + res / 2, lng + res / 2];
  }
  function formatCoords(lat, lng, format = extras.coordFormat) {
    if (format === "dms") return toDMS(lat, "N", "S") + " " + toDMS(lng, "E", "W");
    if (format === "plus") return plusEncode(lat, lng);
    return lat.toFixed(5) + ", " + lng.toFixed(5);
  }
  function parseCoords(input) {
    const text = String(input || "").trim();
    const plus = plusDecode(text);
    if (plus) return plus;
    const dms = [...text.matchAll(/(-?\d+(?:[.,]\d+)?)\s*[°º]\s*(?:(\d+(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d+(?:[.,]\d+)?)\s*["″”]\s*)?([NSEW])?/gi)];
    if (dms.length === 2) {
      const val = (m) => {
        let v = Math.abs(parseFloat(m[1].replace(",", "."))) + (m[2] ? parseFloat(m[2].replace(",", ".")) / 60 : 0) + (m[3] ? parseFloat(m[3].replace(",", ".")) / 3600 : 0);
        if (m[1].startsWith("-") || /[SW]/i.test(m[4] || "")) v = -v;
        return v;
      };
      const first = dms[0];
      const second = dms[1];
      const lat = /[EW]/i.test(first[4] || "") ? val(second) : val(first);
      const lng = /[EW]/i.test(first[4] || "") ? val(first) : val(second);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
    }
    const nums = text.match(/-?\d+(?:\.\d+)?/g);
    if (nums && nums.length === 2) {
      const lat = parseFloat(nums[0]);
      const lng = parseFloat(nums[1]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
    }
    return null;
  }

  /* ------------------------------------------------------------ sun (NOAA) */
  function sunPosition(date) {
    const d = date.getTime() / 86400000 - 10957.5; // days since J2000
    const g = rad((357.529 + 0.98560028 * d) % 360);
    const q = (280.459 + 0.98564736 * d) % 360;
    const L = rad((q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360);
    const e = rad(23.439 - 0.00000036 * d);
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const decl = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const subLng = ((deg(ra) - gmst * 15 + 540) % 360) - 180;
    return { decl, subLng, subLat: deg(decl) };
  }
  function sunAltitude(date, lat, lng) {
    const { decl, subLng } = sunPosition(date);
    const ha = rad(lng - subLng);
    return deg(Math.asin(Math.sin(rad(lat)) * Math.sin(decl) + Math.cos(rad(lat)) * Math.cos(decl) * Math.cos(ha)));
  }
  function sunTimes(day, lat, lng) {
    // Scan the day minute by minute around -0.833° altitude (works for every latitude, including polar days).
    const start = new Date(day); start.setHours(0, 0, 0, 0);
    let rise = null;
    let set = null;
    let prev = sunAltitude(start, lat, lng);
    for (let m = 5; m <= 1440; m += 5) {
      const time = new Date(start.getTime() + m * 60000);
      const alt = sunAltitude(time, lat, lng);
      if (prev < -0.833 && alt >= -0.833 && !rise) rise = time;
      if (prev >= -0.833 && alt < -0.833 && !set) set = time;
      prev = alt;
    }
    const noonAlt = sunAltitude(new Date(start.getTime() + 720 * 60000), lat, lng);
    return { rise, set, polar: !rise && !set ? (noonAlt > 0 ? "day" : "night") : null };
  }

  /* ------------------------------------------------------------ overlays (survive style changes) */
  let map = null;
  const overlayAdders = [];
  const moonMode = () => document.body.classList.contains("mf-moon-mode");
  function runAdders() { overlayAdders.forEach((fn) => { if (moonMode() && map.getSource("moon")) return; try { fn(); } catch {} }); }
  function onStyle(adder) { overlayAdders.push(adder); if (map?.isStyleLoaded() && !(moonMode() && map.getSource("moon"))) adder(); }
  function setSource(id, data) {
    const src = map.getSource(id);
    if (src) src.setData(data);
    else map.addSource(id, { type: "geojson", data });
  }
  const emptyFC = () => ({ type: "FeatureCollection", features: [] });

  // Coordinate grid
  function gridData() {
    const b = map.getBounds();
    const z = map.getZoom();
    const step = z < 2 ? 30 : z < 3 ? 20 : z < 4 ? 10 : z < 5 ? 5 : z < 6 ? 2 : z < 7 ? 1 : z < 9 ? 0.5 : z < 11 ? 0.1 : z < 13 ? 0.05 : 0.01;
    const features = [];
    const west = Math.max(-180, Math.floor(b.getWest() / step) * step);
    const east = Math.min(180, Math.ceil(b.getEast() / step) * step);
    const south = Math.max(-85, Math.floor(b.getSouth() / step) * step);
    const north = Math.min(85, Math.ceil(b.getNorth() / step) * step);
    for (let x = west; x <= east + 1e-9; x += step) features.push({ type: "Feature", properties: { major: Math.abs(x) < 1e-9 }, geometry: { type: "LineString", coordinates: [[x, south], [x, north]] } });
    for (let y = south; y <= north + 1e-9; y += step) features.push({ type: "Feature", properties: { major: Math.abs(y) < 1e-9 }, geometry: { type: "LineString", coordinates: [[west, y], [east, y]] } });
    return { type: "FeatureCollection", features };
  }
  function addGrid() {
    if (!extras.grid) { if (map.getLayer("mf-grid")) map.removeLayer("mf-grid"); return; }
    setSource("mf-grid", gridData());
    if (!map.getLayer("mf-grid")) map.addLayer({ id: "mf-grid", type: "line", source: "mf-grid", paint: { "line-color": ["case", ["get", "major"], "rgba(255,180,80,0.8)", "rgba(196,170,255,0.45)"], "line-width": ["case", ["get", "major"], 1.6, 1] } });
  }
  // Day and night
  function nightData() {
    const { decl, subLng } = sunPosition(new Date());
    const coords = [];
    const tanD = Math.tan(decl) || 1e-6;
    for (let lng = -180; lng <= 180; lng += 2) {
      const lat = deg(Math.atan(-Math.cos(rad(lng - subLng)) / tanD));
      coords.push([lng, lat]);
    }
    const pole = decl > 0 ? -90 : 90;
    coords.push([180, pole], [-180, pole], coords[0]);
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } }] };
  }
  function addDayNight() {
    if (!extras.dayNight) { if (map.getLayer("mf-night")) map.removeLayer("mf-night"); return; }
    setSource("mf-night", nightData());
    if (!map.getLayer("mf-night")) map.addLayer({ id: "mf-night", type: "fill", source: "mf-night", paint: { "fill-color": "#060220", "fill-opacity": 0.38 } });
  }

  /* ------------------------------------------------------------ measure distance + area */
  const measure = { mode: null, points: [] };
  function measureData() {
    const pts = measure.points;
    const features = pts.map((p, i) => ({ type: "Feature", properties: { i }, geometry: { type: "Point", coordinates: p } }));
    if (pts.length > 1) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: measure.mode === "area" && pts.length > 2 ? [...pts, pts[0]] : pts } });
    if (measure.mode === "area" && pts.length > 2) features.push({ type: "Feature", properties: { fill: true }, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } });
    return { type: "FeatureCollection", features };
  }
  function addMeasure() {
    setSource("mf-measure", measure.mode ? measureData() : emptyFC());
    const layers = [
      { id: "mf-measure-fill", type: "fill", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#8f5cff", "fill-opacity": 0.22 } },
      { id: "mf-measure-line", type: "line", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#8f5cff", "line-width": 3, "line-dasharray": [2, 1.2] } },
      { id: "mf-measure-pts", type: "circle", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": "#ffffff", "circle-stroke-color": "#8f5cff", "circle-stroke-width": 3 } },
    ];
    for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer({ ...layer, source: "mf-measure" });
  }
  function measureTotals() {
    const pts = measure.points;
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += haversine(pts[i - 1], pts[i]);
    if (measure.mode === "area" && pts.length > 2) length += haversine(pts[pts.length - 1], pts[0]);
    return { length, area: measure.mode === "area" && pts.length > 2 ? ringArea(pts) : 0 };
  }
  function paintMeasure() {
    const panel = $("#mfMeasure");
    if (!measure.mode) { panel.hidden = true; map.getCanvas().style.cursor = ""; addMeasure(); return; }
    panel.hidden = false;
    map.getCanvas().style.cursor = "crosshair";
    const { length, area } = measureTotals();
    $("#mfMeasureTitle").textContent = measure.mode === "area" ? t("measureArea") : t("measureDistance");
    const big = measure.points.length < 2 ? t("measureHint") : measure.mode === "area" ? (area ? fmtArea(area) : t("measureHintArea")) : fmtDistance(length);
    $("#mfMeasureValue").textContent = big;
    $("#mfMeasureSub").textContent = measure.points.length < 2 ? "" : measure.mode === "area" ? t("perimeter", { value: fmtDistance(length) }) : t("pointsCount", { count: measure.points.length });
    $("#mfMeasureUndo").disabled = !measure.points.length;
    $("#mfMeasureCopy").disabled = measure.points.length < 2;
    addMeasure();
  }
  function startMeasure(mode) {
    measure.mode = measure.mode === mode ? null : mode;
    measure.points = [];
    paintMeasure();
    syncTrayStates();
  }
  function mountMeasurePanel() {
    const panel = h("section", { id: "mfMeasure", class: "mf-measure mu-glass", "aria-live": "polite", hidden: true }, [
      h("div", { class: "mf-measure-head" }, [icon("straighten"), h("h2", { id: "mfMeasureTitle", class: "mu-h-title" }),
        h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), title: t("close"), onclick: () => { measure.mode = null; measure.points = []; paintMeasure(); syncTrayStates(); } }, [icon("close")])]),
      h("div", { id: "mfMeasureValue", class: "mf-measure-value" }),
      h("div", { id: "mfMeasureSub", class: "mu-muted" }),
      h("div", { class: "mf-measure-actions" }, [
        h("button", { type: "button", id: "mfMeasureUndo", class: "mu-btn", onclick: () => { measure.points.pop(); paintMeasure(); } }, [icon("undo"), h("span", { text: t("undo") })]),
        h("button", { type: "button", class: "mu-btn", onclick: () => { measure.points = []; paintMeasure(); } }, [icon("delete_sweep"), h("span", { text: t("clear") })]),
        h("button", { type: "button", id: "mfMeasureCopy", class: "mu-btn mu-btn-primary", onclick: () => {
          const { length, area } = measureTotals();
          copyText(measure.mode === "area" ? fmtArea(area) + " · " + t("perimeter", { value: fmtDistance(length) }) : fmtDistance(length));
        } }, [icon("content_copy"), h("span", { text: t("copy") })]),
      ]),
    ]);
    document.body.append(panel);
    map.on("click", (e) => {
      if (!measure.mode) return;
      measure.points.push([e.lngLat.lng, e.lngLat.lat]);
      paintMeasure();
    });
  }

  /* ------------------------------------------------------------ map controls: compass, 3D, fullscreen, scale, readout */
  let scale = null;
  function mountControls() {
    const stack = h("div", { id: "mfControls", class: "mf-controls" }, [
      h("button", { type: "button", id: "mfCompass", class: "mf-ctrl mu-glass", "aria-label": t("resetNorth"), title: t("resetNorth"), onclick: () => map.easeTo({ bearing: 0, pitch: map.getPitch() > 0 && map.getBearing() === 0 ? 0 : map.getPitch(), duration: 500 }) }, [h("span", { class: "mf-compass-needle", "aria-hidden": "true" }, [icon("navigation", "mu-icon-filled")])]),
      h("button", { type: "button", id: "mfTilt", class: "mf-ctrl mu-glass", "aria-label": t("toggle3d"), title: t("toggle3d"), "aria-pressed": "false", onclick: () => toggleTilt() }, [h("span", { class: "mf-ctrl-text", text: "3D" })]),
      h("button", { type: "button", id: "mfFullscreen", class: "mf-ctrl mu-glass", "aria-label": t("fullscreen"), title: t("fullscreen"), onclick: () => toggleFullscreen() }, [icon("fullscreen")]),
    ]);
    document.body.append(stack);
    const readout = h("button", { type: "button", id: "mfReadout", class: "mf-readout mu-glass", title: t("copyCoordinates"), "aria-label": t("copyCoordinates"), onclick: () => { const c = map.getCenter(); copyText(formatCoords(c.lat, c.lng)); } }, [icon("my_location"), h("span", { id: "mfReadoutText" })]);
    const formatBtn = h("button", { type: "button", id: "mfFormat", class: "mf-readout-format mu-glass", title: t("coordinateFormat"), "aria-label": t("coordinateFormat"), onclick: () => {
      const order = ["dec", "dms", "plus"];
      saveExtras({ coordFormat: order[(order.indexOf(extras.coordFormat) + 1) % order.length] });
      paintReadout();
      toast(t("formatNow", { format: { dec: "DD", dms: "DMS", plus: "Plus Code" }[extras.coordFormat] }), "info");
    } }, [h("span", { id: "mfFormatText" })]);
    document.body.append(h("div", { id: "mfReadoutWrap", class: "mf-readout-wrap" }, [readout, formatBtn]));
    const updateCompass = () => {
      $(".mf-compass-needle").style.transform = `rotate(${-map.getBearing()}deg)`;
      $("#mfTilt").setAttribute("aria-pressed", String(map.getPitch() > 5));
    };
    map.on("rotate", updateCompass);
    map.on("pitch", updateCompass);
    map.on("move", paintReadout);
    updateCompass();
    paintReadout();
    addScale();
    document.addEventListener("fullscreenchange", () => { $("#mfFullscreen .mu-icon").textContent = document.fullscreenElement ? "fullscreen_exit" : "fullscreen"; });
  }
  function paintReadout() {
    const c = map.getCenter();
    const text = $("#mfReadoutText");
    if (text) text.textContent = formatCoords(c.lat, c.lng);
    const f = $("#mfFormatText");
    if (f) f.textContent = { dec: "DD", dms: "DMS", plus: "+" }[extras.coordFormat] || "DD";
  }
  function addScale() {
    if (scale) map.removeControl(scale);
    scale = new maplibregl.ScaleControl({ maxWidth: 140, unit: imperial() ? "imperial" : "metric" });
    map.addControl(scale, "bottom-left");
  }
  function toggleTilt() { map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 60, duration: 700 }); }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => toast(t("fullscreenFailed"), "error"));
  }

  /* ------------------------------------------------------------ helpers: copy, download, dialogs */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast(t("copied")); } catch { toast(t("copyFailed"), "error"); }
  }
  function download(name, type, data) {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  let dialogs = 0;
  function promptDialog({ title, label, value = "", iconName = "edit", confirm, help, placeholder }) {
    return new Promise((resolve) => {
      const id = "mfPrompt" + ++dialogs;
      const input = h("input", { class: "mu-input", type: "text", value, placeholder, autocomplete: "off" });
      const modal = h("div", { class: "mu-modal mf-modal", id, hidden: true }, [
        h("form", { class: "mu-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": id + "T" }, [
          h("div", { class: "mu-dialog-header" }, [
            h("div", { class: "mu-dialog-heading" }, [h("span", { class: "mu-icon-circle" }, [icon(iconName)]), h("h2", { id: id + "T", text: title })]),
            h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), "data-x": "" }, [icon("close")]),
          ]),
          h("label", { class: "mu-field" }, [h("span", { class: "mu-field-label", text: label }), input, help ? h("span", { class: "mu-field-help", text: help }) : null]),
          h("div", { class: "mu-dialog-actions" }, [
            h("button", { type: "button", class: "mu-btn", "data-x": "", text: t("cancel") }),
            h("button", { type: "submit", class: "mu-btn mu-btn-primary", text: confirm || t("save") }),
          ]),
        ]),
      ]);
      document.body.append(modal);
      const finish = (result) => { UI().closeModal(modal); modal.remove(); resolve(result); };
      modal.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); finish(input.value.trim() || null); });
      modal.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => finish(null)));
      modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); finish(null); } });
      UI().openModal(id);
      setTimeout(() => { input.focus(); input.select(); }, 40);
    });
  }
  function infoDialog(id, title, iconName, body) {
    $("#" + id)?.remove();
    const modal = h("div", { class: "mu-modal mf-modal", id, hidden: true }, [
      h("div", { class: "mu-dialog mu-dialog-md", role: "dialog", "aria-modal": "true", "aria-labelledby": id + "T" }, [
        h("div", { class: "mu-dialog-header" }, [
          h("div", { class: "mu-dialog-heading" }, [h("span", { class: "mu-icon-circle" }, [icon(iconName)]), h("h2", { id: id + "T", text: title })]),
          h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), "data-mu-close": "" }, [icon("close")]),
        ]),
        body,
      ]),
    ]);
    document.body.append(modal);
    UI().openModal(id);
    return modal;
  }

  /* ------------------------------------------------------------ share, go to, sun, image */
  async function shareView() {
    const c = map.getCenter();
    const url = location.origin + location.pathname + `#cord=${c.lat.toFixed(6)},${c.lng.toFixed(6)},${map.getZoom().toFixed(2)}`;
    if (navigator.share) {
      try { await navigator.share({ title: document.title, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    copyText(url);
  }
  let tempPin = null;
  async function goToCoordinates() {
    const value = await promptDialog({ title: t("goToCoordinates"), label: t("coordinates"), iconName: "pin_drop", confirm: t("go"), placeholder: "40.7128, -74.0060", help: t("goToHelp") });
    if (!value) return;
    const coords = parseCoords(value);
    if (!coords) { toast(t("coordsInvalid"), "error"); return; }
    flyToPin(coords[0], coords[1]);
  }
  function flyToPin(lat, lng, zoom = 15) {
    map.flyTo({ center: [lng, lat], zoom, speed: 1.4 });
    tempPin?.remove();
    const el = h("div", { class: "mf-temp-pin", "aria-hidden": "true" });
    tempPin = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
    const api = window._mapsApi;
    setTimeout(() => api?.openCustomMapPopup?.(lng, lat, `<div class="mf-pin-popup"><div class="mf-pin-coords">${formatCoords(lat, lng, "dec")}</div><div class="mf-pin-coords">${formatCoords(lat, lng, "dms")}</div><div class="mf-pin-coords">${plusEncode(lat, lng)}</div></div>`), 900);
  }
  function showSunTimes() {
    const c = map.getCenter();
    const today = new Date();
    const s = sunTimes(today, c.lat, c.lng);
    const rows = [];
    if (s.polar) rows.push(h("p", { class: "mf-sun-polar", text: s.polar === "day" ? t("polarDay") : t("polarNight") }));
    else {
      const len = s.rise && s.set ? (s.set - s.rise) / 60000 : null;
      rows.push(
        h("div", { class: "mf-sun-row" }, [icon("wb_twilight"), h("span", { text: t("sunrise") }), h("span", { class: "mf-sun-time", text: s.rise ? fmtTime(s.rise) : "—" })]),
        h("div", { class: "mf-sun-row" }, [icon("wb_sunny"), h("span", { text: t("sunset") }), h("span", { class: "mf-sun-time", text: s.set ? fmtTime(s.set) : "—" })]),
        len && len > 0 ? h("div", { class: "mf-sun-row" }, [icon("schedule"), h("span", { text: t("dayLength") }), h("span", { class: "mf-sun-time", text: t("hoursMinutes", { h: Math.floor(len / 60), m: Math.round(len % 60) }) })]) : null,
      );
    }
    const alt = sunAltitude(new Date(), c.lat, c.lng);
    rows.push(h("div", { class: "mf-sun-row" }, [icon(alt > 0 ? "light_mode" : "dark_mode"), h("span", { text: t("sunNow") }), h("span", { class: "mf-sun-time", text: alt > 0 ? t("sunUp", { value: fmtNum(alt, 0) }) : t("sunDown") })]));
    infoDialog("mfSun", t("sunTimes"), "wb_twilight", h("div", { class: "mf-sun" }, [h("p", { class: "mu-muted", text: formatCoords(c.lat, c.lng, "dec") + " · " + t("timesInYourZone") }), ...rows]));
  }
  // Markers are HTML on top of the map, so the canvas alone has no pins.
  // Each visible marker is drawn onto a copy of the map at the canvas pixel ratio.
  const isClear = (color) => !color || color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
  function markerVisual(marker) {
    for (const el of [marker, ...marker.querySelectorAll("*")]) {
      const cs = getComputedStyle(el);
      if (!isClear(cs.backgroundColor) && el.offsetWidth >= 8) return { el, cs };
    }
    return null;
  }
  function drawPin(ctx, tipX, tipY, size, fill, stroke, badge) {
    const r = size / 2;
    const cx = tipX;
    const cy = tipY - r * Math.SQRT2;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.strokeStyle = stroke;
    ctx.stroke();
    if (badge) {
      ctx.beginPath();
      ctx.arc(cx + r * 0.85, cy - r * 0.85, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = badge;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, size * 0.08);
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawMarkers(ctx, scale, target = map, area = null) {
    const canvasRect = area || target.getCanvas().getBoundingClientRect();
    target.getContainer().querySelectorAll(".maplibregl-marker").forEach((marker) => {
      const ms = getComputedStyle(marker);
      if (ms.display === "none" || ms.visibility === "hidden" || Number(ms.opacity) < 0.3) return; // hidden or behind the globe
      const visual = markerVisual(marker);
      if (!visual) return;
      const box = marker.getBoundingClientRect();
      if (box.right < canvasRect.left || box.left > canvasRect.right || box.bottom < canvasRect.top || box.top > canvasRect.bottom) return;
      const { el, cs } = visual;
      const fill = cs.backgroundColor;
      const stroke = isClear(cs.borderTopColor) || cs.borderTopWidth === "0px" ? "#ffffff" : cs.borderTopColor;
      const size = el.offsetWidth * scale;
      const isPin = cs.borderBottomLeftRadius === "0px" && cs.borderTopLeftRadius !== "0px";
      const x = (box.left + box.width / 2 - canvasRect.left) * scale;
      if (isPin) {
        const dot = [...el.children].map((c) => getComputedStyle(c).backgroundColor).find((c) => !isClear(c));
        drawPin(ctx, x, (box.bottom - canvasRect.top) * scale, size, fill, stroke, dot);
      } else {
        const r = el.getBoundingClientRect();
        const y = (r.top + r.height / 2 - canvasRect.top) * scale;
        ctx.save();
        ctx.beginPath();
        ctx.arc((r.left + r.width / 2 - canvasRect.left) * scale, y, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        if (cs.borderTopWidth !== "0px") { ctx.lineWidth = parseFloat(cs.borderTopWidth) * scale; ctx.strokeStyle = stroke; ctx.stroke(); }
        ctx.restore();
      }
    });
  }
  function saveImage() {
    map.once("render", () => {
      try {
        const source = map.getCanvas();
        const out = document.createElement("canvas");
        out.width = source.width;
        out.height = source.height;
        const ctx = out.getContext("2d");
        // Fill the space around the globe so the image isn't transparent there.
        ctx.fillStyle = getComputedStyle(map.getContainer()).backgroundColor || "#05070f";
        if (isClear(ctx.fillStyle)) ctx.fillStyle = "#05070f";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(source, 0, 0);
        drawMarkers(ctx, source.width / source.getBoundingClientRect().width);
        out.toBlob((blob) => {
          if (!blob) { toast(t("imageFailed"), "error"); return; }
          download("munetios-maps-" + isoDay(new Date()) + ".png", "image/png", blob);
          toast(t("imageSaved"));
        }, "image/png");
      } catch { toast(t("imageFailed"), "error"); }
    });
    map.triggerRepaint();
  }


  /* ------------------------------------------------------------ navigation */
  // The next maneuver ("Then …") and the steps panel for the full-screen navigation view.
  function paintNextStep() {
    const list = $("#navStepsList");
    const box = $("#navNextStep");
    if (!list || !box) return;
    const active = list.querySelector(".nav-step-active");
    const next = active ? active.nextElementSibling : list.children[1];
    if (!next) { box.hidden = true; return; }
    const iconEl = next.querySelector("icon");
    const textEl = next.querySelector(":scope > div > div:first-child");
    $("#navNextIcon").textContent = iconEl ? iconEl.textContent.trim() : "straight";
    $("#navNextText").textContent = textEl ? textEl.textContent.trim() : "";
    box.hidden = !$("#navNextText").textContent;
  }
  function setStepsOpen(open) {
    const side = $("#navOverlaySide");
    const btn = $("#navStepsBtn");
    if (!side || !btn) return;
    side.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) side.querySelector(".nav-step-active")?.scrollIntoView({ block: "nearest" });
  }
  function setupNavigation() {
    const list = $("#navStepsList");
    if (list) new MutationObserver(paintNextStep).observe(list, { childList: true });
    $("#navStepsBtn")?.addEventListener("click", () => setStepsOpen($("#navOverlaySide").hidden));
    $("#navStepsClose")?.addEventListener("click", () => { setStepsOpen(false); $("#navStepsBtn")?.focus(); });
    const overlay = $("#navOverlay");
    if (overlay) {
      // Each trip starts with the steps panel closed.
      new MutationObserver(() => { if (overlay.style.display === "none") setStepsOpen(false); else paintNextStep(); }).observe(overlay, { attributes: true, attributeFilter: ["style"] });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay && overlay.style.display !== "none" && !$("#navOverlaySide").hidden) { setStepsOpen(false); e.stopPropagation(); }
    }, true);
  }

  /* ------------------------------------------------------------ print */
  // Print straight from the preview: the area inside the paper frame, with marker pins,
  // the Munetios Maps badge, and map attribution. The older print window stays as a fallback.
  let previewPins = [];
  function syncPreviewPins() {
    const pm = window._mapsApi?.getPrintMap?.();
    if (!pm || !window.maplibregl) return;
    previewPins.forEach((m) => m.remove());
    previewPins = [];
    (window._mapsApi.getMarkers() || []).forEach((mk) => {
      const lat = Number(mk.lat);
      const lng = Number(mk.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const el = document.createElement("div");
      el.className = "pp-pin";
      el.style.cssText = "width:20px;height:20px;background:#ff5722;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,0.4);position:relative";
      if (mk.imageUrl) {
        const dot = document.createElement("div");
        dot.style.cssText = "position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid #fff;transform:rotate(45deg)";
        el.appendChild(dot);
      }
      el.title = mk.label || "";
      previewPins.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(pm));
    });
  }
  const pressed = (cls, attr, fallback) => $(`.${cls}[aria-pressed="true"]`)?.dataset[attr] || fallback;
  function attributionText(tile) {
    const html = window._mapsApi?.attribution?.(tile) || "";
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }
  function drawAttribution(ctx, w, h, text) {
    if (!text) return;
    const scale = Math.max(1, Math.min(w, h) / 900);
    const size = Math.round(14 * scale);
    const pad = Math.round(8 * scale);
    const lineHeight = Math.round(size * 1.35);
    ctx.save();
    ctx.font = `400 ${size}px "Munetios Sans", "Munetios UI v4 Font", system-ui, sans-serif`;
    // Wrap instead of cutting the attribution short; the badge keeps the bottom-right corner.
    const maxWidth = Math.max(160 * scale, w * 0.58 - pad * 2);
    const lines = [];
    let line = "";
    text.split(" ").forEach((word) => {
      const next = line ? line + " " + word : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
    });
    if (line) lines.push(line);
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    const boxH = lines.length * lineHeight + pad * 2;
    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.fillRect(0, h - boxH, boxW, boxH);
    ctx.fillStyle = "#1a1033";
    ctx.textBaseline = "middle";
    lines.forEach((l, i) => ctx.fillText(l, pad, h - boxH + pad + lineHeight * i + lineHeight / 2));
    ctx.restore();
  }
  function composePrint() {
    const pm = window._mapsApi?.getPrintMap?.();
    const frame = $("#printPaperFrame");
    if (!pm || !frame) return "";
    const canvas = pm.getCanvas();
    const canvasRect = canvas.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const left = Math.max(canvasRect.left, frameRect.left);
    const top = Math.max(canvasRect.top, frameRect.top);
    const right = Math.min(canvasRect.right, frameRect.right);
    const bottom = Math.min(canvasRect.bottom, frameRect.bottom);
    if (right <= left || bottom <= top) return "";
    const ratio = canvas.width / canvasRect.width;
    const sw = (right - left) * ratio;
    const sh = (bottom - top) * ratio;
    const out = document.createElement("canvas");
    out.width = Math.round(sw);
    out.height = Math.round(sh);
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, (left - canvasRect.left) * ratio, (top - canvasRect.top) * ratio, sw, sh, 0, 0, out.width, out.height);
    drawMarkers(ctx, ratio, pm, { left, top, right, bottom });
    drawAttribution(ctx, out.width, out.height, attributionText(pressed("pp-tile-opt", "tile", "map")));
    return out.toDataURL("image/png");
  }
  function printImage(url) {
    const size = pressed("pp-size-opt", "size", "letter") === "a4" ? "A4" : "letter";
    const orient = pressed("pp-orient-opt", "orient", "landscape") === "portrait" ? "portrait" : "landscape";
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Munetios Maps</title><style>@page{size:${size} ${orient};margin:0}html,body{margin:0;height:100%;background:#fff}img{display:block;width:100vw;height:100vh;object-fit:contain}</style></head><body><img alt="Munetios Maps"></body></html>`);
    doc.close();
    const img = doc.querySelector("img");
    return new Promise((resolve, reject) => {
      img.onload = () => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
          resolve(true);
        } catch (err) { reject(err); }
        setTimeout(() => frame.remove(), 60000);
      };
      img.onerror = () => { frame.remove(); reject(new Error("print image")); };
      img.src = url;
    });
  }
  // The preview re-renders at about 300 DPI for the chosen paper, within what the GPU supports.
  const PRINT_DPI = 300;
  function printPixelRatio(pm) {
    const frame = $("#printPaperFrame");
    const canvas = pm.getCanvas();
    if (!frame || !canvas) return 1;
    const longInches = pressed("pp-size-opt", "size", "letter") === "a4" ? 11.69 : 11;
    const shortInches = pressed("pp-size-opt", "size", "letter") === "a4" ? 8.27 : 8.5;
    const portrait = pressed("pp-orient-opt", "orient", "landscape") === "portrait";
    const paperW = (portrait ? shortInches : longInches) * PRINT_DPI;
    const frameW = frame.getBoundingClientRect().width || 1;
    let ratio = paperW / frameW;
    try {
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
      const rect = canvas.getBoundingClientRect();
      ratio = Math.min(ratio, (maxSize - 2) / Math.max(rect.width, rect.height, 1));
    } catch { ratio = Math.min(ratio, 3); }
    return Math.max(1, ratio);
  }
  async function printFromPreview(button) {
    const api = window._mapsApi;
    button.disabled = true;
    try {
      const pm = api.getPrintMap();
      if (pm && !pm.loaded()) await new Promise((r) => { pm.once("idle", r); setTimeout(r, 6000); });
      const ratio = printPixelRatio(pm);
      let raw = "";
      if (ratio > pm.getPixelRatio() && typeof pm.setPixelRatio === "function") {
        try { api.toast?.(api.t?.("print_loading_tiles") || ""); } catch {}
        const normal = pm.getPixelRatio();
        try {
          pm.setPixelRatio(ratio);
          await new Promise((r) => { pm.once("idle", r); pm.triggerRepaint(); setTimeout(r, 8000); });
          raw = composePrint();
        } finally {
          pm.setPixelRatio(normal);
        }
      }
      if (!raw) {
        await new Promise((r) => { pm.once("render", r); pm.triggerRepaint(); setTimeout(r, 500); });
        raw = composePrint();
      }
      if (!raw) throw new Error("blank");
      const marked = await api.addPrintWatermark(raw);
      await printImage(marked || raw);
    } catch {
      // Fall back to the print window when the preview can't be captured.
      if (api.openPrintWindow()) api.closePrintModal();
    } finally {
      button.disabled = false;
    }
  }
  function setupPrint() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.("#printPopupConfirm");
      if (!btn || !window._mapsApi?.getPrintMap) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!btn.disabled) printFromPreview(btn);
    }, true);
    const popup = $("#printPopup");
    if (popup) {
      new MutationObserver(() => {
        if (popup.style.display === "none") return;
        // The preview map is created when the popup first opens.
        setTimeout(syncPreviewPins, 60);
        setTimeout(() => $("#printPopupClose")?.focus(), 80);
      }).observe(popup, { attributes: true, attributeFilter: ["style"] });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && popup.style.display !== "none") { e.stopPropagation(); window._mapsApi?.closePrintModal?.(); }
      }, true);
    }
  }

  /* ------------------------------------------------------------ globe */
  // Zoomed out, the map is a globe; MapLibre flattens it as you zoom in.
  // Changing the map style resets the projection, so it is applied again after each style load.
  function applyGlobe() {
    try {
      if (typeof map.setProjection !== "function") return;
      if (map.getProjection?.()?.type !== "globe") map.setProjection({ type: "globe" });
      // MapLibre's atmosphere is lit from one side, which looked like a glare on one edge;
      // maps-space.js draws an even glow around the globe instead.
      if (typeof map.setSky === "function") {
        map.setSky({
          "sky-color": "#0a1840",
          "horizon-color": "#7fb2ff",
          "sky-horizon-blend": 0.5,
          "atmosphere-blend": 0,
        });
      }
    } catch {}
  }

  /* ------------------------------------------------------------ auto dark map */
  let autoDarkTimer = null;
  function checkAutoDark() {
    if (!extras.autoDark) return;
    const here = window._mapsLastCoords;
    const c = here ? { lat: here.latitude, lng: here.longitude } : map.getCenter();
    const night = sunAltitude(new Date(), c.lat, c.lng) < -0.833;
    const want = night ? "dark" : "light";
    const current = localStorage.getItem("munetios_theme") || "dark";
    if (current !== want && typeof window.applyTheme === "function") window.applyTheme(want);
  }
  function setAutoDark(on) {
    saveExtras({ autoDark: on });
    clearInterval(autoDarkTimer);
    if (on) { checkAutoDark(); autoDarkTimer = setInterval(checkAutoDark, 5 * 60000); }
    toast(on ? t("autoDarkOn") : t("autoDarkOff"), "info");
    syncTrayStates();
  }

  /* ------------------------------------------------------------ saved views */
  function openSavedViews() {
    const list = h("div", { class: "mf-views" });
    const paint = () => {
      list.replaceChildren();
      if (!extras.savedViews.length) list.append(h("div", { class: "mu-empty" }, [h("span", { class: "mu-icon-circle" }, [icon("bookmarks")]), h("span", { text: t("noSavedViews") })]));
      extras.savedViews.forEach((v) => list.append(h("div", { class: "mf-view-row" }, [
        h("button", { type: "button", class: "mf-view-open", onclick: () => { map.flyTo({ center: [v.lng, v.lat], zoom: v.zoom, bearing: v.bearing || 0, pitch: v.pitch || 0, speed: 1.4 }); UI().closeModal("mfViews"); } }, [
          icon("crop_free"), h("span", { class: "mf-view-text" }, [h("span", { class: "mf-view-name", text: v.name }), h("span", { class: "mu-muted", text: formatCoords(v.lat, v.lng, "dec") + " · z" + fmtNum(v.zoom, 1) })]),
        ]),
        h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("rename"), title: t("rename"), onclick: async () => {
          const name = await promptDialog({ title: t("renameView"), label: t("viewName"), value: v.name, iconName: "edit" });
          if (!name) return;
          saveExtras({ savedViews: extras.savedViews.map((x) => (x.id === v.id ? { ...x, name } : x)) });
          paint();
        } }, [icon("edit")]),
        h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft mf-danger", "aria-label": t("delete"), title: t("delete"), onclick: () => { saveExtras({ savedViews: extras.savedViews.filter((x) => x.id !== v.id) }); paint(); } }, [icon("delete")]),
      ])));
    };
    paint();
    const add = h("button", { type: "button", class: "mu-btn mu-btn-primary", onclick: async () => {
      const name = await promptDialog({ title: t("saveView"), label: t("viewName"), value: t("viewDefaultName", { n: extras.savedViews.length + 1 }), iconName: "add_location" });
      if (!name) return;
      const c = map.getCenter();
      saveExtras({ savedViews: [{ id: "v" + Date.now(), name, lat: c.lat, lng: c.lng, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }, ...extras.savedViews] });
      paint();
      toast(t("viewSaved"));
    } }, [icon("add"), h("span", { text: t("saveCurrentView") })]);
    infoDialog("mfViews", t("savedViews"), "bookmarks", h("div", { class: "mf-views-body" }, [add, list]));
  }

  /* ------------------------------------------------------------ markers: search, sort, distance, rename, undo, import, export */
  const markerView = { query: "", sort: "newest" };
  let markerObserver = { pause() {}, resume() {} };
  function myPosition() {
    const c = window._mapsLastCoords;
    return c && Date.now() - c.at < 30 * 60000 ? [c.longitude, c.latitude] : null;
  }
  function decorateMarkersList() {
    const list = $("#markersList");
    if (!list || list.dataset.mfBusy) return;
    list.dataset.mfBusy = "1";
    try {
      const modal = list.closest(".modal");
      if (modal && !$("#mfMarkerTools", modal)) {
        const search = h("input", { type: "search", class: "mf-marker-search-input", placeholder: t("searchMarkers"), "aria-label": t("searchMarkers") });
        search.addEventListener("input", () => { markerView.query = search.value; decorateItems(); });
        const sort = h("select", { class: "mu-select", "aria-label": t("sortBy") }, [["newest", "sortNewest"], ["name", "sortName"], ["nearest", "sortNearest"]].map(([v, k]) => h("option", { value: v, text: t(k) })));
        sort.addEventListener("change", () => {
          markerView.sort = sort.value;
          if (sort.value === "nearest" && !myPosition()) requestPosition();
          decorateItems();
        });
        const tools = h("div", { id: "mfMarkerTools", class: "mf-marker-tools" }, [
          h("label", { class: "mu-search mf-marker-search" }, [icon("search"), search]),
          h("div", { class: "mf-marker-sort" }, [sort]),
          h("div", { class: "mf-marker-actions" }, [
            h("button", { type: "button", class: "mu-btn", onclick: () => importMarkers() }, [icon("upload"), h("span", { text: t("import") })]),
            h("button", { type: "button", class: "mu-btn", onclick: () => exportMarkers() }, [icon("download"), h("span", { text: t("export") })]),
          ]),
        ]);
        list.before(tools);
      }
      decorateItems();
    } finally { delete list.dataset.mfBusy; }
  }
  function decorateItems() {
    markerObserver.pause();
    try { decorateItemsNow(); } finally { markerObserver.resume(); }
  }
  function decorateItemsNow() {
    const list = $("#markersList");
    if (!list) return;
    const api = window._mapsApi;
    const markers = api.getMarkers();
    const byId = new Map(markers.map((m, i) => [String(m.id), { ...m, index: i }]));
    const here = myPosition();
    const items = $$(".marker-item", list);
    items.forEach((item) => {
      const m = byId.get(item.dataset.id);
      if (!m) return;
      if (!item.querySelector(".mf-marker-rename")) {
        const rename = h("div", { class: "marker-remove-btn mf-marker-rename", role: "button", tabindex: "0", title: t("rename"), "aria-label": t("rename"), onclick: async (e) => {
          e.stopPropagation();
          const name = await promptDialog({ title: t("renameMarker"), label: t("markerName"), value: m.label, iconName: "edit_location_alt" });
          if (!name) return;
          api.saveMarkers(api.getMarkers().map((x) => (String(x.id) === String(m.id) ? { ...x, label: name } : x)));
          api.refreshCustomMarkers();
          api.renderMarkersList();
          toast(t("markerRenamed"));
        } }, [h("icon", { text: "edit" })]);
        item.querySelector(".marker-remove-btn")?.before(rename);
      }
      const coords = item.querySelector(".marker-item-coords");
      if (coords) {
        let text = formatCoords(m.lat, m.lng);
        if (here) {
          const d = haversine(here, [m.lng, m.lat]);
          const b = bearing(here, [m.lng, m.lat]);
          text += " · " + t("awayToward", { distance: fmtDistance(d), direction: compassWord(b) });
          item.dataset.distance = String(d);
        }
        coords.textContent = text;
      }
      item.dataset.index = String(m.index);
      item.dataset.name = m.label || "";
      const q = markerView.query.trim().toLowerCase();
      item.hidden = Boolean(q) && !(m.label || "").toLowerCase().includes(q);
    });
    const sorted = [...items].sort((a, b) => {
      if (markerView.sort === "name") return (a.dataset.name || "").localeCompare(b.dataset.name || "", langCode(), { sensitivity: "base" });
      if (markerView.sort === "nearest" && here) return Number(a.dataset.distance || Infinity) - Number(b.dataset.distance || Infinity);
      return Number(a.dataset.index) - Number(b.dataset.index);
    });
    sorted.forEach((item) => list.append(item));
    let empty = $("#mfMarkerNoMatch", list);
    const anyVisible = sorted.some((i) => !i.hidden);
    if (!anyVisible && sorted.length) {
      if (!empty) list.append(h("div", { id: "mfMarkerNoMatch", class: "modal-empty", text: t("noMatchingMarkers") }));
    } else empty?.remove();
  }
  function requestPosition() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      window._mapsLastCoords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() };
      decorateItems();
    }, () => toast(t("locationNeeded"), "error"), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  // Undo when markers are removed (single delete or clear all).
  let lastMarkers = localStorage.getItem("munetios_markers") || "[]";
  let undoTimer = null;
  let restoring = false;
  function watchMarkerChanges() {
    document.addEventListener("maps-data-changed", (e) => {
      if (e.detail.key !== "munetios_markers" || restoring) return;
      const now = localStorage.getItem("munetios_markers") || "[]";
      let before = [];
      let after = [];
      try { before = JSON.parse(lastMarkers); after = JSON.parse(now); } catch {}
      const ids = new Set(after.map((m) => String(m.id)));
      const removed = before.filter((m) => !ids.has(String(m.id)));
      const previous = lastMarkers;
      lastMarkers = now;
      if (removed.length) offerUndo(removed.length === 1 ? t("markerRemoved") : t("markersRemoved", { count: removed.length }), previous);
    });
  }
  function offerUndo(label, previous) {
    let bar = $("#mfUndo");
    if (!bar) {
      bar = h("div", { id: "mfUndo", class: "mf-undo mu-glass", role: "status", "aria-live": "polite" }, [
        h("span", { class: "mf-undo-text" }),
        h("button", { type: "button", class: "mu-btn mu-btn-primary" }, [icon("undo"), h("span", { text: t("undo") })]),
        h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), onclick: () => { bar.hidden = true; } }, [icon("close")]),
      ]);
      document.body.append(bar);
    }
    bar.querySelector(".mf-undo-text").textContent = label;
    bar.querySelector(".mu-btn-primary").onclick = () => {
      restoring = true;
      try { localStorage.setItem("munetios_markers", previous); } finally { restoring = false; }
      lastMarkers = previous;
      const api = window._mapsApi;
      api.refreshCustomMarkers();
      if ($("#markersBackdrop")?.classList.contains("open")) api.renderMarkersList();
      bar.hidden = true;
      toast(t("markersRestored"));
    };
    bar.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { bar.hidden = true; }, 8000);
  }

  const xmlEsc = (v) => String(v ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
  function exportMarkers() {
    const markers = window._mapsApi.getMarkers();
    if (!markers.length) { toast(t("noMarkersToExport"), "info"); return; }
    UI().pickFromList({
      title: t("exportMarkers"), icon: "download", searchLabel: t("search"), closeLabel: t("close"),
      items: [{ value: "geojson", label: "GeoJSON", trailing: ".geojson" }, { value: "gpx", label: "GPX", trailing: ".gpx" }, { value: "kml", label: "KML", trailing: ".kml" }],
      onPick: (format) => {
        const name = "munetios-maps-markers-" + isoDay(new Date());
        if (format === "geojson") {
          download(name + ".geojson", "application/geo+json", JSON.stringify({ type: "FeatureCollection", features: markers.map((m) => ({ type: "Feature", properties: { name: m.label, id: m.id }, geometry: { type: "Point", coordinates: [m.lng, m.lat] } })) }, null, 2));
        } else if (format === "gpx") {
          download(name + ".gpx", "application/gpx+xml", `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Munetios Maps" xmlns="http://www.topografix.com/GPX/1/1">\n${markers.map((m) => `  <wpt lat="${m.lat}" lon="${m.lng}"><name>${xmlEsc(m.label)}</name></wpt>`).join("\n")}\n</gpx>\n`);
        } else {
          download(name + ".kml", "application/vnd.google-earth.kml+xml", `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Munetios Maps</name>\n${markers.map((m) => `  <Placemark><name>${xmlEsc(m.label)}</name><Point><coordinates>${m.lng},${m.lat},0</coordinates></Point></Placemark>`).join("\n")}\n</Document></kml>\n`);
        }
        toast(t("exported"));
      },
    });
  }
  function importMarkers() {
    const input = h("input", { type: "file", accept: ".geojson,.json,.gpx,.kml,application/geo+json,application/gpx+xml,application/vnd.google-earth.kml+xml", hidden: true });
    document.body.append(input);
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        const points = parseMarkerFile(text);
        if (!points.length) { toast(t("importNothing"), "error"); return; }
        const api = window._mapsApi;
        const existing = api.getMarkers();
        const base = Date.now();
        const added = points.map((p, i) => ({ id: base + i, lat: p.lat, lng: p.lng, label: String(p.name || t("importedMarker", { n: i + 1 })).slice(0, 120), imageUrl: "" }));
        api.saveMarkers([...added, ...existing]);
        lastMarkers = localStorage.getItem("munetios_markers") || "[]";
        api.refreshCustomMarkers();
        api.renderMarkersList();
        toast(t("importedCount", { count: added.length }));
      } catch { toast(t("importFailed"), "error"); }
    });
    input.click();
  }
  function parseMarkerFile(text) {
    const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const out = [];
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const json = JSON.parse(trimmed);
      const features = json.type === "FeatureCollection" ? json.features : json.type === "Feature" ? [json] : Array.isArray(json) ? json : [];
      for (const f of features) {
        const g = f && f.geometry;
        if (g?.type === "Point") { const [lng, lat] = g.coordinates.map(Number); if (valid(lat, lng)) out.push({ lat, lng, name: f.properties?.name || f.properties?.title }); }
        else if (Number.isFinite(f?.lat) && Number.isFinite(f?.lng) && valid(f.lat, f.lng)) out.push({ lat: f.lat, lng: f.lng, name: f.label || f.name });
      }
      return out;
    }
    const doc = new DOMParser().parseFromString(trimmed, "application/xml");
    if (doc.querySelector("parsererror")) return out;
    doc.querySelectorAll("wpt, rtept").forEach((n) => {
      const lat = parseFloat(n.getAttribute("lat"));
      const lng = parseFloat(n.getAttribute("lon"));
      if (valid(lat, lng)) out.push({ lat, lng, name: n.querySelector("name")?.textContent });
    });
    doc.querySelectorAll("Placemark").forEach((n) => {
      const c = n.querySelector("Point coordinates")?.textContent.trim();
      if (!c) return;
      const [lng, lat] = c.split(",").map(Number);
      if (valid(lat, lng)) out.push({ lat, lng, name: n.querySelector("name")?.textContent });
    });
    return out;
  }
  function exportRoute() {
    const coords = window._mapsApi.routeCoords() || [];
    if (!coords.length) { toast(t("noRoute"), "info"); return; }
    const pts = coords.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`).join("\n");
    download("munetios-maps-route-" + isoDay(new Date()) + ".gpx", "application/gpx+xml", `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Munetios Maps" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>Munetios Maps</name><trkseg>\n${pts}\n  </trkseg></trk>\n</gpx>\n`);
    toast(t("exported"));
  }

  /* ------------------------------------------------------------ tools tray items */
  const TOOLS = [
    { id: "mfToolMeasure", iconName: "straighten", key: "measureDistance", sub: "measureDistanceSub", run: () => startMeasure("distance"), active: () => measure.mode === "distance" },
    { id: "mfToolArea", iconName: "square_foot", key: "measureArea", sub: "measureAreaSub", run: () => startMeasure("area"), active: () => measure.mode === "area" },
    { id: "mfToolGrid", iconName: "grid_4x4", key: "coordinateGrid", sub: "overlay", run: () => { saveExtras({ grid: !extras.grid }); addGrid(); syncTrayStates(); }, active: () => extras.grid },
    { id: "mfToolNight", iconName: "nights_stay", key: "dayNight", sub: "overlay", run: () => { saveExtras({ dayNight: !extras.dayNight }); addDayNight(); syncTrayStates(); }, active: () => extras.dayNight },
    { id: "mfToolViews", iconName: "bookmarks", key: "savedViews", sub: "savedViewsSub", run: openSavedViews },
    { id: "mfToolGoTo", iconName: "pin_drop", key: "goToCoordinates", sub: "goToSub", run: goToCoordinates },
    { id: "mfToolShare", iconName: "share", key: "shareView", sub: "shareViewSub", run: shareView },
    { id: "mfToolSun", iconName: "wb_twilight", key: "sunTimes", sub: "sunTimesSub", run: showSunTimes },
    { id: "mfToolAutoDark", iconName: "brightness_6", key: "autoDark", sub: "autoDarkSub", run: () => setAutoDark(!extras.autoDark), active: () => extras.autoDark },
    { id: "mfToolImage", iconName: "image", key: "saveImage", sub: "pngFile", run: saveImage },
    { id: "mfToolRoute", iconName: "route", key: "exportRoute", sub: "gpxFile", run: exportRoute },
    { id: "mfToolSatNight", iconName: "dark_mode", key: "satNight", sub: "satNightSub", run: () => { saveExtras({ satNight: !extras.satNight }); window.MunetiosSpace?.refreshSatellite?.(); syncTrayStates(); }, active: () => extras.satNight },
    { id: "mfToolMoon", iconName: "bedtime", key: "visitMoon", sub: "visitMoonSub", run: () => { closeTray(); window.MunetiosSpace?.isMoon?.() ? window.MunetiosSpace.exitMoon() : window.MunetiosSpace?.enterMoon?.(); } },
  ];
  function closeTray() { const tray = $("#toolsTray"); if (tray?.classList.contains("open")) $("#layerTools")?.click(); }
  function toolItem(tool) {
    return h("div", { class: "layer mf-tool", id: tool.id, role: "button", tabindex: "0", "data-tooltip": t(tool.key), "aria-label": t(tool.key), onclick: () => tool.run(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tool.run(); } } }, [
      h("icon", { text: tool.iconName }),
      h("div", { class: "layer-text" }, [h("span", { class: "layer-label", "data-mf": tool.key, text: t(tool.key) }), h("span", { class: "layer-subtitle", "data-mf": tool.sub, text: t(tool.sub) })]),
    ]);
  }
  function registerTool(tool) {
    if (TOOLS.some((x) => x.id === tool.id)) return;
    TOOLS.push(tool);
    const tray = $("#toolsTray");
    if (tray && $("#mfToolMeasure")) { tray.append(toolItem(tool)); syncTrayStates(); }
  }

  /* ------------------------------------------------------------ layer switcher */
  // The layer list folds into one button so it doesn't cover the zoom buttons or the map.
  function mountLayerToggle() {
    const panel = $(".layers-selector");
    if (!panel || $("#mfLayersToggle")) return;
    const sub = h("span", { class: "layer-subtitle", id: "mfLayersCurrent" });
    const toggle = h("button", { type: "button", class: "layer mf-layers-toggle", id: "mfLayersToggle", "aria-expanded": "false", "aria-controls": "mfLayersList" }, [
      h("icon", { text: "layers" }),
      h("div", { class: "layer-text" }, [h("span", { class: "layer-label", "data-mf": "layers", text: t("layers") }), sub]),
      h("icon", { class: "mf-layers-chevron", text: "expand_less" }),
    ]);
    const list = h("div", { class: "mf-layers-list", id: "mfLayersList" });
    [...panel.children].forEach((child) => list.append(child));
    panel.append(list, toggle);
    panel.classList.add("mf-collapsible");
    const setOpen = (open) => {
      panel.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    const paintCurrent = () => { const active = list.querySelector(".layer.active:not(#layerTools) .layer-label"); sub.textContent = active ? active.textContent : ""; };
    toggle.addEventListener("click", () => setOpen(!panel.classList.contains("is-open")));
    list.addEventListener("click", (e) => { if (e.target.closest(".layer")) setTimeout(() => { setOpen(false); paintCurrent(); }, 120); });
    document.addEventListener("pointerdown", (e) => { if (panel.classList.contains("is-open") && !panel.contains(e.target)) setOpen(false); }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel.classList.contains("is-open")) { setOpen(false); toggle.focus(); } });
    new MutationObserver(paintCurrent).observe(list, { subtree: true, attributes: true, attributeFilter: ["class"] });
    paintCurrent();
  }
  function mountTray() {
    const tray = $("#toolsTray");
    if (!tray || $("#mfToolMeasure")) return;
    TOOLS.forEach((tool) => tray.append(toolItem(tool)));
    syncTrayStates();
  }
  function syncTrayStates() {
    TOOLS.forEach((tool) => {
      const el = document.getElementById(tool.id);
      if (!el || !tool.active) return;
      const on = Boolean(tool.active());
      el.classList.toggle("active", on);
      el.setAttribute("aria-pressed", String(on));
    });
  }

  /* ------------------------------------------------------------ command palette + shortcuts */
  function openPalette() {
    const api = window._mapsApi;
    let bookmarks = [];
    try { bookmarks = JSON.parse(localStorage.getItem("munetios_bookmarks") || "[]"); } catch {}
    const actions = [
      ...TOOLS.map((tool) => ({ value: "tool:" + tool.id, label: t(tool.key) })),
      { value: "a:fullscreen", label: t("fullscreen") }, { value: "a:tilt", label: t("toggle3d") }, { value: "a:north", label: t("resetNorth") },
      { value: "a:markers", label: api.t("my_markers") || t("markers") }, { value: "a:shortcuts", label: t("keyboardShortcuts") },
    ];
    UI().pickFromList({
      title: t("commandPalette"), icon: "bolt", searchLabel: t("paletteSearch"), closeLabel: t("close"), emptyText: t("noResults"),
      groups: [
        { label: t("actions"), items: actions },
        { label: t("savedViews"), items: extras.savedViews.map((v) => ({ value: "view:" + v.id, label: v.name, sub: formatCoords(v.lat, v.lng, "dec") })) },
        { label: t("markers"), items: api.getMarkers().map((m) => ({ value: "marker:" + m.id, label: m.label || "", sub: formatCoords(m.lat, m.lng, "dec") })) },
        { label: t("bookmarks"), items: bookmarks.filter((b) => Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng ?? b.lon))).map((b, i) => ({ value: "bm:" + i, label: b.name || b.title || b.label || b.query || formatCoords(Number(b.lat), Number(b.lng ?? b.lon), "dec"), sub: b.address || "" })) },
      ],
      onPick: (value) => {
        if (value.startsWith("tool:")) TOOLS.find((x) => "tool:" + x.id === value)?.run();
        else if (value.startsWith("view:")) { const v = extras.savedViews.find((x) => "view:" + x.id === value); if (v) map.flyTo({ center: [v.lng, v.lat], zoom: v.zoom, bearing: v.bearing || 0, pitch: v.pitch || 0 }); }
        else if (value.startsWith("marker:")) { const m = api.getMarkers().find((x) => "marker:" + x.id === value); if (m) map.flyTo({ center: [m.lng, m.lat], zoom: 15 }); }
        else if (value.startsWith("bm:")) { const b = bookmarks[Number(value.slice(3))]; if (b) map.flyTo({ center: [Number(b.lng ?? b.lon), Number(b.lat)], zoom: 15 }); }
        else if (value === "a:fullscreen") toggleFullscreen();
        else if (value === "a:tilt") toggleTilt();
        else if (value === "a:north") map.easeTo({ bearing: 0, pitch: 0 });
        else if (value === "a:markers") api.openMarkersModal();
        else if (value === "a:shortcuts") showShortcuts();
      },
    });
  }
  function showShortcuts() {
    const rows = [["Ctrl", "K", "commandPalette"], ["M", "", "measureDistance"], ["A", "", "measureArea"], ["G", "", "coordinateGrid"], ["F", "", "fullscreen"], ["T", "", "toggle3d"], ["N", "", "resetNorth"], ["C", "", "goToCoordinates"], ["?", "", "keyboardShortcuts"]];
    infoDialog("mfShortcuts", t("keyboardShortcuts"), "keyboard", h("div", { class: "mf-shortcuts" }, rows.map(([a, b, key]) => h("div", { class: "mf-shortcut" }, [h("span", { text: t(key) }), h("span", { class: "mf-keys" }, [h("span", { class: "mu-kbd", text: a }), b ? h("span", { class: "mu-kbd", text: b }) : null])]))));
  }
  function onKey(e) {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".mu-modal:not([hidden]), .modal-backdrop.open")) return;
    const k = e.key.toLowerCase();
    if (e.key === "Escape" && measure.mode) { measure.mode = null; measure.points = []; paintMeasure(); syncTrayStates(); return; }
    const actions = { m: () => startMeasure("distance"), a: () => startMeasure("area"), g: () => TOOLS[2].run(), f: toggleFullscreen, t: toggleTilt, n: () => map.easeTo({ bearing: 0 }), c: goToCoordinates, "?": showShortcuts };
    const fn = actions[e.key === "?" ? "?" : k];
    if (fn) { e.preventDefault(); fn(); }
  }

  /* ------------------------------------------------------------ translation + start */
  function translate() {
    $$("[data-mf]").forEach((n) => { const v = t(n.dataset.mf); if (n.textContent !== v) n.textContent = v; });
    TOOLS.forEach((tool) => { const el = document.getElementById(tool.id); if (el) { el.dataset.tooltip = t(tool.key); el.setAttribute("aria-label", t(tool.key)); } });
    ["printPopupClose", "navStepsClose"].forEach((id) => { const el = document.getElementById(id); if (el) el.setAttribute("aria-label", t("close")); });
    const labels = { mfCompass: "resetNorth", mfTilt: "toggle3d", mfFullscreen: "fullscreen", mfReadout: "copyCoordinates", mfFormat: "coordinateFormat", mfPaletteBtn: "commandPalette" };
    for (const [id, key] of Object.entries(labels)) { const el = document.getElementById(id); if (el) { el.title = t(key); el.setAttribute("aria-label", t(key)); } }
    if (measure.mode) paintMeasure();
  }
  function start() {
    const api = window._mapsApi;
    if (!api || map) return;
    map = api.map;
    extras = readExtras();
    // Maps' own toasts use the v4 toast so they look the same and float above dialogs.
    const nativeToast = window.showToast;
    window.showToast = (message) => {
      const text = String(message ?? "");
      if (!UI()?.toast) return nativeToast?.(message);
      UI().toast(text, { type: /fail|error|could ?n[o']t|unavailable|denied|invalid|enter /i.test(text) ? "error" : "info" });
    };
    document.documentElement.setAttribute("data-mu-theme", (localStorage.getItem("munetios_theme") || "dark") === "light" ? "light" : "dark");
    mountMeasurePanel();
    mountControls();
    mountTray();
    const topRight = $(".top-right");
    const settings = $("#settingsBtn");
    if (topRight && settings && !$("#mfPaletteBtn")) topRight.insertBefore(h("div", { class: "topbar-item", id: "mfPaletteBtn", role: "button", tabindex: "0", "aria-label": t("commandPalette"), title: t("commandPalette"), onclick: openPalette, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPalette(); } } }, [h("icon", { text: "bolt" })]), settings);
    // Nav drawer: Bookmarks, saved views, and the command palette stay reachable on phones.
    const drawerBody = $(".nav-drawer-body");
    if (drawerBody && !$("#mfDrawerSection")) {
      const navItem = (iconName, key, run) => h("div", { class: "nav-item", role: "button", tabindex: "0", onclick: () => { try { closeDrawer(); } catch {} run(); }, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); try { closeDrawer(); } catch {} run(); } } }, [h("icon", { text: iconName }), h("div", { class: "sidebar-label", "data-mf": key, text: t(key) })]);
      const section = h("div", { class: "nav-section", id: "mfDrawerSection" }, [
        navItem("bookmark", "bookmarks", () => $("#bookmarksBtn")?.click()),
        navItem("bookmarks", "savedViews", openSavedViews),
        navItem("bolt", "commandPalette", openPalette),
        navItem("keyboard", "keyboardShortcuts", showShortcuts),
      ]);
      drawerBody.insertBefore(section, drawerBody.children[1] || null);
    }
    onStyle(applyGlobe);
    const markZoom = () => document.body.classList.toggle("mf-globe-view", map.getZoom() < 4 || moonMode());
    map.on("zoom", markZoom);
    map.on("style.load", markZoom);
    markZoom();
    mountLayerToggle();
    setupNavigation();
    setupPrint();
    onStyle(addGrid);
    onStyle(addDayNight);
    onStyle(addMeasure);
    map.on("style.load", runAdders);
    map.on("load", runAdders);
    map.on("moveend", () => { if (extras.grid && map.getSource("mf-grid")) map.getSource("mf-grid").setData(gridData()); });
    setInterval(() => { if (extras.dayNight && map.getSource("mf-night")) map.getSource("mf-night").setData(nightData()); }, 60000);
    if (extras.autoDark) { checkAutoDark(); autoDarkTimer = setInterval(checkAutoDark, 5 * 60000); }
    watchMarkerChanges();
    const list = $("#markersList");
    if (list) {
      // Reordering the list is itself a DOM change, so stop watching while the list is decorated.
      const observer = new MutationObserver(() => {
        observer.disconnect();
        try { decorateMarkersList(); } finally { observer.observe(list, { childList: true }); }
      });
      markerObserver = { pause: () => observer.disconnect(), resume: () => observer.observe(list, { childList: true }) };
      observer.observe(list, { childList: true });
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("maps-sync-applied", () => {
      extras = readExtras();
      lastMarkers = localStorage.getItem("munetios_markers") || "[]";
      api.refreshCustomMarkers();
      if ($("#markersBackdrop")?.classList.contains("open")) api.renderMarkersList();
      runAdders();
      syncTrayStates();
      paintReadout();
      if (typeof window._refreshMapStyle === "function") { try { window._refreshMapStyle(); } catch {} }
    });
    // Units change in Settings → rescale.
    document.addEventListener("click", (e) => { if (e.target.closest?.("#unitsMetric, #unitsImperial")) setTimeout(() => { addScale(); if (measure.mode) paintMeasure(); }, 50); });
    // Language change → retranslate.
    const langList = document.getElementById("langDropdown");
    if (langList) langList.addEventListener("click", () => setTimeout(translate, 80));
    document.addEventListener("click", (e) => { if (e.target.closest?.("[data-lang], .custom-dropdown-item")) setTimeout(translate, 80); });
    translate();
    window.MapsFeatures = { t, openPalette, parseCoords, plusEncode, plusDecode, sunTimes, formatCoords, haversine, ringArea, extras: () => extras, saveExtras, onStyle, registerTool, syncTrayStates, toast, translate };
    document.dispatchEvent(new CustomEvent("maps-features-ready"));
  }
  if (window._mapsApi) start();
  else document.addEventListener("maps-ready", start, { once: true });
  document.addEventListener("DOMContentLoaded", () => { if (window._mapsApi) start(); });
})();
