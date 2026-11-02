# Agent Note: spec write-description wording and the unserved specRefs warning

Status: implemented

## Problem

Research for the [spec-authoring skill](../feature/2026-09-06-devflow-spec-authoring-skill.md)
surfaced two tool-side defects the skill then had to teach around:

- `devflow_write_spec`'s description ended "This creates a document; it does
  not revise an existing one" — read literally, revision is impossible, while
  `replaces: [own-id]` is precisely the revision path.
- `declaredScope()` in `devflow-tool` folded three states into one silent
  `undefined`: no `spec-refs` registration (a legal state), a registration
  whose `## Scope` heading is missing or lists no entry, and a registration
  whose file cannot be read. The last two dropped the whole specRefs index
  with no signal, and the catch comment justified it with "an undeclared
  scope is a legal state" — untrue once a registration exists.

## Decision

The description now closes with the storage model plus the revision path —
"Every write lands a whole new document; to revise or merge existing ones,
name their ids in \"replaces\"." — without duplicating the `replaces`
parameter's own semantics.

`declaredScope` returns a discriminated `DeclaredScope`
(`undeclared | unserved | declared`). `undeclared` keeps its silence.
`unserved` — a registration exists but yields no readable scope — puts an
optional `specRefsWarning` string on the single-card wire value, declared
once in `CARD_INDEX_PROPERTIES` beside `artifactGates` / `specRefs` and
rendered verbatim as one line by `cardIndexLines`. The warning appears only
while `ctx.devflowSpec` is mounted: without the seam, no index was ever
promised. A well-formed scope reaching no document still omits the index
silently — that is a coverage gap the census owns, not a broken registration.

The two `devflow-spec-authoring` passages that taught the pre-fix behavior
(§3's hazard sentence, §4's quotation of the old description) now state the
fixed behavior, closing the
[skill note's](../feature/2026-09-06-devflow-spec-authoring-skill.md)
teach-reality record. `docs/devflow.md`, devflow-tool's README pair, and the
`dsh-write-spec` skill's `exists` row track the new wording.

## Alternatives considered

**A veto or admission-gate prompt instead of a warning line** — stays
suspended, per the PRD: whether a bad declaration should block a move is
deployment policy, while the index consumer can only say what it failed to
serve.

**Warning on the empty-result branch too** — a declared scope reaching no
document is not a defect of the registration; warning there would punish
declaring scope early, and the census already reports coverage gaps.

**A boolean wire flag with renderer-owned wording** — two owners for one
message; carrying the line itself keeps the wire value and the rendered text
trivially consistent.

## Consequences

A model that mistypes a `## Scope` heading learns it from the very next card
result instead of from the index's unexplained absence. The wire surface
grows one optional string field on the five single-card results; nothing
changes for compositions without the spec seam or for cards without a
`spec-refs` registration.
