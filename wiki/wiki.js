/*!
 * Munetios Wiki
 * Hash routes: #/  #/article/<slug>[/<section>]  #/search/<query>  #/all  #/saved  #/glossary  #/compare[/<a>/<b>]
 * Read aloud uses the browser's own speech synthesis; voices come from this device and nothing is sent anywhere.
 * Preferences and saved articles stay in this browser (localStorage). No tracking, no network requests beyond the page's files.
 */
(() => {
  "use strict";
  const WIKI = window.MunetiosWiki;
  const UI = window.MunetiosUI;
  const LOC = window.MunetiosLocales;
  const STRINGS = window.MunetiosWikiStrings || {};
  const ARTICLES = WIKI.articles;
  const BY_SLUG = new Map(ARTICLES.map((a) => [a.slug, a]));
  const CATEGORIES = ["platform", "productivity", "communication", "media", "education", "navigation", "developers"];
  const CAT_ICON = { platform: "hub", productivity: "work", communication: "forum", media: "photo_library", education: "school", navigation: "explore", developers: "code" };
  const CAT_KEY = { platform: "catPlatform", productivity: "catProductivity", communication: "catCommunication", media: "catMedia", education: "catEducation", navigation: "catNavigation", developers: "catDevelopers" };
  const FACT_KEYS = ["developer", "type", "path", "platforms", "encryption", "sync", "offline", "sharing", "storage", "languages", "license", "released"];
  const SHOTS = "images/screenshots/";
  const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const PREFS_KEY = "munetios-wiki-prefs";
  const SAVED_KEY = "munetios-wiki-saved";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = WIKI.helpers.esc;
  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  // ------------------------------------------------------------------ storage
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable: keep working in memory */ } },
  };
  const DEFAULT_PREFS = { lang: "auto", textSize: 20, spacing: "1.6", letterSpacing: false, voice: "", rate: 1 };
  let prefs = { ...DEFAULT_PREFS, ...store.get(PREFS_KEY, {}) };
  let saved = store.get(SAVED_KEY, []).filter((s) => BY_SLUG.has(s));
  const savePrefs = () => store.set(PREFS_KEY, prefs);

  // ------------------------------------------------------------------ i18n
  let locale = "en-US";
  function resolveLocale() {
    const wanted = prefs.lang && prefs.lang !== "auto" ? prefs.lang : LOC ? LOC.detect() : "en-US";
    return (LOC && LOC.resolve(wanted)) || "en-US";
  }
  function t(key, vars) {
    const table = STRINGS[locale] || STRINGS["en-US"] || {};
    let s = table[key] ?? (STRINGS["en-US"] || {})[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  }
  function applyI18n(root = document) {
    $$("[data-i18n]", root).forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-aria]", root).forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    $$("[data-i18n-title]", root).forEach((el) => el.setAttribute("title", t(el.dataset.i18nTitle)));
    $$("[data-i18n-placeholder]", root).forEach((el) => el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder)));
  }
  function setLocale() {
    locale = resolveLocale();
    const info = LOC ? LOC.LOCALES.find((l) => l.code === locale) : null;
    document.documentElement.lang = locale;
    document.documentElement.dir = info ? info.dir : "ltr";
    applyI18n();
  }
  const formatDate = (iso) => {
    const d = new Date(iso + "T12:00:00");
    for (const tag of [locale, "en-US"]) {
      try { return new Intl.DateTimeFormat(tag, { dateStyle: "long" }).format(d); } catch (e) { /* try the next locale */ }
    }
    return iso;
  };
  const formatNumber = (n) => { try { return new Intl.NumberFormat(locale).format(n); } catch (e) { return String(n); } };

  // ------------------------------------------------------------------ text helpers
  const scratch = document.createElement("div");
  function plain(html) {
    scratch.innerHTML = html.replace(/<(?:pre|code)[\s\S]*?<\/(?:pre|code)>/gi, (m) => " " + m + " ");
    $$("button, svg", scratch).forEach((n) => n.remove());
    return scratch.textContent.replace(/\s+/g, " ").trim();
  }
  const words = (s) => (s.match(/\S+/g) || []).length;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const allShots = (a) => (a.shots || []).flatMap((s) => [s.src, s.phone].filter(Boolean));
  const inlineShots = (a) => (a.sections || []).flatMap((s) => [...s.html.matchAll(/data-shot="images\/screenshots\/([^"]+)"/g)].map((m) => m[1]));

  // ------------------------------------------------------------------ search index
  const INDEX = ARTICLES.map((a) => {
    const sections = a.sections.map((s) => ({ id: s.id, title: s.title, text: plain(s.html) }));
    return { a, title: norm(a.title + " " + a.short), tagline: norm(a.tagline), sections: sections.map((s) => ({ ...s, n: norm(s.title), body: norm(s.text) })), words: words(a.tagline + " " + sections.map((s) => s.text).join(" ")) };
  });
  function searchAll(query) {
    const tokens = norm(query).split(/[^\p{L}\p{N}.@#]+/u).filter((x) => x.length > 1 || /\p{N}/u.test(x));
    if (!tokens.length) return [];
    const out = [];
    for (const item of INDEX) {
      let score = 0, best = null, bestScore = 0;
      for (const tok of tokens) {
        if (item.title.includes(tok)) score += 12;
        if (item.tagline.includes(tok)) score += 5;
      }
      for (const s of item.sections) {
        let ss = 0;
        for (const tok of tokens) {
          if (s.n.includes(tok)) ss += 4;
          const hits = s.body.split(tok).length - 1;
          ss += Math.min(hits, 6);
        }
        score += ss;
        if (ss > bestScore) { bestScore = ss; best = s; }
      }
      const allTokensFound = tokens.every((tok) => item.title.includes(tok) || item.tagline.includes(tok) || item.sections.some((s) => s.n.includes(tok) || s.body.includes(tok)));
      if (score > 0 && allTokensFound) out.push({ article: item.a, section: best, score, tokens });
    }
    return out.sort((x, y) => y.score - x.score);
  }
  function snippet(text, tokens, length = 200) {
    const n = norm(text);
    let at = -1;
    for (const tok of tokens) { const i = n.indexOf(tok); if (i >= 0 && (at < 0 || i < at)) at = i; }
    const start = Math.max(0, at - 60);
    let s = (start > 0 ? "…" : "") + text.slice(start, start + length).trim() + (start + length < text.length ? "…" : "");
    let html = esc(s);
    for (const tok of tokens) {
      if (tok.length < 2) continue;
      const re = new RegExp("(" + tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      html = html.replace(re, "<mark>$1</mark>");
    }
    return html;
  }
  const glossaryMatches = (query) => {
    const q = norm(query).trim();
    if (!q) return [];
    return WIKI.glossary.filter((g) => norm(g.term + " " + g.definition).includes(q));
  };

  // ------------------------------------------------------------------ UI helpers
  const toast = (message, opts) => (UI && UI.toast ? UI.toast(message, opts) : null);
  const live = (msg) => { const el = $("#wikiLive"); el.textContent = ""; setTimeout(() => { el.textContent = msg; }, 30); };
  const icon = (name) => `<span class="mu-icon" aria-hidden="true">${name}</span>`;
  const logoImg = (a, size = 52) => `<img src="${esc(a.logo)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;
  const hrefArticle = (slug, section) => `#/article/${encodeURIComponent(slug)}${section ? "/" + encodeURIComponent(section) : ""}`;
  const absoluteUrl = (hash) => location.origin + location.pathname + hash;
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (err) { ok = false; } ta.remove(); return ok;
    }
  }
  const card = (a, badge) => `
    <a class="wiki-card" href="${hrefArticle(a.slug)}">
      <div class="wiki-card-shot"><img src="${esc(SHOTS + a.shots[0].src)}" alt="" loading="lazy" decoding="async">${badge ? `<span class="mu-badge">${esc(badge)}</span>` : ""}</div>
      <div class="wiki-card-body">${logoImg(a)}<span class="wiki-card-title">${esc(a.title)}</span><span class="wiki-card-tagline" lang="en">${esc(a.tagline)}</span></div>
    </a>`;
  const empty = (iconName, title, help, action) => `<div class="mu-empty wiki-empty"><span class="mu-icon-circle">${icon(iconName)}</span><span>${esc(title)}</span>${help ? `<span class="mu-muted">${esc(help)}</span>` : ""}${action || ""}</div>`;
  const isSaved = (slug) => saved.includes(slug);
  function toggleSaved(slug) {
    if (isSaved(slug)) { saved = saved.filter((s) => s !== slug); toast(t("articleRemoved"), { icon: "bookmark_remove" }); }
    else { saved = [slug, ...saved]; toast(t("articleSaved"), { type: "success", icon: "bookmark_added" }); }
    store.set(SAVED_KEY, saved);
    $$(`[data-save="${slug}"]`).forEach(syncSaveButton);
  }
  function syncSaveButton(btn) {
    const on = isSaved(btn.dataset.save);
    btn.setAttribute("aria-pressed", String(on));
    btn.innerHTML = `${icon(on ? "bookmark_added" : "bookmark_add")}<span>${esc(on ? t("saved") : t("save"))}</span>`;
  }

  // ------------------------------------------------------------------ sidebar
  function renderSidebar() {
    const html = CATEGORIES.map((cat) => {
      const list = ARTICLES.filter((a) => a.category === cat);
      if (!list.length) return "";
      return `<div class="mu-section-label">${esc(t(CAT_KEY[cat]))}</div><nav class="mu-nav" aria-label="${esc(t(CAT_KEY[cat]))}">${list
        .map((a) => `<a class="mu-nav-item" href="${hrefArticle(a.slug)}" data-route="article:${a.slug}">${logoImg(a, 30)}<span>${esc(a.short)}</span></a>`)
        .join("")}</nav>`;
    }).join("");
    $("#wikiNavCategories").innerHTML = html + `<div class="mu-section-label"></div><nav class="mu-nav"><button type="button" class="mu-nav-item" data-mu-open="wikiShortcuts">${icon("keyboard")}<span>${esc(t("keyboardShortcuts"))}</span></button></nav>`;
  }
  function markSidebar(routeKey) {
    $$("#wikiSidebar [data-route]").forEach((a) => {
      if (a.dataset.route === routeKey) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }
  const sidebar = $("#wikiSidebar");
  const menuBtn = $("#wikiMenuBtn");
  function setSidebar(open) {
    sidebar.classList.toggle("is-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  }
  menuBtn.addEventListener("click", () => setSidebar(!sidebar.classList.contains("is-open")));
  document.addEventListener("click", (e) => {
    if (sidebar.classList.contains("is-open") && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) setSidebar(false);
  });

  // ------------------------------------------------------------------ pages
  const main = $("#wikiMain");
  let current = { route: "", slug: "" };
  let tocObserver = null;

  function pageHome() {
    const shotCount = new Set(ARTICLES.flatMap((a) => [...allShots(a), ...inlineShots(a)])).size;
    const sectionCount = ARTICLES.reduce((n, a) => n + a.sections.length, 0);
    const day = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 864e5);
    const pool = ARTICLES.filter((a) => a.category !== "developers");
    const featured = pool[day % pool.length];
    const fs = featured.shots[0];
    return `
      <div class="wiki-stack">
        <section class="wiki-hero mu-glass">
          <div>
            <h1>${esc(t("heroTitle"))}</h1>
            <p>${esc(t("heroText"))}</p>
            <div class="wiki-hero-actions">
              <a class="mu-btn mu-btn-primary mu-btn-lg" href="#/all">${icon("auto_stories")}<span>${esc(t("browseAll"))}</span></a>
              <button type="button" class="mu-btn mu-btn-lg" data-action="random">${icon("casino")}<span>${esc(t("surpriseMe"))}</span></button>
            </div>
          </div>
          <img class="wiki-hero-logo" src="images/logos/munetios.png" alt="" width="168" height="168">
        </section>
        <div class="wiki-stats">
          ${[["description", ARTICLES.length, "statArticles"], ["image", shotCount, "statScreenshots"], ["segment", sectionCount, "statSections"], ["translate", 17, "statLanguages"]]
            .map(([ic, n, key]) => `<div class="mu-stat mu-glass"><span class="mu-icon-circle">${icon(ic)}</span><div><div class="mu-stat-value">${formatNumber(n)}</div><div class="mu-stat-label">${esc(t(key))}</div></div></div>`).join("")}
        </div>
        <section class="wiki-panel mu-glass" aria-labelledby="wikiFeaturedTitle">
          <div class="wiki-featured">
            <button type="button" class="wiki-infobox-shot" data-shot="${esc(SHOTS + fs.src)}" data-caption="${esc(fs.caption)}"><img class="wiki-featured-shot" src="${esc(SHOTS + fs.src)}" alt="${esc(fs.caption)}" loading="lazy"></button>
            <div>
              <span class="mu-badge">${icon("star")} ${esc(t("featured"))}</span>
              <h3 id="wikiFeaturedTitle">${esc(featured.title)}</h3>
              <p lang="en">${esc(featured.tagline)}</p>
              <a class="mu-btn mu-btn-primary" href="${hrefArticle(featured.slug)}">${icon("arrow_forward")}<span>${esc(t("readArticle"))}</span></a>
            </div>
          </div>
        </section>
        <section class="wiki-panel mu-glass" aria-labelledby="wikiCatTitle">
          <div class="wiki-section-head"><span class="mu-icon-circle">${icon("category")}</span><h2 id="wikiCatTitle">${esc(t("browseByCategory"))}</h2></div>
          <div class="wiki-chip-row">${CATEGORIES.filter((c) => ARTICLES.some((a) => a.category === c)).map((c) => `<a class="mu-chip" href="#cat-${c}" data-scroll="cat-${c}">${icon(CAT_ICON[c])}${esc(t(CAT_KEY[c]))}</a>`).join("")}</div>
        </section>
        ${CATEGORIES.map((cat) => {
          const list = ARTICLES.filter((a) => a.category === cat);
          if (!list.length) return "";
          return `<section class="wiki-panel mu-glass" id="cat-${cat}" aria-labelledby="cat-${cat}-title">
            <div class="wiki-section-head"><span class="mu-icon-circle">${icon(CAT_ICON[cat])}</span><h2 id="cat-${cat}-title">${esc(t(CAT_KEY[cat]))}</h2><span class="mu-muted">${esc(t("articlesCount", { n: formatNumber(list.length) }))}</span></div>
            <div class="wiki-card-grid">${list.map((a) => card(a)).join("")}</div>
          </section>`;
        }).join("")}
      </div>`;
  }

  function factLabel(key) { return t("fact" + key.charAt(0).toUpperCase() + key.slice(1)); }

  function pageArticle(a) {
    const idx = ARTICLES.indexOf(a);
    const prev = ARTICLES[(idx - 1 + ARTICLES.length) % ARTICLES.length];
    const next = ARTICLES[(idx + 1) % ARTICLES.length];
    const item = INDEX[idx];
    const minutes = Math.max(1, Math.round(item.words / 200));
    const hero = a.shots[0];
    const facts = FACT_KEYS.filter((k) => a.facts[k]).map((k) => `<dt>${esc(factLabel(k))}</dt><dd lang="en">${k === "path" ? `<code>${esc(a.facts[k])}</code>` : esc(a.facts[k])}</dd>`).join("");
    const hasPhones = a.shots.some((s) => s.phone);
    const tocItems = [...a.sections.map((s) => [s.id, s.title]), ["screenshots", null]];
    const tocList = `<nav class="mu-outline" aria-label="${esc(t("contents"))}"><ol>${tocItems
      .map(([id, title]) => `<li><a href="${hrefArticle(a.slug, id)}" data-toc="${esc(id)}"${title ? ' lang="en"' : ""}>${esc(title || t("screenshots"))}</a></li>`).join("")}</ol></nav>`;
    const sectionHtml = a.sections.map((s) => `
      <section id="sec-${esc(s.id)}" data-section="${esc(s.id)}" aria-labelledby="h-${esc(s.id)}">
        <h2 id="h-${esc(s.id)}"><span class="mu-icon-circle">${icon(s.icon || "article")}</span><span class="wiki-h-text">${esc(s.title)}</span>
          <span class="wiki-h-actions" lang="${esc(locale)}">
            <button type="button" class="mu-icon-btn mu-icon-btn-sm" data-read-from="${esc(s.id)}" aria-label="${esc(t("readFromHere"))}" title="${esc(t("readFromHere"))}">${icon("play_circle")}</button>
            <button type="button" class="mu-icon-btn mu-icon-btn-sm" data-copy-section="${esc(s.id)}" aria-label="${esc(t("linkToSection"))}" title="${esc(t("linkToSection"))}">${icon("link")}</button>
          </span>
        </h2>
        ${s.html}
      </section>`).join("");
    const gallery = (mode) => a.shots.filter((s) => (mode === "phone" ? s.phone : s.src)).map((s) => {
      const src = mode === "phone" ? s.phone : s.src;
      return `<figure class="wiki-figure${mode === "phone" ? " is-phone" : ""}"><button type="button" data-shot="${esc(SHOTS + src)}" data-caption="${esc(s.caption)}"><img src="${esc(SHOTS + src)}" alt="${esc(s.caption)}" loading="lazy" decoding="async"></button><figcaption lang="en">${esc(s.caption)}</figcaption></figure>`;
    }).join("");
    const related = (a.related || []).map((slug) => BY_SLUG.get(slug)).filter(Boolean);
    return `
      <div class="wiki-article-layout">
        <article class="wiki-article mu-glass" data-article="${esc(a.slug)}">
          <nav aria-label="${esc(t("breadcrumb"))}"><ol class="mu-breadcrumbs"><li><a href="#/">${esc(t("home"))}</a></li><li><a href="#cat-${a.category}" data-home-cat="${a.category}">${esc(t(CAT_KEY[a.category]))}</a></li><li><span aria-current="page">${esc(a.short)}</span></li></ol></nav>
          <header class="wiki-article-head">${logoImg(a, 96)}<h1 data-read-title>${esc(a.title)}</h1><p lang="en" data-read-tagline>${esc(a.tagline)}</p></header>
          <ul class="mu-reading-details">
            <li>${icon("schedule")} ${esc(t("minRead", { n: formatNumber(minutes) }))}</li>
            <li>${icon("translate")} ${esc(t("writtenIn"))}</li>
            <li>${icon("update")} ${esc(t("updatedOn", { date: formatDate(a.updated) }))}</li>
          </ul>
          <div class="wiki-toolbar">
            <button type="button" class="mu-btn mu-btn-primary" data-action="read">${icon("record_voice_over")}<span>${esc(t("readAloud"))}</span></button>
            <button type="button" class="mu-btn" data-save="${esc(a.slug)}" aria-pressed="false"></button>
            <button type="button" class="mu-btn" data-action="copy">${icon("link")}<span>${esc(t("copyLink"))}</span></button>
            ${navigator.share ? `<button type="button" class="mu-btn" data-action="share">${icon("share")}<span>${esc(t("share"))}</span></button>` : ""}
            <button type="button" class="mu-btn" data-action="print">${icon("print")}<span>${esc(t("print"))}</span></button>
          </div>
          ${locale.startsWith("en") ? "" : `<div class="mu-alert wiki-lang-note" role="note">${icon("translate")}<div class="mu-alert-body"><span class="mu-muted">${esc(t("articleLanguageNote"))}</span></div></div>`}
          <details class="mu-term-definition wiki-toc-mobile"><summary>${esc(t("contents"))}</summary>${tocList}</details>
          <div class="wiki-content" lang="en" dir="ltr">
            ${sectionHtml}
            <section id="sec-screenshots" data-section="screenshots" aria-labelledby="h-screenshots">
              <h2 id="h-screenshots"><span class="mu-icon-circle">${icon("photo_library")}</span><span class="wiki-h-text" lang="${esc(locale)}">${esc(t("screenshots"))}</span></h2>
              <div class="wiki-gallery-head">
                ${hasPhones ? `<div class="mu-segmented" role="group" aria-label="${esc(t("screenshots"))}" data-gallery-mode lang="${esc(locale)}"><button type="button" aria-pressed="true" data-mode="desktop">${icon("computer")}${esc(t("desktop"))}</button><button type="button" aria-pressed="false" data-mode="phone">${icon("smartphone")}${esc(t("phone"))}</button></div>` : ""}
              </div>
              <div class="wiki-gallery" data-gallery="desktop">${gallery("desktop")}</div>
              ${hasPhones ? `<div class="wiki-gallery is-phone" data-gallery="phone" hidden>${gallery("phone")}</div>` : ""}
            </section>
          </div>
          <div class="wiki-footer-nav" lang="${esc(locale)}">
            ${related.length ? `<footer class="mu-related-footer"><h4>${esc(t("related"))}</h4>${related.map((r) => `<a href="${hrefArticle(r.slug)}">${esc(r.title)}</a>`).join("")}</footer>` : ""}
            <nav class="mu-article-navigation" aria-label="${esc(t("previousArticle"))} / ${esc(t("nextArticle"))}">
              <a href="${hrefArticle(prev.slug)}" aria-label="${esc(t("previousArticle"))}: ${esc(prev.title)}">${icon(document.documentElement.dir === "rtl" ? "arrow_forward" : "arrow_back")}<span>${esc(prev.title)}</span></a>
              <a href="${hrefArticle(next.slug)}" aria-label="${esc(t("nextArticle"))}: ${esc(next.title)}"><span>${esc(next.title)}</span>${icon(document.documentElement.dir === "rtl" ? "arrow_back" : "arrow_forward")}</a>
            </nav>
            <p class="wiki-updated">${esc(t("updatedOn", { date: formatDate(a.updated) }))}</p>
          </div>
        </article>
        <aside class="wiki-aside mu-scroll">
          <section class="wiki-infobox mu-glass" aria-labelledby="infobox-title">
            <div class="wiki-infobox-logo">${logoImg(a, 64)}<h2 id="infobox-title">${esc(a.title)}</h2></div>
            <button type="button" class="wiki-infobox-shot" data-shot="${esc(SHOTS + hero.src)}" data-caption="${esc(hero.caption)}"><img src="${esc(SHOTS + hero.src)}" alt="${esc(hero.caption)}" loading="lazy"></button>
            <section class="mu-fact-sheet"><dl>${facts}</dl></section>
            <a class="mu-btn mu-btn-primary mu-btn-block" href="${esc(a.url)}" target="_blank" rel="noopener">${icon("open_in_new")}<span>${esc(t("openApp", { name: a.short }))}</span></a>
          </section>
          <section class="wiki-toc mu-glass" aria-labelledby="toc-title"><h2 id="toc-title">${esc(t("contents"))}</h2>${tocList}</section>
        </aside>
      </div>`;
  }

  function pageSearch(query) {
    const results = searchAll(query);
    const terms = glossaryMatches(query);
    const total = results.length + terms.length;
    return `
      <section class="wiki-panel mu-glass">
        <div class="wiki-section-head"><span class="mu-icon-circle">${icon("search")}</span><h1 class="mu-h-section">${esc(t("searchResults"))}</h1><span class="mu-muted">${esc(t("resultsFor", { query, n: formatNumber(total) }))}</span></div>
        ${total ? "" : empty("search_off", t("noResults"), t("noResultsHelp"), `<a class="mu-btn mu-btn-primary" href="#/all">${esc(t("browseAll"))}</a>`)}
        <div class="wiki-stack" style="gap:6px">
          ${results.map((r) => `<a class="wiki-result" href="${hrefArticle(r.article.slug, r.section ? r.section.id : "")}">${logoImg(r.article)}<span class="wiki-result-title">${esc(r.article.title)}${r.section ? ` <span class="mu-muted" lang="en">· ${esc(r.section.title)}</span>` : ""}</span><span class="wiki-result-snippet" lang="en">${r.section ? snippet(r.section.text, r.tokens) : esc(r.article.tagline)}</span></a>`).join("")}
        </div>
        ${terms.length ? `<h2 class="mu-h-title" style="margin:24px 0 12px">${esc(t("glossary"))}</h2><div class="wiki-glossary">${terms.map(glossaryEntry).join("")}</div>` : ""}
      </section>`;
  }

  function pageAll() {
    const sorted = [...ARTICLES].sort((x, y) => x.title.localeCompare(y.title, "en"));
    const groups = new Map();
    for (const a of sorted) {
      const letter = a.title.replace(/^Munetios\s+/i, "").charAt(0).toUpperCase();
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(a);
    }
    const letters = [...groups.keys()].sort();
    return `
      <section class="wiki-panel mu-glass">
        <div class="wiki-section-head"><span class="mu-icon-circle">${icon("sort_by_alpha")}</span><h1 class="mu-h-section">${esc(t("allArticles"))}</h1><span class="mu-muted">${esc(t("articlesCount", { n: formatNumber(ARTICLES.length) }))}</span></div>
        <nav class="mu-jump-list" aria-label="${esc(t("allArticles"))}" style="margin-bottom:20px">${letters.map((l) => `<a href="#az-${l}" data-scroll="az-${l}">${l}</a>`).join("")}</nav>
        <div class="wiki-az">${letters.map((l) => `<section id="az-${l}" aria-labelledby="az-${l}-h"><h2 id="az-${l}-h">${l}</h2><ul>${groups.get(l).map((a) => `<li><a href="${hrefArticle(a.slug)}">${logoImg(a, 40)}<span>${esc(a.title)}</span></a></li>`).join("")}</ul></section>`).join("")}</div>
      </section>`;
  }

  function pageSaved() {
    const list = saved.map((s) => BY_SLUG.get(s)).filter(Boolean);
    return `
      <section class="wiki-panel mu-glass">
        <div class="wiki-section-head"><span class="mu-icon-circle">${icon("bookmarks")}</span><h1 class="mu-h-section">${esc(t("savedArticles"))}</h1>${list.length ? `<span class="mu-muted">${esc(t("articlesCount", { n: formatNumber(list.length) }))}</span>` : ""}</div>
        ${list.length ? `<div class="wiki-card-grid">${list.map((a) => card(a)).join("")}</div>` : empty("bookmark_add", t("noSaved"), t("noSavedHelp"), `<a class="mu-btn mu-btn-primary" href="#/all">${esc(t("browseAll"))}</a>`)}
      </section>`;
  }

  function glossaryEntry(g) {
    const links = g.slugs.map((s) => BY_SLUG.get(s)).filter(Boolean);
    return `<dl class="mu-glossary-entry" lang="en"><dt>${esc(g.term)}</dt><dd>${esc(g.definition)}${links.length ? `<div class="wiki-chip-row" lang="${esc(locale)}"><span class="mu-muted">${esc(t("mentionedIn"))}</span>${links.map((a) => `<a class="mu-badge" href="${hrefArticle(a.slug)}">${esc(a.short)}</a>`).join("")}</div>` : ""}</dd></dl>`;
  }
  function pageGlossary() {
    const list = [...WIKI.glossary].sort((x, y) => x.term.localeCompare(y.term, "en"));
    return `
      <section class="wiki-panel mu-glass">
        <div class="wiki-section-head"><span class="mu-icon-circle">${icon("menu_book")}</span><h1 class="mu-h-section">${esc(t("glossary"))}</h1><span class="mu-muted">${esc(t("glossaryIntro"))}</span></div>
        <div class="wiki-glossary">${list.map(glossaryEntry).join("")}</div>
      </section>`;
  }

  function pageCompare(aSlug, bSlug) {
    const a = BY_SLUG.get(aSlug) || BY_SLUG.get("calendar");
    const b = BY_SLUG.get(bSlug) || BY_SLUG.get("tasks");
    const options = (sel) => ARTICLES.map((x) => `<option value="${esc(x.slug)}"${x === sel ? " selected" : ""}>${esc(x.title)}</option>`).join("");
    const keys = FACT_KEYS.filter((k) => a.facts[k] || b.facts[k]);
    return `
      <section class="wiki-panel mu-glass">
        <div class="wiki-section-head"><span class="mu-icon-circle">${icon("compare_arrows")}</span><h1 class="mu-h-section">${esc(t("compareApps"))}</h1><span class="mu-muted">${esc(t("compareIntro"))}</span></div>
        <div class="wiki-compare-picks">
          <label class="mu-field"><span class="mu-field-label">${esc(t("firstApp"))}</span><select class="mu-select" data-compare="a">${options(a)}</select></label>
          <label class="mu-field"><span class="mu-field-label">${esc(t("secondApp"))}</span><select class="mu-select" data-compare="b">${options(b)}</select></label>
        </div>
        <div class="mu-table-wrap"><table class="mu-table">
          <thead><tr><th scope="col">${esc(t("feature"))}</th><th scope="col"><a href="${hrefArticle(a.slug)}">${esc(a.title)}</a></th><th scope="col"><a href="${hrefArticle(b.slug)}">${esc(b.title)}</a></th></tr></thead>
          <tbody>${keys.map((k) => `<tr><th scope="row">${esc(factLabel(k))}</th><td lang="en">${esc(a.facts[k] || t("notAvailable"))}</td><td lang="en">${esc(b.facts[k] || t("notAvailable"))}</td></tr>`).join("")}
            <tr><th scope="row">${esc(t("statSections"))}</th><td>${formatNumber(a.sections.length)}</td><td>${formatNumber(b.sections.length)}</td></tr>
          </tbody>
        </table></div>
      </section>`;
  }

  const pageNotFound = () => `<section class="wiki-panel mu-glass">${empty("travel_explore", t("notFound"), t("notFoundHelp"), `<a class="mu-btn mu-btn-primary" href="#/">${esc(t("backHome"))}</a>`)}</section>`;

  // ------------------------------------------------------------------ router
  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, "");
    const parts = raw.split("/").map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
    return { name: parts[0] || "home", args: parts.slice(1) };
  }
  function render() {
    const { name, args } = parseRoute();
    // Plain in-page anchors (#cat-x, #az-x) are handled by their click handlers.
    if (location.hash && !location.hash.startsWith("#/")) return;
    const key = name + ":" + (args[0] || "");
    if (name === "article" && current.route === key && BY_SLUG.has(args[0])) {
      scrollToSection(args[1]);
      return;
    }
    reader.stop(true);
    setSidebar(false);
    closeSuggest();
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    let title = t("appName");
    let routeKey = name;
    if (name === "home") main.innerHTML = pageHome();
    else if (name === "article" && BY_SLUG.has(args[0])) {
      const a = BY_SLUG.get(args[0]);
      main.innerHTML = pageArticle(a);
      title = a.title + " · " + t("appName");
      routeKey = "article:" + a.slug;
      $$("[data-save]", main).forEach(syncSaveButton);
      watchToc();
    } else if (name === "search") {
      const q = args.join("/");
      main.innerHTML = pageSearch(q);
      title = q + " · " + t("appName");
      if ($("#wikiSearch").value !== q) $("#wikiSearch").value = q;
      $("#wikiSearch").dispatchEvent(new Event("input"));
    } else if (name === "all") { main.innerHTML = pageAll(); title = t("allArticles") + " · " + t("appName"); }
    else if (name === "saved") { main.innerHTML = pageSaved(); title = t("savedArticles") + " · " + t("appName"); }
    else if (name === "glossary") { main.innerHTML = pageGlossary(); title = t("glossary") + " · " + t("appName"); }
    else if (name === "compare") { main.innerHTML = pageCompare(args[0], args[1]); title = t("compareApps") + " · " + t("appName"); }
    else { main.innerHTML = pageNotFound(); routeKey = ""; }
    if (name !== "search" && searchInput.value && document.activeElement !== searchInput) {
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
      closeSuggest();
    }
    current = { route: key, slug: name === "article" ? args[0] : "" };
    document.title = title;
    markSidebar(routeKey);
    if (name === "article" && args[1]) requestAnimationFrame(() => scrollToSection(args[1], true));
    else window.scrollTo({ top: 0, behavior: "auto" });
    main.focus({ preventScroll: true });
    updateProgress();
  }
  function scrollToSection(id, instant) {
    const el = id && document.getElementById("sec-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: instant || reduceMotion.matches ? "auto" : "smooth", block: "start" });
    const details = el.closest("details");
    if (details) details.open = true;
  }
  function watchToc() {
    const links = $$("[data-toc]", main);
    if (!("IntersectionObserver" in window) || !links.length) return;
    const visible = new Map();
    tocObserver = new IntersectionObserver((entries) => {
      entries.forEach((e) => visible.set(e.target.dataset.section, e.isIntersecting ? e.boundingClientRect.top : null));
      const active = [...visible.entries()].filter(([, v]) => v !== null).sort((x, y) => x[1] - y[1])[0];
      if (!active) return;
      links.forEach((l) => (l.dataset.toc === active[0] ? l.setAttribute("aria-current", "true") : l.removeAttribute("aria-current")));
    }, { rootMargin: "-90px 0px -55% 0px" });
    $$("[data-section]", main).forEach((s) => tocObserver.observe(s));
  }
  window.addEventListener("hashchange", render);

  // ------------------------------------------------------------------ reading progress
  const progress = $("#wikiProgress");
  function updateProgress() {
    const art = $(".wiki-article", main);
    let pct = 0;
    if (art) {
      const r = art.getBoundingClientRect();
      const total = r.height - window.innerHeight * 0.6;
      pct = total > 0 ? Math.min(100, Math.max(0, (-r.top + 100) / total * 100)) : 100;
    }
    progress.style.width = pct + "%";
  }
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);

  // ------------------------------------------------------------------ main clicks
  main.addEventListener("click", async (e) => {
    const target = e.target.closest("button, a");
    if (!target) { reader.jumpTo(e.target); return; }
    const art = current.slug && BY_SLUG.get(current.slug);
    if (target.dataset.action === "random") { goRandom(); return; }
    if (target.dataset.action === "read") { reader.toggle(); return; }
    if (target.dataset.action === "copy" && art) { toast((await copyText(absoluteUrl(hrefArticle(art.slug)))) ? t("linkCopied") : t("couldNotCopy"), { icon: "link" }); return; }
    if (target.dataset.action === "share" && art) { try { await navigator.share({ title: art.title, text: art.tagline, url: absoluteUrl(hrefArticle(art.slug)) }); } catch (err) { /* share sheet closed */ } return; }
    if (target.dataset.action === "print") { window.print(); return; }
    if (target.dataset.save) { toggleSaved(target.dataset.save); return; }
    if (target.dataset.readFrom) { reader.start(target.dataset.readFrom); return; }
    if (target.dataset.copySection && art) { toast((await copyText(absoluteUrl(hrefArticle(art.slug, target.dataset.copySection)))) ? t("linkCopied") : t("couldNotCopy"), { icon: "link" }); return; }
    if (target.dataset.shot) { openLightbox(target); return; }
    if (target.dataset.scroll) { e.preventDefault(); document.getElementById(target.dataset.scroll)?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" }); return; }
    if (target.dataset.homeCat) { e.preventDefault(); location.hash = "#/"; requestAnimationFrame(() => document.getElementById("cat-" + target.dataset.homeCat)?.scrollIntoView({ block: "start" })); return; }
    if (target.dataset.mode) {
      const mode = target.dataset.mode;
      $$("[data-gallery]", main).forEach((g) => { g.hidden = g.dataset.gallery !== mode; });
      $$("[data-gallery-mode] button", main).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    }
  });
  main.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-compare]");
    if (!sel) return;
    const a = $('[data-compare="a"]', main).value, b = $('[data-compare="b"]', main).value;
    location.hash = `#/compare/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
  });
  function goRandom() {
    const pool = ARTICLES.filter((a) => a.slug !== current.slug);
    location.hash = hrefArticle(pool[Math.floor(Math.random() * pool.length)].slug);
  }
  $("#wikiRandomBtn").addEventListener("click", goRandom);

  // ------------------------------------------------------------------ search box + suggestions
  const searchInput = $("#wikiSearch");
  const suggest = $("#wikiSuggest");
  let suggestItems = [];
  let suggestActive = -1;
  function closeSuggest() {
    suggest.hidden = true;
    suggest.innerHTML = "";
    suggestItems = [];
    suggestActive = -1;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
  }
  function positionSuggest() {
    const r = searchInput.closest(".mu-search").getBoundingClientRect();
    suggest.style.top = r.bottom + 8 + "px";
    suggest.style.left = Math.max(12, r.left) + "px";
    suggest.style.width = Math.min(Math.max(r.width, 340), window.innerWidth - 24) + "px";
  }
  function openSuggest() {
    const q = searchInput.value.trim();
    if (!q) { closeSuggest(); return; }
    const results = searchAll(q).slice(0, 6);
    suggestItems = results.map((r) => ({ href: hrefArticle(r.article.slug, r.section && r.section.id !== r.article.sections[0].id ? r.section.id : ""), a: r.article, sub: r.section ? r.section.title : r.article.tagline }));
    suggestItems.push({ href: "#/search/" + encodeURIComponent(q), all: true });
    suggest.innerHTML = suggestItems.map((it, i) => it.all
      ? `<a class="mu-menu-item" role="option" id="sg-${i}" href="${esc(it.href)}">${icon("search")}<span>${esc(t("resultsFor", { query: q, n: formatNumber(searchAll(q).length + glossaryMatches(q).length) }))}</span></a>`
      : `<a class="mu-menu-item" role="option" id="sg-${i}" href="${esc(it.href)}">${logoImg(it.a, 36)}<span class="wiki-suggest-text"><span>${esc(it.a.title)}</span><span lang="en">${esc(it.sub)}</span></span></a>`).join("");
    suggest.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
    suggestActive = -1;
    positionSuggest();
  }
  function setSuggestActive(n) {
    const items = $$(".mu-menu-item", suggest);
    if (!items.length) return;
    suggestActive = (n + items.length) % items.length;
    items.forEach((it, i) => { it.classList.toggle("is-active", i === suggestActive); it.setAttribute("aria-selected", String(i === suggestActive)); });
    searchInput.setAttribute("aria-activedescendant", items[suggestActive].id);
    items[suggestActive].scrollIntoView({ block: "nearest" });
  }
  searchInput.addEventListener("input", openSuggest);
  searchInput.addEventListener("focus", () => { if (searchInput.value.trim()) openSuggest(); });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (suggest.hidden) openSuggest(); setSuggestActive(suggestActive + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSuggestActive(suggestActive - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const q = searchInput.value.trim();
      const item = suggestItems[suggestActive];
      if (item) location.hash = item.href;
      else if (q) location.hash = "#/search/" + encodeURIComponent(q);
      closeSuggest();
      searchInput.blur();
    } else if (e.key === "Escape") closeSuggest();
  });
  suggest.addEventListener("mousedown", (e) => e.preventDefault());
  suggest.addEventListener("click", () => { closeSuggest(); searchInput.blur(); });
  document.addEventListener("click", (e) => { if (!suggest.hidden && !suggest.contains(e.target) && !searchInput.contains(e.target)) closeSuggest(); });
  window.addEventListener("resize", () => { if (!suggest.hidden) positionSuggest(); });

  // ------------------------------------------------------------------ screenshot viewer
  let shotList = [];
  let shotIndex = 0;
  const lightbox = $("#wikiLightbox");
  function showShot() {
    const btn = shotList[shotIndex];
    if (!btn) return;
    $("#wikiLightboxImg").src = btn.dataset.shot;
    $("#wikiLightboxImg").alt = btn.dataset.caption || "";
    $("#wikiLightboxCaption").textContent = btn.dataset.caption || "";
    $("#wikiLightboxCaption").lang = "en";
    $("#wikiLightboxCount").textContent = t("imageCount", { n: formatNumber(shotIndex + 1), total: formatNumber(shotList.length) });
    const many = shotList.length > 1;
    $("#wikiLightboxPrev").disabled = !many;
    $("#wikiLightboxNext").disabled = !many;
  }
  function openLightbox(btn) {
    const seen = new Set();
    shotList = $$("[data-shot]", main).filter((b) => b.offsetParent !== null || b === btn).filter((b) => (seen.has(b.dataset.shot) ? false : seen.add(b.dataset.shot)));
    shotIndex = Math.max(0, shotList.findIndex((b) => b.dataset.shot === btn.dataset.shot));
    showShot();
    if (lightbox.hidden && UI) UI.openModal("wikiLightbox");
  }
  $("#wikiLightboxPrev").addEventListener("click", () => { shotIndex = (shotIndex - 1 + shotList.length) % shotList.length; showShot(); });
  $("#wikiLightboxNext").addEventListener("click", () => { shotIndex = (shotIndex + 1) % shotList.length; showShot(); });
  lightbox.addEventListener("keydown", (e) => {
    const rtl = document.documentElement.dir === "rtl";
    if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) $("#wikiLightboxPrev").click();
    if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) $("#wikiLightboxNext").click();
  });

  // ------------------------------------------------------------------ read aloud
  const reader = (() => {
    const synth = window.speechSynthesis;
    const bar = $("#wikiReader");
    const toggleBtn = $("#wikiReaderToggle");
    const fill = $("#wikiReaderFill");
    const meter = $("#wikiReaderBar");
    const followBtn = $("#wikiReaderFollow");
    let blocks = [];
    let index = 0;
    let playing = false;
    let token = 0;
    let follow = true;
    const SELECTOR = "h2, h3, p, li, tr, figcaption, .mu-alert, summary, pre, dt, dd";
    function collect() {
      const content = $(".wiki-content", main);
      const head = [$("[data-read-title]", main), $("[data-read-tagline]", main)].filter(Boolean);
      if (!content) return head;
      const all = $$(SELECTOR, content).filter((el) => {
        if (el.closest(".wiki-h-actions, .wiki-gallery-head")) return false;
        const parent = el.parentElement && el.parentElement.closest(SELECTOR);
        return !(parent && content.contains(parent));
      });
      return [...head, ...all].filter((el) => textOf(el));
    }
    function textOf(el) {
      if (el.matches("h2")) return ($(".wiki-h-text", el) || el).textContent.trim();
      if (el.matches("tr")) return $$("th, td", el).map((c) => c.textContent.trim()).filter(Boolean).join(", ");
      const clone = el.cloneNode(true);
      $$("button, .mu-icon", clone).forEach((n) => n.remove());
      return clone.textContent.replace(/\s+/g, " ").trim();
    }
    function voice() {
      if (!synth) return null;
      const list = synth.getVoices();
      return list.find((v) => v.voiceURI === prefs.voice) || list.find((v) => /^en(-|_)US/i.test(v.lang)) || list.find((v) => /^en/i.test(v.lang)) || null;
    }
    function highlight() {
      $$(".mu-reading-now", main).forEach((el) => el.classList.remove("mu-reading-now"));
      const el = blocks[index];
      if (!el) return;
      el.classList.add("mu-reading-now");
      const details = el.closest("details");
      if (details && !details.open) details.open = true;
      if (follow) el.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
      const pct = blocks.length ? Math.round((index / blocks.length) * 100) : 0;
      fill.style.width = pct + "%";
      meter.setAttribute("aria-valuenow", String(pct));
      const section = el.closest("[data-section]");
      const heading = section ? ($(".wiki-h-text", section) || {}).textContent : "";
      const art = BY_SLUG.get(current.slug);
      $("#wikiReaderTitle").textContent = (art ? art.short : "") + (heading ? " · " + heading : "");
    }
    function speak() {
      const my = ++token;
      synth.cancel();
      if (index >= blocks.length) { finish(); return; }
      highlight();
      const u = new SpeechSynthesisUtterance(textOf(blocks[index]));
      const v = voice();
      if (v) u.voice = v;
      u.lang = v ? v.lang : "en-US";
      u.rate = Number(prefs.rate) || 1;
      u.onend = () => { if (my === token && playing) { index++; speak(); } };
      u.onerror = (e) => { if (my === token && playing && e.error !== "interrupted" && e.error !== "canceled") { index++; speak(); } };
      synth.speak(u);
    }
    function setPlaying(on) {
      playing = on;
      toggleBtn.innerHTML = icon(on ? "pause" : "play_arrow");
      toggleBtn.setAttribute("aria-label", t(on ? "pause" : "resume"));
      $$('[data-action="read"]', main).forEach((b) => { b.innerHTML = `${icon(on ? "pause" : "record_voice_over")}<span>${esc(on ? t("pause") : bar.hidden ? t("readAloud") : t("resume"))}</span>`; });
    }
    function finish() {
      stop();
    }
    function start(sectionId) {
      if (!synth || !("SpeechSynthesisUtterance" in window)) { toast(t("readAloudUnsupported"), { type: "error", icon: "error" }); return; }
      blocks = collect();
      if (!blocks.length) return;
      index = 0;
      if (sectionId) {
        const sec = document.getElementById("sec-" + sectionId);
        const at = sec ? blocks.findIndex((b) => sec.contains(b)) : -1;
        if (at >= 0) index = at;
      }
      bar.hidden = false;
      $("#wikiReaderRateLabel").textContent = formatRate(prefs.rate);
      setPlaying(true);
      speak();
    }
    function pause() { token++; synth.cancel(); setPlaying(false); }
    function resume() { if (!blocks.length) { start(); return; } setPlaying(true); speak(); }
    function toggle() { if (bar.hidden) start(); else if (playing) pause(); else resume(); }
    function stop(silent) {
      token++;
      if (synth) synth.cancel();
      const wasOpen = !bar.hidden;
      bar.hidden = true;
      blocks = [];
      index = 0;
      $$(".mu-reading-now").forEach((el) => el.classList.remove("mu-reading-now"));
      setPlaying(false);
      if (wasOpen && !silent) live(t("readingStopped"));
    }
    function step(d) { if (!blocks.length) return; index = Math.max(0, Math.min(blocks.length - 1, index + d)); if (playing) speak(); else highlight(); }
    function jumpTo(target) {
      if (bar.hidden || !blocks.length) return;
      const at = blocks.findIndex((b) => b === target || b.contains(target));
      if (at < 0) return;
      index = at;
      setPlaying(true);
      speak();
    }
    const formatRate = (r) => formatNumber(Number(r)) + "×";
    $("#wikiReaderPrev").addEventListener("click", () => step(-1));
    $("#wikiReaderNext").addEventListener("click", () => step(1));
    toggleBtn.addEventListener("click", toggle);
    $("#wikiReaderStop").addEventListener("click", () => stop());
    $("#wikiReaderRate").addEventListener("click", () => {
      const i = RATES.indexOf(Number(prefs.rate));
      prefs.rate = RATES[(i + 1) % RATES.length];
      savePrefs();
      $("#wikiReaderRateLabel").textContent = formatRate(prefs.rate);
      const rateSel = $("#wikiRate");
      rateSel.value = String(prefs.rate);
      if (UI && UI.refreshSelect) UI.refreshSelect(rateSel);
      if (playing) speak();
    });
    followBtn.addEventListener("click", () => {
      follow = !follow;
      followBtn.setAttribute("aria-pressed", String(follow));
      followBtn.classList.toggle("mu-icon-btn-soft", !follow);
      if (follow) highlight();
    });
    window.addEventListener("beforeunload", () => synth && synth.cancel());
    return { start, toggle, stop, jumpTo, get active() { return !bar.hidden; }, get playing() { return playing; }, available: Boolean(synth) };
  })();

  // ------------------------------------------------------------------ settings
  const langSelect = $("#wikiLanguage");
  const voiceSelect = $("#wikiVoice");
  const rateSelect = $("#wikiRate");
  const sizeInput = $("#wikiTextSize");
  function fillLanguages() {
    const opts = [`<option value="auto">${esc(t("themeSystem"))}</option>`].concat((LOC ? LOC.LOCALES : [{ code: "en-US", name: "English (United States)" }]).map((l) => `<option value="${l.code}" lang="${l.code}">${esc(l.name)}</option>`));
    langSelect.innerHTML = opts.join("");
    langSelect.value = prefs.lang || "auto";
    if (UI && UI.refreshSelect) UI.refreshSelect(langSelect);
  }
  function fillVoices() {
    const synth = window.speechSynthesis;
    const list = synth ? synth.getVoices() : [];
    const sorted = [...list].sort((a, b) => (/^en/i.test(b.lang) - /^en/i.test(a.lang)) || a.name.localeCompare(b.name));
    voiceSelect.innerHTML = [`<option value="">${esc(t("automaticVoice"))}</option>`].concat(sorted.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`)).join("");
    voiceSelect.value = list.some((v) => v.voiceURI === prefs.voice) ? prefs.voice : "";
    voiceSelect.disabled = !synth;
    if (UI && UI.refreshSelect) UI.refreshSelect(voiceSelect);
  }
  function applyReading() {
    const root = document.documentElement.style;
    const size = Math.min(26, Math.max(18, Number(prefs.textSize) || 20));
    root.setProperty("--wiki-text", size + "px");
    root.setProperty("--wiki-leading", prefs.spacing || "1.6");
    root.setProperty("--wiki-tracking", prefs.letterSpacing ? "0.06em" : "normal");
    root.setProperty("--wiki-word-spacing", prefs.letterSpacing ? "0.16em" : "normal");
    sizeInput.value = String(size);
    sizeInput.dispatchEvent(new Event("input", { bubbles: true }));
    $("#wikiTextSizeValue").textContent = t("textSizeValue", { n: formatNumber(size) });
    $$("#wikiSpacing button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.spacing === String(prefs.spacing))));
    $("#wikiLetterSpacing").checked = Boolean(prefs.letterSpacing);
    rateSelect.value = String(prefs.rate);
    if (UI && UI.refreshSelect) UI.refreshSelect(rateSelect);
  }
  function syncTheme() {
    const pref = UI && UI.theme ? UI.theme.get() : "system";
    $$("#wikiTheme button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === pref)));
  }
  langSelect.addEventListener("change", () => {
    prefs.lang = langSelect.value;
    savePrefs();
    setLocale();
    fillLanguages();
    fillVoices();
    renderSidebar();
    current = { route: "", slug: "" };
    render();
    applyReading();
  });
  voiceSelect.addEventListener("change", () => { prefs.voice = voiceSelect.value; savePrefs(); });
  rateSelect.addEventListener("change", () => { prefs.rate = Number(rateSelect.value) || 1; savePrefs(); $("#wikiReaderRateLabel").textContent = formatNumber(prefs.rate) + "×"; });
  sizeInput.addEventListener("input", (e) => {
    if (!e.isTrusted) return;
    prefs.textSize = Number(sizeInput.value);
    savePrefs();
    applyReading();
  });
  $("#wikiSpacing").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; prefs.spacing = b.dataset.spacing; savePrefs(); applyReading(); });
  $("#wikiLetterSpacing").addEventListener("change", (e) => { prefs.letterSpacing = e.target.checked; savePrefs(); applyReading(); });
  $("#wikiTheme").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || !UI) return; UI.theme.set(b.dataset.theme); syncTheme(); });
  document.addEventListener("mu-theme", syncTheme);
  $("#wikiResetSettings").addEventListener("click", () => {
    prefs = { ...DEFAULT_PREFS };
    savePrefs();
    if (UI) UI.theme.set("system");
    syncTheme();
    setLocale();
    fillLanguages();
    fillVoices();
    renderSidebar();
    current = { route: "", slug: "" };
    render();
    applyReading();
    toast(t("settingsReset"), { type: "success", icon: "restart_alt" });
  });
  if (window.speechSynthesis && "onvoiceschanged" in window.speechSynthesis) window.speechSynthesis.addEventListener("voiceschanged", fillVoices);

  // ------------------------------------------------------------------ keyboard
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  document.addEventListener("keydown", (e) => {
    const modalOpen = document.querySelector(".mu-modal:not([hidden])");
    if ((e.key === "/" && !typing(e.target) && !modalOpen) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (e.key === "?" && !typing(e.target) && !modalOpen) { e.preventDefault(); if (UI) UI.openModal("wikiShortcuts"); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "r" && current.slug) { e.preventDefault(); reader.toggle(); return; }
      if (k === "s" && current.slug) { e.preventDefault(); toggleSaved(current.slug); return; }
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && current.slug && !typing(e.target)) {
        e.preventDefault();
        const i = ARTICLES.findIndex((a) => a.slug === current.slug);
        const forward = (e.key === "ArrowRight") !== (document.documentElement.dir === "rtl");
        location.hash = hrefArticle(ARTICLES[(i + (forward ? 1 : -1) + ARTICLES.length) % ARTICLES.length].slug);
        return;
      }
    }
    if (e.key === "Escape" && !modalOpen && !typing(e.target)) {
      if (reader.active) { reader.stop(); return; }
      if (sidebar.classList.contains("is-open")) { setSidebar(false); menuBtn.focus(); }
    }
  });

  // ------------------------------------------------------------------ start
  setLocale();
  fillLanguages();
  fillVoices();
  applyReading();
  syncTheme();
  renderSidebar();
  if (!reader.available) $("#wikiVoice").closest(".mu-row").hidden = true;
  if (!location.hash) history.replaceState(null, "", "#/");
  render();
})();
