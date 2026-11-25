/*!
 * Munetios WebFilter workspace console (/webfilter)
 * Workspaces + collaborators (Admin / Teacher), Global and per-class web filter rules,
 * UserCSS policies with a live sanitizer, element picker and policy-aware auto-suggest,
 * Remote Devices, and extension download + deployment.
 *
 * Roles: Admins manage everything. Teachers manage rules, UserCSS and devices of their
 * assigned classes; Global rules and lists stay visible to them as inherited, read-only.
 */
(() => {
  "use strict";

  const Engine = window.MunetiosWebFilterEngine;
  const Pack = window.MunetiosWebFilterPackage;
  const I18n = window.MunetiosWebFilterI18n;
  const Account = window.MunetiosAccount;
  const t = (key, vars) => I18n.t(key, vars);
  const EXTENSION_VERSION = "1.4.6";

  /* ================================================================ helpers */

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }
  if (typeof window.escapeHtml !== "function") window.escapeHtml = escapeHtml;
  if (typeof window.omniFormatDate !== "function") window.omniFormatDate = value => I18n.formatDate(value);
  const esc = value => window.escapeHtml(value);
  const formatDate = value => (value ? window.omniFormatDate(value) : t("never"));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const icon = name => `<span class="mu-icon" aria-hidden="true">${esc(name)}</span>`;
  const API = location.origin + "/api/webfilter";
  const BLOCK_PAGE = location.origin + "/blocked";

  function toast(message, type = "info", icon) {
    if (window.MunetiosUI && window.MunetiosUI.toast) window.MunetiosUI.toast(message, { type, icon });
  }

  const legacyKeys = { list: "munetios-webfilter-workspaces", active: "munetios-webfilter-active", workspace: id => "munetios-webfilter-workspace:" + id };
  let KEYS;
  const storage = {
    get(key, fallback) {
      try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch (error) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (error) { toast(t("toast_storage_failed"), "error"); return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (error) { /* ignore */ } },
  };

  function debounce(fn, wait) {
    let timer = 0;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  }

  function normalizeHostInput(value) {
    const pattern = Engine.normalizePattern(value);
    if (!pattern) return "";
    return pattern.value;
  }

  /* ============================================================ workspaces */

  function newWorkspace(name) {
    const account = Account.state.account;
    const member = { id: account.id, email: account.email, name: account.displayName || "", role: "admin", classIds: [], owner: true };
    return {
      id: Engine.createId("ws"),
      name: name || "",
      createdAt: Date.now(),
      collaborators: [member],
      member,
      policy: {
        global: { allowlistOnly: false, rules: [], blockedText: [], blockedCategories: [], categoryOverrides: {}, userCss: Engine.emptyUserCss("allowed"), styles: [] },
        classes: [],
      },
      server: { orgId: "", adminKey: "", enrollToken: "", policyVersion: 0, pushedAt: 0 },
      key: null,
      extension: { published: null, provider: "google" },
      preview: { html: "", targetUrl: "https://www.wikipedia.org/" },
    };
  }

  let workspaces = [];
  let ws = null;

  function loadWorkspace(id) {
    const data = storage.get(KEYS.workspace(id), null);
    if (!data) return null;
    const base = newWorkspace();
    const merged = Object.assign(base, data);
    merged.policy = Engine.normalizePolicy(data.policy);
    merged.server = Object.assign(base.server, data.server || {});
    merged.extension = Object.assign(base.extension, data.extension || {});
    merged.preview = Object.assign(base.preview, data.preview || {});
    delete merged.actingAs;
    return merged;
  }

  function saveWorkspace(options = {}) {
    if (!ws) return;
    if (options.push !== false) ws.policyDirty = true;
    storage.set(KEYS.workspace(ws.id), ws);
    const entry = workspaces.find(item => item.id === ws.id);
    if (entry) entry.name = ws.name;
    storage.set(KEYS.list, workspaces);
    if (options.push !== false) schedulePush(ws);
  }

  function createWorkspace(name) {
    const created = newWorkspace(name);
    workspaces.push({ id: created.id, name: created.name });
    storage.set(KEYS.workspace(created.id), created);
    storage.set(KEYS.list, workspaces);
    return created;
  }

  async function discoverWorkspaces(account) {
    const prefix = "munetios-webfilter-account:" + account.id + ":";
    KEYS = { list: prefix + "workspaces", active: prefix + "active", hidden: prefix + "hidden", sidebar: prefix + "sidebar", workspace: id => prefix + "workspace:" + id };
    const saved = storage.get(KEYS.list, []).map(item => storage.get(KEYS.workspace(item.id), null)).filter(Boolean);
    const legacy = storage.get(legacyKeys.list, []).map(item => storage.get(legacyKeys.workspace(item.id), null)).filter(Boolean);
    const { organizations } = await request("/orgs");
    const known = new Set(organizations.map(item => item.orgId));
    for (const item of legacy) {
      const orgId = item.server?.orgId;
      const key = item.server?.adminKey;
      const email = item.collaborators?.find(person => person.owner)?.email;
      if (!orgId || !key || known.has(orgId) || (email && email.toLowerCase() !== account.email.toLowerCase())) continue;
      try {
        organizations.push(await request("/orgs/" + encodeURIComponent(orgId) + "/claim", { method: "POST", legacyKey: key, json: {} }));
        known.add(orgId);
      } catch (error) {
        if (error.status !== 403 && error.status !== 404) throw error;
      }
    }
    const hidden = new Set(storage.get(KEYS.hidden, []));
    workspaces = organizations.filter(item => !hidden.has(item.orgId)).map(item => {
      const existing = saved.find(local => local.server?.orgId === item.orgId)
        || (item.member.owner && legacy.find(local => local.server?.orgId === item.orgId));
      const cached = existing || newWorkspace(item.name);
      if (!saved.includes(existing)) cached.policyDirty = false;
      cached.server = { ...cached.server, orgId: item.orgId };
      if (item.member.role !== "admin") {
        cached.server.adminKey = "";
        cached.server.enrollToken = "";
        cached.key = null;
      }
      cached.name = item.name;
      cached.member = item.member;
      cached.collaborators = [item.member];
      storage.set(KEYS.workspace(cached.id), cached);
      return { id: cached.id, name: cached.name };
    });
    workspaces.push(...saved.filter(item => !item.server?.orgId).map(item => ({ id: item.id, name: item.name })));
    storage.set(KEYS.list, workspaces);
  }

  function activateWorkspace(id) {
    const loaded = loadWorkspace(id);
    if (!loaded) return false;
    if ($("#wfFormModal:not([hidden]) [data-wf-screen-status]")) closeModal("wfFormModal");
    devices.watch?.abort();
    devices.revision = undefined;
    ws = loaded;
    storage.set(KEYS.active, id);
    devices.list = [];
    devices.error = "";
    cssView.scopeId = "global";
    connect();
    return true;
  }

  const workspaceName = item => (item && item.name) || t("workspace_default_name");
  const personName = person => (person ? person.name || (person.owner ? t("you") : person.email || t("unnamed")) : "");

  /* =========================================================== permissions */

  const actor = () => ws.member;
  const isAdmin = () => actor().role === "admin";
  const canEditGlobal = () => isAdmin();
  const canEditClass = id => isAdmin() || (actor().role === "teacher" && actor().classIds.includes(id));
  const canEditScope = scopeId => (scopeId === "global" ? canEditGlobal() : canEditClass(scopeId));
  const visibleClasses = () => (isAdmin() ? ws.policy.classes : ws.policy.classes.filter(klass => actor().classIds.includes(klass.id)));
  const canActOnDevice = device => isAdmin() || (!!device.classId && actor().classIds.includes(device.classId));
  const findClass = id => ws.policy.classes.find(klass => klass.id === id) || null;
  const scopeLabel = scopeId => (scopeId === "global" ? t("scope_global") : findClass(scopeId) ? findClass(scopeId).name : t("unknown_class"));
  const scopeData = scopeId => (scopeId === "global" ? ws.policy.global : findClass(scopeId));

  // Locked controls keep focus and hover (for the tooltip) but never act.
  function lock(allowed, reasonKey = "locked_admin_only") {
    if (allowed) return "";
    const reason = esc(t(reasonKey));
    return ` aria-disabled="true" data-wf-locked="${reason}" data-tooltip="${reason}"`;
  }
  function guard(allowed, reasonKey = "locked_admin_only") {
    if (!allowed) toast(t(reasonKey), "warning", "lock");
    return allowed;
  }

  /* ================================================================ server */

  const server = { status: "connecting", message: "" };
  const devices = { list: [], loading: false, error: "", fetchedAt: 0, timer: 0, revision: undefined, watch: null };

  async function request(route, init = {}) {
    const headers = Object.assign({}, init.headers || {});
    if (init.legacyKey) headers.Authorization = "Bearer " + init.legacyKey;
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(API + route, {
      method: init.method || "GET",
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      signal: init.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && data.error === "signedOut") {
        await Account.refresh();
        if (!Account.state.account || Account.state.revocation) goToSignIn();
      }
      if (response.status === 403 && data.error === "unauthorized" && ws?.server.orgId
        && route.startsWith("/orgs/" + encodeURIComponent(ws.server.orgId) + "/")) {
        $(".wf-shell").hidden = true;
        $$(".mu-modal").forEach(modal => { modal.hidden = true; });
        location.reload();
      }
      const error = new Error(data.error || "HTTP " + response.status);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function connect() {
    if (!ws) return;
    const workspace = ws;
    server.status = "connecting";
    renderChrome();
    try {
      if (!ws.server.orgId) {
        const created = await request("/orgs", { method: "POST", json: { name: workspaceName(ws) } });
        if (ws !== workspace) return;
        Object.assign(ws.server, { orgId: created.orgId, adminKey: created.adminKey, enrollToken: created.enrollToken, policyVersion: 0 });
        saveWorkspace({ push: false });
      }
      const status = await request("/orgs/" + encodeURIComponent(workspace.server.orgId) + "/status");
      if (ws !== workspace) return;
      ws.member = status.member;
      ws.collaborators = status.members;
      ws.name = status.name;
      const hasConflict = ws.policyDirty && ws.server.policyVersion !== status.policyVersion;
      if (status.policy && (!ws.policyDirty || hasConflict)) {
        ws.policy = Engine.normalizePolicy(status.policy);
        ws.policyDirty = false;
      }
      ws.server.policyVersion = status.policyVersion;
      ws.extension.published = status.extension ? { appId: status.extension.appId, version: status.extension.version, at: status.extension.publishedAt } : null;
      saveWorkspace({ push: false });
      server.status = "online";
      server.message = "";
      if (hasConflict) toast(t("policy_changed"), "warning");
      if ((!status.policy && isAdmin()) || ws.policyDirty) await pushPolicy();
    } catch (error) {
      if (ws !== workspace) return;
      if (error.status === 403 || error.status === 404) { location.reload(); return; }
      server.status = error.status === 401 ? "error" : "offline";
      server.message = error.message;
    }
    if (ws !== workspace) return;
    renderAll();
    if (!$("#wfExtensionModal").hidden) {
      renderExtensionModal();
      preparePackage();
    }
    refreshDevices(true);
    refreshRequests();
    loadBypass();
  }

  function exportPolicy(workspace = ws) {
    return {
      global: Object.assign(JSON.parse(JSON.stringify(workspace.policy.global)), { styles: [] }),
      classes: workspace.policy.classes.filter(klass => workspace.member.role === "admin" || workspace.member.classIds.includes(klass.id)).map(klass => ({
        id: klass.id, name: klass.name, allowlistOnly: klass.allowlistOnly,
        rules: klass.rules, blockedText: klass.blockedText || [], blockedCategories: klass.blockedCategories || [], globalExceptions: klass.globalExceptions, userCss: klass.userCss, styles: [],
        safeModes: klass.safeModes, blockedYouTubeVideos: klass.blockedYouTubeVideos || [], allowedYouTubeVideos: klass.allowedYouTubeVideos || [],
      })),
    };
  }

  const policyWrites = new WeakMap();
  function pushPolicy(classAssignments, workspace = ws) {
    const previous = policyWrites.get(workspace) || Promise.resolve();
    const next = previous.then(() => publishPolicy(workspace, classAssignments));
    policyWrites.set(workspace, next.catch(() => {}));
    return next;
  }

  async function publishPolicy(workspace, classAssignments) {
    if (ws !== workspace || !workspace.server.orgId || server.status !== "online") return false;
    server.pushing = true;
    renderChrome();
    try {
      const policy = exportPolicy(workspace);
      const result = await request("/orgs/" + encodeURIComponent(workspace.server.orgId) + "/policy", {
        method: "PUT", json: { policy, expectedVersion: workspace.server.policyVersion, classAssignments },
      });
      if (ws !== workspace) {
        workspace.server.policyVersion = result.version;
        workspace.policyDirty = JSON.stringify(policy) !== JSON.stringify(exportPolicy(workspace));
        storage.set(KEYS.workspace(workspace.id), workspace);
        return true;
      }
      ws.server.policyVersion = result.version;
      ws.server.pushedAt = result.updatedAt;
      if (result.members) ws.collaborators = result.members;
      ws.policyDirty = JSON.stringify(policy) !== JSON.stringify(exportPolicy(workspace));
      saveWorkspace({ push: false });
      server.pushing = false;
      renderChrome();
      return true;
    } catch (error) {
      if (ws !== workspace) return false;
      server.pushing = false;
      if (error.message === "policyChanged" || error.status === 403) {
        server.message = t("policy_changed");
        ws.policyDirty = false;
        saveWorkspace({ push: false });
        toast(server.message, "warning");
        connect();
        return false;
      }
      server.status = "offline";
      server.message = error.message;
      renderChrome();
      return false;
    }
  }
  const schedulePush = debounce(workspace => { pushPolicy(undefined, workspace); }, 700);

  async function refreshDevices(quiet) {
    if (!ws.server.orgId || server.status !== "online") { renderPage(); return; }
    const workspace = ws;
    devices.loading = !quiet;
    if (!quiet) renderPage();
    try {
      const result = await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/devices");
      if (ws !== workspace) return;
      if (result.member && (result.member.role !== workspace.member.role
        || JSON.stringify(result.member.classIds) !== JSON.stringify(workspace.member.classIds))) {
        location.reload();
        return;
      }
      devices.list = result.devices || [];
      devices.revision = result.revision;
      devices.error = "";
      devices.fetchedAt = Date.now();
    } catch (error) {
      if (ws !== workspace) return;
      devices.error = error.message;
    }
    devices.loading = false;
    const openForm = $("#wfFormModal:not([hidden])");
    if (route.page === "devices" && !openForm) renderPage();
    else if (route.page === "classes" || route.page === "requests") renderPage();
    if (openForm) {
      const list = $("[data-wf-device-tabs]", openForm);
      const device = list && devices.list.find(item => item.id === list.dataset.wfDeviceTabs);
      if (device) updateRemoteTabs(list, device);
      loadScreens(openForm);
    }
    if (!devices.error) watchDeviceChanges();
  }

  function viewingDevices() {
    return document.visibilityState === "visible" && (route.page === "devices" || !!$("#wfFormModal:not([hidden]) [data-wf-screen-status]"));
  }

  function watchDeviceChanges() {
    if (!viewingDevices() || devices.watch || typeof devices.revision !== "string") return;
    const controller = new AbortController();
    devices.watch = controller;
    const workspace = ws;
    (async () => {
      while (ws === workspace && viewingDevices() && !controller.signal.aborted) {
        const after = devices.revision;
        const url = "/orgs/" + encodeURIComponent(workspace.server.orgId) + "/devices/changes?after=" + encodeURIComponent(after);
        const update = await request(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
        if (typeof update.revision !== "string" || ws !== workspace || controller.signal.aborted || !viewingDevices()) return;
        if (update.revision !== after) await refreshDevices(true);
        if (devices.error || typeof devices.revision !== "string") return;
      }
    })().catch(() => {}).finally(() => {
      if (devices.watch === controller) devices.watch = null;
    });
  }

  function startDevicePolling() {
    clearInterval(devices.timer);
    devices.timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (route.page === "devices" || $("#wfFormModal:not([hidden]) [data-wf-screen-status]")) refreshDevices(true);
      refreshRequests();
    }, 10000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") devices.watch?.abort();
      else if (viewingDevices()) refreshDevices(true);
    });
  }

  async function sendCommand(device, type, payload = {}) {
    if (!guard(canActOnDevice(device), "locked_device")) return false;
    try {
      await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/devices/" + encodeURIComponent(device.id) + "/commands", { method: "POST", json: { type, payload } });
      toast(t("toast_command_queued", { device: deviceLabel(device) }), "success", "send");
      refreshDevices(true);
      return true;
    } catch (error) {
      toast(t("toast_command_failed", { error: error.message }), "error");
      return false;
    }
  }

  /* ============================================================== routing */

  const PAGES = [
    { id: "rules", icon: "shield", label: "nav_rules" },
    { id: "categories", icon: "category", label: "nav_categories" },
    { id: "classes", icon: "school", label: "nav_classes" },
    { id: "usercss", icon: "format_paint", label: "nav_usercss" },
    { id: "devices", icon: "devices", label: "nav_devices" },
    { id: "requests", icon: "mark_email_unread", label: "nav_requests" },
    { id: "collaborators", icon: "group", label: "nav_collaborators" },
    { id: "compare", icon: "compare_arrows", label: "nav_compare" },
    { id: "settings", icon: "settings", label: "nav_settings" },
  ];
  const SIDEBAR_ITEMS = PAGES.map(page => page.id).concat("extension");
  const route = { page: "rules", classId: "" };

  function readRoute() {
    const [page, classId] = location.hash.replace(/^#\/?/, "").split("/");
    route.page = PAGES.some(item => item.id === page) ? page : "rules";
    route.classId = classId ? decodeURIComponent(classId) : "";
  }

  function go(page, classId) {
    location.hash = "#/" + page + (classId ? "/" + encodeURIComponent(classId) : "");
  }

  /* ========================================================== sidebar UI */

  function sidebarConfig() {
    const saved = storage.get(KEYS.sidebar, null);
    const order = saved && Array.isArray(saved.order) ? saved.order.filter(id => SIDEBAR_ITEMS.includes(id)) : [];
    SIDEBAR_ITEMS.forEach(id => { if (!order.includes(id)) order.push(id); });
    const hidden = saved && Array.isArray(saved.hidden) ? saved.hidden.filter(id => SIDEBAR_ITEMS.includes(id) && id !== "settings") : [];
    return { order, hidden };
  }

  function sidebarItem(id) {
    if (id === "extension") return { id, icon: "extension", label: "nav_extension", action: "open-extension" };
    return PAGES.find(page => page.id === id);
  }

  function renderSidebar() {
    const config = sidebarConfig();
    $("#wfNav").innerHTML = config.order.filter(id => !config.hidden.includes(id) && (isAdmin() || id !== "extension")).map(id => {
      const item = sidebarItem(id);
      const current = item.id === route.page;
      if (item.action) return `<button type="button" class="mu-nav-item" data-wf-action="${item.action}">${icon(item.icon)}<span>${esc(t(item.label))}</span></button>`;
      const count = item.id === "requests" ? pendingRequests().length : 0;
      return `<a class="mu-nav-item${current ? " is-current" : ""}" href="#/${item.id}"${current ? ' aria-current="page"' : ""}>${icon(item.icon)}<span>${esc(t(item.label))}</span>${count ? `<span class="mu-badge mu-badge-warning wf-nav-count" aria-label="${esc(t("requests_pending", { count }))}">${count}</span>` : ""}</a>`;
    }).join("");
    $("#wfSidebarFoot").innerHTML = `<button type="button" class="mu-nav-item" data-wf-action="customize-sidebar">${icon("tune")}<span>${esc(t("customize_sidebar"))}</span></button>`;
    $("#wfWorkspace").innerHTML = `
      <label class="mu-field"><span class="mu-field-label">${esc(t("workspace"))}</span>
        <select class="mu-select" id="wfWorkspaceSelect">${workspaces.map(item => `<option value="${esc(item.id)}"${item.id === ws.id ? " selected" : ""}>${esc(workspaceName(item))}</option>`).join("")}</select>
      </label>`;
  }

  function renderTopbar() {
    const statusMap = {
      connecting: ["mu-badge", "sync", t("status_connecting")],
      online: ["mu-badge mu-badge-success", "cloud_done", server.pushing ? t("status_syncing") : t("status_synced", { version: ws.server.policyVersion })],
      offline: ["mu-badge mu-badge-warning", "cloud_off", t("status_offline")],
      error: ["mu-badge mu-badge-danger", "error", t("status_error")],
    };
    const [badgeClass, badgeIcon, badgeText] = statusMap[server.status];
    $("#wfTopbarActions").innerHTML = `
      <button type="button" class="${badgeClass} wf-status-badge" data-wf-action="reconnect" data-tooltip="${esc(server.status === "online" ? t("status_synced_tip", { time: formatDate(ws.server.pushedAt) }) : t("reconnect"))}">${icon(badgeIcon)}<span class="wf-hide-narrow">${esc(badgeText)}</span></button>
      <span class="mu-badge">${icon(isAdmin() ? "admin_panel_settings" : "school")}${esc(t(isAdmin() ? "role_admin" : "role_teacher"))}</span>
      ${isAdmin() ? `<button type="button" class="mu-icon-btn" data-wf-action="open-extension" aria-label="${esc(t("nav_extension"))}" data-tooltip="${esc(t("nav_extension"))}">${icon("extension")}</button>` : ""}`;
  }

  function renderChrome() {
    if (!ws) return;
    renderSidebar();
    renderTopbar();
    const page = PAGES.find(item => item.id === route.page);
    $("#wfPageTitle").textContent = t(page.label);
    document.title = t(page.label) + " · Munetios WebFilter";
  }

  /* ============================================================== shared UI */

  function hero(iconName, titleKey, descKey) {
    return `<header class="mu-glass mu-panel wf-hero">
      <span class="mu-icon-circle" aria-hidden="true">${icon(iconName)}</span>
      <div><h1 class="mu-h-display">${esc(t(titleKey))}</h1><p class="mu-muted">${esc(t(descKey))}</p></div>
    </header>`;
  }

  function roleNotice() {
    if (isAdmin()) return "";
    return `<div class="mu-read-only-notice wf-role-notice">${icon("school")}<span>${esc(t("teacher_notice_title", { name: personName(actor()) }))}</span><span class="mu-muted">${esc(t("teacher_notice_body"))}</span></div>`;
  }

  function empty(iconName, text, action) {
    return `<div class="mu-empty"><span class="mu-icon-circle">${icon(iconName)}</span><span>${esc(text)}</span>${action || ""}</div>`;
  }

  function classOptions(selected, includeGlobal, onlyEditable) {
    const list = onlyEditable ? ws.policy.classes.filter(klass => canEditClass(klass.id)) : visibleClasses();
    return (includeGlobal ? `<option value="global"${selected === "global" ? " selected" : ""}>${esc(t("scope_global"))}</option>` : "") +
      list.map(klass => `<option value="${esc(klass.id)}"${selected === klass.id ? " selected" : ""}>${esc(klass.name)}</option>`).join("");
  }

  const ACTION_LABELS = { block: "action_block", allow: "action_allow" };
  const TYPE_LABELS = { domain: "type_domain", url: "type_url", keyword: "type_keyword" };

  function exceptionsFor(klass) {
    if (!klass.globalExceptions) klass.globalExceptions = { rules: [], categories: [], text: [] };
    ["rules", "categories", "text"].forEach(key => { if (!Array.isArray(klass.globalExceptions[key])) klass.globalExceptions[key] = []; });
    return klass.globalExceptions;
  }

  // classId set: a Global rule shown for one class. Its switch and edit button
  // change that class only (Teachers can do this for their own classes).
  function ruleRow(rule, scopeId, classId) {
    const klass = classId ? findClass(classId) : null;
    if (klass) {
      const editable = canEditClass(klass.id);
      const off = exceptionsFor(klass).rules.includes(rule.id);
      const on = !off && rule.enabled !== false;
      return `<div class="mu-row wf-rule${on ? "" : " is-disabled"}">
        <span class="mu-icon-circle${rule.action === "block" ? " mu-icon-circle-danger" : ""}" aria-hidden="true">${icon(rule.action === "block" ? "block" : "check_circle")}</span>
        <div class="mu-row-info">
          <span class="mu-row-title" dir="ltr">${esc(rule.value)}</span>
          <span class="mu-row-subtitle">${esc(t(TYPE_LABELS[rule.type] || "type_domain"))} · ${esc(t(ACTION_LABELS[rule.action]))}${rule.note ? " · " + esc(rule.note) : ""}</span>
        </div>
        <span class="mu-badge${off ? " mu-badge-warning" : ""}">${icon(off ? "toggle_off" : "public")}${esc(off ? t("off_for_class", { name: klass.name }) : t("inherited_global"))}</span>
        <label class="mu-switch"${lock(editable && rule.enabled !== false, rule.enabled === false ? "locked_global" : "locked_class")}><input type="checkbox" data-wf-action="toggle-global-rule" data-class="${esc(klass.id)}" data-id="${esc(rule.id)}" ${on ? "checked" : ""}${editable && rule.enabled !== false ? "" : " disabled"} aria-label="${esc(t("on_for_class", { name: klass.name }))}"><span class="mu-switch-track"></span></label>
        <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-wf-action="change-global-rule" data-class="${esc(klass.id)}" data-id="${esc(rule.id)}" aria-label="${esc(t("change_for_class", { name: klass.name }))}"${editable ? ` data-tooltip="${esc(t("change_for_class", { name: klass.name }))}"` : lock(false, "locked_class")}>${icon("edit")}</button>
      </div>`;
    }
    const editable = canEditScope(scopeId);
    const reason = scopeId === "global" ? "locked_global" : "locked_class";
    return `<div class="mu-row wf-rule${rule.enabled === false ? " is-disabled" : ""}">
      <span class="mu-icon-circle${rule.action === "block" ? " mu-icon-circle-danger" : ""}" aria-hidden="true">${icon(rule.action === "block" ? "block" : "check_circle")}</span>
      <div class="mu-row-info">
        <span class="mu-row-title" dir="ltr">${esc(rule.value)}</span>
        <span class="mu-row-subtitle">${esc(t(TYPE_LABELS[rule.type] || "type_domain"))} · ${esc(t(ACTION_LABELS[rule.action]))}${rule.note ? " · " + esc(rule.note) : ""}</span>
      </div>
      <label class="mu-switch"${lock(editable, reason)}><input type="checkbox" data-wf-action="toggle-rule" data-scope="${esc(scopeId)}" data-id="${esc(rule.id)}" ${rule.enabled === false ? "" : "checked"}${editable ? "" : " disabled"} aria-label="${esc(t("rule_enabled"))}"><span class="mu-switch-track"></span></label>
      <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-wf-action="edit-rule" data-scope="${esc(scopeId)}" data-id="${esc(rule.id)}" aria-label="${esc(t("edit_rule"))}"${editable ? ` data-tooltip="${esc(t("edit_rule"))}"` : lock(false, reason)}>${icon("edit")}</button>
      <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-danger data-wf-action="delete-rule" data-scope="${esc(scopeId)}" data-id="${esc(rule.id)}" aria-label="${esc(t("delete_rule"))}"${editable ? ` data-tooltip="${esc(t("delete_rule"))}"` : lock(false, reason)}>${icon("delete")}</button>
    </div>`;
  }

  function quickButtons(scopeId, allowed, reason) {
    return `<div class="wf-actions">
      <button type="button" class="mu-btn" data-wf-action="add-rule" data-scope="${esc(scopeId)}" data-rule-action="allow"${lock(allowed, reason)}>${icon("check_circle")}${esc(t("allow_a_site"))}</button>
      <button type="button" class="mu-btn mu-btn-primary" data-wf-action="add-rule" data-scope="${esc(scopeId)}" data-rule-action="block"${lock(allowed, reason)}>${icon("block")}${esc(t("block_a_site"))}</button>
    </div>`;
  }

  /* ============================================================ blocked text */

  // classId set: Global blocked words shown for one class, each can be switched off for that class.
  function blockedTextSection(scopeId, classId) {
    const klass = classId ? findClass(classId) : null;
    if (klass) {
      const editable = canEditClass(klass.id);
      const off = exceptionsFor(klass).text;
      const items = ws.policy.global.blockedText || [];
      const tags = items.length ? items.map(phrase => {
        const isOff = off.includes(phrase);
        return `<span class="mu-tag${isOff ? " wf-tag-off" : ""}">${esc(phrase)}<button type="button" data-wf-action="toggle-global-text" data-class="${esc(klass.id)}" data-value="${esc(phrase)}" aria-label="${esc(t(isOff ? "turn_on_for_class" : "turn_off_for_class", { item: phrase, name: klass.name }))}"${editable ? ` data-tooltip="${esc(t(isOff ? "turn_on_for_class" : "turn_off_for_class", { item: phrase, name: klass.name }))}"` : lock(false, "locked_class")}>${icon(isOff ? "undo" : "toggle_off")}</button></span>`;
      }).join("") : `<span class="mu-muted">${esc(t("no_blocked_text"))}</span>`;
      return `<div class="mu-section-label">${esc(t("inherited_blocked_text"))}</div><div class="mu-tags">${tags}</div>`;
    }
    const scope = scopeData(scopeId);
    const editable = canEditScope(scopeId);
    const reason = scopeId === "global" ? "locked_global" : "locked_class";
    const items = scope.blockedText || [];
    const tags = items.length
      ? items.map(phrase => `<span class="mu-tag">${esc(phrase)}<button type="button" data-wf-action="remove-text" data-scope="${esc(scopeId)}" data-value="${esc(phrase)}" aria-label="${esc(t("remove_item", { item: phrase }))}"${lock(editable, reason)}>${icon("close")}</button></span>`).join("")
      : `<span class="mu-muted">${esc(t("no_blocked_text"))}</span>`;
    return `<section class="wf-text-block" aria-labelledby="wfText-${esc(scopeId)}">
      <div class="wf-policy-head"><span class="mu-icon-circle" aria-hidden="true">${icon("spellcheck")}</span><div><h3 class="mu-h-title" id="wfText-${esc(scopeId)}">${esc(t("blocked_text"))}</h3><p class="mu-muted">${esc(t("blocked_text_desc"))}</p></div></div>
      <form class="wf-inline-form" data-wf-form="add-text" data-scope="${esc(scopeId)}">
        <label class="mu-field wf-grow"><span class="wf-visually-hidden">${esc(t("add_blocked_text"))}</span><input class="mu-input" name="phrase" autocomplete="off" placeholder="${esc(t("blocked_text_placeholder"))}" required${editable ? "" : " disabled"}></label>
        <button type="submit" class="mu-btn mu-btn-primary"${lock(editable, reason)}>${icon("add")}${esc(t("add_blocked_text"))}</button>
      </form>
      <div class="mu-tags">${tags}</div>
    </section>`;
  }

  /* ============================================================ rules page */

  function siteControlsSection(scopeId) {
    const scope = scopeData(scopeId);
    const editable = canEditScope(scopeId);
    const reason = scopeId === "global" ? "locked_global" : "locked_class";
    const inherited = scopeId === "global" ? null : ws.policy.global;
    const modes = Engine.SAFE_MODES.map(mode => {
      const title = esc(t("safe_mode_" + mode));
      const fromGlobal = inherited?.safeModes?.[mode] === true;
      return `<div class="mu-row">
        <div class="mu-row-info"><span class="mu-row-title">${title}</span>${fromGlobal ? `<span class="mu-row-subtitle">${esc(t("inherited_from_global"))}</span>` : ""}</div>
        <label class="mu-switch"><input type="checkbox" data-wf-action="toggle-safe-mode" data-scope="${esc(scopeId)}" data-mode="${mode}" aria-label="${title}"${fromGlobal || scope.safeModes?.[mode] ? " checked" : ""}${fromGlobal || !editable ? " disabled" : ""}><span class="mu-switch-track"></span></label>
      </div>`;
    }).join("");
    const blocked = scope.blockedYouTubeVideos || [];
    const allowed = scope.allowedYouTubeVideos || [];
    const inheritedBlocks = (inherited?.blockedYouTubeVideos || []).filter(id => !blocked.includes(id) && !allowed.includes(id));
    const renderVideos = (list, decision, title) => !list.length ? "" : `
      ${title ? `<div class="mu-section-label">${esc(t(title))}</div>` : ""}
      <div class="mu-tags">${list.map(id => `<span class="mu-tag" dir="ltr">${esc(id)}
        ${decision ? `<button type="button" data-wf-action="remove-youtube-video" data-scope="${esc(scopeId)}" data-decision="${decision}" data-value="${esc(id)}" aria-label="${esc(t("remove_item", { item: id }))}"${lock(editable, reason)}>${icon("close")}</button>` : ""}
      </span>`).join("")}</div>`;
    return `<section class="wf-text-block" aria-labelledby="wfSafe-${esc(scopeId)}">
      <div class="wf-policy-head"><span class="mu-icon-circle" aria-hidden="true">${icon("shield")}</span><div><h3 class="mu-h-title" id="wfSafe-${esc(scopeId)}">${esc(t("site_safe_modes"))}</h3></div></div>
      ${modes}
    </section>
    <section class="wf-text-block" aria-labelledby="wfYouTube-${esc(scopeId)}">
      <div class="wf-policy-head"><span class="mu-icon-circle" aria-hidden="true">${icon("video_library")}</span><div><h3 class="mu-h-title" id="wfYouTube-${esc(scopeId)}">${esc(t(inherited ? "youtube_video_rules" : "blocked_youtube_videos"))}</h3></div></div>
      <form class="wf-inline-form" data-wf-form="add-youtube-video" data-scope="${esc(scopeId)}">
        <label class="mu-field wf-grow"><span class="mu-field-label">${esc(t("youtube_video_input"))}</span><input class="mu-input" name="video" dir="ltr" autocomplete="off" required${editable ? "" : " disabled"}></label>
        <div class="wf-actions">
          <button type="submit" class="mu-btn mu-btn-primary" value="block"${lock(editable, reason)}>${icon("block")}${esc(t("block_youtube_video"))}</button>
          ${inherited ? `<button type="submit" class="mu-btn" value="allow"${lock(editable, reason)}>${icon("check")}${esc(t("allow_youtube_video"))}</button>` : ""}
        </div>
      </form>
      ${renderVideos(blocked, "block", inherited ? "blocked_youtube_videos" : "")}
      ${renderVideos(allowed, "allow", "allowed_youtube_videos")}
      ${renderVideos(inheritedBlocks, "", "inherited_from_global")}
    </section>`;
  }

  function currentRulesClass() {
    const list = visibleClasses();
    if (route.classId && list.some(klass => klass.id === route.classId)) return route.classId;
    return list[0] ? list[0].id : "";
  }

  function renderRulesPage() {
    const global = ws.policy.global;
    const classId = currentRulesClass();
    const klass = findClass(classId);
    const admin = canEditGlobal();
    const classPicker = visibleClasses().length ? `<label class="mu-field"><span class="mu-field-label">${esc(t("class"))}</span><select class="mu-select" id="wfRulesClass">${classOptions(classId, false)}</select></label>` : "";
    // Admins edit Global for everyone. Teachers see Global as their class sees it and change it for that class only.
    const globalBody = admin
      ? `${quickButtons("global", true)}
        <div class="mu-row">
          <div class="mu-row-info"><span class="mu-row-title">${esc(t("allowlist_only"))}</span><span class="mu-row-subtitle">${esc(t("allowlist_only_global_desc"))}</span></div>
          <label class="mu-switch"><input type="checkbox" data-wf-action="toggle-allowlist" data-scope="global" ${global.allowlistOnly ? "checked" : ""} aria-label="${esc(t("allowlist_only"))}"><span class="mu-switch-track"></span></label>
        </div>
        <div class="wf-list">${global.rules.length ? global.rules.map(rule => ruleRow(rule, "global")).join("") : empty("shield", t("no_global_rules"))}</div>
        ${blockedTextSection("global")}
        ${siteControlsSection("global")}`
      : klass
        ? `<div class="mu-alert wf-class-scope-notice" role="note">${icon("school")}<div class="mu-alert-body"><span class="mu-alert-title">${esc(t("teacher_global_title", { name: klass.name }))}</span><span class="mu-muted">${esc(t("teacher_global_body"))}</span></div>${classPicker}</div>
          ${quickButtons(klass.id, canEditClass(klass.id), "locked_class")}
          <div class="wf-list">${global.rules.length ? global.rules.map(rule => ruleRow(rule, "global", klass.id)).join("") : empty("shield", t("no_global_rules"))}</div>
          ${blockedTextSection("global", klass.id)}`
        : empty("school", t("no_classes_teacher"));

    return hero("shield", "rules_title", "rules_desc") + roleNotice() + `
      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfTesterTitle">
        <h2 class="mu-h-title" id="wfTesterTitle">${esc(t("tester_title"))}</h2>
        <form class="wf-inline-form" data-wf-form="test-url">
          <label class="mu-field wf-grow"><span class="mu-field-label">${esc(t("tester_url"))}</span><input class="mu-input" name="url" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://example.org/page" required></label>
          <label class="mu-field"><span class="mu-field-label">${esc(t("tester_as"))}</span><select class="mu-select" name="classId">${admin ? `<option value="">${esc(t("tester_no_class"))}</option>` : ""}${classOptions(classId, false)}</select></label>
          <button type="submit" class="mu-btn mu-btn-primary">${icon("travel_explore")}${esc(t("tester_check"))}</button>
        </form>
        <div id="wfTesterResult" aria-live="polite"></div>
      </section>

      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfGlobalRulesTitle">
        <div class="wf-card-head">
          <div><h2 class="mu-h-title" id="wfGlobalRulesTitle">${esc(t("global_rules"))}</h2><p class="mu-muted">${esc(t(admin ? "global_rules_desc" : "global_rules_teacher_desc"))}</p></div>
        </div>
        ${globalBody}
      </section>

      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfClassRulesTitle">
        <div class="wf-card-head">
          <div><h2 class="mu-h-title" id="wfClassRulesTitle">${esc(klass ? t("class_only_rules", { name: klass.name }) : t("class_rules"))}</h2><p class="mu-muted">${esc(t("class_rules_desc"))}</p></div>
          ${classPicker}
        </div>
        ${klass ? `
          ${quickButtons(klass.id, canEditClass(klass.id), "locked_class")}
          <div class="mu-row">
            <div class="mu-row-info"><span class="mu-row-title">${esc(t("allowlist_only"))}</span><span class="mu-row-subtitle">${esc(t("allowlist_only_class_desc"))}</span></div>
            <label class="mu-switch"${lock(canEditClass(klass.id), "locked_class")}><input type="checkbox" data-wf-action="toggle-allowlist" data-scope="${esc(klass.id)}" ${klass.allowlistOnly ? "checked" : ""}${canEditClass(klass.id) ? "" : " disabled"} aria-label="${esc(t("allowlist_only"))}"><span class="mu-switch-track"></span></label>
          </div>
          <div class="wf-list">${klass.rules.length ? klass.rules.map(rule => ruleRow(rule, klass.id)).join("") : empty("rule", t("no_class_rules"))}</div>
          ${admin ? `<div class="mu-section-label">${esc(t("inherited_from_global"))}</div>
          <div class="wf-list">${global.rules.length ? global.rules.map(rule => ruleRow(rule, "global", klass.id)).join("") : `<p class="mu-muted">${esc(t("no_global_rules"))}</p>`}</div>
          ${blockedTextSection("global", klass.id)}` : ""}
          ${blockedTextSection(klass.id)}
          ${siteControlsSection(klass.id)}`
        : empty("school", isAdmin() ? t("no_classes_admin") : t("no_classes_teacher"), isAdmin() ? `<button type="button" class="mu-btn mu-btn-primary" data-wf-action="add-class">${icon("add")}${esc(t("add_class"))}</button>` : "")}
      </section>`;
  }

  function renderTestResult(url, classId) {
    const out = $("#wfTesterResult");
    if (!out) return;
    const parsed = Engine.parseUrl(url);
    if (!parsed) { out.innerHTML = `<p class="mu-inline-error">${esc(t("invalid_url"))}</p>`; return; }
    const ctx = { classId, blockPageUrl: BLOCK_PAGE };
    const access = Engine.evaluateAccess(parsed.href, ws.policy, ctx);
    const controls = Engine.effectiveSiteControls(ws.policy, classId);
    const videoBlocked = !access.blocked && controls.blockedYouTubeVideos.includes(Engine.youtubeVideoId(parsed.href));
    const css = Engine.resolveUserCssMode(parsed.href, ws.policy, ctx);
    const reasonKey = "reason_" + access.reason.replace(/-/g, "_");
    out.innerHTML = `<div class="mu-alert ${access.blocked || videoBlocked ? "is-danger" : "is-success"}" role="status">
      ${icon(access.blocked || videoBlocked ? "block" : "check_circle")}
      <div class="mu-alert-body">
        <span class="mu-alert-title">${esc(t(videoBlocked ? "ext_youtube_video_unavailable" : access.blocked ? "verdict_blocked" : "verdict_allowed"))}</span>
        <span class="mu-muted">${esc(t(videoBlocked ? "blocked_youtube_videos" : reasonKey))}${access.rule && access.rule.value ? " · " + esc(access.reason === "category-block" ? t("cat_" + access.rule.value) : access.rule.value) : ""}${access.scope && access.scope !== "device" ? " · " + esc(scopeLabel(access.scope)) : ""}</span>
        <span class="mu-muted">${esc(t("category_line", { category: t("cat_" + Engine.categorize(parsed, ws.policy).category) }))}</span>
        <span class="mu-muted">${esc(t("usercss_label"))}: ${esc(t("mode_" + css.mode))}</span>
      </div>
    </div>`;
  }

  /* ========================================================== rule editing */

  // Change a Global rule for one class: the Global rule is switched off for that class
  // and the edited copy becomes a class rule. Everyone else keeps the Global rule.
  function openGlobalChangeForm(classId, ruleId) {
    const klass = findClass(classId);
    const source = ws.policy.global.rules.find(item => item.id === ruleId);
    if (!klass || !source || !guard(canEditClass(classId), "locked_class")) return;
    openForm({
      title: t("change_for_class", { name: klass.name }),
      icon: "edit",
      description: t("change_for_class_desc", { name: klass.name }),
      submit: t("save"),
      fields: [
        { name: "action", type: "segmented", label: t("rule_action"), value: source.action, options: [{ value: "block", label: t("action_block") }, { value: "allow", label: t("action_allow") }] },
        { name: "type", type: "select", label: t("rule_type"), value: source.type, options: [{ value: "domain", label: t("type_domain") }, { value: "url", label: t("type_url") }, { value: "keyword", label: t("type_keyword") }] },
        { name: "value", type: "text", label: t("rule_pattern"), value: source.value, required: true, dir: "ltr", help: t("rule_pattern_help") },
        { name: "note", type: "text", label: t("rule_note"), value: source.note || "" },
      ],
      onSubmit(values) {
        const pattern = Engine.normalizePattern(values.value, values.type);
        if (!pattern) return { field: "value", message: t("invalid_pattern") };
        const exceptions = exceptionsFor(klass);
        if (!exceptions.rules.includes(source.id)) exceptions.rules.push(source.id);
        if (!klass.rules.some(item => item.type === pattern.type && item.value === pattern.value && item.action === values.action)) {
          klass.rules.push({ id: Engine.createId("rule"), action: values.action, type: pattern.type, value: pattern.value, note: values.note.trim(), enabled: true, createdBy: actor().id, createdByRole: actor().role, createdAt: Date.now(), replaces: source.id });
        }
        saveWorkspace();
        renderPage();
        toast(t("toast_changed_for_class", { name: klass.name }), "success");
        return null;
      },
    });
  }

  function openRuleForm(scopeId, ruleId, presetAction) {
    if (!guard(canEditScope(scopeId), scopeId === "global" ? "locked_global" : "locked_class")) return;
    const scope = scopeData(scopeId);
    const rule = ruleId ? scope.rules.find(item => item.id === ruleId) : null;
    const startAction = rule ? rule.action : presetAction === "allow" ? "allow" : "block";
    openForm({
      title: rule ? t("edit_rule") : t(startAction === "allow" ? "allow_sites_in" : "block_sites_in", { scope: scopeLabel(scopeId) }),
      icon: rule ? "edit" : startAction === "allow" ? "check_circle" : "block",
      submit: t(rule ? "save" : "add_rules"),
      fields: [
        { name: "action", type: "segmented", label: t("rule_action"), value: startAction, options: [{ value: "block", label: t("action_block") }, { value: "allow", label: t("action_allow") }] },
        { name: "type", type: "select", label: t("rule_type"), value: rule ? rule.type : "domain", options: [{ value: "domain", label: t("type_domain") }, { value: "url", label: t("type_url") }, { value: "keyword", label: t("type_keyword") }] },
        rule
          ? { name: "value", type: "text", label: t("rule_pattern"), value: rule.value, required: true, dir: "ltr", placeholder: "example.org", help: t("rule_pattern_help") }
          : { name: "value", type: "textarea", label: t("rule_patterns"), value: "", required: true, dir: "ltr", placeholder: "games.example\nvideo.example/shorts\nsocial.example", help: t("rule_patterns_help") },
        { name: "note", type: "text", label: t("rule_note"), value: rule ? rule.note || "" : "" },
      ],
      onSubmit(values) {
        if (!rule) {
          // Several rules at once: one per line or separated by commas.
          const entries = values.value.split(values.type === "keyword" ? /[\n,]+/ : /[\s,]+/).map(item => item.trim()).filter(Boolean);
          if (!entries.length) return { field: "value", message: t("required") };
          // With "Domain" selected, a line that has a path ("site.example/games") becomes a URL prefix rule.
          const toPattern = item => Engine.normalizePattern(item, values.type === "domain" && item.includes("/") ? "url" : values.type);
          const invalid = entries.filter(item => !toPattern(item));
          if (invalid.length) return { field: "value", message: t("invalid_patterns", { items: invalid.join(", ") }) };
          let added = 0;
          let skipped = 0;
          entries.map(toPattern).forEach(pattern => {
            const exists = scope.rules.some(item => item.type === pattern.type && item.value === pattern.value && item.action === values.action);
            if (exists) { skipped++; return; }
            scope.rules.push({ id: Engine.createId("rule"), action: values.action, type: pattern.type, value: pattern.value, note: values.note.trim(), enabled: true, createdBy: actor().id, createdByRole: actor().role, createdAt: Date.now() });
            added++;
          });
          if (!added) return { field: "value", message: t("duplicate_rule") };
          saveWorkspace();
          renderPage();
          toast(skipped ? t("toast_rules_skipped", { added, skipped }) : t("toast_rules_added", { count: added }), "success");
          return null;
        }
        const pattern = Engine.normalizePattern(values.value, values.type);
        if (!pattern) return { field: "value", message: t("invalid_pattern") };
        const duplicate = scope.rules.find(item => item.id !== ruleId && item.type === pattern.type && item.value === pattern.value && item.action === values.action);
        if (duplicate) return { field: "value", message: t("duplicate_rule") };
        if (rule.action !== values.action || rule.type !== pattern.type || rule.value !== pattern.value) rule.updatedByRole = actor().role;
        Object.assign(rule, { action: values.action, type: pattern.type, value: pattern.value, note: values.note.trim(), updatedAt: Date.now() });
        saveWorkspace();
        renderPage();
        toast(t(rule ? "toast_rule_saved" : "toast_rule_added"), "success");
        return null;
      },
    });
  }

  function deleteRule(scopeId, ruleId) {
    if (!guard(canEditScope(scopeId), scopeId === "global" ? "locked_global" : "locked_class")) return;
    const scope = scopeData(scopeId);
    const rule = scope.rules.find(item => item.id === ruleId);
    if (!rule) return;
    confirmAction({
      title: t("delete_rule"),
      body: t("delete_rule_confirm", { pattern: rule.value }),
      submit: t("delete"),
      onConfirm() {
        scope.rules = scope.rules.filter(item => item.id !== ruleId);
        saveWorkspace();
        renderPage();
        toast(t("toast_rule_deleted"), "success");
      },
    });
  }

  /* ======================================================= categories page */

  const CATEGORY_ICONS = {
    education: "school", reference: "menu_book", search: "search", productivity: "work", news: "newspaper", social: "groups",
    chat: "forum", video: "smart_display", music: "music_note", games: "sports_esports", gambling: "casino", adult: "explicit",
    shopping: "shopping_bag", ai: "smart_toy", sports: "sports_soccer", government: "account_balance", health: "health_and_safety",
    proxy: "vpn_lock", unrated: "help",
  };
  const categoryName = id => t("cat_" + id);

  function currentCategoriesClass() {
    const list = visibleClasses();
    if (route.classId && list.some(klass => klass.id === route.classId)) return route.classId;
    return list[0] ? list[0].id : "";
  }

  function categoryGrid(scopeId) {
    const scope = scopeData(scopeId);
    const editable = canEditScope(scopeId);
    const reason = scopeId === "global" ? "locked_global" : "locked_class";
    const globalBlocked = ws.policy.global.blockedCategories || [];
    const off = scopeId !== "global" ? exceptionsFor(scope).categories : [];
    return `<div class="wf-category-grid">${Engine.CATEGORIES.map(id => {
      const inherited = scopeId !== "global" && globalBlocked.includes(id);
      const turnedOff = inherited && off.includes(id);
      const checked = (inherited && !turnedOff) || (scope.blockedCategories || []).includes(id);
      const note = inherited ? `<span class="mu-row-subtitle">${icon(turnedOff ? "toggle_off" : "public")} ${esc(turnedOff ? t("off_for_class", { name: scope.name }) : t("blocked_globally"))}</span>` : "";
      return `<div class="mu-row wf-category${checked ? " is-blocked" : ""}">
        <span class="mu-icon-circle${checked ? " mu-icon-circle-danger" : ""}" aria-hidden="true">${icon(CATEGORY_ICONS[id])}</span>
        <div class="mu-row-info"><span class="mu-row-title">${esc(categoryName(id))}</span>${id === "unrated" ? `<span class="mu-row-subtitle">${esc(t("cat_unrated_desc"))}</span>` : ""}${note}</div>
        <label class="mu-switch"${lock(editable, reason)}><input type="checkbox" data-wf-action="toggle-category" data-scope="${esc(scopeId)}" data-id="${id}" ${checked ? "checked" : ""}${editable ? "" : " disabled"} aria-label="${esc(t("category_blocked_label", { category: categoryName(id) }))}"><span class="mu-switch-track"></span></label>
      </div>`;
    }).join("")}</div>`;
  }

  function renderCategoriesPage() {
    const classId = currentCategoriesClass();
    const klass = findClass(classId);
    const overrides = Object.entries(ws.policy.global.categoryOverrides || {}).sort((a, b) => a[0].localeCompare(b[0]));
    return hero("category", "categories_title", "categories_desc") + roleNotice() + `
      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfCatCheckTitle">
        <h2 class="mu-h-title" id="wfCatCheckTitle">${esc(t("category_checker"))}</h2>
        <form class="wf-inline-form" data-wf-form="check-category">
          <label class="mu-field wf-grow"><span class="mu-field-label">${esc(t("tester_url"))}</span><input class="mu-input" name="url" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://example.org" required></label>
          <button type="submit" class="mu-btn mu-btn-primary">${icon("travel_explore")}${esc(t("category_check"))}</button>
        </form>
        <div id="wfCategoryResult" aria-live="polite"></div>
        <p class="mu-muted wf-note">${icon("info")} ${esc(t("builtin_count", { count: Engine.BUILTIN_CATEGORY_COUNT }))}</p>
      </section>

      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfGlobalCatTitle">
        <div class="wf-card-head">
          <div><h2 class="mu-h-title" id="wfGlobalCatTitle">${esc(t("global_categories"))}</h2><p class="mu-muted">${esc(t("global_categories_desc"))}</p></div>
          ${canEditGlobal() ? "" : `<span class="mu-badge">${icon("lock")}${esc(t("read_only"))}</span>`}
        </div>
        ${categoryGrid("global")}
      </section>

      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfClassCatTitle">
        <div class="wf-card-head">
          <div><h2 class="mu-h-title" id="wfClassCatTitle">${esc(t("class_categories"))}</h2><p class="mu-muted">${esc(t("class_categories_desc"))}</p></div>
          ${visibleClasses().length ? `<label class="mu-field"><span class="mu-field-label">${esc(t("class"))}</span><select class="mu-select" id="wfCategoriesClass">${classOptions(classId, false)}</select></label>` : ""}
        </div>
        ${klass ? categoryGrid(klass.id) : empty("school", isAdmin() ? t("no_classes_admin") : t("no_classes_teacher"), isAdmin() ? `<button type="button" class="mu-btn mu-btn-primary" data-wf-action="add-class">${icon("add")}${esc(t("add_class"))}</button>` : "")}
      </section>

      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfCustomCatTitle">
        <div class="wf-card-head">
          <div><h2 class="mu-h-title" id="wfCustomCatTitle">${esc(t("custom_categories"))}</h2><p class="mu-muted">${esc(t("custom_categories_desc"))}</p></div>
          <button type="button" class="mu-btn mu-btn-primary" data-wf-action="categorize-sites"${lock(isAdmin())}>${icon("add")}${esc(t("categorize_sites"))}</button>
        </div>
        <div class="wf-list">${overrides.length ? overrides.map(([domain, category]) => `<div class="mu-row">
            <span class="mu-icon-circle" aria-hidden="true">${icon(CATEGORY_ICONS[category])}</span>
            <div class="mu-row-info"><span class="mu-row-title" dir="ltr">${esc(domain)}</span><span class="mu-row-subtitle">${esc(categoryName(category))}</span></div>
            <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-danger data-wf-action="remove-override" data-value="${esc(domain)}" aria-label="${esc(t("remove_item", { item: domain }))}"${isAdmin() ? ` data-tooltip="${esc(t("remove_item", { item: domain }))}"` : lock(false)}>${icon("delete")}</button>
          </div>`).join("") : empty("category", t("no_custom_categories"))}</div>
      </section>`;
  }

  function renderCategoryResult(url) {
    const out = $("#wfCategoryResult");
    const parsed = Engine.parseUrl(url);
    if (!out) return;
    if (!parsed || !/^https?:$/.test(parsed.protocol)) { out.innerHTML = `<p class="mu-inline-error">${icon("error")}<span>${esc(t("invalid_url"))}</span></p>`; return; }
    const result = Engine.categorize(parsed, ws.policy);
    const blockedGlobally = (ws.policy.global.blockedCategories || []).includes(result.category);
    out.innerHTML = `<div class="mu-alert ${blockedGlobally ? "is-danger" : "is-success"}" role="status">${icon(CATEGORY_ICONS[result.category])}
      <div class="mu-alert-body"><span class="mu-alert-title">${esc(t("category_result", { site: parsed.hostname, category: categoryName(result.category) }))}</span>
      <span class="mu-muted">${esc(t("category_source_" + result.source))}${result.source !== "unrated" && result.domain !== parsed.hostname ? " · " + esc(result.domain) : ""}</span>
      ${blockedGlobally ? `<span class="mu-muted">${esc(t("blocked_globally"))}</span>` : ""}</div></div>`;
  }

  function openCategorizeForm() {
    if (!guard(isAdmin())) return;
    openForm({
      title: t("categorize_sites"), icon: "category", submit: t("save"),
      fields: [
        { name: "domains", type: "textarea", label: t("rule_patterns"), value: "", required: true, dir: "ltr", placeholder: "myschool.example\nlibrary.example", help: t("categorize_sites_help") },
        { name: "category", type: "select", label: t("category"), value: "education", options: Engine.CATEGORIES.map(id => ({ value: id, label: categoryName(id) })) },
      ],
      onSubmit(values) {
        const entries = values.domains.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
        if (!entries.length) return { field: "domains", message: t("required") };
        const invalid = entries.filter(item => !Engine.normalizePattern(item, "domain"));
        if (invalid.length) return { field: "domains", message: t("invalid_patterns", { items: invalid.join(", ") }) };
        ws.policy.global.categoryOverrides = ws.policy.global.categoryOverrides || {};
        entries.forEach(item => { ws.policy.global.categoryOverrides[Engine.normalizePattern(item, "domain").value] = values.category; });
        saveWorkspace();
        renderPage();
        toast(t("toast_categorized", { count: entries.length }), "success");
        return null;
      },
    });
  }

  /* ========================================================== classes page */

  function renderClassesPage() {
    const list = visibleClasses();
    const cards = list.map(klass => {
      const teachers = ws.collaborators.filter(person => person.role === "teacher" && person.classIds.includes(klass.id));
      const deviceCount = devices.list.filter(device => device.classId === klass.id).length;
      return `<article class="mu-glass mu-panel wf-class-card">
        <div class="wf-card-head">
          <span class="mu-icon-circle" aria-hidden="true">${icon("school")}</span>
          <div class="wf-grow"><h2 class="mu-h-title">${esc(klass.name)}</h2></div>
        </div>
        <div class="wf-stats">
          <span class="mu-badge">${icon("rule")}${esc(t("count_rules", { count: klass.rules.length }))}</span>
          <span class="mu-badge">${icon("format_paint")}${esc(t("count_styles", { count: klass.styles.length }))}</span>
          <span class="mu-badge">${icon("devices")}${esc(t("count_devices", { count: deviceCount }))}</span>
        </div>
        <div class="mu-section-label">${esc(t("teachers"))}</div>
        <div class="mu-tags">${teachers.length ? teachers.map(person => `<span class="mu-tag">${esc(personName(person))}</span>`).join("") : `<span class="mu-muted">${esc(t("no_teachers"))}</span>`}</div>
        <div class="wf-actions">
          <a class="mu-btn" href="#/rules/${encodeURIComponent(klass.id)}">${icon("shield")}${esc(t("manage_rules"))}</a>
          <button type="button" class="mu-btn" data-wf-action="edit-class" data-id="${esc(klass.id)}"${lock(isAdmin())}>${icon("edit")}${esc(t("edit_class"))}</button>
          <button type="button" class="mu-btn mu-btn-danger-outline" data-wf-action="delete-class" data-id="${esc(klass.id)}"${lock(isAdmin())}>${icon("delete")}${esc(t("delete"))}</button>
        </div>
      </article>`;
    }).join("");
    return hero("school", "classes_title", "classes_desc") + roleNotice() + `
      ${cards ? `<div class="wf-toolbar"><button type="button" class="mu-btn mu-btn-primary" data-wf-action="add-class"${lock(isAdmin())}>${icon("add")}${esc(t("add_class"))}</button></div>` : ""}
      ${cards ? `<div class="wf-grid">${cards}</div>` : empty("school", isAdmin() ? t("no_classes_page") : t("no_classes_teacher"), isAdmin() ? `<button type="button" class="mu-btn mu-btn-primary" data-wf-action="add-class">${icon("add")}${esc(t("add_class"))}</button>` : "")}`;
  }

  function openClassForm(classId) {
    if (!guard(isAdmin())) return;
    const klass = classId ? findClass(classId) : null;
    const teachers = ws.collaborators.filter(person => person.role === "teacher");
    openForm({
      title: t(klass ? "edit_class" : "add_class"),
      icon: "school",
      submit: t(klass ? "save" : "add_class"),
      fields: [
        { name: "name", type: "text", label: t("class_name"), value: klass ? klass.name : "", required: true, placeholder: t("class_name_placeholder") },
        { name: "teachers", type: "multicheck", label: t("assigned_teachers"), value: klass ? teachers.filter(person => person.classIds.includes(klass.id)).map(person => person.id) : [], options: teachers.map(person => ({ value: person.id, label: personName(person) })), emptyText: t("no_teachers_yet") },
      ],
      async onSubmit(values) {
        const name = values.name.trim();
        if (!name) return { field: "name", message: t("required") };
        const workspace = ws;
        const before = JSON.parse(JSON.stringify(workspace.policy));
        let target = klass;
        if (target) target.name = name;
        else {
          target = { id: Engine.createId("class"), name, allowlistOnly: false, rules: [], blockedText: [], blockedCategories: [], globalExceptions: { rules: [], categories: [], text: [] }, userCss: Engine.emptyUserCss("inherit"), styles: [] };
          ws.policy.classes.push(target);
        }
        if (!await pushPolicy({ classId: target.id, teacherIds: values.teachers })) {
          if (ws === workspace) ws.policy = before;
          return { message: server.message || t("server_offline_title") };
        }
        renderChrome();
        renderPage();
        toast(t(klass ? "toast_class_saved" : "toast_class_added"), "success");
        return null;
      },
    });
  }

  function deleteClass(classId) {
    if (!guard(isAdmin())) return;
    const klass = findClass(classId);
    if (!klass) return;
    confirmAction({
      title: t("delete_class"),
      body: t("delete_class_confirm", { name: klass.name }),
      submit: t("delete"),
      onConfirm() {
        ws.policy.classes = ws.policy.classes.filter(item => item.id !== classId);
        saveWorkspace();
        renderPage();
        toast(t("toast_class_deleted"), "success");
      },
    });
  }

  /* ========================================================== UserCSS page */

  // The UserCSS editor lives in the extension (students and teachers write their own
  // UserCSS there and choose when to inject it). The dashboard only sets where it may run.
  const cssView = { scopeId: "global" };

  function cssScope() {
    if (cssView.scopeId !== "global" && !visibleClasses().some(klass => klass.id === cssView.scopeId)) cssView.scopeId = "global";
    return cssView.scopeId;
  }

  function listCard(scopeId, list) {
    const scope = scopeData(scopeId);
    const editable = canEditScope(scopeId);
    const reason = scopeId === "global" ? "locked_global" : "locked_class";
    const meta = {
      allowed: ["check_circle", "list_allowed", "list_allowed_desc"],
      partial: ["contrast", "list_partial", "list_partial_desc"],
      blocked: ["do_not_disturb_on", "list_blocked", "list_blocked_desc"],
    }[list];
    return `<section class="wf-policy-list" aria-labelledby="wfList-${list}">
      <div class="wf-policy-head"><span class="mu-icon-circle" aria-hidden="true">${icon(meta[0])}</span><div><h3 class="mu-h-title" id="wfList-${list}">${esc(t(meta[1]))}</h3><p class="mu-muted">${esc(t(meta[2]))}</p></div></div>
      <form class="wf-inline-form" data-wf-form="add-list-entry" data-scope="${esc(scopeId)}" data-list="${list}">
        <label class="mu-field wf-grow"><span class="wf-visually-hidden">${esc(t("add_url_to", { list: t(meta[1]) }))}</span><input class="mu-input" name="pattern" dir="ltr" autocomplete="off" placeholder="example.org" required${editable ? "" : " disabled"}></label>
        <button type="submit" class="mu-icon-btn mu-icon-btn-primary" aria-label="${esc(t("add"))}"${editable ? ` data-tooltip="${esc(t("add"))}"` : lock(false, reason)}>${icon("add")}</button>
      </form>
      <div class="mu-tags">${scope.userCss[list].length ? scope.userCss[list].map(pattern => `<span class="mu-tag" dir="ltr">${esc(pattern)}<button type="button" data-wf-action="remove-list-entry" data-scope="${esc(scopeId)}" data-list="${list}" data-value="${esc(pattern)}" aria-label="${esc(t("remove_item", { item: pattern }))}"${lock(editable, reason)}>${icon("close")}</button></span>`).join("") : `<span class="mu-muted">${esc(t("list_empty"))}</span>`}</div>
    </section>`;
  }

  function renderImportUrls() {
    if (!isAdmin()) return "";
    const urls = ws.policy.global.userCss.importUrls || [];
    const entries = urls.map(url => `<span class="mu-tag" dir="ltr">${esc(url)}<button type="button" data-wf-action="remove-import-url" data-value="${esc(url)}" aria-label="${esc(t("remove_item", { item: url }))}">${icon("close")}</button></span>`).join("");
    return `<section class="mu-glass mu-panel wf-card" aria-labelledby="wfCssImportTitle">
      <div class="wf-policy-head"><span class="mu-icon-circle" aria-hidden="true">${icon("link")}</span><div><h2 class="mu-h-title" id="wfCssImportTitle">${esc(t("usercss_import_title"))}</h2><p class="mu-muted">${esc(t("usercss_import_desc"))}</p></div></div>
      <form class="wf-inline-form" data-wf-form="add-import-url">
        <label class="mu-field wf-grow"><span class="wf-visually-hidden">${esc(t("usercss_import_add"))}</span><input class="mu-input" name="url" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://example.org/theme.css" required></label>
        <button type="submit" class="mu-btn mu-btn-primary">${icon("add")}${esc(t("usercss_import_add"))}</button>
      </form>
      <div class="mu-tags">${entries || `<span class="mu-muted">${esc(t("list_empty"))}</span>`}</div>
    </section>`;
  }

  function renderUserCssPage() {
    const scopeId = cssScope();
    const scope = scopeData(scopeId);
    const editable = canEditScope(scopeId);
    const reason = scopeId === "global" ? "locked_global" : "locked_class";
    const defaultOptions = (scopeId === "global" ? [] : ["inherit"]).concat(["allowed", "partial", "blocked"]);
    const inheritedLists = scopeId !== "global" ? `<details class="mu-accordion wf-inherited">
        <summary>${icon("lock")} ${esc(t("inherited_lists"))}</summary>
        <div class="mu-accordion-body">${["allowed", "partial", "blocked"].map(list => `<div class="mu-section-label">${esc(t("list_" + list))}</div><div class="mu-tags">${ws.policy.global.userCss[list].map(item => `<span class="mu-tag" dir="ltr">${esc(item)}</span>`).join("") || `<span class="mu-muted">${esc(t("list_empty"))}</span>`}</div>`).join("")}
        <p class="mu-muted">${esc(t("inherited_lists_desc", { mode: t("mode_" + ws.policy.global.userCss.defaultMode) }))}</p></div>
      </details>` : "";

    return hero("format_paint", "usercss_title", "usercss_desc") + roleNotice() + `
      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfCssHowTitle">
        <div class="wf-policy-head"><span class="mu-icon-circle" aria-hidden="true">${icon("extension")}</span><div><h2 class="mu-h-title" id="wfCssHowTitle">${esc(t("usercss_how_title"))}</h2><p class="mu-muted">${esc(t("usercss_how_body"))}</p></div></div>
        <ol class="wf-steps"><li>${esc(t("usercss_how_1"))}</li><li>${esc(t("usercss_how_2"))}</li><li>${esc(t("usercss_how_3"))}</li></ol>
      </section>

      <section class="mu-glass mu-panel wf-card">
        <div class="wf-card-head">
          <div><h2 class="mu-h-title">${esc(t("url_policies"))}</h2><p class="mu-muted">${esc(t("url_policies_desc"))}</p></div>
          <label class="mu-field"><span class="mu-field-label">${esc(t("scope"))}</span><select class="mu-select" id="wfCssScope">${classOptions(scopeId, true)}</select></label>
          ${editable ? "" : `<span class="mu-badge">${icon("lock")}${esc(t("read_only"))}</span>`}
        </div>
        <div class="mu-row">
          <div class="mu-row-info"><span class="mu-row-title">${esc(t("unlisted_urls"))}</span><span class="mu-row-subtitle">${esc(t("unlisted_urls_desc"))}</span></div>
          <div class="wf-select-wrap"${lock(editable, reason)}><select class="mu-select" id="wfDefaultMode" aria-label="${esc(t("unlisted_urls"))}"${editable ? "" : " disabled"}>${defaultOptions.map(mode => `<option value="${mode}"${scope.userCss.defaultMode === mode ? " selected" : ""}>${esc(t(mode === "inherit" ? "mode_inherit" : "mode_" + mode))}</option>`).join("")}</select></div>
        </div>
        <div class="wf-policy-grid">${listCard(scopeId, "allowed")}${listCard(scopeId, "partial")}${listCard(scopeId, "blocked")}</div>
        ${inheritedLists}
      </section>

      ${renderImportUrls()}
      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfCssCheckTitle">
        <h2 class="mu-h-title" id="wfCssCheckTitle">${esc(t("usercss_check_title"))}</h2>
        <form class="wf-inline-form" data-wf-form="check-usercss">
          <label class="mu-field wf-grow"><span class="mu-field-label">${esc(t("tester_url"))}</span><input class="mu-input" name="url" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://example.org" required></label>
          <button type="submit" class="mu-btn mu-btn-primary">${icon("travel_explore")}${esc(t("tester_check"))}</button>
        </form>
        <div id="wfCssCheckResult" aria-live="polite"></div>
      </section>`;
  }

  const MODE_ICONS = { allowed: "check_circle", partial: "contrast", blocked: "do_not_disturb_on", restricted: "block" };

  function renderCssCheck(url) {
    const out = $("#wfCssCheckResult");
    const parsed = Engine.parseUrl(url);
    if (!out) return;
    if (!parsed || !/^https?:$/.test(parsed.protocol)) { out.innerHTML = `<p class="mu-inline-error">${icon("error")}<span>${esc(t("invalid_url"))}</span></p>`; return; }
    const scopeId = cssScope();
    const resolved = Engine.resolveUserCssMode(parsed.href, ws.policy, { classId: scopeId === "global" ? "" : scopeId, blockPageUrl: BLOCK_PAGE });
    const alertClass = { allowed: "is-success", partial: "is-warning", blocked: "is-danger", restricted: "is-danger" }[resolved.mode];
    out.innerHTML = `<div class="mu-alert ${alertClass}" role="status">${icon(MODE_ICONS[resolved.mode])}<div class="mu-alert-body"><span class="mu-alert-title">${esc(t("mode_" + resolved.mode))}</span><span class="mu-muted">${esc(t("mode_" + resolved.mode + "_desc"))}</span></div></div>`;
  }

  /* ========================================================== devices page */

  // A real name for every device, never a random ID: the name set in the dashboard, the name the
  // device reports (asset ID / hostname on managed Chromebooks), else "Chromebook · student".
  const PLATFORM_KEYS = { cros: "platform_cros", win: "platform_win", mac: "platform_mac", linux: "platform_linux", android: "platform_android" };
  function deviceLabel(device) {
    if (device.name && device.name !== device.id) return device.name;
    const kind = t(PLATFORM_KEYS[device.platform] || "platform_other");
    return device.user ? kind + " · " + device.user : kind;
  }

  // Admins can manage every device. A Teacher can add an unassigned device to one of their
  // classes and change devices they set themselves, but never one another Teacher already set.
  function canManageDevice(device) {
    if (isAdmin()) return true;
    if (actor().role !== "teacher") return false;
    if (!device.classId) return true;
    return actor().classIds.includes(device.classId) && (!device.assignedBy || device.assignedBy === actor().id);
  }
  function visibleDevices() {
    if (isAdmin()) return devices.list;
    return devices.list.filter(device => !device.classId || actor().classIds.includes(device.classId));
  }

  function renderDevicesPage() {
    const connected = server.status === "online";
    const list = visibleDevices();
    let body;
    if (!connected) {
      body = `<div class="mu-alert is-warning" role="status">${icon("cloud_off")}<div class="mu-alert-body"><span class="mu-alert-title">${esc(t("server_offline_title"))}</span><span class="mu-muted">${esc(t("server_offline_body"))}</span></div><button type="button" class="mu-btn" data-wf-action="reconnect">${icon("refresh")}${esc(t("reconnect"))}</button></div>`;
    } else if (devices.loading && !devices.list.length) {
      body = `<div class="mu-skeleton wf-skeleton"></div>`;
    } else if (!list.length) {
      body = isAdmin()
        ? empty("devices", t("no_devices"), `<button type="button" class="mu-btn mu-btn-primary" data-wf-action="open-extension">${icon("extension")}${esc(t("deploy_extension"))}</button>`)
        : empty("devices", t("no_devices_teacher"));
    } else {
      body = `<p class="mu-muted wf-table-note" id="wfDevicesCaption">${esc(t("devices_caption", { time: formatDate(devices.fetchedAt) }))}</p>
        <div class="wf-device-grid">${list.map(deviceCard).join("")}</div>`;
    }
    return hero("devices", "devices_title", "devices_desc") + roleNotice() + `
      <div class="wf-toolbar"><button type="button" class="mu-btn" data-wf-action="refresh-devices"${connected ? "" : " disabled"}>${icon("refresh")}${esc(t("refresh"))}</button></div>
      ${devices.error ? `<div class="mu-alert is-danger" role="alert">${icon("error")}<div class="mu-alert-body"><span class="mu-alert-title">${esc(t("devices_error"))}</span><span class="mu-muted">${esc(devices.error)}</span></div></div>` : ""}
      ${body}`;
  }

  function favicon(url) {
    let host = "";
    try { host = new URL(url).hostname; } catch (error) { host = ""; }
    return host ? `<img class="wf-favicon" src="/api/favicon?domain=${encodeURIComponent(host)}" width="24" height="24" alt="" loading="lazy" data-wf-favicon>` : `<span class="mu-icon wf-favicon" aria-hidden="true">tab</span>`;
  }

  function deviceCard(device) {
    const allowed = canActOnDevice(device);
    const manage = canManageDevice(device);
    const klass = findClass(device.classId);
    const pendingCommands = (device.commands || []).filter(command => command.status === "queued" || command.status === "delivered");
    const pending = pendingCommands.length;
    const canUnlock = device.locked || pendingCommands.some(command => command.type === "lock" || command.type === "unlock")
      || [device.activeUrl, ...(device.tabs || []).map(tab => tab.url)].some(url => isDeviceLockPage(url));
    const button = (action, iconName, labelKey) => `<button type="button" class="mu-icon-btn mu-icon-btn-soft" data-wf-action="${action}" data-id="${esc(device.id)}" aria-label="${esc(t(labelKey))}"${allowed ? ` data-tooltip="${esc(t(labelKey))}"` : lock(false, "locked_device")}>${icon(iconName)}</button>`;
    const temp = (device.tempBlocks || []).filter(block => !block.until || block.until > Date.now());
    const lockReason = device.classId && device.assignedBy && device.assignedBy !== actor().id ? "locked_device_other" : "locked_device";
    return `<article class="mu-glass mu-panel wf-device-card">
      <button type="button" class="wf-device-screen" data-wf-action="device-view" data-id="${esc(device.id)}" aria-label="${esc(t("view_device", { device: deviceLabel(device) }))}">
        ${device.hasScreen ? `<img alt="" data-wf-screen="${esc(device.id)}">` : `<span class="mu-icon" aria-hidden="true">desktop_windows</span>`}
      </button>
      <div class="wf-device-info">
        <div class="mu-row-info"><span class="mu-row-title">${esc(deviceLabel(device))}</span><span class="mu-row-subtitle">${esc([device.user, device.location, t("last_seen", { time: formatDate(device.lastSeen) })].filter(Boolean).join(" · "))}</span></div>
        <div class="wf-status-cell">
          <span class="mu-badge ${device.online ? "mu-badge-success" : ""}">${icon(device.online ? "wifi" : "wifi_off")}${esc(t(device.online ? "online" : "offline"))}</span>
          <span class="mu-badge">${icon("school")}${esc(klass ? klass.name : device.classId ? t("unknown_class") : t("no_class"))}</span>
          ${device.locked ? `<span class="mu-badge mu-badge-danger">${icon("lock")}${esc(t("locked"))}</span>` : ""}
          ${pending ? `<span class="mu-badge mu-badge-warning">${icon("schedule_send")}${esc(t("pending_count", { count: pending }))}</span>` : ""}
          ${temp.map(block => `<span class="mu-badge mu-badge-warning" dir="ltr">${icon("timer")}${esc(block.pattern)}</span>`).join("")}
        </div>
        <p class="wf-device-url">${device.activeUrl ? favicon(device.activeUrl) : ""}<span dir="ltr">${esc(device.activeTitle || device.activeUrl || "—")}</span></p>
        <div class="wf-device-actions">
          <button type="button" class="mu-btn" data-wf-action="device-assign" data-id="${esc(device.id)}"${lock(manage && !device.managedClassId, device.managedClassId ? "locked_managed_class" : lockReason)}>${icon("group_add")}${esc(t(device.classId ? "change_class" : "add_to_class"))}</button>
          <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-wf-action="device-rename" data-id="${esc(device.id)}" aria-label="${esc(t("rename_device"))}"${manage ? ` data-tooltip="${esc(t("rename_device"))}"` : lock(false, lockReason)}>${icon("edit")}</button>
          ${button("device-view", "visibility", "view_screen_tabs")}
          ${canUnlock ? button("device-unlock", "lock_open", "unlock_screen") : button("device-lock", "lock", "lock_screen")}
          ${button("device-notice", "campaign", "push_notice")}
          ${button("device-sync", "sync", "force_sync")}
          ${button("device-temp-block", "timer", "temp_block")}
          ${temp.length ? button("device-clear-temp", "timer_off", "clear_temp_blocks") : ""}
          ${button("device-history", "history", "command_history")}
          <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-danger data-wf-action="device-remove" data-id="${esc(device.id)}" aria-label="${esc(t("remove_device"))}"${isAdmin() ? ` data-tooltip="${esc(t("remove_device"))}"` : lock(false)}>${icon("delete")}</button>
        </div>
      </div>
    </article>`;
  }

  function isDeviceLockPage(url) {
    if (!Engine.isBlockPage(url, BLOCK_PAGE)) return false;
    return new URL(url).searchParams.get("mode") === "lock";
  }

  // Screens need the admin key, so they're fetched as blobs (an <img src> can't send it).
  const screenCache = new Map();
  function loadScreens(root = document) {
    const { orgId } = ws.server;
    return Promise.all(Array.from(root.querySelectorAll("img[data-wf-screen]"), async img => {
      const id = img.dataset.wfScreen;
      const device = devices.list.find(item => item.id === id);
      const key = orgId + "/" + id;
      const cached = screenCache.get(key);
      const preview = img.closest("#wfForm");
      const placeholder = preview?.querySelector("[data-wf-screen-empty]");
      const status = preview?.querySelector("[data-wf-screen-status]");
      if (!device?.hasScreen) {
        if (cached) {
          URL.revokeObjectURL(cached.url);
          screenCache.delete(key);
        }
        img.removeAttribute("src");
        img.hidden = true;
        if (placeholder) placeholder.hidden = false;
        if (status) status.textContent = t("screen_waiting");
        return;
      }
      const showFrame = url => {
        if (img.getAttribute("src") !== url) img.src = url;
        img.hidden = false;
        if (placeholder) placeholder.hidden = true;
        if (status) status.textContent = t("screen_updated", { time: formatDate(device.screenAt) });
      };
      if (cached?.at === device.screenAt) { showFrame(cached.url); return; }
      try {
        const response = await fetch(API + "/orgs/" + encodeURIComponent(orgId) + "/devices/" + encodeURIComponent(id) + "/screen", {
          cache: "no-store", credentials: "same-origin",
        });
        if (!response.ok) return;
        const blob = await response.blob();
        const latest = devices.list.find(item => item.id === id);
        if (!img.isConnected || ws.server.orgId !== orgId || !latest?.hasScreen || latest.screenAt !== device.screenAt) return;
        const current = screenCache.get(key);
        if (current?.at === device.screenAt) { showFrame(current.url); return; }
        const url = URL.createObjectURL(blob);
        screenCache.set(key, { at: device.screenAt, url });
        showFrame(url);
        if (current) URL.revokeObjectURL(current.url);
      } catch (error) { /* retry on the next refresh */ }
    }));
  }

  function wireFavicons(root = document) {
    root.querySelectorAll("img[data-wf-favicon]").forEach(img => {
      img.addEventListener("error", () => {
        const fallback = document.createElement("span");
        fallback.className = "mu-icon wf-favicon";
        fallback.setAttribute("aria-hidden", "true");
        fallback.textContent = "public";
        img.replaceWith(fallback);
      }, { once: true });
    });
  }

  function remoteTabTitle(tab, device) {
    const title = tab.title || tab.url;
    if (!device.classId || device.locked || !findClass(device.classId)) return title;
    const decision = Engine.evaluateAccess(tab.url, ws.policy, { classId: device.classId, tempBlocks: device.tempBlocks, blockPageUrl: BLOCK_PAGE });
    if (decision.reason !== "allow-rule" || decision.scope !== device.classId) return title;
    const rule = decision.rule;
    const role = rule.updatedByRole || rule.createdByRole || ws.collaborators.find(member => member.id === rule.createdBy)?.role;
    if (role !== "teacher" || !Engine.evaluateAccess(tab.url, ws.policy, { blockPageUrl: BLOCK_PAGE }).blocked) return title;
    return `${title} [${t("remote_tab_teacher_allowed")}]`;
  }

  const remoteTabsMarkup = new WeakMap();
  function updateRemoteTabs(list, device) {
    const allowed = canActOnDevice(device);
    const tabs = device.tabs || [];
    const markup = tabs.length ? tabs.map(tab => {
      const title = esc(remoteTabTitle(tab, device));
      return `<div class="mu-row wf-tab-row">
        ${favicon(tab.url)}
        <div class="mu-row-info"><span class="mu-row-title">${title}</span><span class="mu-row-subtitle" dir="ltr">${esc(tab.url)}</span></div>
        ${tab.active ? `<span class="mu-badge mu-badge-success">${esc(t("active_tab"))}</span>` : ""}
        <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-wf-action="device-close-tab-id" data-id="${esc(device.id)}" data-tab="${esc(String(tab.id))}" aria-label="${esc(t("close_tab_named", { tab: tab.title || tab.url }))}"${allowed ? ` data-tooltip="${esc(t("close_tab"))}"` : lock(false, "locked_device")}>${icon("close")}</button>
      </div>`;
    }).join("") : `<p class="mu-muted">${esc(t("no_tabs"))}</p>`;
    if (remoteTabsMarkup.get(list) === markup) return;
    const focusedTab = list.contains(document.activeElement) ? document.activeElement.dataset.tab : null;
    remoteTabsMarkup.set(list, markup);
    list.innerHTML = markup;
    wireFavicons(list);
    if (focusedTab != null) [...list.querySelectorAll("[data-tab]")].find(button => button.dataset.tab === focusedTab)?.focus({ preventScroll: true });
  }

  function openDeviceView(device) {
    const allowed = canActOnDevice(device);
    openForm({
      title: deviceLabel(device), icon: "desktop_windows", submit: t("close"), cancel: false, wide: true,
      html: `<div class="wf-view-screen">
          <img alt="${esc(t("screen_of", { device: deviceLabel(device) }))}" data-wf-screen="${esc(device.id)}" hidden>
          <div class="mu-empty" data-wf-screen-empty><span class="mu-icon-circle">${icon("desktop_access_disabled")}</span><span>${esc(t("no_screen"))}</span></div>
        </div>
        <p class="mu-muted" data-wf-screen-status>${esc(t("screen_waiting"))}</p>
        <div class="wf-card-head"><h3 class="mu-h-title">${esc(t("open_tabs"))}</h3><button type="button" class="mu-btn" data-wf-action="device-open-tab" data-id="${esc(device.id)}"${lock(allowed, "locked_device")}>${icon("open_in_new")}${esc(t("open_tab"))}</button></div>
        <div class="wf-list" data-wf-device-tabs="${esc(device.id)}"></div>`,
      onSubmit: () => null,
    });
    const form = $("#wfForm");
    form.querySelector("[data-mu-close]").focus({ preventScroll: true });
    form.scrollTop = 0;
    updateRemoteTabs($("[data-wf-device-tabs]", form), device);
    loadScreens(form);
  }

  async function saveDevice(device, changes, toastKey) {
    try {
      const result = await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/devices/" + encodeURIComponent(device.id), {
        method: "PUT",
        json: { ...changes, assignmentVersion: device.assignmentVersion || 0 },
      });
      devices.list = devices.list.map(item => item.id === device.id ? result.device : item);
      if (route.page === "devices" || route.page === "classes") renderPage();
      toast(t(toastKey, { device: deviceLabel(result.device) }), "success");
      return null;
    } catch (error) {
      const key = { deviceAssignmentChanged: "device_assignment_changed", deviceAssignmentForbidden: "locked_device_other", deviceManagedClass: "locked_managed_class", invalidDeviceClass: "device_class_unavailable" }[error.message];
      return { message: key ? t(key) : t("toast_command_failed", { error: error.message }) };
    }
  }

  function openAssignForm(device) {
    if (!guard(!device.managedClassId, "locked_managed_class")) return;
    if (!guard(canManageDevice(device), device.assignedBy && device.assignedBy !== actor().id ? "locked_device_other" : "locked_device")) return;
    const options = (isAdmin() ? ws.policy.classes : ws.policy.classes.filter(klass => actor().classIds.includes(klass.id))).map(klass => ({ value: klass.id, label: klass.name }));
    if (!options.length) { toast(t(isAdmin() ? "no_classes_admin" : "no_classes_teacher"), "warning"); return; }
    openForm({
      title: t("add_device_to_class", { device: deviceLabel(device) }), icon: "group_add", submit: t("save"),
      description: t("add_device_to_class_desc"),
      fields: [{ name: "classId", type: "radio", label: t("class"), value: device.classId && options.some(option => option.value === device.classId) ? device.classId : options[0].value, options: (isAdmin() ? [{ value: "", label: t("no_class") }] : []).concat(options) }],
      onSubmit: values => saveDevice(device, { classId: values.classId }, "toast_device_assigned"),
    });
  }

  function openRenameForm(device) {
    if (!guard(canManageDevice(device), device.assignedBy && device.assignedBy !== actor().id ? "locked_device_other" : "locked_device")) return;
    openForm({
      title: t("rename_device"), icon: "edit", submit: t("save"),
      fields: [{ name: "name", type: "text", label: t("ext_device_name"), value: device.name === device.id ? "" : device.name || "", placeholder: t("device_name_placeholder") }],
      onSubmit: values => saveDevice(device, { name: values.name.trim() }, "toast_device_renamed"),
    });
  }

  function deviceAction(action, deviceId, target) {
    const device = devices.list.find(item => item.id === deviceId);
    if (!device) return;
    if (action === "device-view") { openDeviceView(device); return; }
    if (action === "device-assign") { openAssignForm(device); return; }
    if (action === "device-rename") { openRenameForm(device); return; }
    if (action === "device-close-tab-id") {
      if (!guard(canActOnDevice(device), "locked_device")) return;
      sendCommand(device, "close_tab", { tabId: Number(target.dataset.tab) });
      return;
    }
    if (action === "device-remove") {
      if (!guard(isAdmin())) return;
      confirmAction({
        title: t("remove_device"),
        body: t("remove_device_confirm", { device: deviceLabel(device) }),
        submit: t("remove"),
        async onConfirm() {
          try {
            await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/devices/" + encodeURIComponent(device.id), { method: "DELETE" });
            devices.list = devices.list.filter(item => item.id !== device.id);
            renderPage();
            toast(t("toast_device_removed"), "success");
          } catch (error) {
            toast(t("toast_command_failed", { error: error.message }), "error");
          }
        },
      });
      return;
    }
    if (action === "device-history") { openHistory(device); return; }
    if (!guard(canActOnDevice(device), "locked_device")) return;
    if (action === "device-sync") { sendCommand(device, "sync"); return; }
    if (action === "device-unlock") { sendCommand(device, "unlock"); return; }
    if (action === "device-clear-temp") { sendCommand(device, "clear_temp_blocks"); return; }
    if (action === "device-lock") {
      openForm({
        title: t("lock_screen_on", { device: deviceLabel(device) }), icon: "lock", submit: t("lock_screen"),
        fields: [{ name: "message", type: "textarea", label: t("lock_message"), value: "", placeholder: t("lock_message_placeholder") }],
        onSubmit: values => { sendCommand(device, "lock", { message: values.message.trim() }); return null; },
      });
    } else if (action === "device-notice") {
      openForm({
        title: t("push_notice_to", { device: deviceLabel(device) }), icon: "campaign", submit: t("push_notice"),
        fields: [{ name: "message", type: "textarea", label: t("notice_message"), value: "", required: true }],
        onSubmit: values => { if (!values.message.trim()) return { field: "message", message: t("required") }; sendCommand(device, "notice", { message: values.message.trim() }); return null; },
      });
    } else if (action === "device-open-tab") {
      openForm({
        title: t("open_tab_on", { device: deviceLabel(device) }), icon: "open_in_new", submit: t("open_tab"),
        fields: [{ name: "url", type: "text", label: t("tab_url"), value: "https://", required: true, dir: "ltr" }],
        onSubmit: values => {
          const parsed = Engine.parseUrl(values.url);
          if (!parsed || !/^https?:$/.test(parsed.protocol)) return { field: "url", message: t("invalid_url") };
          sendCommand(device, "open_tab", { url: parsed.href });
          return null;
        },
      });
    } else if (action === "device-close-tab") {
      const tabs = device.tabs || [];
      if (!tabs.length) { toast(t("no_tabs"), "warning"); return; }
      openForm({
        title: t("close_tab_on", { device: deviceLabel(device) }), icon: "tab_close", submit: t("close_tab"),
        fields: [{ name: "tabId", type: "radio", label: t("open_tabs"), value: String((tabs.find(tab => tab.active) || tabs[0]).id), options: tabs.map(tab => ({ value: String(tab.id), label: (tab.title || tab.url) + (tab.active ? " · " + t("active_tab") : ""), sub: tab.url })) }],
        onSubmit: values => { sendCommand(device, "close_tab", { tabId: Number(values.tabId) }); return null; },
      });
    } else if (action === "device-temp-block") {
      let host = "";
      try { host = device.activeUrl ? new URL(device.activeUrl).hostname : ""; } catch (error) { host = ""; }
      openForm({
        title: t("temp_block_on", { device: deviceLabel(device) }), icon: "timer", submit: t("temp_block"),
        fields: [
          { name: "pattern", type: "text", label: t("rule_pattern"), value: host, required: true, dir: "ltr", help: t("rule_pattern_help") },
          { name: "minutes", type: "number", label: t("minutes"), value: "30", required: true, min: 1 },
        ],
        onSubmit: values => {
          const pattern = Engine.normalizePattern(values.pattern);
          const minutes = Number(values.minutes);
          if (!pattern) return { field: "pattern", message: t("invalid_pattern") };
          if (!Number.isFinite(minutes) || minutes <= 0) return { field: "minutes", message: t("invalid_minutes") };
          sendCommand(device, "temp_block", { pattern: pattern.value, minutes });
          return null;
        },
      });
    }
  }

  function openHistory(device) {
    const statusKey = { queued: "cmd_queued", delivered: "cmd_delivered", done: "cmd_done", failed: "cmd_failed" };
    const commands = device.commands || [];
    openForm({
      title: t("command_history_for", { device: deviceLabel(device) }), icon: "history", submit: t("close"), cancel: false,
      html: commands.length ? `<div class="wf-list">${commands.map(command => `<div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("cmd_" + command.type))}</span><span class="mu-row-subtitle">${esc(formatDate(command.createdAt))}${command.payload && (command.payload.message || command.payload.url || command.payload.pattern) ? " · " + esc(command.payload.message || command.payload.url || command.payload.pattern) : ""}${command.error ? " · " + esc(command.error) : ""}</span></div><span class="mu-badge ${command.status === "done" ? "mu-badge-success" : command.status === "failed" ? "mu-badge-danger" : "mu-badge-warning"}">${esc(t(statusKey[command.status]))}</span></div>`).join("")}</div>` : empty("history", t("no_commands")),
      onSubmit: () => null,
    });
  }


  /* ======================================================= requests page */

  const requests = { list: [], error: "", fetchedAt: 0 };

  async function refreshRequests() {
    if (!ws.server.orgId || server.status !== "online") return;
    try {
      const result = await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/requests");
      requests.list = result.requests || [];
      requests.error = "";
      requests.fetchedAt = Date.now();
    } catch (error) {
      requests.error = error.message;
    }
    renderSidebar();
    if (route.page === "requests" && document.querySelector("#wfFormModal[hidden]")) renderPage();
  }

  // Teachers see requests from devices in their classes (and from unassigned devices).
  function visibleRequests() {
    if (isAdmin()) return requests.list;
    return requests.list.filter(item => !item.classId || actor().classIds.includes(item.classId));
  }
  const pendingRequests = () => visibleRequests().filter(item => item.status === "pending");

  function requestRow(item) {
    const klass = findClass(item.classId);
    const device = devices.list.find(entry => entry.id === item.deviceId);
    let host = item.url;
    try { host = new URL(item.url).hostname.replace(/^www\./, ""); } catch (error) { /* keep */ }
    const canClass = klass && canEditClass(klass.id);
    const actions = item.status === "pending" ? `<div class="wf-device-actions">
        ${klass ? `<button type="button" class="mu-btn mu-btn-primary" data-wf-action="request-approve" data-id="${esc(item.id)}" data-scope="${esc(klass.id)}"${lock(canClass, "locked_class")}>${icon("check")}${esc(t("allow_for", { scope: klass.name }))}</button>` : ""}
        ${isAdmin() ? `<button type="button" class="mu-btn${klass ? "" : " mu-btn-primary"}" data-wf-action="request-approve" data-id="${esc(item.id)}" data-scope="global">${icon("public")}${esc(t("allow_for_everyone"))}</button>` : ""}
        <button type="button" class="mu-btn mu-btn-danger-outline" data-wf-action="request-deny" data-id="${esc(item.id)}"${lock(isAdmin() || canClass || !item.classId, "locked_class")}>${icon("close")}${esc(t("deny"))}</button>
      </div>` : `<span class="mu-badge ${item.status === "approved" ? "mu-badge-success" : "mu-badge-danger"}">${esc(t("request_" + item.status))}</span>`;
    return `<div class="mu-row wf-request">
      ${favicon(item.url)}
      <div class="mu-row-info">
        <span class="mu-row-title" dir="ltr">${esc(host)}</span>
        <span class="mu-row-subtitle">${esc([item.user || (device ? deviceLabel(device) : ""), klass ? klass.name : "", formatDate(item.createdAt)].filter(Boolean).join(" · "))}</span>
        ${item.reason ? `<span class="wf-request-reason">“${esc(item.reason)}”</span>` : ""}
      </div>
      ${actions}
    </div>`;
  }

  function renderRequestsPage() {
    const connected = server.status === "online";
    const list = visibleRequests();
    const pending = list.filter(item => item.status === "pending");
    const done = list.filter(item => item.status !== "pending");
    return hero("mark_email_unread", "requests_title", "requests_desc") + roleNotice() + (connected ? `
      <section class="mu-glass mu-panel wf-card" aria-labelledby="wfPendingTitle">
        <div class="wf-card-head"><div><h2 class="mu-h-title" id="wfPendingTitle">${esc(t("requests_pending", { count: pending.length }))}</h2></div>
          <button type="button" class="mu-btn" data-wf-action="refresh-requests">${icon("refresh")}${esc(t("refresh"))}</button></div>
        <div class="wf-list">${pending.length ? pending.map(requestRow).join("") : empty("inbox", t("no_requests"))}</div>
      </section>
      ${done.length ? `<section class="mu-glass mu-panel wf-card" aria-labelledby="wfDoneTitle"><h2 class="mu-h-title" id="wfDoneTitle">${esc(t("requests_answered"))}</h2><div class="wf-list">${done.map(requestRow).join("")}</div></section>` : ""}`
      : `<div class="mu-alert is-warning" role="status">${icon("cloud_off")}<div class="mu-alert-body"><span class="mu-alert-title">${esc(t("server_offline_title"))}</span><span class="mu-muted">${esc(t("server_offline_body"))}</span></div><button type="button" class="mu-btn" data-wf-action="reconnect">${icon("refresh")}${esc(t("reconnect"))}</button></div>`);
  }

  async function answerRequest(id, status, scopeId) {
    const item = requests.list.find(entry => entry.id === id);
    if (!item || item.status !== "pending" || item.saving) return;
    if (status === "approved" && !guard(scopeId === "global" ? isAdmin() : scopeId === item.classId && canEditClass(scopeId), scopeId === "global" ? "locked_admin_only" : "locked_class")) return;
    if (status === "denied" && !guard(!item.classId || canEditClass(item.classId), "locked_class")) return;
    item.saving = true;
    try {
      if (status === "approved") {
        const pattern = Engine.normalizePattern(item.url, "domain");
        const scope = scopeData(scopeId);
        if (!pattern || !scope) return;
        const classId = item.classId;
        if (Engine.evaluateAccess(item.url, ws.policy, { classId }).blocked) {
          const rule = { id: Engine.createId("rule"), action: "allow", type: "domain", value: pattern.value, note: t("from_request"), enabled: true, createdBy: actor().id, createdByRole: actor().role, createdAt: Date.now() };
          scope.rules.push(rule);
          if (Engine.evaluateAccess(item.url, ws.policy, { classId }).blocked) {
            scope.rules = scope.rules.filter(entry => entry !== rule);
            toast(t("request_conflicting_rule"), "warning");
            return;
          }
          if (!await pushPolicy()) {
            scope.rules = scope.rules.filter(entry => entry !== rule);
            saveWorkspace({ push: false });
            throw new Error(server.message || t("server_offline_title"));
          }
        }
      }
      await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/requests/" + encodeURIComponent(id), { method: "PUT", json: { status, resolvedBy: actor().id } });
      toast(t(status === "approved" ? "toast_request_approved" : "toast_request_denied"), status === "approved" ? "success" : "info");
    } catch (error) {
      toast(t("toast_command_failed", { error: error.message }), "error");
    } finally {
      item.saving = false;
      refreshRequests();
    }
  }

  /* ======================================================= bypass password */

  const bypass = { loaded: false, enabled: false, minutes: 30 };
  async function loadBypass() {
    if (!ws.server.orgId || server.status !== "online" || !isAdmin()) return;
    try {
      const result = await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/bypass");
      Object.assign(bypass, { loaded: true, enabled: result.enabled, minutes: result.minutes });
    } catch (error) { bypass.loaded = false; }
    if (route.page === "settings") renderPage();
  }

  function renderBypassCard() {
    if (!isAdmin()) return "";
    const online = server.status === "online";
    return `<section class="mu-glass mu-panel wf-card" aria-labelledby="wfBypassTitle">
      <div class="wf-policy-head"><span class="mu-icon-circle" aria-hidden="true">${icon("key")}</span><div><h2 class="mu-h-title" id="wfBypassTitle">${esc(t("bypass_title"))}</h2><p class="mu-muted">${esc(t("bypass_desc"))}</p></div></div>
      <div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(bypass.enabled ? t("bypass_on", { minutes: bypass.minutes }) : t("bypass_off"))}</span><span class="mu-row-subtitle">${esc(t("bypass_hint"))}</span></div>
        <div class="wf-actions">
          <button type="button" class="mu-btn mu-btn-primary" data-wf-action="bypass-set"${online ? "" : " disabled"}>${icon("key")}${esc(t(bypass.enabled ? "bypass_change" : "bypass_set"))}</button>
          ${bypass.enabled ? `<button type="button" class="mu-btn mu-btn-danger-outline" data-wf-action="bypass-remove">${icon("key_off")}${esc(t("bypass_remove"))}</button>` : ""}
        </div></div>
    </section>`;
  }

  function openBypassForm() {
    if (!guard(isAdmin())) return;
    openForm({
      title: t(bypass.enabled ? "bypass_change" : "bypass_set"), icon: "key", submit: t("save"),
      fields: [
        { name: "password", type: "password", label: t("bypass_password"), value: "", required: true, help: t("bypass_password_help") },
        { name: "confirm", type: "password", label: t("bypass_confirm"), value: "", required: true },
        { name: "minutes", type: "number", label: t("bypass_minutes"), value: String(bypass.minutes || 30), required: true, min: 1 },
      ],
      async onSubmit(values) {
        if (values.password.length < 6) return { field: "password", message: t("bypass_too_short") };
        if (values.password !== values.confirm) return { field: "confirm", message: t("bypass_mismatch") };
        const minutes = Number(values.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0) return { field: "minutes", message: t("invalid_minutes") };
        try {
          await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/bypass", { method: "PUT", json: { password: values.password, minutes } });
          Object.assign(bypass, { loaded: true, enabled: true, minutes });
          toast(t("toast_bypass_saved"), "success");
          renderPage();
          return null;
        } catch (error) {
          return { message: t("toast_command_failed", { error: error.message }) };
        }
      },
    });
  }

  /* ==================================================== collaborators page */

  function renderCollaboratorsPage() {
    const rows = ws.collaborators.map(person => `<tr>
      <td><div class="mu-row-info"><span class="mu-row-title">${esc(personName(person))}${person.id === actor().id ? ` <span class="mu-badge">${esc(t("you"))}</span>` : ""}</span><span class="mu-row-subtitle" dir="ltr">${esc(person.email || "")}</span></div></td>
      <td><span class="mu-badge${person.role === "admin" ? " mu-badge-success" : ""}">${icon(person.role === "admin" ? "admin_panel_settings" : "school")}${esc(t(person.role === "admin" ? "role_admin" : "role_teacher"))}</span>${person.owner ? ` <span class="mu-badge">${esc(t("owner"))}</span>` : ""}</td>
      <td>${person.role === "admin" ? esc(t("all_classes")) : person.classIds.map(id => findClass(id)).filter(Boolean).map(klass => `<span class="mu-tag">${esc(klass.name)}</span>`).join(" ") || `<span class="mu-muted">${esc(t("no_classes_assigned"))}</span>`}</td>
      <td><div class="wf-device-actions">
        <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-wf-action="edit-person" data-id="${esc(person.id)}" aria-label="${esc(t("edit_collaborator"))}"${isAdmin() ? ` data-tooltip="${esc(t("edit_collaborator"))}"` : lock(false)}>${icon("edit")}</button>
        <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-danger data-wf-action="remove-person" data-id="${esc(person.id)}" aria-label="${esc(t("remove_collaborator"))}"${isAdmin() && !person.owner ? ` data-tooltip="${esc(t("remove_collaborator"))}"` : lock(false, person.owner ? "locked_owner" : "locked_admin_only")}>${icon("person_remove")}</button>
      </div></td>
    </tr>`).join("");
    return hero("group", "collaborators_title", "collaborators_desc") + roleNotice() + `
      <div class="wf-toolbar"><button type="button" class="mu-btn mu-btn-primary" data-wf-action="add-person"${lock(isAdmin())}>${icon("person_add")}${esc(t("add_collaborator"))}</button></div>
      <div class="mu-table-wrap"><table class="mu-table"><thead><tr><th scope="col">${esc(t("name"))}</th><th scope="col">${esc(t("role"))}</th><th scope="col">${esc(t("classes"))}</th><th scope="col"><span class="wf-visually-hidden">${esc(t("actions"))}</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function openPersonForm(personId) {
    if (!guard(isAdmin())) return;
    const person = personId ? ws.collaborators.find(item => item.id === personId) : null;
    openForm({
      title: t(person ? "edit_collaborator" : "add_collaborator"),
      icon: "person_add",
      submit: t(person ? "save" : "add_collaborator"),
      fields: [
        { name: "name", type: "text", label: t("name"), value: person ? person.name : "", required: !person || !person.owner },
        ...(!person ? [{ name: "email", type: "email", label: t("email"), value: "", dir: "ltr", required: true, help: t("collaborator_account_hint") }] : []),
        { name: "role", type: "segmented", label: t("role"), value: person ? person.role : "teacher", options: [{ value: "teacher", label: t("role_teacher") }, { value: "admin", label: t("role_admin") }], disabled: person && person.owner },
        { name: "classIds", type: "multicheck", label: t("assigned_classes"), help: t("assigned_classes_help"), value: person ? person.classIds : [], options: ws.policy.classes.map(klass => ({ value: klass.id, label: klass.name })), emptyText: t("no_classes_admin") },
      ],
      async onSubmit(values) {
        const name = values.name.trim();
        const email = values.email?.trim();
        if (!name && !(person && person.owner)) return { field: "name", message: t("required") };
        if (!person && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { field: "email", message: t("invalid_email") };
        const role = person && person.owner ? "admin" : values.role;
        const route = "/orgs/" + encodeURIComponent(ws.server.orgId) + "/members";
        try {
          const result = await request(route + (person ? "/" + encodeURIComponent(person.id) : ""), {
            method: person ? "PUT" : "POST", json: { name, email, role, classIds: values.classIds },
          });
          ws.collaborators = result.members;
          ws.member = result.members.find(item => item.id === Account.state.account.id);
        } catch (error) {
          if (error.message === "memberAccountNotFound") return { field: "email", message: t("collaborator_account_not_found") };
          if (error.message === "duplicateMember") return { field: "email", message: t("duplicate_email") };
          return { message: t("toast_command_failed", { error: error.message }) };
        }
        saveWorkspace({ push: false });
        renderChrome();
        renderPage();
        toast(t(person ? "toast_collaborator_saved" : "toast_collaborator_added"), "success");
        return null;
      },
    });
  }

  function removePerson(personId) {
    const person = ws.collaborators.find(item => item.id === personId);
    if (!person) return;
    if (person.owner) { guard(false, "locked_owner"); return; }
    if (!guard(isAdmin())) return;
    confirmAction({
      title: t("remove_collaborator"),
      body: t("remove_collaborator_confirm", { name: personName(person) }),
      submit: t("remove"),
      async onConfirm() {
        try {
          const result = await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/members/" + encodeURIComponent(person.id), { method: "DELETE" });
          ws.collaborators = result.members;
          if (person.id === actor().id) { location.reload(); return; }
        } catch (error) {
          toast(t("toast_command_failed", { error: error.message }), "error");
          return;
        }
        saveWorkspace({ push: false });
        renderChrome();
        renderPage();
        toast(t("toast_collaborator_removed"), "success");
      },
    });
  }

  function renderComparisonPage() {
    const features = ["sites", "categories", "class_rules", "keywords", "safesearch", "restricted_mode", "video_rules", "screens", "tabs", "lock", "requests", "temporary", "usercss", "school_mode"];
    const products = [
      { name: "Munetios WebFilter", supported: features },
      { name: "GoGuardian", url: "https://www.goguardian.com/admin", supported: ["sites", "categories", "class_rules", "keywords", "video_rules", "screens", "tabs", "lock", "temporary"] },
      { name: "Securly", url: "https://www.securly.com/filter", supported: ["sites", "categories", "class_rules", "keywords", "safesearch", "restricted_mode", "video_rules", "screens", "tabs", "lock", "requests", "temporary"] },
      { name: "Lightspeed", url: "https://www.lightspeedsystems.com/products/", supported: ["sites", "categories", "class_rules", "safesearch", "video_rules", "screens", "tabs", "lock"] },
    ];
    const mark = supported => `<span class="wf-compare-mark${supported ? " is-supported" : ""}">${icon(supported ? "check" : "close")}<span class="wf-visually-hidden">${esc(t(supported ? "compare_supported" : "compare_unconfirmed"))}</span></span>`;
    const headings = products.map(({ name, url }) => `<th scope="col" translate="no">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>` : esc(name)}</th>`).join("");
    const rows = features.map(feature => `<tr>
      <th scope="row">${esc(t(`compare_feature_${feature}`))}</th>
      ${products.map(({ supported }) => `<td>${mark(supported.includes(feature))}</td>`).join("")}
    </tr>`).join("");
    return hero("compare_arrows", "nav_compare", "compare_desc") + `
      <div class="wf-compare-legend mu-muted" id="wfCompareLegend">
        <span>${icon("check")}${esc(t("compare_supported"))}</span>
        <span>${icon("close")}${esc(t("compare_unconfirmed"))}</span>
        <span>${esc(t("compare_availability"))}</span>
      </div>
      <div class="mu-table-wrap wf-compare-table" tabindex="0" role="region" aria-label="${esc(t("nav_compare"))}" aria-describedby="wfCompareLegend">
        <table class="mu-table"><thead><tr>
          <th scope="col">${esc(t("compare_feature"))}</th>${headings}
        </tr></thead><tbody>${rows}</tbody></table>
      </div>`;
  }

  /* ========================================================= settings page */

  function renderSettingsPage() {
    const statusText = { connecting: t("status_connecting"), online: t("status_online"), offline: t("status_offline"), error: t("status_error") }[server.status];
    return hero("settings", "settings_title", "settings_desc") + `
      <section class="mu-glass mu-panel wf-card">
        <h2 class="mu-h-title">${esc(t("general"))}</h2>
        <div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("language"))}</span><span class="mu-row-subtitle">${esc(t("language_desc"))}</span></div>
          <div class="wf-select-wrap"><select class="mu-select" id="wfLanguage" aria-label="${esc(t("language"))}">${I18n.languages().map(item => `<option value="${esc(item.code)}" lang="${esc(item.code)}"${item.code === I18n.locale() ? " selected" : ""}>${esc(item.name)}</option>`).join("")}</select></div></div>
        <div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("sidebar"))}</span><span class="mu-row-subtitle">${esc(t("sidebar_desc"))}</span></div>
          <button type="button" class="mu-btn" data-wf-action="customize-sidebar">${icon("tune")}${esc(t("customize_sidebar"))}</button></div>
      </section>
      <section class="mu-glass mu-panel wf-card">
        <h2 class="mu-h-title">${esc(t("workspace"))}</h2>
        <div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(workspaceName(ws))}</span><span class="mu-row-subtitle">${esc(t("workspace_created", { time: formatDate(ws.createdAt) }))}</span></div>
          <button type="button" class="mu-btn" data-wf-action="rename-workspace"${lock(isAdmin())}>${icon("edit")}${esc(t("rename"))}</button></div>
        <div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("new_workspace"))}</span><span class="mu-row-subtitle">${esc(t("new_workspace_desc"))}</span></div>
          <button type="button" class="mu-btn" data-wf-action="new-workspace">${icon("add")}${esc(t("new_workspace"))}</button></div>
        <div class="mu-danger-zone"><div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("delete_workspace"))}</span><span class="mu-row-subtitle">${esc(t("delete_workspace_desc"))}</span></div>
          <button type="button" class="mu-btn mu-btn-danger-outline" data-wf-action="delete-workspace"${lock(isAdmin() && workspaces.length > 1, workspaces.length > 1 ? "locked_admin_only" : "locked_last_workspace")}>${icon("delete")}${esc(t("delete_workspace"))}</button></div></div>
      </section>
      ${renderBypassCard()}
      <section class="mu-glass mu-panel wf-card">
        <h2 class="mu-h-title">${esc(t("server_connection"))}</h2>
        <div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(statusText)}</span><span class="mu-row-subtitle">${esc(t(server.status === "online" ? "server_online_desc" : "server_offline_body"))}</span></div>
          <button type="button" class="mu-btn" data-wf-action="reconnect">${icon("refresh")}${esc(t("reconnect"))}</button></div>
        ${server.status === "error" && isAdmin() ? `<div class="mu-row"><div class="mu-row-info"><span class="mu-row-title">${esc(t("reregister"))}</span><span class="mu-row-subtitle">${esc(t("reregister_desc"))}</span></div><button type="button" class="mu-btn" data-wf-action="reregister">${icon("cloud_sync")}${esc(t("reregister"))}</button></div>` : ""}
      </section>`;
  }

  /* ======================================================= extension modal */

  function managedConfig() {
    return { serverUrl: location.origin, orgId: ws.server.orgId, enrollToken: ws.server.enrollToken, workspaceName: workspaceName(ws) };
  }

  // The workspace keeps one signing key so every downloaded folder installs as the same extension.
  async function ensureKey() {
    if (ws.key && ws.key.extensionId) return ws.key;
    const workspace = ws;
    const key = await Pack.createSigningKey();
    if (ws !== workspace) return null;
    ws.key = key;
    saveWorkspace({ push: false });
    return ws.key;
  }

  const INSTALL_PROVIDERS = ["google", "m365"];

  function installUrl() {
    return ws.server.orgId ? API + "/orgs/" + encodeURIComponent(ws.server.orgId) + "/update.xml" : "";
  }

  function canBuildExtension() {
    const published = ws.extension.published;
    return !!ws.server.enrollToken && (!published || (!!ws.key?.extensionId && published.appId === ws.key.extensionId));
  }

  // The install URL serves a signed package. It is prepared automatically the first time an
  // Admin opens this dialog, so nobody has to publish anything by hand.
  const publishing = { busy: false, error: "" };
  async function preparePackage() {
    if (publishing.busy || !isAdmin() || server.status !== "online" || !canBuildExtension() || ws.extension.published?.version === EXTENSION_VERSION) return;
    const workspace = ws;
    publishing.busy = true;
    publishing.error = "";
    renderExtensionModal();
    try {
      const key = await ensureKey();
      if (!key || ws !== workspace) return;
      const version = EXTENSION_VERSION;
      const bytes = await Pack.buildCrx({ version, key, config: managedConfig(), policy: Object.assign(exportPolicy(), { version: ws.server.policyVersion }), updateUrl: installUrl() });
      if (ws !== workspace) return;
      const { extension } = await request("/orgs/" + encodeURIComponent(workspace.server.orgId) + "/extension?appId=" + key.extensionId + "&version=" + encodeURIComponent(version), {
        method: "PUT", body: bytes, headers: { "Content-Type": "application/x-chrome-extension" },
      });
      workspace.extension.published = { appId: extension.appId, version: extension.version, at: extension.publishedAt };
      if (ws === workspace) saveWorkspace({ push: false });
    } catch (error) {
      if (ws === workspace) publishing.error = error.message;
    } finally {
      publishing.busy = false;
      if (!$("#wfExtensionModal").hidden) renderExtensionModal();
    }
  }

  function copyField(label, value) {
    return `<label class="mu-field"><span class="mu-field-label">${esc(label)}</span>
      <div class="mu-copy-field"><input type="text" readonly value="${esc(value)}" dir="ltr" aria-label="${esc(label)}"><button type="button" class="mu-btn mu-btn-primary" data-mu-copy data-mu-copied="${esc(t("copied"))}">${icon("content_copy")}${esc(t("copy"))}</button></div></label>`;
  }

  function renderUrlInstall() {
    if (!isAdmin()) return "";
    const provider = INSTALL_PROVIDERS.includes(ws.extension.provider) ? ws.extension.provider : "google";
    const id = ws.extension.published?.appId;
    const url = installUrl();
    let status = "";
    if (server.status === "connecting" || publishing.busy) {
      status = `<div class="mu-alert" role="status">${icon("hourglass_top")}<span>${esc(t("preparing_link"))}</span></div>`;
    } else if (server.status !== "online") {
      status = `<div class="mu-alert is-warning" role="status">${icon("cloud_off")}<span>${esc(t("server_offline_title"))}</span><button type="button" class="mu-btn" data-wf-action="reconnect">${icon("refresh")}${esc(t("reconnect"))}</button></div>`;
    } else if (publishing.error) {
      status = `<div class="mu-alert is-danger" role="alert">${icon("error")}<div class="mu-alert-body"><span class="mu-alert-title">${esc(t("link_failed"))}</span><span class="mu-muted">${esc(publishing.error)}</span></div><button type="button" class="mu-btn" data-wf-action="retry-install-link">${icon("refresh")}${esc(t("try_again"))}</button></div>`;
    } else if (!id && !canBuildExtension()) {
      status = `<div class="mu-alert" role="status">${icon("info")}<span>${esc(t("extension_install_unavailable"))}</span></div>`;
    }
    let body = "";
    if (id && url) {
      const steps = [1, 2, 3, 4].map(n => `<li>${esc(t("install_" + provider + "_" + n))}</li>`).join("");
      body = `${copyField(t("extension_id"), id)}
        ${copyField(t("install_url"), url)}
        ${provider === "m365" ? copyField(t("intune_value"), id + ";" + url) : ""}
        <ol class="wf-steps">${steps}</ol>
        <div class="wf-actions"><a class="mu-btn" href="${esc(url.replace(/update\.xml$/, "extension.crx"))}" download="munetios-webfilter.crx">${icon("download")}${esc(t("extension_download_signed"))}</a></div>`;
    }
    return `<section class="wf-deploy-section" aria-labelledby="wfInstallUrlTitle">
      <h3 class="mu-h-title" id="wfInstallUrlTitle">${icon("domain")} ${esc(t("install_whole_school"))}</h3>
      <p class="mu-muted">${esc(t("install_whole_school_desc"))}</p>
      <div class="mu-segmented wf-providers" role="group" aria-label="${esc(t("provider"))}">${INSTALL_PROVIDERS.map(item => `<button type="button" data-wf-action="set-provider" data-id="${item}" aria-pressed="${item === provider}">${esc(t("provider_" + item))}</button>`).join("")}</div>
      ${status}${body}
    </section>`;
  }

  function renderExtensionModal() {
    $("#wfExtensionDialog").innerHTML = `
      <div class="mu-dialog-header"><div class="mu-dialog-heading"><img src="icons/icon-48.png" width="48" height="48" alt=""><h2 id="wfExtensionTitle">${esc(t("extension_title"))}</h2></div><button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-close aria-label="${esc(t("close"))}">${icon("close")}</button></div>
      <p class="mu-muted">${esc(t("extension_desc"))}</p>
      ${renderUrlInstall()}
      ${canBuildExtension() ? `<section class="wf-deploy-section" aria-labelledby="wfInstallFolderTitle">
        <h3 class="mu-h-title" id="wfInstallFolderTitle">${icon("folder")} ${esc(t("install_folder"))}</h3>
        <ol class="wf-steps wf-install-steps">
          <li>${esc(t("install_step_1"))}</li>
          <li>${esc(t("install_step_2"))}</li>
          <li>${esc(t("install_step_3"))}</li>
          <li>${esc(t("install_step_4"))}</li>
        </ol>
        <div class="wf-actions"><button type="button" class="mu-btn mu-btn-primary" data-wf-action="download-zip">${icon("download")}${esc(t("download_extension"))}</button></div>
      </section>` : ""}`;
  }

  function openExtension() {
    if (!guard(isAdmin())) return;
    if (!$("#wfExtensionModal").hidden) return;
    publishing.error = "";
    renderExtensionModal();
    window.MunetiosUI.openModal("wfExtensionModal");
    preparePackage();
  }

  async function downloadZip(button) {
    if (!guard(isAdmin()) || !canBuildExtension()) return;
    button.disabled = true;
    try {
      const key = await ensureKey();
      if (!key) return;
      const version = EXTENSION_VERSION;
      const bytes = await Pack.buildZip({ version, key, config: ws.server.orgId ? managedConfig() : {}, policy: Object.assign(exportPolicy(), { version: ws.server.policyVersion }), updateUrl: "" });
      Pack.download(bytes, "munetios-webfilter.zip", "application/zip");
      toast(t("toast_zip_ready"), "success", "download");
    } catch (error) {
      toast(t("toast_zip_failed", { error: error.message }), "error");
    } finally {
      button.disabled = false;
    }
  }

  /* ================================================================ dialogs */

  function fieldHtml(field) {
    const id = "wfField-" + field.name;
    const help = field.help ? `<span class="mu-field-help">${esc(field.help)}</span>` : "";
    const error = `<span class="mu-inline-error" id="${id}-error" hidden></span>`;
    const dir = field.dir ? ` dir="${field.dir}"` : "";
    if (field.type === "textarea") {
      return `<label class="mu-field"><span class="mu-field-label">${esc(field.label)}</span><textarea class="mu-textarea${field.code ? " wf-code" : ""}" name="${field.name}" id="${id}"${dir}${field.required ? " required" : ""} placeholder="${esc(field.placeholder || "")}" spellcheck="${field.code ? "false" : "true"}">${esc(field.value)}</textarea>${help}${error}</label>`;
    }
    if (field.type === "select") {
      return `<label class="mu-field"><span class="mu-field-label">${esc(field.label)}</span><select class="mu-select" name="${field.name}" id="${id}">${field.options.map(option => `<option value="${esc(option.value)}"${option.value === field.value ? " selected" : ""}>${esc(option.label)}</option>`).join("")}</select>${help}${error}</label>`;
    }
    if (field.type === "segmented") {
      return `<div class="mu-field" role="group" aria-labelledby="${id}-label"><span class="mu-field-label" id="${id}-label">${esc(field.label)}</span><div class="mu-segmented" data-wf-segmented="${field.name}">${field.options.map(option => `<button type="button" data-value="${esc(option.value)}" aria-pressed="${option.value === field.value}"${field.disabled ? " disabled" : ""}>${esc(option.label)}</button>`).join("")}</div><input type="hidden" name="${field.name}" value="${esc(field.value)}">${help}${error}</div>`;
    }
    if (field.type === "multicheck" || field.type === "radio") {
      const multi = field.type === "multicheck";
      const options = field.options.length ? field.options.map(option => `<label class="${multi ? "mu-check" : "mu-radio"} wf-option"><input type="${multi ? "checkbox" : "radio"}" name="${field.name}" value="${esc(option.value)}"${(multi ? field.value.includes(option.value) : option.value === field.value) ? " checked" : ""}><span><span>${esc(option.label)}</span>${option.sub ? `<span class="mu-muted wf-option-sub" dir="ltr">${esc(option.sub)}</span>` : ""}</span></label>`).join("") : `<span class="mu-muted">${esc(field.emptyText || "")}</span>`;
      return `<fieldset class="mu-field wf-fieldset"><legend class="mu-field-label">${esc(field.label)}</legend><div class="wf-options">${options}</div>${help}${error}</fieldset>`;
    }
    const type = field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "password" ? "password" : "text";
    return `<label class="mu-field"><span class="mu-field-label">${esc(field.label)}</span><input class="mu-input" type="${type}" name="${field.name}" id="${id}" value="${esc(field.value)}"${dir}${field.required ? " required" : ""}${field.min != null ? ` min="${field.min}"` : ""} placeholder="${esc(field.placeholder || "")}" autocomplete="off" aria-describedby="${id}-error">${help}${error}</label>`;
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal && !modal.hidden) window.MunetiosUI.closeModal(modal);
  }

  function openForm(options) {
    closeModal("wfFormModal");
    const form = $("#wfForm");
    form.classList.toggle("mu-dialog-lg", !!options.wide);
    const fields = options.fields || [];
    form.innerHTML = `
      <div class="mu-dialog-header"><div class="mu-dialog-heading"><span class="mu-icon-circle${options.danger ? " mu-icon-circle-danger" : ""}">${icon(options.icon || "edit")}</span><h2 id="wfFormTitle">${esc(options.title)}</h2></div><button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-close aria-label="${esc(t("close"))}">${icon("close")}</button></div>
      ${options.description ? `<p class="mu-muted">${esc(options.description)}</p>` : ""}
      ${options.body ? `<p>${esc(options.body)}</p>` : ""}
      ${options.html || ""}
      ${fields.map(fieldHtml).join("")}
      <p class="mu-inline-error" id="wfFormError" hidden></p>
      <div class="mu-dialog-actions">
        ${(options.extraActions || []).map((action, index) => `<button type="button" class="mu-btn mu-btn-ghost" data-wf-extra="${index}">${esc(action.label)}</button>`).join("")}
        ${options.cancel === false ? "" : `<button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button>`}
        <button type="submit" class="mu-btn ${options.danger ? "mu-btn-danger" : "mu-btn-primary"}">${esc(options.submit || t("save"))}</button>
      </div>`;
    form.onclick = event => {
      const segment = event.target.closest("[data-wf-segmented] button");
      if (segment && !segment.disabled) {
        const group = segment.closest("[data-wf-segmented]");
        $$("button", group).forEach(button => button.setAttribute("aria-pressed", String(button === segment)));
        form.elements[group.dataset.wfSegmented].value = segment.dataset.value;
      }
      const extra = event.target.closest("[data-wf-extra]");
      if (extra) {
        options.extraActions[Number(extra.dataset.wfExtra)].action();
        closeModal("wfFormModal");
      }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (submit.disabled) return;
      const values = {};
      fields.forEach(field => {
        if (field.type === "multicheck") values[field.name] = $$(`input[name="${field.name}"]:checked`, form).map(input => input.value);
        else if (field.type === "radio") values[field.name] = ($(`input[name="${field.name}"]:checked`, form) || {}).value || "";
        else values[field.name] = form.elements[field.name] ? form.elements[field.name].value : "";
      });
      $$(".mu-inline-error", form).forEach(node => { node.hidden = true; });
      $$(".is-invalid", form).forEach(node => { node.classList.remove("is-invalid"); node.removeAttribute("aria-invalid"); });
      submit.disabled = true;
      let problem;
      try {
        problem = await (options.onSubmit ? options.onSubmit(values) : null);
      } finally {
        submit.disabled = false;
      }
      if (problem) {
        const target = problem.field ? document.getElementById("wfField-" + problem.field + "-error") : null;
        const output = target || $("#wfFormError");
        output.innerHTML = icon("error") + `<span>${esc(problem.message || String(problem))}</span>`;
        output.hidden = false;
        const input = problem.field ? document.getElementById("wfField-" + problem.field) : null;
        if (input) { input.classList.add("is-invalid"); input.setAttribute("aria-invalid", "true"); input.focus(); }
        return;
      }
      closeModal("wfFormModal");
    };
    window.MunetiosUI.openModal("wfFormModal");
  }

  function confirmAction({ title, body, submit, onConfirm }) {
    openForm({ title, body, submit, danger: true, icon: "warning", onSubmit: async () => { await onConfirm(); return null; } });
  }

  function openSidebarCustomizer() {
    const config = sidebarConfig();
    const render = () => `<div class="wf-list wf-customizer" id="wfSidebarList">${config.order.map((id, index) => {
      const item = sidebarItem(id);
      return `<div class="mu-row"><span class="mu-icon-circle" aria-hidden="true">${icon(item.icon)}</span><div class="mu-row-info"><span class="mu-row-title">${esc(t(item.label))}</span></div>
        <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-move="${index}" data-step="-1" aria-label="${esc(t("move_up"))}"${index === 0 ? " disabled" : ""}>${icon("arrow_upward")}</button>
        <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-move="${index}" data-step="1" aria-label="${esc(t("move_down"))}"${index === config.order.length - 1 ? " disabled" : ""}>${icon("arrow_downward")}</button>
        <label class="mu-switch"><input type="checkbox" data-show="${esc(id)}" ${config.hidden.includes(id) ? "" : "checked"}${id === "settings" ? " disabled" : ""} aria-label="${esc(t("show_in_sidebar", { item: t(item.label) }))}"><span class="mu-switch-track"></span></label></div>`;
    }).join("")}</div>`;
    openForm({
      title: t("customize_sidebar"), icon: "tune", submit: t("save"), description: t("customize_sidebar_desc"),
      html: render(),
      extraActions: [{ label: t("reset"), action: () => { storage.remove(KEYS.sidebar); renderChrome(); } }],
      onSubmit() {
        storage.set(KEYS.sidebar, config);
        renderChrome();
        return null;
      },
    });
    const form = $("#wfForm");
    form.addEventListener("click", event => {
      const move = event.target.closest("[data-move]");
      if (!move) return;
      const index = Number(move.dataset.move);
      const next = index + Number(move.dataset.step);
      [config.order[index], config.order[next]] = [config.order[next], config.order[index]];
      $("#wfSidebarList").outerHTML = render();
      const again = $(`[data-move="${next}"][data-step="${move.dataset.step}"]`) || $(`[data-move="${next}"]`);
      if (again) again.focus();
    });
    form.addEventListener("change", event => {
      const toggle = event.target.closest("[data-show]");
      if (!toggle) return;
      config.hidden = config.hidden.filter(id => id !== toggle.dataset.show);
      if (!toggle.checked) config.hidden.push(toggle.dataset.show);
    });
  }

  /* ================================================================ render */

  function renderPage() {
    if (!ws) return;
    const content = $("#wfContent");
    const scrollY = window.scrollY;
    const focusId = document.activeElement && document.activeElement.id;
    const renderers = { rules: renderRulesPage, categories: renderCategoriesPage, classes: renderClassesPage, usercss: renderUserCssPage, devices: renderDevicesPage, requests: renderRequestsPage, collaborators: renderCollaboratorsPage, compare: renderComparisonPage, settings: renderSettingsPage };
    content.innerHTML = `<div class="wf-page" data-page="${route.page}">${renderers[route.page]()}</div>`;
    wireFavicons(content);
    if (route.page === "devices") loadScreens(content);
    if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus({ preventScroll: true });
    window.scrollTo(0, scrollY);
  }

  function renderAll() {
    renderChrome();
    renderPage();
  }

  /* ================================================================ events */

  document.addEventListener("click", event => {
    const locked = event.target.closest('[aria-disabled="true"][data-wf-locked]');
    if (locked) {
      event.preventDefault();
      event.stopPropagation();
      toast(locked.dataset.wfLocked, "warning", "lock");
      return;
    }
    const target = event.target.closest("[data-wf-action]");
    if (!target || target.matches("input")) return;
    const { wfAction: action, id, scope } = target.dataset;
    switch (action) {
      case "sidebar-open": {
        document.body.classList.add("wf-sidebar-open");
        $(".wf-scrim").hidden = false;
        const first = $("#wfSidebar .mu-nav-item");
        if (first) first.focus();
        break;
      }
      case "sidebar-close": document.body.classList.remove("wf-sidebar-open"); $(".wf-scrim").hidden = true; break;
      case "reconnect": connect(); break;
      case "reregister":
        if (!guard(isAdmin())) return;
        ws.server = { orgId: "", adminKey: "", enrollToken: "", policyVersion: 0, pushedAt: 0 };
        saveWorkspace({ push: false });
        connect();
        break;
      case "open-extension": openExtension(); break;
      case "customize-sidebar": openSidebarCustomizer(); break;
      case "add-rule": openRuleForm(scope, null, target.dataset.ruleAction); break;
      case "change-global-rule": openGlobalChangeForm(target.dataset.class, id); break;
      case "toggle-global-text": {
        const klass = findClass(target.dataset.class);
        if (!klass || !guard(canEditClass(klass.id), "locked_class")) return;
        const off = exceptionsFor(klass).text;
        const value = target.dataset.value;
        klass.globalExceptions.text = off.includes(value) ? off.filter(item => item !== value) : off.concat(value);
        saveWorkspace();
        renderPage();
        break;
      }
      case "edit-rule": openRuleForm(scope, id); break;
      case "delete-rule": deleteRule(scope, id); break;
      case "add-class": openClassForm(); break;
      case "edit-class": openClassForm(id); break;
      case "delete-class": deleteClass(id); break;
      case "copy-text":
        navigator.clipboard.writeText(target.dataset.text).then(() => toast(t("copied"), "success"), () => toast(t("copy_failed"), "error"));
        break;
      case "remove-list-entry": {
        if (!guard(canEditScope(scope), scope === "global" ? "locked_global" : "locked_class")) return;
        const data = scopeData(scope);
        data.userCss[target.dataset.list] = data.userCss[target.dataset.list].filter(item => item !== target.dataset.value);
        saveWorkspace();
        renderPage();
        break;
      }
      case "remove-import-url": {
        if (!guard(isAdmin())) return;
        const lists = ws.policy.global.userCss;
        lists.importUrls = (lists.importUrls || []).filter(url => url !== target.dataset.value);
        saveWorkspace();
        renderPage();
        break;
      }
      case "categorize-sites": openCategorizeForm(); break;
      case "remove-override": {
        if (!guard(isAdmin())) return;
        delete ws.policy.global.categoryOverrides[target.dataset.value];
        saveWorkspace();
        renderPage();
        break;
      }
      case "remove-text": {
        if (!guard(canEditScope(scope), scope === "global" ? "locked_global" : "locked_class")) return;
        const data = scopeData(scope);
        data.blockedText = (data.blockedText || []).filter(item => item !== target.dataset.value);
        saveWorkspace();
        renderPage();
        break;
      }
      case "remove-youtube-video": {
        if (!guard(canEditScope(scope), scope === "global" ? "locked_global" : "locked_class")) return;
        const data = scopeData(scope);
        const list = target.dataset.decision === "allow" && scope !== "global" ? "allowedYouTubeVideos" : "blockedYouTubeVideos";
        data[list] = (data[list] || []).filter(id => id !== target.dataset.value);
        saveWorkspace();
        renderPage();
        break;
      }
      case "refresh-devices": refreshDevices(); break;
      case "refresh-requests": refreshRequests(); break;
      case "request-approve": answerRequest(id, "approved", scope); break;
      case "request-deny": answerRequest(id, "denied"); break;
      case "bypass-set": openBypassForm(); break;
      case "bypass-remove":
        if (!guard(isAdmin())) return;
        confirmAction({
          title: t("bypass_remove"), body: t("bypass_remove_confirm"), submit: t("remove"),
          async onConfirm() {
            try {
              await request("/orgs/" + encodeURIComponent(ws.server.orgId) + "/bypass", { method: "DELETE" });
              bypass.enabled = false;
              toast(t("toast_bypass_removed"), "success");
              renderPage();
            } catch (error) { toast(t("toast_command_failed", { error: error.message }), "error"); }
          },
        });
        break;
      case "add-person": openPersonForm(); break;
      case "edit-person": openPersonForm(id); break;
      case "remove-person": removePerson(id); break;
      case "set-provider": ws.extension.provider = id; saveWorkspace({ push: false }); renderExtensionModal(); break;
      case "retry-install-link": preparePackage(); break;
      case "download-zip": downloadZip(target); break;
      case "rename-workspace":
        if (!guard(isAdmin())) return;
        openForm({
          title: t("rename_workspace"), icon: "edit", submit: t("save"),
          fields: [{ name: "name", type: "text", label: t("workspace_name"), value: ws.name, required: true }],
          async onSubmit(values) {
            if (!values.name.trim()) return { field: "name", message: t("required") };
            try {
              const result = await request("/orgs/" + encodeURIComponent(ws.server.orgId), { method: "PATCH", json: { name: values.name.trim() } });
              ws.name = result.name;
              saveWorkspace({ push: false });
              renderAll();
              return null;
            } catch (error) { return { message: t("toast_command_failed", { error: error.message }) }; }
          },
        });
        break;
      case "new-workspace":
        openForm({
          title: t("new_workspace"), icon: "add", submit: t("create"),
          fields: [{ name: "name", type: "text", label: t("workspace_name"), value: "", required: true }],
          onSubmit(values) {
            if (!values.name.trim()) return { field: "name", message: t("required") };
            const created = createWorkspace(values.name.trim());
            activateWorkspace(created.id);
            renderAll();
            toast(t("toast_workspace_created"), "success");
            return null;
          },
        });
        break;
      case "delete-workspace":
        if (!guard(isAdmin() && workspaces.length > 1, workspaces.length > 1 ? "locked_admin_only" : "locked_last_workspace")) return;
        confirmAction({
          title: t("delete_workspace"), body: t("delete_workspace_confirm", { name: workspaceName(ws) }), submit: t("delete"),
          onConfirm() {
            const removed = ws.id;
            if (ws.server.orgId) storage.set(KEYS.hidden, [...new Set(storage.get(KEYS.hidden, []).concat(ws.server.orgId))]);
            workspaces = workspaces.filter(item => item.id !== removed);
            storage.remove(KEYS.workspace(removed));
            storage.set(KEYS.list, workspaces);
            activateWorkspace(workspaces[0].id);
            renderAll();
            toast(t("toast_workspace_deleted"), "success");
          },
        });
        break;
      default:
        if (action && action.startsWith("device-")) deviceAction(action, id, target);
    }
  });

  document.addEventListener("change", event => {
    const target = event.target;
    if (target.id === "wfWorkspaceSelect") {
      activateWorkspace(target.value);
      renderAll();
    } else if (target.id === "wfCategoriesClass") {
      go("categories", target.value);
    } else if (target.dataset.wfAction === "toggle-category") {
      const scopeId = target.dataset.scope;
      if (!guard(canEditScope(scopeId), scopeId === "global" ? "locked_global" : "locked_class")) { renderPage(); return; }
      const data = scopeData(scopeId);
      const id = target.dataset.id;
      if (scopeId !== "global" && (ws.policy.global.blockedCategories || []).includes(id)) {
        // Blocked globally: switching it off here only changes this class.
        const off = new Set(exceptionsFor(data).categories);
        if (target.checked) off.delete(id); else off.add(id);
        exceptionsFor(data).categories = Engine.CATEGORIES.filter(item => off.has(item));
      } else {
        const list = new Set(data.blockedCategories || []);
        if (target.checked) list.add(id); else list.delete(id);
        data.blockedCategories = Engine.CATEGORIES.filter(item => list.has(item));
      }
      saveWorkspace();
      renderPage();
      toast(t(target.checked ? "toast_category_on" : "toast_category_off", { category: t("cat_" + target.dataset.id), scope: scopeLabel(scopeId) }), "info");
    } else if (target.id === "wfRulesClass") {
      go("rules", target.value);
    } else if (target.id === "wfCssScope") {
      cssView.scopeId = target.value;
      renderPage();
    } else if (target.id === "wfDefaultMode") {
      const scopeId = cssScope();
      if (!guard(canEditScope(scopeId), scopeId === "global" ? "locked_global" : "locked_class")) { renderPage(); return; }
      scopeData(scopeId).userCss.defaultMode = target.value;
      saveWorkspace();
    } else if (target.id === "wfLanguage") {
      I18n.setLocale(target.value);
    } else if (target.dataset.wfAction === "toggle-global-rule") {
      const klass = findClass(target.dataset.class);
      if (!klass || !guard(canEditClass(klass.id), "locked_class")) { renderPage(); return; }
      const off = exceptionsFor(klass).rules;
      klass.globalExceptions.rules = target.checked ? off.filter(item => item !== target.dataset.id) : Array.from(new Set(off.concat(target.dataset.id)));
      saveWorkspace();
      renderPage();
      toast(t(target.checked ? "toast_on_for_class" : "toast_off_for_class", { name: klass.name }), "info");
    } else if (target.dataset.wfAction === "toggle-rule") {
      const scope = scopeData(target.dataset.scope);
      const rule = scope && scope.rules.find(item => item.id === target.dataset.id);
      if (!rule || !guard(canEditScope(target.dataset.scope))) { renderPage(); return; }
      rule.enabled = target.checked;
      saveWorkspace();
      renderPage();
    } else if (target.dataset.wfAction === "toggle-safe-mode") {
      const { scope, mode } = target.dataset;
      if (!Engine.SAFE_MODES.includes(mode) || !guard(canEditScope(scope), scope === "global" ? "locked_global" : "locked_class")) { renderPage(); return; }
      const data = scopeData(scope);
      data.safeModes = { ...data.safeModes, [mode]: target.checked };
      saveWorkspace();
      if (scope === "global") {
        renderPage();
        $(`[data-wf-action="toggle-safe-mode"][data-scope="global"][data-mode="${mode}"]`)?.focus();
      }
    } else if (target.dataset.wfAction === "toggle-allowlist") {
      const scopeId = target.dataset.scope;
      if (!guard(canEditScope(scopeId))) { renderPage(); return; }
      scopeData(scopeId).allowlistOnly = target.checked;
      saveWorkspace();
      toast(t(target.checked ? "toast_allowlist_on" : "toast_allowlist_off", { scope: scopeLabel(scopeId) }), "info");

    }
  });

  document.addEventListener("submit", event => {
    const form = event.target.closest("[data-wf-form]");
    if (!form) return;
    event.preventDefault();
    if (form.dataset.wfForm === "test-url") {
      renderTestResult(form.elements.url.value, form.elements.classId.value);
    } else if (form.dataset.wfForm === "check-usercss") {
      renderCssCheck(form.elements.url.value);
    } else if (form.dataset.wfForm === "check-category") {
      renderCategoryResult(form.elements.url.value);
    } else if (form.dataset.wfForm === "add-youtube-video") {
      const scopeId = form.dataset.scope;
      if (!guard(canEditScope(scopeId), scopeId === "global" ? "locked_global" : "locked_class")) return;
      const videoId = Engine.youtubeVideoId(form.elements.video.value);
      if (!videoId) { toast(t("invalid_youtube_video"), "error"); return; }
      const data = scopeData(scopeId);
      const allow = scopeId !== "global" && event.submitter?.value === "allow";
      const selected = allow ? "allowedYouTubeVideos" : "blockedYouTubeVideos";
      const opposite = allow ? "blockedYouTubeVideos" : "allowedYouTubeVideos";
      const ids = data[selected] || [];
      if (ids.includes(videoId) && !(data[opposite] || []).includes(videoId)) { toast(t("duplicate_rule"), "info"); return; }
      data[selected] = [...new Set(ids.concat(videoId))];
      if (scopeId !== "global") data[opposite] = (data[opposite] || []).filter(id => id !== videoId);
      saveWorkspace();
      renderPage();
      $(`[data-wf-form="add-youtube-video"][data-scope="${CSS.escape(scopeId)}"] input`)?.focus();
    } else if (form.dataset.wfForm === "add-text") {
      const scopeId = form.dataset.scope;
      if (!guard(canEditScope(scopeId), scopeId === "global" ? "locked_global" : "locked_class")) return;
      const phrase = Engine.normalizePhrase(form.elements.phrase.value);
      if (!phrase) { toast(t("invalid_text"), "error"); return; }
      const data = scopeData(scopeId);
      data.blockedText = data.blockedText || [];
      if (!data.blockedText.includes(phrase)) data.blockedText.push(phrase);
      saveWorkspace();
      renderPage();
      toast(t("toast_text_added"), "success");
      const again = $(`[data-wf-form="add-text"][data-scope="${scopeId}"] input`);
      if (again) again.focus();
    } else if (form.dataset.wfForm === "add-import-url") {
      if (!guard(isAdmin())) return;
      const url = Engine.normalizeImportUrl(form.elements.url.value);
      if (!url) { toast(t("usercss_import_invalid"), "error"); return; }
      const lists = ws.policy.global.userCss;
      lists.importUrls = [...new Set([...(lists.importUrls || []), url])];
      saveWorkspace();
      renderPage();
      $('[data-wf-form="add-import-url"] input')?.focus();
    } else if (form.dataset.wfForm === "add-list-entry") {
      const scopeId = form.dataset.scope;
      if (!guard(canEditScope(scopeId), scopeId === "global" ? "locked_global" : "locked_class")) return;
      const value = normalizeHostInput(form.elements.pattern.value);
      if (!value) { toast(t("invalid_pattern"), "error"); return; }
      const lists = scopeData(scopeId).userCss;
      ["allowed", "partial", "blocked"].forEach(list => { lists[list] = lists[list].filter(item => item !== value); });
      lists[form.dataset.list].push(value);
      saveWorkspace();
      renderPage();
      const again = $(`[data-wf-form="add-list-entry"][data-list="${form.dataset.list}"] input`);
      if (again) again.focus();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.body.classList.contains("wf-sidebar-open")) {
      document.body.classList.remove("wf-sidebar-open");
      $(".wf-scrim").hidden = true;
    }
  });

  window.addEventListener("hashchange", () => {
    readRoute();
    document.body.classList.remove("wf-sidebar-open");
    $(".wf-scrim").hidden = true;
    renderAll();
    if (route.page === "devices") refreshDevices();
    if (route.page === "requests") refreshRequests();
    if (route.page === "settings") loadBypass();
    $("#wfMain").focus({ preventScroll: true });
  });

  /* --------------------------------------------------------------- tooltip */

  const tooltip = { el: null, target: null };
  function showTooltip(target) {
    const text = target.getAttribute("data-tooltip");
    if (!text) return;
    if (!tooltip.el) {
      tooltip.el = document.createElement("div");
      tooltip.el.className = "mu-tooltip mu-tooltip-floating";
      tooltip.el.setAttribute("role", "tooltip");
      tooltip.el.id = "wfTooltip";
      document.body.appendChild(tooltip.el);
    }
    tooltip.target = target;
    tooltip.el.textContent = text;
    const rect = target.getBoundingClientRect();
    tooltip.el.classList.add("is-visible");
    const box = tooltip.el.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - box.width / 2, window.innerWidth - box.width - 12));
    const top = rect.bottom + 8 + box.height > window.innerHeight ? rect.top - box.height - 8 : rect.bottom + 8;
    tooltip.el.style.left = left + "px";
    tooltip.el.style.top = top + "px";
    target.setAttribute("aria-describedby", "wfTooltip");
  }
  function hideTooltip() {
    if (tooltip.el) tooltip.el.classList.remove("is-visible");
    if (tooltip.target) tooltip.target.removeAttribute("aria-describedby");
    tooltip.target = null;
  }
  document.addEventListener("pointerover", event => {
    const target = event.target.closest && event.target.closest("[data-tooltip]");
    if (target && target !== tooltip.target) showTooltip(target);
    else if (!target) hideTooltip();
  });
  document.addEventListener("focusin", event => {
    const target = event.target.closest && event.target.closest("[data-tooltip]");
    if (target) showTooltip(target); else hideTooltip();
  });
  document.addEventListener("focusout", hideTooltip);
  document.addEventListener("scroll", hideTooltip, true);

  /* ================================================================== start */

  I18n.onChange(() => {
    if (!ws) return;
    renderAll();
    if (!$("#wfExtensionModal").hidden) renderExtensionModal();
    $$("[data-wf-i18n]").forEach(node => { node.textContent = t(node.dataset.wfI18n); });
    $$("[data-wf-i18n-label]").forEach(node => { node.setAttribute("aria-label", t(node.dataset.wfI18nLabel)); });
    labelResizer();
  });

  function labelResizer() {
    const sidebar = $("#wfSidebar");
    if (!sidebar) return;
    sidebar.dataset.muResizeLabel = t("resize_sidebar");
    const handle = sidebar.querySelector(".mu-sidebar-resizer");
    if (handle) handle.setAttribute("aria-label", t("resize_sidebar"));
  }

  function goToSignIn() {
    $(".wf-shell").hidden = true;
    if (Account.state.revocation) return;
    $$(".mu-modal").forEach(modal => { modal.hidden = true; });
    location.replace("/signin?continue=" + encodeURIComponent(location.pathname + location.search + location.hash));
  }

  async function start() {
    await I18n.load();
    if (!Account.state.ready) {
      await new Promise(resolve => {
        const unsubscribe = Account.on(state => {
          if (!state.ready) return;
          unsubscribe();
          resolve();
        });
      });
    }
    if (Account.state.offline) { showStartError(); return; }
    if (!Account.state.account) { goToSignIn(); return; }
    const account = Account.state.account;
    Account.on(state => {
      if (!state.ready || state.offline) return;
      if (!state.account || state.revocation) goToSignIn();
      else if (state.account.id !== account.id) {
        $(".wf-shell").hidden = true;
        location.reload();
      }
    });
    window.addEventListener("focus", () => Account.refresh());
    window.addEventListener("pageshow", event => { if (event.persisted) Account.refresh(); });
    try { await discoverWorkspaces(account); }
    catch (error) { if (error.message !== "signedOut") showStartError(); return; }
    if (!workspaces.length) createWorkspace("");
    const active = storage.get(KEYS.active, storage.get(legacyKeys.active, ""));
    const id = workspaces.some(item => item.id === active) ? active : workspaces[0].id;
    readRoute();
    ws = loadWorkspace(id);
    if (!ws) {
      workspaces = workspaces.filter(item => item.id !== id);
      ws = createWorkspace("");
    }
    storage.set(KEYS.active, ws.id);
    $$("[data-wf-i18n]").forEach(node => { node.textContent = t(node.dataset.wfI18n); });
    $$("[data-wf-i18n-label]").forEach(node => { node.setAttribute("aria-label", t(node.dataset.wfI18nLabel)); });
    labelResizer();
    renderAll();
    $(".wf-shell").hidden = false;
    startDevicePolling();
    connect();
  }

  function showStartError() {
    $("#wfSessionErrorTitle").textContent = t("session_check_failed");
    $("#wfSessionRetry").textContent = t("try_again");
    $("#wfSessionRetry").onclick = () => location.reload();
    $("#wfSessionError").hidden = false;
  }

  start();
})();
