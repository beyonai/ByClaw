# Agent Note: testenv-author — a second skill and two consent gates for projects with no suite

Status: implemented

*Superseded 2026-09-11: the testenv executor this note describes is deleted; the
package is now the `devflow-e2e-bootstrap-runbook` skill alone — see [testenv
retreats from executor to one runbook skill](2026-09-11-testenv-retreats-to-runbook-skill.md). Kept for the reasoning a
future executor would face again.*

English | [中文](2026-09-02-testenv-author-skill.zh.md)

## Problem

`testenv-bootstrap`'s zero-candidate exit is honest but terminal: the survey
reports that testenv does not apply and names what would have to change — a
service-bound suite — and nothing owns making that change. A project with no
integration tests got a diagnosis instead of a path, and a model pressed to
continue either stopped or improvised test code with no plan, no evidence
discipline, and no user consent.

## Decision

`packages/devflow-testenv/assets/testenv-author.md` is a second bundled
skill, served by the same provider as bootstrap at the same rank from the
same assets directory. Its body is a five-phase protocol: survey the code
(service surface, persistent-state data flows, existing-test conventions —
enumerated from the repository, never assumed), derive a plan whose every
scenario carries a code anchor (no anchor, no entry), report the plan and
stop at the approval gate, write and empirically validate the approved
scenarios (product-behavior assertions across the service boundary, endpoints
from environment or configuration, intent/behavior mismatches reported as
findings rather than pinned into assertions), and hand back to bootstrap,
whose fast path then selects the new suite. A survey that finds no seam worth
an integration test reports not-applicable instead of manufacturing one.

The division of labor is deliberate: author writes tests, bootstrap alone
writes and proves the manifest — one owner per artifact.

Two consent gates connect the skills, and neither is automated. Bootstrap's
zero-candidate section suggests author as the next step and leaves taking it
to the user (gate one; a user who opens with "add integration tests" enters
directly), and author's plan report requires approval before any code is
written (gate two, which stands even when the user initiated the skill).
`tests/skill.spec.ts` pins both bodies' contract sentences and the
name-scoped override: a lower-ranked `testenv-bootstrap` rival replaces only
bootstrap, and disposing the plugin fiber withdraws both skills.

## Alternatives considered

**Folding the authoring protocol into `testenv-bootstrap`.** One invocation
surface, but the two bodies answer different questions — select and record an
existing suite versus derive and write a new one — and their triggers never
overlap: bootstrap fires on manifest questions and manifest errors, author on
the absence of any suite. A merged body would put the authoring protocol in
front of every manifest repair and blur the one honest trigger description
each skill now carries.

**Automatic chaining — bootstrap invoking author on zero candidates, or
author running bootstrap itself at the end.** Writing test code into a
repository is a product decision, not a mechanical consequence of a survey
result: a zero-candidate outcome proves testenv does not apply today, while
whether the project should acquire an integration suite at all is the user's
call. Both transitions are therefore suggestions the user acts on, and the
approval gate stays inside author so that even a user-initiated run cannot
slide from plan to code without an explicit yes.

**A test-code template or scaffold library.** The project's own runner,
fixtures, and assertion dialect are the template — phase 1 mines them —
and a shipped scaffold would age independently of every project it is pasted
into. Excluded with the other non-goals (no tool or schema changes carry this
feature; it is prose plus one provider entry).

## Consequences

A zero-candidate bootstrap now ends with a path instead of a dead end, at the
price of two explicit user decisions before any test lands — deliberate,
because each gate guards a different judgment (whether to invest, whether
this plan). The handoff closes the loop structurally: an author-written suite
faces bootstrap's falsification (environment down, the suite must turn red),
so a suite that only asserts connectivity is caught at selection time rather
than trusted. Both skills ride one provider name, so a project that overrides
`testenv-bootstrap` keeps the bundled `testenv-author` unless it overrides
that name too.
