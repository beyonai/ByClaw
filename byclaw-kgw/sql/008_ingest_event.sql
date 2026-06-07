-- 008_ingest_event.sql
-- Ingest pipeline event store: idempotency + DLQ

CREATE TABLE IF NOT EXISTS kgw_ingest_event (
  event_id           BIGSERIAL     PRIMARY KEY,
  source_id          VARCHAR(128)  NOT NULL,
  item_id            VARCHAR(256)  NOT NULL,
  version            VARCHAR(128),
  op                 VARCHAR(16)   NOT NULL,
  kn_code            VARCHAR(64)   NOT NULL,
  file_path          VARCHAR(512)  NOT NULL,
  status             VARCHAR(16)   NOT NULL DEFAULT 'received',
  error_type         VARCHAR(64),
  error_message      TEXT,
  retry_count        INT           NOT NULL DEFAULT 0,
  payload_size_bytes INT,
  received_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  done_at            TIMESTAMPTZ,
  CONSTRAINT uq_ingest_idempotency UNIQUE (source_id, item_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ingest_event_status
  ON kgw_ingest_event (status) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_ingest_event_query
  ON kgw_ingest_event (kn_code, received_at DESC);
