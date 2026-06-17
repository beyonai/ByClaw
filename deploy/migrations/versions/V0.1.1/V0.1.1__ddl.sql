
CREATE SEQUENCE IF NOT EXISTS byai.ss_sandbox_resize_record_id_seq;



CREATE OR REPLACE FUNCTION byai.add_column_if_missing(
    p_schema_name TEXT,
    p_table_name TEXT,
    p_column_name TEXT,
    p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = p_schema_name
          AND table_name = p_table_name
          AND column_name = p_column_name
    ) THEN
        EXECUTE 'ALTER TABLE ' || quote_ident(p_schema_name) || '.' || quote_ident(p_table_name)
            || ' ADD COLUMN ' || quote_ident(p_column_name) || ' ' || p_column_definition;
    END IF;
END;
$$ LANGUAGE plpgsql;



SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'service_type', 'VARCHAR(128)');


SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'display_name', 'VARCHAR(128)');


SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'enabled', 'INTEGER DEFAULT 1');


SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'default_profile_key', 'VARCHAR(64)');


SELECT byai.add_column_if_missing('byai', 'sandbox_service_spec', 'autoscale_enabled', 'INTEGER DEFAULT 0');



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



SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'service_type', 'VARCHAR(128)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'profile_key', 'VARCHAR(64)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'resource_requests', 'JSONB');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'resource_limits', 'JSONB');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'resize_status', 'VARCHAR(32)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_at', 'TIMESTAMP(6) WITHOUT TIME ZONE');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_reason', 'TEXT');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_duration_ms', 'BIGINT');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_success', 'INTEGER');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_from_profile', 'VARCHAR(64)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_to_profile', 'VARCHAR(64)');


SELECT byai.add_column_if_missing('byai', 'ss_sandbox_record', 'last_resize_error', 'TEXT');



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



DROP FUNCTION byai.add_column_if_missing(TEXT, TEXT, TEXT, TEXT);
