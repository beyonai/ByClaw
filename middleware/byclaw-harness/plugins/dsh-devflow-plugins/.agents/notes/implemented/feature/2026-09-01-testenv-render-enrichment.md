# Agent Note: devflow-testenv — timing facts and enriched result rendering

Status: implemented

*Superseded 2026-09-11: the testenv executor this note describes is deleted; the
package is now the `devflow-e2e-bootstrap-runbook` skill alone — see [testenv
retreats from executor to one runbook skill](2026-09-11-testenv-retreats-to-runbook-skill.md). Kept for the reasoning a
future executor would face again.*

English | [中文](2026-09-01-testenv-render-enrichment.zh.md)

## Problem

The first real sessions against the testenv tools showed information-poor
results: a failing `integration_test` rendered one verdict sentence plus a log
tail, with the actual conclusion — how many tests failed — buried at the
bottom of that tail. The engine already knew the phase ladder and the service
topology, but not how long anything took or whether a run reused an
already-up environment, and the render projected almost none of what it knew.

## Decision

**The engine times itself on the monotonic clock.** The subprocess seam
deliberately carries no timing, so `packages/devflow-testenv/src/engine.ts`
measures with `performance.now()` differences — never wall-clock — the same
way it already owns every deadline: per service, milliseconds from spawn to
probe pass (`readyAfterMs`); per up attempt, the whole duration including any
rollback (`durationMs`); per `status()` re-probe, the answer time (`probeMs`);
per seed/test command, its run time; per `runTest()`, the whole-run duration.
A successful `up()` records the moment it finished, its duration, and the
per-service startup facts; `runTest()` reports `envReused: true` with
`envUpAgeMs` when it finds the environment already up, or `envReused: false`
with `upDurationMs` when it raised the environment itself.

**Every new report and wire field is optional, and renders read them
defensively.** A report from an engine without timing facts renders exactly
the old text — no placeholders, no thrown render.

**The `integration_test` render leads with the conclusion.** First line:
verdict, settling phase, exit code, total duration. Then the environment
block — a reused/fresh header plus one line per service with its probe kind
and timing, formatted by the same `serviceLines` helper `env_up` and
`env_status` render through — then a ✓/✗ phase timeline with durations, then
the runner's own summary line, then the output tail.

**Runner summary extraction is a per-line heuristic in the pure render, not a
wire field.** `RUNNER_SUMMARY_PATTERNS` in
`packages/devflow-testenv/src/tools.ts` is a small fixed regex set (the pytest
bar line, the pytest `-q` line, the vitest/jest `Tests` line); the last
matching line of the test output tail wins, and a tail no pattern matches
renders no summary line at all.

**The bootstrap skill body carries two file-discipline rules.**
`assets/testenv-bootstrap.md` states that the manifest is the skill's only
persistent artifact (experiment files go under `/tmp` or are deleted), and
that a command too complex to inline goes into the project's existing script
directory — no new directory for testenv.

## Alternatives considered

**A `testSummary` wire field carrying the extracted line.** The only reader is
the render, and the tail the line comes from is already on the wire; a
published field nothing else reads is surface kept for nobody. Extraction in
the pure render keeps the heuristic revisable, and promoting the line to the
wire later is additive.

**A real runner-output parser, or per-framework adapters.** Deep parsing of
any one framework's output has no current owner, grows without bound, and
fails noisily on the frameworks it does not know. The per-line pattern match
degrades to silence when it misses, which costs nothing — the full tail is
still right below.

**Wall-clock timing via `Date.now()`.** Every reported number is a duration —
a difference between two marks — and the monotonic clock is immune to clock
steps; the engine has no need for absolute timestamps.

**Required new fields.** Optional fields keep earlier report shapes valid for
render and for any external consumer of the exported report types, at the
price of defensive reads in the render helpers — which the old-shape render
tests pin anyway.

**jobs integration and a browser surface for test results.** Both were
considered as the second and third tier of this enrichment and deliberately
not built; the UI need is re-evaluated when gate integration lands and test
results flow into the devflow-ui board naturally.

## Testing

`packages/devflow-testenv/tests/tools.spec.ts` asserts the first-line
verdict-with-duration, the environment block in both the fresh and the reused
branch, the phase timeline, a pytest-style summary line rendered ahead of the
output tail, silence when no pattern matches, and old-shape reports through
both crafted render values and an engine double that reports no timing facts.
`tests/engine.spec.ts` asserts the new report fields on real child-process
runs, including the reuse-age fields flipping between a fresh run and a
re-run.

## Consequences

Result renders are several lines longer, spent on facts the model previously
had to re-derive with extra tool calls (or could not see at all). The five
surfaces describing each field — output schema description, render text,
both READMEs' tool tables, and the type comments — say the same thing in the
same words, and a change to one owes the others. The pattern set is
deliberately small: an unrecognized runner costs only the summary line, and
supporting it is one appended pattern. `env_up`'s and `env_status`'s service
entries share one schema, so `probeMs` is documented as an env_status fact
even where env_up never sets it.
