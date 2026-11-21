# Munetios developer beta

The `munetios` Worker serves the beta frontend on `beta.munetios.com`. Account and API requests go through a service binding to the D1 backend Worker. WebFilter workspaces and extension packages use Durable Object storage. The asset build contains browser files only.

## Build

```powershell
$config = node developer-beta/build.cjs
npx wrangler deploy --dry-run --config $config
```

The build stages its output in a new temporary directory. It uses FFmpeg to encode the beta copy of the music track to fit the Workers asset limit.

## Deploy the backend

Use the [D1 deployment guide](d1/README.md) to initialize or migrate the account database. Keep the backend's `AUTH_SECURITY_KEY` stable and share `MAIL_BRIDGE_SECRET` only with the Mail Worker.

Deploy and verify the backend before deploying new frontend versions. The Cloudflare login needs permission to manage Worker scripts and D1. Use the existing custom domain when promoting the beta Worker version.

```powershell
npx wrangler deploy --keep-vars --config $config
```
