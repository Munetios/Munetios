CREATE TABLE IF NOT EXISTS munetios_collab_invitations (
    account_id INTEGER NOT NULL REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES munetios_accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, document_id)
);

CREATE INDEX IF NOT EXISTS munetios_collab_invitation_document ON munetios_collab_invitations(document_id);
