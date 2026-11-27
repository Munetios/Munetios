'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

function fixture({ respond, initialKey = {} } = {}) {
  const values = new Map(), requests = [], timeouts = new Map(), intervals = [];
  const document = new EventTarget(); document.visibilityState = 'visible';
  const window = new EventTarget(); window.MunetiosAccountConfig = { autoRefresh: false };
  let session = { account: null, accounts: [] };
  let now = Date.UTC(2026, 0, 1), nextId = 0;
  class ClockDate extends Date { static now() { return now; } }
  let storedKey = initialKey;
  const db = { close() {}, transaction() {
    const tx = { objectStore: () => ({ get: () => ({ result: { key: storedKey } }), put: ({ key }) => { storedKey = key; return {}; }, delete: () => { storedKey = null; return {}; } }) };
    queueMicrotask(() => tx.oncomplete()); return tx;
  } };
  const context = vm.createContext({
    window, document, navigator: { language: 'en', connection: { saveData: false } },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), key: index => [...values.keys()][index], get length() { return values.size; } },
    indexedDB: { open() { const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } },
    TextEncoder, TextDecoder, btoa, atob, crypto: webcrypto, Intl, Date: ClockDate, CustomEvent, AbortSignal, structuredClone,
    setTimeout: fn => { const id = ++nextId; timeouts.set(id, fn); return id; },
    clearTimeout: id => timeouts.delete(id), setInterval: fn => intervals.push(fn),
    fetch: async url => { requests.push(url); const body = respond?.(url) ?? (url.endsWith('/session') ? session : url.includes('/items') || url.includes('/sync/state') ? { items: [], seq: '0' } : { used: 0, quota: 50000000000, groups: {} }); return { ok: !body?.__status, status: body?.__status || 200, json: async () => body }; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'account-i18n.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'account-core.js'), 'utf8'), context);
  const A = window.MunetiosAccount; A.state.account = { id: 'one', email: 'private@example.invalid' }; A.state.ready = true;
  return { A, values, requests, document, window, navigator: context.navigator, session(value) { session = value; },
    async drain() { const callbacks = [...timeouts.values()]; timeouts.clear(); callbacks.forEach(fn => fn()); await new Promise(setImmediate); await new Promise(setImmediate); },
    async advance(ms) { now += ms; intervals.forEach(fn => fn()); await new Promise(setImmediate); await new Promise(setImmediate); }
  };
}

test('password sign-in enables paused sync and decrypts cloud data', async () => {
  const account = { id: 'one', email: 'private@example.invalid' };
  const password = 'a passphrase for testing';
  const salt = new Uint8Array(16);
  const wrapIv = new Uint8Array(12);
  const source = await webcrypto.subtle.importKey('raw', Buffer.from(password), 'PBKDF2', false, ['deriveKey']);
  const wrapping = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt }, source, { name: 'AES-GCM', length: 256 }, false, ['wrapKey']);
  const dataKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapped = await webcrypto.subtle.wrapKey('raw', dataKey, wrapping, { name: 'AES-GCM', iv: wrapIv });
  const material = { salt: Buffer.from(salt).toString('hex'), iv: Buffer.from(wrapIv).toString('hex'), wrapped: Buffer.from(wrapped).toString('base64') };
  const key = 'fixture:document';
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from(account.id + '|' + key) }, dataKey, Buffer.from(JSON.stringify({ d: { title: 'Cloud document' } })));
  const item = { key, version: '1', iv: Buffer.from(iv).toString('hex'), ciphertext: Buffer.from(ciphertext).toString('base64') };
  const { A, values, session } = fixture({ initialKey: null, respond: url => {
    if (url.endsWith('/signin')) return { account, keys: material };
    if (url.includes('prefix=fixture')) return { items: [item], seq: '1' };
  } });
  session({ account, accounts: [] });
  values.set('munetios-sync-disabled:one', 'true');
  let title;
  A.sync.register({ id: 'fixture', prefix: 'fixture:', snapshot: async () => title ? [{ key, data: { title } }] : [], apply: async items => { title = items[0]?.data.title; return true; } });
  await A.signIn({ email: account.email, password });
  assert.equal(A.state.syncEnabled, true);
  assert.equal(await A.sync.now(), true);
  assert.equal(title, 'Cloud document');
});

test('Google sign-in enables sync for the returned account and consumes its marker', async () => {
  const { A, values, session, document } = fixture();
  values.set('munetios-sync-disabled:1', 'true');
  document.cookie = 'munetios-google-sync=1';
  session({ account: { id: '1', email: 'google@example.invalid' }, accounts: [] });
  await A.refresh();
  assert.equal(A.state.syncEnabled, true);
  assert.equal(A.state.status, 'idle');
  assert.match(document.cookie, /Max-Age=0/);
});

test('a revoked session keeps the account signed in, but account and sync requests fail until sign-in', async () => {
  const { A, values, requests, session } = fixture();
  const previous = A.state.account;
  values.set('munetios-account-cache', JSON.stringify(previous));
  values.set('munetios-sync:one', JSON.stringify({ items: { 'omniwrite:doc:cloud': { h: 'hash' }, 'omniwrite:doc:deleted': { h: null } } }));
  session({ account: null, accounts: [], sessionRevoked: true });
  await A.refresh();
  const revocation = A.state.revocation;
  assert.ok(revocation);
  assert.equal(A.state.account.id, 'one');
  assert.equal(A.state.status, 'error');
  assert.deepEqual([...A.cloudItems('omniwrite:doc:', 'omniwrite')], ['cloud']);
  requests.length = 0;
  assert.equal(await A.sync.now(), false);
  assert.equal(A.state.status, 'error');
  await assert.rejects(A.sessions(), { code: 'signedOut', status: 401 });
  await assert.rejects(A.updateProfile('New name'), { code: 'signedOut' });
  assert.ok(requests.every(url => url.endsWith('/session')), 'only the session check reaches the server');
  session({ account: null, accounts: [] });
  await A.refresh();
  assert.equal(A.state.revocation, revocation);
  assert.equal(A.state.account.id, 'one');
  session({ account: previous, accounts: [] });
  await A.refresh();
  assert.equal(A.state.revocation, null);
  assert.equal(A.state.status, 'idle');
});

test('a change that can\'t sync says so in the app\'s language', async () => {
  const { A, values, session, drain } = fixture();
  values.set('munetios-account-cache', JSON.stringify(A.state.account));
  session({ account: null, accounts: [], sessionRevoked: true });
  await A.refresh();
  const shown = [];
  const done = A.sync.report('Folder created', { locale: 'en-US', show: (text, type) => shown.push([text, type]) });
  await drain();
  assert.equal(await done, false);
  assert.deepEqual(shown, [["Folder created. It's saved on this device, but it couldn't sync.", 'error']]);
  shown.length = 0;
  const spanish = A.sync.report('¡Tarea creada!', { locale: 'es-MX', show: (text, type) => shown.push([text, type]) });
  await drain();
  await spanish;
  assert.deepEqual(shown, [['Tarea creada. Se guardó en este dispositivo, pero no se pudo sincronizar.', 'error']]);
  // Sync turned off on purpose: the change is only confirmed.
  await A.sync.setEnabled(false);
  shown.length = 0;
  assert.equal(await A.sync.report('Event created', { locale: 'fr', show: (text, type) => shown.push([text, type]) }), true);
  assert.deepEqual(shown, [['Event created', 'success']]);
});

test('a sign-out the server doesn\'t confirm leaves the session invalid but still signed in', async () => {
  let signOutWorks = false;
  const { A, values, requests, session } = fixture({ respond: url => (url.endsWith('/signout') ? (signOutWorks ? {} : { __status: 503, error: 'unavailable' }) : undefined) });
  const account = A.state.account;
  values.set('munetios-account-cache', JSON.stringify(account));
  session({ account, accounts: [] });
  await A.refresh();
  await assert.rejects(A.signOut(), { code: 'signOutPending' });
  assert.equal(A.state.account.id, 'one');
  assert.equal(A.state.revocation.pendingSignOut, true);
  assert.equal(A.state.status, 'error');
  // The server still accepts the session, but the sign-out stays pending and is finished once it answers.
  signOutWorks = true;
  requests.length = 0;
  await A.refresh();
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.ok(requests.some(url => url.endsWith('/signout')));
})

test('new settings validate values and stay isolated between accounts', () => {
  const { A } = fixture();
  assert.equal(A.settings.definitions.length, 20);
  assert.throws(() => A.settings.set('dateStyle', 'invalid'));
  assert.throws(() => A.settings.set('maskEmail', 'true'));
  assert.throws(() => A.settings.set('timeZone', 'invalid/zone'));
  A.settings.set('maskEmail', true);
  assert.equal(A.displayEmail(A.state.account).includes('private'), false);
  A.state.account = { id: 'two', email: 'other@example.invalid' };
  assert.equal(A.settings.get('maskEmail'), false);
});

test('export exclusions remove private data without deleting its source', async () => {
  const { A, values } = fixture();
  values.set('munetiosSearchHistory', '["private query"]'); values.set('munetiosTheme', 'light-mode'); values.set('shortcuts', '[]');
  for (const name of ['exportHistory', 'exportAppearance', 'exportShortcuts', 'exportEmail']) A.settings.set(name, false);
  const data = await A.sync.exportLocal();
  assert.equal(data.account, null);
  for (const id of ['ls:search-history', 'ls:appearance', 'ls:shortcuts']) assert.equal(id in data.data, false);
  assert.equal(values.get('munetiosSearchHistory'), '["private query"]');
});

test('disabled sync categories avoid network transfers and resume when reenabled', async () => {
  const { A, requests } = fixture();
  for (const name of ['syncHistory', 'syncAppearance', 'syncSearchSettings', 'syncShortcuts', 'syncWorkspaces', 'syncDocuments']) A.settings.set(name, false);
  assert.equal(await A.sync.now(), true);
  assert.equal(requests.some(url => url.includes('/items')), false);
  A.settings.set('syncHistory', true); requests.length = 0;
  await A.sync.now();
  assert.equal(requests.filter(url => url.includes('/items')).length, 1);
  assert.match(requests.find(url => url.includes('/items')), /prefix=ls%3Asearch-history/);
});

test('automatic sync obeys reconnect, background, data saver, and interval settings', async () => {
  const f = fixture(), { A, window, document, navigator, requests } = f;
  A.settings.set('syncOnReconnect', false); window.dispatchEvent(new Event('online')); await f.drain();
  assert.equal(requests.length, 0);
  A.settings.set('syncOnReconnect', true); window.dispatchEvent(new Event('online')); await f.drain();
  assert.ok(requests.length > 0); requests.length = 0;
  document.visibilityState = 'hidden'; A.sync.schedule(); await f.drain(); assert.equal(requests.length, 0);
  A.settings.set('syncInBackground', true); A.sync.schedule(); await f.drain(); assert.ok(requests.length > 0); requests.length = 0;
  navigator.connection.saveData = true; A.sync.schedule(); await f.drain(); assert.equal(requests.length, 0);
  A.settings.set('syncOnDataSaver', true); A.sync.schedule(); await f.drain(); assert.ok(requests.length > 0); requests.length = 0;
  A.settings.set('syncInterval', '60000'); await f.advance(59000); assert.equal(requests.length, 0);
  await f.advance(1000); assert.ok(requests.length > 0);
});

test('an unchanged account syncs with one request, and a rate limit pauses sync until Retry-After', async () => {
  let limited = false;
  const f = fixture({ respond: url => (limited && url.includes('/sync/state') ? { __status: 429, error: 'rateLimited', retryAfter: 120 } : undefined) });
  const { A, requests } = f;
  assert.equal(await A.sync.now(), true);
  assert.ok(requests.filter(url => url.includes('/items')).length > 1, 'the first sync pulls every provider');
  requests.length = 0;
  assert.equal(await A.sync.now(), true);
  assert.deepEqual(requests.map(url => url.replace(/\?.*$/, '')), ['/api/auth/sync/state'], 'nothing changed: one request, no pulls, no storage check');
  limited = true; requests.length = 0;
  assert.equal(await A.sync.now(), false);
  assert.notEqual(A.state.status, 'error', 'a rate limit is not shown as a sync failure');
  requests.length = 0;
  await f.advance(60000);
  assert.equal(requests.length, 0, 'automatic sync waits for Retry-After');
});
