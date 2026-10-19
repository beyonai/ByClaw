# Agent Note: devflow — an edge carries its own execution policy

Status: implemented

English | [中文](2026-08-27-devflow-gate-edge-policies.zh.md)

## Problem

`dsh-devflow-gates` had one execution shape for every edge: the shell executor's default timeout and working directory, commands in order, stop at the first failure, and a veto reason carrying at most `maxFailureOutputChars` of what the command printed.

Its own README said the timeout was a deferred item, "waiting for a consumer that needs them". That consumer is the package's first example: `'developing->reviewing': ['pnpm run test']`. A project's test suite is exactly the thing an executor default is not sized for, and when it is killed the gate reports the kill as a failure of the code rather than of its own budget — the worst possible reading of the evidence.

The truncation had the same shape of problem from the other side. The agent that has to fix a failing gate receives a bounded tail of stdout and stderr and nothing else. At the moment the most information is needed, the least is available.

## Decision

**An edge may carry a policy: `timeoutMs`, `workdir`, `parallel`.** Absent, each falls back to what it does today, so an existing deployment behaves identically. The keys validate like `edges` and `approvals` — an unknown edge or a non-positive timeout fails the load rather than being discovered on the first attempt.

**Sequential stays the default; `parallel` is opt-in.** Running the rest after a known failure spends time on an answer nobody reads, and a later command often presupposes an earlier one passing. Where the commands are genuinely independent — lint, types, tests — `parallel` trades that short-circuit for one round trip and a veto naming every failure at once.

**The complete output goes to `<devflow root>/reports/gates/`, derived from the moving card.** It was `failureLogDir`, a directory the deployment named and left unset by default; a later change derived the location so the artifacts land inside the root `dsh-devflow-fs-guard` protects, and dropped the opt-out with it. A failure to write the log warns and leaves the veto intact — the gate's job is to decide, not to guarantee logging.

## Alternatives considered

**Register the output with `attachArtifact`.** The store already has the concept and the card is where the failure belongs, but the call deadlocks: the store serializes per card, and this waterfall runs *inside* the transition that holds that card's turn. The call waits for a transition that is waiting for it. `parkBlocked` avoids the same cycle by not awaiting its own `transition` call.

**Write under the card directory directly.** Rejected for layering: the on-disk shape belongs to the provider, and a policy plugin joining `root/tasks/<id>/artifacts` hard-codes a layout it does not own.

## Consequences

Putting the failure on the card properly needs a seam that accepts a write from inside its own waterfall. That is a real gap, now recorded in the package's Known Limitations rather than discovered again by the next person who tries `attachArtifact` from a gate and watches their transition hang.

Gate results are still neither cached nor incremental: a rework loop pays for the whole suite each time round. Reusing a previous result needs a notion of what the commands depend on, which this package does not have, and that is recorded as a limitation rather than approximated.

`parallel` makes the number of concurrently running gate commands a deployment's choice rather than always one. Nothing here bounds it; an edge with twenty commands starts twenty processes.
