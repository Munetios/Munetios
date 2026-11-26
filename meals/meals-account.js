/*
 * Munetios Meals accounts and sync.
 *
 * Runs in <head>, before the Meals script opens its database:
 * - Guests keep the original "munetios-meals-db" database on this device.
 * - Each Munetios Account gets its own local database and its own copy of the settings,
 *   so accounts never mix on a shared device.
 * - Signed in with sync unlocked, meals (with photos) and settings sync with end-to-end encryption
 *   through the shared Munetios Account sync engine. Meals use the same sync format as the
 *   Meals planner in Munetios Calendar (/calendar/meals/meals-sync.js), so both show the same meals.
 */
(() => {
  "use strict";
  const OWNER_KEY = "munetios-meals-owner";
  const PREF_KEYS = ["munetios-meals-preferences", "munetios-meals-features"];
  const stashKey = (owner) => "munetios-meals-stash:" + owner;

  // The cached account decides which local data to open; account-core confirms it once it loads.
  let owner = "guest";
  try {
    const cached = JSON.parse(localStorage.getItem("munetios-account-cache") || "null");
    if (cached && cached.id !== undefined && cached.id !== null) owner = String(cached.id);
  } catch {}
  try {
    const previous = localStorage.getItem(OWNER_KEY) || "guest";
    if (previous !== owner) {
      const stash = {};
      for (const key of PREF_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null) stash[key] = value;
        localStorage.removeItem(key);
      }
      if (Object.keys(stash).length) localStorage.setItem(stashKey(previous), JSON.stringify(stash));
      let restore = {};
      try { restore = JSON.parse(localStorage.getItem(stashKey(owner)) || "{}") || {}; } catch {}
      for (const [key, value] of Object.entries(restore)) if (PREF_KEYS.includes(key) && typeof value === "string") localStorage.setItem(key, value);
      localStorage.removeItem(stashKey(owner));
      localStorage.setItem(OWNER_KEY, owner);
    }
  } catch {}

  let resolveReady;
  const workspace = {
    owner,
    dbName: owner === "guest" ? "munetios-meals-db" : "munetios-meals-db:account:" + owner,
    ready: new Promise((resolve) => { resolveReady = resolve; }),
  };
  window.MealsWorkspace = workspace;

  /* ------------------------------------------------------------ settings provider */
  const PREFS_PREFIX = "munetios-meals-prefs:";
  const encoder = new TextEncoder();
  const hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
  const stampKey = () => "munetios-meals-prefs-stamps:" + owner;
  // Settings change times come from content signatures, so an unchanged setting never looks newer.
  async function stamped(key, value) {
    const signature = hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
    let stamps = {};
    try { stamps = JSON.parse(localStorage.getItem(stampKey()) || "{}"); } catch {}
    const saved = stamps[key] || {};
    if (saved.signature !== signature) {
      stamps[key] = { signature, updatedAt: Math.max(Date.now(), (saved.updatedAt || 0) + 1) };
      try { localStorage.setItem(stampKey(), JSON.stringify(stamps)); } catch {}
    }
    return stamps[key].updatedAt;
  }
  async function remember(key, value, updatedAt) {
    const signature = hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
    let stamps = {};
    try { stamps = JSON.parse(localStorage.getItem(stampKey()) || "{}"); } catch {}
    stamps[key] = { signature, updatedAt };
    try { localStorage.setItem(stampKey(), JSON.stringify(stamps)); } catch {}
  }
  function prefsProvider(account) {
    return {
      id: "munetios-meals-prefs",
      prefix: PREFS_PREFIX,
      preserveLocal: true,
      enabled: () => String(account.state.account?.id) === owner,
      async snapshot() {
        const items = [];
        for (const key of PREF_KEYS) {
          const value = localStorage.getItem(key);
          if (value === null) continue;
          let data;
          try { data = JSON.parse(value); } catch { continue; }
          if (!data || typeof data !== "object" || Array.isArray(data)) continue;
          items.push({ key: PREFS_PREFIX + key, data, updatedAt: await stamped(key, value) });
        }
        return items;
      },
      async apply(items) {
        if (String(account.state.account?.id) !== owner) return false;
        let changed = false;
        for (const item of items) {
          if (item.deleted) continue;
          const key = item.key.slice(PREFS_PREFIX.length);
          if (!PREF_KEYS.includes(key) || !item.data || typeof item.data !== "object" || Array.isArray(item.data)) continue;
          const value = JSON.stringify(item.data);
          if (localStorage.getItem(key) === value) continue;
          localStorage.setItem(key, value);
          await remember(key, value, item.updatedAt || Date.now());
          changed = true;
        }
        if (changed) window.MealsApp?.reloadSettings?.();
        return changed;
      },
    };
  }

  /* ------------------------------------------------------------ registration */
  async function start() {
    const account = window.MunetiosAccount;
    if (!account) { resolveReady(null); return; }
    if (!account.state.ready) {
      await new Promise((resolve) => {
        const stop = account.on((s) => { if (s.ready) { stop(); resolve(); } });
        setTimeout(resolve, 6000);
      });
    }
    // The account menu follows the language chosen in Meals.
    if (typeof window.getLocale === "function") { try { account.setLocaleSource?.(() => window.getLocale()); } catch {} }
    const current = () => (account.state.account ? String(account.state.account.id) : "guest");
    // The cached account was stale: reload so the right account's data is opened.
    const guard = "munetios-meals-reload";
    if (account.state.ready && current() !== owner) {
      if (sessionStorage.getItem(guard) !== current()) {
        sessionStorage.setItem(guard, current());
        document.getElementById("app")?.setAttribute("inert", "");
        location.reload();
        return;
      }
    } else {
      sessionStorage.removeItem(guard);
    }
    account.on(() => {
      if (!account.state.ready || current() === owner) return;
      document.getElementById("app")?.setAttribute("inert", "");
      location.reload();
    });
    resolveReady(owner);
    if (owner === "guest") return;
    const app = await window.MealsApp?.ready;
    if (!app || !window.MunetiosMealsSync) return;
    account.sync.register(window.MunetiosMealsSync.createProvider({
      db: app.db(),
      storeName: app.storeName,
      getAccountId: () => (String(account.state.account?.id) === owner ? account.state.account.id : null),
      refresh: () => app.refresh(),
    }));
    account.sync.register(prefsProvider(account));
    document.addEventListener("meals-settings-changed", () => {
      if (String(account.state.account?.id) === owner) account.sync.schedule(800);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
