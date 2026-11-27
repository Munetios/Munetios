-- Munetios Mail: mailbox data in the dedicated "munetios-mail" D1 database.
-- Large content (MIME, bodies, attachments, drafts, templates, assets, exports) lives in the private R2 bucket.
-- Identity and sessions stay in the existing accounts database; account_id refers to munetios_accounts.id there.
PRAGMA foreign_keys = ON;

CREATE TABLE mailboxes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    address TEXT NOT NULL COLLATE NOCASE UNIQUE,
    kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'forwarding')),
    display_name TEXT NOT NULL DEFAULT '',
    picture_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleting')),
    quota_bytes INTEGER NOT NULL DEFAULT 20000000000,
    used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
    reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
    warned_level INTEGER NOT NULL DEFAULT 0,
    legacy_imported INTEGER NOT NULL DEFAULT 0,
    reconciled_at INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX mailboxes_account ON mailboxes(account_id);

CREATE TABLE aliases (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    address TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    can_send INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);
CREATE INDEX aliases_mailbox ON aliases(mailbox_id);

-- Addresses that were released stay retired so nobody can claim someone else's old mail.
CREATE TABLE retired_addresses (
    address TEXT PRIMARY KEY COLLATE NOCASE,
    retired_at INTEGER NOT NULL
);

-- Content-addressed objects, deduplicated per mailbox. Each object is counted once toward the quota.
CREATE TABLE blobs (
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size >= 0),
    ref_count INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'mail',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (mailbox_id, hash)
);
CREATE INDEX blobs_unreferenced ON blobs(ref_count) WHERE ref_count <= 0;

-- R2 objects whose rows are gone; a queue job or the hourly sweep deletes them.
CREATE TABLE blob_deletions (
    r2_key TEXT PRIMARY KEY,
    queued_at INTEGER NOT NULL
);

-- Mail received while the mailbox was full. It waits (outside the quota) until a signed-in device downloads it
-- into local storage and acknowledges it; then the server copy is deleted. Unclaimed mail gets a non-delivery
-- notice to the sender after 30 days, so nothing is dropped silently.
CREATE TABLE device_deliveries (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    envelope_from TEXT NOT NULL DEFAULT '',
    from_addr TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    message_id_header TEXT,
    auto_submitted INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    UNIQUE (mailbox_id, message_id_header)
);
CREATE INDEX device_deliveries_mailbox ON device_deliveries(mailbox_id, received_at);
CREATE INDEX device_deliveries_expiry ON device_deliveries(expires_at);

-- Space held for uploads and incoming messages in progress.
CREATE TABLE reservations (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    bytes INTEGER NOT NULL CHECK (bytes > 0),
    purpose TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX reservations_expiry ON reservations(expires_at);

CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'folder',
    favorite INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX folders_mailbox ON folders(mailbox_id, parent_id, position);

CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#8f5cff',
    icon TEXT NOT NULL DEFAULT 'label',
    favorite INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE (mailbox_id, name)
);

CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    subject_key TEXT NOT NULL,
    last_date INTEGER NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX threads_subject ON threads(mailbox_id, subject_key, last_date);

-- folder: inbox, sent, drafts, scheduled, outbox, archive, spam, trash, or a custom folder id ("f_...").
CREATE TABLE messages (
    num INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    previous_folder TEXT,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'draft')),
    storage TEXT NOT NULL CHECK (storage IN ('raw', 'structured')),
    message_id_header TEXT,
    in_reply_to TEXT,
    references_header TEXT,
    subject TEXT NOT NULL DEFAULT '',
    from_addr TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    to_json TEXT NOT NULL DEFAULT '[]',
    cc_json TEXT NOT NULL DEFAULT '[]',
    bcc_json TEXT NOT NULL DEFAULT '[]',
    reply_to TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    date INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    attachment_count INTEGER NOT NULL DEFAULT 0,
    attachment_bytes INTEGER NOT NULL DEFAULT 0,
    is_read INTEGER NOT NULL DEFAULT 0,
    is_starred INTEGER NOT NULL DEFAULT 0,
    is_important INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'primary',
    priority TEXT NOT NULL DEFAULT 'normal',
    snooze_until INTEGER,
    follow_up_at INTEGER,
    follow_up_due INTEGER NOT NULL DEFAULT 0,
    trashed_at INTEGER,
    spam_score REAL NOT NULL DEFAULT 0,
    spam_reasons TEXT NOT NULL DEFAULT '[]',
    auth_json TEXT NOT NULL DEFAULT '{}',
    list_unsubscribe TEXT NOT NULL DEFAULT '',
    list_unsubscribe_post INTEGER NOT NULL DEFAULT 0,
    raw_hash TEXT,
    body_hash TEXT,
    draft_hash TEXT,
    dedupe_key TEXT,
    delivery_status TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX messages_folder ON messages(mailbox_id, folder, date DESC);
CREATE INDEX messages_thread ON messages(mailbox_id, thread_id, date);
CREATE INDEX messages_unread ON messages(mailbox_id, folder) WHERE is_read = 0;
CREATE INDEX messages_starred ON messages(mailbox_id, date DESC) WHERE is_starred = 1;
CREATE INDEX messages_important ON messages(mailbox_id, date DESC) WHERE is_important = 1;
CREATE INDEX messages_snoozed ON messages(snooze_until) WHERE snooze_until IS NOT NULL;
CREATE INDEX messages_follow_up ON messages(follow_up_at) WHERE follow_up_at IS NOT NULL;
CREATE INDEX messages_size ON messages(mailbox_id, size_bytes DESC);
CREATE INDEX messages_trashed ON messages(folder, trashed_at);
CREATE INDEX messages_header_id ON messages(mailbox_id, message_id_header);
CREATE UNIQUE INDEX messages_dedupe ON messages(mailbox_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE message_labels (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, label_id)
);
CREATE INDEX message_labels_label ON message_labels(label_id);

-- part_index points into the raw MIME for received mail; blob_hash is used for composed mail.
CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    mailbox_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_id TEXT,
    disposition TEXT NOT NULL DEFAULT 'attachment',
    part_index INTEGER,
    blob_hash TEXT,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX attachments_message ON attachments(message_id);
CREATE INDEX attachments_mailbox ON attachments(mailbox_id, size DESC);

-- Files uploaded for a draft before it is sent.
CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    blob_hash TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'device',
    created_at INTEGER NOT NULL
);
CREATE INDEX uploads_mailbox ON uploads(mailbox_id, created_at);

CREATE VIRTUAL TABLE messages_fts USING fts5(
    subject, people, body, filenames,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE outbound (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'scheduled', 'sending', 'sent', 'failed', 'canceled', 'unknown')),
    send_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    provider_message_id TEXT,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (mailbox_id, idempotency_key)
);
CREATE INDEX outbound_due ON outbound(state, send_at);
CREATE INDEX outbound_provider ON outbound(provider_message_id);
CREATE INDEX outbound_message ON outbound(message_id);

CREATE TABLE delivery_recipients (
    outbound_id TEXT NOT NULL REFERENCES outbound(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL COLLATE NOCASE,
    status TEXT NOT NULL DEFAULT 'pending',
    detail TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (outbound_id, recipient)
);

CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    favorite INTEGER NOT NULL DEFAULT 0,
    auto INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE (mailbox_id, email)
);
CREATE INDEX contacts_rank ON contacts(mailbox_id, use_count DESC);

CREATE TABLE contact_groups (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE contact_group_members (
    group_id TEXT NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, contact_id)
);

CREATE TABLE signatures (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    html TEXT NOT NULL DEFAULT '',
    default_new INTEGER NOT NULL DEFAULT 0,
    default_reply INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'design', 'component')),
    blob_hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE filters (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    match_all INTEGER NOT NULL DEFAULT 1,
    conditions_json TEXT NOT NULL,
    actions_json TEXT NOT NULL,
    stop INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
CREATE INDEX filters_mailbox ON filters(mailbox_id, position);

-- list: block, allow, trusted (remote content allowed)
CREATE TABLE sender_lists (
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    list TEXT NOT NULL CHECK (list IN ('block', 'allow', 'trusted')),
    pattern TEXT NOT NULL COLLATE NOCASE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (mailbox_id, list, pattern)
);

CREATE TABLE saved_searches (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    smart INTEGER NOT NULL DEFAULT 0,
    icon TEXT NOT NULL DEFAULT 'saved_search',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE search_history (
    account_id TEXT NOT NULL,
    query TEXT NOT NULL,
    used_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, query)
);

-- Interface preferences and custom themes follow the account across devices.
CREATE TABLE preferences (
    account_id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);

CREATE TABLE themes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX themes_account ON themes(account_id);

-- Background images and font files used by the account's themes.
CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('background', 'font', 'picture', 'sound')),
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    blob_hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX assets_account ON assets(account_id);

-- Vacation responder, forwarding, retention, remote-content defaults, categories.
CREATE TABLE mailbox_settings (
    mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE vacation_replies (
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    sender TEXT NOT NULL COLLATE NOCASE,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (mailbox_id, sender)
);

-- Change feed for real-time sync, offline catch-up, and the polling fallback.
CREATE TABLE changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    mailbox_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE INDEX changes_mailbox ON changes(mailbox_id, seq);

CREATE TABLE exports (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'ready', 'failed')),
    format TEXT NOT NULL DEFAULT 'mbox',
    cursor INTEGER NOT NULL DEFAULT 0,
    upload_id TEXT,
    parts_json TEXT NOT NULL DEFAULT '[]',
    message_count INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE rate_counters (
    key TEXT NOT NULL,
    window INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, window)
);

CREATE TABLE abuse_reports (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    sender_domain TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
    created_at INTEGER NOT NULL
);
CREATE INDEX abuse_reports_status ON abuse_reports(status, created_at);

-- Operational events: codes and counts only, never addresses, subjects, or content.
CREATE TABLE ops_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    code TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    at INTEGER NOT NULL
);
CREATE INDEX ops_log_at ON ops_log(at);
