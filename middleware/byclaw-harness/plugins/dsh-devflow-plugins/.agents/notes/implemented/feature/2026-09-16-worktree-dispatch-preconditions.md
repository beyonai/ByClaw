# Agent Note: the worktree fence checks the two preconditions git can answer

Status: implemented

English | [中文](2026-09-16-worktree-dispatch-preconditions.zh.md)

## Problem

The worktree flow has four preconditions, and [its own note](2026-09-16-devflow-worktree-per-card.md) recorded that the package could check none of them: "A deployment that skips them fails confusingly later rather than loudly now."

This repository was one of those deployments. At `950eed9` the main checkout carried no `.devflow` at all — the only real board lived in an uncommitted worktree — so the flow's first precondition was violated by the repository that introduced it.

Two of the four are questions git answers, and both fail silently:

| Precondition | What skipping it does | When anyone finds out |
|---|---|---|
| The board is committed | the worktree checks out an empty board and renumbers new cards from `0001` | at merge, when two `0001`s collide |
| Process-transient state is ignored | `claim.json` travels with the branch and assigns the card to a session that never existed here | when someone tries to take that card |

## Decision

The fence checks both, and a failure is a veto carrying the command that repairs the repository rather than a description of the problem.

`packages/devflow-worktree/src/preconditions.ts` runs two reads in the transition's own workspace: `git ls-files -- <root>/tasks` must list something, and `git check-ignore -q -- <root>/tasks/<id>/claim.json` must match. The board probe reads the listing rather than `--error-unmatch`'s exit code, whose meaning varies across git versions while "is the output empty" does not. The lease probe names one concrete path, because that is what `check-ignore` answers about and because the question is whether the deployment configured ignore rules at all — auditing every transient file is the [commit-semantics document's](../architecture/2026-09-16-devflow-root-commit-semantics.md) job, and the veto points there for the full list rather than carrying a fourth copy of it.

`gate.ts` consults the checker after the dispatch artifact parses and **before** the here/target/main comparison: with the board untracked, "which checkout is this" has no answer worth giving, because an empty board in the worktree is not the same board at all. Verdicts are cached per workspace directory, for the reason `createMainWorktreeResolver` caches its own. A card with no dispatch artifact reaches none of this — the listener still returns at the artifact lookup, and a test asserts the git call count for such a card is zero.

Neither check is a `Config` field. A board that never entered git destroys the card-number space and a lease that travels assigns a ghost holder; these are invariants of the flow's durability, not deployment-varying choices, so a switch over them could only ever be the way around them.

### The two absences point opposite ways

`maintree.ts` and `preconditions.ts` both swallow every git failure, and they mean opposite things by it. The main-tree resolver's absence means no main working tree is derivable, and the fence refuses to admit on it. The precondition checker's absence — git missing, the directory not a work tree — means the check could not run, and a check that could not run must never be reported as one that failed, so it admits. Both modules say so in a comment at the catch, because the next reader will otherwise take one of them for a bug.

### The timing is a cycle late, and the note says so

The dispatch ceremony is attach, commit, `git worktree add` — no transition anywhere in it. The earliest the fence can ask anything is therefore the `devflow_take` inside the worktree, by which point the worktree exists. The checks are still worth having: that is a full development cycle before the collision they prevent, and the repair at that point is deleting a worktree, not repairing a journal.

## Alternatives considered

**A `devflow_worktree_dispatch` tool that checks at dispatch time.** The only way to check before the worktree exists, and the only one that beats the timing limitation above. Rejected: dispatch is a ceremony taught by a skill and performed with the existing `devflow_attach_artifact` plus a shell, so a dedicated tool hardcodes the ceremony into the model-facing surface and forces the runbook to be rewritten — new surface to answer a question the fence can answer with none.

**`/devflow doctor` alone.** A doctor is run by a person who suspects something. The preconditions are prose for everyone who never suspects anything. Partly adopted: the two checks git cannot answer — review edges in range mode, worktrees outside the main checkout — are exactly the ones a doctor should own, and they stay out of the fence.

**Checking the whole transient list rather than one representative path.** It would be an audit of files the fence has no stake in, and it would mean the package carrying the canonical list — the restatement that produced the drift the commit-semantics note documents.

**A `Config` switch to disable the checks.** Rejected above: the only use for it is to keep dispatching out of a repository that will lose the card-number space at merge.

## Consequences

- A deployment that skipped either precondition starts seeing vetoes where it previously proceeded. That is the intent; its alternative today is the collision at merge.
- Two fixtures had to become compliant repositories — `fence.spec.ts` and `loader-composition.spec.ts` both built a repository with no `.gitignore`, which is to say they were the misconfiguration this change vetoes. `fence.spec.ts` now parameterizes both preconditions and keeps every pre-existing case's assertions unchanged.
- The fence's git usage is now observable: `fence.spec.ts` mocks `node:child_process` and counts the promisified `execFile` calls, which is how the zero-calls-without-a-dispatch property and the per-workspace caching are asserted rather than eyeballed.
- The other two preconditions remain prose, and the runbook still states all four.
