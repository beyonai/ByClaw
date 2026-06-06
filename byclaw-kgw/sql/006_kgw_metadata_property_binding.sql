CREATE TABLE IF NOT EXISTS kgw_metadata_property_binding (
    property_id   BIGINT       NOT NULL REFERENCES kgw_metadata_property(property_id) ON DELETE RESTRICT,
    kn_code       VARCHAR(64)  NOT NULL,
    file_path     VARCHAR(512) NOT NULL,
    status        VARCHAR(16)  NOT NULL,
    attempt_id    BIGINT       NOT NULL,
    bound_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (property_id, kn_code, file_path)
);

CREATE INDEX IF NOT EXISTS idx_binding_pending
    ON kgw_metadata_property_binding (status, bound_at)
    WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS kgw_metadata_binding_outbox (
    id            BIGSERIAL    PRIMARY KEY,
    property_id   BIGINT       NOT NULL,
    kn_code       VARCHAR(64)  NOT NULL,
    file_path     VARCHAR(512) NOT NULL,
    attempt_id    BIGINT       NOT NULL,
    reason        VARCHAR(64)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
