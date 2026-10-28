# ByClaw workspace policy

`@byclaw/dsh-workspace` (`byclawWorkspace`) owns automatic workspace discovery and optional workspace-change statistics in the ByClaw Harness profile. It adapts the public `@deepseek-ai/dsh-workspace-changes@0.2.1-rc.2` plugin without changing DSH source, process results, global Session events or other plugins' capabilities.

## Environment

| Variable | Default | Set to `1` to enable |
| --- | --- | --- |
| `BYCLAW_DSH_WORKSPACE_DISCOVERY_ENABLED` | `0` | Automatic project instructions, filesystem skill discovery, tmux context, iron-rule and Devflow context reads |
| `BYCLAW_DSH_WORKSPACE_CHANGES_ENABLED` | `0` | Workspace-change statistics and changed-file comparisons |
| `BYCLAW_DSH_WORKSPACE_GIT_ENABLED` | `0` | Automatic Git repository discovery and Git snapshots for those statistics |

Only the exact value `1` enables a flag. Restart the user context after changing its environment. Setting the Git flag alone does not enable statistics. Real tools can still execute Git with either flag off.

- Both off: no recorder, automatic Git lookup or snapshots. The workspaceChanges API returns no summary/diff.
- Statistics on, Git off: captures around file-tool writes/edits produce comparisons. Changes made only through Shell/PTC or external commands are not covered.
- Both on: Git discovery and the baseline snapshot wait until the first permitted tool dispatch. Pure chat, denied tools and pre-cancelled calls do not prepare Git or start the tool environment through this recorder. An actual tool can still start its normal execution environment.

The baseline starts **before the first tool**, rather than at `turn/start`. Manual edits before that point are excluded. Later snapshots, file captures, limits, diff rendering, disposal and failure reporting remain owned by the upstream recorder. The adapter is pinned to the inspected DSH release and refuses another recorder version when statistics are enabled.

The patch disables the eager `workspace-changes` row and installs this adapter once. Do not independently mount another stock recorder in the same context. Upstream preparation observers run only within this adapter's child context; the normal subprocess service and permission pipeline remain unchanged. The adapter waits for its baseline, then delegates final cancellation normalization and post-execute processing to ToolRuntime before any tool body can run. Snapshot failures retain upstream behavior: abandon the affected statistics record and warn, rather than claim a successful comparison.

## Automatic discovery

The discovery flag is independent of the statistics/Git flags. With discovery off, pure chat does not read `.git`, project instruction files, filesystem skill roots, iron-rule directories or Devflow board/spec/layout context merely to prepare a model step. The ByClaw web profile already disables host-level DSH instructions and filesystem skills; this plugin also filters those providers and tmux context from standard/PTC/Cordis/minimal presets and later dynamic employee capability registrations, including nested groups.

Preset declarations wait for `byclawWorkspacePresets` before activation. The policy wraps only the current user's public preset registry registration method and restores it on disposal; it does not replace global filesystem methods or the Agent loop. Custom deployment preset declarations must also inject `byclawWorkspacePresets` if they can activate during profile boot. Restart the user context when changing policy: already mounted preset revisions retain their original composition.

Owned iron-rule and Devflow plugins consult the optional `byclawWorkspacePolicy` service before their automatic reads. Without that service they retain their standalone behavior. Their explicit tools, checks after actual file mutations, and downstream admission decisions remain active. Disabling automatic discovery means project `AGENTS.md` and repository rule bodies are not automatically added to model context; opt in for repository-aware coding sessions that need them.

The skill registry, `skill` tool, ByClaw Redis/resource catalogs, bundled business skills and employee on-demand resources stay available. Shell, file reads/writes, Git commands and their existing permission checks still run when explicitly requested. Such tool calls may start the tool environment normally.

## Build and verification

In a DSH 0.2.1-rc.2 pnpm workspace, run `pnpm test`, `pnpm typecheck` and `pnpm build` in this package. Tests use real temporary file mutations and Git repositories, and cover default-off flags, delayed discovery, file-only captures, pre-tool Git baselines, rejected/cancelled tools, repeated tools and separate Sessions.

`Dockerfile`, `Dockerfile.slim` and `Dockerfile.extensions` discover this bundle with the normal plugin inventory. They pack the pinned upstream recorder as well as this plugin, verify the compiled entry/patch exist in the packed plugin directory, and default all three environment variables to `0`. Static layout checks and local package tests do not establish that an image builds or starts; deployment and 2C4G performance comparison must be verified separately.
