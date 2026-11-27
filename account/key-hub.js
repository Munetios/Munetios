// Munetios sync key hub, loaded in a hidden frame from https://accounts.munetios.com by every other Munetios host.
// Each host keeps its own copy of an account's data key (a non-extractable AES-GCM CryptoKey) in IndexedDB, so
// without a hub, unlocking sync on one subdomain left the others showing "Sync is paused on this device".
// The hub stores one shared copy and hands it to Munetios pages:
//   - only to https://munetios.com and https://*.munetios.com (the hosts that already share the session cookie),
//   - only for an account the shared session is currently signed in to (checked with /api/auth/session),
//   - as a CryptoKey object, so the raw key bytes are never readable by the receiving page either.
(() => {
  "use strict";

  const trusted = origin => {
    try {
      const url = new URL(origin);
      return url.protocol === "https:" && !url.port && (url.hostname === "munetios.com" || url.hostname.endsWith(".munetios.com"));
    } catch { return false; }
  };

  function keyStore(mode, action) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("munetios-account", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("keys", { keyPath: "accountId" });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("keys", mode);
        const request = action(tx.objectStore("keys"));
        tx.oncomplete = () => { db.close(); resolve(request?.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }

  async function signedInIds() {
    const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return new Set();
    const data = await response.json();
    return new Set([data.account, ...(data.accounts || [])].filter(item => item?.id).map(item => String(item.id)));
  }

  window.addEventListener("message", async event => {
    if (event.source !== window.parent || !trusted(event.origin)) return;
    const { type, id, accountId, key } = event.data || {};
    if (!["munetios-key-get", "munetios-key-put", "munetios-key-remove"].includes(type) || typeof accountId !== "string" || !/^[0-9A-Za-z_-]{1,64}$/.test(accountId)) return;
    const reply = message => event.source.postMessage({ ...message, id, type: type + "-result" }, event.origin);
    try {
      // Removing is always allowed: it can only take a key away (used when the account signs out).
      if (type === "munetios-key-remove") { await keyStore("readwrite", store => store.delete(accountId)); reply({ ok: true }); return; }
      if (!(await signedInIds()).has(accountId)) { reply({ ok: false }); return; }
      if (type === "munetios-key-get") {
        const stored = (await keyStore("readonly", store => store.get(accountId)))?.key || null;
        reply({ ok: Boolean(stored), key: stored });
        return;
      }
      const valid = key instanceof CryptoKey && key.algorithm?.name === "AES-GCM" && key.type === "secret" && !key.extractable;
      if (!valid) { reply({ ok: false }); return; }
      await keyStore("readwrite", store => store.put({ accountId, key }));
      reply({ ok: true });
    } catch {
      reply({ ok: false });
    }
  });
})();
