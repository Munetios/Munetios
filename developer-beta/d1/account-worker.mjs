import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { httpServerHandler } from 'cloudflare:node';
import { DurableObject } from 'cloudflare:workers';
import express from 'express';
import authModule from '../../auth/router.js';
import d1Module from '../../auth/d1.js';
import webFilterModule from '../../webfilter-api/router.js';
import youtubeModule from '../../youtube/router.js';
import faviconModule from '../../favicon-proxy.js';
import collabModule from '../../collab/router.js';
import { createWebFilterDurableStore } from './webfilter-storage.mjs';
import { createCollabDirectory, createCollabStore } from './collab-storage.mjs';
import accountPage from '../../account/index.html';
import mailPage from '../../mail/index.html';
import webFilterPage from '../../webfilter/index.html';

const handlers = new WeakMap();
const collabId = /^[A-Za-z0-9_-]{22}$/;
const collabObjectPrefix = 'collab:';
const collabError = (status, error) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

async function routeCollaboration(request, pathname, env) {
    const path = pathname.replace(/\/$/, '');
    if (/^\/api\/collab\/documents$/i.test(path) && request.method === 'POST') {
        return env.WEBFILTER.getByName(collabObjectPrefix + randomBytes(16).toString('base64url')).fetch(request);
    }
    if (/^\/api\/collab\/reports$/i.test(path) && request.method === 'POST') {
        if (!request.body) return collabError(400, 'invalidRequest');
        const reader = request.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        let text = '';
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 64 * 1024) {
                    await reader.cancel();
                    return collabError(400, 'invalidRequest');
                }
                text += decoder.decode(value, { stream: true });
            }
            text += decoder.decode();
            const { documentId } = JSON.parse(text);
            if (typeof documentId !== 'string' || !collabId.test(documentId)) return collabError(400, 'invalidRequest');
            return env.WEBFILTER.getByName(collabObjectPrefix + documentId).fetch(new Request(request, { body: text }));
        } catch {
            return collabError(400, 'invalidRequest');
        }
    }
    const id = /^\/api\/collab\/documents\/([^/]+)(?:\/|$)/i.exec(path)?.[1];
    return id && collabId.test(id) ? env.WEBFILTER.getByName(collabObjectPrefix + id).fetch(request) : collabError(404, 'notFound');
}

function createAuth(env) {
    return authModule.createAuthRouter({
        env: { ...env, NODE_ENV: 'production', AUTH_AUTO_MIGRATE: 'false' },
        database: d1Module.createD1AuthDatabase(env.ACCOUNTS_DB),
    });
}

function accountHandler(env) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    const auth = createAuth(env);
    app.use('/api/youtube', youtubeModule.createYouTubeRouter({ env }));
    app.get('/api/favicon', faviconModule.createFaviconRoute({ lookup, sharePending: false }));
    app.post('/api/mail/inbound', express.json({ limit: '2mb' }), auth.mailInbound);
    app.use('/api/auth', auth);
    app.get('/api/collab/shared', collabModule.sharedDirectoryHandler(createCollabDirectory(env.ACCOUNTS_DB), auth.optionalAccount));
    for (const [page, html] of [['account', accountPage], ['mail', mailPage], ['webfilter', webFilterPage]]) {
        const canonical = '/' + page + '/';
        app.get(['/' + page, canonical, canonical + 'index.html'], auth.requireBrowserPage(canonical), (req, res) => {
            if (req.path === '/' + page) return res.redirect(canonical + req.originalUrl.slice(req.path.length));
            res.set('Cache-Control', 'no-store').type('html').send(html);
        });
    }
    return httpServerHandler(createServer(app));
}

export class MunetiosWebFilterStorage extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        const app = express();
        app.disable('x-powered-by');
        app.set('trust proxy', 1);
        const auth = createAuth(env);
        if (ctx.id.name?.startsWith(collabObjectPrefix)) {
            const id = ctx.id.name.slice(collabObjectPrefix.length);
            app.use('/api/collab', collabModule.createCollabRouter({
                store: createCollabStore(ctx.storage, env.ACCOUNTS_DB, id),
                allocateDocumentId: () => id,
                resolveAccount: auth.optionalAccount,
                lookupAccountByEmail: auth.lookupAccountByEmail,
                env,
            }));
        } else {
            app.use('/api/webfilter', webFilterModule.createWebFilterRouter({
                store: createWebFilterDurableStore(ctx.storage),
                requireDashboardSession: auth.requireBrowserSession,
                lookupAccountByEmail: auth.lookupAccountByEmail,
                publicOrigin: env.PUBLIC_ORIGIN,
            }));
        }
        this.handler = httpServerHandler(createServer(app));
    }

    fetch(request) {
        return this.handler.fetch(request, this.env, this.ctx);
    }
}

export default {
    fetch(request, env, ctx) {
        const url = new URL(request.url);
        const headers = new Headers(request.headers);
        const ip = headers.get('CF-Connecting-IP');
        headers.delete('Forwarded');
        headers.delete('X-Forwarded-For');
        headers.delete('X-Forwarded-Host');
        headers.set('Host', url.host);
        if (isIP(ip || '')) headers.set('X-Forwarded-For', ip);
        headers.set('X-Forwarded-Proto', url.protocol.slice(0, -1));
        const sanitized = new Request(request, { headers });
        if (/^\/api\/webfilter(?:\/|$)/i.test(url.pathname)) {
            return env.WEBFILTER.getByName('beta').fetch(sanitized);
        }
        if (/^\/api\/collab(?:\/|$)/i.test(url.pathname) && !/^\/api\/collab\/shared\/?$/i.test(url.pathname)) {
            return routeCollaboration(sanitized, url.pathname, env);
        }
        let handler = handlers.get(env.ACCOUNTS_DB);
        if (!handler) {
            handler = accountHandler(env);
            handlers.set(env.ACCOUNTS_DB, handler);
        }
        return handler.fetch(sanitized, env, ctx);
    },
};
