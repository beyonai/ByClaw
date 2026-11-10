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
