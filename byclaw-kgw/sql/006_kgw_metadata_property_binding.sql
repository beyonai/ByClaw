CREATE TABLE IF NOT EXISTS kgw_metadata_property_binding (
    property_id   BIGINT       NOT NULL REFERENCES kgw_metadata_property(property_id) ON DELETE RESTRICT,
    kn_code       VARCHAR(64)  NOT NULL,
    file_path     VARCHAR(512) NOT NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'BOUND',
    bound_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (property_id, kn_code, file_path),
    CHECK (status IN ('BOUND', 'DELETING'))
);

CREATE INDEX IF NOT EXISTS idx_binding_deleting
    ON kgw_metadata_property_binding (status, updated_at)
    WHERE status = 'DELETING';
