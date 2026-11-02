# Agent Note: the archive on the browser board

Status: implemented

## Problem

The board showed the active set and nothing else. After
[archiving became a journal event](2026-09-09-devflow-archive-lifecycle.md) a
card that was filed simply vanished from the sidebar, and nothing there said
where it went — or reflected a filing or a restore until the reader reloaded,
because the push face forwarded only creations and transitions.

## Decision

A third read-face method, two more push frames, and a secondary group in the
list view.

### `archived` is a projection, not the seam's query

The route gains `archived`, which fixes `set: 'archived'` itself and takes only
`month`, `limit`, and `cursor` from the body. Passing the seam's whole query
through would let an untrusted caller choose which set the host walks, and the
board never needs to choose.

`limit` is clamped to a fixed ceiling rather than a configured one: what it
bounds is how many card directories one untrusted request can make the host
walk. That is a property of serving untrusted callers, like `MAX_BODY_BYTES`,
not a deployment preference — the store's own page size is the tunable one.

A cursor's shape belongs to the store, so the fence checks only that it is a
string of usable length and lets the store reject one it did not issue.

### `idle` is a state, not an absence

The archive source is `idle | loading | ready | error`, and `idle` is what
makes "fetched when asked for, not on every mount" expressible. Without it the
page would have to infer intent from an empty list, and the natural
implementation of that is a fetch on every mount of an unbounded set.

### A change frame restarts the archive; it does not resume it

Pages accumulate behind "load more". When a frame arrives while the archive is
shown, the accumulated pages are dropped and the first page is read again.

A cursor names a position in a set. A card filed or restored between two pages
moves what sits at that position, so resuming would splice one snapshot of the
archive onto another. The archive is a secondary view and re-reading its first
page is cheap; a list that quietly interleaves two different sets is not.

### The Kanban view holds no archived cards

Filed work in the done column would report cards nobody is doing as part of the
board's progress. The group and its control belong to the list view alone, and
the control is not rendered in Kanban rather than rendered inert.

### Rows say how a card left and offer nothing else

`[archived <month>]` or `[abandoned <month>]`, because only the first can come
back — and bringing it back is a `/devflow` decision. The archived row opens the
card's detail and does nothing else.

The face has since stopped being read-only: the board now carries filing and
dropping, which are decisions people make rather than work an executor does.
[The board-decides note](2026-09-10-devflow-board-decides-too.md) owns that
change. Restoring is still absent here, for the reason stated above.

## Alternatives considered

**Reuse the board source for archived cards.** One source, one refresh path —
and two different loading semantics: the board is a complete snapshot that
refetches whole, the archive is a paged stream fetched on demand. Folding them
would have made every board refresh re-read however many archive pages were
open.

**Resume the archive from its cursor after a change frame.** Keeps the reader's
place, at the cost of splicing pages from two different states of the set.

**Show the archive in both views.** The kanban's columns are stage progress;
adding filed work to `done` makes that number mean two things.

**Let the browser pass a full `CardQuery`.** One method instead of two and a
larger untrusted surface, for a capability the board does not have a use for.

## Consequences

`DevCard.archivedMonth` is what the row's month comes from. `updatedAt` names
the archiving by then, so a row would have read `2026-09` while
`/devflow archived 2026-07` matched it — a label disagreeing with its filter.

The push face now forwards four events. Each registration is its own effect
with its own disposer description, and the existing disposal test covers the
endpoint as a whole.

A superseded archive read is dropped rather than rendered: a reader who hid the
archive is not shown an error about the read they walked away from.

The client bundle gains no runtime import — the archive section is built from
the same primitives the board already uses, so the purity gate is unaffected.
