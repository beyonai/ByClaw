# @zhchxiao123/dsh-devflow-spec-sentinel

English | [中文](README.zh.md)

**Turn-end sentinel and pre-step index for devflow spec documents.** The plugin watches which files a turn's first-party `write`/`edit` calls landed; when the stopping turn has left an anchored architecture document stale, it steers the agent into one continuation step that names the document, the failing anchors, and the four legitimate exits — rewrite via `replaces: [<same id>]`, replace a document that was wrong, retire the claim through a merge, or explicitly defer. The same document never interrupts the same session twice; after its one interruption, staleness stays visible through `devflow_read_spec` warnings and the pre-step spec index rather than through force.

This is deliberately the opposite cadence from [`devflow-iron-rules`](../devflow-iron-rules/README.md), whose turn-stopping hook shape it shares without sharing code: an iron rule violation is an **obligation** and blocks every dirty turn until fixed or capped; a stale spec document is a **reference**, and its reader owes it one informed look, not a fight. There is no retry ceiling here because there is nothing to retry — a mid-refactor rename that keeps a document reasonably stale for many turns is a legitimate state, and the sentinel says so in its own message.

Zero configuration is meaningful: without the `devflowSpec` seam the sentinel and the index are inert (both live on a conditional child that follows the seam in and out), and a workspace without spec documents never matches anything.

## What triggers an interruption

- Only files landed by a successful first-party `write`/`edit` count; the paths come from those tools' `file_path` argument, resolved against the calling session's working directory.
- Only `symbol` and `content-hash` anchors participate. A `churn` anchor compares commit time against the document — an uncommitted edit cannot flip it, so churn health belongs to the `/devflow spec` census, and churn anchors never appear in the sentinel's message.
- Only a `stale` verdict arms the sentinel. `unevaluable` means a check can no longer run, which is a census concern, not evidence that this turn's writes broke a claim.
- A `list()`/`evaluate()` failure warns and settles the turn; the awareness layer never fails or wedges a turn.

## The pre-step spec index

Before each model step, the `devflow-spec-map` runtime context lists the documents relevant to what the session has touched — index lines only (id, freshness, and for anchor hits the touched files; never a body), pointing at `devflow_read_spec`. Two layers:

- **Anchor-hit layer** (sharp, writes only): documents whose anchors claim files the session's writes landed. Stale documents come first with their failing anchor ids named — a document whose interruption was deferred stays visible here exactly because it stays stale.
- **Scope layer** (broad, reads included): the other documents of every package the session has touched at all, resolved through the workspace layout below. Reading a file is the early "about to work here" signal.

The touch window is session-cumulative with a fixed recency bound per set; the rendered index is capped at `contextMaxBytes`, dropping scope lines from the end before anchor-hit lines and always announcing the drop. The harness diffs the snapshot per step, so an unchanged index is never re-sent.

## The `devflowSpecWorkspace` service

The plugin publishes an optional read-only service mapping a workspace root to its member packages — the scope-id prefixes their documents live under. Discovery runs a detector chain, one detector per package-manager convention, each reading only text manifests at the root and never executing build code; the layout is the **union** of the non-null answers, deduplicated by (directory, scope id) — the shape a Maven-and-Gradle dual build or a Python-beside-JS repository needs. Discovery is root-driven, never a crawl: a stray nested project no root manifest points at is deliberately not discovered, because promoting every vendored or scenario package to a scope would misreport coverage in the opposite direction. Only when **no** detector answers does the root `package.json` name stand in as a single package — an answered-but-empty manifest is reported as exactly that, not papered over. Resolution failure warns and yields an empty layout, never an error. Consumers read it with `ctx.get('devflowSpecWorkspace')`; `/devflow spec`'s census calls `discover()` to derive scope coverage and name the detectors that answered, falling back to `layout()` against providers predating that face.

| Detector | Reads | Members |
|---|---|---|
| `pnpm-workspace` | `pnpm-workspace.yaml` `packages` globs | matched directories carrying a named `package.json` |
| `npm/yarn/bun workspaces` | `package.json` `workspaces` (array or `{ packages }`) | matched directories carrying a named `package.json` |
| `cargo` | `Cargo.toml` `[workspace].members` + root `[package].name` | member crates by their own `[package].name`; the root when it is a package itself |
| `go` | `go.work` `use` directives, else root `go.mod` | modules named by the module path's tail, major-version suffix (`/v2`) stripped |
| `uv-workspace` | `pyproject.toml` `[tool.uv.workspace]` | member pyprojects by `[project].name`; a virtual root is no member |
| `maven` | `pom.xml` `<modules>`, `<parent>` and the other foreign-coordinate blocks skipped | module poms by artifactId, directory name standing in; else the root artifactId as a single package |
| `gradle-settings` | `settings.gradle(.kts)` literal `include` lines + `rootProject.name` | `:a:b` project paths as `a/b` directories, the root name prefixing scope ids; else the root name alone |
| `pyproject` | `pyproject.toml` `[project].name`, else `[tool.poetry].name` | the root as a single package; yields whole to `uv-workspace` when `[tool.uv.workspace]` is present in the same file |
| `composer` | `composer.json` `name` | the root as a single package, named by the `vendor/package` name's package half |
| `ruby` | root `*.gemspec` or `Gemfile` presence (a gemspec is code and is never read) | the root as a single package named after its directory |
| `dotnet` | `*.sln` `Project` lines (`.csproj` entries only), else root `*.csproj` | project directories under their solution-declared names; else one package per root project file |
| `mix` | root `mix.exs` + `apps/*/mix.exs` presence (a mix file is code and is never read) | umbrella app directories by name; else the root by directory name |

Globs everywhere share one narrow surface: explicit relative paths and one-level `dir/*`, with `!` negation where the manifest defines it. Everything outside a detector's stated surface is warned about and skipped, never guessed at, and a manifest-declared name outside the scope-id syntax degrades to its directory name with a warning — no invented escaping scheme.

`scripts/survey-workspace-discovery.ts` at the repository root drives this same resolver from the command line (`tsx scripts/survey-workspace-discovery.ts [--pretty] <root>...`), printing each root's detectors and packages as JSON — the manual regression tool for detector changes against real repositories; it ships with the repository, not with this package, and no CI runs it.

## Composition notes

- **Beside `devflow-iron-rules`:** when both plugins steer on the same stop, the agent loop merges the messages into a single continuation step, delivered in listener order — nothing is lost or overwritten.
- **Inside `agent/turn-stopping`, this plugin only ever steers or does nothing.** At the pinned harness version, `inject()` during that window feeds the same next-step list as `steer()` and would also hold the turn open; the non-interrupting channel for a deferred document is the pre-step spec index.
- The spec index additionally requires the `systemPrompt` registry; without it, collection and the sentinel still run.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `root` | `.devflow/spec` | Spec root for callers whose session derives no root of its own; a relative path resolves against the process cwd. |
| `contextMaxBytes` | `2048` | Byte ceiling of the rendered spec index; over it, scope lines are dropped from the end first and the drop is announced. |

The spec root of an agent with a session working directory is always `<cwd>/.devflow/spec`, the same derivation every other devflow root uses.
