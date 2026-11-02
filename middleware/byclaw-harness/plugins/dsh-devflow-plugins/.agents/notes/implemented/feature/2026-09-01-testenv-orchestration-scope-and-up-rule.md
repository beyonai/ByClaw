# Agent Note: devflow-testenv — B-tier orchestration scope and the one up-command rule

Status: implemented

*Superseded 2026-09-11: the testenv executor this note describes is deleted; the
package is now the `devflow-e2e-bootstrap-runbook` skill alone — see [testenv
retreats from executor to one runbook skill](2026-09-11-testenv-retreats-to-runbook-skill.md). Kept for the reasoning a
future executor would face again.*

English | [中文](2026-09-01-testenv-orchestration-scope-and-up-rule.zh.md)

## Problem

Integration-test environments are re-discovered from scratch in every session:
which services exist, how each starts, when each counts as ready, and how to
tear everything down. The harness already covers "one background command with
tail and kill" through `bash(run_in_background)`, so a testenv plugin is only
worth shipping for what that cannot express — ordered multi-service topology
with readiness gates and a whole-environment teardown guarantee.

Two questions decide the engine's shape. How much orchestration does the
manifest promise? And what does "the service is up" mean when one `up` command
is a long-lived server (`pnpm start`) while another exits immediately after
delegating to a daemon (`docker compose up -d`)?

## Decision

**Scope is the B tier: ordered serial startup, one readiness probe per
service, whole-environment reverse teardown, one test command.** The
manifest's `services` list is the start order and the reverse of the teardown
order. There is no dependency DAG, no parallel startup, no port allocation, no
per-service restart, and no automatic retry — each is excluded for lacking a
current owner, not for being hard. The list form keeps a future `dependsOn`
field additive.

**One rule covers both up-command shapes, with no manifest field to pick a
shape.** `packages/devflow-testenv/src/engine.ts` starts each service and
then watches two things at once — the readiness probe and the process's exit:

- A passing probe means ready, whether or not the process still runs. This is
  the `compose up -d` case: the command may exit long before the daemon it
  delegated to answers the probe.
- A process that fails before its probe passes — non-zero exit, signal death,
  or a spawn-level error — fails the service immediately, with the exit facts
  in the error.
- A clean exit keeps the probe polling until the service's readiness deadline;
  only the deadline turns "exited 0 but never ready" into a failure, and the
  error says the process had already exited.

Any service failure rolls already-started services back in reverse order
before `up()` returns. A successful `up()` registers the environment as one
`ctx.effect()` whose disposer is the whole teardown, so fiber disposal cannot
leave service processes behind; `down()` runs the same disposer. Teardown runs
a declared `down` command first but always ends by terminating the up process
tree (idempotent when already gone) and waiting boundedly for whole-tree exit,
aggregating every service's failures instead of stopping at the first.

The engine holds every deadline itself — readiness polling, down commands,
seed/test runs — because the subprocess seam deliberately carries none. The
per-stream spill cap is a fixed constant (16 MiB), not config: the spill file
only backs recovery of a lossy incremental read, and the model-facing surface
stays the bounded in-memory tail.

## The workspace root, and rollback residue on the wire

**The workspace root is the process cwd captured once at apply time.**
*Superseded 2026-09-02: real deployments run the harness with its cwd at the
harness checkout, not any workspace, so apply-time capture resolved every
session's manifest into the checkout. The root now resolves per call from the
calling agent session's cwd, with one engine per workspace root — see the
[session-root resolution note](../bug-fix/2026-09-02-testenv-session-root-resolution.md).*
The original reasoning: the harness runs with its cwd at the workspace root —
the same assumption `devflow-filesystem`'s default root rests on — so `apply`
resolves the root eagerly and hands it to the engine, which resolves the
manifest path and every service `cwd` against that captured value.

**`env_up` reports the rollback's own residue as `teardownDetail`.** A failed
startup rolls the started services back, and that teardown aggregates its own
failures into the engine report — but the tool's closed output schema
(`additionalProperties: false`) had no field to carry them, so the model was
told "every started service was torn back down" even when the rollback left
processes or state behind. The wire field folds the engine's
`teardownFailures` lines into one text block; the render switches its verdict
line and appends the residue. Error quality is the manifest repair loop's
lifeline, and residue the model cannot see is residue nobody cleans up.

## Alternatives considered

**A tier — a bootstrap skill with no engine.** A skill can teach a session to
run commands, but it cannot promise teardown: nothing structural ties the
started processes to the session's lifetime, which is exactly the orphan
problem the effect-registered environment removes.

**C tier — dependency DAG, parallel startup, port allocation.** More capable,
but every extra capability lacked a current owner, and a DAG in the manifest
forces every manifest author to think in graphs when a list already encodes
the one ordering guarantee the B tier makes.

**A manifest field distinguishing self-exiting from long-lived up commands.**
It makes the author declare a fact the engine can observe, and it creates a
misdeclaration failure mode (a `compose`-style command marked long-lived would
fail on its own success). The unified rule needs no declaration and misreads
neither shape.

**Treating any pre-ready exit — including exit 0 — as immediate failure.** It
would fail `compose up -d` whenever the probe lags the command's exit, which
is that command's normal behavior. Only a failing exit is proof the service
cannot become ready.

**A `Config` field for the workspace root, or per-session cwd resolution.** A
configured root duplicates what the harness's own cwd already names and
invites the two to drift; per-session roots (the `devflow-tool` pattern) would
need an owning-agent identity on every call and one engine per workspace,
while this engine is one environment per session by design and its tools take
no session argument. *The per-session alternative is what shipped on
2026-09-02, once real deployment showed the cwd assumption false — the
[session-root resolution note](../bug-fix/2026-09-02-testenv-session-root-resolution.md)
owns that decision.*

**Structured `teardownFailures` on the wire instead of folded text.** The
reader is the model, which pages through rendered lines; no programmatic
consumer of a structured array exists, and publishing one would be wire
surface kept for nobody. The engine keeps the structured list internally, so
promoting it later is additive.

## Testing

`packages/devflow-testenv/tests/engine.spec.ts` runs the engine over the real
`LocalSubprocessRuntime` with real `sh`/`node` children for every lifecycle
claim: strict start order, ready-after-clean-exit, failing-exit-before-ready,
readiness timeout, reverse rollback with no surviving process, both teardown
paths, down-timeout degradation to termination, failure aggregation, status
re-probing, post-exit log reads, the up→seed→test ladder, and teardown through
fiber disposal. A scripted `SubprocessHandle` double covers only branches a
real process cannot reach deterministically — spawn-level rejections, a tree
that refuses to exit, in-flight state guards.

## Consequences

A session gets exactly one environment per engine instance, and the teardown
promise is structural rather than behavioral: disposing the fiber is
sufficient. The cost of the unified up rule is that a service whose command
exits 0 without ever becoming ready burns its full readiness deadline before
failing — the error message compensates by stating the process had already
exited. The B-tier cut means a service graph with genuine fan-in must be
linearized by hand in the manifest; reintroducing a `dependsOn` field is
additive if an owner appears. Capturing the root at apply time tied correct
resolution to the harness starting in the workspace — deployment proved it
starts elsewhere, and the "diagnosable failure" led a model to shim a manifest
into the harness checkout; the
[session-root resolution note](../bug-fix/2026-09-02-testenv-session-root-resolution.md)
replaced the capture. `env_up`'s output schema is now a
strict superset of `env_status`'s: the one extra field appears only on the
call that can roll back.
