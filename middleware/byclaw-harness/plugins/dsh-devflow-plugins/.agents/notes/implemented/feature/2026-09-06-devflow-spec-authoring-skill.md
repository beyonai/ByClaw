# Agent Note: the devflow-spec-authoring skill — judgment for the spec seam, mounted with it

Status: implemented

## Problem

The spec seam (`devflow_write_spec` / `devflow_read_spec`) shipped with its
protocol fully stated — the tool descriptions, the store's ten closed
rejection codes, the born-stale rule — but its judgment layer had no home.
Nothing model-facing answered: when is a learning worth a permanent document
versus an iron rule versus nothing, which anchor kind can even be written
here, how ids decide whether a document is ever found, how the set shrinks,
or what the right move is after a stale warning. The
[guidance-layer Agent Note](2026-09-05-devflow-model-guidance-layer.md)
already established where such knowledge goes: a bundled skill, catalog
strategy, judgment only.

## Decision

`devflow-spec-authoring` is a second bundled skill in
`@zhchxiao123/dsh-devflow-guidance`, same shape as `devflow-workflow`
(`BUNDLED_SKILL_RANK`, model- and user-invocable, static asset body,
overridable by a lower-ranked same-layer provider). A package-internal
`bundledSkill(name, description)` factory now builds both providers; it is
deliberately not exported — the catalog surface of this package is its two
skills, and deployments customize by name-override, not by minting bundled
skills from outside.

**Conditional registration (the one new mechanism).** The provider registers
inside `ctx.inject(['devflowSpec'], …)` in `apply()`, so the skill appears
exactly while a composition mounts the spec seam and is withdrawn when that
service's fiber is disposed. Two alternatives were rejected:

- **A package-level `inject` gaining `devflowSpec`** would hold the whole
  plugin — the workflow skill and the board snapshot — hostage to a seam
  they do not need: every composition without spec documents would lose all
  guidance. Over-punishment for one optional skill.
- **A `ctx.get('devflowSpec')` probe at `apply()` time** samples the service
  store once while the Loader activates rows concurrently: lose that race
  and the skill registers nothing, forever, with no diagnostic; and a seam
  disposed later would leave a skill advertising a capability that left.
  The rationale is the same one `devflow-iron-rules/src/record.ts` records
  for its `tools` child; this is the first conditional child on
  `devflowSpec` specifically.

No dependency was added for the key: cordis types `inject` keys as plain
strings, so the package needs neither a runtime nor a type-only import of
`@zhchxiao123/dsh-devflow-spec` (the spec-filesystem provider is a
devDependency for the composition tests only).

**Teach reality, not the ideal.** Research surfaced two tool-side defects —
the write description's misleading "does not revise" closing sentence, and
the specRefs index silently dropped by a malformed `## Scope` section — and
the skill initially taught that behavior rather than waiting for fixes. Both
are fixed by [the defect-fix note](../bug-fix/2026-09-06-devflow-spec-tool-defects.md),
and the two skill passages track the fixed behavior: §4 states the
whole-document storage model without quoting the old sentence, and §3's
hazard line tells the author to act on the warning the card result now
carries.

**Obligation boundary, unchanged.** The rejection codes and the born-stale
enforcement are referenced as "the store rejects…" and never restated as a
protocol list — the tool descriptions own protocol, per the guidance-layer
note's judgment/obligation split.

## Consequences

A composition with the spec seam now advertises two catalog lines from this
package; one without it sees `devflow-workflow` only, and a skill teaching
absent tools can never appear. The composition tests pin all three states
through the real Loader: booted with the spec-filesystem row (skill listed,
body served), booted without it (absent, workflow intact), and the spec
service fiber disposed alone (skill withdrawn, workflow intact).

The costs: one more catalog line while the seam is mounted (about 6 KB of
body only when loaded) and a devDependency on the spec-filesystem provider
for tests.
