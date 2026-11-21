/*!
 * OmniWrite on Munetios UI v4
 * - omniFormatDate(): one date format everywhere (medium date + short time,
 *   in the OmniWrite language, NM/AN instead of AM/PM)
 * - Generic modals get the v4 dialog layout as they open: icon circle +
 *   title + round close button in one header row, v4 primary/danger actions,
 *   v4 fields and muted text. Specialized modals keep their own design.
 * Loaded in <head> so omniFormatDate exists before anything renders.
 */
(() => {
  "use strict";

  /* ---------------------------------------------------------- dates */
  const language = () => {
    try { return localStorage.getItem("omniwrite-lang") || navigator.language || "en"; } catch { return navigator.language || "en"; }
  };
  const meridiem = text => text.replace(/\bAM\b/g, "NM").replace(/\bPM\b/g, "AN");
  function format(value, options) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    try { return meridiem(new Intl.DateTimeFormat(language(), options).format(date)); }
    catch { return meridiem(new Intl.DateTimeFormat("en", options).format(date)); }
  }
  window.omniFormatDate = value => format(value, { dateStyle: "medium", timeStyle: "short" });
  window.omniFormatDay = value => format(value, { dateStyle: "medium" });

  /* ---------------------------------------------------------- modals */
  // These were redesigned individually and keep their own layout.
  const SKIP = [".omni-settings-modal", ".omni-recovery-modal", ".omni-icon-modal", ".omni-preview-modal", ".omni-split-modal",
    ".omni-handwriting-modal", ".omni-download-modal", ".omni-version-history-modal", ".omni-unsupported-browser-modal",
    ".omni-command-palette", "[data-omni-keep-design]"].join(",");
  const PRIMARY = /(save|create|confirm|accept|apply|add|ok|done|submit|insert|unlock|lock|rename|start|continue|export|download|import|restore|move|share|copy|upload|send|search|finish|yes|enable|set)/i;
  const DANGER = /(delete|remove|reset|clear|discard|erase|destroy|empty|purge|revoke)/i;
  const CANCEL = /(cancel|close|dismiss|back|no\b|skip|later)/i;
  const SKIP_BUTTON = ".omni-select-button, .setting-toggle, .omni-icon-tile, .omni-format-tile, .mu-select-button, .modal-content-close, [data-omni-plain]";
  const translate = key => {
    try { const value = typeof window._t === "function" ? window._t(key) : ""; return value && value !== key ? value : ""; } catch { return ""; }
  };

  function enhanceClose(close) {
    if (close.dataset.v4) return;
    close.dataset.v4 = "1";
    if (close.textContent.trim() === "×") {
      close.textContent = "";
      const icon = document.createElement("icon");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "close";
      close.append(icon);
    }
    if (!/^(BUTTON|A)$/.test(close.tagName)) {
      close.setAttribute("role", "button");
      if (!close.hasAttribute("tabindex")) close.tabIndex = 0;
      close.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); close.click(); }
      });
    }
    const label = (close.getAttribute("aria-label") || "").trim();
    if (!label || label === "×" || label === "close") close.setAttribute("aria-label", translate("close") || "Close");
  }
  // A button with a visible word (not only an icon such as an up/down arrow).
  const isTextButton = button => {
    const clone = button.cloneNode(true);
    clone.querySelectorAll("icon, .mu-icon, .material-symbols-rounded").forEach(icon => icon.remove());
    return clone.textContent.trim().length > 1;
  };
  // Rows of reorder controls (customizers, lists) are not dialog actions.
  const NOT_ACTION_ROW = "[class*='customizer-row'], [class*='-row-actions'], .toolbar-customizer-list, li, [role='listitem']";
  function enhanceButtons(content) {
    content.querySelectorAll("button").forEach(button => {
      if (button.closest(SKIP_BUTTON) || button.matches(SKIP_BUTTON)) return;
      button.classList.add("omni-v4-btn");
      if (!isTextButton(button)) button.classList.add("omni-v4-icon-only");
      if (DANGER.test(button.id || "")) button.classList.add("omni-v4-danger");
    });
    // In an action row (2+ worded buttons side by side), the last non-cancel button is the main action.
    content.querySelectorAll("div, footer, form").forEach(row => {
      if (row.matches(NOT_ACTION_ROW) || row.closest(NOT_ACTION_ROW)) return;
      const buttons = [...row.children].filter(child => child.tagName === "BUTTON" && child.classList.contains("omni-v4-btn"));
      if (buttons.length < 2 || buttons.some(button => button.classList.contains("omni-v4-icon-only"))) return;
      row.classList.add("omni-v4-actions");
      const main = [...buttons].reverse().find(button => !CANCEL.test(button.id || ""));
      if (main && !main.classList.contains("omni-v4-danger")) main.classList.add("omni-v4-primary");
    });
    // A lone worded button that clearly creates/saves something is primary too.
    content.querySelectorAll("button.omni-v4-btn:not(.omni-v4-primary):not(.omni-v4-danger):not(.omni-v4-icon-only)").forEach(button => {
      if (button.closest(NOT_ACTION_ROW)) return;
      const siblings = [...button.parentElement.children].filter(child => child.tagName === "BUTTON");
      if (siblings.length === 1 && PRIMARY.test(button.id || "") && !CANCEL.test(button.id || "")) button.classList.add("omni-v4-primary");
    });
  }

  /* Version history keeps its own layout; add the v4 header icon and main action. */
  function enhanceVersionHistory(modal) {
    const content = modal.querySelector(":scope > .modal-content");
    if (!content || content.dataset.v4) return;
    content.dataset.v4 = "1";
    content.classList.add("omni-v4-version");
    const heading = content.querySelector("h2");
    if (heading && !heading.parentElement.querySelector(".omni-v4-icon")) {
      const row = document.createElement("div");
      row.className = "omni-v4-version-title";
      const circle = document.createElement("span");
      circle.className = "mu-icon-circle omni-v4-icon";
      circle.innerHTML = '<icon aria-hidden="true">history</icon>';
      heading.before(row);
      row.append(circle, heading);
    }
    const close = content.querySelector(":scope > .modal-content-close");
    if (close) enhanceClose(close);
    const preview = content.querySelector("#versionPreview");
    const buttons = preview ? [...preview.querySelectorAll("button")] : [];
    buttons.forEach(button => button.classList.add("omni-v4-btn"));
    buttons.at(-1)?.classList.add("omni-v4-primary"); // "Restore this version"
  }

  /* ---------------------------------------------------------- pages */
  const PAGE_ICONS = { imagesApp: "photo_library", chartsApp: "bar_chart", tasksApp: "task_alt" };
  function enhanceHero(pageId) {
    const page = document.getElementById(pageId);
    if (!page) return;
    let hero = page.querySelector(".dashboard-hero, .omni-images-hero");
    const content = page.querySelector(".content-area");
    if (!hero && pageId === "tasksApp" && content) {
      // Tasks only has a bare heading above its embedded app.
      const title = content.querySelector(":scope > h1");
      if (!title) return;
      hero = document.createElement("div");
      hero.className = "dashboard-hero liquid-glass";
      title.before(hero);
      hero.append(title);
    }
    if (!hero || hero.dataset.v4) return;
    hero.dataset.v4 = "1";
    hero.classList.add("omni-v4-hero");
    const title = hero.querySelector("h1, h2");
    if (!title) return;
    const text = document.createElement("div");
    text.className = "omni-v4-hero-text";
    const description = title.nextElementSibling && title.nextElementSibling.tagName === "P" ? title.nextElementSibling : null;
    title.before(text);
    text.append(title);
    if (description) text.append(description);
    const circle = document.createElement("span");
    circle.className = "mu-icon-circle omni-v4-hero-icon";
    circle.innerHTML = `<icon aria-hidden="true">${PAGE_ICONS[pageId]}</icon>`;
    text.before(circle);
  }
  // The image library has a legacy text-only empty state.
  const EMPTY_LISTS = { imagesList: "photo_library" };
  function decorateEmpty(list, icon) {
    const items = [...list.children].filter(child => !child.classList.contains("omni-v4-empty-icon"));
    const onlyText = list.children.length === 0 && list.textContent.trim();
    const single = items.length === 1 && !items[0].querySelector("button, img, input, a, canvas") && items[0].textContent.trim().length < 90 ? items[0] : null;
    if (onlyText) {
      const holder = document.createElement("div");
      holder.textContent = list.textContent.trim();
      list.textContent = "";
      list.append(holder);
      return decorateEmpty(list, icon);
    }
    list.classList.toggle("omni-v4-empty-list", Boolean(single));
    if (!single || single.classList.contains("omni-v4-empty")) return;
    single.classList.add("omni-v4-empty");
    const circle = document.createElement("span");
    circle.className = "mu-icon-circle omni-v4-empty-icon";
    circle.innerHTML = `<icon aria-hidden="true">${icon}</icon>`;
    single.prepend(circle);
  }
  function enhancePages() {
    Object.keys(PAGE_ICONS).forEach(enhanceHero);
    Object.entries(EMPTY_LISTS).forEach(([id, icon]) => {
      const list = document.getElementById(id);
      if (!list || list.dataset.v4Watch) return;
      list.dataset.v4Watch = "1";
      decorateEmpty(list, icon);
      let busy = false;
      new MutationObserver(() => {
        if (busy) return;
        busy = true;
        decorateEmpty(list, icon);
        busy = false;
      }).observe(list, { childList: true, characterData: true, subtree: false });
    });
  }
  function enhance(modal) {
    if (!(modal instanceof Element) || !modal.matches(".modal")) return;
    if (modal.matches(".omni-version-history-modal")) { enhanceVersionHistory(modal); return; }
    if (modal.matches(SKIP)) return;
    const content = modal.querySelector(":scope > .modal-content");
    if (!content || content.dataset.v4) return;
    content.dataset.v4 = "1";
    content.classList.add("omni-v4-dialog");
    const close = content.querySelector(":scope > .modal-content-close");
    const heading = content.querySelector(":scope > h2, :scope > h1");
    if (heading) {
      const header = document.createElement("div");
      header.className = "omni-v4-header";
      const icon = heading.querySelector(":scope > icon:first-child");
      if (icon) {
        const circle = document.createElement("span");
        circle.className = "mu-icon-circle omni-v4-icon";
        icon.setAttribute("aria-hidden", "true");
        circle.append(icon);
        header.append(circle);
      }
      heading.before(header);
      header.append(heading);
      if (close) header.append(close); // same element, so its click handler keeps working
    }
    if (close) enhanceClose(close);
    content.querySelectorAll(":scope label > b:first-child, :scope label > strong:first-child").forEach(label => label.classList.add("omni-v4-label"));
    enhanceButtons(content);
  }
  function scan(node) {
    if (!(node instanceof Element)) return;
    if (node.closest("#editorArea, .document-page, [contenteditable='true']")) return; // never work on every keystroke
    if (node.matches(".modal")) enhance(node);
    node.querySelectorAll?.(".modal").forEach(enhance);
    // Buttons added after the modal opened (lists, steps) still get the v4 look.
    const dialog = node.closest?.(".omni-v4-dialog");
    if (dialog) enhanceButtons(dialog);
  }
  function start() {
    scan(document.body);
    enhancePages();
    setTimeout(enhancePages, 1500); // pages that render after the first data load
    new MutationObserver(records => {
      for (const record of records) record.addedNodes.forEach(scan);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  window.OmniWriteV4 = { enhance };
})();
