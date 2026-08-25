-- ByClaw Super current PostgreSQL/OpenGauss DDL (schema version 11).
-- 用于新环境初始化最终态表结构，不是旧环境增量升级脚本。
-- 默认 schema 为 byai；如 DB_SCHEMA 不同，请全文替换 schema 名。

BEGIN;

CREATE SCHEMA IF NOT EXISTS byai;
SET search_path TO byai, public;

CREATE TABLE IF NOT EXISTS byai_super_schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS byai_super_sessions (
  id uuid PRIMARY KEY,
  owner_version smallint NOT NULL DEFAULT 1,
  user_code text NOT NULL,
  tenant_id text NULL,
  namespace text NULL,
  user_name text NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  context_revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz NULL,
  session_context jsonb NOT NULL DEFAULT '{"schemaVersion":1}'::jsonb,
  session_context_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT sessions_owner_v1 CHECK (
    owner_version <> 1 OR (tenant_id IS NULL AND namespace IS NULL)
  ),
  CONSTRAINT sessions_context_version_positive CHECK (
    session_context_version > 0
  )
);

CREATE INDEX IF NOT EXISTS sessions_owner_updated_idx
  ON byai_super_sessions(owner_version, user_code, updated_at DESC);

CREATE TABLE IF NOT EXISTS byai_super_runs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL
    REFERENCES byai_super_sessions(id) ON DELETE CASCADE,
  input text NOT NULL,
  agent_snapshot jsonb NOT NULL,
  status text NOT NULL,
  base_context_revision bigint NOT NULL DEFAULT 0,
  attempt_no integer NOT NULL DEFAULT 0,
  execution_stage text NOT NULL DEFAULT 'QUEUED',
  lease_fencing_token bigint NULL,
  final_answer text NULL,
  error_code text NULL,
  error_message text NULL,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  thinking_level text NOT NULL DEFAULT 'off',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ingress_context jsonb NULL,
  CONSTRAINT runs_thinking_level_check CHECK (
    thinking_level IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')
  )
);

CREATE INDEX IF NOT EXISTS runs_session_created_idx
  ON byai_super_runs(session_id, created_at, id);

CREATE INDEX IF NOT EXISTS runs_claim_idx
  ON byai_super_runs(status, created_at)
  WHERE status IN (
    'CREATED', 'QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_USER',
    'SYNTHESIZING', 'CANCELLING'
  );

CREATE TABLE IF NOT EXISTS byai_super_delegations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL
    REFERENCES byai_super_runs(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  connector_id text NOT NULL,
  task text NOT NULL,
  expected_output text NULL,
  status text NOT NULL,
  external_ref jsonb NULL,
  connector_cursor text NULL,
  result jsonb NULL,
  error text NULL,
  partial_output text NULL,
  agent_name text NULL,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  last_activity_at timestamptz NULL,
  callback_deadline_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS delegations_run_created_idx
  ON byai_super_delegations(run_id, created_at, id);

CREATE INDEX IF NOT EXISTS delegations_callback_deadline_idx
  ON byai_super_delegations(callback_deadline_at)
  WHERE status = 'RUNNING' AND callback_deadline_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS byai_super_run_events (
  run_id uuid NOT NULL
    REFERENCES byai_super_runs(id) ON DELETE CASCADE,
  event_id bigint NOT NULL,
  timestamp timestamptz NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (run_id, event_id)
);

CREATE TABLE IF NOT EXISTS byai_super_pi_sessions (
  session_id uuid PRIMARY KEY
    REFERENCES byai_super_sessions(id) ON DELETE CASCADE,
  pi_session_id text NOT NULL,
  pi_sdk_version text NOT NULL,
  session_format_version integer NOT NULL,
  header jsonb NOT NULL,
  active_leaf_id text NULL,
  revision bigint NOT NULL,
  entry_count bigint NOT NULL,
  content_bytes bigint NOT NULL,
  checksum text NOT NULL,
  model_provider text NULL,
  model_id text NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS byai_super_pi_session_entries (
  session_id uuid NOT NULL
    REFERENCES byai_super_sessions(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  entry_id text NOT NULL,
  parent_id text NULL,
  entry_type text NOT NULL,
  entry_json jsonb NOT NULL,
  visibility text NOT NULL,
  run_id uuid NULL REFERENCES byai_super_runs(id) ON DELETE SET NULL,
  attempt_no integer NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, seq),
  UNIQUE (session_id, entry_id),
  CONSTRAINT pi_entry_visibility CHECK (
    visibility IN ('COMMITTED', 'PENDING')
  )
);

CREATE INDEX IF NOT EXISTS pi_entries_run_attempt_idx
  ON byai_super_pi_session_entries(run_id, attempt_no, visibility);

CREATE TABLE IF NOT EXISTS byai_super_ingress_session_bindings (
  source text NOT NULL,
  owner_version smallint NOT NULL DEFAULT 1,
  user_code text NOT NULL,
  tenant_id text NULL,
  namespace text NULL,
  external_session_id text NOT NULL,
  session_id uuid NOT NULL
    REFERENCES byai_super_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (source, owner_version, user_code, external_session_id),
  CONSTRAINT ingress_binding_owner_v1 CHECK (
    owner_version <> 1 OR (tenant_id IS NULL AND namespace IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS byai_super_session_execution_leases (
  session_id uuid PRIMARY KEY
    REFERENCES byai_super_sessions(id) ON DELETE CASCADE,
  owner_instance_id text NOT NULL,
  fencing_token bigint NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  run_id uuid NOT NULL REFERENCES byai_super_runs(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL
);

CREATE INDEX IF NOT EXISTS session_leases_expiry_idx
  ON byai_super_session_execution_leases(lease_expires_at);

CREATE TABLE IF NOT EXISTS byai_super_run_execution_credentials (
  run_id uuid PRIMARY KEY REFERENCES byai_super_runs(id) ON DELETE CASCADE,
  credential text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS run_credentials_expiry_idx
  ON byai_super_run_execution_credentials(expires_at);

CREATE TABLE IF NOT EXISTS byai_super_callback_timeout_outbox (
  run_id uuid PRIMARY KEY REFERENCES byai_super_runs(id) ON DELETE CASCADE,
  claimed_by text NULL,
  claim_expires_at timestamptz NULL,
  delivered_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS callback_timeout_outbox_pending_idx
  ON byai_super_callback_timeout_outbox(claim_expires_at, created_at)
  WHERE delivered_at IS NULL;

-- 该表由能力卡接口使用，当前仍由运维 DDL 管理。
CREATE TABLE IF NOT EXISTS byai_super_agent_capability_cards (
  system_code varchar(64) NOT NULL,
  agent_id varchar(200) NOT NULL,
  agent_code varchar(128),
  agent_name varchar(200),
  schema_version varchar(64) NOT NULL,
  generator_version varchar(32) NOT NULL,
  source_version varchar(128),
  source_fingerprint varchar(128) NOT NULL,
  card text NOT NULL,
  routing_text varchar(1024),
  quality text,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT pk_byai_super_agent_capability_cards
    PRIMARY KEY (system_code, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_byai_super_agent_capability_cards_fingerprint
  ON byai_super_agent_capability_cards(source_fingerprint);

CREATE INDEX IF NOT EXISTS idx_byai_super_agent_capability_cards_status
  ON byai_super_agent_capability_cards(status);

-- 仅用于记录这份完整 DDL 对应的最终结构；应用启动不再依赖该版本号。
INSERT INTO byai_super_schema_migrations(version, name)
SELECT migration.version, migration.name
FROM (
  SELECT 1 AS version, 'initial_multi_user_persistence' AS name
  UNION ALL SELECT 2, 'delegation_resume_partial_output'
  UNION ALL SELECT 3, 'plaintext_run_execution_credentials'
  UNION ALL SELECT 4, 'delegation_agent_name'
  UNION ALL SELECT 5, 'run_thinking_level'
  UNION ALL SELECT 6, 'user_interaction_waiting_status'
  UNION ALL SELECT 7, 'session_business_context'
  UNION ALL SELECT 8, 'run_attachments'
  UNION ALL SELECT 9, 'run_ingress_context'
  UNION ALL SELECT 10, 'delegation_last_activity'
  UNION ALL SELECT 11, 'delegation_callback_deadline'
) migration
WHERE NOT EXISTS (
  SELECT 1
    FROM byai_super_schema_migrations applied
   WHERE applied.version = migration.version
);

COMMIT;

-- Verification
SELECT version, name, applied_at
  FROM byai.byai_super_schema_migrations
 ORDER BY version;

SELECT table_schema, table_name
  FROM information_schema.tables
 WHERE table_schema = 'byai'
   AND table_name LIKE 'byai_super_%'
 ORDER BY table_name;
