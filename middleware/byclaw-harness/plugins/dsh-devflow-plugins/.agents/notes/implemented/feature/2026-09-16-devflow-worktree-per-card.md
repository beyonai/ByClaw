# Agent Note: devflow — worktree-per-card development

Status: implemented

English | [中文](2026-09-16-devflow-worktree-per-card.zh.md)

## Problem

Cards developed in parallel inside one checkout share one branch. A
range-mode review of either card sees both cards' changes and files its
findings against the wrong one — the cross-contamination
`dsh-devflow-review-gate` records as its known limitation, whose stated fix is
"the card model carrying a range". Opening a second checkout by hand avoids
it, but devflow has no vocabulary for that: nothing records where a card is
being developed, nothing stops a second session from taking the same card,
and nothing stops two checkouts from writing one card's journal — an
append-only file whose merge conflict renders the card unreadable.

## Decision

One card, one branch, one linked git worktree — carried by topology, not by
a new state store. `dsh-devflow-worktree` ships two contributions:

- The bundled `devflow-worktree-runbook` skill carries the ceremony: attach
  a dispatch artifact (configured kind, default `worktree`, frontmatter
  `branch`/`base`/`worktree`) to the `ready` card, commit, then create the
  branch and worktree — in that order; develop and transition the card from
  a session inside the worktree; merge to deliver code and journal together;
  remove the worktree and branch. The plugin never creates or removes a
  worktree itself, per the testenv precedent of judgment-only packages.
- A fence on the `devflow/transition` waterfall enforces the one rule the
  process depends on: a dispatched card transitions only from its named
  worktree or from the repository's main working tree (derived per directory
  from `git rev-parse --path-format=absolute --git-common-dir`, cached).
  Everything else vetoes with both directories named; an unreadable or
  malformed dispatch also vetoes. Cards without a dispatch artifact are
  untouched, and the store is reached with `ctx.get('devflow')` — reads
  only, since a waterfall write deadlocks behind the transition it decides.

No existing decision moves. Root resolution stays `join(cwd, '.devflow')` in
every consumer — a worktree is exactly the per-directory workspace the
root-follows-caller note designed for — and the review-gate
cross-contamination dissolves by topology, because one branch now carries one
card, so the deployment-wide `baseRef` is per-card in effect without the card
model carrying a range.

The same change fixes the one restatement divergence the survey surfaced:
review-gate's `gateParents` passed the devflow root as its synthetic parent's
cwd where the agent-gate original passes the root's parent; checkers now
land in the card's workspace, which in a dispatched card's case is its
worktree.

## Alternatives considered

- **A central board with worktree-aware root resolution** — every session's
  root walks back to the main checkout's `.devflow`. Rejected: it reverses
  the recorded root-follows-caller decision in nine independent consumers,
  puts N writers on one root's `commit.lock`, and still cannot fix the
  automation plane, whose workspace registry is realpath-exact.
- **A `workspace`/`worktree` field on the card** — rejected by the
  root-follows-caller note already: a card's membership is the directory it
  lives in, and a stored location is a second source of truth that moves and
  diverges with the repository. The dispatch artifact is journal-carried
  card *content*, revision-bumped like any deliverable, not addressing.
- **Skill only, no fence** — the one-writer rule would be prose. Its
  violation is silent until merge, and then it is a destroyed card; a
  mechanical veto at the write site names the mistake while it is still one
  transition, not a conflict.
- **Fencing artifact registration too** — rejected: the attach plane is the
  recovery path (a moved worktree re-dispatches itself by attaching its
  current path), and the destructive failure the fence exists for is the
  journal fork, which transitions dominate.

## Consequences

- Parallel development gets isolation per card with zero changes to the
  seam, the store, the root rule, or any gate's configuration surface; the
  fence composes as one more waterfall listener.
- The flow has four preconditions the runbook states: `.devflow/tasks/`
  committed (an ignored board gives a worktree a silent empty one that
  renumbers from `0001`), `claim.json` and `commit.lock` ignored, review edges
  in range mode, worktrees outside the main checkout or ignored. The fence now
  checks the first two on a dispatched card's first transition and vetoes with
  the repair command ([preconditions note](2026-09-16-worktree-dispatch-preconditions.md));
  the last two are a deployment's own configuration and stay prose, so
  skipping them still fails confusingly later rather than loudly now.
- Card creation inside worktrees stays prohibited only by prose — sequence
  numbers are allocated per board and collide at merge. The collision is now
  an asserted behavior rather than a warning: `tests/worktree-dispatch-composition.spec.ts`
  creates one card on each side and asserts that both take `0002` and that the
  merge is clean, so a future fix has a failing shape to start from.
- Midscene acceptance follows the worktree only in project mode, which
  resolves the workspace per session and keys its runtime state by that
  path; under a legacy profile the configured `workspace` names the main
  checkout, so a dispatched card's Web acceptance waits for the merge. A
  removed worktree takes its inspect history with it — the reports
  themselves are archived into the card's `artifacts/` and travel with the
  branch. The automation/scheduler/github-sync planes reject in worktree
  sessions
  (unregistered directories), consistent with their PRD's ruling that
  worktrees of one remote are distinct projects.
- Verified by package tests over real git repositories and worktrees, a
  real-Loader composition driving veto and admission through the filesystem
  store, and a disposal assertion on both contributions. The premise under all
  of it — that a card survives the round trip through git — is pinned
  separately by `tests/worktree-dispatch-composition.spec.ts`, which walks the
  runbook's whole ceremony across two compositions and one real linked
  worktree and asserts that after the branch merges back into a main checkout
  that moved on meanwhile, `foldJournal` replays the merged journal, its
  revisions are contiguous, both sides' entries are present, and the
  dispatching session can advance the card from where the worktree left off.
