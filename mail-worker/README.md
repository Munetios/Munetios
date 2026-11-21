# Munetios Mail Worker

This standalone Worker uses Cloudflare Email Sending for outbound mail and Cloudflare Email Routing for inbound SMTP. It connects to the existing Munetios app over HTTPS. The site and Worker deploy independently.

## Worker setup

- Onboard the sending domain in Cloudflare Email Service. The default verification sender is `verify@munetios.com`.
- Configure `MAIL_BRIDGE_SECRET` on both the Worker and the Express app with the same randomly generated secret. Set the Worker's `MAIL_APP_ORIGIN` to the app's public HTTPS origin.
- Set the app's `MAIL_WORKER_URL` to the Worker URL and apply `auth/schema.sql` if automatic migration is disabled.
- Route the intended Munetios mailbox addresses to this Worker through Cloudflare Email Routing. Review the domain's existing mail records and routing rules before changing inbound delivery.

Use the Worker directory for dependency installation and testing.

```powershell
npm ci --prefix mail-worker
npm test --prefix mail-worker
```

After authenticating Wrangler, deploy just the mail Worker with its own configuration.

```powershell
npx wrangler secret put MAIL_BRIDGE_SECRET --config mail-worker/wrangler.toml
npx wrangler secret put MAIL_APP_ORIGIN --config mail-worker/wrangler.toml
npx wrangler deploy --config mail-worker/wrangler.toml
```

## Account enrollment

New external accounts must enter a single-use email code. Codes expire in 10 minutes and email delivery fails closed if the Worker is unavailable. Existing accounts retain their sign-in flow.

Anyone can register an available `@munetios.com` address directly as a personal account. System mailboxes and existing accounts cannot be claimed. Put additional addresses managed outside this app in the Express environment variable `MUNETIOS_RESERVED_MAILBOXES` as a comma-separated list before enabling public registration. WebFilter roles are assigned separately in its workspaces.

New `@munetios.com` personal accounts get their mailbox when they register. Existing `@munetios.com` accounts can be provisioned by an operator after confirming address ownership. Insert their account ID into `munetios_mailboxes`.

**Incomplete** Mail at `/mail/` provides a plain-text Inbox, Sent folder, and Compose. The app stores messages for the provisioned account in MySQL.
