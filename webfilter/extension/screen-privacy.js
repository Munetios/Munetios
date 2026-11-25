(() => {
  "use strict";

  const credential = [
    'input[type="password" i]', 'input[autocomplete*="password" i]', 'input[autocomplete~="one-time-code" i]',
    '[role="textbox"][aria-label*="passw" i]', 'input[aria-label*="passw" i]',
    'input[placeholder*="passw" i]', 'input[name*="passw" i]', 'input[id*="passw" i]',
    'input[name*="passwd" i]', 'input[id*="passwd" i]', 'input[name="pwd" i]', 'input[id="pwd" i]',
    'input[style*="text-security" i]', 'object', 'embed', 'fencedframe',
  ].join(",");
  const roots = new WeakSet();
  let revision = 0;
  let privatePage = false;
  const observer = new MutationObserver(checkChanges);
  const options = {
    subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true,
    attributeFilter: ["type", "autocomplete", "role", "aria-label", "placeholder", "name", "id", "style", "class", "src", "srcdoc"],
  };

  function inspect(root) {
    if (privatePage) return;
    const opaqueFrame = frame => frame.matches?.("iframe[src], frame[src]") &&
      !/^(https?:|about:blank$|about:srcdoc$)/i.test(frame.src);
    if (root.matches?.(credential) || root.querySelector?.(credential) ||
        opaqueFrame(root) || [...(root.querySelectorAll?.("iframe[src], frame[src]") || [])].some(opaqueFrame) ||
        [...(root.querySelectorAll?.("input") || [])].some(input => {
          const mask = getComputedStyle(input).webkitTextSecurity;
          return mask && mask !== "none";
        })) {
      privatePage = true;
      return;
    }
    const findShadow = element => {
      if (!(element instanceof HTMLElement)) return;
      const shadow = chrome.dom.openOrClosedShadowRoot(element);
      if (!shadow) return;
      if (!roots.has(shadow)) {
        roots.add(shadow);
        observer.observe(shadow, options);
        revision++;
      }
      inspect(shadow);
    };
    findShadow(root);
    for (const element of root.querySelectorAll?.("*") || []) {
      findShadow(element);
      if (privatePage) break;
    }
  }

  function checkChanges(records) {
    if (!records.length || privatePage) return;
    revision++;
    for (const record of records) {
      if (record.type === "attributes" && record.target.matches("input, [role='textbox']")) {
        const oldValue = record.oldValue || "";
        if (record.target.matches(credential) || /passw|one-time-code|text-security|^pwd$/i.test(oldValue)) {
          privatePage = true;
          return;
        }
      }
      for (const node of record.addedNodes) inspect(node);
      for (const node of record.removedNodes) inspect(node);
    }
  }

  observer.observe(document, options);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "mwf:screen-privacy" || sender.id !== chrome.runtime.id) return;
    checkChanges(observer.takeRecords());
    if (document.readyState !== "complete") { respond(null); return; }
    inspect(document);
    respond(privatePage ? null : revision);
  });
})();
