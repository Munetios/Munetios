(() => {
  "use strict";
  if (customElements.get("munetios-youtube-player")) return;
  const scriptUrl = new URL(document.currentScript.src);
  const stylesheet = new URL("munetios-ui-v4.css", scriptUrl).href;
  let apiPromise;
  const validId = (value) => /^[A-Za-z0-9_-]{11}$/.test(value || "");
  const locale = () => {
    try {
      return (
        localStorage.getItem(
          location.pathname.startsWith("/omniwrite")
            ? "omniwrite-lang"
            : "munetiosLanguage",
        ) ||
        document.documentElement.lang ||
        "en"
      );
    } catch {
      return document.documentElement.lang || "en";
    }
  };
  const t = (key) => window.MunetiosYouTubeI18n.get(locale(), key);
  function parseCaptions(text) {
    const seconds = (value) =>
      value
        .replace(",", ".")
        .split(":")
        .reduce((total, piece) => total * 60 + Number(piece), 0);
    const cues = [];
    const source = String(text)
      .replace(/^\uFEFF/, "")
      .replaceAll("\r", "");
    for (const block of source.split(/\n\s*\n/)) {
      const lines = block.trim().split("\n");
      const index = lines.findIndex((line) =>
        /\d+:\d+(?::\d+)?[.,]\d+\s+-->/.test(line),
      );
      if (index < 0) continue;
      const match = lines[index].match(
        /([\d:]+[.,]\d+)\s+-->\s+([\d:]+[.,]\d+)/,
      );
      if (!match) continue;
      const start = seconds(match[1]),
        end = seconds(match[2]);
      if (Number.isFinite(start) && end > start)
        cues.push({
          start,
          end,
          text: lines
            .slice(index + 1)
            .join("\n")
            .replace(/<[^>]*>/g, ""),
        });
    }
    if (!cues.length) {
      const lines = source
        .split("\n")
        .map((line) => line.match(/^\s*((?:\d+:)?\d+:\d+(?:[.,]\d+)?)\s+(.+)$/))
        .filter(Boolean);
      lines.forEach((line, i) => {
        const start = seconds(line[1]);
        const end = lines[i + 1] ? seconds(lines[i + 1][1]) : start + 5;
        if (end > start) cues.push({ start, end, text: line[2] });
      });
    }
    return cues.sort((a, b) => a.start - b.start);
  }
  function loadAPI() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("api"));
      }, 15000);
      const callback = () => {
        cleanup();
        try {
          previous?.();
        } finally {
          resolve(window.YT);
        }
      };
      const cleanup = () => {
        clearTimeout(timeout);
        if (window.onYouTubeIframeAPIReady === callback)
          window.onYouTubeIframeAPIReady = previous;
      };
      window.onYouTubeIframeAPIReady = callback;
      const script = document.createElement("script");
      script.src = "/api/youtube/iframe-api";
      script.async = true;
      script.onerror = () => {
        cleanup();
        script.remove();
        reject(new Error("api"));
      };
      document.head.append(script);
    }).catch((error) => {
      apiPromise = null;
      throw error;
    });
    return apiPromise;
  }
  class YouTubePlayer extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.ready = false;
      this.loaded = false;
    }
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;
      if (this.getAttribute("contenteditable") !== "false")
        this.setAttribute("contenteditable", "false");
      this.shadowRoot.innerHTML = `<link rel="stylesheet" href="${stylesheet}"><section class="mu-youtube-shell">
        <div class="mu-youtube-gate"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">smart_display</span></span><p data-label="warning"></p><button class="mu-btn mu-btn-primary" data-load data-label="load" type="button"></button></div>
        <div class="mu-youtube-stage" hidden></div>
        <p class="mu-youtube-warning" hidden><span class="mu-icon" aria-hidden="true">privacy_tip</span><span data-label="warning"></span></p>
      </section>`;
      this.$ = (selector) => this.shadowRoot.querySelector(selector);
      this.$("[data-load]").addEventListener("click", () => this.load());
      this.translate();
      this.languageObserver = new MutationObserver(() => this.translate());
      this.languageObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"],
      });
    }
    get videoId() {
      return this.getAttribute("video-id");
    }
    translate() {
      this.shadowRoot.querySelectorAll("[data-label]").forEach((node) => {
        node.textContent = t(node.dataset.label);
      });
      this.$(".mu-youtube-shell").dir = /^(ar|he|fa|ur)(-|$)/.test(locale())
        ? "rtl"
        : "ltr";
    }
    load() {
      if (this.loaded || !validId(this.videoId)) return;
      const frame = document.createElement("iframe");
      const url = new URL(
        `https://www.youtube-nocookie.com/embed/${this.videoId}`,
      );
      for (const [key, value] of Object.entries({
        enablejsapi: "1",
        controls: "1",
        playsinline: "1",
        rel: "0",
        origin: location.origin,
      }))
        url.searchParams.set(key, value);
      frame.src = url.href;
      frame.title = this.getAttribute("video-title") || "YouTube";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      this.loaded = true;
      this.$(".mu-youtube-stage").replaceChildren(frame);
      this.$(".mu-youtube-stage").hidden = false;
      this.$(".mu-youtube-gate").hidden = true;
      this.$(".mu-youtube-warning").hidden = false;
      // The SDK only preserves state for the surrounding app's miniplayer.
      // Native playback and controls work even if the SDK proxy is unavailable.
      loadAPI()
        .then((YT) => {
          if (!this.isConnected || this.$("iframe") !== frame) return;
          this.player = new YT.Player(frame, {
            host: "https://www.youtube-nocookie.com",
            events: {
              onReady: () => {
                if (!this.isConnected) return;
                this.ready = true;
                if (this.pendingPlayback)
                  this.restorePlayback(this.pendingPlayback);
              },
            },
          });
        })
        .catch(() => {});
    }
    playbackSnapshot() {
      return this.ready
        ? {
            position: this.player.getCurrentTime(),
            volume: this.player.getVolume(),
            muted: this.player.isMuted(),
            rate: this.player.getPlaybackRate(),
            playing: this.player.getPlayerState() === 1,
          }
        : null;
    }
    restorePlayback(state) {
      if (!this.ready) {
        this.pendingPlayback = state;
        return;
      }
      this.player.seekTo(state.position || 0, true);
      this.player.setVolume(state.volume ?? 100);
      state.muted ? this.player.mute() : this.player.unMute();
      this.player.setPlaybackRate(state.rate || 1);
      if (state.playing) this.player.playVideo();
      this.pendingPlayback = null;
    }
    disconnectedCallback() {
      queueMicrotask(() => {
        if (this.isConnected) return;
        this.languageObserver?.disconnect();
        this.player?.destroy();
        this.player = null;
        this.ready = false;
        this.loaded = false;
        this.initialized = false;
      });
    }
  }
  customElements.define("munetios-youtube-player", YouTubePlayer);
  function videoId(source) {
    try {
      const url = new URL(source, location.href);
      if (url.hostname === "youtu.be") return url.pathname.split("/")[1];
      if (!/^(?:www\.|m\.)?youtube(?:-nocookie)?\.com$/.test(url.hostname))
        return null;
      return (
        url.searchParams.get("v") ||
        url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]
      );
    } catch {
      return null;
    }
  }
  function upgrade(scope) {
    const selector =
      'iframe[src*="youtube"], iframe[src*="youtu.be"], .youtube-nocookie-placeholder';
    const nodes = [
      ...(scope.matches?.(selector) ? [scope] : []),
      ...(scope.querySelectorAll?.(selector) || []),
    ];
    for (const node of nodes) {
      if (!node.isConnected) continue;
      const id = videoId(
        node.getAttribute("data-omni-embed-src") || node.getAttribute("src"),
      );
      if (!validId(id)) continue;
      const host = document.createElement("munetios-youtube-player");
      host.setAttribute("video-id", id);
      host.setAttribute("video-title", node.getAttribute("title") || "YouTube");
      node.replaceWith(host);
    }
  }
  function prepareHTML(html) {
    const template = document.createElement("template");
    template.innerHTML = html || "";
    for (const frame of template.content.querySelectorAll(
      'iframe[src*="youtube"], iframe[src*="youtu.be"], .youtube-nocookie-placeholder',
    )) {
      const id = videoId(
        frame.getAttribute("data-omni-embed-src") || frame.getAttribute("src"),
      );
      if (!validId(id)) continue;
      const host = document.createElement("munetios-youtube-player");
      host.setAttribute("video-id", id);
      host.setAttribute(
        "video-title",
        frame.getAttribute("title") || "YouTube",
      );
      frame.replaceWith(host);
    }
    return template.innerHTML;
  }
  window.MunetiosYouTube = { parseCaptions, videoId, upgrade, prepareHTML };
  function start() {
    upgrade(document);
    new MutationObserver((records) =>
      records.forEach((record) =>
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) upgrade(node);
        }),
      ),
    ).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
