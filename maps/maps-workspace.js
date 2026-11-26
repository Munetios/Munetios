/*
 * Munetios Maps workspace switch. Runs in <head>, before the main Maps script reads localStorage.
 * Maps keeps its data in localStorage, so each Munetios Account (and guest mode) gets its own copy:
 * when the signed-in account changes, the previous owner's data is set aside and the new owner's
 * data is put back. maps-sync.js reloads the page if the account turns out to be different.
 */
(() => {
  "use strict";
  const DATA_KEYS = [
    "munetios_markers",
    "munetios_bookmarks",
    "munetios_history",
    "munetios_recent_dirs",
    "munetios_marked_states",
    "munetios_custom_layer",
    "munetios-maps-extras",
  ];
  const OWNER_KEY = "munetios-maps-owner";
  const stashKey = (owner) => "munetios-maps-stash:" + owner;
  let owner = "guest";
  try {
    const cached = JSON.parse(localStorage.getItem("munetios-account-cache") || "null");
    if (cached && cached.id !== undefined && cached.id !== null) owner = String(cached.id);
  } catch {}
  try {
    const previous = localStorage.getItem(OWNER_KEY) || "guest";
    if (previous !== owner) {
      const stash = {};
      for (const key of DATA_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null) stash[key] = value;
        localStorage.removeItem(key);
      }
      if (Object.keys(stash).length) localStorage.setItem(stashKey(previous), JSON.stringify(stash));
      let restore = {};
      try { restore = JSON.parse(localStorage.getItem(stashKey(owner)) || "{}") || {}; } catch {}
      for (const [key, value] of Object.entries(restore)) if (DATA_KEYS.includes(key) && typeof value === "string") localStorage.setItem(key, value);
      localStorage.removeItem(stashKey(owner));
      localStorage.setItem(OWNER_KEY, owner);
    }
  } catch {}
  window.MapsWorkspace = Object.freeze({ owner, dataKeys: DATA_KEYS });
})();
