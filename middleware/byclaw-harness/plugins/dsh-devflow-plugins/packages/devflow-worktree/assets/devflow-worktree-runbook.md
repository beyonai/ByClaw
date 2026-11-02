# Devflow Worktree Runbook

Develop one devflow card in its own git worktree on its own branch. The board
travels with git: the card's `.devflow` entry is committed on the branch
beside the code, so the pull request that merges the work also merges the
card's journal — stages, artifacts, and all. Reviews and gate commands run in
the worktree and see exactly one card's changes.

One rule carries everything else: **from the moment a card is dispatched
until its branch is merged, only its own worktree writes that card.** The
card's journal is an append-only file; two checkouts appending to it merge
into a conflict that renders the card unreadable. The worktree fence enforces
this rule for stage transitions, and this runbook is how you stay inside it
everywhere else.

## Preconditions

Confirm all of these before the first dispatch. The fence checks the first two
itself and vetoes the dispatched card's first transition with the command that
repairs the repository — but that is inside the worktree, a whole ceremony
late. The last two produce a confusing failure later rather than an error at
all.

1. **The board is committed.** `.devflow/tasks/` must be tracked in git —
   `git ls-files .devflow/tasks | head` proves it. A branch checked out from a
   repository that gitignores its board gives the worktree an empty board
   that silently renumbers new cards from `0001`.
2. **Process-transient state is ignored, and nothing else is.** `.gitignore`
   carries the canonical snippet from "Commit semantics of `.devflow`" in the
   devflow walkthrough, which is the authority on which of the directory's
   four kinds of content belong in git:

   ```gitignore
   .devflow/**/claim.json
   .devflow/**/commit.lock
   .devflow/midscene/operation.lock
   ```

   Leases and locks are per-checkout process state; a lease that traveled
   with a branch assigns work nobody holds, and an inherited commit lock
   fails that card's writes closed. Ignoring anything wider takes the board
   down with them — precondition 1.
3. **Review runs in range mode.** If `dsh-devflow-review-gate` guards a
   review edge, its edge must configure `baseRef` (range mode). Workspace mode
   reviews uncommitted changes and requires that `developing` never commits —
   the opposite of a flow whose deliverable is a mergeable branch.
4. **Worktrees live outside the main checkout, or under an ignored path.**
   An unignored worktree directory inside the repository pollutes every
   file census that hashes untracked files.
5. **Web acceptance runs in midscene project mode.** A legacy profile's
   `workspace` is one fixed absolute path — the main checkout — so a
   dispatched card fails the scope check on every midscene-guarded edge and
   its acceptance waits for the merge. Project mode resolves the workspace
   from the session's own directory and keys its runtime state by that path,
   which gives each worktree its own.

## Dispatch (in the main checkout's session)

Bring the card to `ready` on the main board as usual — planning stages and
their artifacts happen before dispatch. Then:

1. Attach the dispatch artifact. Read the card's current revision with
   `devflow_show`, then `devflow_attach_artifact` with the deployment's
   dispatch kind (default `worktree`) and content of exactly this shape:

   ```markdown
   ---
   branch: devflow/<card-id>
   base: main
   worktree: <absolute path the worktree will live at>
   ---
   Dispatched for isolated development.
   ```

   All three frontmatter fields are required and non-blank. `base` is the ref
   the card's changes will be measured against.

2. Commit the dispatch so the branch carries it:

   ```sh
   git add .devflow/tasks/<card-id>
   git commit -m "devflow: dispatch <card-id> to a worktree"
   ```

3. Create the branch and worktree at that commit:

   ```sh
   git worktree add <worktree-path> -b devflow/<card-id>
   ```

Order matters: attach, commit, then branch. A dispatch attached after
branching writes the card on the main side while the branch also writes it —
the exact both-sides conflict this flow exists to prevent.

From this point the main checkout treats the card as read-only. The dispatch
artifact on the main board is the visible record of where the card went, and
it is what stops a second session from taking the same card.

## Develop (in a session whose working directory is the worktree)

The worktree is a complete workspace: its `.devflow` carries the board as of
the dispatch commit, and every devflow tool works unchanged.

1. `devflow_take` the card — the lease and the `ready → developing` move
   happen in the worktree's own board.
2. Develop normally. Commit code **and card state** to the branch as you go;
   the journal entries your transitions append are part of the deliverable.
3. Drive the card through its verification edges. Gate commands, reviews, and
   checker subagents all run in the worktree automatically — the card's
   workspace is the worktree by construction.
4. Do not create new cards here. Card sequence numbers are allocated per
   board, and numbers minted in a worktree collide with numbers minted on the
   main board at merge. New work goes on the main board.

## Merge back and tear down (in the main checkout's session)

1. Merge the branch (directly or through a pull request). Code and card state
   arrive together; the card lands on the main board at whatever stage the
   worktree drove it to.
2. Confirm the card's `artifacts/` carries every midscene report the
   worktree produced. Archived reports travel with the merge; the inspect
   history under `$DSH_HOME` is keyed by the worktree's path and is
   unreachable once that path is gone.
3. Remove the worktree and branch:

   ```sh
   git worktree remove <worktree-path>
   git branch -d devflow/<card-id>
   ```

4. Post-merge board actions on the card (archiving, a follow-up transition)
   are made from the main checkout; the fence recognizes the repository's
   main working tree and admits them even though the dispatched worktree is
   gone.

## When something goes wrong

- **A transition is vetoed with "dispatched to worktree …"**: you are writing
  the card from a checkout that is neither its worktree nor the main working
  tree. Move to the right directory; do not retry from where you are.
- **The worktree was moved**: attach a new dispatch artifact naming the
  current path, from the worktree itself, then continue.
- **An artifact was attached from a third checkout**: the card is forked.
  The fence stops transitions, not attachments, and artifact registration
  appends to the same journal under the same revision sequence — the fork
  is the one a transition would have produced. The gap is deliberate:
  attaching is how a moved worktree names its new path, and fencing it
  would leave a displaced worktree no way back. The one-writer rule covers
  every write to the card, attachments included.
- **The card must be pulled back before merge**: from the main checkout,
  delete the branch and worktree, then attach a dispatch artifact whose
  `worktree` field names the main checkout itself. The fence then treats the
  main checkout as the card's home again. The branch's journal entries are
  discarded with the branch — whatever stage the main board shows is the
  card's stage.
- **A journal conflict appears at merge**: both sides wrote the card — a
  transition on one side and an attachment on the other is enough; the rule
  above was broken. Resolve by taking the branch side of
  `journal.jsonl` wholesale if the main side's extra entries were mistaken,
  or re-dispatch and replay otherwise. Never hand-merge interleaved journal
  lines — revisions must stay contiguous or the card becomes unreadable.
