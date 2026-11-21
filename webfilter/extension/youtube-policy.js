(() => {
  "use strict";

  const Engine = self.MunetiosWebFilterEngine;
  const INVALID_ID = "___________";
  let blockedIds = new Set();
  let blockedId = "";
  let player = null;
  let notice = null;
  let retryTimer = 0;
  let nativeAttempt = null;
  let nextNativeAttempt = 0;
  let policyRequest = 0;

  function currentVideoId() {
    return Engine.youtubeVideoId(location.href);
  }

  function preventPlayback(event) {
    const id = currentVideoId();
    if ((blockedIds.has(id) || (blockedId && id === INVALID_ID)) && event.target instanceof HTMLMediaElement) {
      event.target.pause();
    }
  }

  function findPlayer() {
    return document.querySelector("ytd-reel-video-renderer[is-active] .html5-video-player")
      || document.querySelector("#movie_player, .html5-video-player");
  }

  function showUnavailable(parent, insidePlayer) {
    if (notice?.parentNode === parent) return;
    notice?.remove();
    notice = document.createElement("div");
    notice.dataset.mwfYoutubeUnavailable = "";
    if (insidePlayer) notice.style.cssText = "position:absolute!important;inset:0!important;display:block!important;z-index:2147483647!important";
    const shadow = notice.attachShadow({ mode: "closed" });
    const state = document.createElement("div");
    state.setAttribute("role", "status");
    state.style.cssText = "box-sizing:border-box;display:grid;place-items:center;height:100%;min-height:64px;padding:16px;background:#0f0f0f;color:#fff;text-align:center;font:400 16px Roboto,Arial,sans-serif";
    state.textContent = chrome.i18n.getMessage("ext_youtube_video_unavailable") || "Video unavailable";
    shadow.append(state);
    parent.append(notice);
  }

  function updatePlayer() {
    const id = currentVideoId();
    const nextId = id === INVALID_ID && blockedIds.has(blockedId) ? blockedId : blockedIds.has(id) ? id : "";
    if (nextId !== blockedId) {
      blockedId = nextId;
      nativeAttempt = null;
      nextNativeAttempt = 0;
      player = null;
      notice?.remove();
      notice = null;
    }
    if (!blockedId) {
      clearInterval(retryTimer);
      retryTimer = 0;
      return;
    }
    if (!retryTimer) retryTimer = setInterval(updatePlayer, 250);
    document.querySelectorAll("video, audio").forEach(media => {
      if (!media.paused) media.pause();
    });
    const currentPlayer = findPlayer();
    if (currentPlayer !== player) {
      player = currentPlayer;
      nativeAttempt = null;
      nextNativeAttempt = 0;
    }
    if (player && id === blockedId && !nativeAttempt && Date.now() >= nextNativeAttempt) {
      const attempt = { ready: false };
      nativeAttempt = attempt;
      nextNativeAttempt = Date.now() + 1000;
      chrome.runtime.sendMessage({ type: "mwf:youtube-unavailable", url: location.href }).then(ready => {
        if (nativeAttempt === attempt) {
          attempt.ready = ready;
          if (!ready) nativeAttempt = null;
        }
      }, () => { if (nativeAttempt === attempt) nativeAttempt = null; });
    }
    const error = player?.querySelector(".ytp-error-content-wrap, .ytp-error");
    if (error?.getClientRects().length && getComputedStyle(error).visibility === "visible" && error.textContent.trim()) {
      notice?.remove();
      notice = null;
    } else {
      const parent = player || document.querySelector("ytd-player, #player-container, ytm-player, main") || document.body;
      if (parent) showUnavailable(parent, parent === player);
    }
  }

  async function refreshPolicy() {
    const request = ++policyRequest;
    const ids = await chrome.runtime.sendMessage({ type: "mwf:youtube-policy" }).catch(() => null);
    if (request !== policyRequest || !Array.isArray(ids)) return;
    const current = currentVideoId();
    const recover = blockedId && (current === blockedId || current === INVALID_ID) && !ids.includes(blockedId);
    blockedIds = new Set(ids);
    if (recover && current === blockedId && nativeAttempt?.ready) {
      // The native player was reset while blocked. Load the original video again.
      location.reload();
      return;
    }
    updatePlayer();
  }

  document.addEventListener("play", preventPlayback, true);
  document.addEventListener("loadedmetadata", preventPlayback, true);
  document.addEventListener("yt-navigate-finish", updatePlayer, true);
  document.addEventListener("yt-page-data-updated", updatePlayer, true);
  window.addEventListener("popstate", updatePlayer);
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "mwf:youtube-navigated") updatePlayer();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "managed" || (area === "local" && (changes.policy || changes.assignedClassId))) refreshPolicy();
  });
  refreshPolicy();
})();
