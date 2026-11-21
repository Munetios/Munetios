# Real-time collaboration

Collaboration for OmniWrite documents and spreadsheets. The local server and beta Worker mount it at `/api/collab` and use the account database and sessions from `auth/`. Beta stores each shared file in its own SQLite-backed Durable Object, with D1 used for accounts and profiles.

## Privacy
The browser encrypts shared content with AES-GCM, and existing URLs keep the key in the `#fragment` (`/omniwrite/#/shared/{id}/{key}`). When an owner saves **Anyone with the link**, the owner also supplies the file key to the server so Munetios can read its contents. The server removes its stored copy of the key when the owner switches back to **Restricted**. Switching back cannot undo previous access or copies. Existing link-shared files keep working. To give the server access to an existing file, the owner can save its link access settings again.

## Access
- Sharing needs a Munetios account. Only the owner can add people, change roles, change general access, or stop sharing.
- Roles: **Editor** (`edit`), **Suggest** (`suggest`), **View only** (`view`).
- General access: **Restricted** (only people added by email) or **Anyone with the link**, with the owner's choice of role. Signed-out visitors with the link can view only.
- Locked documents and spreadsheets cannot collaborate. While a file is locked, only its owner can reach it (to unlock it), and content updates are refused.

## Live updates
Server-Sent Events (`GET /documents/:id/events`) carry content, presence, role, and settings changes. Concurrent edits are merged in the browser (`omniwrite/collab.js`). Documents merge by block and then by character. Spreadsheets merge by cell. Presence is kept in memory. Beta routes every request for the same file to its Durable Object. Local deployments with multiple server processes need sticky sessions or a shared broker.

## Database
`schema.sql` creates the tables on first use, unless `AUTH_AUTO_MIGRATE=false`. In that case, apply the file manually and grant SELECT, INSERT, UPDATE, DELETE on these tables:

| Table | Contents |
|---|---|
| `munetios_collab_documents` | Owner, kind, general access, lock, version, IV |
| `munetios_collab_link_keys` | File keys provided by owners for anyone-with-the-link sharing |
| `munetios_collab_members` | People added by email and their roles |
| `munetios_collab_suggestions` | One open suggestion per person and file |
| `munetios_collab_parts` | Ciphertext in 256 KiB parts (works with a 1 MiB `max_allowed_packet`) |
| `munetios_collab_reports` | Reports for link-shared files |
| `munetios_collab_comments` | Encrypted comments and replies on shared files |
| `munetios_collab_comment_threads` | Which thread each reply belongs to, and whether a thread is resolved (a separate table, so existing installs never need ALTER) |

## Comments and live cursors
- Comments on private files stay with the file on the device. Comments on shared files are stored here, encrypted with the link key. That covers the text, the anchor (quoted text or cell), and a guest's name.
- No account is needed to comment. Owners, Editors, and Suggest can comment. Signed-out guests can comment when the link gives Suggest or Editor, though they still only view the content. Signed-in authors are verified by `account_id`. Guests keep a random token in their browser (only its hash is stored) so they can delete their own comments. Owners can delete any comment.
- Replies (`parentId`) belong to a thread, one level deep. Anyone who can comment can resolve or reopen a thread (`PATCH /documents/:id/comments/:commentId`). Replying to a resolved thread reopens it, and deleting a thread deletes its replies.
- `POST /documents/:id/cursor` relays each person's caret, selection, or selected cells to the others over the event stream. Newcomers receive the latest cursors when they connect. Cursors live in memory only.

Reports keep the file id, kind, owner, reporter account (or none if signed out), a SHA-256 hash of the reporter's IP, the reason, and the details. They also keep `review_key` when the reporter allows reviewers to open the file. Reports have no foreign keys, so they remain after a file or account is deleted. New reports have `status = 'open'`.

Comments in `schema.sql` must not contain semicolons, because the file is split on them.

## Tests
`npm run test:collab`
