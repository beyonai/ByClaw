CREATE SEQUENCE IF NOT EXISTS byai.ss_sandbox_resize_record_id_seq;

ALTER TABLE byai.sandbox_service_spec
    ADD COLUMN IF NOT EXISTS service_type VARCHAR(128),
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(128),
    ADD COLUMN IF NOT EXISTS enabled INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS default_profile_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS autoscale_enabled INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS byai.sandbox_service_profile (
    id BIGINT NOT NULL DEFAULT nextval('byai.seq_any_table'::regclass),
    service_type VARCHAR(128) NOT NULL,
    profile_key VARCHAR(64) NOT NULL,
    resource_requests JSONB,
    resource_limits JSONB,
    template_patch_json JSONB,
    resize_enabled INTEGER DEFAULT 0,
    resize_strategy VARCHAR(32) DEFAULT 'IN_PLACE',
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT pg_systimestamp(),
    CONSTRAINT pk_sandbox_service_profile PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sandbox_service_profile_type_key
    ON byai.sandbox_service_profile (service_type, profile_key);

ALTER TABLE byai.ss_sandbox_record
    ADD COLUMN IF NOT EXISTS service_type VARCHAR(128),
    ADD COLUMN IF NOT EXISTS profile_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS resource_requests JSONB,
    ADD COLUMN IF NOT EXISTS resource_limits JSONB,
    ADD COLUMN IF NOT EXISTS resize_status VARCHAR(32),
    ADD COLUMN IF NOT EXISTS last_resize_at TIMESTAMP(6) WITHOUT TIME ZONE,
    ADD COLUMN IF NOT EXISTS last_resize_reason TEXT,
    ADD COLUMN IF NOT EXISTS last_resize_duration_ms BIGINT,
    ADD COLUMN IF NOT EXISTS last_resize_success INTEGER,
    ADD COLUMN IF NOT EXISTS last_resize_from_profile VARCHAR(64),
    ADD COLUMN IF NOT EXISTS last_resize_to_profile VARCHAR(64),
    ADD COLUMN IF NOT EXISTS last_resize_error TEXT;

CREATE TABLE IF NOT EXISTS byai.ss_sandbox_resize_record (
    id BIGINT NOT NULL DEFAULT nextval('byai.ss_sandbox_resize_record_id_seq'::regclass),
    sandbox_record_id BIGINT NOT NULL,
    sandbox_id VARCHAR(128),
    user_code VARCHAR(500) NOT NULL,
    service_type VARCHAR(128),
    from_profile_key VARCHAR(64),
    to_profile_key VARCHAR(64),
    from_resource_requests JSONB,
    from_resource_limits JSONB,
    to_resource_requests JSONB,
    to_resource_limits JSONB,
    trigger_source VARCHAR(64),
    reason_code VARCHAR(128),
    reason_detail TEXT,
    resize_type VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'REQUESTED',
    success INTEGER,
    started_at TIMESTAMP(6) WITHOUT TIME ZONE,
    finished_at TIMESTAMP(6) WITHOUT TIME ZONE,
    duration_ms BIGINT,
    opensandbox_request_id VARCHAR(128),
    opensandbox_response JSONB,
    error_message TEXT,
    create_time TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT pg_systimestamp(),
    update_time TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT pg_systimestamp(),
    CONSTRAINT pk_ss_sandbox_resize_record PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_record
    ON byai.ss_sandbox_resize_record (sandbox_record_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_user
    ON byai.ss_sandbox_resize_record (user_code, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_sandbox
    ON byai.ss_sandbox_resize_record (sandbox_id);
CREATE INDEX IF NOT EXISTS idx_ss_sandbox_resize_record_status
    ON byai.ss_sandbox_resize_record (status, started_at);

UPDATE byai.sandbox_service_spec
SET service_type = COALESCE(service_type, service_key),
    display_name = COALESCE(display_name, service_key),
    enabled = COALESCE(enabled, 1),
    default_profile_key = COALESCE(default_profile_key, CASE WHEN service_key = 'openclaw' THEN 'xs' ELSE NULL END),
    autoscale_enabled = COALESCE(autoscale_enabled, CASE WHEN service_key = 'openclaw' THEN 1 ELSE 0 END)
WHERE service_type IS NULL
   OR display_name IS NULL
   OR enabled IS NULL
   OR default_profile_key IS NULL
   OR autoscale_enabled IS NULL;

INSERT INTO byai.sandbox_service_profile (
    service_type, profile_key, resource_requests, resource_limits,
    resize_enabled, resize_strategy, enabled, sort_order, updated_at
)
VALUES
    ('openclaw', 'xs', '{"cpu":"250m","memory":"765Mi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 10, CURRENT_TIMESTAMP),
    ('openclaw', 's', '{"cpu":"500m","memory":"1Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 20, CURRENT_TIMESTAMP),
    ('openclaw', 'm', '{"cpu":"1","memory":"2Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 30, CURRENT_TIMESTAMP),
    ('openclaw', 'l', '{"cpu":"2","memory":"4Gi"}'::jsonb, '{"cpu":"2","memory":"4Gi"}'::jsonb, 1, 'IN_PLACE', 1, 40, CURRENT_TIMESTAMP)
ON CONFLICT (service_type, profile_key) DO UPDATE SET
    resource_requests = EXCLUDED.resource_requests,
    resource_limits = EXCLUDED.resource_limits,
    resize_enabled = EXCLUDED.resize_enabled,
    resize_strategy = EXCLUDED.resize_strategy,
    enabled = EXCLUDED.enabled,
    sort_order = EXCLUDED.sort_order,
    updated_at = CURRENT_TIMESTAMP;
