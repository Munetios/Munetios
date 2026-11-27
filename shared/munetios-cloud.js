/*!
 * Munetios Cloud client for Calendar and Photos.
 *  - Spaces: shared calendars and albums. Content is encrypted with AES-GCM in
 *    the browser. The space key is kept by Munetios so collaborators can open it.
 *  - Chunked uploads: files are split into encrypted chunks (one request each),
 *    retried with backoff, and resumed after a connection drops.
 *  - Sharing dialog: add people by their Munetios Account email, change roles,
 *    remove people, and stop sharing.
 * Requires munetios-ui-v4.js and cloud-i18n.js.
 */
(() => {
  "use strict";
  const API = "/api/cloud";
  const PLAIN_CHUNK = 4 * 1024 * 1024;
  const TAG = 16;
  const CHUNK_ATTEMPTS = 5;
  const PARALLEL_CHUNKS = 3;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buffer) => { const bytes = new Uint8Array(buffer); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const b64url = (buffer) => b64(buffer).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64url = (value) => unb64(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  class CloudError extends Error {
    constructor(code, status, body) { super(code); this.code = code; this.status = status; this.body = body; }
  }

  async function request(path, { method = "GET", body, bytes, signal } = {}) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (bytes !== undefined) headers["content-type"] = "application/octet-stream";
    let response;
    try {
      response = await fetch(API + path, { method, headers, credentials: "same-origin", signal, body: bytes ?? (body === undefined ? undefined : JSON.stringify(body)) });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new CloudError("offline", 0);
    }
    const type = response.headers.get("content-type") || "";
    const data = type.includes("json") ? await response.json().catch(() => ({})) : await response.arrayBuffer();
    // A 404 without a JSON error means this server doesn't have the Munetios Cloud API at all
    // (for example, a server started before it was installed). Report that once instead of per request.
    // Apps listen for this to explain why a change didn't save.
    if (response.status === 429) window.dispatchEvent(new CustomEvent("munetios-cloud-rate-limited", { detail: data }));
    if (!response.ok) throw new CloudError(response.status === 404 && !type.includes("json") ? "notDeployed" : data?.error || "unavailable", response.status, data);
    return data;
  }

  /* ---------------------------------------------------------- crypto */
  async function newKey() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
  const importKey = (key) => crypto.subtle.importKey("raw", unb64url(key), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  async function encryptJson(key, kind, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("munetios-cloud:" + kind) }, await importKey(key), enc.encode(JSON.stringify(value)));
    return { iv: b64(iv), ciphertext: b64(data) };
  }
  async function decryptJson(key, kind, iv, ciphertext) {
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode("munetios-cloud:" + kind) }, await importKey(key), unb64(ciphertext));
    return JSON.parse(dec.decode(data));
  }
  function chunkIv(base, index) {
    const iv = new Uint8Array(base);
    const view = new DataView(iv.buffer);
    view.setUint32(8, (view.getUint32(8) ^ index) >>> 0);
    return iv;
  }

  /* ---------------------------------------------------------- uploads */
  // Uploads a Blob in encrypted chunks. Returns what is needed to download and decrypt it later.
  // options: { onProgress(sent, total), signal, resume: previous result of a failed upload }
  async function uploadBlob(blob, options = {}) {
    const plainSize = blob.size;
    const chunkCount = Math.max(1, Math.ceil(plainSize / PLAIN_CHUNK));
    const size = plainSize + chunkCount * TAG;
    const state = options.resume || {
      key: await newKey(),
      iv: b64(crypto.getRandomValues(new Uint8Array(12))),
      chunkSize: PLAIN_CHUNK + TAG,
      plainChunk: PLAIN_CHUNK,
      plainSize, size, chunkCount, blobId: null,
    };
    if (!state.blobId) {
      const created = await request("/uploads", { method: "POST", body: { size, chunkSize: state.chunkSize, chunkCount }, signal: options.signal });
      state.blobId = created.id;
    }
    options.onState?.(state);
    const key = await importKey(state.key);
    const baseIv = unb64(state.iv);
    let received = new Set();
    if (options.resume) {
      try { received = new Set((await request(`/uploads/${state.blobId}`, { signal: options.signal })).received); } catch (error) {
        if (error.status === 404) { delete state.blobId; return uploadBlob(blob, { ...options, resume: null }); }
        throw error;
      }
    }
    let sent = 0;
    const sizeOf = (index) => Math.min(PLAIN_CHUNK, plainSize - index * PLAIN_CHUNK);
    received.forEach((index) => { sent += sizeOf(index); });
    options.onProgress?.(sent, plainSize);
    const queue = [];
    for (let index = 0; index < chunkCount; index++) if (!received.has(index)) queue.push(index);
    async function sendChunk(index) {
      const plain = await blob.slice(index * PLAIN_CHUNK, index * PLAIN_CHUNK + PLAIN_CHUNK).arrayBuffer();
      const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: chunkIv(baseIv, index), additionalData: enc.encode(`${state.blobId}:${index}:${chunkCount}`) }, key, plain);
      for (let attempt = 1; ; attempt++) {
        if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
          await request(`/uploads/${state.blobId}/chunks/${index}`, { method: "PUT", bytes: data, signal: options.signal });
          sent += plain.byteLength;
          options.onProgress?.(sent, plainSize);
          return;
        } catch (error) {
          if (error?.name === "AbortError" || error.code === "notDeployed" || error.status === 413 || error.status === 404 || error.status === 409 || attempt >= CHUNK_ATTEMPTS) throw error;
          if (!navigator.onLine) await new Promise((resolve) => addEventListener("online", resolve, { once: true }));
          else await sleep(Math.min(16000, 1000 * 2 ** (attempt - 1)));
        }
      }
    }
    const workers = Array.from({ length: Math.min(PARALLEL_CHUNKS, queue.length) }, async () => {
      while (queue.length) await sendChunk(queue.shift());
    });
    await Promise.all(workers);
    await request(`/uploads/${state.blobId}/complete`, { method: "POST", body: {}, signal: options.signal });
    return { blobId: state.blobId, key: state.key, iv: state.iv, chunkSize: state.chunkSize, plainChunk: state.plainChunk, plainSize, chunkCount };
  }

  async function downloadBlob(ref, type, { onProgress, signal } = {}) {
    const key = await importKey(ref.key);
    const baseIv = unb64(ref.iv);
    const parts = [];
    let got = 0;
    for (let index = 0; index < ref.chunkCount; index++) {
      const data = await request(`/blobs/${ref.blobId}/chunks/${index}`, { signal });
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: chunkIv(baseIv, index), additionalData: enc.encode(`${ref.blobId}:${index}:${ref.chunkCount}`) }, key, data);
      parts.push(plain);
      got += plain.byteLength;
      onProgress?.(got, ref.plainSize);
    }
    return new Blob(parts, { type: type || "application/octet-stream" });
  }

  const available = () => request("/calendar/holidays/countries").then(() => true, (error) => error.code !== "notDeployed" && error.code !== "offline");
  const deleteBlob = (blobId) => request(`/blobs/${blobId}`, { method: "DELETE" }).catch((error) => { if (error.status !== 404) throw error; });
  const storage = () => request("/storage");

  /* ---------------------------------------------------------- spaces */
  // A shared calendar or album. content: { meta: {...}, items: { [id]: {...} } }
  class Space {
    constructor(info) { Object.assign(this, info); this.listeners = new Set(); this.source = null; }
    static async list(kind) { return (await request(`/spaces?kind=${kind}`)).spaces; }
    static async create(kind, content) {
      const key = await newKey();
      const sealed = await encryptJson(key, kind, content);
      const created = await request("/spaces", { method: "POST", body: { kind, key, ...sealed } });
      return new Space({ id: created.id, kind, role: "owner", version: 1, key, content });
    }
    static async open(id) {
      const data = await request(`/spaces/${id}`);
      const content = await decryptJson(data.key, data.kind, data.iv, data.ciphertext);
      return new Space({ id, kind: data.kind, role: data.role, version: data.version, key: data.key, owner: data.owner, me: data.me, content });
    }
    async reload() {
      const data = await request(`/spaces/${this.id}`);
      this.content = await decryptJson(data.key, data.kind, data.iv, data.ciphertext);
      Object.assign(this, { role: data.role, version: data.version, owner: data.owner });
      return this;
    }
    // Applies mutate(content) and saves. On a conflict it reapplies the change to the newest version.
    async update(mutate) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const next = structuredClone(this.content);
        mutate(next);
        const sealed = await encryptJson(this.key, this.kind, next);
        try {
          const saved = await request(`/spaces/${this.id}/content`, { method: "PUT", body: { baseVersion: this.version, ...sealed } });
          this.version = saved.version;
          this.content = next;
          return this;
        } catch (error) {
          if (error.status !== 409) throw error;
          this.version = error.body.version;
          this.content = await decryptJson(this.key, this.kind, error.body.iv, error.body.ciphertext);
        }
      }
      throw new CloudError("conflict", 409);
    }
    async remove() { await request(`/spaces/${this.id}`, { method: "DELETE" }); this.stop(); }
    members() { return request(`/spaces/${this.id}/members`); }
    addMember(email, role) { return request(`/spaces/${this.id}/members`, { method: "POST", body: { email, role } }); }
    setRole(accountId, role) { return request(`/spaces/${this.id}/members/${accountId}`, { method: "PATCH", body: { role } }); }
    removeMember(accountId) { return request(`/spaces/${this.id}/members/${accountId}`, { method: "DELETE" }); }
    linkBlob(blobId) { return request(`/spaces/${this.id}/blobs`, { method: "POST", body: { blobId } }); }
    unlinkBlob(blobId) { return request(`/spaces/${this.id}/blobs/${blobId}`, { method: "DELETE" }).catch((error) => { if (error.status !== 404) throw error; }); }
    // Live updates. listener({ type: "content" | "role" | "members" | "revoked" | "deleted" })
    watch(listener) {
      this.listeners.add(listener);
      if (!this.source && "EventSource" in window) {
        const source = new EventSource(`${API}/spaces/${this.id}/events`);
        this.source = source;
        source.onmessage = async (message) => {
          let event;
          try { event = JSON.parse(message.data); } catch { return; }
          if (event.type === "content" && event.version > this.version) { try { await this.reload(); } catch { return; } }
          if (event.type === "role") this.role = event.role;
          if (event.type === "revoked" || event.type === "deleted") this.stop();
          this.listeners.forEach((fn) => fn(event, this));
        };
      }
      return () => this.listeners.delete(listener);
    }
    stop() { this.source?.close(); this.source = null; }
  }

  /* ---------------------------------------------------------- strings */
  let composedStrings = null;
  function strings(locale) {
    composedStrings = composedStrings || window.MunetiosLocales.compose(window.MunetiosCloudStrings, {}, { es: "ES", pt: "BR" });
    return composedStrings[window.MunetiosLocales.resolve(locale) || "en-US"] || composedStrings["en-US"];
  }
  function errorText(error, fallback, t) {
    if (error?.code === "offline") return t("errorOffline");
    if (error?.code === "notDeployed") return t("cloudUnavailable");
    if (error?.code === "rateLimited") return t("errorRateLimited", { minutes: Math.max(1, Math.ceil((Number(error.body?.retryAfter) || 60) / 60)) });
    if (error?.code === "storageFull") return t("errorStorageFull");
    if (error?.code === "signedOut") return t("errorSignedOut");
    if (error?.code === "noAccess") return t("errorNoAccess");
    return fallback;
  }

  /* ---------------------------------------------------------- sharing dialog */
  // openShareDialog({ space, title, kind, t, me, onStop, onLeave, onChange })
  async function openShareDialog(options) {
    const { space, t } = options;
    const id = "muShare" + Math.random().toString(36).slice(2, 8);
    const modal = document.createElement("div");
    modal.className = "mu-modal mu-share-dialog";
    modal.id = id;
    modal.hidden = true;
    const owner = space.role === "owner";
    modal.innerHTML = `
      <div class="mu-dialog mu-dialog-md" role="dialog" aria-modal="false" aria-labelledby="${id}T">
        <div class="mu-dialog-header"><div class="mu-dialog-heading"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">${options.kind === "album" ? "photo_album" : "calendar_month"}</span></span><h2 id="${id}T">${esc(t("shareTitle", { name: options.title }))}</h2></div>
        <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-close aria-label="${esc(t("close"))}"><span class="mu-icon" aria-hidden="true">close</span></button></div>
        ${owner ? `<form class="mu-share-add" novalidate>
          <label class="mu-field"><span class="mu-field-label">${esc(t("shareEmail"))}</span><input class="mu-input" type="email" name="email" autocomplete="email" required placeholder="${esc(t("shareEmailPlaceholder"))}"></label>
          <label class="mu-field"><span class="mu-field-label">${esc(t("shareRole"))}</span><select class="mu-select" name="role"><option value="edit">${esc(t(options.kind === "album" ? "roleEditAlbum" : "roleEditCalendar"))}</option><option value="view">${esc(t(options.kind === "album" ? "roleViewAlbum" : "roleViewCalendar"))}</option></select></label>
          <button type="submit" class="mu-btn mu-btn-primary"><span class="mu-icon" aria-hidden="true">person_add</span>${esc(t("shareAdd"))}</button>
          <p class="mu-inline-error" role="alert" hidden></p>
        </form>` : `<div class="mu-read-only-notice"><span class="mu-icon" aria-hidden="true">group</span><span>${esc(t(space.role === "edit" ? "sharedCanEdit" : "sharedCanView", { name: space.owner?.name || "" }))}</span></div>`}
        <div class="mu-section-label">${esc(t("sharePeople"))}</div>
        <div class="mu-share-people" aria-live="polite"><div class="mu-skeleton" style="height:64px;border-radius:28px"></div></div>
        <p class="mu-muted mu-share-note">${esc(t(options.kind === "album" ? "shareNoteAlbum" : "shareNoteCalendar"))}</p>
        <div class="mu-dialog-actions">
          ${owner ? `<button type="button" class="mu-btn mu-btn-danger-outline" data-action="stop"><span class="mu-icon" aria-hidden="true">link_off</span>${esc(t("stopSharing"))}</button>` : `<button type="button" class="mu-btn mu-btn-danger-outline" data-action="leave"><span class="mu-icon" aria-hidden="true">logout</span>${esc(t(options.kind === "album" ? "leaveAlbum" : "leaveCalendar"))}</button>`}
          <button type="button" class="mu-btn mu-btn-primary" data-mu-close>${esc(t("done"))}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("select.mu-select").forEach((select) => window.MunetiosUI.enhanceSelect(select));
    const people = modal.querySelector(".mu-share-people");
    const notify = (message, type = "info") => window.MunetiosUI.toast(message, { type });
    async function render() {
      let data;
      try { data = await space.members(); } catch (error) {
        people.innerHTML = `<div class="mu-alert is-danger" role="alert"><span class="mu-icon" aria-hidden="true">error</span><div class="mu-alert-body"><span class="mu-alert-title">${esc(errorText(error, t("errorGeneric"), t))}</span></div></div>`;
        return;
      }
      const row = (person, role, isOwner) => `
        <div class="mu-row mu-share-person" data-account="${esc(person.accountId)}">
          <span class="mu-avatar" aria-hidden="true">${esc(([...(person.name || person.displayName || person.email || "?")][0] || "?").toLocaleUpperCase())}</span>
          <div class="mu-row-info"><span class="mu-row-title">${esc(person.name || person.displayName || String(person.email || "").split("@")[0])}${person.accountId === String(options.me?.id || "") ? ` <span class="mu-badge">${esc(t("you"))}</span>` : ""}</span><span class="mu-row-subtitle">${esc(person.email || "")}</span></div>
          ${isOwner ? `<span class="mu-badge">${esc(t("roleOwner"))}</span>` : owner ? `
            <select class="mu-select" data-role aria-label="${esc(t("shareRole"))}"><option value="edit"${role === "edit" ? " selected" : ""}>${esc(t("roleEditShort"))}</option><option value="view"${role === "view" ? " selected" : ""}>${esc(t("roleViewShort"))}</option></select>
            <button type="button" class="mu-icon-btn" data-remove aria-label="${esc(t("removePerson", { name: person.displayName || person.email }))}"><span class="mu-icon" aria-hidden="true">person_remove</span></button>` : `<span class="mu-badge">${esc(t(role === "edit" ? "roleEditShort" : "roleViewShort"))}</span>`}
        </div>`;
      people.innerHTML = (data.owner ? row(data.owner, "owner", true) : "") + data.members.map((member) => row(member, member.role, false)).join("");
      people.querySelectorAll("select.mu-select").forEach((select) => window.MunetiosUI.enhanceSelect(select));
    }
    people.addEventListener("change", async (event) => {
      const select = event.target.closest("[data-role]");
      if (!select) return;
      try { await space.setRole(select.closest("[data-account]").dataset.account, select.value); notify(t("roleUpdated"), "success"); options.onChange?.(); }
      catch (error) { notify(errorText(error, t("errorGeneric"), t), "error"); render(); }
    });
    people.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-remove]");
      if (!button) return;
      button.disabled = true;
      try { await space.removeMember(button.closest("[data-account]").dataset.account); notify(t("personRemoved"), "success"); render(); options.onChange?.(); }
      catch (error) { button.disabled = false; notify(errorText(error, t("errorGeneric"), t), "error"); }
    });
    const form = modal.querySelector(".mu-share-add");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = form.email.value.trim();
      const errorBox = form.querySelector(".mu-inline-error");
      errorBox.hidden = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorBox.textContent = t("errorEmail"); errorBox.hidden = false; form.email.focus(); return; }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await space.addMember(email, form.role.value);
        form.email.value = "";
        notify(t("personAdded", { email }), "success");
        render();
        options.onChange?.();
      } catch (error) {
        errorBox.textContent = error.code === "noAccount" ? t("errorNoAccount") : error.code === "isOwner" ? t("errorIsOwner") : errorText(error, t("errorGeneric"), t);
        errorBox.hidden = false;
      } finally { submit.disabled = false; }
    });
    modal.querySelector('[data-action="stop"]')?.addEventListener("click", async () => {
      try { await options.onStop?.(); window.MunetiosUI.closeModal(modal); }
      catch (error) { notify(errorText(error, t("errorGeneric"), t), "error"); }
    });
    modal.querySelector('[data-action="leave"]')?.addEventListener("click", async () => {
      try { await options.onLeave?.(); window.MunetiosUI.closeModal(modal); }
      catch (error) { notify(errorText(error, t("errorGeneric"), t), "error"); }
    });
    const observer = new MutationObserver(() => { if (modal.hidden) { observer.disconnect(); modal.remove(); } });
    observer.observe(modal, { attributes: true, attributeFilter: ["hidden"] });
    window.MunetiosUI.openModal(id);
    render();
    return modal;
  }

  /* ---------------------------------------------------------- languages */
  // The 17 global Munetios locales (shared/munetios-locales.js).
  const L = window.MunetiosLocales;
  const LANGUAGES = L.CODES.slice();
  const resolveLanguage = (value) => L.resolve(String(value || "")) || L.detect();
  // The base language of a locale ("es-US" → "es"), used for right-to-left checks and shared files.
  const catalogBase = (code) => String(code || "en").split("-")[0];
  // The language's own name for itself, or its name in another language.
  function languageName(code, inLocale) {
    if (!inLocale || L.resolve(inLocale) === code) return L.name(code);
    try {
      const name = new Intl.DisplayNames([inLocale], { type: "language", languageDisplay: "standard" }).of(code);
      return name && name !== code ? name.charAt(0).toLocaleUpperCase(inLocale) + name.slice(1) : L.name(code);
    } catch { return L.name(code); }
  }
  // Modern language picker: native names first, the name in the current language below.
  function pickLanguage({ value, uiLocale, t, onPick }) {
    const preferred = [...new Set((navigator.languages || [navigator.language]).map(resolveLanguage))];
    const toItem = (code) => ({ value: code, label: L.name(code), sub: languageName(code, uiLocale), lang: code, keywords: code + " " + L.name(code) });
    const system = { value: "system", label: t("systemDefault"), sub: languageName(resolveLanguage(navigator.language), uiLocale) };
    window.MunetiosUI.pickFromList({
      title: t("language"), icon: "translate", value, searchLabel: t("searchLanguages"), emptyText: t("noResults"), closeLabel: t("close"),
      groups: [
        { label: t("suggestedLanguages"), items: [system, ...preferred.map(toItem)] },
        { label: t("allLanguages"), items: LANGUAGES.map(toItem) },
      ],
      onPick,
    });
  }

  window.MunetiosCloud = Object.freeze({
    request, CloudError, Space, available, uploadBlob, downloadBlob, deleteBlob, storage, openShareDialog, errorText, strings,
    encryptJson, decryptJson, newKey, b64, unb64, LANGUAGES, resolveLanguage, catalogBase, languageName, pickLanguage, PLAIN_CHUNK,
  });
})();
