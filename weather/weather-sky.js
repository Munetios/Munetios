/*!
 * Ganetios Weather: animated outdoor sky.
 * Draws a sky lit by the real sun altitude, drifting volumetric-looking clouds,
 * rain, drizzle, snow, fog, lightning, stars, the moon at its true phase, and
 * layered hills with atmospheric perspective. Respects prefers-reduced-motion.
 */
(function () {
  "use strict";

  // Sky colors by sun altitude: [altitude, zenith, middle, horizon]
  const SKY = [
    [-90, "#03050d", "#060a1a", "#0a0f24"],
    [-18, "#04071a", "#0a1030", "#131a3c"],
    [-12, "#0a1236", "#1a2050", "#2f2c5c"],
    [-8, "#121c4c", "#2d2f6b", "#5a3f72"],
    [-4, "#1b2c66", "#4b4a8c", "#d46f6e"],
    [0, "#27488e", "#7c78b4", "#ff9a62"],
    [4, "#3363b4", "#86a3d6", "#ffc38a"],
    [10, "#2f6dcc", "#6fa3e6", "#d9e4ee"],
    [25, "#2a6ad6", "#5e9eec", "#bcdaf6"],
    [90, "#1f5fd0", "#4f93ea", "#a9d0f6"],
  ];

  const SCENES = {
    clear: { clouds: 1, cover: 0.05, dark: 0, rain: 0, snow: 0, fog: 0, storm: 0 },
    mostlyClear: { clouds: 4, cover: 0.12, dark: 0, rain: 0, snow: 0, fog: 0, storm: 0 },
    partly: { clouds: 9, cover: 0.3, dark: 0.05, rain: 0, snow: 0, fog: 0, storm: 0 },
    cloudy: { clouds: 16, cover: 0.6, dark: 0.18, rain: 0, snow: 0, fog: 0, storm: 0 },
    overcast: { clouds: 24, cover: 0.92, dark: 0.32, rain: 0, snow: 0, fog: 0.1, storm: 0 },
    fog: { clouds: 10, cover: 0.85, dark: 0.18, rain: 0, snow: 0, fog: 1, storm: 0 },
    drizzle: { clouds: 20, cover: 0.85, dark: 0.3, rain: 0.25, snow: 0, fog: 0.2, storm: 0 },
    rain: { clouds: 24, cover: 0.95, dark: 0.45, rain: 0.7, snow: 0, fog: 0.15, storm: 0 },
    heavyRain: { clouds: 26, cover: 1, dark: 0.58, rain: 1, snow: 0, fog: 0.25, storm: 0 },
    snow: { clouds: 22, cover: 0.92, dark: 0.22, rain: 0, snow: 0.7, fog: 0.2, storm: 0 },
    sleet: { clouds: 22, cover: 0.92, dark: 0.32, rain: 0.4, snow: 0.35, fog: 0.15, storm: 0 },
    storm: { clouds: 26, cover: 1, dark: 0.7, rain: 0.9, snow: 0, fog: 0.1, storm: 1 },
  };

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const luma = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  function skyColors(alt) {
    let i = 0;
    while (i < SKY.length - 2 && alt > SKY[i + 1][0]) i++;
    const a = SKY[i];
    const b = SKY[i + 1];
    const f = clamp((alt - a[0]) / (b[0] - a[0]), 0, 1);
    return [1, 2, 3].map((k) => mix(hex(a[k]), hex(b[k]), f));
  }

  // Seeded random so the landscape and stars stay put between frames.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Sky {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.state = { scene: "clear", altitude: 30, dayProgress: 0.5, moonPhase: 0.5, moonIllumination: 0.5, moonAltitude: 30, southern: false, wind: 10, cloudCover: null };
      this.reduced = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
      this.clouds = [];
      this.drops = [];
      this.flakes = [];
      this.stars = [];
      this.flash = 0;
      this.nextFlash = 3;
      this.bolt = null;
      this.time = 0;
      this.last = 0;
      this.visible = true;
      this.still = false;
      this.running = false;
      this.spriteKey = "";
      this.resize = this.resize.bind(this);
      this.frame = this.frame.bind(this);
      this.ro = new ResizeObserver(this.resize);
      this.ro.observe(canvas);
      if ("IntersectionObserver" in window) {
        this.io = new IntersectionObserver((entries) => { this.visible = entries[0].isIntersecting; if (this.visible) this.start(); });
        this.io.observe(canvas);
      }
      document.addEventListener("visibilitychange", () => { if (!document.hidden) this.start(); });
      this.reduced.addEventListener?.("change", () => this.start());
      this.resize();
    }

    set(next) {
      const prevScene = this.state.scene;
      Object.assign(this.state, next);
      if (!SCENES[this.state.scene]) this.state.scene = "clear";
      if (prevScene !== this.state.scene) this.populate();
      this.spriteKey = "";
      this.start();
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.makeStars();
      this.makeHills();
      this.populate();
      this.spriteKey = "";
      this.draw(0);
      this.start();
    }

    makeStars() {
      const r = rng(7);
      const n = Math.round((this.w * this.h) / 2200);
      this.stars = Array.from({ length: n }, () => ({ x: r() * this.w, y: r() * this.h * 0.75, s: r() * 1.3 + 0.3, p: r() * Math.PI * 2, k: 0.6 + r() * 2.2 }));
    }

    makeHills() {
      const r = rng(19);
      const layers = [];
      for (let l = 0; l < 3; l++) {
        const base = this.h * (0.78 + l * 0.07);
        const amp = this.h * (0.07 - l * 0.015);
        const pts = [];
        const f1 = 1.5 + r() * 2;
        const f2 = 4 + r() * 4;
        const o1 = r() * 10;
        const o2 = r() * 10;
        for (let x = 0; x <= this.w + 8; x += 8) {
          const u = x / this.w;
          pts.push([x, base - amp * (0.6 * Math.sin(u * f1 * Math.PI + o1) + 0.3 * Math.sin(u * f2 * Math.PI + o2) + 0.1 * Math.sin(u * 23 + o1))]);
        }
        // A few tree silhouettes on the nearest ridge.
        const trees = [];
        if (l === 2) {
          for (let i = 0; i < this.w / 26; i++) {
            const x = r() * this.w;
            const idx = Math.min(pts.length - 1, Math.round(x / 8));
            trees.push({ x, y: pts[idx][1] + 2, h: 10 + r() * 22 });
          }
        }
        layers.push({ pts, trees });
      }
      this.hills = layers;
    }

    populate() {
      const sc = SCENES[this.state.scene];
      const r = rng(Math.round(performance.now()) || 1);
      const n = Math.round(sc.clouds * Math.max(0.6, this.w / 900));
      this.clouds = Array.from({ length: n }, (_, i) => this.newCloud(r, i / Math.max(1, n), true));
      const area = (this.w * this.h) / 420000;
      this.drops = Array.from({ length: Math.round(sc.rain * 420 * area) }, () => this.newDrop(true));
      this.flakes = Array.from({ length: Math.round(sc.snow * 300 * area) }, () => this.newFlake(true));
    }

    newCloud(r, t, scatter) {
      const sc = SCENES[this.state.scene];
      const layer = r() < 0.35 ? 0 : r() < 0.6 ? 1 : 2;
      const scale = (0.55 + r() * 0.8) * (layer === 0 ? 0.6 : layer === 1 ? 0.9 : 1.25) * (0.7 + sc.cover * 0.6);
      return {
        x: scatter ? r() * (this.w + 400) - 200 : -380 * scale,
        y: this.h * (0.06 + r() * (0.45 + sc.cover * 0.1)) + layer * 18,
        scale, layer, variant: Math.floor(r() * 4), alpha: 0.75 + r() * 0.25,
      };
    }
    newDrop(scatter) {
      const sc = SCENES[this.state.scene];
      return { x: Math.random() * (this.w + 200) - 100, y: scatter ? Math.random() * this.h : -20, v: (sc.rain > 0.5 ? 900 : 600) + Math.random() * 400, l: (sc.rain > 0.5 ? 16 : 9) + Math.random() * 12, a: 0.25 + Math.random() * 0.4 };
    }
    newFlake(scatter) {
      return { x: Math.random() * this.w, y: scatter ? Math.random() * this.h : -10, v: 30 + Math.random() * 60, r: 1 + Math.random() * 2.6, p: Math.random() * Math.PI * 2, a: 0.5 + Math.random() * 0.5 };
    }

    // Pre-render cloud sprites in the current light so frames stay cheap.
    sprites(light, shade) {
      const key = light.map((v) => v | 0).join() + shade.map((v) => v | 0).join();
      if (key === this.spriteKey && this.cloudSprites) return this.cloudSprites;
      this.spriteKey = key;
      this.cloudSprites = [0, 1, 2, 3].map((v) => {
        const r = rng(101 + v * 17);
        const W = 420;
        const Hh = 200;
        const PAD = 6;
        const c = document.createElement("canvas");
        c.width = W;
        c.height = Hh;
        const g = c.getContext("2d");
        const puffs = [];
        const count = 26 + Math.floor(r() * 14);
        for (let i = 0; i < count; i++) {
          const u = r();
          const px = 60 + u * (W - 120);
          const hump = Math.sin(u * Math.PI);
          // Keep every puff (and its shaded base) inside the sprite so edges stay soft.
          const pr = Math.min(26 + r() * 46 * (0.5 + hump), (Hh - 2 * PAD) / 2.4);
          const py = clamp(Hh * 0.62 - hump * (24 + r() * 30) - r() * 14, pr + PAD, Hh - pr * 1.2 - PAD);
          puffs.push([clamp(px, pr + PAD, W - pr - PAD), py, pr]);
        }
        // Shadowed base first, then lit tops offset upward, for depth.
        puffs.forEach(([x, y, pr]) => {
          const gr = g.createRadialGradient(x, y + pr * 0.2, pr * 0.1, x, y + pr * 0.2, pr);
          gr.addColorStop(0, rgb(shade, 0.9));
          gr.addColorStop(0.65, rgb(shade, 0.55));
          gr.addColorStop(1, rgb(shade, 0));
          g.fillStyle = gr;
          g.beginPath();
          g.arc(x, y + pr * 0.2, pr, 0, Math.PI * 2);
          g.fill();
        });
        puffs.forEach(([x, y, pr]) => {
          const gr = g.createRadialGradient(x - pr * 0.2, y - pr * 0.35, pr * 0.05, x, y - pr * 0.1, pr * 0.9);
          gr.addColorStop(0, rgb(light, 0.95));
          gr.addColorStop(0.55, rgb(light, 0.5));
          gr.addColorStop(1, rgb(light, 0));
          g.fillStyle = gr;
          g.beginPath();
          g.arc(x, y - pr * 0.1, pr * 0.9, 0, Math.PI * 2);
          g.fill();
        });
        return c;
      });
      return this.cloudSprites;
    }

    start() {
      if (this.running) return;
      if (this.reduced.matches || this.still || !this.visible || document.hidden) { this.draw(0); return; }
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }

    frame(now) {
      if (this.reduced.matches || this.still || !this.visible || document.hidden) { this.running = false; return; }
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.draw(dt);
      requestAnimationFrame(this.frame);
    }

    draw(dt) {
      const { ctx, w, h } = this;
      if (!w || !h) return;
      this.time += dt;
      const st = this.state;
      const sc = SCENES[st.scene];
      const alt = st.altitude;
      const [zen, mid, hor] = skyColors(alt);
      // Clouds wash the sky toward gray, darker for heavy cloud.
      const bright = clamp((alt + 10) / 30, 0, 1);
      const gray = mix([20, 22, 30], [150, 158, 170], bright);
      const wash = sc.cover * 0.85;
      const darken = 1 - sc.dark * 0.55;
      const z = mix(zen, gray, wash).map((v) => v * darken);
      const m = mix(mid, gray, wash * 0.9).map((v) => v * darken);
      const ho = mix(hor, mix(gray, [200, 205, 212], bright * 0.5), wash * 0.8).map((v) => v * darken);

      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.85);
      sky.addColorStop(0, rgb(z));
      sky.addColorStop(0.55, rgb(m));
      sky.addColorStop(1, rgb(ho));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Sun position on screen: horizontal by progress through the day, vertical by altitude.
      const sx = w * (0.06 + 0.88 * clamp(st.dayProgress, -0.1, 1.1));
      const horizonY = h * 0.8;
      const sy = horizonY - clamp(alt / 60, -0.3, 1) * horizonY * 0.9;
      const night = clamp((-alt - 4) / 10, 0, 1);

      // Stars
      if (night > 0) {
        const visible = night * (1 - sc.cover);
        if (visible > 0.02) {
          this.stars.forEach((s) => {
            const tw = 0.65 + 0.35 * Math.sin(this.time * s.k + s.p);
            ctx.fillStyle = `rgba(255,255,255,${(visible * tw * (0.4 + s.s / 2)).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }

      // Sun glow and disc
      if (alt > -10) {
        const vis = (1 - sc.cover * 0.85) * clamp((alt + 10) / 10, 0, 1);
        const warm = clamp(1 - alt / 15, 0, 1);
        const glowC = mix([255, 250, 230], [255, 150, 80], warm);
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.55);
        glow.addColorStop(0, rgb(glowC, 0.55 * vis + 0.08 * (1 - sc.cover)));
        glow.addColorStop(0.15, rgb(glowC, 0.22 * vis));
        glow.addColorStop(1, rgb(glowC, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        if (alt > -1 && vis > 0.05 && sc.cover < 0.7) {
          ctx.fillStyle = rgb(mix([255, 252, 240], [255, 190, 120], warm), clamp(vis * 1.2, 0, 1));
          ctx.beginPath();
          ctx.arc(sx, sy, 22, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Moon
      if (night > 0.05 && st.moonAltitude > -2) {
        const mx = w * 0.72;
        const my = h * (0.18 + 0.25 * (1 - clamp(st.moonAltitude / 60, 0, 1)));
        const vis = night * (1 - sc.cover * 0.8);
        const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 140);
        mg.addColorStop(0, `rgba(220,225,255,${(0.25 * vis * (0.3 + (st.moonIllumination ?? 0.5))).toFixed(3)})`);
        mg.addColorStop(1, "rgba(220,225,255,0)");
        ctx.fillStyle = mg;
        ctx.fillRect(mx - 140, my - 140, 280, 280);
        this.drawMoon(mx, my, 18, st.moonPhase, st.southern, vis);
      }

      // Clouds: light color follows the sun, warmer near the horizon.
      const warmth = clamp(1 - Math.abs(alt) / 12, 0, 1) * (1 - sc.dark);
      const dayLight = mix([40, 44, 62], [255, 255, 255], bright);
      const light = mix(mix(dayLight, [255, 186, 150], warmth * 0.6), [120, 124, 134], sc.dark * 0.8);
      const shade = mix(light.map((v) => v * 0.68), [70, 74, 86], sc.dark * 0.7).map((v) => v * (0.75 + 0.25 * bright));
      const sprites = this.sprites(light, shade);
      const speed = 6 + (st.wind || 8) * 0.9;
      [0, 1, 2].forEach((layer) => {
        this.clouds.forEach((c, i) => {
          if (c.layer !== layer) return;
          c.x += dt * speed * (0.4 + layer * 0.45);
          const cw = 420 * c.scale;
          if (c.x > w + 40) this.clouds[i] = this.newCloud(Math.random, 0, false);
          ctx.globalAlpha = c.alpha * (0.6 + sc.cover * 0.4);
          ctx.drawImage(sprites[c.variant], c.x, c.y, cw, 200 * c.scale);
        });
      });
      ctx.globalAlpha = 1;
      // Overcast deck: a soft uniform layer on top.
      if (sc.cover > 0.55) {
        const deck = ctx.createLinearGradient(0, 0, 0, h * 0.7);
        deck.addColorStop(0, rgb(shade, (sc.cover - 0.5) * 0.9));
        deck.addColorStop(1, rgb(shade, 0));
        ctx.fillStyle = deck;
        ctx.fillRect(0, 0, w, h * 0.7);
      }

      // Lightning
      if (sc.storm) {
        this.nextFlash -= dt;
        if (this.nextFlash <= 0) {
          this.flash = 1;
          this.nextFlash = 2.5 + Math.random() * 6;
          this.bolt = this.makeBolt();
        }
        if (this.flash > 0) {
          ctx.fillStyle = `rgba(220,225,255,${(this.flash * 0.45).toFixed(3)})`;
          ctx.fillRect(0, 0, w, h);
          if (this.bolt && this.flash > 0.4) {
            ctx.strokeStyle = `rgba(255,255,255,${this.flash.toFixed(3)})`;
            ctx.lineWidth = 2;
            ctx.shadowColor = "rgba(190,200,255,0.9)";
            ctx.shadowBlur = 12;
            ctx.beginPath();
            this.bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          this.flash = Math.max(0, this.flash - dt * (dt ? 2.6 : 1));
        }
      }

      // Hills with atmospheric perspective
      const groundBase = st.scene === "snow" ? [228, 234, 244] : [34, 58, 44];
      const groundLit = mix(groundBase.map((v) => v * 0.12), groundBase, bright).map((v) => v * darken);
      this.hills.forEach((layer, i) => {
        const haze = [0.62, 0.38, 0.12][i];
        const col = mix(groundLit, ho, haze + sc.fog * 0.3 * (2 - i) / 2);
        ctx.fillStyle = rgb(col);
        ctx.beginPath();
        ctx.moveTo(0, h);
        layer.pts.forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
        layer.trees.forEach((t) => {
          ctx.beginPath();
          ctx.moveTo(t.x, t.y - t.h);
          ctx.lineTo(t.x - t.h * 0.28, t.y);
          ctx.lineTo(t.x + t.h * 0.28, t.y);
          ctx.closePath();
          ctx.fill();
        });
      });

      // Fog bands
      if (sc.fog > 0) {
        for (let i = 0; i < 4; i++) {
          const y = h * (0.55 + i * 0.1);
          const off = Math.sin(this.time * 0.05 + i) * 40;
          const fg = ctx.createLinearGradient(0, y - 60, 0, y + 60);
          const fc = mix(ho, [200, 205, 215], 0.5 * bright);
          fg.addColorStop(0, rgb(fc, 0));
          fg.addColorStop(0.5, rgb(fc, 0.32 * sc.fog));
          fg.addColorStop(1, rgb(fc, 0));
          ctx.fillStyle = fg;
          ctx.fillRect(off - 60, y - 60, w + 120, 120);
        }
        ctx.fillStyle = rgb(mix(ho, [210, 214, 222], 0.4), 0.22 * sc.fog);
        ctx.fillRect(0, 0, w, h);
      }

      // Rain
      if (this.drops.length) {
        const slant = (st.wind || 8) * 0.012;
        ctx.strokeStyle = rgb(mix([180, 195, 220], [235, 240, 255], bright), 1);
        ctx.lineWidth = 1.2;
        ctx.lineCap = "round";
        this.drops.forEach((d, i) => {
          d.y += d.v * dt;
          d.x += d.v * slant * dt;
          if (d.y > h) this.drops[i] = this.newDrop(false);
          ctx.globalAlpha = d.a;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.l * slant, d.y - d.l);
          ctx.stroke();
        });
        ctx.globalAlpha = 1;
      }

      // Snow
      if (this.flakes.length) {
        ctx.fillStyle = "#ffffff";
        this.flakes.forEach((f, i) => {
          f.y += f.v * dt;
          f.p += dt * 1.4;
          f.x += Math.sin(f.p) * 18 * dt + (st.wind || 5) * 0.4 * dt;
          if (f.y > h) this.flakes[i] = this.newFlake(false);
          ctx.globalAlpha = f.a;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }

      // Gentle vignette for depth and text legibility.
      const vg = ctx.createLinearGradient(0, 0, 0, h);
      vg.addColorStop(0, "rgba(0,0,0,0.12)");
      vg.addColorStop(0.5, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      this.skyLuma = luma(m);
    }

    drawMoon(x, y, r, phase, southern, alpha) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillStyle = "rgba(40,44,70,0.85)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y);
      if (southern) ctx.scale(-1, 1);
      const k = Math.cos(2 * Math.PI * phase);
      const rx = Math.abs(k) * r;
      const waxing = phase < 0.5;
      ctx.fillStyle = "#f3f1e6";
      ctx.shadowColor = "rgba(240,240,255,0.7)";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      if (waxing) {
        ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
        ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, phase >= 0.25);
      } else {
        ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, true);
        ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, phase < 0.75);
      }
      ctx.fill();
      ctx.restore();
    }

    makeBolt() {
      const pts = [];
      let x = this.w * (0.2 + Math.random() * 0.6);
      let y = this.h * 0.12;
      pts.push([x, y]);
      while (y < this.h * 0.78) {
        x += (Math.random() - 0.5) * 40;
        y += 14 + Math.random() * 24;
        pts.push([x, y]);
      }
      return pts;
    }
  }

  /** Map a WMO weather code (Open-Meteo) to a sky scene. */
  function sceneForCode(code) {
    if (code === 0) return "clear";
    if (code === 1) return "mostlyClear";
    if (code === 2) return "partly";
    if (code === 3) return "overcast";
    if (code === 45 || code === 48) return "fog";
    if (code >= 51 && code <= 55) return "drizzle";
    if (code === 56 || code === 57 || code === 66 || code === 67) return "sleet";
    if (code === 61 || code === 80) return "rain";
    if (code === 63 || code === 81) return "rain";
    if (code === 65 || code === 82) return "heavyRain";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 95) return "storm";
    return "cloudy";
  }

  window.GanetiosSky = Object.freeze({ Sky, SCENES: Object.keys(SCENES), sceneForCode });
})();
