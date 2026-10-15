# Upstream provenance

- Repository: <https://github.com/zhchxiao123/dsh-devflow-plugins>
- Imported commit: `55df7330a0e1ff56b7ff9a7f6cb24f3e0bd1bb2f`
- Imported on: 2026-09-19
- Upstream version: `0.4.0-dev.8`

The repository is carried here as a source snapshot without its nested `.git`
directory. This file is ByClaw-local provenance metadata.

## How a sync is performed

The snapshot has no upstream history of its own, so a sync reconstructs one in a
scratch repository: commit the previously imported upstream tree, commit this
directory on top of it, then rebase that ByClaw commit onto the new upstream
tree. Restrict the ByClaw commit to the files listed below — replaying the whole
directory diff drags in adaptation churn upstream has since made itself, which
turns a tractable merge into thirty conflicts of pure version noise.

## ByClaw-local differences

Everything else in this directory matches the recorded upstream commit byte for
byte. Five differences are deliberate:

1. **Repository-root bundle shell** — `cordis.patch.yml` plus the root
   `package.json`'s `version`, `exports`, `files`, `dsh.bundle.patch`, and its
   dependency on `@zhchxiao123/dsh-devflow-bundle`.
   `scripts/docker-plugin-layout.mjs` discovers a bundle only at
   `plugins/<name>/package.json`, and the packing step requires a version string
   that upstream's private root manifest omits. The patch is the upstream
   devflow-bundle patch with one change: the artifact gate and agent gate that
   upstream ships `disabled: true` are enabled. It states no `config` — see (7).
   **Its row list must be resynced from `packages/devflow-bundle/cordis.patch.yml`
   on every import** — a row added upstream and missed here is a plugin that
   silently never mounts. `tests/repository-bundle.spec.ts` fails when the two
   drift.

2. **Expanded root `devDependencies`** — 22 packages beyond upstream's root
   manifest (`shiki`, `katex`, the `micromark-*` / `mdast-*` set, the React UI
   kit, `zustand`, and others). Under the harness's own pnpm workspace the
   plugin root hoists differently, and `tsdown --config tsdown.client.ts` has to
   resolve these from here.

   `@deepseek-ai/dsh-client-ui-sidebar-right`, `-dockkit`, and `-layout` are
   deliberately *not* among them. Installing the real right-Sidebar package puts
   its `.d.ts` beside `devflow-ui/src/client/sidebar-right.ts`, and the two
   augment the same slot declarations with different types — `TS2717` on every
   build. They were carried by the previous import only because it consumed the
   package instead of the restatement.

3. **Optional `dsh-better-sidebar` bridge in `devflow-ui`** — deployments whose
   visible side panel comes from the ecosystem `dsh-better-sidebar` foundation
   instead of the Harness right-Sidebar shell. `better-sidebar.ts` restates that
   foundation's service contract structurally, and `index.ts` mirrors the board
   into its registry whenever the service appears, keeping upstream's official
   registration as the canonical path. The service is deliberately not an
   `inject` dependency: a missing optional foundation must never hold Devflow
   pending.

   Supporting this cost one seam in upstream code: `DevflowBoardTab.tsx` splits
   its page factory into a host-neutral `createDevflowBoardScopedPage` and
   passes artifact opening in as an optional `openResource` prop, because
   `tab.actions.openResource` exists only in the official slot. Where the host
   cannot open a resource the board renders without artifact links rather than
   dead ones. This seam is a reasonable upstream contribution.

4. **`devflow-agent-gate` inherits the initiating agent's model route** — an
   agent-triggered transition dispatches its checker on that agent's latest
   request provider and model, including session-local model selections, instead
   of always using the deployment default. Upstream has not adopted this; it is
   a genuine fork, not an adaptation, and should be offered upstream so the next
   sync carries one fewer difference.

5. **ByClaw-local tests** — `tests/repository-bundle.spec.ts` and
   `tests/docker-plugin-layout.spec.ts` cover the bundle shell in (1) and the
   layout contract Docker relies on. Neither has an upstream counterpart.

6. **Eleven upstream packages are not carried.** Docker packs every
   `plugins/*/packages/*`, so a package present here ships in the image whether
   or not the bundle mounts it. None of these eleven is a bundle row, so
   dropping them changes nothing that loads:

   - `devflow-midscene` — pins `playwright 1.63.0` against the `1.62.1` that
     `Dockerfile.base` installs with browsers under `/ms-playwright`, and its
     `@midscene/*` + playwright + sharp graph is ~57 MB installed.
   - `devflow-deploy` — no dependent in the retained set.
   - The automation line, a closed cluster of nine that nothing retained
     references: `automation-project`, `automation-ui`, `automation-web`,
     `github-sync`, `github-sync-local`, `github-sync-tool`, `scheduler`,
     `scheduler-local`, `scheduler-tool`.

   Removing them required five consequent edits, all of which re-apply on a
   sync: prune `tsconfig.json` `references` and `tsconfig.base.json` `paths`;
   drop `automation-ui` from the bundle list in `tsdown.client.ts`; drop the
   eleven entries from `tests/invariant-companions.spec.ts`; delete
   `tests/automation-entrances.spec.ts`, `tests/scheduled-github-sync.spec.ts`,
   `tests/scheduler-validation-handler.ts`, and
   `scripts/scheduler-github-profile-smoke.mjs`; and narrow the carrier list in
   `tests/bundle-row-ids.spec.ts` to `devflow-bundle` and `devflow-testenv`.

   Two of those name a directory rather than a package, so a grep for the
   package name does not find them: `tsdown.client.ts` and the `patch-yaml`
   import below. **`pnpm run verify` does not catch either** — it is typecheck,
   lint, and test, and neither `tsc` nor `vitest` reads `tsdown.client.ts`. A
   stale entry there fails only at `pnpm run build`, which is what the image
   runs. After removing a package, run `pnpm run build` and
   `pnpm run preflight:tarballs` as well as `verify`.

   `tests/patch-yaml.ts` also moved here from
   `packages/devflow-deploy/tests/`, where upstream hosts it because `yaml` is
   that package's devDependency. The ByClaw copy resolves `js-yaml` from the
   root instead, adding no dependency.

   Upstream's `README.md`, `docs/devflow.md`, `AGENTS.md`, and
   `.github/workflows/ci.yml` still describe the removed packages, and are
   deliberately left untouched: they are upstream's documents, the nested
   workflow never runs (GitHub Actions reads only a repository root
   `.github/`), and editing them would add four files to re-patch on every
   sync for no behavioral gain. This file is where ByClaw's package set is
   recorded.

7. **The two enabled gates default to ByClaw's constrained workflow.**
   `devflow-artifact-gate` defaults `kinds` to the five documents and `edges`
   to the stages they guard; `devflow-agent-gate` defaults `edges` to the five
   checker prompts. Upstream leaves all three dicts empty on purpose — which
   edge is worth paying a checker for is a deployment decision — so this is a
   deliberate override of that stance, not an oversight, and it puts
   Chinese-language prompts in a package that is otherwise language-neutral.

   The payoff is that the policy has one home. Before this, the bundle layer
   restated it, so every profile wanting the constrained workflow either copied
   it or silently got an ungated pipeline. Now enabling the row is the whole
   decision. Schemastery dicts do not merge: a deployment stating its own
   `edges` replaces the set entirely, and `edges: {}` turns the checks off
   while leaving the plugin mounted.

   Each package carries a `tests/default-policy.spec.ts` that mounts it with no
   config and drives a real transition, because every other spec in both
   packages states its own config — without them the shipped default would be
   the one configuration nothing exercises.

8. **`devflow-workflow`'s browser-acceptance section is rewritten.** Upstream's
   section 8 tells the agent to load `devflow-midscene-browser` and
   `devflow-midscene-acceptance` and to use `midscene_auth` — three things this
   image does not have, since (6) drops `devflow-midscene`. Worse than dead
   text: it also says to use those skills "rather than inventing a separate
   workflow", which steers the agent away from `@byclaw/dsh-browser-use`, the
   browser automation this harness does mount. The ByClaw section keeps the
   obligations that are the skill's real content — ask only for what is
   missing, never take credentials through chat or reports, a blocked login is
   a preparation blocker rather than a failed assertion, register the run as an
   artifact, an earlier report cannot stand in for fresh gate execution — and
   points them at the `browser` tool instead.

   Upstream's own spec calls this the "seven-section judgment body" and pins
   sentences only from sections 1-7, so section 8 carries no test contract and
   the rewrite breaks nothing.

   The alternative was a ByClaw-owned skill provider registered at a lower rank
   than `BUNDLED_SKILL_RANK`, which is the override point upstream documents in
   `devflow-guidance/src/skill.ts`. It was not taken: it costs a new plugin and
   a runtime transform that can silently stop matching, to avoid one markdown
   section a three-way merge replays cheaply. **If this repository ever
   consumes the devflow line from npm instead of source, that provider becomes
   the only available route** — the body would then live inside a published
   tarball.

9. **`devflow-testenv` is mounted, which upstream's bundle does not do.** Its
   `devflow-e2e-bootstrap-runbook` skill turns "how do I bring this system up"
   from per-card archaeology into a repository-carried, executable runbook.
   Upstream keeps the package out of `devflow-bundle` on the grounds that it
   names no card, so a board-less profile still wants it and bundling it would
   delete the standalone install path. ByClaw always mounts the board, and the
   gates here refuse `testing -> done` without reproducible evidence, so the
   runbook belongs in the same composition as the gates that demand it.

   Mounting took **two** edits, and either alone is inert: a row in the root
   `cordis.patch.yml`, and `@zhchxiao123/dsh-devflow-testenv` in the root
   manifest's `dependencies`. The row names a package the profile must already
   carry — `devflow-bundle` pulls only the seventeen it mounts, and the
   Dockerfile's profile `overrides` make a package resolvable without putting
   it in the dependency graph. `tests/repository-bundle.spec.ts` now asserts
   both halves.

   The row id is `testenv`, matching the id this package's own patch uses. A
   profile that also installs it standalone then fails loudly with `duplicate
   loader entry id` rather than registering the skill twice under two ids.

## Notes for the next sync

- Upstream's `sidebar-right.ts` restates the right-Sidebar contract locally
  rather than importing `@deepseek-ai/dsh-client-ui-sidebar-right`, whose
  published types are not self-contained. A previous import here had inverted
  that choice; do not reintroduce the package dependency.
- `devflow-agent-gate` throws on a configured `reportDir` or `verdictCacheDir`:
  both are now derived from the moving card's own devflow root. Carrying either
  in the root patch is a fatal composition error, not a stale setting.
- A sync brings the eleven packages in (5) back. Re-apply the removal and its
  four consequent edits, or the image regains ~57 MB of Midscene dependencies
  and a `playwright` version that does not match the one the base image
  installs. `devflow-testenv` and `devflow-business` are kept on purpose: both
  are small, and testenv still ships its own `cordis.patch.yml`, which is what
  `tests/bundle-row-ids.spec.ts` checks the XOR rule against.
