-- Policies remain immutable; the cursor is the sole CAS serialization point.
CREATE TABLE byai.tenant_execution_policy (
    enterprise_id BIGINT NOT NULL,
    revision BIGINT NOT NULL CHECK (revision > 0),
    payload TEXT NOT NULL,
    PRIMARY KEY (enterprise_id, revision)
);
CREATE TABLE byai.tenant_policy_cursor (
    enterprise_id BIGINT PRIMARY KEY,
    desired_revision BIGINT NOT NULL CHECK (desired_revision > 0),
    generation VARCHAR(64) NOT NULL DEFAULT '0'
);
CREATE TABLE byai.tenant_policy_consumer (
    enterprise_id BIGINT NOT NULL,
    policy_revision BIGINT NOT NULL,
    consumer_key VARCHAR(64) NOT NULL,
    generation VARCHAR(64) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (enterprise_id, policy_revision, consumer_key, generation),
    FOREIGN KEY (enterprise_id, policy_revision)
        REFERENCES byai.tenant_execution_policy (enterprise_id, revision)
);
COMMENT ON TABLE byai.tenant_execution_policy IS 'Immutable tenant execution policy snapshots; unsupported quotas do not imply runtime activation';
COMMENT ON TABLE byai.tenant_policy_cursor IS 'Authoritative desired policy revision and current runtime generation; conditional updates fence concurrent changes';
COMMENT ON TABLE byai.tenant_policy_consumer IS 'Acknowledgments scoped to immutable policy revision and current runtime generation';
