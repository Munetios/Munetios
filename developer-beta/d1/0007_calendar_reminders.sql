CREATE TABLE IF NOT EXISTS munetios_calendar_push_devices (
    endpoint TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES munetios_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS munetios_calendar_push_times (
    endpoint TEXT NOT NULL REFERENCES munetios_calendar_push_devices(endpoint) ON DELETE CASCADE,
    due_at INTEGER NOT NULL,
    PRIMARY KEY (endpoint, due_at)
);

CREATE INDEX IF NOT EXISTS munetios_calendar_push_due ON munetios_calendar_push_times(due_at);
