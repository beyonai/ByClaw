-- Open-source V0.5.2.1: durable resource authorization queue and transactional cache outbox.
-- Also execute this file once against an existing installation before deploying the task endpoints.
CREATE TABLE IF NOT EXISTS byai.byai_authorization_task (
    task_id varchar(36) PRIMARY KEY,
    enterprise_id bigint NOT NULL,
    operator_id bigint NOT NULL,
    resource_id bigint NOT NULL,
    operation varchar(16) NOT NULL,
    request_id varchar(64) NOT NULL,
    request_hash varchar(64) NOT NULL,
    payload text,
    status varchar(16) NOT NULL,
    phase varchar(16) NOT NULL,
    progress integer NOT NULL DEFAULT 0,
    completed_users integer NOT NULL DEFAULT 0,
    total_users integer NOT NULL DEFAULT 0,
    data_applied integer NOT NULL DEFAULT 0,
    message varchar(1024),
    attempts integer NOT NULL DEFAULT 0,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    retry_at bigint NOT NULL,
    lease_until bigint,
    lease_token varchar(36),
    active_resource varchar(100),
    worker_slot varchar(32),
    cache_plan text,
    CONSTRAINT uq_auth_task_request UNIQUE (enterprise_id, operator_id, request_id),
    CONSTRAINT uq_auth_task_active UNIQUE (active_resource),
    CONSTRAINT uq_auth_task_worker UNIQUE (worker_slot)
);
CREATE INDEX IF NOT EXISTS idx_auth_task_pending ON byai.byai_authorization_task (status, retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_task_owner ON byai.byai_authorization_task (enterprise_id, operator_id, resource_id, created_at);

-- Batch lookups must not repeatedly scan the entire grant table.
CREATE INDEX IF NOT EXISTS idx_auth_batch_resource ON byai.au_privilege_grant (grant_obj_id, grant_obj_type, status_cd, grant_type);
CREATE INDEX IF NOT EXISTS idx_auth_batch_subject ON byai.au_privilege_grant (grant_to_obj_type, grant_to_obj_id, status_cd, grant_type);
