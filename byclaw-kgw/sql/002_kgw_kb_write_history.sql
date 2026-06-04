-- 002_kgw_kb_write_history.sql
-- KB write history for version monotonicity checks.

CREATE TABLE IF NOT EXISTS kgw_kb_write_history (
    kn_code           VARCHAR(64)  NOT NULL,
    file_path         VARCHAR(512) NOT NULL,
    version           VARCHAR(64)  NOT NULL,
    source_id         VARCHAR(128),
    source_connector  VARCHAR(128),
    written_at        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (kn_code, file_path, written_at)
);

CREATE INDEX IF NOT EXISTS idx_kb_write_history_latest
    ON kgw_kb_write_history (kn_code, file_path, written_at DESC);
