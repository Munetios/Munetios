// Munetios Photos picker for attachments.
// Munetios Photos keeps its library end-to-end encrypted on the device (IndexedDB) with optional encrypted cloud
// backup through Munetios Cloud. This picker reads that library read-only on this origin, decrypts only the items
// the user selects, optionally resizes, compresses, and strips metadata, and returns the bytes for upload into
// private mail attachment storage. Nothing in Photos is changed or shared, and no public link is created.
import { t, formatBytes, formatDate } from "./i18n.js";
import { el, icon, iconButton, dialog, button, select, toast, emptyState } from "./ui.js";

const scope = window.MunetiosWorkspaceScope;
const DB_NAME = scope ? scope.local("munetios_photos") : "munetios_photos";
const toBytes = data => data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : Array.isArray(data) ? new Uint8Array(data) : new Uint8Array();

async function openLibrary() {
    if (indexedDB.databases) {
        const names = (await indexedDB.databases()).map(item => item.name);
        if (!names.includes(DB_NAME)) return null; // never create an empty Photos database
    }
    return new Promise(resolve => {
        const request = indexedDB.open(DB_NAME);
        request.onupgradeneeded = () => { request.transaction.abort(); resolve(null); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
}

function readAll(db, store) {
    return new Promise(resolve => {
        if (!db.objectStoreNames.contains(store)) return resolve([]);
        const request = db.transaction(store, "readonly").objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
    });
}

function readOne(db, store, key) {
    return new Promise(resolve => {
        const request = db.transaction(store, "readonly").objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
    });
}

const sizeOf = record => record.size || record.encryption?.originalSize || record.cloud?.plainSize || (record.data ? toBytes(record.data).byteLength : 0);
const takenAt = record => Date.parse(record.takenAt || record.date) || 0;

async function originalBlob(db, record, onProgress, signal) {
    if (record.data) {
        if (!record.encryption?.enabled) return new Blob([toBytes(record.data)], { type: record.type });
        const stored = await readOne(db, "photo_keys", record.encryption.keyId);
        if (stored?.keyData) {
            const key = await crypto.subtle.importKey("raw", stored.keyData, { name: "AES-GCM" }, false, ["decrypt"]);
            const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.encryption.iv || []) }, key, toBytes(record.data));
            return new Blob([plain], { type: record.type });
        }
    }
    const ref = record.cloud || record.remote;
    if (ref && window.MunetiosCloud?.downloadBlob) return window.MunetiosCloud.downloadBlob(ref, record.type, { onProgress, signal });
    throw new Error("unavailable");
}

// Re-encodes an image through a canvas: resizes, compresses, and drops EXIF/GPS metadata.
export async function processImage(blob, { maxSize = 0, quality = 0.9, stripMetadata = true, keepFormat = true } = {}) {
    if (!/^image\/(jpeg|png|webp)$/.test(blob.type) || (!maxSize && !stripMetadata && quality >= 1)) return blob;
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    let { width, height } = bitmap;
    if (maxSize && Math.max(width, height) > maxSize) { const scale = maxSize / Math.max(width, height); width = Math.round(width * scale); height = Math.round(height * scale); }
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const type = keepFormat && blob.type !== "image/png" ? blob.type : blob.type === "image/png" && quality >= 1 ? "image/png" : "image/jpeg";
    return canvas.convertToBlob({ type, quality });
}

// Resolves with [{ blob, name, inline }] or [] when canceled.
export function pickPhotos({ defaultInline = false } = {}) {
    return new Promise(async resolve => {
        const db = await openLibrary();
        let settled = false;
        const finish = value => { if (settled) return; settled = true; resolve(value); if (!value.length) db?.close(); };
        if (!db) {
            const d = dialog({ title: t("selectFromPhotos"), iconName: "photo_library", onClose: () => finish([]),
                content: [emptyState("photo_library", t("photosEmpty"), t("photosEmptyDetail"), el("a", { class: "mu-btn", href: "/photos/", target: "_blank", rel: "noopener" }, icon("open_in_new"), t("openPhotos")))],
                actions: [button(t("close"), () => d.close())] });
            return;
        }
        const records = (await readAll(db, "photos")).filter(record => !record.trashed && !record.locked);
        const albums = (await readAll(db, "albums")).filter(album => !album.sharedWithMe);
        const selected = new Set();
        const thumbs = new Map();
        let query = "", album = "", sort = "taken", grouping = "month";
        const options = { inline: defaultInline, compress: false, resize: 0, strip: true };
        const grid = el("div", { class: "mail-photos-grid", role: "listbox", "aria-multiselectable": "true", "aria-label": t("photos") });
        const summary = el("span", { class: "mu-muted" });
        const search = el("input", { class: "mu-input", type: "search", placeholder: t("searchPhotos"), "aria-label": t("searchPhotos") });
        search.addEventListener("input", () => { query = search.value.toLowerCase(); render(); });
        const updateSummary = () => {
            const bytes = [...selected].reduce((sum, id) => sum + sizeOf(records.find(record => record.id === id) || {}), 0);
            summary.textContent = selected.size ? t("photosSelected", { count: selected.size, size: formatBytes(bytes) }) : t("noneSelected");
            attachButton.disabled = !selected.size;
        };
        const preview = async record => {
            try {
                const blob = await originalBlob(db, record);
                const url = URL.createObjectURL(blob);
                const media = record.isVideo ? el("video", { src: url, controls: true, autoplay: true }) : el("img", { src: url, alt: record.name || "" });
                const close = () => { box.remove(); URL.revokeObjectURL(url); };
                const box = el("div", { class: "mail-lightbox", role: "dialog", "aria-label": record.name || t("preview"), tabindex: "-1" }, media, iconButton("close", t("close"), close));
                box.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); close(); } });
                box.addEventListener("click", event => { if (event.target === box) close(); });
                document.body.append(box);
                box.focus();
            } catch { toast(t("photoUnavailable"), "error"); }
        };
        function render() {
            let list = records.filter(record => !album || (record.albums || []).map(String).includes(album));
            if (query) list = list.filter(record => [record.name, record.notes, ...(record.tags || []), formatDate(takenAt(record), { dateStyle: "long" }), formatDate(takenAt(record), { month: "long", year: "numeric" })].join(" ").toLowerCase().includes(query));
            list.sort((a, b) => sort === "name" ? String(a.name).localeCompare(String(b.name)) : sort === "size" ? sizeOf(b) - sizeOf(a) : takenAt(b) - takenAt(a));
            const nodes = [];
            let lastGroup = "";
            for (const record of list) {
                if (sort === "taken" && grouping !== "none") {
                    const group = formatDate(takenAt(record) || Date.now(), grouping === "day" ? { dateStyle: "full" } : { month: "long", year: "numeric" });
                    if (group !== lastGroup) { nodes.push(el("div", { class: "mail-photos-group", role: "presentation", text: group })); lastGroup = group; }
                }
                const tile = el("button", { type: "button", class: "mail-photo", role: "option", "aria-pressed": String(selected.has(record.id)), "aria-selected": String(selected.has(record.id)), "aria-label": `${record.name || t("photo")}, ${formatBytes(sizeOf(record))}${record.isVideo ? ", " + t("video") : ""}` },
                    record.thumb ? el("img", { src: record.thumb, alt: "", loading: "lazy" }) : el("span", { class: "mu-icon", "aria-hidden": "true", text: record.isVideo ? "movie" : "image", style: "display:grid;place-items:center;height:100%" }),
                    el("span", { class: "mail-photo-check", "aria-hidden": "true" }, icon(selected.has(record.id) ? "check" : "radio_button_unchecked")),
                    el("span", { class: "mail-photo-meta", "aria-hidden": "true" }, el("span", { text: record.isVideo ? t("video") : "" }), el("span", { text: formatBytes(sizeOf(record)) })));
                const zoom = el("span", { class: "mail-photo-zoom", role: "button", tabindex: "0", "aria-label": t("preview") }, icon("fullscreen"));
                zoom.addEventListener("click", event => { event.stopPropagation(); preview(record); });
                zoom.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); preview(record); } });
                tile.append(zoom);
                tile.addEventListener("click", () => { if (selected.has(record.id)) selected.delete(record.id); else selected.add(record.id); render(); updateSummary(); });
                nodes.push(tile);
            }
            grid.replaceChildren(...(nodes.length ? nodes : [emptyState("image_search", t("noPhotosMatch"), "")]));
            thumbs.clear();
        }
        const attachButton = button(t("attachSelected"), () => { const chosen = [...selected].map(id => records.find(record => record.id === id)).filter(Boolean); finish(prepare(db, chosen, options)); d.close(); }, { primary: true });
        const tools = el("div", { class: "mail-photos-tools" }, search,
            select(t("album"), [{ value: "", label: t("allPhotos") }, ...albums.map(item => ({ value: String(item.id), label: item.name }))], "", value => { album = value; render(); }),
            select(t("sort"), [{ value: "taken", label: t("byDate") }, { value: "name", label: t("byName") }, { value: "size", label: t("bySize") }], "taken", value => { sort = value; render(); }),
            select(t("groupBy"), [{ value: "month", label: t("byMonth") }, { value: "day", label: t("byDay") }, { value: "none", label: t("noGrouping") }], "month", value => { grouping = value; render(); }));
        const optionsRow = el("div", { class: "mail-photos-options" },
            el("label", { class: "mu-check" }, (() => { const box = el("input", { type: "checkbox" }); box.checked = options.inline; box.addEventListener("change", () => { options.inline = box.checked; }); return box; })(), t("insertInline")),
            el("label", { class: "mu-check" }, (() => { const box = el("input", { type: "checkbox" }); box.checked = options.compress; box.addEventListener("change", () => { options.compress = box.checked; }); return box; })(), t("compressImages")),
            select(t("resize"), [{ value: 0, label: t("originalSize") }, { value: 3840, label: "3840 px" }, { value: 2048, label: "2048 px" }, { value: 1600, label: "1600 px" }, { value: 1024, label: "1024 px" }], 0, value => { options.resize = Number(value); }),
            el("label", { class: "mu-check" }, (() => { const box = el("input", { type: "checkbox" }); box.checked = options.strip; box.addEventListener("change", () => { options.strip = box.checked; }); return box; })(), t("removeMetadata")),
            el("span", { class: "mu-muted", style: undefined, text: t("videoMetadataNote") }));
        const d = dialog({ title: t("selectFromPhotos"), iconName: "photo_library", size: "mu-dialog-lg", onClose: () => finish([]),
            content: [el("div", { class: "mail-photos" }, tools, summary, grid, optionsRow)], actions: [button(t("cancel"), () => d.close()), attachButton] });
        render();
        updateSummary();
    });
}

// Decrypts (or downloads from Munetios Cloud) and processes each selected item. Returns jobs that start lazily so
// the composer can show progress, cancel, and retry each one.
function prepare(db, records, options) {
    return records.map(record => ({
        name: record.name || (record.isVideo ? "video" : "photo"),
        size: sizeOf(record),
        inline: options.inline && !record.isVideo,
        async load({ onProgress, signal } = {}) {
            const original = await originalBlob(await reopen(db), record, onProgress, signal);
            if (record.isVideo) return original;
            const processed = await processImage(original, { maxSize: options.resize, quality: options.compress ? 0.82 : 0.95, stripMetadata: options.strip });
            return processed.size && (options.strip || options.resize || processed.size < original.size) ? processed : original;
        },
    }));
}

let reopened = null;
async function reopen(db) {
    try { db.transaction("photos", "readonly"); return db; }
    catch { reopened ||= await openLibrary(); return reopened; }
}

