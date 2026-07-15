SET search_path TO byai;

CREATE TABLE IF NOT EXISTS byai.po_storage_quota_setting (
    setting_id BIGINT PRIMARY KEY,
    default_quota_bytes BIGINT NOT NULL DEFAULT 2147483648,
    warning_percent INT NOT NULL DEFAULT 90,
    recycle_retention_days INT NOT NULL DEFAULT 7,
    create_by BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_by BIGINT,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS byai.po_user_storage_quota (
    storage_quota_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    user_code VARCHAR(128) NOT NULL,
    bucket_name VARCHAR(128) NOT NULL,
    storage_type VARCHAR(32) NOT NULL,
    base_quota_bytes BIGINT NOT NULL DEFAULT 2147483648,
    addon_quota_bytes BIGINT NOT NULL DEFAULT 0,
    total_quota_bytes BIGINT NOT NULL DEFAULT 2147483648,
    used_bytes BIGINT NOT NULL DEFAULT 0,
    reserved_bytes BIGINT NOT NULL DEFAULT 0,
    usage_status VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
    provision_status VARCHAR(32) NOT NULL DEFAULT 'INIT',
    quota_sync_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    last_scan_time TIMESTAMP,
    last_warning_time TIMESTAMP,
    last_warning_status VARCHAR(32),
    version BIGINT NOT NULL DEFAULT 0,
    last_error VARCHAR(2000),
    create_by BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_by BIGINT,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delete_flag CHAR(1) NOT NULL DEFAULT '0'
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_storage_quota_user
    ON byai.po_user_storage_quota(user_id) WHERE delete_flag = '0';
CREATE INDEX IF NOT EXISTS idx_po_user_storage_quota_status
    ON byai.po_user_storage_quota(usage_status, provision_status);
CREATE INDEX IF NOT EXISTS idx_po_user_storage_quota_bucket
    ON byai.po_user_storage_quota(bucket_name);

CREATE TABLE IF NOT EXISTS byai.po_storage_package (
    package_id BIGINT PRIMARY KEY,
    package_code VARCHAR(64) NOT NULL,
    package_name VARCHAR(128) NOT NULL,
    addon_bytes BIGINT NOT NULL,
    price DECIMAL(18, 2),
    status VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
    sort_no INT NOT NULL DEFAULT 0,
    remark VARCHAR(512),
    create_by BIGINT,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_by BIGINT,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_po_storage_package_code
    ON byai.po_storage_package(package_code);

CREATE TABLE IF NOT EXISTS byai.po_user_storage_grant (
    grant_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    package_id BIGINT,
    granted_bytes BIGINT NOT NULL,
    grant_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    grant_source VARCHAR(32) NOT NULL DEFAULT 'ADMIN',
    granted_by BIGINT,
    granted_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_by BIGINT,
    revoked_time TIMESTAMP,
    remark VARCHAR(512)
);
CREATE INDEX IF NOT EXISTS idx_po_user_storage_grant_user_status
    ON byai.po_user_storage_grant(user_id, grant_status);

CREATE TABLE IF NOT EXISTS byai.po_user_storage_recycle (
    recycle_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    source_bucket VARCHAR(128) NOT NULL,
    archive_bucket VARCHAR(128) NOT NULL,
    archive_path VARCHAR(512),
    archive_bytes BIGINT NOT NULL DEFAULT 0,
    recycle_status VARCHAR(32) NOT NULL,
    retention_until TIMESTAMP NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    operator_id BIGINT,
    started_time TIMESTAMP,
    finished_time TIMESTAMP,
    error_message VARCHAR(2000)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_storage_recycle_request
    ON byai.po_user_storage_recycle(request_id);
CREATE INDEX IF NOT EXISTS idx_po_user_storage_recycle_cleanup
    ON byai.po_user_storage_recycle(recycle_status, retention_until);
CREATE INDEX IF NOT EXISTS idx_po_user_storage_recycle_user_time
    ON byai.po_user_storage_recycle(user_id, started_time DESC, recycle_id DESC);

CREATE TABLE IF NOT EXISTS byai.po_user_storage_operation (
    operation_id BIGINT PRIMARY KEY,
    request_id VARCHAR(128) NOT NULL,
    user_id BIGINT,
    operation_type VARCHAR(32) NOT NULL,
    operation_status VARCHAR(32) NOT NULL,
    operator_id BIGINT,
    before_quota BIGINT,
    after_quota BIGINT,
    before_used BIGINT,
    after_used BIGINT,
    related_recycle_id BIGINT,
    error_message VARCHAR(2000),
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finish_time TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_storage_operation_request
    ON byai.po_user_storage_operation(request_id);
CREATE INDEX IF NOT EXISTS idx_po_user_storage_operation_user
    ON byai.po_user_storage_operation(user_id, create_time DESC);

CREATE OR REPLACE FUNCTION byai.add_storage_quota_column_if_missing(
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

SELECT byai.add_storage_quota_column_if_missing(
    'byai', 'po_storage_quota_setting', 'downgrade_grace_days', 'INT NOT NULL DEFAULT 7');

DROP FUNCTION byai.add_storage_quota_column_if_missing(TEXT, TEXT, TEXT, TEXT);

CREATE TABLE IF NOT EXISTS byai.po_user_storage_downgrade (
    downgrade_id BIGINT PRIMARY KEY,
    request_id VARCHAR(128) NOT NULL,
    user_id BIGINT NOT NULL,
    grant_id BIGINT,
    grant_ids VARCHAR(2000),
    package_id BIGINT,
    package_names VARCHAR(1000),
    change_bytes BIGINT NOT NULL DEFAULT 0,
    request_source VARCHAR(16) NOT NULL,
    request_type VARCHAR(16) NOT NULL,
    downgrade_status VARCHAR(32) NOT NULL,
    grant_source VARCHAR(32) NOT NULL,
    before_quota_bytes BIGINT NOT NULL,
    target_quota_bytes BIGINT NOT NULL,
    used_bytes_snapshot BIGINT NOT NULL DEFAULT 0,
    reserved_bytes_snapshot BIGINT NOT NULL DEFAULT 0,
    overage_bytes BIGINT NOT NULL DEFAULT 0,
    reason VARCHAR(512),
    review_remark VARCHAR(512),
    grace_deadline TIMESTAMP,
    related_recycle_id BIGINT,
    requested_by BIGINT,
    reviewed_by BIGINT,
    requested_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_time TIMESTAMP,
    completed_time TIMESTAMP,
    error_message VARCHAR(2000),
    version BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_storage_downgrade_request
    ON byai.po_user_storage_downgrade(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_storage_downgrade_open_grant
    ON byai.po_user_storage_downgrade(grant_id)
    WHERE downgrade_status IN ('REQUESTED', 'GRACE', 'ARCHIVING');
CREATE UNIQUE INDEX IF NOT EXISTS uk_po_user_storage_downgrade_open_user
    ON byai.po_user_storage_downgrade(user_id)
    WHERE downgrade_status IN ('REQUESTED', 'GRACE', 'ARCHIVING');
CREATE INDEX IF NOT EXISTS idx_po_user_storage_downgrade_user_time
    ON byai.po_user_storage_downgrade(user_id, requested_time DESC, downgrade_id DESC);
CREATE INDEX IF NOT EXISTS idx_po_user_storage_downgrade_due
    ON byai.po_user_storage_downgrade(downgrade_status, grace_deadline);
