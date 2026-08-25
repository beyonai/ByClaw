# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`byclaw-super` is a standalone TypeScript service that orchestrates "digital employee" agents. A Pi-SDK-backed Leader LLM understands the user's goal in natural language, picks agents from an authorization snapshot fetched from ByClaw BE, and delegates execution through a pluggable Connector SPI. V1 ships one Connector (`openclaw-by-framework`) that talks to OpenClaw workers via Redis streams.

**PostgreSQL is the single source of truth for all business state and Pi context** — Session, Run, Delegation, RunEvent, Pi checkpoints, ingress bindings, execution leases, and short-lived execution credentials all live there. Multiple service instances cooperate through a database-backed Run queue, per-Session leases, and fencing tokens. The `InMemory*` repository implementations exist **only for unit tests**; the production Composition Root (`app/runtime.ts`) wires `PostgresDatabase` exclusively.

This is a subproject of the broader ByClaw monorepo but has its own build, dependencies, and runtime. The parent `ByClaw/CLAUDE.md` does not apply to this service.

**Authoritative context docs** (read before architectural changes):

- `.dev/PROJECT_CONTEXT.md` — full product background, fixed decisions, call chain, and the persistence/multi-instance design.
- `.dev/progress/CURRENT.md` — what is done vs. still pending verification.
- `.dev/LEADER_DELEGATION_FLOW.md`, `.dev/attachments-be-read-contract.md` — flow and integration contracts.

## Commands

All commands run from the repo root. Node ≥ 22.19, pnpm 11.3.0.

```bash
pnpm install                # install workspace deps
pnpm dev                    # build internal packages, then tsx app/index.ts (reads root .env, port 3000)
pnpm build                  # build packages + tsc -p tsconfig.json → dist/
pnpm start                  # node dist/index.js (production)
pnpm typecheck              # build packages, typecheck each package, then tsc --noEmit across workspace
pnpm test                   # build, then vitest run (all *.test.ts except legacy/ and e2e/)
pnpm db:migrate             # run PostgreSQL schema migrations (tsx app/scripts/migrate.ts)
pnpm capability:backfill    # compile+persist agent capability cards from source employee tables
pnpm smoke                  # real Redis + OpenClaw round-trip; needs BEYOND_TOKEN
pnpm test:e2e               # build packages, compile e2e/, run vitest with e2e/vitest.config.ts
```

There is no custom single-test wrapper — use vitest directly:

```bash
pnpm exec vitest run app/test/http.test.ts
pnpm exec vitest run -t "creates a run"            # by test name pattern
```

**Database integration tests are opt-in** (skipped unless `POSTGRES_INTEGRATION=true`):

```bash
POSTGRES_INTEGRATION=true DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=postgres \
  DB_SCHEMA=byai DB_USER=... DB_PASS=... \
  pnpm exec vitest run packages/storage-postgres/test/postgres.integration.test.ts
```

`vitest.config.ts` excludes `legacy/**` and `e2e/**` from the default suite; e2e has its own tsconfig + vitest config. `pnpm dev` and `pnpm build` always run `pnpm -r run build` first because `app/` consumes compiled `dist/` from the workspace packages via `tsconfig` references and `workspace:*`. **Editing a package's `.ts` without rebuilding will not be seen by the app.**

## Layout and dependency boundary (critical)

pnpm workspace. The root directory itself is the deployable app `@byclaw/byclaw-super`; `app/` is just its source folder (no `package.json`, no `tsconfig.json`, no `.env`).

```
app/                              Composition Root + HTTP/Worker adapters (this is src/)
  index.ts                        process entry: dotenv, createApplication(), signal-driven shutdown
  runtime.ts                      Composition Root: wires PostgresDatabase, Connector, services, HTTP, Worker
  config/                         loadConfig(): validates/normalizes .env into AppConfig
    index.ts                      env → AppConfig; config-defaults.ts holds the defaults table
  auth/beyond-token.ts            RS256 JWT verifier (reuses ByClaw BE login public key)
  ingress/run-ingress-service.ts  SHARED ingress: token verify → agent snapshot → createRun
  business/                       ByClaw BE outbound integration
    agent-catalog.ts              authorized agents from ByClaw BE (/digitEmploy/discover)
    agent-capability-source.ts    reads source employee rows for capability-card backfill
    byai-attachment-resolver.ts   downloads Run attachments from BE by fileId, Run-credential auth
    endpoint-resolver.ts          resolves ByClaw BE endpoint from Redis service registry
  server/
    app.ts                        Fastify HTTP: /byclawSuper route registration, readiness aggregation, CORS
    byclaw-sse.ts                 RunEvent → ByClaw thinking/answer SSE frame serializer
    http-request-utils.ts         header/auth/error helpers
    http-responses.ts             outbound DTOs + pagination cursors
    http-schemas.ts / http-types.ts
    routes/                       capability-routes, session-routes, run-routes, health-routes
  worker/
    by-framework-worker.ts        by-framework inbound Worker + runtime lifecycle
    by-framework-protocol.ts      by-framework protocol parse + message construction
  scripts/                        migrate.ts, backfill-agent-capability-cards.ts, smoke.ts
  test/                           vitest specs
packages/by-conductor/            Orchestration core + Repository/Connector SPI (framework-neutral)
  src/context/                    ContextCompiler + ordered processors (see "Context engineering")
  src/agent-capability.ts         capability-card compile domain
  src/attachments.ts, attachment-inspection.ts   controlled attachment reading tool
  src/leader-session-cache.ts     single-flight + LRU + TTL cache of Pi LeaderSessions
  src/pi-session-checkpoint.ts    Pi header + append-only entries checkpoint model
  src/execution-credentials.ts    short-lived Beyond-Token credential domain
  src/run-service.ts, delegation-service.ts, pi-leader.ts, leader.ts
  src/repositories.ts             Repository/Queue/Claim/Checkpoint/Credential PORTS
  src/memory.ts                   InMemory* implementations (tests only)
packages/storage-postgres/        migrations.ts + postgres-database.ts (SQL Repository impls)
packages/connectors/by-framework-common/     Shared Gateway/Redis transport for by-framework Connectors
packages/connectors/openclaw-by-framework/   Thin OpenClaw routing Connector
packages/connectors/code-by-framework/       Thin Code routing Connector
.dev/                             PROJECT_CONTEXT.md, progress, plans, contracts
e2e/                              HTTP/SSE end-to-end tests (own tsconfig + vitest config)
legacy/                           Pre-refactor reference; excluded from vitest and workspace
```

**Hard dependency direction** (enforced by package deps; do not bypass):

```
app → by-conductor
app → storage-postgres → by-conductor
app → connector-{openclaw,code}-by-framework → connector-by-framework-common
connector-by-framework-common → by-conductor + by-framework (Redis transport)
```

`by-conductor` must stay transport-neutral. **Do not import Fastify, Redis, `by-framework`, PostgreSQL (`pg`), or any concrete Connector/Repository from inside `packages/by-conductor/src/`.** It only defines ports (`repositories.ts`) and the orchestration that consumes them. New runtimes (Hermes, Codex, etc.) belong in a new `packages/connectors/*-*/` package; new storage backends belong in a new `packages/storage-*` package; both are registered from `app/runtime.ts`, never patched into the Leader.

## Architecture

Single process with **two inbound entry points** that funnel through one `RunIngressService`, plus **outbound** delegation through the Connector. State is durable in PostgreSQL; multiple instances cooperate via the DB queue.

```
INBOUND (two paths, same ingress chain)
  A) HTTP:   POST /byclawSuper/v1/sessions {message}                    atomic: Session + first Run + credential + run.created
             POST /byclawSuper/v1/sessions/:sessionId/runs {message}    append a Run
        │
  B) Worker: by-framework AskAgent → app/worker/by-framework-worker.ts
             (targetAgentType = BYCLAW_WORKER_AGENT_TYPE; Beyond-Token in metadata;
              external sessionId → internal sessionId via persistent ingress_session_bindings)
        ↓ both
  RunIngressService.createSessionRun/createRun
    → auth/beyond-token:        verify RS256 JWT, build CallerPrincipal (userCode only)
    → Session lookup:          append path → require full owner match; missing/foreign both return 404
    → ByClawBeAgentCatalog:     GET /byaiService/api/v2/digitEmploy/discover,
                                keep only usesPermissions=true agents (refreshed every turn)
    → RunService.createRun      (transactional snapshot of agentList; credential stored in same txn)
        ↓ enqueued via RunExecutionQueue (Postgres NOTIFY)
  RunService claim loop (FOR UPDATE SKIP LOCKED)
    → claims earliest non-terminal Run per Session (per-Session FIFO, cross-Session parallel)
    → acquires Session lease + monotonic fencing token; bumps attemptNo; emits run.attempt
    → lazily opens/reuses a Pi LeaderSession (LeaderSessionCache: single-flight + LRU + TTL)
  PiLeaderSession.run           ContextCompiler builds per-turn system context; tools resolved from snapshot
  delegateAgent execute         bridges into DelegationService (re-checks authorization vs snapshot)
        ↓ OUTBOUND
  DelegationService.execute     aggregates Connector events; status+event committed in one txn
  ConnectorRegistry.require     strict lookup; missing Connector = hard error, no fallback
  ByFrameworkConnector         shared Gateway/Redis transport, selected by thin runtime Connector
  OpenClawByFrameworkConnector routes to BYCLAW_EXE_{userCode}
  CodeByFrameworkConnector     routes to BYCLAW_CODE_{userCode}
        resume(): reconnects Redis stream from persisted cursor, does NOT re-sendMessage
  AgentResult → Leader synthesizes → RunEvents appended to event store in the completion txn
        (Run terminal + Pi checkpoint COMMIT + sessions.context_revision + credential delete, one txn)

OUT (two paths, same RunEvent stream, both DB-backed)
  A) HTTP:   GET /byclawSuper/v1/runs/:runId/events → owner check → byclaw-sse.ts → ByClaw SSE frames
  B) Worker: worker #forwardRunEvents → by-framework reasoningLog*/answerDelta protocol
  Event store: LISTEN/NOTIFY lowers latency; consumers ALWAYS re-poll by DB cursor.
```

### HTTP surface

| Endpoint | Role |
| --- | --- |
| `POST /byclawSuper/v1/sessions` | Create Session + first Run atomically (same txn writes credential + `run.created`) |
| `POST /byclawSuper/v1/sessions/:sessionId/runs` | Append a Run to an existing Session |
| `GET /byclawSuper/v1/sessions/:sessionId/messages` | Paginated user/assistant history (opaque `before` cursor; `limit` counts Runs) |
| `GET /byclawSuper/v1/runs/:runId` | Status snapshot: current status, final answer, or error |
| `POST /byclawSuper/v1/runs/:runId/cancel` | Request cancel of a QUEUED or executing Run |
| `GET /byclawSuper/v1/runs/:runId/events` | SSE: replay from `Last-Event-ID` then live-subscribe persisted events |
| `POST /byclawSuper/v1/agent-capability-cards/compile` | Compile a capability card via the Pi capability compiler |
| `PUT /byclawSuper/v1/agents/:agentId/capability-card` | Compile + upsert a capability card |
| `GET /byclawSuper/health` | Process alive |
| `GET /byclawSuper/ready` | DB schema + event listener + Pi + all Connectors + Worker (when enabled) |

`GET /byclawSuper/v1/runs/:runId` is a status snapshot; `GET /events` is a replayable event stream — neither substitutes for the other.

## Key invariants (enforced in code; preserve these)

- **PostgreSQL is the only production store.** Production never assembles `InMemory*`. Anything touching Run status, lease, fencing, checkpoint, or transaction boundaries must ship with tests — do not change execution semantics under the guise of "reorganizing."
- **Per-Session FIFO, cross-Session parallel.** The DB queue claims only the earliest non-terminal Run of each Session. There is no global lock.
- **`sessionId` is the multi-turn handle; `runId` is one execution.** One Session owns one reused Pi LeaderSession. Missing and foreign Session/Run IDs both return 404. State is durable, but a Run's in-flight execution lives only on the instance currently holding its lease.
- **Session is the authorization root.** `Session.owner` is V1 = `userCode` only (`userName` is display-only; `tenantId`/`namespace`/`System-Code` are NOT used for V1 authorization — the DB reserves the columns for a future explicit owner-version migration). Run access resolves `Run.sessionId` and compares the full owner. A `runId` is a locator, never an authorization credential.
- **Authorization is fetched at ingress and re-checked at execution.** `RunIngressService` pulls the agent snapshot (usesPermissions=true only) when the Run is created; `DelegationService.execute` re-validates `agentId` against that snapshot before touching the Connector. The Leader can never select an agent outside the snapshot.
- **Leader sees no transport detail.** `AgentProfile.execution` (connectorId, targetId) is never injected into the Pi prompt — only `id/code/name/description` are. The agent allowlist is injected as a per-turn system context region, never written to the long-term Pi transcript.
- **`Beyond-Token` is request-scoped and never persisted as ordinary state.** Plaintext lives only in the dedicated `byai_super_run_execution_credentials` table, gated by the current lease + fencing token + expiry. It is never written to Run, Delegation, RunEvent, Pi entries, or logs. The credential is deleted in the Run's terminal transaction and reaped periodically (default 60s).
- **Multi-instance writes are fenced.** Every execution-period write (Run/Delegation/Event/Pi checkpoint) validates the current lease + monotonic fencing token. A stale instance that lost its lease has its heartbeat abort the local Leader, and its DB writes are rejected. `attemptNo` increments on each claim/takeover.
- **Cancellation cascades**: Run → Pi `session.abort()` + AbortController + `DelegationService.cancelRun` → idempotent `ConnectorExecution.cancel()` per active delegation. The Worker maps inbound `CancelTaskCommand` to `RunService.cancelRun`. Connector cancel promises are memoized so concurrent triggers hit the external system once.
- **SSE is replay-capable and connection-stateless.** `Last-Event-ID` resumes after the stored event id; client disconnect does NOT cancel the Run and does NOT migrate the TCP connection to another instance. A client reconnects to any healthy instance and PostgreSQL replays subsequent events. Terminal status closes the stream; a 15s heartbeat comment keeps proxies alive.
- **Wire format is ByClaw's thinking model, not the internal event union.** Internal `RunEvent`s are translated for both out-paths: HTTP via `byclaw-sse.ts`; the Worker via `by-framework` `REASONING_LOG_*` / `ANSWER_DELTA`. Both adapters collapse raw Pi/OpenClaw reasoning into safe, stable Chinese progress text — do not leak raw upstream reasoning to clients.
- **`userCode`/`agentId` are NOT request body fields.** `userCode` comes from verified JWT claims; `agentId` is chosen by the Leader from the server-fetched snapshot. Request bodies contain only `message` (and attachment references).
- **`/byclawSuper/health`** = process alive; **`/byclawSuper/ready`** = DB schema version + event listener + Pi model + all Connector health checks + Worker health (when `BYCLAW_WORKER_ENABLED`) pass, else 503. The OpenClaw Connector's `health()` only PINGs Redis — worker liveness is checked at dispatch time, not at `/byclawSuper/ready`.

## Persistence and multi-instance execution

Schema lives in `packages/storage-postgres/src/migrations.ts` (prefix `byai_super_`, tracked via `byai_super_schema_migrations`). Tables: `sessions`, `runs`, `delegations`, `run_events`, `pi_sessions`, `pi_session_entries`, `ingress_session_bindings`, `session_execution_leases`, `run_execution_credentials`. Startup validates the schema version against `LATEST_POSTGRES_SCHEMA_VERSION` in code.

- **Migrations do not auto-run in production.** Use `pnpm db:migrate` (recommended: a separate release job). `DB_MIGRATE_ON_START=true` is for controlled environments only.
- **Run queue**: `FOR UPDATE SKIP LOCKED` claims the earliest non-terminal Run whose Session has no earlier non-terminal Run. Claim writes instance ID, lease expiry, attempt, and a monotonic fencing token.
- **Pi context**: stored as native Pi header + append-only entries (not flattened messages). New entries are staged `PENDING` for the current Run/attempt and promoted to `COMMITTED` in the Run's success transaction; failed/canceled attempts discard `PENDING`. The local JSONL is a disposable instance-private cache — on cache miss, instance switch, or redeploy, it is rebuilt from PostgreSQL via `SessionManager.open()`.
- **Recovery by `executionStage`** (`QUEUED` / Leader running / Connector waiting / Leader synthesizing) re-derives work from committed Pi context + persisted Delegation `externalRef`/cursor. The code paths exist; production sign-off still requires actually killing an instance in each stage and proving takeover (see `.dev/progress/CURRENT.md`).
- **Compatibility note**: SQL upserts use an advisory-lock + update/insert pattern that works on both standard PostgreSQL and the local openGauss test env (which lacks `LISTEN` — tests set `DB_EVENT_LISTEN_ENABLED=false` and poll). Standard PostgreSQL keeps `LISTEN/NOTIFY` on by default.

## Context engineering

The Leader's base system prompt (`super-assistant-system-prompt.ts`) holds only stable Supervisor responsibilities and safety bounds. Per-turn runtime context is assembled by `ContextCompiler` (`packages/by-conductor/src/context/`) through a fixed processor order:

1. `SupervisorPolicyProcessor` — normalizes/validates the stable system prompt.
2. `SessionContextProcessor` — injects locale, timezone, and current local date fixed at Session creation.
3. `AuthorizedAgentsProcessor` — encodes the Run's frozen authorized-agent snapshot as a dynamic data region.
4. `UserContextProcessor` — per-turn user context (e.g. attachment references).
5. `ContextCleanupProcessor` — drops empty regions and stabilizes the final format.

Adding a new context region = a new processor in this pipeline, not a prompt string concatenated in the Leader.

## Pi Leader configuration

`packages/by-conductor/src/pi-leader.ts`. Extensions, skills, prompt templates, themes, and context files are disabled. Compaction is ON (`reserveTokens=16384`, `keepRecentTokens=20000`); retries (max 2) are on. `LeaderSessionCache`: single-flight open, LRU, default max 100 sessions, 30min idle TTL.

**Tools** (`context/active-leader-tools.ts`):

- `delegateAgent` — present only when the Run's authorized-agent snapshot is non-empty; real delegation still re-validates via `DelegationService`.
- `inspectAttachment` — controlled tool that reads only the current Run's attachment IDs (resolved through `ByAiAttachmentResolver`, which downloads by `fileId` from ByClaw BE using the Run's short-lived credential; contract in `.dev/attachments-be-read-contract.md`).
- `downloadAttachment` — implementation and protocol kept, but currently **disabled** (`DOWNLOAD_ATTACHMENT_ENABLED = false`); the BE download endpoint is pending rework. While disabled, the Leader must delegate file reading to a specialist agent (see the base system prompt) instead of downloading. Re-enable centrally once the endpoint is wired.
- Pi built-in `read`/`write`/`edit`/`grep`/`find`/`ls` — **disabled** (`LEADER_FILE_TOOL_NAMES` is empty). The per-Session cwd (`<sessionCacheDirectory>/<sessionId>/files`) is still created for `downloadAttachment`, but no built-in file tool reads/writes it. Re-enable centrally by uncommenting entries in `LEADER_FILE_TOOL_NAMES` (`context/active-leader-tools.ts`).
- `askUserQuestion` — implementation and protocol kept, but currently **disabled** (`ASK_USER_QUESTION_ENABLED = false`); re-enable centrally when frontend interaction is fixed.
- `bash` and MCP stay disabled — `bash` would let any caller run arbitrary host commands (RCE).

## ByClaw BE integration (auth + agent catalog + attachments + capability cards)

- **Auth**: `auth/beyond-token.ts` verifies the `Beyond-Token` JWT with RS256 using the same login public key as ByClaw BE (`LOGIN_JWT_PUBLIC_KEY`; override only if the parent deployment does). There is no Java session. The token must carry a `userCode` claim.
- **Agent catalog**: `ByClawBeAgentCatalog.listAuthorizedAgents()` calls `/byaiService/api/v2/digitEmploy/discover` carrying the same token, keeping only `usesPermissions=true` entries. Catalog errors map to HTTP 401 (auth) or 502 (upstream).
- **Attachments**: `ByAiAttachmentResolver` downloads Run attachments by `fileId` from BE, authenticating with the Run's short-lived credential; bounded by `ATTACHMENT_MAX_FILE_BYTES` / `ATTACHMENT_MAX_TEXT_CHARS` / `ATTACHMENT_MAX_STRUCTURE_CHARS`.
- **Capability cards**: compiled via the Pi capability compiler (`POST /byclawSuper/v1/agent-capability-cards/compile`, `PUT /byclawSuper/v1/agents/:agentId/capability-card`) and back-filled from source employee tables via `pnpm capability:backfill` (source schema/DB overridable via `BYCLAW_SOURCE_*`).
- **Endpoint discovery**: `RedisByClawBeEndpointResolver` reads Redis hash `byai_gateway:sd:instances:ByaiService` (field `ByaiService:{instanceId}`), assembles origins from each instance's `protocol/host/port/path_prefix`, and load-balances by `weight`. It falls back to `BYCLAW_BE_BASE_URL` when the hash is empty, an instance is invalid, Redis throws, or the read times out.

## Domain types and state machines

All in `packages/by-conductor/src/types.ts`. Read it before touching status transitions.

- **Run**: `CREATED → QUEUED → RUNNING → (WAITING_AGENT → SYNTHESIZING)? → COMPLETED | FAILED | CANCELLING → CANCELLED`, plus `executionStage` distinguishing queue/leader/connector/synthesize phases.
- **Delegation**: `CREATED → QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED | TIMED_OUT`
- `TERMINAL_RUN_STATUSES` and `TERMINAL_DELEGATION_STATUSES` are the source of truth for "is this done."

`RunEvent` is the internal event union both out-adapters serialize from. `ConnectorEvent` (`progress | output_delta | artifact | completed | failed`) is the transport-neutral union Connectors emit — any new Connector must map its native events into this shape.

## Environment

Only one config file: `byclaw-super/.env` (copy from `.env.example`). The outer `ByClaw/.env` and any `app/.env` are ignored. `dotenv/config` is imported at the top of `app/index.ts`, so commands must run from the root. Defaults live in `app/config/config-defaults.ts`; same-named env vars override them. **DB credentials have no code defaults.**

Required / commonly overridden:

- **Database** (required for a working service): `DB_USER`, `DB_PASS`; plus `DB_HOST`, `DB_PORT` (default 5432), `DB_DATABASE`, `DB_SCHEMA` (default `byai`), `DB_SSL`, `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`. `DB_TYPE` must be `postgresql`. `DB_MIGRATE_ON_START` (default false), `DB_EVENT_LISTEN_ENABLED` (default true; set false on DBs without `LISTEN`).
- **Pi model**: the service reads the platform default LLM from Redis `byai:aimodel:typelist` field `LLM`; if Redis lookup or parsing fails it falls back to DeepSeek/Volcengine Ark using `PI_PROVIDER`, `PI_MODEL`, `ARK_BASE_URL`, and `ARK_API_KEY`. `PI_ENTRY_MAX_BYTES`, `PI_SESSION_MAX_BYTES`, `PI_SESSION_MAX_ENTRIES`, `PI_SESSION_CACHE_DIR` / `PI_SESSION_CACHE_MAX_ENTRIES` / `PI_SESSION_CACHE_IDLE_TTL_MS`.
- **Redis** (must be the same Redis the OpenClaw `byai-channel` worker uses): `REDIS_HOST`, `REDIS_PORT`, `REDIS_DATABASE`/`REDIS_DB`, optional `REDIS_USERNAME`/`REDIS_PASSWORD`.
- **Execution tuning**: `RUN_LEASE_MS`, `RUN_QUEUE_POLL_MS`, `RUN_CREDENTIAL_MAX_TTL_MS`, `RUN_CREDENTIAL_CLEANUP_INTERVAL_MS`, `DELEGATION_FIRST_ACTIVITY_TIMEOUT_MS`, `DELEGATION_IDLE_TIMEOUT_MS` (event-stream Connectors renew these boundaries with trusted activity), `DELEGATION_CALLBACK_TIMEOUT_MS` (absolute deadline after a callback Connector is accepted; child DataStream activity never renews it), `BYCLAW_INSTANCE_ID` (defaults to `byclaw-super-{hostname}-{pid}`, or `BYCLAW_WORKER_ID` if set; must be unique per instance). Legacy `DELEGATION_TIMEOUT_MS` and `OPENCLAW_FIRST_EVENT_TIMEOUT_MS` remain fallback aliases for the idle and first-activity settings only.
- **Worker**: `BYCLAW_WORKER_ENABLED` (default true) registers the process as a by-framework Worker under `BYCLAW_WORKER_AGENT_TYPE` (default `BY_SUPER`); `BYCLAW_WORKER_ID`, `BYCLAW_WORKER_MAX_CONCURRENCY`.
- **ByClaw BE / auth / attachments**: `BYCLAW_BE_BASE_URL`, `BYCLAW_BE_TIMEOUT_MS`, `LOGIN_JWT_PUBLIC_KEY`, `ATTACHMENT_TEMP_DIR`, `ATTACHMENT_MAX_FILE_BYTES`, `ATTACHMENT_MAX_TEXT_CHARS`, `ATTACHMENT_MAX_STRUCTURE_CHARS`, and `BYCLAW_SOURCE_*` for capability backfill.

## Conventions

- Code comments and some internal docs are in Chinese; root docs are in English. Match the surrounding file's language.
- TypeScript is strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `composite`, `NodeNext` modules (so relative imports inside packages use explicit `.js` extensions). Optional fields use conditional spread (`...(x ? { x } : {})`) rather than `x: undefined`. Re-exported types live in each package's `index.ts`.
- `app/` imports workspace packages as `@byclaw/by-conductor`, `@byclaw/connector-openclaw-by-framework`, `@byclaw/storage-postgres` (resolved via `tsconfig.base.json` paths for typecheck, via `workspace:*` for runtime).
- Memory repositories use `structuredClone` on save and get so callers can't mutate stored state.
- `app/runtime.ts` is the only place concrete Connectors, the storage backend, and the Worker are registered. New Connectors go in `packages/connectors/*-*/`, new inbound transports go in `app/` adapters, new storage backends go in `packages/storage-*` — all wired here, never in `by-conductor`.
- Prefer placing new code in the file matching its existing responsibility. Only split out a function/file when the logic reads independently, is reusable, or is independently testable — don't add base classes, managers, or extra abstraction layers for simple forwarding.
