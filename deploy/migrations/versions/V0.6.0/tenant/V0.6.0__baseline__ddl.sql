-- V0.6.0 complete tenant candidate snapshot captured from PostgreSQL 17.11.
-- Validate on the target openGauss version before release. No data or runtime marker is included.
CREATE SCHEMA IF NOT EXISTS byai;

CREATE SEQUENCE byai.byai_message_relobj_id_seq INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 NO CYCLE;

CREATE SEQUENCE byai.seq_any_table INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 NO CYCLE;

CREATE TABLE byai.byai_group_chat_execution (
    execution_id bigint NOT NULL,
    group_session_id bigint NOT NULL,
    source_message_id bigint NOT NULL,
    reply_to_message_id bigint,
    initiator_user_id bigint NOT NULL,
    target_agent_id bigint NOT NULL,
    candidate_session_id bigint NOT NULL,
    status character varying(32) NOT NULL,
    disposition character varying(16) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    task_name character varying(255),
    ack_text text,
    disposition_time timestamp without time zone,
    parent_execution_id bigint,
    root_message_id bigint NOT NULL,
    trace_id character varying(255),
    gateway_session_id character varying(255),
    ack_message_id bigint,
    answer_message_id bigint,
    error_code character varying(128),
    error_message text,
    attempt integer DEFAULT 0 NOT NULL,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    start_time timestamp without time zone,
    finish_time timestamp without time zone
);

CREATE TABLE byai.byai_group_chat_execution_event (
    execution_id bigint NOT NULL,
    event_id character varying(255) NOT NULL,
    event_type character varying(64),
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE byai.byai_group_chat_forward_item (
    item_id bigint NOT NULL,
    enterprise_id bigint NOT NULL,
    request_id bigint NOT NULL,
    target_id bigint NOT NULL,
    ordinal integer NOT NULL,
    selected_message_id bigint NOT NULL,
    selected_merged_card boolean NOT NULL,
    source_message_id bigint NOT NULL,
    content text NOT NULL,
    speaker_json text NOT NULL,
    source_created_at timestamp without time zone NOT NULL,
    references_json text DEFAULT '[]'::text NOT NULL,
    attachments_json text DEFAULT '[]'::text NOT NULL,
    bound_message_id bigint,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE byai.byai_group_chat_forward_request (
    request_id bigint NOT NULL,
    enterprise_id bigint NOT NULL,
    actor_user_id bigint NOT NULL,
    backend character varying(16) NOT NULL,
    source_session_id bigint NOT NULL,
    client_request_id character varying(64) NOT NULL,
    mode character varying(16) NOT NULL,
    request_hash character(64) NOT NULL,
    state character varying(32) DEFAULT 'RUNNING'::character varying NOT NULL,
    snapshot_version integer NOT NULL,
    frozen_json text NOT NULL,
    source_manifest_json text DEFAULT '[]'::text NOT NULL,
    sources_frozen boolean DEFAULT false NOT NULL,
    lease_owner character varying(128),
    fencing_version bigint DEFAULT 0 NOT NULL,
    lease_until timestamp without time zone,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE byai.byai_group_chat_forward_target (
    target_id bigint NOT NULL,
    enterprise_id bigint NOT NULL,
    request_id bigint NOT NULL,
    target_session_id bigint NOT NULL,
    state character varying(16) DEFAULT 'PENDING'::character varying NOT NULL,
    lease_owner character varying(128),
    fencing_version bigint DEFAULT 0 NOT NULL,
    lease_until timestamp without time zone,
    checkpoint_json text DEFAULT '{}'::text NOT NULL,
    message_ids_json text DEFAULT '[]'::text NOT NULL,
    error_code character varying(128),
    retryable boolean DEFAULT false NOT NULL,
    pending_delivery boolean DEFAULT false NOT NULL,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE byai.byai_group_chat_mention (
    message_id bigint NOT NULL,
    group_session_id bigint NOT NULL,
    mentioned_user_id bigint NOT NULL,
    creator_id bigint NOT NULL,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE byai.byai_group_chat_message_ack (
    session_id bigint NOT NULL,
    message_id bigint NOT NULL,
    user_id bigint NOT NULL,
    user_name character varying(255) NOT NULL,
    acknowledged_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE byai.byai_group_chat_pending_publication (
    task_session_id bigint NOT NULL,
    pending_publication_id bigint NOT NULL,
    text_content text,
    source_files_json text DEFAULT '[]'::text NOT NULL,
    uploaded_files_json text DEFAULT '{}'::text NOT NULL,
    cloud_resource_id bigint,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE byai.byai_group_chat_task (
    task_session_id bigint NOT NULL,
    group_session_id bigint NOT NULL,
    source_message_id bigint NOT NULL,
    dispatch_id bigint NOT NULL,
    initiator_user_id bigint NOT NULL,
    target_agent_id bigint NOT NULL,
    task_name character varying(255) NOT NULL,
    status character varying(32) NOT NULL,
    turn_status character varying(32) NOT NULL,
    publish_message_id bigint,
    publish_by bigint,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    update_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    current_turn_id bigint,
    current_turn_trace_id character varying(255)
);

CREATE TABLE byai.byai_group_chat_task_publication (
    pending_publication_id bigint,
    task_session_id bigint NOT NULL,
    group_session_id bigint NOT NULL,
    message_id bigint NOT NULL,
    publisher_user_id bigint NOT NULL,
    text_content text,
    files_json text,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE byai.byai_group_chat_topic (
    topic_id bigint NOT NULL,
    group_session_id bigint NOT NULL,
    root_message_id bigint NOT NULL,
    last_message_id bigint NOT NULL,
    last_activity_at timestamp(3) without time zone NOT NULL,
    create_time timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE byai.byai_group_chat_turn (
    execution_id bigint NOT NULL,
    group_session_id bigint NOT NULL,
    source_message_id bigint NOT NULL,
    reply_to_message_id bigint,
    initiator_user_id bigint NOT NULL,
    target_agent_id bigint NOT NULL,
    candidate_session_id bigint NOT NULL,
    status character varying(32) NOT NULL,
    disposition character varying(16) DEFAULT 'UNKNOWN'::character varying NOT NULL,
    task_name character varying(255),
    ack_text text,
    disposition_time timestamp without time zone,
    parent_execution_id bigint,
    root_message_id bigint NOT NULL,
    trace_id character varying(255),
    gateway_session_id character varying(255),
    ack_message_id bigint,
    answer_message_id bigint,
    error_code character varying(128),
    error_message text,
    attempt integer DEFAULT 0 NOT NULL,
    create_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    start_time timestamp without time zone,
    finish_time timestamp without time zone,
    anchor_execution_id bigint NOT NULL,
    trigger_message_id bigint NOT NULL,
    input_message_id bigint NOT NULL,
    parent_turn_id bigint,
    sender_type character varying(16) NOT NULL,
    sender_id bigint NOT NULL,
    hop_count integer DEFAULT 0 NOT NULL,
    phase character varying(32) DEFAULT 'NORMAL'::character varying NOT NULL,
    input_content text NOT NULL,
    input_metadata text,
    public_boundary_message_id bigint NOT NULL
);

CREATE TABLE byai.byai_message (
    id bigint NOT NULL,
    access_terminal character varying(256),
    append_index bigint,
    archived_at timestamp without time zone,
    belong_date date,
    call_logs text,
    create_time timestamp without time zone,
    creator_id bigint,
    creator_name text,
    enterprise_id bigint,
    final_content text,
    final_message_struct text,
    infer_log text,
    is_complete boolean,
    message_content text,
    message_id bigint,
    message_ref bigint,
    message_struct text,
    metadata text,
    msg_status integer,
    project_id bigint,
    rel_message_id bigint,
    rel_objs text,
    related_resources text,
    res_com_id bigint,
    res_com_ids text,
    role text,
    session_id bigint,
    task_id bigint,
    update_time timestamp without time zone,
    usage integer,
    doc_access_terminal character varying(256),
    doc_belong_date date,
    doc_create_time character varying(256),
    doc_creator_id bigint,
    doc_infer_log text,
    doc_is_complete boolean,
    doc_message_content text,
    doc_message_id bigint,
    doc_message_struct text,
    doc_metadata text,
    doc_msg_status bigint,
    doc_project_id bigint,
    doc_related_resources text,
    doc_res_com_ids text,
    doc_session_id bigint,
    doc_task_id bigint,
    doc_usage bigint,
    topic_id bigint,
    recalled_at timestamp(3) without time zone,
    recalled_by bigint,
    created_seq bigint,
    storage_version bigint DEFAULT 1 NOT NULL,
    last_mirror_event_seq bigint DEFAULT 0 NOT NULL,
    last_mirror_event_id character varying(128),
    client_request_id character varying(64),
    run_id character varying(64),
    answer_message_id bigint,
    persist_command_id character varying(64),
    persist_hash character(64)
);

CREATE TABLE byai.byai_message_relobj (
    id bigint DEFAULT nextval('byai.byai_message_relobj_id_seq'::regclass) NOT NULL,
    ask_access_terminal character varying(256),
    ask_content text,
    ask_content_tags character varying(256),
    ask_content_vector text,
    ask_msg_id bigint,
    ask_obj_id bigint,
    ask_obj_type character varying(256),
    ask_time timestamp without time zone,
    com_acct_id bigint,
    create_time timestamp without time zone,
    feedback_content text,
    feedback_label character varying(256),
    feedback_score double precision,
    feedback_time timestamp without time zone,
    feedback_type character varying(256),
    first_text_duration double precision,
    input_token_count double precision,
    output_token_count double precision,
    output_token_per_second double precision,
    project_id bigint,
    rel_id bigint,
    request_status integer,
    res_access_terminal character varying(256),
    res_content text,
    res_content_tags character varying(256),
    res_content_vector text,
    res_msg_id bigint,
    res_obj_id bigint,
    res_obj_type character varying(256),
    res_time timestamp without time zone,
    session_id bigint,
    task_due_time double precision,
    task_id bigint,
    doc_ask_access_terminal text,
    doc_ask_content text,
    doc_ask_msg_id bigint,
    doc_ask_obj_id bigint,
    doc_ask_obj_type text,
    doc_ask_time text,
    doc_com_acct_id bigint,
    doc_create_time text,
    doc_feedback_type text,
    doc_first_text_duration double precision,
    doc_input_token_count double precision,
    doc_output_token_count double precision,
    doc_output_token_per_second double precision,
    doc_project_id bigint,
    doc_request_status bigint,
    doc_res_access_terminal text,
    doc_res_content text,
    doc_res_msg_id bigint,
    doc_res_obj_id bigint,
    doc_res_obj_type text,
    doc_res_time text,
    doc_session_id bigint,
    doc_task_due_time double precision,
    doc_task_id bigint
);

CREATE TABLE byai.byai_session (
    session_id bigint,
    parent_session_id bigint,
    session_name character varying(255),
    create_time timestamp without time zone,
    creator_id bigint,
    object_type character varying(255),
    object_id bigint,
    enterprise_id bigint,
    session_content text,
    is_debug integer,
    session_type character varying(10),
    update_by bigint,
    update_time timestamp without time zone,
    state text,
    project_id bigint DEFAULT '-1'::integer NOT NULL,
    last_seq bigint DEFAULT 0 NOT NULL
);

CREATE TABLE byai.byai_session_ext (
    ext_id bigint,
    session_id bigint,
    ext_param_name character varying(255),
    ext_param_code character varying(255),
    ext_param_value text
);

CREATE TABLE byai.byai_session_member (
    byai_session_member_id bigint,
    session_id bigint,
    mem_obj_type character varying(32),
    mem_obj_id bigint,
    user_role character varying(10),
    create_time timestamp without time zone,
    creator_id bigint,
    com_acct_id bigint,
    mem_name character varying,
    request_count bigint,
    last_read_message_id bigint,
    last_read_time timestamp without time zone,
    welcome_handled_at timestamp without time zone
);

CREATE TABLE byai.byai_session_workspace (
    id bigint,
    session_id bigint,
    name character varying,
    rel_count integer,
    create_time timestamp without time zone,
    create_by bigint,
    update_time timestamp without time zone,
    update_by bigint,
    icon character varying,
    file_id bigint,
    file_url character varying,
    is_exist smallint
);

ALTER TABLE byai.byai_group_chat_execution ADD CONSTRAINT pk_byai_group_chat_execution PRIMARY KEY (execution_id);

ALTER TABLE byai.byai_group_chat_execution ADD CONSTRAINT uk_group_chat_execution_candidate UNIQUE (candidate_session_id);

ALTER TABLE byai.byai_group_chat_execution ADD CONSTRAINT uk_group_chat_execution_source_agent UNIQUE (source_message_id, target_agent_id);

ALTER TABLE byai.byai_group_chat_execution_event ADD CONSTRAINT pk_group_chat_execution_event PRIMARY KEY (execution_id, event_id);

ALTER TABLE byai.byai_group_chat_forward_item ADD CONSTRAINT byai_group_chat_forward_item_ordinal_check CHECK ((ordinal >= 0));

ALTER TABLE byai.byai_group_chat_forward_item ADD CONSTRAINT byai_group_chat_forward_item_pkey PRIMARY KEY (item_id);

ALTER TABLE byai.byai_group_chat_forward_item ADD CONSTRAINT uq_forward_item_ordinal UNIQUE (target_id, ordinal);

ALTER TABLE byai.byai_group_chat_forward_request ADD CONSTRAINT byai_group_chat_forward_request_backend_check CHECK (backend IN ('LEGACY','TENANT'));

ALTER TABLE byai.byai_group_chat_forward_request ADD CONSTRAINT byai_group_chat_forward_request_fencing_version_check CHECK ((fencing_version >= 0));

ALTER TABLE byai.byai_group_chat_forward_request ADD CONSTRAINT byai_group_chat_forward_request_mode_check CHECK (mode IN ('SINGLE','MERGED'));

ALTER TABLE byai.byai_group_chat_forward_request ADD CONSTRAINT byai_group_chat_forward_request_pkey PRIMARY KEY (request_id);

ALTER TABLE byai.byai_group_chat_forward_request ADD CONSTRAINT byai_group_chat_forward_request_state_check CHECK (state IN ('RUNNING','SUCCEEDED','PARTIAL_FAILED','FAILED'));

ALTER TABLE byai.byai_group_chat_forward_request ADD CONSTRAINT uq_forward_request_actor_key UNIQUE (enterprise_id, actor_user_id, client_request_id);

ALTER TABLE byai.byai_group_chat_forward_request ADD CONSTRAINT uq_forward_request_tenant UNIQUE (enterprise_id, request_id);

ALTER TABLE byai.byai_group_chat_forward_target ADD CONSTRAINT byai_group_chat_forward_target_fencing_version_check CHECK ((fencing_version >= 0));

ALTER TABLE byai.byai_group_chat_forward_target ADD CONSTRAINT byai_group_chat_forward_target_pkey PRIMARY KEY (target_id);

ALTER TABLE byai.byai_group_chat_forward_target ADD CONSTRAINT byai_group_chat_forward_target_state_check CHECK (state IN ('PENDING','COPYING','READY','SUCCEEDED','FAILED'));

ALTER TABLE byai.byai_group_chat_forward_target ADD CONSTRAINT uq_forward_target_group UNIQUE (request_id, target_session_id);

ALTER TABLE byai.byai_group_chat_forward_target ADD CONSTRAINT uq_forward_target_tenant UNIQUE (enterprise_id, request_id, target_id);

ALTER TABLE byai.byai_group_chat_mention ADD CONSTRAINT pk_byai_group_chat_mention PRIMARY KEY (message_id, mentioned_user_id);

ALTER TABLE byai.byai_group_chat_message_ack ADD CONSTRAINT pk_byai_group_chat_message_ack PRIMARY KEY (session_id, message_id, user_id);

ALTER TABLE byai.byai_group_chat_pending_publication ADD CONSTRAINT byai_group_chat_pending_publication_pending_publication_id_key UNIQUE (pending_publication_id);

ALTER TABLE byai.byai_group_chat_pending_publication ADD CONSTRAINT byai_group_chat_pending_publication_pkey PRIMARY KEY (task_session_id);

ALTER TABLE byai.byai_group_chat_task ADD CONSTRAINT pk_byai_group_chat_task PRIMARY KEY (task_session_id);

ALTER TABLE byai.byai_group_chat_task ADD CONSTRAINT uk_group_chat_task_dispatch UNIQUE (dispatch_id);

ALTER TABLE byai.byai_group_chat_task_publication ADD CONSTRAINT pk_byai_group_chat_task_publication PRIMARY KEY (task_session_id);

ALTER TABLE byai.byai_group_chat_task_publication ADD CONSTRAINT uk_group_chat_task_publication_message UNIQUE (message_id);

ALTER TABLE byai.byai_group_chat_topic ADD CONSTRAINT ck_group_chat_topic_root CHECK ((topic_id = root_message_id));

ALTER TABLE byai.byai_group_chat_topic ADD CONSTRAINT pk_byai_group_chat_topic PRIMARY KEY (topic_id);

ALTER TABLE byai.byai_group_chat_turn ADD CONSTRAINT ck_group_turn_hop CHECK (((hop_count >= 0) AND (hop_count <= 6)));

ALTER TABLE byai.byai_group_chat_turn ADD CONSTRAINT pk_byai_group_chat_turn PRIMARY KEY (execution_id);

ALTER TABLE byai.byai_group_chat_turn ADD CONSTRAINT uk_group_turn_trigger_agent UNIQUE (trigger_message_id, target_agent_id);

ALTER TABLE byai.byai_message ADD CONSTRAINT byai_message_pkey PRIMARY KEY (id);

ALTER TABLE byai.byai_message_relobj ADD CONSTRAINT byai_message_relobj_pkey PRIMARY KEY (id);

ALTER TABLE byai.byai_group_chat_execution_event ADD CONSTRAINT fk_group_chat_execution_event_execution FOREIGN KEY (execution_id) REFERENCES byai.byai_group_chat_execution(execution_id);

ALTER TABLE byai.byai_group_chat_forward_item ADD CONSTRAINT fk_forward_item_target FOREIGN KEY (enterprise_id, request_id, target_id) REFERENCES byai.byai_group_chat_forward_target(enterprise_id, request_id, target_id);

ALTER TABLE byai.byai_group_chat_forward_target ADD CONSTRAINT fk_forward_target_request FOREIGN KEY (enterprise_id, request_id) REFERENCES byai.byai_group_chat_forward_request(enterprise_id, request_id);

ALTER TABLE byai.byai_group_chat_pending_publication ADD CONSTRAINT fk_group_chat_pending_task FOREIGN KEY (task_session_id) REFERENCES byai.byai_group_chat_task(task_session_id);

CREATE INDEX idx_byai_message_session_message ON byai.byai_message USING btree (session_id, message_id);

CREATE INDEX idx_byai_message_session_ref ON byai.byai_message USING btree (session_id, message_ref);

CREATE INDEX idx_byai_message_session_topic_time ON byai.byai_message USING btree (session_id, topic_id, create_time DESC, message_id DESC);

CREATE INDEX idx_forward_item_message ON byai.byai_group_chat_forward_item USING btree (enterprise_id, bound_message_id, ordinal);

CREATE INDEX idx_forward_request_recovery ON byai.byai_group_chat_forward_request USING btree (enterprise_id, state, lease_until);

CREATE INDEX idx_forward_target_delivery ON byai.byai_group_chat_forward_target USING btree (enterprise_id, pending_delivery, target_id);

CREATE INDEX idx_forward_target_recovery ON byai.byai_group_chat_forward_target USING btree (enterprise_id, state, lease_until);

CREATE INDEX idx_group_chat_execution_group_time ON byai.byai_group_chat_execution USING btree (group_session_id, create_time);

CREATE INDEX idx_group_chat_execution_status ON byai.byai_group_chat_execution USING btree (status, create_time);

CREATE INDEX idx_group_chat_execution_trace ON byai.byai_group_chat_execution USING btree (trace_id);

CREATE INDEX idx_group_chat_mention_user_group_message ON byai.byai_group_chat_mention USING btree (mentioned_user_id, group_session_id, message_id);

CREATE INDEX idx_group_chat_message_ack_message ON byai.byai_group_chat_message_ack USING btree (session_id, message_id, acknowledged_at);

CREATE INDEX idx_group_chat_task_group_time ON byai.byai_group_chat_task USING btree (group_session_id, create_time);

CREATE INDEX idx_group_chat_task_initiator_time ON byai.byai_group_chat_task USING btree (initiator_user_id, create_time);

CREATE INDEX idx_group_chat_task_running_turn ON byai.byai_group_chat_task USING btree (status, turn_status, task_session_id);

CREATE INDEX idx_group_chat_topic_group_activity ON byai.byai_group_chat_topic USING btree (group_session_id, last_activity_at DESC, last_message_id DESC, topic_id DESC);

CREATE INDEX idx_group_turn_session_queue ON byai.byai_group_chat_turn USING btree (candidate_session_id, status, execution_id);

CREATE INDEX idx_session_ext_operation_assignee ON byai.byai_session_ext USING btree (ext_param_value) WHERE ((ext_param_code)::text = 'oploop_assignee_id'::text);

CREATE INDEX idx_session_ext_operation_source ON byai.byai_session_ext USING btree (ext_param_value) WHERE ((ext_param_code)::text = 'oploop_source_id'::text);

CREATE INDEX idx_session_ext_operation_status ON byai.byai_session_ext USING btree (ext_param_value) WHERE ((ext_param_code)::text = 'oploop_task_status'::text);

CREATE UNIQUE INDEX uk_byai_session_member_object ON byai.byai_session_member USING btree (session_id, mem_obj_type, mem_obj_id);

CREATE UNIQUE INDEX uk_group_turn_trace ON byai.byai_group_chat_turn USING btree (trace_id);

CREATE UNIQUE INDEX uq_tenant_answer_run ON byai.byai_message USING btree (enterprise_id, run_id) WHERE ((usage = 2) AND (run_id IS NOT NULL));

CREATE UNIQUE INDEX uq_tenant_ask_answer_relation ON byai.byai_message_relobj USING btree (ask_msg_id, res_msg_id) WHERE ((ask_msg_id IS NOT NULL) AND (res_msg_id IS NOT NULL));

CREATE UNIQUE INDEX uq_tenant_input_request ON byai.byai_message USING btree (enterprise_id, creator_id, client_request_id) WHERE ((usage = 1) AND (client_request_id IS NOT NULL));

CREATE UNIQUE INDEX uq_tenant_message_business_id ON byai.byai_message USING btree (message_id);

CREATE UNIQUE INDEX uq_tenant_message_command ON byai.byai_message USING btree (persist_command_id) WHERE (persist_command_id IS NOT NULL);

CREATE UNIQUE INDEX uq_tenant_message_session_seq ON byai.byai_message USING btree (session_id, created_seq) WHERE (created_seq IS NOT NULL);

CREATE UNIQUE INDEX uq_tenant_reserved_answer ON byai.byai_message USING btree (answer_message_id) WHERE ((usage = 1) AND (answer_message_id IS NOT NULL));

CREATE UNIQUE INDEX uq_tenant_session_business_id ON byai.byai_session USING btree (session_id);

COMMENT ON TABLE byai.byai_group_chat_message_ack IS '群消息被@真人用户的收到确认，不产生新消息';

COMMENT ON COLUMN byai.byai_group_chat_forward_item.source_message_id IS 'Historical provenance, intentionally no source-message foreign key';

COMMENT ON COLUMN byai.byai_group_chat_forward_item.attachments_json IS 'Public target attachments; physical locators remain server-only in the target checkpoint';

COMMENT ON COLUMN byai.byai_group_chat_forward_request.frozen_json IS 'Immutable public template fields only; never serialize raw locator candidate metadata';

COMMENT ON COLUMN byai.byai_group_chat_forward_request.source_manifest_json IS 'Validated minimal source identities and immutable proofs; no credentials or signed URLs';

COMMENT ON COLUMN byai.byai_group_chat_forward_target.checkpoint_json IS 'Attempt-owned object manifest with attachmentId, attemptId, storageType, scopeId/root and path/key, plus progress and attachment mapping';

COMMENT ON COLUMN byai.byai_group_chat_task.current_turn_id IS '当前轮次启动占位标识，用于隔离迟到的启动失败回调';

COMMENT ON COLUMN byai.byai_group_chat_task.current_turn_trace_id IS '当前轮次实际trace，用于完成回调与落库结果补偿';

COMMENT ON COLUMN byai.byai_group_chat_task_publication.pending_publication_id IS '待发布内容ID';

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

COMMENT ON COLUMN byai.byai_session.project_id IS '平台工作组ID；-1表示默认项目';

COMMENT ON COLUMN byai.byai_session.last_seq IS '会话内最后提交的消息序号';

COMMENT ON COLUMN byai.byai_session_member.last_read_message_id IS '用户已读消息ID';

COMMENT ON COLUMN byai.byai_session_member.last_read_time IS '用户最近阅读时间';
