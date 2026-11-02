# Agent Note: what the model may narrow, page, and see filed

Status: implemented

## Problem

`devflow_list` exposed two predicates — `stage` and `parent` — and no ceiling.
It returned every active card, so a workspace with a hundred cards spent a
hundred rows of context on every call, and a model looking for "the
requirements" or "the express cards" had to pull the whole board and filter it
itself.

The seam had since grown [a shared predicate vocabulary and a paged
read](2026-09-09-devflow-archive-lifecycle.md). The tool plane was the one
consumer that wanted paging and the only one that had not been given it.

## Decision

`devflow_list` reads through `query` and takes the seam's whole vocabulary:
`stage`, `parent`, `topLevel`, `serviceClass`, `set`, `month`, `limit`,
`cursor`. It returns `{ cards, truncated, nextCursor? }`.

**A truncated page renders the call that continues it.** Not a sentence about
there being more — the literal next invocation. A page that does not say it was
cut short is read as the whole board, and a model that plans against a board it
only partly saw makes decisions no one can explain later.

### `set: 'archived'` is on the model plane

The [archive-lifecycle note](2026-09-09-devflow-archive-lifecycle.md) says
archiving and restoring stay human. That constraint is about the two **writes**.
Reading filed work is different: how a similar requirement was decomposed, what
its slices were, how long it took — that is ordinary context for planning new
work, and withholding it would make the model re-derive what the workspace
already knows.

So the model reads the archive and cannot write it. `devflow_archive` and
`devflow_restore` do not exist, and a test asserts their absence rather than
merely not registering them.

### Contradictions fail loudly

`parent` and `topLevel` select disjoint cards. Stating both is a usage error
raised by the seam, not an empty page: an empty answer to
`{ parent: '0001-x', topLevel: true }` reads as "that requirement has no
slices", which is a lie the model would act on.

## Alternatives considered

**Keep `devflow_list` unbounded and add a separate paged tool.** No behavior
change for existing callers, and it splits one question across two tools, so
every model has to learn which one to reach for. The board is the thing that
needs a ceiling; giving it one is the point.

**Return the whole set and let the model stop reading.** It cannot — the tool
result is already in its context by the time it decides.

**Describe truncation in prose** ("more cards remain"). The model then has to
construct the continuing call from the parameter documentation, which is a
step it can get wrong for no reason.

**Add a read-only `devflow_archived` tool instead of a `set` parameter.** A
second tool for the same question, narrowed by the same predicates, that would
have to be kept in step with this one forever.

## Consequences

**A bare `devflow_list` now returns the first page rather than the whole
board.** This is the one behavior change, and it is the point of the change
rather than a side effect. The default page size is the store's `pageSize`, and
the truncation line is what keeps the smaller answer honest.

Narrowing does not make the read cheaper on disk — the seam judges predicates on
folded state, so every candidate card is still loaded. What it saves is context,
which is the resource this plane is actually short of.

`presentCall` is unchanged, and its existing assertions still pin it: the new
parameters do not alter how a call is presented, only what it returns.
