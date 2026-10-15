# Agent Note: the archive page counts itself, and says why work stopped

Status: implemented

## Problem

Follows [the archive scope](2026-09-10-board-archive-scope.md), which made the
archive reachable but left its page reporting the wrong things.

**The counts described a different set of cards.** That change promoted the
toolbar to chrome without moving the counts with the scope, so the archive page
read `1 card · 1 in progress · 0 blocked · 0 done` above four archived cards.
A page header that contradicts its own body is worse than none: the number is
specific enough to be believed.

**A filed card took three lines and led with the wrong thing.** The row reused
the active list's `.rowButton`, which stacks its children, so the id, the title
and the badge each took a line. The id came first and in a monospaced face, so
the slug outranked the title a reader actually scans by. Four cards filled most
of the pane while the width beside them went unused.

**Every row repeated its month.** The month is how the archive is bucketed on
disk and how it is read back; printing it per row spends a column on a value
that changes a few times a year.

**The section titled itself "Archived"** directly under a scope selector already
highlighting "Archive".

**The reason a card was dropped was not shown.** The journal refuses a blank
one (`journal.ts:112`: dropping "removes it from the board, so the reason is all
that is left of it"), and the abandon prompt makes writing it the confirmation.
Then the list showed only "dropped 2026-09" and put the reason a click away.

**Nothing said which cards could come back.** A filed card can be restored, a
dropped one never can. That distinction decides what a reader does next, and the
page conveyed it only as orange versus grey.

## Decision

### The counts follow the scope, and never claim a total

Active scope keeps its four counts. Archive scope reports what it has loaded and
says so: `3 loaded · 1 filed · 2 dropped`.

It cannot report a total. `CardPage` carries `cards` / `truncated` /
`nextCursor` and nothing else, because counting the archive means walking every
month bucket — the cost the paging design exists to avoid. A "total" here would
be a number nobody can compute, so the copy names the quantity it actually has.

Before the first page lands the counts render nothing rather than `0 loaded`,
which would contradict itself a moment later.

### The month heads its group

Cards are grouped by `archivedMonth`, the same bucket the store files them
under. Grouping **scans for boundaries rather than sorting**: the read face
returns the set in its own order and pages accumulate in it, so re-sorting would
lift a later page's card above an earlier one and make "load more" read as a
shuffle.

### One card, one box, two lines

A filed card sits in a box of its own: bordered, but lighter than a kanban card
and with no shadow. An identical box would imply this work can still move.

Inside, the title heads its own line beside how the card left, and the id shares
the line below with the reason. A single line was tried first and abandoned: the
title, the id, the reason and the badge competed for one width, and the reason —
a sentence, and the reason for showing anything at all — lost, clipped to a few
words nobody can act on. It now takes that second line's width and up to two of
them.

`.rowButton` itself is untouched — it is the active list's, and this change is
not about the active board. The archive row overrides it through
`.archiveRowButton`.

The per-month lists are also pinned to `flex: none; overflow: visible`. Splitting
one list into several left each an independent scroller that flexed against its
siblings, which would trap a reader inside whichever month they landed in.

### The reason is shown, which cost a projection field

`abandonedReason` now rides from the journal to the card:

| | |
|---|---|
| `JournalFoldState.abandonedReason` | captured where `abandoned` is set |
| `DevCard.abandonedReason` | the field the read face already serialises |
| `materialize` | spread beside `abandoned` |

The estimate in the PRD was wrong and is corrected there: this looked like a
change to the `card.md` projection format, but cards are not built from
frontmatter. `materialize` folds the journal and spreads the fold state
(`devflow-filesystem/src/index.ts:1182`); frontmatter supplies only `title` and
`body`. So the reason travels a straight line and **no on-disk format changes** —
`renderProjection` and the drift check are untouched. Putting the reason in
frontmatter would only give the drift check a field nobody reads.

The field is present exactly while `abandoned` is, because the decoder rejects a
blank reason. Readers need no fallback for one without the other; that is
`foldJournal`'s invariant, not theirs.

Justifying the field at all: `AGENTS.md` warns against published surface nothing
reads. This has a named consumer, and the alternative was to keep forcing every
reader to write a reason and then never show it — which makes the store's
insistence pointless.

### The rule is stated, and still not offered

The scope opens with one line: a filed card can be restored through `/devflow`,
a dropped one cannot. No restore control appears — that remains a `/devflow`
decision, and this change does not revisit it. Saying what is possible is not the
same as offering to do it.

## Alternatives considered

**Hide the counts in archive scope.** Simplest correct fix for the contradiction.
Rejected: the reader has just paged an unbounded set and "how much am I looking
at" is a fair question. Answering it honestly is better than declining to.

**Show the reason by fetching each card's journal.** `devflow-command` recovers
it that way (`index.ts:210`), which is right for one card's detail and wrong for
a list — it is a request per row.

**Keep the reason out and mark the badge "cannot be restored".** Considered while
the projection change still looked expensive. Dropped once the real cost was
measured: it answers "can it come back" but not "why did it stop", and the second
is what the reader came for.

## Consequences

- `DevCard` gains an optional field. It flows to every reader of the read face,
  including `devflow-command`, which can drop its journal scan for the list case
  if that ever matters. Not done here: that plane reads one card's detail, where
  the journal is already in hand.
- The archive section lost its top border and its blanket `opacity: 0.72`. Both
  said "secondary to the board", which was true when it was an appendix and is
  not now that it is a scope's whole body.
- `archive.badge` / `archive.badge.abandoned` lost their `{month}` parameter.

## Corrected afterwards

Two claims here did not survive contact with the running board, and are fixed in
[the family-grouping change](2026-09-10-the-board-offers-what-works.md):

- **The disabled view switch said the archive "reads by when work left".** It does
  not. The walk sorts month buckets descending and then ids descending within
  each (`devflow-filesystem/src/index.ts:1079-1086`), so two cards filed minutes
  apart appear in id order, not in the order they left. The copy now names the
  month grouping, which is true.
- **The flat list scattered a family.** The store files a requirement and its
  slices in one bucket precisely so they stay together, and rendering them as
  peers threw that away.

## Verification

- `tsc -b --force`, `oxlint`: clean.
- `vitest run`: 99 suites, 1314 tests.
- `test:coverage`: per-file 100% on `packages/*/src`.
- `pnpm run build` including the client-bundle purity gate, and
  `preflight:tarballs`.
- Not covered by automation: that the counts match what is on screen — the thing
  that prompted this — and that a long reason under a long title fills its two
  lines without pushing the box out of shape. Both want a real Web profile.
