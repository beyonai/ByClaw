# Agent Note: `.devflow` holds four kinds of content and one answer each about git

Status: implemented

## Problem

Four kinds of content with genuinely different git semantics had accumulated under one directory, and no document had ever separated them. Two packages inferred the answer on their own and reached opposite conclusions:

- `packages/devflow-worktree/assets/devflow-worktree-runbook.md` made a committed board its first precondition — "A branch checked out from a repository that gitignores its board gives the worktree an empty board that silently renumbers new cards from `0001`."
- `packages/devflow-midscene/tests/devflow-composition.spec.ts` built its workspace with a `.gitignore` of `.devflow/`.

Each was self-consistent, and together they were a contradiction. The midscene line was not an incidental fixture detail either: it was the only place that package stated what it assumes about repository layout, so it was the package's position on the question.

The same gap had already cost something smaller. The runbook's ignore list named `claim.json` and `commit.lock`; `.devflow/midscene/operation.lock` arrived later with `packages/devflow-midscene/src/project-settings.ts` and nobody added it, because no one owned the list.

## Decision

`docs/devflow.md` and its Chinese page carry one section, "Commit semantics of `.devflow`", that names the four kinds and what decides each of them: **where the file's truth lives.**

| Content | In git | Because its truth is |
|---|---|---|
| Card state — `tasks/**/journal.jsonl`, `card.md`, `artifacts/` | required | the journal, which `foldJournal` reads only while its revisions stay contiguous |
| Repository knowledge — `spec/`, `iron-rules/`, `business/` | required | the file plus git, the sentence the spec seam already rests on |
| Deployment policy — `validation.json`, `midscene/settings.json`, `midscene/suites/` | expected | the maintainer's decision, which `validation.json` exists to keep binding without a provider mounted |
| Process-transient state — `**/claim.json`, `**/commit.lock`, `midscene/operation.lock` | never | a live process, so a copy that traveled describes one that never ran here |

The fourth row's rule is stated in the document in its general form, because it decides paths the table does not name: **a file whose content means nothing on another machine does not belong in git.**

The section also carries the canonical `.gitignore` snippet. Every other document references the section rather than restating the classification — the snippet itself is copied, because a snippet exists to be copied, and `tests/devflow-root-commit-contract.spec.ts` asserts every copy reduces to the same patterns as the one in `docs/devflow.md`.

`.devflow/midscene/operation.lock` is listed at its current path. Moving it to a runtime root is separate work; until it moves, a missing line is durable state leaking into git, while a line left behind after the move costs nothing.

### What the test pins

`tests/devflow-root-commit-contract.spec.ts` boots the store through the real Loader over a real git repository carrying the snippet, drives one card far enough to leave a lease and a registered artifact, and asserts **both** directions: every transient path hits `git check-ignore`, and every card-state and policy path is tracked after `git add -A`. Asserting only that transients are ignored would miss the half the runbook's first precondition warns about, which is the failure that actually happened.

## Alternatives considered

**Each package's own README.** This is what produced the contradiction. Two packages writing to the same directory both described the part they touch, and neither had any reason to notice the other's answer.

**A cross-package spec in the planning workspace rather than in the repository.** The shortest path, since the decision was made there. It loses the audience: planning notes are not published with the packages, so a deployment that installed the bundle would never see a rule it has to follow.

**Restating the classification in the runbook and the midscene README instead of referencing it.** Three copies of a classification drift, and the drift is silent — which is precisely how `operation.lock` ended up missing from the one list that existed.

**Ignoring `.devflow/` wholesale, as the midscene fixture effectively claimed.** It makes the transient problem disappear by making the board disappear with it: the card would not travel with its branch, worktree-per-card would have nothing to develop against, and gate policy would stop binding in every checkout but the one that wrote it.

## Consequences

- The runbook's precondition 2 now names the whole list, so a repository set up from it does not leak `operation.lock`. `packages/devflow-worktree/tests/skill.spec.ts` pins the third line along with the first two.
- A change to the snippet in `docs/devflow.md` fails the contract test until every carrier follows. That is the point, and it is also the cost: adding a carrier means adding it to that test's list.
- `packages/devflow-midscene/tests/devflow-composition.spec.ts` now runs against the layout every deployment actually has. Its acceptance run passes unchanged, which settles that the old fixture line was an assumption rather than a dependency.
- `.devflow/reports/` and `.devflow/cache/` — the gate artifact locations — are not in the table. The document's criterion answers them, but naming them is a decision nobody has made yet; the table states the four kinds that packages were actively contradicting each other about.
