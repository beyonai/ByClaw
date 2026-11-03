-- 数字员工版本管理：增量迁移。执行前备份，禁止重复执行或删除已有版本数据。
SET search_path TO byai;

ALTER TABLE ss_resource ADD COLUMN config_version_seq BIGINT NOT NULL DEFAULT 0;
COMMENT ON COLUMN ss_resource.config_version_seq IS '员工配置已保存的最大顺序版本号';
ALTER TABLE ss_resource ADD COLUMN config_revision BIGINT NOT NULL DEFAULT 0;
COMMENT ON COLUMN ss_resource.config_revision IS '配置乐观并发修订号，每次保存或生效递增';
ALTER TABLE ss_resource ADD COLUMN pending_activation_id BIGINT;
COMMENT ON COLUMN ss_resource.pending_activation_id IS '尚未完成运行态同步的生效操作标识';

ALTER TABLE ss_resource_version ADD COLUMN version_seq BIGINT;
COMMENT ON COLUMN ss_resource_version.version_seq IS '数字员工内递增版本号，历史非完整快照为空';
ALTER TABLE ss_resource_version ADD COLUMN base_version_id BIGINT;
COMMENT ON COLUMN ss_resource_version.base_version_id IS '编辑所基于的同一员工历史版本标识';
ALTER TABLE ss_resource_version ADD COLUMN source_version_id BIGINT;
COMMENT ON COLUMN ss_resource_version.source_version_id IS '发布或复制时的来源员工版本标识';
ALTER TABLE ss_resource_version ADD COLUMN snapshot_schema_version INTEGER;
COMMENT ON COLUMN ss_resource_version.snapshot_schema_version IS '完整配置快照协议版本';
ALTER TABLE ss_resource_version ADD COLUMN content_hash VARCHAR(64);
COMMENT ON COLUMN ss_resource_version.content_hash IS '完整配置快照的 SHA256 摘要';
ALTER TABLE ss_resource_version ADD COLUMN version_source VARCHAR(32);
COMMENT ON COLUMN ss_resource_version.version_source IS '版本来源：基线、编辑、新建、绑定变化或发布';
ALTER TABLE ss_resource_version ADD COLUMN change_note VARCHAR(500);
COMMENT ON COLUMN ss_resource_version.change_note IS '保存版本时填写的修改说明';
ALTER TABLE ss_resource_version ADD COLUMN save_request_id VARCHAR(64);
COMMENT ON COLUMN ss_resource_version.save_request_id IS '客户端保存幂等请求标识';

ALTER TABLE ss_resource_version ADD COLUMN saved_revision BIGINT;
COMMENT ON COLUMN ss_resource_version.saved_revision IS '版本保存成功时的配置修订号，用于幂等重试检查';

ALTER TABLE digital_employee_publication ADD COLUMN source_version_id BIGINT;
COMMENT ON COLUMN digital_employee_publication.source_version_id IS '发布申请冻结的个人来源版本标识';
ALTER TABLE digital_employee_publication ADD COLUMN target_version_id BIGINT;
COMMENT ON COLUMN digital_employee_publication.target_version_id IS '审核后生效的企业员工版本标识';

CREATE TABLE ss_resource_version_relation (
    relation_id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    resource_id BIGINT NOT NULL,
    version_id BIGINT NOT NULL,
    relation_type VARCHAR(32) NOT NULL,
    target_resource_id BIGINT,
    target_code VARCHAR(255),
    target_version_id BIGINT,
    binding_mode VARCHAR(16) NOT NULL DEFAULT 'CURRENT',
    sort_order INTEGER NOT NULL DEFAULT 0,
    relation_config TEXT
);
COMMENT ON TABLE ss_resource_version_relation IS '数字员工配置版本依赖索引，与完整快照同事务派生、不可独立修改';
COMMENT ON COLUMN ss_resource_version_relation.relation_id IS '版本依赖记录标识';
COMMENT ON COLUMN ss_resource_version_relation.tenant_id IS '所属租户标识';
COMMENT ON COLUMN ss_resource_version_relation.resource_id IS '数字员工标识';
COMMENT ON COLUMN ss_resource_version_relation.version_id IS '配置版本标识';
COMMENT ON COLUMN ss_resource_version_relation.relation_type IS '依赖类型：资源、技能、工具、模型或员工组成员';
COMMENT ON COLUMN ss_resource_version_relation.target_resource_id IS '关联资源标识';
COMMENT ON COLUMN ss_resource_version_relation.target_code IS '关联工具编码或模型标识';
COMMENT ON COLUMN ss_resource_version_relation.target_version_id IS '已固定的依赖版本标识，为空表示使用当前版本';
COMMENT ON COLUMN ss_resource_version_relation.binding_mode IS '依赖绑定策略，CURRENT 表示运行时使用当前可用资源';
COMMENT ON COLUMN ss_resource_version_relation.sort_order IS '快照内依赖排列顺序';
COMMENT ON COLUMN ss_resource_version_relation.relation_config IS '不含凭证的依赖绑定配置 JSON';

CREATE TABLE ss_resource_version_activation (
    activation_id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    resource_id BIGINT NOT NULL,
    from_version_id BIGINT,
    to_version_id BIGINT NOT NULL,
    expected_revision BIGINT NOT NULL,
    operator_id BIGINT,
    request_id VARCHAR(64),
    reason VARCHAR(500),
    status VARCHAR(32) NOT NULL,
    error_message VARCHAR(1800),
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
COMMENT ON TABLE ss_resource_version_activation IS '数字员工版本生效及运行态同步记录，失败保留并允许重试';
COMMENT ON COLUMN ss_resource_version_activation.activation_id IS '生效操作标识';
COMMENT ON COLUMN ss_resource_version_activation.tenant_id IS '所属租户标识';
COMMENT ON COLUMN ss_resource_version_activation.resource_id IS '数字员工标识';
COMMENT ON COLUMN ss_resource_version_activation.from_version_id IS '操作前生效版本标识';
COMMENT ON COLUMN ss_resource_version_activation.to_version_id IS '本次指定的生效版本标识';
COMMENT ON COLUMN ss_resource_version_activation.expected_revision IS '操作开始时的配置修订号';
COMMENT ON COLUMN ss_resource_version_activation.operator_id IS '实际发起或执行生效操作的用户标识';
COMMENT ON COLUMN ss_resource_version_activation.request_id IS '客户端生效幂等请求标识';
COMMENT ON COLUMN ss_resource_version_activation.reason IS '生效原因或操作来源';
COMMENT ON COLUMN ss_resource_version_activation.status IS '同步状态：SYNC_PENDING、READY、SYNC_FAILED 或 SUPERSEDED';
COMMENT ON COLUMN ss_resource_version_activation.error_message IS '可展示的同步失败原因，不保存凭证';
COMMENT ON COLUMN ss_resource_version_activation.retry_count IS '运行态同步尝试次数';
COMMENT ON COLUMN ss_resource_version_activation.created_at IS '生效操作创建时间';
COMMENT ON COLUMN ss_resource_version_activation.completed_at IS '运行态同步完成时间';

CREATE UNIQUE INDEX uq_employee_version_seq ON ss_resource_version (com_acct_id, resource_id, version_seq);
CREATE UNIQUE INDEX uq_employee_version_save_request ON ss_resource_version (com_acct_id, resource_id, save_request_id);
CREATE INDEX idx_employee_version_history ON ss_resource_version (com_acct_id, resource_id, version_seq DESC);
CREATE INDEX idx_employee_version_relation ON ss_resource_version_relation (tenant_id, resource_id, version_id);
CREATE INDEX idx_employee_version_dependency ON ss_resource_version_relation (tenant_id, target_resource_id);
CREATE INDEX idx_employee_activation_resource ON ss_resource_version_activation (tenant_id, resource_id, created_at);
CREATE UNIQUE INDEX uq_employee_activation_request ON ss_resource_version_activation (tenant_id, resource_id, request_id);
