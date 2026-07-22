# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`byclaw-super` is a standalone TypeScript service that orchestrates "digital employee" agents. A Pi-SDK-backed Leader LLM understands the user's goal in natural language, picks agents from a pre-authorized snapshot, and delegates execution through a pluggable Connector SPI. V1 ships one Connector (`openclaw-by-framework`) that talks to OpenClaw workers via Redis streams.

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
pnpm smoke                  # real Redis + OpenClaw worker round-trip; needs SMOKE_AGENT_ID, BEYOND_TOKEN
```

There is no custom single-test wrapper — use vitest directly:

```bash
pnpm exec vitest run packages/by-conductor/test/conductor.test.ts
pnpm exec vitest run -t "creates a run"   # by test name pattern
```

`pnpm dev` and `pnpm build` always run `pnpm -r run build` first because `app/` consumes compiled `dist/` from the workspace packages via `tsconfig` references and `workspace:*`. Editing a package's `.ts` without rebuilding will not be seen by the app.

## Layout and dependency boundary (critical)

pnpm workspace. The root directory itself is the deployable app `@byclaw/byclaw-super`; `app/` is just its source folder (no `package.json`, no `tsconfig.json`, no `.env`).

```
app/                              Fastify HTTP layer + Composition Root (this is src/)
packages/by-conductor/            Orchestration core + Connector SPI (framework-neutral)
packages/connectors/
  openclaw-by-framework/          OpenClaw Connector built on @byclaw/by-framework
.dev/                             Long-form context: PROJECT_CONTEXT.md, progress, plans
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

The runtime is a single process. State lives in memory for V1 — restarting loses everything (known limitation, not a bug).

**Call chain** for a Run:

```
POST /v1/threads/:threadId/runs
  → RunService.createRun           enqueues into per-Thread FIFO
  → RunService.#pump → #execute    lazily creates a Pi LeaderSession for the Thread
  → PiLeaderSession.run            prompts Pi; only tool is delegateAgent
  → delegateAgent execute          bridges into DelegationService via activeInput
  → DelegationService.execute      re-checks authorization, starts Connector, aggregates events
  → ConnectorRegistry.require      strict lookup; missing Connector = hard error, no fallback
  → OpenClawByFrameworkConnector   dispatches via by-framework GatewayClient to BYCLAW_EXE_{userCode}
  → Redis XREAD on session stream  deltas aggregated, reasoning events dropped
  → AgentResult returned to Leader → Leader synthesizes → SSE emits run.completed
```

**Key invariants** (these are enforced in code and should be preserved):

- **Per-Thread FIFO, cross-Thread parallel.** `RunService` keeps one queue per Thread and one reused Pi Session per Thread to preserve conversation context. Don't add global locking.
- **Authorization is re-checked at execution time.** The Run snapshots `agentList` at creation; `DelegationService.execute` re-validates `agentId` against that snapshot before touching the Connector. Never let the Leader select an agent outside the snapshot.
- **Leader sees no transport detail.** `AgentProfile.execution` (connectorId, targetId) is never injected into the Pi prompt — only `id/code/name/description` are. Don't leak Connector internals into the LLM context.
- **`Beyond-Token` is request-scoped.** It rides on `CreateRunInput.metadata`, flows into the Connector, is forwarded to OpenClaw, and is never persisted to `Delegation`, `ExternalExecutionRef`, events, or logs. `ExternalExecutionRef.metadata` is the boundary — keep it credential-free.
- **Cancellation cascades**: Run → Pi `session.abort()` + AbortController + `DelegationService.cancelRun` → idempotent `ConnectorExecution.cancel()` per active delegation. Connector cancel promises are memoized so concurrent triggers (user cancel, timeout, signal) only hit the external system once.
- **SSE is replay-capable.** `Last-Event-ID` resumes after the stored event id; client disconnect does NOT cancel the Run; terminal status closes the stream. The HTTP POST only submits; SSE is a one-way result stream.
- **`/health`** = process alive; **`/ready`** = Pi model + all Connector health checks pass (returns 503 otherwise). The OpenClaw Connector's `health()` only PINGs Redis — worker liveness is checked at dispatch time, not at `/ready`.

**Pi Leader configuration** (`packages/by-conductor/src/pi-leader.ts`): extensions, skills, prompt templates, themes, context files, and all built-in tools are disabled. `delegateAgent` is the *only* tool. Compaction is off; retries (max 2) are on. Don't enable Shell, file, or MCP tools on the Leader — that breaks the security model.

## Domain types and state machines

All in `packages/by-conductor/src/types.ts`. Read it before touching status transitions.

- **Run**: `CREATED → QUEUED → RUNNING → (WAITING_AGENT → SYNTHESIZING)? → COMPLETED | FAILED | CANCELLING → CANCELLED`
- **Delegation**: `CREATED → QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED | TIMED_OUT`
- `TERMINAL_RUN_STATUSES` and `TERMINAL_DELEGATION_STATUSES` are the source of truth for "is this done."

`ConnectorEvent` is the transport-neutral union (`progress | output_delta | artifact | completed | failed`). Any new Connector must map its native events into this shape.

## Environment

Only one config file: `byclaw-super/.env` (copy from `.env.example`). The outer `ByClaw/.env` and any `app/.env` are ignored. `dotenv/config` is imported at the top of `app/index.ts`, so commands must run from the root.

Required for a working dev loop:
- `PI_PROVIDER` + `PI_MODEL` must be set together (or both omitted). Mismatch is a startup error.
- `OPENAI_API_KEY` for the Zhipu/GLM endpoint.
- Redis reachable at `REDIS_HOST:REDIS_PORT` on `REDIS_DATABASE` — must be the **same** Redis the OpenClaw `byai-channel` worker uses.
- `DELEGATION_TIMEOUT_MS` bounds each delegation (default 30 min).

`userCode`, `tenantId`, `agentId` are API request params, not env vars. `Beyond-Token` comes via the `Beyond-Token` header on `POST /v1/threads/:threadId/runs`.

## Conventions

- Code comments and some internal docs are in Chinese; root docs are in English. Match the surrounding file's language.
- TypeScript is strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `composite`. Optional fields use conditional spread (`...(x ? { x } : {})`) rather than `x: undefined`. Re-exported types live in `index.ts`.
- `app/` imports workspace packages as `@byclaw/by-conductor` and `@byclaw/connector-openclaw-by-framework` (resolved via `tsconfig.base.json` paths for typecheck, via `workspace:*` for runtime).
- Memory repositories use `structuredClone` on save and get so callers can't mutate stored state.
