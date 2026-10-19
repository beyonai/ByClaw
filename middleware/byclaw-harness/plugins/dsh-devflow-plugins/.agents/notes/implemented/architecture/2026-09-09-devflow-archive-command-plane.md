# Agent Note: the archive on the human command plane

Status: implemented

## Problem

[Archiving became a journal event](2026-09-09-devflow-archive-lifecycle.md), which
gave the seam `archive`, `restore`, and a paged `query` over the archived set.
None of it had a way in. `/devflow archive` still meant only "sweep every done
card", and there was no way to file one card, bring one back, or look at what
had been filed.

The archive also had no reader anywhere, so `abandon` told the truth when it
said "this is not reversible — the archive has no read face". That sentence is
now wrong, and a wrong sentence on the one command that permanently removes a
card is worse than no sentence.

## Decision

Five sub-commands, all on the human plane:

```
/devflow archive                       # unchanged sweep
/devflow archive <id>                  # one card, with its finished slices
/devflow restore <id>
/devflow archived [<YYYY-MM>]
/devflow archived --cursor <cursor>
```

Nothing here reaches the model tool plane. Archiving and restoring are
decisions, like abandonment, and this is where decisions live.

### Rejections say what to do next

The seam's codes are stable and precise, and useless on their own to a person
at a prompt. Each is rewritten with the next action:

| code | what the plane says |
|---|---|
| `not-done` | where the card actually is, and that a card that will not be delivered is abandoned instead |
| `parent-active` | the requirement's id, because that is what has to move first |
| `already-archived` | `/devflow archived` lists it |
| `abandoned` (restore) | terminal; open a new card, and `/devflow archived` still shows this one |
| `not-archived` | it is on the board already |

`revision-mismatch` and `write-contended` pass the store's own message through:
they are about a race, and the plane has nothing to add.

### Restoring says it did not resume anything

`restore` returns a card at the stage its journal already recorded, so a
restored `done` card lands back on the board still done. Left unsaid, that reads
as a bug. The reply states the stage and that continuing the work is an ordinary
rework move.

### The index tags, `show` explains

An archived line carries `[archived <month>]` or `[abandoned <month>]`, because
only the first can be restored. The abandonment *reason* is not on the line —
it lives in the journal, not on the card, so putting it in a listing costs one
extra read per row and a defensive path for a row that vanished mid-page.

`/devflow show <id>` prints it instead. That is where one card is already being
read, the second read is bounded, and a failure to read it is a failure of the
command rather than a silently degraded row.

### Cursors are passed back whole

`archived --cursor <cursor>` hands the store's own encoding back untouched:
this plane neither builds nor parses one. A truncated page ends with the exact
command that continues it, rather than a sentence about there being more.

### The month shown is the bucket

`DevCard` gained `archivedMonth`. Without it the line could only show
`updatedAt`, which after filing names the archiving rather than the work — so
`/devflow archived 2026-07` would list a card labelled `2026-09`. A filter and
a label that disagree are worse than no label.

## Alternatives considered

**Put the abandonment reason on every archived line.** What the PRD asked for,
and it costs a second read per row plus a defensive branch for a card that
disappeared between the page walk and the render — an unreachable path that
still has to be written, reviewed, and covered. The index/detail split gets the
same fact to the same reader for less.

**Derive the displayed month from `updatedAt`.** No seam change, and it would
have quietly disagreed with the `month` filter for every card.

**Let `archived` accept a month *or* a cursor in one positional slot.** Fewer
tokens to type, and it makes a malformed cursor indistinguishable from a
malformed month, so the error could not say which one the caller got wrong.

**Give the model a read-only archive tool.** Deferred to the tool-plane change
rather than decided here; this note only claims that the *write* operations
stay human.

## Consequences

`/devflow archive` with no argument is byte-identical to before, and a test
pins it — the sweep is the one behavior an existing user already depends on.

`archive now` used to be a usage error. It is now a card id, so an unknown card
throws the way `show <unknown>` already did rather than returning a usage error.
That is consistent with the rest of the plane, and it means the grammar no
longer rejects anything it can interpret.

The `abandon` reply no longer claims the archive is unreadable; it points at
`/devflow archived`. The card is still unrecoverable, and that still leads.

`show` now reads the journal a second time for an abandoned card. It is one
card and one file, and only for cards that carry the entry.
