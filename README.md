# Munetios

This repository contains the Munetios Search, Munetios Accounts, OmniWrite and Sheets, Munetios Calendar, Munetios Photos, Munetios Mail, SuperVidPlayer, Ganetios Weather, WebFilter, and the shared Munetios UI v4 components. The local server uses Express and serves the browser apps and their API routes from one origin.

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
| `/` | Munetios Search |
| `/signin/` and `/account/` | Munetios sign-in and account settings |
| `/omniwrite/` and `/omniwrite/sheets/` | OmniWrite editor and Sheets |
| `/calendar/` | Munetios Calendar |
| `/photos/` | Munetios Photos |
| `/mail/` | Munetios Mail |
| `/weather/` | Ganetios Weather |
| `/apps/supervidplayer` | SuperVidPlayer |
| `/webfilter/` | Munetios WebFilter dashboard |
| `/tasks/` | Munetios Tasks (accounts and end-to-end encrypted sync) |
| `/supanotes/` | Munetios SupaNotes (accounts and end-to-end encrypted sync) |
| `/meals/` | Munetios Meals (accounts and end-to-end encrypted sync) |
| `/maps/` | Munetios Maps (accounts, end-to-end encrypted sync, self-hosted satellite imagery, and live traffic) |
| `/munetios-ui/` | Munetios UI v4 component previews |

## Configure account-backed features

Create an empty local MySQL database and a dedicated database user. Set the connection variables described in the [Accounts guide](auth/README.md) before starting the server. Express loads variables from the process environment or a local `.env` file. The SQL files in this repository define schemas and migrations for fresh databases.

- [SuperVidPlayer setup and storage](apps/supervidplayer/README.md)
- [Collaboration storage and setup](collab/README.md)
- [Munetios Cloud for Calendar and Photos](cloud/README.md)
- [WebFilter API](webfilter-api/README.md)
- [Mail Worker](mail-worker/README.md)
- [Cloudflare developer beta](developer-beta/README.md) and [D1 backend](developer-beta/d1/README.md)

## Munetios Maps server

The Maps server (`maps-server/router.js`, mounted at `/api/maps`) serves satellite imagery and live traffic from this machine.

- **Satellite tiles** come from `maps-server/tiles/<layer>/<z>/<x>/<y>.<ext>`. Put your own imagery there to serve it. A tile that isn't there yet is downloaded once from an open-data source and saved: Sentinel-2 cloudless 2016 (CC BY 4.0, up to zoom 14), NASA Blue Marble, and NASA Black Marble city lights (public domain, up to zoom 8). The app draws the night side for the current time.
- **Live traffic** is built from anonymous speed reports that people choose to share while navigating. Reports carry no account, device, or trip identifier, skip the first and last 500 m of every trip, and are kept for 15 minutes. Only each road cell's long-run free-flow speed is saved, in `maps-server/data/`.

| Variable | Effect |
| --- | --- |
| `MAPS_TILE_DIR` | Folder for imagery tiles (default `maps-server/tiles`) |
| `MAPS_TILES_OFFLINE=1` | Serve only tiles already on disk; never download |
| `MAPS_DAY_UPSTREAM`, `MAPS_NIGHT_UPSTREAM` | Comma-separated `https://…/{z}/{x}/{y}` sources to fill missing tiles |
| `MAPS_DAY_MAXZOOM`, `MAPS_NIGHT_MAXZOOM` | Highest zoom your imagery provides |
| `MAPS_TRAFFIC_MIN_REPORTS` | Reports needed before a road cell is shown (default 2) |

The Moon view uses NASA LRO imagery (public domain), stored in `maps/moon/`.

## Checks

```sh
npm run test:account
npm run test:auth
npm run test:cloud
npm run test:collab
npm run test:webfilter
npm run test:youtube
npm run i18n:validate
```

## License

Munetios source code is licensed under the [Apache License, Version 2.0](LICENSE).

[Munetios UI v4 Font](fonts/google-sans-flex/munetios-ui-v4-font.ttf) is the default UI font. It uses a single-story `a` by default and switches to double-story with `ss02`. The original [Google Sans Flex](fonts/google-sans-flex/googlesansflex.ttf) is available in font pickers with `ss01` off by default. Both fonts use the [SIL Open Font License 1.1](fonts/google-sans-flex/OFL.txt). The [English spellcheck dictionary](omniwrite/spellcheck-license.txt) retains its own license.
