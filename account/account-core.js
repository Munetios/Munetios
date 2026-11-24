/*!
 * Munetios account core: sessions, end-to-end encryption, and sync.
 *
 * Encryption model
 *  - The password never leaves the browser. Two keys are derived from it with
 *    PBKDF2-SHA-256: a login secret (sent instead of the password) and a key
 *    that wraps a random AES-GCM data key. The server stores only the wrapped key.
 *  - Every synced item is encrypted with the data key (AES-GCM, random IV, and
 *    the account id + item key as associated data) before upload.
 *  - The unwrapped data key is kept on this device as a non-extractable CryptoKey.
 *
 * Sync model
 *  - Providers describe local data as items ({ key, data, updatedAt }).
 *  - Each item has a server version. Pulls use a cursor per provider; pushes
 *    send the version they are based on, and the server rejects stale writes.
 *  - On a conflict the newer change wins (by updatedAt).
 *  - If this device's data belonged to a different account, that account's
 *    data replaces it instead of being merged.
 * Requires account-i18n.js.
 */
(() => {
  "use strict";
  const API = "/api/auth";
  const S = window.MunetiosAccountStrings;
  const config = Object.assign({ autoSync: true }, window.MunetiosAccountConfig || {});
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const ITERATIONS = 310000;
  const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
  const unhex = value => new Uint8Array(value.match(/../g).map(b => parseInt(b, 16)));
  const b64 = buffer => { const bytes = new Uint8Array(buffer); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
    json(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  };

  /* ---------------------------------------------------------- strings */
  let localeSource = () => store.get("munetiosLanguage") || navigator.language;
  const locale = () => S.resolveLocale(localeSource());
  function t(key, vars) {
    let text = (S.catalog[locale()] || S.catalog.en)[key] ?? S.catalog.en[key] ?? key;
    if (vars) text = text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] ?? m));
    return text;
  }
  // Times use NM / AN instead of AM / PM.
  const meridiem = text => text.replace(/\bAM\b/g, "NM").replace(/\bPM\b/g, "AN");
  const formatDate = value => { try { return new Intl.DateTimeFormat(locale(), accountDateOptions(false)).format(new Date(value)); } catch { return String(value); } };
  const formatTime = value => { try { return meridiem(new Intl.DateTimeFormat(locale(), accountDateOptions(true)).format(new Date(value))); } catch { return String(value); } };

  const accountSettingDefinitions = [
    ['dateStyle', 'account', 'medium', ['short', 'medium', 'long']],
    ['hourCycle', 'account', 'auto', ['auto', 'h12', 'h23']],
    ['timeZone', 'account', 'auto', 'timeZones'],
    ['maskEmail', 'account', false],
    ['showPictures', 'account', true],
    ['syncHistory', 'sync', true],
    ['syncAppearance', 'sync', true],
    ['syncSearchSettings', 'sync', true],
    ['syncShortcuts', 'sync', true],
    ['syncWorkspaces', 'sync', true],
    ['syncDocuments', 'sync', true],
    ['syncInterval', 'sync', '30000', ['30000', '60000', '300000', '900000']],
    ['syncOnReconnect', 'sync', true],
    ['syncInBackground', 'sync', false],
    ['syncOnDataSaver', 'sync', false],
    ['exportFormatting', 'data', 'pretty', ['pretty', 'compact']],
    ['exportHistory', 'data', true],
    ['exportAppearance', 'data', true],
    ['exportShortcuts', 'data', true],
    ['exportEmail', 'data', true]
  ];
  const settingsKey = () => state.account ? `munetios-account-settings:${state.account.id}` : null;
  function getAccountSetting(name) {
    const definition = accountSettingDefinitions.find(item => item[0] === name);
    if (!definition) return undefined;
    const value = store.json(settingsKey(), {})[name];
    if (typeof definition[2] === 'boolean') return typeof value === 'boolean' ? value : definition[2];
    if (definition[3] === 'timeZones') {
      try { if (value === 'auto') return value; if (typeof value === 'string') { new Intl.DateTimeFormat('en', { timeZone: value }); return value; } } catch {}
      return definition[2];
    }
    return definition[3].includes(value) ? value : definition[2];
  }
  function setAccountSetting(name, value) {
    const definition = accountSettingDefinitions.find(item => item[0] === name);
    const key = settingsKey();
    if (!key || !definition) throw new Error('invalidSetting');
    if (typeof definition[2] === 'boolean') { if (typeof value !== 'boolean') throw new Error('invalidSetting'); }
    else if (definition[3] === 'timeZones') {
      if (typeof value !== 'string') throw new Error('invalidSetting');
      if (value !== 'auto') new Intl.DateTimeFormat('en', { timeZone: value });
    }
    else if (!definition[3].includes(value)) throw new Error('invalidSetting');
    const values = store.json(key, {}); values[name] = value;
    localStorage.setItem(key, JSON.stringify(values));
    document.dispatchEvent(new CustomEvent('munetios-account-settings-changed', { detail: { name } }));
    emit();
  }
  function accountDateOptions(withTime) {
    const timeZone = getAccountSetting('timeZone');
    const hourCycle = getAccountSetting('hourCycle');
    return { dateStyle: getAccountSetting('dateStyle'), ...(timeZone !== 'auto' ? { timeZone } : {}), ...(withTime ? { timeStyle: 'short', ...(hourCycle !== 'auto' ? { hourCycle } : {}) } : {}) };
  }
  const displayEmail = account => getAccountSetting('maskEmail') ? `•••@${String(account?.email || '').split('@').pop()}` : account?.email || '';
  const providerSetting = { 'ls:search-history': 'syncHistory', 'ls:appearance': 'syncAppearance', 'ls:settings': 'syncSearchSettings', 'ls:shortcuts': 'syncShortcuts', 'ls:workspaces': 'syncWorkspaces', 'omniwrite': 'syncDocuments', 'omniwrite-media': 'syncDocuments', 'omniwrite-sheets': 'syncDocuments' };
  const providerEnabled = provider => !providerSetting[provider.id] || getAccountSetting(providerSetting[provider.id]);
  function checkProvider(provider) {
    if (!providerEnabled(provider)) throw Object.assign(new Error('syncCategoryDisabled'), { code: 'syncCategoryDisabled' });
  }
  function automaticSyncAllowed() {
    return Boolean(state.account && (document.visibilityState === 'visible' || getAccountSetting('syncInBackground')) && (!navigator.connection?.saveData || getAccountSetting('syncOnDataSaver')));
  }
  window.addEventListener('storage', event => {
    if (event.key === settingsKey() || event.key === null) { document.dispatchEvent(new CustomEvent('munetios-account-settings-changed')); emit(); }
  });

  /* ---------------------------------------------------------- api */
  async function api(path, body, { signal } = {}) {
    const timeout = AbortSignal.timeout(45000);
    const response = await fetch(API + path, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (response.status === 401 && data?.error === "signedOut" && path !== "/session" && state.account) void refresh();
    if (!response.ok) throw Object.assign(new Error(data?.error || "unavailable"), { status: response.status, code: data?.error || "unavailable", data });
    return data;
  }

  /* ---------------------------------------------------------- crypto */
  const passwordKey = (password, usage) => crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [usage]);
  async function authSecret(password, email) {
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`munetios-auth-v1:${email.trim().toLowerCase()}`), iterations: ITERATIONS }, await passwordKey(password, "deriveBits"), 256);
    return hex(bits);
  }
  async function wrappingKey(password, saltHex) {
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: ITERATIONS }, await passwordKey(password, "deriveKey"), { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
  }
  async function wrap(password, dataKey) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.wrapKey("raw", dataKey, await wrappingKey(password, hex(salt)), { name: "AES-GCM", iv });
    return { salt: hex(salt), iv: hex(iv), wrapped: b64(wrapped) };
  }
  async function createKeys(password) {
    const exportable = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const material = await wrap(password, exportable);
    const dataKey = await crypto.subtle.importKey("raw", await crypto.subtle.exportKey("raw", exportable), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    return { material, dataKey };
  }
  async function unwrapKeys(password, material, extractable = false) {
    return crypto.subtle.unwrapKey("raw", unb64(material.wrapped), await wrappingKey(password, material.salt), { name: "AES-GCM", iv: unhex(material.iv) }, { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
  }
  async function encryptItem(dataKey, accountId, key, payload) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`${accountId}|${key}`) }, dataKey, enc.encode(JSON.stringify(payload)));
    return { iv: hex(iv), ciphertext: b64(ciphertext) };
  }
  async function decryptItem(dataKey, accountId, item) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(item.iv), additionalData: enc.encode(`${accountId}|${item.key}`) }, dataKey, unb64(item.ciphertext));
    return JSON.parse(dec.decode(plain));
  }
  const digest = async data => hex(await crypto.subtle.digest("SHA-256", enc.encode(JSON.stringify(data))));
  // Three-way merge for key/value groups (settings, appearance…). base = the last synced copy.
  // A key changed only on this device keeps the local value; otherwise the synced value wins.
  // On a device's first sync (no base) the synced value wins for every key it has.
  function mergeGroups(local = {}, remote = {}, base) {
    const merged = {};
    for (const key of new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(base || {})])) {
      const localChanged = base ? local[key] !== base[key] : !(key in remote);
      const value = localChanged ? local[key] : remote[key];
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }

  /* ---------------------------------------------------------- key store (this device) */
  function openKeyStore() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("munetios-account", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keys", { keyPath: "accountId" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function keyStore(mode, action) {
    const db = await openKeyStore();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("keys", mode);
        const request = action(tx.objectStore("keys"));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  const keys = {
    async get(accountId) { try { return (await keyStore("readonly", s => s.get(String(accountId))))?.key || null; } catch { return null; } },
    put: (accountId, key) => keyStore("readwrite", s => s.put({ accountId: String(accountId), key })),
    async remove(accountId) { try { await keyStore("readwrite", s => s.delete(String(accountId))); } catch {} }
  };

  /* ---------------------------------------------------------- state */
  const revokedKey = "munetios-revoked-session";
  const accountCacheKey = "munetios-account-cache";
  const state = { ready: false, account: null, accounts: [], status: "signed-out", lastSynced: null, offline: false, syncEnabled: true, storage: null, revocation: store.json(revokedKey, null) };
  const listeners = new Set();
  let sessionRequest = 0;
  function emit() {
    for (const listener of listeners) { try { listener(state); } catch {} }
    document.dispatchEvent(new CustomEvent("munetios-account", { detail: state }));
  }
  function setStatus(status) { if (state.status !== status) { state.status = status; emit(); } }
  async function updateLock() {
    if (state.revocation) { state.status = "paused"; return; }
    if (!state.account) { state.status = "signed-out"; return; }
    state.syncEnabled = store.get(`munetios-sync-disabled:${state.account.id}`) !== "true";
    if (!state.syncEnabled) { state.status = "paused"; return; }
    const key = await keys.get(state.account.id);
    if (!key) state.status = "locked";
    else if (state.status === "signed-out" || state.status === "locked" || state.status === "paused") state.status = "idle";
    state.lastSynced = Number(store.get(`munetios-last-synced:${state.account.id}`)) || null;
  }
  async function refresh({ deliberate = false, enableSyncFor = null, scheduleSync = true } = {}) {
    const request = ++sessionRequest;
    try {
      const data = await api("/session");
      if (request !== sessionRequest) return state;
      const previous = state.account || store.json(accountCacheKey, null);
      const sharedHost = ['accounts.munetios.com', 'write.munetios.com'].includes(window.location?.hostname);
      const googleCookie = sharedHost ? 'munetios-shared-google-sync' : 'munetios-google-sync';
      const googleSync = String(document.cookie || '').split(';').map(part => part.trim())
        .find(part => part.startsWith(googleCookie + '='))?.slice(googleCookie.length + 1);
      const googleSignIn = Boolean(data.account && String(data.account.id) === googleSync);
      if (!deliberate && !googleSignIn && (data.sessionRevoked || (!data.account && previous))) {
        state.revocation = { accountId: previous?.id || state.revocation?.accountId || null, id: state.revocation?.id || Date.now() };
        store.set(revokedKey, JSON.stringify(state.revocation));
      } else if (deliberate || googleSignIn || (data.account && state.revocation?.accountId === data.account.id)) {
        state.revocation = null;
        store.remove(revokedKey);
      }
      if (state.account?.id !== data.account?.id) state.storage = null;
      state.account = data.account; state.accounts = data.accounts || []; state.offline = false;
      if (state.account && (state.account.id === enableSyncFor || googleSignIn)) {
        store.remove(`munetios-sync-disabled:${state.account.id}`);
      }
      if (googleSync) document.cookie = `${googleCookie}=; Max-Age=0; Path=/; SameSite=Lax${sharedHost ? '; Domain=munetios.com; Secure' : ''}`;
      if (state.account) store.set(accountCacheKey, JSON.stringify({ id: state.account.id, email: state.account.email, displayName: state.account.displayName, picture: state.account.picture }));
      else store.remove(accountCacheKey);
    } catch {
      if (request !== sessionRequest) return state;
      // Offline or server unavailable: keep showing the last known account; sync reports the failure.
      state.offline = true;
      if (!state.account && !state.revocation) state.account = store.json(accountCacheKey, null);
    }
    state.ready = true;
    await updateLock();
    if (!state.revocation && state.offline && state.account && state.syncEnabled && state.status !== "locked") state.status = "error";
    emit();
    if (scheduleSync && config.autoSync && state.account && !state.offline && !state.revocation) schedule(300);
    return state;
  }

  /* ---------------------------------------------------------- account actions */
  async function storeNewKeys(accountId, password) {
    const { material, dataKey } = await createKeys(password);
    await api("/keys", { keys: material });
    await keys.put(accountId, dataKey);
  }
  // Before another account becomes active on this device, upload the current account's changes.
  async function syncBeforeAdding(add) {
    if (add && state.account && state.status !== "locked") { try { await sync(); } catch {} }
  }
  async function signIn({ email, password, code, add = false }) {
    await syncBeforeAdding(add);
    const secret = await authSecret(password, email);
    let result;
    try {
      result = await api("/signin", { email, password: secret, code, add });
    } catch (error) {
      // Accounts created before end-to-end encryption upgrade once with the original password.
      if (!error.data?.upgradeAvailable) throw error;
      result = await api("/signin", { email, password, upgrade: secret, code, add });
    }
    if (result.keys) {
      let key;
      try { key = await unwrapKeys(password, result.keys); }
      catch (error) {
        // A password reset changes sign-in credentials without replacing encrypted data keys.
        if (error.name !== "OperationError") throw error;
      }
      if (key) await keys.put(result.account.id, key);
    }
    else await storeNewKeys(result.account.id, password);
    await refresh({ deliberate: true, enableSyncFor: result.account.id });
    return result.account;
  }
  async function signUp({ email, password, emailCode, add = false }) {
    await syncBeforeAdding(add);
    const secret = await authSecret(password, email);
    const { material, dataKey } = await createKeys(password);
    const result = await api("/signup", { email, password: secret, keys: material, emailCode, add });
    await keys.put(result.account.id, dataKey);
    await refresh({ deliberate: true, enableSyncFor: result.account.id });
    return result.account;
  }
  // Turns sync on for a device that is signed in but has no data key yet.
  async function unlock(password) {
    const account = state.account;
    if (!account) throw Object.assign(new Error("signedOut"), { code: "signedOut" });
    const { keys: material } = await api("/keys");
    if (!material) { await storeNewKeys(account.id, password); }
    else {
      let key;
      try { key = await unwrapKeys(password, material); } catch { throw Object.assign(new Error("invalidCredentials"), { code: "invalidCredentials" }); }
      await keys.put(account.id, key);
    }
    await updateLock(); emit(); schedule(100);
  }
  async function changePassword(current, next) {
    const account = state.account;
    const { keys: material } = await api("/keys");
    let newMaterial;
    if (material) {
      let dataKey;
      try { dataKey = await unwrapKeys(current, material, true); } catch { throw Object.assign(new Error("invalidCredentials"), { code: "invalidCredentials" }); }
      newMaterial = await wrap(next, dataKey);
    } else {
      const created = await createKeys(next);
      newMaterial = created.material;
      await keys.put(account.id, created.dataKey);
    }
    await api("/password", { currentPassword: await authSecret(current, account.email), newPassword: await authSecret(next, account.email), keys: newMaterial });
  }
  async function deleteAccount(password, confirmation) {
    const account = state.account;
    await api("/delete", { password: await authSecret(password, account.email), confirmation });
    await keys.remove(account.id);
    store.remove(`munetios-sync:${account.id}`); store.remove(`munetios-last-synced:${account.id}`);
    await refresh({ deliberate: true });
  }
  async function updateProfile(displayName) {
    const result = await api("/profile", { displayName });
    state.account = result.account;
    store.set("munetios-account-cache", JSON.stringify({ id: state.account.id, email: state.account.email, displayName: state.account.displayName, picture: state.account.picture }));
    emit();
    return result.account;
  }
  async function updateProfilePicture(picture) {
    const result = await api('/profile-picture', { picture });
    state.account = result.account;
    store.set('munetios-account-cache', JSON.stringify({ id: state.account.id, email: state.account.email, displayName: state.account.displayName, picture: state.account.picture }));
    emit();
    return result.account;
  }
  async function signOut() {
    const account = state.account;
    // Upload the latest changes first; data on this device stays either way.
    try { await Promise.race([sync(), new Promise(resolve => setTimeout(resolve, 8000))]); } catch {}
    await api("/signout", {});
    if (account) await keys.remove(account.id);
    await refresh({ deliberate: true });
  }
  async function switchAccount(accountId) {
    if (state.account && !state.revocation && state.syncEnabled && state.status !== "locked") {
      const ok = await sync();
      if (!ok) throw Object.assign(new Error("switchBlocked"), { code: "switchBlocked" });
    }
    await api("/switch", { accountId });
    await refresh({ deliberate: true });
    await sync();
  }

  /* ---------------------------------------------------------- workspaces (shared with OmniWrite) */
  const WORKSPACES_KEY = "omniwrite-workspaces";
  const ACTIVE_WORKSPACE_KEY = "omniwrite-active-workspace";
  const PERSONAL = "workspace-personal";
  const workspaces = {
    PERSONAL,
    list() {
      const list = store.json(WORKSPACES_KEY, []);
      const valid = Array.isArray(list) ? list.filter(ws => ws && ws.id && typeof ws.name === "string") : [];
      if (!valid.some(ws => ws.id === PERSONAL)) valid.unshift({ id: PERSONAL, name: "Personal", createdAt: Date.now(), updatedAt: Date.now(), locked: false });
      return valid;
    },
    label: ws => (ws.id === PERSONAL ? t("personal") : ws.name),
    active() { const id = store.get(ACTIVE_WORKSPACE_KEY); return workspaces.list().some(ws => ws.id === id) ? id : PERSONAL; },
    setActive(id) { if (!store.set(ACTIVE_WORKSPACE_KEY, id)) throw new Error("storage"); },
    save(list) { if (!store.set(WORKSPACES_KEY, JSON.stringify(list))) throw new Error("storage"); document.dispatchEvent(new CustomEvent("munetios-workspaces-changed")); schedule(400); },
    create(name) {
      const clean = String(name || "").trim().replace(/\s+/g, " ");
      if (!clean) throw Object.assign(new Error("wsNameRequired"), { code: "wsNameRequired" });
      const list = workspaces.list();
      const ws = { id: `workspace-${crypto.randomUUID()}`, name: clean, createdAt: Date.now(), updatedAt: Date.now() };
      list.push(ws); workspaces.save(list);
      return ws;
    },
    rename(id, name) {
      const clean = String(name || "").trim().replace(/\s+/g, " ");
      if (!clean) throw Object.assign(new Error("wsNameRequired"), { code: "wsNameRequired" });
      const list = workspaces.list();
      const ws = list.find(item => item.id === id);
      if (!ws) throw Object.assign(new Error("missing"), { code: "wsRenameFailed" });
      ws.name = clean; ws.updatedAt = Date.now(); workspaces.save(list);
    },
    remove(id, documentCount) {
      if (id === PERSONAL) throw Object.assign(new Error("personal"), { code: "wsDeletePersonal" });
      if (documentCount > 0) throw Object.assign(new Error("hasDocs"), { code: "wsDeleteHasDocs" });
      workspaces.save(workspaces.list().filter(ws => ws.id !== id));
      if (workspaces.active() === id || store.get(ACTIVE_WORKSPACE_KEY) === id) store.set(ACTIVE_WORKSPACE_KEY, PERSONAL);
    },
    // Document counts per workspace as last seen by OmniWrite on this device.
    localCounts: () => store.json("munetios-workspace-doc-counts", {})
  };

  /* ---------------------------------------------------------- sync engine */
  const providers = new Map();
  // localStorage groups shared by Ganetios, OmniWrite, and Account settings (same origin).
  function localGroup(id, list, prefixes = []) {
    return {
      id: `ls:${id}`, prefix: `ls:${id}`, mergeable: true,
      keysNow() {
        const found = new Set(list.filter(key => store.get(key) !== null));
        if (prefixes.length) { try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (prefixes.some(p => key.startsWith(p))) found.add(key); } } catch {} }
        return [...found].sort();
      },
      async snapshot() {
        const data = {};
        for (const key of this.keysNow()) data[key] = store.get(key);
        return Object.keys(data).length ? [{ key: this.prefix, data, updatedAt: Date.now() }] : [];
      },
      async apply(items, { replace = false } = {}) {
        let changed = false;
        // Replacing another account's data: if this account has nothing for the group, clear it.
        if (replace && !items.some(item => !item.deleted && item.data)) {
          for (const key of this.keysNow()) { store.remove(key); changed = true; }
          return changed;
        }
        for (const item of items) {
          if (item.deleted || !item.data) continue;
          for (const key of this.keysNow()) if (!(key in item.data)) { store.remove(key); changed = true; }
          for (const [key, value] of Object.entries(item.data)) if (store.get(key) !== value) { store.set(key, value); changed = true; }
        }
        return changed;
      }
    };
  }
  const LOCAL_GROUPS = [
    localGroup("search-history", ["munetiosSearchHistory", "munetiosSearchPersonalizationProfile", "munetiosSearchHistoryPersonalization"]),
    localGroup("appearance", ["munetiosTheme", "munetiosThemeUserOverride", "munetiosBgColor", "munetiosTextColor", "munetiosBgImage", "munetiosFontFamily", "munetiosFontUserOverride", "munetiosReduceTransparency", "munetiosToastColor", "munetiosToastPosition"], ["munetiosFont_"]),
    localGroup("settings", ["munetiosLanguage", "safeSearchLevel", "munetiosDefaultSearchMode", "munetiosCountry", "munetiosTTS", "munetiosVoiceSpeed", "munetiosVoiceName", "munetiosVoiceMusic", "munetiosMusicUrl", "schoolMode"]),
    localGroup("shortcuts", ["shortcuts", "munetiosBookmarks"]),
    localGroup("workspaces", [WORKSPACES_KEY])
  ];
  LOCAL_GROUPS.forEach(group => providers.set(group.id, group));

  let running = null, rerun = false, timer = null;
  const SYNC_BATCH_BYTES = 4 * 1024 * 1024;
  function schedule(delay = 1500) { if (!config.autoSync || !state.syncEnabled) return; clearTimeout(timer); timer = setTimeout(() => { if (automaticSyncAllowed()) sync().catch(() => {}); }, delay); }
  function register(provider) { providers.set(provider.id, provider); schedule(400); }
  const syncStateKey = id => `munetios-sync:${id}`;
  async function syncProvider(provider, account, dataKey, syncState, owners, applied) {
    checkProvider(provider);
    if (!state.syncEnabled || state.revocation) throw Object.assign(new Error("syncDisabled"), { code: "syncDisabled" });
    const hashData = data => provider.hash ? provider.hash(data) : digest(data);
    const replace = !provider.preserveLocal && Boolean(owners[provider.id]) && owners[provider.id] !== account.id;
    const getItems = cursor => api(`/sync/items?prefix=${encodeURIComponent(provider.prefix)}&since=${cursor}${provider.paginated ? "&paged=1" : ""}`);
    let since = replace ? "0" : (syncState.cursor[provider.prefix] || "0");
    let remote = await getItems(since);
    if (BigInt(remote.seq) < BigInt(syncState.seq || "0")) {
      // The account's synced data was deleted: upload everything again.
      syncState.items = {}; syncState.cursor = {}; syncState.seq = "0";
      if (since !== "0") remote = await getItems("0");
    }
    if (replace && remote.hasMore) {
      const complete = [...remote.items];
      while (remote.hasMore) {
        checkProvider(provider);
        remote = await getItems(complete.at(-1).version);
        complete.push(...remote.items);
      }
      remote = { ...remote, items: complete };
    }
    if (!state.syncEnabled || state.revocation) throw Object.assign(new Error("syncDisabled"), { code: "syncDisabled" });
    const decoded = [];
    let cursor = BigInt(syncState.cursor[provider.prefix] || "0");
    for (const item of remote.items) {
      if (BigInt(item.version) > cursor) cursor = BigInt(item.version);
      if (item.deleted) { decoded.push({ key: item.key, version: item.version, deleted: true }); continue; }
      const payload = await decryptItem(dataKey, account.id, item);
      decoded.push({ key: item.key, version: item.version, data: payload.d, updatedAt: payload.u || 0 });
    }
    checkProvider(provider);
    const localNow = new Map((await provider.snapshot()).map(item => [item.key, item]));
    if (replace && !provider.mergeable) {
      // Documents must never be lost: if the previous account still has unsynced changes here,
      // keep this device's copy until that account syncs again.
      const previousState = store.json(syncStateKey(owners[provider.id]), { items: {} });
      for (const item of localNow.values()) {
        if (previousState.items[item.key]?.h === await hashData(item.data)) continue;
        if (!provider.keepLocalChange?.(item)) return { conflicts: 0, blocked: true };
      }
    }
    // Sync state per item: version, content hash, and (for mergeable groups) the synced copy as the merge base.
    const remember = (item, data) => ({ v: item.version, ...(provider.mergeable && data ? { d: data } : {}) });
    checkProvider(provider);
    if (replace) {
      if (await provider.apply(decoded.filter(item => !item.deleted), { replace: true })) applied.add(provider.id);
      syncState.items = Object.fromEntries(Object.entries(syncState.items).filter(([key]) => !key.startsWith(provider.prefix)));
      for (const item of decoded) syncState.items[item.key] = { ...remember(item, item.deleted ? null : item.data), h: item.deleted ? null : await hashData(item.data) };
    } else {
      const toApply = [];
      for (const item of decoded) {
        const previous = syncState.items[item.key];
        if (previous && previous.v === item.version) continue; // already have this version
        const local = localNow.get(item.key);
        if (provider.mergeable && !item.deleted) {
          // Key/value groups merge instead of one side replacing the other; a changed result is pushed below.
          const merged = mergeGroups(local?.data, item.data, previous?.d);
          toApply.push({ key: item.key, version: item.version, data: merged });
          syncState.items[item.key] = { ...remember(item, item.data), h: await hashData(item.data) };
          continue;
        }
        const localHash = local ? await hashData(local.data) : null;
        const localChanged = previous ? localHash !== previous.h : Boolean(local);
        const remoteWins = !localChanged || (!item.deleted && (item.updatedAt || 0) >= (local?.updatedAt || 0));
        if (remoteWins) {
          toApply.push(item);
          syncState.items[item.key] = { v: item.version, h: item.deleted ? null : await hashData(item.data) };
        } else {
          syncState.items[item.key] = { v: item.version, h: "conflict" }; // keep the newer local change and push it
        }
      }
      checkProvider(provider);
      if (toApply.length && await provider.apply(toApply, { replace: false })) applied.add(provider.id);
    }
    if (cursor > 0n) syncState.cursor[provider.prefix] = cursor.toString();
    if (BigInt(remote.seq) > BigInt(syncState.seq || "0")) syncState.seq = remote.seq;

    if (remote.hasMore) return { more: true, conflicts: 0, full: false, blocked: false };
    const pushes = [];
    let deferred = false;
    const present = new Set();
    for (const item of await provider.snapshot()) {
      present.add(item.key);
      const hash = await hashData(item.data);
      const previous = syncState.items[item.key];
      if (provider.canPush && !provider.canPush(item.data, syncState.items)) { deferred = true; continue; }
      if (previous?.h === hash) provider.onSynced?.(item.key, account.id);
      else pushes.push({ key: item.key, baseVersion: previous?.v || "0", data: item.data, updatedAt: item.updatedAt || Date.now(), hash });
    }
    for (const [key, previous] of Object.entries(syncState.items)) {
      if (!provider.retainMissing && key.startsWith(provider.prefix) && !present.has(key) && previous.h !== null && !provider.retainMissingItem?.(key)) pushes.push({ key, baseVersion: previous.v, deleted: true, hash: null });
    }
    let conflicts = 0, full = deferred, blocked = false;
    const batchSize = provider.batchSize || 20;
    const upload = async (items, chunk) => {
      if (!state.syncEnabled || state.revocation || state.account?.id !== account.id) throw Object.assign(new Error("syncDisabled"), { code: "syncDisabled" });
      checkProvider(provider);
      let results;
      try { ({ results } = await api("/sync/batch", { items })); }
      catch (error) {
        if (error.status !== 413) throw error;
        if (items.length === 1) blocked = true;
        else {
          const middle = Math.floor(items.length / 2);
          await upload(items.slice(0, middle), chunk.slice(0, middle));
          await upload(items.slice(middle), chunk.slice(middle));
        }
        return;
      }
      for (const result of results) {
        const sent = chunk.find(item => item.key === result.key);
        if (result.status === "ok") {
          syncState.items[result.key] = { v: result.version, h: sent.hash, ...(provider.mergeable && sent.data ? { d: sent.data } : {}) };
          if (!sent.deleted) {
            provider.onPushed?.(result.key, account.id);
            provider.onSynced?.(result.key, account.id);
          }
        }
        else if (result.status === "quotaExceeded") full = true;
        else conflicts++;
      }
    };
    let items = [], chunk = [], bytes = 12;
    for (const item of pushes) {
      const encrypted = item.deleted
        ? { key: item.key, baseVersion: item.baseVersion, deleted: true }
        : { key: item.key, baseVersion: item.baseVersion, ...(await encryptItem(dataKey, account.id, item.key, { d: provider.loadItem ? await provider.loadItem(item.data) : item.data, u: item.updatedAt })) };
      const size = item.deleted ? JSON.stringify(encrypted).length + 1
        : JSON.stringify({ ...encrypted, ciphertext: "" }).length + encrypted.ciphertext.length + 1;
      if (items.length && (items.length >= batchSize || bytes + size > SYNC_BATCH_BYTES)) {
        await upload(items, chunk);
        items = []; chunk = []; bytes = 12;
      }
      items.push(encrypted);
      chunk.push(item);
      bytes += size;
    }
    if (items.length) await upload(items, chunk);
    owners[provider.id] = account.id;
    return { conflicts, full, blocked };
  }
  async function runSync() {
    const account = state.account;
    if (state.revocation) { setStatus("paused"); return false; }
    if (!account) { setStatus("signed-out"); return false; }
    if (!state.syncEnabled) { setStatus("paused"); return false; }
    const dataKey = await keys.get(account.id);
    if (!dataKey) { setStatus("locked"); return false; }
    setStatus("syncing");
    try {
      const syncState = store.json(syncStateKey(account.id), { cursor: {}, items: {}, seq: "0" });
      const owners = store.json("munetios-sync-owner", {});
      const applied = new Set();
      let conflicts = 0, blocked = false, full = false;
      for (const provider of providers.values()) {
        if (!providerEnabled(provider)) continue;
        let result;
        do {
          const beforeProvider = structuredClone(syncState);
          try { result = await syncProvider(provider, account, dataKey, syncState, owners, applied); }
          catch (error) { if (error.code === 'syncCategoryDisabled') { Object.assign(syncState, beforeProvider); break; } throw error; }
          full = full || result.full;
          conflicts += result.conflicts; blocked = blocked || result.blocked;
          store.set(syncStateKey(account.id), JSON.stringify(syncState));
          store.set("munetios-sync-owner", JSON.stringify(owners));
        } while (result.more);
      }
      if (applied.size) document.dispatchEvent(new CustomEvent("munetios-sync-applied", { detail: { providers: [...applied] } }));
      state.offline = false;
      if (blocked) { setStatus("error"); return false; } // "Couldn't sync. Saved locally instead"
      state.lastSynced = Date.now();
      store.set(`munetios-last-synced:${account.id}`, String(state.lastSynced));
      await storage().catch(() => {});
      setStatus(!state.syncEnabled || state.revocation ? "paused" : full ? "full" : "synced");
      if (conflicts) rerun = true;
      return !full;
    } catch (error) {
      if (error.code === "syncDisabled") { setStatus("paused"); return false; }
      if (error.status === 401) await refresh();
      if (state.revocation) { setStatus("paused"); return false; }
      setStatus("error");
      return false;
    }
  }
  function sync() {
    if (running) { rerun = true; return running; }
    running = runSync().finally(() => {
      running = null;
      if (rerun) { rerun = false; schedule(800); }
    });
    return running;
  }
  async function setSyncEnabled(enabled) {
    state.syncEnabled = Boolean(enabled);
    if (state.account) store.set(`munetios-sync-disabled:${state.account.id}`, String(!state.syncEnabled));
    clearTimeout(timer); rerun = false;
    await updateLock(); emit();
    if (state.syncEnabled) schedule(100);
  }
  async function storage() {
    const result = await api('/sync/storage'); state.storage = result; emit(); return result;
  }
  async function securityAction(path, password, details = {}) {
    return api(`/security/${path}`, { ...details, password: await authSecret(password, state.account.email) });
  }
  async function exportLocal() {
    const out = { exportedAt: new Date().toISOString(), account: state.account && getAccountSetting('exportEmail') ? { email: state.account.email } : null, data: {} };
    const exportOptions = { 'ls:search-history': 'exportHistory', 'ls:appearance': 'exportAppearance', 'ls:shortcuts': 'exportShortcuts' };
    for (const provider of providers.values()) {
      if (exportOptions[provider.id] && !getAccountSetting(exportOptions[provider.id])) continue;
      out.data[provider.id] = await provider.snapshot();
    }
    return out;
  }
  async function resetSynced() {
    await api("/sync/reset", {});
    if (state.account) store.remove(syncStateKey(state.account.id));
  }
  // Decrypts synced OmniWrite documents to count them per workspace (used before deleting a workspace).
  async function remoteWorkspaceCounts() {
    const account = state.account;
    const dataKey = account && await keys.get(account.id);
    if (!dataKey) return null;
    const counts = {};
    let cursor = "0", page;
    do {
      page = await api(`/sync/items?prefix=omniwrite:doc:&since=${cursor}&paged=1`);
      for (const item of page.items) {
        cursor = item.version;
        if (item.deleted) continue;
        try { const { d } = await decryptItem(dataKey, account.id, item); const ws = d?.workspaceId || PERSONAL; counts[ws] = (counts[ws] || 0) + 1; } catch {}
      }
    } while (page.hasMore && page.items.length);
    return counts;
  }

  async function readPhotosLibrary({ signal } = {}) {
    signal?.throwIfAborted();
    if (!state.ready || state.offline) await refresh({ scheduleSync: false });
    const accountId = state.account?.id;
    const checkAccount = () => {
      signal?.throwIfAborted();
      if (!accountId || state.account?.id !== accountId || state.revocation || state.offline || !state.syncEnabled) throw new Error("photosUnavailable");
    };
    checkAccount();
    const dataKey = await keys.get(accountId);
    if (!dataKey) throw new Error("photosLocked");
    const prefix = "munetios-photos:item:";
    const photos = [];
    let cursor = "0";
    for (;;) {
      checkAccount();
      const page = await api(`/sync/items?prefix=${encodeURIComponent(prefix)}&since=${cursor}&paged=1`, undefined, { signal });
      checkAccount();
      if (!Array.isArray(page?.items)) throw new Error("photosUnavailable");
      for (const item of page.items) {
        checkAccount();
        if (item.deleted || !item.key.startsWith(prefix)) continue;
        const { d: photo } = await decryptItem(dataKey, accountId, item);
        if (photo?.cloud?.blobId && !photo.trashed && !photo.locked) {
          const { cloud, name, type, thumb, takenAt, date, cloudId, isVideo, archived, color } = photo;
          photos.push({ cloud, name, type, thumb, takenAt, date, cloudId: cloudId || item.key.slice(prefix.length), isVideo, archived, color });
        }
      }
      if (!page.hasMore || !page.items.length) break;
      const next = String(page.items.at(-1).version);
      if (!/^\d+$/.test(next) || BigInt(next) <= BigInt(cursor)) throw new Error("photosUnavailable");
      cursor = next;
    }
    checkAccount();
    return { accountId, photos };
  }

  /* ---------------------------------------------------------- auto sync */
  if (config.autoSync) {
    let nextSync = Date.now() + 30000;
    setInterval(() => {
      if (Date.now() < nextSync) return;
      nextSync = Date.now() + Number(getAccountSetting('syncInterval'));
      if (automaticSyncAllowed() && !running) sync().catch(() => {});
    }, 1000);
    document.addEventListener('munetios-account-settings-changed', () => { nextSync = Date.now() + Number(getAccountSetting('syncInterval')); });
    window.addEventListener("online", () => { if (getAccountSetting('syncOnReconnect')) schedule(500); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(700); });
  }

  window.MunetiosAccount = {
    settings: { definitions: accountSettingDefinitions, get: getAccountSetting, set: setAccountSetting }, displayEmail,
    t, locale, formatDate, formatTime, setLocaleSource(fn) { localeSource = fn; emit(); },
    state, on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh, signIn, signUp, requestEmailCode: email => api("/email-code", { email }), unlock, signOut, switchAccount, changePassword, deleteAccount, updateProfile, updateProfilePicture,
    cloudOwner(provider) { return store.json("munetios-sync-owner", {})[provider]; },
    cloudItems(prefix, provider) {
      const owner = state.revocation?.accountId || store.json("munetios-sync-owner", {})[provider];
      return new Set(Object.entries(store.json(syncStateKey(owner), { items: {} }).items)
        .filter(([key, item]) => key.startsWith(prefix) && item.h !== null).map(([key]) => key.slice(prefix.length)));
    },
    requestPasswordReset: email => api("/password-reset/request", { email }),
    requestForgotEmail: email => api('/forgot-email', { email }),
    async requestEmailChangeCode(email, password) {
      return api('/email-change/code', { email, password: await authSecret(password, state.account.email) });
    },
    async changeEmail(email, password, code, factor) {
      const current = state.account.email;
      await api('/email-change', { email, code, factor, password: await authSecret(password, current), nextSecret: await authSecret(password, email) });
      await refresh();
    },
    async resetPassword(email, proof, password, factor) {
      return api("/password-reset/complete", { email, proof, password: await authSecret(password, email), factor });
    },
    sessions: () => api("/sessions"), revokeSession: id => api("/sessions/revoke", { id }), revokeOtherSessions: () => api("/sessions/revoke-others", {}),
    google: { connection: () => api('/google/connection'), async disconnect(password) {
      return api('/google/disconnect', { password: await authSecret(password, state.account.email) });
    } },
    security: { get: () => api("/security"), action: securityAction },
    photos: { readLibrary: readPhotosLibrary },
    sync: { storage, setEnabled: setSyncEnabled, register, now: sync, schedule, exportLocal, reset: resetSynced, remoteWorkspaceCounts },
    workspaces
  };
  if (config.autoRefresh !== false) {
    refresh();
    const checkSession = () => { if (state.account && document.visibilityState === "visible") void refresh({ scheduleSync: false }); };
    setInterval(checkSession, 15000);
    document.addEventListener("visibilitychange", checkSession);
    window.addEventListener("online", checkSession);
    window.addEventListener("storage", event => {
      if (event.key !== revokedKey || !event.newValue || state.revocation) return;
      state.revocation = store.json(revokedKey, null);
      void refresh({ scheduleSync: false });
    });
  }
})();
