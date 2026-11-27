CREATE TABLE IF NOT EXISTS munetios_profile_picture_privacy (
    account_id INTEGER PRIMARY KEY REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    show_to_everyone INTEGER NOT NULL CHECK (show_to_everyone IN (0, 1))
);
