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


-- 组织级数字员工发布：审核目标与生效范围分别登记；既有副本仍共享同一版本。
ALTER TABLE byai.digital_employee_publication ADD COLUMN IF NOT EXISTS scope_update BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN byai.digital_employee_publication.scope_update IS '配置更新需全部已发布组织审核通过后统一生效；首次发布可逐组织生效';

CREATE TABLE IF NOT EXISTS byai.digital_employee_publication_target (
    target_id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    request_id BIGINT NOT NULL,
    org_id BIGINT NOT NULL,
    org_name VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    revision BIGINT NOT NULL DEFAULT 0,
    reviewer_id BIGINT,
    reviewer_name VARCHAR(255),
    reviewed_at TIMESTAMP,
    comment VARCHAR(2000),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_employee_publication_target UNIQUE (tenant_id, request_id, org_id),
    CONSTRAINT ck_employee_publication_target_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT ck_employee_publication_target_org CHECK (org_id = -1 OR org_id > 0)
);
COMMENT ON TABLE byai.digital_employee_publication_target IS '发布申请的逐组织审核记录；org_id=-1为全公司';
CREATE INDEX IF NOT EXISTS ix_employee_target_inbox
    ON byai.digital_employee_publication_target (tenant_id, org_id, status, request_id);

CREATE TABLE IF NOT EXISTS byai.digital_employee_publish_scope (
    scope_id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    resource_id BIGINT NOT NULL,
    org_id BIGINT NOT NULL,
    request_id BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_employee_publish_scope UNIQUE (tenant_id, resource_id, org_id),
    CONSTRAINT ck_employee_publish_scope_org CHECK (org_id = -1 OR org_id > 0)
);
COMMENT ON TABLE byai.digital_employee_publish_scope IS '数字员工当前生效发布范围，独立于尚未完成的审核申请';
CREATE INDEX IF NOT EXISTS ix_employee_publish_scope_org
    ON byai.digital_employee_publish_scope (tenant_id, org_id, resource_id);
