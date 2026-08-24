import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAccountData } from "./authSecurity.js";
import { dataDirectory as resolvedDataDirectory } from "./dataDirectory.js";
import {
  getDurableRealtimeDatabase,
  saveDurableRealtimeDatabase,
} from "./durableAuthStore.js";
import {
  activityForPeer,
  advanceMeetActivityState,
  createMeetActivityState,
  finalizeMeetActivityState,
  joinMeetActivity,
  meetAnagramsDictionarySize,
  parseWordHuntCustomWords,
  updateMeetActivityState,
} from "./meetActivities.js";

const databaseDirectory = resolvedDataDirectory;
const databasePath = join(databaseDirectory, "realtime.sqlite");
const realtimeRoomLifetimeMs = 24 * 60 * 60 * 1000;
const realtimeUserKeySecret =
  process.env.MUNETIOS_REALTIME_USER_KEY_SECRET ||
  process.env.AUTH_SECRET ||
  "munetios-realtime-user-key";
// Activity, recording, and profile-status migrations each increment this so
// databases held open by Next.js hot reload receive the latest peer columns.
const realtimeSchemaVersion = 7;

function ensureRealtimeChatSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS realtime_chat_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES realtime_rooms(id) ON DELETE CASCADE,
      sender_peer_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_avatar_url TEXT,
      body TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      created_at INTEGER NOT NULL,
      edited_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS realtime_chat_reactions (
      message_id TEXT NOT NULL REFERENCES realtime_chat_messages(id) ON DELETE CASCADE,
      peer_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, peer_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS realtime_chat_room_index
      ON realtime_chat_messages (room_id, created_at);
  `);
}

function ensureRealtimeActivitySchema(database) {
  const existing = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'realtime_activities'",
    )
    .get();
  if (!existing) {
    database.exec(`
    CREATE TABLE IF NOT EXISTS realtime_activities (
      room_id TEXT PRIMARY KEY REFERENCES realtime_rooms(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL CHECK (activity_type IN ('chess', 'anagrams', 'wordhunt')),
      owner_peer_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
    return;
  }
  if (String(existing.sql || "").includes("'wordhunt'")) return;
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE realtime_activities_next (
        room_id TEXT PRIMARY KEY REFERENCES realtime_rooms(id) ON DELETE CASCADE,
        activity_type TEXT NOT NULL CHECK (activity_type IN ('chess', 'anagrams', 'wordhunt')),
        owner_peer_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO realtime_activities_next (
        room_id, activity_type, owner_peer_id, state_json, created_at, updated_at
      )
      SELECT
        room_id, activity_type, owner_peer_id, state_json, created_at, updated_at
      FROM realtime_activities;
      DROP TABLE realtime_activities;
      ALTER TABLE realtime_activities_next RENAME TO realtime_activities;
      COMMIT;
    `);
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {}
    throw error;
  }
}

function ensureRealtimePeerStateSchema(database) {
  const stateColumns = database
    .prepare("PRAGMA table_info(realtime_peer_states)")
    .all()
    .map((column) => column.name);
  if (!stateColumns.includes("recording_on")) {
    database.exec(
      "ALTER TABLE realtime_peer_states ADD COLUMN recording_on INTEGER NOT NULL DEFAULT 0;",
    );
  }
  if (!stateColumns.includes("status_emoji")) {
    database.exec(
      "ALTER TABLE realtime_peer_states ADD COLUMN status_emoji TEXT NOT NULL DEFAULT '';",
    );
  }
}

function createDatabase() {
  mkdirSync(databaseDirectory, { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS realtime_rooms (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL CHECK (service IN ('meet', 'ai-voice')),
      owner_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS realtime_peers (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES realtime_rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      token_hash TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS realtime_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL REFERENCES realtime_rooms(id) ON DELETE CASCADE,
      from_peer_id TEXT NOT NULL,
      to_peer_id TEXT,
      kind TEXT NOT NULL CHECK (
        kind IN ('peer-joined', 'peer-left', 'offer', 'answer', 'ice-candidate')
      ),
      payload TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS realtime_events_poll_index
      ON realtime_events (room_id, id);
    CREATE INDEX IF NOT EXISTS realtime_peers_room_index
      ON realtime_peers (room_id);
    CREATE TABLE IF NOT EXISTS realtime_kicks (
      peer_id TEXT PRIMARY KEY REFERENCES realtime_peers(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL,
      kicked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS realtime_peer_states (
      peer_id TEXT PRIMARY KEY REFERENCES realtime_peers(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL,
      microphone_on INTEGER NOT NULL DEFAULT 0,
      camera_on INTEGER NOT NULL DEFAULT 0,
      screen_sharing INTEGER NOT NULL DEFAULT 0,
      recording_on INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS realtime_bans (
      room_id TEXT NOT NULL REFERENCES realtime_rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      banned_by_peer_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );
  `);
  ensureRealtimeChatSchema(database);
  ensureRealtimeActivitySchema(database);
  const peerColumns = database
    .prepare("PRAGMA table_info(realtime_peers)")
    .all()
    .map((column) => column.name);
  if (!peerColumns.includes("avatar_url")) {
    database.exec("ALTER TABLE realtime_peers ADD COLUMN avatar_url TEXT;");
  }
  ensureRealtimePeerStateSchema(database);
  database
    .prepare(
      `INSERT OR IGNORE INTO realtime_peer_states
       (peer_id, room_id, microphone_on, camera_on, screen_sharing, recording_on, updated_at)
       SELECT id, room_id, 0, 0, 0, 0, last_seen_at FROM realtime_peers`,
    )
    .run();
  database
    .prepare(
      "UPDATE realtime_rooms SET expires_at = created_at + ? WHERE expires_at != created_at + ?",
    )
    .run(realtimeRoomLifetimeMs, realtimeRoomLifetimeMs);
  return database;
}

function getDatabase() {
  if (!globalThis.__munetiosRealtimeDatabase) {
    globalThis.__munetiosRealtimeDatabase = createDatabase();
    globalThis.__munetiosRealtimeSchemaVersion = realtimeSchemaVersion;
  } else if (
    globalThis.__munetiosRealtimeSchemaVersion !== realtimeSchemaVersion
  ) {
    ensureRealtimeChatSchema(globalThis.__munetiosRealtimeDatabase);
    ensureRealtimeActivitySchema(globalThis.__munetiosRealtimeDatabase);
    ensureRealtimePeerStateSchema(globalThis.__munetiosRealtimeDatabase);
    globalThis.__munetiosRealtimeSchemaVersion = realtimeSchemaVersion;
  }
  return globalThis.__munetiosRealtimeDatabase;
}

let durableHydrationPromise = null;
let durableRefreshPromise = null;

export async function hydrateRealtimeDatabase() {
  if (globalThis.__munetiosRealtimeDatabase) return;
  if (!durableHydrationPromise) {
    durableHydrationPromise = (async () => {
      mkdirSync(databaseDirectory, { recursive: true });
      const stored = await getDurableRealtimeDatabase();
      if (stored?.length) await writeFile(databasePath, stored);
    })();
  }
  await durableHydrationPromise;
}

export async function refreshRealtimeDatabaseFromDurable() {
  if (!durableRefreshPromise) {
    durableRefreshPromise = (async () => {
      const stored = await getDurableRealtimeDatabase();
      if (!stored?.length) return false;

      const database = globalThis.__munetiosRealtimeDatabase;
      if (database) {
        try {
          database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        } catch {}
        try {
          database.close();
        } catch {}
      }
      globalThis.__munetiosRealtimeDatabase = null;
      globalThis.__munetiosRealtimeSchemaVersion = null;
      await Promise.all([
        rm(`${databasePath}-shm`, { force: true }),
        rm(`${databasePath}-wal`, { force: true }),
      ]);
      await writeFile(databasePath, stored);
      durableHydrationPromise = null;
      return true;
    })().finally(() => {
      durableRefreshPromise = null;
    });
  }
  return durableRefreshPromise;
}

export async function persistRealtimeDatabase() {
  const database = globalThis.__munetiosRealtimeDatabase;
  if (!database) return false;
  database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  return saveDurableRealtimeDatabase(await readFile(databasePath));
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function publicUserKey(userId) {
  return createHmac("sha256", realtimeUserKeySecret)
    .update(String(userId))
    .digest("base64url")
    .slice(0, 40);
}

function newPeerCredentials() {
  return {
    peerId: randomUUID(),
    peerToken: randomBytes(32).toString("base64url"),
  };
}

export function createMeetRoomId() {
  return String(randomInt(10_000_000, 100_000_000));
}

function createAvailableRoomId(database, service) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roomId =
      service === "meet"
        ? createMeetRoomId()
        : randomBytes(12).toString("base64url");
    const exists = database
      .prepare("SELECT 1 FROM realtime_rooms WHERE id = ?")
      .get(roomId);
    if (!exists) return roomId;
  }
  throw new Error("unable_to_generate_room_id");
}

export function cleanRealtimeState(now = Date.now()) {
  const database = getDatabase();
  database.prepare("DELETE FROM realtime_rooms WHERE expires_at < ?").run(now);
  database
    .prepare("DELETE FROM realtime_events WHERE created_at < ?")
    .run(now - 24 * 60 * 60 * 1000);
}

export function createRealtimeRoom({
  avatarUrl = null,
  displayName,
  requestedRoomId = null,
  service,
  userId,
}) {
  const database = getDatabase();
  cleanRealtimeState();
  const now = Date.now();
  const roomId = requestedRoomId || createAvailableRoomId(database, service);
  const credentials = newPeerCredentials();
  const expiresAt = now + realtimeRoomLifetimeMs;

  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        "INSERT INTO realtime_rooms (id, service, owner_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(roomId, service, userId, now, expiresAt);
    database
      .prepare(
        "INSERT INTO realtime_peers (id, room_id, user_id, display_name, avatar_url, token_hash, joined_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        credentials.peerId,
        roomId,
        userId,
        displayName,
        avatarUrl,
        hashToken(credentials.peerToken),
        now,
        now,
      );
    database
      .prepare(
        "INSERT INTO realtime_peer_states (peer_id, room_id, microphone_on, camera_on, screen_sharing, recording_on, updated_at) VALUES (?, ?, 0, 0, 0, 0, ?)",
      )
      .run(credentials.peerId, roomId, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    ...credentials,
    avatarUrl,
    cursor: 0,
    displayName,
    expiresAt,
    owner: true,
    roomId,
    service,
  };
}

function replaceActivityPeerIds(database, roomId, oldPeerIds, nextPeerId) {
  if (!oldPeerIds.size) return;
  const activity = database
    .prepare(
      "SELECT owner_peer_id, state_json FROM realtime_activities WHERE room_id = ?",
    )
    .get(roomId);
  if (!activity) return;
  const replaceValue = (value) => {
    if (typeof value === "string" && oldPeerIds.has(value)) return nextPeerId;
    if (Array.isArray(value)) return value.map(replaceValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, replaceValue(entry)]),
      );
    }
    return value;
  };
  database
    .prepare(
      "UPDATE realtime_activities SET owner_peer_id = ?, state_json = ?, updated_at = ? WHERE room_id = ?",
    )
    .run(
      oldPeerIds.has(activity.owner_peer_id)
        ? nextPeerId
        : activity.owner_peer_id,
      JSON.stringify(replaceValue(JSON.parse(activity.state_json))),
      Date.now(),
      roomId,
    );
}

export function joinRealtimeRoom({
  avatarUrl = null,
  displayName,
  roomId,
  userId,
}) {
  const database = getDatabase();
  cleanRealtimeState();
  const room = database
    .prepare(
      "SELECT id, service, owner_user_id, expires_at FROM realtime_rooms WHERE id = ?",
    )
    .get(roomId);
  if (!room) return null;
  const banned = database
    .prepare(
      "SELECT user_id FROM realtime_bans WHERE room_id = ? AND user_id = ?",
    )
    .get(roomId, userId);
  if (banned) return { banned: true };

  const existingPeerIds = new Set(
    database
      .prepare(
        `SELECT p.id FROM realtime_peers p
         LEFT JOIN realtime_kicks k ON k.peer_id = p.id
         WHERE p.room_id = ? AND p.user_id = ? AND k.peer_id IS NULL`,
      )
      .all(roomId, userId)
      .map((peer) => peer.id),
  );
  const maximumPeers = room.service === "ai-voice" ? 2 : 16;
  const count = database
    .prepare(
      `SELECT count(*) AS total FROM realtime_peers p
       LEFT JOIN realtime_kicks k ON k.peer_id = p.id
       WHERE p.room_id = ? AND p.user_id != ? AND k.peer_id IS NULL`,
    )
    .get(roomId, userId).total;
  if (count >= maximumPeers) return { full: true };

  const now = Date.now();
  const credentials = newPeerCredentials();
  database.exec("BEGIN IMMEDIATE");
  let joinedEvent;
  try {
    database
      .prepare(
        "INSERT INTO realtime_peers (id, room_id, user_id, display_name, avatar_url, token_hash, joined_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        credentials.peerId,
        roomId,
        userId,
        displayName,
        avatarUrl,
        hashToken(credentials.peerToken),
        now,
        now,
      );
    database
      .prepare(
        "INSERT INTO realtime_peer_states (peer_id, room_id, microphone_on, camera_on, screen_sharing, recording_on, updated_at) VALUES (?, ?, 0, 0, 0, 0, ?)",
      )
      .run(credentials.peerId, roomId, now);
    replaceActivityPeerIds(
      database,
      roomId,
      existingPeerIds,
      credentials.peerId,
    );
    for (const previousPeerId of existingPeerIds) {
      database
        .prepare(
          "INSERT INTO realtime_events (room_id, from_peer_id, kind, created_at) VALUES (?, ?, 'peer-left', ?)",
        )
        .run(roomId, previousPeerId, now);
      database
        .prepare("DELETE FROM realtime_peers WHERE id = ?")
        .run(previousPeerId);
    }
    joinedEvent = database
      .prepare(
        "INSERT INTO realtime_events (room_id, from_peer_id, kind, created_at) VALUES (?, ?, 'peer-joined', ?)",
      )
      .run(roomId, credentials.peerId, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    ...credentials,
    avatarUrl,
    cursor: Number(joinedEvent.lastInsertRowid),
    displayName,
    expiresAt: room.expires_at,
    owner: room.owner_user_id === userId,
    roomId,
    service: room.service,
  };
}

export function rejoinRealtimeRoom({
  avatarUrl = null,
  displayName,
  roomId,
  userId,
}) {
  const joined = joinRealtimeRoom({
    avatarUrl,
    displayName,
    roomId,
    userId,
  });
  if (joined) return joined;
  try {
    return createRealtimeRoom({
      avatarUrl,
      displayName,
      requestedRoomId: roomId,
      service: "meet",
      userId,
    });
  } catch (error) {
    const racedJoin = joinRealtimeRoom({
      avatarUrl,
      displayName,
      roomId,
      userId,
    });
    if (racedJoin) return racedJoin;
    throw error;
  }
}

export function resumeRealtimeRoom({ peerId, peerToken, roomId, userId }) {
  const database = getDatabase();
  cleanRealtimeState();
  const peer = database
    .prepare(
      `SELECT p.id, p.display_name, p.avatar_url, p.user_id,
              r.service, r.owner_user_id, r.expires_at
       FROM realtime_peers p
       JOIN realtime_rooms r ON r.id = p.room_id
       LEFT JOIN realtime_kicks k ON k.peer_id = p.id
       WHERE p.id = ? AND p.room_id = ? AND p.token_hash = ?
         AND p.user_id = ? AND k.peer_id IS NULL AND r.expires_at > ?`,
    )
    .get(peerId, roomId, hashToken(peerToken), userId, Date.now());
  if (!peer) return null;
  const now = Date.now();
  database
    .prepare("UPDATE realtime_peers SET last_seen_at = ? WHERE id = ?")
    .run(now, peerId);
  const resumedEvent = database
    .prepare(
      "INSERT INTO realtime_events (room_id, from_peer_id, kind, payload, created_at) VALUES (?, ?, 'peer-joined', ?, ?)",
    )
    .run(roomId, peerId, JSON.stringify({ resumed: true }), now);
  return {
    avatarUrl: peer.avatar_url || null,
    cursor: Number(resumedEvent.lastInsertRowid),
    displayName: peer.display_name,
    expiresAt: peer.expires_at,
    owner: peer.owner_user_id === peer.user_id,
    peerId,
    peerToken,
    resumed: true,
    roomId,
    service: peer.service,
  };
}

export function authenticateRealtimePeer({
  peerId,
  peerToken,
  roomId,
  userId = null,
}) {
  const database = getDatabase();
  const peer = database
    .prepare(
      "SELECT id, room_id, user_id FROM realtime_peers WHERE id = ? AND room_id = ? AND token_hash = ?",
    )
    .get(peerId, roomId, hashToken(peerToken));
  return peer && (!userId || peer.user_id === userId) ? peer : null;
}

export function touchRealtimePeer(peerId) {
  const database = getDatabase();
  database
    .prepare("UPDATE realtime_peers SET last_seen_at = ? WHERE id = ?")
    .run(Date.now(), peerId);
}

export function updateRealtimePeerState({
  cameraOn,
  microphoneOn,
  peerId,
  recordingOn,
  roomId,
  screenSharing,
}) {
  const database = getDatabase();
  const result = database
    .prepare(
      `UPDATE realtime_peer_states
       SET microphone_on = ?, camera_on = ?, screen_sharing = ?, recording_on = ?, updated_at = ?
       WHERE peer_id = ? AND room_id = ?`,
    )
    .run(
      microphoneOn ? 1 : 0,
      cameraOn ? 1 : 0,
      screenSharing ? 1 : 0,
      recordingOn ? 1 : 0,
      Date.now(),
      peerId,
      roomId,
    );
  touchRealtimePeer(peerId);
  return Number(result.changes) > 0;
}

export function updateRealtimePeerStatus({ emoji, peerId, roomId }) {
  const database = getDatabase();
  const result = database
    .prepare(
      `UPDATE realtime_peer_states
       SET status_emoji = ?, updated_at = ?
       WHERE peer_id = ? AND room_id = ?`,
    )
    .run(emoji, Date.now(), peerId, roomId);
  touchRealtimePeer(peerId);
  return Number(result.changes) > 0;
}

export function publishRealtimeSignal({
  fromPeerId,
  kind,
  payload,
  roomId,
  toPeerId,
}) {
  const database = getDatabase();
  const target = database
    .prepare(
      `SELECT p.id FROM realtime_peers p
       LEFT JOIN realtime_kicks k ON k.peer_id = p.id
       WHERE p.id = ? AND p.room_id = ? AND k.peer_id IS NULL`,
    )
    .get(toPeerId, roomId);
  if (!target) return null;
  const result = database
    .prepare(
      "INSERT INTO realtime_events (room_id, from_peer_id, to_peer_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      roomId,
      fromPeerId,
      toPeerId,
      kind,
      JSON.stringify(payload),
      Date.now(),
    );
  touchRealtimePeer(fromPeerId);
  return Number(result.lastInsertRowid);
}

export function pollRealtimeEvents({ after, peerId, roomId }) {
  const database = getDatabase();
  const room = database
    .prepare("SELECT expires_at FROM realtime_rooms WHERE id = ?")
    .get(roomId);
  if (!room || room.expires_at <= Date.now()) {
    return { ended: true, events: [], peers: [] };
  }
  const kicked = database
    .prepare(
      "SELECT peer_id FROM realtime_kicks WHERE peer_id = ? AND room_id = ?",
    )
    .get(peerId, roomId);
  if (kicked) {
    database.prepare("DELETE FROM realtime_peers WHERE id = ?").run(peerId);
    return { events: [], kicked: true, peers: [] };
  }

  touchRealtimePeer(peerId);
  const events = database
    .prepare(
      `SELECT id, from_peer_id, to_peer_id, kind, payload, created_at
       FROM realtime_events
       WHERE room_id = ? AND id > ? AND from_peer_id != ?
         AND (to_peer_id IS NULL OR to_peer_id = ?)
       ORDER BY id ASC LIMIT 100`,
    )
    .all(roomId, after, peerId, peerId)
    .map((event) => ({
      createdAt: event.created_at,
      fromPeerId: event.from_peer_id,
      id: event.id,
      kind: event.kind,
      payload: event.payload ? JSON.parse(event.payload) : null,
      toPeerId: event.to_peer_id,
    }));
  const peers = database
    .prepare(
      `SELECT p.id, p.user_id, p.display_name, p.avatar_url, p.joined_at,
              COALESCE(s.microphone_on, 0) AS microphone_on,
              COALESCE(s.camera_on, 0) AS camera_on,
              COALESCE(s.screen_sharing, 0) AS screen_sharing,
              COALESCE(s.recording_on, 0) AS recording_on,
              COALESCE(s.status_emoji, '') AS status_emoji
       FROM realtime_peers p
       LEFT JOIN realtime_kicks k ON k.peer_id = p.id
       LEFT JOIN realtime_peer_states s ON s.peer_id = p.id
       WHERE p.room_id = ? AND p.id != ? AND k.peer_id IS NULL
       ORDER BY p.joined_at, p.id`,
    )
    .all(roomId, peerId)
    .map((peer) => ({
      avatarUrl: peer.avatar_url || null,
      cameraOn: Boolean(peer.camera_on),
      displayName: peer.display_name,
      joinedAt: peer.joined_at,
      microphoneOn: Boolean(peer.microphone_on),
      peerId: peer.id,
      recordingOn: Boolean(peer.recording_on),
      screenSharing: Boolean(peer.screen_sharing),
      statusEmoji: peer.status_emoji || "",
      userKey: publicUserKey(peer.user_id),
    }));
  return {
    activity: activityForPeer(getRealtimeActivity(roomId), peerId),
    chatMessages: listRealtimeChatMessages({ peerId, roomId }),
    events,
    peers,
  };
}

function activityPeer(database, peerId, roomId) {
  return database
    .prepare(
      `SELECT p.id, p.display_name
       FROM realtime_peers p
       LEFT JOIN realtime_kicks k ON k.peer_id = p.id
       WHERE p.id = ? AND p.room_id = ? AND k.peer_id IS NULL`,
    )
    .get(peerId, roomId);
}

export function getRealtimeActivity(roomId) {
  const database = getDatabase();
  const row = database
    .prepare(
      `SELECT activity_type, owner_peer_id, state_json, created_at, updated_at
       FROM realtime_activities WHERE room_id = ?`,
    )
    .get(roomId);
  if (!row) return null;
  let state = JSON.parse(row.state_json);
  if (state.type === "wordhunt" && state.customDictionaryVersion !== 1) {
    const owner = database
      .prepare(
        "SELECT user_id FROM realtime_peers WHERE id = ? AND room_id = ? LIMIT 1",
      )
      .get(row.owner_peer_id, roomId);
    const settings = owner?.user_id
      ? getAccountData(owner.user_id, "meet-settings-v1", {})
      : {};
    const customWords =
      parseWordHuntCustomWords(settings.wordHuntCustomWords || "") || [];
    state = {
      ...state,
      customDictionaryVersion: 1,
      customWords,
      dictionarySize: meetAnagramsDictionarySize + customWords.length,
    };
    database
      .prepare(
        "UPDATE realtime_activities SET state_json = ?, updated_at = ? WHERE room_id = ?",
      )
      .run(JSON.stringify(state), Date.now(), roomId);
  }
  const advancedState = advanceMeetActivityState(state);
  if (advancedState !== state) {
    state = advancedState;
    database
      .prepare(
        "UPDATE realtime_activities SET state_json = ?, updated_at = ? WHERE room_id = ?",
      )
      .run(JSON.stringify(state), Date.now(), roomId);
  }
  if (
    (state.type === "anagrams" || state.type === "wordhunt") &&
    !state.ended &&
    Number(state.endsAt) <= Date.now()
  ) {
    const finalized = finalizeMeetActivityState(state);
    database
      .prepare(
        "UPDATE realtime_activities SET state_json = ?, updated_at = ? WHERE room_id = ?",
      )
      .run(JSON.stringify(finalized), Date.now(), roomId);
    return {
      createdAt: row.created_at,
      ownerPeerId: row.owner_peer_id,
      state: finalized,
      type: row.activity_type,
      updatedAt: Date.now(),
    };
  }
  return {
    createdAt: row.created_at,
    ownerPeerId: row.owner_peer_id,
    state,
    type: row.activity_type,
    updatedAt: row.updated_at,
  };
}

export function startRealtimeActivity({
  allowOthers,
  boardSize,
  cheats,
  creatorWord,
  customBoard,
  customWords,
  durationSeconds,
  peerId,
  roomId,
  type,
}) {
  const database = getDatabase();
  const peer = activityPeer(database, peerId, roomId);
  if (!peer) return null;
  const now = Date.now();
  const state = createMeetActivityState({
    allowOthers,
    boardSize,
    cheats,
    creatorWord,
    customBoard,
    customWords,
    durationSeconds,
    ownerName: peer.display_name,
    ownerPeerId: peer.id,
    type,
  });
  database
    .prepare(
      `INSERT INTO realtime_activities (
        room_id, activity_type, owner_peer_id, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET
        activity_type = excluded.activity_type,
        owner_peer_id = excluded.owner_peer_id,
        state_json = excluded.state_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`,
    )
    .run(roomId, type, peerId, JSON.stringify(state), now, now);
  touchRealtimePeer(peerId);
  return getRealtimeActivity(roomId);
}

function updateStoredActivity(database, roomId, state) {
  const now = Date.now();
  database
    .prepare(
      "UPDATE realtime_activities SET state_json = ?, updated_at = ? WHERE room_id = ?",
    )
    .run(JSON.stringify(state), now, roomId);
  return { ...getRealtimeActivity(roomId), updatedAt: now };
}

export function joinRealtimeActivity({ peerId, roomId }) {
  const database = getDatabase();
  const peer = activityPeer(database, peerId, roomId);
  const activity = getRealtimeActivity(roomId);
  if (!peer || !activity) return { error: "activity_not_found" };
  const joined = joinMeetActivity(activity.state, peer.id, peer.display_name);
  if (joined.error) return joined;
  touchRealtimePeer(peerId);
  return { activity: updateStoredActivity(database, roomId, joined.state) };
}

export function updateRealtimeActivity({ payload, peerId, roomId }) {
  const database = getDatabase();
  const peer = activityPeer(database, peerId, roomId);
  const activity = getRealtimeActivity(roomId);
  if (!peer || !activity) return { error: "activity_not_found" };
  const updated = updateMeetActivityState(activity.state, peerId, payload);
  if (updated.error) return updated;
  touchRealtimePeer(peerId);
  return {
    activity: updateStoredActivity(database, roomId, updated.state),
    points: updated.points || 0,
  };
}

export function endRealtimeActivity({ peerId, roomId }) {
  const database = getDatabase();
  const activity = getRealtimeActivity(roomId);
  if (!activity) return { error: "activity_not_found" };
  if (activity.ownerPeerId !== peerId) {
    return { error: "activity_owner_required" };
  }
  touchRealtimePeer(peerId);
  database
    .prepare("DELETE FROM realtime_activities WHERE room_id = ?")
    .run(roomId);
  return { activity: null };
}

export function createRealtimeChatMessage({
  body = "",
  imageUrl = null,
  peerId,
  roomId,
}) {
  const database = getDatabase();
  const sender = database
    .prepare(
      `SELECT p.display_name, p.avatar_url
       FROM realtime_peers p
       LEFT JOIN realtime_kicks k ON k.peer_id = p.id
       WHERE p.id = ? AND p.room_id = ? AND k.peer_id IS NULL`,
    )
    .get(peerId, roomId);
  if (!sender) return null;
  const id = randomUUID();
  const createdAt = Date.now();
  database
    .prepare(
      `INSERT INTO realtime_chat_messages (
        id, room_id, sender_peer_id, sender_name, sender_avatar_url,
        body, image_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      roomId,
      peerId,
      sender.display_name,
      sender.avatar_url || null,
      body,
      imageUrl,
      createdAt,
    );
  touchRealtimePeer(peerId);
  return { createdAt, id };
}

export function editRealtimeChatMessage({ body, messageId, peerId, roomId }) {
  const database = getDatabase();
  const result = database
    .prepare(
      `UPDATE realtime_chat_messages
       SET body = ?, edited_at = ?
       WHERE id = ? AND room_id = ? AND sender_peer_id = ?`,
    )
    .run(body, Date.now(), messageId, roomId, peerId);
  if (Number(result.changes) > 0) touchRealtimePeer(peerId);
  return Number(result.changes) > 0;
}

export function toggleRealtimeChatReaction({
  emoji,
  messageId,
  peerId,
  roomId,
}) {
  const database = getDatabase();
  const message = database
    .prepare(
      "SELECT id FROM realtime_chat_messages WHERE id = ? AND room_id = ?",
    )
    .get(messageId, roomId);
  if (!message) return null;
  const existing = database
    .prepare(
      `SELECT 1 FROM realtime_chat_reactions
       WHERE message_id = ? AND peer_id = ? AND emoji = ?`,
    )
    .get(messageId, peerId, emoji);
  if (existing) {
    database
      .prepare(
        `DELETE FROM realtime_chat_reactions
         WHERE message_id = ? AND peer_id = ? AND emoji = ?`,
      )
      .run(messageId, peerId, emoji);
  } else {
    database
      .prepare(
        `INSERT INTO realtime_chat_reactions
         (message_id, peer_id, emoji, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(messageId, peerId, emoji, Date.now());
  }
  touchRealtimePeer(peerId);
  return !existing;
}

export function listRealtimeChatMessages({ peerId, roomId }) {
  const database = getDatabase();
  const messages = database
    .prepare(
      `SELECT id, sender_peer_id, sender_name, sender_avatar_url, body,
              image_url, created_at, edited_at
       FROM realtime_chat_messages
       WHERE room_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 300`,
    )
    .all(roomId);
  const reactionStatement = database.prepare(
    `SELECT emoji, peer_id, count(*) OVER (PARTITION BY emoji) AS total
     FROM realtime_chat_reactions
     WHERE message_id = ?
     ORDER BY created_at ASC`,
  );
  return messages.map((message) => {
    const reactions = new Map();
    for (const reaction of reactionStatement.all(message.id)) {
      const current = reactions.get(reaction.emoji) || {
        count: Number(reaction.total),
        emoji: reaction.emoji,
        reactedByMe: false,
      };
      if (reaction.peer_id === peerId) current.reactedByMe = true;
      reactions.set(reaction.emoji, current);
    }
    return {
      avatarUrl: message.sender_avatar_url || null,
      body: message.body,
      createdAt: message.created_at,
      editedAt: message.edited_at || null,
      id: message.id,
      imageUrl: message.image_url || null,
      peerId: message.sender_peer_id,
      reactions: [...reactions.values()],
      senderName: message.sender_name,
    };
  });
}

export function isRealtimeRoomOwner({ peerId, roomId }) {
  const database = getDatabase();
  const owner = database
    .prepare(
      `SELECT p.id FROM realtime_peers p
       INNER JOIN realtime_rooms r ON r.id = p.room_id
       LEFT JOIN realtime_kicks k ON k.peer_id = p.id
       WHERE p.id = ? AND p.room_id = ? AND p.user_id = r.owner_user_id
         AND k.peer_id IS NULL`,
    )
    .get(peerId, roomId);
  return owner?.id === peerId;
}

export function kickRealtimePeer({ peerId, roomId, targetPeerId }) {
  const database = getDatabase();
  if (peerId === targetPeerId || !isRealtimeRoomOwner({ peerId, roomId })) {
    return false;
  }

  const target = database
    .prepare("SELECT id FROM realtime_peers WHERE id = ? AND room_id = ?")
    .get(targetPeerId, roomId);
  if (!target) return false;

  const now = Date.now();
  database
    .prepare(
      "INSERT OR REPLACE INTO realtime_kicks (peer_id, room_id, kicked_at) VALUES (?, ?, ?)",
    )
    .run(targetPeerId, roomId, now);
  database
    .prepare(
      "INSERT INTO realtime_events (room_id, from_peer_id, kind, created_at) VALUES (?, ?, 'peer-left', ?)",
    )
    .run(roomId, targetPeerId, now);
  return true;
}

export function banRealtimePeer({ peerId, roomId, targetPeerId }) {
  const database = getDatabase();
  if (peerId === targetPeerId || !isRealtimeRoomOwner({ peerId, roomId })) {
    return false;
  }
  const target = database
    .prepare(
      "SELECT id, user_id FROM realtime_peers WHERE id = ? AND room_id = ?",
    )
    .get(targetPeerId, roomId);
  if (!target) return false;

  database
    .prepare(
      "INSERT OR REPLACE INTO realtime_bans (room_id, user_id, banned_by_peer_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(roomId, target.user_id, peerId, Date.now());
  return kickRealtimePeer({ peerId, roomId, targetPeerId });
}

export function leaveRealtimeRoom({ peerId, roomId }) {
  const database = getDatabase();
  const now = Date.now();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        "INSERT INTO realtime_events (room_id, from_peer_id, kind, created_at) VALUES (?, ?, 'peer-left', ?)",
      )
      .run(roomId, peerId, now);
    database.prepare("DELETE FROM realtime_peers WHERE id = ?").run(peerId);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
