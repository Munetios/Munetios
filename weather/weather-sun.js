/*!
 * Ganetios Weather: sun and moon math.
 * Everything here runs offline from UTC timestamps (NOAA solar equations), so the
 * sunrise panel and the month list never make a network request.
 */
(function () {
  "use strict";
  const RAD = Math.PI / 180;
  const DAY = 86400000;

  // Twilight thresholds (sun altitude in degrees).
  // veryDawn/veryDusk: sun 28° below the horizon. nautical (-12°) only colors the twilight bands.
  const H = { sunrise: -0.833, dawn: -6, nautical: -12, astro: -18, veryDawn: -28 };

  function solarParams(ms) {
    const jd = ms / DAY + 2440587.5;
    const T = (jd - 2451545) / 36525;
    const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
    const y = Math.tan((eps * RAD) / 2) ** 2;
    const eqTime = (4 / RAD) * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
    return { decl, eqTime };
  }

  /** Sun altitude and azimuth (degrees) at a UTC instant. */
  function position(ms, lat, lon) {
    const { decl, eqTime } = solarParams(ms);
    const utcMin = (((ms / 60000) % 1440) + 1440) % 1440;
    const tst = (((utcMin + eqTime + 4 * lon) % 1440) + 1440) % 1440;
    const ha = tst / 4 - 180;
    const cosZ = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
    const zenith = Math.acos(Math.max(-1, Math.min(1, cosZ))) / RAD;
    // Geometric altitude: the -0.833 degree sunrise threshold already accounts for refraction and the sun's radius.
    const alt = 90 - zenith;
    const azDen = Math.cos(lat * RAD) * Math.sin(zenith * RAD);
    let az = 180;
    if (Math.abs(azDen) > 1e-6) {
      const c = (Math.sin(lat * RAD) * Math.cos(zenith * RAD) - Math.sin(decl * RAD)) / azDen;
      az = Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
      az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
    }
    return { altitude: alt, azimuth: az, declination: decl };
  }

  // ------------------------------------------------------------ time zones
  const dtfCache = new Map();
  function partsFormatter(tz) {
    if (!dtfCache.has(tz)) {
      dtfCache.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }));
    }
    return dtfCache.get(tz);
  }
  /** Offset of a time zone from UTC in minutes. Without a zone, falls back to longitude-based solar time. */
  function offsetMinutes(ms, tz, lon) {
    if (tz) {
      try {
        const p = {};
        partsFormatter(tz).formatToParts(new Date(ms)).forEach((x) => { p[x.type] = Number(x.value); });
        const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
        return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
      } catch (e) { /* fall through */ }
    }
    return Math.round((lon || 0) / 15) * 60;
  }
  /** Local calendar fields at a UTC instant. */
  function localParts(ms, tz, lon) {
    const d = new Date(ms + offsetMinutes(ms, tz, lon) * 60000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() };
  }
  /** UTC instant of local midnight for a local calendar date. */
  function localMidnight(year, month, day, tz, lon) {
    const guess = Date.UTC(year, month, day);
    let ms = guess - offsetMinutes(guess, tz, lon) * 60000;
    ms = guess - offsetMinutes(ms, tz, lon) * 60000;
    return ms;
  }

  // ------------------------------------------------------------ daily events
  const STEP = 2 * 60000;
  /**
   * Sun events for one local day.
   * Returns ms timestamps (or null) for veryDawn, dawn, sunrise, solarNoon, sunset, dusk, veryDusk,
   * the altitude samples for charts, and polar flags.
   */
  function day(year, month, dayOfMonth, lat, lon, tz) {
    const start = localMidnight(year, month, dayOfMonth, tz, lon);
    const end = localMidnight(year, month, dayOfMonth + 1, tz, lon);
    const samples = [];
    for (let t = start; t <= end; t += STEP) samples.push({ t, alt: position(t, lat, lon).altitude });
    if (samples[samples.length - 1].t !== end) samples.push({ t: end, alt: position(end, lat, lon).altitude });

    let max = samples[0];
    let min = samples[0];
    samples.forEach((s) => { if (s.alt > max.alt) max = s; if (s.alt < min.alt) min = s; });
    // Refine solar noon to the minute.
    let noon = max.t;
    let best = max.alt;
    for (let t = max.t - STEP; t <= max.t + STEP; t += 15000) {
      const a = position(t, lat, lon).altitude;
      if (a > best) { best = a; noon = t; }
    }

    function crossing(h, rising) {
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        const up = a.alt < h && b.alt >= h;
        const down = a.alt >= h && b.alt < h;
        if ((rising && up) || (!rising && down)) {
          const f = (h - a.alt) / (b.alt - a.alt);
          return Math.round(a.t + f * (b.t - a.t));
        }
      }
      return null;
    }
    const polarDay = min.alt > H.sunrise;
    const polarNight = max.alt < H.sunrise;
    // Daylight: total time with the sun above the sunrise threshold.
    let daylight = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const span = b.t - a.t;
      if (a.alt >= H.sunrise && b.alt >= H.sunrise) daylight += span;
      else if (a.alt >= H.sunrise || b.alt >= H.sunrise) {
        const f = (H.sunrise - a.alt) / (b.alt - a.alt);
        daylight += a.alt >= H.sunrise ? f * span : (1 - f) * span;
      }
    }
    return {
      start, end, length: end - start, samples,
      veryDawn: crossing(H.veryDawn, true), dawn: crossing(H.dawn, true), sunrise: crossing(H.sunrise, true),
      solarNoon: noon, noonAltitude: best,
      sunset: crossing(H.sunrise, false), dusk: crossing(H.dawn, false), veryDusk: crossing(H.veryDawn, false),
      astroDawn: crossing(H.astro, true), astroDusk: crossing(H.astro, false),
      minAltitude: min.alt, polarDay, polarNight,
      daylight: polarDay ? end - start : polarNight ? 0 : Math.round(daylight),
    };
  }

  /** Day/night segments across a local day as fractions 0..1 (for the blue/black bars). */
  function daySegments(info) {
    if (info.polarDay) return [{ from: 0, to: 1, day: true }];
    if (info.polarNight) return [{ from: 0, to: 1, day: false }];
    const segs = [];
    let cur = info.samples[0].alt >= H.sunrise;
    let from = 0;
    for (let i = 1; i < info.samples.length; i++) {
      const a = info.samples[i - 1];
      const b = info.samples[i];
      const isDay = b.alt >= H.sunrise;
      if (isDay !== cur) {
        const f = (H.sunrise - a.alt) / (b.alt - a.alt);
        const at = (a.t + f * (b.t - a.t) - info.start) / info.length;
        segs.push({ from, to: at, day: cur });
        from = at;
        cur = isDay;
      }
    }
    segs.push({ from, to: 1, day: cur });
    return segs;
  }

  // ------------------------------------------------------------ moon
  const SYNODIC = 29.530588853;
  /** Moon phase 0..1 (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter) and illuminated fraction. */
  function moon(ms) {
    const jd = ms / DAY + 2440587.5;
    let phase = ((jd - 2451550.1) / SYNODIC) % 1;
    if (phase < 0) phase += 1;
    return { phase, illumination: (1 - Math.cos(2 * Math.PI * phase)) / 2, age: phase * SYNODIC };
  }
  function moonPhaseKey(phase) {
    const keys = ["moonNew", "moonWaxingCrescent", "moonFirstQuarter", "moonWaxingGibbous", "moonFull", "moonWaningGibbous", "moonLastQuarter", "moonWaningCrescent"];
    return keys[Math.round(phase * 8) % 8];
  }
  /**
   * SVG markup of the moon at a phase. In the southern hemisphere the lit side is mirrored.
   */
  function moonSVG(phase, size, southern, label) {
    const r = 10;
    const c = 12;
    const k = Math.cos(2 * Math.PI * phase);
    const rx = Math.abs(k) * r;
    const waxing = phase < 0.5;
    let d;
    if (waxing) {
      d = `M${c} ${c - r}A${r} ${r} 0 0 1 ${c} ${c + r}A${rx.toFixed(2)} ${r} 0 0 ${phase < 0.25 ? 0 : 1} ${c} ${c - r}Z`;
    } else {
      d = `M${c} ${c - r}A${r} ${r} 0 0 0 ${c} ${c + r}A${rx.toFixed(2)} ${r} 0 0 ${phase > 0.75 ? 1 : 0} ${c} ${c - r}Z`;
    }
    const flip = southern ? ` transform="matrix(-1 0 0 1 24 0)"` : "";
    const a11y = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
    return `<svg class="gw-moon" viewBox="0 0 24 24" width="${size}" height="${size}" ${a11y} focusable="false"><circle cx="12" cy="12" r="10" class="gw-moon-dark"/><path d="${d}" class="gw-moon-lit"${flip}/><circle cx="12" cy="12" r="10" class="gw-moon-rim"/></svg>`;
  }

  window.GanetiosSun = Object.freeze({ H, position, day, daySegments, offsetMinutes, localParts, localMidnight, moon, moonPhaseKey, moonSVG });
})();
