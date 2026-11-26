'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const context = { window: {}, console };
vm.runInNewContext(read('ganetios-features-i18n.js'), context);
vm.runInNewContext(read('ganetios-locales.js'), context);
const html = read('index.html');
const start = html.indexOf('          const translations = {');
const end = html.indexOf('          function hasCompleteUiLanguageCoverage', start);
assert.ok(start > 0 && end > start);
vm.runInNewContext(html.slice(start, end) + ';window.localeAudit = { translations, runtimeTranslationFallbacks };', context);
const { translations, runtimeTranslationFallbacks: fallbacks } = context.window.localeAudit;
function merged(locale) {
  const base = locale.split('-')[0];
  return { ...fallbacks[base], ...translations[base], ...fallbacks[locale], ...translations[locale] };
}
function check(catalog, english, label) {
  for (const [key, value] of Object.entries(english)) {
    assert.equal(typeof catalog[key], 'string', `${label}: missing ${key}`);
    assert.ok(catalog[key].trim(), `${label}: empty ${key}`);
    assert.deepEqual(placeholders(catalog[key]), placeholders(value), `${label}: placeholders in ${key}`);
    assert.ok(!catalog[key].includes('\ufffd'), `${label}: replacement character in ${key}`);
  }
}
function checkEnglishSentences(catalog, english, label) {
  for (const [key, value] of Object.entries(english)) {
    if (typeof value === 'string' && (value.match(/[A-Za-z]+/g) || []).length >= 4) assert.notEqual(catalog[key], value, `${label}: English sentence in ${key}`);
  }
}
const covered = ['es-ES','es-MX','es-US','fr-FR','de-DE','it-IT','pt-BR','pt-PT','ru-RU','zh-CN','ja-JP','ko-KR','ar-SA','hi-IN','tr-TR','vi-VN'];
for (const locale of covered) { check(merged(locale), translations.en, `Ganetios ${locale}`); checkEnglishSentences(merged(locale), translations.en, `Ganetios ${locale}`); }
const ganetiosFeatures = Object.fromEntries(Object.entries(translations.en).filter(([key]) => /^g[ft]/.test(key)));
const selector = html.match(/const supportedLanguageLocales = \[([\s\S]*?)\]\.filter/)[1];
const ganetiosLocales = [...selector.matchAll(/"([^"]+)"/g)].map(([, locale]) => locale);
for (const locale of ganetiosLocales) {
  check(merged(locale), ganetiosFeatures, `Ganetios features ${locale}`);
  if (!locale.startsWith('en')) checkEnglishSentences(merged(locale), ganetiosFeatures, `Ganetios features ${locale}`);
}
assert.equal(merged('pt-BR').searchButton, 'Buscar');
assert.equal(merged('pt-BR').settingsBtn, 'Configurações');
assert.equal(merged('pt-PT').settingsBtn, 'Ajustes');
assert.equal(merged('pt-PT').searchButton, 'Pesquisar');
const folder = path.join(root, 'omniwrite', 'languages');
const index = JSON.parse(fs.readFileSync(path.join(folder, 'index.json'), 'utf8'));
const cache = new Map();
function omni(locale, seen = new Set()) {
  if (cache.has(locale)) return cache.get(locale);
  assert.ok(!seen.has(locale), `Circular language fallback: ${locale}`); seen.add(locale);
  const base = index.fallbacks[locale];
  const inherited = base ? omni(base, new Set(seen)) : {};
  const file = path.join(folder, `${locale}.json`);
  const own = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const result = { ...inherited, ...own }; cache.set(locale, result); return result;
}
const english = omni('en');
for (const locale of new Set([...index.languages, ...Object.keys(index.fallbacks)])) {
  const catalog = omni(locale);
  check(catalog, english, `OmniWrite ${locale}`);
  if (!locale.startsWith('en')) checkEnglishSentences(catalog, english, `OmniWrite ${locale}`);
  for (const key of ['collab_open_share_failed', 'sheets_resize_cells', 'sheets_column_width', 'sheets_row_height']) {
    assert.doesNotMatch(catalog[key], /[?\ufffd]/u, `OmniWrite ${locale}: corrupted text in ${key}`);
  }
}
assert.equal(omni('pt-BR').search, 'Buscar');
assert.equal(omni('pt-BR').search_fonts, 'Buscar fontes');
assert.equal(omni('pt-BR').settings, 'Configurações');
assert.equal(omni('pt-PT').settings, 'Ajustes');
assert.equal(omni('pt-PT').font_settings, 'Ajustes do tipo de letra');
for (const [key, value] of Object.entries(omni('pt-BR'))) assert.ok(!/\b[Pp]esquis(?:ar|e|ando)\b/.test(value), `pt-BR search action: ${key}`);
for (const [key, value] of Object.entries(omni('pt-PT'))) assert.ok(!/\b[Cc]onfigurações\b/.test(value), `pt-PT settings label: ${key}`);
for (const file of ['account/account-i18n.js', 'signin/translations.js']) vm.runInNewContext(read(file), context);
for (const [label, catalog] of [['Account', context.window.MunetiosAccountStrings.catalog], ['Sign in', context.window.MunetiosSigninTranslations]]) {
  for (const [locale, dictionary] of Object.entries(catalog)) check(dictionary, catalog.en, `${label} ${locale}`);
}
assert.equal(context.window.MunetiosAccountStrings.catalog['pt-PT'].accountSettings, 'Ajustes da conta');
// Munetios WebFilter (webfilter/languages): same fallback chain as webfilter-i18n.js.
const wfFolder = path.join(root, 'webfilter', 'languages');
const wfIndex = JSON.parse(fs.readFileSync(path.join(wfFolder, 'index.json'), 'utf8'));
const wfEnglish = JSON.parse(fs.readFileSync(path.join(wfFolder, 'en-US.json'), 'utf8'));
function webfilter(locale) {
  const chain = []; const seen = new Set(); let code = locale;
  while (code && !seen.has(code)) { seen.add(code); if (wfIndex.languages.includes(code)) chain.unshift(code); code = wfIndex.fallbacks[code]; }
  return Object.assign({}, wfEnglish, ...chain.map(name => JSON.parse(fs.readFileSync(path.join(wfFolder, `${name}.json`), 'utf8'))));
}
const wfLocales = [...new Set([...wfIndex.languages, ...Object.keys(wfIndex.fallbacks)])];
for (const locale of wfLocales) {
  const catalog = webfilter(locale);
  check(catalog, wfEnglish, `WebFilter ${locale}`);
  if (!locale.startsWith('en')) checkEnglishSentences(catalog, wfEnglish, `WebFilter ${locale}`);
}
for (const locale of ['es', 'es-419', 'es-MX', 'es-US']) assert.equal(webfilter(locale).nav_settings, 'Configuración', `WebFilter ${locale} settings label`);
assert.equal(webfilter('es-ES').nav_settings, 'Ajustes');
assert.equal(webfilter('pt-BR').nav_settings, 'Configurações');
assert.equal(webfilter('pt-PT').nav_settings, 'Ajustes');
for (const [key, value] of Object.entries(webfilter('es-ES'))) assert.ok(!/\b[Cc]onfiguración\b/.test(value) || /[Cc]onfiguración >|[Pp]erfil(es)? de configuración/.test(value), `es-ES settings label: ${key}`);
for (const [key, value] of Object.entries(webfilter('pt-PT'))) assert.ok(!/\b[Cc]onfigurações\b/.test(value), `WebFilter pt-PT settings label: ${key}`);
for (const [key, value] of Object.entries(webfilter('pt-BR'))) assert.ok(!/\b[Pp]esquis(?:ar|e|ando)\b/.test(value), `WebFilter pt-BR search action: ${key}`);
// Munetios Maps: one complete catalog for each of the 17 global locales, with the regional rules.
{
  const mctx = { console, navigator: { language: "en-US", languages: ["en-US"] } }; mctx.window = mctx; vm.createContext(mctx);
  for (const file of ["shared/munetios-locales.js", "maps/maps-locales.js", "maps/maps-locales-2.js", "maps/maps-features-i18n.js"]) vm.runInContext(read(file), mctx);
  const mapsHtml = read("maps/index.html");
  // Run the real contiguous block: the tables through the 17-locale build, plus the language helpers it calls.
  const start = mapsHtml.indexOf("const UI_TRANSLATIONS = {");
  const buildEnd = mapsHtml.indexOf("})();", mapsHtml.indexOf("Object.assign(UI_TRANSLATIONS, built, { en: built[\"en-US\"] });", start)) + 5;
  const helperStart = mapsHtml.indexOf("function _normalizeLanguageCode");
  const helpers = helperStart > buildEnd || helperStart < start ? mapsHtml.slice(helperStart, mapsHtml.indexOf("function _getTranslationDict", helperStart)) : "";
  mctx.localStorage = { getItem: () => null, setItem() {} };
  vm.runInContext(helpers + mapsHtml.slice(start, buildEnd) + ";this.MAPS = UI_TRANSLATIONS;", mctx);
  const codes = mctx.MunetiosLocales.CODES;
  assert.equal(codes.length, 17);
  for (const code of codes) {
    check(mctx.MAPS[code], mctx.MAPS["en-US"], `Maps ${code}`);
    check(mctx.MapsFeatureStrings[code], mctx.MapsFeatureStrings.en, `Maps features ${code}`);
    if (!code.startsWith("en")) checkEnglishSentences(mctx.MAPS[code], mctx.MAPS["en-US"], `Maps ${code}`);
  }
  assert.equal(mctx.MAPS["pt-BR"].search_placeholder, "Buscar no Munetios Maps");
  assert.equal(mctx.MAPS["pt-PT"].settings, "Ajustes");
  assert.equal(mctx.MAPS["es-ES"].settings, "Ajustes");
  for (const code of ["es-419", "es-US"]) assert.equal(mctx.MAPS[code].settings, "Configuración");
  for (const code of ["es-419", "es-ES", "es-US"]) assert.equal(mctx.MAPS[code].home_label, "Casa");
  assert.match(mctx.MAPS["en-GB"].toast_no_start, /^Could not/);
  assert.match(mctx.MAPS["en-US"].toast_no_start, /^Couldn't/);
  for (const [k, v] of Object.entries(mctx.MAPS["en-GB"])) assert.ok(!/Couldn't/.test(v), `Maps en-GB: ${k}`);
  for (const [k, v] of Object.entries(mctx.MAPS["pt-BR"])) assert.ok(!/[Pp]esquis/.test(v), `Maps pt-BR search: ${k}`);
  for (const [k, v] of Object.entries(mctx.MAPS["pt-PT"])) assert.ok(!/Configurações|Definições/.test(v), `Maps pt-PT settings: ${k}`);
}
// Apps on the shared 17-locale catalogs: every locale present, every key filled, placeholders intact.
{
  const actx = { console, navigator: { language: "en-US", languages: ["en-US"] }, localStorage: { getItem: () => null, setItem() {} } }; actx.window = actx; vm.createContext(actx);
  vm.runInContext(read("shared/munetios-locales.js"), actx);
  for (const file of ["mail/strings.js", "tasks/tasks-features-i18n.js", "tasks/tasks-account-i18n.js", "supanotes/supanotes-features-i18n.js", "meals/meals-features-i18n.js", "munetios-ui/youtube-i18n.js"]) vm.runInContext(read(file), actx);
  const codes = actx.MunetiosLocales.CODES;
  for (const [label, cat] of [["Mail", actx.MunetiosMailTranslations], ["Tasks features", actx.TasksFeatureStrings], ["SupaNotes features", actx.SupaNotesFeatureStrings], ["Meals features", actx.MealsFeatureStrings]]) {
    assert.deepEqual(Object.keys(cat).sort(), [...codes].sort(), `${label}: locales`);
    const realWords = (text) => (String(text).replace(/{w+}/g, "").match(/[A-Za-z]{3,}/g) || []).length;
    for (const code of codes) {
      check(cat[code], cat["en-US"], `${label} ${code}`);
      if (code.startsWith("en")) continue;
      for (const [key, value] of Object.entries(cat["en-US"])) if (realWords(value) >= 4) assert.notEqual(cat[code][key], value, `${label} ${code}: English sentence in ${key}`);
    }
  }
  assert.deepEqual(Object.keys(actx.MunetiosTasksAccountStrings).sort(), [...codes].sort(), "Tasks account: locales");
  for (const code of codes) assert.ok(actx.MunetiosYouTubeI18n.get(code, "settings"), `YouTube ${code}`);
  assert.equal(actx.MunetiosYouTubeI18n.get("es-ES", "settings"), "Ajustes");
  assert.equal(actx.MunetiosYouTubeI18n.get("pt-PT", "settings"), "Ajustes");
  assert.equal(actx.MunetiosLocales.toTraditional("设置"), "設定");
}
console.log(`PASS: ${covered.length} Ganetios regional catalogs, Ganetios features in all ${ganetiosLocales.length} language options, ${cache.size} OmniWrite catalogs, and all account/sign-in catalogs; key coverage, placeholders, Unicode, and Portuguese terminology.`);
