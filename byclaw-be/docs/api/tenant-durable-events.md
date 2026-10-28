# Durable tenant events

`HookPublisher.publishDurable(String type, int version, String aggregateId,
String aggregateRevision, String generation, String correlationId,
Map<String, Object> data)` returns the new UUID event ID. IDs, revisions and
generations are decimal strings. Each type/version requires a business-owned
`HookEventSchema`; its data whitelist must exclude credentials and unnecessary
personal data. Credential-named fields are additionally rejected recursively.
Payloads larger than 256 KiB fail before insertion.

Call this method inside the authoritative central business database transaction.
It requires an actual transaction with a synchronized connection bound to
`multipleDataSource` and rejects non-central routing. It writes
`byai.integration_outbox` and one `byai.integration_delivery` per enabled matching
subscription directly on that connection. There is no after-commit insert and no
new transaction. Business rollback removes both records. An event is stored even
when there are no subscriptions. Missing transactions, unsupported schemas and
persistence failures propagate to the caller; callers must let failures roll back
critical business state. Do not catch and suppress publishing failures.

The JSON envelope contains `eventId`, `type`, `eventVersion`, `occurredAt`,
`sourceSystem=byclaw`, `aggregateId`, `aggregateRevision`, `generation`,
`correlationId`, and whitelisted `data`. A compatible nested `event` projection
supports existing hook request mappings. Mapping a custom HTTP body is an
operator-owned protocol choice; retain all identity/revision fields required by
the receiver.

Enable the worker with `byclaw.hooks.durable.enabled=true`; subscriptions use the
existing `byclaw.hooks.subscriptions` configuration. Persistence is independent
of transport enablement. Only subscriptions present when publishing receive a
delivery row; adding subscriptions does not automatically replay history.
Install the approved schema migration before the first durable publishing call.
Disabling the worker preserves pending rows. Existing best-effort `publish`
behavior remains separate; avoid configuring duplicate transport for the same
business action.

The worker uses the physical central `dataSourceByai`, reads at most ten
candidates per invocation and processes them sequentially outside business
transactions. A conditional update claims each row, advances its fence and
sets a 120-second lease. HTTP call timeouts are validated at no more than 60
seconds. Completion requires the current fence and an unexpired lease. Expired
claims are eligible for recovery; stale workers cannot acknowledge newer claims.
HTTP calls disable implicit connection retries, redirects and wire replay.
Explicit retries retain event/subscription idempotency identity; HMAC metadata
is freshly signed for each attempt. Delivery is at least once: receivers must
transactionally deduplicate the idempotency key and reject stale business
revisions/generations. A response lost after receiver commit may be retried.

`PENDING`, `PROCESSING`, `RETRY`, `DELIVERED`, `FAILED` and `FILTERED` are durable
statuses. Retry policy uses the existing bounded `max-attempts` (1–100), delay,
HTTP status and transport-error settings. Attempts include expired claims;
exhaustion is terminal. The default is one attempt, so deployments requiring
retries must explicitly configure a larger bound. Removed/disabled subscriptions
and exhausted retries become `FAILED`. Required-data filtering becomes
`FILTERED` for that subscription without removing the event. Per-subscription
status never completes another subscription. Error codes exclude response bodies,
URLs, headers and exception messages. Credentials remain exclusively in runtime
configuration and are not stored in delivery rows. Pending deliveries use the
current configuration for the same subscription ID; changing its endpoint must
be reviewed as redirecting existing pending events.

No replay administration or retention/deletion job is provided here. Operators
must inspect terminal rows and use an audited recovery process before replaying;
do not delete outbox rows referenced by delivery rows. Event tables contain
business data and require the same access controls as the owning business state.

This guarantee applies only to Java call sites that invoke `publishDurable` in
their central transaction. Legacy hooks, Node events, external provider actions,
and HACU receipt processing are not made reliable by this implementation. The
isolated PostgreSQL 17 verification script exercises the new DDL, transaction
rollback, delivery claim/reclaim, independent subscriptions and stale/expired
acknowledgment rejection against minimal fixtures. Cross-process HTTP
interoperability, deployed database grants/baseline and openGauss compatibility
still require separate integration acceptance.
