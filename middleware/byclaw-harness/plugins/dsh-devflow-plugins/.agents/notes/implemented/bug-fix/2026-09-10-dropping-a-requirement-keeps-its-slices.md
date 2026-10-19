# Agent Note: dropping a requirement no longer strands its slices

Status: implemented

## Problem

`abandon` had no parent/child handling at all. Dropping a decomposed
requirement succeeded and left its sub-requirements on the active board,
`parent` pointing at a card that was no longer there. The work they sliced was
withdrawn; they still read as live.

Measured before changing anything:

```
abandon(parent)     → { ok: true }
active board after  → 0002-slice-a [draft] parent=0001-requirement
                      0003-slice-b [draft] parent=0001-requirement
archive after       → 0001-requirement abandoned=true
```

`archive` had thought about exactly this and `abandon` had not:

| | before |
|---|---|
| `archive(slice)` while its requirement is open | refused `parent-active` — "archiving it now would drop it from that requirement's progress" |
| `archive(requirement)` | cascades its delivered slices into its bucket |
| `abandon(slice)` while its requirement is open | allowed — correct, dropping one slice is not dropping the requirement |
| `abandon(requirement)` with live slices | **allowed, slices stranded, nothing said** |

[The board's write face](2026-09-10-board-archive-scope.md) widened the blast
radius: it put a drop control on every unfinished card, requirements included,
so this became one click plus a reason. Before that the path ran through
`/devflow`.

## Two things checked and found already correct

**Dropping a slice does not stall its requirement.** `list` excludes abandoned
cards, and `devflow-parent-gate` filters the unfinished ones out of
`list({ parent })`, so a dropped slice leaves the completion count by itself.

**`archive`'s cascade has no matching hole.** The worry was a slice reopening
after its requirement settled, leaving `archive(requirement)` — which files only
delivered slices — to strand it. `done → developing` returns `illegal-edge`: a
delivered card cannot be reopened, so a done requirement's slices are all done.

## Decision

`abandon` refuses a requirement whose slices are still being worked, with
`children-active`, naming them and their stages the way the completion gate
names what it is waiting for.

### The test is "unsettled", not "has children"

Refusing on any child at all creates a state with no exit. A requirement can sit
mid-pipeline with every slice delivered — the completion gate only guards the
edge into `done`, so nothing forces the parent forward. In that state:

- `abandon(requirement)` → refused by the naive rule
- `abandon(slice)` → `already-done`
- `archive(slice)` → `parent-active`
- `archive(requirement)` → `not-done`

Nothing settles, nothing drops. So the check filters `list({ parent })` — which
already excludes abandoned and archived cards — down to those not `done`.

### A requirement dropped with all slices delivered files them with it

This is the state the narrower test lets through, and leaving it alone would
reproduce the original bug on a smaller set. The alternatives were:

- **Leave the delivered slices on the board.** They are exactly the orphans this
  change exists to prevent.
- **Refuse anyway.** There is an escape — drive the requirement to `done`, then
  archive — but it records a delivery that never happened. Buying an operation
  with a false journal entry is not a trade this store should offer.
- **File them with it.** Taken.

Their entries say `archived`, not `abandoned`: they *were* delivered, and the
requirement's withdrawal does not retract that. They share the requirement's
bucket, the same rule `archive` already follows so a family stays in one place.

That bucket is the month the requirement was **withdrawn** in, not the month its
slices finished. `archive` buckets by when work finished; an abandoned card
never finished, so the only date it has is the day someone stopped it. This is
pre-existing behavior, left alone.

### The cascade is one implementation, not two

`archive`'s loop moved into `fileDeliveredChildren`, which both paths call. Two
copies of "file the delivered slices under this bucket, skip a revision race,
never roll back" would drift, and the second copy would be the one nobody
remembers to fix.

### The check runs on every card, including ones that can have no children

`rejectIllegalParent` keeps decomposition one level deep, so a card that already
has a parent can never have children and the `list` call is provably empty for
it. Skipping the call there would buy one read and spend it on a silent
dependency: if that invariant is ever relaxed, the skip fails without a symptom.

### The board does not pre-empt the refusal

`AGENTS.md` is explicit that enforcement belongs to the operation making the
decision, not to a caller that declines to offer it. The store refuses; the
board reports the refusal through the path it already has for every other one.

Disabling the control would also mean recomputing the store's test in the
client, against a listing that can be stale — the two would answer differently
exactly when it matters.

## Consequences

- `AbandonResult`'s success arm gains `cascaded`, required rather than optional,
  matching `ArchiveResult`. No caller had to change: nothing constructed that
  arm outside the store.
- `abandon` now reads the children of every card it drops. For a card without
  any that is one directory listing.
- **Cards already stranded by the released version stay stranded.** This stops
  new ones; it does not find or repair existing ones. Whether that deserves a
  diagnostic is a separate question, unanswered here.

## Verification

- `tsc -b --force`, `oxlint`: clean.
- `vitest run`: 99 suites, 1318 tests, including the refusal, the all-delivered
  cascade, and dropping a single slice.
- The suite passed untouched before this change — the path had no coverage at
  all, which is how it shipped.
- `test:coverage`: per-file 100%. `pnpm run build` and `preflight:tarballs` pass.
- Not covered by automation: how this reads in a real Web profile when a reader
  tries to drop a requirement and is told to settle its slices first.
