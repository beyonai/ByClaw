# Agent Note: archiving is a journal event, not a directory move

Status: implemented

## Problem

Archiving was the one devflow state change with no commit point. `archiveDone`
renamed `<root>/tasks/<id>/` to `<root>/archive/<YYYY-MM>/<id>/` and wrote
nothing; "this card is archived" was expressed solely by where its directory
sat.

That broke the rule the rest of the subsystem is built on — *publish state only
at its commit point, and for devflow that point is the journal append* — and it
cost three things a user could feel:

- **No single-card archiving.** `archiveDone(root?)` took a root, not an id.
- **No way back.** Archiving was not an event, so the history had no vocabulary
  to say "filed, then brought back"; there was nothing a restore could write.
- **Nothing to read.** `list` scans `tasks/` only, and `read` hard-coded
  `join(root, 'tasks', id)`. A filed card did not merely disappear from the
  board — `devflow_show`, `/devflow show`, and the sidebar detail all failed
  with a missing-file error instead of answering with the card.

The third is the sharpest: the card was intact on disk the whole time, and the
store refused to say so.

## Decision

Archiving and restoring are journal entries.

```ts
JournalArchived { rev, at, type: 'archived',  by, reason? }   // not terminal
JournalRestored { rev, at, type: 'restored',  by, reason? }
```

`foldJournal` enforces their shape, so a hand-edited journal cannot describe a
card that moved while filed: only a `done` card archives, an archived card
accepts nothing but `restored`, and `restored` requires a card that is archived.
`abandoned` keeps its terminal rule untouched — the two are independent, and an
abandoned card carries no `archived` entry.

The active set is now `!abandoned && !archived`, derived from folded state
rather than from the directory. That is what makes the move-after-append a
cleanup step: a crash between them leaves a card that is already off the board,
and the next archiving finishes the rename.

Three seam methods follow: `archive(request)`, `restore(request)`, and — from
the query-vocabulary decision below — `query(query?, root?)`. `archiveDone`
keeps its signature and now sweeps through the same single-card commit path.

### Reads locate, writes do not

`read` / `history` / `holder` resolve a card through a locator that checks
`tasks/<id>` first and scans `archive/*/<id>` second. Writers keep reading
`tasks/` only, and turn "the card is filed" into an `archived` rejection code
rather than the missing-file failure a caller could not act on. The archive is
consulted only after the active read already failed, so the ordinary write path
pays nothing for it.

### One predicate vocabulary, two entry points

`CardFilter` became a view of a shared `CardPredicates` (`stage`, `parent`,
`topLevel`, `serviceClass`); `CardQuery` is the same predicates plus `set`,
`month`, `limit`, and `cursor`. `list` and `query` differ in pagination, not in
how a card is selected.

`list` keeps returning **all** of the active set, unchanged, because six of its
seven consumers depend on that. One of them is a gate:
`devflow-parent-gate` lists a requirement's slices and vetoes `-> done` if any
is unfinished. A silently truncated list there does not degrade a view — it
lets a card through the gate.

`list` does not accept `set` or `month`. Completeness can be promised for the
active set and not for the archive, which grows without bound; archived cards
are reachable only through the paged read.

### Buckets say when the work finished

A card files under the month of its **last entry before** the archiving, not
the month the archiving ran. A sweep run once a year would otherwise drop every
card into that year's month and leave the buckets saying nothing. This survived
as a behavior only because the existing tests asserted it; the first
implementation of this change got it wrong.

### Cards filed before this change

They carry no `archived` entry, so the locator treats their directory as the
statement. Restoring one appends a migration `archived` entry and then the
`restored`, keeping the stream self-consistent.

## Alternatives considered

**Give `archiveDone` an id parameter and leave archiving unjournalled.** The
smallest change that answers the literal request, and it answers only that one:
restoring still has nothing to write, and a filed card still fails every read.
It also leaves the one place in devflow where state is published somewhere
other than the journal, which is the thing that made all three symptoms
possible.

**Let the fold accept an orphaned `restored`.** Simpler than appending two
entries when restoring a pre-change card, and it costs a permanent exception in
the state machine that exists only for data written before one release. The
migration entry pays the cost once, into the data.

**Bucket by the archiving timestamp.** Reads more naturally ("filed in
September") and destroys the buckets' usefulness under any batched sweep.

**A `set` predicate on `list`.** Would have unified the two reads into one
method, at the price of `list` promising completeness over an unbounded set —
a promise it could not keep, and whose failure mode is a truncated gate check.

**Fold the two events into `devflow/stage-changed`.** Archiving does not move
the card, so every listener would have to re-derive which of the two happened.

## Consequences

`DevCard` gains `archived?: true` and the **required** `createdAt` /
`updatedAt`. Required, not optional: both exist for every card, and optional
fields would buy each consumer a meaningless fallback branch. Only code that
*constructs* a `DevCard` is affected — the provider and the test doubles.

Those stamps have a caller today: the archive bucket used to be derived by
`lastEntryMonth`, which re-read a `journal.jsonl` that `loadCard` had just
read. That function is gone.

Two write paths returned a card built by spreading the pre-append value and
patching the fields they knew had changed. `updatedAt` is now such a field, and
both had to be told about it — the artifact registration test caught the drift
because it asserts that a fresh read equals the returned card.

`query` narrows *after* loading: a page of five matches out of a thousand cards
still loads a thousand cards, because predicates are judged on folded state.
The limit saves everything after the page fills, which is what makes an
unbounded archive readable at all. Pushing predicates below the load was
considered and rejected — `stage` needs the full fold, so the saving would be
one `card.md` read.

Cursors are this provider's own encoding, passed back verbatim. An unparsable
cursor fails loudly rather than restarting at page one, which would turn a
corrupted cursor into an endless loop over the first page.

**Rolling this back is not free.** A journal that already carries `archived` or
`restored` entries fails to decode under the previous release, which rejects
unknown entry types by design. Verify no card has been archived since this
shipped, or accept that those cards become unreadable.

## Related

The model tool plane deliberately gains nothing here: archiving and restoring
are human decisions, like abandonment, and stay on `/devflow`.
