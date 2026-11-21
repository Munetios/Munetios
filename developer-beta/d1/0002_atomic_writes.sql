ALTER TABLE munetios_account_keys ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE munetios_write_check (
    value INTEGER NOT NULL CONSTRAINT munetios_expected_write CHECK (value = 1)
);
