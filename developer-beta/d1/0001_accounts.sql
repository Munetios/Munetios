CREATE TABLE munetios_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE munetios_email_codes (
    email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    sent_at TEXT NOT NULL
);

CREATE TABLE munetios_mailboxes (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE
);

CREATE TABLE munetios_mail_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES munetios_mailboxes(account_id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('inbox', 'sent')),
    message_key TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, direction, message_key)
);
CREATE INDEX mail_folder ON munetios_mail_messages(account_id, direction, id);

CREATE TABLE munetios_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    account_id INTEGER NOT NULL REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sessions_expiry ON munetios_sessions(expires_at);
CREATE INDEX sessions_account ON munetios_sessions(account_id);

CREATE TABLE munetios_account_keys (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    kdf_salt TEXT NOT NULL,
    wrap_iv TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    sync_seq INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE munetios_profiles (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE munetios_profile_pictures (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    picture TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE munetios_session_devices (
    token_hash TEXT PRIMARY KEY NOT NULL REFERENCES munetios_sessions(token_hash) ON DELETE CASCADE,
    device TEXT NOT NULL
);

CREATE TABLE munetios_sync_items (
    account_id INTEGER NOT NULL REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    version INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    iv TEXT,
    ciphertext TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, item_key)
);
CREATE INDEX sync_version ON munetios_sync_items(account_id, version);

CREATE TABLE munetios_account_security (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
    last_counter INTEGER NOT NULL DEFAULT -1,
    setup_expires TEXT,
    recovery_email TEXT COLLATE NOCASE
);

CREATE TABLE munetios_sync_item_chunks (
    account_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    part_index INTEGER NOT NULL,
    ciphertext TEXT NOT NULL,
    PRIMARY KEY (account_id, item_key, part_index),
    FOREIGN KEY (account_id, item_key) REFERENCES munetios_sync_items(account_id, item_key) ON DELETE CASCADE
);
