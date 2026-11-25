/*!
 * Munetios WebFilter extension: content script (document_start, top frame)
 * - Asks the service worker to apply the font + sanitized UserCSS for this page.
 *   Restricted pages are never styled.
 * - Local font fallback: if the page CSP stops the injected @font-face, the bundled
 *   font is loaded as an ArrayBuffer through the FontFace API, which
 *   never touches the network or the page's font-src.
 * - Blocked text: removes blocked words or phrases as students type or paste them,
 *   and stops forms that still contain them. Password fields are never read, and
 *   typed text never leaves the device. Websites on an allow rule get no list.
 * - Shows WebFilter notices in a closed shadow root in the top layer, and turns
 *   UserCSS off for the page if anything manages to hide a notice.
 */
(() => {
  "use strict";
  if (window.top !== window || window.__munetiosWebFilter) return;
  window.__munetiosWebFilter = true;

  const FAMILY = "Munetios UI v4 Font";
  const fontPromises = new Map();

  function loadBundledFont(family = FAMILY) {
    if (fontPromises.has(family)) return fontPromises.get(family);
    const fontPath = Engine.BUNDLED_FONTS[family];
    if (!fontPath) return Promise.resolve(false);
    const promise = (async () => {
      try {
        const ready = await document.fonts.load('400 18px "' + family + '"');
        if (ready && ready.length) return true;
      } catch (error) {
        // Fall through to the ArrayBuffer path.
      }
      try {
        const response = await fetch(chrome.runtime.getURL(fontPath));
        const face = new FontFace(family, await response.arrayBuffer(), {
          weight: "1 1000",
          stretch: "25% 151%",
          style: "normal",
          display: "swap",
        });
        await face.load();
        document.fonts.add(face);
        return true;
      } catch (error) {
        return false;
      }
    })();
    fontPromises.set(family, promise);
    return promise;
  }

  async function applyPage() {
    let result = null;
    try {
      result = await chrome.runtime.sendMessage({ type: "mwf:page", url: location.href });
    } catch (error) {
      return;
    }
    if (!result || result.restricted) return;
    setPhrases(result.phrases);
    for (const family of result.fonts || []) loadBundledFont(family);
  }

  /* ---------------------------------------------------------- blocked text */
  const Engine = window.MunetiosWebFilterEngine;
  let phrases = [];
  let lastTextNotice = 0;
  const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", ""]);

  function setPhrases(list) {
    phrases = Array.isArray(list) ? list.filter(item => typeof item === "string" && item) : [];
  }

  function editableTarget(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.closest("munetios-webfilter-notice")) return null;
    if (node.tagName === "TEXTAREA") return node;
    if (node.tagName === "INPUT") return TEXT_INPUTS.has((node.getAttribute("type") || "").toLowerCase()) ? node : null;
    const editable = node.closest("[contenteditable]:not([contenteditable=\"false\"])");
    return editable && editable.isContentEditable ? editable : null;
  }

  function setNativeValue(field, value) {
    const proto = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(field, value);
    // Let frameworks (React, Vue...) see the cleaned value.
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function cleanContentEditable(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let changed = false;
    while ((node = walker.nextNode())) {
      const cleaned = Engine.stripBlockedText(node.nodeValue, phrases);
      if (cleaned !== node.nodeValue.normalize("NFKC")) { node.nodeValue = cleaned; changed = true; }
    }
    // A phrase split across nodes: fall back to cleaning the whole text.
    if (!changed && Engine.findBlockedText(root.textContent, phrases)) {
      root.textContent = Engine.stripBlockedText(root.textContent, phrases);
      changed = true;
    }
    if (changed) {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      const selection = getSelection();
      if (selection) { selection.removeAllRanges(); selection.addRange(range); }
    }
    return changed;
  }

  function textBlockedNotice() {
    if (Date.now() - lastTextNotice < 3000) return;
    lastTextNotice = Date.now();
    showNotice(chrome.i18n.getMessage("ext_text_blocked_body") || "That text isn't allowed by your school's WebFilter, so it was removed.", {
      title: chrome.i18n.getMessage("ext_text_blocked_title") || "Blocked text",
      autoClose: 5000,
    });
  }

  function checkField(field) {
    if (!phrases.length || !Engine) return false;
    const value = field.isContentEditable ? field.textContent : field.value;
    if (!Engine.findBlockedText(value, phrases)) return false;
    if (field.isContentEditable) cleanContentEditable(field);
    else setNativeValue(field, Engine.stripBlockedText(value, phrases));
    textBlockedNotice();
    return true;
  }

  document.addEventListener("input", event => {
    const field = editableTarget(event.target);
    if (field) checkField(field);
  }, true);

  document.addEventListener("submit", event => {
    if (!phrases.length || !Engine || !event.target || !event.target.elements) return;
    let blocked = false;
    Array.from(event.target.elements).forEach(element => { if (editableTarget(element) && checkField(element)) blocked = true; });
    if (blocked) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);

  const PROTECT = "all: initial !important; display: block !important; visibility: visible !important; opacity: 1 !important; " +
    "position: fixed !important; inset: 16px 16px auto 16px !important; margin: 0 auto !important; max-width: 720px !important; " +
    "z-index: 2147483647 !important; pointer-events: auto !important; transform: none !important; filter: none !important; " +
    "clip-path: none !important; mask: none !important; content-visibility: visible !important; contain: none !important;";

  function showNotice(message, options = {}) {
    loadBundledFont();
    document.querySelectorAll("munetios-webfilter-notice").forEach(node => node.remove());
    const host = document.createElement("munetios-webfilter-notice");
    host.setAttribute("style", PROTECT);
    host.setAttribute("role", "alert");
    if ("popover" in HTMLElement.prototype) host.setAttribute("popover", "manual");
    const root = host.attachShadow({ mode: "closed" });
    const title = options.title || chrome.i18n.getMessage("ext_notice_title") || "Message from your school";
    const dismiss = chrome.i18n.getMessage("ext_dismiss") || "Dismiss";
    root.innerHTML = `
      <style>
        :host { color-scheme: light dark; }
        .card { box-sizing: border-box; display: flex; gap: 16px; align-items: flex-start; padding: 20px 24px; border-radius: 36px;
          background: linear-gradient(180deg, rgba(46, 16, 96, 0.50), rgba(20, 8, 52, 0.48)); color: #f6f3ff;
          border: 1px solid rgba(255, 255, 255, 0.24); box-shadow: 0 18px 48px rgba(8, 3, 26, 0.32);
          -webkit-backdrop-filter: blur(2px) saturate(160%); backdrop-filter: blur(2px) saturate(160%);
          font-family: "Munetios UI v4 Font", system-ui, sans-serif; font-size: 18px; font-weight: 400; line-height: 1.45; }
        img { width: 48px; height: 48px; flex: none; }
        .body { flex: 1; min-width: 0; }
        h2 { margin: 0 0 4px; font-size: 22px; font-weight: 300; }
        p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
        button { font: inherit; font-size: 18px; color: inherit; background: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.24);
          border-radius: 999px; min-height: 48px; padding: 0 20px; cursor: pointer; flex: none; }
        button:hover { background: rgba(255, 255, 255, 0.2); }
        button:focus-visible { outline: 2px solid #c4aaff; outline-offset: 2px; }
      </style>
      <div class="card"><img alt="" src="${chrome.runtime.getURL("icons/icon-48.png")}"><div class="body"><h2></h2><p></p></div><button type="button"></button></div>`;
    root.querySelector("h2").textContent = title;
    root.querySelector("p").textContent = message;
    const button = root.querySelector("button");
    button.textContent = dismiss;
    button.addEventListener("click", () => host.remove());
    document.documentElement.appendChild(host);
    try { if (host.showPopover) host.showPopover(); } catch (error) { /* Not in the top layer; inline styles still protect it. */ }
    if (options.autoClose) setTimeout(() => host.remove(), options.autoClose);
    setTimeout(() => {
      if (!host.isConnected) return;
      const visible = typeof host.checkVisibility === "function"
        ? host.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
        : host.getBoundingClientRect().height > 0;
      if (!visible) chrome.runtime.sendMessage({ type: "mwf:integrity" }).catch(() => {});
    }, 400);
    return true;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message && message.type === "mwf:text-filter") {
      setPhrases(message.phrases);
      return false;
    }
    if (message && message.type === "mwf:notice") {
      const show = () => sendResponse({ ok: showNotice(String(message.message || "")) });
      if (document.documentElement) show();
      else document.addEventListener("DOMContentLoaded", show, { once: true });
      return true;
    }
    if (message && message.type === "mwf:pick-start") { startPicker(); sendResponse({ ok: true }); return false; }
    if (message && message.type === "mwf:pick-stop") { stopPicker(); sendResponse({ ok: true }); return false; }
    return false;
  });

  /* ------------------------------------------------------- block page relay */
  // The WebFilter block page (/blocked) asks for Request access and the bypass password
  // through window.postMessage. The service worker only answers when this tab really is
  // the block page.
  const BLOCK_PAGE_TYPES = { hello: "mwf:blocked-hello", bypass: "mwf:blocked-bypass", request: "mwf:blocked-request", status: "mwf:blocked-status" };
  window.addEventListener("message", event => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== "munetios-blocked" || !BLOCK_PAGE_TYPES[data.type]) return;
    const reply = result => window.postMessage({ source: "munetios-webfilter", id: data.id, result }, location.origin);
    chrome.runtime.sendMessage(Object.assign({}, data.payload || {}, { type: BLOCK_PAGE_TYPES[data.type] })).then(reply, () => reply(null));
  });

  /* ------------------------------------------------- UserCSS element picker */
  // Started from the extension's UserCSS editor: hover highlights an element and shows
  // its selector; a click sends the selector back to the editor.
  let picker = null;

  function selectorFor(element) {
    const ident = /^[A-Za-z_][\w-]*$/;
    if (element.id && ident.test(element.id) && document.querySelectorAll("#" + element.id).length === 1) return "#" + element.id;
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      const classes = Array.from(node.classList).filter(name => ident.test(name) && !/^mwf-/.test(name));
      let part = tag;
      if (node.id && ident.test(node.id)) part = tag + "#" + node.id;
      else if (classes.length) part = (tag === "div" || tag === "span" ? "" : tag) + "." + classes.join(".");
      parts.unshift(part);
      const selector = parts.join(" ");
      try {
        if (document.querySelectorAll(selector).length === 1 && (parts.length > 1 || classes.length || node.id)) return selector;
      } catch (error) { /* keep walking up */ }
      node = node.parentElement;
    }
    return parts.join(" ") || element.tagName.toLowerCase();
  }

  function startPicker() {
    if (picker || !document.documentElement) return;
    const host = document.createElement("munetios-webfilter-picker");
    host.setAttribute("style", "all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; pointer-events: none !important; display: block !important;");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .box { position: fixed; box-sizing: border-box; border: 2px solid #8f5cff; background: rgba(143, 92, 255, 0.14); border-radius: 6px; pointer-events: none; display: none; }
      .label { position: absolute; left: -2px; bottom: 100%; margin-bottom: 4px; max-width: 420px; padding: 4px 12px; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        background: #8f5cff; color: #fff; font: 400 18px/1.4 "Google Sans Mono", ui-monospace, monospace; }
    </style><div class="box"><span class="label"></span></div>`;
    const box = root.querySelector(".box");
    const label = root.querySelector(".label");
    document.documentElement.appendChild(host);
    const target = event => {
      const element = event.target;
      return element && element.nodeType === 1 && element !== host && element !== document.documentElement ? element : null;
    };
    const move = event => {
      const element = target(event);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = rect.left + "px";
      box.style.top = rect.top + "px";
      box.style.width = rect.width + "px";
      box.style.height = rect.height + "px";
      label.textContent = selectorFor(element);
    };
    const click = event => {
      const element = target(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      chrome.runtime.sendMessage({ type: "mwf:picked", selector: selectorFor(element) }).catch(() => {});
      stopPicker();
    };
    const key = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      chrome.runtime.sendMessage({ type: "mwf:pick-cancel" }).catch(() => {});
      stopPicker();
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    picker = { host, move, click, key };
  }

  function stopPicker() {
    if (!picker) return;
    document.removeEventListener("mousemove", picker.move, true);
    document.removeEventListener("click", picker.click, true);
    document.removeEventListener("keydown", picker.key, true);
    picker.host.remove();
    picker = null;
  }

  applyPage();
})();
