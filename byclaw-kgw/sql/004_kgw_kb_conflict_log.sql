-- 004_kgw_kb_conflict_log.sql
-- Parallel-write conflict log: STALE_VERSION, SOURCE_LOCKED.

CREATE TABLE IF NOT EXISTS kgw_kb_conflict_log (
    id                 BIGSERIAL PRIMARY KEY,
    kn_code            VARCHAR(64)  NOT NULL,
    file_path          VARCHAR(512) NOT NULL,
    current_writer     VARCHAR(64),
    attempted_writer   VARCHAR(64)  NOT NULL,
    attempted_version  VARCHAR(64),
    reason             VARCHAR(64)  NOT NULL,
    attempted_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conflict_kb_time
    ON kgw_kb_conflict_log (kn_code, attempted_at DESC);
