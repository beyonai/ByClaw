-- V0.5.0 tenant database baseline; applied only inside a tenant OpenGauss database.

CREATE SCHEMA IF NOT EXISTS byai;


CREATE SEQUENCE IF NOT EXISTS byai.byai_message_relobj_id_seq;
CREATE SEQUENCE IF NOT EXISTS byai.seq_any_table;

CREATE TABLE IF NOT EXISTS byai.byai_session (session_id bigint, parent_session_id bigint, session_name character varying(255), create_time timestamp without time zone, creator_id bigint, object_type character varying(255), object_id bigint, enterprise_id bigint, session_content text, is_debug integer, session_type character varying(10), update_by bigint, update_time timestamp without time zone, state text, project_id BIGINT NOT NULL DEFAULT -1, last_seq BIGINT NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS byai.byai_session_ext (ext_id bigint, session_id bigint, ext_param_name character varying(255), ext_param_code character varying(255), ext_param_value text);

CREATE TABLE IF NOT EXISTS byai.byai_session_member (byai_session_member_id bigint, session_id bigint, mem_obj_type character varying(32), mem_obj_id bigint, user_role character varying(10), create_time timestamp without time zone, creator_id bigint, com_acct_id bigint, mem_name character varying, request_count bigint, last_read_message_id BIGINT, last_read_time TIMESTAMP);

CREATE TABLE IF NOT EXISTS byai.byai_session_workspace (id bigint, session_id bigint, name character varying, rel_count integer, create_time timestamp without time zone, create_by bigint, update_time timestamp without time zone, update_by bigint, icon character varying, file_id bigint, file_url character varying, is_exist smallint);

CREATE TABLE IF NOT EXISTS byai.byai_message (id bigint NOT NULL PRIMARY KEY, access_terminal character varying(256), append_index bigint, archived_at timestamp without time zone, belong_date date, call_logs text, create_time timestamp without time zone, creator_id bigint, creator_name text, enterprise_id bigint, final_content text, final_message_struct text, infer_log text, is_complete boolean, message_content text, message_id bigint, message_ref bigint, message_struct text, metadata text, msg_status integer, project_id bigint, rel_message_id bigint, rel_objs text, related_resources text, res_com_id bigint, res_com_ids text, role text, session_id bigint, task_id bigint, update_time timestamp without time zone, usage integer, doc_access_terminal character varying(256), doc_belong_date date, doc_create_time character varying(256), doc_creator_id bigint, doc_infer_log text, doc_is_complete boolean, doc_message_content text, doc_message_id bigint, doc_message_struct text, doc_metadata text, doc_msg_status bigint, doc_project_id bigint, doc_related_resources text, doc_res_com_ids text, doc_session_id bigint, doc_task_id bigint, doc_usage bigint, topic_id BIGINT, recalled_at TIMESTAMP(3), recalled_by BIGINT, created_seq BIGINT, storage_version BIGINT NOT NULL DEFAULT 1, last_mirror_event_seq BIGINT NOT NULL DEFAULT 0, last_mirror_event_id VARCHAR(128), client_request_id VARCHAR(64), run_id VARCHAR(64), answer_message_id BIGINT, persist_command_id VARCHAR(64), persist_hash CHAR(64));

CREATE TABLE IF NOT EXISTS byai.byai_message_relobj (id bigint NOT NULL DEFAULT nextval('byai.byai_message_relobj_id_seq'::regclass) PRIMARY KEY, ask_access_terminal character varying(256), ask_content text, ask_content_tags character varying(256), ask_content_vector text, ask_msg_id bigint, ask_obj_id bigint, ask_obj_type character varying(256), ask_time timestamp without time zone, com_acct_id bigint, create_time timestamp without time zone, feedback_content text, feedback_label character varying(256), feedback_score double precision, feedback_time timestamp without time zone, feedback_type character varying(256), first_text_duration double precision, input_token_count double precision, output_token_count double precision, output_token_per_second double precision, project_id bigint, rel_id bigint, request_status integer, res_access_terminal character varying(256), res_content text, res_content_tags character varying(256), res_content_vector text, res_msg_id bigint, res_obj_id bigint, res_obj_type character varying(256), res_time timestamp without time zone, session_id bigint, task_due_time double precision, task_id bigint, doc_ask_access_terminal text, doc_ask_content text, doc_ask_msg_id bigint, doc_ask_obj_id bigint, doc_ask_obj_type text, doc_ask_time text, doc_com_acct_id bigint, doc_create_time text, doc_feedback_type text, doc_first_text_duration double precision, doc_input_token_count double precision, doc_output_token_count double precision, doc_output_token_per_second double precision, doc_project_id bigint, doc_request_status bigint, doc_res_access_terminal text, doc_res_content text, doc_res_msg_id bigint, doc_res_obj_id bigint, doc_res_obj_type text, doc_res_time text, doc_session_id bigint, doc_task_due_time double precision, doc_task_id bigint);

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

CREATE TABLE IF NOT EXISTS byai.byai_group_chat_task_publication (
    pending_publication_id BIGINT,
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

CREATE TABLE IF NOT EXISTS byai.byai_group_chat_mention (
    message_id           BIGINT      NOT NULL,
    group_session_id     BIGINT      NOT NULL,
    mentioned_user_id    BIGINT      NOT NULL,
    creator_id           BIGINT      NOT NULL,
    create_time          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_byai_group_chat_mention PRIMARY KEY (message_id, mentioned_user_id)
);

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


COMMENT ON COLUMN byai.byai_session.project_id IS '平台工作组ID；-1表示默认项目';

COMMENT ON COLUMN byai.byai_session.last_seq IS '会话内最后提交的消息序号';

COMMENT ON COLUMN byai.byai_session_member.last_read_message_id IS '用户已读消息ID';

COMMENT ON COLUMN byai.byai_session_member.last_read_time IS '用户最近阅读时间';

COMMENT ON COLUMN byai.byai_message.topic_id IS '群消息话题根ID';

COMMENT ON COLUMN byai.byai_message.recalled_at IS '消息撤回时间';

COMMENT ON COLUMN byai.byai_message.recalled_by IS '撤回操作人ID';

COMMENT ON COLUMN byai.byai_message.created_seq IS '消息在会话内的提交序号';

COMMENT ON COLUMN byai.byai_message.storage_version IS '消息持久化版本';

COMMENT ON COLUMN byai.byai_message.last_mirror_event_seq IS '非Gateway出站镜像已提交的最大事件序号';

COMMENT ON COLUMN byai.byai_message.last_mirror_event_id IS 'Gateway出站镜像最近提交的源Stream事件ID';

COMMENT ON COLUMN byai.byai_message.client_request_id IS '用户入站请求幂等ID';

COMMENT ON COLUMN byai.byai_message.run_id IS 'AI生成运行ID';

COMMENT ON COLUMN byai.byai_message.answer_message_id IS '预留的回答业务ID';

COMMENT ON COLUMN byai.byai_message.persist_command_id IS 'Node持久化命令幂等ID';

COMMENT ON COLUMN byai.byai_message.persist_hash IS '持久化正文及关键字段SHA-256摘要';

COMMENT ON COLUMN byai.byai_group_chat_task_publication.pending_publication_id IS '待发布内容ID';

CREATE INDEX IF NOT EXISTS idx_group_chat_execution_status ON byai.byai_group_chat_execution(status, create_time);
CREATE INDEX IF NOT EXISTS idx_group_chat_execution_group_time ON byai.byai_group_chat_execution(group_session_id, create_time);
CREATE INDEX IF NOT EXISTS idx_group_chat_execution_trace ON byai.byai_group_chat_execution(trace_id);
CREATE INDEX IF NOT EXISTS idx_group_chat_task_group_time ON byai.byai_group_chat_task(group_session_id, create_time);
CREATE INDEX IF NOT EXISTS idx_group_chat_task_initiator_time ON byai.byai_group_chat_task(initiator_user_id, create_time);
CREATE INDEX IF NOT EXISTS idx_group_chat_mention_user_group_message ON byai.byai_group_chat_mention(mentioned_user_id, group_session_id, message_id);
CREATE INDEX IF NOT EXISTS idx_group_turn_session_queue ON byai.byai_group_chat_turn(candidate_session_id, status, execution_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_group_turn_trace ON byai.byai_group_chat_turn(trace_id);
CREATE INDEX IF NOT EXISTS idx_group_chat_topic_group_activity ON byai.byai_group_chat_topic(group_session_id, last_activity_at DESC, last_message_id DESC, topic_id DESC);
CREATE INDEX IF NOT EXISTS idx_session_ext_operation_source ON byai.byai_session_ext(ext_param_value) WHERE ext_param_code = 'oploop_source_id';
CREATE INDEX IF NOT EXISTS idx_session_ext_operation_status ON byai.byai_session_ext(ext_param_value) WHERE ext_param_code = 'oploop_task_status';
CREATE INDEX IF NOT EXISTS idx_session_ext_operation_assignee ON byai.byai_session_ext(ext_param_value) WHERE ext_param_code = 'oploop_assignee_id';

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_session_business_id ON byai.byai_session(session_id);

CREATE UNIQUE INDEX IF NOT EXISTS uk_byai_session_member_object ON byai.byai_session_member(session_id, mem_obj_type, mem_obj_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_message_business_id ON byai.byai_message(message_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_message_command ON byai.byai_message(persist_command_id) WHERE persist_command_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_input_request ON byai.byai_message(enterprise_id, creator_id, client_request_id) WHERE usage = 1 AND client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_reserved_answer ON byai.byai_message(answer_message_id) WHERE usage = 1 AND answer_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_answer_run ON byai.byai_message(enterprise_id, run_id) WHERE usage = 2 AND run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_message_session_seq ON byai.byai_message(session_id, created_seq) WHERE created_seq IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_ask_answer_relation ON byai.byai_message_relobj(ask_msg_id, res_msg_id) WHERE ask_msg_id IS NOT NULL AND res_msg_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_byai_message_session_message ON byai.byai_message(session_id, message_id);

CREATE INDEX IF NOT EXISTS idx_byai_message_session_ref ON byai.byai_message(session_id, message_ref);

CREATE INDEX IF NOT EXISTS idx_byai_message_session_topic_time ON byai.byai_message(session_id, topic_id, create_time DESC, message_id DESC);
