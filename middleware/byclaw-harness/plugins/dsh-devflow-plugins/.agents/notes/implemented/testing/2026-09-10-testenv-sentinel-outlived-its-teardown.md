# Agent Note: a test sentinel that outlived the teardown waiting for it

Status: implemented

*Superseded 2026-09-11: the testenv executor this note describes is deleted; the
package is now the `devflow-e2e-bootstrap-runbook` skill alone — see [testenv
retreats from executor to one runbook skill](../feature/2026-09-11-testenv-retreats-to-runbook-skill.md). Kept for the reasoning a
future executor would face again.*

## Problem

`packages/devflow-testenv/tests/engine.spec.ts` failed in CI on two independent
branches with the same message:

```
FAIL  runTestObserved over real processes
      > cancel leaves a reused environment up, because the earlier up() owns it
Error: Hook timed out in 30000ms.
 ❯ packages/devflow-testenv/tests/engine.spec.ts:36:1
```

It passed locally every time, and passed on a third branch. Retrying the CI job
turned it green. That profile — intermittent, load-correlated, green on retry —
invites treating it as noise and re-running until it passes.

It is not noise. Three tests in the file spawned `sleep 60` as a sentinel: a
process that must outlive the deadline or cancellation being exercised. The
deadlines they exercise are 250ms, 300ms, and a cancel handshake.

The file's `afterEach` disposes each environment's fiber under a **30 second**
budget. These are real processes, so teardown waits for them. A sentinel of 60
seconds against a teardown budget of 30 therefore guarantees that **any** delay
in a termination path converts into a hook timeout — the budget cannot cover
the worst case the test itself creates.

The reported failure also names the wrong thing. The error points at the
`afterEach` hook, not at the process it was waiting for, so the log invites a
hunt through teardown code for a bug that is not there.

## Decision

The sentinel becomes `sleep 10`, behind a named constant whose doc states the
constraint that chose the number:

```ts
const OUTLIVES_ITS_DEADLINE = 'sleep 10'
```

Ten seconds is roughly thirty times the longest deadline any of these tests
exercises, and a third of the teardown budget. Whatever a loaded runner does to
the termination path, teardown now finishes inside its budget.

## What this does not claim

It does not establish that cancellation reaps the process tree promptly. The
engine says it does — a cancelled report carries "the command was cancelled and
its process tree was terminated" — but no test asserts the processes are gone,
and this change does not add one. If that path does leak, the file is now slower
rather than failing, and the leak stays invisible.

That is a real gap and it is left open deliberately: closing it means capturing
the sentinel's pid through the engine's spawn seam and asserting its death,
which is a test to design rather than a number to change. Recorded here so the
next reader of this file knows the coverage is absent rather than assumed.

## Alternatives considered

**Raise the `afterEach` budget above 60 seconds.** Also makes the failure stop.
Rejected: it keeps the worst case and doubles what a genuine hang costs before
anyone hears about it. The budget was not the thing that was wrong.

**Retry the job.** It works — the rerun passed. Rejected as the fix: the test
would keep blocking merges at whatever rate CI happens to be loaded, and a
release train is exactly where that rate stops being tolerable.

**Assert the sentinel dies, and shorten it.** The stronger change. Not taken
here because it needs the pid to reach the test, and a release was waiting on
the CI signal. See the gap above.

## Consequences

- The file runs faster: its three slowest tests no longer hold a 60-second child
  through their teardown.
- The constant is named for its obligation, so shortening a deadline elsewhere
  in the file does not silently invalidate it, and lengthening the sentinel past
  the teardown budget is now visibly wrong.

## Verification

- `packages/devflow-testenv/tests/engine.spec.ts` run three times: 27 tests, all
  passing, ~4.3s each.
- `vitest run`: 99 suites, 1303 tests.
- `test:coverage`: per-file 100% on `packages/*/src`.
- `oxlint` and `tsc -b --force`: clean.
- The CI signal is what this change exists for, and it is only proven by CI.
