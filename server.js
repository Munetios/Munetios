"use strict";
require('dotenv').config({ quiet: true });

/*
 * Ganetios local server
 *  - Serves index.html and its assets on http://localhost:3000
 *  - GET /api/favicon?domain=example.com fetches a site's favicon server-side,
 *    so the visitor's browser never contacts the site (or any third-party
 *    favicon service) just to draw an icon.
 *
 * Privacy: no request logging, no cookies, no referrer and a generic
 * User-Agent are sent upstream. Only the icon bytes are cached, in memory.
 */

const path = require("path");
const dns = require("dns").promises;
const net = require("net");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const HOSTS = process.env.HOST ? [process.env.HOST] : ["127.0.0.1", "::1"];
const ROOT = __dirname;

const app = express();
app.disable("x-powered-by");
if (process.env.BETA_ORIGIN_TOKEN) {
  const { secureEqual } = require('./auth/mail');
  const origin = new URL(process.env.PUBLIC_ORIGIN);
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    if (!secureEqual(req.get('x-beta-origin-token'), process.env.BETA_ORIGIN_TOKEN)) {
      return res.set('Cache-Control', 'no-store').status(404).end();
    }
    const clientIp = req.get('x-beta-client-ip');
    if (net.isIP(clientIp || '')) req.headers['x-forwarded-for'] = clientIp;
    else delete req.headers['x-forwarded-for'];
    req.headers['x-forwarded-proto'] = 'https';
    req.headers.host = origin.host;
    next();
  });
}
app.use('/api/youtube', require('./youtube/router').createYouTubeRouter());
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
const authEnv = { ...process.env };
if (!authEnv.GOOGLE_CLIENT_URL && !authEnv.PUBLIC_ORIGIN && HOSTS.every(host => host === '127.0.0.1' || host === '::1' || host === 'localhost')) {
  const hostname = HOSTS.length === 1 && HOSTS[0] === '127.0.0.1' ? '127.0.0.1' : 'localhost';
  authEnv.GOOGLE_CLIENT_URL = `http://${hostname}:${PORT}/api/auth/google/callback`;
}
const superVidPlayer = require('./supervidplayer-server');
const auth = require('./auth/router').createAuthRouter({
  env: authEnv,
  onBrowserSessionChange: superVidPlayer.clearOfflineAccess,
});
const requireWebFilterPage = auth.requireBrowserPage("/webfilter/");
const requireMailPage = auth.requireBrowserPage("/mail/");
app.post('/api/mail/inbound', express.json({ limit: '2mb' }), auth.mailInbound);
app.use('/api/auth', auth);
superVidPlayer.install(app, auth, authEnv);

// Munetios Mail API: the same code the Mail Worker runs, with local SQLite and file storage in .local-mail/.
const localMail = import('./mail-worker/src/local/express.js')
  .then(module => module.createLocalMail({ auth, env: authEnv }))
  .catch(error => {
    console.error('Munetios Mail API is unavailable. Run "npm ci --prefix mail-worker" (Node.js 22.5+ is required).', error.code || error.name);
    return null;
  });
app.use('/api/mail/v1', async (req, res, next) => {
  const handler = await localMail;
  if (!handler) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'unavailable' });
  return handler(req, res, next);
});
app.use('/api/webfilter', require('./webfilter-api/router').createWebFilterRouter({
  dataFile: process.env.WEBFILTER_DATA_FILE || path.join(__dirname, 'webfilter-api', 'data', 'store.json'),
  requireDashboardSession: auth.requireBrowserSession,
  lookupAccountByEmail: auth.lookupAccountByEmail,
}));

// Real-time collaboration for OmniWrite documents and spreadsheets (end-to-end encrypted content).
app.use('/api/collab', require('./collab/router').createCollabRouter({
  store: require('./collab/store').createMysqlStore({ database: auth.database, env: authEnv }),
  resolveAccount: auth.optionalAccount,
  lookupAccountByEmail: auth.lookupAccountByEmail,
  env: authEnv,
}));

// Munetios Cloud for Calendar and Photos: shared calendars and albums, chunked media uploads, time zones, and holidays.
app.use('/api/cloud', require('./cloud/router').createCloudRouter({
  store: require('./cloud/store').createMysqlStore({ database: auth.database, env: authEnv }),
  resolveAccount: auth.optionalAccount,
  lookupAccountByEmail: auth.lookupAccountByEmail,
  env: authEnv,
  rateLimit: auth.syncRateLimit,
}));

// Munetios Maps: self-hosted satellite tiles and live traffic from anonymous, opt-in speed reports.
app.use('/api/maps', require('./maps-server/router').createMapsRouter());

app.get('/api/favicon',require('./favicon-proxy').createFaviconRoute({ lookup: dns.lookup }));

const weatherApi = import('./developer-beta/weather-api.mjs').then(api => ({
  response: api.weatherResponse,
  take: api.createLocalWeatherLimit(),
}));
app.use('/api/weather', async (req, res) => {
  const { response, take } = await weatherApi;
  const url = new URL(req.originalUrl, 'http://localhost');
  const result = await response(url, req.method, () => take(req.ip));
  res.set(Object.fromEntries(result.headers)).status(result.status).send(Buffer.from(await result.arrayBuffer()));
});

// Keep server-side files out of the static site.
const PRIVATE_PATHS = /^\/(server\.js|favicon-proxy\.js|package(-lock)?\.json|claude\.md|(?:auth|cloud|collab|youtube|supervidplayer-server|webfilter-api|mail-worker|developer-beta|maps-server)(\/|$)|node_modules(\/|$)|\.)/i;
app.use((req, res, next) => {
  try {
    const pathname = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, "/"));
    if (PRIVATE_PATHS.test(pathname)) return res.status(404).type("text/plain").send("Not found");
  } catch {
    return res.sendStatus(400);
  }
  next();
});

app.get(["/signin", "/signin/"], (req, res) => res.sendFile(path.join(ROOT, "signin", "index.html")));
// Munetios WebFilter block page: the extension sends blocked tabs here. The console is served statically at /webfilter/.
app.get(["/blocked", "/blocked/"], (req, res) => res.set("Cache-Control", "no-store").sendFile(path.join(ROOT, "blocked", "index.html")));

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  let pathname;
  try {
    pathname = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, "/")).toLowerCase();
  } catch {
    return next();
  }
  const appPage = pathname.match(/^\/(webfilter|mail)(?:\/index\.html|\/)?$/)?.[1];
  if (!appPage) return next();
  const canonical = "/" + appPage + "/";
  const requirePage = appPage === "mail" ? requireMailPage : requireWebFilterPage;
  return requirePage(req, res, () => {
    if (req.path !== canonical && req.path !== canonical + "index.html") {
      return res.redirect(canonical + req.originalUrl.slice(req.path.length));
    }
    return res.sendFile(path.join(ROOT, appPage, "index.html"), { cacheControl: false, lastModified: false });
  });
});

app.get("/omniwrite/overview", (req, res) => res.sendFile(path.join(ROOT, "omniwrite", "overview.html")));
app.get(require("./photos/routes.js").pathPattern, (req, res) => res.sendFile(path.join(ROOT, "photos", "index.html")));
app.use(express.static(ROOT, { dotfiles: "ignore", index: "index.html" }));

app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));

app.get(/^(?!\/api(?:\/|$))/i, (req, res, next) => {
  if (!req.accepts("html") || ![undefined, "document", "iframe"].includes(req.get("Sec-Fetch-Dest"))) return next();
  res.status(404).set("Cache-Control", "no-store, no-transform").sendFile(path.join(ROOT, "404.html"), { lastModified: false });
});

// Listen on both loopback addresses so http://localhost:3000 works whether the
// browser resolves "localhost" to IPv4 or IPv6. Set HOST to expose it elsewhere.
HOSTS.forEach((host, index) => {
  const server = app.listen(PORT, host, () => {
    if (index === 0) console.log("Ganetios is running at http://localhost:" + PORT);
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error("Port " + PORT + " is already in use on " + host + ". Stop the other server or set PORT.");
      process.exit(1);
    }
    // A machine without IPv6 simply skips the ::1 listener.
    if (index > 0 && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) return;
    throw error;
  });
});
