-- Generic service commands retain request identity independently from worker leases.
CREATE TABLE IF NOT EXISTS byai.internal_command (
    id bigint PRIMARY KEY,
    source_system varchar(64) NOT NULL,
    request_id varchar(128) NOT NULL,
    request_hash varchar(64) NOT NULL,
    type varchar(32) NOT NULL,
    enterprise_id bigint NOT NULL,
    owner_user_id bigint NOT NULL,
    request_snapshot text NOT NULL,
    status varchar(32) NOT NULL,
    stage varchar(64) NOT NULL,
    result text,
    error_code varchar(64),
    revision bigint NOT NULL DEFAULT 0,
    lease_owner varchar(128),
    lease_until timestamptz,
    fencing_token bigint NOT NULL DEFAULT 0,
    attempt integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_internal_command_request UNIQUE (source_system, request_id),
    CONSTRAINT ck_internal_command_status CHECK (status IN ('PENDING','RUNNING','RETRY_WAIT','RECONCILING','SUCCEEDED','FAILED','MANUAL_REQUIRED'))
);
CREATE INDEX IF NOT EXISTS idx_internal_command_due ON byai.internal_command(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_internal_command_enterprise ON byai.internal_command(enterprise_id,created_at);

-- An uncertain external result keeps this slot even after the worker's lease expires.
CREATE TABLE IF NOT EXISTS byai.tenant_runtime_operation (
    enterprise_id bigint PRIMARY KEY,
    active_command_id bigint,
    generation bigint NOT NULL DEFAULT 1,
    state varchar(32) NOT NULL DEFAULT 'IDLE',
    fencing_token bigint NOT NULL DEFAULT 0,
    revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS byai.internal_command_step (
    command_id bigint NOT NULL REFERENCES byai.internal_command(id),
    step_key varchar(64) NOT NULL,
    status varchar(32) NOT NULL,
    provider_request_key varchar(128) NOT NULL,
    result text,
    error_code varchar(64),
    revision bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(command_id,step_key)
);
COMMENT ON COLUMN byai.internal_command.request_snapshot IS 'Canonical immutable JSON text including authenticated-service audit actor; never contains transport credentials';

-- Serialize all commercial member inserts and reactivations on the existing package snapshot row.
-- This also protects legacy invitation/admin writers during the HACU schema-writer transition.
CREATE OR REPLACE FUNCTION byai.enforce_commercial_member_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    snapshot text;
    maximum_members bigint;
    active_members bigint;
BEGIN
    IF NEW.status <> 'ACTIVE' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.enterprise_id = NEW.enterprise_id AND OLD.status = 'ACTIVE' THEN RETURN NEW; END IF;
    IF NOT EXISTS (SELECT 1 FROM byai.tenant_config WHERE enterprise_id=NEW.enterprise_id
        AND params_code='COMMERCIAL_MANAGED' AND params_value='true') THEN RETURN NEW; END IF;
    UPDATE byai.tenant_config SET params_version=params_version+1
        WHERE enterprise_id=NEW.enterprise_id AND params_code='PACKAGE_CONTENT_SNAPSHOT'
        RETURNING params_value INTO snapshot;
    maximum_members := (snapshot::jsonb->>'memberLimit')::bigint;
    IF maximum_members IS NULL OR maximum_members < 1 THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='COMMERCIAL_MEMBER_LIMIT_UNAVAILABLE';
    END IF;
    SELECT count(*) INTO active_members FROM byai.tenant_user_membership
        WHERE enterprise_id=NEW.enterprise_id AND status='ACTIVE';
    IF active_members >= maximum_members THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='COMMERCIAL_MEMBER_LIMIT_EXCEEDED';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_commercial_member_limit ON byai.tenant_user_membership;
CREATE TRIGGER trg_commercial_member_limit BEFORE INSERT OR UPDATE OF enterprise_id,status
ON byai.tenant_user_membership FOR EACH ROW EXECUTE FUNCTION byai.enforce_commercial_member_limit();
