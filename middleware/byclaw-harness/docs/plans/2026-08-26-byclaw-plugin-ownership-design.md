# ByClaw DSH plugin ownership design

## Goal

Maintain the Trellis workflow, better sidebar, diff viewer, and CodeGraph integration as ByClaw-owned DSH plugins while keeping session transport concerns separate from runtime capabilities.

## Package ownership

The repository owns four capability packages under `plugins/`:

- `@byclaw/dsh-trellis`
- `@byclaw/dsh-better-sidebar`
- `@byclaw/dsh-diff-viewer`
- `@byclaw/dsh-codegraph`

The first three packages start from the currently deployed upstream revisions. Their licenses and upstream repository metadata remain available in each package. Package names use the `@byclaw` scope so a profile cannot accidentally resolve an upstream package with the same unscoped identity.

## CodeGraph responsibility

`@byclaw/dsh-codegraph` owns both halves of the capability:

1. Its bundle patch mounts `@deepseek-ai/dsh-mcp-client` with the stable `codegraph` server namespace.
2. Its Cordis plugin discovers the CodeGraph tools visible to each Agent and contributes the matching system-prompt policy.

The MCP process command and startup behavior are profile-configurable. The default command is `codegraph` with `serve --mcp`; no developer-specific executable or project directory is embedded in the package. The policy tells the Agent to pass its authoritative session cwd as `projectPath`, so one MCP process can serve multiple project workspaces without relying on its process cwd.

If no CodeGraph tools are visible in the Agent scope, the policy contributes no model-visible text. The policy describes only tools that are actually registered.

## ByClaw integration responsibility

`@byclaw/dsh-integration` continues to persist the external ByAI `session_id` and authoritative cwd, inject a separately sourced `plugin:byclaw-context` workspace message, and make descendants inherit that workspace. It does not advertise Trellis, CodeGraph, or any other runtime capability.

The `<byclaw-runtime-capabilities>` message and the `byclaw:codegraph-policy` section are removed. Capability plugins discover and register their own runtime instructions.

## Profile migration

The Web profile replaces the external Trellis, sidebar, and diff-viewer bundles with local ByClaw package links. It removes the hand-written `mcp-codegraph` patch row and installs `@byclaw/dsh-codegraph`, whose bundle owns the MCP row and policy plugin row.

## Verification

Verification covers package builds, focused behavior tests, profile composition, CodeGraph MCP tool discovery, ByAI inbound session/cwd inheritance, Trellis context, and UI bundle activation. The final end-to-end run uses an ordinary architecture request without explicitly instructing the Agent to invoke Trellis or CodeGraph.
