CREATE TABLE IF NOT EXISTS munetios_cloud_spaces (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('calendar', 'album')),
    version INTEGER NOT NULL DEFAULT 1,
    iv TEXT NOT NULL,
    space_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cloud_spaces_owner ON munetios_cloud_spaces(owner_id, kind);

CREATE TABLE IF NOT EXISTS munetios_cloud_members (
    space_id TEXT NOT NULL REFERENCES munetios_cloud_spaces(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('edit', 'view')),
    PRIMARY KEY (space_id, account_id)
);
CREATE INDEX IF NOT EXISTS cloud_members_account ON munetios_cloud_members(account_id);

CREATE TABLE IF NOT EXISTS munetios_cloud_parts (
    space_id TEXT NOT NULL REFERENCES munetios_cloud_spaces(id) ON DELETE CASCADE,
    part_index INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (space_id, part_index)
);

CREATE TABLE IF NOT EXISTS munetios_cloud_blobs (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    size INTEGER NOT NULL,
    chunk_size INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready'))
);
CREATE INDEX IF NOT EXISTS cloud_blobs_owner ON munetios_cloud_blobs(owner_id);

CREATE TABLE IF NOT EXISTS munetios_cloud_blob_chunks (
    blob_id TEXT NOT NULL REFERENCES munetios_cloud_blobs(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    PRIMARY KEY (blob_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS munetios_cloud_blob_parts (
    blob_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    part_index INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (blob_id, chunk_index, part_index),
    FOREIGN KEY (blob_id, chunk_index) REFERENCES munetios_cloud_blob_chunks(blob_id, chunk_index) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS munetios_cloud_space_blobs (
    space_id TEXT NOT NULL REFERENCES munetios_cloud_spaces(id) ON DELETE CASCADE,
    blob_id TEXT NOT NULL REFERENCES munetios_cloud_blobs(id) ON DELETE CASCADE,
    added_by INTEGER NOT NULL REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (space_id, blob_id)
);
CREATE INDEX IF NOT EXISTS cloud_space_blobs_blob ON munetios_cloud_space_blobs(blob_id);
