# Agent Note: devflow — the checks and the append happen under one lock

Status: implemented

English | [中文](2026-08-27-devflow-commit-lock.zh.md)

## Problem

Every check a transition makes — the revision compare-and-set, the edge legality, the rework reason — ran against a card read at the top of `commitTransition`, and the append that acted on those checks came after the `devflow/transition` waterfall. That waterfall is where a deployment's gate commands run. With `'developing->reviewing': ['pnpm run test']` configured, the distance between "revision 3 is current" and "write revision 4" is however long the test suite takes.

`serialized()` closes that window inside one provider instance. It does nothing across instances, and two processes over one root are the ordinary case: a harness and a `/devflow` invocation, two harnesses, a checkout shared with CI. Both read revision 3, both pass every check, both append revision 4.

The result is not a lost update. `foldJournal` requires contiguous revisions and requires each transition to depart the location the previous entry arrived at, so the second append makes the journal **structurally invalid** — and the store's read path is deliberately fail-loud. The card becomes permanently unreadable, and the journal is the authority, so nothing else can recover it. A single card's history is the one thing this design promises to keep.

The same gap breaks legality independently of revisions: a card parked `blocked` during a gate still receives the move the gate approved, written with a `from` the card no longer sat at.

## Decision

**A commit lock spans one writer's final commit work, and nothing before it.** `committingJournal()` takes `commit.lock` in the card directory with an `O_EXCL` creation and gives every journal writer one settled fold plus its next-entry append. Transition and artifact writers hold it for that journal work and append only when the revision still equals the one their earlier checks used. Unchanged revision proves those checks still hold because a card's location only moves with its revision. A stale-claim takeover also re-reads `claim.json`, builds `claim-expired` from the settled revision, and replaces the lease before releasing the same lock, so two concurrent takeovers cannot both succeed. Because the journal is authoritative, takeover records the eviction before replacing the lease; a crash between those two file writes leaves an auditable eviction with the old lease still present, and a later takeover can retry.

The lock deliberately does **not** cover the caller's checks or the waterfall. Gate commands take minutes; a lock held across them would queue unrelated commits behind a test suite, and would turn every crashed gate into a stuck card.

A revision-dependent caller that loses this race gets `revision-mismatch`, the code it already had to handle, with a message naming the gate as the reason the card moved underneath it. A transition or artifact caller that never gets the lock gets `write-contended`: nothing was written, and the operation can be retried unchanged. A contended stale takeover leaves the observed holder in place.

## Alternatives considered

- **Require the caller to hold the card's lease.** The investigation says no: of the write paths, only `devflow_take` and the driver claim at all. `/devflow move`, plain `devflow_transition`, and every `attachArtifact` do not, so the rule could only ever warn — leaving the corruption open — or break three of five callers. Worse, the driver holds its lease as `{kind:'command'}` while the child that writes is `{kind:'agent'}`, so an identity comparison would reject the one consumer using leases correctly.
- **Append first, then verify and roll back.** The journal is append-only; a truncating rollback gives that up, and `foldJournal` would see the intermediate state anyway.
- **Re-check without a lock.** Narrows the window from minutes to microseconds but does not close it, and what leaks through is unrecoverable data loss rather than a retry.
- **Break a lock after an mtime threshold.** Rejected because the stale check and pathname deletion are not atomic. If the old owner releases and a successor acquires between them, the checker deletes the successor's live lock and admits two writers.

The retry budget is a fixed constant rather than a `Config` field. It bounds an internal critical section of one read and one append; a deployment has nothing to tune.

## Consequences

`TransitionRejectionCode` and `ArtifactResult`'s code union each gain `write-contended`. No consumer in this line switches exhaustively over either, so the addition is compatible; a consumer that does will need a case.

Concurrent commits on one card now serialize across processes rather than corrupting. This includes `claim-expired`, which is a journal mutation even though claim acquisition is not a transition. Commits on *different* cards are unaffected — the lock is per card directory, matching `serialized()`'s root + id key.

A process killed between taking the lock and releasing it leaves the file behind. The store does not delete it from age alone because that cannot prove ownership; writes fail closed as contention until an operator verifies no writer is active and removes the lock. This trades automatic crash recovery for mutual exclusion that cannot delete a successor's lock.

`transition-contention.spec.ts` holds the waterfall open the way a gate does, commits from a second instance, and asserts the first commit is refused and the card stays readable. It also races two stale takeovers and requires one holder plus one `claim-expired` revision. `commit-lock.spec.ts` requires an old lock to remain contended instead of being deleted without ownership proof.
