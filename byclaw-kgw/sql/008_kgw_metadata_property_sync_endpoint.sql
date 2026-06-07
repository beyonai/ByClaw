-- S4: switch sync granularity from per-knCode to per-endpoint.
-- ``endpoint_key`` is ``domain_url`` (direct mode) or ``domain_name``
-- (by-framework discovery mode), matching the value used by the circuit
-- breaker registry. N knCodes sharing one backend share one sync row.
DROP TABLE IF EXISTS kgw_metadata_property_sync CASCADE;

CREATE TABLE kgw_metadata_property_sync (
    property_id     BIGINT       NOT NULL REFERENCES kgw_metadata_property(property_id) ON DELETE CASCADE,
    endpoint_key    VARCHAR(255) NOT NULL,
    sync_status     VARCHAR(16)  NOT NULL,
    last_sync_at    TIMESTAMPTZ,
    last_error      TEXT,
    PRIMARY KEY (property_id, endpoint_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_status
    ON kgw_metadata_property_sync (sync_status)
    WHERE sync_status IN ('FAILED', 'PURGING', 'PURGE_FAILED');
