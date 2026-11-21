/*!
 * Munetios WebFilter extension: background service worker (Manifest V3)
 * - Enforces Global, Class and temporary device blocks before pages load: rules are compiled
 *   into declarativeNetRequest redirects, so a blocked page never starts loading. A navigation
 *   listener with the same engine stays as a backup.
 * - Device name and class come from the dashboard (or managed policy). Students can't change them.
 * - Injects the bundled Google Sans Flex and sanitized UserCSS with
 *   chrome.scripting.insertCSS, which page CSPs (font-src, style-src) can't block.
 *   The bundled font is the ss01 build, so ss01 never needs font-feature-settings
 *   and other fonts on the site are left untouched.
 * - Blocked pages are replaced by the WebFilter block page at <server>/blocked.
 *   Restricted pages, including /blocked itself, never receive UserCSS.
 * - Blocked text: URLs containing it are blocked, and each page's content script gets
 *   the list to remove it while students type. Websites on an allow rule are exempt.
 * - UserCSS editor (side panel): students write their own styles; they only run when
 *   "Inject UserCSS" is on, and always through the school's UserCSS policy sandbox.
 * - Remote management: waits for commands while the periodic heartbeat reports device status.
 */
importScripts("categories.js", "policy-engine.js");

const Engine = self.MunetiosWebFilterEngine;
const HEARTBEAT_ALARM = "mwf-heartbeat";
const FONT_URL = chrome.runtime.getURL(Engine.FONT_PATH);
const injected = new Map();
const tabQueues = new Map();
let ruleSync = Promise.resolve();

/* ------------------------------------------------------------- settings */

async function readBundled(name) {
  try {
    const response = await fetch(chrome.runtime.getURL(name));
    return response.ok ? await response.json() : null;
  } catch (error) {
    return null;
  }
}

async function readManaged() {
  try {
    return (await chrome.storage.managed.get(null)) || {};
  } catch (error) {
    return {};
  }
}

async function getSettings() {
  const [bundled, managed, local] = await Promise.all([
    readBundled("config.json"),
    readManaged(),
    chrome.storage.local.get(["deviceId", "assignedName", "assignedClassId", "workspaceName"]),
  ]);
  const config = Object.assign({}, bundled || {});
  ["serverUrl", "orgId", "enrollToken"].forEach(key => { if (typeof managed[key] === "string" && managed[key]) config[key] = managed[key]; });
  // Managed policy first, then what an Admin or Teacher set in the dashboard. Never the student.
  const fromDashboard = { deviceName: local.assignedName, classId: local.assignedClassId, studentName: "" };
  const pick = key => (typeof managed[key] === "string" && managed[key] ? managed[key] : fromDashboard[key] || "");
  return {
    serverUrl: String(config.serverUrl || "").replace(/\/+$/, ""),
    orgId: config.orgId || "",
    workspaceName: String(local.workspaceName || config.workspaceName || "").slice(0, 120),
    enrollToken: config.enrollToken || "",
    deviceId: local.deviceId || "",
    deviceName: pick("deviceName"),
    studentName: pick("studentName"),
    classId: pick("classId"),
    managed: {
      deviceName: !!managed.deviceName,
      studentName: !!managed.studentName,
      classId: !!managed.classId,
      server: !!managed.serverUrl,
    },
  };
}

async function ensureDeviceId() {
  const { deviceId } = await chrome.storage.local.get("deviceId");
  if (deviceId) return deviceId;
  const created = "dev-" + crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: created });
  return created;
}

async function getPolicy() {
  const { policy } = await chrome.storage.local.get("policy");
  if (policy) return policy;
  const bundled = await readBundled("policy.json");
  if (bundled) await chrome.storage.local.set({ policy: bundled, policyVersion: Number(bundled.version) || 0 });
  return bundled || { global: {}, classes: [] };
}

async function getContext() {
  const [settings, policy, local] = await Promise.all([
    getSettings(),
    getPolicy(),
    chrome.storage.local.get(["tempBlocks", "tempAllows", "locked", "injectUserCss", "userStyles"]),
  ]);
  const now = Date.now();
  const tempBlocks = (local.tempBlocks || []).filter(block => !block.until || block.until > now);
  const tempAllows = (local.tempAllows || []).filter(item => !item.until || item.until > now);
  return {
    settings, policy, tempBlocks, tempAllows, locked: local.locked || null, classId: settings.classId, extensionId: chrome.runtime.id, now,
    blockPageUrl: blockPageUrl(settings),
    injectUserCss: !!local.injectUserCss,
    userStyles: Array.isArray(local.userStyles) ? local.userStyles : [],
  };
}

/* ------------------------------------------------------------ enforcement */

function blockPageUrl(settings) {
  return settings.serverUrl ? settings.serverUrl + "/blocked" : "";
}

// The WebFilter block page lives on the WebFilter server at /blocked.
// The original address always goes last (the network-level redirect appends it unencoded).
function blockPage(ctx, params) {
  const { url, ...rest } = params;
  const query = new URLSearchParams(ctx.settings.workspaceName ? { ...rest, workspace: ctx.settings.workspaceName } : rest).toString();
  return (ctx.blockPageUrl || "about:blank") + "?" + query + (url !== undefined ? (query ? "&" : "") + "url=" + encodeURIComponent(url) : "");
}

/* ------------------------------------------------- redirect before load */
// Compiles the policy into declarativeNetRequest rules (priority mirrors the engine's order).
const ALL_PAGES = "^(https?://.*)$";
const SEP = "(?:[^a-z0-9]|%[0-9a-f]{2})";

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redirectTo(ctx, params) {
  const base = blockPage(ctx, params) + (Object.keys(params).length ? "&" : "") + "url=";
  return { type: "redirect", redirect: { regexSubstitution: base.replace(/\\/g, "\\\\") + "\\1" } };
}

function patternCondition(value, type) {
  const pattern = Engine.normalizePattern(value, type);
  if (!pattern) return null;
  if (pattern.type === "domain") return { regexFilter: ALL_PAGES, requestDomains: [pattern.value] };
  if (pattern.type === "keyword") return { regexFilter: "^(https?://.*" + escapeRegex(pattern.value) + ".*)$" };
  const prefix = pattern.value.replace(/^www\./, "");
  return { regexFilter: "^(https?://(?:www\\.)?" + escapeRegex(prefix) + "(?:[/?#].*)?)$" };
}

function blockDetails(verdict) {
  const { reason, rule } = verdict;
  if (!rule) return { reason };
  if (reason === "category-block") return { reason, category: rule.value };
  if (reason === "blocked-text") return { reason };
  return { reason, websiteId: Engine.blockedWebsiteId(rule.id, rule.value), until: rule.until || "" };
}

function compileRedirectRules(ctx) {
  const policy = Engine.normalizePolicy(ctx.policy);
  const klass = ctx.classId ? policy.classes.find(item => item.id === ctx.classId) || null : null;
  const global = Engine.effectiveGlobal(policy, ctx.classId);
  const rules = [];
  const add = (priority, action, condition) => {
    if (!condition) return;
    rules.push({ id: rules.length + 1, priority, action, condition: Object.assign({ resourceTypes: ["main_frame"], isUrlFilterCaseSensitive: false }, condition) });
  };
  const allow = { type: "allow" };
  let serverHost = "";
  try { serverHost = new URL(ctx.settings.serverUrl).hostname; } catch (error) { serverHost = ""; }
  if (serverHost) add(1000, allow, { requestDomains: [serverHost] });
  if (ctx.locked) {
    add(900, redirectTo(ctx, { mode: "lock", message: ctx.locked.message || "" }), { regexFilter: ALL_PAGES });
    return rules;
  }
  ctx.tempAllows.forEach(item => add(800, allow, patternCondition(item.pattern)));
  ctx.tempBlocks.forEach(item => add(700, redirectTo(ctx, { mode: "blocked", reason: "temporary", websiteId: Engine.blockedWebsiteId(item.id, item.pattern), until: String(item.until || "") }), patternCondition(item.pattern)));
  const ruleSet = (list, action, priority, reason) => list.filter(rule => rule.enabled !== false && rule.action === action).forEach(rule => {
    add(priority, action === "allow" ? allow : redirectTo(ctx, { mode: "blocked", reason, websiteId: Engine.blockedWebsiteId(rule.id, rule.value) }), patternCondition(rule.value, rule.type));
  });
  if (klass) { ruleSet(klass.rules, "block", 600, "class-block"); ruleSet(klass.rules, "allow", 500); }
  ruleSet(global.rules, "block", 400, "global-block");
  ruleSet(global.rules, "allow", 300);
  const phrases = Array.from(new Set(global.blockedText.concat(klass ? klass.blockedText : []).map(Engine.normalizePhrase).filter(Boolean)));
  phrases.forEach(phrase => {
    const words = phrase.split(" ").map(escapeRegex);
    add(250, redirectTo(ctx, { mode: "blocked", reason: "blocked-text" }), { regexFilter: "^(https?://.*?" + SEP + words.join(SEP + "+") + "(?:" + SEP + "|$).*)$" });
  });
  const blocked = Array.from(new Set(global.blockedCategories.concat(klass ? klass.blockedCategories : [])));
  const overrides = Engine.categoryOverridesOf(policy);
  blocked.filter(category => category !== "unrated").forEach(category => {
    const domains = Engine.categoryDomains(category, policy);
    if (domains.length) add(200, redirectTo(ctx, { mode: "blocked", reason: "category-block", category }), { regexFilter: ALL_PAGES, requestDomains: domains });
    if (category === "education") add(200, redirectTo(ctx, { mode: "blocked", reason: "category-block", category }), { regexFilter: "^(https?://[^/:]*\\.(?:edu|(?:edu|ac|sch)\\.[a-z]{2})(?::\\d+)?(?:[/?#].*)?)$" });
    if (category === "government") add(200, redirectTo(ctx, { mode: "blocked", reason: "category-block", category }), { regexFilter: "^(https?://[^/:]*\\.(?:gov|mil|(?:gov|gob|gouv|govt)\\.[a-z]{2})(?::\\d+)?(?:[/?#].*)?)$" });
  });
  // A custom category can move a subdomain out of a blocked category.
  const movedOut = Object.entries(overrides).filter(([, category]) => !blocked.includes(category)).map(([domain]) => domain);
  if (movedOut.length && blocked.length) add(210, allow, { requestDomains: movedOut });
  if (blocked.includes("unrated")) {
    add(150, allow, { requestDomains: Engine.categorizedDomains(policy) });
    if (!blocked.includes("education")) add(150, allow, { regexFilter: "^https?://[^/:]*\\.(?:edu|(?:edu|ac|sch)\\.[a-z]{2})(?::\\d+)?(?:[/?#]|$)" });
    if (!blocked.includes("government")) add(150, allow, { regexFilter: "^https?://[^/:]*\\.(?:gov|mil|(?:gov|gob|gouv|govt)\\.[a-z]{2})(?::\\d+)?(?:[/?#]|$)" });
    add(100, redirectTo(ctx, { mode: "blocked", reason: "category-block", category: "unrated" }), { regexFilter: ALL_PAGES });
  }
  if (policy.global.allowlistOnly || (klass && klass.allowlistOnly)) {
    add(90, redirectTo(ctx, { mode: "blocked", reason: "allowlist-only" }), { regexFilter: ALL_PAGES });
  }
  return rules;
}

function compileSiteModeRules(ctx, firstId) {
  const { safeModes } = Engine.effectiveSiteControls(ctx.policy, ctx.classId);
  const rules = [];
  const forceParam = (key, value, match, resourceTypes) => {
    rules.push({
      id: firstId + rules.length,
      priority: 80,
      action: { type: "redirect", redirect: { transform: { queryTransform: { addOrReplaceParams: [{ key, value }] } } } },
      condition: { ...match, resourceTypes, requestMethods: ["get"] },
    });
  };
  if (safeModes.includes("google")) {
    forceParam("safe", "active", { regexFilter: Engine.GOOGLE_SEARCH_FILTER }, ["main_frame", "sub_frame", "xmlhttprequest"]);
  }
  if (safeModes.includes("munetios")) {
    forceParam("schoolMode", "true", { requestDomains: ["munetios.com"] }, ["main_frame", "sub_frame"]);
  }
  if (safeModes.includes("youtube")) {
    for (const frameCondition of [{ resourceTypes: ["main_frame"] }, { excludedResourceTypes: ["main_frame"] }]) {
      rules.push({
        id: firstId + rules.length,
        priority: 1100,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "YouTube-Restrict", operation: "set", value: "Strict" }] },
        condition: { requestDomains: Engine.YOUTUBE_RESTRICT_DOMAINS, ...frameCondition },
      });
    }
  }
  return rules;
}

function syncRedirectRules() {
  ruleSync = ruleSync.catch(() => {}).then(updateRedirectRules);
  return ruleSync;
}

async function updateRedirectRules() {
  if (!chrome.declarativeNetRequest) return;
  const context = await getContext();
  const redirects = context.blockPageUrl ? compileRedirectRules(context) : [];
  const modeRules = compileSiteModeRules(context, redirects.length + 1);
  const hasYouTubeHeader = rules => rules.some(rule => rule.action.requestHeaders?.some(header => header.header.toLowerCase() === "youtube-restrict"));
  let existing = [];
  try {
    existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map(rule => rule.id), addRules: redirects.concat(modeRules) });
  } catch (error) {
    // Too many or invalid rules: the navigation listener below still enforces everything.
    console.warn("Munetios WebFilter: redirect rules not applied", error);
    try {
      existing = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map(rule => rule.id), addRules: modeRules });
    } catch (ignored) { return false; }
  }
  return hasYouTubeHeader(existing) !== hasYouTubeHeader(modeRules);
}

function isBlockPage(url, ctx) {
  return Engine.isBlockPage(url, ctx.blockPageUrl);
}

function isOwnPage(url) {
  return String(url || "").startsWith(chrome.runtime.getURL(""));
}

function isWebUrl(url) {
  return /^https?:/i.test(String(url || ""));
}

function isLockPage(url, ctx) {
  return isBlockPage(url, ctx) && new URL(url).searchParams.get("mode") === "lock";
}

// Returns true when the tab was sent to a WebFilter page.
async function enforce(tabId, url, ctx, applySiteModes = true) {
  const context = ctx || (await getContext());
  if (!isWebUrl(url) || isBlockPage(url, context)) return false;
  if (context.locked) {
    const current = await getContext();
    if (!current.locked) return false;
    await chrome.tabs.update(tabId, { url: blockPage(current, { mode: "lock", message: current.locked.message || "", url }) }).catch(() => {});
    return true;
  }
  const verdict = Engine.evaluateAccess(url, context.policy, context);
  if (!verdict.blocked) {
    if (!applySiteModes) return false;
    const forcedUrl = Engine.forcedSafeUrl(url, Engine.effectiveSiteControls(context.policy, context.classId).safeModes);
    if (!forcedUrl) return false;
    // Declarative rules cover requests. This also covers same-document navigations and
    // pages explicitly allowed by a higher-priority rule.
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url === url && !tab.pendingUrl) await chrome.tabs.update(tabId, { url: forcedUrl }).catch(() => {});
    return true;
  }
  await removeInjected(tabId, 0);
  await chrome.tabs.update(tabId, {
    url: blockPage(context, { mode: "blocked", url, ...blockDetails(verdict) }),
  }).catch(() => {});
  return true;
}

async function removeInjected(tabId, frameId) {
  const key = tabId + ":" + frameId;
  const previous = injected.get(key);
  if (!previous) return;
  injected.delete(key);
  await chrome.scripting.removeCSS({ target: { tabId, frameIds: [frameId] }, css: previous, origin: "AUTHOR" }).catch(() => {});
}

// Serializes CSS work per tab so overlapping navigations never double-inject.
function queueTab(tabId, task) {
  const previous = tabQueues.get(tabId) || Promise.resolve();
  const next = previous.then(task, task);
  tabQueues.set(tabId, next.catch(() => {}));
  return next;
}

function applyToTab(tabId, frameId, url) {
  return queueTab(tabId, async () => {
    const ctx = await getContext();
    // The block page is a WebFilter restricted page: never styled.
    if (isBlockPage(url, ctx)) { await removeInjected(tabId, frameId); return { restricted: true }; }
    if (await enforce(tabId, url, ctx)) return { restricted: true };
    const page = Engine.computePageStyles(url, ctx.policy, ctx);
    await removeInjected(tabId, frameId);
    // Restricted pages never get UserCSS (they are redirected above); Blocked URLs load unstyled.
    if (page.mode === "restricted") return { restricted: true, mode: page.mode };
    const { integrityFailed = {} } = await chrome.storage.session.get("integrityFailed").catch(() => ({}));
    const userCss = integrityFailed[tabId] === url ? "" : page.css;
    const css = Engine.fontFaceCss(FONT_URL) + userCss;
    try {
      await chrome.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, css, origin: "AUTHOR" });
      injected.set(tabId + ":" + frameId, css);
    } catch (error) {
      return { restricted: false, mode: page.mode, error: String(error && error.message || error) };
    }
    const phrases = page.textFilter.phrases;
    chrome.tabs.sendMessage(tabId, { type: "mwf:text-filter", phrases }, { frameId }).catch(() => {});
    return { restricted: false, mode: page.mode, usesGoogleSansFlex: !!(userCss && page.usesGoogleSansFlex), stripped: page.violations.length, phrases };
  });
}

function blockedTarget(url) {
  // The original address is the last parameter (unencoded when added by a redirect rule).
  const text = String(url || "");
  const at = text.search(/[?&]url=/);
  if (at < 0) return "";
  let value = text.slice(at + 5);
  if (/^https?%3A/i.test(value)) { try { value = decodeURIComponent(value); } catch (error) { /* keep */ } }
  return value;
}

async function refreshAllTabs() {
  const youtubeModeChanged = await syncRedirectRules();
  const ctx = await getContext();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async tab => {
    if (tab.id && isBlockPage(tab.url, ctx) && !ctx.locked && /[?&]mode=blocked/.test(tab.url)) {
      const target = blockedTarget(tab.url);
      if (isWebUrl(target) && !Engine.evaluateAccess(target, ctx.policy, ctx).blocked) await chrome.tabs.update(tab.id, { url: target }).catch(() => {});
      return;
    }
    if (!tab.id || !isWebUrl(tab.url) || isBlockPage(tab.url, ctx)) return;
    if (await enforce(tab.id, tab.url, ctx)) return;
    if (youtubeModeChanged && Engine.YOUTUBE_RESTRICT_DOMAINS.some(domain => Engine.hostMatches(Engine.parseUrl(tab.url)?.hostname, domain))) {
      await chrome.tabs.reload(tab.id).catch(() => {});
      return;
    }
    await applyToTab(tab.id, 0, tab.url);
  }));
}

chrome.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId === 0) enforce(details.tabId, details.url, null, false);
});
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0 && isWebUrl(details.url)) applyToTab(details.tabId, 0, details.url);
});
chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId === 0) applyToTab(details.tabId, 0, details.url);
  if (Engine.YOUTUBE_VIDEO_DOMAINS.some(domain => Engine.hostMatches(Engine.parseUrl(details.url)?.hostname, domain))) {
    chrome.tabs.sendMessage(details.tabId, { type: "mwf:youtube-navigated" }, { frameId: details.frameId, documentId: details.documentId }).catch(() => {});
  }
});
function rememberWebTab(tab) {
  if (tab && tab.id != null && isWebUrl(tab.url)) chrome.storage.session.set({ lastWebTabId: tab.id }).catch(() => {});
}
chrome.tabs.onActivated.addListener(({ tabId }) => { chrome.tabs.get(tabId).then(rememberWebTab, () => {}); });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === "complete" && tab.active) rememberWebTab(tab); });

chrome.tabs.onRemoved.addListener(tabId => {
  injected.delete(tabId + ":0");
  tabQueues.delete(tabId);
});

/* --------------------------------------------------------------- server */

async function api(settings, route, init) {
  const response = await fetch(settings.serverUrl + "/api/webfilter/orgs/" + encodeURIComponent(settings.orgId) + route, Object.assign({
    credentials: "omit",
    cache: "no-store",
  }, init, {
    headers: Object.assign({ "Content-Type": "application/json", "X-WebFilter-Enroll": settings.enrollToken }, (init && init.headers) || {}),
  }));
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

function connected(settings) {
  return !!(settings.serverUrl && settings.orgId && settings.enrollToken);
}

async function syncPolicy() {
  const settings = await getSettings();
  if (!connected(settings)) throw new Error("not-configured");
  const result = await api(settings, "/policy", { method: "GET" });
  if (result.policy) {
    await chrome.storage.local.set({ policy: result.policy, policyVersion: result.version, ...(typeof result.workspaceName === "string" ? { workspaceName: result.workspaceName } : {}), lastSync: Date.now(), lastError: "" });
    await refreshAllTabs();
  } else {
    await chrome.storage.local.set({ lastSync: Date.now(), lastError: "" });
  }
  return result.version;
}

async function profileEmail() {
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
    return info && info.email ? info.email : "";
  } catch (error) {
    return "";
  }
}

// Real device names on managed Chromebooks (asset ID, hostname, location set in the Admin console).
async function deviceAttributes() {
  const api = chrome.enterprise && chrome.enterprise.deviceAttributes;
  if (!api) return {};
  const call = name => new Promise(resolve => {
    try { api[name](value => resolve(chrome.runtime.lastError ? "" : value || "")); } catch (error) { resolve(""); }
  });
  return { hostname: await call("getDeviceHostname"), assetId: await call("getDeviceAssetId"), location: await call("getDeviceAnnotatedLocation") };
}

// A small picture of the visible tab for Remote Devices.
async function captureScreen(tab) {
  if (!tab || tab.windowId == null) return "";
  try {
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
    const bitmap = await createImageBitmap(await (await fetch(shot)).blob());
    const scale = Math.min(1, 960 / bitmap.width);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.6 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return "data:image/jpeg;base64," + btoa(binary);
  } catch (error) {
    return "";
  }
}

let heartbeatInFlight;
let commandWatch;
function heartbeat() {
  if (!heartbeatInFlight) heartbeatInFlight = sendHeartbeat().finally(() => { heartbeatInFlight = null; });
  return heartbeatInFlight;
}

function watchRemoteCommands() {
  if (!commandWatch) commandWatch = waitForRemoteCommands().catch(() => {}).finally(() => { commandWatch = null; });
}

async function waitForRemoteCommands() {
  while (true) {
    const settings = await getSettings();
    if (!connected(settings)) return;
    const deviceId = settings.deviceId || (await ensureDeviceId());
    const update = await api(settings, "/devices/" + encodeURIComponent(deviceId) + "/command-ready", { signal: AbortSignal.timeout(25000) });
    if (typeof update.ready !== "boolean") return;
    if (update.ready && !(await heartbeat()).ok) return;
  }
}

async function sendHeartbeat() {
  const settings = await getSettings();
  if (!connected(settings)) return { ok: false, reason: "not-configured" };
  const deviceId = settings.deviceId || (await ensureDeviceId());
  const [tabs, active, local] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    chrome.storage.local.get(["policyVersion", "locked", "tempBlocks"]),
  ]);
  const activeTab = active[0] || tabs.find(tab => tab.active) || null;
  const platform = await chrome.runtime.getPlatformInfo().catch(() => ({ os: "" }));
  const [attributes, screen] = await Promise.all([deviceAttributes(), captureScreen(activeTab)]);
  try {
    const result = await api(settings, "/devices/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        deviceId,
        deviceName: settings.deviceName || attributes.assetId || attributes.hostname || "",
        reportedName: (settings.managed.deviceName ? settings.deviceName : "") || attributes.assetId || attributes.hostname || "",
        hostname: attributes.hostname || "",
        assetId: attributes.assetId || "",
        location: attributes.location || "",
        screen,
        user: settings.studentName || (await profileEmail()),
        classId: settings.classId,
        managedClassId: settings.managed.classId ? settings.classId : "",
        version: chrome.runtime.getManifest().version,
        platform: platform.os || "",
        activeUrl: activeTab ? activeTab.url || "" : "",
        activeTitle: activeTab ? activeTab.title || "" : "",
        locked: !!local.locked,
        policyVersion: local.policyVersion || 0,
        tempBlocks: (local.tempBlocks || []).filter(block => !block.until || block.until > Date.now()),
        tabs: tabs.filter(tab => Number.isInteger(tab.id)).map(tab => ({ id: tab.id, url: tab.url || "", title: tab.title || "", active: !!tab.active })),
      }),
    });
    await chrome.storage.local.set({
      lastHeartbeat: Date.now(), lastError: "",
      ...(typeof result.workspaceName === "string" ? { workspaceName: result.workspaceName } : {}),
    });
    if (typeof result.workspaceName === "string" && result.workspaceName !== settings.workspaceName) await syncRedirectRules();
    if (result.assignment) {
      const { assignedClassId = "", assignedName = "" } = await chrome.storage.local.get(["assignedClassId", "assignedName"]);
      if (result.assignment.classId !== assignedClassId || result.assignment.name !== assignedName) {
        await chrome.storage.local.set({ assignedClassId: result.assignment.classId || "", assignedName: result.assignment.name || "" });
        await refreshAllTabs();
      }
    }
    if (result.policyVersion > (local.policyVersion || 0)) await syncPolicy().catch(() => {});
    if (Array.isArray(result.commands) && result.commands.length) {
      const results = [];
      for (const command of result.commands) results.push(await runCommand(command));
      await api(settings, "/devices/" + encodeURIComponent(deviceId) + "/ack", { method: "POST", body: JSON.stringify({ results }) }).catch(() => {});
    }
    return { ok: true };
  } catch (error) {
    await chrome.storage.local.set({ lastError: String(error && error.message || error) });
    return { ok: false, reason: String(error && error.message || error) };
  }
}

/* ------------------------------------------------------- remote actions */

async function lockDevice(message) {
  await chrome.storage.local.set({ locked: { message: message || "", at: Date.now() } });
  await syncRedirectRules();
  const ctx = await getContext();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    if (isWebUrl(tab.url) || tab.active) {
      const url = isLockPage(tab.url, ctx) ? blockedTarget(tab.url) : tab.url;
      await chrome.tabs.update(tab.id, { url: blockPage(ctx, { mode: "lock", message: message || "", url }) }).catch(() => {});
    }
  }
}

async function unlockDevice() {
  const { lockedTabs = {} } = await chrome.storage.local.get("lockedTabs");
  await chrome.storage.local.remove("locked");
  await syncRedirectRules();
  const ctx = await getContext();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    const page = tab.pendingUrl || tab.url;
    if (!isLockPage(page, ctx)) continue;
    const original = blockedTarget(page) || lockedTabs[tab.id];
    try {
      await chrome.tabs.update(tab.id, { url: isWebUrl(original) ? original : "chrome://newtab/" });
    } catch (error) {
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (current && isLockPage(current.pendingUrl || current.url, ctx)) throw error;
    }
  }
  await chrome.storage.local.remove("lockedTabs");
}

async function pushNotice(message) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && tab.id && isWebUrl(tab.url)) {
    try {
      const shown = await chrome.tabs.sendMessage(tab.id, { type: "mwf:notice", message });
      if (shown && shown.ok) return;
    } catch (error) {
      // No content script on this page; fall back to a notice tab.
    }
  }
  await chrome.tabs.create({ url: blockPage(await getContext(), { mode: "notice", message }), active: true });
}

async function runCommand(command) {
  try {
    const payload = command.payload || {};
    if (command.type === "lock") await lockDevice(payload.message);
    else if (command.type === "unlock") await unlockDevice();
    else if (command.type === "notice") await pushNotice(payload.message);
    else if (command.type === "sync") await syncPolicy();
    else if (command.type === "open_tab") await chrome.tabs.create({ url: payload.url, active: true });
    else if (command.type === "close_tab") await chrome.tabs.remove(Number(payload.tabId));
    else if (command.type === "temp_block") {
      const { tempBlocks = [] } = await chrome.storage.local.get("tempBlocks");
      const now = Date.now();
      const next = tempBlocks.filter(block => !block.until || block.until > now);
      next.push({ id: command.id, pattern: String(payload.pattern), until: now + Number(payload.minutes) * 60000 });
      await chrome.storage.local.set({ tempBlocks: next });
      await refreshAllTabs();
    } else if (command.type === "clear_temp_blocks") {
      await chrome.storage.local.set({ tempBlocks: [] });
      await refreshAllTabs();
    } else {
      return { id: command.id, ok: false, error: "unknownCommand" };
    }
    return { id: command.id, ok: true };
  } catch (error) {
    return { id: command.id, ok: false, error: String(error && error.message || error) };
  }
}

/* ------------------------------------------------------------ block page */
async function handleBlockPage(type, message, tab) {
  const ctx = await getContext();
  if (!isBlockPage(tab.url, ctx)) return null;
  const settings = ctx.settings;
  const target = blockedTarget(tab.url);
  if (type === "mwf:blocked-hello") {
    if (ctx.locked) return { available: false, workspaceName: settings.workspaceName };
    const verdict = isWebUrl(target) ? Engine.evaluateAccess(target, ctx.policy, ctx) : null;
    const available = connected(settings);
    const bypass = available && verdict?.blocked ? await api(settings, "/bypass", { method: "GET", signal: AbortSignal.timeout(700) }).catch(() => null) : null;
    return { available, bypassEnabled: bypass?.enabled === true, workspaceName: settings.workspaceName, ...(verdict ? blockDetails(verdict) : {}) };
  }
  if (ctx.locked || !connected(settings) || !isWebUrl(target)) return { ok: false, error: "unavailable" };
  const deviceId = settings.deviceId || (await ensureDeviceId());
  if (type === "mwf:blocked-bypass") {
    try {
      const result = await api(settings, "/bypass/verify", { method: "POST", body: JSON.stringify({ password: String(message.password || ""), url: target, deviceId }) });
      const host = new URL(target).hostname.replace(/^www\./, "");
      const { tempAllows = [] } = await chrome.storage.local.get("tempAllows");
      const now = Date.now();
      const next = tempAllows.filter(item => !item.until || item.until > now);
      next.push({ pattern: host, until: now + Number(result.minutes || 30) * 60000 });
      await chrome.storage.local.set({ tempAllows: next });
      await syncRedirectRules();
      await chrome.tabs.update(tab.id, { url: target }).catch(() => {});
      return { ok: true, minutes: result.minutes };
    } catch (error) {
      return { ok: false, error: /403/.test(String(error.message)) ? "wrong" : "unavailable" };
    }
  }
  if (type === "mwf:blocked-request") {
    try {
      const user = settings.studentName || (await profileEmail());
      const result = await api(settings, "/requests", { method: "POST", body: JSON.stringify({ deviceId, url: target, reason: String(message.reason || ""), user }) });
      return { ok: true, id: result.request.id };
    } catch (error) {
      return { ok: false, error: "unavailable" };
    }
  }
  if (type === "mwf:blocked-status") {
    try {
      const result = await api(settings, "/requests/" + encodeURIComponent(String(message.id || "")), { method: "GET", headers: { "X-WebFilter-Device": deviceId } });
      if (result.request.status === "approved") {
        await syncPolicy().catch(() => {});
        const fresh = await getContext();
        if (!Engine.evaluateAccess(target, fresh.policy, fresh).blocked) await chrome.tabs.update(tab.id, { url: target }).catch(() => {});
      }
      return { ok: true, status: result.request.status };
    } catch (error) {
      return { ok: false, error: "unavailable" };
    }
  }
  return null;
}

/* -------------------------------------------------------------- messages */

async function popupState() {
  const ctx = await getContext();
  const local = await chrome.storage.local.get(["lastSync", "lastHeartbeat", "lastError", "policyVersion"]);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const configuredName = ctx.settings.deviceName !== ctx.settings.deviceId ? ctx.settings.deviceName : "";
  const attributes = configuredName ? {} : await deviceAttributes();
  const deviceName = configuredName || attributes.assetId || attributes.hostname || "";
  let page = null;
  if (tab && isWebUrl(tab.url)) {
    const styles = Engine.computePageStyles(tab.url, ctx.policy, ctx);
    const controls = Engine.effectiveSiteControls(ctx.policy, ctx.classId);
    const videoUnavailable = controls.blockedYouTubeVideos.includes(Engine.youtubeVideoId(tab.url));
    page = { url: tab.url, blocked: styles.access.blocked, reason: styles.access.reason, mode: styles.mode, videoUnavailable };
  }
  const policy = Engine.normalizePolicy(ctx.policy);
  return {
    settings: Object.assign({}, ctx.settings, { enrollToken: undefined, deviceName }),
    connected: connected(ctx.settings),
    classes: policy.classes.map(item => ({ id: item.id, name: item.name })),
    locked: !!ctx.locked,
    lastSync: local.lastSync || 0,
    lastHeartbeat: local.lastHeartbeat || 0,
    lastError: local.lastError || "",
    policyVersion: local.policyVersion || policy.version || 0,
    version: chrome.runtime.getManifest().version,
    page,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message && message.type;
  if (sender.id === chrome.runtime.id && sender.tab && Engine.YOUTUBE_VIDEO_DOMAINS.some(domain => Engine.hostMatches(Engine.parseUrl(sender.url)?.hostname, domain))) {
    if (type === "mwf:youtube-policy") {
      getContext().then(ctx => sendResponse(Engine.effectiveSiteControls(ctx.policy, ctx.classId).blockedYouTubeVideos), () => sendResponse(null));
      return true;
    }
    if (type === "mwf:youtube-unavailable" && sender.documentId) {
      const videoId = Engine.youtubeVideoId(message.url);
      getContext().then(async ctx => {
        if (!videoId || !Engine.effectiveSiteControls(ctx.policy, ctx.classId).blockedYouTubeVideos.includes(videoId)) return false;
        const [execution] = await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
          world: "MAIN",
          args: [message.url, videoId],
          func: (url, id) => {
            if (location.href !== url) return false;
            const player = document.querySelector("ytd-reel-video-renderer[is-active] .html5-video-player")
              || document.querySelector("#movie_player, .html5-video-player");
            if (typeof player?.loadVideoById !== "function") return false;
            const currentId = player.getVideoData?.()?.video_id;
            if (currentId && currentId !== id) return false;
            // An impossible video ID makes YouTube's player render its own unavailable state.
            player.loadVideoById("___________");
            return true;
          },
        });
        return execution?.result === true;
      }).then(sendResponse, () => sendResponse(false));
      return true;
    }
  }
  if (type === "mwf:page" && sender.tab && sender.tab.id != null) {
    applyToTab(sender.tab.id, sender.frameId || 0, sender.url || message.url).then(sendResponse, () => sendResponse({ restricted: true }));
    return true;
  }
  if (type === "mwf:integrity" && sender.tab && sender.tab.id != null) {
    // A notice was hidden on this page: turn its UserCSS off until the next navigation.
    chrome.storage.session.get("integrityFailed").then(({ integrityFailed = {} }) => {
      integrityFailed[sender.tab.id] = sender.tab.url;
      return chrome.storage.session.set({ integrityFailed });
    }).then(() => applyToTab(sender.tab.id, 0, sender.tab.url)).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  // The block page talks to the extension through its content script.
  if (type && type.startsWith("mwf:blocked-") && sender.tab && sender.tab.id != null) {
    handleBlockPage(type, message, sender.tab).then(sendResponse, () => sendResponse(null));
    return true;
  }
  // Extension pages only (popup, UserCSS editor): content scripts on web pages can't change settings.
  if (sender.id !== chrome.runtime.id || (sender.tab && !isOwnPage(sender.url)) || (!sender.tab && sender.url && !isOwnPage(sender.url))) return false;
  if (type === "mwf:editor-state") {
    (async () => {
      const ctx = await getContext();
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      // In the side panel the active tab is the page; when the editor is open in its own tab,
      // use the website tab the student was last on.
      let web = tab && isWebUrl(tab.url) ? tab : null;
      if (!web) {
        const { lastWebTabId } = await chrome.storage.session.get("lastWebTabId").catch(() => ({}));
        if (lastWebTabId != null) web = await chrome.tabs.get(lastWebTabId).catch(() => null);
        if (web && !isWebUrl(web.url)) web = null;
      }
      sendResponse({
        policy: ctx.policy,
        classId: ctx.classId,
        blockPageUrl: ctx.blockPageUrl,
        extensionId: chrome.runtime.id,
        injectUserCss: ctx.injectUserCss,
        userStyles: ctx.userStyles,
        tab: web ? { id: web.id, url: web.url, title: web.title || "" } : null,
      });
    })();
    return true;
  }
  if (type === "mwf:pick-start" || type === "mwf:pick-stop") {
    chrome.tabs.sendMessage(Number(message.tabId), { type }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (type === "mwf:popup-state") {
    popupState().then(sendResponse);
    return true;
  }
  if (type === "mwf:sync") {
    (async () => {
      let ok = true;
      try { await syncPolicy(); } catch (error) { ok = false; await chrome.storage.local.set({ lastError: String(error && error.message || error) }); }
      const beat = await heartbeat();
      sendResponse(Object.assign(await popupState(), { ok: ok && beat.ok }));
    })();
    return true;
  }
  return false;
});

/* ------------------------------------------------------------- lifecycle */

async function start() {
  await ensureDeviceId();
  await getPolicy();
  await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  await refreshAllTabs();
  await syncPolicy().catch(() => {});
  await heartbeat();
  watchRemoteCommands();
}

chrome.runtime.onInstalled.addListener(() => { start(); });
chrome.runtime.onStartup.addListener(() => { start(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === HEARTBEAT_ALARM) heartbeat().finally(watchRemoteCommands);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "managed") refreshAllTabs().then(heartbeat).finally(watchRemoteCommands);
  // The UserCSS editor saves as the student types: apply the change to open pages right away.
  if (area === "local" && (changes.userStyles || changes.injectUserCss)) refreshAllTabs();
});
