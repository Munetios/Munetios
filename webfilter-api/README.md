# Munetios WebFilter API

Server side of Munetios WebFilter, mounted at `/api/webfilter` by `server.js`. The console lives at `/webfilter/` and the block page at `/blocked`.

## What it stores

`webfilter-api/data/store.json` (override with `WEBFILTER_DATA_FILE`), git-ignored:

- One org per WebFilter workspace: policy (Global rules, class rules, UserCSS lists and styles), devices, a 24-hour command history, and the published extension metadata.
- The admin key and enrollment token are stored only as SHA-256 hashes.
- Published CRX files sit next to the store as `<orgId>.crx`.

## Authentication

| Caller | Header | Can |
| --- | --- | --- |
| WebFilter dashboard | Munetios session cookie | Discover organizations and use the permissions assigned to the signed-in account |
| Extension | `X-WebFilter-Enroll: <enrollToken>` | Read policy, send heartbeats, acknowledge commands |
| Chrome / Edge updater | none | `update.xml` and `extension.crx` |

Admins add existing Munetios accounts by email in Collaborators. The server stores membership by account ID and enforces the assigned classrooms when a teacher reads policy, manages devices, or saves rules. Approved classroom edits merge into the full server policy and require the current policy revision.

Existing workspaces can be claimed once using the legacy organization key from the original browser and an authenticated Munetios account. The current server policy and devices are retained. Add former browser-only collaborators using their Munetios accounts after claiming the workspace.

## Remote commands

`lock` (optional `message`), `unlock`, `notice` (`message`), `sync`, `open_tab` (`url`, http/https only), `close_tab` (`tabId`), `temp_block` (`pattern`, `minutes` > 0), `clear_temp_blocks`.

Connected extensions wait on `GET /devices/:deviceId/command-ready` with their enrollment token. A queued command wakes the device and triggers an immediate heartbeat to receive it. The scheduled heartbeat still delivers commands when the live connection is unavailable. The dashboard waits on `GET /devices/changes` with its admin key to refresh queue, delivery, and acknowledgment status as it changes.

## Tests

```
npm run test:webfilter
```
