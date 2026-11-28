# Munetios Cloud for Calendar and Photos

The local server mounts this module at `/api/cloud`. It uses the account database and sessions from `auth/`.

## Privacy
- **Personal data** (your own events, birthdays, photo details, and albums) syncs through Munetios Account sync, which is end-to-end encrypted. The server never sees those keys.
- **Photo and video bytes** upload in chunks. The browser encrypts each chunk with AES-GCM using a per-item key. That key travels only inside the end-to-end encrypted sync data, or inside a shared album.
- **Shared calendars and shared albums** ("spaces") are encrypted in the browser. Munetios stores the space key (`space_key`) so collaborators added by email can open the space. The owner can stop sharing at any time, which deletes the space and its key from the server.

## Access
- Sharing requires a Munetios Account. Only the owner can add people, change roles, or stop sharing. Collaborators can leave.
- Roles: **Editor** (`edit`) and **Viewer** (`view`).
- In a shared album, people with `edit` can link their own uploads. Album members can download the photos linked to that album and nothing else. The owner can remove any photo, and others can remove only the photos they added.

## Uploads
1. `POST /uploads` with `{ size, chunkSize, chunkCount }` (encrypted sizes) reserves an upload and checks the storage quota.
2. `PUT /uploads/:id/chunks/:index` sends one chunk (`application/octet-stream`, up to 8 MiB). The client uses 4 MiB chunks, so large files never exceed request limits.
3. `GET /uploads/:id` lists the chunks received so far, so interrupted uploads resume where they stopped.
4. `POST /uploads/:id/complete` checks that every chunk arrived and that the total size matches.

The client retries each failed chunk with backoff and waits for the connection to return while offline. Chunk bytes are stored on disk in `CLOUD_DATA_DIR` (default `cloud/data/blobs`), and MySQL stores ownership and progress. `CLOUD_STORAGE_QUOTA` sets the per-account limit in bytes (default 50 GB).

## Calendar helpers
- `GET /calendar/timezones` returns the server's time zone list with current UTC offsets. The list is cached for 10 minutes so daylight saving changes appear quickly.
- `GET /calendar/holidays?country=US&year=2026` returns holiday dates computed on the server. `GET /calendar/holidays/countries` lists the supported countries.

## Rate limits
Updating and syncing share one budget per session: **400 requests per 10 minutes** by default. That covers account sync (`/api/auth/sync/state`, `/items`, `/batch`, `/reset`, and `/storage`) plus creating and updating shared calendars and albums. Over the limit, the server answers `429 rateLimited` with `Retry-After` and `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers. Set `SYNC_RATE_LIMIT` and `SYNC_RATE_WINDOW_MS` to change it. Counts are kept in memory, so on Cloudflare Workers the limit applies per isolate. Chunk uploads and downloads aren't counted, so large videos aren't blocked.

To stay well under the limit, each account sync starts with one `GET /sync/state` request. A device pulls only when the server's sequence number changed, and pushes only providers with local changes, so an idle sync costs one request. On a 429, sync waits for `Retry-After` and resumes on its own.

## Live updates
`GET /spaces/:id/events` (Server-Sent Events) sends `content`, `role`, `members`, `revoked`, and `deleted` events. Local deployments that run multiple server processes need sticky sessions.

## Database
`schema.sql` creates these tables on first use unless `AUTH_AUTO_MIGRATE=false`. In that case, apply the file manually.

| Table | Contents |
|---|---|
| `munetios_cloud_spaces` | Owner, kind (`calendar` or `album`), version, IV, space key |
| `munetios_cloud_members` | People added by email and their roles |
| `munetios_cloud_parts` | Space ciphertext in 256 KiB parts |
| `munetios_cloud_blobs` | Uploaded photos and videos: owner, encrypted size, chunk layout, status |
| `munetios_cloud_blob_chunks` | Chunks received so far, for resumable uploads |
| `munetios_cloud_space_blobs` | Photos and videos linked to shared albums |

## Tests
`npm run test:cloud`
