# Agent Note: /devflow doctor reports the deployment, including what it could not check

Status: implemented

English | [中文](2026-09-16-devflow-doctor-command.zh.md)

## Problem

Nothing could answer "is this devflow installed correctly?". Every misconfiguration surfaced late and somewhere else: the four gates ship `disabled: true` and you learn that by reading `devflow-bundle/cordis.patch.yml`; a review edge left in workspace mode reviews another card's changes and you learn that from the review; an uncommitted board collides at merge; a lease nobody reclaims stops a card until somebody remembers `/devflow takeover`.

Two of those are not hypothetical. `dsh-devflow-plugins-midscene/.devflow/tasks/` still carries `claim.json` files dated 2026-09-15 on cards `0001` and `0004`, because `ClaimHolder.heartbeatAt` is written at claim time and `heartbeat()` has no caller anywhere on this line — the timestamp can only ever be the moment the card was taken.

## Decision

`/devflow doctor` is a read-only report in five sections, derived from read faces that already exist — `list()`, `holder()`, each card's own artifacts, `ctx.get` probes, and git. No store method, no service, and no seam was added for it, following `/devflow spec`, which is derived from `list()` plus `evaluate()` for the same reason. It is a human-facing command rather than a model-facing tool for that command's reason too: a whole-deployment sweep is the opposite of the index-not-bodies discipline the tool plane keeps.

### `Not asked` is a primary output

The section always renders and always leads with the sentence that none of its lines is an answer of "no problem". Four entries are fixed, because no composition of this line can answer them: validator availability (`ValidatorRegistry` keeps its providers private and publishes no enumeration), each gate's edge configuration (`devflow-gates` provides a registry and nothing else; `devflow-review-gate` and `devflow-agent-gate` provide nothing, so the `baseRef` question the parent task wanted answered cannot be), the dispatch artifact kind (the worktree plugin's `worktree` default is assumed, and a deployment that configured another has every dispatch missed rather than reported), and what `.gitignore` means (only `git check-ignore` is asked — `/devflow spec`'s position, for its reason). Whatever the run itself could not reach joins the list.

**The first draft of this command failed exactly here, and the failure is why the section exists.** The fence's precondition checker answers `undefined` both for a repository that passes and for one it could not ask about, which is right for a fence — [its own note](2026-09-16-worktree-dispatch-preconditions.md) records that a check that could not run must never be reported as one that failed. Run against `dsh-devflow-plugins-midscene`, whose gitdir pointer is stale, doctor rendered that `undefined` as "the board is tracked and its transient state is ignored". So `doctor` establishes git can answer at all (`git rev-parse --is-inside-work-tree`) before trusting the shared verdict, and each section that cannot answer leaves a marker where the answer would have been rather than falling silent.

### One implementation, one wording

The Board section calls `createDispatchPreconditionChecker` itself, so a fault reads in the report exactly as it reads in the veto a transition receives; two accounts of one fault read as two faults. The report frames it, never rewrites it: where a card is dispatched the sentence stands as the live veto it is, and where none is the report says so and names the card standing in for the first one that will be.

### The worktree entry point exists to keep a default plugin light

`devflow-command` is mounted by default in the bundle and `devflow-worktree` is not, so importing the checker had to not make the first depend on the second's load. The worktree index value-imports `@deepseek-ai/dsh-skill` to register its bundled runbook — a package `devflow-command` neither declares nor needs to read a dispatch record. `packages/devflow-worktree/src/dispatch.ts` is therefore a package entry of its own, exporting `parseWorktreeDispatch`, `createDispatchPreconditionChecker`, and `WorktreeDispatch`; nothing reachable from it imports anything but node builtins, so loading it mounts nothing and requires nothing.

### Two questions about one worktree

Path existence and git linkage are reported apart, because a plain directory at the dispatched path answers the first and fails the second — a state nothing makes visible today and one the fence admits, since it only compares resolved directories.

### No threshold for a lease

Leases are rendered with their holder and the age of the heartbeat, and judged by the reader. A threshold would be a deployment-varying tunable whose only owner is this report, and lease reclamation is a decision the parent task deliberately deferred. The section says why the ages look the way they do — `heartbeat()` has no caller — so a reader is not left inferring that a two-day-old timestamp means a dead session.

## Alternatives considered

**Giving `ValidatorRegistry` a `names()` read face.** It would make the Gates section genuinely useful, and it is a small increment on a class this line owns rather than a new seam. Rejected for now: the only consumer would be this report, and the rule here is that an abstraction needs a current owner and need. Landing it as "cannot be answered" costs one honest line; if that line gets asked about repeatedly, the consumer's need is then demonstrated rather than assumed, and the read face is one card.

**A configuration-projection service on `devflow-review-gate`.** The same trade with a larger bill — a whole service so one report can print one field. Same verdict, more firmly.

**Importing the checker from the worktree package index.** What the plan assumed. Rejected after checking what the index's module graph actually pulls: a value import of `@deepseek-ai/dsh-skill`, which would put a package the default command plane never touches on its load path. In practice `dsh-skill` is present wherever `devflow-guidance` is, which is everywhere — but that is an implicit dependency on another plugin being mounted, and it is the kind this line refuses.

**Reimplementing the two git checks inside `devflow-command`.** The fallback the plan named if the import proved coupling. Rejected because the narrow entry achieves the same isolation without giving up a single wording for a single fault, which is what makes a veto and a report recognizable as the same event.

**A `--fix` flag.** Rejected: a health command that repairs things gets run as an installer, and then nobody knows what it changed. Every fault the report names carries the command that repairs it instead.

**A staleness threshold for leases.** Rejected above — an unowned tunable, and a verdict the report has no standing to give.

## Consequences

- `devflow-command` gains a runtime dependency on `@zhchxiao123/dsh-devflow-worktree`, resolved only through the `./dispatch` entry. The worktree plugin still need not be mounted; nothing in that entry registers anything.
- `devflow-worktree` ships a second entry, so its `files`, `exports`, tsdown entry list, and the root `tsconfig.base.json` paths all name `dispatch` beside `index` and `invariant`.
- The `USAGE` string changed, so the tests asserting it whole changed with it.
- The Worktrees section is silent about a deployment that configured a non-default `artifactKind`. That is stated in `Not asked` rather than worked around, and it is the one place this report can be wrong without saying so.
- Doctor spawns up to three git processes per run (`rev-parse`, `ls-files`/`check-ignore` through the checker, `worktree list`), all on a human-invoked path. Nothing on the transition, pre-step, or turn-end paths runs any of it.

## Testing

`packages/devflow-command/tests/doctor.spec.ts` builds real git repositories, real boards, and real `claim.json` files. The cases written first are the two that would let the report lie: a workspace with no board, and a composition with no optional plane mounted. The AC4 case asserts that the report contains the string `createDispatchPreconditionChecker` itself returns, rather than asserting a literal on each side, so the two cannot drift apart into two wordings.
