CREATE TABLE IF NOT EXISTS kgw_metadata_property_sync (
    property_id     BIGINT      NOT NULL REFERENCES kgw_metadata_property(property_id) ON DELETE CASCADE,
    kn_code         VARCHAR(64) NOT NULL,
    sync_status     VARCHAR(16) NOT NULL,
    last_sync_at    TIMESTAMPTZ,
    last_error      TEXT,
    PRIMARY KEY (property_id, kn_code)
);

CREATE INDEX IF NOT EXISTS idx_sync_status
    ON kgw_metadata_property_sync (sync_status)
    WHERE sync_status IN ('FAILED', 'PURGING', 'PURGE_FAILED');
