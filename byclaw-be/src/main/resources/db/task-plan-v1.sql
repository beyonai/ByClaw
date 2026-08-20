-- ByClaw Agent 任务计划 V1。部署时应在 byai schema 执行；语句可幂等重放。
SET search_path TO byai;

CREATE TABLE IF NOT EXISTS byai_agent_task_plan
(
    plan_id               BIGINT       NOT NULL,
    user_id               BIGINT       NOT NULL,
    user_code             VARCHAR(128),
    session_id            BIGINT       NOT NULL,
    message_id            BIGINT       NOT NULL,
    turn_id               VARCHAR(128),
    lane_id               VARCHAR(128),
    trace_id              VARCHAR(128),
    source_runtime        VARCHAR(32)   NOT NULL,
    source_run_id         VARCHAR(128)  NOT NULL,
    create_request_id     VARCHAR(128)  NOT NULL,
    title                 VARCHAR(500)  NOT NULL,
    last_explanation      VARCHAR(2000),
    status                VARCHAR(32)   NOT NULL,
    status_reason_code    VARCHAR(64),
    status_reason_message VARCHAR(500),
    version               INT          NOT NULL,
    created_at            TIMESTAMP    NOT NULL,
    updated_at            TIMESTAMP    NOT NULL,
    completed_at          TIMESTAMP,
    CONSTRAINT pk_byai_agent_task_plan PRIMARY KEY (plan_id),
    CONSTRAINT uk_byai_agent_task_plan_create
        UNIQUE (user_id, source_runtime, source_run_id, create_request_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_task_plan_execution
    ON byai_agent_task_plan (user_id, session_id, message_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_task_plan_trace
    ON byai_agent_task_plan (user_id, session_id, trace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS byai_agent_task_item
(
    task_id               BIGINT       NOT NULL,
    plan_id               BIGINT       NOT NULL,
    position              INT          NOT NULL,
    title                 VARCHAR(1000) NOT NULL,
    description           VARCHAR(4000),
    status                VARCHAR(32)   NOT NULL,
    status_reason_code    VARCHAR(64),
    status_reason_message VARCHAR(500),
    created_at            TIMESTAMP    NOT NULL,
    updated_at            TIMESTAMP    NOT NULL,
    started_at            TIMESTAMP,
    completed_at          TIMESTAMP,
    CONSTRAINT pk_byai_agent_task_item PRIMARY KEY (task_id),
    CONSTRAINT fk_agent_task_item_plan FOREIGN KEY (plan_id)
        REFERENCES byai_agent_task_plan (plan_id) ON DELETE CASCADE,
    CONSTRAINT uk_agent_task_item_position UNIQUE (plan_id, position)
);

CREATE INDEX IF NOT EXISTS idx_agent_task_item_plan
    ON byai_agent_task_item (plan_id, position);

CREATE TABLE IF NOT EXISTS byai_agent_task_event
(
    event_id        BIGINT       NOT NULL,
    plan_id         BIGINT       NOT NULL,
    plan_version    INT          NOT NULL,
    event_type      VARCHAR(64)   NOT NULL,
    actor_type      VARCHAR(32)   NOT NULL,
    actor_id        VARCHAR(128),
    idempotency_key VARCHAR(128),
    payload         TEXT         NOT NULL,
    created_at      TIMESTAMP    NOT NULL,
    CONSTRAINT pk_byai_agent_task_event PRIMARY KEY (event_id),
    CONSTRAINT fk_agent_task_event_plan FOREIGN KEY (plan_id)
        REFERENCES byai_agent_task_plan (plan_id) ON DELETE CASCADE,
    CONSTRAINT uk_agent_task_event_idempotency UNIQUE (plan_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_task_event_plan
    ON byai_agent_task_event (plan_id, plan_version, event_id);
