# devflow for DeepSeek Harness

English | [中文](README.md)

File-based development state for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): work is a **card**, a card's history is an append-only journal, and every stage move commits at that journal. Eleven runtime plugins over one capability seam (`ctx.devflow`), plus one declarative install bundle; the Harness agent is the workflow executor.

This repository is the standalone plugin line. It depends only on harness packages published to npm — nothing here patches the harness.

## The packages

| Package | Role |
|---|---|
| `@zhchxiao123/dsh-devflow` | Service Definition of the `ctx.devflow` seam: card vocabulary, journal decode/replay |
| `@zhchxiao123/dsh-devflow-filesystem` | Service Provider: `.devflow/` on disk, `O_EXCL` leases, month-bucket archiving |
| `@zhchxiao123/dsh-devflow-gates` | Gate policy on the transition waterfall: per-edge commands plus one-shot human approvals |
| `@zhchxiao123/dsh-devflow-parent-gate` | Completion policy: a decomposed requirement reaches `done` only after every sub-requirement does |
| `@zhchxiao123/dsh-devflow-fs-guard` | Denies the agent's file tools any write under `.devflow/`, keeping the store the only write path |
| `@zhchxiao123/dsh-devflow-artifact-gate` | Mechanical artifact contract over configured transition edges |
| `@zhchxiao123/dsh-devflow-agent-gate` | Independent LLM admission checks over registered artifacts |
| `@zhchxiao123/dsh-devflow-tool` | The model-facing tools (`devflow_list`, `devflow_create`, `devflow_transition`, …) |
| `@zhchxiao123/dsh-devflow-guidance` | Model guidance: the `devflow-workflow` bundled skill carrying cross-tool process judgment (loaded on demand), plus the `devflow-board` board-snapshot runtime context |
| `@zhchxiao123/dsh-devflow-command` | The deterministic `/devflow` intervention plane |
| `@zhchxiao123/dsh-devflow-web` | devflow's own browser channel: a read-only JSON route plus a change stream |
| `@zhchxiao123/dsh-devflow-ui` | The board, browser half: registered directly in the official Harness right Sidebar |

Three planes move a card and they are separate on purpose: the model uses the tools, a human intervenes through `/devflow`, and approvals ride the harness's approval plane. The web board is **read-only** — the route projects two reads and no write verb has an endpoint at all.

## Scheduling and GitHub content synchronization

Two optional capabilities can run independently or compose:

| Package | Role |
|---|---|
| `@zhchxiao123/dsh-scheduler` | Service Definition for plans, handlers, and delivery state |
| `@zhchxiao123/dsh-scheduler-local` | Fixed intervals and Cron, local persistence, recovery, and `/scheduler` management |
| `@zhchxiao123/dsh-github-sync` | Service Definition for content, versions, changes, and consumer cursors |
| `@zhchxiao123/dsh-github-sync-local` | Issue, comment, and Discussion synchronization, persistence, and `/github-sync` management |

While the host runs, scanning requires no live conversation. GitHub sync can run manually on its own; when a scheduler is also loaded, the `github.sync` handler accepts a subscription ID and returns a durably accepted run ID. The scheduler distinguishes delivery from downstream outcomes, and downstream plugins consume changes with independent cursors. Synchronization does not evaluate issues, create development tasks, or write to GitHub.


Automation belongs to a Harness project. Native right-Sidebar pages sit alongside each other: Automation manages plans and deliveries; GitHub Subscriptions manages subscriptions, content and synchronization runs. `scheduler-tool` and `github-sync-tool` resolve the project from the actual session and share services with the pages. Unassigned legacy records require explicit claiming.

See the [scheduler guide](packages/scheduler-local/README.md) and [GitHub sync guide](packages/github-sync-local/README.md). These plugins use Node.js 24 SQLite on local filesystems; multi-instance coordination is limited to processes sharing the same supported local database. They are not enabled by the Devflow bundle.

## Harness version

Every Harness and Cordis dependency is pinned to the latest adapted baseline: `0.1.5-rc.2` for `@deepseek-ai/*` and `4.0.2` for Cordis. The board client follows the split `dsh-client-store`, `dsh-client-ui-renderer`, and `dsh-api-session-controller` boundaries. The last local tarball boot regression ran at `0.1.3-alpha.2`. Dependencies remain explicit instead of floating across pre-1.0 compatibility boundaries.

## Install into a harness

```sh
dsh plugin --profile web add @zhchxiao123/dsh-devflow-bundle
```

That is the whole install: `dsh plugin add` forwards to pnpm and then reconciles the profile's bundle stack against what got installed, so the bundle mounts every devflow row by itself — no profile file to edit. The board comes with it. See [`devflow-bundle`](packages/devflow-bundle/README.md) for what mounts, what ships disabled, and how to override a row.

The latest Harness Web includes the official right Sidebar. Devflow appears directly on its start page and tab strip; no third-party sidebar is required, and the plugin no longer creates a floating control over the conversation.

The optional [Midscene Web acceptance package](packages/devflow-midscene/README.md) is installed separately. It provides a skill, CLI and reports through existing artifact and completion gates; the default bundle does not include it.

## What it looks like in practice

These are real regression-session screenshots from this repository running in DSH Web, not interface mockups.

### Workspace board

![The seven-stage devflow Kanban showing independent work, blocked cards, and a parent swimlane](docs/screenshots/devflow-kanban-board.png)

A wide sidebar shows all seven ordered stages at once: draft, design, ready, developing, review, testing, and done. Independent work sits at the top, while a parent with children becomes a collapsible swimlane and each child appears only in its real stage. A blocked card remains in its source-stage column with an explicit marker instead of creating an eighth column. The board is still read-only; transitions come from the Harness agent's `devflow_*` tools or human commands.

### Card detail

Open any card to inspect its current stage, revision, complete stage rail, requirement body, acceptance criteria, decomposition, and registered artifacts.

![A completed card showing its current stage, revision, stage rail, requirement, and deliverables](docs/screenshots/devflow-card-detail.png)

### Stage artifacts and transition timeline

![The card detail view showing five artifact kinds, stage transitions, gate results, and transition reasons](docs/screenshots/devflow-card-timeline.png)

The detail view collects the requirements document, design document, development report, review report, and test report. The same timeline records artifact registrations, stage changes, revisions, timestamps, dwell times, transition reasons, and gate results, making the card's complete path from draft to done directly auditable.

## Plugin marketplace information

**Value:** Give the Harness agent a durable, inspectable development workflow with file-backed cards, revision-safe transitions, optional artifact and admission checks, human intervention, and a read-only web board.

| Item | Support |
|---|---|
| Install package | `@zhchxiao123/dsh-devflow-bundle` |
| Profile | `web` for the complete bundle; server-side packages may be composed separately |
| Harness compatibility | Pinned to `@deepseek-ai/*` `0.1.5-rc.2`; Cordis `4.0.2`; last local boot regression at `0.1.3-alpha.2` |
| Full Kanban page | Integrates directly with the official Harness `0.1.5-rc.2` right Sidebar; no extra sidebar dependency |
| Node.js | `^22.19` or `>=24` |
| Local data | Reads and writes `.devflow/` under each caller's workspace; no project source files are modified by the store |
| Network and models | No telemetry or bundled third-party service; the optional agent check uses the model provider already configured in Harness |
| Commands | The optional command check runs only commands explicitly configured by the profile owner |
| Defaults | Artifact, agent, command, and approval checks are mounted but disabled until the profile defines their policy |

The install entry is a `dsh.bundle` manifest whose patch mounts the runtime packages. Function plugins export `apply(ctx)` according to the Harness loader contract; service packages export their service class.

With an artifact contract enabled, the model sees requirements before attempting a transition. The [real Loader composition test](packages/devflow-tool/tests/loader-composition.spec.ts) asserts output in this form:

```text
Created card 0001-artifact-flow [draft] Artifact flow (rev 1).
artifact requirements for draft -> designing:
[missing] requirements-document

Card 0001-artifact-flow moved draft -> designing (rev 4).
artifact requirements for designing -> ready:
[missing] design-document
```

## Getting started (development)

```sh
git clone https://github.com/zhchxiao123/dsh-devflow-plugins.git
cd dsh-devflow-plugins
pnpm run init
```

`init` installs against the recorded lockfile, then typechecks, lints, and tests — a clean checkout either reproduces or tells you the harness moved. After that:

```sh
pnpm run verify        # typecheck + lint + test, the pre-push gate
pnpm run test:coverage # per-file 100% on packages/*/src
pnpm run build         # emit lib/types
```

Workspace packages resolve to each other through `tsconfig.base.json` `paths` (the source plane) in tests and typecheck; consumers resolve them through `exports` to built `lib/`.

## Where the work is described

This repository carries its own development record, moved with the code:

| Path | What lives there |
|---|---|
| `.agents/prd/` | six PRDs — what each change set was for and what was ruled out |
| `.scratch/devflow/` | 22 issues sliced from those PRDs, each with its resolution |
| `.agents/notes/implemented/` | Agent Notes — the decisions, the alternatives, and why |
| `.agents/skills/` | how to work here: prose standard, code review, note hygiene |
| `docs/devflow.md` | the subsystem walkthrough |
| `AGENTS.md` | the conventions this line holds itself to |

Start from `AGENTS.md`; it opens with the one rule that shapes the rest — **this line depends only on published harness surface.**

## Releasing

Twelve packages publish together at one version. See [RELEASING.md](RELEASING.md); the short form is `pnpm run set-version <v> && pnpm run release`, which refuses to publish unless typecheck, lint, tests, the build, and a tarball preflight all pass.

## Testing

Tests cover every package, including the board's — `tests/loader-factory.ts` runs the harness's published client bundles through a module table so the browser-half specs use the real `SlotRegistry` rather than a double. Per-file 100% coverage on `packages/*/src` is the gate, and the install path itself is verified against a real harness boot.
