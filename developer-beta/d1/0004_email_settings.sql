CREATE TABLE munetios_verified_recovery (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    email TEXT NOT NULL
);
CREATE INDEX munetios_recovery_by_email ON munetios_verified_recovery(email);

CREATE TABLE munetios_retired_addresses (
    email TEXT PRIMARY KEY,
    account_id INTEGER REFERENCES munetios_accounts(id) ON DELETE SET NULL
);
