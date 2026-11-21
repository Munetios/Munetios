'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createYouTubeRouter } = require('./router');
async function serve(t, options) {
    const app = express(); app.use('/api/youtube', createYouTubeRouter(options));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api/youtube`;
    return (route, options) => fetch(base + route, options);
}
test('player scripts are proxied, cached, and widget paths cannot escape the allowlist', async t => {
    const calls = [];
    const request = await serve(t, { fetchUpstream: async (url, options) => {
        calls.push({ url, options });
        return new Response(url.endsWith('iframe_api') ? "var scriptUrl = 'https:\\/\\/www.youtube.com\\/s\\/player\\/abcdef12\\/www-widgetapi.vflset\\/www-widgetapi.js';" : 'window.testWidget=true;');
    } });
    const first = await request('/iframe-api');
    assert.equal(first.status, 200);
    assert.match(await first.text(), /scriptUrl = '\/api\/youtube\/widget-api\?path=/);
    await request('/iframe-api'); assert.equal(calls.length, 1);
    const widget = await request('/widget-api?path=' + encodeURIComponent('/s/player/abcdef12/www-widgetapi.vflset/www-widgetapi.js'));
    assert.equal(widget.status, 200);
    assert.equal(calls[1].url, 'https://www.youtube.com/s/player/abcdef12/www-widgetapi.vflset/www-widgetapi.js');
    for (const path of ['https://untrusted.example/script.js', '/s/player/../secret.js', '//untrusted.example/script.js', '/iframe_api']) assert.equal((await request('/widget-api?path=' + encodeURIComponent(path))).status, 400);
    assert.equal(calls.length, 2);
    assert(calls.every(call => call.options.credentials === 'omit' && call.options.redirect === 'error' && !call.options.headers?.Cookie));
});
test('metadata returns only title and author and rejects malformed IDs', async t => {
    const calls = [];
    const request = await serve(t, { fetchUpstream: async url => { calls.push(url); return Response.json({ title: 'Example', author_name: 'Author', html: '<iframe></iframe>' }); } });
    assert.equal((await request('/video/invalid')).status, 400);
    const response = await request('/video/M7lc1UVf-VE');
    assert.deepEqual(await response.json(), { title: 'Example', author: 'Author' });
    assert.match(calls[0], /^https:\/\/www.youtube.com\/oembed\?/);
});
test('captions require server authorization and the token never reaches the client', async t => {
    const missing = await serve(t, { env: {}, fetchUpstream: () => { throw new Error('must not fetch'); } });
    assert.equal((await missing('/captions/M7lc1UVf-VE')).status, 503);
    const calls = [];
    const request = await serve(t, { env: { YOUTUBE_CAPTIONS_ACCESS_TOKEN: 'test-server-token' }, fetchUpstream: async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/videos?')) return Response.json({ items: [{ status: { privacyStatus: 'public', embeddable: true } }] });
        return url.includes('?part=') ? Response.json({ items: [{ id: 'track123', snippet: { language: 'fr', status: 'serving' } }] }) : new Response('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nBonjour');
    } });
    assert.equal((await request('/captions/M7lc1UVf-VE?lang=../../bad')).status, 400);
    const response = await request('/captions/M7lc1UVf-VE?lang=fr');
    assert.equal(response.status, 200); assert.match(await response.text(), /Bonjour/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert(calls.every(call => call.url.startsWith('https://www.googleapis.com/youtube/v3/') && call.options.headers.Authorization === 'Bearer test-server-token'));
});
test('server-owned caption authorization never exposes private or unlisted video captions', async t => {
    let calls = 0;
    const request = await serve(t, { env: { YOUTUBE_CAPTIONS_ACCESS_TOKEN: 'test-server-token' }, fetchUpstream: async url => {
        calls++; assert(url.includes('/videos?'));
        return Response.json({ items: [{ status: { privacyStatus: 'private' } }] });
    } });
    assert.equal((await request('/captions/M7lc1UVf-VE')).status, 404);
    assert.equal(calls, 1);
});
test('upstream failures fail closed without exposing details or using a browser fallback', async t => {
    const request = await serve(t, { fetchUpstream: async () => { throw new Error('private upstream details'); } });
    const response = await request('/iframe-api');
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'youtubeUnavailable' });
});
