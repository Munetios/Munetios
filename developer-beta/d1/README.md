# D1 migration

This directory contains the D1 account backend and the WebFilter Durable Object. Deploy this backend with `wrangler deploy --config developer-beta/d1/wrangler.toml --keep-vars`. The public beta connects to it through the `BETA_BACKEND` service binding.

The account export preserves IDs, password hashes, Mail entries, sessions, account security settings, wrapped encryption keys, and encrypted sync records. Store the export in a private directory outside the workspace. Use the same account security key when bringing up the D1 backend.

```powershell
node developer-beta/d1/export-mysql.cjs C:/path/to/private/munetios-data.sql
```

Use an empty staging D1 database for import. Apply `0001_accounts.sql` before importing the data file, then apply `0002_atomic_writes.sql`. Run `node developer-beta/d1/verify-staging.cjs` to compare the imported account data and sync metadata to MySQL. Verify representative signed-in, inbox, and sync flows before routing public traffic.

Apply `0003_account_mail.sql` before deploying the backend with Google sign-in, password reset, and HTML mail support.
Apply `0004_email_settings.sql` before deploying verified recovery addresses and email changes.

Apply `0005_collaboration_directory.sql` before deploying the OmniWrite Shared page. D1 stores invitation metadata. Existing invitations are indexed when an owner or invited collaborator next opens the file. Restricted shares use the key in the original share link.

Create a Google OAuth Web application client with the authorized redirect URI `https://beta.munetios.com/api/auth/google/callback`. Set `GOOGLE_CLIENT_URL` to that exact redirect URI. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the backend Worker. For local testing, use `.env` and register the local callback URI separately.

The local server defaults to `http://localhost:3000/api/auth/google/callback`. Open the sign-in page using the same hostname as the registered callback so the browser can return the OAuth state cookie.

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID --config developer-beta/d1/wrangler.toml
npx wrangler secret put GOOGLE_CLIENT_SECRET --config developer-beta/d1/wrangler.toml
```

Password reset sends a code and a link to the account's external email. It leaves existing encrypted data and its key in place. The original encryption password or an already unlocked device can still open those files. Set the Mail Worker's `MAIL_APP_ORIGIN` to the same public origin used by the backend.

External accounts receive a separate Munetios forwarding address on their first Mail visit. Cloudflare Email Routing must send mail for those addresses to the Mail Worker. Users can then forward messages from their existing provider to that address.

WebFilter workspace state and published extension packages live in the `MunetiosWebFilterStorage` Durable Object. When migrating a deployment that already has WebFilter data outside MySQL, preserve organization IDs, account IDs, enrollment credentials, and CRX bytes so existing devices can continue checking in.

D1 has a 10 GB per-database limit on Workers Paid. The current D1 storage contains the encrypted sync payloads. Supporting the full 50 GB application quota for even one account requires moving those payloads to object storage.
