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

-- OpenGauss 不支持 ALTER TABLE ... ADD COLUMN IF NOT EXISTS，使用迁移内临时函数保持幂等。
CREATE OR REPLACE FUNCTION byai._v041_add_column_if_missing(
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

SELECT byai._v041_add_column_if_missing(
    'byai', 'byai_session_member', 'last_read_message_id', 'BIGINT'
);
SELECT byai._v041_add_column_if_missing(
    'byai', 'byai_session_member', 'last_read_time', 'TIMESTAMP'
);

DROP FUNCTION IF EXISTS byai._v041_add_column_if_missing(TEXT, TEXT, TEXT, TEXT);

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
