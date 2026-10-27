# ByClaw workspace policy

`@byclaw/dsh-workspace` (`byclawWorkspace`) owns optional workspace-change statistics in the ByClaw Harness profile. It adapts the public `@deepseek-ai/dsh-workspace-changes@0.2.1-rc.2` plugin without changing DSH source, process results, global Session events or other plugins' capabilities.

## Environment

| Variable | Default | Set to `1` to enable |
| --- | --- | --- |
| `BYCLAW_DSH_WORKSPACE_CHANGES_ENABLED` | `0` | Workspace-change statistics and changed-file comparisons |
| `BYCLAW_DSH_WORKSPACE_GIT_ENABLED` | `0` | Automatic Git repository discovery and Git snapshots for those statistics |

Only the exact value `1` enables a flag. Restart the user context after changing its environment. Setting the Git flag alone does not enable statistics. Real tools can still execute Git with either flag off.

- Both off: no recorder, automatic Git lookup or snapshots. The workspaceChanges API returns no summary/diff.
- Statistics on, Git off: captures around file-tool writes/edits produce comparisons. Changes made only through Shell/PTC or external commands are not covered.
- Both on: Git discovery and the baseline snapshot wait until the first permitted tool dispatch. Pure chat, denied tools and pre-cancelled calls do not prepare Git or start the tool environment through this recorder. An actual tool can still start its normal execution environment.

The baseline starts **before the first tool**, rather than at `turn/start`. Manual edits before that point are excluded. Later snapshots, file captures, limits, diff rendering, disposal and failure reporting remain owned by the upstream recorder. The adapter is pinned to the inspected DSH release and refuses another recorder version when statistics are enabled.

The patch disables the eager `workspace-changes` row and installs this adapter once. Do not independently mount another stock recorder in the same context. Upstream preparation observers run only within this adapter's child context; the normal subprocess service and permission pipeline remain unchanged. The adapter waits for its baseline, then delegates final cancellation normalization and post-execute processing to ToolRuntime before any tool body can run. Snapshot failures retain upstream behavior: abandon the affected statistics record and warn, rather than claim a successful comparison.

## Build and verification

In a DSH 0.2.1-rc.2 pnpm workspace, run `pnpm test`, `pnpm typecheck` and `pnpm build` in this package. Tests use real temporary file mutations and Git repositories, and cover default-off flags, delayed discovery, file-only captures, pre-tool Git baselines, rejected/cancelled tools, repeated tools and separate Sessions.

`Dockerfile`, `Dockerfile.slim` and `Dockerfile.extensions` discover this bundle with the normal plugin inventory. They pack the pinned upstream recorder as well as this plugin, verify the compiled entry/patch exist in the packed plugin directory, and default both environment variables to `0`. Static layout checks and local package tests do not establish that an image builds or starts; deployment and 2C4G performance comparison must be verified separately.
