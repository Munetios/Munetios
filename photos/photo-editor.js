/*!
 * Munetios Photos editor.
 *  - Adjust: brightness, contrast, saturation, warmth, tint, sharpen, grain, fade, blur, vignette, sepia
 *  - Color: hue shift, color pop, color tint, duotone
 *  - Filters, crop and rotate, flip
 *  - Paint: pen and marker with any color, size, and opacity
 *  - AI erase: paint over objects and remove them with an open-source model that runs on this device
 *  - Undo and redo, hold to compare with the original
 *
 * MunetiosPhotoEditor.open({ blob, name, type, thumb, t, notify, confirm, pickColor, onSave(blob, { copy }) })
 * Requires munetios-ui-v4.js. AI erase uses ai-eraser.js.
 */
(() => {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const PRESETS = {
    none: {}, vivid: { saturation: 140, contrast: 115 }, mono: { saturation: 0, contrast: 110 }, sepia: { sepia: 80, warmth: 15 },
    cool: { warmth: -30, saturation: 110 }, warm: { warmth: 30, brightness: 104 }, fade: { contrast: 88, fade: 35, saturation: 85 },
    dramatic: { contrast: 135, brightness: 92, vignette: 45 }, noir: { saturation: 0, contrast: 145, brightness: 90, vignette: 35, grain: 20 },
    golden: { warmth: 45, saturation: 115, brightness: 104, tint: 8 }, teal: { duoOn: false, hue: -8, warmth: 18, tint: -20, contrast: 112, saturation: 120 },
  };
  const ADJUST = [["brightness", 0, 200, 100], ["contrast", 0, 200, 100], ["saturation", 0, 200, 100], ["warmth", -100, 100, 0], ["tint", -100, 100, 0],
    ["sharpen", 0, 100, 0], ["grain", 0, 100, 0], ["fade", 0, 100, 0], ["sepia", 0, 100, 0], ["blur", 0, 20, 0], ["vignette", 0, 100, 0]];
  const BRUSH_COLORS = ["#ffffff", "#000000", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#ec407a"];
  const defaults = () => ({
    ...Object.fromEntries(ADJUST.map(([k, , , v]) => [k, v])), hue: 0, tintColor: "#ff8a00", tintAmount: 0,
    popOn: false, popHue: null, popRange: 30, duoOn: false, duoDark: "#1b1464", duoLight: "#ffd166",
    rotate: 0, flipH: false, flipV: false, crop: null, ratio: "free", preset: "none",
  });

  const loadImage = (blob) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
  const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hueOf = (r, g, b) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return -1;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  // Stable noise, so grain looks the same in the preview and the saved photo.
  const noise = (i) => { let x = (i * 374761393) ^ 0x5bd1e995; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967295 - 0.5; };

  async function open(options) {
    const { t, notify } = options;
    const UI = window.MunetiosUI;
    const original = await loadImage(options.blob);
    const base = Object.assign(document.createElement("canvas"), { width: original.naturalWidth, height: original.naturalHeight });
    const bctx = base.getContext("2d", { willReadFrequently: true });
    bctx.drawImage(original, 0, 0);
    let state = defaults();
    let mode = "adjust";
    let comparing = false;
    let pickingPop = false;
    const brush = { color: "#e53935", size: 24, opacity: 100, kind: "pen" };
    const eraseBrush = { size: 40 };
    let maskStrokes = [];
    const history = [];
    let historyIndex = -1;

    /* ---------------------------------------------------------- markup */
    const slider = (key, min, max, value) => `<div class="mu-slider"><label class="mu-slider-head" for="ed-${key}"><span>${esc(t("adjust_" + key))}</span><output class="mu-slider-value" for="ed-${key}">${value}</output></label><input id="ed-${key}" class="mu-range" type="range" min="${min}" max="${max}" value="${value}" data-adjust="${key}"></div>`;
    const colorButton = (key, value, label) => `<button type="button" class="mu-picker-field ph-color-field" data-color-key="${key}"><span class="mu-picker-swatch" style="background:${value}" aria-hidden="true"></span><span class="mu-picker-value">${esc(label)}</span></button>`;
    const el = document.createElement("div");
    el.className = "ph-editor";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", t("editPhoto"));
    el.innerHTML = `<header class="ph-viewer-bar mu-glass mu-glass-solid">
        <button type="button" class="mu-icon-btn" data-ed="cancel" aria-label="${esc(t("cancel"))}" title="${esc(t("cancel"))}"><span class="mu-icon" aria-hidden="true">close</span></button>
        <span class="ph-viewer-title">${esc(t("editPhoto"))}</span>
        <div class="ph-viewer-tools">
          <button type="button" class="mu-icon-btn" data-ed="undo" aria-label="${esc(t("undo"))}" title="${esc(t("undo"))} (Ctrl+Z)" disabled><span class="mu-icon" aria-hidden="true">undo</span></button>
          <button type="button" class="mu-icon-btn" data-ed="redo" aria-label="${esc(t("redo"))}" title="${esc(t("redo"))} (Ctrl+Shift+Z)" disabled><span class="mu-icon" aria-hidden="true">redo</span></button>
          <button type="button" class="mu-icon-btn" data-ed="compare" aria-label="${esc(t("holdToCompare"))}" title="${esc(t("holdToCompare"))}"><span class="mu-icon" aria-hidden="true">compare</span></button>
          <span class="mu-divider-v" aria-hidden="true"></span>
          <button type="button" class="mu-btn mu-btn-ghost" data-ed="reset">${esc(t("reset"))}</button>
          <button type="button" class="mu-btn" data-ed="copy">${esc(t("saveAsCopy"))}</button>
          <button type="button" class="mu-btn mu-btn-primary" data-ed="save"><span class="mu-icon" aria-hidden="true">check</span>${esc(t("save"))}</button>
        </div></header>
      <div class="ph-editor-body"><div class="ph-editor-stage"><div class="ph-editor-canvas-wrap">
          <canvas class="ph-editor-canvas"></canvas>
          <canvas class="ph-editor-overlay" hidden></canvas>
          <div class="ph-crop" hidden><span data-h="nw"></span><span data-h="ne"></span><span data-h="sw"></span><span data-h="se"></span></div>
        </div></div>
        <aside class="ph-editor-panel mu-glass mu-scroll">
          <div class="mu-tabs ph-editor-tabs" role="tablist">
            ${[["adjust", "tune"], ["color", "palette"], ["filters", "auto_awesome"], ["crop", "crop_rotate"], ["paint", "brush"], ["erase", "ink_eraser"]].map(([id, icon], i) => `<button type="button" role="tab" data-mu-tab="${id}" aria-selected="${i === 0}"><span class="mu-icon" aria-hidden="true">${icon}</span>${esc(t({ adjust: "adjust", color: "tabColor", filters: "filters", crop: "cropRotate", paint: "tabPaint", erase: "tabErase" }[id]))}</button>`).join("")}
          </div>
          <div data-mu-panel="adjust" class="ph-editor-section">${ADJUST.map(([k, min, max, v]) => slider(k, min, max, v)).join("")}</div>
          <div data-mu-panel="color" class="ph-editor-section" hidden>
            ${slider("hue", -180, 180, 0)}
            <div class="ph-tool-group"><span class="mu-field-label">${esc(t("tintColor"))}</span><div class="ph-editor-row">${colorButton("tintColor", state.tintColor, state.tintColor.toUpperCase())}</div>${slider("tintAmount", 0, 100, 0)}</div>
            <div class="ph-tool-group">
              <div class="mu-row ph-plain-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("colorPop"))}</span><span class="mu-row-subtitle">${esc(t("colorPopHelp"))}</span></div><label class="mu-switch"><input type="checkbox" data-toggle="popOn" aria-label="${esc(t("colorPop"))}"><span class="mu-switch-track"></span></label></div>
              <div class="ph-editor-row"><button type="button" class="mu-btn" data-ed="pick-pop"><span class="mu-icon" aria-hidden="true">colorize</span>${esc(t("pickColorFromPhoto"))}</button><span class="ph-pop-swatch" aria-hidden="true"></span></div>
              ${slider("popRange", 5, 90, 30)}
            </div>
            <div class="ph-tool-group">
              <div class="mu-row ph-plain-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("duotone"))}</span></div><label class="mu-switch"><input type="checkbox" data-toggle="duoOn" aria-label="${esc(t("duotone"))}"><span class="mu-switch-track"></span></label></div>
              <div class="ph-editor-row">${colorButton("duoDark", state.duoDark, t("duotoneShadows"))}${colorButton("duoLight", state.duoLight, t("duotoneHighlights"))}</div>
            </div>
          </div>
          <div data-mu-panel="filters" class="ph-editor-section" hidden><div class="ph-filter-grid">${Object.keys(PRESETS).map((f) => `<button type="button" class="mu-option-tile ph-filter-tile" data-preset="${f}" aria-pressed="${f === "none"}"><span class="ph-filter-preview" data-preview="${f}"></span><span>${esc(t("filter_" + f + "Preset"))}</span></button>`).join("")}</div></div>
          <div data-mu-panel="crop" class="ph-editor-section" hidden>
            <div class="mu-field"><span class="mu-field-label">${esc(t("aspectRatio"))}</span><div class="ph-chip-row">${["free", "1:1", "4:5", "4:3", "3:2", "16:9", "9:16"].map((r) => `<button type="button" class="mu-chip" data-ratio="${r}" aria-pressed="${r === "free"}">${esc(r === "free" ? t("ratioFree") : r)}</button>`).join("")}</div></div>
            <div class="ph-editor-row"><button type="button" class="mu-btn" data-ed="rotate"><span class="mu-icon" aria-hidden="true">rotate_right</span>${esc(t("rotate"))}</button><button type="button" class="mu-btn" data-ed="flipH"><span class="mu-icon" aria-hidden="true">flip</span>${esc(t("flipHorizontal"))}</button><button type="button" class="mu-btn" data-ed="flipV"><span class="mu-icon" aria-hidden="true">flip</span>${esc(t("flipVertical"))}</button></div>
          </div>
          <div data-mu-panel="paint" class="ph-editor-section" hidden>
            <div class="mu-field"><span class="mu-field-label">${esc(t("brushMode"))}</span><div class="mu-segmented" role="group" aria-label="${esc(t("brushMode"))}"><button type="button" data-brush-kind="pen" aria-pressed="true"><span class="mu-icon" aria-hidden="true">edit</span>${esc(t("modePen"))}</button><button type="button" data-brush-kind="marker" aria-pressed="false"><span class="mu-icon" aria-hidden="true">ink_highlighter</span>${esc(t("modeMarker"))}</button></div></div>
            <div class="mu-field"><span class="mu-field-label">${esc(t("brushColor"))}</span><div class="mu-swatches ph-brush-colors" role="group" aria-label="${esc(t("brushColor"))}">${BRUSH_COLORS.map((c) => `<button type="button" class="mu-swatch" style="background:${c}" data-brush-color="${c}" aria-pressed="${c === brush.color}" aria-label="${c}"></button>`).join("")}<button type="button" class="mu-swatch ph-swatch-custom" data-brush-color="custom" aria-pressed="false" aria-label="${esc(t("customColor"))}"><span class="mu-icon" aria-hidden="true">colorize</span></button></div></div>
            ${slider("brushSize", 2, 200, brush.size)}${slider("brushOpacity", 5, 100, brush.opacity)}
            <p class="mu-muted ph-tool-hint">${esc(t("paintHelp"))}</p>
          </div>
          <div data-mu-panel="erase" class="ph-editor-section" hidden>
            <p class="ph-tool-hint">${esc(t("eraseHelp"))}</p>
            ${slider("eraseSize", 8, 240, eraseBrush.size)}
            <div class="ph-editor-row"><button type="button" class="mu-btn mu-btn-primary" data-ed="erase"><span class="mu-icon" aria-hidden="true">auto_fix_high</span>${esc(t("eraseRun"))}</button><button type="button" class="mu-btn" data-ed="clear-mask"><span class="mu-icon" aria-hidden="true">layers_clear</span>${esc(t("clearMask"))}</button></div>
            <div class="ph-tool-status" role="status" aria-live="polite" hidden><span class="ph-tool-status-text"></span><div class="mu-progress" aria-hidden="true"><span style="width:0%"></span></div></div>
            <p class="mu-muted ph-tool-hint">${esc(t("aiPrivacyNote"))}</p>
          </div>
        </aside></div>`;
    document.body.appendChild(el);
    document.body.classList.add("ph-viewer-open");
    const q = (s) => el.querySelector(s);
    const canvas = q(".ph-editor-canvas"), overlay = q(".ph-editor-overlay"), cropEl = q(".ph-crop");
    // Sliders that belong to tools, not to the photo's look.
    for (const id of ["hue", "tintAmount", "popRange", "brushSize", "brushOpacity", "eraseSize"]) {
      const input = q(`#ed-${id}`);
      if (input) input.closest(".mu-slider").querySelector("span").textContent = t({ hue: "adjust_hue", tintAmount: "tintAmount", popRange: "colorPopRange", brushSize: "brushSize", brushOpacity: "brushOpacity", eraseSize: "brushSize" }[id]);
    }

    /* ---------------------------------------------------------- rendering */
    const oriented = () => (state.rotate % 180 ? [base.height, base.width] : [base.width, base.height]);
    const drawingMode = () => mode === "paint" || mode === "erase";
    function pixelPass(c, w, h, s) {
      if (!(s.popOn && s.popHue !== null) && !s.duoOn && !s.grain && !s.sharpen) return;
      const image = c.getImageData(0, 0, w, h);
      const d = image.data;
      if (s.sharpen) {
        const src = new Uint8ClampedArray(d), amount = s.sharpen / 60;
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = (y * w + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const blurred = (src[i - 4 + ch] + src[i + 4 + ch] + src[i - w * 4 + ch] + src[i + w * 4 + ch]) / 4;
            d[i + ch] = src[i + ch] + (src[i + ch] - blurred) * amount;
          }
        }
      }
      const [dr, dg, db] = hexRgb(s.duoDark), [lr, lg, lb] = hexRgb(s.duoLight);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        let r = d[i], g = d[i + 1], b = d[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (s.popOn && s.popHue !== null) {
          const hue = hueOf(r, g, b);
          const dist = hue < 0 ? 180 : Math.min(Math.abs(hue - s.popHue), 360 - Math.abs(hue - s.popHue));
          const keep = Math.max(0, Math.min(1, (s.popRange + 10 - dist) / 20));
          r = lum + (r - lum) * keep; g = lum + (g - lum) * keep; b = lum + (b - lum) * keep;
        }
        if (s.duoOn) { const k = lum / 255; r = dr + (lr - dr) * k; g = dg + (lg - dg) * k; b = db + (lb - db) * k; }
        if (s.grain) { const n = noise(p) * s.grain * 0.9; r += n; g += n; b += n; }
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      c.putImageData(image, 0, 0);
    }
    // Draws the photo with every setting. neutral: no crop, rotation, or flip (used while painting).
    function render(target, scale, { neutral = false, source = base, plain = false } = {}) {
      const s = plain ? defaults() : state;
      const [w, h] = neutral ? [source.width, source.height] : oriented();
      const crop = neutral || plain ? { x: 0, y: 0, w: 1, h: 1 } : (s.crop || { x: 0, y: 0, w: 1, h: 1 });
      target.width = Math.max(1, Math.round(w * crop.w * scale));
      target.height = Math.max(1, Math.round(h * crop.h * scale));
      const c = target.getContext("2d", { willReadFrequently: true });
      c.save();
      c.filter = `brightness(${s.brightness}%) contrast(${s.contrast}%) saturate(${s.saturation}%) sepia(${s.sepia}%) hue-rotate(${s.hue}deg) blur(${s.blur * scale}px)`;
      c.translate(-crop.x * w * scale, -crop.y * h * scale);
      c.translate((w * scale) / 2, (h * scale) / 2);
      if (!neutral) { c.rotate((s.rotate * Math.PI) / 180); c.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1); }
      c.drawImage(source, (-source.width * scale) / 2, (-source.height * scale) / 2, source.width * scale, source.height * scale);
      c.restore();
      const W = target.width, H = target.height;
      const overlayFill = (op, color) => { c.save(); c.globalCompositeOperation = op; c.fillStyle = color; c.fillRect(0, 0, W, H); c.restore(); };
      if (s.warmth) overlayFill("soft-light", s.warmth > 0 ? `rgba(255,140,0,${s.warmth / 220})` : `rgba(0,120,255,${-s.warmth / 220})`);
      if (s.tint) overlayFill("soft-light", s.tint > 0 ? `rgba(255,0,200,${s.tint / 260})` : `rgba(0,200,60,${-s.tint / 260})`);
      if (s.tintAmount) { const [r, g, b] = hexRgb(s.tintColor); overlayFill("color", `rgba(${r},${g},${b},${s.tintAmount / 200})`); }
      if (s.fade) overlayFill("lighten", `rgba(60,60,60,${s.fade / 200})`);
      if (s.vignette) { const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${s.vignette / 110})`); c.fillStyle = g; c.fillRect(0, 0, W, H); }
      pixelPass(c, W, H, s);
    }
    let frame = 0;
    function draw() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const stage = q(".ph-editor-stage");
        const neutral = drawingMode();
        const [w, h] = neutral ? [base.width, base.height] : oriented();
        const crop = neutral ? null : state.crop;
        const scale = Math.min(1, (stage.clientWidth - 32) / (w * (crop?.w || 1)), (stage.clientHeight - 32) / (h * (crop?.h || 1)));
        if (comparing) render(canvas, scale, { source: original, neutral: true, plain: true });
        else if (mode === "crop") { const saved = state.crop; state.crop = null; render(canvas, Math.min(1, (stage.clientWidth - 32) / oriented()[0], (stage.clientHeight - 32) / oriented()[1])); state.crop = saved; positionCrop(); }
        else render(canvas, scale, { neutral: drawingMode() });
        overlay.width = canvas.width; overlay.height = canvas.height;
        overlay.style.width = canvas.style.width; overlay.style.height = canvas.style.height;
        drawOverlay();
      });
    }

    /* ---------------------------------------------------------- history (destructive edits: paint and AI erase) */
    const snapshot = () => new Promise((resolve) => base.toBlob(resolve, "image/png"));
    async function pushHistory() {
      history.splice(historyIndex + 1);
      history.push(await snapshot());
      historyIndex = history.length - 1;
      syncHistoryButtons();
    }
    async function restore(index) {
      const img = await loadImage(history[index]);
      bctx.clearRect(0, 0, base.width, base.height);
      bctx.drawImage(img, 0, 0);
      historyIndex = index;
      syncHistoryButtons();
      draw();
    }
    function syncHistoryButtons() { q('[data-ed="undo"]').disabled = historyIndex <= 0; q('[data-ed="redo"]').disabled = historyIndex >= history.length - 1; }

    /* ---------------------------------------------------------- crop box */
    function positionCrop() {
      const c = state.crop || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      state.crop = c;
      Object.assign(cropEl.style, { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` });
    }
    function applyRatio() {
      if (state.ratio === "free" || !state.crop) return;
      const [rw, rh] = state.ratio.split(":").map(Number);
      const [w, h] = oriented();
      const c = state.crop;
      let cw = c.w, ch = (c.w * w * rh) / rw / h;
      if (ch > 1) { ch = 1; cw = (h * rw) / rh / w; }
      c.w = Math.min(1, cw); c.h = Math.min(1, ch); c.x = Math.min(c.x, 1 - c.w); c.y = Math.min(c.y, 1 - c.h);
    }
    let dragCrop = null;
    cropEl.addEventListener("pointerdown", (e) => { e.preventDefault(); dragCrop = { handle: e.target.dataset.h || "move", sx: e.clientX, sy: e.clientY, start: { ...state.crop }, rect: canvas.getBoundingClientRect() }; cropEl.setPointerCapture(e.pointerId); });
    cropEl.addEventListener("pointermove", (e) => {
      if (!dragCrop) return;
      const { handle, start, rect } = dragCrop;
      const dx = (e.clientX - dragCrop.sx) / rect.width, dy = (e.clientY - dragCrop.sy) / rect.height;
      const c = { ...start };
      if (handle === "move") { c.x = Math.max(0, Math.min(1 - c.w, start.x + dx)); c.y = Math.max(0, Math.min(1 - c.h, start.y + dy)); }
      else {
        if (handle.includes("w")) { c.x = Math.max(0, Math.min(start.x + start.w - 0.05, start.x + dx)); c.w = start.w - (c.x - start.x); }
        if (handle.includes("e")) c.w = Math.max(0.05, Math.min(1 - start.x, start.w + dx));
        if (handle.includes("n")) { c.y = Math.max(0, Math.min(start.y + start.h - 0.05, start.y + dy)); c.h = start.h - (c.y - start.y); }
        if (handle.includes("s")) c.h = Math.max(0.05, Math.min(1 - start.y, start.h + dy));
      }
      state.crop = c; applyRatio(); positionCrop();
    });
    cropEl.addEventListener("pointerup", () => { dragCrop = null; });

    /* ---------------------------------------------------------- paint and erase strokes */
    let stroke = null;
    const toBase = (e) => { const r = overlay.getBoundingClientRect(); const s = base.width / r.width; return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s }; };
    function strokePath(c, points, scale) {
      c.beginPath();
      points.forEach((p, i) => (i ? c.lineTo(p.x * scale, p.y * scale) : c.moveTo(p.x * scale, p.y * scale)));
      if (points.length === 1) c.lineTo(points[0].x * scale + 0.1, points[0].y * scale);
      c.stroke();
    }
    function styleStroke(c, s, scale) {
      c.lineCap = "round"; c.lineJoin = "round"; c.lineWidth = s.size * scale; c.strokeStyle = s.color;
      c.globalAlpha = s.kind === "marker" ? Math.min(0.5, s.opacity / 100) : s.opacity / 100;
      c.globalCompositeOperation = s.kind === "marker" ? "multiply" : "source-over";
    }
    function drawOverlay() {
      const c = overlay.getContext("2d");
      c.clearRect(0, 0, overlay.width, overlay.height);
      const scale = overlay.width / base.width;
      if (mode === "erase") {
        c.save(); c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "rgba(255,64,96,0.5)";
        for (const s of [...maskStrokes, ...(stroke?.erase ? [stroke] : [])]) { c.lineWidth = s.size * scale; strokePath(c, s.points, scale); }
        c.restore();
      } else if (stroke && !stroke.erase) { c.save(); styleStroke(c, stroke, scale); strokePath(c, stroke.points, scale); c.restore(); }
    }
    overlay.addEventListener("pointerdown", (e) => {
      if (!drawingMode()) return;
      e.preventDefault();
      overlay.setPointerCapture(e.pointerId);
      const sizeScale = base.width / overlay.getBoundingClientRect().width;
      stroke = mode === "erase"
        ? { erase: true, size: eraseBrush.size * sizeScale, points: [toBase(e)] }
        : { ...brush, size: brush.size * sizeScale, points: [toBase(e)] };
      drawOverlay();
    });
    overlay.addEventListener("pointermove", (e) => { if (!stroke) return; stroke.points.push(toBase(e)); drawOverlay(); });
    const endStroke = async () => {
      if (!stroke) return;
      const done = stroke;
      stroke = null;
      if (done.erase) { maskStrokes.push(done); drawOverlay(); return; }
      bctx.save(); styleStroke(bctx, done, 1); strokePath(bctx, done.points, 1); bctx.restore();
      await pushHistory();
      draw();
    };
    overlay.addEventListener("pointerup", endStroke);
    overlay.addEventListener("pointercancel", endStroke);
    // Color pop: click the photo to choose the color to keep.
    canvas.addEventListener("click", (e) => {
      if (!pickingPop) return;
      const r = canvas.getBoundingClientRect();
      const x = Math.round((e.clientX - r.left) * (canvas.width / r.width)), y = Math.round((e.clientY - r.top) * (canvas.height / r.height));
      const saved = { ...state }; state.popOn = false;
      render(canvas, canvas.width / (oriented()[0] * (state.crop?.w || 1)));
      const [pr, pg, pb] = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
      state = saved;
      const hue = hueOf(pr, pg, pb);
      pickingPop = false;
      canvas.classList.remove("is-picking");
      if (hue < 0) { notify(t("colorPopGray"), "info"); draw(); return; }
      state.popHue = hue; state.popOn = true;
      q('[data-toggle="popOn"]').checked = true;
      q(".ph-pop-swatch").style.background = `rgb(${pr},${pg},${pb})`;
      draw();
    });

    /* ---------------------------------------------------------- AI erase */
    const status = q(".ph-tool-status");
    const showStatus = (text, fraction) => { status.hidden = !text; q(".ph-tool-status-text").textContent = text || ""; const bar = status.querySelector(".mu-progress"); bar.hidden = fraction === undefined; if (fraction !== undefined) bar.firstChild.style.width = `${Math.round(fraction * 100)}%`; };
    let erasing = false;
    async function runErase() {
      if (erasing) return;
      if (!maskStrokes.length) { notify(t("maskEmpty"), "info"); return; }
      const AI = window.MunetiosAIEraser;
      if (!AI) { notify(t("errorAiModel"), "error"); return; }
      if (!(await AI.isCached()) && !(await options.confirm({ icon: "download", title: t("aiModelTitle"), text: t("aiModelHelp"), confirm: t("aiDownload") }))) return;
      erasing = true;
      const button = q('[data-ed="erase"]');
      button.disabled = true;
      try {
        try { await AI.load({ onProgress: (f) => showStatus(t("aiDownloading", { percent: String(Math.round(f * 100)) }), f) }); }
        catch { showStatus(""); notify(t("errorAiModel"), "error"); return; }
        showStatus(t("aiWorking"));
        await new Promise(requestAnimationFrame);
        const mask = Object.assign(document.createElement("canvas"), { width: base.width, height: base.height });
        const m = mask.getContext("2d");
        m.lineCap = "round"; m.lineJoin = "round"; m.strokeStyle = "#ffffff";
        for (const s of maskStrokes) { m.lineWidth = s.size; strokePath(m, s.points, 1); }
        const result = await AI.erase(base, mask);
        bctx.clearRect(0, 0, base.width, base.height);
        bctx.drawImage(result, 0, 0);
        maskStrokes = [];
        await pushHistory();
        showStatus("");
        notify(t("aiDone"), "success");
        draw();
      } catch (error) {
        showStatus("");
        notify(error?.code === "emptyMask" ? t("maskEmpty") : t("errorAiErase"), "error");
      } finally { erasing = false; button.disabled = false; }
    }

    /* ---------------------------------------------------------- controls */
    const syncSliders = () => el.querySelectorAll("[data-adjust]").forEach((input) => {
      const key = input.dataset.adjust;
      const value = key === "brushSize" ? brush.size : key === "brushOpacity" ? brush.opacity : key === "eraseSize" ? eraseBrush.size : state[key];
      if (value === undefined) return;
      input.value = value;
      input.closest(".mu-slider").querySelector("output").textContent = value;
      input.dispatchEvent(new Event("mu-sync"));
    });
    el.addEventListener("input", (e) => {
      const input = e.target.closest("[data-adjust]");
      if (!input) return;
      const key = input.dataset.adjust, value = Number(input.value);
      input.closest(".mu-slider").querySelector("output").textContent = input.value;
      if (key === "brushSize") brush.size = value;
      else if (key === "brushOpacity") brush.opacity = value;
      else if (key === "eraseSize") eraseBrush.size = value;
      else { state[key] = value; draw(); }
    });
    el.addEventListener("change", (e) => { const toggle = e.target.closest("[data-toggle]"); if (!toggle) return; state[toggle.dataset.toggle] = toggle.checked; if (toggle.dataset.toggle === "popOn" && toggle.checked && state.popHue === null) { pickingPop = true; canvas.classList.add("is-picking"); notify(t("colorPopHelp"), "info"); } draw(); });
    q(".ph-editor-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest("[data-mu-tab]");
      if (!tab) return;
      mode = tab.dataset.muTab;
      overlay.hidden = !drawingMode();
      overlay.classList.toggle("is-erase", mode === "erase");
      cropEl.hidden = mode !== "crop";
      if (mode === "crop") positionCrop();
      else if (state.crop && state.crop.w > 0.99 && state.crop.h > 0.99) state.crop = null;
      draw();
    });
    el.addEventListener("click", async (e) => {
      const preset = e.target.closest("[data-preset]");
      if (preset) {
        const keep = { rotate: state.rotate, flipH: state.flipH, flipV: state.flipV, crop: state.crop, ratio: state.ratio, popOn: state.popOn, popHue: state.popHue, popRange: state.popRange, tintColor: state.tintColor, duoDark: state.duoDark, duoLight: state.duoLight };
        state = Object.assign(defaults(), keep, PRESETS[preset.dataset.preset], { preset: preset.dataset.preset });
        el.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b === preset)));
        syncSliders(); draw(); return;
      }
      const ratio = e.target.closest("[data-ratio]");
      if (ratio) { state.ratio = ratio.dataset.ratio; el.querySelectorAll("[data-ratio]").forEach((b) => b.setAttribute("aria-pressed", String(b === ratio))); positionCrop(); applyRatio(); positionCrop(); return; }
      const kind = e.target.closest("[data-brush-kind]");
      if (kind) { brush.kind = kind.dataset.brushKind; el.querySelectorAll("[data-brush-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b === kind))); return; }
      const swatch = e.target.closest("[data-brush-color]");
      if (swatch) {
        const choose = (color) => { brush.color = color; el.querySelectorAll("[data-brush-color]").forEach((b) => b.setAttribute("aria-pressed", String(b === swatch))); };
        if (swatch.dataset.brushColor === "custom") options.pickColor({ anchor: swatch, value: brush.color, onPick: (c) => { if (c) { swatch.style.background = c; choose(c); } } });
        else choose(swatch.dataset.brushColor);
        return;
      }
      const colorField = e.target.closest("[data-color-key]");
      if (colorField) {
        const key = colorField.dataset.colorKey;
        options.pickColor({ anchor: colorField, value: state[key], onPick: (c) => { if (!c) return; state[key] = c; colorField.querySelector(".mu-picker-swatch").style.background = c; if (key === "tintColor") colorField.querySelector(".mu-picker-value").textContent = c.toUpperCase(); if (key === "tintColor" && !state.tintAmount) { state.tintAmount = 40; syncSliders(); } if (key.startsWith("duo") && !state.duoOn) { state.duoOn = true; q('[data-toggle="duoOn"]').checked = true; } draw(); } });
        return;
      }
      const b = e.target.closest("[data-ed]");
      if (!b) return;
      const action = b.dataset.ed;
      if (action === "cancel") close();
      else if (action === "undo" && historyIndex > 0) restore(historyIndex - 1);
      else if (action === "redo" && historyIndex < history.length - 1) restore(historyIndex + 1);
      else if (action === "reset") { state = defaults(); maskStrokes = []; el.querySelectorAll("[data-toggle]").forEach((x) => { x.checked = false; }); el.querySelectorAll("[data-preset]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.preset === "none"))); syncSliders(); if (historyIndex > 0) restore(0).then(pushHistory); else draw(); }
      else if (action === "rotate") { state.rotate = (state.rotate + 90) % 360; state.crop = null; draw(); }
      else if (action === "flipH") { state.flipH = !state.flipH; draw(); }
      else if (action === "flipV") { state.flipV = !state.flipV; draw(); }
      else if (action === "pick-pop") { pickingPop = true; canvas.classList.add("is-picking"); notify(t("colorPopHelp"), "info"); if (mode !== "color") draw(); }
      else if (action === "erase") runErase();
      else if (action === "clear-mask") { maskStrokes = []; drawOverlay(); }
      else if (action === "save" || action === "copy") save(action === "copy");
    });
    const compareButton = q('[data-ed="compare"]');
    const startCompare = (e) => { e.preventDefault(); comparing = true; draw(); };
    const endCompare = () => { if (!comparing) return; comparing = false; draw(); };
    compareButton.addEventListener("pointerdown", startCompare);
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => compareButton.addEventListener(ev, endCompare));
    compareButton.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") startCompare(e); });
    compareButton.addEventListener("keyup", endCompare);

    async function save(copy) {
      if (state.crop && state.crop.w > 0.99 && state.crop.h > 0.99) state.crop = null;
      try {
        const out = document.createElement("canvas");
        render(out, 1);
        const type = /^image\/(png|webp)$/.test(options.type) ? options.type : "image/jpeg";
        const blob = await new Promise((resolve) => out.toBlob(resolve, type, 0.94));
        if (!blob) throw new Error("encode");
        await options.onSave(blob, { copy, type });
        close();
      } catch { notify(t("errorEdit"), "error"); }
    }
    function close() {
      el.remove();
      removeEventListener("resize", draw);
      document.removeEventListener("keydown", keys, true);
      options.onClose?.();
    }
    function keys(e) {
      if (!el.isConnected || document.querySelector(".mu-modal:not([hidden])")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); q(e.shiftKey ? '[data-ed="redo"]' : '[data-ed="undo"]').click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); q('[data-ed="redo"]').click(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (pickingPop) { pickingPop = false; canvas.classList.remove("is-picking"); } else close(); }
    }
    document.addEventListener("keydown", keys, true);
    addEventListener("resize", draw);
    el.querySelectorAll("[data-preview]").forEach((span) => {
      span.style.backgroundImage = options.thumb ? `url('${options.thumb}')` : "";
      const p = { ...defaults(), ...PRESETS[span.dataset.preview] };
      span.style.filter = `brightness(${p.brightness}%) contrast(${p.contrast}%) saturate(${p.saturation}%) sepia(${p.sepia}%) hue-rotate(${p.hue}deg)`;
    });
    await pushHistory();
    draw();
    q('[data-ed="save"]').focus();
  }

  window.MunetiosPhotoEditor = Object.freeze({ open });
})();
