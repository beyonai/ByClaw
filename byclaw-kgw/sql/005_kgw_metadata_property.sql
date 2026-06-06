CREATE TABLE IF NOT EXISTS kgw_metadata_property (
    property_id    BIGSERIAL    PRIMARY KEY,
    property_name  VARCHAR(128) NOT NULL,
    backend_name   VARCHAR(160) NOT NULL UNIQUE,
    value_type     VARCHAR(32)  NOT NULL,
    description    TEXT,
    ext_params     JSONB,
    status         VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_metadata_property_name_active
    ON kgw_metadata_property (property_name)
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_metadata_property_deleted
    ON kgw_metadata_property (deleted_at)
    WHERE status = 'DELETED';
