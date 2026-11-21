/* Munetios WebFilter extension: UserCSS editor (side panel, or a tab where side panels aren't available).
 * - Students and teachers write their own styles; nothing runs until "Inject UserCSS" is on.
 * - Every keystroke is saved, and the service worker re-applies it to open pages through the
 *   school's UserCSS policy, so the page next to the panel is the live preview.
 * - "Select an element" highlights elements on that page; a click inserts its selector here.
 * - Suggestions follow the policy for the current page (Partially blocked pages only offer
 *   the properties that are kept), and the report lists everything the policy removed.
 */
(() => {
  "use strict";
  const Engine = self.MunetiosWebFilterEngine;
  const msg = (key, vars, fallback) => {
    let text = chrome.i18n.getMessage(key) || fallback || key;
    if (vars) text = text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] == null ? m : String(vars[name])));
    return text;
  };
  const $ = id => document.getElementById(id);
  document.documentElement.lang = chrome.i18n.getUILanguage() || "en";
  document.querySelectorAll("[data-i18n]").forEach(node => { node.textContent = msg(node.dataset.i18n, null, node.textContent); });

  const state = { policy: null, classId: "", blockPageUrl: "", extensionId: "", inject: false, styles: [], tab: null, currentId: "", picking: false };

  /* ------------------------------------------------------------- storage */
  const send = message => chrome.runtime.sendMessage(message).catch(() => null);
  let saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    $("mwfSaved").textContent = "";
    saveTimer = setTimeout(async () => {
      saveTimer = 0;
      await chrome.storage.local.set({ userStyles: state.styles });
      $("mwfSaved").textContent = msg("ext_saved", null, "Saved");
    }, 350);
  }

  function current() { return state.styles.find(style => style.id === state.currentId) || null; }

  function siteOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (error) { return ""; }
  }

  /* ------------------------------------------------------------- policy */
  function pageMode() {
    if (!state.tab || !state.policy) return null;
    return Engine.resolveUserCssMode(state.tab.url, state.policy, { classId: state.classId, blockPageUrl: state.blockPageUrl });
  }

  const MODE_TEXT = {
    allowed: () => msg("ext_mode_allowed", null, "Full UserCSS"),
    partial: () => msg("ext_mode_partial", null, "Colors and text style only"),
    blocked: () => msg("ext_mode_blocked", null, "Not applied"),
    restricted: () => msg("ext_mode_restricted", null, "Not applied on restricted pages"),
  };

  function renderPageMode() {
    const box = $("mwfPageMode");
    const mode = pageMode();
    if (!state.tab) { box.textContent = msg("ext_open_site", null, "Open a website to try your styles on it."); return; }
    const site = siteOf(state.tab.url);
    box.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = msg("ext_page_mode", { site }, "On " + site);
    const detail = document.createElement("span");
    detail.textContent = MODE_TEXT[mode.mode]() + (state.inject ? "" : " · " + msg("ext_inject_off_note", null, "Turn on Inject UserCSS to see your styles."));
    box.append(title, detail);
  }

  function renderReport() {
    const style = current();
    const panel = $("mwfReportPanel");
    const list = $("mwfReport");
    if (!style || !state.tab || !state.policy) { panel.hidden = true; return; }
    const mode = pageMode().mode;
    const ctx = { classId: state.classId };
    const result = Engine.sanitizeCss(style.css, {
      mode,
      extensionId: state.extensionId,
      isExternalAllowed: url => Engine.isOnAllowedWebsiteList(url, state.policy, ctx),
    });
    panel.hidden = false;
    list.textContent = "";
    if (!result.violations.length) {
      const li = document.createElement("li");
      li.textContent = msg("ext_nothing_removed", null, "Nothing was removed.");
      list.append(li);
      return;
    }
    result.violations.forEach(item => {
      const li = document.createElement("li");
      li.textContent = msg("v_" + item.code.replace(/-/g, "_"), null, item.code);
      const code = document.createElement("span");
      code.className = "mwf-code-line";
      code.textContent = msg("ext_line", { line: item.line || 1 }, "Line " + (item.line || 1)) + [item.property ? item.property + (item.value ? ": " + item.value : "") : item.value, item.url].filter(Boolean).map(text => " · " + text).join("");
      li.append(code);
      list.append(li);
    });
  }

  /* ------------------------------------------------------------- styles */
  function renderStyles() {
    const select = $("mwfStyleSelect");
    select.textContent = "";
    state.styles.forEach(style => select.add(new Option(style.name || msg("ext_untitled", null, "Untitled style"), style.id)));
    if (!current() && state.styles.length) state.currentId = state.styles[0].id;
    select.value = state.currentId;
    select.disabled = !state.styles.length;
    $("mwfDeleteStyle").disabled = !state.styles.length;
    $("mwfNoStyles").hidden = !!state.styles.length;
    const style = current();
    $("mwfStyleFields").hidden = !style;
    if (style) {
      $("mwfName").value = style.name || "";
      $("mwfTargets").value = (style.targets || []).join(", ");
      $("mwfEnabled").checked = style.enabled !== false;
      if ($("mwfCss").value !== style.css) $("mwfCss").value = style.css;
    }
    renderReport();
  }

  function renderAll() {
    $("mwfInject").checked = state.inject;
    renderPageMode();
    renderStyles();
  }

  async function load() {
    const data = await send({ type: "mwf:editor-state" });
    if (!data) return;
    state.policy = data.policy;
    state.classId = data.classId;
    state.blockPageUrl = data.blockPageUrl;
    state.extensionId = data.extensionId;
    state.inject = !!data.injectUserCss;
    // Never overwrite keystrokes that haven't been saved yet.
    if (!saveTimer) state.styles = Array.isArray(data.userStyles) ? data.userStyles : [];
    state.tab = data.tab;
    renderAll();
  }

  $("mwfInject").addEventListener("change", async event => {
    state.inject = event.target.checked;
    await chrome.storage.local.set({ injectUserCss: state.inject });
    renderPageMode();
  });

  $("mwfStyleSelect").addEventListener("change", event => { state.currentId = event.target.value; renderStyles(); });

  $("mwfNewStyle").addEventListener("click", () => {
    const site = state.tab ? siteOf(state.tab.url) : "";
    const style = { id: Engine.createId("ustyle"), name: site || msg("ext_untitled", null, "Untitled style"), targets: site ? [site] : [], css: "", enabled: true, createdAt: Date.now() };
    state.styles.push(style);
    state.currentId = style.id;
    renderStyles();
    saveSoon();
    $("mwfCss").focus();
  });

  $("mwfDeleteStyle").addEventListener("click", () => {
    const style = current();
    if (!style || !confirm(msg("ext_delete_confirm", null, "Delete this style?"))) return;
    state.styles = state.styles.filter(item => item.id !== style.id);
    state.currentId = state.styles[0] ? state.styles[0].id : "";
    renderStyles();
    saveSoon();
  });

  $("mwfName").addEventListener("input", event => {
    const style = current();
    if (!style) return;
    style.name = event.target.value;
    const option = $("mwfStyleSelect").selectedOptions[0];
    if (option) option.textContent = style.name || msg("ext_untitled", null, "Untitled style");
    saveSoon();
  });

  $("mwfTargets").addEventListener("input", event => {
    const style = current();
    if (!style) return;
    style.targets = event.target.value.split(/[\s,]+/).map(item => item.trim()).filter(item => item && Engine.normalizePattern(item)).map(item => Engine.normalizePattern(item).value);
    saveSoon();
  });

  $("mwfEnabled").addEventListener("change", event => {
    const style = current();
    if (!style) return;
    style.enabled = event.target.checked;
    saveSoon();
  });

  /* ------------------------------------------------------------- picker */
  async function setPicking(on) {
    if (on && !state.tab) { $("mwfSaved").textContent = msg("ext_pick_failed", null, "Open a website in this tab to select an element."); return; }
    state.picking = on;
    $("mwfPick").setAttribute("aria-pressed", String(on));
    if (state.tab) {
      const result = await send({ type: on ? "mwf:pick-start" : "mwf:pick-stop", tabId: state.tab.id });
      if (on && (!result || !result.ok)) {
        state.picking = false;
        $("mwfPick").setAttribute("aria-pressed", "false");
        $("mwfSaved").textContent = msg("ext_pick_failed", null, "Open a website in this tab to select an element.");
        return;
      }
    }
    if (on) $("mwfSaved").textContent = msg("ext_picking", null, "Click an element on the page. Press Escape to stop.");
  }

  $("mwfPick").addEventListener("click", () => setPicking(!state.picking));

  function insertSelector(selector) {
    const area = $("mwfCss");
    const before = area.value.replace(/\s+$/, "");
    const block = (before ? before + "\n\n" : "") + selector + " {\n  ";
    area.value = block + "\n}\n";
    area.focus();
    area.setSelectionRange(block.length, block.length);
    onCssInput();
    showSuggestions();
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || !message) return;
    if (message.type === "mwf:picked" && state.picking && sender.tab && state.tab && sender.tab.id === state.tab.id) {
      state.picking = false;
      $("mwfPick").setAttribute("aria-pressed", "false");
      $("mwfSaved").textContent = "";
      insertSelector(String(message.selector || ""));
    } else if (message.type === "mwf:pick-cancel") {
      state.picking = false;
      $("mwfPick").setAttribute("aria-pressed", "false");
      $("mwfSaved").textContent = "";
    }
  });

  /* ------------------------------------------------------------- editor */
  let reportTimer = 0;
  function onCssInput() {
    const style = current();
    if (!style) return;
    style.css = $("mwfCss").value;
    saveSoon();
    clearTimeout(reportTimer);
    reportTimer = setTimeout(renderReport, 150);
  }

  const suggest = { items: [], index: 0, context: null };

  function cssContext(text, caret) {
    const before = text.slice(0, caret);
    const clean = before.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, m => " ".repeat(m.length));
    if ((clean.match(/\{/g) || []).length <= (clean.match(/\}/g) || []).length) return null;
    const last = Math.max(clean.lastIndexOf("{"), clean.lastIndexOf(";"));
    const segment = before.slice(last + 1);
    if (/[{}]/.test(segment)) return null;
    const colon = segment.indexOf(":");
    if (colon < 0) {
      const prefix = segment.trimStart();
      return /^[-a-z]*$/i.test(prefix) ? { kind: "property", prefix, start: caret - prefix.length } : null;
    }
    const prefix = segment.slice(colon + 1).replace(/^\s+/, "");
    if (/!important/i.test(prefix)) return null;
    return { kind: "value", property: segment.slice(0, colon).trim().toLowerCase(), prefix, start: caret - prefix.length };
  }

  function caretPoint(area, position) {
    const mirror = document.createElement("div");
    const styles = getComputedStyle(area);
    ["boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "tabSize"].forEach(prop => { mirror.style[prop] = styles[prop]; });
    Object.assign(mirror.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre", top: "0", left: "-9999px" });
    mirror.textContent = area.value.slice(0, position);
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.append(marker);
    document.body.append(mirror);
    const rect = area.getBoundingClientRect();
    const point = { left: rect.left + marker.offsetLeft - area.scrollLeft, top: rect.top + marker.offsetTop - area.scrollTop + (parseFloat(styles.lineHeight) || 29) };
    mirror.remove();
    return point;
  }

  function showSuggestions() {
    const area = $("mwfCss");
    const box = $("mwfSuggest");
    const context = document.activeElement === area && area.selectionStart === area.selectionEnd ? cssContext(area.value, area.selectionStart) : null;
    if (!context) return hideSuggestions();
    const mode = pageMode() ? pageMode().mode : "allowed";
    let items;
    if (context.kind === "property") {
      items = Engine.propertySuggestions(context.prefix, mode).map(item => ({ text: item.name, allowed: item.allowed, partial: item.partial }));
      if (items.length === 1 && items[0].text === context.prefix) items = [];
    } else {
      const blocked = mode === "partial" && !Engine.PARTIAL_PROPERTIES.includes(context.property);
      items = Engine.valueSuggestions(context.property, context.prefix).map(text => ({ text, allowed: !blocked }));
    }
    if (!items.length) return hideSuggestions();
    suggest.items = items;
    suggest.context = context;
    suggest.index = Math.max(0, items.findIndex(item => item.allowed));
    box.textContent = "";
    items.forEach((item, index) => {
      const option = document.createElement("div");
      option.className = "mwf-option" + (index === suggest.index ? " is-active" : "") + (item.allowed ? "" : " is-blocked");
      option.id = "mwfSuggest-" + index;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === suggest.index));
      if (!item.allowed) option.setAttribute("aria-disabled", "true");
      const label = document.createElement("span");
      label.textContent = item.text;
      option.append(label);
      if (!item.allowed || (mode === "partial" && item.partial)) {
        const tag = document.createElement("small");
        tag.className = item.allowed ? "is-good" : "is-bad";
        tag.textContent = item.allowed ? msg("ext_permitted", null, "Permitted") : msg("ext_blocked_by_policy", null, "Blocked by policy");
        option.append(tag);
      }
      option.addEventListener("mousedown", event => event.preventDefault());
      option.addEventListener("click", () => accept(index));
      box.append(option);
    });
    const point = caretPoint(area, context.start);
    const width = Math.min(360, window.innerWidth - 24);
    box.style.width = width + "px";
    box.style.left = Math.max(12, Math.min(point.left, window.innerWidth - width - 12)) + "px";
    box.style.top = (point.top + 270 > window.innerHeight ? Math.max(12, point.top - 300) : point.top + 4) + "px";
    box.hidden = false;
    area.setAttribute("aria-expanded", "true");
    area.setAttribute("aria-activedescendant", "mwfSuggest-" + suggest.index);
  }

  function hideSuggestions() {
    $("mwfSuggest").hidden = true;
    $("mwfCss").setAttribute("aria-expanded", "false");
    $("mwfCss").removeAttribute("aria-activedescendant");
    suggest.items = [];
  }

  function move(step) {
    let next = suggest.index;
    for (let i = 0; i < suggest.items.length; i++) {
      next = (next + step + suggest.items.length) % suggest.items.length;
      if (suggest.items[next].allowed) break;
    }
    suggest.index = next;
    Array.from($("mwfSuggest").children).forEach((option, index) => {
      option.classList.toggle("is-active", index === next);
      option.setAttribute("aria-selected", String(index === next));
      if (index === next) option.scrollIntoView({ block: "nearest" });
    });
    $("mwfCss").setAttribute("aria-activedescendant", "mwfSuggest-" + next);
  }

  function accept(index) {
    const item = suggest.items[index];
    const area = $("mwfCss");
    if (!item) return;
    if (!item.allowed) { $("mwfSaved").textContent = msg("ext_blocked_by_policy", null, "Blocked by policy") + ": " + item.text; return; }
    const context = suggest.context;
    const insert = context.kind === "property" ? item.text + ": " : item.text + ";";
    area.value = area.value.slice(0, context.start) + insert + area.value.slice(area.selectionStart);
    const caret = context.start + insert.length;
    area.setSelectionRange(caret, caret);
    area.focus();
    onCssInput();
    if (context.kind === "property") showSuggestions(); else hideSuggestions();
  }

  const area = $("mwfCss");
  area.addEventListener("input", () => { onCssInput(); showSuggestions(); });
  area.addEventListener("click", showSuggestions);
  area.addEventListener("blur", () => setTimeout(hideSuggestions, 120));
  area.addEventListener("scroll", hideSuggestions);
  area.addEventListener("keydown", event => {
    const open = !$("mwfSuggest").hidden && suggest.items.length;
    if (open && event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (open && event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    // Tab accepts a suggestion. Enter always starts a new line.
    else if (open && event.key === "Tab") { event.preventDefault(); accept(suggest.index); }
    else if (open && event.key === "Enter") { hideSuggestions(); }
    else if (open && event.key === "Escape") { event.preventDefault(); hideSuggestions(); }
    else if (event.key === " " && (event.ctrlKey || event.metaKey)) { event.preventDefault(); showSuggestions(); }
  });

  /* ------------------------------------------------------------- follow the active tab */
  chrome.tabs.onActivated.addListener(() => load());
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url || info.status === "complete") load(); });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.policy) load();
  });

  load();
})();
