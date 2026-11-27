-- Optional birthday chosen when creating an account (or later in Account settings).
-- Munetios Calendar shows it every year as a birthday.
CREATE TABLE IF NOT EXISTS munetios_profile_birthdays (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    birthday TEXT NOT NULL CHECK (birthday GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
