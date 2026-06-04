-- 001_kgw_audit_log.sql
-- Unified audit log for serve + ingest paths.

CREATE TABLE IF NOT EXISTS kgw_audit_log (
    id                 BIGSERIAL PRIMARY KEY,
    source             VARCHAR(16)  NOT NULL,
    trace_id           VARCHAR(64),
    actor_user_id      VARCHAR(128),
    actor_ip           INET,
    actor_kind         VARCHAR(32),
    source_connector   VARCHAR(128),
    source_id          VARCHAR(128),
    source_item_id     VARCHAR(256),
    source_version     VARCHAR(64),
    operation_type     VARCHAR(64)  NOT NULL,
    kn_code            VARCHAR(64),
    file_path          VARCHAR(512),
    payload_size_bytes BIGINT,
    row_count          INTEGER,
    payload_redacted   JSONB,
    result_code        VARCHAR(8),
    result_msg         TEXT,
    latency_ms         INTEGER,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_kb_time      ON kgw_audit_log (kn_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_op_time      ON kgw_audit_log (operation_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_source_time  ON kgw_audit_log (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trace        ON kgw_audit_log (trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_user         ON kgw_audit_log (actor_user_id, created_at DESC);
