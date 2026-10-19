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
