-- metadataProperty 后端同步状态(状态轨 2)。
-- ``endpoint_key`` 是 ``domain_url``(直连模式)或 ``domain_name``
-- (by-framework 服务发现模式),与 circuit breaker registry 使用的键一致。
-- 多个 knCode 共享一个后端实例时只产生一行 sync 记录,
-- 避免对 metadataProperties/batchCreate 这种系统级接口重复同步。
CREATE TABLE IF NOT EXISTS kgw_metadata_property_sync (
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
