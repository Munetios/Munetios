/*!
 * Munetios Weather
 * Forecasts from Open-Meteo, alerts and text forecasts from weather.gov (United States),
 * city search from Photon, and a purple OpenMapTiles map for picking places.
 * Sun and moon data are computed on the device. Saved places stay in this browser.
 */
(function () {
  "use strict";
  const UI = window.MunetiosUI;
  const Sun = window.GanetiosSun;
  const SkyLib = window.GanetiosSky;
  const MapLib = window.GanetiosMap;
  const STR = window.GanetiosWeatherStrings;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const HOUR = 3600000;
  const US_CODES = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);

  // ------------------------------------------------------------ storage
  const KEYS = { settings: "ganetios-weather-settings", locations: "ganetios-weather-locations", active: "ganetios-weather-active", skipMyLocation: "munetios-weather-skip-my-location" };
  const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };

  const region = ((navigator.languages && navigator.languages[0]) || navigator.language || "en-US").split("-")[1]?.toUpperCase() || "";
  const imperial = ["US", "LR", "MM", "PR"].includes(region);
  const settings = Object.assign({
    language: "system", temp: imperial ? "fahrenheit" : "celsius", wind: imperial || region === "GB" ? "mph" : "kmh",
    precip: imperial ? "inch" : "mm", pressure: imperial ? "inHg" : "hPa", distance: imperial || region === "GB" ? "mi" : "km", clock: "auto", useDeviceTimezone: false, animate: true,
  }, read(KEYS.settings, {}));
  let locations = read(KEYS.locations, []);
  let activeId = read(KEYS.active, null);
  const store = { data: {}, aq: {}, nws: {}, alerts: {}, summary: {} };
  const view = { metric: "temp", range: 48, table: false, sunDate: null, monthDay: 16, preview: null, previewAlt: 40 };
  const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let deviceZone = deviceTimezone();
  let zoneRevision = 0;

  // ------------------------------------------------------------ language
  // The 17 global Munetios locales (shared/munetios-locales.js).
  const LOCALES = window.MunetiosLocales;
  const LANGS = LOCALES.CODES.slice();
  const resolveLanguage = (code) => LOCALES.resolve(String(code || ""));
  // One complete catalog per locale; gaps fill from the closest language before English.
  const CATALOGS = LOCALES.compose(STR, {}, { es: "419", pt: "BR" });
  if (settings.language !== "system") settings.language = resolveLanguage(settings.language) || "system";
  const browserLanguage = () => LOCALES.detect();
  let systemLanguage = browserLanguage();
  const lang = () => settings.language === "system" ? systemLanguage : settings.language;
  // Intl has no Corsican data, so Corsican dates and numbers use the conventions of Corsica (fr-FR).
  const locale = () => (lang() === "co" ? "fr-FR" : lang());
  function t(key, vars) {
    let s = (CATALOGS[lang()] || CATALOGS["en-US"])[key] ?? CATALOGS["en-US"][key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
    return s;
  }
  function applyStrings() {
    document.documentElement.lang = lang();
    document.documentElement.dir = lang() === "ar" ? "rtl" : "ltr";
    $$("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
    $$("[data-t-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.tLabel)); if (el.matches("button")) el.title = t(el.dataset.tLabel); });
    $$("[data-t-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.tPlaceholder); });
  }

  // ------------------------------------------------------------ formatting
  const nf = (opts) => new Intl.NumberFormat(locale(), opts);
  const num = (v, d = 0) => (v == null || Number.isNaN(v) ? "—" : nf({ maximumFractionDigits: d, minimumFractionDigits: d }).format(v));
  const pct = (v) => (v == null ? "—" : nf({ style: "percent", maximumFractionDigits: 0 }).format(v / 100));
  const deg = (v) => (v == null ? "—" : num(Math.round(v)) + "°");
  function uses12h() {
    if (settings.clock === "12") return true;
    if (settings.clock === "24") return false;
    try { const hc = new Intl.DateTimeFormat(locale(), { hour: "numeric" }).resolvedOptions().hourCycle; return hc === "h12" || hc === "h11"; } catch (e) { return true; }
  }
  const meridiem = (h) => (h < 12 ? "NM" : "AN");
  function formatParts(ms, tz, opts) {
    const o = Object.assign({ timeZone: tz || "UTC" }, opts, uses12h() ? { hourCycle: "h12" } : { hourCycle: "h23" });
    let fmt;
    try { fmt = new Intl.DateTimeFormat(locale(), o); } catch (e) { o.timeZone = "UTC"; fmt = new Intl.DateTimeFormat(locale(), o); }
    const parts = fmt.formatToParts(new Date(ms));
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: o.timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(ms))) % 24;
    return parts.map((p) => (p.type === "dayPeriod" ? meridiem(hour) : p.value)).join("").replace(/\s+/g, " ").trim();
  }
  const zoneOf = (loc) => (settings.useDeviceTimezone ? deviceZone : loc?.tz) || null;
  function timeStr(ms, loc) {
    if (ms == null) return "—";
    if (loc && !zoneOf(loc)) {
      const { hour, minute } = Sun.localParts(ms, null, loc.lon);
      return clockStr(hour, minute);
    }
    return formatParts(ms, zoneOf(loc), { hour: "numeric", minute: "2-digit" });
  }
  function hourStr(ms, loc) {
    if (loc && !zoneOf(loc)) return clockStr(Sun.localParts(ms, null, loc.lon).hour, null);
    return formatParts(ms, zoneOf(loc), { hour: "numeric" });
  }
  /** A wall clock time with no date, e.g. 12:00 NM for polar day. */
  function clockStr(h, m) {
    return formatParts(Date.UTC(2026, 0, 1, h, m ?? 0), "UTC", m == null ? { hour: "numeric" } : { hour: "numeric", minute: "2-digit" });
  }
  // Label solar charts with the selected date, time zone and clock format.
  function sunHourLabel(h, loc, lp) {
    const zone = zoneOf(loc);
    const local = Date.UTC(lp.year, lp.month, lp.day, h);
    let instant = local - Sun.offsetMinutes(local, zone, loc.lon) * 60000;
    instant = local - Sun.offsetMinutes(instant, zone, loc.lon) * 60000;
    return hourStr(instant, loc);
  }
  function dateStr(ms, loc, opts) {
    const zone = zoneOf(loc);
    const o = Object.assign({ timeZone: zone || "UTC" }, opts);
    if (!zone) ms += Sun.offsetMinutes(ms, null, loc?.lon) * 60000;
    try { return new Intl.DateTimeFormat(locale(), o).format(new Date(ms)); } catch (e) { return new Intl.DateTimeFormat(locale(), Object.assign(o, { timeZone: "UTC" })).format(new Date(ms)); }
  }
  function durationStr(ms) {
    const total = Math.round(Math.abs(ms) / 60000);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return t("durationHm", { h: num(h), m: num(m) });
  }
  function deltaStr(ms) {
    const sec = Math.round(ms / 1000);
    const sign = sec > 0 ? "+" : sec < 0 ? "−" : "±";
    const a = Math.abs(sec);
    return sign + t("durationMs", { m: num(Math.floor(a / 60)), s: num(a % 60) });
  }
  const compass = (d) => (d == null ? "" : t("compass").split("|")[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]);

  // Units
  const tempUnit = () => (settings.temp === "fahrenheit" ? "°F" : "°C");
  const windUnit = () => ({ kmh: t("unitKmh"), mph: t("unitMph"), ms: t("unitMs"), kn: t("unitKn") }[settings.wind]);
  const precipUnit = () => (settings.precip === "inch" ? t("unitIn") : t("unitMm"));
  function pressureStr(hpa) {
    if (hpa == null) return "—";
    if (settings.pressure === "inHg") return num(hpa * 0.0295299830714, 2) + " " + t("unitInHg");
    if (settings.pressure === "mmHg") return num(hpa * 0.750061683, 0) + " " + t("unitMmHg");
    if (settings.pressure === "kPa") return num(hpa / 10, 1) + " " + t("unitKpa");
    return num(hpa, 0) + " " + t("unitHpa");
  }
  const pressureValue = (hpa) => (settings.pressure === "inHg" ? hpa * 0.0295299830714 : settings.pressure === "mmHg" ? hpa * 0.750061683 : settings.pressure === "kPa" ? hpa / 10 : hpa);
  const pressureUnit = () => ({ inHg: t("unitInHg"), mmHg: t("unitMmHg"), kPa: t("unitKpa"), hPa: t("unitHpa") }[settings.pressure]);
  function distanceValue(m) { return settings.distance === "mi" ? m / 1609.344 : m / 1000; }
  const distanceUnit = () => (settings.distance === "mi" ? t("unitMi") : t("unitKm"));
  function visibilityStr(m) {
    if (m == null) return "—";
    const v = distanceValue(m);
    return num(v, v < 10 ? 1 : 0) + " " + distanceUnit();
  }

  // ------------------------------------------------------------ weather codes
  const CODES = {
    0: ["wxClear", "sunny"], 1: ["wxMainlyClear", "sunny"], 2: ["wxPartlyCloudy", "partly_cloudy_day"], 3: ["wxOvercast", "cloud"],
    45: ["wxFog", "foggy"], 48: ["wxRimeFog", "foggy"],
    51: ["wxDrizzleLight", "rainy_light"], 53: ["wxDrizzle", "rainy_light"], 55: ["wxDrizzleDense", "rainy_light"],
    56: ["wxFreezingDrizzle", "rainy_snow"], 57: ["wxFreezingDrizzle", "rainy_snow"],
    61: ["wxRainLight", "rainy_light"], 63: ["wxRain", "rainy"], 65: ["wxRainHeavy", "rainy_heavy"],
    66: ["wxFreezingRain", "rainy_snow"], 67: ["wxFreezingRain", "rainy_snow"],
    71: ["wxSnowLight", "weather_snowy"], 73: ["wxSnow", "weather_snowy"], 75: ["wxSnowHeavy", "snowing_heavy"], 77: ["wxSnowGrains", "grain"],
    80: ["wxShowersLight", "rainy_light"], 81: ["wxShowers", "rainy"], 82: ["wxShowersViolent", "rainy_heavy"],
    85: ["wxSnowShowers", "weather_snowy"], 86: ["wxSnowShowers", "snowing_heavy"],
    95: ["wxThunderstorm", "thunderstorm"], 96: ["wxThunderHail", "weather_hail"], 99: ["wxThunderHail", "weather_hail"],
  };
  const condText = (code) => t((CODES[code] || CODES[3])[0]);
  function condIcon(code, isDay) {
    const icon = (CODES[code] || CODES[3])[1];
    if (!isDay) {
      if (icon === "sunny") return "clear_night";
      if (icon === "partly_cloudy_day") return "partly_cloudy_night";
    }
    return icon;
  }
  const iconHtml = (name, cls = "") => `<span class="mu-icon ${cls}" aria-hidden="true">${name}</span>`;
  /** Night icon: the moon at its real phase, with the weather as a small badge when it isn't clear. */
  function nightIcon(code, ms, lat, size) {
    const m = Sun.moon(ms);
    const badge = code > 1 ? `<span class="mu-icon gw-moon-badge" aria-hidden="true">${condIcon(code, false) === "partly_cloudy_night" ? "cloud" : condIcon(code, false)}</span>` : "";
    return `<span class="gw-moon-icon" style="--s:${size}px">${Sun.moonSVG(m.phase, size, lat < 0)}${badge}</span>`;
  }

  // ------------------------------------------------------------ network
  const WEATHER_API = "/api/weather";
  // Place search and names come straight from Photon; the Weather server is only the backup
  // (it retries Photon and then Open-Meteo's geocoder).
  const PHOTON = "https://photon.komoot.io";
  async function photonJSON(path, params, signal) {
    try {
      const res = await fetch(PHOTON + path + "?" + params, { signal, referrerPolicy: "no-referrer", credentials: "omit", mode: "cors" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!Array.isArray(data?.features)) throw new Error("Invalid Photon response");
      return data;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return getJSON(WEATHER_API + (path === "/api/" ? "/search?" : "/reverse?") + params, { signal });
    }
  }
  let retryWeatherAt = 0;
  async function getJSON(url, opts) {
    if (Date.now() < retryWeatherAt) throw Object.assign(new Error("HTTP 429"), { status: 429 });
    const res = await fetch(url, Object.assign({ referrerPolicy: "no-referrer", credentials: "omit" }, opts));
    if (res.status === 429) {
      const now = Date.now();
      if (now >= retryWeatherAt) UI.toast(t("rateLimited"), { type: "error" });
      const seconds = Number(res.headers.get("Retry-After")) || 60;
      retryWeatherAt = Math.max(retryWeatherAt, now + seconds * 1000);
    }
    if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { status: res.status });
    return res.json();
  }
  function forecastURL(loc, timezone, includePast) {
    const p = new URLSearchParams({
      latitude: loc.lat.toFixed(4), longitude: loc.lon.toFixed(4), timezone, timeformat: "unixtime", forecast_days: "16",
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      hourly: "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,snowfall,weather_code,cloud_cover,pressure_msl,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,daylight_duration,sunshine_duration,uv_index_max,precipitation_sum,precipitation_probability_max,precipitation_hours,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant",
      minutely_15: "precipitation", forecast_minutely_15: "12",
      temperature_unit: settings.temp, wind_speed_unit: settings.wind, precipitation_unit: settings.precip,
    });
    if (includePast) p.set("past_days", "1");
    return WEATHER_API + "/forecast?" + p;
  }
  async function requestForecast(loc, timezone, includePast) {
    const data = await getJSON(forecastURL(loc, timezone, includePast));
    if (!data?.current || !data.hourly?.time?.length || !data.daily?.time?.length) {
      throw new Error("Invalid weather data");
    }
    return data;
  }
  async function loadForecast(loc, revision) {
    const timezone = settings.useDeviceTimezone ? deviceZone : "auto";
    let data;
    if (timezone !== "auto") {
      try {
        data = await requestForecast(loc, timezone, true);
      } catch (error) {
        if (error.status === 429) throw error;
      }
    }
    if (revision !== zoneRevision) return;
    if (!data) data = await requestForecast(loc, timezone, false);
    if (revision !== zoneRevision) return;
    if (timezone === "auto" && data.timezone && loc.tz !== data.timezone) { loc.tz = data.timezone; saveLocations(); }
    if (timezone !== "auto") {
      // Keep past hours for calculations and start the daily forecast on today's date.
      const today = Sun.localParts(Date.now(), timezone, loc.lon);
      const start = Sun.localMidnight(today.year, today.month, today.day, timezone, loc.lon);
      const first = data.daily.time.findIndex(ts => ts * 1000 + 12 * HOUR >= start);
      if (first > 0) {
        for (const [key, values] of Object.entries(data.daily)) {
          if (Array.isArray(values)) data.daily[key] = values.slice(first);
        }
      }
    }
    // Visibility arrives in feet with imperial units; keep meters internally.
    if (data.hourly_units?.visibility === "ft") data.hourly.visibility = data.hourly.visibility.map((v) => (v == null ? v : v * 0.3048));
    data.fetchedAt = Date.now();
    store.data[loc.id] = data;
    return data;
  }
  async function loadAirQuality(loc, revision) {
    const p = new URLSearchParams({ latitude: loc.lat.toFixed(4), longitude: loc.lon.toFixed(4), timezone: settings.useDeviceTimezone ? deviceZone : "auto", timeformat: "unixtime", current: "us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide", hourly: "us_aqi,european_aqi", forecast_days: "7" });
    const data = await getJSON(WEATHER_API + "/air-quality?" + p);
    if (revision === zoneRevision) store.aq[loc.id] = data;
  }
  const inUS = (loc) => (loc.countryCode ? US_CODES.has(loc.countryCode.toUpperCase()) : (loc.lat > 18 && loc.lat < 72 && loc.lon > -180 && loc.lon < -64) || (loc.lat > 13 && loc.lat < 21 && loc.lon > 144 && loc.lon < 146));
  async function loadNWS(loc) {
    if (!inUS(loc)) { store.alerts[loc.id] = { supported: false, features: [] }; store.nws[loc.id] = null; return; }
    const pt = loc.lat.toFixed(4) + "," + loc.lon.toFixed(4);
    const alertsP = getJSON(WEATHER_API + "/nws/alerts?point=" + pt)
      .then((a) => { store.alerts[loc.id] = { supported: true, features: a.features || [] }; })
      .catch(() => { store.alerts[loc.id] = { supported: true, error: true, features: [] }; });
    const forecastP = getJSON(WEATHER_API + "/nws/points/" + pt)
      .then((p) => p.properties?.forecast ? getJSON(WEATHER_API + "/nws" + new URL(p.properties.forecast).pathname) : null)
      .then((f) => { store.nws[loc.id] = f?.properties?.periods || null; })
      .catch(() => { store.nws[loc.id] = null; });
    await Promise.all([alertsP, forecastP]);
  }
  async function loadSummaries() {
    const list = locations.filter((l) => l.id !== activeId);
    if (!list.length) return;
    const revision = zoneRevision;
    const timezone = settings.useDeviceTimezone ? list.map(() => deviceZone).join(",") : "auto";
    const p = new URLSearchParams({ latitude: list.map((l) => l.lat.toFixed(4)).join(","), longitude: list.map((l) => l.lon.toFixed(4)).join(","), timezone, timeformat: "unixtime", current: "temperature_2m,weather_code,is_day", daily: "temperature_2m_max,temperature_2m_min", forecast_days: "1", temperature_unit: settings.temp });
    try {
      let res = await getJSON(WEATHER_API + "/forecast?" + p);
      if (revision !== zoneRevision) return;
      if (!Array.isArray(res)) res = [res];
      res.forEach((r, i) => {
        const loc = list[i];
        if (!loc) return;
        store.summary[loc.id] = r;
        if (timezone === "auto" && r.timezone && !loc.tz) loc.tz = r.timezone;
      });
      saveLocations();
      renderLocations();
    } catch (e) { /* the sidebar keeps its last values */ }
  }

  // ------------------------------------------------------------ Photon search
  const PHOTON_LANGS = ["en", "de", "fr"];
  function photonParams(extra) {
    const p = new URLSearchParams(extra);
    p.set("layer", "city");
    const l = lang().split("-")[0];
    // Photon translates to a few languages; everywhere else names stay in the local language of the place.
    if (PHOTON_LANGS.includes(l)) p.set("lang", l);
    return p;
  }
  function photonToPlace(f) {
    const pr = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    return { name: pr.name || pr.city || "", admin: pr.state || pr.county || "", country: pr.country || "", countryCode: (pr.countrycode || "").toUpperCase(), lat, lon, type: pr.type, osmValue: pr.osm_value };
  }
  const isCity = (pl) => pl.type === "city" || ["city", "town", "village", "municipality"].includes(pl.osmValue);
  async function searchPlaces(q, signal) {
    const active = activeLocation();
    const p = photonParams({ q });
    if (active) { p.set("lat", active.lat.toFixed(2)); p.set("lon", active.lon.toFixed(2)); }
    const res = await photonJSON("/api/", p, signal);
    if (!Array.isArray(res?.features)) throw new Error("Invalid search results");
    const seen = new Set();
    return res.features.map(photonToPlace).filter((pl) => {
      if (!isCity(pl) || !pl.name) return false;
      const key = pl.name + "|" + pl.admin + "|" + pl.country;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  async function reversePlace(lat, lon, signal) {
    try {
      const res = await photonJSON("/reverse", photonParams({ lat: lat.toFixed(5), lon: lon.toFixed(5) }), signal);
      const f = (res.features || [])[0];
      if (f) {
        const pl = photonToPlace(f);
        return Object.assign(pl, { lat, lon });
      }
      const res2 = await photonJSON("/reverse", new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5) }), signal);
      const g = (res2.features || [])[0];
      if (g) {
        const pr = g.properties || {};
        return { name: pr.city || pr.town || pr.village || pr.county || pr.state || pr.name || coordsLabel(lat, lon), admin: pr.state || "", country: pr.country || "", countryCode: (pr.countrycode || "").toUpperCase(), lat, lon };
      }
    } catch (e) { /* fall back to coordinates */ }
    return { name: coordsLabel(lat, lon), admin: "", country: "", countryCode: "", lat, lon };
  }
  function coordsLabel(lat, lon) {
    const ns = lat >= 0 ? t("north") : t("south");
    const ew = lon >= 0 ? t("east") : t("west");
    return `${num(Math.abs(lat), 4)}° ${ns}, ${num(Math.abs(lon), 4)}° ${ew}`;
  }
  /** Parses decimal or degrees-minutes-seconds coordinates. Returns { lat, lon } or null. */
  function parseCoords(q) {
    const s = q.trim();
    if (!/^[\s\d.,;°'′’"″”+\-NSEWnsew]+$/.test(s) || !/\d/.test(s)) return null;
    const re = /([-+]?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″”]|'')\s*)?([NSEWnsew])?/g;
    const parts = [];
    let m;
    while ((m = re.exec(s))) {
      if (!m[0].trim()) { re.lastIndex++; continue; }
      const neg = m[1].startsWith("-");
      let v = Math.abs(Number(m[1])) + (m[2] ? Number(m[2]) / 60 : 0) + (m[3] ? Number(m[3]) / 3600 : 0);
      const hemi = (m[4] || "").toUpperCase();
      if (neg || hemi === "S" || hemi === "W") v = -v;
      parts.push({ v, hemi });
    }
    if (parts.length !== 2) return null;
    let [a, b] = parts;
    if ((a.hemi === "E" || a.hemi === "W") && (b.hemi === "N" || b.hemi === "S" || !b.hemi)) [a, b] = [b, a];
    if (Math.abs(a.v) > 90 || Math.abs(b.v) > 180) return null;
    return { lat: a.v, lon: b.v };
  }

  // ------------------------------------------------------------ locations
  const activeLocation = () => locations.find((l) => l.id === activeId) || null;
  const locationName = (loc) => loc.isCurrent ? t("myLocation") : loc.name;
  function saveLocations() { write(KEYS.locations, locations); write(KEYS.active, activeId); }
  function addLocation(pl, { current = false, select = true } = {}) {
    const existing = locations.find((l) => Boolean(l.isCurrent) === current && Math.abs(l.lat - pl.lat) < 0.01 && Math.abs(l.lon - pl.lon) < 0.01);
    if (existing) {
      if (select) setActive(existing.id);
      if (!current) UI.toast(t("alreadySaved", { name: existing.name }));
      return existing;
    }
    const loc = { id: "loc-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: pl.name, admin: pl.admin || "", country: pl.country || "", countryCode: pl.countryCode || "", lat: Number(pl.lat), lon: Number(pl.lon), tz: pl.tz || null };
    if (current) {
      loc.isCurrent = true;
      const index = locations.findIndex((l) => l.isCurrent);
      if (index < 0) locations.unshift(loc);
      else {
        const previousId = locations[index].id;
        locations[index] = loc;
        for (const entries of Object.values(store)) delete entries[previousId];
        if (activeId === previousId) select = true;
      }
    } else locations.push(loc);
    if (select) setActive(loc.id);
    else { saveLocations(); loadSummaries(); renderLocations(); }
    if (!current) UI.toast(t("locationAdded", { name: loc.name }), { type: "success" });
    return loc;
  }
  function removeLocation(id) {
    const loc = locations.find((l) => l.id === id);
    if (loc?.isCurrent) write(KEYS.skipMyLocation, true);
    locations = locations.filter((l) => l.id !== id);
    delete store.data[id];
    if (activeId === id) activeId = locations[0]?.id || null;
    saveLocations();
    renderLocations();
    refresh();
    if (loc) UI.toast(t("locationRemoved", { name: locationName(loc) }));
  }
  function moveLocation(id, dir) {
    const i = locations.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= locations.length) return;
    [locations[i], locations[j]] = [locations[j], locations[i]];
    saveLocations();
    renderLocations();
  }
  function setActive(id) {
    activeId = id;
    view.sunDate = null;
    saveLocations();
    renderLocations();
    refresh();
    if (window.matchMedia("(width < 900px)").matches) toggleSidebar(false);
  }

  function renderLocations() {
    const list = $("#locationList");
    if (!locations.length) {
      list.innerHTML = `<li class="mu-empty gw-empty-locations"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">location_on</span></span><span>${esc(t("noLocations"))}</span></li>`;
      return;
    }
    list.innerHTML = locations.map((loc) => {
      const name = locationName(loc);
      const place = loc.isCurrent ? loc.name : loc.country;
      const d = loc.id === activeId ? store.data[loc.id] : store.summary[loc.id];
      const cur = d?.current;
      const now = Date.now();
      const temp = cur ? deg(cur.temperature_2m) : "";
      const icon = cur ? (cur.is_day ? iconHtml(condIcon(cur.weather_code, true)) : nightIcon(cur.weather_code, now, loc.lat, 26)) : "";
      const hi = d?.daily ? deg(d.daily.temperature_2m_max[0]) : "";
      const lo = d?.daily ? deg(d.daily.temperature_2m_min[0]) : "";
      return `<li class="gw-loc${loc.id === activeId ? " is-active" : ""}">
        <button type="button" class="gw-loc-main" data-id="${loc.id}" ${loc.id === activeId ? 'aria-current="true"' : ""}>
          <span class="gw-loc-text"><span class="gw-loc-name">${esc(name)}</span><span class="gw-loc-sub">${esc(timeStr(now, loc))}${place ? " · " + esc(place) : ""}</span>${cur ? `<span class="gw-loc-sub">${esc(condText(cur.weather_code))}</span>` : ""}</span>
          <span class="gw-loc-wx">${icon}<span class="gw-loc-temp">${temp}</span>${hi ? `<span class="gw-loc-sub">${esc(t("hiLoShort", { hi, lo }))}</span>` : ""}</span>
        </button>
        <button type="button" class="mu-icon-btn mu-icon-btn-sm gw-loc-more" data-more="${loc.id}" aria-label="${esc(t("locationOptions", { name }))}" title="${esc(t("locationOptions", { name }))}"><span class="mu-icon" aria-hidden="true">more_vert</span></button>
      </li>`;
    }).join("");
  }

  // Context menu for a saved location
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
  function showMenu(anchor, items) {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "mu-menu mu-menu-context mu-menu-floating";
    menu.setAttribute("role", "menu");
    menu.innerHTML = items.map((it, i) => it.sep ? '<div class="mu-menu-sep" role="separator"></div>' : `<button type="button" class="mu-menu-item${it.danger ? " is-danger" : ""}" role="menuitem" data-i="${i}" ${it.disabled ? "disabled" : ""}>${iconHtml(it.icon)}<span>${esc(it.label)}</span></button>`).join("");
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = clamp(r.right - mw, 8, innerWidth - mw - 8) + "px";
    menu.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + "px";
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      const it = items[Number(b.dataset.i)];
      closeMenu();
      it.run();
    });
    openMenu = menu;
    menu.querySelector("button:not([disabled])")?.focus();
  }
  document.addEventListener("pointerdown", (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenu) { closeMenu(); } });

  // ------------------------------------------------------------ render: main
  let sky = null;
  function currentHourIndex(d) {
    const now = Date.now() / 1000;
    const times = d.hourly.time;
    const next = times.findIndex((x) => x > now);
    return next < 0 ? Math.max(0, times.length - 1) : Math.max(0, next - 1);
  }
  function renderAll() {
    const loc = activeLocation();
    const d = loc && store.data[loc.id];
    $("#main").setAttribute("aria-busy", d ? "false" : "true");
    if (!loc) { renderEmpty(); return; }
    $("#placeName").textContent = locationName(loc);
    $("#placeSub").textContent = placeSubtitle(loc);
    renderSun();
    renderAlerts();
    updateSky();
    if (!d) {
      const spinner = `<div class="spinner-container gw-loading" role="status" aria-label="${esc(t("loading"))}"><svg class="google-spinner" viewBox="0 0 50 50" aria-hidden="true" focusable="false"><circle class="spinner-circle" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg></div>`;
      ["#hourly", "#details", "#daily", "#chart"].forEach((sel) => { $(sel).innerHTML = spinner; });
      ["#nowTemp", "#nowCond", "#nowHiLo", "#nowFeels", "#nowcast"].forEach((sel) => { $(sel).textContent = ""; });
      $("#nowIcon").innerHTML = "";
      $("#chartLegend").innerHTML = "";
      $("#nwsCard").hidden = true;
      return;
    }
    renderNow(loc, d);
    renderHourly(loc, d);
    renderDetails(loc, d);
    renderChart();
    renderDaily(loc, d);
    renderNWS(loc);
  }
  function placeSubtitle(loc) {
    const place = [loc.isCurrent ? loc.name : "", loc.admin, loc.country].filter(Boolean);
    return [[...new Set(place)].join(", "), dateStr(Date.now(), loc, { weekday: "long", month: "long", day: "numeric" }), timeStr(Date.now(), loc)].filter(Boolean).join(" · ");
  }
  function renderEmpty() {
    $("#placeName").textContent = t("welcomeTitle");
    $("#placeSub").textContent = t("welcomeText");
    $("#nowTemp").textContent = "";
    $("#nowCond").textContent = "";
    $("#nowHiLo").textContent = "";
    $("#nowFeels").textContent = "";
    $("#nowIcon").innerHTML = "";
    $("#nowcast").textContent = "";
    $("#hourly").innerHTML = `<p class="mu-muted">${esc(t("addToSeeForecast"))}</p>`;
    $("#details").innerHTML = "";
    $("#daily").innerHTML = "";
    $("#chart").innerHTML = "";
    $("#chartLegend").innerHTML = "";
    $("#nwsCard").hidden = true;
    $("#alertStrip").hidden = true;
    renderAlerts();
    renderSun();
    updateSky();
  }

  function renderNow(loc, d) {
    const c = d.current;
    $("#nowTemp").textContent = deg(c.temperature_2m);
    $("#nowTemp").setAttribute("aria-label", t("temperatureIs", { v: num(Math.round(c.temperature_2m)) + tempUnit() }));
    $("#nowCond").textContent = condText(c.weather_code);
    $("#nowHiLo").textContent = t("hiLo", { hi: deg(d.daily.temperature_2m_max[0]), lo: deg(d.daily.temperature_2m_min[0]) });
    $("#nowFeels").textContent = t("feelsLikeValue", { v: deg(c.apparent_temperature) });
    $("#nowIcon").innerHTML = c.is_day ? iconHtml(condIcon(c.weather_code, true), "mu-icon-filled") : nightIcon(c.weather_code, Date.now(), loc.lat, 72);
    $("#nowcast").textContent = nowcastText(d);
  }
  function nowcastText(d) {
    const m = d.minutely_15;
    if (!m?.time) return "";
    const now = Date.now() / 1000;
    const idx = m.time.findIndex((x) => x + 900 > now);
    if (idx < 0) return "";
    const next = m.precipitation.slice(idx, idx + 8);
    const raining = (next[0] || 0) > 0;
    if (raining) {
      const stop = next.findIndex((v) => !v);
      return stop < 0 ? t("nowcastContinuing") : t("nowcastStopping", { min: num(stop * 15) });
    }
    const start = next.findIndex((v) => v > 0);
    return start < 0 ? t("nowcastNone") : t("nowcastStarting", { min: num(start * 15) });
  }

  function renderHourly(loc, d) {
    const h = d.hourly;
    const i0 = currentHourIndex(d);
    const items = [];
    for (let i = i0; i < i0 + 24 && i < h.time.length; i++) items.push({ kind: "hour", t: h.time[i] * 1000, i });
    // Sunrise and sunset inside the next 24 hours (computed on the device).
    const start = items[0]?.t ?? Date.now();
    const end = start + 24 * HOUR;
    const zone = zoneOf(loc);
    const lp = Sun.localParts(start, zone, loc.lon);
    for (let k = 0; k <= 2; k++) {
      const info = Sun.day(lp.year, lp.month, lp.day + k, loc.lat, loc.lon, zone);
      [["sunrise", info.sunrise], ["sunset", info.sunset]].forEach(([kind, ms]) => {
        if (ms && ms > Date.now() && ms < end && !items.some((x) => x.kind === kind && Math.abs(x.t - ms) < HOUR)) items.push({ kind, t: ms });
      });
    }
    items.sort((a, b) => a.t - b.t);
    $("#hourly").innerHTML = items.map((it, n) => {
      if (it.kind !== "hour") {
        return `<div class="gw-hour is-sun" role="listitem"><span class="gw-hour-time">${esc(timeStr(it.t, loc))}</span>${iconHtml(it.kind === "sunrise" ? "wb_twilight" : "wb_twilight", "gw-sun-icon is-" + it.kind)}<span class="gw-hour-temp">${esc(t(it.kind))}</span></div>`;
      }
      const i = it.i;
      const isDay = h.is_day[i];
      const code = h.weather_code[i];
      const pp = h.precipitation_probability[i];
      const icon = isDay ? iconHtml(condIcon(code, true), "mu-icon-filled") : nightIcon(code, it.t, loc.lat, 34);
      const label = n === 0 && it.t <= Date.now() ? t("now") : hourStr(it.t, loc);
      return `<div class="gw-hour${isDay ? "" : " is-night"}" role="listitem" aria-label="${esc(label + ", " + condText(code) + ", " + deg(h.temperature_2m[i]))}">
        <span class="gw-hour-time">${esc(label)}</span>${icon}<span class="gw-hour-temp">${deg(h.temperature_2m[i])}</span>
        <span class="gw-hour-pop${pp >= 10 ? "" : " is-empty"}">${iconHtml("water_drop")}${pct(pp)}</span></div>`;
    }).join("");
  }

  function uvCategory(uv) { return uv < 3 ? "uvLow" : uv < 6 ? "uvModerate" : uv < 8 ? "uvHigh" : uv < 11 ? "uvVeryHigh" : "uvExtreme"; }
  function aqiCategory(v, us) {
    if (v == null) return "";
    if (us) return v <= 50 ? "aqiGood" : v <= 100 ? "aqiModerate" : v <= 150 ? "aqiSensitive" : v <= 200 ? "aqiUnhealthy" : v <= 300 ? "aqiVeryUnhealthy" : "aqiHazardous";
    return v <= 20 ? "aqiGood" : v <= 40 ? "aqiFair" : v <= 60 ? "aqiModerate" : v <= 80 ? "aqiPoor" : v <= 100 ? "aqiVeryPoor" : "aqiExtremelyPoor";
  }
  function windArrow(dir) {
    return `<svg class="gw-compass" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" class="gw-compass-ring"/>${[0, 90, 180, 270].map((a) => `<line x1="32" y1="5" x2="32" y2="10" transform="rotate(${a} 32 32)" class="gw-compass-tick"/>`).join("")}<g transform="rotate(${(dir + 180) % 360} 32 32)"><path d="M32 12 L39 34 L32 29 L25 34 Z" class="gw-compass-arrow"/><line x1="32" y1="29" x2="32" y2="52" class="gw-compass-tail"/></g></svg>`;
  }
  function tile(icon, label, value, sub, extra = "") {
    return `<div class="gw-tile"><div class="gw-tile-head">${iconHtml(icon)}<span>${esc(label)}</span></div><div class="gw-tile-value">${value}</div>${sub ? `<div class="gw-tile-sub">${sub}</div>` : ""}${extra}</div>`;
  }
  function renderDetails(loc, d) {
    const c = d.current;
    const h = d.hourly;
    const i = currentHourIndex(d);
    const dew = h.dew_point_2m[i];
    const uv = h.uv_index[i];
    const vis = h.visibility[i];
    const p3 = h.pressure_msl[Math.max(0, i - 3)];
    const trend = c.pressure_msl - p3;
    const trendKey = trend > 1 ? "pressureRising" : trend < -1 ? "pressureFalling" : "pressureSteady";
    const precip24 = h.precipitation.slice(i, i + 24).reduce((a, b) => a + (b || 0), 0);
    const aq = store.aq[loc.id]?.current;
    const usAqi = inUS(loc);
    const aqiV = aq ? (usAqi ? aq.us_aqi : aq.european_aqi) : null;
    const moon = Sun.moon(Date.now());
    const today = Sun.localParts(Date.now(), zoneOf(loc), loc.lon);
    const sunInfo = Sun.day(today.year, today.month, today.day, loc.lat, loc.lon, zoneOf(loc));
    const tiles = [
      tile("device_thermostat", t("feelsLike"), deg(c.apparent_temperature), esc(c.apparent_temperature < c.temperature_2m - 1 ? t("feelsColder") : c.apparent_temperature > c.temperature_2m + 1 ? t("feelsWarmer") : t("feelsSame"))),
      tile("humidity_percentage", t("humidity"), pct(c.relative_humidity_2m), esc(t("dewPointValue", { v: deg(dew) }))),
      tile("air", t("wind"), `${num(c.wind_speed_10m)} <span class="gw-unit">${esc(windUnit())}</span>`, esc(t("gustsValue", { v: num(c.wind_gusts_10m) + " " + windUnit() })) + "<br>" + esc(compass(c.wind_direction_10m) + " · " + num(c.wind_direction_10m) + "°"), windArrow(c.wind_direction_10m)),
      tile("compress", t("pressure"), esc(pressureStr(c.pressure_msl)), esc(t(trendKey))),
      tile("wb_sunny", t("uvIndex"), num(uv, 0), esc(t(uvCategory(uv || 0))), `<div class="gw-meter" style="--v:${clamp((uv || 0) / 11, 0, 1)}"><i></i></div>`),
      tile("visibility", t("visibility"), esc(visibilityStr(vis)), ""),
      tile("cloud", t("cloudCover"), pct(c.cloud_cover), ""),
      tile("water_drop", t("precipitation"), `${num(precip24, settings.precip === "inch" ? 2 : 1)} <span class="gw-unit">${esc(precipUnit())}</span>`, esc(t("next24h"))),
      tile("aq", t("airQuality"), aqiV == null ? "—" : num(aqiV), aqiV == null ? "" : esc(t(aqiCategory(aqiV, usAqi)) + " · " + (usAqi ? t("usAqi") : t("euAqi"))) + (aq?.pm2_5 != null ? "<br>" + esc(t("pm25Value", { v: num(aq.pm2_5, 1) })) : "")),
      tile("light_mode", t("daylight"), esc(sunInfo.polarDay ? t("polarDay") : sunInfo.polarNight ? t("polarNight") : durationStr(sunInfo.daylight)), esc(t("sunshineValue", { v: durationStr((d.daily.sunshine_duration[0] || 0) * 1000) }))),
      `<div class="gw-tile"><div class="gw-tile-head">${iconHtml("bedtime")}<span>${esc(t("moon"))}</span></div><div class="gw-tile-value gw-tile-moon">${Sun.moonSVG(moon.phase, 44, loc.lat < 0)}<span>${pct(moon.illumination * 100)}</span></div><div class="gw-tile-sub">${esc(t(Sun.moonPhaseKey(moon.phase)))}</div></div>`,
    ];
    $("#details").innerHTML = tiles.join("");
  }

  // ------------------------------------------------------------ charts
  const METRICS = {
    temp: { label: "chartTemperature", series: [["temperature_2m", "temperature", 1], ["apparent_temperature", "feelsLike", 2]], unit: () => tempUnit(), digits: 0 },
    precipProb: { label: "chartPrecipChance", series: [["precipitation_probability", "chancePrecip", 3]], unit: () => "%", digits: 0, bars: true, min: 0, max: 100 },
    precip: { label: "chartPrecipAmount", series: [["precipitation", "precipitation", 3]], unit: () => precipUnit(), digits: 2, bars: true, min: 0 },
    wind: { label: "chartWind", series: [["wind_speed_10m", "windSpeed", 1], ["wind_gusts_10m", "gusts", 2]], unit: () => windUnit(), digits: 0, min: 0 },
    humidity: { label: "humidity", series: [["relative_humidity_2m", "humidity", 1]], unit: () => "%", digits: 0, min: 0, max: 100 },
    dew: { label: "dewPoint", series: [["dew_point_2m", "dewPoint", 2]], unit: () => tempUnit(), digits: 0 },
    pressure: { label: "pressure", series: [["pressure_msl", "pressure", 1]], unit: () => pressureUnit(), digits: settings.pressure === "inHg" ? 2 : 0, map: pressureValue },
    uv: { label: "uvIndex", series: [["uv_index", "uvIndex", 1]], unit: () => "", digits: 1, min: 0 },
    clouds: { label: "cloudCover", series: [["cloud_cover", "cloudCover", 3]], unit: () => "%", digits: 0, min: 0, max: 100 },
    visibility: { label: "visibility", series: [["visibility", "visibility", 2]], unit: () => distanceUnit(), digits: 1, min: 0, map: distanceValue },
  };
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
    return { lo, hi, ticks, step };
  }
  function chartData() {
    const loc = activeLocation();
    const d = loc && store.data[loc.id];
    if (!d) return null;
    const m = METRICS[view.metric];
    const h = d.hourly;
    const i0 = currentHourIndex(d);
    const i1 = Math.min(h.time.length, i0 + view.range);
    const times = h.time.slice(i0, i1).map((x) => x * 1000);
    const series = m.series.map(([key, label, color]) => ({ key, label: t(label), color, values: h[key].slice(i0, i1).map((v) => (v == null ? null : m.map ? m.map(v) : v)) }));
    return { loc, m, times, series, isDay: h.is_day.slice(i0, i1) };
  }
  function renderChart() {
    const cd = chartData();
    const host = $("#chart");
    if (!cd) { host.innerHTML = ""; return; }
    const { loc, m, times, series, isDay } = cd;
    const W = Math.max(320, host.clientWidth || 600);
    const Hh = 340;
    const pad = { l: 72, r: 18, t: 18, b: 52 };
    const pw = W - pad.l - pad.r;
    const ph = Hh - pad.t - pad.b;
    const all = series.flatMap((s) => s.values).filter((v) => v != null);
    let min = m.min ?? Math.min(...all);
    let max = m.max ?? Math.max(...all);
    if (m.min != null && max <= min) max = min + 1;
    const nt = niceTicks(min, max, 4);
    const lo = m.min ?? nt.lo;
    const hi = m.max ?? nt.hi;
    const n = times.length;
    const x = (i) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * pw);
    const y = (v) => pad.t + ph - ((v - lo) / (hi - lo || 1)) * ph;
    let svg = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="${esc(t(m.label))}">`;
    svg += `<defs><linearGradient id="gwArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="gw-area-top"/><stop offset="1" class="gw-area-bottom"/></linearGradient></defs>`;
    // Night bands
    let runStart = null;
    for (let i = 0; i <= n; i++) {
      const night = i < n && !isDay[i];
      if (night && runStart == null) runStart = i;
      if (!night && runStart != null) {
        svg += `<rect class="gw-night-band" x="${x(runStart)}" y="${pad.t}" width="${Math.max(1, x(Math.min(n - 1, i)) - x(runStart))}" height="${ph}" rx="6"/>`;
        runStart = null;
      }
    }
    // Grid and y labels
    nt.ticks.filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9).forEach((v) => {
      svg += `<line class="gw-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="gw-axis" x="${pad.l - 10}" y="${y(v) + 6}" text-anchor="end">${esc(num(v, nt.step < 1 ? (nt.step < 0.1 ? 2 : 1) : 0))}</text>`;
    });
    // X labels
    const lastLabelX = { v: -Infinity };
    times.forEach((ms, i) => {
      const lp = Sun.localParts(ms, zoneOf(loc), loc.lon);
      let label = null;
      if (view.range <= 48) { if (lp.hour % (view.range <= 24 ? 3 : 6) === 0) label = lp.hour === 0 ? dateStr(ms, loc, { weekday: "short" }) : hourStr(ms, loc); }
      else if (lp.hour === 0) label = view.range <= 168 ? dateStr(ms, loc, { weekday: "short" }) : dateStr(ms, loc, { day: "numeric" });
      if (label == null) return;
      const px = x(i);
      if (px - lastLabelX.v < (view.range > 168 ? 40 : 64)) return;
      lastLabelX.v = px;
      svg += `<line class="gw-grid gw-grid-v" x1="${px}" x2="${px}" y1="${pad.t}" y2="${pad.t + ph}"/>`;
      svg += `<text class="gw-axis" x="${px}" y="${Hh - 16}" text-anchor="middle">${esc(label)}</text>`;
    });
    // Marks
    series.forEach((s, si) => {
      if (m.bars) {
        const bw = Math.max(1, pw / n - 2);
        s.values.forEach((v, i) => {
          if (!v) return;
          const top = y(v);
          svg += `<rect class="gw-bar gw-c${s.color}" x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, pad.t + ph - top)}" rx="${Math.min(4, bw / 2)}"/>`;
        });
        return;
      }
      let path = "";
      s.values.forEach((v, i) => { if (v == null) return; path += (path ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); });
      if (si === 0) svg += `<path class="gw-area" d="${path}L${x(n - 1)} ${pad.t + ph}L${x(0)} ${pad.t + ph}Z" fill="url(#gwArea)"/>`;
      svg += `<path class="gw-line gw-c${s.color}${si > 0 ? " is-secondary" : ""}" d="${path}"/>`;
    });
    // Direct labels for the high and low of the first series (selective, not on every point)
    if (!m.bars && series[0]) {
      const vals = series[0].values;
      let iMax = 0;
      let iMin = 0;
      vals.forEach((v, i) => { if (v == null) return; if (v > vals[iMax]) iMax = i; if (v < vals[iMin]) iMin = i; });
      [[iMax, -12], [iMin, 28]].forEach(([i, dy]) => {
        const v = vals[i];
        if (v == null) return;
        const anchor = i < n * 0.1 ? "start" : i > n * 0.9 ? "end" : "middle";
        svg += `<circle class="gw-dot gw-c${series[0].color}" cx="${x(i)}" cy="${y(v)}" r="5"/><text class="gw-point-label" x="${x(i)}" y="${clamp(y(v) + dy, pad.t + 16, pad.t + ph - 4)}" text-anchor="${anchor}">${esc(num(v, m.digits) + (m.unit() === "%" ? "%" : m.unit().startsWith("°") ? "°" : ""))}</text>`;
      });
    }
    svg += `<g class="gw-hover" hidden><line class="gw-crosshair" y1="${pad.t}" y2="${pad.t + ph}"/>${series.map((s) => `<circle class="gw-dot gw-c${s.color}" r="6"/>`).join("")}</g>`;
    svg += `<rect class="gw-hit" x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
    host.innerHTML = svg + `<div class="gw-tooltip mu-glass-solid" role="status" hidden></div>`;
    // Legend for two or more series
    $("#chartLegend").innerHTML = series.length > 1 ? series.map((s, i) => `<span class="gw-legend-item"><i class="gw-c${s.color}${i > 0 ? " is-secondary" : ""}"></i>${esc(s.label)}</span>`).join("") : `<span class="gw-legend-item is-single">${esc(t(m.label))}${m.unit() ? " (" + esc(m.unit()) + ")" : ""}</span>`;
    // Hover layer
    const svgEl = host.querySelector("svg");
    const hover = svgEl.querySelector(".gw-hover");
    const tip = host.querySelector(".gw-tooltip");
    const show = (clientX) => {
      const r = svgEl.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const i = clamp(Math.round(((px - pad.l) / pw) * (n - 1)), 0, n - 1);
      hover.hidden = false;
      const cx = x(i);
      hover.querySelector("line").setAttribute("x1", cx);
      hover.querySelector("line").setAttribute("x2", cx);
      hover.querySelectorAll("circle").forEach((c, k) => {
        const v = series[k].values[i];
        c.setAttribute("cx", cx);
        c.setAttribute("cy", v == null ? -50 : m.bars ? y(v) : y(v));
      });
      tip.hidden = false;
      tip.innerHTML = `<div class="gw-tip-time">${esc(dateStr(times[i], loc, { weekday: "short", day: "numeric" }) + " · " + timeStr(times[i], loc))}</div>` + series.map((s) => `<div class="gw-tip-row"><i class="gw-c${s.color}"></i><span>${esc(s.label)}</span><span>${esc(s.values[i] == null ? "—" : num(s.values[i], m.digits) + (m.unit() ? (m.unit() === "%" ? "%" : " " + m.unit()) : ""))}</span></div>`).join("");
      const tx = (cx / W) * r.width;
      tip.style.insetInlineStart = "auto";
      tip.style.left = clamp(tx + 14, 8, r.width - tip.offsetWidth - 8) + "px";
    };
    svgEl.addEventListener("pointermove", (e) => show(e.clientX));
    svgEl.addEventListener("pointerdown", (e) => show(e.clientX));
    svgEl.addEventListener("pointerleave", () => { hover.hidden = true; tip.hidden = true; });
    if (view.table) renderChartTable(cd);
  }
  function renderChartTable(cd) {
    const { loc, m, times, series } = cd;
    $("#chartTable").innerHTML = `<table class="mu-table"><caption class="mu-table-caption">${esc(t(m.label))}</caption><thead><tr><th scope="col">${esc(t("time"))}</th>${series.map((s) => `<th scope="col">${esc(s.label)}${m.unit() ? " (" + esc(m.unit()) + ")" : ""}</th>`).join("")}</tr></thead><tbody>${times.map((ms, i) => `<tr><td>${esc(dateStr(ms, loc, { weekday: "short", day: "numeric" }) + " " + timeStr(ms, loc))}</td>${series.map((s) => `<td>${esc(s.values[i] == null ? "—" : num(s.values[i], m.digits))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  // ------------------------------------------------------------ daily
  function renderDaily(loc, d) {
    const dl = d.daily;
    const n = dl.time.length;
    const lo = Math.min(...dl.temperature_2m_min);
    const hi = Math.max(...dl.temperature_2m_max);
    const span = hi - lo || 1;
    const nowT = d.current.temperature_2m;
    $("#daily").innerHTML = dl.time.map((ts, i) => {
      const ms = ts * 1000 + 12 * HOUR;
      const name = i === 0 ? t("today") : i === 1 ? t("tomorrow") : dateStr(ms, loc, { weekday: "long" });
      const date = dateStr(ms, loc, { month: "short", day: "numeric" });
      const pp = dl.precipitation_probability_max[i];
      const a = ((dl.temperature_2m_min[i] - lo) / span) * 100;
      const b = ((dl.temperature_2m_max[i] - lo) / span) * 100;
      const dot = i === 0 ? `<span class="gw-range-now" style="inset-inline-start:${clamp(((nowT - lo) / span) * 100, 0, 100)}%"></span>` : "";
      return `<li><button type="button" class="gw-day" data-day="${i}" aria-label="${esc(name + ", " + date + ", " + condText(dl.weather_code[i]) + ", " + t("hiLo", { hi: deg(dl.temperature_2m_max[i]), lo: deg(dl.temperature_2m_min[i]) }))}">
        <span class="gw-day-name"><span>${esc(name)}</span><span class="mu-muted">${esc(date)}</span></span>
        ${iconHtml(condIcon(dl.weather_code[i], true), "mu-icon-filled gw-day-icon")}
        <span class="gw-day-pop${pp >= 10 ? "" : " is-empty"}">${iconHtml("water_drop")}${pct(pp)}</span>
        <span class="gw-day-lo">${deg(dl.temperature_2m_min[i])}</span>
        <span class="gw-range"><span class="gw-range-fill" style="inset-inline-start:${a}%;inline-size:${Math.max(2, b - a)}%;--lo:${a};--hi:${b}"></span>${dot}</span>
        <span class="gw-day-hi">${deg(dl.temperature_2m_max[i])}</span>
      </button></li>`;
    }).join("");
    $("#dailyTitle").textContent = t("dailyForecastN", { n: num(n) });
  }
  function openDay(i) {
    const loc = activeLocation();
    const d = store.data[loc.id];
    const dl = d.daily;
    const ms = dl.time[i] * 1000 + 12 * HOUR;
    const lp = Sun.localParts(ms, zoneOf(loc), loc.lon);
    const info = Sun.day(lp.year, lp.month, lp.day, loc.lat, loc.lon, zoneOf(loc));
    const st = sunTimes(loc, info, lp.year, lp.month, lp.day);
    const rise = info.polarDay ? clockStr(0, 0) : info.polarNight ? clockStr(12, 0) : st.riseText;
    const set = info.polarDay ? clockStr(0, 0) : info.polarNight ? clockStr(12, 0) : st.setText;
    $("#dayModalTitle").textContent = dateStr(ms, loc, { weekday: "long", month: "long", day: "numeric" });
    $("#dayModalIcon").innerHTML = iconHtml(condIcon(dl.weather_code[i], true));
    const row = (icon, label, value) => `<div class="gw-day-row">${iconHtml(icon)}<span>${esc(label)}</span><span>${value}</span></div>`;
    $("#dayModalBody").innerHTML = `<p class="gw-day-cond">${esc(condText(dl.weather_code[i]))}</p>` + [
      row("thermostat", t("highLow"), esc(deg(dl.temperature_2m_max[i]) + " / " + deg(dl.temperature_2m_min[i]))),
      row("device_thermostat", t("feelsLike"), esc(deg(dl.apparent_temperature_max[i]) + " / " + deg(dl.apparent_temperature_min[i]))),
      row("water_drop", t("chancePrecip"), esc(pct(dl.precipitation_probability_max[i]))),
      row("rainy", t("precipitation"), esc(num(dl.precipitation_sum[i], settings.precip === "inch" ? 2 : 1) + " " + precipUnit() + " · " + t("hoursValue", { n: num(dl.precipitation_hours[i]) }))),
      dl.snowfall_sum[i] ? row("weather_snowy", t("snowfall"), esc(num(dl.snowfall_sum[i], 1) + " " + (settings.precip === "inch" ? t("unitIn") : t("unitCm")))) : "",
      row("air", t("wind"), esc(num(dl.wind_speed_10m_max[i]) + " " + windUnit() + " · " + t("gustsValue", { v: num(dl.wind_gusts_10m_max[i]) + " " + windUnit() }) + " · " + compass(dl.wind_direction_10m_dominant[i]))),
      row("wb_sunny", t("uvIndex"), esc(num(dl.uv_index_max[i], 1) + " · " + t(uvCategory(dl.uv_index_max[i] || 0)))),
      row("wb_twilight", t("sunrise"), esc(rise)),
      row("wb_twilight", t("sunset"), esc(set)),
      row("light_mode", t("daylight"), esc(info.polarDay ? t("polarDay") : info.polarNight ? t("polarNight") : durationStr(info.daylight))),
      row("sunny", t("sunshine"), esc(durationStr((dl.sunshine_duration[i] || 0) * 1000))),
    ].join("");
    $("#daySunBtn").onclick = () => { view.sunDate = { year: lp.year, month: lp.month, day: lp.day }; renderSun(); UI.closeModal("dayModal"); $("#sunCard").scrollIntoView({ behavior: "smooth", block: "start" }); };
    UI.openModal("dayModal");
  }

  // ------------------------------------------------------------ NWS text forecast
  function renderNWS(loc) {
    const periods = store.nws[loc.id];
    $("#nwsCard").hidden = !periods?.length;
    if (!periods?.length) return;
    $("#nwsPeriods").innerHTML = periods.map((p, i) => `<details lang="en"${i === 0 ? " open" : ""}><summary><span class="gw-nws-name">${esc(p.name)}</span><span class="mu-muted">${esc(p.shortForecast)}</span></summary><div class="mu-accordion-body">${esc(p.detailedForecast)}</div></details>`).join("");
  }

  // ------------------------------------------------------------ alerts
  function severityClass(s) { return s === "Extreme" || s === "Severe" ? "is-danger" : s === "Moderate" ? "is-warning" : ""; }
  function renderAlerts() {
    const loc = activeLocation();
    const body = $("#alertsBody");
    const count = $("#alertCount");
    const strip = $("#alertStrip");
    const a = loc && store.alerts[loc.id];
    count.hidden = true;
    strip.hidden = true;
    if (!loc) { body.innerHTML = `<p class="mu-muted">${esc(t("alertsNoLocation"))}</p>`; return; }
    if (!a) { body.innerHTML = `<div class="spinner-container" role="status" aria-label="${esc(t("loading"))}"><svg class="google-spinner" viewBox="0 0 50 50" aria-hidden="true" focusable="false"><circle class="spinner-circle" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg></div>`; return; }
    if (!a.supported) { body.innerHTML = `<div class="mu-empty gw-alert-empty"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">public</span></span><span>${esc(t("alertsUnsupported"))}</span></div>`; return; }
    if (a.error) { body.innerHTML = `<div class="mu-alert"><span class="mu-icon" aria-hidden="true">cloud_off</span><div class="mu-alert-body"><span class="mu-alert-title">${esc(t("alertsError"))}</span></div></div>`; return; }
    if (!a.features.length) { body.innerHTML = `<div class="mu-empty gw-alert-empty"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">verified_user</span></span><span>${esc(t("noAlerts"))}</span></div><p class="gw-source">${esc(t("sourceNws"))}</p>`; return; }
    count.hidden = false;
    count.textContent = num(a.features.length);
    const sorted = a.features.slice().sort((x, y) => ["Extreme", "Severe", "Moderate", "Minor", "Unknown"].indexOf(x.properties.severity) - ["Extreme", "Severe", "Moderate", "Minor", "Unknown"].indexOf(y.properties.severity));
    body.innerHTML = `<div class="mu-accordion gw-alerts">${sorted.map((f, i) => {
      const p = f.properties;
      const sev = severityClass(p.severity);
      const until = p.ends || p.expires;
      return `<details class="gw-alert ${sev}"${i === 0 ? " open" : ""}><summary>${iconHtml(sev === "is-danger" ? "crisis_alert" : "warning", "gw-alert-icon")}<span class="gw-alert-text"><span class="gw-alert-event" lang="en">${esc(p.event)}</span><span class="mu-muted">${esc(until ? t("untilTime", { time: dateStr(Date.parse(until), loc, { weekday: "short" }) + " " + timeStr(Date.parse(until), loc) }) : "")}</span></span></summary>
        <div class="mu-accordion-body" lang="en">
          <div class="gw-alert-badges"><span class="mu-badge ${sev === "is-danger" ? "mu-badge-danger" : sev ? "mu-badge-warning" : ""}">${esc(t("severity" + (p.severity || "Unknown")))}</span>${p.urgency ? `<span class="mu-badge">${esc(t("urgency" + p.urgency))}</span>` : ""}</div>
          ${p.headline ? `<p class="gw-alert-headline">${esc(p.headline)}</p>` : ""}
          <p class="gw-alert-desc">${esc(p.description || "")}</p>
          ${p.instruction ? `<p class="gw-alert-inst"><span class="mu-icon" aria-hidden="true">shield</span>${esc(p.instruction)}</p>` : ""}
          <p class="mu-muted">${esc(p.senderName || "")}</p>
        </div></details>`;
    }).join("")}</div><p class="gw-source">${esc(t("sourceNws"))}</p>`;
    // Strip above the forecast for the most severe alert
    const top = sorted[0].properties;
    strip.hidden = false;
    strip.className = "gw-alert-strip mu-alert " + severityClass(top.severity);
    strip.innerHTML = `${iconHtml("warning")}<div class="mu-alert-body"><span class="mu-alert-title" lang="en">${esc(top.event)}</span><span class="mu-muted" lang="en">${esc(top.headline || top.areaDesc || "")}</span></div><button type="button" class="mu-btn" id="alertStripBtn">${esc(t("viewAlerts"))}</button>`;
    $("#alertStripBtn").onclick = () => { $("#alertsCard").scrollIntoView({ behavior: "smooth", block: "start" }); $("#alertsCard summary")?.focus(); };
  }

  // ------------------------------------------------------------ sunrise & sunset
  function sunDay(loc) {
    const lp = view.sunDate || Sun.localParts(Date.now(), zoneOf(loc), loc.lon);
    return { lp, info: Sun.day(lp.year, lp.month, lp.day, loc.lat, loc.lon, zoneOf(loc)) };
  }
  /**
   * Sunrise and sunset for a local date, following them across midnight in white-night seasons:
   * a sunset after midnight comes from the next date (+1) and a sunrise before midnight from the previous one (−1).
   */
  function sunTimes(loc, info, y, m, d) {
    let rise = info.sunrise;
    let set = info.sunset;
    let riseShift = 0;
    let setShift = 0;
    if (!settings.useDeviceTimezone && !info.polarDay && !info.polarNight) {
      if (rise && (!set || set < rise)) {
        const n = Sun.day(y, m, d + 1, loc.lat, loc.lon, zoneOf(loc));
        if (n.sunset && (!n.sunrise || n.sunset < n.sunrise)) { set = n.sunset; setShift = 1; }
      }
      if (set && (!rise || rise > set) && !setShift) {
        const p = Sun.day(y, m, d - 1, loc.lat, loc.lon, zoneOf(loc));
        if (p.sunrise && (!p.sunset || p.sunrise > p.sunset)) { rise = p.sunrise; riseShift = -1; }
      }
    }
    const label = (ms, shift) => (ms ? timeStr(ms, loc) + (shift > 0 ? " (+1)" : shift < 0 ? " (−1)" : "") : t("doesNotOccur"));
    return { rise, set, riseText: label(rise, riseShift), setText: label(set, setShift) };
  }
  function renderSun() {
    const loc = activeLocation();
    const card = $("#sunCard");
    card.hidden = !loc;
    if (!loc) return;
    const { lp, info } = sunDay(loc);
    const isToday = (() => { const n = Sun.localParts(Date.now(), zoneOf(loc), loc.lon); return n.year === lp.year && n.month === lp.month && n.day === lp.day; })();
    $("#sunDate").textContent = isToday ? t("today") + " · " + dateStr(info.start + 12 * HOUR, loc, { month: "short", day: "numeric" }) : dateStr(info.start + 12 * HOUR, loc, { weekday: "short", month: "short", day: "numeric", year: lp.year !== new Date().getFullYear() ? "numeric" : undefined });
    $("#sunToday").disabled = isToday;
    const polar = $("#sunPolar");
    polar.hidden = !(info.polarDay || info.polarNight);
    polar.className = "gw-sun-polar " + (info.polarDay ? "is-day" : "is-night");
    polar.innerHTML = info.polarDay ? `${iconHtml("sunny", "mu-icon-filled")}<span><span class="gw-polar-title">${esc(t("polarDay"))}</span><span class="mu-muted">${esc(t("polarDayHelp"))}</span></span>` : info.polarNight ? `${iconHtml("dark_mode", "mu-icon-filled")}<span><span class="gw-polar-title">${esc(t("polarNight"))}</span><span class="mu-muted">${esc(t("polarNightHelp"))}</span></span>` : "";
    const nowMs = Date.now();
    const showNow = isToday;
    renderSunDial(loc, info, showNow ? nowMs : null, lp);
    renderSunChart(loc, info, showNow ? nowMs : null, lp);
    renderSunEvents(loc, info, lp);
    renderMonths(loc, lp.year);
  }
  function bandColor(alt) {
    if (alt >= Sun.H.sunrise) return "var(--gw-sun-day)";
    if (alt >= Sun.H.dawn) return "var(--gw-sun-civil)";
    if (alt >= Sun.H.nautical) return "var(--gw-sun-nautical)";
    if (alt >= Sun.H.astro) return "var(--gw-sun-astro)";
    if (alt >= Sun.H.veryDawn) return "var(--gw-sun-almost)";
    return "var(--gw-sun-night)";
  }
  function renderSunDial(loc, info, nowMs, lp) {
    const S = 280;
    const c = S / 2;
    const R = 112;
    const sw = 22;
    // Noon at the top, midnight at the bottom.
    const angle = (f) => (f * 360 + 180) * (Math.PI / 180);
    const pt = (f, r) => [c + r * Math.sin(angle(f)), c - r * Math.cos(angle(f))];
    let arcs = "";
    const samples = info.samples;
    const seg = 96;
    for (let k = 0; k < seg; k++) {
      const f0 = k / seg;
      const f1 = (k + 1) / seg;
      const s = samples[Math.min(samples.length - 1, Math.round(((f0 + f1) / 2) * (samples.length - 1)))];
      const [x0, y0] = pt(f0, R);
      const [x1, y1] = pt(f1 + 0.002, R);
      arcs += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" stroke="${bandColor(s.alt)}" stroke-width="${sw}" fill="none"/>`;
    }
    // Hour labels sit outside the ring so they never collide with the day length in the center.
    let ticks = "";
    [0, 6, 12, 18].forEach((hh) => {
      const f = hh / 24;
      const [x0, y0] = pt(f, R - sw / 2 - 4);
      const [x1, y1] = pt(f, R - sw / 2 - 12);
      const side = hh === 6 || hh === 18;
      const [lx, ly] = pt(f, R + sw / 2 + (side ? 10 : 12));
      const anchor = hh === 6 ? "end" : hh === 18 ? "start" : "middle";
      const dy = hh === 12 ? -2 : hh === 0 ? 18 : 6;
      ticks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="gw-dial-tick"/><text x="${lx}" y="${ly + dy}" text-anchor="${anchor}" class="gw-dial-label">${esc(sunHourLabel(hh, loc, lp))}</text>`;
    });
    const mark = (ms, cls) => {
      if (!ms) return "";
      const f = (ms - info.start) / info.length;
      const [x0, y0] = pt(f, R + sw / 2 + 2);
      const [x1, y1] = pt(f, R - sw / 2 - 2);
      return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="gw-dial-mark ${cls}"/>`;
    };
    let sun = "";
    if (nowMs && nowMs >= info.start && nowMs <= info.end) {
      const f = (nowMs - info.start) / info.length;
      const [sx, sy] = pt(f, R);
      const alt = Sun.position(nowMs, loc.lat, loc.lon).altitude;
      sun = `<line x1="${c}" y1="${c}" x2="${sx}" y2="${sy}" class="gw-dial-hand"/><circle cx="${sx}" cy="${sy}" r="14" class="gw-dial-sun${alt < Sun.H.sunrise ? " is-below" : ""}"/>`;
    }
    const center = info.polarDay ? t("polarDay") : info.polarNight ? t("polarNight") : durationStr(info.daylight);
    $("#sunDial").innerHTML = `<svg viewBox="-64 -30 ${S + 128} ${S + 60}" role="img" aria-label="${esc(t("sunDialLabel", { v: center }))}">${arcs}${ticks}${mark(info.sunrise, "is-rise")}${mark(info.sunset, "is-set")}${sun}<text x="${c}" y="${c - 2}" text-anchor="middle" class="gw-dial-center">${esc(center)}</text>${info.polarDay || info.polarNight ? "" : `<text x="${c}" y="${c + 26}" text-anchor="middle" class="gw-dial-sub">${esc(t("daylight"))}</text>`}</svg>`;
  }
  function renderSunChart(loc, info, nowMs, lp) {
    const host = $("#sunChart");
    const W = Math.max(280, host.clientWidth || 340);
    const Hh = 230;
    const pad = { l: 52, r: 12, t: 14, b: 40 };
    const pw = W - pad.l - pad.r;
    const ph = Hh - pad.t - pad.b;
    const s = info.samples;
    const maxA = Math.max(...s.map((p) => p.alt));
    const minA = Math.min(...s.map((p) => p.alt));
    const top = Math.min(90, Math.max(20, Math.ceil((maxA + 8) / 10) * 10));
    const bot = Math.max(-90, Math.min(-20, Math.floor((minA - 4) / 10) * 10));
    const x = (ms) => pad.l + ((ms - info.start) / info.length) * pw;
    const y = (a) => pad.t + ((top - a) / (top - bot)) * ph;
    let svg = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="${esc(t("sunAngleChart"))}">`;
    // Altitude bands
    [[top, 0, "var(--gw-sun-day-soft)"], [0, -6, "var(--gw-sun-civil)"], [-6, -12, "var(--gw-sun-nautical)"], [-12, -18, "var(--gw-sun-astro)"], [-18, -28, "var(--gw-sun-almost)"], [-28, bot, "var(--gw-sun-night)"]].forEach(([a, b, col]) => {
      const ya = y(Math.min(top, Math.max(bot, a)));
      const yb = y(Math.min(top, Math.max(bot, b)));
      if (yb > ya) svg += `<rect x="${pad.l}" y="${ya}" width="${pw}" height="${yb - ya}" fill="${col}" class="gw-sun-band"/>`;
    });
    // Grid
    [top, 0, bot].concat(top >= 60 ? [45] : []).forEach((a) => {
      svg += `<line class="gw-grid${a === 0 ? " gw-horizon" : ""}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(a)}" y2="${y(a)}"/><text class="gw-axis" x="${pad.l - 8}" y="${y(a) + 6}" text-anchor="end">${esc(num(a))}°</text>`;
    });
    [6, 12, 18].forEach((hh) => {
      const ms = info.start + (hh / 24) * info.length;
      svg += `<text class="gw-axis" x="${x(ms)}" y="${Hh - 10}" text-anchor="middle">${esc(sunHourLabel(hh, loc, lp))}</text>`;
    });
    let path = "";
    s.forEach((p, i) => { path += (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.alt).toFixed(1); });
    svg += `<clipPath id="gwAbove"><rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${y(0) - pad.t}"/></clipPath>`;
    svg += `<path d="${path}L${x(info.end)} ${y(0)}L${x(info.start)} ${y(0)}Z" class="gw-sun-area" clip-path="url(#gwAbove)"/>`;
    svg += `<path d="${path}" class="gw-sun-curve"/>`;
    if (info.solarNoon) svg += `<circle cx="${x(info.solarNoon)}" cy="${y(info.noonAltitude)}" r="5" class="gw-sun-noon"/>`;
    if (nowMs && nowMs >= info.start && nowMs <= info.end) {
      const a = Sun.position(nowMs, loc.lat, loc.lon).altitude;
      svg += `<circle cx="${x(nowMs)}" cy="${y(a)}" r="11" class="gw-dial-sun${a < Sun.H.sunrise ? " is-below" : ""}"/>`;
    }
    svg += `<g class="gw-hover" hidden><line class="gw-crosshair" y1="${pad.t}" y2="${pad.t + ph}"/><circle r="6" class="gw-dot gw-c1"/></g><rect class="gw-hit" x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
    host.innerHTML = svg + `<div class="gw-tooltip mu-glass-solid" role="status" hidden></div>`;
    const svgEl = host.querySelector("svg");
    const hover = svgEl.querySelector(".gw-hover");
    const tip = host.querySelector(".gw-tooltip");
    const show = (clientX) => {
      const r = svgEl.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const ms = info.start + clamp((px - pad.l) / pw, 0, 1) * info.length;
      const pos = Sun.position(ms, loc.lat, loc.lon);
      hover.hidden = false;
      hover.querySelector("line").setAttribute("x1", x(ms));
      hover.querySelector("line").setAttribute("x2", x(ms));
      hover.querySelector("circle").setAttribute("cx", x(ms));
      hover.querySelector("circle").setAttribute("cy", y(pos.altitude));
      tip.hidden = false;
      tip.innerHTML = `<div class="gw-tip-time">${esc(timeStr(ms, loc))}</div><div class="gw-tip-row"><span>${esc(t("sunAltitude"))}</span><span>${esc(num(pos.altitude, 1))}°</span></div><div class="gw-tip-row"><span>${esc(t("sunAzimuth"))}</span><span>${esc(num(pos.azimuth, 0) + "° " + compass(pos.azimuth))}</span></div>`;
      tip.style.left = clamp((x(ms) / W) * r.width + 12, 8, r.width - tip.offsetWidth - 8) + "px";
    };
    svgEl.addEventListener("pointermove", (e) => show(e.clientX));
    svgEl.addEventListener("pointerdown", (e) => show(e.clientX));
    svgEl.addEventListener("pointerleave", () => { hover.hidden = true; tip.hidden = true; });
  }
  function renderSunEvents(loc, info, lp) {
    const prev = Sun.day(lp.year, lp.month, lp.day - 1, loc.lat, loc.lon, zoneOf(loc));
    const polarRise = info.polarDay ? clockStr(0, 0) : info.polarNight ? clockStr(12, 0) : null;
    const tm = (ms, fallback) => (ms ? timeStr(ms, loc) : fallback);
    const none = t("doesNotOccur");
    const st = sunTimes(loc, info, lp.year, lp.month, lp.day);
    const rows = [
      ["veryDawn", "brightness_4", tm(info.veryDawn, none), t("sunBelow", { n: num(-Sun.H.veryDawn) })],
      ["almostLight", "brightness_3", tm(info.astroDawn, none), t("sunBetweenBelow", { a: num(-Sun.H.astro), b: num(-Sun.H.veryDawn) })],
      ["dawn", "brightness_5", tm(info.dawn, none), t("sunBelow", { n: num(6) })],
      ["sunrise", "wb_twilight", polarRise ?? st.riseText, st.rise ? compass(Sun.position(st.rise, loc.lat, loc.lon).azimuth) + " · " + num(Sun.position(st.rise, loc.lat, loc.lon).azimuth) + "°" : ""],
      ["solarNoon", "light_mode", tm(info.solarNoon, none), t("sunAt", { n: num(info.noonAltitude, 1) })],
      ["sunset", "wb_twilight", polarRise ?? st.setText, st.set ? compass(Sun.position(st.set, loc.lat, loc.lon).azimuth) + " · " + num(Sun.position(st.set, loc.lat, loc.lon).azimuth) + "°" : ""],
      ["dusk", "brightness_5", tm(info.dusk, none), t("sunBelow", { n: num(6) })],
      ["almostDark", "brightness_3", tm(info.astroDusk, none), t("sunBetweenBelow", { a: num(-Sun.H.astro), b: num(-Sun.H.veryDawn) })],
      ["veryDusk", "brightness_4", tm(info.veryDusk, none), t("sunBelow", { n: num(-Sun.H.veryDawn) })],
    ];
    const change = info.daylight - prev.daylight;
    $("#sunEvents").innerHTML = rows.map(([key, icon, time, sub]) => `<li class="gw-sun-event is-${key}"><span class="gw-sun-event-icon">${iconHtml(icon, "mu-icon-filled")}</span><span class="gw-sun-event-text"><span>${esc(t(key))}</span>${sub ? `<span class="mu-muted">${esc(sub)}</span>` : ""}</span><span class="gw-sun-event-time">${esc(time)}</span></li>`).join("") +
      `<li class="gw-sun-event is-length"><span class="gw-sun-event-icon">${iconHtml("hourglass_bottom")}</span><span class="gw-sun-event-text"><span>${esc(t("dayLength"))}</span><span class="mu-muted">${esc(info.polarDay || info.polarNight || prev.polarDay || prev.polarNight ? "" : t("vsYesterday", { v: deltaStr(change) }))}</span></span><span class="gw-sun-event-time">${esc(info.polarDay ? t("polarDay") : info.polarNight ? t("polarNight") : durationStr(info.daylight))}</span></li>`;
  }
  function renderMonths(loc, year) {
    const host = $("#sunMonths");
    const fmt = new Intl.DateTimeFormat(locale(), { month: "short", timeZone: "UTC" });
    const today = Sun.localParts(Date.now(), zoneOf(loc), loc.lon);
    host.innerHTML = Array.from({ length: 12 }, (_, m) => {
      const lastDay = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
      const dayN = Math.min(view.monthDay, lastDay);
      const info = Sun.day(year, m, dayN, loc.lat, loc.lon, zoneOf(loc));
      const segs = Sun.daySegments(info);
      const bar = segs.map((s) => `<span class="${s.day ? "is-day" : "is-night"}" style="inset-inline-start:${(s.from * 100).toFixed(2)}%;inline-size:${((s.to - s.from) * 100).toFixed(2)}%"></span>`).join("");
      let times;
      if (info.polarDay) times = `<span class="gw-polar-tag is-day">${esc(t("polarDay"))}</span><span class="mu-muted">${esc(clockStr(0, 0) + " – " + clockStr(0, 0))}</span>`;
      else if (info.polarNight) times = `<span class="gw-polar-tag is-night">${esc(t("polarNight"))}</span><span class="mu-muted">${esc(clockStr(12, 0) + " – " + clockStr(12, 0))}</span>`;
      else { const st = sunTimes(loc, info, year, m, dayN); times = `<span>${esc(st.riseText + " – " + st.setText)}</span><span class="mu-muted">${esc(durationStr(info.daylight))}</span>`; }
      const label = fmt.format(new Date(Date.UTC(year, m, dayN))) + " " + num(dayN);
      return `<li class="gw-month${today.month === m && today.year === year ? " is-current" : ""}"><span class="gw-month-name">${esc(label)}</span><span class="gw-month-bar" aria-hidden="true">${bar}<i class="gw-month-noon"></i></span><span class="gw-month-times">${times}</span></li>`;
    }).join("");
  }

  // ------------------------------------------------------------ sky
  function skyStateFor(loc, d) {
    const now = Date.now();
    let alt = 30;
    let progress = 0.5;
    let moonAlt = 30;
    if (loc) {
      alt = Sun.position(now, loc.lat, loc.lon).altitude;
      const lp = Sun.localParts(now, loc.tz, loc.lon);
      const info = Sun.day(lp.year, lp.month, lp.day, loc.lat, loc.lon, loc.tz);
      if (info.sunrise && info.sunset) progress = (now - info.sunrise) / (info.sunset - info.sunrise);
      else progress = (now - info.start) / info.length;
      // The moon trails the sun by its phase: about 24.8 hours per full cycle.
      moonAlt = Sun.position(now - Sun.moon(now).phase * 24.8 * HOUR, loc.lat, loc.lon).altitude;
    }
    const m = Sun.moon(now);
    const c = d?.current;
    return {
      scene: c ? SkyLib.sceneForCode(c.weather_code) : "partly", altitude: alt, dayProgress: progress, moonPhase: m.phase, moonIllumination: m.illumination,
      moonAltitude: moonAlt, southern: loc ? loc.lat < 0 : false, wind: c ? c.wind_speed_10m : 10,
    };
  }
  function updateSky() {
    if (!sky) return;
    const loc = activeLocation();
    const d = loc && store.data[loc.id];
    const st = skyStateFor(loc, d);
    if (view.preview) {
      st.scene = view.preview;
      st.altitude = view.previewAlt;
      st.dayProgress = view.previewAlt === -7 ? -0.05 : view.previewAlt === -1 ? 1.02 : 0.5;
    }
    sky.still = !settings.animate;
    sky.set(st);
    $("#previewChip").hidden = !view.preview;
    if (view.preview) $("#previewLabel").textContent = t("previewing", { name: t("scene_" + view.preview) });
    $("#hero").classList.toggle("is-bright", st.altitude > 4 && !["storm", "heavyRain", "rain", "overcast"].includes(st.scene));
  }

  // Sky previews modal
  let previewSky = null;
  let previewScene = "clear";
  let previewAlt = 40;
  function openSkyPreviews() {
    previewScene = view.preview || SkyLib.sceneForCode(store.data[activeId]?.current?.weather_code ?? 0);
    previewAlt = view.preview ? view.previewAlt : 40;
    $("#sceneGrid").innerHTML = SkyLib.SCENES.map((s) => `<button type="button" class="mu-chip gw-scene" data-scene="${s}" aria-pressed="${s === previewScene}">${iconHtml(sceneIcon(s))}<span>${esc(t("scene_" + s))}</span></button>`).join("");
    $$("#skyTime button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.alt) === previewAlt)));
    UI.openModal("skyModal");
    requestAnimationFrame(() => {
      if (!previewSky) previewSky = new SkyLib.Sky($("#skyPreviewCanvas"));
      paintPreview();
    });
  }
  function sceneIcon(s) {
    return { clear: "sunny", mostlyClear: "sunny", partly: "partly_cloudy_day", cloudy: "cloud", overcast: "filter_drama", fog: "foggy", drizzle: "rainy_light", rain: "rainy", heavyRain: "rainy_heavy", snow: "weather_snowy", sleet: "rainy_snow", storm: "thunderstorm" }[s] || "cloud";
  }
  function paintPreview() {
    if (!previewSky) return;
    const m = Sun.moon(Date.now());
    previewSky.still = !settings.animate;
    previewSky.set({ scene: previewScene, altitude: previewAlt, dayProgress: previewAlt === -7 ? -0.05 : previewAlt === -1 ? 1.02 : 0.5, moonPhase: m.phase, moonIllumination: m.illumination, moonAltitude: 35, southern: (activeLocation()?.lat ?? 1) < 0, wind: 12 });
    $("#skyPreviewLabel").textContent = t("scene_" + previewScene);
  }

  // ------------------------------------------------------------ search UI
  function resultItem(pl, i, prefix) {
    const sub = [pl.admin, pl.country].filter(Boolean).join(", ");
    return `<li class="mu-menu-item gw-result" role="option" id="${prefix}-${i}" data-i="${i}" aria-selected="false">${iconHtml(pl.coords ? "pin_drop" : "location_city")}<span class="gw-result-text"><span>${esc(pl.name)}</span>${sub ? `<span class="mu-muted">${esc(sub)}</span>` : ""}</span></li>`;
  }
  function wireSearch(input, list, onChoose, opts = {}) {
    let results = [];
    let active = -1;
    let ctrl = null;
    let timer = null;
    const prefix = list.id;
    const setOpen = (open) => {
      if (opts.floating) list.hidden = !open;
      input.setAttribute("aria-expanded", String(open));
    };
    const highlight = (i) => {
      active = i;
      $$(".gw-result", list).forEach((el, k) => el.setAttribute("aria-selected", String(k === i)));
      if (i >= 0) { input.setAttribute("aria-activedescendant", prefix + "-" + i); list.children[i]?.scrollIntoView({ block: "nearest" }); } else input.removeAttribute("aria-activedescendant");
    };
    const render = (msg) => {
      if (msg) { list.innerHTML = `<li class="gw-result-msg mu-muted" role="presentation">${esc(msg)}</li>`; setOpen(true); return; }
      list.innerHTML = results.map((r, i) => resultItem(r, i, prefix)).join("");
      setOpen(results.length > 0);
      highlight(results.length ? 0 : -1);
    };
    const run = async () => {
      const q = input.value.trim();
      ctrl?.abort();
      if (!q) { results = []; list.innerHTML = ""; setOpen(false); return; }
      const coords = parseCoords(q);
      if (coords) {
        results = [{ name: coordsLabel(coords.lat, coords.lon), admin: t("coordinates"), country: "", lat: coords.lat, lon: coords.lon, coords: true }];
        render();
        return;
      }
      if (q.length < 2) return;
      ctrl = new AbortController();
      render(t("searching"));
      try {
        results = await searchPlaces(q, ctrl.signal);
        if (!results.length) render(t("noCities"));
        else render();
      } catch (e) {
        if (e.name !== "AbortError") render(t(e.status === 429 ? "rateLimited" : "searchError"));
      }
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 280); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && results.length) { e.preventDefault(); highlight((active + 1) % results.length); }
      else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); highlight((active - 1 + results.length) % results.length); }
      else if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(timer);
        if (active >= 0 && results[active]) choose(active);
        else run();
      } else if (e.key === "Escape" && opts.floating && !list.hidden) { e.stopPropagation(); setOpen(false); }
    });
    if (opts.floating) {
      input.addEventListener("focus", () => { if (list.children.length && input.value.trim()) setOpen(true); });
      document.addEventListener("pointerdown", (e) => { if (!list.contains(e.target) && !input.closest(".gw-search-wrap").contains(e.target)) setOpen(false); });
    }
    const choose = async (i) => {
      let pl = results[i];
      if (pl.coords) {
        list.innerHTML = `<li class="gw-result-msg mu-muted" role="presentation">${esc(t("lookingUp"))}</li>`;
        pl = await reversePlace(pl.lat, pl.lon);
      }
      onChoose(pl);
      if (opts.floating) { input.value = ""; results = []; list.innerHTML = ""; setOpen(false); input.blur(); input.closest(".mu-topbar-search")?.classList.remove("has-value", "is-open"); }
    };
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => { const li = e.target.closest(".gw-result"); if (li) choose(Number(li.dataset.i)); });
    return { clear() { input.value = ""; results = []; list.innerHTML = ""; setOpen(false); } };
  }

  // ------------------------------------------------------------ location modal with map
  let picker = null;
  let selectedPlace = null;
  const mapAttribution = '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
  const currentTheme = () => document.documentElement.getAttribute("data-mu-theme") === "light" ? "light" : "dark";
  function selectPlace(pl) {
    selectedPlace = pl;
    $("#modalSelected").hidden = false;
    $("#modalSelectedName").textContent = pl.name;
    $("#modalSelectedSub").textContent = [pl.admin, pl.country].filter(Boolean).join(", ") || coordsLabel(pl.lat, pl.lon);
    if (picker) { picker.flyTo(pl.lon, pl.lat, 10); picker.mark(pl.lon, pl.lat); }
  }
  let pickerLanguage;
  async function openLocationModal() {
    selectedPlace = null;
    $("#modalSelected").hidden = true;
    modalSearch.clear();
    UI.openModal("locationModal");
    setTimeout(() => $("#modalSearch").focus(), 40);
    const status = $("#mapStatus");
    const language = lang();
    if (picker && pickerLanguage !== language) { picker.destroy(); picker = null; }
    if (picker) { requestAnimationFrame(() => picker.resize()); return; }
    status.hidden = false;
    status.textContent = t("loadingMap");
    const loc = activeLocation();
    try {
      picker = await MapLib.create({
        container: $("#pickerMap"), center: loc ? [loc.lon, loc.lat] : [0, 25], zoom: loc ? 8 : 1.6, theme: currentTheme(), lang: language, attribution: mapAttribution,
        locale: {
          "Map.Title": t("mapLabel"),
          "Marker.Title": t("mapMarker"),
          "NavigationControl.ZoomIn": t("zoomIn"),
          "NavigationControl.ZoomOut": t("zoomOut"),
          "AttributionControl.ToggleAttribution": t("mapCredits"),
        },
        onPick: (ll, point) => showMapMenu(ll, point),
        onLoad: () => { status.hidden = true; },
        onLoadError: () => { status.textContent = t("mapError"); },
      });
      pickerLanguage = language;
      if (loc) picker.mark(loc.lon, loc.lat);
    } catch (e) {
      status.textContent = t("mapError");
    }
  }
  async function showMapMenu(ll, point) {
    const menu = $("#mapMenu");
    const wrap = $(".gw-map-wrap");
    const lat = ll.lat;
    const lon = ((ll.lng + 540) % 360) - 180;
    picker.mark(lon, lat);
    menu.innerHTML = `<div class="gw-map-menu-head"><span class="gw-map-menu-name">${esc(t("lookingUp"))}</span><span class="mu-muted">${esc(coordsLabel(lat, lon))}</span></div><div class="mu-menu-sep" role="separator"></div>
      <button type="button" class="mu-menu-item" role="menuitem" data-act="add" disabled>${iconHtml("add_location_alt")}<span>${esc(t("addLocation"))}</span></button>
      <button type="button" class="mu-menu-item" role="menuitem" data-act="copy">${iconHtml("content_copy")}<span>${esc(t("copyCoordinates"))}</span></button>`;
    if (menu.parentElement !== wrap) wrap.appendChild(menu);
    menu.hidden = false;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = clamp(point.x + 8, 8, wrap.clientWidth - mw - 8) + "px";
    menu.style.top = clamp(point.y + 8, 8, wrap.clientHeight - mh - 8) + "px";
    let place = null;
    menu.onclick = (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "add" && place) { menu.hidden = true; addLocation(place); UI.closeModal("locationModal"); }
      if (b.dataset.act === "copy") { navigator.clipboard?.writeText(lat.toFixed(5) + ", " + lon.toFixed(5)).then(() => UI.toast(t("copied"), { type: "success" })); menu.hidden = true; }
    };
    place = await reversePlace(lat, lon);
    if (menu.hidden) return;
    menu.querySelector(".gw-map-menu-name").textContent = [place.name, place.country].filter(Boolean).join(", ");
    const add = menu.querySelector('[data-act="add"]');
    add.disabled = false;
    add.focus();
    selectPlace(place);
  }
  document.addEventListener("pointerdown", (e) => { const m = $("#mapMenu"); if (m && !m.hidden && !m.contains(e.target)) m.hidden = true; }, true);

  // ------------------------------------------------------------ settings
  function fillSelect(sel, options, value) {
    sel.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("");
    UI.refreshSelect?.(sel);
  }
  const languageName = (code) => LOCALES.name(code);
  function renderSettings() {
    fillSelect($("#setLanguage"), [["system", t("systemDefault")], ...LANGS.map((l) => [l, languageName(l)])], settings.language);
    fillSelect($("#setTemp"), [["fahrenheit", t("fahrenheit")], ["celsius", t("celsius")]], settings.temp);
    fillSelect($("#setWind"), [["mph", t("unitMph")], ["kmh", t("unitKmh")], ["ms", t("unitMs")], ["kn", t("knots")]], settings.wind);
    fillSelect($("#setPrecip"), [["inch", t("inches")], ["mm", t("millimeters")]], settings.precip);
    fillSelect($("#setPressure"), [["inHg", t("unitInHg")], ["hPa", t("unitHpa")], ["mmHg", t("unitMmHg")], ["kPa", t("unitKpa")]], settings.pressure);
    fillSelect($("#setDistance"), [["mi", t("miles")], ["km", t("kilometers")]], settings.distance);
    fillSelect($("#setClock"), [["auto", t("clockAuto")], ["12", t("clock12", { t: clockStr(15, 30) })], ["24", t("clock24")]], settings.clock);
    $("#setDeviceTimezone").checked = settings.useDeviceTimezone;
    $("#setAnimate").checked = settings.animate;
    const pref = UI.theme.get();
    $$("#themeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themePref === pref)));
  }
  function fillChartMetric() {
    fillSelect($("#chartMetric"), Object.entries(METRICS).map(([k, m]) => [k, t(m.label)]), view.metric);
  }
  function fillMonthDay() {
    const fmt = new Intl.NumberFormat(locale());
    fillSelect($("#monthDay"), Array.from({ length: 31 }, (_, i) => [String(i + 1), t("dayN", { n: fmt.format(i + 1) })]), String(view.monthDay));
  }
  function onSettingsChange(reload) {
    write(KEYS.settings, settings);
    applyStrings();
    renderSettings();
    fillChartMetric();
    fillMonthDay();
    if (reload) refresh(true);
    else { renderLocations(); renderAll(); }
  }
  function onTimezoneChange() {
    zoneRevision++;
    store.data = {};
    store.summary = {};
    store.aq = {};
    view.sunDate = null;
    onSettingsChange(true);
  }

  // ------------------------------------------------------------ refresh
  async function refresh(force) {
    const loc = activeLocation();
    renderLocations();
    renderAll();
    if (!loc) return;
    const cached = store.data[loc.id];
    if (cached && !force && Date.now() - cached.fetchedAt < 10 * 60000) { loadSummaries(); return; }
    const id = loc.id;
    const revision = zoneRevision;
    const isCurrent = () => revision === zoneRevision && activeId === id;
    $("#refreshBtn").classList.add("is-spinning");
    try {
      await Promise.all([
        loadForecast(loc, revision).then(() => { if (isCurrent()) { renderLocations(); renderAll(); } }),
        loadAirQuality(loc, revision).catch(() => {}).then(() => { if (isCurrent() && store.data[id]) renderDetails(loc, store.data[id]); }),
        loadNWS(loc).then(() => { if (isCurrent()) { renderAlerts(); if (store.data[id]) renderNWS(loc); } }),
      ]);
    } catch (e) {
      if (isCurrent() && e.status !== 429) {
        console.error(e);
        UI.toast(t("loadError"), { type: "error" });
      }
    } finally {
      if (revision === zoneRevision) $("#refreshBtn").classList.remove("is-spinning");
    }
    if (revision === zoneRevision) loadSummaries();
  }

  // ------------------------------------------------------------ sidebar
  function toggleSidebar(force) {
    const open = force ?? document.body.classList.contains("is-sidebar-collapsed");
    document.body.classList.toggle("is-sidebar-collapsed", !open);
    $("#sidebarToggle").setAttribute("aria-expanded", String(open));
  }

  // ------------------------------------------------------------ geolocation
  let locating = false;
  let selectMyLocation = false;
  async function locate(automatic = false) {
    if (automatic && read(KEYS.skipMyLocation, false)) return;
    if (!navigator.geolocation) {
      if (!automatic) UI.toast(t("locationUnavailable"), { type: "error" });
      return;
    }
    if (!automatic) selectMyLocation = true;
    if (locating) return;
    locating = true;
    const button = $("#locateBtn");
    button.classList.add("is-spinning");
    try {
      const { coords } = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
      });
      const pl = await reversePlace(coords.latitude, coords.longitude, AbortSignal.timeout?.(5000));
      if (selectMyLocation || !read(KEYS.skipMyLocation, false)) {
        if (selectMyLocation) write(KEYS.skipMyLocation, false);
        addLocation(pl, { current: true, select: selectMyLocation || !activeId });
      }
    } catch (e) {
      if (selectMyLocation) UI.toast(t("locationDenied"), { type: "error" });
    } finally {
      locating = false;
      selectMyLocation = false;
      button.classList.remove("is-spinning");
    }
  }

  // ------------------------------------------------------------ wire up
  let modalSearch;
  function init() {
    applyStrings();
    sky = new SkyLib.Sky($("#sky"));
    renderSettings();
    fillChartMetric();
    fillMonthDay();

    if (!locations.find((l) => l.id === activeId)) activeId = locations[0]?.id || null;
    if (window.matchMedia("(width < 900px)").matches) toggleSidebar(false);

    wireSearch($("#searchInput"), $("#searchResults"), (pl) => addLocation(pl), { floating: true });
    modalSearch = wireSearch($("#modalSearch"), $("#modalResults"), (pl) => selectPlace(pl));

    $("#sidebarToggle").addEventListener("click", () => toggleSidebar());
    $("#addLocationBtn").addEventListener("click", openLocationModal);
    $("#addLocationMain").addEventListener("click", openLocationModal);
    $("#mapBtn").addEventListener("click", openLocationModal);
    $("#locateBtn").addEventListener("click", () => locate());
    $("#refreshBtn").addEventListener("click", () => refresh(true));
    $("#settingsBtn").addEventListener("click", () => { renderSettings(); UI.openModal("settingsModal"); });
    $("#skyBtn").addEventListener("click", openSkyPreviews);
    $("#previewReset").addEventListener("click", () => { view.preview = null; updateSky(); });
    $("#modalAdd").addEventListener("click", () => { if (selectedPlace) { addLocation(selectedPlace); UI.closeModal("locationModal"); } });

    $("#locationList").addEventListener("click", (e) => {
      const main = e.target.closest(".gw-loc-main");
      if (main) { setActive(main.dataset.id); return; }
      const more = e.target.closest("[data-more]");
      if (more) {
        const id = more.dataset.more;
        const i = locations.findIndex((l) => l.id === id);
        showMenu(more, [
          { icon: "arrow_upward", label: t("moveUp"), disabled: i === 0, run: () => moveLocation(id, -1) },
          { icon: "arrow_downward", label: t("moveDown"), disabled: i === locations.length - 1, run: () => moveLocation(id, 1) },
          { icon: "content_copy", label: t("copyCoordinates"), run: () => navigator.clipboard?.writeText(locations[i].lat.toFixed(5) + ", " + locations[i].lon.toFixed(5)).then(() => UI.toast(t("copied"), { type: "success" })) },
          { sep: true },
          { icon: "delete", label: t("remove"), danger: true, run: () => removeLocation(id) },
        ]);
      }
    });

    $("#daily").addEventListener("click", (e) => { const b = e.target.closest("[data-day]"); if (b) openDay(Number(b.dataset.day)); });

    $("#chartMetric").addEventListener("change", (e) => { view.metric = e.target.value; renderChart(); });
    $("#chartRange").addEventListener("click", (e) => { const b = e.target.closest("[data-range]"); if (!b) return; view.range = Number(b.dataset.range); renderChart(); });
    $("#chartTableBtn").addEventListener("click", (e) => {
      view.table = !view.table;
      e.currentTarget.setAttribute("aria-pressed", String(view.table));
      $("#chartTable").hidden = !view.table;
      renderChart();
    });

    const shiftSun = (n) => {
      const loc = activeLocation();
      if (!loc) return;
      const cur = view.sunDate || Sun.localParts(Date.now(), zoneOf(loc), loc.lon);
      const d = new Date(Date.UTC(cur.year, cur.month, cur.day + n));
      view.sunDate = { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
      renderSun();
    };
    $("#sunPrev").addEventListener("click", () => shiftSun(-1));
    $("#sunNext").addEventListener("click", () => shiftSun(1));
    $("#sunToday").addEventListener("click", () => { view.sunDate = null; renderSun(); });
    $("#sunDate").addEventListener("click", (e) => {
      const loc = activeLocation();
      if (!loc) return;
      const cur = view.sunDate || Sun.localParts(Date.now(), zoneOf(loc), loc.lon);
      const iso = cur.year + "-" + String(cur.month + 1).padStart(2, "0") + "-" + String(cur.day).padStart(2, "0");
      UI.pickDate({ anchor: e.currentTarget, value: iso, locale: locale(), labels: {
        date: t("selectDate"), today: t("today"), previous: t("previousMonth"), next: t("nextMonth"),
      }, onPick(v) {
        if (!v) return;
        const [y, m, d] = v.split("-").map(Number);
        view.sunDate = { year: y, month: m - 1, day: d };
        renderSun();
      } });
    });
    $("#monthDay").addEventListener("change", (e) => { view.monthDay = Number(e.target.value); const loc = activeLocation(); if (loc) renderMonths(loc, sunDay(loc).lp.year); });

    // Settings
    $("#themeSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-theme-pref]"); if (b) UI.theme.set(b.dataset.themePref); });
    $("#setLanguage").addEventListener("change", (e) => { settings.language = e.target.value; onSettingsChange(false); });
    window.addEventListener("languagechange", () => {
      systemLanguage = browserLanguage();
      if (settings.language === "system") onSettingsChange(false);
    });
    $("#setTemp").addEventListener("change", (e) => { settings.temp = e.target.value; store.summary = {}; onSettingsChange(true); });
    $("#setWind").addEventListener("change", (e) => { settings.wind = e.target.value; onSettingsChange(true); });
    $("#setPrecip").addEventListener("change", (e) => { settings.precip = e.target.value; onSettingsChange(true); });
    $("#setPressure").addEventListener("change", (e) => { settings.pressure = e.target.value; METRICS.pressure.digits = settings.pressure === "inHg" ? 2 : settings.pressure === "kPa" ? 1 : 0; onSettingsChange(false); });
    $("#setDistance").addEventListener("change", (e) => { settings.distance = e.target.value; onSettingsChange(false); });
    $("#setClock").addEventListener("change", (e) => { settings.clock = e.target.value; onSettingsChange(false); });
    $("#setDeviceTimezone").addEventListener("change", (e) => {
      deviceZone = deviceTimezone();
      settings.useDeviceTimezone = e.target.checked;
      onTimezoneChange();
    });
    $("#setAnimate").addEventListener("change", (e) => { settings.animate = e.target.checked; write(KEYS.settings, settings); updateSky(); });
    METRICS.pressure.digits = settings.pressure === "inHg" ? 2 : settings.pressure === "kPa" ? 1 : 0;
    document.addEventListener("mu-theme", () => {
      renderSettings();
      if (picker) picker.setTheme(currentTheme(), lang());
    });

    // Sky previews
    $("#sceneGrid").addEventListener("click", (e) => {
      const b = e.target.closest("[data-scene]");
      if (!b) return;
      previewScene = b.dataset.scene;
      $$("#sceneGrid [data-scene]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      paintPreview();
    });
    $("#skyTime").addEventListener("click", (e) => { const b = e.target.closest("[data-alt]"); if (!b) return; previewAlt = Number(b.dataset.alt); paintPreview(); });
    $("#skyApply").addEventListener("click", () => { view.preview = previewScene; view.previewAlt = previewAlt; updateSky(); UI.closeModal("skyModal"); });

    // Redraw width-dependent charts on resize.
    let rz = null;
    new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { renderChart(); const loc = activeLocation(); if (loc) { const { info } = sunDay(loc); const lp = Sun.localParts(Date.now(), zoneOf(loc), loc.lon); const today = !view.sunDate || (view.sunDate.year === lp.year && view.sunDate.month === lp.month && view.sunDate.day === lp.day); renderSunChart(loc, info, today ? Date.now() : null, sunDay(loc).lp); } }, 120); }).observe($("#main"));

    // Keep clocks, the sun, and the sky moving; refresh data every 15 minutes.
    setInterval(() => {
      const loc = activeLocation();
      if (!loc || document.hidden) return;
      $("#placeSub").textContent = placeSubtitle(loc);
      renderLocations();
      if (!view.sunDate) renderSun();
      updateSky();
      const d = store.data[loc.id];
      if (d && Date.now() - d.fetchedAt > 15 * 60000) refresh(true);
      else if (d) { renderHourly(loc, d); $("#nowcast").textContent = nowcastText(d); }
    }, 60000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      const zone = deviceTimezone();
      if (zone !== deviceZone) {
        deviceZone = zone;
        if (settings.useDeviceTimezone) { onTimezoneChange(); return; }
      }
      const d = store.data[activeId];
      if (d && Date.now() - d.fetchedAt > 15 * 60000) refresh(true);
    });
    window.addEventListener("online", () => refresh(true));

    renderLocations();
    refresh();
    locate(true);
    if (!locations.length) setTimeout(() => {
      if (!locations.length && !locating && document.activeElement === document.body) $("#searchInput").focus();
    }, 300);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
