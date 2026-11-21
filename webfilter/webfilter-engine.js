/*!
 * Munetios WebFilter policy engine
 * One file shared by the WebFilter workspace (OmniWrite), the Node tests and the
 * Munetios WebFilter extension (bundled as policy-engine.js). No DOM, no network.
 *
 * - evaluateAccess(url, policy, ctx)      web filter verdict (global > class > temporary)
 * - resolveUserCssMode(url, policy, ctx)  allowed | partial | blocked | restricted
 * - sanitizeCss(css, options)             UserCSS security sandbox with a violation report
 * - computePageStyles(url, policy, ctx)   everything the extension needs for one page
 * - textFilterFor(url, policy, ctx)       blocked text for a page (allow-listed sites are exempt)
 * - findBlockedText / stripBlockedText    whole-word matching for URLs and typed text
 *
 * A page the web filter blocks is "restricted": UserCSS is never applied to it,
 * whatever the UserCSS lists say. The WebFilter block page itself (<server>/blocked,
 * passed as ctx.blockPageUrl) is always reachable and always restricted.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MunetiosWebFilterEngine = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this, function () {
  "use strict";

  const VERSION = "1.0.0";
  const FONT_PATH = "fonts/munetios-sans.ttf";
  const MODE_RANK = { allowed: 0, partial: 1, blocked: 2, restricted: 3 };

  // Partially Blocked URLs keep only these 8 properties (background-color is part of #2).
  const PARTIAL_PROPERTIES = Object.freeze([
    "font-family",
    "background",
    "background-color",
    "color",
    "font-size",
    "backdrop-filter",
    "font-weight",
    "font-feature-settings",
    "font-variation-settings",
  ]);
  const PARTIAL_SET = new Set(PARTIAL_PROPERTIES);

  const NESTED_AT_RULES = new Set(["media", "supports", "layer", "container", "scope", "starting-style", "document", "-moz-document"]);
  const DECLARATION_AT_RULES = new Set(["font-face", "page", "property", "counter-style", "font-palette-values"]);
  const PARTIAL_AT_RULES = new Set(["media", "supports", "layer", "container", "font-face"]);
  const LEGACY_SCRIPT_PROPERTIES = new Set(["behavior", "-ms-behavior", "-moz-binding"]);
  const HIDING_PROPERTIES = new Set(["display", "visibility", "opacity", "filter", "transform", "clip", "clip-path", "mask", "mask-image",
    "-webkit-mask", "-webkit-mask-image", "content-visibility", "zoom", "scale", "translate", "rotate"]);
  const GEOMETRY_PROPERTIES = new Set(["position", "inset", "top", "right", "bottom", "left", "width", "height", "min-width", "min-height",
    "inset-block", "inset-inline", "block-size", "inline-size", "min-block-size", "min-inline-size"]);
  const INTERACTIVE_TYPES = /(^|[\s>+~(,])(iframe|input|button|a|select|textarea|label|summary|option|embed|object)(?=$|[\s.#:[>+~),])/i;
  const INTERACTIVE_ATTRS = /\[(?:\s*)(?:role\s*[~|^$*]?=\s*["']?(?:button|link|checkbox|tab|menuitem)|href|onclick|type\s*=\s*["']?(?:submit|button|checkbox|radio))/i;
  const SENSITIVE_SELECTOR = /\[\s*value\s*[*^$|~]?=|\[\s*value\s*\]|type\s*=\s*["']?(?:password|hidden)|\[\s*(?:name|id|autocomplete)\s*[*^$|~]?=\s*["']?[^\]]*(?:pass|pwd|token|csrf|secret|otp|pin|card|cvv|ssn)/i;
  const PROTECTED_SELECTOR = /munetios-webfilter|munetios-wf|\bmwf-|data-mwf|data-munetios-webfilter/i;
  const PROPERTY_NAME = /^-{0,2}[a-z][a-z0-9-]*$/;

  /* ------------------------------------------------------------------ urls */

  function parseUrl(input) {
    const text = String(input == null ? "" : input).trim();
    if (!text) return null;
    try {
      return new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text);
    } catch (error) {
      return null;
    }
  }

  function hostMatches(host, domain) {
    const h = String(host || "").toLowerCase().replace(/\.$/, "");
    const d = String(domain || "").toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
    return !!d && (h === d || h.endsWith("." + d));
  }

  // "example.org" and "*.example.org" match the domain and its subdomains;
  // anything with a path ("example.org/games") is a URL prefix.
  function normalizePattern(input, type) {
    let value = String(input == null ? "" : input).trim();
    if (!value) return null;
    const kind = type || (value.includes("/") ? "url" : "domain");
    if (kind === "keyword") {
      value = value.toLowerCase();
      return value.length ? { type: "keyword", value } : null;
    }
    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    if (kind === "domain") {
      value = value.split(/[/?#]/)[0].replace(/:\d+$/, "").toLowerCase();
      if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(value) && !/^[a-z0-9.-]+$/i.test(value)) return null;
      return { type: "domain", value: value.replace(/^\*\./, "") };
    }
    const parsed = parseUrl(value);
    if (!parsed) return null;
    const prefix = (parsed.hostname + parsed.pathname + parsed.search).replace(/\/$/, "");
    return { type: "url", value: prefix.toLowerCase() };
  }

  function matchPattern(pattern, url, type) {
    const normalized = typeof pattern === "object" && pattern ? pattern : normalizePattern(pattern, type);
    if (!normalized) return false;
    const parsed = url instanceof URL ? url : parseUrl(url);
    if (!parsed) return false;
    if (normalized.type === "domain") return hostMatches(parsed.hostname, normalized.value);
    if (normalized.type === "keyword") {
      return (parsed.hostname + parsed.pathname + parsed.search).toLowerCase().includes(normalized.value);
    }
    const candidate = (parsed.hostname.replace(/^www\./, "") + parsed.pathname + parsed.search).toLowerCase();
    const full = (parsed.hostname + parsed.pathname + parsed.search).toLowerCase();
    const prefix = normalized.value;
    const bare = prefix.replace(/^www\./, "");
    return [full, candidate].some(text => text === prefix || text === bare || text.startsWith(prefix + "/") || text.startsWith(bare + "/") ||
      text.startsWith(prefix + "?") || text.startsWith(bare + "?") || (prefix.includes("?") && text.startsWith(prefix)));
  }

  // The WebFilter block page (<server>/blocked) must never be filtered or styled.
  function isBlockPage(url, blockPageUrl) {
    const parsed = url instanceof URL ? url : parseUrl(url);
    const page = parseUrl(blockPageUrl);
    if (!parsed || !page || !blockPageUrl) return false;
    const path = page.pathname.replace(/\/+$/, "");
    return parsed.origin === page.origin && (parsed.pathname === path || parsed.pathname === path + "/");
  }

  function isWebUrl(parsed) {
    return !!parsed && (parsed.protocol === "http:" || parsed.protocol === "https:");
  }

  const SAFE_MODES = Object.freeze(["google", "youtube", "munetios"]);
  const GOOGLE_SEARCH_FILTER = "^https?://(?:www\\.)?google\\.(?:com|cat|[a-z]{2}|(?:com|co)\\.[a-z]{2})(?::[0-9]+)?/(?:search|webhp|images|imghp|m/search|custom|safesearch|preferences)?(?:[?#]|$)";
  const YOUTUBE_RESTRICT_DOMAINS = Object.freeze(["youtube.com", "youtube-nocookie.com", "youtube.googleapis.com", "youtubei.googleapis.com"]);
  const YOUTUBE_VIDEO_DOMAINS = Object.freeze(["youtube.com", "youtube-nocookie.com", "youtubeeducation.com", "youtu.be"]);
  const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

  function youtubeVideoId(input) {
    const raw = String(input || "").trim();
    if (YOUTUBE_ID.test(raw)) return raw;
    const url = parseUrl(raw);
    if (!isWebUrl(url) || !YOUTUBE_VIDEO_DOMAINS.some(domain => hostMatches(url.hostname, domain))) return "";
    const [, route, id] = url.pathname.split("/");
    const value = hostMatches(url.hostname, "youtu.be") ? route
      : route === "watch" ? url.searchParams.get("v")
      : ["shorts", "live", "embed", "v"].includes(route) ? id : "";
    return value && YOUTUBE_ID.test(value) ? value : "";
  }

  function effectiveSiteControls(rawPolicy, classId) {
    const policy = normalizePolicy(rawPolicy);
    const klass = findClass(policy, classId);
    const allowed = new Set(klass?.allowedYouTubeVideos);
    const inherited = policy.global.blockedYouTubeVideos.filter(id => !allowed.has(id));
    return {
      safeModes: SAFE_MODES.filter(mode => policy.global.safeModes[mode] || (klass && klass.safeModes[mode])),
      blockedYouTubeVideos: [...new Set(inherited.concat(klass?.blockedYouTubeVideos || []))],
    };
  }

  function forcedSafeUrl(input, modes) {
    const url = parseUrl(input);
    if (!isWebUrl(url)) return "";
    const params = [];
    if (modes.includes("google") && new RegExp(GOOGLE_SEARCH_FILTER, "i").test(url.href)) {
      params.push(["safe", "active"]);
    }
    if (modes.includes("munetios") && hostMatches(url.hostname, "munetios.com")) {
      params.push(["schoolMode", "true"]);
    }
    if (!params.some(([key, value]) => url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value)) return "";
    params.forEach(([key, value]) => url.searchParams.set(key, value));
    return url.href;
  }

  /* ---------------------------------------------------------------- policy */

  function emptyUserCss(defaultMode) {
    return { defaultMode: defaultMode || "allowed", allowed: [], blocked: [], partial: [] };
  }

  function normalizePolicy(policy) {
    const source = policy && typeof policy === "object" ? policy : {};
    const global = source.global && typeof source.global === "object" ? source.global : {};
    const list = value => (Array.isArray(value) ? value.filter(item => typeof item === "string" && item.trim()) : []);
    const userCss = (value, fallback) => {
      const v = value && typeof value === "object" ? value : {};
      return {
        defaultMode: ["allowed", "partial", "blocked", "inherit"].includes(v.defaultMode) ? v.defaultMode : fallback,
        allowed: list(v.allowed),
        blocked: list(v.blocked),
        partial: list(v.partial),
      };
    };
    const rules = value => (Array.isArray(value) ? value.filter(rule => rule && typeof rule.value === "string") : []);
    const styles = value => (Array.isArray(value) ? value.filter(style => style && typeof style.css === "string") : []);
    const videoList = value => [...new Set(list(value).map(youtubeVideoId).filter(Boolean))];
    const siteControls = scope => ({
      safeModes: Object.fromEntries(SAFE_MODES.map(mode => [mode, scope.safeModes?.[mode] === true])),
      blockedYouTubeVideos: videoList(scope.blockedYouTubeVideos),
    });
    return {
      version: Number(source.version) || 0,
      updatedAt: Number(source.updatedAt) || 0,
      global: {
        ...siteControls(global),
        allowlistOnly: !!global.allowlistOnly,
        rules: rules(global.rules),
        blockedText: list(global.blockedText),
        blockedCategories: categoryList(global.blockedCategories),
        categoryOverrides: categoryOverrides(global.categoryOverrides),
        userCss: userCss(global.userCss, "allowed"),
        styles: styles(global.styles),
      },
      classes: (Array.isArray(source.classes) ? source.classes : []).filter(item => item && item.id).map(item => ({
        ...siteControls(item),
        allowedYouTubeVideos: videoList(item.allowedYouTubeVideos),
        id: String(item.id),
        name: String(item.name || ""),
        allowlistOnly: !!item.allowlistOnly,
        rules: rules(item.rules),
        blockedText: list(item.blockedText),
        blockedCategories: categoryList(item.blockedCategories),
        globalExceptions: {
          rules: list(item.globalExceptions && item.globalExceptions.rules),
          categories: categoryList(item.globalExceptions && item.globalExceptions.categories),
          text: list(item.globalExceptions && item.globalExceptions.text),
        },
        userCss: userCss(item.userCss, "inherit"),
        styles: styles(item.styles),
      })),
    };
  }

  function findClass(policy, classId) {
    return classId ? policy.classes.find(item => item.id === String(classId)) || null : null;
  }

  // Global settings as one class sees them: a Teacher can switch a Global rule,
  // category or blocked word off for their class only (class.globalExceptions).
  function effectiveGlobal(policy, klass) {
    const global = policy.global;
    if (!klass) return { rules: global.rules, blockedText: global.blockedText, blockedCategories: global.blockedCategories };
    const ex = klass.globalExceptions;
    const text = new Set(ex.text.map(normalizePhrase));
    return {
      rules: global.rules.filter(rule => !ex.rules.includes(rule.id)),
      blockedText: global.blockedText.filter(item => !text.has(normalizePhrase(item))),
      blockedCategories: global.blockedCategories.filter(item => !ex.categories.includes(item)),
    };
  }

  function firstRuleMatch(rules, action, parsed) {
    return rules.find(rule => rule.enabled !== false && rule.action === action && matchPattern(rule.value, parsed, rule.type)) || null;
  }

  /* --------------------------------------------------------- categories */

  // Built-in category list: well-known sites only, no network lookups. Anything
  // not found here (and not given a custom category) is "unrated".
  const CATEGORIES = Object.freeze(["education", "reference", "search", "productivity", "news", "social", "chat", "video", "music",
    "games", "gambling", "adult", "shopping", "ai", "sports", "government", "health", "proxy", "unrated"]);
  const CATEGORY_SET = new Set(CATEGORIES);
  const BUILTIN_CATEGORIES = (() => {
    const lists = {
      education: "khanacademy.org coursera.org edx.org duolingo.com quizlet.com brainpop.com ixl.com desmos.com code.org scratch.mit.edu classroom.google.com instructure.com schoology.com kahoot.com kahoot.it nearpod.com edpuzzle.com newsela.com commonlit.org readworks.org prodigygame.com mathway.com wolframalpha.com pbslearningmedia.org ck12.org gimkit.com blooket.com seesaw.me flip.com padlet.com typing.com typingclub.com brilliant.org mathsisfun.com coolmath.com",
      reference: "wikipedia.org wikimedia.org wiktionary.org wikibooks.org britannica.com merriam-webster.com dictionary.com thesaurus.com nationalgeographic.com archive.org wikihow.com howstuffworks.com stackoverflow.com stackexchange.com w3schools.com developer.mozilla.org openlibrary.org gutenberg.org",
      search: "google.com bing.com duckduckgo.com yahoo.com ecosia.org startpage.com kiddle.co search.brave.com ganetios.com",
      productivity: "docs.google.com drive.google.com sheets.google.com slides.google.com mail.google.com calendar.google.com office.com microsoft365.com onedrive.live.com outlook.com outlook.live.com notion.so canva.com dropbox.com box.com zoom.us teams.microsoft.com trello.com github.com gitlab.com replit.com munetios.com figma.com",
      news: "cnn.com bbc.com bbc.co.uk nytimes.com washingtonpost.com reuters.com apnews.com npr.org theguardian.com foxnews.com nbcnews.com cbsnews.com abcnews.go.com usatoday.com wsj.com bloomberg.com aljazeera.com news.google.com time.com",
      social: "facebook.com instagram.com tiktok.com twitter.com x.com snapchat.com pinterest.com reddit.com tumblr.com threads.net bsky.app linkedin.com mastodon.social vk.com weibo.com bereal.com",
      chat: "discord.com discord.gg whatsapp.com telegram.org messenger.com signal.org slack.com kik.com",
      video: "youtube.com youtu.be youtube-nocookie.com vimeo.com twitch.tv dailymotion.com netflix.com hulu.com disneyplus.com primevideo.com max.com peacocktv.com crunchyroll.com kick.com rumble.com",
      music: "spotify.com soundcloud.com music.apple.com pandora.com deezer.com tidal.com music.youtube.com",
      games: "roblox.com minecraft.net epicgames.com fortnite.com steampowered.com steamcommunity.com coolmathgames.com poki.com crazygames.com miniclip.com friv.com kongregate.com addictinggames.com chess.com lichess.org itch.io ea.com xbox.com playstation.com nintendo.com slither.io agar.io krunker.io y8.com armorgames.com 1v1.lol",
      gambling: "bet365.com draftkings.com fanduel.com pokerstars.com stake.com betmgm.com williamhill.com betway.com 888casino.com roobet.com",
      adult: "pornhub.com xvideos.com xnxx.com xhamster.com onlyfans.com redtube.com youporn.com chaturbate.com stripchat.com spankbang.com",
      shopping: "amazon.com ebay.com etsy.com walmart.com target.com aliexpress.com temu.com shein.com bestbuy.com wish.com",
      ai: "chatgpt.com openai.com claude.ai gemini.google.com perplexity.ai character.ai copilot.microsoft.com poe.com midjourney.com huggingface.co deepseek.com grok.com",
      sports: "espn.com nba.com nfl.com mlb.com nhl.com fifa.com uefa.com bleacherreport.com sports.yahoo.com skysports.com",
      government: "usa.gov whitehouse.gov irs.gov loc.gov gov.uk europa.eu un.org",
      health: "webmd.com mayoclinic.org healthline.com kidshealth.org medlineplus.gov clevelandclinic.org cdc.gov nih.gov",
      proxy: "proxysite.com croxyproxy.com hidester.com kproxy.com 4everproxy.com hide.me nordvpn.com expressvpn.com protonvpn.com browserling.com",
    };
    const map = new Map();
    Object.entries(lists).forEach(([category, domains]) => domains.split(" ").forEach(domain => map.set(domain, category)));
    // The full curated list (webfilter-categories.js, 5,000+ sites) is loaded next to this file:
    // required in Node, or present as a global in the console, block page tools and extension.
    let data = null;
    if (typeof module === "object" && module.exports && typeof require === "function") {
      try { data = require("./webfilter-categories.js"); } catch (error) { data = null; }
    } else if (typeof globalThis !== "undefined") {
      data = globalThis.MunetiosWebFilterCategories || null;
    }
    if (data) Object.entries(data).forEach(([category, domains]) => { if (Array.isArray(domains)) domains.forEach(domain => map.set(domain, category)); });
    return map;
  })();

  function categoryList(value) {
    return Array.isArray(value) ? Array.from(new Set(value.filter(item => CATEGORY_SET.has(item)))) : [];
  }

  function categoryOverrides(value) {
    const out = {};
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([domain, category]) => {
        const pattern = normalizePattern(domain, "domain");
        if (pattern && CATEGORY_SET.has(category)) out[pattern.value] = category;
      });
    }
    return out;
  }

  // Most specific domain wins; at the same level a custom category beats the built-in list.
  function categorize(url, rawPolicy) {
    const parsed = url instanceof URL ? url : parseUrl(url);
    const host = parsed ? parsed.hostname.toLowerCase().replace(/\.$/, "") : "";
    if (!host) return { category: "unrated", source: "unrated", domain: "" };
    const overrides = rawPolicy && rawPolicy.global && rawPolicy.global.categoryOverrides && !Array.isArray(rawPolicy.global.categoryOverrides)
      ? categoryOverrides(rawPolicy.global.categoryOverrides) : {};
    if (/^[\d.]+$|^\[|^localhost$/.test(host)) {
      return overrides[host] ? { category: overrides[host], source: "custom", domain: host } : { category: "unrated", source: "unrated", domain: host };
    }
    const labels = host.split(".");
    for (let i = 0; i < labels.length - 1 || (i === 0 && labels.length === 1); i++) {
      const candidate = labels.slice(i).join(".");
      if (Object.prototype.hasOwnProperty.call(overrides, candidate)) return { category: overrides[candidate], source: "custom", domain: candidate };
      if (BUILTIN_CATEGORIES.has(candidate)) return { category: BUILTIN_CATEGORIES.get(candidate), source: "builtin", domain: candidate };
    }
    if (/\.(edu|k12\.[a-z]{2}\.us)$|\.(edu|ac|sch)\.[a-z]{2}$/.test(host)) return { category: "education", source: "builtin", domain: host };
    if (/\.(gov|mil)$|\.(gov|gob|gouv|govt)\.[a-z]{2}$/.test(host)) return { category: "government", source: "builtin", domain: host };
    return { category: "unrated", source: "unrated", domain: host };
  }

  // Domains in one category (built-in list plus custom categories), for network-level rules.
  function categoryDomains(category, rawPolicy) {
    const overrides = categoryOverrides(rawPolicy && rawPolicy.global && rawPolicy.global.categoryOverrides);
    const list = [];
    BUILTIN_CATEGORIES.forEach((value, domain) => {
      if (value === category && !(Object.prototype.hasOwnProperty.call(overrides, domain) && overrides[domain] !== category)) list.push(domain);
    });
    Object.entries(overrides).forEach(([domain, value]) => { if (value === category && !list.includes(domain)) list.push(domain); });
    return list;
  }

  function categorizedDomains(rawPolicy) {
    const overrides = categoryOverrides(rawPolicy && rawPolicy.global && rawPolicy.global.categoryOverrides);
    return Array.from(new Set(Array.from(BUILTIN_CATEGORIES.keys()).concat(Object.keys(overrides))));
  }

  /* ------------------------------------------------------- blocked text */

  function normalizeText(value) {
    return String(value == null ? "" : value).normalize("NFKC").toLowerCase();
  }

  function normalizePhrase(value) {
    return normalizeText(value).replace(/[\s\p{P}\p{S}]+/gu, " ").trim();
  }

  // Whole words only ("ass" never matches "class"); words may be separated by
  // spaces, punctuation or URL separators ("bad word", "bad-word", "bad+word").
  function phraseRegExp(phrase, flags) {
    const words = normalizePhrase(phrase).split(" ").filter(Boolean).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return null;
    return new RegExp("(?<![\\p{L}\\p{N}])" + words.join("[\\s\\p{P}\\p{S}]+") + "(?![\\p{L}\\p{N}])", flags || "u");
  }

  function findBlockedText(text, phrases) {
    const haystack = normalizeText(text);
    for (const phrase of phrases || []) {
      const pattern = phraseRegExp(phrase);
      if (pattern && pattern.test(haystack)) return phrase;
    }
    return null;
  }

  // Removes every blocked phrase from typed text (case-insensitive).
  function stripBlockedText(text, phrases) {
    let output = String(text == null ? "" : text);
    for (const phrase of phrases || []) {
      const pattern = phraseRegExp(phrase, "giu");
      if (pattern) output = output.normalize("NFKC").replace(pattern, "");
    }
    return output;
  }

  function urlText(parsed) {
    let text = parsed.hostname + " " + parsed.pathname + " " + parsed.search + " " + parsed.hash;
    text = text.replace(/\+/g, " ");
    try { text = decodeURIComponent(text); } catch (error) { /* keep the raw text */ }
    return text;
  }

  function allowRuleFor(policy, klass, parsed) {
    return (klass ? firstRuleMatch(klass.rules, "allow", parsed) : null) || firstRuleMatch(effectiveGlobal(policy, klass).rules, "allow", parsed);
  }

  function textPhrases(policy, klass) {
    return Array.from(new Set(effectiveGlobal(policy, klass).blockedText.concat(klass ? klass.blockedText : []).map(normalizePhrase).filter(Boolean)));
  }

  function activeTempAllow(parsed, context, now) {
    return (Array.isArray(context.tempAllows) ? context.tempAllows : [])
      .find(item => item && (!item.until || item.until > now) && matchPattern(item.pattern, parsed)) || null;
  }

  // Blocked text for one page. Websites on an allow rule (or a bypass) are exempt.
  function textFilterFor(url, rawPolicy, ctx) {
    const context = ctx || {};
    const policy = normalizePolicy(rawPolicy);
    const parsed = parseUrl(url);
    if (!isWebUrl(parsed) || isBlockPage(parsed, context.blockPageUrl)) return { phrases: [], exempt: true };
    if (activeTempAllow(parsed, context, Number(context.now) || Date.now())) return { phrases: [], exempt: true };
    const klass = findClass(policy, context.classId);
    if (allowRuleFor(policy, klass, parsed)) return { phrases: [], exempt: true };
    return { phrases: textPhrases(policy, klass), exempt: false };
  }

  // Precedence: bypass > temporary device block > class block > class allow > global block > global allow
  // > blocked text > blocked categories > allowlist-only > open.
  function evaluateAccess(url, rawPolicy, ctx) {
    const context = ctx || {};
    const policy = normalizePolicy(rawPolicy);
    const parsed = parseUrl(url);
    if (!parsed) return { blocked: false, reason: "invalid", scope: null, rule: null };
    if (!isWebUrl(parsed)) return { blocked: false, reason: "internal", scope: null, rule: null };
    if (isBlockPage(parsed, context.blockPageUrl)) return { blocked: false, reason: "webfilter-page", scope: null, rule: null };
    const now = Number(context.now) || Date.now();
    // An Admin's bypass password opens a site on this device for a while, above every rule.
    const bypass = activeTempAllow(parsed, context, now);
    if (bypass) return { blocked: false, reason: "bypass", scope: "device", rule: { value: bypass.pattern, until: bypass.until || 0 } };
    const temporary = (Array.isArray(context.tempBlocks) ? context.tempBlocks : [])
      .find(block => block && (!block.until || block.until > now) && matchPattern(block.pattern, parsed));
    if (temporary) return { blocked: true, reason: "temporary", scope: "device", rule: { id: temporary.id, value: temporary.pattern, until: temporary.until || 0 } };
    const klass = findClass(policy, context.classId);
    const global = effectiveGlobal(policy, klass);
    // A class's own rules come first, so a Teacher's Allow or Block applies to their class only.
    const classBlock = klass ? firstRuleMatch(klass.rules, "block", parsed) : null;
    if (classBlock) return { blocked: true, reason: "class-block", scope: klass.id, rule: classBlock };
    const classAllow = klass ? firstRuleMatch(klass.rules, "allow", parsed) : null;
    if (classAllow) return { blocked: false, reason: "allow-rule", scope: klass.id, rule: classAllow };
    const globalBlock = firstRuleMatch(global.rules, "block", parsed);
    if (globalBlock) return { blocked: true, reason: "global-block", scope: "global", rule: globalBlock };
    const globalAllow = firstRuleMatch(global.rules, "allow", parsed);
    if (globalAllow) return { blocked: false, reason: "allow-rule", scope: "global", rule: globalAllow };
    const phrase = findBlockedText(urlText(parsed), textPhrases(policy, klass));
    if (phrase) {
      const scope = global.blockedText.some(item => normalizePhrase(item) === phrase) ? "global" : klass.id;
      return { blocked: true, reason: "blocked-text", scope, rule: { value: phrase } };
    }
    const globalCategories = global.blockedCategories;
    const classCategories = klass ? klass.blockedCategories : [];
    if (globalCategories.length || classCategories.length) {
      const category = categorize(parsed, policy).category;
      if (globalCategories.includes(category)) return { blocked: true, reason: "category-block", scope: "global", rule: { value: category } };
      if (classCategories.includes(category)) return { blocked: true, reason: "category-block", scope: klass.id, rule: { value: category } };
    }
    if (policy.global.allowlistOnly) return { blocked: true, reason: "allowlist-only", scope: "global", rule: null };
    if (klass && klass.allowlistOnly) return { blocked: true, reason: "allowlist-only", scope: klass.id, rule: null };
    return { blocked: false, reason: "open", scope: null, rule: null };
  }

  // External UserCSS resources are allowed only for hosts on the Allowed Website List
  // (enabled "allow" web filter rules, global plus the device's class).
  function isOnAllowedWebsiteList(url, rawPolicy, ctx) {
    const policy = normalizePolicy(rawPolicy);
    const parsed = parseUrl(url);
    if (!isWebUrl(parsed)) return false;
    const klass = findClass(policy, ctx && ctx.classId);
    const rules = effectiveGlobal(policy, klass).rules.concat(klass ? klass.rules : []);
    return rules.some(rule => rule.enabled !== false && rule.action === "allow" && rule.type !== "keyword" && matchPattern(rule.value, parsed, rule.type));
  }

  function listMatch(userCss, parsed) {
    for (const mode of ["blocked", "partial", "allowed"]) {
      const pattern = userCss[mode].find(item => matchPattern(item, parsed));
      if (pattern) return { mode, pattern };
    }
    return null;
  }

  function resolveUserCssMode(url, rawPolicy, ctx) {
    const context = ctx || {};
    const policy = normalizePolicy(rawPolicy);
    const access = evaluateAccess(url, policy, context);
    if (access.reason === "webfilter-page") return { mode: "restricted", source: { scope: null, list: "webfilter-page", pattern: "" }, access };
    if (access.blocked) return { mode: "restricted", source: { scope: access.scope, list: "webfilter", pattern: access.rule ? access.rule.value : "" }, access };
    const parsed = parseUrl(url);
    if (!isWebUrl(parsed)) return { mode: "blocked", source: { scope: null, list: "internal", pattern: "" }, access };
    const results = [];
    const globalMatch = listMatch(policy.global.userCss, parsed);
    results.push(globalMatch
      ? { mode: globalMatch.mode, source: { scope: "global", list: globalMatch.mode, pattern: globalMatch.pattern } }
      : { mode: policy.global.userCss.defaultMode === "inherit" ? "allowed" : policy.global.userCss.defaultMode, source: { scope: "global", list: "default", pattern: "" } });
    const klass = findClass(policy, context.classId);
    if (klass) {
      const classMatch = listMatch(klass.userCss, parsed);
      if (classMatch) results.push({ mode: classMatch.mode, source: { scope: klass.id, list: classMatch.mode, pattern: classMatch.pattern } });
      else if (klass.userCss.defaultMode !== "inherit") results.push({ mode: klass.userCss.defaultMode, source: { scope: klass.id, list: "default", pattern: "" } });
    }
    // The most restrictive answer wins: a class can tighten Global, never loosen it.
    const winner = results.reduce((best, item) => (MODE_RANK[item.mode] > MODE_RANK[best.mode] ? item : best), results[0]);
    return { mode: winner.mode, source: winner.source, access };
  }

  function stylesForUrl(url, rawPolicy, ctx) {
    const policy = normalizePolicy(rawPolicy);
    const parsed = parseUrl(url);
    if (!parsed) return [];
    const klass = findClass(policy, ctx && ctx.classId);
    const targets = style => (Array.isArray(style.targets) ? style.targets.filter(Boolean) : []);
    const matches = style => style.enabled !== false && (!targets(style).length || targets(style).some(pattern => matchPattern(pattern, parsed)));
    // A student's own styles (written in the extension's UserCSS editor) join only when
    // they turned injection on; they go through the same policy sandbox as everything else.
    const own = ctx && ctx.injectUserCss && Array.isArray(ctx.userStyles) ? ctx.userStyles.filter(style => style && typeof style.css === "string") : [];
    return policy.global.styles.filter(matches).map(style => Object.assign({ scope: "global" }, style))
      .concat(klass ? klass.styles.filter(matches).map(style => Object.assign({ scope: klass.id }, style)) : [])
      .concat(own.filter(matches).map(style => Object.assign({ scope: "user" }, style)));
  }

  /* ------------------------------------------------------------ css parser */

  function stripComments(text) {
    let out = "";
    let i = 0;
    let quote = "";
    while (i < text.length) {
      const ch = text[i];
      if (quote) {
        out += ch;
        if (ch === "\\" && i + 1 < text.length) { out += text[i + 1]; i += 2; continue; }
        if (ch === quote) quote = "";
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; out += ch; i++; continue; }
      if (ch === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        const chunk = end < 0 ? text.slice(i) : text.slice(i, end + 2);
        out += chunk.replace(/[^\n]/g, " ");
        i += chunk.length;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  // Index of the matching "}" for the "{" at `open`, respecting strings and nesting.
  function matchBrace(text, open) {
    let depth = 0;
    let quote = "";
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === "\\") { i++; continue; }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) return i; }
    }
    return text.length;
  }

  // First index of any char in `stops` at paren/bracket depth 0 outside strings.
  function scanTo(text, start, end, stops) {
    let depth = 0;
    let quote = "";
    for (let i = start; i < end; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === "\\") { i++; continue; }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "(" || ch === "[") depth++;
      else if ((ch === ")" || ch === "]") && depth > 0) depth--;
      else if (depth === 0 && stops.includes(ch)) return i;
    }
    return end;
  }

  function lineAt(lines, index) {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  function parseDeclarations(text, start, end, lines, nested) {
    const decls = [];
    let i = start;
    while (i < end) {
      const stop = scanTo(text, i, end, ";{");
      if (stop < end && text[stop] === "{") {
        // CSS nesting inside a style rule is not supported by the sandbox.
        const close = matchBrace(text, stop);
        nested.push({ selector: text.slice(i, stop).trim(), line: lineAt(lines, i) });
        i = close + 1;
        continue;
      }
      const chunk = text.slice(i, stop);
      const colon = scanTo(chunk, 0, chunk.length, ":");
      if (chunk.trim() && colon < chunk.length) {
        let value = chunk.slice(colon + 1).trim();
        let important = false;
        const bang = value.match(/!\s*important\s*$/i);
        if (bang) { important = true; value = value.slice(0, bang.index).trim(); }
        const offset = i + chunk.search(/\S/);
        decls.push({ prop: chunk.slice(0, colon).trim().toLowerCase(), rawProp: chunk.slice(0, colon).trim(), value, important, line: lineAt(lines, Math.max(offset, i)) });
      } else if (chunk.trim()) {
        decls.push({ prop: "", rawProp: chunk.trim(), value: "", important: false, invalid: true, line: lineAt(lines, i + chunk.search(/\S/)) });
      }
      i = stop + 1;
    }
    return decls;
  }

  function parseRules(text, start, end, lines) {
    const nodes = [];
    let i = start;
    while (i < end) {
      while (i < end && /\s/.test(text[i])) i++;
      if (i >= end) break;
      if (text[i] === "}" || text[i] === ";") { i++; continue; }
      const line = lineAt(lines, i);
      if (text[i] === "@") {
        const nameMatch = /^@([-a-zA-Z0-9_]+)/.exec(text.slice(i, Math.min(end, i + 64)));
        const name = nameMatch ? nameMatch[1].toLowerCase() : "";
        const stop = scanTo(text, i, end, ";{");
        const prelude = text.slice(i + (nameMatch ? nameMatch[0].length : 1), stop).trim();
        if (stop >= end || text[stop] === ";") {
          nodes.push({ type: "at", name, prelude, line, statement: true });
          i = stop + 1;
          continue;
        }
        const close = matchBrace(text, stop);
        const node = { type: "at", name, prelude, line, statement: false };
        if (NESTED_AT_RULES.has(name) || /keyframes$/.test(name)) node.children = parseRules(text, stop + 1, close, lines);
        else if (DECLARATION_AT_RULES.has(name)) { node.nested = []; node.decls = parseDeclarations(text, stop + 1, close, lines, node.nested); }
        else node.body = text.slice(stop + 1, close);
        nodes.push(node);
        i = close + 1;
        continue;
      }
      const open = scanTo(text, i, end, "{;");
      if (open >= end || text[open] === ";") { nodes.push({ type: "junk", text: text.slice(i, open).trim(), line }); i = open + 1; continue; }
      const close = matchBrace(text, open);
      const nested = [];
      nodes.push({ type: "rule", selector: text.slice(i, open).trim().replace(/\s+/g, " "), decls: parseDeclarations(text, open + 1, Math.min(close, end), lines, nested), nested, line });
      i = close + 1;
    }
    return nodes;
  }

  function parseStylesheet(css) {
    const text = stripComments(String(css == null ? "" : css));
    const lines = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") lines.push(i + 1);
    return parseRules(text, 0, text.length, lines);
  }

  /* -------------------------------------------------------------- sandbox */

  function extractUrls(value) {
    const urls = [];
    const pattern = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/gi;
    let match;
    while ((match = pattern.exec(value))) urls.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
    // image-set("a.png" 1x) and src("...") take plain strings as URLs too.
    const setPattern = /(?:image-set|-webkit-image-set|src)\(([^)]*)\)/gi;
    while ((match = setPattern.exec(value))) {
      const strings = match[1].match(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g) || [];
      strings.forEach(item => urls.push(item.slice(1, -1).trim()));
    }
    return urls;
  }

  const SAFE_DATA = /^data:(?:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff2?|x-font-ttf|x-font-woff))[;,]/i;
  const RISKY_VALUE = /expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|-moz-binding|livescript\s*:/i;

  function classifyUrl(raw, options) {
    const value = String(raw || "").trim();
    if (!value || value.startsWith("#")) return { ok: true, kind: "fragment" };
    if (/^(?:javascript|vbscript|livescript)\s*:/i.test(value) || /^data\s*:\s*text\/html/i.test(value)) return { ok: false, kind: "script-url", risky: true };
    if (/^data:/i.test(value)) return SAFE_DATA.test(value) ? { ok: true, kind: "data" } : { ok: false, kind: "data-uri" };
    const extensionMatch = /^chrome-extension:\/\/([a-p]{32})\/(.*)$/i.exec(value);
    if (extensionMatch) {
      const sameExtension = !options.extensionId || options.extensionId === extensionMatch[1].toLowerCase();
      return sameExtension && extensionMatch[2] === FONT_PATH ? { ok: true, kind: "extension-font" } : { ok: false, kind: "extension-url" };
    }
    if (/^\/\//.test(value) || /^https?:/i.test(value)) {
      const parsed = parseUrl(/^\/\//.test(value) ? "https:" + value : value);
      if (!parsed) return { ok: false, kind: "invalid-url" };
      const allowed = typeof options.isExternalAllowed === "function" && options.isExternalAllowed(parsed.href);
      return allowed ? { ok: true, kind: "external-allowed", host: parsed.hostname } : { ok: false, kind: "external", host: parsed.hostname };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { ok: false, kind: "scheme" };
    return { ok: true, kind: "relative" };
  }

  function numeric(value) {
    const match = /^(-?\d*\.?\d+)\s*([a-z%]*)$/i.exec(String(value).trim());
    return match ? { n: parseFloat(match[1]), unit: match[2].toLowerCase() } : null;
  }

  function coversAxis(map, startProp, endProp, sizeProps, viewportUnit, fixed) {
    const unknown = value => /var\(|env\(|calc\(/i.test(value);
    const edge = value => {
      if (value == null) return false;
      if (unknown(value)) return fixed;
      const n = numeric(value);
      return !!n && n.n <= 0;
    };
    const size = value => {
      if (value == null) return false;
      if (unknown(value)) return fixed || new RegExp("100\\s*" + viewportUnit, "i").test(value);
      const n = numeric(value);
      if (!n) return false;
      if (n.unit === viewportUnit || n.unit === "d" + viewportUnit || n.unit === "s" + viewportUnit || n.unit === "l" + viewportUnit) return n.n >= 90;
      if (n.unit === "%") return fixed && n.n >= 90;
      if (n.unit === "px") return n.n >= 2000;
      return false;
    };
    // Zero insets cover the viewport only for fixed boxes (absolute ones cover their parent).
    return (fixed && edge(map[startProp]) && edge(map[endProp])) || sizeProps.some(prop => size(map[prop]));
  }

  function insetParts(value) {
    if (value == null) return null;
    const parts = String(value).trim().split(/\s+/);
    const [t, r = t, b = t, l = r] = parts;
    return { top: t, right: r, bottom: b, left: l };
  }

  function selectorParts(selector) {
    const parts = [];
    let start = 0;
    let depth = 0;
    let quote = "";
    for (let i = 0; i < selector.length; i++) {
      const ch = selector[i];
      if (quote) { if (ch === quote) quote = ""; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      else if (ch === "," && depth === 0) { parts.push(selector.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(selector.slice(start).trim());
    return parts.filter(Boolean);
  }

  function lastCompound(part) {
    const pieces = part.replace(/\([^)]*\)|\[[^\]]*\]/g, m => m.replace(/[\s>+~]/g, "_")).split(/\s*[\s>+~]\s*/);
    return pieces[pieces.length - 1] || "";
  }

  // Could this selector match <html>? WebFilter notices hang off <html>, so hiding
  // properties are never allowed there (html, :root, *, [lang], :not(p), ...).
  function mayMatchRoot(part) {
    const compound = lastCompound(part);
    if (/^html\b/i.test(compound) || /:root\b/i.test(compound)) return true;
    const flat = part.replace(/\([^)]*\)|\[[^\]]*\]/g, "").trim();
    if (/[\s>+~]/.test(flat)) return false;
    const compoundFlat = compound.replace(/\([^)]*\)|\[[^\]]*\]/g, "").replace(/::?[-a-z]+/gi, "");
    const type = /^([a-z][a-z0-9-]*|\*)/i.exec(compoundFlat);
    if (type && type[1] !== "*" && type[1].toLowerCase() !== "html") return false;
    return !/[.#]/.test(compoundFlat);
  }

  function targetsInteractive(part) {
    const compound = lastCompound(part);
    return INTERACTIVE_TYPES.test(" " + compound) || INTERACTIVE_ATTRS.test(compound) || /^\*$/.test(compound);
  }

  function createReport() {
    return { violations: [], kept: 0, stripped: 0, blockedDomains: [] };
  }

  function report(state, violation) {
    state.report.violations.push(Object.assign({ selector: state.selector || "" }, violation));
    if (violation.host && !state.report.blockedDomains.includes(violation.host)) state.report.blockedDomains.push(violation.host);
  }

  // Returns the URL problems of a value, or [] when every URL is fine.
  function urlProblems(value, state) {
    return extractUrls(value).map(url => ({ url, verdict: classifyUrl(url, state.options) })).filter(item => !item.verdict.ok);
  }

  function sanitizeDeclaration(decl, state, context) {
    const { prop, value } = decl;
    const base = { property: decl.rawProp, value, line: decl.line };
    if (decl.invalid || !PROPERTY_NAME.test(prop)) {
      report(state, Object.assign({ code: "invalid-declaration", category: "stripped" }, base));
      return null;
    }
    if (decl.rawProp.includes("\\") || value.includes("\\")) {
      report(state, Object.assign({ code: "escape-obfuscation", category: "risky" }, base));
      return null;
    }
    if (LEGACY_SCRIPT_PROPERTIES.has(prop) || RISKY_VALUE.test(value)) {
      report(state, Object.assign({ code: "script-vector", category: "risky" }, base));
      return null;
    }
    if (state.options.mode === "partial" && !context.fontFace && !PARTIAL_SET.has(prop)) {
      report(state, Object.assign({ code: "partial-property", category: "stripped" }, base));
      return null;
    }
    const problems = urlProblems(value, state);
    if (problems.length) {
      problems.forEach(problem => {
        const code = problem.verdict.kind === "external" ? "external-resource" : problem.verdict.risky ? "script-vector" : "blocked-url";
        report(state, Object.assign({ code, category: problem.verdict.risky ? "risky" : "blocked", url: problem.url, host: problem.verdict.host || "" }, base));
      });
      return null;
    }
    if (prop === "z-index") {
      if (/var\(|calc\(|env\(/i.test(value)) { report(state, Object.assign({ code: "z-index-indirect", category: "risky" }, base)); return null; }
      const n = parseInt(value, 10);
      if (Number.isFinite(n) && n > 9999) { report(state, Object.assign({ code: "z-index-extreme", category: "risky" }, base)); return null; }
    }
    if (context.interactive) {
      const opacity = prop === "opacity" ? numeric(value) : null;
      const transparent = opacity && (opacity.unit === "%" ? opacity.n <= 10 : opacity.n <= 0.1);
      if ((prop === "pointer-events" && /none/i.test(value)) || transparent || (prop === "opacity" && /var\(/i.test(value))) {
        report(state, Object.assign({ code: "interactive-spoofing", category: "risky" }, base));
        return null;
      }
    }
    if (context.root && HIDING_PROPERTIES.has(prop)) {
      report(state, Object.assign({ code: "protected-overlay", category: "risky" }, base));
      return null;
    }
    return decl;
  }

  function sanitizeStyleRule(node, state) {
    state.selector = node.selector;
    const out = [];
    if (!node.selector) return null;
    if (node.selector.includes("\\")) {
      report(state, { code: "escape-obfuscation", category: "risky", line: node.line });
      state.report.stripped += node.decls.length;
      return null;
    }
    if (RISKY_VALUE.test(node.selector)) {
      report(state, { code: "script-vector", category: "risky", line: node.line });
      state.report.stripped += node.decls.length;
      return null;
    }
    if (PROTECTED_SELECTOR.test(node.selector)) {
      report(state, { code: "protected-target", category: "risky", line: node.line });
      state.report.stripped += node.decls.length;
      return null;
    }
    const parts = selectorParts(node.selector);
    const sensitive = SENSITIVE_SELECTOR.test(node.selector);
    if (sensitive && node.decls.some(decl => /url\(|image-set\(|var\(|src\(/i.test(decl.value))) {
      report(state, { code: "exfiltration", category: "risky", line: node.line });
      state.report.stripped += node.decls.length;
      return null;
    }
    (node.nested || []).forEach(item => report(state, { code: "nested-rule", category: "stripped", line: item.line, value: item.selector }));
    const context = {
      interactive: parts.some(targetsInteractive),
      root: parts.some(mayMatchRoot),
    };
    const kept = node.decls.map(decl => sanitizeDeclaration(decl, state, context)).filter(Boolean);
    // Full-viewport fixed/absolute overlays (UI redressing / clickjacking).
    const map = {};
    kept.forEach(decl => { map[decl.prop] = decl.value; });
    const position = String(map.position || "").toLowerCase();
    if (position === "fixed" || position === "absolute") {
      const fixed = position === "fixed" || context.root;
      const inset = insetParts(map.inset);
      const geometry = Object.assign({}, inset ? { top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left } : {}, map);
      const horizontal = coversAxis(geometry, "left", "right", ["width", "min-width", "inline-size", "min-inline-size"], "vw", fixed);
      const vertical = coversAxis(geometry, "top", "bottom", ["height", "min-height", "block-size", "min-block-size"], "vh", fixed);
      if (horizontal && vertical) {
        kept.filter(decl => GEOMETRY_PROPERTIES.has(decl.prop)).forEach(decl => {
          report(state, { code: "viewport-overlay", category: "risky", property: decl.rawProp, value: decl.value, line: decl.line });
        });
        for (let i = kept.length - 1; i >= 0; i--) if (GEOMETRY_PROPERTIES.has(kept[i].prop)) kept.splice(i, 1);
      }
    }
    state.report.kept += kept.length;
    state.report.stripped += node.decls.length - kept.length;
    if (!kept.length) return null;
    out.push(node.selector + " {");
    kept.forEach(decl => out.push("  " + decl.rawProp.toLowerCase() + ": " + decl.value + (decl.important ? " !important" : "") + ";"));
    out.push("}");
    return out.join("\n");
  }

  function sanitizeFontFace(node, state) {
    state.selector = "@font-face";
    const unicodeRange = node.decls.some(decl => decl.prop === "unicode-range");
    const src = node.decls.filter(decl => decl.prop === "src").map(decl => decl.value).join(",");
    const remote = extractUrls(src).some(url => /^(?:https?:)?\/\//i.test(url));
    if (unicodeRange && remote) {
      report(state, { code: "font-tracking", category: "risky", line: node.line, value: src });
      state.report.stripped += node.decls.length;
      return null;
    }
    const kept = node.decls.map(decl => sanitizeDeclaration(decl, state, { fontFace: true })).filter(Boolean);
    state.report.kept += kept.length;
    state.report.stripped += node.decls.length - kept.length;
    if (!kept.some(decl => decl.prop === "src") || !kept.some(decl => decl.prop === "font-family")) {
      if (kept.length) report(state, { code: "font-face-incomplete", category: "stripped", line: node.line });
      return null;
    }
    return "@font-face {\n" + kept.map(decl => "  " + decl.prop + ": " + decl.value + (decl.important ? " !important" : "") + ";").join("\n") + "\n}";
  }

  function indent(text) {
    return text.split("\n").map(line => (line ? "  " + line : line)).join("\n");
  }

  function sanitizeNodes(nodes, state) {
    const out = [];
    nodes.forEach(node => {
      if (node.type === "junk") {
        if (node.text) report(state, { code: "invalid-declaration", category: "stripped", line: node.line, value: node.text });
        return;
      }
      if (node.type === "rule") {
        const css = sanitizeStyleRule(node, state);
        if (css) out.push(css);
        return;
      }
      state.selector = "@" + node.name;
      const name = node.name;
      if (name === "charset") return;
      if (node.prelude.includes("\\") || RISKY_VALUE.test(node.prelude)) {
        report(state, { code: RISKY_VALUE.test(node.prelude) ? "script-vector" : "escape-obfuscation", category: "risky", line: node.line, value: node.prelude });
        return;
      }
      if (name === "import") {
        if (state.options.mode === "partial") {
          report(state, { code: "partial-import", category: "stripped", line: node.line, value: node.prelude });
          return;
        }
        const quoted = /^\s*(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?/i.exec(node.prelude);
        const target = quoted ? quoted[1] : "";
        const verdict = classifyUrl(target, state.options);
        if (!verdict.ok || verdict.kind === "relative" || verdict.kind === "data") {
          report(state, { code: verdict.kind === "external" ? "external-import" : verdict.risky ? "script-vector" : "blocked-import", category: verdict.risky ? "risky" : "blocked", line: node.line, url: target, host: verdict.host || "" });
          return;
        }
        out.push("@import " + node.prelude + ";");
        return;
      }
      if (state.options.mode === "partial" && !PARTIAL_AT_RULES.has(name)) {
        report(state, { code: "partial-at-rule", category: "stripped", line: node.line, value: "@" + name });
        return;
      }
      if (name === "font-face") {
        const css = sanitizeFontFace(node, state);
        if (css) out.push(css);
        return;
      }
      if (node.children && (NESTED_AT_RULES.has(name) || /keyframes$/.test(name))) {
        let inner;
        if (/keyframes$/.test(name)) {
          const frames = node.children.filter(child => child.type === "rule").map(child => {
            state.selector = child.selector;
            const kept = child.decls.map(decl => sanitizeDeclaration(decl, state, {})).filter(Boolean);
            state.report.kept += kept.length;
            state.report.stripped += child.decls.length - kept.length;
            return kept.length ? child.selector + " {\n" + kept.map(decl => "  " + decl.prop + ": " + decl.value + ";").join("\n") + "\n}" : "";
          }).filter(Boolean);
          inner = frames.join("\n");
        } else {
          inner = sanitizeNodes(node.children, state);
        }
        if (inner.trim()) out.push("@" + name + (node.prelude ? " " + node.prelude : "") + " {\n" + indent(inner) + "\n}");
        return;
      }
      if (node.statement && name === "layer") { out.push("@layer " + node.prelude + ";"); return; }
      report(state, { code: "unsupported-at-rule", category: "stripped", line: node.line, value: "@" + name });
    });
    return out.join("\n\n");
  }

  /**
   * options.mode: "allowed" | "partial" | "blocked" | "restricted"
   * options.isExternalAllowed(url): true when the host is on the Allowed Website List
   * options.extensionId: the extension's own ID (only its bundled font is allowed)
   */
  function sanitizeCss(css, rawOptions) {
    const options = Object.assign({ mode: "allowed" }, rawOptions || {});
    const state = { options, report: createReport(), selector: "" };
    const source = String(css == null ? "" : css);
    if (options.mode === "blocked" || options.mode === "restricted") {
      if (source.trim()) report(state, { code: options.mode === "restricted" ? "restricted-page" : "blocked-url-policy", category: "blocked", line: 1 });
      return { css: "", mode: options.mode, violations: state.report.violations, kept: 0, stripped: 0, blockedDomains: [] };
    }
    const output = sanitizeNodes(parseStylesheet(source), state);
    return {
      css: output ? output + "\n" : "",
      mode: options.mode,
      violations: state.report.violations,
      kept: state.report.kept,
      stripped: state.report.stripped,
      blockedDomains: state.report.blockedDomains,
    };
  }

  function usesGoogleSansFlex(css) {
    return /google\s+sans\s+flex/i.test(String(css || ""));
  }

  // The bundled file is the ss01 build of Google Sans Flex, so ss01 is part of the
  // glyphs themselves: no font-feature-settings is ever set on the page, and other
  // fonts on the site keep their own features. The descriptor below only applies
  // to this face in browsers that support it.
  function fontFaceCss(fontUrl) {
    return "@font-face {\n  font-family: 'Google Sans Flex';\n  src: url('" + fontUrl + "') format('truetype');\n  font-weight: 1 1000;\n  font-stretch: 25% 151%;\n  font-style: normal;\n  font-display: swap;\n  font-feature-settings: \"ss01\" 1;\n}\n";
  }

  function computePageStyles(url, rawPolicy, ctx) {
    const context = ctx || {};
    const policy = normalizePolicy(rawPolicy);
    const resolved = resolveUserCssMode(url, policy, context);
    const styles = resolved.mode === "restricted" || resolved.mode === "blocked" ? [] : stylesForUrl(url, policy, context);
    const combined = styles.map(style => "/* " + String(style.name || style.id || "UserCSS").replace(/\*\//g, "") + " */\n" + style.css).join("\n\n");
    const result = sanitizeCss(combined, {
      mode: resolved.mode,
      extensionId: context.extensionId,
      isExternalAllowed: target => isOnAllowedWebsiteList(target, policy, context),
    });
    return {
      url: String(url || ""),
      access: resolved.access,
      mode: resolved.mode,
      source: resolved.source,
      styles: styles.map(style => ({ id: style.id, name: style.name, scope: style.scope })),
      css: result.css,
      violations: result.violations,
      usesGoogleSansFlex: usesGoogleSansFlex(result.css),
      textFilter: textFilterFor(url, policy, context),
    };
  }

  /* ---------------------------------------------------- editor suggestions */

  const FONT_VALUES = ["'Google Sans Flex'", "'Google Sans Mono'", "'Google Sans Flex', system-ui, sans-serif", "'Google Sans Mono', ui-monospace, monospace", "system-ui", "sans-serif", "serif", "monospace", "inherit"];
  const COLOR_VALUES = ["#8f5cff", "#f6f3ff", "#110736", "#1d2433", "#ffffff", "#43d9a0", "#ff6b5e", "#ffcf4a", "rgba(255, 255, 255, 0.24)", "rgba(17, 7, 54, 0.40)", "currentColor", "transparent", "inherit"];
  const SUGGESTIONS = {
    "font-family": FONT_VALUES,
    "background": ["rgba(255, 255, 255, 0.24)", "rgba(17, 7, 54, 0.40)", "linear-gradient(180deg, rgba(46, 16, 96, 0.50), rgba(20, 8, 52, 0.48))", "#ffffff", "transparent", "none"],
    "background-color": COLOR_VALUES,
    "color": COLOR_VALUES,
    "font-size": ["18px", "20px", "22px", "24px", "28px", "36px", "48px", "1rem", "1.25rem", "inherit"],
    "backdrop-filter": ["blur(2px)", "blur(2px) saturate(160%)", "saturate(170%)", "none"],
    "font-weight": ["300", "400", "normal", "inherit"],
    "font-feature-settings": ["\"ss01\" 1", "\"ss01\" 1, \"tnum\" 1", "\"tnum\" 1", "normal"],
    "font-variation-settings": ["\"wght\" 400", "\"wght\" 300", "\"wdth\" 100", "\"ROND\" 100", "\"opsz\" 18", "normal"],
    "border-radius": ["999px", "44px", "36px", "28px", "22px", "50%", "0"],
    "border": ["1px solid rgba(255, 255, 255, 0.12)", "none", "0"],
    "border-color": COLOR_VALUES,
    "box-shadow": ["0 18px 48px rgba(8, 3, 26, 0.32)", "none"],
    "display": ["block", "inline-block", "flex", "inline-flex", "grid", "contents", "none"],
    "position": ["static", "relative", "sticky", "absolute", "fixed"],
    "visibility": ["visible", "hidden"],
    "opacity": ["1", "0.9", "0.7", "0.5"],
    "width": ["auto", "100%", "fit-content", "min(100%, 960px)"],
    "height": ["auto", "100%", "fit-content"],
    "max-width": ["100%", "960px", "70ch", "none"],
    "margin": ["0", "auto", "0 auto", "16px"],
    "padding": ["0", "8px 16px", "16px", "24px"],
    "gap": ["8px", "12px", "16px", "24px"],
    "line-height": ["1.4", "1.5", "1.6", "normal"],
    "letter-spacing": ["0", "0.01em", "normal"],
    "text-align": ["start", "center", "end", "justify"],
    "text-decoration": ["none", "underline"],
    "font-style": ["normal", "italic"],
    "outline": ["2px solid #8f5cff", "none"],
    "cursor": ["pointer", "default", "text", "auto"],
    "transition": ["all 0.2s ease", "background-color 0.2s ease", "none"],
    "filter": ["none", "saturate(120%)", "grayscale(100%)"],
    "z-index": ["0", "1", "10", "100", "auto"],
    "pointer-events": ["auto"],
    "overflow": ["visible", "hidden", "auto", "clip"],
    "text-transform": ["none", "uppercase", "capitalize"],
    "accent-color": COLOR_VALUES,
    "caret-color": COLOR_VALUES,
    "background-image": ["none", "linear-gradient(180deg, #8f5cff, #110736)"],
    "border-width": ["0", "1px", "2px"],
    "border-style": ["solid", "dashed", "none"],
    "min-height": ["0", "48px", "100%"],
    "flex": ["1", "0 0 auto", "none"],
    "flex-direction": ["row", "column"],
    "align-items": ["center", "start", "end", "stretch"],
    "justify-content": ["center", "space-between", "start", "end"],
    "grid-template-columns": ["repeat(auto-fit, minmax(240px, 1fr))", "1fr 1fr"],
    "text-shadow": ["none", "0 1px 2px rgba(0, 0, 0, 0.24)"],
    "scrollbar-color": ["rgba(255, 255, 255, 0.22) transparent"],
    "inset": ["auto"],
    "top": ["auto", "0"],
    "left": ["auto", "0"],
    "right": ["auto", "0"],
    "bottom": ["auto", "0"],
  };

  function propertySuggestions(prefix, mode) {
    const query = String(prefix || "").toLowerCase();
    const names = Array.from(new Set(PARTIAL_PROPERTIES.concat(Object.keys(SUGGESTIONS))));
    return names
      .filter(name => !query || name.startsWith(query) || name.includes(query))
      .map(name => ({ name, allowed: mode !== "partial" || PARTIAL_SET.has(name), partial: PARTIAL_SET.has(name) }))
      .sort((a, b) => {
        if (a.allowed !== b.allowed) return a.allowed ? -1 : 1;
        if (mode === "partial" && a.partial !== b.partial) return a.partial ? -1 : 1;
        const aStarts = a.name.startsWith(query);
        const bStarts = b.name.startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  function valueSuggestions(property, prefix) {
    const list = SUGGESTIONS[String(property || "").toLowerCase()] || [];
    const query = String(prefix || "").toLowerCase().trim();
    return list.filter(value => !query || value.toLowerCase().includes(query));
  }

  function blockedWebsiteId(id, legacyPattern) {
    if (/^[a-z0-9_-]{1,100}$/i.test(id || "") && id) return id;
    if (!legacyPattern) return "";
    let hash = 2166136261;
    for (let i = 0; i < legacyPattern.length; i++) hash = Math.imul(hash ^ legacyPattern.charCodeAt(i), 16777619);
    return "site-" + (hash >>> 0).toString(16).padStart(8, "0");
  }

  function createId(prefix) {
    const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    return (prefix || "id") + "-" + random;
  }

  return Object.freeze({
    VERSION,
    blockedWebsiteId,
    FONT_PATH,
    PARTIAL_PROPERTIES,
    parseUrl,
    isBlockPage,
    hostMatches,
    normalizePattern,
    matchPattern,
    SAFE_MODES,
    GOOGLE_SEARCH_FILTER,
    YOUTUBE_RESTRICT_DOMAINS,
    YOUTUBE_VIDEO_DOMAINS,
    youtubeVideoId,
    effectiveSiteControls,
    forcedSafeUrl,
    normalizePolicy,
    evaluateAccess,
    isOnAllowedWebsiteList,
    resolveUserCssMode,
    textFilterFor,
    CATEGORIES,
    BUILTIN_CATEGORY_COUNT: BUILTIN_CATEGORIES.size,
    categorize,
    categoryDomains,
    categorizedDomains,
    categoryOverridesOf: rawPolicy => categoryOverrides(rawPolicy && rawPolicy.global && rawPolicy.global.categoryOverrides),
    effectiveGlobal: (rawPolicy, classId) => { const policy = normalizePolicy(rawPolicy); return effectiveGlobal(policy, findClass(policy, classId)); },
    phraseRegExp,
    findBlockedText,
    stripBlockedText,
    normalizePhrase,
    stylesForUrl,
    parseStylesheet,
    sanitizeCss,
    computePageStyles,
    fontFaceCss,
    usesGoogleSansFlex,
    propertySuggestions,
    valueSuggestions,
    emptyUserCss,
    createId,
  });
});
