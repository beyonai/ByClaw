-- 私聊入口按原群、发起人和员工绑定，已有会话在首次重新打开时绑定，保留历史消息。
CREATE TABLE byai.byai_group_chat_direct_binding (
    group_session_id BIGINT NOT NULL,
    initiator_user_id BIGINT NOT NULL,
    target_agent_id BIGINT NOT NULL,
    task_session_id BIGINT NOT NULL,
    CONSTRAINT pk_group_chat_direct_binding PRIMARY KEY (group_session_id, initiator_user_id, target_agent_id),
    CONSTRAINT uk_group_chat_direct_binding_session UNIQUE (task_session_id)
);
COMMENT ON TABLE byai.byai_group_chat_direct_binding IS '群内私聊的固定会话标识，由服务端复用';

-- 一张确认卡只产生一条群消息，同一私聊可以保留多份独立的确认回执。
CREATE TABLE byai.byai_group_chat_private_publication (
    task_session_id BIGINT NOT NULL,
    pending_publication_id BIGINT NOT NULL,
    group_session_id BIGINT NOT NULL,
    message_id BIGINT NOT NULL,
    publisher_user_id BIGINT NOT NULL,
    text_content TEXT,
    files_json TEXT,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_group_chat_private_publication PRIMARY KEY (task_session_id, pending_publication_id),
    CONSTRAINT uk_group_chat_private_pub_message UNIQUE (message_id)
);
COMMENT ON TABLE byai.byai_group_chat_private_publication IS '用户逐次确认的群内私聊成果；确认后私聊可继续使用';

-- 真人待办独立生命周期；执行会话与待办标识分离，正文保留不可变业务快照。
CREATE TABLE byai.byai_group_human_task_batch (
 batch_id BIGINT PRIMARY KEY, enterprise_id BIGINT NOT NULL, group_session_id BIGINT NOT NULL,
 initiator_user_id BIGINT NOT NULL, sender_type VARCHAR(16) NOT NULL, sender_id BIGINT NOT NULL,
 source_message_id BIGINT, card_message_id BIGINT,
 request_id VARCHAR(128) NOT NULL, payload_hash VARCHAR(64) NOT NULL, status VARCHAR(32) NOT NULL,
 revision BIGINT NOT NULL, payload TEXT NOT NULL, create_time TIMESTAMP NOT NULL, update_time TIMESTAMP NOT NULL,
 CONSTRAINT ck_human_batch_sender_type CHECK (sender_type IN ('USER', 'AGENT')),
 CONSTRAINT uk_human_batch_request UNIQUE(enterprise_id,initiator_user_id,request_id)
);
CREATE TABLE byai.byai_group_human_task (
 human_task_id BIGINT PRIMARY KEY, enterprise_id BIGINT NOT NULL, group_session_id BIGINT NOT NULL,
 batch_id BIGINT NOT NULL, initiator_user_id BIGINT NOT NULL, assignee_user_id BIGINT NOT NULL,
 status VARCHAR(32) NOT NULL, revision BIGINT NOT NULL, latest_version INTEGER NOT NULL,
 latest_submission_id BIGINT, payload TEXT NOT NULL, create_time TIMESTAMP NOT NULL, update_time TIMESTAMP NOT NULL
);
CREATE INDEX idx_human_task_initiator ON byai.byai_group_human_task(enterprise_id,initiator_user_id,status,human_task_id);
CREATE INDEX idx_human_task_assignee ON byai.byai_group_human_task(enterprise_id,assignee_user_id,status,human_task_id);
CREATE INDEX idx_human_task_batch ON byai.byai_group_human_task(enterprise_id,batch_id);
CREATE TABLE byai.byai_group_human_task_session (
 task_session_id BIGINT PRIMARY KEY, enterprise_id BIGINT NOT NULL, human_task_id BIGINT NOT NULL,
 entry_type VARCHAR(32) NOT NULL, create_time TIMESTAMP NOT NULL
);
CREATE INDEX idx_human_task_session_task ON byai.byai_group_human_task_session(human_task_id);
CREATE TABLE byai.byai_group_human_task_submission (
 submission_id BIGINT PRIMARY KEY, enterprise_id BIGINT NOT NULL, human_task_id BIGINT NOT NULL,
 version_no INTEGER NOT NULL, request_id VARCHAR(128) NOT NULL, payload_hash VARCHAR(64) NOT NULL,
 payload TEXT NOT NULL, create_time TIMESTAMP NOT NULL,
 CONSTRAINT uk_human_submission_request UNIQUE(human_task_id,request_id),
 CONSTRAINT uk_human_submission_version UNIQUE(human_task_id,version_no)
);
CREATE TABLE byai.byai_group_human_task_review (
 review_id BIGINT PRIMARY KEY, enterprise_id BIGINT NOT NULL, human_task_id BIGINT NOT NULL,
 submission_id BIGINT NOT NULL, request_id VARCHAR(128) NOT NULL, payload_hash VARCHAR(64) NOT NULL,
 payload TEXT NOT NULL, create_time TIMESTAMP NOT NULL,
 CONSTRAINT uk_human_review_request UNIQUE(human_task_id,request_id)
);
CREATE TABLE byai.byai_group_human_task_submit_request (
 human_task_id BIGINT NOT NULL, request_id VARCHAR(128) NOT NULL, payload_hash VARCHAR(64) NOT NULL,
 payload TEXT NOT NULL, revision BIGINT NOT NULL, create_time TIMESTAMP NOT NULL, update_time TIMESTAMP NOT NULL,
 CONSTRAINT pk_human_submit_request PRIMARY KEY(human_task_id,request_id)
);
COMMENT ON TABLE byai.byai_group_human_task_batch IS '真人待办创建与派发批次：保存来源群、真人发起人、卡片发送者身份、条目及编辑版本；支持数字员工提案确认和真人直接创建，关联正式群卡片；批次内各待办独立提交和验收，不进行整批验收';
COMMENT ON TABLE byai.byai_group_human_task IS '真人待办主表：保存所属批次、发起人、负责人、任务要求、截止时间、验收标准、当前状态及最新提交版本；验收通过后禁止再次提交';
COMMENT ON TABLE byai.byai_group_human_task_session IS '真人待办与数字员工执行会话关联表：区分群内执行和私聊入口，一个待办可关联多个会话，一个会话仅绑定一个待办，供成果提交确定目标待办';
COMMENT ON TABLE byai.byai_group_human_task_submission IS '真人待办成果提交版本表：按待办递增版本号，完整保存每次提交的正文、云盘附件引用、提交人和来源会话；新版本替代当前版本但不覆盖历史成果';
COMMENT ON TABLE byai.byai_group_human_task_review IS '真人待办验收记录表：关联具体提交版本，保存验收通过或退回修改的决定、意见、验收人及操作时间；历史验收记录随原提交版本保留';
COMMENT ON TABLE byai.byai_group_human_task_submit_request IS '真人待办请求幂等与上传进度表：按待办和请求标识保存内容摘要、上传检查点、处理状态及成功回执，用于提交和专用私聊创建的失败重试与重复请求去重';
COMMENT ON COLUMN byai.byai_group_human_task_batch.initiator_user_id IS '业务发起人真人用户标识，承担确认和验收职责，与卡片发送者独立';
COMMENT ON COLUMN byai.byai_group_human_task_batch.sender_type IS '卡片发送者类型：USER 真人用户，AGENT 数字员工，由服务端确定';
COMMENT ON COLUMN byai.byai_group_human_task_batch.sender_id IS '卡片发送者标识：对应 sender_type 的用户或数字员工标识，批次确认后保持不变';
COMMENT ON COLUMN byai.byai_group_human_task_batch.source_message_id IS '来源群消息标识；真人直接创建正式待办时允许为空';
