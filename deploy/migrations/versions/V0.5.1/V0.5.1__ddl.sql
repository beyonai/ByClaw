-- 企业资源同步：独立查看授权、同步版本及可恢复的关联来源对账。
ALTER TABLE byai.ss_resource ADD COLUMN IF NOT EXISTS view_auth_controlled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE byai.ss_resource ADD COLUMN IF NOT EXISTS use_auth_controlled BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN byai.ss_resource.use_auth_controlled IS '使用范围由第三方接管，不从共享员工自动扩展授权';
ALTER TABLE byai.ss_resource ADD COLUMN IF NOT EXISTS third_sync_revision BIGINT NOT NULL DEFAULT 0;
COMMENT ON COLUMN byai.ss_resource.view_auth_controlled IS '显式接管查看范围，空范围仍受控';
COMMENT ON COLUMN byai.ss_resource.third_sync_revision IS '第三方同步版本，旧关联任务不得覆盖新版本';

CREATE TABLE IF NOT EXISTS byai.byai_resource_binding_source (
    binding_source_id BIGINT PRIMARY KEY,
    com_acct_id BIGINT NOT NULL,
    resource_id BIGINT NOT NULL,
    digital_employee_id BIGINT NOT NULL,
    source_type VARCHAR(32) NOT NULL,
    source_key VARCHAR(128) NOT NULL,
    source_user_id BIGINT,
    sync_revision BIGINT,
    status_cd VARCHAR(3) NOT NULL DEFAULT 'A',
    create_by BIGINT,
    update_by BIGINT,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_resource_binding_source UNIQUE
        (com_acct_id, resource_id, digital_employee_id, source_type, source_key),
    CONSTRAINT ck_resource_binding_source_type CHECK (source_type IN ('THIRD_PARTY_SYNC', 'MANUAL', 'LEGACY')),
    CONSTRAINT ck_resource_binding_sync_user CHECK (source_type != 'THIRD_PARTY_SYNC' OR source_user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_resource_binding_reconcile
    ON byai.byai_resource_binding_source (com_acct_id, resource_id, status_cd);
CREATE INDEX IF NOT EXISTS ix_resource_binding_employee
    ON byai.byai_resource_binding_source (digital_employee_id, resource_id, status_cd);

CREATE TABLE IF NOT EXISTS byai.byai_resource_sync_job (
    sync_job_id BIGINT PRIMARY KEY,
    com_acct_id BIGINT NOT NULL,
    resource_id BIGINT NOT NULL,
    sync_revision BIGINT NOT NULL,
    operator_user_id BIGINT NOT NULL,
    auth_scope TEXT,
    auth_refresh_user_ids TEXT NOT NULL DEFAULT '[]',
    association_mode VARCHAR(32) NOT NULL,
    package_changed BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    result_summary TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    create_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_resource_sync_revision UNIQUE (com_acct_id, resource_id, sync_revision),
    CONSTRAINT ck_resource_sync_mode CHECK (association_mode IN ('RECONCILE', 'CLEANUP_ONLY', 'NONE'))
);
CREATE INDEX IF NOT EXISTS ix_resource_sync_pending
    ON byai.byai_resource_sync_job (status, next_retry_time);
