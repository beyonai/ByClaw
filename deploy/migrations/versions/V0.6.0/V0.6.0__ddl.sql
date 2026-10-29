-- V0.6.0 业务结构：群消息转发、租户开通与人工恢复、运行规则版本。
-- 当前任务占用与当前规则指向合并为 tenant_operation_state；按用户安排直接重建这些表。
-- 每张表和每列均在下方提供中文业务注释；外部接口字段不变。
-- 2026-10-29 简化：移除任务 result、运行任务 generation/fencing_token、步骤 error_code 四个无实际用途字段；运行占用状态由 active_command_id 是否为空决定，不再重复保存 state。
-- 本版本直接 CREATE TABLE，不提供旧库改名、回填或退役脚本。
-- 消息转发内容具有独立生命周期，不因原始消息变化而重新读取。
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
COMMENT ON TABLE byai_group_chat_forward_request IS '群消息转发任务：一次点击对应一条记录，重复请求复用原任务';
COMMENT ON COLUMN byai_group_chat_forward_request.request_id IS '转发任务编号';
COMMENT ON COLUMN byai_group_chat_forward_request.enterprise_id IS '所属企业编号';
COMMENT ON COLUMN byai_group_chat_forward_request.actor_user_id IS '发起转发的用户编号';
COMMENT ON COLUMN byai_group_chat_forward_request.backend IS '处理数据所在位置：LEGACY 公共库，TENANT 租户库';
COMMENT ON COLUMN byai_group_chat_forward_request.source_session_id IS '来源群编号';
COMMENT ON COLUMN byai_group_chat_forward_request.client_request_id IS '客户端请求编号；同一企业同一用户重试时保持不变';
COMMENT ON COLUMN byai_group_chat_forward_request.mode IS '转发方式：SINGLE 逐条转发，MERGED 合并转发';
COMMENT ON COLUMN byai_group_chat_forward_request.request_hash IS '请求内容摘要；同一请求编号不能用于不同转发内容';
COMMENT ON COLUMN byai_group_chat_forward_request.state IS '整体进度：RUNNING 处理中，SUCCEEDED 全部成功，PARTIAL_FAILED 部分失败，FAILED 失败';
COMMENT ON COLUMN byai_group_chat_forward_request.snapshot_version IS '转发内容快照的数据格式版本';
COMMENT ON COLUMN byai_group_chat_forward_request.frozen_json IS '不可变的公开消息模板；不保存原始文件定位候选元数据';
COMMENT ON COLUMN byai_group_chat_forward_request.source_manifest_json IS '经校验的最小来源标识和内容校验凭据；不含访问凭证或签名地址';
COMMENT ON COLUMN byai_group_chat_forward_request.sources_frozen IS '来源内容是否已完成固定；完成后重试沿用原内容';
COMMENT ON COLUMN byai_group_chat_forward_request.lease_owner IS '当前处理实例标识';
COMMENT ON COLUMN byai_group_chat_forward_request.fencing_version IS '处理权编号；任务被重新领取后递增，旧处理者不能再保存结果';
COMMENT ON COLUMN byai_group_chat_forward_request.lease_until IS '当前处理权到期时间';
COMMENT ON COLUMN byai_group_chat_forward_request.create_time IS '任务创建时间';
COMMENT ON COLUMN byai_group_chat_forward_request.update_time IS '任务最后更新时间';

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
COMMENT ON TABLE byai_group_chat_forward_target IS '群消息转发目标：每个目标群单独记录进度和失败原因';
COMMENT ON COLUMN byai_group_chat_forward_target.target_id IS '目标处理记录编号';
COMMENT ON COLUMN byai_group_chat_forward_target.enterprise_id IS '所属企业编号';
COMMENT ON COLUMN byai_group_chat_forward_target.request_id IS '所属转发任务编号';
COMMENT ON COLUMN byai_group_chat_forward_target.target_session_id IS '接收转发的目标群编号';
COMMENT ON COLUMN byai_group_chat_forward_target.state IS '目标群进度：PENDING 待处理，COPYING 复制附件，READY 可发送，SUCCEEDED 成功，FAILED 失败';
COMMENT ON COLUMN byai_group_chat_forward_target.lease_owner IS '当前处理实例标识';
COMMENT ON COLUMN byai_group_chat_forward_target.fencing_version IS '处理权编号；防止过期处理者覆盖新结果';
COMMENT ON COLUMN byai_group_chat_forward_target.lease_until IS '当前处理权到期时间';
COMMENT ON COLUMN byai_group_chat_forward_target.checkpoint_json IS '各上传尝试的附件复制进度、尝试标识及附件映射';
COMMENT ON COLUMN byai_group_chat_forward_target.message_ids_json IS '本次转发在目标群生成的消息编号列表';
COMMENT ON COLUMN byai_group_chat_forward_target.error_code IS '本目标群最后一次失败的错误码';
COMMENT ON COLUMN byai_group_chat_forward_target.retryable IS '当前失败是否允许重试';
COMMENT ON COLUMN byai_group_chat_forward_target.pending_delivery IS '已生成的消息是否仍待投递通知';
COMMENT ON COLUMN byai_group_chat_forward_target.create_time IS '记录创建时间';
COMMENT ON COLUMN byai_group_chat_forward_target.update_time IS '记录最后更新时间';

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
COMMENT ON TABLE byai_group_chat_forward_item IS '群消息转发内容：每个目标群持有独立的消息和附件快照';
COMMENT ON COLUMN byai_group_chat_forward_item.item_id IS '转发内容记录编号';
COMMENT ON COLUMN byai_group_chat_forward_item.enterprise_id IS '所属企业编号';
COMMENT ON COLUMN byai_group_chat_forward_item.request_id IS '所属转发任务编号';
COMMENT ON COLUMN byai_group_chat_forward_item.target_id IS '所属目标群处理记录编号';
COMMENT ON COLUMN byai_group_chat_forward_item.ordinal IS '在目标群转发内容中的顺序，从零开始';
COMMENT ON COLUMN byai_group_chat_forward_item.selected_message_id IS '用户选择的消息或合并卡片编号';
COMMENT ON COLUMN byai_group_chat_forward_item.selected_merged_card IS '用户选择的是否为合并消息卡片';
COMMENT ON COLUMN byai_group_chat_forward_item.source_message_id IS '原始消息编号，仅记录历史来源，不设置源消息外键';
COMMENT ON COLUMN byai_group_chat_forward_item.content IS '转发的消息内容快照';
COMMENT ON COLUMN byai_group_chat_forward_item.speaker_json IS '原发言人的公开信息快照';
COMMENT ON COLUMN byai_group_chat_forward_item.source_created_at IS '原始消息发送时间';
COMMENT ON COLUMN byai_group_chat_forward_item.references_json IS '转发内容中的公开引用信息';
COMMENT ON COLUMN byai_group_chat_forward_item.attachments_json IS '目标群独立文件副本的公开描述：文件标识、名称、路径和访问地址';
COMMENT ON COLUMN byai_group_chat_forward_item.bound_message_id IS '最终关联的目标群消息编号；未发送时为空';
COMMENT ON COLUMN byai_group_chat_forward_item.create_time IS '记录创建时间';


CREATE INDEX idx_forward_request_recovery ON byai_group_chat_forward_request (enterprise_id, state, lease_until);
CREATE INDEX idx_forward_target_recovery ON byai_group_chat_forward_target (enterprise_id, state, lease_until);
CREATE INDEX idx_forward_target_delivery ON byai_group_chat_forward_target (enterprise_id, pending_delivery, target_id);
CREATE INDEX idx_forward_item_message ON byai_group_chat_forward_item (enterprise_id, bound_message_id, ordinal);

-- 欢迎卡是个人入群引导：新增列时将存量关系标记为已处理，避免老成员换浏览器再次收到欢迎。
-- 临时默认值只用于这次结构迁移；随后立即移除，新成员默认 NULL，禁止在每次启动时重复回填。
ALTER TABLE byai.byai_session_member ADD COLUMN welcome_handled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE byai.byai_session_member ALTER COLUMN welcome_handled_at DROP DEFAULT;

COMMENT ON COLUMN byai.byai_session_member.welcome_handled_at IS '本次成员关系的个人欢迎资格处理时间，NULL 表示未处理；包含存量迁移跳过，不代表实际曝光';

-- 群消息发送与停止操作已使用可续租 Redis 锁，不再需要旧保护表。
DROP TABLE IF EXISTS byai.byai_group_chat_send_gate;

-- BEGIN tenant service integration schema

-- 租户服务任务：重试始终保留原请求身份，工作实例的处理权可以过期并重新领取。
CREATE TABLE byai.tenant_task (
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
    error_code varchar(64),
    revision bigint NOT NULL DEFAULT 0,
    lease_owner varchar(128),
    lease_until TIMESTAMP WITH TIME ZONE,
    fencing_token bigint NOT NULL DEFAULT 0,
    attempt integer NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_tenant_task_request UNIQUE (source_system, request_id),
    CONSTRAINT ck_tenant_task_status CHECK (status IN ('PENDING','RUNNING','RETRY_WAIT','RECONCILING','SUCCEEDED','FAILED','MANUAL_REQUIRED'))
);
COMMENT ON TABLE byai.tenant_task IS '租户服务任务：记录开通、策略变更及删除请求，重试复用原任务';
COMMENT ON COLUMN byai.tenant_task.id IS '服务任务编号；接口中的 commandId';
COMMENT ON COLUMN byai.tenant_task.source_system IS '已认证的调用方系统标识；与请求编号一起识别重复请求';
COMMENT ON COLUMN byai.tenant_task.request_id IS '调用方请求编号；超时重试不得更换';
COMMENT ON COLUMN byai.tenant_task.request_hash IS '请求内容摘要；防止同一请求编号携带不同参数';
COMMENT ON COLUMN byai.tenant_task.type IS '任务类型：PROVISION 开通，POLICY 规则变更，其他值由具体成员或删除接口定义';
COMMENT ON COLUMN byai.tenant_task.enterprise_id IS '本任务操作的企业编号';
COMMENT ON COLUMN byai.tenant_task.owner_user_id IS '开通时的企业所有者，删除时的操作用户；其他任务可为零，完整操作身份见请求快照';
COMMENT ON COLUMN byai.tenant_task.request_snapshot IS '规范化的不可变请求 JSON，包含操作审计身份，不含服务认证凭据';
COMMENT ON COLUMN byai.tenant_task.status IS '任务进度：PENDING 待处理，RUNNING 执行中，RETRY_WAIT 待重试，RECONCILING 对账中，SUCCEEDED 成功，FAILED 失败，MANUAL_REQUIRED 待人工处理';
COMMENT ON COLUMN byai.tenant_task.stage IS '当前业务步骤，如 DB_CREATE、NODE_CREATE、SCHEMA_INIT、READY';
COMMENT ON COLUMN byai.tenant_task.error_code IS '最近一次处理失败的错误码';
COMMENT ON COLUMN byai.tenant_task.revision IS '任务记录版本；提交恢复请求时校验，防止根据过期状态操作';
COMMENT ON COLUMN byai.tenant_task.lease_owner IS '当前领取任务的工作实例标识';
COMMENT ON COLUMN byai.tenant_task.lease_until IS '本次领取的有效截止时间';
COMMENT ON COLUMN byai.tenant_task.fencing_token IS '任务执行权编号；领取或恢复时递增，旧工作实例不能再提交结果';
COMMENT ON COLUMN byai.tenant_task.attempt IS '任务累计领取次数';
COMMENT ON COLUMN byai.tenant_task.next_attempt_at IS '允许后台再次处理的时间';
COMMENT ON COLUMN byai.tenant_task.created_at IS '任务受理时间';
COMMENT ON COLUMN byai.tenant_task.updated_at IS '任务最后更新时间';
CREATE INDEX idx_tenant_task_due ON byai.tenant_task(status,next_attempt_at);
CREATE INDEX idx_tenant_task_enterprise ON byai.tenant_task(enterprise_id,created_at);

-- 外部创建结果未知时，当前任务记录仍保留占用，不能因执行权过期就重复开通。
CREATE TABLE byai.tenant_operation_state (
    enterprise_id BIGINT PRIMARY KEY,
    active_command_id BIGINT,
    operation_revision BIGINT NOT NULL DEFAULT 0,
    policy_revision BIGINT CHECK (policy_revision > 0),
    runtime_generation VARCHAR(64) NOT NULL DEFAULT '0',
    applied_rule_revision BIGINT,
    applied_runtime_generation VARCHAR(64),
    rule_applied_at TIMESTAMP WITH TIME ZONE
);
COMMENT ON TABLE byai.tenant_operation_state IS '租户当前运行状态：同一行保存未结束任务、当前规则版本和运行环境代次';
COMMENT ON COLUMN byai.tenant_operation_state.enterprise_id IS '企业编号；每个企业一条运行状态';
COMMENT ON COLUMN byai.tenant_operation_state.active_command_id IS '当前未结束的服务任务编号；为空表示无占用，结果未知时保留原编号';
COMMENT ON COLUMN byai.tenant_operation_state.operation_revision IS '任务占用记录版本；人工恢复和删除时校验，防止并发改变归属';
COMMENT ON COLUMN byai.tenant_operation_state.policy_revision IS '最近确认的共享权益版本；商业规则正文及权威版本由 HACU/Redis 提供';
COMMENT ON COLUMN byai.tenant_operation_state.runtime_generation IS '当前运行环境代次；零表示尚未就绪，旧环境不能确认新环境的规则';
COMMENT ON COLUMN byai.tenant_operation_state.applied_rule_revision IS '主服务最近确认应用的规则版本；须同时匹配当前规则版本和运行代次才代表当前已确认';
COMMENT ON COLUMN byai.tenant_operation_state.applied_runtime_generation IS '主服务最近确认所属的运行环境代次；不代表 Node 已确认';
COMMENT ON COLUMN byai.tenant_operation_state.rule_applied_at IS '主服务对最近版本和代次的首次确认时间；重复确认不覆盖，不保留历史回执';
CREATE TABLE byai.tenant_task_step (
    command_id bigint NOT NULL REFERENCES byai.tenant_task(id),
    step_key varchar(64) NOT NULL,
    status varchar(32) NOT NULL,
    provider_request_key varchar(128) NOT NULL,
    result text,
    revision bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(command_id,step_key)
);
COMMENT ON TABLE byai.tenant_task_step IS '租户任务步骤：记住外部操作意图和结果，恢复时避免重复创建资源';
COMMENT ON COLUMN byai.tenant_task_step.command_id IS '所属服务任务编号';
COMMENT ON COLUMN byai.tenant_task_step.step_key IS '业务步骤，如 DB_CREATE、NODE_CREATE、SCHEMA_INIT';
COMMENT ON COLUMN byai.tenant_task_step.status IS '步骤进度：STARTED 已记录执行意图但结果未确认，SUCCEEDED 已确认成功，RETRY_READY 已获准重试';
COMMENT ON COLUMN byai.tenant_task_step.provider_request_key IS '外部服务请求编号；同一任务同一步骤恢复时保持不变';
COMMENT ON COLUMN byai.tenant_task_step.result IS '已确认的步骤结果 JSON；用于复用资源和核实结果';
COMMENT ON COLUMN byai.tenant_task_step.revision IS '步骤记录版本；恢复时校验，防止覆盖并发完成的步骤';

-- END tenant service integration schema

-- BEGIN BYCLAW TENANT COMMAND RECOVERY
-- 人工恢复请求与结果使用独立表保存，关联原租户任务。
-- 恢复回执及管理员操作信息，随原任务的版本条件更新一同提交。
BEGIN;
CREATE TABLE byai.tenant_task_recovery (
    source_system varchar(64) NOT NULL,
    request_id varchar(36) NOT NULL,
    command_id bigint NOT NULL REFERENCES byai.tenant_task(id),
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
COMMENT ON TABLE byai.tenant_task_recovery IS '租户任务人工恢复回执：保留原任务、操作原因和受理结果，超时后可查询';
COMMENT ON COLUMN byai.tenant_task_recovery.source_system IS '原任务所属调用方系统标识';
COMMENT ON COLUMN byai.tenant_task_recovery.request_id IS '本次人工恢复请求编号；与开通请求编号不同，重试时不更换';
COMMENT ON COLUMN byai.tenant_task_recovery.command_id IS '要继续处理的原服务任务编号';
COMMENT ON COLUMN byai.tenant_task_recovery.enterprise_id IS '原任务对应企业编号；恢复不分配新企业';
COMMENT ON COLUMN byai.tenant_task_recovery.request_hash IS '本次恢复参数摘要；防止相同请求编号携带不同恢复内容';
COMMENT ON COLUMN byai.tenant_task_recovery.expected_revision IS '管理员发起恢复时看到的任务版本，用于拒绝过期操作';
COMMENT ON COLUMN byai.tenant_task_recovery.actor_type IS '操作身份类型；当前须为 PLATFORM_ADMIN';
COMMENT ON COLUMN byai.tenant_task_recovery.actor_id IS '执行恢复的管理员标识';
COMMENT ON COLUMN byai.tenant_task_recovery.reason IS '管理员填写的恢复原因';
COMMENT ON COLUMN byai.tenant_task_recovery.confirm_no_in_flight IS '管理员是否确认不存在仍在进行的外部创建请求';
COMMENT ON COLUMN byai.tenant_task_recovery.decision IS '受理时核实的恢复决定，如 RETRY_SAFE、RETRY_AFTER_CONFIRMATION、ADOPT_EXISTING';
COMMENT ON COLUMN byai.tenant_task_recovery.step_key IS '本次核实和恢复的原任务步骤';
COMMENT ON COLUMN byai.tenant_task_recovery.receipt IS '已提交的恢复受理结果 JSON；受理成功不等于最终开通成功';
COMMENT ON COLUMN byai.tenant_task_recovery.created_at IS '恢复受理时间';
CREATE INDEX idx_tenant_task_recovery_command ON byai.tenant_task_recovery(command_id,created_at);
COMMIT;
-- END BYCLAW TENANT COMMAND RECOVERY
