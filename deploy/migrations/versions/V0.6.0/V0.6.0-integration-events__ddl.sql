-- Critical events and subscription attempts share the authoritative business transaction.
CREATE TABLE byai.integration_outbox (
    event_id varchar(36) PRIMARY KEY,
    event_type varchar(128) NOT NULL,
    event_version integer NOT NULL,
    aggregate_id varchar(19) NOT NULL,
    aggregate_revision varchar(19) NOT NULL,
    generation varchar(19) NOT NULL,
    correlation_id varchar(128) NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX integration_outbox_aggregate_idx
    ON byai.integration_outbox (aggregate_id, created_at);
CREATE TABLE byai.integration_delivery (
    event_id varchar(36) NOT NULL REFERENCES byai.integration_outbox(event_id),
    subscription_id varchar(64) NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN
        ('PENDING','PROCESSING','RETRY','DELIVERED','FAILED','FILTERED')),
    attempt integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL,
    lease_until timestamptz,
    fencing_token bigint NOT NULL DEFAULT 0,
    delivered_at timestamptz,
    error_code varchar(64),
    PRIMARY KEY (event_id, subscription_id)
);
CREATE INDEX integration_delivery_due_idx
    ON byai.integration_delivery(status, next_attempt_at);
CREATE INDEX integration_delivery_lease_idx
    ON byai.integration_delivery(status, lease_until);
COMMENT ON TABLE byai.integration_outbox IS 'Immutable critical business events persisted in the owning transaction';
COMMENT ON TABLE byai.integration_delivery IS 'Independent subscription attempts with expiring leases and fencing tokens';
