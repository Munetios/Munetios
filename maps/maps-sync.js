/*
 * Munetios Maps accounts and sync.
 * Signed in with sync unlocked, markers, bookmarks, search history, recent directions,
 * marked states, the custom map style, and the new Maps extras (saved views and map options)
 * sync with end-to-end encryption through the shared Munetios Account sync engine.
 * Each stored value is one sync item; the newest change wins.
 */
(() => {
  "use strict";
  const workspace = window.MapsWorkspace || { owner: "guest", dataKeys: [] };
  const PREFIX = "munetios-maps:";
  const KEYS = workspace.dataKeys;
  const JSON_KEYS = new Set(KEYS);
  const itemKey = (key) => PREFIX + key;
  const stampsKey = () => "munetios-maps-stamps:" + workspace.owner;
  const encoder = new TextEncoder();
  const hash = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text || ""))), (b) => b.toString(16).padStart(2, "0")).join("");
  const readStamps = () => { try { return JSON.parse(localStorage.getItem(stampsKey()) || "{}") || {}; } catch { return {}; } };
  const writeStamps = (stamps) => { try { localStorage.setItem(stampsKey(), JSON.stringify(stamps)); } catch {} };
  let applying = false;

  // Track when each value last changed on this device.
  async function stampChanges() {
    const stamps = readStamps();
    let changed = false;
    for (const key of KEYS) {
      const value = localStorage.getItem(key);
      const h = value === null ? null : await hash(value);
      if ((stamps[key]?.h ?? null) !== h) {
        stamps[key] = { h, u: Math.max(Date.now(), (stamps[key]?.u || 0) + 1) };
        changed = true;
      }
    }
    if (changed) writeStamps(stamps);
    return stamps;
  }

  // Schedule a sync whenever Maps writes one of its data keys.
  const account = () => window.MunetiosAccount;
  const nativeSet = Storage.prototype.setItem;
  const nativeRemove = Storage.prototype.removeItem;
  const touched = (store, key) => {
    if (store !== window.localStorage || !KEYS.includes(key)) return;
    document.dispatchEvent(new CustomEvent("maps-data-changed", { detail: { key } }));
    if (!applying && workspace.owner !== "guest") account()?.sync.schedule(1200);
  };
  Storage.prototype.setItem = function (key, value) { nativeSet.call(this, key, value); touched(this, key); };
  Storage.prototype.removeItem = function (key) { nativeRemove.call(this, key); touched(this, key); };

  function validValue(key, value) {
    if (typeof value !== "string") return false;
    if (!JSON_KEYS.has(key)) return true;
    try { JSON.parse(value); return true; } catch { return false; }
  }

  async function start() {
    const acc = account();
    if (!acc) return;
    if (!acc.state.ready) await new Promise((resolve) => { const stop = acc.on((s) => { if (s.ready) { stop(); resolve(); } }); setTimeout(resolve, 8000); });
    const current = () => (acc.state.account ? String(acc.state.account.id) : "guest");
    // The cached account was stale: reload so maps-workspace.js puts the right data in place.
    const guard = "munetios-maps-reload";
    if (acc.state.ready && current() !== workspace.owner) {
      if (sessionStorage.getItem(guard) !== current()) {
        sessionStorage.setItem(guard, current());
        location.reload();
      }
      return;
    }
    sessionStorage.removeItem(guard);
    acc.on(() => {
      if (!acc.state.ready || current() === workspace.owner) return;
      document.body.inert = true;
      location.reload();
    });
    if (workspace.owner === "guest") return;
    const accountId = workspace.owner;
    acc.sync.register({
      id: "munetios-maps",
      prefix: PREFIX,
      preserveLocal: true,
      enabled: () => String(acc.state.account?.id) === accountId,
      async snapshot() {
        const stamps = await stampChanges();
        const items = [];
        for (const key of KEYS) {
          const value = localStorage.getItem(key);
          if (value === null) continue;
          items.push({ key: itemKey(key), data: value, updatedAt: stamps[key]?.u || 1 });
        }
        return items;
      },
      async apply(items) {
        let changed = false;
        applying = true;
        try {
          const stamps = readStamps();
          for (const item of items) {
            const key = item.key.slice(PREFIX.length);
            if (!KEYS.includes(key)) continue;
            if (item.deleted) {
              if (localStorage.getItem(key) !== null) { localStorage.removeItem(key); changed = true; }
              stamps[key] = { h: null, u: item.updatedAt || Date.now() };
              continue;
            }
            if (!validValue(key, item.data)) continue;
            if (localStorage.getItem(key) !== item.data) { localStorage.setItem(key, item.data); changed = true; }
            stamps[key] = { h: await hash(item.data), u: item.updatedAt || 1 };
          }
          writeStamps(stamps);
        } finally { applying = false; }
        if (changed) document.dispatchEvent(new CustomEvent("maps-sync-applied"));
        return changed;
      },
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
