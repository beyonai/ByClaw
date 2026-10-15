# AGENTS.md

devflow is a **plugin line over the DeepSeek Harness**, not a fork of it. Packages compose against `@deepseek-ai/*` packages consumed from npm; nothing here patches the harness, and nothing here may require a harness change to work. The Harness agent is the sole workflow executor; plugins expose state, tools, gates, commands, and views rather than a second background orchestrator. The optional scheduler and GitHub sync capabilities perform mechanical background intake without advancing Devflow stages. Read [docs/devflow.md](docs/devflow.md) before changing `packages/`.

## The one rule that shapes everything else

**This line depends only on published harness surface.** If something you need is not exported from a published `@deepseek-ai/*` entry point, you have three honest options, in order of preference:

1. **Restate it locally** — the trust fence in `devflow-web` and the sidebar-foundation contract in `devflow-ui` are both local restatements of rules whose implementations are package-internal to the harness. A restatement says so in its module doc, and a divergence from the original is a defect in the copy.
2. **Reach it through a service name** — cross-plugin collaboration goes through `ctx` services, never value imports. `ctx.get(name)` for optional ones.
3. **Propose it upstream** and wait — only when the first two genuinely do not work.

What you may **not** do is depend on unreleased harness work. `escapeDismissHandler` is the standing example: it exists in the harness's `ui-primitives` on an unmerged branch, so this line holds its own copy until that export ships.

## Harness version

Every `@deepseek-ai/*` dependency is pinned to one exact prerelease (`0.1.5-rc.2`), never a range. `^0.1.5-rc.2` does not match a later prerelease, and a floating range across a pre-1.0 harness is how a plugin line silently stops loading. Bumping the harness is a deliberate change: bump every package together, run the full suite, and record what moved. Typecheck the bump with `tsc -b --force`: an incremental `tsc -b` treats a changed dependency `.d.ts` as no reason to rebuild and will report success against surface that no longer exists.

**The version is written in three places, and a bump that misses one lies to you.** `packages/*/package.json`, the `minimumReleaseAgeExclude` list in `pnpm-workspace.yaml`, and the root `package.json` devDependencies. Miss the root list and the old copies stay installed; TypeScript then resolves declaration merging against them and reports slots and namespaces as nonexistent — errors that name the new surface but are produced entirely by the old. Delete `node_modules` and `pnpm-lock.yaml` before reinstalling, because an incremental install keeps the stale copies alive. A bump also adds transitively-required packages that the exclude list has never seen; `pnpm install` names each one, and every name it prints belongs on the list.

## Layout

```
packages/
  devflow/              Service Definition of the ctx.devflow seam
  devflow-agent-gate/   independent LLM admission policy
  devflow-artifact-gate/ mechanical artifact contract policy
  devflow-bundle/       one-command composition patch; a package it mounts ships no patch of its own
  devflow-business/     repository-carried business knowledge, confirmed only by review
  devflow-filesystem/   Service Provider: .devflow/ on disk
  devflow-gates/        gate policy on the transition waterfall
  devflow-review-gate/  code-review policy over open-code-review's delegate mode
  devflow-parent-gate/  completion policy for decomposed requirements
  devflow-fs-guard/     denies agent file tools any write under .devflow/
  devflow-spec/         Service Definition of the ctx.devflowSpec seam
  devflow-spec-filesystem/ Service Provider: .devflow/spec/ plus anchor evaluation
  devflow-spec-tool/    devflow_write_spec / devflow_read_spec
  devflow-spec-sentinel/ turn-end staleness steer + the pre-step spec index
  devflow-iron-rules/   repository-carried obligations, enforced at turn end
  devflow-testenv/      the e2e bootstrap runbook skill; installs standalone, outside the bundle
  devflow-worktree/     worktree-per-card: the dispatch runbook skill + the worktree fence; bundle-mounted
  devflow-midscene/     optional Web acceptance skill and isolated suite CLI
  devflow-deploy/       persistent publishing over a target-type seam
  devflow-tool/         the model-facing tools
  devflow-guidance/     the devflow-workflow skill + devflow-board runtime context
  devflow-command/      the deterministic /devflow intervention plane
  devflow-web/          devflow's own browser channel (HTTP + change stream)
  devflow-ui/           the board, browser half
  scheduler/           Service Definition of the ctx.scheduler seam
  scheduler-local/     local SQLite schedules, handler delivery, and /scheduler
  github-sync/         Service Definition of the ctx.githubSync seam
  github-sync-local/   local GitHub snapshots, changes, consumers, and /github-sync
  scheduler-tool/      agent scheduling tools
  github-sync-tool/    agent subscription, synchronization and consumer tools
  automation-project/  existing Harness workspace identity resolution
  automation-web/      trusted project-scoped automation HTTP management
  automation-ui/       native Automation and GitHub Subscriptions Sidebar pages
.agents/
  prd/                  what each change set is for
  notes/                Agent Notes — the decisions and their rationale
  skills/               how to work here (prose standard, review, notes)
.scratch/devflow/       issues sliced out of a PRD
docs/devflow.md         the subsystem walkthrough
```

## Commands

```sh
pnpm run init            # install, then prove the checkout
pnpm run verify          # typecheck + lint + test — the pre-push gate
pnpm run test:coverage   # per-file 100% on packages/*/src
pnpm run build           # clean, then declarations, node entries, browser bundle
pnpm run preflight       # pack every package and inspect the tarballs
pnpm run preflight:tarballs # the same minus the "already published" check — what CI blocks on
pnpm run release         # verify + build + preflight + publish (see RELEASING.md)
```

`build` cleans first on purpose: tsdown's `outDir` is the same `lib/` that `tsc -b` writes declarations into, so the two steps would otherwise delete each other's output — and incremental tsc would not put the declarations back.

## Conventions

These carry over from the harness because the code does. Where a rule cites a harness document, that document is still the authority — read it in the harness checkout.

- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer. A contribution proves disposal with a test that disposes the fiber and observes removal.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role.
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Require a current owner and need.** Tie each abstraction, option, and compatibility path to a current consumer. A published wire field nothing reads is surface you will have to keep.
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields. Protocol constants, external specs, and security invariants stay fixed, and say why in their doc.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point.
- **Trust TypeScript at typed same-process boundaries.** Validate at parser/config, model/tool JSON, durable/file, worker, process, and wire boundaries — the read face's request body is exactly such a boundary.
- **Publish state only at its commit point.** For devflow that point is the journal append; projections, notifications, and views derive from it.
- **Plugin exports:** service packages default-export their service class; function plugins named-export `name` / `inject` / `Config` / `apply` and have no default export. Mixing the forms makes the Loader discard the function plugin's namespace.
- **Optional services use `ctx.get(name)`**, never the `ctx.<name>` property proxy.
- **Every package owns `./invariant`.** Check an event/data relation, or give an empty installer a package-specific `No runtime invariant:` reason.
- **`src/types.ts` contains only types.** Tests live at package level under `tests/`.
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- **Do not comment on facts obvious from code.** Comments and docs state contracts and consequences, not reasoning transcripts — apply [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md) and [dsh-trim-cot-leakage](.agents/skills/dsh-trim-cot-leakage/SKILL.md).
- **Tests describe behavior, not correctness.** Change obsolete behavior together with its tests and say why.
- **Non-trivial changes carry an Agent Note** in the same change ([format](.agents/notes/README.md)).
- Files end with exactly one trailing newline.

## Testing

Package tests need a local `tests/tsconfig.json` so type-aware lint can discover their project. Extend `tsconfig.tests.json` for no-emit tests; keep production build references limited to production projects. Root scripts and test helpers use local configs extending `tsconfig.tools.json`.

Per-file 100% coverage on `packages/*/src` is the gate. Beyond unit tests, a product-visible plugin needs a **real-composition test**: boot a test-only `cordis.yml` through the real Loader and assert user-visible or durable output, mocking only what is genuinely external. The existing suites under `packages/*/tests/` are the template — `devflow-web` boots the store, the webserver, and its own route, then drives the running server over raw HTTP and live WebSockets.

## The browser bundle

`devflow-ui` ships `lib/client.js`, a loader-factory artifact the harness serves at `/plugins/<id>/client.js` and runs with a `require` backed by its module table. `tsdown.client.ts` builds it, restating the harness's own client-bundle preset because that preset lives in `packages/client/tsdown.client.ts` and its tarballs carry no `src/` — a divergence from it is a defect in our copy.

Two rules bind anything you add to the browser half:

- **A runtime import must be in the module table** (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `dsh-client-ui-slots`, `dsh-client-ui-primitives`, `dsh-client-store`, `dsh-client-ui-renderer/client`) **or inline cleanly.** A purity gate in the build fails on any other `@deepseek-ai/*` value import, because it would either inline a duplicate of a shared singleton or require a specifier the table cannot answer. Collaborate through a cordis service, or import type-only.
- **`dsh.client` without `lib/client.js` is fatal, not degraded.** The harness refuses to boot rather than starting without the plugin, so never publish the one without the other.

### Testing against the harness's client bundles

`tests/loader-factory.ts` is a module table: it evaluates a published client bundle, hands its factory a `require` backed by statically imported singletons, and returns the exports — so a spec can `import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'` and get the real class rather than a double. The table's entries are static imports on purpose; a `createRequire` would hand the factory a second React and every hook would throw.

Two consequences worth knowing before you add a client dependency:

- **A bundle requiring something the table does not serve throws here** — which is the same failure it would have in a browser, so add the entry only if the harness actually shares that module.
- **`@deepseek-ai/dsh-client-test-runtime` cannot be used.** Its published `lib/index.js` imports a `src/` path no tarball ships. The two doubles this line needs are restated in `packages/devflow-ui/tests/harness-doubles.ts`.
