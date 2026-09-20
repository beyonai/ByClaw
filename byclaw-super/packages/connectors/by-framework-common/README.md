# by-framework delegation delivery

Business state, execution ownership and delegation results remain authoritative in PostgreSQL.
The shared connector uses Redis only for by-framework transport and durable publication receipts.
No process-local business cache or new database table is required.

Both the app and this connector use `@byclaw/by-framework@1.6.0`. Its execution metadata is
preserved in the framework registry with the SDK's TTL, but excluded from permanent dispatch
routes. Super does not register the SDK's new wait index for its delegations: PostgreSQL owns
callback deduplication and deadlines, and consuming a Redis wait before the database transaction
would drop pending recovery after a crash. The inbound runner also routes all orphan recovery
through Super's existing lease and authenticated-pending checks rather than the SDK's additional
orphan scan.

`Delegation.id` supplies the stable request message ID. The production callAgent adapter reserves an
immutable Redis route and deterministic framework execution ID, initializes the existing framework
session registry without overwriting running or terminal records, then uses one Lua script to publish
`XADD` and its receipt atomically. Retries resume any interrupted step. The receipt shares the control
stream's Redis Cluster hash slot; registry initialization is independently idempotent. An accepted
route is reused even if availability or fallback routing changes on another instance.

The `byclaw-super:dispatch-*` keys contain identifiers and
transport bookkeeping, never request credentials or task content. They do not automatically expire:
expiring them could let an arbitrarily delayed old process dispatch the same delegation again.
Retain these keys alongside durable framework streams; deleting or losing them invalidates transport
deduplication. Their eventual operational cleanup must be coordinated with terminal database state
and retirement of all older execution attempts. Framework registry records keep the SDK's existing
retention policy. This protocol prevents duplicate **publication**; worker execution and arbitrary
external effects still depend on the downstream consumer's own delivery semantics.

The optional `cancelPending` connector port cancels a delegation even when the publisher died
before storing its external reference in PostgreSQL. It first records a durable cancellation marker,
uses the message-to-route index to locate the existing framework registry execution, and requests
cancellation without dispatching a new task. Cancellation before routing prevents a later publish;
after routing, a cancellation tombstone in the control stream slot is checked atomically with XADD.
A publication that wins this ordering already has a registry execution that can be cancelled.

An SDK execution created before this adapter was enabled has no atomic receipt. When its registry
mapping exists, the connector refuses to republish it because it cannot prove whether the old process
already published. Persisted database external references continue to use `resume()` normally.

Redis errors during publication are reported as recoverable dispatch uncertainty. The Run and
Delegation remain nonterminal, so the next database owner resumes the original dispatch rather than
marking an accepted remote task failed or asking the model to invent another delegation.

Losing a database lease or being unable to confirm execution ownership stops local observation; it
must not issue remote cancellation. Failure and timeout paths first commit their fenced delegation
terminal state, and only a successful commit permits cancellation. A database-confirmed user
cancellation is a separate global intent and may cancel a late-returning remote handle even after
the old attempt has lost its lease. Nonresumable third-party HTTP
connectors persist their reference before opening their lazy request stream; takeover fails that
existing delegation explicitly and never POSTs it again.

Tests inject response loss after route reservation, registry initialization and atomic publication,
and run concurrent publishers against shared transport state. These are isolated protocol tests;
production rollout still requires real Redis/PostgreSQL multi-instance crash and partition testing.
