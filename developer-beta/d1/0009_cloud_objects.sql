CREATE TABLE munetios_cloud_objects (
    object_key TEXT PRIMARY KEY NOT NULL,
    delete_after INTEGER
);
CREATE INDEX cloud_objects_cleanup ON munetios_cloud_objects(delete_after) WHERE delete_after IS NOT NULL;

ALTER TABLE munetios_cloud_blob_chunks ADD COLUMN object_key TEXT REFERENCES munetios_cloud_objects(object_key);

CREATE TRIGGER cloud_object_cleanup_after_chunk_delete
AFTER DELETE ON munetios_cloud_blob_chunks
WHEN OLD.object_key IS NOT NULL
BEGIN
    UPDATE munetios_cloud_objects SET delete_after = 0 WHERE object_key = OLD.object_key;
END;
