# Munetios

This repository contains the Ganetios start page, Munetios Accounts, OmniWrite and Sheets, Munetios Mail, WebFilter, and the shared Munetios UI v4 components. The local server uses Express and serves the browser apps and their API routes from one origin.

## Run locally

Use Node.js 18 or newer, npm, and Git LFS. Git LFS stores the background audio asset. After cloning, run the following commands from the repository root:

```sh
git lfs pull
npm ci
npm start
```

Open [http://localhost:3000](http://localhost:3000). The server listens on loopback by default. Set `PORT` to use a different port.

| Path | App |
| --- | --- |
| `/` | Ganetios start page |
| `/signin/` and `/account/` | Munetios sign-in and account settings |
| `/omniwrite/` and `/omniwrite/sheets/` | OmniWrite editor and Sheets |
| `/mail/` | Munetios Mail |
| `/webfilter/` | Munetios WebFilter dashboard |
| `/munetios-ui/` | Munetios UI v4 component previews |

## Configure account-backed features

Create an empty local MySQL database and a dedicated database user. Set the connection variables described in the [Accounts guide](auth/README.md) before starting the server. Express loads variables from the process environment or a local `.env` file. The SQL files in this repository define schemas and migrations for fresh databases.

- [Collaboration storage and setup](collab/README.md)
- [WebFilter API](webfilter-api/README.md)
- [Mail Worker](mail-worker/README.md)
- [Cloudflare developer beta](developer-beta/README.md) and [D1 backend](developer-beta/d1/README.md)

## Checks

```sh
npm run test:account
npm run test:auth
npm run test:collab
npm run test:webfilter
npm run test:youtube
npm run i18n:validate
```

## License

Munetios source code is licensed under the [Apache License, Version 2.0](LICENSE).

[Munetios Sans](fonts/google-sans-flex/googlesansflex-ss01.ttf) is the modified Google Sans Flex font with the single-story `a` (SS01) enabled by default. Munetios Sans and the original Google Sans Flex are distributed under the [SIL Open Font License 1.1](fonts/google-sans-flex/OFL.txt), which includes the upstream copyright notice. The [English spellcheck dictionary](omniwrite/spellcheck-license.txt) retains its own license.
