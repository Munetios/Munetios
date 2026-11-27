'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../webfilter/webfilter-engine.js');

test('site safety policies inherit global controls and isolate class video blocks', () => {
  const globalId = 'AbCdEf12345';
  const classId = 'ZYxWV_1234A';
  const rules = {
    global: { safeModes: { google: true, youtube: 'true' }, blockedYouTubeVideos: [globalId, 'https://youtu.be/' + globalId, 'invalid'] },
    classes: [
      { id: 'class-a', safeModes: { google: false, youtube: true, munetios: true }, blockedYouTubeVideos: ['https://www.youtube.com/shorts/' + classId] },
      { id: 'class-b' },
    ],
  };
  assert.deepEqual(E.effectiveSiteControls(rules, 'class-a'), {
    safeModes: ['google', 'youtube', 'munetios'], blockedYouTubeVideos: [globalId, classId],
  });
  assert.deepEqual(E.effectiveSiteControls(rules, 'class-b'), {
    safeModes: ['google'], blockedYouTubeVideos: [globalId],
  });
  for (const url of [
    'https://m.youtube.com/watch?list=abc&v=' + globalId,
    'https://www.youtube.com/live/' + globalId,
    'https://www.youtube-nocookie.com/embed/' + globalId,
    'https://youtu.be/' + globalId + '?t=15',
  ]) {
    assert.equal(E.youtubeVideoId(url), globalId);
  }
  assert.equal(E.youtubeVideoId('https://youtube.com.example/watch?v=' + globalId), '');
  assert.equal(E.youtubeVideoId('https://youtube.com/results?v=' + globalId), '');
  assert.equal(E.youtubeVideoId(globalId.toLowerCase()), globalId.toLowerCase());
});

test('a classroom can allow an inherited YouTube video block or block another video', () => {
  const inheritedVideo = 'AbCdEf12345';
  const classroomBlock = 'ZYxWV_1234A';
  const policy = {
    global: { safeModes: { youtube: true }, blockedYouTubeVideos: [inheritedVideo] },
    classes: [
      { id: 'class-a', allowedYouTubeVideos: ['https://youtu.be/' + inheritedVideo], blockedYouTubeVideos: [classroomBlock] },
      { id: 'class-b' },
    ],
  };
  assert.deepEqual(E.effectiveSiteControls(policy, 'class-a'), {
    safeModes: ['youtube'], blockedYouTubeVideos: [classroomBlock],
  });
  assert.deepEqual(E.effectiveSiteControls(policy, 'class-b').blockedYouTubeVideos, [inheritedVideo]);
  assert.deepEqual(E.effectiveSiteControls(policy).blockedYouTubeVideos, [inheritedVideo]);
  policy.classes[0].blockedYouTubeVideos.push(inheritedVideo);
  assert.ok(E.effectiveSiteControls(policy, 'class-a').blockedYouTubeVideos.includes(inheritedVideo));
});

test('forced search and school mode replace conflicting values without changing the target site', () => {
  const modes = ['google', 'munetios'];
  const search = E.forcedSafeUrl('https://www.google.co.uk/search?q=math&safe=off&safe=blur#result', modes);
  assert.equal(search, 'https://www.google.co.uk/search?q=math&safe=active#result');
  assert.equal(E.forcedSafeUrl(search, modes), '');
  assert.equal(E.forcedSafeUrl('https://app.munetios.com/notes?schoolMode=false&lesson=5#current', modes),
    'https://app.munetios.com/notes?schoolMode=true&lesson=5#current');
  assert.equal(E.forcedSafeUrl('https://accounts.google.com/preferences', modes), '');
  assert.equal(E.forcedSafeUrl('https://munetios.com.example/notes', modes), '');
});

const policy = {
  global: {
    allowlistOnly: false,
    rules: [
      { id: 'g1', type: 'domain', value: 'games.example', action: 'block' },
      { id: 'g2', type: 'domain', value: 'cdn.allowed.example', action: 'allow' },
      { id: 'g3', type: 'keyword', value: 'casino', action: 'block' },
      { id: 'g4', type: 'url', value: 'video.example/kids', action: 'allow' },
    ],
    userCss: { defaultMode: 'allowed', allowed: ['wiki.example'], blocked: ['bank.example'], partial: ['news.example'] },
    styles: [{ id: 's1', name: 'Wiki font', targets: ['wiki.example'], css: 'body { font-family: "Google Sans Flex"; }' }],
  },
  classes: [{
    id: 'c1', name: 'Period 1', allowlistOnly: false,
    rules: [{ id: 'c1r', type: 'domain', value: 'social.example', action: 'block' }, { id: 'c1a', type: 'domain', value: 'video.example', action: 'block' }],
    userCss: { defaultMode: 'inherit', allowed: [], blocked: ['wiki.example/private'], partial: ['wiki.example'] },
    styles: [{ id: 's2', name: 'Class colors', targets: [], css: 'p { color: #8f5cff; display: none; }' }],
  }],
};

test('web filter precedence: global block beats class allow; class block applies only to its class', () => {
  assert.equal(E.evaluateAccess('https://games.example/play', policy).reason, 'global-block');
  assert.equal(E.evaluateAccess('https://m.games.example', policy).blocked, true);
  assert.equal(E.evaluateAccess('https://bestcasino.example', policy).reason, 'global-block');
  assert.equal(E.evaluateAccess('https://social.example', policy).blocked, false);
  assert.equal(E.evaluateAccess('https://social.example', policy, { classId: 'c1' }).reason, 'class-block');
  assert.equal(E.evaluateAccess('https://video.example/kids/song', policy, { classId: 'c1' }).reason, 'class-block');
  assert.equal(E.evaluateAccess('chrome://settings', policy).reason, 'internal');
  const tmp = E.evaluateAccess('https://wiki.example', policy, { tempBlocks: [{ pattern: 'wiki.example', until: Date.now() + 60000 }] });
  assert.equal(tmp.reason, 'temporary');
  const expired = E.evaluateAccess('https://wiki.example', policy, { tempBlocks: [{ pattern: 'wiki.example', until: Date.now() - 1 }] });
  assert.equal(expired.blocked, false);
  const locked = { global: { allowlistOnly: true, rules: [{ type: 'domain', value: 'ok.example', action: 'allow' }] } };
  assert.equal(E.evaluateAccess('https://other.example', locked).reason, 'allowlist-only');
  assert.equal(E.evaluateAccess('https://ok.example', locked).blocked, false);
});

test('UserCSS lists: most restrictive wins and blocked web filter pages are restricted', () => {
  assert.equal(E.resolveUserCssMode('https://wiki.example', policy).mode, 'allowed');
  assert.equal(E.resolveUserCssMode('https://wiki.example', policy, { classId: 'c1' }).mode, 'partial');
  assert.equal(E.resolveUserCssMode('https://wiki.example/private/x', policy, { classId: 'c1' }).mode, 'blocked');
  assert.equal(E.resolveUserCssMode('https://news.example', policy).mode, 'partial');
  assert.equal(E.resolveUserCssMode('https://bank.example', policy).mode, 'blocked');
  const restricted = E.computePageStyles('https://games.example', policy);
  assert.equal(restricted.mode, 'restricted');
  assert.equal(restricted.css, '');
  assert.deepEqual(restricted.styles, []);
});

test('blocked URLs never receive UserCSS but are not blocked by the web filter', () => {
  const page = E.computePageStyles('https://bank.example/login', policy);
  assert.equal(page.access.blocked, false);
  assert.equal(page.mode, 'blocked');
  assert.equal(page.css, '');
});

test('partial mode keeps only the 8 permitted properties', () => {
  const result = E.sanitizeCss('a { color: red; display: none; position: fixed; background: #fff; font-size: 20px; opacity: .5; backdrop-filter: blur(2px); font-weight: 300; font-feature-settings: "ss01" 1; font-variation-settings: "wght" 400; font-family: x; width: 10px }', { mode: 'partial' });
  assert.match(result.css, /color: red/);
  assert.match(result.css, /backdrop-filter: blur\(2px\)/);
  assert.doesNotMatch(result.css, /display|position|opacity|width/);
  assert.equal(result.violations.filter(v => v.code === 'partial-property').length, 4);
  assert.equal(E.sanitizeCss('@import url("https://api.munetios.com/a.css"); @keyframes x { from { color: red } }', { mode: 'partial' }).css, '');
});

test('imports and URL values use the fixed HTTPS resource hosts', () => {
  const css = [
    '@import "https://cdn.allowed.example/x.css";',
    '@import url(https://api.munetios.com/ok.css);',
    '@import "https://fonts.googleapis.com/css2?family=Roboto";',
    '.a { background: url(https://api.munetios.com.example/t.png); }',
    '.b { background-image: url("https://api.munetios.com/bg.png"); }',
    '.c { background: url(//fonts.gstatic.com/p.png); }',
    '.d { background: url(images/local.png); }',
    '.e { background: url(data:image/png;base64,AA); }',
    '.f { background: url(http://api.munetios.com/insecure.png); }',
    '.g { background: image-set("https://api.munetios.com/one.png" 1x, "https://fonts.gstatic.com/two.png" 2x); }',
    '.h { filter: url(#local-filter); }',
    "@font-face { font-family: 'X'; src: url('chrome-extension://abcdefghijklmnopabcdefghijklmnop/fonts/munetios-sans.ttf'); }",
  ].join('\n');
  const result = E.computePageStyles('https://school.example/', policy, { injectUserCss: true, userStyles: [{ id: 'test', targets: [], css }] });
  assert.match(result.css, /api\.munetios\.com\/ok\.css/);
  assert.match(result.css, /fonts\.googleapis\.com\/css2/);
  assert.match(result.css, /api\.munetios\.com\/bg\.png/);
  assert.doesNotMatch(result.css, /allowed\.example|gstatic\.com|munetios\.com\.example|local\.png|local-filter|data:|insecure\.png|chrome-extension|image-set/);
  assert.match(E.fontFaceCss('chrome-extension://abcdefghijklmnopabcdefghijklmnop/fonts/munetios-sans.ttf'), /munetios-sans\.ttf/);
});

test('approved imports are sanitized recursively and resources never follow redirects', async t => {
  const styles = new Map([
    ['https://fonts.googleapis.com/base.css', '@import "https://api.munetios.com/nested.css"; .imported { color: blue; background-image: url(https://fonts.gstatic.com/blocked.png); }'],
    ['https://api.munetios.com/nested.css', '@import "https://fonts.googleapis.com/base.css"; .nested { color: green; background: url(https://api.munetios.com/image.png); }'],
  ]);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    if (url.endsWith('/redirect.png')) throw new TypeError('redirect refused');
    const response = styles.has(url)
      ? new Response(styles.get(url), { headers: { 'Content-Type': 'text/css' } })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  });
  const { css } = E.sanitizeCss(`
    @import url('https://fonts.googleapis.com/base.css') layer(school) supports(display: grid) screen;
    .card { color: red; background: url('https://api.munetios.com/redirect.png'); }
    .picture { background: image-set('https://api.munetios.com/image.png' 1x); }
  `);
  const resolved = await E.resolveCssResources(css, 'allowed');
  assert.deepEqual(calls.sort(), [...styles.keys(), 'https://api.munetios.com/image.png', 'https://api.munetios.com/redirect.png'].sort());
  assert.match(resolved, /@layer school[\s\S]+@supports \(display: grid\)[\s\S]+@media screen/);
  assert.match(resolved, /\.imported \{\s+color: blue;/);
  assert.match(resolved, /\.nested \{\s+color: green;\s+background: url\("data:image\/png;base64,AQID"\)/);
  assert.match(resolved, /\.card \{\s+color: red;\s*}/);
  assert.match(resolved, /image-set\("data:image\/png;base64,AQID" 1x\)/);
  assert.doesNotMatch(resolved, /@import|https:\/\//);
});

test('workspace import permissions cover HTTPS origins or exact stylesheets and never grant url() access', async t => {
  const policy = { global: { userCss: { importUrls: ['styles.example', 'https://cdn.example/staff.css', 'http://invalid.example', 'https://*.example'] } } };
  const css = `
    @import 'https://styles.example/theme.css';
    @import 'https://cdn.example/staff.css';
    @import 'https://cdn.example/other.css';
    @import 'https://sub.styles.example/theme.css';
    .banner { background: url(https://styles.example/image.png); }
  `;
  const page = E.computePageStyles('https://school.example', policy, { injectUserCss: true, userStyles: [{ id: 'theme', css }] });
  assert.deepEqual(page.importUrls, ['https://styles.example', 'https://cdn.example/staff.css']);
  assert.deepEqual(E.computePageStyles('https://school.example', policy, { injectUserCss: false, userStyles: [{ id: 'theme', css }] }).css, '');
  assert.match(page.css, /styles\.example\/theme\.css/);
  assert.match(page.css, /cdn\.example\/staff\.css/);
  assert.doesNotMatch(page.css, /other\.css|sub\.styles|image\.png/);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    const response = new Response('.banner { color: blue; background: url(https://styles.example/image.png); }', { headers: { 'Content-Type': 'text/css' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  });
  const resolved = await E.resolveCssResources(page.css, page.mode, undefined, page.importUrls);
  assert.deepEqual(calls.sort(), ['https://cdn.example/staff.css', 'https://styles.example/theme.css']);
  assert.match(resolved, /color: blue/);
  assert.doesNotMatch(resolved, /image\.png|@import/);
});

test('risky CSS is stripped even on Allowed URLs', () => {
  const css = [
    '.x { width: expression(alert(1)); color: red; }',
    '.y { -moz-binding: url(x.xml#b); behavior: url(x.htc); }',
    '.z { background: url("javascript:alert(1)"); }',
    '.w { background: url(data:text/html,<script>); }',
    '.v { z-index: 2147483647; }',
    '.u { z-index: 9999; }',
    '.overlay { position: fixed; inset: 0; background: white; }',
    '.overlay2 { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; }',
    '.ok { position: fixed; bottom: 16px; right: 16px; }',
    'iframe { opacity: 0; pointer-events: none; }',
    'button.buy { opacity: 0.01; }',
    'input[type="password"][value^="a"] { background: url(https://cdn.allowed.example/a); }',
    'input[value$="z"] { background-image: var(--leak); }',
    "@font-face { font-family: spy; src: url(https://cdn.allowed.example/a.woff); unicode-range: U+0061; }",
    '#munetios-webfilter-block { display: none; }',
    'munetios-webfilter-notice { visibility: hidden; }',
    'html { opacity: 0; color: red; }',
    ':root { filter: blur(20px); }',
    '* { visibility: hidden; }',
    '.c\\6f lor { color: red; }',
    '.e { c\\olor: red; }',
    '.nest { color: red; & .child { color: blue; } }',
  ].join('\n');
  const result = E.sanitizeCss(css, { mode: 'allowed' });
  const codes = result.violations.map(v => v.code);
  for (const code of ['script-vector', 'z-index-extreme', 'viewport-overlay', 'interactive-spoofing', 'exfiltration', 'font-tracking', 'protected-target', 'protected-overlay', 'escape-obfuscation', 'nested-rule']) {
    assert.ok(codes.includes(code), 'missing ' + code + ' in ' + codes.join(','));
  }
  assert.doesNotMatch(result.css, /expression|binding|behavior|javascript|text\/html|2147483647|munetios|unicode-range|value\^=|value\$=/i);
  assert.match(result.css, /z-index: 9999/);
  assert.match(result.css, /\.ok \{\n  position: fixed;/);
  assert.doesNotMatch(result.css, /\.overlay \{[^}]*position/);
  assert.match(result.css, /html \{\n  color: red;\n\}/);
  assert.doesNotMatch(result.css, /visibility: hidden|filter: blur\(20px\)/);
  assert.match(result.css, /\.nest \{\n  color: red;\n\}/);
});

test('ordinary hiding rules on classes keep working', () => {
  const result = E.sanitizeCss('.ad-banner { display: none; } main article p { font-family: "Google Sans Flex"; }', { mode: 'allowed' });
  assert.match(result.css, /\.ad-banner \{\n  display: none;/);
  assert.equal(result.violations.length, 0);
});

test('computePageStyles combines matching global and class styles and sanitizes them for the mode', () => {
  const page = E.computePageStyles('https://wiki.example/article', policy, { classId: 'c1' });
  assert.equal(page.mode, 'partial');
  assert.equal(page.styles.length, 2);
  assert.match(page.css, /color: #8f5cff/);
  assert.doesNotMatch(page.css, /display/);
  assert.equal(page.usesGoogleSansFlex, true);
});

test('auto-suggest filters to the 8 permitted properties in partial mode', () => {
  const partial = E.propertySuggestions('', 'partial');
  const firstNine = partial.slice(0, 9).map(item => item.name).sort();
  assert.deepEqual(firstNine, [...E.PARTIAL_PROPERTIES].sort());
  assert.equal(partial.find(item => item.name === 'display').allowed, false);
  assert.equal(E.propertySuggestions('disp', 'allowed')[0].allowed, true);
  assert.ok(E.valueSuggestions('font-family', 'google').includes("'Google Sans Flex'"));
  assert.ok(E.valueSuggestions('backdrop-filter', '').includes('blur(2px)'));
  assert.ok(E.valueSuggestions('font-feature-settings', 'ss01').includes('"ss01" 1'));
});

test('the /blocked page is never filtered (no redirect loops) and never styled', () => {
  const ctx = { blockPageUrl: 'https://wf.school.example/blocked' };
  const strict = { global: { allowlistOnly: true, rules: [], userCss: { defaultMode: 'allowed' }, styles: [{ id: 's', css: 'body { color: red; }' }] }, classes: [] };
  assert.equal(E.evaluateAccess('https://wf.school.example/blocked?mode=blocked', strict, ctx).blocked, false);
  assert.equal(E.evaluateAccess('https://wf.school.example/blocked?mode=blocked', strict, ctx).reason, 'webfilter-page');
  assert.equal(E.evaluateAccess('https://wf.school.example/other', strict, ctx).reason, 'allowlist-only');
  assert.equal(E.evaluateAccess('https://evil.example/blocked', strict, ctx).blocked, true);
  const page = E.computePageStyles('https://wf.school.example/blocked/', strict, ctx);
  assert.equal(page.mode, 'restricted');
  assert.equal(page.css, '');
});

test('the injected @font-face never sets font-feature-settings on page elements', () => {
  const css = E.fontFaceCss('chrome-extension://abcdefghijklmnopabcdefghijklmnop/fonts/munetios-sans.ttf');
  assert.match(css, /^@font-face \{[\s\S]*\}\n$/);
  assert.equal((css.match(/\{/g) || []).length, 1);
});

test('blocked text blocks matching URLs, skips allow-listed sites, and matches whole words only', () => {
  const p = { global: { rules: [{ type: 'domain', value: 'kids.example', action: 'allow' }], blockedText: ['bad word', 'casino'] }, classes: [{ id: 'c', name: 'C', blockedText: ['poker'] }] };
  assert.equal(E.evaluateAccess('https://search.example/?q=Bad+Word', p).reason, 'blocked-text');
  assert.equal(E.evaluateAccess('https://search.example/bad-word', p).rule.value, 'bad word');
  assert.equal(E.evaluateAccess('https://search.example/?q=badwords', p).blocked, false);
  assert.equal(E.evaluateAccess('https://kids.example/?q=casino', p).reason, 'allow-rule');
  assert.equal(E.evaluateAccess('https://x.example/?q=poker', p).blocked, false);
  assert.equal(E.evaluateAccess('https://x.example/?q=poker', p, { classId: 'c' }).scope, 'c');
  assert.equal(E.findBlockedText('a classic class', ['ass']), null);
  assert.equal(E.findBlockedText('ｃａｓｉｎｏ night', ['casino']), 'casino');
  assert.equal(E.stripBlockedText('Play CASINO now', ['casino']), 'Play  now');
  assert.deepEqual(E.textFilterFor('https://kids.example/', p), { phrases: [], exempt: true });
  assert.deepEqual(E.textFilterFor('https://a.example/', p, { classId: 'c' }).phrases, ['bad word', 'casino', 'poker']);
  assert.equal(E.textFilterFor('https://wf.example/blocked?url=casino', p, { blockPageUrl: 'https://wf.example/blocked' }).exempt, true);
});

test('categories: built-in list, custom overrides, Unrated default, and allow rules win', () => {
  const p = { global: { rules: [{ type: 'domain', value: 'chess.com', action: 'allow' }], blockedCategories: ['games', 'unrated'], categoryOverrides: { 'myschool.example': 'education', 'www.cool.example': 'games', 'bad key!': 'games', 'x.example': 'not-a-category' } }, classes: [{ id: 'c', name: 'C', blockedCategories: ['social', 'bogus'] }] };
  assert.equal(E.categorize('https://www.roblox.com/', p).category, 'games');
  assert.equal(E.categorize('https://music.youtube.com/', p).category, 'music');
  assert.equal(E.categorize('https://www.youtube.com/', p).category, 'video');
  assert.deepEqual(E.categorize('https://never-heard-of.example/', p), { category: 'unrated', source: 'unrated', domain: 'never-heard-of.example' });
  assert.equal(E.categorize('https://a.myschool.example/', p).source, 'custom');
  assert.equal(E.categorize('https://cs.stanford.edu/', p).category, 'education');
  assert.equal(E.categorize('https://www.nasa.gov/', p).category, 'government');
  assert.equal(E.categorize('http://127.0.0.1:3000/', p).category, 'unrated');
  assert.equal(E.evaluateAccess('https://www.roblox.com/', p).reason, 'category-block');
  assert.equal(E.evaluateAccess('https://chess.com/', p).reason, 'allow-rule');
  assert.equal(E.evaluateAccess('https://unknown.example/', p).rule.value, 'unrated');
  assert.equal(E.evaluateAccess('https://myschool.example/', p).blocked, false);
  assert.equal(E.evaluateAccess('https://www.instagram.com/', p).blocked, false);
  assert.equal(E.evaluateAccess('https://www.instagram.com/', p, { classId: 'c' }).scope, 'c');
  const normalized = E.normalizePolicy(p);
  assert.deepEqual(Object.keys(normalized.global.categoryOverrides).sort(), ['myschool.example', 'www.cool.example']);
  assert.deepEqual(normalized.classes[0].blockedCategories, ['social']);
  assert.equal(E.evaluateAccess('https://wf.example/blocked', p, { blockPageUrl: 'https://wf.example/blocked' }).blocked, false);
});

test('teachers: class rules come first and Global rules, categories and words can be switched off for one class', () => {
  const p = { global: { rules: [{ id: 'g1', type: 'domain', value: 'youtube.com', action: 'block' }, { id: 'g2', type: 'domain', value: 'games.example', action: 'block' }], blockedText: ['casino'], blockedCategories: ['games'] },
    classes: [{ id: 'bio', name: 'Bio', rules: [{ id: 'c1', type: 'domain', value: 'youtube.com', action: 'allow' }], globalExceptions: { rules: ['g2'], categories: ['games'], text: ['casino'] } }, { id: 'art', name: 'Art' }] };
  assert.equal(E.evaluateAccess('https://youtube.com', p, { classId: 'bio' }).reason, 'allow-rule');
  assert.equal(E.evaluateAccess('https://youtube.com', p, { classId: 'art' }).reason, 'global-block');
  assert.equal(E.evaluateAccess('https://games.example', p, { classId: 'bio' }).blocked, false);
  assert.equal(E.evaluateAccess('https://games.example', p, { classId: 'art' }).blocked, true);
  assert.equal(E.evaluateAccess('https://roblox.com', p, { classId: 'bio' }).blocked, false);
  assert.equal(E.evaluateAccess('https://roblox.com', p, { classId: 'art' }).reason, 'category-block');
  assert.equal(E.evaluateAccess('https://x.example/?q=casino', p, { classId: 'bio' }).blocked, false);
  assert.equal(E.evaluateAccess('https://x.example/?q=casino', p, { classId: 'art' }).reason, 'blocked-text');
  assert.deepEqual(E.textFilterFor('https://x.example/', p, { classId: 'bio' }).phrases, []);
});

test("students' own UserCSS runs only when injection is on and still goes through the policy sandbox", () => {
  const own = [{ id: 'u', name: 'Mine', targets: ['news.example'], css: 'p { color: red; position: fixed; inset: 0; }' }];
  const policy = { global: { userCss: { defaultMode: 'allowed', partial: ['partial.example'], blocked: ['bank.example'] } } };
  assert.equal(E.computePageStyles('https://news.example/', policy, { userStyles: own, injectUserCss: false }).css, '');
  const on = E.computePageStyles('https://news.example/', policy, { userStyles: own, injectUserCss: true });
  assert.match(on.css, /color: red/);
  assert.doesNotMatch(on.css, /position/);
  assert.equal(on.styles[0].scope, 'user');
  assert.equal(E.computePageStyles('https://other.example/', policy, { userStyles: own, injectUserCss: true }).css, '');
  const everywhere = [{ id: 'u2', targets: [], css: 'p { color: blue; display: none; }' }];
  assert.doesNotMatch(E.computePageStyles('https://partial.example/', policy, { userStyles: everywhere, injectUserCss: true }).css, /display/);
  assert.equal(E.computePageStyles('https://bank.example/', policy, { userStyles: everywhere, injectUserCss: true }).css, '');
});

test('the built-in category list covers over 5,000 websites, each a valid domain in exactly one category', () => {
  const data = require('../webfilter/webfilter-categories.js');
  const domain = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  const seen = new Map();
  for (const [category, domains] of Object.entries(data)) {
    assert.ok(E.CATEGORIES.includes(category) && category !== 'unrated', 'unknown category ' + category);
    for (const name of domains) {
      assert.match(name, domain, name);
      assert.ok(!seen.has(name), `${name} is in both ${seen.get(name)} and ${category}`);
      seen.set(name, category);
    }
  }
  assert.ok(seen.size > 5000, 'only ' + seen.size + ' sites');
  assert.ok(E.BUILTIN_CATEGORY_COUNT > 5000);
  for (const [name, category] of seen) assert.equal(E.categorize('https://www.' + name + '/', {}).category, category, name);
});
