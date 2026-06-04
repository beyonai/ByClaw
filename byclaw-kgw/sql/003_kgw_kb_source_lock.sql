-- 003_kgw_kb_source_lock.sql
-- Manual write lock; serve-path writes set 'manual' by default; ingest cannot override.

CREATE TABLE IF NOT EXISTS kgw_kb_source_lock (
    kn_code      VARCHAR(64)  NOT NULL,
    file_path    VARCHAR(512) NOT NULL,
    lock_owner   VARCHAR(64)  NOT NULL,
    locked_at    TIMESTAMPTZ DEFAULT NOW(),
    expires_at   TIMESTAMPTZ,
    PRIMARY KEY (kn_code, file_path)
);
