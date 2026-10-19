English | [中文](README.zh.md)

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="dsh-agent-teams turns one DeepSeek Harness session into a coordinated multi-agent team">
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@byclaw/dsh-agent-teams.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-202724" alt="DeepSeek Harness plugin">
</p>

## One prompt. A working team.

`dsh-agent-teams` turns the current DeepSeek Harness session into a captain that can assemble durable sub-agents, split a goal into dependency-aware tasks, and coordinate work through direct messages.

Ask in natural language. The plugin provides the team protocol, 17 coordination tools, persistent state, an automatic shared-task scheduler, and a live Web UI—without requiring a separate workflow engine.

<p align="center">
  <img src="./assets/ui.png" width="100%" alt="DeepSeek Harness conversation with the AgentTeams live activity panel, members, tasks, dependencies, and reports">
</p>

## Why AgentTeams?

| Capability | What it changes |
| --- | --- |
| **Captain-led delegation** | The current session creates the team, assigns roles, and consolidates the final result. |
| **Durable members** | Members are continuable DSH sub-agents that can be woken for focused follow-up turns. |
| **Dependency-aware tasks** | Tasks move through explicit states and cannot be claimed before their dependencies finish. |
| **Automatic reuse and safe takeover** | Idle members claim the next ready task; reassignment revokes stale attempts before new work starts, and cold recovery retries stranded open attempts. |
| **Direct messaging** | Members send durable mailbox messages directly to teammates or the captain—no relay required. |
| **Live activity panel** | The Web UI combines segmented progress, a collapsible roster, and an interactive task DAG; completed archives retain their full member and task history. |

## Install

> [!NOTE]
> Requires an existing [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installation.

### Build from this workspace

`@byclaw/dsh-agent-teams` is a private DeepSeek Harness workspace package. It is not published to the npm registry and is installed from this checkout.

```sh
cd /path/to/deepseek-harness
pnpm install
pnpm --filter @byclaw/dsh-agent-teams run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/agent-teams
```

Run the filtered build again after changing the plugin source. The local plugin install remains linked to this checkout.

Validate the composed profile, restart DSH, and refresh the Web UI:

```sh
dsh --profile web --dump-config
dsh web
```

Then ask for a team directly:

> Use AgentTeams to review the commits after v0.5.3 from performance, security, and product perspectives. Return one consolidated report.

## How it works

1. The current session creates a team and becomes its captain.
2. The captain adds role-specific members backed by continuable sub-agents.
3. The goal becomes tasks with owners and explicit dependencies.
4. The shared scheduler uses real `running / idle / ready` state to atomically claim one ready task per idle member and wake it. If an idle/ready member still owns an open task after an interrupted turn or process restart, the scheduler retries it with a fresh attempt.
5. Members update with the current `attempt_id`; reassignment or captain takeover revokes the old attempt and waits for the old worker to quiesce before a new attempt starts.
6. The captain presents the combined result, then archives the complete team record.

Team state is stored under `$DSH_HOME/runtime/byclaw-agent-teams/<workspace-and-namespace-digest>/` (`DSH_HOME` defaults to `~/.dsh`). The workspace and `stateDir` identify the same durable team namespace across restarts; Web snapshots, cancellation, recovery and member selection use that one resolver. On first access, a dedicated legacy `<workspace>/<stateDir>/` bookkeeping directory is moved to the private runtime location; existing tasks, inboxes, transcripts and team IDs are preserved. Business files stay in the workspace. Conflicting old/new records are rejected for explicit reconciliation.

Member creation is zero-interaction by default: the plugin snapshots the LLM provider, model, and reasoning effort actually used by the captain's current step, and restores that snapshot on later continuations. Only an explicit heterogeneous-team request (for example, “backend on provider A/model X, frontend on provider B/model Y”) supplies a member-specific `provider` + `model`; there is no per-member model or reasoning prompt.

## Configuration

Defaults work without extra setup. The plugin does not limit team size. A trusted profile can override member behavior:

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams
    memberProvider: spawn
    memberModel: deepseek-v4
    memberMaxDepth: 1
    controlledWorkflow: true
    maxTaskAttempts: 3
    catalogDir: /absolute/path/to/agent-teams-catalog
```

`memberProvider` is the sub-agent runtime backend (`spawn` / `fork`), not an LLM provider. Cross-LLM-provider routing uses the optional `provider` + `model` fields of `agent_teams_add_member`; `memberModel` is only a model default for all members.

With `controlledWorkflow: true`, the captain must supply every task's description, dependencies (including `[]`), assignee, acceptance criteria, and required tools before calling `agent_teams_start` exactly once. `catalogDir` stores machine-global reusable expert rosters and runtime pointers; keep it outside an untrusted workspace. `maxTaskAttempts` bounds automatic retries.

## Catalog and Claude Code members

`agent_teams_save_template` saves the active roster to `catalogDir`; `agent_teams_list_templates` reads reusable rosters, while global instance tools expose running-team metadata without granting ownership. When the optional ByClaw generation coordinator is installed, template listing and template-backed `agent_teams_create` use shared admission, and template saving uses exclusive admission. The coordinator remains fail-closed during integration unload, so refresh cannot replace roster or Skill files during an admitted operation and cannot overwrite an unrelated concurrent save.

An `agent_teams_add_member` request can set `runtime: claude-code` for a locally installed Claude CLI. That member receives a self-contained prompt rather than Harness tools, persists its Claude session below the team's inbox using sanitized path segments, and resumes on later tasks. The child process receives only executable/runtime variables and configured Claude authentication inputs, never the full host environment.

## Boundaries

- One captain leads one active team at a time.
- Idle members are automatically reused for ready work; messages that cannot be delivered live remain durable and are retried at a later status boundary.
- State is file-backed and serialized within one DSH process; concurrent processes editing the same team are not coordinated.
- The activity panel reports persisted state as-is. Models may occasionally finish work without performing the expected task-state update.

See [docs/usage.md](./docs/usage.md) for the full tool reference, state model, Web UI behavior, configuration, and known limits.

## Plugin development Skill

The repository also ships the open Agent Skills package [`dsh-plugin-development`](./skills/dsh-plugin-development/SKILL.md):

```sh
npx skills add NanmiCoder/dsh-agent-teams --skill dsh-plugin-development
```

## Documentation

| Guide | Covers |
| --- | --- |
| [Usage](./docs/usage.md) | Architecture, UI behavior, tools, configuration, limits, and validation |
| [Verification](./docs/verification-guide.md) | Offline, composition, real e2e, and GUI verification |
| [Plugin development](./docs/developing-dsh-plugins.md) | Human-readable guide built from this plugin |
| [README writing](./docs/readme-writing-guide.md) | Repository documentation conventions |

## Development

```sh
pnpm install
pnpm build
pnpm verify
```

## License

[MIT](./LICENSE)
