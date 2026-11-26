/*
 * Munetios Maps live traffic, from the self-hosted maps server (/api/maps/traffic).
 *
 * Viewing: road segments are colored by how their current speed compares with their usual free-flow
 * speed, refreshed every 20 seconds.
 * Sharing (off by default): while you navigate, pairs of nearby points and the speed between them are
 * sent with no account, device, or trip identifier. The first and last 500 m of every trip are never sent,
 * so where a trip starts and ends stays on your device.
 */
(() => {
  "use strict";
  const REFRESH_MS = 20000;
  const SEND_MS = 60000;
  const PRIVACY_M = 500;
  const MIN_ZOOM = 9;
  const COLORS = { free: "#22c55e", moderate: "#f59e0b", heavy: "#ef4444", standstill: "#991b1b" };

  function start() {
    const F = window.MapsFeatures;
    const api = window._mapsApi;
    const map = api?.map;
    if (!F || !map || map.__munetiosTraffic) return;
    map.__munetiosTraffic = true;
    const t = F.t;
    const extras = () => F.extras();
    const UI = () => window.MunetiosUI;
    const isMoon = () => document.body.classList.contains("mf-moon-mode");
    const h = (tag, attrs = {}, children = []) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "text") el.textContent = v;
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
      children.forEach((c) => el.append(c));
      return el;
    };
    let data = { type: "FeatureCollection", features: [] };
    let lastUpdate = 0;
    let lastError = false;
    let serverMissing = false;

    /* -------------------------------------------- map layer */
    /* -------------------------------------------- typical traffic */
    // Works with no server and no reports: each major road is colored by how busy roads of its kind
    // usually are at this local time and day (rush hours on weekdays, quiet nights). Live reports draw on top.
    const TYPICAL_MIN_ZOOM = 5;
    const ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"];
    const CLASS_LOAD = { motorway: 1, trunk: 0.92, primary: 0.82, secondary: 0.66, tertiary: 0.5 };
    function busyness() {
      // Local time where the map is looking (time zone estimated from longitude).
      const lng = map.getCenter().lng;
      const now = new Date(Date.now() + (lng / 15) * 3600e3);
      const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
      const day = now.getUTCDay();
      const weekend = day === 0 || day === 6;
      const bump = (center, width, height) => height * Math.exp(-(((hour - center) / width) ** 2));
      const base = hour < 5 ? 0.08 : hour < 6 ? 0.18 : 0.32;
      const curve = weekend
        ? base + bump(13, 3.5, 0.35) + bump(18, 2.5, 0.15)
        : base + bump(8.1, 1.2, 0.6) + bump(17.6, 1.6, 0.68) + bump(12.5, 1.8, 0.15);
      return Math.min(1, Math.max(0, curve));
    }
    const vectorSource = () => {
      const sources = map.getStyle()?.sources || {};
      if (sources.ofm?.type === "vector") return "ofm";
      return Object.keys(sources).find((id) => sources[id].type === "vector") || null;
    };
    function typicalColor() {
      const b = busyness();
      // Per-road variation from the road's name, so a city doesn't turn one flat color.
      const vary = ["/", ["%", ["length", ["to-string", ["coalesce", ["get", "name"], ["get", "ref"], ""]]], 7], 7];
      const load = ["+", ["*", ["match", ["get", "class"], "motorway", CLASS_LOAD.motorway, "trunk", CLASS_LOAD.trunk, "primary", CLASS_LOAD.primary, "secondary", CLASS_LOAD.secondary, CLASS_LOAD.tertiary], b], ["*", ["-", vary, 0.5], 0.28 * b]];
      return ["step", load, COLORS.free, 0.42, COLORS.moderate, 0.62, COLORS.heavy, 0.82, COLORS.standstill];
    }
    function addTypical() {
      const src = vectorSource();
      if (!src || map.getLayer("mf-traffic-typical")) return;
      const before = map.getLayer("mf-traffic-line") ? "mf-traffic-line" : map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      map.addLayer({
        id: "mf-traffic-typical",
        type: "line",
        source: src,
        "source-layer": "transportation",
        minzoom: TYPICAL_MIN_ZOOM,
        filter: ["all", ["in", ["get", "class"], ["literal", ROAD_CLASSES]], ["!=", ["get", "brunnel"], "tunnel"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": typicalColor(),
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "class"], ["motorway", "trunk"], 1.4, 0.6], 9, ["match", ["get", "class"], ["motorway", "trunk"], 2.5, 1.2], 13, ["match", ["get", "class"], ["motorway", "trunk"], 4.5, 3], 17, 8],
          "line-offset": ["interpolate", ["linear"], ["zoom"], 9, 0, 10, 1, 17, 5],
          "line-opacity": 0.85,
        },
      }, before);
    }
    setInterval(() => { if (map.getLayer("mf-traffic-typical")) map.setPaintProperty("mf-traffic-typical", "line-color", typicalColor()); }, 60000);
    map.on("moveend", () => { if (map.getLayer("mf-traffic-typical")) map.setPaintProperty("mf-traffic-typical", "line-color", typicalColor()); });

    function addLayer() {
      if (!extras().traffic || isMoon()) return;
      try { addTypical(); } catch {}
      if (!map.getSource("mf-traffic")) map.addSource("mf-traffic", { type: "geojson", data });
      if (!map.getLayer("mf-traffic-line")) {
        const before = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        map.addLayer({
          id: "mf-traffic-line",
          type: "line",
          source: "mf-traffic",
          minzoom: MIN_ZOOM,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["match", ["get", "level"], "free", COLORS.free, "moderate", COLORS.moderate, "heavy", COLORS.heavy, COLORS.standstill],
            "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 13, 4.5, 17, 9],
            "line-offset": ["interpolate", ["linear"], ["zoom"], 9, 1, 17, 5],
            "line-opacity": 0.92,
          },
        }, before);
      }
    }
    function removeLayer() {
      if (map.getLayer("mf-traffic-typical")) map.removeLayer("mf-traffic-typical");
      if (map.getLayer("mf-traffic-line")) map.removeLayer("mf-traffic-line");
      if (map.getSource("mf-traffic")) map.removeSource("mf-traffic");
    }
    F.onStyle(addLayer);

    /* -------------------------------------------- fetching */
    let timer = 0;
    let moveTimer = 0;
    async function refresh() {
      clearTimeout(timer);
      if (!extras().traffic || isMoon()) return;
      timer = setTimeout(refresh, REFRESH_MS);
      if (map.getZoom() < MIN_ZOOM) { paintLegend(); return; }
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5)).join(",");
      try {
        const res = await fetch(`/api/maps/traffic?bbox=${bbox}`, { credentials: "same-origin", cache: "no-store" });
        // An HTML 404 means this server was started before the Maps server existed.
        serverMissing = res.status === 404 && (res.headers.get("content-type") || "").includes("text/html");
        if (!res.ok) throw new Error(String(res.status));
        data = await res.json();
        lastUpdate = Date.now();
        lastError = false;
        map.getSource("mf-traffic")?.setData(data);
      } catch {
        lastError = true;
      }
      paintLegend();
    }
    map.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(refresh, 400); });

    /* -------------------------------------------- legend */
    const legend = h("div", { class: "mf-traffic-legend", hidden: "", role: "status", "aria-live": "polite" });
    document.body.append(legend);
    function ago(ms) {
      const s = Math.max(0, Math.round(ms / 1000));
      if (s < 60) return t("trafficSecondsAgo", { n: s });
      return t("trafficMinutesAgo", { n: Math.round(s / 60) });
    }
    function paintLegend() {
      legend.hidden = !extras().traffic || isMoon();
      if (legend.hidden) return;
      legend.replaceChildren();
      legend.append(h("span", { class: "mu-icon", "aria-hidden": "true", text: "traffic" }));
      const body = h("div", { class: "mf-traffic-body" });
      body.append(h("span", { class: "mf-traffic-title", text: t("trafficLive") }));
      let status;
      if (map.getZoom() < TYPICAL_MIN_ZOOM) status = t("trafficZoomIn");
      else if (map.getZoom() < MIN_ZOOM) status = t("trafficTypical");
      else if (lastError && serverMissing) status = t("trafficTypicalOnly");
      else if (lastError) status = t("trafficOffline");
      else if (!data.features.length) status = t("trafficTypical");
      else status = `${t("trafficSegments", { n: data.features.length })} · ${ago(Date.now() - lastUpdate)}`;
      body.append(h("span", { class: "mf-traffic-status", text: status }));
      legend.append(body);
      const scale = h("div", { class: "mf-traffic-scale", "aria-hidden": "true" }, [
        h("span", { text: t("trafficFast") }),
        ...["free", "moderate", "heavy", "standstill"].map((k) => h("i", { style: `background:${COLORS[k]}` })),
        h("span", { text: t("trafficSlow") }),
      ]);
      legend.append(scale);
      const share = h("button", {
        type: "button",
        class: "mu-btn mf-traffic-share",
        "aria-pressed": String(Boolean(extras().trafficShare)),
        onclick: toggleShare,
      }, [h("span", { class: "mu-icon", "aria-hidden": "true", text: extras().trafficShare ? "cell_tower" : "share_location" }), h("span", { text: extras().trafficShare ? t("trafficSharing") : t("trafficShare") })]);
      legend.append(share);
    }
    setInterval(() => { if (!legend.hidden) paintLegend(); }, 5000);

    function setTraffic(on) {
      F.saveExtras({ traffic: on });
      if (on) { addLayer(); refresh(); } else { clearTimeout(timer); removeLayer(); }
      paintLegend();
      F.syncTrayStates();
      syncLayerItem();
    }
    async function toggleShare() {
      if (!extras().trafficShare) {
        const ok = await confirmShare();
        if (!ok) return;
      }
      F.saveExtras({ trafficShare: !extras().trafficShare });
      if (!extras().trafficShare) resetTrip();
      paintLegend();
      F.toast(extras().trafficShare ? t("trafficShareOn") : t("trafficShareOff"), "info");
    }
    function confirmShare() {
      return new Promise((resolve) => {
        if (!UI()?.openModal) { resolve(window.confirm(t("trafficShareExplain"))); return; }
        const id = "mfTrafficShareModal";
        document.getElementById(id)?.remove();
        const modal = h("div", { class: "mu-modal", id, hidden: "" });
        const yes = h("button", { type: "button", class: "mu-btn mu-btn-primary" }, [h("span", { class: "mu-icon", "aria-hidden": "true", text: "check" }), h("span", { text: t("trafficShare") })]);
        const no = h("button", { type: "button", class: "mu-btn", "data-mu-close": "" }, [h("span", { text: t("cancel") })]);
        modal.append(h("div", { class: "mu-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": id + "T" }, [
          h("div", { class: "mu-dialog-header" }, [
            h("div", { class: "mu-dialog-heading" }, [h("span", { class: "mu-icon-circle" }, [h("span", { class: "mu-icon", "aria-hidden": "true", text: "share_location" })]), h("h2", { id: id + "T", text: t("trafficShareTitle") })]),
          ]),
          h("p", { class: "mf-traffic-explain", text: t("trafficShareExplain") }),
          h("div", { class: "mu-dialog-actions" }, [no, yes]),
        ]));
        document.body.append(modal);
        let answered = false;
        yes.addEventListener("click", () => { answered = true; UI().closeModal(modal); resolve(true); });
        new MutationObserver((r, obs) => { if (modal.hidden) { obs.disconnect(); modal.remove(); if (!answered) resolve(false); } }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
        UI().openModal(id);
      });
    }

    /* -------------------------------------------- layer switcher + tools */
    let layerItem = null;
    function mountLayerItem() {
      const list = document.getElementById("mfLayersList") || document.querySelector(".layers-selector");
      if (!list || document.getElementById("layerTraffic")) return;
      layerItem = h("div", { class: "layer", id: "layerTraffic", role: "button", tabindex: "0", "aria-pressed": "false", onclick: (e) => { e.stopPropagation(); setTraffic(!extras().traffic); }, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTraffic(!extras().traffic); } } }, [
        h("icon", { text: "traffic" }),
        h("div", { class: "layer-text" }, [h("span", { class: "layer-label", "data-mf": "traffic", text: t("traffic") }), h("span", { class: "layer-subtitle", "data-mf": "trafficLive", text: t("trafficLive") })]),
      ]);
      const tools = document.getElementById("layerTools");
      list.insertBefore(layerItem, tools || null);
      syncLayerItem();
    }
    function syncLayerItem() {
      if (!layerItem) return;
      layerItem.classList.toggle("mf-on", Boolean(extras().traffic));
      layerItem.setAttribute("aria-pressed", String(Boolean(extras().traffic)));
    }
    F.registerTool({ id: "mfToolTraffic", iconName: "traffic", key: "traffic", sub: "trafficLive", run: () => setTraffic(!extras().traffic), active: () => extras().traffic });
    setTimeout(mountLayerItem, 0);
    document.addEventListener("maps-sync-applied", () => { if (extras().traffic) { addLayer(); refresh(); } else removeLayer(); paintLegend(); syncLayerItem(); });
    map.on("style.load", () => setTimeout(() => { paintLegend(); if (extras().traffic) refresh(); }, 50));

    /* -------------------------------------------- sharing while navigating */
    const R = 6371008.8;
    const RAD = Math.PI / 180;
    const dist = (a, b) => {
      const dLat = (b.lat - a.lat) * RAD;
      const dLng = (b.lng - a.lng) * RAD;
      const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(q));
    };
    let trip = null;
    function resetTrip() { trip = null; }
    const navigating = () => { const o = document.getElementById("navOverlay"); return o && o.style.display !== "none" && o.style.display !== ""; };
    function samplePosition() {
      if (!extras().trafficShare || !navigating()) { if (trip) resetTrip(); return; }
      const c = window._mapsLastCoords;
      if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
      if (Number.isFinite(c.accuracy) && c.accuracy > 50) return;
      const now = Date.now();
      const p = { lat: c.latitude, lng: c.longitude, t: now, speed: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null };
      if (!trip) { trip = { start: p, last: p, traveled: 0, pending: [], held: [] }; return; }
      const d = dist(trip.last, p);
      if (d < 25) return;
      const dt = (p.t - trip.last.t) / 1000;
      if (d > 500 || dt <= 0 || dt > 120) { trip.last = p; return; }
      const speed = p.speed ?? d / dt;
      trip.traveled += d;
      const seg = { s: [trip.last.lng, trip.last.lat, p.lng, p.lat, Math.round(speed * 10) / 10], d };
      trip.last = p;
      // Nothing from the first 500 m of the trip.
      if (trip.traveled - d < PRIVACY_M) return;
      // The latest 500 m are held back, so the trip's end is never sent either.
      trip.held.push(seg);
      let heldDist = trip.held.reduce((sum, x) => sum + x.d, 0);
      while (trip.held.length && heldDist - trip.held[0].d >= PRIVACY_M) {
        const out = trip.held.shift();
        heldDist -= out.d;
        trip.pending.push(out.s);
      }
    }
    async function sendPending() {
      if (!trip?.pending.length || !extras().trafficShare) return;
      const batch = trip.pending.splice(0, 100);
      try {
        await fetch("/api/maps/traffic/samples", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", body: JSON.stringify({ s: batch }) });
      } catch {}
    }
    setInterval(samplePosition, 2000);
    setInterval(sendPending, SEND_MS);

    window.MapsTraffic = { setTraffic, refresh, data: () => data };
    paintLegend();
    if (extras().traffic) { addLayer(); refresh(); }
  }
  if (window.MapsFeatures) start();
  else document.addEventListener("maps-features-ready", start, { once: true });
})();
