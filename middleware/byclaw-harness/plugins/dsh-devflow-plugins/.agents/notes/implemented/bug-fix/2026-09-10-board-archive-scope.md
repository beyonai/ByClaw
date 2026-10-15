# Agent Note: the archive is a scope, and a card's actions belong in its box

Status: implemented

## Problem

Two defects, both observed in a real Harness Web profile, both introduced by
[the board's write face](../architecture/2026-09-10-devflow-board-decides-too.md).

**Filing the workspace's last card stranded the reader.** The board rendered its
toolbar inside the `listing.length > 0` branch, and the archive control lived in
that toolbar. An empty active set therefore skipped the toolbar, the archive
control, and the view switch together, leaving one line of text and **no route
to the archive at all**. The line itself claimed the workspace had "no devflow
cards yet" — a denial of history, said to someone who had just filed one.

**A card's actions rendered outside its border.** `KanbanCard` was a `<span>`
shell holding a bordered `<button>` and, after it, the action bar. The bordered
box was the button, so "drop" floated beneath the card rather than belonging to
it. The compact list had the same split in a milder form: the hover highlight
sat on the opener, so it stopped short of the actions.

The nesting constraint behind that layout is real — HTML forbids a `<button>`
inside a `<button>`, and the browser hands the inner one's click to the outer.
The error was the resolution: the actions were moved out of the card, when what
had to move was the border off the button.

## Decision

### The archive is a scope, not an appendix

The old control read as *additive* — "show me extra rows". A reader who just
filed their last card is asking something *navigational* — "where did it go".
That mismatch is why the control could be a child of the list view at all, and
it is what produced both disappearances.

The toolbar now carries an **active / archive** scope selector, on an axis of its
own beside the Kanban/list switch. The archive is reachable from either view,
and from an empty board.

`binding.ts` did not change. `setArchiveVisible(true|false)` already meant
"enter / leave the archive" — entering fetches the first page, leaving bumps the
epoch and returns to `IDLE_ARCHIVE`, voiding a response in flight. Only the
caller's placement was wrong. A seam that survives a UI rework untouched is the
seam being right.

### The toolbar is chrome

It renders whenever the board read succeeded, regardless of how many cards came
back. The empty state occupies the board area alone. This is what makes the
archive reachable at the moment it matters most.

### The empty message states only what this page can know

`page.empty` was **deleted** rather than reworded. It asserted that the
workspace had never held a card, and this page cannot determine that: `CardPage`
carries `cards` / `truncated` / `nextCursor` and no total, because counting the
archive means walking every month bucket — the cost the paging design exists to
avoid.

`page.empty.active` says the active set is empty and names the archive as the
place to look. It deliberately does **not** claim the archive holds anything.
The reader clicks; if it is empty, `archive.empty` says so.

### The stage columns stay out of the archive

Filed work does not flow, so arranging it by stage would imply it still does.
The view switch is `disabled` in the archive scope **with its reason rendered**,
not removed — a control that vanishes reads as a fault.

### The card box is an ordinary element

```
<span class=kanbanCard>          border, radius, background, shadow
  <button class=kanbanCardOpener>  the visible content, unmoved
  <CardActionBar/>                 inside the border
```

The actions stay in normal flow rather than absolutely positioned: they already
occupied that row of vertical space outside the border, so moving them inside
costs no height, and absolute positioning would have to reserve padding against
long titles for no gain.

`data-blocked` / `data-settled` moved to the container, which owns the border and
shadow they style. Hover and focus moved to `:focus-within` on the container, so
a keyboard focus anywhere inside rings the box a reader actually sees.

The compact list took the same shape through a new `.rowCard` box, which also
moved the row highlight off the opener so it covers the actions too.

## Alternatives considered

**Keep the toggle, just render it in the Kanban too and outside the empty
branch.** Smaller, and it would have closed both disappearances. Rejected: it
leaves the additive framing that caused them, so the next view or state added to
this page can drop the archive again the same way.

**Let the archive scope render as a Kanban of the stages cards died in.** There
is a real question behind it — "where does work stop?" — but it is a reporting
question, not this board's. A stage board whose cards cannot move misrepresents
what a stage column means. Left out; if the question earns a surface, it should
be one built for it.

**Absolutely position the action bar inside the card.** Keeps the card's current
height. Rejected: the height is unchanged either way, and absolute positioning
buys a permanent overlap risk with a clamped three-line title.

**Give the sweep a confirmation.** Considered and deliberately not done. Filing
is reversible, which is why the single-card action commits on click; batching it
does not make it irreversible. Changing it belongs to a decision about the sweep,
not to this repair.

## Consequences

- `scope` joins `viewMode` and `collapsed` as per-mount presentation state. It is
  not persisted and not in the binding, matching the existing rule that these are
  local viewing preferences.
- `ArchiveSection`'s `idle` branch now renders the loading line instead of
  `null`. Under the toggle model `idle` meant "nobody asked"; under the scope
  model reaching the section *is* the asking, so `idle` is only the gap before
  the first page lands, and silence there would read as an empty archive.
- Two regression assertions now guard the structure that broke:
  `querySelectorAll('button button')` must be empty, and each action must be a
  descendant of its card's box. The previous suite passed against the defective
  markup, which is how it shipped.

## Known gap found here, not fixed here

The card opener carries `aria-label={t('row.open', { id })}`, and `aria-label`
**overrides element content** as the accessible name. Assistive technology
therefore announces "open {id} detail" and never the card's title. This predates
this change and is unaffected by it.

It is left open on purpose: fixing it edits the `row.open` copy in both
languages and rewrites roughly ten by-name test queries — a copy decision worth
reviewing on its own rather than buried in a structural repair. Recorded in the
package README's Known Limitations.

## Verification

- `tsc -b --force`, `oxlint`: clean.
- `vitest run`: 99 suites, 1309 tests.
- `test:coverage`: per-file 100% on `packages/*/src`.
- `pnpm run build` including the client-bundle purity gate, and
  `preflight:tarballs`.
- Not covered by automation: that the result looks right. Filing the last card
  and returning to it through the scope selector, and the actions sitting inside
  the border under a long title, need a real Web profile.
