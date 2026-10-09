-- ByClaw 群聊执行状态与消息关系索引。
-- 迁移必须可重复执行，不能修改 deploy/middleware/initdb/。

CREATE TABLE IF NOT EXISTS byai.byai_group_chat_execution (
    execution_id         BIGINT       NOT NULL,
    group_session_id     BIGINT       NOT NULL,
    source_message_id    BIGINT       NOT NULL,
    reply_to_message_id  BIGINT,
    initiator_user_id    BIGINT       NOT NULL,
    target_agent_id      BIGINT       NOT NULL,
    candidate_session_id BIGINT       NOT NULL,
    status               VARCHAR(32)  NOT NULL,
    disposition          VARCHAR(16)  NOT NULL DEFAULT 'UNKNOWN',
    task_name            VARCHAR(255),
    ack_text             TEXT,
    disposition_time     TIMESTAMP,
    parent_execution_id  BIGINT,
    root_message_id      BIGINT       NOT NULL,
    trace_id             VARCHAR(255),
    gateway_session_id   VARCHAR(255),
    ack_message_id       BIGINT,
    answer_message_id    BIGINT,
    error_code           VARCHAR(128),
    error_message        TEXT,
    attempt              INTEGER      NOT NULL DEFAULT 0,
    create_time          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    start_time           TIMESTAMP,
    finish_time          TIMESTAMP,
    CONSTRAINT pk_byai_group_chat_execution PRIMARY KEY (execution_id),
    CONSTRAINT uk_group_chat_execution_source_agent UNIQUE (source_message_id, target_agent_id),
    CONSTRAINT uk_group_chat_execution_candidate UNIQUE (candidate_session_id)
);

CREATE INDEX IF NOT EXISTS idx_group_chat_execution_status
    ON byai.byai_group_chat_execution (status, create_time);

CREATE INDEX IF NOT EXISTS idx_group_chat_execution_group_time
    ON byai.byai_group_chat_execution (group_session_id, create_time);

CREATE INDEX IF NOT EXISTS idx_group_chat_execution_trace
    ON byai.byai_group_chat_execution (trace_id);

CREATE TABLE IF NOT EXISTS byai.byai_group_chat_execution_event (
    execution_id BIGINT NOT NULL,
    event_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(64),
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_group_chat_execution_event PRIMARY KEY (execution_id, event_id),
    CONSTRAINT fk_group_chat_execution_event_execution FOREIGN KEY (execution_id)
        REFERENCES byai.byai_group_chat_execution (execution_id)
);

CREATE TABLE IF NOT EXISTS byai.byai_group_chat_task (
    task_session_id      BIGINT       NOT NULL,
    group_session_id     BIGINT       NOT NULL,
    source_message_id    BIGINT       NOT NULL,
    dispatch_id          BIGINT       NOT NULL,
    initiator_user_id    BIGINT       NOT NULL,
    target_agent_id      BIGINT       NOT NULL,
    task_name            VARCHAR(255) NOT NULL,
    status               VARCHAR(32)  NOT NULL,
    turn_status          VARCHAR(32)  NOT NULL,
    publish_message_id   BIGINT,
    publish_by           BIGINT,
    create_time          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_group_chat_task PRIMARY KEY (task_session_id),
    CONSTRAINT uk_group_chat_task_dispatch UNIQUE (dispatch_id)
);

CREATE INDEX IF NOT EXISTS idx_group_chat_task_group_time
    ON byai.byai_group_chat_task (group_session_id, create_time);

CREATE INDEX IF NOT EXISTS idx_group_chat_task_initiator_time
    ON byai.byai_group_chat_task (initiator_user_id, create_time);

CREATE TABLE IF NOT EXISTS byai.byai_group_chat_task_publication (
    task_session_id      BIGINT       NOT NULL,
    group_session_id     BIGINT       NOT NULL,
    message_id           BIGINT       NOT NULL,
    publisher_user_id    BIGINT       NOT NULL,
    text_content         TEXT,
    files_json           TEXT,
    create_time          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_group_chat_task_publication PRIMARY KEY (task_session_id),
    CONSTRAINT uk_group_chat_task_publication_message UNIQUE (message_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_session_member_object
    ON byai.byai_session_member (session_id, mem_obj_type, mem_obj_id);

ALTER TABLE byai.byai_session_member ADD COLUMN last_read_message_id BIGINT;
ALTER TABLE byai.byai_session_member ADD COLUMN last_read_time TIMESTAMP;

ALTER TABLE byai.byai_group_chat_task_publication ADD COLUMN pending_publication_id BIGINT;

-- 复用分享主表存储群邀请。NULL 类型兼容历史消息分享，群邀请 link_id = session_id。
ALTER TABLE byai.message_share_link ADD COLUMN link_type VARCHAR(32) DEFAULT 'MESSAGE';
ALTER TABLE byai.message_share_link ALTER COLUMN link_type SET DEFAULT 'MESSAGE';
ALTER TABLE byai.message_share_link ALTER COLUMN link_type DROP NOT NULL;

-- 表达式唯一索引将 NULL 与 MESSAGE 视为同类。存在历史重复数据时建索引失败，
-- 应先人工核查重复记录，不自动删除或覆盖分享数据。
CREATE UNIQUE INDEX IF NOT EXISTS uk_message_share_link_type_id
    ON byai.message_share_link ((COALESCE(link_type, 'MESSAGE')), link_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_message_share_link_type_token
    ON byai.message_share_link ((COALESCE(link_type, 'MESSAGE')), link_token);

COMMENT ON COLUMN byai.message_share_link.link_type IS
    'MESSAGE（NULL 兼容历史消息分享）/ GROUP_INVITATION（link_id 为群 session_id）';

-- 群消息话题归属允许为空：私有消息、系统事件和待核查的历史异常不分配话题。
ALTER TABLE byai.byai_message ADD COLUMN topic_id BIGINT;

-- 群消息撤回只记录状态与操作人，原文、引用和业务数据保持不变。
ALTER TABLE byai.byai_message ADD COLUMN recalled_at TIMESTAMP(3);
ALTER TABLE byai.byai_message ADD COLUMN recalled_by BIGINT;
COMMENT ON COLUMN byai.byai_message.recalled_at IS '撤回时间；空值表示未撤回';
COMMENT ON COLUMN byai.byai_message.recalled_by IS '撤回操作人用户ID，用户名从Redis共享用户信息读取';

-- 当前轮次绑定只由新请求写入，不回填历史任务的运行状态。
ALTER TABLE byai.byai_group_chat_task ADD COLUMN current_turn_id BIGINT;
ALTER TABLE byai.byai_group_chat_task ADD COLUMN current_turn_trace_id VARCHAR(255);
COMMENT ON COLUMN byai.byai_group_chat_task.current_turn_id IS '当前轮次启动占位标识，用于隔离迟到的启动失败回调';
COMMENT ON COLUMN byai.byai_group_chat_task.current_turn_trace_id IS '当前轮次实际trace，用于完成回调与落库结果补偿';
CREATE INDEX IF NOT EXISTS idx_group_chat_task_running_turn
    ON byai.byai_group_chat_task (status, turn_status, task_session_id);

CREATE TABLE IF NOT EXISTS byai.byai_group_chat_mention (
    message_id           BIGINT      NOT NULL,
    group_session_id     BIGINT      NOT NULL,
    mentioned_user_id    BIGINT      NOT NULL,
    creator_id           BIGINT      NOT NULL,
    create_time          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_group_chat_mention PRIMARY KEY (message_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_chat_mention_user_group_message
    ON byai.byai_group_chat_mention (mentioned_user_id, group_session_id, message_id);

-- V0.4.1 上线前已产生的群消息同样需要进入 mention 索引，避免列表状态只对新消息生效。
-- 历史 metadata 是 TEXT，兼容跳过旧数据中的非 JSON 内容，避免单条脏数据中断整次迁移。
CREATE OR REPLACE FUNCTION byai._v041_try_parse_jsonb(source TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    parsed JSONB;
BEGIN
    parsed := source::JSONB;
    IF jsonb_typeof(parsed -> 'resourceList') = 'array' THEN
        RETURN parsed -> 'resourceList';
    END IF;
    RETURN '[]'::JSONB;
EXCEPTION WHEN OTHERS THEN
    RETURN '[]'::JSONB;
END;
$$;

WITH source_messages AS (
    SELECT message.message_id,
           message.session_id,
           message.creator_id,
           message.usage,
           COALESCE(message.create_time, CURRENT_TIMESTAMP) AS create_time,
           byai._v041_try_parse_jsonb(message.metadata) AS resource_list
    FROM byai.byai_message message
    JOIN byai.byai_session session
      ON session.session_id = message.session_id
     AND session.session_type = 'hs_as'
    WHERE message.metadata IS NOT NULL
      AND message.archived_at IS NULL
      AND message.creator_id IS NOT NULL
), resources AS (
    SELECT source.message_id,
           source.session_id,
           source.creator_id,
           source.usage,
           source.create_time,
           jsonb_array_elements(resource_list) AS item
    FROM source_messages source
), validated_mentions AS (
    SELECT resource.message_id,
           resource.session_id,
           resource.creator_id,
           resource.usage,
           resource.create_time,
           CASE
               WHEN resource.item ->> 'resourceId' ~ '^[0-9]{1,19}$'
                AND (resource.item ->> 'resourceId')::NUMERIC BETWEEN 1 AND 9223372036854775807
                   THEN (resource.item ->> 'resourceId')::BIGINT
           END AS mentioned_user_id
    FROM resources resource
    WHERE resource.item ->> 'resourceType' = 'HUMAN'
)
INSERT INTO byai.byai_group_chat_mention (
    message_id, group_session_id, mentioned_user_id, creator_id, create_time
)
SELECT DISTINCT mention.message_id,
                mention.session_id,
                mention.mentioned_user_id,
                mention.creator_id,
                mention.create_time
FROM validated_mentions mention
WHERE mention.mentioned_user_id IS NOT NULL
  AND NOT (
      COALESCE(mention.usage, 0) = 1
      AND mention.creator_id = mention.mentioned_user_id
  )
  AND NOT EXISTS (
      SELECT 1
      FROM byai.byai_group_chat_mention existing
      WHERE existing.message_id = mention.message_id
        AND existing.mentioned_user_id = mention.mentioned_user_id
  );

DROP FUNCTION IF EXISTS byai._v041_try_parse_jsonb(TEXT);

CREATE INDEX IF NOT EXISTS idx_byai_message_session_message
    ON byai.byai_message (session_id, message_id);

CREATE INDEX IF NOT EXISTS idx_byai_message_session_ref
    ON byai.byai_message (session_id, message_ref);

COMMENT ON TABLE byai.byai_group_chat_execution IS '群聊 Agent 初始委派、幂等和恢复状态';
COMMENT ON COLUMN byai.byai_group_chat_execution.candidate_session_id IS '委派前创建的隔离候选会话，TASK 时直接作为 taskId';
COMMENT ON TABLE byai.byai_group_chat_task IS '可多轮人工干预的群聊任务';
COMMENT ON TABLE byai.byai_group_chat_task_publication IS '任务一次性完成发布的不可变快照';
COMMENT ON TABLE byai.byai_group_chat_mention IS '群消息中对真人用户的 mention 检索索引';
COMMENT ON COLUMN byai.byai_session_member.last_read_message_id IS '用户已实际阅读到的群消息标识';

-- Each continuation owns its immutable request and durable queue position.
CREATE TABLE IF NOT EXISTS byai.byai_group_chat_turn (
    execution_id         BIGINT       NOT NULL,
    group_session_id     BIGINT       NOT NULL,
    source_message_id    BIGINT       NOT NULL,
    reply_to_message_id  BIGINT,
    initiator_user_id    BIGINT       NOT NULL,
    target_agent_id      BIGINT       NOT NULL,
    candidate_session_id BIGINT       NOT NULL,
    status               VARCHAR(32)  NOT NULL,
    disposition          VARCHAR(16)  NOT NULL DEFAULT 'UNKNOWN',
    task_name            VARCHAR(255),
    ack_text             TEXT,
    disposition_time     TIMESTAMP,
    parent_execution_id  BIGINT,
    root_message_id      BIGINT       NOT NULL,
    trace_id             VARCHAR(255),
    gateway_session_id   VARCHAR(255),
    ack_message_id       BIGINT,
    answer_message_id    BIGINT,
    error_code           VARCHAR(128),
    error_message        TEXT,
    attempt              INTEGER      NOT NULL DEFAULT 0,
    create_time          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    start_time           TIMESTAMP,
    finish_time          TIMESTAMP,
    anchor_execution_id BIGINT NOT NULL,
    trigger_message_id BIGINT NOT NULL,
    input_message_id BIGINT NOT NULL,
    parent_turn_id BIGINT,
    sender_type VARCHAR(16) NOT NULL,
    sender_id BIGINT NOT NULL,
    hop_count INTEGER NOT NULL DEFAULT 0,
    phase VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
    input_content TEXT NOT NULL,
    input_metadata TEXT,
    public_boundary_message_id BIGINT NOT NULL,
    CONSTRAINT pk_byai_group_chat_turn PRIMARY KEY (execution_id),
    CONSTRAINT uk_group_turn_trigger_agent UNIQUE (trigger_message_id, target_agent_id),
    CONSTRAINT ck_group_turn_hop CHECK (hop_count BETWEEN 0 AND 6)
);
CREATE INDEX IF NOT EXISTS idx_group_turn_session_queue
    ON byai.byai_group_chat_turn (candidate_session_id, status, execution_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_group_turn_trace
    ON byai.byai_group_chat_turn (trace_id);

-- 发布卡片：任务最多一份待发布内容；上传进度用于失败后的安全重试。
CREATE TABLE IF NOT EXISTS byai.byai_group_chat_pending_publication (
    task_session_id BIGINT NOT NULL PRIMARY KEY,
    pending_publication_id BIGINT NOT NULL UNIQUE,
    text_content TEXT,
    source_files_json TEXT NOT NULL DEFAULT '[]',
    uploaded_files_json TEXT NOT NULL DEFAULT '{}',
    cloud_resource_id BIGINT,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_group_chat_pending_task FOREIGN KEY (task_session_id)
        REFERENCES byai.byai_group_chat_task (task_session_id)
);


-- 仅首条引用回复创建记录；独立根消息的 topic_id 不要求存在对应话题行。
CREATE TABLE IF NOT EXISTS byai.byai_group_chat_topic (
    topic_id BIGINT NOT NULL,
    group_session_id BIGINT NOT NULL,
    root_message_id BIGINT NOT NULL,
    last_message_id BIGINT NOT NULL,
    last_activity_at TIMESTAMP(3) NOT NULL,
    create_time TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_group_chat_topic PRIMARY KEY (topic_id),
    CONSTRAINT ck_group_chat_topic_root CHECK (topic_id = root_message_id)
);

CREATE INDEX IF NOT EXISTS idx_group_chat_topic_group_activity
    ON byai.byai_group_chat_topic
        (group_session_id, last_activity_at DESC, last_message_id DESC, topic_id DESC);

CREATE INDEX IF NOT EXISTS idx_byai_message_session_topic_time
    ON byai.byai_message (session_id, topic_id, create_time DESC, message_id DESC);

COMMENT ON COLUMN byai.byai_message.topic_id IS '群公开消息引用链根 message_id；独立消息也有归属，系统事件及私有消息为空';
COMMENT ON TABLE byai.byai_group_chat_topic IS '首次公开引用回复形成的话题，不维护消息计数';
COMMENT ON COLUMN byai.byai_group_chat_topic.last_activity_at IS '最近发言时间，列表直接按本字段排序，不动态聚合消息';

-- 工作组快速创建模板，绑定已有数字员工或数字员工组资源。
CREATE TABLE IF NOT EXISTS byai.byai_workgroup_template (
    template_id BIGINT PRIMARY KEY,
    template_name VARCHAR(100) NOT NULL,
    catalog_id BIGINT NOT NULL,
    summary VARCHAR(500) NOT NULL,
    default_group_name VARCHAR(100) NOT NULL,
    default_goal VARCHAR(500) NOT NULL,
    icon VARCHAR(64),
    sort_order INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
    version BIGINT NOT NULL DEFAULT 1,
    create_by BIGINT NOT NULL,
    update_by BIGINT NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workgroup_template_catalog
    ON byai.byai_workgroup_template (status, catalog_id, sort_order);

CREATE TABLE IF NOT EXISTS byai.byai_workgroup_template_resource (
    template_id BIGINT NOT NULL,
    resource_id BIGINT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (template_id, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_workgroup_template_resource_resource
    ON byai.byai_workgroup_template_resource (resource_id);

COMMENT ON TABLE byai.byai_workgroup_template IS '工作组快速创建模板；catalog_id 引用资产目录';
COMMENT ON TABLE byai.byai_workgroup_template_resource IS '模板包含的数字员工或数字员工组资源';

-- 桌面端安装包版本管理：原有 sys_app_version 只按 device_type 存一条最新记录，
-- 现在一条记录代表「平台 × 架构 × 渠道」的一个发布项，并补充安装包附件与发布状态。
-- device_type 的语义不能动（桌面端固定发 electron），平台/架构放新列。
ALTER TABLE byai.sys_app_version ALTER COLUMN app_version TYPE VARCHAR(32);
ALTER TABLE byai.sys_app_version ALTER COLUMN url TYPE VARCHAR(1000);
ALTER TABLE byai.sys_app_version ALTER COLUMN update_msg TYPE VARCHAR(2000);

-- OpenGauss 不支持 ALTER TABLE ... ADD COLUMN IF NOT EXISTS，这里直接加列（本迁移只执行一次）。
ALTER TABLE byai.sys_app_version ADD COLUMN platform VARCHAR(16);
ALTER TABLE byai.sys_app_version ADD COLUMN arch VARCHAR(16);
ALTER TABLE byai.sys_app_version ADD COLUMN channel VARCHAR(16) NOT NULL DEFAULT 'stable';
ALTER TABLE byai.sys_app_version ADD COLUMN file_name VARCHAR(255);
ALTER TABLE byai.sys_app_version ADD COLUMN file_size BIGINT;
ALTER TABLE byai.sys_app_version ADD COLUMN sha256 VARCHAR(64);
-- 历史数据视为已发布，避免新增过滤条件后已发布的桌面端收不到更新。
ALTER TABLE byai.sys_app_version ADD COLUMN release_status VARCHAR(16) NOT NULL DEFAULT 'published';
ALTER TABLE byai.sys_app_version ADD COLUMN create_by BIGINT;
ALTER TABLE byai.sys_app_version ADD COLUMN update_by BIGINT;
ALTER TABLE byai.sys_app_version ADD COLUMN create_time TIMESTAMP;
ALTER TABLE byai.sys_app_version ADD COLUMN update_time TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_sys_app_version_release
    ON byai.sys_app_version (device_type, release_status, channel, platform, arch, publish_time DESC);

COMMENT ON COLUMN byai.sys_app_version.platform IS 'windows/macos；本期只做桌面端，device_type 固定 electron';
COMMENT ON COLUMN byai.sys_app_version.channel IS '发布渠道：stable/beta/dev';
COMMENT ON COLUMN byai.sys_app_version.url IS '安装包存储地址；http 开头为外部地址，其余走 /api/v1/appVersion/package/{versionId} 免登录下载';
COMMENT ON COLUMN byai.sys_app_version.release_status IS 'draft/published/offline；只有 published 会被 /latest 返回';

-- 群消息“收到”确认：每个被@真人用户独立确认，确认不是新的群消息。
CREATE TABLE IF NOT EXISTS byai.byai_group_chat_message_ack (
    session_id BIGINT NOT NULL,
    message_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    acknowledged_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_group_chat_message_ack PRIMARY KEY (session_id, message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_chat_message_ack_message
    ON byai.byai_group_chat_message_ack (session_id, message_id, acknowledged_at);

COMMENT ON TABLE byai.byai_group_chat_message_ack IS '群消息被@真人用户的收到确认，不产生新消息';

-- 个人数字员工发布到官方推荐：源员工与官方副本独立维护，候选配置独立审核。
ALTER TABLE byai.ss_resource ADD COLUMN publication_source_id BIGINT;
ALTER TABLE byai.ss_resource ADD COLUMN publication_request_id BIGINT;
CREATE UNIQUE INDEX uq_employee_official_source
    ON byai.ss_resource (com_acct_id, publication_source_id);
COMMENT ON COLUMN byai.ss_resource.publication_source_id IS '来源个人数字员工ID，关联ss_resource.resource_id；仅官方员工副本填写，普通资源为空';
COMMENT ON COLUMN byai.ss_resource.publication_request_id IS '关联发布申请ID，关联digital_employee_publication.request_id；官方员工记录当前生效申请，技能副本记录创建该副本的申请';

CREATE TABLE byai.digital_employee_publication (
    request_id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    source_id BIGINT NOT NULL,
    author_id BIGINT NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    employee_name VARCHAR(512) NOT NULL,
    official_id BIGINT,
    status VARCHAR(16) NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    snapshot_json TEXT NOT NULL,
    dependencies_json TEXT NOT NULL,
    comment VARCHAR(2000),
    reviewer_id BIGINT,
    reviewer_name VARCHAR(255),
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    publish_error VARCHAR(2000),
    CONSTRAINT ck_employee_publication_status CHECK (status IN ('DRAFT','PENDING','APPLYING','PUBLISHED','REJECTED','WITHDRAWN','FAILED'))
);
CREATE INDEX idx_employee_publication_inbox
    ON byai.digital_employee_publication (tenant_id, status, updated_at DESC);
CREATE INDEX idx_employee_publication_source
    ON byai.digital_employee_publication (tenant_id, source_id, created_at DESC);
COMMENT ON TABLE byai.digital_employee_publication IS '数字员工发布申请、审核快照及发布结果；更新不修改在用版本';
COMMENT ON COLUMN byai.digital_employee_publication.request_id IS '发布申请ID，主键';
COMMENT ON COLUMN byai.digital_employee_publication.tenant_id IS '申请所属企业（租户）ID，用于发布数据隔离';
COMMENT ON COLUMN byai.digital_employee_publication.source_id IS '来源个人数字员工ID，关联ss_resource.resource_id；官方副本的更新申请仍保留此来源ID';
COMMENT ON COLUMN byai.digital_employee_publication.author_id IS '数字员工原创建者用户ID，用于作者署名及维护权限校验，不一定是本次申请的操作人';
COMMENT ON COLUMN byai.digital_employee_publication.author_name IS '数字员工原创建者姓名快照，用于作者署名展示';
COMMENT ON COLUMN byai.digital_employee_publication.employee_name IS '本次申请配置中的数字员工名称';
COMMENT ON COLUMN byai.digital_employee_publication.official_id IS '官方数字员工副本ID，关联ss_resource.resource_id；首次发布成功前为空，更新申请沿用已有官方副本ID';
COMMENT ON COLUMN byai.digital_employee_publication.status IS '申请状态：DRAFT草稿、PENDING待审核、APPLYING发布执行中、PUBLISHED已发布、REJECTED已驳回、WITHDRAWN已撤回、FAILED发布失败';
COMMENT ON COLUMN byai.digital_employee_publication.revision IS '申请修订号，初始为1，随申请变更递增，用于并发操作及重复提交校验';
COMMENT ON COLUMN byai.digital_employee_publication.snapshot_json IS '待发布数字员工配置快照，JSON格式；审核及发布以此快照为准';
COMMENT ON COLUMN byai.digital_employee_publication.dependencies_json IS '关联资源快照清单，JSON格式，包含资源处理方式、校验结果及待复制技能的文件位置和摘要';
COMMENT ON COLUMN byai.digital_employee_publication.comment IS '审核意见或处理说明，记录通过、驳回等操作的说明';
COMMENT ON COLUMN byai.digital_employee_publication.reviewer_id IS '审核操作人用户ID；管理员免人工审核发布时记录该管理员';
COMMENT ON COLUMN byai.digital_employee_publication.reviewer_name IS '审核操作人姓名快照；管理员免人工审核发布时记录该管理员';
COMMENT ON COLUMN byai.digital_employee_publication.reviewed_at IS '审核操作时间；管理员免人工审核发布时记录自动通过时间';
COMMENT ON COLUMN byai.digital_employee_publication.created_at IS '发布申请创建时间';
COMMENT ON COLUMN byai.digital_employee_publication.updated_at IS '发布申请最近更新时间；用于列表排序及发布执行超时判定';
COMMENT ON COLUMN byai.digital_employee_publication.publish_error IS '发布执行失败原因，供失败提示及管理员排查使用';

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_publication_active
    ON byai.digital_employee_publication (tenant_id, source_id)
    WHERE status IN ('DRAFT', 'PENDING', 'APPLYING', 'FAILED');

-- 撤回的持久化屏障和停止补偿；执行 ID 来自统一序列，覆盖 turn 及历史 execution。
CREATE TABLE IF NOT EXISTS byai.byai_group_chat_recall_stop (
    execution_id BIGINT PRIMARY KEY,
    session_id BIGINT NOT NULL,
    initiator_user_id BIGINT NOT NULL,
    trace_id VARCHAR(255),
    task_owned BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(16) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_recall_stop_pending
    ON byai.byai_group_chat_recall_stop(status, session_id);
-- 独立于群/任务行锁，避免 STOP 的同步回调与发送串行化发生锁反转。
CREATE TABLE IF NOT EXISTS byai.byai_group_chat_send_gate (
    session_id BIGINT PRIMARY KEY
);

-- 商业版本官方推荐资源收藏：仅新增独立表，不修改资源、授权或安装数据。
-- 收藏功能上线前执行本段；两个主键同时承担列表关联索引，避免逐资源统计收藏记录。

CREATE TABLE IF NOT EXISTS byai.byai_resource_favorite (
    com_acct_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    resource_id BIGINT NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_resource_favorite PRIMARY KEY (com_acct_id, user_id, resource_id)
);

CREATE TABLE IF NOT EXISTS byai.byai_resource_favorite_count (
    com_acct_id BIGINT NOT NULL,
    resource_id BIGINT NOT NULL,
    favorite_count BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT pk_byai_resource_favorite_count PRIMARY KEY (com_acct_id, resource_id),
    CONSTRAINT ck_resource_favorite_count_nonnegative CHECK (favorite_count >= 0)
);

COMMENT ON TABLE byai.byai_resource_favorite IS '商业版企业资源的用户收藏关系；不产生授权、申请或安装关系';
COMMENT ON COLUMN byai.byai_resource_favorite.com_acct_id IS '当前用户所属企业（租户）ID';
COMMENT ON COLUMN byai.byai_resource_favorite.user_id IS '收藏用户ID，来自服务端登录上下文';
COMMENT ON COLUMN byai.byai_resource_favorite.resource_id IS '收藏资源ID；支持数字员工、技能、知识、工具，技能组除外';
COMMENT ON COLUMN byai.byai_resource_favorite.create_time IS '收藏时间，重复收藏不改变原时间';
COMMENT ON TABLE byai.byai_resource_favorite_count IS '企业资源收藏总数，与收藏关系在同一事务中维护';
COMMENT ON COLUMN byai.byai_resource_favorite_count.com_acct_id IS '资源所属企业（租户）ID';
COMMENT ON COLUMN byai.byai_resource_favorite_count.resource_id IS '资源ID';
COMMENT ON COLUMN byai.byai_resource_favorite_count.favorite_count IS '收藏用户总数，关系实际新增或删除时才增减；不复用授权申请次数或技能使用次数';

-- 完善个人资料：复用客户线索，不扩展 po_users，不使用 SQL function 或数据回填。
-- openGauss 兼容：新增字段使用普通 ALTER；执行前检查字段与索引，仅执行尚未存在的 ADD COLUMN / CREATE INDEX。
ALTER TABLE byai.byai_customer_leads ADD COLUMN user_id BIGINT;
ALTER TABLE byai.byai_customer_leads ADD COLUMN profile_role VARCHAR(50);
ALTER TABLE byai.byai_customer_leads ADD COLUMN profile_interests TEXT;
CREATE UNIQUE INDEX uk_customer_leads_profile_user ON byai.byai_customer_leads(user_id);
COMMENT ON COLUMN byai.byai_customer_leads.user_id IS '个人资料所属登录用户；历史留资记录保持NULL';
COMMENT ON COLUMN byai.byai_customer_leads.profile_role IS '用户自填岗位分类，不修改岗位权限';
COMMENT ON COLUMN byai.byai_customer_leads.profile_interests IS '用户感兴趣的工作领域，JSON字符串数组';

ALTER TABLE byai.au_privilege_grant ADD PRIMARY KEY (privilege_grant_id);
ALTER TABLE byai.authorized_object_data_permissions ADD PRIMARY KEY (id);
ALTER TABLE byai.authorized_objects ADD PRIMARY KEY (id);
ALTER TABLE byai.byai_aimodel ADD PRIMARY KEY (model_id);
ALTER TABLE byai.byai_ai_prompt ADD PRIMARY KEY (prompt_id);
ALTER TABLE byai.byai_attach_file ADD PRIMARY KEY (attach_file_id);
ALTER TABLE byai.byai_customer_leads ADD PRIMARY KEY (id);
ALTER TABLE byai.byai_files ADD PRIMARY KEY (file_id);
ALTER TABLE byai.byai_mode_dig_rel ADD PRIMARY KEY (rel_id);
ALTER TABLE byai.byai_monitor_target ADD PRIMARY KEY (target_id);
ALTER TABLE byai.byai_notification ADD PRIMARY KEY (id);
ALTER TABLE byai.byai_sequence ADD PRIMARY KEY (sequence_id);
ALTER TABLE byai.byai_session ADD PRIMARY KEY (session_id);
ALTER TABLE byai.byai_session_ext ADD PRIMARY KEY (ext_id);
ALTER TABLE byai.byai_session_member ADD PRIMARY KEY (byai_session_member_id);
ALTER TABLE byai.byai_session_workspace ADD PRIMARY KEY (id);
ALTER TABLE byai.byai_showcase ADD PRIMARY KEY (id);
ALTER TABLE byai.byai_space_dir ADD PRIMARY KEY (dir_id);
ALTER TABLE byai.byai_space_dir_rel ADD PRIMARY KEY (dir_rel_id);
ALTER TABLE byai.byai_system_config ADD PRIMARY KEY (param_id);
ALTER TABLE byai.byai_system_config_list ADD PRIMARY KEY (param_id);
ALTER TABLE byai.byai_system_feedback ADD PRIMARY KEY (id);
ALTER TABLE byai.byai_tag_relation ADD PRIMARY KEY (relation_id);
ALTER TABLE byai.byai_track_log ADD PRIMARY KEY (trace_id);
ALTER TABLE byai.byai_web_crawl_archive_doc ADD PRIMARY KEY (doc_archive_id);
ALTER TABLE byai.byai_web_crawl_request ADD PRIMARY KEY (request_id);
ALTER TABLE byai.datacloud_login_type ADD PRIMARY KEY (login_type_id);
ALTER TABLE byai.datacloud_script ADD PRIMARY KEY (script_id);
ALTER TABLE byai.datacloud_script_category ADD PRIMARY KEY (category_id);
ALTER TABLE byai.datacloud_script_execution ADD PRIMARY KEY (execution_id);
ALTER TABLE byai.datacloud_script_history ADD PRIMARY KEY (history_id);
ALTER TABLE byai.datacloud_script_scenario ADD PRIMARY KEY (scenario_id);
ALTER TABLE byai.datacloud_script_step ADD PRIMARY KEY (step_id);
ALTER TABLE byai.datacloud_script_step_history ADD PRIMARY KEY (step_history_id);
ALTER TABLE byai.datacloud_script_template ADD PRIMARY KEY (template_id);
ALTER TABLE byai.datacloud_script_view ADD PRIMARY KEY (view_id);
ALTER TABLE byai.datacloud_target_script ADD PRIMARY KEY (target_script_id);
ALTER TABLE byai.default_data_permissions ADD PRIMARY KEY (id);
ALTER TABLE byai.digital_position_user_relation ADD PRIMARY KEY (dig_position_rel_id);
ALTER TABLE byai.feedback_msg_info ADD PRIMARY KEY (feedback_msg_id);
ALTER TABLE byai.function_menu_permission ADD PRIMARY KEY (id);
ALTER TABLE byai.log_exception_info ADD PRIMARY KEY (request_id);
ALTER TABLE byai.memory_library ADD PRIMARY KEY (library_id);
ALTER TABLE byai.men_res_com ADD PRIMARY KEY (res_com_id);
ALTER TABLE byai.men_task ADD PRIMARY KEY (task_id);
ALTER TABLE byai.men_task_catalog ADD PRIMARY KEY (task_catalog_id);
ALTER TABLE byai.men_task_rec_obj ADD PRIMARY KEY (task_rec_obj_id);
ALTER TABLE byai.men_task_status_log ADD PRIMARY KEY (task_status_log_id);
ALTER TABLE byai.permission_group_authorized_objects ADD PRIMARY KEY (id);
ALTER TABLE byai.permission_group_categories ADD PRIMARY KEY (id);
ALTER TABLE byai.permission_group_excluded_objects ADD PRIMARY KEY (id);
ALTER TABLE byai.permission_group_resources ADD PRIMARY KEY (id);
ALTER TABLE byai.permission_groups ADD PRIMARY KEY (id);
ALTER TABLE byai.po_login_log ADD PRIMARY KEY (log_id);
ALTER TABLE byai.po_manage_log ADD PRIMARY KEY (log_id);
ALTER TABLE byai.po_organization ADD PRIMARY KEY (org_id);
ALTER TABLE byai.po_org_external_system ADD PRIMARY KEY (po_org_external_system_id);
ALTER TABLE byai.po_position ADD PRIMARY KEY (position_id);
ALTER TABLE byai.po_position_external ADD PRIMARY KEY (position_external_id);
ALTER TABLE byai.po_safe_account_msg ADD PRIMARY KEY (msg_id);
ALTER TABLE byai.po_source_system ADD PRIMARY KEY (po_external_system_id);
ALTER TABLE byai.po_station ADD PRIMARY KEY (station_id);
ALTER TABLE byai.po_user_access_token ADD PRIMARY KEY (user_access_token_id);
ALTER TABLE byai.po_user_external_system ADD PRIMARY KEY (id);
ALTER TABLE byai.po_users ADD PRIMARY KEY (user_id);
ALTER TABLE byai.po_users_organization ADD PRIMARY KEY (id);
ALTER TABLE byai.po_users_organization_external_system ADD PRIMARY KEY (po_users_organization_external_id);
ALTER TABLE byai.query_config ADD PRIMARY KEY (query_id);
ALTER TABLE byai.resource_attribute_permissions ADD PRIMARY KEY (id);
ALTER TABLE byai.resource_rule_enabled ADD PRIMARY KEY (resource_template_id);
ALTER TABLE byai.resource_template_relation ADD PRIMARY KEY (resource_template_id);
ALTER TABLE byai.ss_res_ext_agent ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_attribute ADD PRIMARY KEY (ext_attribute_id);
ALTER TABLE byai.ss_res_ext_db ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_dbdataset ADD PRIMARY KEY (dataset_id);
ALTER TABLE byai.ss_res_ext_dig_employee ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_doc ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_evaluate ADD PRIMARY KEY (evaluate_id);
ALTER TABLE byai.ss_res_ext_mcp ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_mcpserver ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_mcptool ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_object ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_test_set ADD PRIMARY KEY (test_set_id);
ALTER TABLE byai.ss_res_ext_tool ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_toolkit ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_res_ext_view ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_resource ADD PRIMARY KEY (resource_id);
ALTER TABLE byai.ss_resource_catalog ADD PRIMARY KEY (catalog_id);
ALTER TABLE byai.ss_resource_oper_log ADD PRIMARY KEY (resource_oper_log_id);
ALTER TABLE byai.ss_resource_rel_detail ADD PRIMARY KEY (resource_rel_detail_id);
ALTER TABLE byai.ss_resource_version ADD PRIMARY KEY (resource_version_id);
ALTER TABLE byai.ss_res_position_relation ADD PRIMARY KEY (resource_position_rel_id);
ALTER TABLE byai.ss_superassist_kw_catalog ADD PRIMARY KEY (kw_catalog_id);
ALTER TABLE byai.suas_superassist ADD PRIMARY KEY (superassist_id);
ALTER TABLE byai.suas_superassist_resource_privilege ADD PRIMARY KEY (id);
ALTER TABLE byai.suas_superassist_sub_agent ADD PRIMARY KEY (superassist_sub_agent_id);
ALTER TABLE byai.sys_app_version ADD PRIMARY KEY (version_id);
ALTER TABLE byai.template_rule_info ADD PRIMARY KEY (template_id);

delete byai.byai_system_config_list where param_group_code in('MODEL_TAGS') and param_value ='7';
INSERT INTO byai.byai_system_config_list (param_id, param_group_code, param_group_name, param_name, param_en_name, param_value, param_desc, param_seq) VALUES(nextval('byai.seq_any_table'), 'MODEL_TAGS', '模型打标', '多模态模型', 'MULTIMODAL_MODEL', '7', '多模态模型', 7);

