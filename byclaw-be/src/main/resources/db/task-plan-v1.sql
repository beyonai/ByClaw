-- ByClaw Agent 任务计划单表版。旧任务计划数据明确不保留。
-- 需要人工在 byai schema 执行；应用代码不会自动执行本文件。
SET search_path TO byai;

DROP TABLE IF EXISTS byai_agent_task_event;
DROP TABLE IF EXISTS byai_agent_task_item;
DROP TABLE IF EXISTS byai_agent_task_plan;

CREATE TABLE byai_agent_task_plan
(
    plan_id               BIGSERIAL    NOT NULL,
    user_id               BIGINT       NOT NULL,
    session_id            BIGINT       NOT NULL,
    message_id            BIGINT       NOT NULL,
    turn_id               VARCHAR(128),
    lane_id               VARCHAR(128),
    trace_id              VARCHAR(128),
    source_runtime        VARCHAR(32)   NOT NULL,
    source_run_id         VARCHAR(128)  NOT NULL,
    title                 VARCHAR(500)  NOT NULL,
    last_explanation      VARCHAR(2000),
    status                VARCHAR(32)   NOT NULL,
    status_reason_code    VARCHAR(64),
    status_reason_message VARCHAR(500),
    version               INT          NOT NULL,
    tasks_payload         TEXT         NOT NULL,
    last_command_id       VARCHAR(128)  NOT NULL,
    created_at            TIMESTAMP    NOT NULL,
    updated_at            TIMESTAMP    NOT NULL,
    completed_at          TIMESTAMP,
    CONSTRAINT pk_byai_agent_task_plan PRIMARY KEY (plan_id)
);

-- 同一用户的同一会话在任意时刻最多存在一个非终态任务列表。
CREATE UNIQUE INDEX uk_agent_task_plan_active
    ON byai_agent_task_plan (user_id, session_id)
    WHERE status IN ('ACTIVE', 'CANCELLING');

CREATE INDEX idx_agent_task_plan_message
    ON byai_agent_task_plan (user_id, session_id, message_id, updated_at DESC);

CREATE INDEX idx_agent_task_plan_trace
    ON byai_agent_task_plan (user_id, session_id, trace_id, updated_at DESC);

CREATE INDEX idx_agent_task_plan_run
    ON byai_agent_task_plan (user_id, source_runtime, source_run_id, updated_at DESC);
