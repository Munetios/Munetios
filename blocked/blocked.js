/* Munetios WebFilter block page: /blocked?mode=blocked|lock|notice&reason=&rule=&until=&message=&url=
 * The original address is always the last parameter (a network-level redirect appends it unencoded).
 * Request access and the bypass password go through the Munetios WebFilter extension's content
 * script (window.postMessage), which only answers when this tab really is the block page.
 */
(async () => {
  "use strict";
  const I18n = window.MunetiosWebFilterI18n;
  await I18n.load();
  const t = I18n.t;
  const $ = id => document.getElementById(id);
  const search = location.search;
  const params = new URLSearchParams(search.replace(/[?&]url=.*$/, ""));
  const mode = params.get("mode") || "blocked";
  const engine = window.MunetiosWebFilterEngine;
  const setWorkspace = name => { if (typeof name === "string" && name.trim()) $("mwfWorkspace").textContent = name.trim().slice(0, 120); };
  const blockInfo = { reason: params.get("reason"), rule: params.get("rule"), websiteId: params.get("websiteId"), category: params.get("category"), until: Number(params.get("until")) || 0 };
  setWorkspace(params.get("workspace"));

  function targetUrl() {
    const at = search.search(/[?&]url=/);
    if (at < 0) return "";
    let value = search.slice(at + 5);
    if (/^https?%3A/i.test(value)) { try { value = decodeURIComponent(value); } catch (error) { /* keep */ } }
    return value;
  }

  // --------------------------------------------------------------- extension bridge
  let counter = 0;
  const pending = new Map();
  window.addEventListener("message", event => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== "munetios-webfilter" || !pending.has(data.id)) return;
    pending.get(data.id)(data.result);
    pending.delete(data.id);
  });
  function ask(type, payload, timeout = 15000) {
    return new Promise(resolve => {
      const id = "mwf-" + (++counter);
      pending.set(id, resolve);
      window.postMessage({ source: "munetios-blocked", id, type, payload }, location.origin);
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, timeout);
    });
  }

  function status(text, tone) {
    const box = $("mwfStatus");
    box.textContent = text;
    box.className = "mwf-blocked-status" + (tone ? " is-" + tone : "");
    box.hidden = !text;
  }

  const reasons = {
    "global-block": () => t("block_reason_global"),
    "class-block": () => t("block_reason_class"),
    temporary: () => t("block_reason_temporary"),
    "allowlist-only": () => t("block_reason_allowlist"),
    "blocked-text": () => t("block_reason_text"),
    "category-block": rule => t("block_reason_category", { category: t("cat_" + rule) }),
  };

  function showReason({ reason, rule, websiteId, category, until }) {
    const text = (reasons[reason] || reasons["global-block"])(category || rule || "unrated");
    $("mwfReason").textContent = text + (until ? " · " + t("block_until", { time: I18n.formatTime(until) }) : "");
    const id = ["global-block", "class-block", "temporary"].includes(reason) ? engine.blockedWebsiteId(websiteId, rule) : "";
    $("mwfRule").textContent = id;
    $("mwfRuleRow").hidden = !id;
  }

  // Static labels
  $("mwfUrlLabel").textContent = t("block_address");
  $("mwfReasonLabel").textContent = t("block_reason");
  $("mwfRuleLabel").textContent = t("block_rule");
  $("mwfRequestLabel").textContent = t("block_request_access");
  $("mwfRequestTitle").textContent = t("block_request_title");
  $("mwfRequestReasonLabel").textContent = t("block_request_reason");
  $("mwfRequestSendLabel").textContent = t("block_send_request");
  $("mwfBypassLabel").textContent = t("block_bypass");
  $("mwfBypassTitle").textContent = t("block_bypass_title");
  $("mwfBypassDesc").textContent = t("block_bypass_desc");
  $("mwfPasswordLabel").textContent = t("block_password");
  $("mwfUnlockLabel").textContent = t("block_unlock");
  $("mwfRequestCancel").textContent = t("block_cancel");
  $("mwfBypassCancel").textContent = t("block_cancel");

  const back = $("mwfBack");
  const message = params.get("message") || "";

  if (mode === "lock") {
    $("mwfTitle").textContent = t("block_locked_title");
    $("mwfBody").textContent = t("block_locked_body");
    $("mwfActions").hidden = true;
  } else if (mode === "notice") {
    $("mwfTitle").textContent = t("block_notice_title");
    $("mwfBody").textContent = t("block_notice_body");
    $("mwfBackLabel").textContent = t("block_dismiss");
    back.querySelector(".mu-icon").textContent = "close";
    back.addEventListener("click", () => {
      window.close();
      if (!window.closed) history.length > 1 ? history.back() : location.replace("about:blank");
    });
  } else {
    const url = targetUrl();
    $("mwfTitle").textContent = t("block_title");
    $("mwfBody").textContent = t("block_body");
    $("mwfFacts").hidden = false;
    $("mwfUrl").textContent = url;
    showReason(blockInfo);
    $("mwfBackLabel").textContent = t("block_go_back");
    back.addEventListener("click", () => { history.length > 1 ? history.back() : location.replace("about:blank"); });

    const togglePanel = (id, button) => {
      ["mwfRequestPanel", "mwfBypassPanel"].forEach(other => { if (other !== id) $(other).hidden = true; });
      $(id).hidden = !$(id).hidden;
      $("mwfRequestBtn").setAttribute("aria-expanded", String(!$("mwfRequestPanel").hidden));
      $("mwfBypassBtn").setAttribute("aria-expanded", String(!$("mwfBypassPanel").hidden));
      if (!$(id).hidden) $(id).querySelector("textarea, input").focus();
      else button.focus();
    };
    document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => {
      const panel = button.dataset.close;
      togglePanel(panel, panel === "mwfRequestPanel" ? $("mwfRequestBtn") : $("mwfBypassBtn"));
    }));
    $("mwfRequestBtn").addEventListener("click", () => togglePanel("mwfRequestPanel", $("mwfRequestBtn")));
    $("mwfBypassBtn").addEventListener("click", () => togglePanel("mwfBypassPanel", $("mwfBypassBtn")));

    const hello = await ask("hello", { url }, 1500);
    setWorkspace(hello?.workspaceName);
    if (hello && hello.available && /^https?:/i.test(url)) {
      $("mwfRequestBtn").hidden = false;
      $("mwfBypassBtn").hidden = !hello.bypassEnabled;
      if (hello.reason && hello.reason !== "open") showReason({ ...blockInfo, ...hello, until: hello.until || blockInfo.until });
    } else {
      $("mwfNeedsExtension").textContent = t("block_needs_extension");
      $("mwfNeedsExtension").hidden = false;
    }

    // Request access: send, then wait for an Admin or Teacher to answer.
    let pollTimer = 0;
    $("mwfRequestPanel").addEventListener("submit", async event => {
      event.preventDefault();
      const send = $("mwfRequestSend");
      send.disabled = true;
      const result = await ask("request", { url, reason: $("mwfRequestReason").value.trim() });
      send.disabled = false;
      if (!result || !result.ok) { status(t("block_request_failed"), "bad"); return; }
      $("mwfRequestPanel").hidden = true;
      $("mwfRequestBtn").disabled = true;
      $("mwfRequestBtn").setAttribute("aria-expanded", "false");
      status(t("block_request_sent"), "good");
      const check = async () => {
        const answer = await ask("status", { url, id: result.id });
        if (answer && answer.status === "approved") { status(t("block_request_approved"), "good"); return; }
        if (answer && answer.status === "denied") { status(t("block_request_denied"), "bad"); return; }
        pollTimer = setTimeout(check, 10000);
      };
      pollTimer = setTimeout(check, 10000);
    });

    // Bypass password (set by an Admin in the dashboard).
    $("mwfBypassPanel").addEventListener("submit", async event => {
      event.preventDefault();
      const unlock = $("mwfUnlock");
      unlock.disabled = true;
      const result = await ask("bypass", { url, password: $("mwfPassword").value });
      unlock.disabled = false;
      $("mwfPassword").value = "";
      if (result && result.ok) { clearTimeout(pollTimer); status(t("block_bypass_ok", { minutes: result.minutes }), "good"); return; }
      status(result && result.error === "wrong" ? t("block_wrong_password") : t("block_bypass_failed"), "bad");
      $("mwfPassword").focus();
    });
  }

  document.title = $("mwfTitle").textContent + " · Munetios WebFilter";
  if (message) {
    $("mwfMessage").hidden = false;
    $("mwfMessage").textContent = message;
  }
})();
