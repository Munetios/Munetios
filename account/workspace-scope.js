/*
 * Munetios workspaces: which workspace this page works in.
 *
 * Loaded (not deferred) before an app opens its local data. Personal keeps every existing local
 * database, setting, and sync key exactly as before; any other workspace gets its own local copies
 * and its own end-to-end encrypted sync space (keys under "ws.<workspace id>."), so workspaces
 * never mix in Calendar, Photos, Tasks, Notes, Maps, Meals, or OmniWrite.
 */
(() => {
  "use strict";
  const WORKSPACES_KEY = "omniwrite-workspaces";
  const ACTIVE_KEY = "omniwrite-active-workspace";
  const PERSONAL = "workspace-personal";
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  function activeId() {
    const id = read(ACTIVE_KEY);
    if (!id || id === PERSONAL || !/^workspace-[A-Za-z0-9-]{1,64}$/.test(id)) return PERSONAL;
    try {
      const list = JSON.parse(read(WORKSPACES_KEY) || "[]");
      return Array.isArray(list) && list.some((ws) => ws && ws.id === id) ? id : PERSONAL;
    } catch { return PERSONAL; }
  }
  const id = activeId();
  const personal = id === PERSONAL;
  window.MunetiosWorkspaceScope = Object.freeze({
    id,
    personal,
    // Local database or storage key name for this workspace.
    local: (name) => (personal ? name : `${name}::${id}`),
    // Sync prefix for this workspace (the sync server allows A-Z a-z 0-9 : . _ -).
    syncPrefix: (prefix) => (personal ? prefix : `ws.${id}.${prefix}`),
    // Short suffix for owner keys, e.g. "account:7" -> "account:7:ws:workspace-…".
    suffix: personal ? "" : `:ws:${id}`,
  });
  // Switching workspace in another tab reloads this one, so a page never shows two workspaces' data.
  window.addEventListener("storage", (event) => {
    if (event.key === ACTIVE_KEY && activeId() !== id) location.reload();
  });
})();
