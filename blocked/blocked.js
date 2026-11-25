/* The extension supplies block details and handles actions for verified navigations. */
(async () => {
  "use strict";
  const I18n = window.MunetiosWebFilterI18n;
  await I18n.load();
  const t = I18n.t;
  const $ = id => document.getElementById(id);
  const setWorkspace = name => { if (typeof name === "string" && name.trim()) $("mwfWorkspace").textContent = name.trim().slice(0, 120); };

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

  function showReason({ reason, blockId, category, until }) {
    const text = (reasons[reason] || reasons["global-block"])(category || "unrated");
    $("mwfReason").textContent = text + (until ? " · " + t("block_until", { time: I18n.formatTime(until) }) : "");
    const id = typeof blockId === "string" && /^[a-z0-9_-]{1,100}$/i.test(blockId) ? blockId : "";
    $("mwfRule").textContent = id;
    $("mwfRuleRow").hidden = !id;
  }

  // Static labels
  $("mwfUrlLabel").textContent = t("tab_url");
  $("mwfReasonLabel").textContent = t("block_reason");
  $("mwfRuleLabel").textContent = t("block_pattern");
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
  const reply = await ask("hello", {}, 2000);
  const hello = reply?.verified === true ? reply : null;
  // Older extensions check the policy against a URL from the query string.
  // Their response can select the standard screen, but cannot verify details or actions.
  const legacyBlock = reply?.verified === undefined && Object.hasOwn(reasons, reply?.reason);
  const mode = hello?.mode;
  setWorkspace(hello?.workspaceName);

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
    if (hello || legacyBlock) $("mwfTitle").textContent = t("block_title");
    $("mwfBody").textContent = t(hello || legacyBlock ? "block_body" : "block_return_body");
    if (hello) {
      $("mwfFacts").hidden = false;
      if (typeof hello.blockedUrl === "string" && hello.blockedUrl) {
        $("mwfUrl").textContent = hello.blockedUrl;
        $("mwfUrlRow").hidden = false;
      }
      showReason(hello);
    }
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

    if (hello?.available) {
      $("mwfRequestBtn").hidden = false;
      $("mwfBypassBtn").hidden = !hello.bypassEnabled;
    } else if (hello) {
      $("mwfNeedsExtension").textContent = t("block_needs_extension");
      $("mwfNeedsExtension").hidden = false;
    }

    // Request access: send, then wait for an Admin or Teacher to answer.
    let pollTimer = 0;
    $("mwfRequestPanel").addEventListener("submit", async event => {
      event.preventDefault();
      const send = $("mwfRequestSend");
      send.disabled = true;
      const result = await ask("request", { reason: $("mwfRequestReason").value.trim() });
      send.disabled = false;
      if (!result || !result.ok) { status(t("block_request_failed"), "bad"); return; }
      $("mwfRequestPanel").hidden = true;
      $("mwfRequestBtn").disabled = true;
      $("mwfRequestBtn").setAttribute("aria-expanded", "false");
      status(t("block_request_sent"), "good");
      const check = async () => {
        const answer = await ask("status", { id: result.id });
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
      const result = await ask("bypass", { password: $("mwfPassword").value });
      unlock.disabled = false;
      $("mwfPassword").value = "";
      if (result && result.ok) { clearTimeout(pollTimer); status(t("block_bypass_ok", { minutes: result.minutes }), "good"); return; }
      status(result && result.error === "wrong" ? t("block_wrong_password") : t("block_bypass_failed"), "bad");
      $("mwfPassword").focus();
    });
  }

  document.title = $("mwfTitle").textContent + " · Munetios WebFilter";
  if (typeof hello?.message === "string" && hello.message) {
    $("mwfMessage").hidden = false;
    $("mwfMessage").textContent = hello.message;
  }
})();
