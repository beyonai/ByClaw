# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`byclaw-super` is a standalone TypeScript service that orchestrates "digital employee" agents. A Pi-SDK-backed Leader LLM understands the user's goal in natural language, picks agents from an authorization snapshot, and delegates execution through a pluggable Connector SPI. V1 ships one Connector (`openclaw-by-framework`) that talks to OpenClaw workers via Redis streams.

This is a subproject of the broader ByClaw monorepo but has its own build, dependencies, and runtime. The parent `ByClaw/CLAUDE.md` does not apply to this service.

**Authoritative context doc**: `.dev/PROJECT_CONTEXT.md` holds the full product background, fixed decisions, and call chain. Read it before making architectural changes.

## Commands

All commands run from the repo root. Node ≥ 22.19, pnpm 11.3.0.

```bash
pnpm install                # install workspace deps
pnpm dev                    # build internal packages, then tsx app/index.ts (reads root .env, port 3000)
pnpm build                  # build packages + tsc -p tsconfig.json → dist/
pnpm start                  # node dist/index.js (production)
pnpm typecheck              # build packages, then tsc --noEmit across workspace
pnpm test                   # build, then vitest run (all *.test.ts)
pnpm smoke                  # real Redis + OpenClaw round-trip; needs BEYOND_TOKEN
                             # optional: BYCLAW_SUPER_URL (default :3000), SMOKE_MESSAGE
```

There is no custom single-test wrapper — use vitest directly:

```bash
pnpm exec vitest run app/test/http.test.ts
pnpm exec vitest run -t "creates a run"   # by test name pattern
```

`pnpm dev` and `pnpm build` always run `pnpm -r run build` first because `app/` consumes compiled `dist/` from the workspace packages via `tsconfig` references and `workspace:*`. Editing a package's `.ts` without rebuilding will not be seen by the app.

## Layout and dependency boundary (critical)

pnpm workspace. The root directory itself is the deployable app `@byclaw/byclaw-super`; `app/` is just its source folder (no `package.json`, no `tsconfig.json`, no `.env`).

```
app/                              Composition Root + HTTP/Worker adapters (this is src/)
  index.ts                        process entry: dotenv, createApplication(), signal-driven shutdown
  runtime.ts                      Composition Root: wires ports, Connector, services, HTTP, Worker
  config/                         loadConfig(): validates/normalizes .env into AppConfig
    index.ts                      env → AppConfig (config-defaults.ts holds the defaults table)
  ingress/
    run-ingress-service.ts        SHARED ingress: token verify → agent snapshot → createRun
  business/                       ByClaw BE outbound integration
    agent-catalog.ts              authorized agents from ByClaw BE (/digitEmploy/discover)
    endpoint-resolver.ts          resolves ByClaw BE endpoint from Redis service registry
  auth/beyond-token.ts            RS256 JWT verifier (reuses ByClaw BE login public key)
  server/app.ts                   Fastify HTTP: Session/Run creation, Run query/cancel, authenticated SSE
  server/byclaw-sse.ts            RunEvent → ByClaw thinking/answer SSE frame serializer
  worker/by-framework-worker.ts   by-framework inbound Worker + runtime lifecycle
  adapters/openclaw/              reserved for app-local Connector shims
  scripts/smoke.ts                the `pnpm smoke` round-trip
  test/                           vitest specs
packages/by-conductor/            Orchestration core + Connector SPI (framework-neutral)
packages/connectors/
  openclaw-by-framework/          OpenClaw Connector built on @byclaw/by-framework
.dev/                             Long-form context: PROJECT_CONTEXT.md, progress, plans
e2e/                              placeholder, currently empty
legacy/                           Pre-refactor reference; excluded from vitest and workspace
```

**Hard dependency direction** (enforced by package deps; do not bypass):

```
app → by-conductor
app → connector-openclaw-by-framework
connector-openclaw-by-framework → by-conductor
connector-openclaw-by-framework → by-framework (Redis transport)

by-conductor ✕→ any concrete Connector, Fastify, Redis, or by-framework
```

Concretely: `by-conductor` must stay transport-neutral. Don't import Fastify, Redis, `by-framework`, or any Connector from inside `packages/by-conductor/src/`. New runtimes (Hermes, Codex, etc.) belong in a new `packages/connectors/*-*/` package, registered from `app/runtime.ts`, never patched into the Leader.

## Architecture

The runtime is a single process with **two inbound entry points** that both funnel through one `RunIngressService`, plus **outbound** delegation through the Connector. State lives in memory for V1 — restarting loses everything (known limitation, not a bug).

```
INBOUND (two paths, same ingress chain)
  A) HTTP:   POST /v1/sessions {message}                    create Session + first Run
             POST /v1/sessions/:sessionId/runs {message}    append a Run
  B) Worker: by-framework AskAgent → app/worker/by-framework-worker.ts
                 (targetAgentType = BYCLAW_WORKER_AGENT_TYPE; Beyond-Token in metadata;
                  by-framework sessionId → sessionId via #externalSessionBindings map)
        ↓ both
  RunIngressService.createSessionRun/createRun
    → auth/beyond-token:        verify RS256 JWT, build CallerPrincipal
    → Session lookup:          append path → require full owner match; missing/foreign both return 404
    → ByClawBeAgentCatalog:     GET /byaiService/api/v2/digitEmploy/discover,
                                keep only usesPermissions=true agents (refreshed every turn)
    → new Session only through POST /v1/sessions
    → RunService.createRun      (snapshots agentList; Beyond-Token rides on metadata)
    ← response: { sessionId, runId, status, eventsUrl }
        ↓ enqueues into per-Session FIFO
  RunService.#pump → #execute   (lazily creates a Pi LeaderSession per Session)
  PiLeaderSession.run           prompts Pi; tools: delegateAgent + read/write/edit/grep/find/ls
  delegateAgent execute         bridges into DelegationService via activeInput
        ↓ OUTBOUND
  DelegationService.execute     re-checks authorization vs snapshot, aggregates Connector events
  ConnectorRegistry.require     strict lookup; missing Connector = hard error, no fallback
  OpenClawByFrameworkConnector  dispatches via by-framework GatewayClient to BYCLAW_EXE_{userCode}
  Redis XREAD on session stream deltas aggregated, reasoning events dropped
  AgentResult → Leader synthesizes → RunEvents appended to event store

OUT (two paths, same RunEvent stream)
  A) HTTP:   GET /v1/runs/:runId/events → owner check → server/byclaw-sse.ts → ByClaw SSE frames
  B) Worker: worker #forwardRunEvents → by-framework reasoningLog*/answerDelta protocol
```

**Key invariants** (these are enforced in code and should be preserved):

- **Per-Session FIFO, cross-Session parallel.** `RunService` keeps one queue per Session and one reused Pi Session per Session to preserve conversation context. Don't add global locking.
- **`sessionId` is the multi-turn handle; `runId` is one execution.** `POST /v1/sessions` creates both; each later `POST /v1/sessions/:sessionId/runs` returns a new `runId`. One Session owns one reused Pi LeaderSession. Missing and foreign Session/Run IDs both return 404. All state lives in memory, so restart or another instance invalidates both IDs.
- **Session is the authorization root.** `Session.owner` contains `tenantId + userCode + namespace`; Run access resolves `Run.sessionId` and compares the complete owner before query, cancel, append, or SSE. A `runId` is a locator, never an authorization credential.
- **Authorization is fetched at ingress and re-checked at execution.** `RunIngressService` pulls the agent snapshot from ByClaw BE (`usesPermissions=true` only) when the Run is created; `DelegationService.execute` re-validates `agentId` against that snapshot before touching the Connector. Never let the Leader select an agent outside the snapshot.
- **Leader sees no transport detail.** `AgentProfile.execution` (connectorId, targetId) is never injected into the Pi prompt — only `id/code/name/description` are. Don't leak Connector internals into the LLM context.
- **`Beyond-Token` is request-scoped and never persisted.** It is required on every Session/Run endpoint. It rides only in the in-memory queue/active execution context, flows into the Connector, and is never written to Session, Run, Delegation, ExternalExecutionRef, events, or logs.
- **`userCode`/`tenantId`/`namespace`/`agentId` are NOT request body fields.** `userCode` and optional tenant fields come from verified claims; `namespace` comes from the verified ingress context (`System-Code`, defaulting to `default`); `agentId` is chosen by the Leader from the server-fetched snapshot. Request bodies contain only `message`.
- **Cancellation cascades**: Run → Pi `session.abort()` + AbortController + `DelegationService.cancelRun` → idempotent `ConnectorExecution.cancel()` per active delegation. The Worker maps inbound `CancelTaskCommand` to `RunService.cancelRun`. Connector cancel promises are memoized so concurrent triggers (user cancel, timeout, signal) only hit the external system once.
- **SSE is replay-capable.** `Last-Event-ID` resumes after the stored event id; client disconnect does NOT cancel the Run; terminal status closes the stream. The HTTP POST only submits; SSE is a one-way result stream. A 15s heartbeat comment keeps proxies alive.
- **Wire format is ByClaw's thinking model, not the internal event union.** Internal `RunEvent`s are translated for both out-paths: HTTP via `byclaw-sse.ts` (`reasoningLogStart/Delta/End`, `answerStart/Delta/End`, `appStreamResponse`, `error`); the Worker via `by-framework` `REASONING_LOG_*` / `ANSWER_DELTA`. Both adapters collapse raw Pi/OpenClaw reasoning into safe, stable Chinese progress text — do not leak raw upstream reasoning to clients.
- **`/health`** = process alive; **`/ready`** = Pi model + all Connector health checks + Worker health (when `BYCLAW_WORKER_ENABLED`) pass, else 503. The OpenClaw Connector's `health()` only PINGs Redis — worker liveness is checked at dispatch time, not at `/ready`.

**Pi Leader configuration** (`packages/by-conductor/src/pi-leader.ts`): extensions, skills, prompt templates, themes, and context files are disabled. Tools enabled: `delegateAgent` plus Pi's built-in file/search tools (`read`/`write`/`edit`/`grep`/`find`/`ls`, via `LEADER_FILE_TOOL_NAMES` in `context/active-leader-tools.ts`). Their `cwd` is pinned to a per-Session directory under the cache root (`<sessionCacheDirectory>/<sessionId>/files`), not the repo root — so `.env`/source stay out of reach and different Sessions are file-isolated; the dir is cleaned on Session dispose. Shell (`bash`) and MCP stay disabled — `bash` would let any caller run arbitrary commands on the host. Compaction is off; retries (max 2) are on.

## ByClaw BE integration (auth + agent catalog + discovery)

- **Auth**: `auth/beyond-token.ts` verifies the `Beyond-Token` JWT with RS256 using the same login public key as ByClaw BE (`LOGIN_JWT_PUBLIC_KEY`; override only if the parent deployment does). There is no Java session. The token must carry a `userCode` claim.
- **Agent catalog**: `ByClawBeAgentCatalog.listAuthorizedAgents()` calls `/byaiService/api/v2/digitEmploy/discover` carrying the same token, and keeps only entries with `usesPermissions=true`. Catalog errors map to HTTP 401 (auth) or 502 (upstream).
- **Endpoint discovery**: `RedisByClawBeEndpointResolver` reads Redis hash `byai_gateway:sd:instances:ByaiService` (field `ByaiService:{instanceId}`), assembles origins from each instance's `protocol/host/port/path_prefix`, and load-balances by `weight`. It falls back to `BYCLAW_BE_BASE_URL` when the hash is empty, an instance is invalid, Redis throws, or the read times out.

## Domain types and state machines

All in `packages/by-conductor/src/types.ts`. Read it before touching status transitions.

- **Run**: `CREATED → QUEUED → RUNNING → (WAITING_AGENT → SYNTHESIZING)? → COMPLETED | FAILED | CANCELLING → CANCELLED`
- **Delegation**: `CREATED → QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED | TIMED_OUT`
- `TERMINAL_RUN_STATUSES` and `TERMINAL_DELEGATION_STATUSES` are the source of truth for "is this done."

`RunEvent` (`run.created | run.status | leader.delta | delegation.started | delegation.progress | delegation.completed | delegation.failed | run.completed | run.failed | run.cancelled`) is the internal event union both out-adapters serialize from. `ConnectorEvent` (`progress | output_delta | artifact | completed | failed`) is the transport-neutral union Connectors emit — any new Connector must map its native events into this shape.

## Environment

Only one config file: `byclaw-super/.env` (copy from `.env.example`). The outer `ByClaw/.env` and any `app/.env` are ignored. `dotenv/config` is imported at the top of `app/index.ts`, so commands must run from the root.

Required for a working dev loop:

- `PI_PROVIDER` + `PI_MODEL` must be set together (or both omitted). Mismatch is a startup error. `OPENAI_API_KEY` + `OPENAI_BASE_URL` for the Zhipu/GLM endpoint.
- Redis reachable at `REDIS_HOST:REDIS_PORT` on `REDIS_DATABASE` — must be the **same** Redis the OpenClaw `byai-channel` worker uses.
- `DELEGATION_TIMEOUT_MS` bounds each delegation (default 30 min).
- `BYCLAW_WORKER_ENABLED` (default true) registers the process as a by-framework Worker under `BYCLAW_WORKER_AGENT_TYPE` (default `BY_SUPER`); set `false` for HTTP/SSE-only. `BYCLAW_WORKER_ID` defaults to `byclaw-super-{hostname}` and must be unique within the Redis.
- `BYCLAW_BE_BASE_URL` / `BYCLAW_BE_TIMEOUT_MS` are the fallback origin/timeout for agent-catalog calls.

## Conventions

- Code comments and some internal docs are in Chinese; root docs are in English. Match the surrounding file's language.
- TypeScript is strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `composite`. Optional fields use conditional spread (`...(x ? { x } : {})`) rather than `x: undefined`. Re-exported types live in `index.ts`.
- `app/` imports workspace packages as `@byclaw/by-conductor` and `@byclaw/connector-openclaw-by-framework` (resolved via `tsconfig.base.json` paths for typecheck, via `workspace:*` for runtime).
- Memory repositories use `structuredClone` on save and get so callers can't mutate stored state.
- `app/runtime.ts` is the only place concrete Connectors and the Worker are registered. New Connectors go in `packages/connectors/*-*/`, new inbound transports go in `app/` adapters, and both are wired here — never in `by-conductor`.
