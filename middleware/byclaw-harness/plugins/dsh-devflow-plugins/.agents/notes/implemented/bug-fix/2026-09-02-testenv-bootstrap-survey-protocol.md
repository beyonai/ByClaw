# Agent Note: testenv-bootstrap — survey protocol replaces stop-at-first research

Status: implemented

*Superseded 2026-09-11: the testenv executor this note describes is deleted; the
package is now the `devflow-e2e-bootstrap-runbook` skill alone — see [testenv
retreats from executor to one runbook skill](../feature/2026-09-11-testenv-retreats-to-runbook-skill.md). Kept for the reasoning a
future executor would face again.*

English | [中文](2026-09-02-testenv-bootstrap-survey-protocol.zh.md)

## Problem

The first real bootstrap against a deep workspace — a meta-root hosting a
monorepo with `vitest.e2e.config.ts`, `vitest.web.config.ts`, and Python
suites — produced a one-mock-service manifest with a smoke command as `test`,
and the rest of the test landscape was never inventoried or ruled out. The
cause was the skill body's own wording: "stop as soon as the start commands …
are established" and "start with the single most upstream service" are right
for a single-suite project and cause premature convergence everywhere else —
the first suite that runs is usually the most heavily mocked one, and nothing
forced proof that the chosen suite actually depends on the environment.

## Decision

`packages/devflow-testenv/assets/testenv-bootstrap.md` is an eight-section
survey protocol: landscape survey with an explicit ban on early convergence,
per-suite service-binding analysis (a fully mocked suite is never `test`),
suite selection with eliminations recorded in the manifest's header comment,
precondition inventory, a comment-complete manifest (scope declaration plus
per-entry provenance), the positive loop plus negative verification, an
in-session survey report, and repair. The old behavior survives as a bounded
fast path: exactly one test configuration, one CI test job, and no
workspace/monorepo structure skip sections 1–3.

Negative verification takes the shape the five tools can express honestly: no
tool stops a single service, and `integration_test` raises a down environment
itself, so falsification is `env_down` followed by the manifest's `test`
command run directly in the shell — it must turn red, and a green run sends
the binding analysis back to section 2. The file-discipline sentences (only
persistent artifact, never into the harness checkout, no shim manifest) carry
over verbatim; `tests/skill.spec.ts` pins the new contract sentences and the
absence of "stop as soon as".

## Alternatives considered

**Per-service kill for negative verification.** Truer falsification — one
dependency down instead of all — but no tool stops a single service, and a
shell-side kill leaves the engine believing the environment is up while a
service is dead. Whole-environment down is the only falsification the current
tools state honestly; a single-service stop tool has no owner.

**A multi-suite `tests` map in the manifest schema.** Would record the whole
landscape machine-readably, but no tool reads more than one `test` command;
the header comment carries the eliminations at zero schema cost.

**Splitting the skill into survey/write/repair skills.** Three invocation
surfaces for one workflow whose steps feed each other; the fast path already
removes the survey cost where it buys nothing.

## Consequences

Bootstrap on a deep repository reads more before the first `env_up`, spent on
classifying suites it will not run; simple projects keep the old cost through
the fast path. A green-but-meaningless manifest is now a detectable defect —
the red run fails to happen — rather than a silent one. The falsification is
deliberately coarse: it proves the suite depends on the environment as a
whole, not on each service individually.
