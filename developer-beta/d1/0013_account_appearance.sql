CREATE TABLE IF NOT EXISTS munetios_account_appearance (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    font_family TEXT NOT NULL DEFAULT '',
    accent_color TEXT NOT NULL DEFAULT ''
);
