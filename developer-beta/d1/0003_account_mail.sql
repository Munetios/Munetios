CREATE TABLE munetios_password_resets (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    sent_at TEXT NOT NULL
);
CREATE TABLE munetios_google_identities (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    subject TEXT NOT NULL UNIQUE
);
CREATE TABLE munetios_mail_aliases (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    address TEXT NOT NULL UNIQUE
);
CREATE TABLE munetios_mail_html (
    message_id INTEGER PRIMARY KEY REFERENCES munetios_mail_messages(id) ON DELETE CASCADE,
    html TEXT NOT NULL
);
