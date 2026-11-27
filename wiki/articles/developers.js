(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { note, faq, table, link } = W.helpers;
  W.register({
    slug: "developers",
    title: "Running Munetios (developer guide)",
    short: "Developer guide",
    logo: "images/logos/munetios.png",
    category: "developers",
    tagline: "Run every Munetios app locally, configure accounts and storage, and deploy the developer beta.",
    url: "/munetios-ui/",
    updated: "2026-11-27",
    shots: [
      { src: "munetios-ui-desktop.jpg", caption: "The Munetios UI v4 preview page, served by the local server." },
    ],
    facts: {
      developer: "Munetios",
      type: "Developer documentation",
      platforms: "Node.js 18 or newer (Mail API needs Node.js 24)",
      storage: "MySQL (accounts), disk (media), SQLite (local Mail)",
      license: "Apache License 2.0",
    },
    related: ["munetios-ui", "accounts", "privacy", "cloud"],
    sections: [
      {
        id: "run", title: "Run locally", icon: "terminal",
        html: `
<p>Use Node.js 18 or newer, npm, and Git LFS (it stores the background audio). From the repository root:</p>
<pre><code>git lfs pull
npm ci
npm start</code></pre>
<p>Open <code>http://localhost:3000</code>. The server listens on loopback by default; set <code>PORT</code> to use another port. One Express server serves every browser app and its API routes from one origin.</p>`,
      },
      {
        id: "paths", title: "App paths", icon: "route",
        html: table(["Path", "App"], [
          ["<code>/</code>", link("search", "Munetios Search")], ["<code>/signin/</code>, <code>/account/</code>", link("accounts", "Sign-in and account settings")],
          ["<code>/omniwrite/</code>, <code>/omniwrite/sheets/</code>", link("omniwrite", "OmniWrite") + " and " + link("sheets", "Sheets")], ["<code>/calendar/</code>", link("calendar", "Calendar")],
          ["<code>/photos/</code>", link("photos", "Photos")], ["<code>/mail/</code>", link("mail", "Mail")], ["<code>/webfilter/</code>", link("webfilter", "WebFilter")],
          ["<code>/tasks/</code>", link("tasks", "Tasks")], ["<code>/supanotes/</code>", link("supanotes", "SupaNotes")], ["<code>/meals/</code>", link("meals", "Meals")],
          ["<code>/maps/</code>", link("maps", "Maps")],["<code>/munetios-ui/</code>", link("munetios-ui", "Munetios UI v4")], ["<code>/wiki/</code>", "This wiki"],
        ]),
      },
      {
        id: "accounts", title: "Accounts and database", icon: "database",
        html: `
<p>Account-backed features need an empty MySQL database and a dedicated database user (never root). Set the connection variables in the environment or a local <code>.env</code> file. Tables are created on the first account request, unless <code>AUTH_AUTO_MIGRATE=false</code>, in which case you apply <code>schema.sql</code> files yourself and grant SELECT, INSERT, UPDATE, and DELETE.</p>
${table(["Variable", "Purpose"], [
  ["<code>PUBLIC_ORIGIN</code>", "The exact public origin behind a reverse proxy"], ["<code>TRUST_PROXY</code>", "Only your proxy's address or CIDR, so rate limits see real visitors"],
  ["<code>NODE_ENV=production</code>", "Secure cookies"], ["<code>MYSQL_SSL=true</code>", "Verified TLS to MySQL (with <code>MYSQL_SSL_CA_FILE</code> for a private CA)"],
  ["<code>CLOUD_DATA_DIR</code>, <code>CLOUD_STORAGE_QUOTA</code>", "Munetios Cloud chunk storage and per-account limit"],
  ["<code>SYNC_RATE_LIMIT</code>, <code>SYNC_RATE_WINDOW_MS</code>", "Sync request budget"],
  ["<code>WEBFILTER_DATA_FILE</code>", "WebFilter store location"],
  ["<code>MAPS_TILE_DIR</code>, <code>MAPS_TILES_OFFLINE</code>", "Satellite tiles folder and offline-only mode"],
])}
${note("Deploy over HTTPS", "Mutating account requests require JSON and a same-origin Origin header. Serve the account pages over HTTPS in production.", "warning")}`,
      },
      {
        id: "mail", title: "Munetios Mail", icon: "mail",
        html: `<p>Mail is a standalone Cloudflare Worker (Email Sending outbound, Email Routing inbound) that talks to the app over HTTPS with a shared <code>MAIL_BRIDGE_SECRET</code>. Locally, the same Mail API code runs with SQLite and file storage in <code>.local-mail/</code>; it needs <code>npm ci --prefix mail-worker</code> and Node.js 24 (for SQLite full-text search).</p>`,
      },
      {
        id: "beta", title: "Developer beta", icon: "rocket_launch",
        html: `
<p>The <code>munetios</code> Worker serves the beta frontend on beta.munetios.com. Account and API requests go to a D1 backend Worker through a service binding; WebFilter workspaces and shared OmniWrite files use Durable Objects. Build the assets with:</p>
<pre><code>$config = node developer-beta/build.cjs
npx wrangler deploy --dry-run --config $config</code></pre>
<p>Deploy and verify the backend before the frontend, and keep <code>AUTH_SECURITY_KEY</code> stable.</p>`,
      },
      {
        id: "checks", title: "Checks", icon: "checklist",
        html: `<pre><code>npm run test:account
npm run test:auth
npm run test:cloud
npm run test:collab
npm run test:webfilter
npm run test:youtube
npm run i18n:validate</code></pre>`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Why does Mail say it's unavailable locally?", "Install the Mail Worker dependencies with npm ci --prefix mail-worker and run Node.js 24 or newer."],
          ["Where do I add new UI components?", `In Munetios UI v4. See ${link("munetios-ui", "Munetios UI v4")}.`],
        ]),
      },
    ],
  });
})();
