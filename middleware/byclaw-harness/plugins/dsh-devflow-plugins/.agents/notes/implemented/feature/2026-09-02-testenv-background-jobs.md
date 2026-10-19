# Agent Note: devflow-testenv — integration_test as a background job

Status: implemented

*Superseded 2026-09-11: the testenv executor this note describes is deleted; the
package is now the `devflow-e2e-bootstrap-runbook` skill alone — see [testenv
retreats from executor to one runbook skill](2026-09-11-testenv-retreats-to-runbook-skill.md). Kept for the reasoning a
future executor would face again.*

English | [中文](2026-09-02-testenv-background-jobs.zh.md)

## Problem

Real sessions showed the model abandoning `integration_test` for
`bash(run_in_background: true)` whenever a suite ran long: the bash job gives
live output, an id to poll, and a kill switch, while the deterministic tool
blocked the turn until the suite finished. Every defection lost the phase
report, the seed orchestration, the environment-reuse annotation, the runner
summary, and the manifest's `test` command as the single source of truth. A
deterministic tool that loses to a raw shell on ergonomics stops being used.

## Decision

**`integration_test` takes the harness's own `run_in_background: true`
parameter and registers the whole up → seed → test chain as one `ctx.jobs`
job** (kind `testenv-integration`, declaration-merged into `JobKindMap`;
label `integration test`; owner = `exec.agent`, exactly the bash tool's
precedent). The tool returns `{ jobId }` immediately; the output schema is a
`oneOf` whose synchronous branch is byte-identical to the previous shape.

**The engine grew one observed-run form, not a second state machine.**
`runTest()` now delegates to a private `executeRun(observer?)`; the public
synchronous path passes `undefined` and is pinned unchanged by the existing
render tests. `runTestObserved()` wraps the same path in an `ObservedRun`
that (a) collects phase-marker lines and the live seed/test output into one
consuming cursor — stream text arrives as offset-delta reads of the spawn's
bounded in-memory tail, the same mechanism `logs()` uses, with lossy reads
announced — and (b) carries one `AbortController` whose signal joins every
readiness poll and foreground spawn via `AbortSignal.any`, so cancellation
rides the exact signals the deadlines already use.

**Cancellation semantics reuse the existing teardown paths.** Cancel during
the up phase surfaces as a start failure ("the run was cancelled before the
service became ready") and rolls back through the ordinary `rollBack`; cancel
during seed/test terminates the tree through the spawn signal, and — after
the run settles — an environment the run brought up itself is torn down
through `down()`, while an environment reused from an earlier `up()` stays up
because that call owns it.

**Job status maps deliberately** (`src/tools.ts`, `observeJob`): a settled
run is `completed` even when the test is red or the up phase failed — the
failure is the *result*, rendered by the very same `renderIntegrationTest`
pure function the synchronous path uses (extracted from the inline render, so
there is exactly one failure wording); `killed` is a cancelled run; `failed`
is reserved for the run itself breaking (an invalid manifest — with the
`testenv-bootstrap` pointer appended, mirroring `guarded()` — or an engine
state that refused the run). The final render is both the `JobOutcome.output`
and the last delta of the streaming cursor, so the settling `job_output` read
delivers it.

**`ctx.jobs` is an optional peer, honest when absent.** The package declares
`@deepseek-ai/dsh-jobs` as an optional `peerDependency` (types only; runtime
always goes through `ctx.get('jobs')`). A composition without the service
fails the background call with the synchronous alternative named; a registry
that refuses for lack of a controller propagates its message verbatim with
the same alternative appended. No silent downgrade to the synchronous path.

## Alternatives considered

**A copy of the run loop for the observed form.** Rejected: the teardown and
timeout semantics are the hardest-won part of the engine; the observer
parameter threads through `up`/`startService`/`runBounded` precisely so the
job path cannot drift from the synchronous one.

**`failed` for a red test.** Rejected after reading the jobs vocabulary: the
registry reserves `failed` for producer breakage, and the bash tool maps a
non-zero exit to `completed` with the exit code as detail. A red test is a
successful run of the job.

**Tearing down a reused environment on kill.** Rejected: the job owns only
what it created; an environment a user brought up with `env_up` outlives the
killed run, exactly as it outlives a failed synchronous run.

**Backgrounding `env_up`.** Out of scope with no owner; the up phase is
bounded by readiness deadlines and its waiting problem is far smaller.

## Testing

`tests/engine.spec.ts` drives observed runs over real child processes:
markers and live output read mid-run (gated on a flag file, so the process
provably still runs), cancel during test (tree dead, environment down),
cancel against a reused environment (stays up), cancel during up (rolled
back, cancellation named), and a lossy overflow announcement.
`tests/tools.spec.ts` composes the real `LocalJobRegistry` (+ real
`AgentRegistry` for the owned-job fence) and proves: immediate job-id return,
during-run `job_output` content, final output equal to the synchronous render
of the same manifest (durations normalized) for both a green and a red run,
`kill` → `killed` with no surviving process, `failed` for manifest and engine
defects, the two no-jobs/no-controller refusals, and the synchronous path
byte-stable under `run_in_background: false`. `tests/loader-composition.spec.ts`
boots `@deepseek-ai/dsh-jobs-local` through the real Loader and runs the
background path end to end.

## Consequences

The five surfaces describing the background contract — parameter and schema
descriptions, the render acknowledgement, both READMEs, and the type
comments — say the same thing and owe each other updates. The streaming
cursor is bounded per phase by `logTailBytes`, not overall; a caller that
never reads gets at most one bounded tail per phase plus the markers. The
observed handle's `done` never rejects into the registry: `observeJob`
converts rejections to `failed`, honoring the `JobHooks.done` contract.
`@deepseek-ai/dsh-jobs` joins the pinned-prerelease set and must move with
every harness bump.
