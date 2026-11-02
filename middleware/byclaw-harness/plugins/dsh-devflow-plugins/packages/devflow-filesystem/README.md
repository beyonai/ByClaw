# @zhchxiao123/dsh-devflow-filesystem

English | [中文](README.zh.md)

Filesystem Service Provider for the [`ctx.devflow`](../devflow/README.md) seam. Cards live under `<root>/tasks/<id>/` — a directory named `<seq>-<slug>`, stable from creation — as a `card.md` (YAML frontmatter projection plus Markdown body) and an append-only `journal.jsonl`, the authoritative history. One store instance serves any number of roots: every operation resolves its explicit root argument through one defaulting step (an omitted root is the configured default, a given one resolves absolute), per-card serialization keys on root + id, and each returned card names its root.

## Read behavior

`list` scans `<root>/tasks` (a missing root lists empty; entries that are not card directories are skipped), `read` loads one card. Every load replays `journal.jsonl` through the Definition's fold: an invalid JSON line, a malformed entry, or a broken stream fails the read with an error naming the file and line — a card is never silently skipped. The `card.md` frontmatter requires `title`; its `stage`/`stageRevision` fields are projections, warned and overridden by the journal on drift. A card missing its journal fails loudly; a lost `card.md` degrades to a warned journal-only view (the title is frontmatter-owned and irrecoverable) and is rematerialized by the next committed transition.

## Write behavior

`create` serializes in-process and allocates the next sequence number past every active *and archived* card, reserving `tasks/<seq>-<slug>/` with an exclusive (non-recursive) `mkdir`; losing that reservation to another process rescans for a fresh number, and five straight losses resolve the stable `exists` rejection. The journal's first `created` entry is the only commit point — a failed write fails the whole creation — after which the `card.md` projection (frontmatter title, `draft`, revision 1, plus the Markdown body) is written (failure only warns, the standard projection degradation) and `devflow/card-created` is emitted. An omitted slug derives from the title (lowercase alphanumeric runs joined by dashes, bounded, falling back to `card`).

A requested `parent` is validated before any directory is reserved, against the same root: a card the root's `tasks/` does not hold rejects `unknown-parent` unless the root's archive holds it (`parent-settled`, as does a parent already `done`), and a parent that carries a parent of its own rejects `nested-parent` — the breakdown is one level deep. Validation and commit both run under the *parent's* in-process card chain, so one provider instance cannot interleave a creation with a move deciding on the current children. The accepted edge is written into the `created` entry and projected as the frontmatter's `parent:`; `list` narrows to one parent's children through `filter.parent`.

Every journal mutation after creation — transition, artifact registration, and stale-claim eviction — replays the journal and appends its next entry under the card's `commit.lock`, taken with `O_EXCL`. Transition and artifact commits hold the lock for that journal re-read and append; stale takeover additionally re-reads and replaces `claim.json` before releasing it. Transition gates run before the lock, and a permitting gate decision's `approvedBy`/`checks` land in the committed entry's `gate`. A store-written artifact registration (`kind` + `content`) validates its kind against the slug grammar (`invalid-kind` otherwise), then writes `tasks/<id>/artifacts/<rev>-<kind>.md` atomically (temp file + rename) *before* taking the lock — so a registration that loses the revision re-check or the lock budget leaves only a file no journal entry references: invisible to reads, harmless, and overwritten by a same-revision retry. Temp-file replacements retry transient `EBUSY`/`EPERM` conflicts within a fixed internal budget, covering Windows readers that briefly hold the destination path. A revision-dependent writer that finds the card moved resolves `revision-mismatch`; transition and artifact writers that exhaust the lock budget resolve `write-contended` without appending. After a transition commits, the frontmatter projection is rewritten atomically (temp file + rename, preserving unrelated fields and the body; failure only warns) and `devflow/stage-changed` is emitted.

`claim` creates `claim.json` with `O_EXCL`: a second claim resolves with the current holder, `heartbeat()` refreshes the liveness mark, and `release()` removes the file idempotently. A stale takeover journals `claim-expired` and replaces the lease inside the same commit lock, so concurrent takeover attempts grant at most one holder; lock contention leaves the observed holder in place. The lease assigns work, while `commit.lock` protects journal structure. Both are this checkout's process state and neither is ever committed, while the journal, card file, and artifacts must be — [commit semantics of `.devflow`](../../docs/devflow.md#devflow-commit-semantics) carries the rule and the `.gitignore` that implements it. `archive` appends the card's `archived` entry under the commit lock — the only commit point — and then renames its directory whole into `archive/<YYYY-MM>/<id>/`, so the journal and artifacts stay intact. The bucket is the month of the card's **last entry before** that append, falling back to the current month when it carries no `YYYY-MM` prefix: a sweep run long after the work finished must not pile every card into the month it ran. Because the append is what takes the card off the board, a crash before the rename leaves a card that `list` already ignores, and a later archive finishes the move. A decomposed requirement files as one family: a done slice whose requirement is still on the board stays with it (`parent-active`), and archiving the requirement cascades its done slices into the requirement's bucket. A slice that outlived its requirement's archiving files on its own.

`restore` is the inverse and the only writer that touches the archive: the `restored` append commits, then the directory moves back to `tasks/`. A card filed before archiving was journalled carries no `archived` entry, so its directory is what marks it; restoring one appends a migration `archived` entry ahead of the `restored` so the stream stays self-consistent. An abandoned card is refused (`abandoned`) — it stays readable, and reversing that decision means a new card.

Reads locate a card by checking `tasks/<id>` and then scanning `archive/*/<id>`, so `read`, `history`, and `holder` all answer for a filed card. Writers do not: they read `tasks/` only, and turn a filed card into the `archived` rejection code rather than a missing-file failure. `query` walks the active set by ascending id and the archive by descending bucket then descending id, stopping as soon as the page fills; its cursor is this provider's own `set:month:id` encoding, and one it did not issue is rejected rather than silently restarting at the first page.

## Config

```yaml
- id: devflow
  name: '@zhchxiao123/dsh-devflow-filesystem'
  config:
    root: .devflow
```

| Key | Default | Meaning |
|---|---|---|
| `root` | `.devflow` | Default devflow root, used by operations whose caller derives no root of its own; a relative path resolves against the process cwd. |

## Model Experience

Indirectly, through the model-facing tools in dsh-tool-devflow: the store backend registers no prompt or schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **An abandoned commit lock fails closed** — mtime alone cannot prove ownership: a stale checker can otherwise delete a successor's newly acquired lock. If a process dies while holding `commit.lock`, writes resolve as contended until an operator verifies no writer is active and removes that card's lock file.
- **Stale takeover is audit-first across two files** — `claim-expired` commits before `claim.json` is replaced. A process crash between those writes leaves the old lease beside a truthful eviction record; a later takeover can retry and append the next revision, but the two files cannot be replaced atomically as one filesystem operation.
- **Takeover trusts the local clock** — staleness compares the lease heartbeat with `Date.now()`, so severe clock skew across machines sharing one workspace can evict a live holder early or late.
- **Cross-process simultaneous creation can share a sequence number** — the exclusive `mkdir` guards the full `<seq>-<slug>` directory name, so two *processes* creating with different slugs in the same instant can both keep one number; ids stay unique, and in-process creators are serialized.
- **No change watching** — reads are on-demand; a card moved by another process is seen at the next read, not pushed.
