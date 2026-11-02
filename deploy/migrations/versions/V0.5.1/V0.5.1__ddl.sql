-- 本脚本采用先删后建；重复执行会清空下列四张新增表，并重置本次新增字段。
-- 已有业务数据的环境执行前须备份并确认影响；本脚本不删除资源主表、发布申请主表及权限授权主表。

-- 企业资源同步：独立查看授权、同步版本及可恢复的关联来源对账。
ALTER TABLE byai.ss_resource DROP COLUMN IF EXISTS view_auth_controlled;
ALTER TABLE byai.ss_resource ADD COLUMN view_auth_controlled BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN byai.ss_resource.view_auth_controlled IS '显式接管查看范围，空范围仍受控';
ALTER TABLE byai.ss_resource DROP COLUMN IF EXISTS use_auth_controlled;
ALTER TABLE byai.ss_resource ADD COLUMN use_auth_controlled BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN byai.ss_resource.use_auth_controlled IS '使用范围由第三方接管，不从共享员工自动扩展授权';
ALTER TABLE byai.ss_resource DROP COLUMN IF EXISTS third_sync_revision;
ALTER TABLE byai.ss_resource ADD COLUMN third_sync_revision BIGINT NOT NULL DEFAULT 0;
COMMENT ON COLUMN byai.ss_resource.third_sync_revision IS '第三方同步版本，旧关联任务不得覆盖新版本';

DROP TABLE IF EXISTS byai.byai_resource_binding_source;
CREATE TABLE byai.byai_resource_binding_source (
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
COMMENT ON TABLE byai.byai_resource_binding_source IS '数字员工与资源关联的来源台账，用于第三方同步对账及保留手工关联';
COMMENT ON COLUMN byai.byai_resource_binding_source.binding_source_id IS '关联来源记录主键';
COMMENT ON COLUMN byai.byai_resource_binding_source.com_acct_id IS '资源所属企业标识';
COMMENT ON COLUMN byai.byai_resource_binding_source.resource_id IS '被关联的技能、工具或知识资源标识';
COMMENT ON COLUMN byai.byai_resource_binding_source.digital_employee_id IS '关联资源的数字员工标识';
COMMENT ON COLUMN byai.byai_resource_binding_source.source_type IS '关联来源类型：THIRD_PARTY_SYNC第三方同步、MANUAL手工关联、LEGACY历史关联';
COMMENT ON COLUMN byai.byai_resource_binding_source.source_key IS '来源唯一键：第三方同步为USER:用户标识，其他来源为来源类型';
COMMENT ON COLUMN byai.byai_resource_binding_source.source_user_id IS '触发第三方同步关联的授权用户标识，第三方同步来源必填';
COMMENT ON COLUMN byai.byai_resource_binding_source.sync_revision IS '本条关联来源对应的第三方同步版本';
COMMENT ON COLUMN byai.byai_resource_binding_source.status_cd IS '关联来源状态：A有效、X已撤销';
COMMENT ON COLUMN byai.byai_resource_binding_source.create_by IS '创建人用户标识';
COMMENT ON COLUMN byai.byai_resource_binding_source.update_by IS '最后更新人用户标识';
COMMENT ON COLUMN byai.byai_resource_binding_source.create_time IS '创建时间';
COMMENT ON COLUMN byai.byai_resource_binding_source.update_time IS '最后更新时间';
DROP INDEX IF EXISTS byai.ix_resource_binding_reconcile;
CREATE INDEX ix_resource_binding_reconcile
    ON byai.byai_resource_binding_source (com_acct_id, resource_id, status_cd);
DROP INDEX IF EXISTS byai.ix_resource_binding_employee;
CREATE INDEX ix_resource_binding_employee
    ON byai.byai_resource_binding_source (digital_employee_id, resource_id, status_cd);

DROP TABLE IF EXISTS byai.byai_resource_sync_job;
CREATE TABLE byai.byai_resource_sync_job (
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
COMMENT ON TABLE byai.byai_resource_sync_job IS '企业资源同步后的持久化关联对账任务，支持失败重试和同步版本校验';
COMMENT ON COLUMN byai.byai_resource_sync_job.sync_job_id IS '资源同步对账任务主键';
COMMENT ON COLUMN byai.byai_resource_sync_job.com_acct_id IS '资源所属企业标识';
COMMENT ON COLUMN byai.byai_resource_sync_job.resource_id IS '同步的技能、工具或知识资源标识';
COMMENT ON COLUMN byai.byai_resource_sync_job.sync_revision IS '任务对应的第三方同步版本，过期版本不得覆盖新版本';
COMMENT ON COLUMN byai.byai_resource_sync_job.operator_user_id IS '发起同步操作的用户标识';
COMMENT ON COLUMN byai.byai_resource_sync_job.auth_scope IS '授权范围JSON，包含用户、组织及岗位标识列表';
COMMENT ON COLUMN byai.byai_resource_sync_job.auth_refresh_user_ids IS '需要刷新资源授权缓存的用户标识JSON数组';
COMMENT ON COLUMN byai.byai_resource_sync_job.association_mode IS '关联处理模式：RECONCILE完整对账、CLEANUP_ONLY仅清理、NONE不调整关联';
COMMENT ON COLUMN byai.byai_resource_sync_job.package_changed IS '资源包是否变更，变更后需刷新已关联数字员工的运行配置';
COMMENT ON COLUMN byai.byai_resource_sync_job.status IS '任务状态：PENDING待处理、RUNNING执行中、COMPLETED完成、PARTIAL部分失败、FAILED失败、SUPERSEDED已被新版本替代或资源已删除';
COMMENT ON COLUMN byai.byai_resource_sync_job.result_summary IS '处理结果JSON，记录关联变更统计、跳过原因和待重试的数字员工标识';
COMMENT ON COLUMN byai.byai_resource_sync_job.retry_count IS '任务已领取执行的次数，包含首次执行';
COMMENT ON COLUMN byai.byai_resource_sync_job.next_retry_time IS '下次允许领取或重试的时间';
COMMENT ON COLUMN byai.byai_resource_sync_job.create_time IS '任务创建时间';
COMMENT ON COLUMN byai.byai_resource_sync_job.update_time IS '任务最后更新时间';
DROP INDEX IF EXISTS byai.ix_resource_sync_pending;
CREATE INDEX ix_resource_sync_pending
    ON byai.byai_resource_sync_job (status, next_retry_time);


-- 组织级数字员工发布：审核目标与生效范围分别登记；既有副本仍共享同一版本。
ALTER TABLE byai.digital_employee_publication DROP COLUMN IF EXISTS scope_update;
ALTER TABLE byai.digital_employee_publication ADD COLUMN scope_update BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN byai.digital_employee_publication.scope_update IS '配置更新需全部已发布组织审核通过后统一生效；首次发布可逐组织生效';

DROP TABLE IF EXISTS byai.digital_employee_publication_target;
CREATE TABLE byai.digital_employee_publication_target (
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
COMMENT ON COLUMN byai.digital_employee_publication_target.target_id IS '发布目标审核记录主键';
COMMENT ON COLUMN byai.digital_employee_publication_target.tenant_id IS '发布申请所属企业标识';
COMMENT ON COLUMN byai.digital_employee_publication_target.request_id IS '所属数字员工发布申请标识';
COMMENT ON COLUMN byai.digital_employee_publication_target.org_id IS '目标组织标识，-1表示全公司';
COMMENT ON COLUMN byai.digital_employee_publication_target.org_name IS '申请时的目标组织名称，全公司范围记录为全公司';
COMMENT ON COLUMN byai.digital_employee_publication_target.status IS '目标组织审核状态：PENDING待审核、APPROVED已通过、REJECTED已拒绝';
COMMENT ON COLUMN byai.digital_employee_publication_target.revision IS '审核记录乐观锁版本，防止重复或并发审核覆盖';
COMMENT ON COLUMN byai.digital_employee_publication_target.reviewer_id IS '审核人用户标识';
COMMENT ON COLUMN byai.digital_employee_publication_target.reviewer_name IS '审核人姓名';
COMMENT ON COLUMN byai.digital_employee_publication_target.reviewed_at IS '审核完成时间';
COMMENT ON COLUMN byai.digital_employee_publication_target.comment IS '审核意见';
COMMENT ON COLUMN byai.digital_employee_publication_target.created_at IS '发布目标记录创建时间';
DROP INDEX IF EXISTS byai.ix_employee_target_inbox;
CREATE INDEX ix_employee_target_inbox
    ON byai.digital_employee_publication_target (tenant_id, org_id, status, request_id);

DROP TABLE IF EXISTS byai.digital_employee_publish_scope;
CREATE TABLE byai.digital_employee_publish_scope (
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
COMMENT ON COLUMN byai.digital_employee_publish_scope.scope_id IS '生效发布范围记录主键';
COMMENT ON COLUMN byai.digital_employee_publish_scope.tenant_id IS '数字员工所属企业标识';
COMMENT ON COLUMN byai.digital_employee_publish_scope.resource_id IS '企业数字员工资源标识';
COMMENT ON COLUMN byai.digital_employee_publish_scope.org_id IS '已生效的目标组织标识，-1表示全公司';
COMMENT ON COLUMN byai.digital_employee_publish_scope.request_id IS '产生该生效范围的发布申请标识';
COMMENT ON COLUMN byai.digital_employee_publish_scope.created_at IS '发布范围生效记录创建时间';
DROP INDEX IF EXISTS byai.ix_employee_publish_scope_org;
CREATE INDEX ix_employee_publish_scope_org
    ON byai.digital_employee_publish_scope (tenant_id, org_id, resource_id);

-- 历史待审重复记录须在执行前检查；存在重复时索引创建会失败，不自动删改历史申请。
DROP INDEX IF EXISTS byai.uq_employee_pending_permission;
CREATE UNIQUE INDEX uq_employee_pending_permission
    ON byai.au_privilege_grant (grant_obj_type, grant_obj_id, grant_to_obj_type, grant_to_obj_id, grant_type)
    WHERE status_cd = 'P' AND grant_obj_type = 'DIG_EMPLOYEE' AND grant_to_obj_type = 'USER'
      AND grant_to_type = 'RED' AND grant_type IN ('AVAILABLE_USE', 'MANAGE_APPLY');
