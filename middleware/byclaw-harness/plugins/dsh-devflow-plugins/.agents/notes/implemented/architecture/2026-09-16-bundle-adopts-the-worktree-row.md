# Agent Note: a package is mounted once — the bundle adopts the worktree row

Status: implemented

English | [中文](2026-09-16-bundle-adopts-the-worktree-row.zh.md)

## Problem

Two gaps sat between "the bundle is installed" and "the line actually holds anyone to anything", and answering the first uncovered a third that was already latent.

**Assembly.** `devflow-bundle` mounted its four policy rows `disabled: true`, each with a sound reason: an empty spec set gates nothing. The configuration that makes them decide existed only inside `docs/devflow.md`, as a YAML block in the middle of prose. `examples/` held one probe script. So the entire enforcing power of this line depended on a deployment being willing to retype a sample out of a document — and one contract written in two places is the drift this repository keeps finding.

**Discoverability.** `devflow-worktree` was not in the bundle. A capability nobody can install with the one command everybody runs is a capability most deployments never learn exists, and worktree-per-card is the recorded answer to `devflow-review-gate`'s own known limitation.

**The latent one.** Four packages — `devflow-bundle`, `devflow-deploy`, `devflow-midscene`, `devflow-testenv`, and at the time `devflow-worktree` — each ship a `cordis.patch.yml` declaring `dsh.bundle`. That was safe only by accident: none of the four standalone ones was a dependency of the bundle, so no profile ever applied two layers that insert the same row id. Nothing enforced the coincidence, and nothing tested it.

## The failure mode adopting a package would have shipped

`applyEntryPatches` in `@deepseek-ai/cordis-plugin-include` appends an untargeted patch's rows unconditionally — `data.push(...insert)`, with no deduplication by id. The harness's `dsh plugin add` (`apps/cli/src/plugin.ts`, `reconcilePlugins`) appends every *direct* dependency of the profile that declares `dsh.bundle` to `dsh.profile.bundles`, and `loadProfile` applies each of those layers in order.

So a profile holding both `@zhchxiao123/dsh-devflow-bundle` and a package that also patches itself composes two rows of one id, and the Loader refuses the entire composition:

```js
if (seen.has(id)) throw new TypeError(`duplicate loader entry id: ${id}`);
```

A profile that no longer boots, out of two installs that each worked alone. This is not hypothetical for this repository: `e2e/.state/home/profiles/devflow-e2e/package.json` already lists `@zhchxiao123/dsh-devflow-testenv` in `dsh.profile.bundles` beside the bundle.

## Decision

**A package is mounted by the bundle XOR it ships its own `cordis.patch.yml`, never both.** Adopting a package into the mount list means deleting its patch and its `dsh.bundle` manifest key in the same change. The rule was real and entirely unenforced; `tests/bundle-row-ids.spec.ts` now feeds every `packages/*/cordis.patch.yml` through the real `applyEntryPatches` and fails with the offending id and both carriers named.

**`devflow-worktree` joins the bundle and loses its standalone patch.** Its bundled skill teaches a devflow card ceremony end to end and its fence reads the card store, so a profile that mounts it without a board gets a runbook for a board it does not have and a fence inert by construction — the standalone path had no current owner, which is what makes deleting it a removal of unusable surface rather than of a capability. `dsh plugin add @zhchxiao123/dsh-devflow-worktree` now installs a plain dependency that mounts nothing, and both language READMEs say so as a removal rather than leaving it to be discovered.

**`devflow-testenv` does not join.** This is where the adoption rule stops being about mounting cost. Its mounting cost is the lowest of any package in the line — one bundled skill, no tools, no configuration — and by that test alone it would belong. But its runbook bootstraps an e2e environment and names no card, so a profile that never mounts a devflow board still wants it. Adopting it would buy discoverability by deleting a path that works, and the review-gate cross-contamination problem this batch exists to answer never needed it.

**`devflow-midscene` and `devflow-deploy` stay out on mounting cost**, unchanged: midscene needs Node 24, Playwright, a chromium, and a vision-model endpoint, none installable from here; deploy's `host` / `remoteWebRoot` / `remoteReleasesRoot` / `baseUrl` have no fallback default, which is why its own patch ships its row `disabled: true`.

**The worktree row's position in the mount list is a decision separate from its enablement.** Its fence registers on `devflow/transition`, where mount order is decision order, so the row sits after `devflow-guidance` and ahead of the four policy rows: when the card is being written from a checkout that may not write it, running a structure check, a checker, or a test suite first spends work on a move that cannot be admitted either way. The patch comment says so, because the next person to reorder the bundle would otherwise reverse it without noticing.

**The pipeline configuration now lives in exactly one file.** `examples/full-pipeline/cordis.patch.yml` is a profile patch that enables and configures every row the bundle ships disabled, defines the `worktree` dispatch kind so the structure check sees a half-written dispatch before the fence has to, and pins the fence's `artifactKind` to that same kind. `docs/devflow.md` keeps the argument — load order is the waterfall, a profile patch configures rows where they already sit, approvals are deliberately absent, the agent is the producer — and no longer restates a single setting.

**The dispatch ceremony is covered by a composition test rather than by an e2e runner.** `tests/worktree-dispatch-composition.spec.ts` boots two real Loader compositions over one real git repository and one real linked worktree. Its reason for existing is the assertion at the end: after the branch merges back into a main checkout that moved on meanwhile, the merged `journal.jsonl` decodes, `foldJournal` replays it, revisions are the contiguous sequence 1..n, both sides' entries are present, and the session that dispatched the card advances it from where the worktree left off. A second case asserts that a card minted inside the worktree collides with one minted on the main board — that it **collides**, not that anything stops it.

`e2e/README.md` now states which half of the flow each place owns: everything that does not need a live harness has moved into `tests/`, and what remains there needs a browser and a served GUI. It also records that `e2e/.state/` is the residue of one manual local run, not a fixture.

## The example and the test do not share a file

The composition test builds its own minimal shape and never reads the example. A sample answers to a person copying it and gets edited for readability; a fixture answers to a machine and gets edited for the smallest thing that can decide a question. Bound together, each would drag the other — and the existing precedent is already this: `docs/devflow.md` says the artifact-contract spec boots that composition *shape*, not that file.

## Alternatives considered

- **Adopt both `devflow-worktree` and `devflow-testenv`, additively, keeping their patches.** This was the plan, and it is the defect above: it makes a documented configuration refuse to boot. Rejected on evidence, not on taste.
- **Adopt both and delete both patches.** Rejected for testenv only: its standalone path has real users, and "the mounting cost is zero" is an argument for adopting a package, never an argument for removing the way it is installed today.
- **Give the bundle's rows different ids so both layers can coexist.** Rejected: the plugin then mounts twice — two fences, two skill providers — and it breaks this patch's own stated contract that a profile overrides a row by addressing the same id.
- **Change nothing and document the hazard.** Rejected: the hazard is a refused boot, and the rule it violates is mechanical. A document that has to be remembered at the moment a dependency is added is the weakest possible form of this check.
- **Build an e2e runner for the dispatch ceremony.** Rejected: the whole ceremony is git plus the store plus one waterfall listener, all drivable in process. A runner is warranted when something genuinely needs a live harness, which is exactly what `e2e/README.md` keeps.
- **Write the ceremony into `e2e/README.md` as another manual procedure.** Rejected: a manual procedure never runs in CI, which returns the flow to "never been run" — the finding that produced this work.
- **Leave the YAML in `docs/devflow.md` and add the example beside it.** Rejected, and it is the easy mistake here: two copies of one contract is the defect this change exists to remove. The document keeps the reasoning, which has no second home.
- **Have the test import the example.** Rejected; see above.

## Consequences

- **The default composition of every existing deployment changes on upgrade.** They gain one catalog line and one transition listener. The listener is inert for every card carrying no dispatch artifact and the skill is a catalog entry loaded on demand, so the increment is within what a minor upgrade may do — but it is a change to what installs by default, and a deployment that wants neither disables the row from its own profile patch.
- **A profile that installed `devflow-worktree` standalone keeps working and stops being special.** The package still resolves and the row still mounts, now from the bundle; what changed is that the profile's own `dsh.profile.bundles` entry for it resolves to a package with no `dsh.bundle`, which `reconcilePlugins` drops on the next `dsh plugin add`. A profile that never runs one again carries a stale entry that `loadProfile` rejects with `declares no dsh.bundle` — the loud failure, not the silent one, and the README says what to do.
- **`devflow-worktree` now has two configurations that must agree**: the fence's `artifactKind` and the artifact gate's `kinds` entry for it. The example writes both explicitly for that reason; a kind the gate never defined leaves the fence parsing records nothing shaped.
- **The XOR rule is enforced for every future adoption**, not just this one. `tests/bundle-row-ids.spec.ts` also pins the list of packages that still carry a patch, so a carrier joining or leaving is a deliberate edit with its reason in the patch rather than a silent drift.
- **The round trip through git is verified, and it holds.** The merged journal folds, which is the premise the whole worktree topology rests on. The negative case is pinned by construction: a both-sides append does not merge at all, so the rule the fence enforces is the precondition of the board's durability model rather than a policy stacked on top of it.
- **Card-number collision across a worktree boundary is now a visible, asserted behavior** instead of one line of prose in a runbook. Nothing prevents it, and the test says so — which is where a future fix starts.
- **`pnpm run preflight:tarballs` is the gate for the manifest changes.** The bundle ships no new file and gained one `workspace:^` range; `devflow-worktree`'s tarball loses `cordis.patch.yml` from its `files`, and with the `dsh.bundle` key gone, preflight's "a bundle declaration the tarball does not carry" check no longer applies to it.
