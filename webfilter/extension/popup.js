/* Munetios WebFilter extension: toolbar popup (device settings and status). */
(() => {
  "use strict";
  const t = (key, fallback) => chrome.i18n.getMessage(key) || fallback;
  const $ = id => document.getElementById(id);
  const locale = chrome.i18n.getUILanguage() || "en";
  document.documentElement.lang = locale;
  document.querySelectorAll("[data-i18n]").forEach(node => { node.textContent = t(node.dataset.i18n, node.textContent); });

  const formatTime = value => value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)).replace(/\bAM\b/g, "NM").replace(/\bPM\b/g, "AN")
    : t("ext_never", "Never");
  const modeLabels = {
    allowed: t("ext_mode_allowed", "Full UserCSS"),
    partial: t("ext_mode_partial", "Fonts and colors only"),
    blocked: t("ext_mode_blocked", "Not applied"),
    restricted: t("ext_mode_restricted", "Not applied on restricted pages"),
  };

  function render(state) {
    if (!state) return;
    const connection = $("mwfConnection");
    connection.textContent = state.connected && !state.lastError ? t("ext_connected", "Connected") : t("ext_offline", "Not connected");
    connection.className = "mwf-status " + (state.connected && !state.lastError ? "mwf-ok" : "mwf-bad");
    if (state.locked) {
      connection.textContent = t("ext_locked_title", "This device is locked");
      connection.className = "mwf-status mwf-warn";
    }
    $("mwfPage").textContent = state.page ? (state.page.blocked ? t("ext_page_blocked", "Blocked") : t("ext_page_allowed", "Allowed")) : "—";
    if (state.page?.videoUnavailable && !state.page.blocked) {
      $("mwfPage").textContent = t("ext_youtube_video_unavailable", "Video unavailable");
    }
    $("mwfMode").textContent = state.page ? modeLabels[state.page.mode] || state.page.mode : "—";
    $("mwfLastSync").textContent = formatTime(state.lastSync);

    const settings = state.settings || {};
    const klass = (state.classes || []).find(item => item.id === settings.classId);
    $("mwfDeviceName").textContent = settings.deviceName || t("ext_not_named", "Not named yet");
    $("mwfClass").textContent = klass ? klass.name : t("ext_no_class", "No class");
  }

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      return null;
    }
  }


  $("mwfSync").addEventListener("click", async () => {
    const button = $("mwfSync");
    button.disabled = true;
    const state = await send({ type: "mwf:sync" });
    button.disabled = false;
    render(state);
    $("mwfLive").textContent = state && state.ok ? t("ext_synced", "Policy synced") : t("ext_sync_failed", "Could not reach the WebFilter server");
  });

  // UserCSS editor: side panel beside the page (so "Select an element" works there), or a tab.
  $("mwfOpenEditor").addEventListener("click", async () => {
    try {
      const win = await chrome.windows.getCurrent();
      if (chrome.sidePanel && chrome.sidePanel.open) {
        await chrome.sidePanel.open({ windowId: win.id });
        window.close();
        return;
      }
    } catch (error) { /* Fall back to a tab. */ }
    chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
    window.close();
  });

  send({ type: "mwf:popup-state" }).then(render);
})();
