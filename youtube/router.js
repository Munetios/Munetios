'use strict';
const express = require('express');
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WIDGET_PATH = /^\/s\/player\/[A-Za-z0-9_-]+\/www-widgetapi(?:\.vflset)?\/[A-Za-z0-9_.-]+\.js$/;
function createYouTubeRouter({ fetchUpstream = fetch, env = process.env } = {}) {
    const router = express.Router();
    const cache = new Map();
    async function read(url, options = {}) {
        const response = await fetchUpstream(url, {
            credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(10000), ...options
        });
        if (!response.ok) throw new Error('upstream');
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('size'); }
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks).toString('utf8');
    }
    async function cached(key, action) {
        for (const [entry, value] of cache) if (value.expires < Date.now()) cache.delete(entry);
        if (cache.has(key)) return cache.get(key).text;
        const text = await action();
        cache.set(key, { text, expires: Date.now() + 3600000 });
        return text;
    }
    router.use((req, res, next) => {
        res.set({ 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer' });
        next();
    });
    router.get('/iframe-api', async (req, res) => {
        const script = await cached('iframe-api', async () => {
            const source = await read('https://www.youtube.com/iframe_api');
            const match = source.match(/var scriptUrl\s*=\s*'([^']+)'/);
            if (!match) throw new Error('script');
            const upstream = new URL(match[1].replaceAll('\\/', '/'));
            if (upstream.origin !== 'https://www.youtube.com' || !WIDGET_PATH.test(upstream.pathname)) throw new Error('script');
            return source.replace(match[0], `var scriptUrl = '/api/youtube/widget-api?path=${encodeURIComponent(upstream.pathname)}'`);
        });
        res.set('Cache-Control', 'public, max-age=3600').type('application/javascript').send(script);
    });
    router.get('/widget-api', async (req, res) => {
        if (typeof req.query.path !== 'string' || !WIDGET_PATH.test(req.query.path)) return res.status(400).json({ error: 'invalidPath' });
        const script = await cached(req.query.path, () => read(`https://www.youtube.com${req.query.path}`));
        res.set('Cache-Control', 'public, max-age=3600').type('application/javascript').send(script);
    });
    router.get('/video/:id', async (req, res) => {
        if (!VIDEO_ID.test(req.params.id)) return res.status(400).json({ error: 'invalidVideo' });
        const text = await cached(`video:${req.params.id}`, () => read(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${req.params.id}`)}&format=json`));
        const data = JSON.parse(text);
        res.set('Cache-Control', 'public, max-age=3600').json({ title: data.title, author: data.author_name });
    });
    router.get('/captions/:id', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!VIDEO_ID.test(req.params.id)) return res.status(400).json({ error: 'invalidVideo' });
        if (!env.YOUTUBE_CAPTIONS_ACCESS_TOKEN) return res.status(503).json({ error: 'captionsUnavailable' });
        const language = String(req.query.lang || 'en');
        if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) return res.status(400).json({ error: 'invalidLanguage' });
        const headers = { Authorization: `Bearer ${env.YOUTUBE_CAPTIONS_ACCESS_TOKEN}` };
        const video = JSON.parse(await read(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${req.params.id}`, { headers }));
        if (video.items?.[0]?.status?.privacyStatus !== 'public' || video.items[0].status.embeddable === false) return res.status(404).json({ error: 'captionsUnavailable' });
        const data = JSON.parse(await read(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${req.params.id}`, { headers }));
        const tracks = (data.items || []).filter(item => item.snippet?.status === 'serving' && !item.snippet?.isDraft);
        const track = tracks.find(item => item.snippet.language === language) || tracks.find(item => item.snippet.language === language.split('-')[0]) || tracks[0];
        if (!track?.id) return res.status(404).json({ error: 'captionsUnavailable' });
        res.type('text/vtt').send(await read(`https://www.googleapis.com/youtube/v3/captions/${encodeURIComponent(track.id)}?tfmt=vtt`, { headers }));
    });
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        res.set('Cache-Control', 'no-store').status(502).json({ error: 'youtubeUnavailable' });
    });
    return router;
}
module.exports = { createYouTubeRouter };
