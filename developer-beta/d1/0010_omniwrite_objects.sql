ALTER TABLE munetios_sync_items ADD COLUMN object_key TEXT REFERENCES munetios_cloud_objects(object_key);
ALTER TABLE munetios_sync_items ADD COLUMN object_bytes INTEGER;

CREATE INDEX sync_omniwrite_inline ON munetios_sync_items(account_id, item_key)
WHERE object_key IS NULL AND deleted = 0
    AND (item_key GLOB 'omniwrite:*' OR item_key GLOB 'omniwrite-sheets:*' OR item_key GLOB 'omniwrite-media:*');

CREATE TRIGGER sync_object_cleanup_after_update
AFTER UPDATE OF object_key ON munetios_sync_items
WHEN OLD.object_key IS NOT NULL AND OLD.object_key IS NOT NEW.object_key
BEGIN
    UPDATE munetios_cloud_objects SET delete_after = (unixepoch() + 600) * 1000 WHERE object_key = OLD.object_key;
END;

CREATE TRIGGER sync_object_cleanup_after_delete
AFTER DELETE ON munetios_sync_items
WHEN OLD.object_key IS NOT NULL
BEGIN
    UPDATE munetios_cloud_objects SET delete_after = (unixepoch() + 600) * 1000 WHERE object_key = OLD.object_key;
END;
