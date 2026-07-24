/**
 * 显式维护数据库版本。迁移只允许向前执行，生产环境由独立 migration job 调用；
 * 应用启动仅检查版本，不会擅自修改 schema。
 */
export interface PostgresMigration {
  version: number;
  name: string;
  sql: string;
}

/** 首版持久化模型：业务状态、Pi 原生记录、跨实例租约和加密执行凭证。 */
export const POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [
  {
    version: 1,
    name: "initial_multi_user_persistence",
    sql: `
CREATE TABLE sessions (
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
  CONSTRAINT sessions_owner_v1 CHECK (
    owner_version <> 1 OR (tenant_id IS NULL AND namespace IS NULL)
  )
);
CREATE INDEX sessions_owner_updated_idx
  ON sessions(owner_version, user_code, updated_at DESC);

CREATE TABLE runs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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
  finished_at timestamptz NULL
);
CREATE INDEX runs_session_created_idx ON runs(session_id, created_at, id);
CREATE INDEX runs_claim_idx ON runs(status, created_at)
  WHERE status IN ('CREATED', 'QUEUED', 'RUNNING', 'WAITING_AGENT', 'SYNTHESIZING', 'CANCELLING');

CREATE TABLE delegations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  connector_id text NOT NULL,
  task text NOT NULL,
  expected_output text NULL,
  status text NOT NULL,
  external_ref jsonb NULL,
  connector_cursor text NULL,
  result jsonb NULL,
  partial_output text NULL,
  error text NULL,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL
);
CREATE INDEX delegations_run_created_idx ON delegations(run_id, created_at, id);

CREATE TABLE run_events (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  event_id bigint NOT NULL,
  timestamp timestamptz NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (run_id, event_id)
);

CREATE TABLE pi_sessions (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
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

CREATE TABLE pi_session_entries (
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  entry_id text NOT NULL,
  parent_id text NULL,
  entry_type text NOT NULL,
  entry_json jsonb NOT NULL,
  visibility text NOT NULL,
  run_id uuid NULL REFERENCES runs(id) ON DELETE SET NULL,
  attempt_no integer NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, seq),
  UNIQUE (session_id, entry_id),
  CONSTRAINT pi_entry_visibility CHECK (visibility IN ('COMMITTED', 'PENDING'))
);
CREATE INDEX pi_entries_run_attempt_idx
  ON pi_session_entries(run_id, attempt_no, visibility);

CREATE TABLE ingress_session_bindings (
  source text NOT NULL,
  owner_version smallint NOT NULL DEFAULT 1,
  user_code text NOT NULL,
  tenant_id text NULL,
  namespace text NULL,
  external_session_id text NOT NULL,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (source, owner_version, user_code, external_session_id),
  CONSTRAINT ingress_binding_owner_v1 CHECK (
    owner_version <> 1 OR (tenant_id IS NULL AND namespace IS NULL)
  )
);

CREATE TABLE session_execution_leases (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  owner_instance_id text NOT NULL,
  fencing_token bigint NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL
);
CREATE INDEX session_leases_expiry_idx ON session_execution_leases(lease_expires_at);

CREATE TABLE run_execution_credentials (
  run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  encrypted_data_key bytea NOT NULL,
  key_version text NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  aad_version smallint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX run_credentials_expiry_idx ON run_execution_credentials(expires_at);
`,
  },
  {
    version: 2,
    name: "delegation_resume_partial_output",
    sql: `
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS partial_output text NULL;
`,
  },
] as const;

export const LATEST_POSTGRES_SCHEMA_VERSION =
  POSTGRES_MIGRATIONS.at(-1)?.version ?? 0;
