/*
 * Munetios Maps: the solar system and beyond.
 *
 * Zooming out past the whole Earth opens a space view with the planets at their real positions
 * for today (JPL approximate orbital elements, valid 1800–2050). Keep zooming out to see the outer
 * planets, the Kuiper belt and Oort cloud, nearby stars, the Milky Way, the Local Group and the
 * observable universe. Zooming back in on Earth returns to the map.
 */
(() => {
  "use strict";
  const RAD = Math.PI / 180;
  const AU_KM = 149597870.7;
  const LY_AU = 63241.077;

  /* ------------------------------------------------------------ orbits */
  // a (AU), e, I, L, long. perihelion, long. ascending node (degrees) and their rates per century.
  const ELEMENTS = {
    mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
    venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
    earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
    mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
    jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
    saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
    uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
    neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.01262724]],
    pluto: [[39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684], [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482]],
  };
  // Diameter (km), length of day (hours), year (days), known moons, color, minimum size on screen (px).
  const BODIES = {
    sun: { d: 1392700, day: 609.12, moons: null, color: "#ffcc4d", min: 12 },
    mercury: { d: 4879, day: 4222.6, year: 87.97, moons: 0, color: "#a8a29e", min: 4 },
    venus: { d: 12104, day: 2802, year: 224.7, moons: 0, color: "#e8c88f", min: 5 },
    earth: { d: 12756, day: 24, year: 365.25, moons: 1, color: "#4a90e2", min: 6 },
    mars: { d: 6792, day: 24.7, year: 687, moons: 2, color: "#d2693c", min: 5 },
    jupiter: { d: 142984, day: 9.9, year: 4331, moons: 95, color: "#d9b38c", min: 9 },
    saturn: { d: 120536, day: 10.7, year: 10747, moons: 146, color: "#e6d3a3", min: 8 },
    uranus: { d: 51118, day: 17.2, year: 30589, moons: 28, color: "#9fdfe8", min: 7 },
    neptune: { d: 49528, day: 16.1, year: 59800, moons: 16, color: "#4f6fe0", min: 7 },
    pluto: { d: 2376, day: 153.3, year: 90560, moons: 5, color: "#cbb8a0", min: 3 },
    moon: { d: 3475, day: 708.7, year: 27.32, moons: 0, color: "#c9c9c9", min: 4 },
  };
  const PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
  const julianCenturies = (date) => (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
  function elementsAt(id, T) {
    const [base, rate] = ELEMENTS[id];
    return base.map((v, i) => v + rate[i] * T);
  }
  function orbitPoint(el, E) {
    const [a, e, I, L, wbar, node] = el;
    const w = (wbar - node) * RAD;
    const O = node * RAD;
    const inc = I * RAD;
    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(inc), si = Math.sin(inc);
    return [
      (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
      (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
      sw * si * xp + cw * si * yp,
    ];
  }
  function position(id, date) {
    const el = elementsAt(id, julianCenturies(date));
    const e = el[1];
    let M = ((el[3] - el[4]) % 360) * RAD;
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    return orbitPoint(el, E);
  }
  function orbitPath(id, date) {
    const el = elementsAt(id, julianCenturies(date));
    const pts = [];
    for (let i = 0; i <= 240; i++) pts.push(orbitPoint(el, (i / 240) * Math.PI * 2));
    return pts;
  }
  // The Moon's geocentric ecliptic longitude (same low-precision theory as maps-space.js).
  function moonOffset(date) {
    const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;
    const L = 218.316 + 13.176396 * d;
    const M = (134.963 + 13.064993 * d) * RAD;
    const D = (297.85 + 12.190749 * d) * RAD;
    const lambda = (L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D)) * RAD;
    const r = 384400 / AU_KM;
    return [r * Math.cos(lambda), r * Math.sin(lambda)];
  }
  // RA/Dec (degrees) and distance (AU) to ecliptic x/y.
  function sky(raDeg, decDeg, distAU) {
    const ra = raDeg * RAD, dec = decDeg * RAD, eps = 23.4393 * RAD;
    const x = Math.cos(dec) * Math.cos(ra), y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
    return [x * distAU, (y * Math.cos(eps) + z * Math.sin(eps)) * distAU];
  }
  const STARS = [
    ["Alpha Centauri", 219.9, -60.83, 4.37], ["Sirius", 101.29, -16.72, 8.6], ["Procyon", 114.83, 5.22, 11.46], ["Wolf 359", 164.12, 7.01, 7.9],
    ["Tau Ceti", 26.02, -15.94, 11.9], ["Epsilon Eridani", 53.23, -9.46, 10.5], ["Altair", 297.7, 8.87, 16.7], ["Vega", 279.23, 38.78, 25],
    ["Polaris", 37.95, 89.26, 433], ["Betelgeuse", 88.79, 7.41, 548], ["Rigel", 78.63, -8.2, 860],
  ].map(([name, ra, dec, ly]) => ({ name, xy: sky(ra, dec, ly * LY_AU) }));
  const GALACTIC_CENTER = sky(266.42, -29.01, 26000 * LY_AU);
  const GALAXIES = [
    ["andromeda", 10.68, 41.27, 2.537e6, 110000], ["triangulum", 23.46, 30.66, 2.73e6, 30000], ["magellanicClouds", 80.89, -69.76, 160000, 14000],
  ].map(([key, ra, dec, ly, size]) => ({ key, xy: sky(ra, dec, ly * LY_AU), size: size * LY_AU }));

  /* ------------------------------------------------------------ procedural backgrounds */
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  // Milky Way: a barred spiral 100,000 light-years across, centered on the galactic center.
  const GALAXY_POINTS = [];
  for (let i = 0; i < 9000; i++) {
    const arm = i % 4;
    const t = Math.pow(rand(), 0.7);
    const r = t * 50000;
    const angle = arm * (Math.PI / 2) + Math.log(1 + r / 4000) * 2.4 + gauss() * 0.28;
    const spread = 1200 + r * 0.06;
    GALAXY_POINTS.push([Math.cos(angle) * r + gauss() * spread, Math.sin(angle) * r + gauss() * spread, rand()]);
  }
  for (let i = 0; i < 2500; i++) GALAXY_POINTS.push([gauss() * 3500, gauss() * 2200, rand()]);
  const KUIPER = Array.from({ length: 900 }, () => { const r = 30 + rand() * 20, a = rand() * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; });
  const OORT = Array.from({ length: 1400 }, () => { const r = 2000 + Math.pow(rand(), 0.6) * 98000, a = rand() * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; });
  // Cosmic web: galaxy clusters along filaments, filling the observable universe (46.5 billion ly).
  const UNIVERSE_R = 46.5e9 * LY_AU;
  const WEB = [];
  for (let n = 0; n < 160; n++) {
    let x = (rand() * 2 - 1) * UNIVERSE_R, y = (rand() * 2 - 1) * UNIVERSE_R;
    const dir = rand() * Math.PI * 2;
    for (let k = 0; k < 40; k++) {
      x += Math.cos(dir + gauss() * 0.5) * UNIVERSE_R * 0.02;
      y += Math.sin(dir + gauss() * 0.5) * UNIVERSE_R * 0.02;
      if (Math.hypot(x, y) < UNIVERSE_R) WEB.push([x, y, rand()]);
    }
  }

  /* ------------------------------------------------------------ sky backdrop */
  // Star colors by temperature (blue-white to orange-red), weighted toward the common white and yellow stars.
  const STAR_COLORS = [[155, 176, 255], [170, 191, 255], [202, 215, 255], [248, 247, 255], [255, 244, 234], [255, 236, 210], [255, 214, 170], [255, 190, 140]];
  function makeSky(w, h, scaleFactor) {
    const c = document.createElement("canvas");
    c.width = Math.round(w * scaleFactor);
    c.height = Math.round(h * scaleFactor);
    const g = c.getContext("2d");
    g.scale(scaleFactor, scaleFactor);
    g.fillStyle = "#000000";
    g.fillRect(0, 0, w, h);
    let sd = 97;
    const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    // Milky Way band: soft clouds of light along a tilted band, with darker dust.
    const bandAngle = -0.42;
    const cx = w / 2, cy = h / 2, len = Math.hypot(w, h);
    g.save();
    g.translate(cx, cy);
    g.rotate(bandAngle);
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 260; i++) {
      const x = (rnd() - 0.5) * len;
      const y = (rnd() - 0.5 + (rnd() - 0.5)) * h * 0.16;
      const r = 30 + rnd() * 110;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const warm = rnd() < 0.3;
      grad.addColorStop(0, warm ? "rgba(255,226,190,0.035)" : "rgba(190,205,255,0.03)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 4200; i++) {
      const x = (rnd() - 0.5) * len;
      const y = (rnd() - 0.5 + (rnd() - 0.5) + (rnd() - 0.5)) * h * 0.12;
      g.fillStyle = `rgba(230,232,255,${0.08 + rnd() * 0.22})`;
      g.fillRect(x, y, 0.8, 0.8);
    }
    g.globalCompositeOperation = "source-over";
    for (let i = 0; i < 70; i++) {
      const x = (rnd() - 0.5) * len;
      const y = (rnd() - 0.5) * h * 0.05;
      const r = 20 + rnd() * 70;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(0,0,0,0.35)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.restore();
    // Stars: many faint, few bright.
    const count = Math.round((w * h) / 520);
    for (let i = 0; i < count; i++) {
      const x = rnd() * w, y = rnd() * h;
      const mag = Math.pow(rnd(), 3.2);
      const [r, gg, b] = STAR_COLORS[Math.floor(Math.pow(rnd(), 0.8) * STAR_COLORS.length)];
      const alpha = 0.18 + mag * 0.82;
      const size = 0.5 + mag * 1.5;
      g.fillStyle = `rgba(${r},${gg},${b},${alpha})`;
      g.beginPath(); g.arc(x, y, size, 0, Math.PI * 2); g.fill();
      if (mag > 0.75) {
        const halo = g.createRadialGradient(x, y, 0, x, y, size * 5);
        halo.addColorStop(0, `rgba(${r},${gg},${b},0.35)`);
        halo.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = halo;
        g.fillRect(x - size * 5, y - size * 5, size * 10, size * 10);
        // Faint diffraction spikes on the brightest stars.
        if (mag > 0.92) {
          g.strokeStyle = `rgba(${r},${gg},${b},0.22)`;
          g.lineWidth = 0.6;
          g.beginPath(); g.moveTo(x - size * 7, y); g.lineTo(x + size * 7, y); g.moveTo(x, y - size * 7); g.lineTo(x, y + size * 7); g.stroke();
        }
      }
    }
    return c;
  }
  // Atmosphere rim colors.
  const ATMOSPHERE = { earth: [110, 170, 255, 0.55], venus: [255, 214, 150, 0.4], mars: [255, 150, 110, 0.22], jupiter: [255, 220, 180, 0.18], saturn: [255, 230, 190, 0.16], uranus: [170, 235, 255, 0.3], neptune: [110, 150, 255, 0.32] };

  /* ------------------------------------------------------------ textures */
  const textures = {};
  function loadTexture(id) {
    if (textures[id]) return textures[id];
    const entry = { data: null };
    textures[id] = entry;
    const img = new Image();
    img.src = id === "moon" ? "./moon/moon-1k.jpg" : `./planets/${id}/tex.jpg`;
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      entry.data = g.getImageData(0, 0, c.width, c.height);
      sprites.clear();
      requestDraw();
    };
    return entry;
  }
  const saturnRing = new Image();
  saturnRing.src = "./planets/saturn/ring.png";
  const sprites = new Map();
  // A lit sphere seen from the ecliptic plane, light coming from the Sun's direction on screen.
  function sphereSprite(id, radius, lightAngle) {
    const px = Math.max(4, Math.round(radius * 2));
    const la = Math.round(lightAngle / 0.2) * 0.2;
    const key = `${id}:${px}:${id === "sun" ? 0 : la}`;
    if (sprites.has(key)) return sprites.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const g = canvas.getContext("2d");
    const img = g.createImageData(px, px);
    const tex = loadTexture(id).data;
    // la: direction toward the Sun on screen, measured counterclockwise with y pointing up.
    const lx = Math.cos(la), ly = Math.sin(la), lz = 0.12;
    const ll = Math.hypot(lx, ly, lz);
    const color = BODIES[id]?.color || "#cccccc";
    const cr = parseInt(color.slice(1, 3), 16), cg = parseInt(color.slice(3, 5), 16), cb = parseInt(color.slice(5, 7), 16);
    for (let j = 0; j < px; j++) {
      const b = 1 - ((j + 0.5) / px) * 2;
      for (let i = 0; i < px; i++) {
        const a = ((i + 0.5) / px) * 2 - 1;
        const rr = a * a + b * b;
        if (rr > 1) continue;
        const c = Math.sqrt(1 - rr);
        let r = cr, gg = cg, bb = cb;
        if (tex) {
          const lat = Math.asin(b), lng = Math.atan2(a, c);
          const tx = Math.min(tex.width - 1, Math.floor((lng / (2 * Math.PI) + 0.5) * tex.width));
          const ty = Math.min(tex.height - 1, Math.floor((0.5 - lat / Math.PI) * tex.height));
          const q = (ty * tex.width + tx) * 4;
          r = tex.data[q]; gg = tex.data[q + 1]; bb = tex.data[q + 2];
        }
        const ndl = (a * lx + b * ly + c * lz) / ll;
        const lit = Math.max(0, Math.min(1, (ndl + 0.06) / 0.5));
        const limb = id === "sun" ? 0.62 + 0.38 * Math.pow(c, 0.5) : 1;
        const shade = id === "sun" ? limb * 1.08 : 0.025 + 0.975 * lit * lit * (3 - 2 * lit) * (0.82 + 0.18 * c);
        const p = (j * px + i) * 4;
        img.data[p] = r * shade;
        img.data[p + 1] = gg * shade;
        img.data[p + 2] = bb * shade;
        img.data[p + 3] = 255 * Math.min(1, (1 - Math.sqrt(rr)) * px * 0.5);
      }
    }
    g.putImageData(img, 0, 0);
    if (sprites.size > 400) sprites.clear();
    sprites.set(key, canvas);
    return canvas;
  }

  /* ------------------------------------------------------------ view */
  let requestDraw = () => {};
  function start() {
    const F = window.MapsFeatures;
    const map = window._mapsApi?.map;
    const Space = window.MunetiosSpace;
    if (!F || !map || !Space || map.__munetiosSolar) return;
    map.__munetiosSolar = true;
    const t = (key, vars) => F.t(key, vars);
    const lang = () => { try { const l = _getLang(); return l === "auto" ? navigator.language : l; } catch { return navigator.language; } };
    const fmt = (n, digits = 0) => { try { return new Intl.NumberFormat(lang(), { maximumFractionDigits: digits }).format(n); } catch { return String(Math.round(n)); } };
    const sig = (n) => fmt(n, n < 10 ? 2 : n < 100 ? 1 : 0);
    function distanceLabel(au) {
      if (au < 0.01) return t("kmUnit", { n: fmt(au * AU_KM) });
      if (au < 20000) return t("auUnit", { n: sig(au) });
      const ly = au / LY_AU;
      if (ly < 1e6) return t("lyUnit", { n: sig(ly) });
      if (ly < 1e9) return t("mlyUnit", { n: sig(ly / 1e6) });
      return t("glyUnit", { n: sig(ly / 1e9) });
    }
    const durationLabel = (days) => (days < 2 ? t("hoursUnit", { n: sig(days * 24) }) : days < 730 ? t("daysUnit", { n: sig(days) }) : t("yearsUnit", { n: sig(days / 365.25) }));

    /* -------------------------------------------- DOM */
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
    const icon = (name) => h("span", { class: "mu-icon", "aria-hidden": "true", text: name });
    const canvas = h("canvas", { class: "mf-solar-canvas", role: "img" });
    const title = h("span", { class: "mf-solar-title" });
    const sub = h("span", { class: "mf-solar-sub" });
    const backBtn = h("button", { type: "button", class: "mu-btn mu-btn-primary mf-solar-back" }, [icon("public"), h("span", { class: "mf-solar-back-label" })]);
    const zoomIn = h("button", { type: "button", class: "mu-icon-btn mf-solar-zoom" }, [icon("add")]);
    const zoomOut = h("button", { type: "button", class: "mu-icon-btn mf-solar-zoom" }, [icon("remove")]);
    const SPEEDS = [["pause", "timePaused", "pause", 0], ["live", "timeLive", "schedule", 1], ["day", "timeDay", "fast_forward", 86400], ["month", "timeMonth", "double_arrow", 86400 * 30]];
    const speedBtns = SPEEDS.map(([id, key, ic]) => h("button", { type: "button", "data-speed": id, "aria-pressed": id === "live" ? "true" : "false" }, [icon(ic), h("span", { class: "mf-solar-speed-label", "data-key": key })]));
    const scaleBar = h("div", { class: "mf-solar-scale" }, [h("i"), h("span")]);
    const card = h("div", { class: "mf-solar-card", hidden: "", role: "dialog", "aria-modal": "false" });
    const list = h("div", { class: "nav-sr-only mf-solar-list" });
    const overlay = h("div", { class: "mf-solar", hidden: "", role: "region", "aria-labelledby": "mfSolarTitle" }, [canvas, list]);
    const ui = h("div", { class: "mf-solar-ui", hidden: "" }, [
      h("div", { class: "mf-solar-top" }, [h("div", { class: "mf-solar-heading" }, [icon("brightness_low"), h("div", { class: "mf-solar-heading-text" }, [Object.assign(title, { id: "mfSolarTitle" }), sub])]), backBtn]),
      h("div", { class: "mf-solar-bottom" }, [scaleBar, h("div", { class: "mu-segmented mf-solar-speeds", role: "group" }, speedBtns), h("div", { class: "mf-solar-zooms" }, [zoomOut, zoomIn])]),
      card,
    ]);
    // Right after the map canvas, so the app's panels and buttons stay above it.
    const mapEl = map.getContainer();
    mapEl.parentNode.insertBefore(overlay, mapEl.nextSibling);
    document.body.append(ui);
    const hint = h("button", { type: "button", class: "mu-btn mf-solar-hint", hidden: "" }, [icon("brightness_low"), h("span", { class: "mf-solar-hint-label" })]);
    document.body.append(hint);
    hint.addEventListener("click", () => open());

    /* -------------------------------------------- state */
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, dpr = 1;
    let center = [0, 0];
    let scale = 1.6e-5; // AU per pixel
    const MIN_SCALE = 1.2e-5;
    const MAX_SCALE = UNIVERSE_R / 160;
    let simTime = Date.now();
    let speed = 1;
    let lastFrame = performance.now();
    let selected = null;
    let hits = [];
    let raf = 0;
    let isOpen = false;
    requestDraw = () => { if (isOpen && !raf) raf = requestAnimationFrame(frame); };
    const date = () => new Date(simTime);
    const earthPos = () => position("earth", date());
    const bodyPos = (id) => {
      if (id === "sun") return [0, 0, 0];
      if (id === "moon") { const e = earthPos(); const m = moonOffset(date()); return [e[0] + m[0], e[1] + m[1], 0]; }
      return position(id, date());
    };
    const toScreen = (p) => [W / 2 + (p[0] - center[0]) / scale, H / 2 - (p[1] - center[1]) / scale];
    const toWorld = (x, y) => [center[0] + (x - W / 2) * scale, center[1] - (y - H / 2) * scale];

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = overlay.clientWidth;
      H = overlay.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      requestDraw();
    }
    window.addEventListener("resize", () => { if (isOpen) resize(); });

    /* -------------------------------------------- drawing */
    const fade = (value, lo, hi) => Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
    let placed = [];
    function label(text, x, y, color = "rgba(244,241,255,0.92)", align = "left") {
      ctx.font = '400 18px "Munetios UI v4 Font", system-ui, sans-serif';
      const w = ctx.measureText(text).width;
      const left = align === "center" ? x - w / 2 : x;
      const box = [left - 4, y - 13, left + w + 4, y + 13];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
      placed.push(box);
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(4,6,16,0.85)";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    }
    function region() {
      const R = scale * Math.min(W, H) / 2;
      if (R < 0.02) return "earthMoon";
      if (R < 3) return "innerPlanets";
      if (R < 70) return "solarSystem";
      if (R < 900) return "kuiperBelt";
      if (R < 3e5) return "oortCloud";
      if (R < 2e8) return "nearbyStars";
      if (R < 1.5e10) return "milkyWay";
      if (R < 8e11) return "localGroup";
      return "observableUniverse";
    }
    let skyCache = null;
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!skyCache || skyCache.w !== W || skyCache.h !== H) skyCache = { w: W, h: H, img: makeSky(W, H, dpr) };
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, H);
      const skyA = 1 - fade(Math.log10(scale * Math.min(W, H) / 2), Math.log10(3e8), Math.log10(4e9));
      if (skyA > 0) { ctx.globalAlpha = skyA; ctx.drawImage(skyCache.img, 0, 0, W, H); ctx.globalAlpha = 1; }
      placed = [];
      hits = [];
      const R = scale * Math.min(W, H) / 2;
      const now = date();

      // Observable universe and cosmic web.
      const webA = fade(Math.log10(R), Math.log10(2e11), Math.log10(2e12));
      if (webA > 0) {
        ctx.globalCompositeOperation = "lighter";
        for (const [x, y, b] of WEB) {
          const [sx, sy] = toScreen([x, y]);
          if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue;
          ctx.fillStyle = `rgba(${170 + b * 60},${150 + b * 50},255,${(0.25 + b * 0.5) * webA})`;
          ctx.fillRect(sx, sy, 1.6, 1.6);
        }
        ctx.globalCompositeOperation = "source-over";
        const [cx, cy] = toScreen([0, 0]);
        const r = UNIVERSE_R / scale;
        ctx.strokeStyle = `rgba(180,160,255,${0.55 * webA})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Local Group galaxies.
      const lgA = fade(Math.log10(R), Math.log10(4e9), Math.log10(3e10)) * (1 - fade(Math.log10(R), Math.log10(2e12), Math.log10(2e13)));
      if (lgA > 0) {
        for (const g of GALAXIES) {
          const [sx, sy] = toScreen(g.xy);
          const r = Math.max(6, g.size / scale / 2);
          const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
          grad.addColorStop(0, `rgba(255,240,220,${0.9 * lgA})`);
          grad.addColorStop(0.4, `rgba(190,170,255,${0.35 * lgA})`);
          grad.addColorStop(1, "rgba(120,100,255,0)");
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.45, 0.6, 0, Math.PI * 2); ctx.fill();
          label(t(g.key), sx + r * 0.7 + 8, sy, `rgba(244,241,255,${lgA})`);
          hits.push({ id: g.key, kind: "galaxy", x: sx, y: sy, r: Math.max(16, r * 0.6) });
        }
      }

      // Milky Way.
      const mwA = fade(Math.log10(R), Math.log10(5e7), Math.log10(6e8)) * (1 - fade(Math.log10(R), Math.log10(1e13), Math.log10(1e14)));
      if (mwA > 0) {
        const [gx, gy] = toScreen(GALACTIC_CENTER);
        const unit = LY_AU / scale;
        ctx.globalCompositeOperation = "lighter";
        const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, 52000 * unit);
        glow.addColorStop(0, `rgba(255,226,170,${0.7 * mwA})`);
        glow.addColorStop(0.08, `rgba(255,205,140,${0.32 * mwA})`);
        glow.addColorStop(0.35, `rgba(150,170,230,${0.1 * mwA})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(gx, gy, 52000 * unit, 0, Math.PI * 2); ctx.fill();
        const dot = Math.max(1, Math.min(2.4, 200 * unit));
        for (const [x, y, b] of GALAXY_POINTS) {
          const sx = gx + x * unit, sy = gy - y * unit;
          if (sx < -3 || sy < -3 || sx > W + 3 || sy > H + 3) continue;
          // Old yellow stars near the core, young blue-white stars out in the arms.
          const r = Math.hypot(x, y) / 50000;
          const warm = Math.max(0, 1 - r * 2.2);
          ctx.fillStyle = `rgba(${Math.round(190 + 65 * warm)},${Math.round(200 + 20 * warm - 10 * b)},${Math.round(255 - 95 * warm)},${(0.12 + b * 0.38) * mwA})`;
          ctx.fillRect(sx, sy, dot, dot);
        }
        ctx.globalCompositeOperation = "source-over";
        if (52000 * unit > 50) {
          label(t("galacticCenter"), gx, gy + 22, `rgba(255,236,200,${mwA})`, "center");
          hits.push({ id: "galacticCenter", kind: "place", x: gx, y: gy, r: 18 });
        } else {
          label(t("milkyWay"), gx + Math.max(10, 52000 * unit) + 6, gy, `rgba(255,236,200,${mwA})`);
        }
      }

      // Nearby stars.
      const starA = fade(Math.log10(R), Math.log10(4e4), Math.log10(4e5)) * (1 - fade(Math.log10(R), Math.log10(1.5e8), Math.log10(1.5e9)));
      if (starA > 0) {
        for (const s of STARS) {
          const [sx, sy] = toScreen(s.xy);
          if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
          ctx.fillStyle = `rgba(255,250,235,${starA})`;
          ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill();
          label(s.name, sx + 10, sy, `rgba(244,241,255,${starA})`);
          hits.push({ id: s.name, kind: "star", x: sx, y: sy, r: 14, dist: Math.hypot(...s.xy) });
        }
      }

      // Oort cloud and Kuiper belt.
      const oortA = fade(Math.log10(R), Math.log10(400), Math.log10(4000)) * (1 - fade(Math.log10(R), Math.log10(2e6), Math.log10(2e7)));
      if (oortA > 0) {
        ctx.fillStyle = `rgba(170,190,255,${0.35 * oortA})`;
        for (const [x, y] of OORT) { const [sx, sy] = toScreen([x, y]); if (sx >= 0 && sy >= 0 && sx <= W && sy <= H) ctx.fillRect(sx, sy, 1.4, 1.4); }
        const [cx, cy] = toScreen([0, 0]);
        if (100000 / scale > 80) label(t("oortCloud"), cx, cy - 60000 / scale, `rgba(200,210,255,${oortA})`, "center");
      }
      const kuiperA = fade(Math.log10(R), Math.log10(15), Math.log10(60)) * (1 - fade(Math.log10(R), Math.log10(5e3), Math.log10(5e4)));
      if (kuiperA > 0) {
        ctx.fillStyle = `rgba(190,200,230,${0.45 * kuiperA})`;
        for (const [x, y] of KUIPER) { const [sx, sy] = toScreen([x, y]); if (sx >= 0 && sy >= 0 && sx <= W && sy <= H) ctx.fillRect(sx, sy, 1.5, 1.5); }
        const [cx, cy] = toScreen([0, 0]);
        if (50 / scale > 80) label(t("kuiperBelt"), cx, cy - 52 / scale, `rgba(210,215,240,${kuiperA})`, "center");
      }

      // The Sun's neighborhood: "You are here" once the solar system is a dot.
      const hereA = fade(Math.log10(R), Math.log10(5e4), Math.log10(5e5));
      if (hereA > 0) {
        const [sx, sy] = toScreen([0, 0]);
        ctx.strokeStyle = `rgba(255,209,102,${hereA})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(255,209,102,${hereA})`;
        ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
        label(t("youAreHere"), sx + 16, sy - 14, `rgba(255,209,102,${hereA})`);
      }

      // Planets, orbits, Sun.
      const planetA = 1 - fade(Math.log10(R), Math.log10(3e3), Math.log10(3e4));
      if (planetA > 0) {
        for (const id of PLANETS) {
          const a = ELEMENTS[id][0][0];
          const orbitPx = a / scale;
          if (orbitPx < 6) continue;
          const pts = orbitPath(id, now);
          ctx.strokeStyle = id === "earth" ? `rgba(120,175,255,${0.55 * planetA})` : `rgba(255,255,255,${0.16 * planetA})`;
          ctx.lineWidth = id === "earth" ? 1.4 : 1;
          if (id === "pluto") ctx.setLineDash([6, 6]);
          ctx.beginPath();
          pts.forEach((p, i) => { const [x, y] = toScreen(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // Sun
        const [sx, sy] = toScreen([0, 0]);
        const sunR = Math.max(BODIES.sun.min, (BODIES.sun.d / 2 / AU_KM) / scale);
        if (sx > -sunR * 4 && sy > -sunR * 4 && sx < W + sunR * 4 && sy < H + sunR * 4) {
          ctx.globalCompositeOperation = "lighter";
          const reach = Math.max(sunR * 6, 60);
          const glow = ctx.createRadialGradient(sx, sy, sunR * 0.8, sx, sy, reach);
          glow.addColorStop(0, `rgba(255,236,190,${0.75 * planetA})`);
          glow.addColorStop(0.12, `rgba(255,200,120,${0.32 * planetA})`);
          glow.addColorStop(0.4, `rgba(255,150,70,${0.08 * planetA})`);
          glow.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(sx, sy, reach, 0, Math.PI * 2); ctx.fill();
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = planetA;
          const spr = sphereSprite("sun", Math.min(sunR, 400), 0);
          ctx.drawImage(spr, sx - Math.min(sunR, 400), sy - Math.min(sunR, 400), Math.min(sunR, 400) * 2, Math.min(sunR, 400) * 2);
          ctx.globalAlpha = 1;
          label(t("sun"), sx, sy + Math.min(sunR, 400) + 18, `rgba(255,224,150,${planetA})`, "center");
          hits.push({ id: "sun", kind: "body", x: sx, y: sy, r: Math.max(16, Math.min(sunR, 400)) });
        }
        const showMoon = scale < 4e-4;
        const drawList = PLANETS.map((id) => ({ id, p: position(id, now) }));
        if (showMoon) drawList.push({ id: "moon", p: bodyPos("moon") });
        for (const { id, p } of drawList) {
          const [x, y] = toScreen(p);
          const real = (BODIES[id].d / 2 / AU_KM) / scale;
          const r = Math.min(Math.max(BODIES[id].min, real), 600);
          if (x < -r - 60 || y < -r - 60 || x > W + r + 60 || y > H + r + 60) continue;
          const a = ELEMENTS[id] ? ELEMENTS[id][0][0] : 1;
          if (id !== "moon" && a / scale < 6 && id !== "earth") continue;
          ctx.globalAlpha = planetA;
          if (id === "saturn" && saturnRing.complete && saturnRing.naturalWidth) {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(1, 0.38);
            ctx.drawImage(saturnRing, -r * 2.3, -r * 2.3, r * 4.6, r * 4.6);
            ctx.restore();
          }
          const atm = ATMOSPHERE[id];
          if (atm && r >= 4) {
            const [ar, ag, ab, aa] = atm;
            const rim = ctx.createRadialGradient(x, y, r * 0.92, x, y, r * 1.35);
            rim.addColorStop(0, `rgba(${ar},${ag},${ab},${aa * planetA})`);
            rim.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
            ctx.fillStyle = rim;
            ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, Math.PI * 2); ctx.fill();
          }
          const spr = sphereSprite(id, r, Math.atan2(sy - y, sx - x) * -1);
          ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          if (id === "earth") {
            ctx.strokeStyle = `rgba(120,175,255,${0.5 * planetA})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.stroke();
          }
          label(t(id), x + r + 8, y, id === "earth" ? `rgba(160,200,255,${planetA})` : `rgba(244,241,255,${planetA})`);
          hits.push({ id, kind: "body", x, y, r: Math.max(16, r) });
        }
        if (showMoon) {
          const [ex, ey] = toScreen(earthPos());
          const mr = (384400 / AU_KM) / scale;
          if (mr > 20) {
            ctx.strokeStyle = "rgba(200,200,220,0.35)";
            ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(ex, ey, mr, 0, Math.PI * 2); ctx.stroke();
          }
        }
      }

      // Scale bar and heading.
      paintScale();
      const reg = region();
      title.textContent = t(reg);
      canvas.setAttribute("aria-label", t(reg));
      try { sub.textContent = new Intl.DateTimeFormat(lang(), { dateStyle: "long" }).format(now); } catch { sub.textContent = now.toDateString(); }
    }
    function paintScale() {
      const target = 140 * scale;
      const exp = Math.pow(10, Math.floor(Math.log10(target)));
      const step = [1, 2, 5, 10].map((m) => m * exp).reverse().find((v) => v <= target) || exp;
      scaleBar.querySelector("i").style.width = `${Math.max(20, step / scale)}px`;
      scaleBar.querySelector("span").textContent = distanceLabel(step);
    }
    function frame(ts) {
      raf = 0;
      const dt = Math.min(0.25, (ts - lastFrame) / 1000);
      lastFrame = ts;
      if (speed === 1) simTime = Date.now();
      else if (speed > 1) simTime += dt * speed * 1000;
      if (selected) followSelected();
      draw();
      if (selected) paintCard();
      if (isOpen && (speed !== 0 || animating)) raf = requestAnimationFrame(frame);
    }

    /* -------------------------------------------- camera */
    let animating = null;
    function zoomAt(factor, sx = W / 2, sy = H / 2) {
      const before = toWorld(sx, sy);
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE * 0.6, scale * factor));
      const after = toWorld(sx, sy);
      center = [center[0] + before[0] - after[0], center[1] + before[1] - after[1]];
      // Zoomed all the way in on Earth: back to the map.
      if (scale < MIN_SCALE) {
        const e = earthPos();
        const [ex, ey] = toScreen(e);
        if (Math.hypot(ex - W / 2, ey - H / 2) < Math.min(W, H) * 0.3) { close({ toEarth: true }); return; }
        scale = MIN_SCALE;
      }
      requestDraw();
    }
    function flyTo(target, targetScale, ms = 900) {
      const from = { c: center.slice(), s: Math.log(scale) };
      const to = { c: target, s: Math.log(targetScale) };
      const t0 = performance.now();
      animating = (ts) => {
        const k = Math.min(1, (ts - t0) / ms);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        center = [from.c[0] + (to.c[0] - from.c[0]) * e, from.c[1] + (to.c[1] - from.c[1]) * e];
        scale = Math.exp(from.s + (to.s - from.s) * e);
        if (k >= 1) animating = null;
      };
      const step = (ts) => { if (!animating) return; animating(ts); requestDraw(); if (animating) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
    function followSelected() {
      if (!selected || selected.kind !== "body" || animating) return;
      const p = bodyPos(selected.id);
      if (selected.follow) center = [p[0], p[1]];
    }
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      animating = null;
      zoomAt(Math.exp(e.deltaY * 0.0016), e.offsetX, e.offsetY);
    }, { passive: false });
    const pointers = new Map();
    let dragged = false;
    let pinch = 0;
    canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.offsetX, e.offsetY]); dragged = false; animating = null; if (selected) selected.follow = false; });
    canvas.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoomAt(pinch / d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = d;
        dragged = true;
        return;
      }
      const dx = e.offsetX - prev[0], dy = e.offsetY - prev[1];
      if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
      center = [center[0] - dx * scale, center[1] + dy * scale];
      requestDraw();
    });
    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (!dragged && e.type === "pointerup") pick(e.offsetX, e.offsetY);
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    zoomIn.addEventListener("click", () => zoomAt(0.5));
    zoomOut.addEventListener("click", () => zoomAt(2));
    const onSolarKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); if (!card.hidden) closeCard(); else close({ toEarth: !Space.isMoon() }); }
      else if ((e.key === "+" || e.key === "=") && e.target === canvas) zoomAt(0.5);
      else if (e.key === "-" && e.target === canvas) zoomAt(2);
    };
    overlay.addEventListener("keydown", onSolarKey);
    ui.addEventListener("keydown", onSolarKey);
    canvas.tabIndex = 0;

    /* -------------------------------------------- picking + info card */
    function pick(x, y) {
      const hit = hits.slice().reverse().find((h) => Math.hypot(h.x - x, h.y - y) <= h.r);
      if (!hit) { closeCard(); return; }
      select(hit);
    }
    function select(hit) {
      selected = { ...hit, follow: hit.kind === "body" };
      paintCard(true);
      card.hidden = false;
      if (hit.kind === "body") {
        const p = bodyPos(hit.id);
        const real = (BODIES[hit.id].d / 2 / AU_KM);
        const target = hit.id === "sun" ? 0.02 : hit.id === "moon" || hit.id === "earth" ? 4e-5 : Math.max(real / 40, 2e-5);
        flyTo([p[0], p[1]], Math.min(scale, target) === scale ? scale : target);
      }
      requestDraw();
    }
    function closeCard() { selected = null; card.hidden = true; requestDraw(); }
    let cardKey = "";
    function paintCard(force) {
      if (!selected) return;
      const id = selected.id;
      const key = id + ":" + Math.floor(simTime / 60000) + ":" + lang();
      if (!force && key === cardKey) return;
      cardKey = key;
      card.replaceChildren();
      const rows = [];
      const name = selected.kind === "star" ? id : t(id);
      if (selected.kind === "body") {
        const b = BODIES[id];
        const p = bodyPos(id);
        const e = earthPos();
        if (id !== "earth") rows.push(t("fromEarth", { value: distanceLabel(Math.hypot(p[0] - e[0], p[1] - e[1], (p[2] || 0) - (e[2] || 0))) }));
        if (id !== "sun") rows.push(t("fromSun", { value: distanceLabel(id === "moon" ? Math.hypot(p[0], p[1]) : Math.hypot(p[0], p[1], p[2] || 0)) }));
        rows.push(t("diameter", { value: t("kmUnit", { n: fmt(b.d) }) }));
        if (b.year) rows.push(t("orbitalPeriod", { value: durationLabel(b.year) }));
        rows.push(t("bodyDay", { value: durationLabel(b.day / 24) }));
        if (b.moons !== null && b.moons !== undefined) rows.push(t("moonsCount", { n: fmt(b.moons) }));
      } else if (selected.kind === "star") {
        rows.push(t("fromEarth", { value: distanceLabel(selected.dist) }));
      } else if (selected.kind === "galaxy") {
        const g = GALAXIES.find((x) => x.key === id);
        if (g) rows.push(t("fromEarth", { value: distanceLabel(Math.hypot(...g.xy)) }));
      } else if (id === "galacticCenter") {
        rows.push(t("fromEarth", { value: distanceLabel(Math.hypot(...GALACTIC_CENTER)) }));
      }
      const head = h("div", { class: "mf-solar-card-head" }, [h("h2", { text: name }), h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), onclick: closeCard }, [icon("close")])]);
      card.append(head, h("ul", { class: "mf-solar-facts" }, rows.map((r) => h("li", { text: r }))));
      const actions = h("div", { class: "mf-solar-card-actions" });
      if (id === "earth") actions.append(h("button", { type: "button", class: "mu-btn mu-btn-primary", onclick: () => close({ toEarth: true }) }, [icon("public"), h("span", { text: t("backToEarth") })]));
      else if (selected.kind === "body" && Space.canVisit(id)) actions.append(h("button", { type: "button", class: "mu-btn mu-btn-primary", onclick: () => visit(id) }, [icon("travel_explore"), h("span", { text: t("visitBody", { name }) })]));
      if (actions.children.length) card.append(actions);
      card.setAttribute("aria-label", name);
    }
    function visit(id) {
      close({ silent: true });
      Space.enterBody(id);
    }

    // Keyboard and screen reader access to every body.
    function paintList() {
      list.replaceChildren(...["sun", ...PLANETS, "moon"].map((id) => h("button", { type: "button", text: t(id), onclick: () => select({ id, kind: "body", x: 0, y: 0, r: 0 }) })));
    }

    /* -------------------------------------------- open / close */
    let lastFocus = null;
    function translate() {
      backBtn.querySelector(".mf-solar-back-label").textContent = t("backToEarth");
      zoomIn.setAttribute("aria-label", t("zoomIn"));
      zoomOut.setAttribute("aria-label", t("zoomOut"));
      speedBtns.forEach((b) => { const l = b.querySelector(".mf-solar-speed-label"); l.textContent = t(l.dataset.key); b.setAttribute("aria-label", l.textContent); });
      ui.querySelector(".mf-solar-speeds").setAttribute("aria-label", t("timeLive"));
      hint.querySelector(".mf-solar-hint-label").textContent = t("zoomToSpace");
      paintList();
    }
    function open({ focus = null } = {}) {
      if (isOpen) return;
      isOpen = true;
      lastFocus = document.activeElement;
      translate();
      overlay.style.setProperty("--mf-solar-stars", map.getContainer().style.getPropertyValue("--mf-stars"));
      overlay.hidden = false;
      ui.hidden = false;
      hint.hidden = true;
      document.body.classList.add("mf-solar-open");
      resize();
      const e = earthPos();
      center = [e[0], e[1]];
      scale = MIN_SCALE * 1.4;
      lastFrame = performance.now();
      if (focus && BODIES[focus] && focus !== "earth") {
        setTimeout(() => select({ id: focus, kind: "body", x: 0, y: 0, r: 0 }), 50);
      } else {
        // A short pull-back from Earth to the inner planets.
        flyTo([e[0] * 0.5, e[1] * 0.5], 2.2 / Math.min(W, H), 1600);
      }
      requestDraw();
      setTimeout(() => canvas.focus(), 60);
    }
    function close({ toEarth = false, silent = false } = {}) {
      if (!isOpen) return;
      isOpen = false;
      overlay.hidden = true;
      ui.hidden = true;
      card.hidden = true;
      selected = null;
      animating = null;
      document.body.classList.remove("mf-solar-open");
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (silent) return;
      if (toEarth) {
        if (Space.isMoon()) Space.exitMoon();
        map.jumpTo({ zoom: 0, pitch: 0 });
        map.easeTo({ zoom: 1.4, duration: 900 });
      }
      try { lastFocus?.focus?.(); } catch {}
    }
    backBtn.addEventListener("click", () => close({ toEarth: true }));
    speedBtns.forEach((b, i) => b.addEventListener("click", () => {
      speed = SPEEDS[i][3];
      if (speed === 1) simTime = Date.now();
      speedBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      lastFrame = performance.now();
      requestDraw();
    }));
    // Live time ticks once a second while the view is open.
    setInterval(() => { if (isOpen && speed === 1) requestDraw(); }, 1000);

    const PAN = { panUpBtn: [0, -1], panDownBtn: [0, 1], panLeftBtn: [-1, 0], panRightBtn: [1, 0] };
    document.addEventListener("click", (e) => {
      if (!isOpen) return;
      const btn = e.target.closest?.("#zoomInBtn, #zoomOutBtn, #panUpBtn, #panDownBtn, #panLeftBtn, #panRightBtn");
      if (!btn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      animating = null;
      if (btn.id === "zoomInBtn") zoomAt(0.5);
      else if (btn.id === "zoomOutBtn") zoomAt(2);
      else {
        const [dx, dy] = PAN[btn.id];
        if (selected) selected.follow = false;
        center = [center[0] + dx * W * 0.25 * scale, center[1] - dy * H * 0.25 * scale];
        requestDraw();
      }
    }, true);
    // A search result or saved place moves the map behind space: show it.
    map.on("movestart", (e) => { if (isOpen && !e.originalEvent) close(); });

    /* -------------------------------------------- entering from the map */
    const atGlobeLimit = () => map.getZoom() <= map.getMinZoom() + 0.25 && !Space.isMoon() && map.getProjection?.()?.type === "globe";
    let pull = 0;
    let pullTimer = 0;
    map.getContainer().addEventListener("wheel", (e) => {
      if (isOpen || e.deltaY <= 0 || !atGlobeLimit()) { pull = 0; return; }
      pull += e.deltaY;
      clearTimeout(pullTimer);
      pullTimer = setTimeout(() => { pull = 0; }, 600);
      if (pull > 240) { pull = 0; open(); }
    }, { passive: true });
    document.getElementById("zoomOutBtn")?.addEventListener("click", () => { if (atGlobeLimit()) open(); });
    let touchStart = 0;
    map.getContainer().addEventListener("touchmove", (e) => {
      if (e.touches.length !== 2 || isOpen || !atGlobeLimit()) { touchStart = 0; return; }
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (!touchStart) touchStart = d;
      else if (touchStart / d > 1.6) { touchStart = 0; open(); }
    }, { passive: true });
    map.getContainer().addEventListener("touchend", () => { touchStart = 0; }, { passive: true });
    // A hint appears when the whole Earth is in view.
    const paintHint = () => {
      const show = !isOpen && !Space.isMoon() && map.getProjection?.()?.type === "globe" && map.getZoom() < 1.2 && !document.body.classList.contains("mf-solar-open");
      hint.hidden = !show;
    };
    map.on("zoom", paintHint);
    map.on("style.load", () => setTimeout(paintHint, 60));
    document.addEventListener("keydown", (e) => { if (isOpen && e.key === "Escape" && !overlay.contains(e.target) && !ui.contains(e.target) && !e.target.closest?.(".mu-modal")) close({ toEarth: !Space.isMoon() }); });
    F.registerTool({ id: "mfToolSolar", iconName: "brightness_low", key: "solarSystem", sub: "solarSystemSub", run: () => { const tray = document.getElementById("toolsTray"); if (tray?.classList.contains("open")) document.getElementById("layerTools")?.click(); open(); } });
    document.addEventListener("click", (e) => { if (e.target.closest?.("[data-lang], .custom-dropdown-item")) setTimeout(() => { translate(); if (isOpen) requestDraw(); }, 120); });

    window.MunetiosSolar = {
      setView: (au) => { scale = au; center = [0, 0]; requestDraw(); },
      open,
      close,
      distanceText: (id) => { if (!BODIES[id]) return ""; const p = bodyPos(id), e = earthPos(); return t("fromEarth", { value: distanceLabel(Math.hypot(p[0] - e[0], p[1] - e[1], (p[2] || 0) - (e[2] || 0))) }); },
      position: (id, d = new Date()) => (id === "earth" || ELEMENTS[id] ? position(id, d) : null),
    };
    try { Space.paintBar?.(); } catch {}
    paintHint();
  }
  const ready = () => window.MapsFeatures && window.MunetiosSpace?.enterBody && window._mapsApi;
  const tryStart = () => { if (ready()) start(); };
  document.addEventListener("maps-features-ready", tryStart);
  document.addEventListener("maps-space-ready", tryStart);
  if (document.readyState !== "loading") tryStart();
  else document.addEventListener("DOMContentLoaded", () => setTimeout(tryStart, 0));
})();
