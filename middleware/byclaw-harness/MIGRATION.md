# ByClaw plugin migrations

## AgentTeams

`plugins/agent-teams` imports the live working tree from `dsh-agent-teams-control-plane` at branch `codex/agent-teams-control-plane`, commit `6b6cfdb0065c1b641fe4a9a43f9f459c258583d4`.

The import includes that checkout's tracked and untracked implementation changes, excluding `.git/`, `.github/`, `node_modules/`, `lib/`, `.agent-teams/`, `integrations/`, `pnpm-lock.yaml`, and `docs/superpowers/`.

The plugin package is renamed to `@byclaw/dsh-agent-teams`; its DeepSeek Harness service dependencies retain their `@deepseek-ai` names.

## ByClaw integration

`plugins/byclaw-integration` imports the live working tree from `dsh-agent-teams-control-plane/integrations/byclaw-dsh` at the same source snapshot: branch `codex/agent-teams-control-plane`, commit `6b6cfdb0065c1b641fe4a9a43f9f459c258583d4`.

The import excludes `node_modules/`, `lib/`, and `pnpm-lock.yaml`.

The plugin package depends on the workspace `@byclaw/dsh-agent-teams`; its DeepSeek Harness development dependencies use matching workspace packages.
