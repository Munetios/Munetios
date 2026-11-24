/*!
 * Munetios Photos AI eraser: removes painted areas from a photo with MI-GAN.
 *  - Model: MI-GAN pipeline v2 by Picsart AI Research, MIT license (open source).
 *    https://github.com/Picsart-AI-Research/MI-GAN
 *  - Runs entirely in the browser with onnxruntime-web (WebGPU when available, otherwise WebAssembly).
 *    Photos never leave the device. Only the model file is downloaded, once, and kept in Cache Storage.
 *
 * MunetiosAIEraser.load({ onProgress(fraction) }) -> Promise
 * MunetiosAIEraser.erase(sourceCanvas, maskCanvas) -> Promise<HTMLCanvasElement>
 *   maskCanvas: white strokes where the photo should be erased, on a transparent background
 *   (same size as sourceCanvas). Transparency matters: it limits the blend to the painted area.
 */
(() => {
  "use strict";
  const ORT_VERSION = "1.20.1";
  const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const MODEL_URL = "https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx";
  const CACHE = "munetios-photos-ai-v1";
  const POLARITY_KEY = "munetiosPhotos:miganHoleValue";
  const MAX_SIDE = 2048; // larger regions are processed at this size and scaled back
  let sessionPromise = null;

  const loadScript = (src) => new Promise((resolve, reject) => {
    if (window.ort) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.crossOrigin = "anonymous";
    script.onload = resolve;
    script.onerror = () => reject(new Error("runtime"));
    document.head.appendChild(script);
  });

  async function modelBytes(onProgress) {
    let cache = null;
    try { cache = await caches.open(CACHE); const hit = await cache.match(MODEL_URL); if (hit) { onProgress?.(1); return await hit.arrayBuffer(); } } catch {}
    const response = await fetch(MODEL_URL, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok || !response.body) throw new Error("model");
    const total = Number(response.headers.get("content-length")) || 28_100_000;
    const reader = response.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.byteLength;
      onProgress?.(Math.min(0.99, got / total));
    }
    const blob = new Blob(parts);
    try { await cache?.put(MODEL_URL, new Response(blob, { headers: { "content-type": "application/octet-stream" } })); } catch {}
    onProgress?.(1);
    return blob.arrayBuffer();
  }

  async function createSession(bytes) {
    const ort = window.ort;
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    const providers = "gpu" in navigator ? [["webgpu"], ["wasm"]] : [["wasm"]];
    let lastError;
    for (const executionProviders of providers) {
      try { return await ort.InferenceSession.create(bytes, { executionProviders }); } catch (error) { lastError = error; }
    }
    throw lastError || new Error("session");
  }

  function load({ onProgress } = {}) {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        await loadScript(`${ORT_BASE}ort.webgpu.min.js`);
        return createSession(await modelBytes(onProgress));
      })().catch((error) => { sessionPromise = null; throw error; });
    }
    return sessionPromise;
  }
  const isCached = async () => { try { return Boolean(await (await caches.open(CACHE)).match(MODEL_URL)); } catch { return false; } };

  // Bounding box of the painted area, padded so the model sees enough surroundings.
  function maskBounds(mask, width, height) {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[(y * width + x) * 4] > 127) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (maxX < 0) return null;
    const pad = Math.max(48, Math.round(Math.max(maxX - minX, maxY - minY) * 0.75));
    const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
    return { x, y, w: Math.min(width, maxX + pad + 1) - x, h: Math.min(height, maxY + pad + 1) - y };
  }

  async function run(session, rgba, holes, w, h, holeValue) {
    const ort = window.ort;
    const image = new Uint8Array(3 * w * h);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      image[i] = rgba[i * 4]; image[w * h + i] = rgba[i * 4 + 1]; image[2 * w * h + i] = rgba[i * 4 + 2];
      mask[i] = holes[i] ? holeValue : 255 - holeValue;
    }
    const result = await session.run({
      [session.inputNames[0]]: new ort.Tensor("uint8", image, [1, 3, h, w]),
      [session.inputNames[1]]: new ort.Tensor("uint8", mask, [1, 1, h, w]),
    });
    const data = result[session.outputNames[0]].data;
    const out = new Uint8ClampedArray(4 * w * h);
    for (let i = 0; i < w * h; i++) { out[i * 4] = data[i]; out[i * 4 + 1] = data[w * h + i]; out[i * 4 + 2] = data[2 * w * h + i]; out[i * 4 + 3] = 255; }
    return out;
  }
  // How much the output changed inside and outside the painted area.
  function changes(before, after, holes) {
    let inside = 0, outside = 0, ni = 0, no = 0;
    for (let i = 0; i < holes.length; i++) {
      const d = Math.abs(before[i * 4] - after[i * 4]) + Math.abs(before[i * 4 + 1] - after[i * 4 + 1]) + Math.abs(before[i * 4 + 2] - after[i * 4 + 2]);
      if (holes[i]) { inside += d; ni++; } else { outside += d; no++; }
    }
    return { inside: inside / Math.max(1, ni), outside: outside / Math.max(1, no) };
  }

  async function erase(source, maskCanvas) {
    const session = await load();
    const W = source.width, H = source.height;
    const maskData = maskCanvas.getContext("2d").getImageData(0, 0, W, H).data;
    const box = maskBounds(maskData, W, H);
    if (!box) throw Object.assign(new Error("emptyMask"), { code: "emptyMask" });
    // Work on the region around the painted area, scaled down if it is very large.
    const scale = Math.min(1, MAX_SIDE / Math.max(box.w, box.h));
    const w = Math.max(8, Math.round(box.w * scale)), h = Math.max(8, Math.round(box.h * scale));
    const region = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const rctx = region.getContext("2d", { willReadFrequently: true });
    rctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, w, h);
    const rgba = rctx.getImageData(0, 0, w, h).data;
    const regionMask = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const mctx = regionMask.getContext("2d", { willReadFrequently: true });
    mctx.drawImage(maskCanvas, box.x, box.y, box.w, box.h, 0, 0, w, h);
    const holes = new Uint8Array(w * h);
    const m = mctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) holes[i] = m[i * 4] > 127 ? 1 : 0;

    // The model's mask convention is checked on first use: the right one changes the painted area
    // and leaves the rest alone. The answer is remembered.
    let holeValue = Number(localStorage.getItem(POLARITY_KEY) ?? "0");
    let out = await run(session, rgba, holes, w, h, holeValue);
    if (localStorage.getItem(POLARITY_KEY) === null) {
      const first = changes(rgba, out, holes);
      if (first.inside <= first.outside) {
        holeValue = 255 - holeValue;
        out = await run(session, rgba, holes, w, h, holeValue);
      }
      try { localStorage.setItem(POLARITY_KEY, String(holeValue)); } catch {}
    }

    // Only the painted area (softened at the edge) is taken from the model, so the rest of the photo is untouched.
    const filled = Object.assign(document.createElement("canvas"), { width: w, height: h });
    filled.getContext("2d").putImageData(new ImageData(out, w, h), 0, 0);
    const feather = Object.assign(document.createElement("canvas"), { width: box.w, height: box.h });
    const fctx = feather.getContext("2d");
    fctx.filter = `blur(${Math.max(1, Math.round(3 / scale))}px)`;
    fctx.drawImage(maskCanvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    fctx.filter = "none";
    fctx.globalCompositeOperation = "source-in";
    fctx.drawImage(filled, 0, 0, box.w, box.h);
    const result = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const ctx = result.getContext("2d");
    ctx.drawImage(source, 0, 0);
    ctx.drawImage(feather, box.x, box.y);
    return result;
  }

  window.MunetiosAIEraser = Object.freeze({ load, erase, isCached, MODEL_URL, MODEL_LICENSE: "MIT", MODEL_NAME: "MI-GAN" });
})();
