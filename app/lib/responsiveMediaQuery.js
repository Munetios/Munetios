function getTextScale() {
  if (typeof document === "undefined") return 1;
  const value = Number.parseFloat(
    document.documentElement.style.getPropertyValue("--app-text-scale"),
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function scaleMediaQuery(mediaQuery) {
  const scale = getTextScale();
  return mediaQuery.replace(
    /(\b(?:min-|max-)?(?:width|height)\s*:\s*)(\d*\.?\d+)(px|rem|em)\b/gi,
    (_match, prefix, value, unit) =>
      `${prefix}${Math.round(Number(value) * scale * 1000) / 1000}${unit}`,
  );
}

export function getResponsiveViewportWidth() {
  if (typeof window === "undefined") return 0;
  return window.innerWidth / getTextScale();
}

export function createResponsiveMediaQuery(mediaQuery) {
  let nativeMediaQuery = window.matchMedia(scaleMediaQuery(mediaQuery));
  const listeners = new Set();

  const notify = () => {
    const event = {
      matches: nativeMediaQuery.matches,
      media: mediaQuery,
    };
    for (const listener of listeners) listener(event);
  };
  const refresh = () => {
    nativeMediaQuery.removeEventListener("change", notify);
    nativeMediaQuery = window.matchMedia(scaleMediaQuery(mediaQuery));
    nativeMediaQuery.addEventListener("change", notify);
    notify();
  };

  nativeMediaQuery.addEventListener("change", notify);
  window.addEventListener("munetios:responsivechange", refresh);

  return {
    addEventListener(type, listener) {
      if (type === "change") listeners.add(listener);
    },
    get matches() {
      return nativeMediaQuery.matches;
    },
    get media() {
      return mediaQuery;
    },
    removeEventListener(type, listener) {
      if (type !== "change") return;
      listeners.delete(listener);
      if (listeners.size === 0) {
        nativeMediaQuery.removeEventListener("change", notify);
        window.removeEventListener("munetios:responsivechange", refresh);
      }
    },
  };
}
