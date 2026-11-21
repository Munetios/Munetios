/*!
 * Munetios WebFilter localization
 * Strings live in webfilter/languages/<locale>.json. languages/index.json lists the
 * files and which file each regional locale falls back to (es-MX -> es-419, ...).
 * English (en-US) fills any key a language file doesn't define.
 */
(function () {
  "use strict";
  const script = document.currentScript;
  const BASE = new URL("languages/", script ? script.src : location.href).href;
  const STORAGE_KEY = "munetios-webfilter-lang";
  const NATIVE_NAMES = {
    "en-US": "English (United States)",
    "es-419": "Español (Latinoamérica)",
    "es-ES": "Español (España)",
    "pt-BR": "Português (Brasil)",
    "pt-PT": "Português (Portugal)",
    fr: "Français",
  };
  let index = { languages: ["en-US"], fallbacks: {} };
  let strings = {};
  let current = "en-US";
  const listeners = new Set();

  async function fetchJson(name) {
    try {
      const response = await fetch(BASE + encodeURIComponent(name) + ".json", { cache: "no-cache", credentials: "same-origin" });
      return response.ok ? await response.json() : null;
    } catch (error) {
      return null;
    }
  }

  function canonical(code) {
    try { return Intl.getCanonicalLocales(String(code || "").replace(/_/g, "-"))[0] || ""; } catch (error) { return ""; }
  }

  function known(code) {
    return index.languages.includes(code) || Object.prototype.hasOwnProperty.call(index.fallbacks, code);
  }

  function resolve(code) {
    const value = canonical(code);
    if (!value) return "";
    if (known(value)) return value;
    const base = value.split("-")[0];
    return known(base) ? base : "";
  }

  function stored() {
    try { return localStorage.getItem(STORAGE_KEY) || localStorage.getItem("omniwrite-lang") || ""; } catch (error) { return ""; }
  }

  function pickLocale(preferred) {
    const candidates = [preferred, stored()].concat(Array.from(navigator.languages || [navigator.language || ""]));
    for (const candidate of candidates) {
      const found = resolve(candidate);
      if (found) return found;
    }
    return "en-US";
  }

  // locale -> fallback -> ... -> file, all on top of English.
  async function loadChain(locale) {
    const chain = [];
    const seen = new Set();
    let code = locale;
    while (code && !seen.has(code)) {
      seen.add(code);
      if (index.languages.includes(code)) chain.unshift(code);
      code = index.fallbacks[code];
    }
    const files = await Promise.all(["en-US"].concat(chain.filter(item => item !== "en-US")).map(fetchJson));
    return Object.assign({}, ...files.filter(Boolean));
  }

  async function load(preferred) {
    const loadedIndex = await fetchJson("index");
    if (loadedIndex && Array.isArray(loadedIndex.languages)) index = { languages: loadedIndex.languages, fallbacks: loadedIndex.fallbacks || {} };
    current = pickLocale(preferred);
    strings = await loadChain(current);
    document.documentElement.lang = current;
    listeners.forEach(listener => { try { listener(current); } catch (error) { console.error(error); } });
    return current;
  }

  function t(key, vars) {
    const value = Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key;
    if (!vars) return value;
    return String(value).replace(/\{(\w+)\}/g, (match, name) => (vars[name] == null ? match : String(vars[name])));
  }

  const meridiem = text => text.replace(/\bAM\b/g, "NM").replace(/\bPM\b/g, "AN");
  function format(value, options) {
    const date = value instanceof Date ? value : new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "";
    try { return meridiem(new Intl.DateTimeFormat(current, options).format(date)); }
    catch (error) { return meridiem(new Intl.DateTimeFormat("en-US", options).format(date)); }
  }

  async function setLocale(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch (error) { /* Private mode: this session only. */ }
    return load(code);
  }

  window.MunetiosWebFilterI18n = Object.freeze({
    load,
    t,
    setLocale,
    locale: () => current,
    languages: () => index.languages.map(code => ({ code, name: NATIVE_NAMES[code] || code })),
    formatDate: value => format(value, { dateStyle: "medium", timeStyle: "short" }),
    formatTime: value => format(value, { timeStyle: "short" }),
    onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  });
})();
