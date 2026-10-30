-- Forwarded public snapshots own their lifetime independently of source messages.
SET search_path TO byai;

CREATE TABLE byai_group_chat_forward_request (
    request_id BIGINT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    actor_user_id BIGINT NOT NULL,
    backend VARCHAR(16) NOT NULL CHECK (backend IN ('LEGACY','TENANT')),
    source_session_id BIGINT NOT NULL,
    client_request_id VARCHAR(64) NOT NULL,
    mode VARCHAR(16) NOT NULL CHECK (mode IN ('SINGLE','MERGED')),
    request_hash CHAR(64) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'RUNNING' CHECK (state IN ('RUNNING','SUCCEEDED','PARTIAL_FAILED','FAILED')),
    snapshot_version INTEGER NOT NULL,
    frozen_json TEXT NOT NULL,
    source_manifest_json TEXT NOT NULL DEFAULT '[]',
    sources_frozen BOOLEAN NOT NULL DEFAULT FALSE,
    lease_owner VARCHAR(128),
    fencing_version BIGINT NOT NULL DEFAULT 0 CHECK (fencing_version >= 0),
    lease_until TIMESTAMP,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_forward_request_actor_key UNIQUE (enterprise_id, actor_user_id, client_request_id),
    CONSTRAINT uq_forward_request_tenant UNIQUE (enterprise_id, request_id)
);

CREATE TABLE byai_group_chat_forward_target (
    target_id BIGINT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    request_id BIGINT NOT NULL,
    target_session_id BIGINT NOT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','COPYING','READY','SUCCEEDED','FAILED')),
    lease_owner VARCHAR(128),
    fencing_version BIGINT NOT NULL DEFAULT 0 CHECK (fencing_version >= 0),
    lease_until TIMESTAMP,
    checkpoint_json TEXT NOT NULL DEFAULT '{}',
    message_ids_json TEXT NOT NULL DEFAULT '[]',
    error_code VARCHAR(128),
    retryable BOOLEAN NOT NULL DEFAULT FALSE,
    pending_delivery BOOLEAN NOT NULL DEFAULT FALSE,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_forward_target_group UNIQUE (request_id, target_session_id),
    CONSTRAINT uq_forward_target_tenant UNIQUE (enterprise_id, request_id, target_id)
);

CREATE TABLE byai_group_chat_forward_item (
    item_id BIGINT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    request_id BIGINT NOT NULL,
    target_id BIGINT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    selected_message_id BIGINT NOT NULL,
    selected_merged_card BOOLEAN NOT NULL,
    source_message_id BIGINT NOT NULL,
    content TEXT NOT NULL,
    speaker_json TEXT NOT NULL,
    source_created_at TIMESTAMP NOT NULL,
    references_json TEXT NOT NULL DEFAULT '[]',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    bound_message_id BIGINT,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_forward_item_ordinal UNIQUE (target_id, ordinal)
);

COMMENT ON COLUMN byai_group_chat_forward_request.frozen_json IS '仅保存不可变的公开消息模板字段，不序列化原始文件定位候选元数据';
COMMENT ON COLUMN byai_group_chat_forward_request.source_manifest_json IS '经校验的最小来源标识及不可变内容校验凭据，不包含访问凭证或签名地址';
COMMENT ON COLUMN byai_group_chat_forward_target.checkpoint_json IS '按上传尝试保存的文件复制进度，包含文件槽位、尝试标识、普通上传结果及附件映射';
COMMENT ON COLUMN byai_group_chat_forward_item.source_message_id IS '原始消息标识，仅用于记录历史来源，不设置源消息外键';
COMMENT ON COLUMN byai_group_chat_forward_item.attachments_json IS '目标群独立文件副本的公开描述，包含普通上传返回的文件标识、名称、路径及访问地址';

CREATE INDEX idx_forward_request_recovery ON byai_group_chat_forward_request (enterprise_id, state, lease_until);
CREATE INDEX idx_forward_target_recovery ON byai_group_chat_forward_target (enterprise_id, state, lease_until);
CREATE INDEX idx_forward_target_delivery ON byai_group_chat_forward_target (enterprise_id, pending_delivery, target_id);
CREATE INDEX idx_forward_item_message ON byai_group_chat_forward_item (enterprise_id, bound_message_id, ordinal);

-- 欢迎卡是个人入群引导：新增列时将存量关系标记为已处理，避免老成员换浏览器再次收到欢迎。
-- 临时默认值只用于这次结构迁移；随后立即移除，新成员默认 NULL，禁止在每次启动时重复回填。
ALTER TABLE byai.byai_session_member ADD COLUMN welcome_handled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE byai.byai_session_member ALTER COLUMN welcome_handled_at DROP DEFAULT;

COMMENT ON COLUMN byai.byai_session_member.welcome_handled_at IS '本次成员关系的个人欢迎资格处理时间，NULL 表示未处理；包含存量迁移跳过，不代表实际曝光';

-- Group send/STOP exclusion is maintained by renewable Redis leases.
DROP TABLE IF EXISTS byai.byai_group_chat_send_gate;

-- BEGIN tenant service integration schema

-- Generic service commands retain request identity independently from worker leases.
CREATE TABLE byai.internal_command (
    id bigint PRIMARY KEY,
    source_system varchar(64) NOT NULL,
    request_id varchar(128) NOT NULL,
    request_hash varchar(64) NOT NULL,
    type varchar(32) NOT NULL,
    enterprise_id bigint NOT NULL,
    owner_user_id bigint NOT NULL,
    request_snapshot text NOT NULL,
    status varchar(32) NOT NULL,
    stage varchar(64) NOT NULL,
    result text,
    error_code varchar(64),
    revision bigint NOT NULL DEFAULT 0,
    lease_owner varchar(128),
    lease_until TIMESTAMP WITH TIME ZONE,
    fencing_token bigint NOT NULL DEFAULT 0,
    attempt integer NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_internal_command_request UNIQUE (source_system, request_id),
    CONSTRAINT ck_internal_command_status CHECK (status IN ('PENDING','RUNNING','RETRY_WAIT','RECONCILING','SUCCEEDED','FAILED','MANUAL_REQUIRED'))
);
CREATE INDEX idx_internal_command_due ON byai.internal_command(status,next_attempt_at);
CREATE INDEX idx_internal_command_enterprise ON byai.internal_command(enterprise_id,created_at);

-- An uncertain external result keeps this slot even after the worker's lease expires.
CREATE TABLE byai.tenant_runtime_operation (
    enterprise_id bigint PRIMARY KEY,
    active_command_id bigint,
    generation bigint NOT NULL DEFAULT 1,
    state varchar(32) NOT NULL DEFAULT 'IDLE',
    fencing_token bigint NOT NULL DEFAULT 0,
    revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE byai.internal_command_step (
    command_id bigint NOT NULL REFERENCES byai.internal_command(id),
    step_key varchar(64) NOT NULL,
    status varchar(32) NOT NULL,
    provider_request_key varchar(128) NOT NULL,
    result text,
    error_code varchar(64),
    revision bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(command_id,step_key)
);
COMMENT ON COLUMN byai.internal_command.request_snapshot IS 'Canonical immutable JSON text including authenticated-service audit actor; never contains transport credentials';

-- 草稿会话切换项目只需判断是否已经产生用户问题；部分索引避免随消息总量增长而扫描会话消息。
CREATE INDEX IF NOT EXISTS idx_byai_message_user_question_session
    ON byai.byai_message (session_id) WHERE usage = 1;

-- Policies remain immutable; the cursor is the sole CAS serialization point.
CREATE TABLE byai.tenant_execution_policy (
    enterprise_id BIGINT NOT NULL,
    revision BIGINT NOT NULL CHECK (revision > 0),
    payload TEXT NOT NULL,
    PRIMARY KEY (enterprise_id, revision)
);
CREATE TABLE byai.tenant_policy_cursor (
    enterprise_id BIGINT PRIMARY KEY,
    desired_revision BIGINT NOT NULL CHECK (desired_revision > 0),
    generation VARCHAR(64) NOT NULL DEFAULT '0'
);
CREATE TABLE byai.tenant_policy_consumer (
    enterprise_id BIGINT NOT NULL,
    policy_revision BIGINT NOT NULL,
    consumer_key VARCHAR(64) NOT NULL,
    generation VARCHAR(64) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (enterprise_id, policy_revision, consumer_key, generation),
    FOREIGN KEY (enterprise_id, policy_revision)
        REFERENCES byai.tenant_execution_policy (enterprise_id, revision)
);
COMMENT ON TABLE byai.tenant_execution_policy IS 'Immutable tenant execution policy snapshots; unsupported quotas do not imply runtime activation';
COMMENT ON TABLE byai.tenant_policy_cursor IS 'Authoritative desired policy revision and current runtime generation; conditional updates fence concurrent changes';
COMMENT ON TABLE byai.tenant_policy_consumer IS 'Acknowledgments scoped to immutable policy revision and current runtime generation';

-- Critical events and subscription attempts share the authoritative business transaction.
CREATE TABLE byai.integration_outbox (
    event_id varchar(36) PRIMARY KEY,
    event_type varchar(128) NOT NULL,
    event_version integer NOT NULL,
    aggregate_id varchar(19) NOT NULL,
    aggregate_revision varchar(19) NOT NULL,
    generation varchar(19) NOT NULL,
    correlation_id varchar(128) NOT NULL,
    payload jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX integration_outbox_aggregate_idx
    ON byai.integration_outbox (aggregate_id, created_at);
CREATE TABLE byai.integration_delivery (
    event_id varchar(36) NOT NULL REFERENCES byai.integration_outbox(event_id),
    subscription_id varchar(64) NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN
        ('PENDING','PROCESSING','RETRY','DELIVERED','FAILED','FILTERED')),
    attempt integer NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
    lease_until TIMESTAMP WITH TIME ZONE,
    fencing_token bigint NOT NULL DEFAULT 0,
    delivered_at TIMESTAMP WITH TIME ZONE,
    error_code varchar(64),
    PRIMARY KEY (event_id, subscription_id)
);
CREATE INDEX integration_delivery_due_idx
    ON byai.integration_delivery(status, next_attempt_at);
CREATE INDEX integration_delivery_lease_idx
    ON byai.integration_delivery(status, lease_until);
COMMENT ON TABLE byai.integration_outbox IS 'Immutable critical business events persisted in the owning transaction';
COMMENT ON TABLE byai.integration_delivery IS 'Independent subscription attempts with expiring leases and fencing tokens';

-- END tenant service integration schema

-- QUOTA GUARDS: transaction-local serialization for optional shared commercial quota admission.
-- Created lazily per scope only when Redis publishes a LIMITED quota snapshot.
CREATE TABLE byai.quota_write_guard (
    scope VARCHAR(32) NOT NULL CHECK (scope IN ('ENTERPRISE_MEMBER', 'ENTERPRISE_WORKGROUP', 'LEGACY_GROUP_MEMBER')),
    subject_id BIGINT NOT NULL CHECK (subject_id > 0),
    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
    PRIMARY KEY (scope, subject_id)
);
COMMENT ON TABLE byai.quota_write_guard IS 'Transaction write guards for enterprise and legacy group quota admission';

-- BEGIN BYCLAW TENANT COMMAND RECOVERY
-- Existing V0.6.0 installations apply only this additional block; retain all historical command and step data.
-- Recovery receipts and administrator evidence are committed with the original command CAS.
BEGIN;
CREATE TABLE byai.internal_command_recovery (
    source_system varchar(64) NOT NULL,
    request_id varchar(36) NOT NULL,
    command_id bigint NOT NULL REFERENCES byai.internal_command(id),
    enterprise_id bigint NOT NULL,
    request_hash varchar(64) NOT NULL,
    expected_revision bigint NOT NULL,
    actor_type varchar(32) NOT NULL,
    actor_id varchar(128) NOT NULL,
    reason varchar(500) NOT NULL,
    confirm_no_in_flight boolean NOT NULL,
    decision varchar(40) NOT NULL,
    step_key varchar(64) NOT NULL,
    receipt text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(source_system,request_id)
);
CREATE INDEX idx_internal_command_recovery_command ON byai.internal_command_recovery(command_id,created_at);
COMMIT;
-- END BYCLAW TENANT COMMAND RECOVERY
