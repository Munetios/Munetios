/*!
 * Munetios Photos (v4 redesign)
 *  - Photos and videos encrypted on this device (AES-GCM, one key per item)
 *  - Munetios Cloud backup: chunked, encrypted uploads with a bottom-right upload tray
 *  - Sync across devices with Munetios Account (end-to-end encrypted metadata)
 *  - Shared albums with collaborators, editing, memories, utilities
 * Requires munetios-ui-v4.js, account-core.js, cloud-i18n.js, munetios-cloud.js, jszip.min.js, photos-i18n.js.
 */
(() => {
  "use strict";
  const UI = window.MunetiosUI;
  const Cloud = window.MunetiosCloud;
  const A = window.MunetiosAccount;
  const STR = window.MunetiosPhotosStrings;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { localStorage.setItem(key, value); },
    json(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  };
  const DAY_MS = 86400000;
  const LARGE_BYTES = 10 * 1024 * 1024;

  /* ================================================================ settings and language */
  // Each workspace keeps its own library and settings (Personal keeps the original names).
  const SETTINGS_KEY = (window.MunetiosWorkspaceScope ? window.MunetiosWorkspaceScope.local("munetiosPhotos:settings") : "munetiosPhotos:settings");
  const DEFAULTS = {
    language: "system", gridSize: 180, groupBy: "day", sort: "taken", order: "desc", quality: store.get("munetios_photo_quality") || "high",
    cloudBackup: true, accountSync: true, slideshowInterval: 4, slideshowTransition: "fade", showMemories: true, trashDays: 30,
    reduceTransparency: store.get("munetios_reduce_transparency") === "1", stripLocation: true, lockedHash: "", lockedSalt: "",
  };
  let settings = Object.assign({}, DEFAULTS, store.json(SETTINGS_KEY, {}));
  function saveSettings(patch, { quiet = false } = {}) {
    const next = Object.assign({}, settings, patch, { updatedAt: Date.now() });
    try { store.set(SETTINGS_KEY, JSON.stringify(next)); settings = next; if (settings.accountSync) A?.sync?.schedule?.(800); return true; }
    catch { if (!quiet) UI.toast(t("errorSettings"), { type: "error" }); return false; }
  }
  const language = () => Cloud.resolveLanguage(settings.language === "system" ? navigator.language : settings.language);
  const uiLocale = () => ({ es: "es-ES", en: "en-US" })[language()] || language();
  let catalog = {};
  function buildCatalog() {
    const code = language();
    const base = Cloud.catalogBase(code);
    catalog = Object.assign({}, Cloud.strings("en"), STR.en, Cloud.strings(code === "zh-CN" ? "zh" : code), STR[base] || {}, STR[code] || {});
  }
  function t(key, vars) {
    let text = catalog[key] ?? key;
    if (vars) text = text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] ?? m));
    return text;
  }
  function translateUI() {
    document.documentElement.lang = language();
    document.documentElement.dir = Cloud.catalogBase(language()) === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll("[data-t-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.tLabel)); el.title = t(el.dataset.tLabel); });
    document.querySelectorAll("[data-t-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.tPlaceholder); });
    document.body.classList.toggle("is-reduced-transparency", Boolean(settings.reduceTransparency));
    A?.setLocaleSource?.(() => language());
    tray?.configure({ collapseLabel: t("collapse"), expandLabel: t("expand"), closeLabel: t("close"), cancelLabel: t("cancel"), retryLabel: t("retry") });
    if (screenCapture) renderScreenRecording();
  }
  // The custom video player (shared with OmniWrite) reads its labels through a global _t.
  // Its labels come from OmniWrite's language files, which cover every Photos language.
  let playerStrings = {};
  window._t = (key) => playerStrings[key] ?? catalog[key] ?? key;
  async function loadPlayerStrings() {
    const code = language();
    const base = Cloud.catalogBase(code);
    const files = [...new Set(["en", base, code === "es-419" ? "es-MX" : code === "zh-CN" ? "zh" : code])];
    const merged = {};
    for (const file of files) {
      try { const response = await fetch(`/omniwrite/languages/${file}.json`); if (response.ok) Object.assign(merged, await response.json()); } catch {}
    }
    playerStrings = merged;
  }
  const num = (n) => new Intl.NumberFormat(uiLocale()).format(n);
  function bytes(n) {
    const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];
    let i = 0, v = Number(n) || 0;
    while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
    try { return new Intl.NumberFormat(uiLocale(), { style: "unit", unit: units[i], unitDisplay: i ? "short" : "long", maximumFractionDigits: i ? 1 : 0 }).format(v); } catch { return `${v.toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][i]}`; }
  }
  const fmtDate = (value, options) => { try { return new Intl.DateTimeFormat(uiLocale(), options).format(new Date(value)); } catch { return String(value); } };
  const meridiem = (text) => text.replace(/\bAM\b/g, "NM").replace(/\bPM\b/g, "AN");
  const fmtDateTime = (value) => meridiem(fmtDate(value, { dateStyle: "medium", timeStyle: "short" }));
  const duration = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function relative(ms) {
    const diff = Math.round((ms - Date.now()) / DAY_MS);
    try { return new Intl.RelativeTimeFormat(uiLocale(), { numeric: "auto" }).format(diff, "day"); } catch { return fmtDate(ms, { dateStyle: "medium" }); }
  }
  const notify = (message, type = "info") => UI.toast(message, { type });

  /* ================================================================ storage (IndexedDB, compatible with earlier versions) */
  const DB_NAME = (window.MunetiosWorkspaceScope ? window.MunetiosWorkspaceScope.local("munetios_photos") : "munetios_photos"), PHOTOS = "photos", ALBUMS = "albums", KEYS = "photo_keys", META = "meta";
  let dbPromise = null;
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  function openDb() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 3);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS, { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains(ALBUMS)) db.createObjectStore(ALBUMS, { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => { dbPromise = null; reject(open.error); };
      open.onblocked = () => { dbPromise = null; reject(new Error("blocked")); };
    });
    return dbPromise;
  }
  async function tx(storeName, mode, work) {
    const db = await openDb();
    const transaction = db.transaction(storeName, mode);
    const result = work(transaction.objectStore(storeName));
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error); });
    return result instanceof IDBRequest ? result.result : result;
  }
  const putRecord = (storeName, value) => tx(storeName, "readwrite", (s) => s.put(value));
  const deleteRecord = (storeName, key) => tx(storeName, "readwrite", (s) => s.delete(key));
  const getRecord = (storeName, key) => tx(storeName, "readonly", (s) => s.get(key));
  const allRecords = (storeName) => tx(storeName, "readonly", (s) => s.getAll());
  const toBytes = (data) => data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : Array.isArray(data) ? new Uint8Array(data) : new Uint8Array();

  /* ---------------------------------------------------------- per-item encryption */
  async function encryptBytes(plain) {
    const cryptoKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const keyId = `photo-key-${crypto.randomUUID()}`;
    await putRecord(KEYS, { id: keyId, keyData: await crypto.subtle.exportKey("raw", cryptoKey), createdAt: new Date().toISOString() });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plain));
    return { data, encryption: { enabled: true, algorithm: "AES-GCM", version: 1, keyId, iv: Array.from(iv), originalSize: plain.byteLength } };
  }
  async function decryptLocal(record) {
    if (!record.data) return null;
    if (!record.encryption?.enabled) return toBytes(record.data);
    const stored = await getRecord(KEYS, record.encryption.keyId);
    if (!stored?.keyData) throw new Error("missingKey");
    const key = await crypto.subtle.importKey("raw", stored.keyData, { name: "AES-GCM" }, false, ["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.encryption.iv || []) }, key, toBytes(record.data)));
  }
  const blobCache = new Map();
  async function getBlob(record, { onProgress } = {}) {
    if (blobCache.has(record.id)) return blobCache.get(record.id);
    let blob;
    const local = await decryptLocal(record).catch(() => null);
    if (local) blob = new Blob([local], { type: record.type });
    else if (record.cloud) blob = await Cloud.downloadBlob(record.cloud, record.type, { onProgress });
    else if (record.remote) blob = await Cloud.downloadBlob(record.remote, record.type, { onProgress });
    else throw new Error("unavailable");
    blobCache.set(record.id, blob);
    if (blobCache.size > 24) blobCache.delete(blobCache.keys().next().value);
    return blob;
  }
  const size = (record) => record.size || record.encryption?.originalSize || (record.data ? toBytes(record.data).byteLength : 0) || record.cloud?.plainSize || 0;

  /* ================================================================ state */
  const photos = new Map();   // id -> record
  const albums = new Map();   // id -> { id, uid, name, created, description, cover, sort, spaceId, role, updatedAt }
  const shared = new Map();   // spaceId -> { space, album, items }
  let section = "library";
  let query = "";
  let filter = "all";
  let colorFilter = "";
  let unlocked = false;
  const selection = new Set();
  let selectMode = false;
  let lastSelected = null;
  let tray = null;

  const visibleIn = (p, s = section) => {
    if (s === "trash") return Boolean(p.trashed);
    if (p.trashed) return false;
    if (s === "locked") return Boolean(p.locked);
    if (p.locked) return false;
    if (s === "archive") return Boolean(p.archived);
    if (s.startsWith("album:")) return (p.albums || []).map(String).includes(s.slice(6));
    if (p.archived) return false;
    if (s === "favorites") return Boolean(p.favorite);
    if (s === "videos") return Boolean(p.isVideo);
    if (s === "screenshots") return Boolean(p.screenshots);
    return true;
  };
  const takenAt = (p) => Date.parse(p.takenAt || p.date) || 0;
  function sorted(list, albumSort) {
    const by = albumSort === "name" ? "name" : albumSort === "oldest" ? "taken" : settings.sort;
    const dir = albumSort === "oldest" ? 1 : albumSort === "newest" ? -1 : settings.order === "asc" ? 1 : -1;
    const key = { taken: takenAt, added: (p) => Date.parse(p.date) || 0, name: (p) => String(p.name || "").toLocaleLowerCase(uiLocale()), size }[by] || takenAt;
    return list.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || b.id - a.id; });
  }
  function matchesQuery(p) {
    if (!query) return true;
    const q = query.toLocaleLowerCase(uiLocale());
    const text = [p.name, p.notes, ...(p.tags || []), p.exif?.make, p.exif?.model, fmtDate(takenAt(p), { dateStyle: "long" }), fmtDate(takenAt(p), { month: "long", year: "numeric" })].join(" ").toLocaleLowerCase(uiLocale());
    return text.includes(q);
  }
  function matchesFilter(p) {
    if (colorFilter && colorDistance(p.color, colorFilter) > 90) return false;
    switch (filter) {
      case "photos": return !p.isVideo;
      case "videos": return Boolean(p.isVideo);
      case "favorites": return Boolean(p.favorite);
      case "edited": return Boolean(p.editedAt);
      case "large": return size(p) >= LARGE_BYTES;
      case "rated": return Number(p.rating) > 0;
      case "cloud": return Boolean(p.cloud);
      case "local": return !p.cloud;
      default: return true;
    }
  }
  function colorDistance(a, b) {
    if (!a || !b) return 999;
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  }

  /* ================================================================ media helpers */
  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
      img.src = url;
    });
  }
  function loadVideo(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const video = document.createElement("video");
      video.muted = true; video.playsInline = true; video.preload = "metadata";
      video.onloadeddata = () => { video.currentTime = Math.min(1, (video.duration || 2) / 3); };
      video.onseeked = () => resolve({ video, url });
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("video")); };
      video.src = url;
    });
  }
  // Thumbnail, size, dominant color, and duration for a photo or video.
  async function describeMedia(blob, isVideo) {
    let source, url, width, height, length = 0;
    if (isVideo) { const v = await loadVideo(blob); source = v.video; url = v.url; width = source.videoWidth; height = source.videoHeight; length = source.duration || 0; }
    else { const i = await loadImage(blob); source = i.img; url = i.url; width = source.naturalWidth; height = source.naturalHeight; }
    const scale = Math.min(1, 480 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const tiny = document.createElement("canvas"); tiny.width = tiny.height = 1;
    tiny.getContext("2d").drawImage(canvas, 0, 0, 1, 1);
    const [r, g, b] = tiny.getContext("2d").getImageData(0, 0, 1, 1).data;
    const color = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    const thumb = canvas.toDataURL("image/webp", 0.72);
    URL.revokeObjectURL(url);
    return { thumb: thumb.startsWith("data:image/webp") ? thumb : canvas.toDataURL("image/jpeg", 0.72), width, height, color, duration: length };
  }
  const imageQuality = {
    high: { maxEdge: 4096, encoderQuality: 0.92 },
    medium: { maxEdge: 2560, encoderQuality: 0.82 },
    low: { maxEdge: 1600, encoderQuality: 0.72 },
  };
  async function compress(file) {
    const preset = imageQuality[settings.quality];
    if (!preset || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const { img, url } = await loadImage(file);
    try {
      const scale = Math.min(1, preset.maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale === 1 && file.type === "image/jpeg" && settings.quality === "high") return file;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image encoding failed")), file.type, preset.encoderQuality);
      });
      if (scale === 1 && out.size >= file.size) return file;
      return new File([out], file.name, { type: out.type, lastModified: file.lastModified });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  // Minimal EXIF reader for JPEG files (camera, exposure, date taken, location).
  function readExif(buffer) {
    try {
      const view = new DataView(buffer);
      if (view.getUint16(0) !== 0xffd8) return null;
      let offset = 2;
      while (offset < view.byteLength - 4) {
        const marker = view.getUint16(offset);
        if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
          const tiff = offset + 10;
          const little = view.getUint16(tiff) === 0x4949;
          const u16 = (o) => view.getUint16(o, little), u32 = (o) => view.getUint32(o, little);
          const text = (o, n) => { let s = ""; for (let i = 0; i < n - 1; i++) { const c = view.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); };
          const rational = (o) => { const d = u32(o + 4); return d ? u32(o) / d : 0; };
          const readIfd = (start) => {
            const out = {};
            const count = u16(start);
            for (let i = 0; i < count; i++) {
              const e = start + 2 + i * 12;
              const tag = u16(e), type = u16(e + 2), n = u32(e + 4);
              const valueOffset = (type === 2 && n > 4) || (type === 5 || type === 10) ? tiff + u32(e + 8) : e + 8;
              if (type === 2) out[tag] = text(valueOffset, n);
              else if (type === 3) out[tag] = u16(valueOffset);
              else if (type === 4) out[tag] = u32(valueOffset);
              else if (type === 5) out[tag] = n > 1 ? [0, 1, 2].map((k) => rational(valueOffset + k * 8)) : rational(valueOffset);
              else if (type === 10) out[tag] = rational(valueOffset);
            }
            return out;
          };
          const ifd0 = readIfd(tiff + u32(tiff + 4));
          const exif = ifd0[0x8769] ? readIfd(tiff + ifd0[0x8769]) : {};
          const gps = ifd0[0x8825] ? readIfd(tiff + ifd0[0x8825]) : {};
          const toDeg = (v, ref) => (Array.isArray(v) ? (v[0] + v[1] / 60 + v[2] / 3600) * (/[SW]/.test(ref || "") ? -1 : 1) : null);
          const date = exif[0x9003] || ifd0[0x132];
          const taken = date && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}/.test(date) ? date.replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T") : null;
          return {
            make: ifd0[0x10f] || "", model: ifd0[0x110] || "", lens: exif[0xa434] || "", iso: exif[0x8827] || null,
            exposure: exif[0x829a] || null, fNumber: exif[0x829d] || null, focal: exif[0x920a] || null, orientation: ifd0[0x112] || 1,
            taken, lat: toDeg(gps[2], gps[1]), lon: toDeg(gps[4], gps[3]),
          };
        }
        if ((marker & 0xff00) !== 0xff00) break;
        offset += 2 + view.getUint16(offset + 2);
      }
    } catch {}
    return null;
  }
  async function sha256(bytesValue) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytesValue))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

  /* ================================================================ import */
  const isMedia = (file) => /^(image|video)\//.test(file.type);
  async function importFiles(fileList, { albumId = null, locked = false, quiet = false } = {}) {
    const files = [...fileList].filter(isMedia);
    if (files.length < fileList.length && !quiet) notify(t("errorUnsupported"), "error");
    if (!files.length) return [];
    const added = [];
    const progress = files.length > 1 ? UI.toast(t("importing", { n: num(files.length) }), { duration: 60000 }) : null;
    for (const original of files) {
      try {
        const isVideo = original.type.startsWith("video/");
        const file = isVideo ? original : await compress(original);
        const buffer = await file.arrayBuffer();
        const exif = !isVideo && file.type === "image/jpeg" ? readExif(await original.slice(0, 256 * 1024).arrayBuffer()) : null;
        const info = await describeMedia(file, isVideo).catch(() => ({ thumb: "", width: 0, height: 0, color: "", duration: 0 }));
        const encrypted = await encryptBytes(new Uint8Array(buffer));
        const record = {
          id: Date.now() * 1000 + Math.floor(Math.random() * 1000), cloudId: uid(), name: original.name || (isVideo ? "video" : "photo"), type: file.type || original.type,
          data: encrypted.data, encryption: encrypted.encryption, secure: true, date: new Date().toISOString(),
          takenAt: exif?.taken || (original.lastModified ? new Date(original.lastModified).toISOString() : new Date().toISOString()),
          favorite: false, albums: albumId ? [albumId] : [], screenshots: /screen ?shot|captura|bildschirm|скриншот|スクリーンショット|스크린샷|截屏|截图/i.test(original.name || ""),
          tags: [], notes: "", isVideo, archived: false, locked, rating: 0, size: buffer.byteLength, hash: await sha256(buffer), exif: exif || null,
          thumb: info.thumb, width: info.width, height: info.height, color: info.color, duration: info.duration, editedAt: null, originalPhotoId: null, updatedAt: Date.now(),
        };
        await putRecord(PHOTOS, record);
        photos.set(record.id, record);
        added.push(record);
        if (!locked) queueUpload(record);
      } catch {
        notify(t("errorSavePhoto"), "error");
      }
    }
    progress?.remove();
    if (added.length && !quiet) notify(t("imported", { n: num(added.length) }), "success");
    render();
    return added;
  }

  /* ================================================================ Munetios Cloud backup (chunked uploads) */
  const signedIn = () => Boolean(A?.state?.account);
  const uploads = new Map(); // photo id -> { entry, controller, resume }
  const queue = [];
  let active = 0;
  function ensureTray() {
    if (!tray) {
      tray = UI.uploadTray({ title: t("uploadingOne"), collapseLabel: t("collapse"), expandLabel: t("expand"), closeLabel: t("close"), cancelLabel: t("cancel"), retryLabel: t("retry") });
      tray.onClose = () => { queue.length = 0; uploads.forEach((u) => u.controller?.abort()); uploads.clear(); updateTrayTitle(); };
    }
    return tray;
  }
  function updateTrayTitle() {
    if (!tray) return;
    const pending = [...uploads.values()].filter((u) => u.entry.state === "active").length;
    const failed = [...uploads.values()].filter((u) => u.entry.state === "failed").length;
    const done = [...uploads.values()].filter((u) => u.entry.state === "done").length;
    tray.setTitle(pending ? (pending === 1 ? t("uploadingOne") : t("uploadingItems", { n: num(pending) })) : failed ? t("errorUpload") : done === 1 ? t("uploadComplete") : t("uploadedItems", { n: num(done) }));
  }
  function queueUpload(record, { force = false } = {}) {
    if (!signedIn() || (!settings.cloudBackup && !force) || record.cloud || record.locked || uploads.has(record.id)) return;
    const entry = ensureTray().add({ name: record.name, icon: record.isVideo ? "movie" : "image", meta: t("uploadWaiting"), cancelLabel: t("cancel") });
    const job = { id: record.id, accountId: A.state.account.id, entry, controller: null, resume: null };
    entry.onCancel = () => { job.controller?.abort(); const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1); uploads.delete(record.id); if (job.resume?.blobId) Cloud.deleteBlob(job.resume.blobId).catch(() => {}); updateTrayTitle(); };
    uploads.set(record.id, job);
    queue.push(job);
    updateTrayTitle();
    pump();
  }
  function pump() {
    while (navigator.onLine !== false && signedIn() && !A.state.offline && active < 2 && queue.length) {
      const job = queue.shift();
      if (job.accountId !== A.state.account.id) {
        job.entry.remove();
        uploads.delete(job.id);
        updateTrayTitle();
        continue;
      }
      active++;
      runUpload(job).finally(() => { active--; updateTrayTitle(); pump(); });
    }
  }
  async function runUpload(job) {
    const record = photos.get(job.id);
    if (!record) { job.entry.remove(); return; }
    job.controller = new AbortController();
    try {
      const blob = await getBlob(record);
      const ref = await Cloud.uploadBlob(blob, {
        signal: job.controller.signal, resume: job.resume,
        onState: (state) => { job.resume = state; },
        onProgress: (sent, total) => job.entry.progress(total ? sent / total : 1, t("uploadProgress", { done: bytes(sent), total: bytes(total) })),
      });
      const fresh = photos.get(job.id);
      if (!fresh) { Cloud.deleteBlob(ref.blobId).catch(() => {}); return; }
      fresh.cloud = Object.assign(ref, { uploadedAt: Date.now() });
      fresh.updatedAt = Date.now();
      await putRecord(PHOTOS, fresh);
      job.entry.done(t("uploaded"));
      A?.sync?.schedule?.(1200);
      scheduleUsage();
      renderCloudStatus();
      if (section !== "storage") updateTile(fresh); else render();
      setTimeout(() => { if (job.entry.state === "done") { job.entry.remove(); uploads.delete(job.id); updateTrayTitle(); } }, 6000);
    } catch (error) {
      if (error?.name === "AbortError") return;
      job.retryOnReconnect = error?.code === "offline" || navigator.onLine === false;
      const message = error?.code === "storageFull" ? t("errorStorageFull") : error?.code === "offline" ? t("errorOffline") : error?.code === "notDeployed" ? t("cloudUnavailable") : t("errorUpload");
      job.entry.fail(message, () => { job.retryOnReconnect = false; queue.push(job); updateTrayTitle(); pump(); });
      if (error?.code === "storageFull") notify(t("errorStorageFull"), "error");
    }
  }
  async function backupEverything() {
    if (!signedIn()) return requireSignIn();
    let n = 0;
    for (const p of photos.values()) if (!p.cloud && !p.locked && !p.trashed) { queueUpload(p, { force: true }); n++; }
    if (!n) notify(t("allBackedUp"), "success");
  }
  async function freeUpSpace() {
    const list = [...photos.values()].filter((p) => p.cloud && p.data);
    if (!list.length) { notify(t("nothingToFree"), "info"); return; }
    const total = list.reduce((s, p) => s + toBytes(p.data).byteLength, 0);
    if (!(await confirmDialog({ icon: "cleaning_services", title: t("freeUpSpace"), text: t("freeUpSpaceConfirm", { n: num(list.length), size: bytes(total) }), confirm: t("freeUpSpace") }))) return;
    try {
      for (const p of list) {
        if (p.encryption?.keyId) await deleteRecord(KEYS, p.encryption.keyId).catch(() => {});
        p.data = null; p.encryption = null; p.cloudOnly = true;
        await putRecord(PHOTOS, p);
        blobCache.delete(p.id);
      }
      notify(t("spaceFreed", { size: bytes(total) }), "success");
      render();
    } catch { notify(t("errorFreeSpace"), "error"); }
  }
  async function keepOnDevice(record) {
    try {
      const blob = await getBlob(record);
      const enc = await encryptBytes(new Uint8Array(await blob.arrayBuffer()));
      Object.assign(record, { data: enc.data, encryption: enc.encryption, cloudOnly: false });
      await putRecord(PHOTOS, record);
      notify(t("savedOnDevice"), "success");
    } catch { notify(t("errorDownload"), "error"); }
  }

  /* ================================================================ Munetios Account sync (end-to-end encrypted metadata) */
  const PREFIX = "munetios-photos:";
  const SYNC_FIELDS = ["cloudId", "name", "type", "date", "takenAt", "favorite", "screenshots", "tags", "notes", "isVideo", "archived", "rating", "size", "hash", "exif", "thumb", "width", "height", "color", "duration", "editedAt", "trashed", "trashedAt", "cloud", "updatedAt"];
  function registerSync() {
    if (!A?.sync?.register || !settings.accountSync || window.__munetiosPhotosSync) return;
    window.__munetiosPhotosSync = true;
    A.sync.register({
      id: "munetios-photos", prefix: PREFIX,
      async snapshot() {
        if (!settings.accountSync) return [];
        const out = [];
        const albumList = [...albums.values()].filter((a) => !a.sharedWithMe).map((a) => ({ uid: a.uid, name: a.name, created: a.created, description: a.description || "", cover: photos.get(a.cover)?.cloudId || "", sort: a.sort || "newest", spaceId: a.spaceId || "", updatedAt: a.updatedAt || 0 }));
        out.push({ key: PREFIX + "albums", data: albumList, updatedAt: Math.max(0, ...albumList.map((a) => a.updatedAt)) });
        const { lockedHash, lockedSalt, ...prefs } = settings;
        out.push({ key: PREFIX + "settings", data: prefs, updatedAt: settings.updatedAt || 0 });
        for (const p of photos.values()) {
          if (!p.cloud || p.locked) continue;
          const data = Object.fromEntries(SYNC_FIELDS.map((f) => [f, p[f]]));
          data.albumUids = (p.albums || []).map((id) => albums.get(id)?.uid).filter(Boolean);
          out.push({ key: PREFIX + "item:" + p.cloudId, data, updatedAt: p.updatedAt || 0 });
        }
        return out;
      },
      async apply(list, { replace = false } = {}) {
        if (!settings.accountSync) return false;
        let changed = false;
        const seen = new Set();
        const albumByUid = () => new Map([...albums.values()].map((a) => [a.uid, a]));
        for (const entry of list) {
          if (entry.key === PREFIX + "albums" && Array.isArray(entry.data)) {
            const byUid = albumByUid();
            for (const a of entry.data) {
              const local = byUid.get(a.uid);
              if (local && (local.updatedAt || 0) > (a.updatedAt || 0)) continue;
              const album = Object.assign(local || { id: a.uid }, { uid: a.uid, name: a.name, created: a.created, description: a.description, sort: a.sort, spaceId: a.spaceId || undefined, updatedAt: a.updatedAt, coverCloudId: a.cover });
              albums.set(album.id, album);
              await putRecord(ALBUMS, album);
              changed = true;
            }
          } else if (entry.key === PREFIX + "settings" && entry.data) {
            settings = Object.assign({}, settings, entry.data, { lockedHash: settings.lockedHash, lockedSalt: settings.lockedSalt });
            try { store.set(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
            changed = true;
          } else if (entry.key.startsWith(PREFIX + "item:")) {
            const cloudId = entry.key.slice((PREFIX + "item:").length);
            seen.add(cloudId);
            const local = [...photos.values()].find((p) => p.cloudId === cloudId);
            if (entry.deleted) { if (local) { photos.delete(local.id); await deleteRecord(PHOTOS, local.id); changed = true; } continue; }
            if (local && (local.updatedAt || 0) >= (entry.data.updatedAt || 0)) continue;
            const byUid = albumByUid();
            const record = Object.assign(local || { id: Date.now() * 1000 + Math.floor(Math.random() * 1000), data: null, encryption: null, cloudOnly: true, secure: true, locked: false }, entry.data);
            record.albums = (entry.data.albumUids || []).map((u) => byUid.get(u)?.id).filter(Boolean);
            delete record.albumUids;
            photos.set(record.id, record);
            await putRecord(PHOTOS, record);
            changed = true;
          }
        }
        if (replace) for (const p of [...photos.values()]) if (p.cloud && p.cloudOnly && !seen.has(p.cloudId)) { photos.delete(p.id); await deleteRecord(PHOTOS, p.id); changed = true; }
        for (const album of albums.values()) if (album.coverCloudId) { album.cover = [...photos.values()].find((p) => p.cloudId === album.coverCloudId)?.id; }
        if (changed) { buildCatalog(); translateUI(); render(); restorePendingMedia(); }
        return changed;
      },
    });
  }

  /* ================================================================ dialogs and menus */
  function dialog({ icon, title, body, actions = "", size: dialogSize = "md", className = "" }) {
    const id = "ph" + Math.random().toString(36).slice(2, 9);
    const modal = document.createElement("div");
    modal.className = `mu-modal ph-dialog ${className}`;
    modal.id = id;
    modal.hidden = true;
    modal.innerHTML = `<div class="mu-dialog ${dialogSize === "lg" ? "mu-dialog-lg" : dialogSize === "md" ? "mu-dialog-md" : ""}" role="dialog" aria-modal="false" aria-labelledby="${id}T">
      <div class="mu-dialog-header"><div class="mu-dialog-heading"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${esc(icon)}</span></span><h2 id="${id}T">${esc(title)}</h2></div>
      <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-close aria-label="${esc(t("close"))}"><span class="mu-icon" aria-hidden="true">close</span></button></div>
      <div class="ph-dialog-body">${body}</div>${actions ? `<div class="mu-dialog-actions">${actions}</div>` : ""}</div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("select.mu-select").forEach((s) => UI.enhanceSelect(s));
    const api = { modal, q: (s) => modal.querySelector(s), qa: (s) => [...modal.querySelectorAll(s)], close: () => { if (!modal.hidden) UI.closeModal(modal); }, onClose: null };
    new MutationObserver((records, observer) => { if (modal.hidden) { observer.disconnect(); modal.remove(); api.onClose?.(); } }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
    UI.openModal(id);
    return api;
  }
  function confirmDialog({ icon = "help", title, text, confirm, danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const d = dialog({ icon, title, size: "", body: `<p class="ph-dialog-text">${esc(text)}</p>`, actions: `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="button" class="mu-btn ${danger ? "mu-btn-danger" : "mu-btn-primary"}" data-ok>${esc(confirm)}</button>` });
      d.q("[data-ok]").addEventListener("click", () => { answered = true; d.close(); resolve(true); });
      d.onClose = () => { if (!answered) resolve(false); };
    });
  }
  function promptDialog({ icon, title, label, value = "", confirm, multiline = false }) {
    return new Promise((resolve) => {
      let result = null;
      const d = dialog({ icon, title, size: "", body: `<label class="mu-field"><span class="mu-field-label">${esc(label)}</span>${multiline ? `<textarea class="mu-textarea" rows="3">${esc(value)}</textarea>` : `<input class="mu-input" value="${esc(value)}">`}</label>`, actions: `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="button" class="mu-btn mu-btn-primary" data-ok>${esc(confirm)}</button>` });
      const input = d.q("input, textarea");
      const ok = () => { result = input.value.trim(); d.close(); };
      d.q("[data-ok]").addEventListener("click", ok);
      if (!multiline) input.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
      d.onClose = () => resolve(result);
      setTimeout(() => { input.focus(); input.select?.(); }, 30);
    });
  }
  let openMenuEl = null;
  function closeMenu() { openMenuEl?.remove(); openMenuEl = null; }
  function menu(anchor, entries) {
    closeMenu();
    const el = document.createElement("div");
    el.className = "mu-menu mu-menu-context ph-floating-menu";
    el.setAttribute("role", "menu");
    el.innerHTML = entries.filter(Boolean).map((e, i) => (e === "-" ? '<div class="mu-menu-sep" role="separator"></div>' : `<button type="button" class="mu-menu-item${e.danger ? " is-danger" : ""}" role="menuitem" data-i="${i}"><span class="mu-icon" aria-hidden="true">${esc(e.icon)}</span><span>${esc(e.label)}</span></button>`)).join("");
    const list = entries.filter(Boolean);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.left = Math.max(12, Math.min(innerWidth - el.offsetWidth - 12, r.right - el.offsetWidth)) + "px";
    el.style.top = (r.bottom + el.offsetHeight + 12 > innerHeight ? Math.max(12, r.top - el.offsetHeight - 6) : r.bottom + 6) + "px";
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (!b) return; closeMenu(); list[Number(b.dataset.i)].action(); });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMenu(); anchor.focus(); } });
    openMenuEl = el;
    el.querySelector(".mu-menu-item")?.focus();
    setTimeout(() => document.addEventListener("pointerdown", (e) => { if (!el.contains(e.target)) closeMenu(); }, { once: true }), 0);
  }
  function requireSignIn() {
    dialog({ icon: "account_circle", title: t("signInTitle"), size: "", body: `<p class="ph-dialog-text">${esc(t("signInHelp"))}</p>`, actions: `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><a class="mu-btn mu-btn-primary" href="/signin?continue=${encodeURIComponent(location.pathname)}">${esc(t("signIn"))}</a>` });
  }
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ================================================================ rendering */
  const main = $("phMain");
  const SECTION_TITLES = { library: "photos", memories: "memories", favorites: "favorites", videos: "videos", screenshots: "screenshots", albums: "albums", archive: "archive", locked: "lockedFolder", trash: "recentlyDeleted", duplicates: "duplicates", storage: "storage", recap: "yearInReview" };
  function sectionTitle() {
    if (query) return t("searchResults");
    if (section.startsWith("album:")) return albums.get(albumKey(section.slice(6)))?.name || t("albums");
    if (section.startsWith("shared:")) return shared.get(section.slice(7))?.album.name || t("sharedAlbums");
    return t(SECTION_TITLES[section] || "photos");
  }
  const albumKey = (raw) => (albums.has(raw) ? raw : albums.has(Number(raw)) ? Number(raw) : raw);
  function render() {
    main.setAttribute("aria-busy", "false");
    $("sectionTitle").textContent = sectionTitle();
    document.title = `${sectionTitle()} · Munetios Photos`;
    document.querySelectorAll("[data-section]").forEach((el) => { if (el.dataset.section === section) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current"); });
    renderCounts();
    renderAlbumNav();
    renderCloudStatus();
    main.style.setProperty("--tile", `${settings.gridSize}px`);
    if (section === "albums" && !query) return renderAlbums();
    if (section === "memories" && !query) return renderMemories();
    if (section === "duplicates") return renderDuplicates();
    if (section === "storage") return renderStorage();
    if (section === "recap") return renderRecap();
    if (section.startsWith("shared:")) return renderShared(section.slice(7));
    if (section === "locked" && !unlocked) return renderLockedGate();
    renderLibrary();
  }
  function renderCounts() {
    const count = (s) => [...photos.values()].filter((p) => visibleIn(p, s)).length;
    const values = { library: count("library"), favorites: count("favorites"), videos: count("videos"), screenshots: count("screenshots"), archive: count("archive"), trash: count("trash"), albums: albums.size };
    document.querySelectorAll("[data-count]").forEach((el) => { const v = values[el.dataset.count]; el.textContent = v ? num(v) : ""; el.hidden = !v; });
  }
  function renderAlbumNav() {
    $("albumNav").innerHTML = [...albums.values()].sort((a, b) => a.name.localeCompare(b.name, uiLocale())).map((a) => `<button type="button" class="mu-nav-item" data-section="${a.sharedWithMe ? `shared:${esc(a.spaceId)}` : `album:${esc(a.id)}`}"${section === (a.sharedWithMe ? `shared:${a.spaceId}` : `album:${a.id}`) ? ' aria-current="page"' : ""}><span class="mu-icon" aria-hidden="true">${a.spaceId ? "group" : "photo_album"}</span><span class="ph-nav-text">${esc(a.name)}</span></button>`).join("");
  }
  // Storage used: Munetios Cloud (from the server) and this device (encrypted copies in IndexedDB).
  let cloudUsage = null, usageTimer = null, usageLoading = false;
  const deviceBytes = () => [...photos.values()].reduce((sum, p) => sum + (p.data ? toBytes(p.data).byteLength : 0), 0);
  async function refreshCloudUsage() {
    if (!signedIn() || usageLoading || A.state.offline || navigator.onLine === false) return;
    usageLoading = true;
    try { cloudUsage = await Cloud.storage(); } catch { cloudUsage = cloudUsage?.quota ? cloudUsage : { error: true }; }
    usageLoading = false;
    renderCloudStatus({ fetch: false });
  }
  const scheduleUsage = () => { clearTimeout(usageTimer); usageTimer = setTimeout(refreshCloudUsage, 1500); };
  const hasPersonalCloudQuota = (usage) => usage?.quota > 0 && !usage.sharedCapacity;
  function renderCloudStatus({ fetch = true } = {}) {
    const box = $("cloudStatus");
    const device = `<div class="ph-usage-line"><span class="mu-icon" aria-hidden="true">smartphone</span><span>${esc(t("deviceUsed", { size: bytes(deviceBytes()) }))}</span></div>`;
    if (!signedIn()) { box.innerHTML = `${device}<p class="mu-muted">${esc(t("cloudSignedOut"))}</p><a class="mu-btn mu-btn-primary" href="/signin?continue=${encodeURIComponent(location.pathname)}">${esc(t("signIn"))}</a>`; return; }
    if (fetch && !cloudUsage) refreshCloudUsage();
    const total = [...photos.values()].filter((p) => !p.locked && !p.trashed).length;
    const backed = [...photos.values()].filter((p) => p.cloud && !p.locked && !p.trashed).length;
    const pct = cloudUsage?.quota ? Math.min(100, cloudUsage.used / cloudUsage.quota * 100) : 0;
    const usage = cloudUsage?.error
      ? `<div class="ph-usage-line mu-muted"><span class="mu-icon" aria-hidden="true">cloud_off</span><span>${esc(t("cloudStorage"))}: —</span></div>`
      : cloudUsage
      ? hasPersonalCloudQuota(cloudUsage)
        ? `<div class="ph-usage"><div class="ph-usage-line"><span class="mu-icon" aria-hidden="true">cloud</span><span>${esc(t("usedOf", { used: bytes(cloudUsage.used), total: bytes(cloudUsage.quota) }))}</span></div><div class="mu-progress${pct >= 90 ? " is-warning" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="${esc(t("cloudStorage"))}"><span style="width:${Math.max(pct ? 1 : 0, pct).toFixed(1)}%"></span></div></div>`
        : `<div class="ph-usage-line"><span class="mu-icon" aria-hidden="true">cloud</span><span>${esc(t("cloudStorage"))} · ${esc(bytes(cloudUsage.used))}</span></div>`
      : `<div class="ph-usage-line mu-muted"><span class="mu-icon" aria-hidden="true">cloud</span><span>${esc(t("loading"))}</span></div>`;
    box.innerHTML = `${usage}${device}<div class="ph-cloud-line"><span class="mu-icon" aria-hidden="true">${backed === total ? "cloud_done" : settings.cloudBackup ? "cloud_sync" : "cloud_off"}</span><span>${esc(backed === total ? t("allBackedUp") : t("backedUpCount", { done: num(backed), total: num(total) }))}</span></div><button type="button" class="mu-btn mu-btn-ghost ph-usage-link" data-section="storage"><span class="mu-icon" aria-hidden="true">storage</span>${esc(t("manageStorage"))}</button>`;
  }
  const FILTERS = ["all", "photos", "videos", "favorites", "edited", "rated", "large", "cloud", "local"];
  const COLOR_FILTERS = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#ec407a", "#795548", "#212121", "#f5f5f5"];
  function toolbar() {
    return `<div class="ph-toolbar">
      <div class="mu-chip-grid ph-filters" role="group" aria-label="${esc(t("filter"))}">${FILTERS.map((f) => `<button type="button" class="mu-chip" data-filter="${f}" aria-pressed="${filter === f}">${esc(t("filter_" + f))}</button>`).join("")}</div>
      <div class="ph-toolbar-end">
        <div class="mu-swatches ph-color-filter" role="group" aria-label="${esc(t("searchByColor"))}">${COLOR_FILTERS.map((c) => `<button type="button" class="mu-swatch" style="background:${c}" data-color="${c}" aria-pressed="${colorFilter === c}" aria-label="${esc(t("colorNamed", { color: c }))}"></button>`).join("")}</div>
        <div class="mu-slider ph-zoom"><label class="mu-slider-head" for="gridZoom"><span class="mu-icon" aria-hidden="true">zoom_in</span><span class="ph-sr-only">${esc(t("gridSize"))}</span></label><input id="gridZoom" class="mu-range" type="range" min="100" max="360" step="20" value="${settings.gridSize}" aria-label="${esc(t("gridSize"))}"></div>
        <button type="button" class="mu-btn mu-btn-ghost" id="sortBtn"><span class="mu-icon" aria-hidden="true">sort</span>${esc(t("sort"))}</button>
      </div></div>`;
  }
  function groupKey(p) {
    const d = new Date(takenAt(p));
    if (settings.groupBy === "year") return String(d.getFullYear());
    if (settings.groupBy === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function groupLabel(key) {
    if (settings.groupBy === "year") return key;
    if (settings.groupBy === "month") return fmtDate(`${key}-01T12:00:00`, { month: "long", year: "numeric" });
    const ms = Date.parse(`${key}T12:00:00`);
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const diff = Math.round((ms - today.getTime()) / DAY_MS);
    if (diff === 0 || diff === -1) return relative(ms);
    return fmtDate(ms, { weekday: "short", month: "long", day: "numeric", year: new Date(ms).getFullYear() === today.getFullYear() ? undefined : "numeric" });
  }
  function tile(p) {
    const state = uploads.get(p.id)?.entry.state === "active" ? "uploading" : p.cloud ? (p.data ? "backed" : "cloud") : "";
    return `<div class="ph-tile${selection.has(p.id) ? " is-selected" : ""}" data-id="${p.id}" style="--ph-color:${esc(p.color || "#444")}">
      <button type="button" class="ph-tile-open" data-open="${p.id}" aria-label="${esc(p.name)}${p.isVideo ? ", " + esc(t("video")) : ""}">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy" decoding="async">` : `<span class="ph-tile-placeholder" data-needs-thumb="${p.id}"><span class="mu-icon" aria-hidden="true">${p.isVideo ? "movie" : "image"}</span></span>`}</button>
      <label class="ph-tile-check mu-check" aria-label="${esc(t("selectItem", { name: p.name }))}"><input type="checkbox" data-select="${p.id}" ${selection.has(p.id) ? "checked" : ""}></label>
      <span class="ph-tile-badges" aria-hidden="true">${p.isVideo ? `<span class="ph-badge"><span class="mu-icon">play_arrow</span>${esc(duration(p.duration))}</span>` : ""}${p.favorite ? '<span class="ph-badge"><span class="mu-icon ph-filled">favorite</span></span>' : ""}${Number(p.rating) ? `<span class="ph-badge"><span class="mu-icon ph-filled">star</span>${num(p.rating)}</span>` : ""}${state ? `<span class="ph-badge"><span class="mu-icon">${{ uploading: "cloud_upload", backed: "cloud_done", cloud: "cloud" }[state]}</span></span>` : ""}</span>
    </div>`;
  }
  function updateTile(p) {
    const el = main.querySelector(`.ph-tile[data-id="${p.id}"]`);
    if (el) el.outerHTML = tile(p);
  }
  function renderLibrary() {
    const albumId = section.startsWith("album:") ? albumKey(section.slice(6)) : null;
    const album = albumId !== null ? albums.get(albumId) : null;
    const list = sorted([...photos.values()].filter((p) => (query ? !p.trashed && !p.locked && !p.archived : visibleIn(p)) && matchesQuery(p) && matchesFilter(p)), album?.sort);
    let head = "";
    if (album) head = albumHeader(album, list.length);
    else if (section === "trash") head = `<div class="mu-alert ph-banner"><span class="mu-icon" aria-hidden="true">info</span><div class="mu-alert-body"><span class="mu-alert-title">${esc(t("trashHelp", { n: num(settings.trashDays) }))}</span></div>${list.length ? `<button type="button" class="mu-btn mu-btn-danger-outline" id="emptyTrashBtn"><span class="mu-icon" aria-hidden="true">delete_sweep</span>${esc(t("emptyTrash"))}</button>` : ""}</div>`;
    else if (section === "locked") head = `<div class="mu-alert ph-banner"><span class="mu-icon" aria-hidden="true">lock</span><div class="mu-alert-body"><span class="mu-alert-title">${esc(t("lockedHelp"))}</span></div><button type="button" class="mu-btn" id="lockNowBtn"><span class="mu-icon" aria-hidden="true">lock</span>${esc(t("lockNow"))}</button><button type="button" class="mu-btn mu-btn-primary" id="lockedUploadBtn"><span class="mu-icon" aria-hidden="true">add</span>${esc(t("addToLocked"))}</button></div>`;
    else if (section === "library" && !query && settings.showMemories) head = memoryBanner();
    let body;
    if (!list.length) body = emptyState();
    else if (album?.sort === "name" || settings.sort === "name" || settings.sort === "size" || section === "trash") body = `<div class="ph-grid">${list.map(tile).join("")}</div>`;
    else {
      const groups = new Map();
      for (const p of list) { const k = groupKey(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
      body = [...groups].map(([k, items]) => `<section class="ph-group"><div class="ph-group-head"><h2>${esc(groupLabel(k))}</h2><button type="button" class="mu-btn mu-btn-ghost ph-group-select" data-select-group="${esc(k)}">${esc(t("selectAll"))}</button></div><div class="ph-grid">${items.map(tile).join("")}</div></section>`).join("");
    }
    main.innerHTML = `${head}${toolbar()}<div class="ph-content mu-scroll" id="phContent">${body}</div>`;
    fillMissingThumbs();
  }
  function emptyState() {
    const map = { trash: ["delete", "trashEmpty"], favorites: ["favorite", "favoritesEmpty"], archive: ["archive", "archiveEmpty"], locked: ["lock", "lockedEmpty"], videos: ["movie", "videosEmpty"], screenshots: ["screenshot_monitor", "screenshotsEmpty"] };
    const [icon, key] = query || filter !== "all" || colorFilter ? ["search_off", "noResults"] : map[section] || ["add_photo_alternate", "libraryEmpty"];
    return `<div class="mu-empty ph-empty"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${icon}</span></span><span>${esc(t(key))}</span>${["library", "favorites", "videos"].includes(section) || section.startsWith("album:") ? `<button type="button" class="mu-btn mu-btn-primary" data-action="upload"><span class="mu-icon" aria-hidden="true">upload</span>${esc(t("upload"))}</button>` : ""}</div>`;
  }
  let thumbWork = false;
  async function fillMissingThumbs() {
    if (thumbWork) return;
    thumbWork = true;
    try {
      for (const el of [...main.querySelectorAll("[data-needs-thumb]")]) {
        const p = photos.get(Number(el.dataset.needsThumb));
        if (!p || p.thumb) continue;
        try {
          const blob = await getBlob(p);
          Object.assign(p, await describeMedia(blob, p.isVideo));
          if (!p.size) p.size = blob.size;
          await putRecord(PHOTOS, p);
          updateTile(p);
        } catch {}
      }
    } finally { thumbWork = false; }
  }

  /* ---------------------------------------------------------- memories */
  function onThisDay() {
    const now = new Date();
    const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const byYear = new Map();
    for (const p of photos.values()) {
      if (!visibleIn(p, "library")) continue;
      const d = new Date(takenAt(p));
      if (d.getFullYear() >= now.getFullYear()) continue;
      if (`${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` !== md) continue;
      if (!byYear.has(d.getFullYear())) byYear.set(d.getFullYear(), []);
      byYear.get(d.getFullYear()).push(p);
    }
    return [...byYear].sort((a, b) => b[0] - a[0]);
  }
  function memoryBanner() {
    const memories = onThisDay();
    if (!memories.length) return "";
    return `<section class="ph-memories" aria-label="${esc(t("onThisDay"))}">${memories.map(([year, list]) => `<button type="button" class="ph-memory" data-memory="${year}" style="background-image:url('${esc(list[0].thumb || "")}')"><span class="ph-memory-text"><span>${esc(t("yearsAgo", { n: num(new Date().getFullYear() - year) }))}</span><span class="mu-muted">${esc(t("photosCount", { n: num(list.length) }))}</span></span></button>`).join("")}</section>`;
  }
  function renderMemories() {
    const memories = onThisDay();
    const months = new Map();
    for (const p of photos.values()) if (visibleIn(p, "library") && p.favorite) { const k = groupKey(Object.assign({}, p)); const m = k.slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m).push(p); }
    const best = [...months].sort((a, b) => b[0].localeCompare(a[0]));
    main.innerHTML = `<div class="ph-content mu-scroll ph-memories-page">
      <section class="ph-page-section"><h2 class="mu-h-title">${esc(t("onThisDay"))}</h2>${memories.length ? memories.map(([year, list]) => `<div class="ph-group"><div class="ph-group-head"><h3>${esc(t("yearsAgo", { n: num(new Date().getFullYear() - year) }))} · ${esc(fmtDate(takenAt(list[0]), { dateStyle: "long" }))}</h3><button type="button" class="mu-btn mu-btn-ghost" data-slideshow-ids="${list.map((p) => p.id).join(",")}"><span class="mu-icon" aria-hidden="true">slideshow</span>${esc(t("slideshow"))}</button></div><div class="ph-grid">${list.map(tile).join("")}</div></div>`).join("") : `<p class="mu-muted">${esc(t("noMemoriesToday"))}</p>`}</section>
      <section class="ph-page-section"><h2 class="mu-h-title">${esc(t("favoritesByMonth"))}</h2>${best.length ? best.map(([m, list]) => `<div class="ph-group"><div class="ph-group-head"><h3>${esc(fmtDate(`${m}-01T12:00:00`, { month: "long", year: "numeric" }))}</h3><button type="button" class="mu-btn mu-btn-ghost" data-slideshow-ids="${list.map((p) => p.id).join(",")}"><span class="mu-icon" aria-hidden="true">slideshow</span>${esc(t("slideshow"))}</button></div><div class="ph-grid">${list.map(tile).join("")}</div></div>`).join("") : `<p class="mu-muted">${esc(t("favoritesEmpty"))}</p>`}</section></div>`;
  }

  /* ---------------------------------------------------------- albums */
  function albumCover(a) {
    const cover = photos.get(a.cover) || sorted([...photos.values()].filter((p) => !p.trashed && !p.locked && (p.albums || []).map(String).includes(String(a.id))))[0];
    return cover?.thumb || (a.sharedWithMe ? Object.values(shared.get(a.spaceId)?.space.content.items || {}).find((i) => i.thumb && !i.deleted)?.thumb : "") || "";
  }
  function renderAlbums() {
    const list = [...albums.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const count = (a) => (a.sharedWithMe ? Object.values(shared.get(a.spaceId)?.space.content.items || {}).filter((i) => !i.deleted).length : [...photos.values()].filter((p) => !p.trashed && !p.locked && (p.albums || []).map(String).includes(String(a.id))).length);
    main.innerHTML = `<div class="ph-content mu-scroll"><div class="ph-albums-head"><button type="button" class="mu-btn mu-btn-primary" data-action="new-album"><span class="mu-icon" aria-hidden="true">add</span>${esc(t("newAlbum"))}</button></div>
      ${list.length ? `<div class="ph-album-grid">${list.map((a) => `<button type="button" class="ph-album-card mu-media-card" data-section-go="${a.sharedWithMe ? `shared:${esc(a.spaceId)}` : `album:${esc(a.id)}`}"><span class="ph-album-cover mu-media-card-media"${albumCover(a) ? ` style="background-image:url('${esc(albumCover(a))}')"` : ""}>${albumCover(a) ? "" : '<span class="mu-icon" aria-hidden="true">photo_album</span>'}${a.spaceId ? `<span class="ph-badge ph-album-shared"><span class="mu-icon" aria-hidden="true">group</span>${esc(a.sharedWithMe ? t("sharedBy", { name: a.ownerName || "" }) : t("shared"))}</span>` : ""}</span><span class="mu-media-card-body"><span class="ph-album-name">${esc(a.name)}</span><span class="mu-muted">${esc(t("photosCount", { n: num(count(a)) }))}</span></span></button>`).join("")}</div>` : `<div class="mu-empty ph-empty"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">photo_album</span></span><span>${esc(t("albumsEmpty"))}</span></div>`}</div>`;
  }
  function albumHeader(album, n) {
    return `<div class="ph-album-header"><div class="ph-album-header-text"><span class="mu-muted">${esc(t("photosCount", { n: num(n) }))}${album.spaceId ? " · " + esc(t("shared")) : ""}</span>${album.description ? `<p class="ph-album-desc">${esc(album.description)}</p>` : ""}</div>
      <div class="ph-album-actions"><button type="button" class="mu-btn" data-action="album-add"><span class="mu-icon" aria-hidden="true">add_photo_alternate</span>${esc(t("addPhotos"))}</button><button type="button" class="mu-btn" data-action="album-share"><span class="mu-icon" aria-hidden="true">${album.spaceId ? "group" : "share"}</span>${esc(t(album.spaceId ? "sharingDetails" : "shareAlbum"))}</button><button type="button" class="mu-btn" data-action="album-slideshow"><span class="mu-icon" aria-hidden="true">slideshow</span>${esc(t("slideshow"))}</button><button type="button" class="mu-icon-btn" data-action="album-menu" aria-label="${esc(t("albumOptions"))}"><span class="mu-icon" aria-hidden="true">more_vert</span></button></div></div>`;
  }
  async function createAlbum(name, photoIds = []) {
    const album = { id: uid(), uid: "", name, created: new Date().toISOString(), description: "", cover: null, sort: "newest", updatedAt: Date.now() };
    album.uid = album.id;
    try {
      await putRecord(ALBUMS, album);
      albums.set(album.id, album);
      for (const id of photoIds) { const p = photos.get(id); if (p && !(p.albums || []).includes(album.id)) { p.albums = [...(p.albums || []), album.id]; p.updatedAt = Date.now(); await putRecord(PHOTOS, p); } }
      A?.sync?.schedule?.(800);
      notify(t("albumCreated"), "success");
      return album;
    } catch { notify(t("errorCreateAlbum"), "error"); return null; }
  }
  async function newAlbumFlow(photoIds = []) {
    const name = await promptDialog({ icon: "photo_album", title: t("newAlbum"), label: t("albumName"), confirm: t("create") });
    if (!name) return null;
    const album = await createAlbum(name, photoIds);
    if (album) { render(); }
    return album;
  }
  async function addToAlbum(ids, album) {
    try {
      for (const id of ids) {
        const p = photos.get(id);
        if (!p || (p.albums || []).map(String).includes(String(album.id))) continue;
        p.albums = [...(p.albums || []), album.id];
        p.updatedAt = Date.now();
        await putRecord(PHOTOS, p);
      }
      album.updatedAt = Date.now();
      await putRecord(ALBUMS, album);
      if (album.spaceId) await pushToSharedAlbum(album, ids);
      A?.sync?.schedule?.(800);
      notify(t("addedToAlbum", { name: album.name }), "success");
      render();
    } catch { notify(t("errorGeneric"), "error"); }
  }
  function chooseAlbum(ids) {
    const list = [...albums.values()].filter((a) => !a.sharedWithMe || a.role === "edit");
    const d = dialog({ icon: "library_add", title: t("addToAlbum"), size: "md", body: `<div class="ph-choose-albums"><button type="button" class="mu-row ph-row-btn" data-new><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">add</span></span><span class="mu-row-info"><span class="mu-row-title">${esc(t("newAlbum"))}</span></span></button>${list.map((a) => `<button type="button" class="mu-row ph-row-btn" data-album="${esc(a.id)}"><span class="ph-mini-cover"${albumCover(a) ? ` style="background-image:url('${esc(albumCover(a))}')"` : ""}></span><span class="mu-row-info"><span class="mu-row-title">${esc(a.name)}</span>${a.spaceId ? `<span class="mu-row-subtitle">${esc(t("shared"))}</span>` : ""}</span></button>`).join("")}</div>` });
    d.modal.addEventListener("click", async (e) => {
      if (e.target.closest("[data-new]")) { d.close(); const album = await newAlbumFlow(ids); if (album?.spaceId) pushToSharedAlbum(album, ids); clearSelection(); return; }
      const b = e.target.closest("[data-album]");
      if (!b) return;
      const album = albums.get(b.dataset.album) || albums.get(Number(b.dataset.album));
      d.close();
      if (album.sharedWithMe) await addToRemoteAlbum(album, ids); else await addToAlbum(ids, album);
      clearSelection();
    });
  }
  function albumMenu(anchor, album) {
    menu(anchor, [
      { icon: "edit", label: t("renameAlbum"), action: async () => { const name = await promptDialog({ icon: "edit", title: t("renameAlbum"), label: t("albumName"), value: album.name, confirm: t("save") }); if (name) { album.name = name; await saveAlbum(album); } } },
      { icon: "notes", label: t("editDescription"), action: async () => { const text = await promptDialog({ icon: "notes", title: t("editDescription"), label: t("description"), value: album.description || "", confirm: t("save"), multiline: true }); if (text !== null) { album.description = text; await saveAlbum(album); } } },
      { icon: "sort", label: t("sortAlbum"), action: () => menu(anchor, ["newest", "oldest", "name"].map((s) => ({ icon: album.sort === s ? "check" : "", label: t("albumSort_" + s), action: async () => { album.sort = s; await saveAlbum(album); } }))) },
      { icon: "download", label: t("downloadZip"), action: () => exportZip([...photos.values()].filter((p) => (p.albums || []).map(String).includes(String(album.id)) && !p.trashed)) },
      "-",
      { icon: "delete", label: t("deleteAlbum"), danger: true, action: () => deleteAlbum(album) },
    ]);
  }
  async function saveAlbum(album) {
    album.updatedAt = Date.now();
    try {
      await putRecord(ALBUMS, album);
      if (album.spaceId && album.role === "owner") await shared.get(album.spaceId)?.space.update((c) => { c.meta = Object.assign({}, c.meta, { name: album.name, description: album.description || "" }); });
      A?.sync?.schedule?.(800);
      render();
    } catch { notify(t("errorGeneric"), "error"); }
  }
  async function deleteAlbum(album) {
    if (!(await confirmDialog({ icon: "delete", title: t("deleteAlbum"), text: t("deleteAlbumConfirm", { name: album.name }), confirm: t("delete"), danger: true }))) return;
    try {
      if (album.spaceId) { await shared.get(album.spaceId)?.space.remove().catch(() => {}); shared.delete(album.spaceId); }
      for (const p of photos.values()) if ((p.albums || []).map(String).includes(String(album.id))) { p.albums = p.albums.filter((id) => String(id) !== String(album.id)); await putRecord(PHOTOS, p); }
      await deleteRecord(ALBUMS, album.id);
      albums.delete(album.id);
      A?.sync?.schedule?.(800);
      go("albums");
      notify(t("albumDeleted"), "success");
    } catch { notify(t("errorGeneric"), "error"); }
  }

  /* ================================================================ shared albums with collaborators */
  const sharedItem = (p, ref, me) => ({ photoId: p.cloudId, blobId: ref.blobId, key: ref.key, iv: ref.iv, chunkSize: ref.chunkSize, plainChunk: ref.plainChunk, plainSize: ref.plainSize, chunkCount: ref.chunkCount, name: p.name, type: p.type, isVideo: Boolean(p.isVideo), takenAt: p.takenAt || p.date, width: p.width, height: p.height, duration: p.duration || 0, thumb: p.thumb, caption: p.notes || "", addedBy: String(me?.id || ""), addedByName: me?.displayName || String(me?.email || "").split("@")[0], updatedAt: Date.now() });
  async function ensureUploaded(p) {
    if (p.cloud) return p.cloud;
    const blob = await getBlob(p);
    const entry = ensureTray().add({ name: p.name, icon: p.isVideo ? "movie" : "image" });
    try {
      const ref = await Cloud.uploadBlob(blob, { onProgress: (s, total) => entry.progress(total ? s / total : 1, t("uploadProgress", { done: bytes(s), total: bytes(total) })) });
      p.cloud = Object.assign(ref, { uploadedAt: Date.now() });
      p.updatedAt = Date.now();
      await putRecord(PHOTOS, p);
      entry.done(t("uploaded"));
      setTimeout(() => entry.remove(), 5000);
      return p.cloud;
    } catch (error) { entry.fail(Cloud.errorText(error, t("errorUpload"), t)); throw error; }
  }
  async function pushToSharedAlbum(album, ids) {
    const info = shared.get(album.spaceId);
    if (!info) return;
    const me = A.state.account;
    for (const id of ids) {
      const p = photos.get(id);
      if (!p) continue;
      try {
        const ref = await ensureUploaded(p);
        await info.space.linkBlob(ref.blobId);
        await info.space.update((c) => { c.items = c.items || {}; c.items[p.cloudId] = sharedItem(p, ref, me); });
      } catch (error) { notify(Cloud.errorText(error, t("errorUpload"), t), "error"); }
    }
  }
  async function shareAlbum(album) {
    if (!signedIn()) return requireSignIn();
    try {
      let info = album.spaceId ? shared.get(album.spaceId) : null;
      if (album.spaceId && !info) { attachShared(album, await Cloud.Space.open(album.spaceId)); info = shared.get(album.spaceId); }
      if (!info) {
        const space = await Cloud.Space.create("album", { meta: { name: album.name, description: album.description || "" }, items: {} });
        album.spaceId = space.id; album.role = "owner"; album.updatedAt = Date.now();
        await putRecord(ALBUMS, album);
        attachShared(album, space);
        info = shared.get(space.id);
        const ids = [...photos.values()].filter((p) => (p.albums || []).map(String).includes(String(album.id)) && !p.trashed && !p.locked).map((p) => p.id);
        pushToSharedAlbum(album, ids).then(render);
        A?.sync?.schedule?.(800);
        render();
      }
      await Cloud.openShareDialog({
        space: info.space, kind: "album", title: album.name, t, me: A.state.account,
        onStop: async () => {
          if (!(await confirmDialog({ icon: "link_off", title: t("stopSharing"), text: t("stopSharingAlbumConfirm", { name: album.name }), confirm: t("stopSharing"), danger: true }))) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
          await info.space.remove();
          shared.delete(album.spaceId);
          delete album.spaceId; delete album.role; album.updatedAt = Date.now();
          await putRecord(ALBUMS, album);
          A?.sync?.schedule?.(800);
          render();
          notify(t("sharingStopped"), "success");
        },
        onLeave: () => leaveSharedAlbum(album),
      });
    } catch (error) {
      if (error?.code === "cancelled") return;
      notify(error?.code === "offline" ? t("errorOffline") : t("errorShareAlbum"), "error");
    }
  }
  function attachShared(album, space) {
    shared.set(space.id, { space, album });
    album.role = space.role;
    if (album.sharedWithMe) { album.name = space.content.meta?.name || album.name; album.description = space.content.meta?.description || ""; }
    space.watch((event) => {
      if (event.type === "content" || event.type === "role") {
        if (album.sharedWithMe) { album.name = space.content.meta?.name || album.name; album.description = space.content.meta?.description || ""; album.role = space.role; }
        if (section === `shared:${space.id}` || section === "albums" || section === `album:${album.id}`) render(); else renderAlbumNav();
      }
      if ((event.type === "revoked" || event.type === "deleted") && album.sharedWithMe) {
        shared.delete(space.id); albums.delete(album.id);
        if (section === `shared:${space.id}`) go("albums");
        else render();
        notify(t("albumAccessRemoved", { name: album.name }), "info");
      }
    });
  }
  async function loadSharedAlbums() {
    if (!signedIn() || navigator.onLine === false) return;
    let list;
    try { list = await Cloud.Space.list("album"); } catch (error) { if (error.status !== 401) notify(t("errorLoadShared"), "error"); return; }
    for (const album of [...albums.values()].filter((a) => a.spaceId && !a.sharedWithMe)) {
      if (shared.has(album.spaceId)) continue;
      if (!list.some((s) => s.id === album.spaceId)) { delete album.spaceId; delete album.role; putRecord(ALBUMS, album).catch(() => {}); continue; }
      try { attachShared(album, await Cloud.Space.open(album.spaceId)); } catch {}
    }
    for (const info of list.filter((s) => s.role !== "owner")) {
      if (shared.has(info.id)) continue;
      try {
        const space = await Cloud.Space.open(info.id);
        const album = { id: `space-${info.id}`, uid: `space-${info.id}`, name: space.content.meta?.name || "", spaceId: info.id, role: info.role, ownerName: info.owner?.name || "", sharedWithMe: true, updatedAt: info.updatedAt };
        albums.set(album.id, album);
        attachShared(album, space);
      } catch {}
    }
    render();
    restorePendingMedia();
  }
  function renderShared(spaceId) {
    const info = shared.get(spaceId);
    if (!info) { main.innerHTML = `<div class="mu-empty ph-empty"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">cloud_off</span></span><span>${esc(t("errorLoadShared"))}</span></div>`; return; }
    const { space, album } = info;
    const items = Object.values(space.content.items || {}).filter((i) => !i.deleted).sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
    const canAdd = space.role === "edit" || space.role === "owner";
    main.innerHTML = `<div class="ph-album-header"><div class="ph-album-header-text"><span class="mu-muted">${esc(t("photosCount", { n: num(items.length) }))} · ${esc(t("sharedBy", { name: space.owner?.name || album.ownerName || "" }))}</span>${album.description ? `<p class="ph-album-desc">${esc(album.description)}</p>` : ""}</div>
      <div class="ph-album-actions">${canAdd ? `<button type="button" class="mu-btn" data-action="remote-add"><span class="mu-icon" aria-hidden="true">add_photo_alternate</span>${esc(t("addPhotos"))}</button>` : ""}<button type="button" class="mu-btn" data-action="remote-share"><span class="mu-icon" aria-hidden="true">group</span>${esc(t("sharingDetails"))}</button><button type="button" class="mu-btn mu-btn-danger-outline" data-action="remote-leave"><span class="mu-icon" aria-hidden="true">logout</span>${esc(t("leaveAlbum"))}</button></div></div>
      <div class="ph-content mu-scroll">${items.length ? `<div class="ph-grid">${items.map((i) => `<div class="ph-tile"><button type="button" class="ph-tile-open" data-remote="${esc(i.photoId)}" aria-label="${esc(i.name)}">${i.thumb ? `<img src="${esc(i.thumb)}" alt="" loading="lazy">` : `<span class="ph-tile-placeholder"><span class="mu-icon" aria-hidden="true">image</span></span>`}</button><span class="ph-tile-badges" aria-hidden="true">${i.isVideo ? `<span class="ph-badge"><span class="mu-icon">play_arrow</span>${esc(duration(i.duration))}</span>` : ""}<span class="ph-badge ph-badge-person">${esc(i.addedByName || "")}</span></span></div>`).join("")}</div>` : `<div class="mu-empty ph-empty"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">photo_album</span></span><span>${esc(t("sharedAlbumEmpty"))}</span></div>`}</div>`;
  }
  async function addToRemoteAlbum(album, ids) {
    const info = shared.get(album.spaceId);
    if (!info) return;
    const me = A.state.account;
    for (const id of ids) {
      const p = photos.get(id);
      if (!p) continue;
      try {
        const ref = await ensureUploaded(p);
        await info.space.linkBlob(ref.blobId);
        await info.space.update((c) => { c.items = c.items || {}; c.items[p.cloudId] = sharedItem(p, ref, me); });
      } catch (error) { notify(Cloud.errorText(error, t("errorUpload"), t), "error"); }
    }
    notify(t("addedToAlbum", { name: album.name }), "success");
    render();
  }
  async function leaveSharedAlbum(album) {
    const info = shared.get(album.spaceId);
    if (!(await confirmDialog({ icon: "logout", title: t("leaveAlbum"), text: t("leaveAlbumConfirm", { name: album.name }), confirm: t("leave"), danger: true }))) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
    await info.space.remove();
    shared.delete(album.spaceId); albums.delete(album.id);
    go("albums");
    notify(t("leftAlbum"), "success");
  }
  // Remote items from a shared album look like records to the viewer.
  function remoteRecord(item, spaceId) {
    return { id: `remote:${spaceId}:${item.photoId}`, remote: { blobId: item.blobId, key: item.key, iv: item.iv, chunkSize: item.chunkSize, plainChunk: item.plainChunk, plainSize: item.plainSize, chunkCount: item.chunkCount }, name: item.name, type: item.type, isVideo: item.isVideo, takenAt: item.takenAt, width: item.width, height: item.height, thumb: item.thumb, notes: item.caption, size: item.plainSize, addedByName: item.addedByName, addedBy: item.addedBy, spaceId, photoId: item.photoId, readOnly: true };
  }

  /* ================================================================ viewer */
  let viewer = null;
  async function openViewer(id, list = currentIds(), updateURL = true) {
    const ids = list.includes(id) ? list : [id];
    const index = ids.indexOf(id);
    if (!recordFor(id)) return;
    closeViewer(false);
    const el = document.createElement("div");
    el.className = "ph-viewer";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", t("photoViewer"));
    el.innerHTML = `<header class="ph-viewer-bar mu-glass mu-glass-solid">
        <button type="button" class="mu-icon-btn" data-v="close" aria-label="${esc(t("back"))}"><span class="mu-icon" aria-hidden="true">arrow_back</span></button>
        <span class="ph-viewer-title"></span>
        <div class="ph-viewer-tools"></div>
      </header>
      <div class="ph-stage" tabindex="0"><div class="ph-stage-inner"></div>
        <button type="button" class="mu-icon-btn ph-nav-prev" data-v="prev" aria-label="${esc(t("previous"))}"><span class="mu-icon" aria-hidden="true">chevron_left</span></button>
        <button type="button" class="mu-icon-btn ph-nav-next" data-v="next" aria-label="${esc(t("next"))}"><span class="mu-icon" aria-hidden="true">chevron_right</span></button>
        <div class="ph-zoom-level mu-glass" aria-live="polite" hidden></div>
      </div>
      <aside class="mu-side-panel ph-info" hidden aria-label="${esc(t("info"))}"></aside>`;
    document.body.appendChild(el);
    document.body.classList.add("ph-viewer-open");
    viewer = { el, ids, index, url: null, zoom: 1, x: 0, y: 0, record: null, returnFocus: document.activeElement };
    const stage = el.querySelector(".ph-stage");
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      const action = b.dataset.v;
      if (action === "close") closeViewer();
      else if (action === "prev") show(viewer.index - 1);
      else if (action === "next") show(viewer.index + 1);
      else viewerAction(action, b);
    });
    // Zoom and pan
    stage.addEventListener("wheel", (e) => { if (!viewer.record || viewer.record.isVideo) return; e.preventDefault(); setZoom(viewer.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    stage.addEventListener("dblclick", (e) => { if (e.target.closest("button, video")) return; setZoom(viewer.zoom > 1 ? 1 : 2.5); });
    let drag = null;
    stage.addEventListener("pointerdown", (e) => { if (viewer.zoom <= 1 || e.target.closest("button")) return; drag = { x: e.clientX - viewer.x, y: e.clientY - viewer.y }; stage.setPointerCapture(e.pointerId); stage.classList.add("is-panning"); });
    stage.addEventListener("pointermove", (e) => { if (!drag) return; viewer.x = e.clientX - drag.x; viewer.y = e.clientY - drag.y; applyTransform(); });
    stage.addEventListener("pointerup", () => { drag = null; stage.classList.remove("is-panning"); });
    let touchX = null;
    stage.addEventListener("touchstart", (e) => { if (e.touches.length === 1 && viewer.zoom <= 1) touchX = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener("touchend", (e) => { if (touchX === null) return; const dx = e.changedTouches[0].clientX - touchX; touchX = null; if (Math.abs(dx) > 60) show(viewer.index + (dx < 0 ? 1 : -1) * (document.dir === "rtl" ? -1 : 1)); });
    el.addEventListener("keydown", viewerKeys);
    await show(index, updateURL ? "open" : null);
    if (viewer?.el === el) stage.focus();
  }
  function recordFor(id) {
    if (typeof id === "string" && id.startsWith("remote:")) {
      const [, spaceId, photoId] = id.split(":");
      const item = shared.get(spaceId)?.space.content.items?.[photoId];
      return item && !item.deleted ? remoteRecord(item, spaceId) : null;
    }
    return photos.get(id);
  }
  async function show(i, routeAction = "replace") {
    if (!viewer) return;
    const { ids } = viewer;
    if (i < 0 || i >= ids.length) return;
    viewer.index = i;
    const record = recordFor(ids[i]);
    if (!record) return;
    viewer.record = record;
    if (routeAction) updateMediaPath(record, routeAction);
    viewer.zoom = 1; viewer.x = 0; viewer.y = 0;
    const el = viewer.el;
    el.querySelector(".ph-viewer-title").textContent = record.name;
    el.querySelector(".ph-nav-prev").hidden = i === 0;
    el.querySelector(".ph-nav-next").hidden = i === ids.length - 1;
    renderViewerTools();
    const inner = el.querySelector(".ph-stage-inner");
    inner.innerHTML = `${record.thumb ? `<img class="ph-stage-media ph-stage-preview" src="${esc(record.thumb)}" alt="">` : ""}<div class="ph-stage-loading" role="status"><div class="mu-progress" aria-label="${esc(t("loading"))}"><span style="width:0%"></span></div></div>`;
    if (viewer.url) { URL.revokeObjectURL(viewer.url); viewer.url = null; }
    try {
      const blob = await getBlob(record, { onProgress: (got, total) => { const bar = inner.querySelector(".ph-stage-loading .mu-progress span"); if (bar && total) bar.style.width = `${Math.round(got / total * 100)}%`; } });
      if (!viewer || viewer.record !== record) return;
      viewer.url = URL.createObjectURL(blob);
      inner.style.setProperty("--ar", record.width && record.height ? record.width / record.height : 16 / 9);
      inner.innerHTML = record.isVideo
        ? `<video class="ph-stage-media ph-stage-video" src="${viewer.url}" autoplay playsinline title="${esc(record.name)}"></video>`
        : `<img class="ph-stage-media" src="${viewer.url}" alt="${esc(record.notes || record.name)}" draggable="false">`;
      const video = inner.querySelector("video");
      if (video) {
        video.addEventListener("loadedmetadata", () => { if (video.videoWidth && video.videoHeight) inner.style.setProperty("--ar", video.videoWidth / video.videoHeight); }, { once: true });
        window.OmniVideoPlayer?.upgrade(video);
      }
      applyTransform();
    } catch {
      if (!viewer || viewer.record !== record) return;
      inner.querySelector(".ph-stage-loading")?.remove();
      notify(t("errorOpenPhoto"), "error");
    }
    if (!viewer.el.querySelector(".ph-info").hidden) renderInfo();
  }
  function renderViewerTools() {
    const r = viewer.record;
    const ro = r.readOnly;
    viewer.el.querySelector(".ph-viewer-tools").innerHTML = `
      ${!ro && !r.trashed ? `<button type="button" class="mu-icon-btn" data-v="favorite" aria-pressed="${Boolean(r.favorite)}" aria-label="${esc(t(r.favorite ? "unfavorite" : "favorite"))}" title="${esc(t(r.favorite ? "unfavorite" : "favorite"))}"><span class="mu-icon${r.favorite ? " ph-filled" : ""}" aria-hidden="true">favorite</span></button>` : ""}
      <button type="button" class="mu-icon-btn" data-v="info" aria-label="${esc(t("info"))}" title="${esc(t("info"))}"><span class="mu-icon" aria-hidden="true">info</span></button>
      ${!ro && !r.isVideo && !r.trashed ? `<button type="button" class="mu-icon-btn" data-v="edit" aria-label="${esc(t("edit"))}" title="${esc(t("edit"))}"><span class="mu-icon" aria-hidden="true">tune</span></button>` : ""}
      ${!ro && !r.trashed ? `<button type="button" class="mu-icon-btn" data-v="album" aria-label="${esc(t("addToAlbum"))}" title="${esc(t("addToAlbum"))}"><span class="mu-icon" aria-hidden="true">library_add</span></button>` : ""}
      <button type="button" class="mu-icon-btn" data-v="download" aria-label="${esc(t("download"))}" title="${esc(t("download"))}"><span class="mu-icon" aria-hidden="true">download</span></button>
      ${r.trashed ? `<button type="button" class="mu-btn" data-v="restore"><span class="mu-icon" aria-hidden="true">restore</span>${esc(t("restore"))}</button>` : ""}
      ${!ro || r.addedBy === String(A?.state?.account?.id || "") || shared.get(r.spaceId)?.space.role === "owner" ? `<button type="button" class="mu-icon-btn" data-v="delete" aria-label="${esc(t(r.trashed ? "deleteForever" : ro ? "removeFromAlbum" : "delete"))}" title="${esc(t(r.trashed ? "deleteForever" : ro ? "removeFromAlbum" : "delete"))}" data-mu-danger><span class="mu-icon" aria-hidden="true">${r.trashed ? "delete_forever" : ro ? "remove_circle" : "delete"}</span></button>` : ""}
      <button type="button" class="mu-icon-btn" data-v="more" aria-label="${esc(t("moreOptions"))}" title="${esc(t("moreOptions"))}"><span class="mu-icon" aria-hidden="true">more_vert</span></button>`;
  }
  function setZoom(z) {
    if (!viewer) return;
    viewer.zoom = Math.max(1, Math.min(8, z));
    if (viewer.zoom === 1) { viewer.x = 0; viewer.y = 0; }
    applyTransform();
    const level = viewer.el.querySelector(".ph-zoom-level");
    level.hidden = viewer.zoom === 1;
    level.textContent = `${Math.round(viewer.zoom * 100)}%`;
  }
  function applyTransform() {
    const media = viewer?.el.querySelector("img.ph-stage-media:not(.ph-stage-preview)");
    if (media) media.style.transform = `translate(${viewer.x}px, ${viewer.y}px) scale(${viewer.zoom})`;
  }
  function viewerKeys(e) {
    if (e.target.closest("input, textarea, .mu-side-panel select")) return;
    const map = { arrowleft: () => show(viewer.index + (document.dir === "rtl" ? 1 : -1)), arrowright: () => show(viewer.index + (document.dir === "rtl" ? -1 : 1)), escape: closeViewer, f: () => viewerAction("favorite"), i: () => viewerAction("info"), e: () => viewerAction("edit"), delete: () => viewerAction("delete"), "+": () => setZoom(viewer.zoom * 1.25), "=": () => setZoom(viewer.zoom * 1.25), "-": () => setZoom(viewer.zoom / 1.25), 0: () => setZoom(1) };
    const fn = map[e.key.toLowerCase()];
    if (fn && !document.querySelector(".mu-modal:not([hidden])")) { e.preventDefault(); fn(); }
    if (/^[1-5]$/.test(e.key) && e.altKey) { e.preventDefault(); setRating(viewer.record, Number(e.key)); }
  }
  function closeViewer(updateURL = true) {
    if (!viewer) return;
    if (viewer.url) URL.revokeObjectURL(viewer.url);
    viewer.el.remove();
    document.body.classList.remove("ph-viewer-open");
    const back = viewer.returnFocus;
    viewer = null;
    back?.focus?.();
    if (!updateURL || !Routes.parse(location.pathname)?.media) return;
    if (history.state?.photosReturnSection) history.back();
    else history.replaceState(null, "", Routes.sectionPath(section));
  }
  async function viewerAction(action, anchor) {
    const r = viewer?.record;
    if (!r) return;
    if (action === "favorite" && !r.readOnly) { await updatePhoto(r, { favorite: !r.favorite }); renderViewerTools(); }
    else if (action === "info") { const panel = viewer.el.querySelector(".ph-info"); panel.hidden = !panel.hidden; if (!panel.hidden) renderInfo(); }
    else if (action === "edit" && !r.readOnly && !r.isVideo) openEditor(r);
    else if (action === "album" && !r.readOnly) chooseAlbum([r.id]);
    else if (action === "download") openExport([r]);
    else if (action === "restore") { await restoreItems([r.id]); closeViewer(); }
    else if (action === "delete") {
      if (r.readOnly) return removeRemote(r);
      if (r.trashed) { if (await confirmDialog({ icon: "delete_forever", title: t("deleteForever"), text: t("deleteForeverConfirm", { n: num(1) }), confirm: t("deleteForever"), danger: true })) { await purge([r.id]); nextAfterRemoval(); } }
      else { await trash([r.id]); nextAfterRemoval(); }
    } else if (action === "more") {
      const items = r.readOnly
        ? [{ icon: "save_alt", label: t("saveToLibrary"), action: () => saveRemoteToLibrary(r) }, { icon: "content_copy", label: t("copyImage"), action: () => copyImage(r) }]
        : [
          { icon: "slideshow", label: t("slideshow"), action: () => { const ids = viewer.ids; const start = viewer.index; closeViewer(); startSlideshow(ids, start); } },
          !r.isVideo && { icon: "content_copy", label: t("copyImage"), action: () => copyImage(r) },
          { icon: "drive_file_rename_outline", label: t("rename"), action: async () => { const name = await promptDialog({ icon: "drive_file_rename_outline", title: t("rename"), label: t("name"), value: r.name, confirm: t("save") }); if (name) { await updatePhoto(r, { name }); viewer.el.querySelector(".ph-viewer-title").textContent = name; } } },
          { icon: "compare", label: t("compare"), action: () => pickCompare(r) },
          { icon: "library_add", label: t("duplicate"), action: () => duplicatePhoto(r) },
          section.startsWith("album:") && { icon: "image", label: t("setAsCover"), action: async () => { const album = albums.get(albumKey(section.slice(6))); album.cover = r.id; await saveAlbum(album); notify(t("coverSet"), "success"); } },
          section.startsWith("album:") && { icon: "remove_circle", label: t("removeFromAlbum"), action: () => removeFromAlbum([r.id]) },
          r.cloud && r.data && { icon: "cloud_done", label: t("backedUp"), action: () => {} },
          r.cloud && !r.data && { icon: "download_for_offline", label: t("keepOnDevice"), action: () => keepOnDevice(r) },
          !r.cloud && signedIn() && !r.locked && { icon: "cloud_upload", label: t("backUpNow"), action: () => queueUpload(r, { force: true }) },
          { icon: r.archived ? "unarchive" : "archive", label: t(r.archived ? "unarchive" : "archive"), action: async () => { await updatePhoto(r, { archived: !r.archived }); nextAfterRemoval(); } },
          { icon: r.locked ? "lock_open" : "lock", label: t(r.locked ? "removeFromLocked" : "moveToLocked"), action: () => moveToLocked([r.id], !r.locked).then(nextAfterRemoval) },
        ];
      menu(anchor, items);
    }
  }
  function nextAfterRemoval() {
    if (!viewer) return;
    const ids = currentIds();
    if (!ids.length) return closeViewer();
    viewer.ids = ids;
    show(Math.min(viewer.index, ids.length - 1));
    render();
  }
  function renderInfo() {
    const r = viewer.record, panel = viewer.el.querySelector(".ph-info");
    const ro = r.readOnly;
    const exif = r.exif || {};
    const line = (icon, title, sub) => (title ? `<div class="mu-row ph-info-row"><span class="mu-icon" aria-hidden="true">${icon}</span><div class="mu-row-info"><span class="mu-row-title">${esc(title)}</span>${sub ? `<span class="mu-row-subtitle">${esc(sub)}</span>` : ""}</div></div>` : "");
    const camera = [exif.make, exif.model].filter(Boolean).join(" ").replace(/^(\w+) \1/i, "$1");
    const exposure = [exif.fNumber ? `ƒ/${Number(exif.fNumber).toFixed(1)}` : "", exif.exposure ? (exif.exposure < 1 ? `1/${Math.round(1 / exif.exposure)}` : `${exif.exposure}s`) : "", exif.focal ? `${Math.round(exif.focal)} mm` : "", exif.iso ? `ISO ${exif.iso}` : ""].filter(Boolean).join(" · ");
    panel.innerHTML = `<div class="mu-sheet-grip" aria-hidden="true"></div>
      <div class="mu-side-panel-header"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">info</span></span><h2>${esc(t("info"))}</h2><button type="button" class="mu-icon-btn mu-icon-btn-soft" data-info-close aria-label="${esc(t("close"))}"><span class="mu-icon" aria-hidden="true">close</span></button></div>
      ${ro ? `<p class="ph-caption-ro">${esc(r.notes || "")}</p>` : `<label class="mu-field"><span class="mu-field-label">${esc(t("caption"))}</span><textarea class="mu-textarea" rows="2" data-info="notes" placeholder="${esc(t("addCaption"))}">${esc(r.notes || "")}</textarea></label>`}
      ${!ro ? `<div class="mu-field"><span class="mu-field-label">${esc(t("rating"))}</span><div class="mu-rating" role="radiogroup" aria-label="${esc(t("rating"))}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= (r.rating || 0) ? "is-on" : ""}" role="radio" aria-checked="${n === r.rating}" data-rate="${n}" aria-label="${esc(t("stars", { n: num(n) }))}"><span class="mu-icon" aria-hidden="true">star</span></button>`).join("")}</div></div>
      <div class="mu-field"><span class="mu-field-label">${esc(t("tags"))}</span><div class="mu-tags">${(r.tags || []).map((tag) => `<span class="mu-tag">${esc(tag)}<button type="button" data-untag="${esc(tag)}" aria-label="${esc(t("removeTag", { tag }))}"><span class="mu-icon" aria-hidden="true">close</span></button></span>`).join("")}</div><input class="mu-input" data-info="tag" placeholder="${esc(t("addTag"))}" aria-label="${esc(t("addTag"))}"></div>` : ""}
      <div class="mu-group ph-info-group">
        ${line("calendar_today", fmtDate(takenAt(r), { dateStyle: "full" }), meridiem(fmtDate(takenAt(r), { timeStyle: "short" })))}
        ${line(r.isVideo ? "movie" : "image", r.name, [r.width && r.height ? `${num(r.width)} × ${num(r.height)}` : "", bytes(size(r)), r.isVideo ? duration(r.duration) : ""].filter(Boolean).join(" · "))}
        ${line("photo_camera", camera, [exif.lens, exposure].filter(Boolean).join(" · "))}
        ${exif.lat != null && exif.lon != null ? line("location_on", `${Number(exif.lat).toFixed(4)}, ${Number(exif.lon).toFixed(4)}`, t("locationHelp")) : ""}
        ${ro ? line("person", t("addedBy", { name: r.addedByName || "" })) : line(r.cloud ? (r.data ? "cloud_done" : "cloud") : "smartphone", t(r.cloud ? (r.data ? "backedUp" : "cloudOnly") : "onThisDevice"), r.cloud?.uploadedAt ? fmtDateTime(r.cloud.uploadedAt) : t("encryptedOnDevice"))}
        ${r.editedAt ? line("tune", t("edited"), fmtDateTime(r.editedAt)) : ""}
        ${(r.albums || []).length ? line("photo_album", r.albums.map((id) => albums.get(id)?.name).filter(Boolean).join(", ")) : ""}
      </div>`;
    panel.querySelector("[data-info-close]").addEventListener("click", () => { panel.hidden = true; });
    panel.querySelector('[data-info="notes"]')?.addEventListener("change", (e) => updatePhoto(r, { notes: e.target.value.trim() }));
    panel.querySelector('[data-info="tag"]')?.addEventListener("keydown", async (e) => { if (e.key !== "Enter") return; const tag = e.target.value.trim(); if (!tag) return; await updatePhoto(r, { tags: [...new Set([...(r.tags || []), tag])] }); renderInfo(); panel.querySelector('[data-info="tag"]').focus(); });
    panel.onclick = async (e) => {
      const rate = e.target.closest("[data-rate]");
      if (rate) { await setRating(r, Number(rate.dataset.rate) === r.rating ? 0 : Number(rate.dataset.rate)); renderInfo(); }
      const untag = e.target.closest("[data-untag]");
      if (untag) { await updatePhoto(r, { tags: (r.tags || []).filter((x) => x !== untag.dataset.untag) }); renderInfo(); }
    };
  }
  async function setRating(r, n) { if (!r.readOnly) await updatePhoto(r, { rating: n }); }
  async function updatePhoto(r, patch) {
    Object.assign(r, patch, { updatedAt: Date.now() });
    try {
      await putRecord(PHOTOS, r);
      A?.sync?.schedule?.(800);
      for (const info of shared.values()) if (info.space.role !== "view" && info.space.content.items?.[r.cloudId] && ("notes" in patch || "name" in patch)) info.space.update((c) => { Object.assign(c.items[r.cloudId], { caption: r.notes || "", name: r.name, updatedAt: Date.now() }); }).catch(() => {});
      if (!viewer) render(); else { renderCounts(); updateTile(r); }
    } catch { notify(t("errorSavePhoto"), "error"); }
  }
  const currentIds = () => [...main.querySelectorAll(".ph-tile-open[data-open], .ph-tile-open[data-remote]")].map((el) => el.dataset.open ? Number(el.dataset.open) : `remote:${section.slice(7)}:${el.dataset.remote}`);
  async function removeRemote(r) {
    const info = shared.get(r.spaceId);
    if (!info) return;
    try {
      await info.space.update((c) => { delete c.items[r.photoId]; });
      await info.space.unlinkBlob(r.remote.blobId);
      nextAfterRemoval();
    } catch { notify(t("errorGeneric"), "error"); }
  }
  async function saveRemoteToLibrary(r) {
    try {
      const blob = await getBlob(r);
      await importFiles([new File([blob], r.name, { type: r.type })]);
    } catch { notify(t("errorDownload"), "error"); }
  }
  async function copyImage(r) {
    try {
      const blob = await getBlob(r);
      let png = blob;
      if (blob.type !== "image/png") {
        const { img, url } = await loadImage(blob);
        const canvas = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
        canvas.getContext("2d").drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      notify(t("copied"), "success");
    } catch { notify(t("errorCopy"), "error"); }
  }
  async function duplicatePhoto(r) {
    try {
      const blob = await getBlob(r);
      const [copy] = await importFiles([new File([blob], r.name.replace(/(\.\w+)?$/, ` (${t("copy")})$1`), { type: r.type })], { quiet: true });
      if (copy) { await updatePhoto(copy, { favorite: r.favorite, tags: [...(r.tags || [])], notes: r.notes || "", albums: [...(r.albums || [])], takenAt: r.takenAt, originalPhotoId: r.id }); notify(t("duplicated"), "success"); }
    } catch { notify(t("errorSavePhoto"), "error"); }
  }

  /* ================================================================ selection and bulk actions */
  function toggleSelect(id, on, { range = false } = {}) {
    if (range && lastSelected !== null) {
      const ids = currentIds().filter((x) => typeof x === "number");
      const [a, b] = [ids.indexOf(lastSelected), ids.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) ids.slice(a, b + 1).forEach((x) => selection.add(x));
    } else if (on ?? !selection.has(id)) selection.add(id); else selection.delete(id);
    lastSelected = id;
    syncSelection();
  }
  function syncSelection() {
    const n = selection.size;
    $("actionBar").hidden = n === 0;
    $("selectionCount").textContent = t("selectedCount", { n: num(n) });
    const inTrash = section === "trash";
    document.querySelectorAll("[data-bulk]").forEach((b) => {
      const k = b.dataset.bulk;
      if (k === "restore") b.hidden = !inTrash;
      else if (["favorite", "album", "archive", "lock", "collage"].includes(k)) b.hidden = inTrash;
      if (k === "compare") b.hidden = n !== 2;
      if (k === "archive") { b.querySelector(".mu-icon").textContent = section === "archive" ? "unarchive" : "archive"; b.setAttribute("aria-label", t(section === "archive" ? "unarchive" : "archive")); b.title = b.getAttribute("aria-label"); }
      if (k === "lock") { b.querySelector(".mu-icon").textContent = section === "locked" ? "lock_open" : "lock"; b.setAttribute("aria-label", t(section === "locked" ? "removeFromLocked" : "moveToLocked")); b.title = b.getAttribute("aria-label"); }
    });
    main.querySelectorAll(".ph-tile[data-id]").forEach((el) => { const on = selection.has(Number(el.dataset.id)); el.classList.toggle("is-selected", on); const c = el.querySelector("[data-select]"); if (c) c.checked = on; });
    document.body.classList.toggle("is-selecting", selectMode || n > 0);
    $("selectBtn").setAttribute("aria-pressed", String(selectMode || n > 0));
  }
  function clearSelection() { selection.clear(); selectMode = false; lastSelected = null; syncSelection(); }
  async function bulk(action) {
    const ids = [...selection];
    if (!ids.length && action !== "clear") return;
    if (action === "clear") return clearSelection();
    if (action === "favorite") { const on = ids.some((id) => !photos.get(id)?.favorite); for (const id of ids) await updatePhoto(photos.get(id), { favorite: on }); }
    else if (action === "album") return chooseAlbum(ids);
    else if (action === "compare") { const [a, b] = ids.map((id) => photos.get(id)); clearSelection(); return openCompare(a, b); }
    else if (action === "collage") { clearSelection(); return openCollage(ids); }
    else if (action === "download") return exportZip(ids.map((id) => photos.get(id)).filter(Boolean));
    else if (action === "archive") { const on = section !== "archive"; for (const id of ids) await updatePhoto(photos.get(id), { archived: on }); notify(t(on ? "archived" : "unarchived", { n: num(ids.length) }), "success"); }
    else if (action === "lock") await moveToLocked(ids, section !== "locked");
    else if (action === "restore") await restoreItems(ids);
    else if (action === "delete") {
      if (section === "trash") { if (!(await confirmDialog({ icon: "delete_forever", title: t("deleteForever"), text: t("deleteForeverConfirm", { n: num(ids.length) }), confirm: t("deleteForever"), danger: true }))) return; await purge(ids); }
      else if (section.startsWith("album:")) { const choice = await confirmDialog({ icon: "remove_circle", title: t("removeFromAlbum"), text: t("removeFromAlbumConfirm", { n: num(ids.length) }), confirm: t("removeFromAlbum") }); if (!choice) return; await removeFromAlbum(ids); }
      else await trash(ids);
    }
    clearSelection();
    render();
  }
  async function trash(ids) {
    try {
      for (const id of ids) { const p = photos.get(id); if (p) { Object.assign(p, { trashed: true, trashedAt: new Date().toISOString(), updatedAt: Date.now() }); await putRecord(PHOTOS, p); } }
      A?.sync?.schedule?.(800);
      notify(t("movedToTrash", { n: num(ids.length) }), "success");
      render();
    } catch { notify(t("errorDeletePhoto"), "error"); }
  }
  async function restoreItems(ids) {
    for (const id of ids) { const p = photos.get(id); if (p) { delete p.trashed; delete p.trashedAt; p.updatedAt = Date.now(); await putRecord(PHOTOS, p).catch(() => {}); } }
    A?.sync?.schedule?.(800);
    notify(t("restored", { n: num(ids.length) }), "success");
    render();
  }
  async function purge(ids) {
    try {
      for (const id of ids) {
        const p = photos.get(id);
        if (!p) continue;
        if (p.encryption?.keyId) await deleteRecord(KEYS, p.encryption.keyId).catch(() => {});
        if (p.cloud && signedIn()) await Cloud.deleteBlob(p.cloud.blobId).catch(() => {});
        for (const info of shared.values()) if (info.space.content.items?.[p.cloudId] && info.space.role !== "view") await info.space.update((c) => { delete c.items[p.cloudId]; }).catch(() => {});
        await deleteRecord(PHOTOS, id);
        photos.delete(id);
        blobCache.delete(id);
      }
      A?.sync?.schedule?.(800);
      scheduleUsage();
      render();
    } catch { notify(t("errorDeletePhoto"), "error"); }
  }
  async function removeFromAlbum(ids) {
    const album = albums.get(albumKey(section.slice(6)));
    if (!album) return;
    for (const id of ids) {
      const p = photos.get(id);
      if (!p) continue;
      p.albums = (p.albums || []).filter((a) => String(a) !== String(album.id));
      p.updatedAt = Date.now();
      await putRecord(PHOTOS, p);
      if (album.spaceId) { const info = shared.get(album.spaceId); if (info && p.cloud) { await info.space.update((c) => { delete c.items[p.cloudId]; }).catch(() => {}); await info.space.unlinkBlob(p.cloud.blobId); } }
    }
    A?.sync?.schedule?.(800);
    render();
  }
  async function purgeOldTrash() {
    const cutoff = Date.now() - settings.trashDays * DAY_MS;
    const old = [...photos.values()].filter((p) => p.trashed && Date.parse(p.trashedAt) < cutoff).map((p) => p.id);
    if (old.length) await purge(old);
  }

  /* ================================================================ locked folder */
  async function pinHash(pin, salt) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 210000 }, key, 256);
    return Cloud.b64(bits);
  }
  function renderLockedGate() {
    const setup = !settings.lockedHash;
    main.innerHTML = `<div class="ph-content ph-locked-gate"><div class="mu-empty"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">lock</span></span><h2 class="mu-h-title">${esc(t("lockedFolder"))}</h2><p class="mu-muted">${esc(t(setup ? "lockedSetupHelp" : "lockedEnterHelp"))}</p>
      <form class="ph-pin-form" id="pinForm"><label class="mu-field"><span class="mu-field-label">${esc(t(setup ? "createPin" : "enterPin"))}</span><input class="mu-input" type="password" inputmode="numeric" autocomplete="${setup ? "new-password" : "current-password"}" minlength="4" maxlength="12" required id="pinInput"></label>
      ${setup ? `<label class="mu-field"><span class="mu-field-label">${esc(t("confirmPin"))}</span><input class="mu-input" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" maxlength="12" required id="pinConfirm"></label>` : ""}
      <p class="mu-inline-error" id="pinError" role="alert" hidden></p><button type="submit" class="mu-btn mu-btn-primary"><span class="mu-icon" aria-hidden="true">lock_open</span>${esc(t(setup ? "setUpLocked" : "unlock"))}</button></form></div></div>`;
    $("pinInput").focus();
    $("pinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pin = $("pinInput").value;
      const error = $("pinError");
      error.hidden = true;
      if (!/^\d{4,12}$/.test(pin)) { error.textContent = t("errorPinFormat"); error.hidden = false; return; }
      if (setup) {
        if (pin !== $("pinConfirm").value) { error.textContent = t("errorPinMatch"); error.hidden = false; return; }
        const salt = Cloud.b64(crypto.getRandomValues(new Uint8Array(16)));
        if (!saveSettings({ lockedSalt: salt, lockedHash: await pinHash(pin, salt) })) return;
        unlocked = true;
      } else if ((await pinHash(pin, settings.lockedSalt)) === settings.lockedHash) unlocked = true;
      else { error.textContent = t("errorPin"); error.hidden = false; $("pinInput").select(); return; }
      render();
      restorePendingMedia();
    });
  }
  async function moveToLocked(ids, on) {
    if (on && !settings.lockedHash) { go("locked"); notify(t("lockedSetupFirst"), "info"); return; }
    for (const id of ids) {
      const p = photos.get(id);
      if (!p) continue;
      Object.assign(p, { locked: on, updatedAt: Date.now() });
      await putRecord(PHOTOS, p).catch(() => notify(t("errorSavePhoto"), "error"));
    }
    A?.sync?.schedule?.(800);
    notify(t(on ? "movedToLocked" : "removedFromLocked", { n: num(ids.length) }), "success");
    render();
  }

  /* ================================================================ utilities */
  function renderDuplicates() {
    const groups = new Map();
    for (const p of photos.values()) if (!p.trashed && !p.locked && p.hash) { if (!groups.has(p.hash)) groups.set(p.hash, []); groups.get(p.hash).push(p); }
    const dupes = [...groups.values()].filter((g) => g.length > 1);
    main.innerHTML = `<div class="ph-content mu-scroll"><div class="mu-alert ph-banner"><span class="mu-icon" aria-hidden="true">content_copy</span><div class="mu-alert-body"><span class="mu-alert-title">${esc(t(dupes.length ? "duplicatesFound" : "noDuplicates", { n: num(dupes.length) }))}</span><span class="mu-muted">${esc(t("duplicatesHelp"))}</span></div>${dupes.length ? `<button type="button" class="mu-btn mu-btn-primary" id="mergeAllBtn"><span class="mu-icon" aria-hidden="true">merge</span>${esc(t("keepOneOfEach"))}</button>` : ""}</div>
      ${dupes.map((g, i) => `<section class="ph-group"><div class="ph-group-head"><h2>${esc(t("duplicateSet", { n: num(i + 1), count: num(g.length) }))}</h2><button type="button" class="mu-btn mu-btn-ghost" data-merge="${i}">${esc(t("keepOne"))}</button></div><div class="ph-grid">${g.map(tile).join("")}</div></section>`).join("")}</div>`;
    const merge = async (g) => { const keep = g.find((p) => p.favorite) || g[0]; const rest = g.filter((p) => p !== keep); for (const p of rest) { keep.albums = [...new Set([...(keep.albums || []), ...(p.albums || [])])]; keep.tags = [...new Set([...(keep.tags || []), ...(p.tags || [])])]; } await putRecord(PHOTOS, keep); await trash(rest.map((p) => p.id)); };
    main.querySelectorAll("[data-merge]").forEach((b) => b.addEventListener("click", async () => { await merge(dupes[Number(b.dataset.merge)]); render(); }));
    $("mergeAllBtn")?.addEventListener("click", async () => { for (const g of dupes) await merge(g); render(); });
  }
  async function renderStorage() {
    const all = [...photos.values()];
    const local = all.filter((p) => p.data).reduce((s, p) => s + toBytes(p.data).byteLength, 0);
    const cloudCount = all.filter((p) => p.cloud).length;
    const freeable = all.filter((p) => p.cloud && p.data);
    const large = sorted(all.filter((p) => !p.trashed && !p.locked && size(p) >= LARGE_BYTES), "").sort((a, b) => size(b) - size(a));
    let estimate = null;
    try { estimate = await navigator.storage?.estimate?.(); } catch {}
    main.innerHTML = `<div class="ph-content mu-scroll ph-storage">
      <div class="ph-stats">
        <div class="mu-stat"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">smartphone</span></span><div><div class="mu-stat-value">${esc(bytes(local))}</div><div class="mu-stat-label">${esc(t("onThisDevice"))}</div></div></div>
        <div class="mu-stat"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">cloud</span></span><div><div class="mu-stat-value" id="cloudUsed">${signedIn() ? "…" : "—"}</div><div class="mu-stat-label">${esc(t("munetiosCloud"))}</div></div></div>
        <div class="mu-stat"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">cloud_done</span></span><div><div class="mu-stat-value">${esc(num(cloudCount))}</div><div class="mu-stat-label">${esc(t("backedUpItems"))}</div></div></div>
      </div>
      ${estimate?.quota ? `<div class="mu-field"><span class="mu-field-label">${esc(t("browserStorage"))}</span><div class="mu-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(estimate.usage / estimate.quota * 100)}" aria-label="${esc(t("browserStorage"))}"><span style="width:${Math.max(1, Math.round(estimate.usage / estimate.quota * 100))}%"></span></div><span class="mu-muted">${esc(t("usedOf", { used: bytes(estimate.usage), total: bytes(estimate.quota) }))}</span></div>` : ""}
      <div class="mu-field" id="cloudQuota" hidden></div>
      <div class="ph-storage-actions">
        <button type="button" class="mu-btn mu-btn-primary" id="backupAllBtn"><span class="mu-icon" aria-hidden="true">cloud_upload</span>${esc(t("backUpEverything"))}</button>
        <button type="button" class="mu-btn" id="freeSpaceBtn" ${freeable.length ? "" : "disabled"}><span class="mu-icon" aria-hidden="true">cleaning_services</span>${esc(t("freeUpSpaceSize", { size: bytes(freeable.reduce((s, p) => s + toBytes(p.data).byteLength, 0)) }))}</button>
        <button type="button" class="mu-btn" id="exportAllBtn"><span class="mu-icon" aria-hidden="true">folder_zip</span>${esc(t("exportLibrary"))}</button>
        <button type="button" class="mu-btn" id="importZipBtn"><span class="mu-icon" aria-hidden="true">unarchive</span>${esc(t("importZip"))}</button>
      </div>
      <section class="ph-page-section"><h2 class="mu-h-title">${esc(t("largeItems"))}</h2>${large.length ? `<div class="ph-grid">${large.map(tile).join("")}</div>` : `<p class="mu-muted">${esc(t("noLargeItems"))}</p>`}</section></div>`;
    $("backupAllBtn").addEventListener("click", backupEverything);
    $("freeSpaceBtn").addEventListener("click", freeUpSpace);
    $("exportAllBtn").addEventListener("click", () => exportZip([...photos.values()].filter((p) => !p.trashed && !p.locked)));
    $("importZipBtn").addEventListener("click", () => $("zipInput").click());
    if (signedIn()) {
      try {
        const s = await Cloud.storage();
        if (!$("cloudUsed")) return;
        $("cloudUsed").textContent = bytes(s.used);
        const box = $("cloudQuota");
        box.hidden = !hasPersonalCloudQuota(s);
        box.innerHTML = box.hidden ? "" : `<span class="mu-field-label">${esc(t("cloudStorage"))}</span><div class="mu-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(s.used / s.quota * 100)}" aria-label="${esc(t("cloudStorage"))}"><span style="width:${Math.max(1, Math.round(s.used / s.quota * 100))}%"></span></div><span class="mu-muted">${esc(t("usedOf", { used: bytes(s.used), total: bytes(s.quota) }))}</span>`;
      } catch { if ($("cloudUsed")) $("cloudUsed").textContent = "—"; }
    }
    fillMissingThumbs();
  }
  function renderRecap() {
    const year = new Date().getFullYear();
    const list = [...photos.values()].filter((p) => visibleIn(p, "library") && new Date(takenAt(p)).getFullYear() === year);
    const months = Array.from({ length: 12 }, (_, m) => list.filter((p) => new Date(takenAt(p)).getMonth() === m).length);
    const max = Math.max(1, ...months);
    const top = months.indexOf(Math.max(...months));
    const favs = list.filter((p) => p.favorite);
    const highlight = (favs.length ? favs : list).slice(0, 24);
    main.innerHTML = `<div class="ph-content mu-scroll ph-recap"><section class="ph-recap-hero" style="${highlight[0]?.thumb ? `background-image:url('${esc(highlight[0].thumb)}')` : ""}"><div class="ph-recap-hero-text"><h2 class="mu-h-display">${esc(t("yourYear", { year: String(year) }))}</h2><p>${esc(t("recapSummary", { photos: num(list.filter((p) => !p.isVideo).length), videos: num(list.filter((p) => p.isVideo).length) }))}</p>${highlight.length ? `<button type="button" class="mu-btn mu-btn-primary" data-slideshow-ids="${highlight.map((p) => p.id).join(",")}"><span class="mu-icon" aria-hidden="true">play_arrow</span>${esc(t("playHighlights"))}</button>` : ""}</div></section>
      <div class="ph-stats"><div class="mu-stat"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">photo_camera</span></span><div><div class="mu-stat-value">${esc(num(list.length))}</div><div class="mu-stat-label">${esc(t("itemsThisYear"))}</div></div></div><div class="mu-stat"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">favorite</span></span><div><div class="mu-stat-value">${esc(num(favs.length))}</div><div class="mu-stat-label">${esc(t("favorites"))}</div></div></div><div class="mu-stat"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">local_fire_department</span></span><div><div class="mu-stat-value">${list.length ? esc(fmtDate(new Date(year, top, 15), { month: "long" })) : "—"}</div><div class="mu-stat-label">${esc(t("busiestMonth"))}</div></div></div></div>
      <section class="ph-page-section"><h2 class="mu-h-title">${esc(t("photosByMonth"))}</h2><ul class="mu-comparison-bars">${months.map((n, m) => `<li><span>${esc(fmtDate(new Date(year, m, 15), { month: "short" }))}</span><span class="mu-progress mu-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(n / max * 100)}" aria-label="${esc(fmtDate(new Date(year, m, 15), { month: "long" }))}"><span style="--mu-meter-value:${Math.round(n / max * 100)}%"></span></span><span class="mu-muted">${esc(num(n))}</span></li>`).join("")}</ul></section>
      ${highlight.length ? `<section class="ph-page-section"><h2 class="mu-h-title">${esc(t("highlights"))}</h2><div class="ph-grid">${highlight.map(tile).join("")}</div></section>` : ""}</div>`;
  }

  /* ---------------------------------------------------------- export, ZIP */
  function openExport(list) {
    const allPhotos = list.every((p) => !p.isVideo);
    const d = dialog({ icon: "download", title: t("download"), size: "md",
      body: allPhotos ? `<div class="ph-form">
        <label class="mu-field"><span class="mu-field-label">${esc(t("format"))}</span><select class="mu-select" name="format"><option value="original">${esc(t("formatOriginal"))}</option><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></label>
        <label class="mu-field"><span class="mu-field-label">${esc(t("exportSize"))}</span><select class="mu-select" name="size"><option value="0">${esc(t("sizeOriginal"))}</option><option value="3840">3840 px</option><option value="2048">2048 px</option><option value="1080">1080 px</option></select></label>
        <div class="mu-row ph-plain-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("removeMetadata"))}</span><span class="mu-row-subtitle">${esc(t("removeMetadataHelp"))}</span></div><label class="mu-switch"><input type="checkbox" name="strip" ${settings.stripLocation ? "checked" : ""} aria-label="${esc(t("removeMetadata"))}"><span class="mu-switch-track"></span></label></div></div>` : `<p class="ph-dialog-text">${esc(t("downloadVideoHelp"))}</p>`,
      actions: `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="button" class="mu-btn mu-btn-primary" data-ok><span class="mu-icon" aria-hidden="true">download</span>${esc(t("download"))}</button>` });
    d.q("[data-ok]").addEventListener("click", async () => {
      const format = d.q("[name=format]")?.value || "original", max = Number(d.q("[name=size]")?.value || 0), strip = d.q("[name=strip]")?.checked;
      d.close();
      for (const r of list) {
        try {
          let blob = await getBlob(r), name = r.name;
          if (!r.isVideo && (format !== "original" || max || strip)) {
            const type = format === "original" ? (/^image\/(png|webp)$/.test(r.type) ? r.type : "image/jpeg") : format;
            const { img, url } = await loadImage(blob);
            const scale = max ? Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
            const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
            name = name.replace(/\.\w+$/, "") + "." + ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type]);
          }
          download(name, blob);
        } catch { notify(t("errorDownload"), "error"); }
      }
    });
  }
  async function exportZip(list) {
    if (!list.length) return;
    if (!window.JSZip) { notify(t("errorExportZip"), "error"); return; }
    const toast = UI.toast(t("preparingZip", { n: num(list.length) }), { duration: 120000 });
    try {
      const zip = new JSZip();
      const meta = { app: "munetios-photos", version: 4, photos: [], albums: [...albums.values()].filter((a) => !a.sharedWithMe).map((a) => ({ id: a.id, name: a.name, description: a.description || "", created: a.created })) };
      const used = new Set();
      for (const p of list) {
        const blob = await getBlob(p);
        let file = p.name || `item-${p.id}`;
        while (used.has(file)) file = file.replace(/(\.\w+)?$/, `-${p.id}$1`);
        used.add(file);
        zip.file(file, blob);
        meta.photos.push({ file, favorite: Boolean(p.favorite), screenshots: Boolean(p.screenshots), tags: p.tags || [], notes: p.notes || "", editedAt: p.editedAt || null, takenAt: p.takenAt, rating: p.rating || 0, archived: Boolean(p.archived), albums: (p.albums || []).map(String), isVideo: Boolean(p.isVideo) });
      }
      zip.file("munetios_photos.json", JSON.stringify(meta, null, 2));
      download(`munetios-photos-${new Date().toISOString().slice(0, 10)}.zip`, await zip.generateAsync({ type: "blob" }));
    } catch { notify(t("errorExportZip"), "error"); }
    toast.remove();
  }
  async function importZip(file) {
    if (!window.JSZip) { notify(t("errorImportZip"), "error"); return; }
    try {
      const zip = await JSZip.loadAsync(file);
      const metaFile = zip.file("munetios_photos.json");
      const meta = metaFile ? JSON.parse(await metaFile.async("string")) : { photos: [], albums: [] };
      const byFile = new Map((meta.photos || []).filter(Boolean).map((e) => [e.file, e]));
      const albumMap = new Map();
      for (const a of meta.albums || []) { const album = await createAlbum(a.name || t("untitledAlbum")); if (album) { album.description = a.description || ""; await putRecord(ALBUMS, album); albumMap.set(String(a.id ?? a.name), album.id); } }
      const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
      for (const name of Object.keys(zip.files)) {
        const ext = name.split(".").pop().toLowerCase();
        if (!types[ext] || zip.files[name].dir) continue;
        const blob = await zip.file(name).async("blob");
        const [record] = await importFiles([new File([blob], name.split("/").pop(), { type: types[ext] })], { quiet: true });
        const m = byFile.get(name);
        if (record && m) await updatePhoto(record, { favorite: Boolean(m.favorite), screenshots: Boolean(m.screenshots), tags: Array.isArray(m.tags) ? m.tags : [], notes: typeof m.notes === "string" ? m.notes : "", editedAt: m.editedAt || null, takenAt: m.takenAt || record.takenAt, rating: Number(m.rating) || 0, archived: Boolean(m.archived), albums: (m.albums || []).map((a) => albumMap.get(String(a))).filter(Boolean) });
      }
      notify(t("zipImported"), "success");
      render();
    } catch { notify(t("errorImportZip"), "error"); }
  }

  /* ================================================================ editor (photo-editor.js) */
  async function openEditor(r) {
    let blob;
    try { blob = await getBlob(r); } catch { notify(t("errorOpenPhoto"), "error"); return; }
    if (!window.MunetiosPhotoEditor) { notify(t("errorOpenPhoto"), "error"); return; }
    try {
      await window.MunetiosPhotoEditor.open({
        blob, name: r.name, type: r.type, thumb: r.thumb, t, notify, confirm: confirmDialog,
        pickColor: (o) => UI.pickColor(Object.assign({}, o, { labels: { done: t("done"), cancel: t("cancel"), color: t("color"), hex: t("hexColor") } })),
        onClose: () => { if (!viewer) document.body.classList.remove("ph-viewer-open"); },
        async onSave(edited, { copy, type }) {
          if (copy) {
            const [made] = await importFiles([new File([edited], r.name.replace(/(\.\w+)?$/, ` (${t("edited")})$1`), { type })], { quiet: true });
            if (!made) throw new Error("save");
            await updatePhoto(made, { takenAt: r.takenAt, editedAt: new Date().toISOString(), originalPhotoId: r.id, albums: [...(r.albums || [])], exif: r.exif });
          } else {
            const bytesEdited = await edited.arrayBuffer();
            const enc = await encryptBytes(new Uint8Array(bytesEdited));
            if (r.encryption?.keyId) await deleteRecord(KEYS, r.encryption.keyId).catch(() => {});
            const info = await describeMedia(edited, false);
            const oldCloud = r.cloud;
            Object.assign(r, info, { data: enc.data, encryption: enc.encryption, type, size: edited.size, editedAt: new Date().toISOString(), cloud: null, cloudOnly: false, hash: await sha256(bytesEdited), updatedAt: Date.now() });
            await putRecord(PHOTOS, r);
            blobCache.delete(r.id);
            if (oldCloud && signedIn()) Cloud.deleteBlob(oldCloud.blobId).catch(() => {});
            queueUpload(r);
          }
          notify(t("editSaved"), "success");
          if (viewer) show(viewer.index);
          render();
        },
      });
    } catch { notify(t("errorOpenPhoto"), "error"); }
  }

  /* ================================================================ compare, collage, slideshow */
  function pickCompare(r) {
    notify(t("pickSecondPhoto"), "info");
    closeViewer();
    selectMode = true;
    selection.clear();
    selection.add(r.id);
    syncSelection();
  }
  async function openCompare(a, b) {
    if (!a || !b) return;
    let ua, ub;
    try { ua = URL.createObjectURL(await getBlob(a)); ub = URL.createObjectURL(await getBlob(b)); } catch { notify(t("errorOpenPhoto"), "error"); return; }
    const d = dialog({ icon: "compare", title: t("compare"), size: "lg", className: "ph-compare-dialog",
      body: `<div class="mu-segmented" role="group" aria-label="${esc(t("compareMode"))}" id="cmpMode"><button type="button" aria-pressed="true" data-mode="side">${esc(t("sideBySide"))}</button><button type="button" aria-pressed="false" data-mode="slider">${esc(t("slider"))}</button></div>
        <div class="ph-compare is-side"><figure><img src="${ua}" alt="${esc(a.name)}"><figcaption>${esc(a.name)} · ${esc(bytes(size(a)))}</figcaption></figure><figure class="ph-compare-b"><img src="${ub}" alt="${esc(b.name)}"><figcaption>${esc(b.name)} · ${esc(bytes(size(b)))}</figcaption></figure></div>
        <input class="mu-range ph-compare-range" type="range" min="0" max="100" value="50" aria-label="${esc(t("slider"))}" hidden>` });
    const box = d.q(".ph-compare"), range = d.q(".ph-compare-range");
    d.q("#cmpMode").addEventListener("click", (e) => { const m = e.target.closest("[data-mode]"); if (!m) return; d.qa("#cmpMode button").forEach((x) => x.setAttribute("aria-pressed", String(x === m))); box.classList.toggle("is-side", m.dataset.mode === "side"); box.classList.toggle("is-slider", m.dataset.mode === "slider"); range.hidden = m.dataset.mode !== "slider"; });
    range.addEventListener("input", () => box.style.setProperty("--cut", `${range.value}%`));
    d.onClose = () => { URL.revokeObjectURL(ua); URL.revokeObjectURL(ub); };
  }
  async function openCollage(preset = []) {
    const pool = sorted([...photos.values()].filter((p) => visibleIn(p, "library") && !p.isVideo));
    const chosen = new Set(preset.filter((id) => photos.get(id) && !photos.get(id).isVideo));
    const d = dialog({ icon: "dashboard", title: t("collage"), size: "lg", className: "ph-collage-dialog",
      body: `<p class="mu-muted">${esc(t("collageHelp"))}</p><div class="ph-form-grid"><label class="mu-field"><span class="mu-field-label">${esc(t("layout"))}</span><select class="mu-select" name="layout"><option value="grid">${esc(t("layoutGrid"))}</option><option value="row">${esc(t("layoutRow"))}</option><option value="column">${esc(t("layoutColumn"))}</option></select></label><label class="mu-field"><span class="mu-field-label">${esc(t("spacing"))}</span><select class="mu-select" name="gap"><option value="0">0</option><option value="12" selected>12 px</option><option value="32">32 px</option></select></label></div>
        <div class="ph-collage-pick ph-grid">${pool.map((p) => `<label class="ph-tile ph-pick-tile${chosen.has(p.id) ? " is-selected" : ""}"><img src="${esc(p.thumb || "")}" alt="${esc(p.name)}" loading="lazy"><span class="ph-tile-check mu-check"><input type="checkbox" data-pick="${p.id}" ${chosen.has(p.id) ? "checked" : ""} aria-label="${esc(p.name)}"></span></label>`).join("")}</div>`,
      actions: `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="button" class="mu-btn mu-btn-primary" data-ok><span class="mu-icon" aria-hidden="true">dashboard</span>${esc(t("createCollage"))}</button>` });
    d.modal.addEventListener("change", (e) => { const c = e.target.closest("[data-pick]"); if (!c) return; const id = Number(c.dataset.pick); if (c.checked) chosen.add(id); else chosen.delete(id); c.closest(".ph-tile").classList.toggle("is-selected", c.checked); });
    d.q("[data-ok]").addEventListener("click", async () => {
      const list = [...chosen].map((id) => photos.get(id)).filter(Boolean);
      if (list.length < 2) { notify(t("collageNeedsTwo"), "error"); return; }
      const layout = d.q("[name=layout]").value, gap = Number(d.q("[name=gap]").value);
      d.close();
      try {
        const images = [];
        for (const p of list) images.push(await loadImage(await getBlob(p)));
        const W = 2400, cols = layout === "row" ? images.length : layout === "column" ? 1 : Math.ceil(Math.sqrt(images.length));
        const rows = Math.ceil(images.length / cols);
        const cell = (W - gap * (cols + 1)) / cols;
        const cellH = layout === "row" ? cell * 1.3 : cell;
        const canvas = Object.assign(document.createElement("canvas"), { width: W, height: Math.round(rows * cellH + gap * (rows + 1)) });
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        images.forEach(({ img }, i) => {
          const x = gap + (i % cols) * (cell + gap), y = gap + Math.floor(i / cols) * (cellH + gap);
          const s = Math.max(cell / img.naturalWidth, cellH / img.naturalHeight);
          const sw = cell / s, sh = cellH / s;
          ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, cell, cellH);
        });
        images.forEach(({ url }) => URL.revokeObjectURL(url));
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
        const [record] = await importFiles([new File([blob], `${t("collage")} ${new Date().toISOString().slice(0, 10)}.jpg`, { type: "image/jpeg" })], { quiet: true });
        if (record) { notify(t("collageCreated"), "success"); openViewer(record.id, [record.id]); }
      } catch { notify(t("errorCollage"), "error"); }
    });
  }
  let slideshow = null;
  async function startSlideshow(ids, start = 0) {
    const list = ids.filter((id) => photos.get(id) && !photos.get(id).isVideo);
    if (!list.length) return;
    const el = document.createElement("div");
    el.className = `ph-slideshow is-${settings.slideshowTransition}`;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", t("slideshow"));
    el.innerHTML = `<div class="ph-slide-stage"></div><div class="ph-slide-bar mu-glass mu-glass-solid"><button type="button" class="mu-icon-btn" data-s="prev" aria-label="${esc(t("previous"))}"><span class="mu-icon" aria-hidden="true">skip_previous</span></button><button type="button" class="mu-icon-btn mu-icon-btn-primary" data-s="toggle" aria-label="${esc(t("pause"))}"><span class="mu-icon" aria-hidden="true">pause</span></button><button type="button" class="mu-icon-btn" data-s="next" aria-label="${esc(t("next"))}"><span class="mu-icon" aria-hidden="true">skip_next</span></button><button type="button" class="mu-icon-btn" data-s="shuffle" aria-pressed="false" aria-label="${esc(t("shuffle"))}"><span class="mu-icon" aria-hidden="true">shuffle</span></button><span class="mu-divider-v" aria-hidden="true"></span><button type="button" class="mu-icon-btn" data-s="close" aria-label="${esc(t("close"))}"><span class="mu-icon" aria-hidden="true">close</span></button></div>`;
    document.body.appendChild(el);
    el.requestFullscreen?.().catch(() => {});
    slideshow = { el, list, index: start, playing: true, timer: null, urls: [] };
    const stage = el.querySelector(".ph-slide-stage");
    const showSlide = async (i) => {
      if (!slideshow) return;
      slideshow.index = (i + list.length) % list.length;
      try {
        const url = URL.createObjectURL(await getBlob(photos.get(list[slideshow.index])));
        slideshow.urls.push(url);
        const img = document.createElement("img");
        img.className = "ph-slide";
        img.alt = photos.get(list[slideshow.index]).notes || "";
        img.src = url;
        stage.appendChild(img);
        requestAnimationFrame(() => img.classList.add("is-in"));
        const old = [...stage.children].slice(0, -1);
        setTimeout(() => old.forEach((o) => o.remove()), 900);
        while (slideshow.urls.length > 3) URL.revokeObjectURL(slideshow.urls.shift());
      } catch {}
      schedule();
    };
    const schedule = () => { clearTimeout(slideshow.timer); if (slideshow.playing) slideshow.timer = setTimeout(() => showSlide(slideshow.index + 1), settings.slideshowInterval * 1000); };
    const stop = () => { clearTimeout(slideshow.timer); slideshow.urls.forEach((u) => URL.revokeObjectURL(u)); el.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); slideshow = null; };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-s]");
      if (!b) return;
      const a = b.dataset.s;
      if (a === "close") stop();
      else if (a === "prev") showSlide(slideshow.index - 1);
      else if (a === "next") showSlide(slideshow.index + 1);
      else if (a === "toggle") { slideshow.playing = !slideshow.playing; b.querySelector(".mu-icon").textContent = slideshow.playing ? "pause" : "play_arrow"; b.setAttribute("aria-label", t(slideshow.playing ? "pause" : "play")); schedule(); }
      else if (a === "shuffle") { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); if (on) list.sort(() => Math.random() - 0.5); }
    });
    el.tabIndex = -1;
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") stop(); if (e.key === "ArrowRight") showSlide(slideshow.index + 1); if (e.key === "ArrowLeft") showSlide(slideshow.index - 1); if (e.key === " ") { e.preventDefault(); el.querySelector('[data-s="toggle"]').click(); } });
    document.addEventListener("fullscreenchange", function onFs() { if (!document.fullscreenElement && slideshow?.el === el) { document.removeEventListener("fullscreenchange", onFs); } });
    el.focus();
    showSlide(start);
  }

  /* ================================================================ camera and screen recording */
  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { notify(t("errorCamera"), "error"); return; }
    let stream, facing = "environment", recorder = null, chunks = [];
    const start = async () => { stream?.getTracks().forEach((tr) => tr.stop()); stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: true })); };
    try { await start(); } catch { notify(t("errorCamera"), "error"); return; }
    const d = dialog({ icon: "photo_camera", title: t("camera"), size: "lg", className: "ph-camera-dialog",
      body: `<video class="ph-camera-video" autoplay playsinline muted data-mu-plain-video></video><div class="ph-camera-controls"><button type="button" class="mu-icon-btn" data-c="switch" aria-label="${esc(t("switchCamera"))}"><span class="mu-icon" aria-hidden="true">cameraswitch</span></button><button type="button" class="mu-btn mu-btn-primary ph-shutter" data-c="photo"><span class="mu-icon" aria-hidden="true">photo_camera</span>${esc(t("takePhoto"))}</button><button type="button" class="mu-btn" data-c="record"><span class="mu-icon" aria-hidden="true">videocam</span><span>${esc(t("recordVideo"))}</span></button></div>` });
    const video = d.q("video");
    video.srcObject = stream;
    d.modal.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-c]");
      if (!b) return;
      if (b.dataset.c === "switch") { facing = facing === "environment" ? "user" : "environment"; try { await start(); video.srcObject = stream; } catch { notify(t("errorCamera"), "error"); } }
      if (b.dataset.c === "photo") {
        const canvas = Object.assign(document.createElement("canvas"), { width: video.videoWidth, height: video.videoHeight });
        canvas.getContext("2d").drawImage(video, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
        await importFiles([new File([blob], `IMG_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.jpg`, { type: "image/jpeg" })]);
      }
      if (b.dataset.c === "record") {
        if (recorder) { recorder.stop(); return; }
        try {
          chunks = [];
          recorder = new MediaRecorder(stream);
          recorder.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
          recorder.onstop = async () => { const type = recorder.mimeType || "video/webm"; recorder = null; b.querySelector("span:last-child").textContent = t("recordVideo"); b.classList.remove("is-recording"); await importFiles([new File([new Blob(chunks, { type })], `VID_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.webm`, { type })]); };
          recorder.start();
          b.classList.add("is-recording");
          b.querySelector("span:last-child").textContent = t("stopRecording");
        } catch { notify(t("errorCamera"), "error"); }
      }
    });
    d.onClose = () => { recorder?.stop(); stream?.getTracks().forEach((tr) => tr.stop()); };
  }
  let screenCapture = null;
  let choosingScreen = false;

  async function enableRecordingAudio() {
    const tone = window.Tone;
    if (tone) await tone.start();
    return tone;
  }

  function recordingCue(toneReady, rising) {
    void toneReady.then(tone => {
      if (!tone) return;
      const synth = new tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.01, decay: 0.09, sustain: 0, release: 0.1 } }).toDestination();
      try {
        synth.volume.value = -20;
        const now = tone.now();
        synth.triggerAttackRelease(rising ? "G5" : "C6", 0.09, now);
        synth.triggerAttackRelease(rising ? "C6" : "G5", 0.13, now + 0.1);
      } finally { setTimeout(() => synth.dispose(), 450); }
    }).catch(() => {});
  }

  function updateRecordingTime() {
    if (!screenCapture) return;
    const { elapsed, started } = screenCapture;
    const seconds = Math.floor((elapsed + (started === null ? 0 : performance.now() - started)) / 1000);
    $("screenRecordingTime").textContent = [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, "0")).join(":");
  }

  function renderScreenRecording() {
    const paused = screenCapture.recorder.state === "paused";
    const bar = $("screenRecordingBar");
    bar.dataset.paused = String(paused);
    $("screenRecordingStatus").textContent = t(paused ? "screenRecordingPaused" : "screenRecordingActive");
    const toggle = $("pauseScreenRecording");
    const label = t(paused ? "resumeRecording" : "pauseRecording");
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.firstElementChild.textContent = paused ? "play_arrow" : "pause";
    updateRecordingTime();
  }

  function stopScreenCapture(capture = screenCapture) {
    if (capture && capture.recorder.state !== "inactive") capture.recorder.stop();
  }

  async function finishScreenCapture(capture) {
    if (screenCapture !== capture) return;
    clearInterval(capture.timer);
    capture.stream.getTracks().forEach(track => track.stop());
    screenCapture = null;
    const bar = $("screenRecordingBar");
    const restoreFocus = bar.contains(document.activeElement);
    bar.hidden = true;
    if (restoreFocus && capture.trigger instanceof HTMLElement) capture.trigger.focus({ preventScroll: true });
    recordingCue(capture.toneReady, false);
    if (!capture.chunks.length) { notify(t("errorSaveRecording"), "error"); return; }
    const type = capture.recorder.mimeType || capture.chunks[0].type || "video/webm";
    const extension = type.startsWith("video/mp4") ? "mp4" : "webm";
    const name = `Screen recording ${capture.createdAt.toISOString().slice(0, 16).replace("T", " ")}.${extension}`;
    await importFiles([new File(capture.chunks, name, { type })]);
  }

  async function recordScreen() {
    if (screenCapture) { $("stopScreenRecording").focus(); return; }
    if (choosingScreen) return;
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) { notify(t("errorScreenRecord"), "error"); return; }
    choosingScreen = true;
    const trigger = document.activeElement;
    let stream;
    try {
      const toneReady = enableRecordingAudio().catch(() => null);
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const recorder = new MediaRecorder(stream);
      const capture = { stream, recorder, trigger, toneReady, chunks: [], started: performance.now(), elapsed: 0, createdAt: new Date() };
      recorder.ondataavailable = event => { if (event.data.size) capture.chunks.push(event.data); };
      recorder.onstop = () => { void finishScreenCapture(capture).catch(() => notify(t("errorSaveRecording"), "error")); };
      recorder.onerror = () => stopScreenCapture(capture);
      recorder.onpause = () => {
        if (screenCapture !== capture) return;
        if (capture.started !== null) capture.elapsed += performance.now() - capture.started;
        capture.started = null;
        renderScreenRecording();
      };
      recorder.onresume = () => {
        if (screenCapture !== capture) return;
        capture.started = performance.now();
        renderScreenRecording();
      };
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === "ended") throw new Error("screenNotAvailable");
      track.addEventListener("ended", () => stopScreenCapture(capture), { once: true });
      recorder.start(1000);
      screenCapture = capture;
      $("screenRecordingBar").hidden = false;
      renderScreenRecording();
      capture.timer = setInterval(updateRecordingTime, 250);
      $("stopScreenRecording").focus({ preventScroll: true });
      recordingCue(toneReady, true);
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") notify(t("errorScreenRecord"), "error");
    } finally { choosingScreen = false; }
  }

  /* ================================================================ settings */
  function openSettings() {
    const row = (title, sub, control) => `<div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(title)}</span>${sub ? `<span class="mu-row-subtitle">${esc(sub)}</span>` : ""}</div><div class="ph-setting-control">${control}</div></div>`;
    const sw = (name, label) => `<label class="mu-switch"><input type="checkbox" data-setting="${name}" ${settings[name] ? "checked" : ""} aria-label="${esc(label)}"><span class="mu-switch-track"></span></label>`;
    const sel = (name, options, label) => `<select class="mu-select" data-setting="${name}" aria-label="${esc(label)}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(settings[name]) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const languageText = settings.language === "system" ? `${t("systemDefault")} (${Cloud.languageName(language(), uiLocale())})` : Cloud.languageName(language(), uiLocale());
    const d = dialog({ icon: "settings", title: t("settings"), size: "lg", className: "ph-settings",
      body: `<div class="mu-tabs" role="tablist"><button type="button" role="tab" data-mu-tab="general" aria-selected="true">${esc(t("general"))}</button><button type="button" role="tab" data-mu-tab="library" aria-selected="false">${esc(t("library"))}</button><button type="button" role="tab" data-mu-tab="cloud" aria-selected="false">${esc(t("backupAndSync"))}</button><button type="button" role="tab" data-mu-tab="privacy" aria-selected="false">${esc(t("privacy"))}</button></div>
        <div data-mu-panel="general" class="mu-group">
          ${row(t("language"), t("languageHelp"), `<button type="button" class="mu-btn" id="langBtn"><span class="mu-icon" aria-hidden="true">translate</span><span>${esc(languageText)}</span></button>`)}
          ${row(t("theme"), "", `<div class="mu-segmented" role="group" aria-label="${esc(t("theme"))}" id="themeSeg">${["system", "light", "dark"].map((v) => `<button type="button" data-theme-pref="${v}" aria-pressed="${UI.theme.get() === v}">${esc(t({ system: "themeSystem", light: "themeLight", dark: "themeDark" }[v]))}</button>`).join("")}</div>`)}
          ${row(t("reduceTransparency"), t("reduceTransparencyHelp"), sw("reduceTransparency", t("reduceTransparency")))}
          ${row(t("slideshowSpeed"), "", sel("slideshowInterval", [2, 4, 6, 10].map((s) => [String(s), t("seconds", { n: num(s) })]), t("slideshowSpeed")))}
          ${row(t("slideshowTransition"), "", sel("slideshowTransition", ["fade", "slide", "zoom"].map((v) => [v, t("transition_" + v)]), t("slideshowTransition")))}
        </div>
        <div data-mu-panel="library" class="mu-group" hidden>
          ${row(t("groupBy"), "", sel("groupBy", ["day", "month", "year"].map((v) => [v, t("group_" + v)]), t("groupBy")))}
          ${row(t("uploadQuality"), t("uploadQualityHelp"), sel("quality", ["original", "high", "medium", "low"].map((v) => [v, imageQuality[v] ? `${t("quality_" + v)} · ≤ ${num(imageQuality[v].maxEdge)} px` : t("quality_" + v)]), t("uploadQuality")))}
          ${row(t("showMemories"), t("showMemoriesHelp"), sw("showMemories", t("showMemories")))}
          ${row(t("trashDuration"), "", sel("trashDays", [7, 30, 60].map((n) => [String(n), t("days", { n: num(n) })]), t("trashDuration")))}
          ${row(t("importZip"), "", `<button type="button" class="mu-btn" id="setImportZip"><span class="mu-icon" aria-hidden="true">unarchive</span>${esc(t("import"))}</button>`)}
          ${row(t("exportLibrary"), "", `<button type="button" class="mu-btn" id="setExportZip"><span class="mu-icon" aria-hidden="true">folder_zip</span>${esc(t("export"))}</button>`)}
        </div>
        <div data-mu-panel="cloud" class="mu-group" hidden>
          ${row(t("cloudBackup"), signedIn() ? t("cloudBackupHelp") : t("cloudSignedOut"), sw("cloudBackup", t("cloudBackup")))}
          ${row(t("accountSync"), t("accountSyncHelp"), sw("accountSync", t("accountSync")))}
          ${row(t("backUpEverything"), "", `<button type="button" class="mu-btn" id="setBackupAll"><span class="mu-icon" aria-hidden="true">cloud_upload</span>${esc(t("backUpNow"))}</button>`)}
          ${row(t("freeUpSpace"), t("freeUpSpaceHelp"), `<button type="button" class="mu-btn" id="setFreeSpace"><span class="mu-icon" aria-hidden="true">cleaning_services</span>${esc(t("freeUpSpace"))}</button>`)}
        </div>
        <div data-mu-panel="privacy" class="mu-group" hidden>
          ${row(t("removeMetadata"), t("removeMetadataHelp"), sw("stripLocation", t("removeMetadata")))}
          ${row(t("lockedFolder"), settings.lockedHash ? t("lockedOn") : t("lockedOff"), settings.lockedHash ? `<button type="button" class="mu-btn" id="resetPin"><span class="mu-icon" aria-hidden="true">password</span>${esc(t("changePin"))}</button>` : `<button type="button" class="mu-btn" id="setupPin"><span class="mu-icon" aria-hidden="true">lock</span>${esc(t("setUpLocked"))}</button>`)}
          <div class="mu-danger-zone ph-danger"><div class="mu-row-info"><span class="mu-row-title">${esc(t("deleteAllData"))}</span><span class="mu-row-subtitle">${esc(t("deleteAllDataHelp"))}</span></div><button type="button" class="mu-btn mu-btn-danger" id="deleteAllBtn"><span class="mu-icon" aria-hidden="true">delete_forever</span>${esc(t("deleteAllData"))}</button></div>
        </div>` });
    d.modal.addEventListener("change", (e) => {
      const el = e.target.closest("[data-setting]");
      if (!el) return;
      let value = el.type === "checkbox" ? el.checked : el.value;
      if (["slideshowInterval", "trashDays"].includes(el.dataset.setting)) value = Number(value);
      if (!saveSettings({ [el.dataset.setting]: value })) return;
      if (el.dataset.setting === "quality") try { store.set("munetios_photo_quality", value); } catch {}
      if (el.dataset.setting === "accountSync" && value) registerSync();
      if (el.dataset.setting === "cloudBackup" && value) backupEverything();
      translateUI();
      render();
    });
    d.q("#themeSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-theme-pref]"); if (!b) return; UI.theme.set(b.dataset.themePref); d.qa("#themeSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
    d.q("#langBtn").addEventListener("click", () => Cloud.pickLanguage({ value: settings.language, uiLocale: uiLocale(), t, onPick: async (value) => { if (saveSettings({ language: value })) { buildCatalog(); await loadPlayerStrings(); translateUI(); render(); d.close(); openSettings(); } } }));
    d.q("#setImportZip").addEventListener("click", () => $("zipInput").click());
    d.q("#setExportZip").addEventListener("click", () => exportZip([...photos.values()].filter((p) => !p.trashed && !p.locked)));
    d.q("#setBackupAll").addEventListener("click", backupEverything);
    d.q("#setFreeSpace").addEventListener("click", freeUpSpace);
    d.q("#setupPin")?.addEventListener("click", () => { d.close(); go("locked"); });
    d.q("#resetPin")?.addEventListener("click", async () => { if (await confirmDialog({ icon: "password", title: t("changePin"), text: t("changePinHelp"), confirm: t("continue") })) { saveSettings({ lockedHash: "", lockedSalt: "" }); unlocked = false; d.close(); go("locked"); render(); } });
    d.q("#deleteAllBtn").addEventListener("click", async () => {
      if (!(await confirmDialog({ icon: "delete_forever", title: t("deleteAllData"), text: t("deleteAllDataConfirm"), confirm: t("deleteAllData"), danger: true }))) return;
      try {
        for (const s of [PHOTOS, ALBUMS, KEYS]) await tx(s, "readwrite", (st) => st.clear());
        for (const info of shared.values()) if (info.space.role === "owner") await info.space.remove().catch(() => {});
        photos.clear(); albums.clear(); shared.clear(); blobCache.clear();
        d.close(); go("library"); render();
        notify(t("allDataDeleted"), "success");
      } catch { notify(t("errorGeneric"), "error"); }
    });
  }
  const SHORTCUTS = [["U", "upload"], ["/", "search"], ["S", "select"], ["Ctrl + A", "selectAll"], ["Esc", "clearSelection"], ["←  →", "previousNext"], ["F", "favorite"], ["I", "info"], ["E", "edit"], ["+  −", "zoom"], ["Delete", "delete"], ["Alt + 1–5", "rating"], ["?", "keyboardShortcuts"]];
  function openShortcuts() {
    dialog({ icon: "keyboard", title: t("keyboardShortcuts"), size: "md", body: `<div class="mu-shortcuts">${SHORTCUTS.map(([keys, label]) => `<div class="mu-shortcut"><span>${esc(t(label))}</span><span>${keys.split(/\s+\+\s+|\s{2}/).map((k) => `<span class="mu-kbd">${esc(k)}</span>`).join(" ")}</span></div>`).join("")}</div>` });
  }

  /* ================================================================ navigation and events */
  const Routes = window.MunetiosPhotosRoutes;
  const narrowSidebar = matchMedia("(max-width: 900px)");

  function syncSidebar() {
    const open = document.body.classList.contains("is-sidebar-open");
    const expanded = narrowSidebar.matches ? open : !document.body.classList.contains("is-sidebar-collapsed");
    $("sidebarBackdrop").hidden = !open;
    $("sidebarToggle").setAttribute("aria-expanded", String(expanded));
  }

  function dismissSidebar(restoreFocus = false) {
    if (!document.body.classList.contains("is-sidebar-open")) return;
    document.body.classList.remove("is-sidebar-open");
    syncSidebar();
    if (restoreFocus) $("sidebarToggle").focus({ preventScroll: true });
  }

  function updateMediaPath(record, action) {
    const key = record.readOnly ? `${record.spaceId}~${record.photoId}` : record.cloudId || record.id;
    const path = `/photos/photo/${key}`;
    if (location.pathname === path) return;
    if (action === "open" && !Routes.parse(location.pathname)?.media) {
      history.pushState({ photosReturnSection: section }, "", path);
    } else {
      history.replaceState(history.state, "", path);
    }
  }

  function restorePendingMedia() {
    const route = Routes.parse(location.pathname);
    if (route?.media && !viewer) applyLocation();
  }

  function applyLocation() {
    const route = Routes.parse(location.pathname);
    closeViewer(false);
    if (!route?.media) {
      go(route?.section || "library", false);
      return;
    }
    const [key, photoKey] = route.media.split("~");
    const record = photoKey
      ? recordFor(`remote:${key}:${photoKey}`)
      : [...photos.values()].find((p) => p.cloudId === key) || photos.get(Number(key));
    if (!record) {
      go(photoKey ? `shared:${key}` : "library", false);
      return;
    }
    const fallback = record.readOnly ? `shared:${record.spaceId}`
      : record.locked ? "locked" : record.trashed ? "trash" : record.archived ? "archive" : record.isVideo ? "videos" : "library";
    const previous = history.state?.photosReturnSection;
    go(previous && !record.readOnly && !record.locked && visibleIn(record, previous) ? previous : fallback, false);
    if (!record.locked || unlocked) openViewer(record.id, currentIds(), false);
  }

  function go(next, updateURL = true) {
    if (updateURL) {
      const path = Routes.sectionPath(next);
      const route = Routes.parse(location.pathname);
      if (route?.section !== next) {
        closeViewer(false);
        history.pushState(null, "", path);
      }
    }
    if (next === section && !query) { dismissSidebar(true); return; }
    section = next;
    query = ""; $("searchInput").value = "";
    filter = "all"; colorFilter = "";
    clearSelection();
    dismissSidebar();
    render();
    main.focus({ preventScroll: true });
  }
  function bind() {
    document.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-section]");
      if (nav && (nav.closest(".ph-sidebar") || nav.closest(".ph-bottom-nav"))) { go(nav.dataset.section); return; }
    });
    $("sidebarToggle").addEventListener("click", () => {
      if (!narrowSidebar.matches) document.body.classList.toggle("is-sidebar-collapsed");
      else if (document.body.classList.contains("is-sidebar-open")) { dismissSidebar(true); return; }
      else {
        document.body.classList.add("is-sidebar-open");
        $("sidebarClose").focus({ preventScroll: true });
      }
      syncSidebar();
    });
    $("sidebarClose").addEventListener("click", () => dismissSidebar(true));
    $("sidebarBackdrop").addEventListener("click", () => dismissSidebar(true));
    narrowSidebar.addEventListener("change", () => { dismissSidebar(); syncSidebar(); });
    syncSidebar();
    // On phones the camera and select buttons live in the Upload menu.
    $("uploadBtn").addEventListener("click", (e) => {
      if (!matchMedia("(width < 768px)").matches) { $("fileInput").click(); return; }
      menu(e.currentTarget, [
        { icon: "upload", label: t("upload"), action: () => $("fileInput").click() },
        { icon: "photo_camera", label: t("camera"), action: openCamera },
        { icon: "check_circle", label: t("select"), action: () => $("selectBtn").click() },
        { icon: "screen_record", label: t("screenRecord"), action: recordScreen },
      ]);
    });
    $("cameraBtn").addEventListener("click", openCamera);
    $("settingsBtn").addEventListener("click", openSettings);
    $("selectBtn").addEventListener("click", () => { if (selectMode || selection.size) clearSelection(); else { selectMode = true; syncSelection(); } });
    $("newAlbumBtn").addEventListener("click", () => newAlbumFlow());
    $("collageBtn").addEventListener("click", () => openCollage());
    $("recordBtn").addEventListener("click", recordScreen);
    $("stopScreenRecording").addEventListener("click", () => stopScreenCapture());
    $("pauseScreenRecording").addEventListener("click", () => {
      const recorder = screenCapture?.recorder;
      if (recorder?.state === "recording") recorder.pause();
      else if (recorder?.state === "paused") recorder.resume();
    });
    $("shortcutsBtn").addEventListener("click", openShortcuts);
    $("fileInput").addEventListener("change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      const albumId = section.startsWith("album:") ? albumKey(section.slice(6)) : null;
      const added = await importFiles(files, { albumId, locked: section === "locked" && unlocked });
      if (albumId !== null && albums.get(albumId)?.spaceId) pushToSharedAlbum(albums.get(albumId), added.map((p) => p.id));
      if (section.startsWith("shared:")) { const album = shared.get(section.slice(7))?.album; if (album) addToRemoteAlbum(album, added.map((p) => p.id)); }
    });
    $("zipInput").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importZip(f); });
    let searchTimer;
    $("searchInput").addEventListener("input", (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { query = e.target.value.trim(); render(); }, 160); });
    $("actionBar").addEventListener("click", (e) => { const b = e.target.closest("[data-bulk]"); if (b) bulk(b.dataset.bulk); });

    main.addEventListener("click", async (e) => {
      const check = e.target.closest("[data-select]");
      if (check) { e.stopPropagation(); toggleSelect(Number(check.dataset.select), check.checked, { range: e.shiftKey }); return; }
      const open = e.target.closest("[data-open]");
      if (open) {
        const id = Number(open.dataset.open);
        if (selectMode || selection.size || e.ctrlKey || e.metaKey || e.shiftKey) { toggleSelect(id, undefined, { range: e.shiftKey }); return; }
        openViewer(id);
        return;
      }
      const remote = e.target.closest("[data-remote]");
      if (remote) { openViewer(`remote:${section.slice(7)}:${remote.dataset.remote}`); return; }
      const f = e.target.closest("[data-filter]");
      if (f) { filter = f.dataset.filter; render(); return; }
      const c = e.target.closest("[data-color]");
      if (c) { colorFilter = colorFilter === c.dataset.color ? "" : c.dataset.color; render(); return; }
      const groupSel = e.target.closest("[data-select-group]");
      if (groupSel) { groupSel.closest(".ph-group").querySelectorAll("[data-open]").forEach((x) => selection.add(Number(x.dataset.open))); selectMode = true; syncSelection(); return; }
      const goTo = e.target.closest("[data-section-go]");
      if (goTo) { go(goTo.dataset.sectionGo); return; }
      const mem = e.target.closest("[data-memory]");
      if (mem) { const list = onThisDay().find(([y]) => String(y) === mem.dataset.memory)?.[1] || []; startSlideshow(list.map((p) => p.id)); return; }
      const ss = e.target.closest("[data-slideshow-ids]");
      if (ss) { startSlideshow(ss.dataset.slideshowIds.split(",").map(Number)); return; }
      if (e.target.closest("#sortBtn")) {
        const btn = e.target.closest("#sortBtn");
        menu(btn, [
          ...["taken", "added", "name", "size"].map((s) => ({ icon: settings.sort === s ? "check" : "", label: t("sort_" + s), action: () => { saveSettings({ sort: s }, { quiet: true }); render(); } })),
          "-",
          { icon: settings.order === "desc" ? "check" : "", label: t("newestFirst"), action: () => { saveSettings({ order: "desc" }, { quiet: true }); render(); } },
          { icon: settings.order === "asc" ? "check" : "", label: t("oldestFirst"), action: () => { saveSettings({ order: "asc" }, { quiet: true }); render(); } },
          "-",
          ...["day", "month", "year"].map((g) => ({ icon: settings.groupBy === g ? "check" : "", label: t("group_" + g), action: () => { saveSettings({ groupBy: g }, { quiet: true }); render(); } })),
        ]);
        return;
      }
      const action = e.target.closest("[data-action]")?.dataset.action;
      const album = section.startsWith("album:") ? albums.get(albumKey(section.slice(6))) : null;
      if (action === "upload" || action === "album-add") $("fileInput").click();
      else if (action === "new-album") newAlbumFlow();
      else if (action === "album-share" && album) shareAlbum(album);
      else if (action === "album-slideshow") startSlideshow(currentIds());
      else if (action === "album-menu" && album) albumMenu(e.target.closest("[data-action]"), album);
      else if (action === "remote-add") $("fileInput").click();
      else if (action === "remote-share") { const info = shared.get(section.slice(7)); if (info) Cloud.openShareDialog({ space: info.space, kind: "album", title: info.album.name, t, me: A?.state?.account, onLeave: () => leaveSharedAlbum(info.album) }).catch(() => notify(t("errorShareAlbum"), "error")); }
      else if (action === "remote-leave") { const info = shared.get(section.slice(7)); if (info) leaveSharedAlbum(info.album).catch((err) => { if (err?.code !== "cancelled") notify(t("errorGeneric"), "error"); }); }
      if (e.target.closest("#emptyTrashBtn")) { const ids = [...photos.values()].filter((p) => p.trashed).map((p) => p.id); if (await confirmDialog({ icon: "delete_sweep", title: t("emptyTrash"), text: t("deleteForeverConfirm", { n: num(ids.length) }), confirm: t("emptyTrash"), danger: true })) await purge(ids); }
      if (e.target.closest("#lockNowBtn")) { unlocked = false; render(); }
      if (e.target.closest("#lockedUploadBtn")) $("fileInput").click();
    });
    main.addEventListener("input", (e) => { if (e.target.id === "gridZoom") { main.style.setProperty("--tile", `${e.target.value}px`); } });
    main.addEventListener("change", (e) => { if (e.target.id === "gridZoom") saveSettings({ gridSize: Number(e.target.value) }, { quiet: true }); });
    main.addEventListener("wheel", (e) => { if (!e.ctrlKey || !main.querySelector(".ph-grid")) return; e.preventDefault(); const next = Math.max(100, Math.min(360, settings.gridSize + (e.deltaY < 0 ? 20 : -20))); settings.gridSize = next; main.style.setProperty("--tile", `${next}px`); const z = $("gridZoom"); if (z) { z.value = next; z.dispatchEvent(new Event("input", { bubbles: true })); } clearTimeout(main._zt); main._zt = setTimeout(() => saveSettings({ gridSize: next }, { quiet: true }), 300); }, { passive: false });

    // Drag and drop anywhere, and paste to upload
    let dragDepth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; dragDepth++; $("dropOverlay").hidden = false; });
    addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("dropOverlay").hidden = true; });
    addEventListener("drop", async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragDepth = 0; $("dropOverlay").hidden = true;
      const albumId = section.startsWith("album:") ? albumKey(section.slice(6)) : null;
      const added = await importFiles(e.dataTransfer.files, { albumId, locked: section === "locked" && unlocked });
      if (albumId !== null && albums.get(albumId)?.spaceId) pushToSharedAlbum(albums.get(albumId), added.map((p) => p.id));
    });
    addEventListener("paste", (e) => {
      if (e.target.closest?.("input, textarea")) return;
      const files = [...(e.clipboardData?.files || [])].filter(isMedia);
      if (files.length) { e.preventDefault(); importFiles(files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `Pasted ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}${i ? "-" + i : ""}.png`, { type: f.type })))); }
    });

    document.addEventListener("keydown", (e) => {
      if (viewer || slideshow || document.querySelector(".ph-editor, .mu-modal:not([hidden])")) return;
      if (e.key === "Escape" && document.body.classList.contains("is-sidebar-open")) {
        e.preventDefault();
        dismissSidebar(true);
        return;
      }
      if (e.target.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); currentIds().filter((x) => typeof x === "number").forEach((id) => selection.add(id)); selectMode = true; syncSelection(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const map = { u: () => $("fileInput").click(), "/": () => $("searchInput").focus(), s: () => $("selectBtn").click(), escape: clearSelection, delete: () => selection.size && bulk("delete"), "?": openShortcuts };
      const fn = map[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(); }
    });
    let rateNoticeAt = 0;
    addEventListener("munetios-cloud-rate-limited", (e) => {
      if (Date.now() - rateNoticeAt < 20000) return;
      rateNoticeAt = Date.now();
      notify(Cloud.errorText({ code: "rateLimited", body: e.detail }, t("errorGeneric"), t), "error");
    });
    document.addEventListener("mu-theme", () => {});
    A?.on?.(refreshCloudConnection);
    addEventListener("beforeunload", (e) => { if ([...uploads.values()].some((u) => u.entry.state === "active")) { e.preventDefault(); e.returnValue = ""; } });
  }
  let cloudConnected = false;
  function refreshCloudConnection() {
    const connected = signedIn() && !A.state.offline && navigator.onLine !== false;
    if (!signedIn()) cloudUsage = null;
    renderCloudStatus({ fetch: connected });
    if (connected && !cloudConnected) {
      cloudConnected = true;
      loadSharedAlbums();
      refreshCloudUsage();
      for (const job of uploads.values()) if (job.retryOnReconnect && job.entry.state === "failed") job.entry.retry?.();
      for (const p of photos.values()) if (!p.cloud && !p.locked && !p.trashed) queueUpload(p);
      pump();
    } else {
      cloudConnected = connected;
    }
  }

  /* ================================================================ start */
  async function migrate() {
    // Earlier versions used numbered albums. Give every album a stable id that syncs across devices.
    if (store.get("munetiosPhotos:migrated")) return;
    const list = await allRecords(ALBUMS);
    const map = new Map();
    for (const a of list) {
      if (typeof a.id === "string") continue;
      const next = Object.assign({}, a, { id: uid(), sort: a.sort || "newest", description: a.description || "", updatedAt: Date.now() });
      next.uid = next.id;
      map.set(a.id, next.id);
      await putRecord(ALBUMS, next);
      await deleteRecord(ALBUMS, a.id);
    }
    for (const p of await allRecords(PHOTOS)) {
      let changed = false;
      if (!p.cloudId) { p.cloudId = uid(); changed = true; }
      if ((p.albums || []).some((id) => map.has(id))) { p.albums = p.albums.map((id) => map.get(id) ?? id); changed = true; }
      if (changed) await putRecord(PHOTOS, p);
    }
    store.set("munetiosPhotos:migrated", "1");
  }
  function startEmbeddedPicker() {
    if (window.top !== window.parent) return;
    const kind = new URLSearchParams(location.search).get("omniwrite-picker");
    if (kind !== "image" && kind !== "video") return;
    const allowedOrigins = new Set(["https://write.munetios.com", "https://beta.munetios.com"]);
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) allowedOrigins.add(location.origin);
    const connect = (event) => {
      if (event.source !== window.parent || !allowedOrigins.has(event.origin) || event.data?.type !== "munetios-photos-picker" || !event.ports[0]) return;
      window.removeEventListener("message", connect);
      void showEmbeddedPicker(kind, event.ports[0]);
    };
    window.addEventListener("message", connect);
  }

  async function showEmbeddedPicker(kind, port) {
    const grid = $("phPicker");
    const allowed = (record) => record && visibleIn(record, "library") && typeof record.type === "string" && record.type.startsWith(kind + "/");
    const local = [], localCloudIds = new Set();
    let remote = [], accountId, busy = false;
    const measure = () => port.postMessage({ type: "grid", height: Math.ceil(grid.getBoundingClientRect().height) });
    const resize = new ResizeObserver(measure);
    resize.observe(grid);

    async function readBlob(entry, refreshAccount = false) {
      if (entry.remote) {
        if (refreshAccount) await A.refresh({ scheduleSync: false });
        if (A.state.account?.id !== accountId || A.state.revocation) throw new Error("accountChanged");
        const blob = await getBlob(entry);
        if (A.state.account?.id !== accountId || A.state.revocation) throw new Error("accountChanged");
        return blob;
      }
      const record = await getRecord(PHOTOS, entry.id);
      if (!allowed(record)) throw new Error("unavailable");
      return getBlob(record);
    }

    const thumbnails = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        thumbnails.unobserve(target);
        readBlob(target.photo).then(blob => describeMedia(blob, kind === "video")).then(({ thumb }) => {
          if (target.isConnected) target.src = thumb;
        }).catch(() => {});
      }
    }, { root: grid, rootMargin: "120px" });

    function renderPicker() {
      const records = sorted([...local, ...remote]);
      thumbnails.disconnect();
      const items = document.createDocumentFragment();
      for (const record of records) {
        const tile = document.createElement("div");
        tile.className = "ph-tile";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ph-tile-open";
        button.setAttribute("aria-label", record.name || t(kind === "video" ? "video" : "photos"));
        const preview = document.createElement("img");
        preview.alt = "";
        preview.loading = "lazy";
        preview.decoding = "async";
        preview.photo = record;
        if (/^data:image\/(?:webp|jpeg|png);base64,/i.test(record.thumb || "")) preview.src = record.thumb;
        else thumbnails.observe(preview);
        button.appendChild(preview);
        button.addEventListener("click", async (event) => {
          if (!event.isTrusted || busy) return;
          busy = true;
          grid.setAttribute("aria-busy", "true");
          try {
            const blob = await readBlob(record, true);
            port.postMessage({ type: "selection", blob, name: record.name });
          } catch {
            port.postMessage({ type: "error" });
          } finally {
            busy = false;
            grid.removeAttribute("aria-busy");
          }
        });
        tile.appendChild(button);
        items.appendChild(tile);
      }
      grid.replaceChildren(items);
      grid.hidden = records.length === 0;
      measure();
    }

    try {
      buildCatalog();
      await tx(PHOTOS, "readonly", (store) => {
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const { id, cloudId, name, date, takenAt, thumb, type, size } = row.value;
          if (cloudId) localCloudIds.add(cloudId);
          if (allowed(row.value)) local.push({ id, name, date, takenAt, thumb, type, size });
          row.continue();
        };
      });
      if (local.length) renderPicker();
      if (settings.accountSync && A?.photos) {
        const state = await A.refresh({ scheduleSync: false });
        if (state.offline && !local.length) throw new Error("offline");
        if (state.account) {
          const library = await A.photos.readLibrary();
          accountId = library.accountId;
          remote = library.photos.filter((record) => allowed(record) && !localCloudIds.has(record.cloudId))
            .map((record) => ({ ...record, id: `picker-${record.cloudId}`, remote: true }));
          if (remote.length) renderPicker();
        }
      }
      if (!local.length && !remote.length) port.postMessage({ type: "empty" });
    } catch {
      if (!local.length) port.postMessage({ type: "error" });
    }
  }

  async function start() {
    if (document.documentElement.hasAttribute("data-ph-embedded")) { startEmbeddedPicker(); return; }
    buildCatalog();
    translateUI();
    await loadPlayerStrings();
    bind();
    try {
      await migrate();
      for (const a of await allRecords(ALBUMS)) albums.set(a.id, a);
      for (const p of await allRecords(PHOTOS)) photos.set(p.id, p);
    } catch {
      main.setAttribute("aria-busy", "false");
      main.innerHTML = `<div class="mu-empty ph-empty"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">error</span></span><span>${esc(t("errorLoadPhotos"))}</span><button type="button" class="mu-btn mu-btn-primary" onclick="location.reload()"><span class="mu-icon" aria-hidden="true">refresh</span>${esc(t("retry"))}</button></div>`;
      notify(t("errorLoadPhotos"), "error");
      return;
    }
    render();
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    purgeOldTrash();
    registerSync();
    cloudConnected = false;
    refreshCloudConnection();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", document.baseURI)).catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
