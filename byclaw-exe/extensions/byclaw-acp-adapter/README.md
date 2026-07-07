# ByClaw ACP Adapter

OpenClaw plugin that reads ByClaw digital-employee metadata from Redis and turns it into reusable ACP Claude Code agent/team/workflow/loop plans.

## Runtime Contract

ByClaw BE is the management plane. It creates and maintains these Redis records:

- `DIG_EMPLOYEE_*`: digital employees from the HTML role model.
- `BYCLAW_AGENT_TEAM_*`: a reusable team, for example `rd-core`.
- `BYCLAW_WORKFLOW_*`: ordered role steps for the team.
- `BYCLAW_LOOP_*`: loop policy, iteration cap, and exit criteria.

OpenClaw still runs with a single `main` agent. The adapter turns the BE-managed
team into Claude Code native custom agents by writing:

```text
<cwd>/.claude/agents/byclaw-*.md
```

The returned `sessionsSpawn` still targets one ACP downstream session:

```json
{
  "runtime": "acp",
  "agentId": "claude",
  "streamTo": "parent"
}
```

Inside that Claude Code session, the task instructs the main Claude session to use
the generated named subagents, such as `byclaw-coder`, `byclaw-reviewer`, and
`byclaw-tester`, instead of simulating the team in a normal answer.

## Remote Claude Code Bridge

The adapter can keep the same `sessions_spawn` contract while targeting a remote
Claude Code worker. Register a custom acpx agent whose command is the bridge:

```json
{
  "plugins": {
    "entries": {
      "acpx": {
        "enabled": true,
        "config": {
          "agents": {
            "byclaw-remote-claude": {
              "command": "node /path/to/ByClaw/byclaw-exe/extensions/byclaw-acp-adapter/scripts/byclaw-remote-claude-acp.mjs"
            }
          }
        }
      },
      "byclaw-acp-adapter": {
        "enabled": true,
        "config": {
          "defaultAcpAgentId": "byclaw-remote-claude"
        }
      }
    }
  }
}
```

Flow:

```text
OpenClaw sessions_spawn(agentId=byclaw-remote-claude)
  -> acpx starts byclaw-remote-claude-acp.mjs over ACP stdio
  -> bridge sends By-Framework AskAgent to BYCLAW_CODE_${USER_CODE}
  -> remote Claude Code writes to byai_gateway:session:${byai-channel_session_id}:data_stream
  -> BE websocket broadcaster consumes that Redis session queue and streams to FE
```

The bridge returns the ACP prompt turn after the remote worker ACKs the task. It
does not consume `byai_gateway:session:*:data_stream` and does not mirror remote
output back through ACP `session/update`; the Redis session queue remains owned
by the existing BE websocket broadcast path.

Required env for the bridge:

```bash
export REDIS_DATABASE=0
export REDIS_HOST=<redis-host>
export REDIS_PORT=6379
export REDIS_USERNAME=<redis-username>
export REDIS_PASSWORD=...
export USER_CODE=<user-code>
```

Useful bridge overrides:

- `BYCLAW_REMOTE_CLAUDE_TARGET_AGENT_TYPE`: explicit remote worker agent type.
- `BYCLAW_REMOTE_CLAUDE_TARGET_AGENT_TYPE_PREFIX`: default is `BYCLAW_CODE_`.
- `BYCLAW_REMOTE_CLAUDE_FRAMEWORK_ENTRY`: path to `@byclaw/by-framework/dist/index.js` when the bridge cannot auto-discover it.
- `BYCLAW_REMOTE_CLAUDE_LANGUAGE`: language metadata sent to the remote worker, default `zh-CN`.

`byclaw-remote-claude-acp.mjs` extracts `byaiChannelSessionId` from the ACP prompt
and uses it as the remote worker session id. This keeps generated files aligned
with the Session Files rules in `metadata.md`.

Sensitive provider headers from Redis metadata are redacted before registry
responses, Claude agent files, and SQLite run ledger rows are written.

## Shared Run Directory

ACP task files are written under the OpenClaw/byai-channel shared root:

```text
${STATE_DIR}/.byclaw/acp-runs/{ACP_CLIENT_TYPE}/{byai-channel_session_id}
```

`sessionId` passed to `byclawAcpPlan` / `byclawAcpRun` must be the real
byai-channel `session_id`. Do not pass a digital-employee id, agent id, run id,
or generated id. The adapter records this value as `byaiChannelSessionId` and
uses it for the shared directory name when it is path-safe.

The adapter also writes byai-channel fixed work specs into `metadata.md`,
`clients/{client}.md`, and `plan-bundle.json`. These specs include the Session
Files rules: downstream ACP clients must resolve `/object/...`, `/view/...`,
and `/qa/...` paths against `/by/.sessions/{byai-channel_session_id}` before
reading, citing, or returning file links.

## What It Registers

- Tools: `byclawAcpPlan`, `byclawAcpRun`
- Gateway methods: `byclaw.acp.registry`, `byclaw.acp.plan`, `byclaw.acp.run`, `byclaw.acp.runs.list`, `byclaw.acp.runs.show`
- HTTP routes: `/plugins/byclaw-acp-adapter/registry`, `/plugins/byclaw-acp-adapter/plan`, `/plugins/byclaw-acp-adapter/run`
- SQLite tables:
  - `byclaw_pipeline_runs`: HTML `PipelineRun` contract.
  - `byclaw_pipeline_tasks`: HTML `PipelineTask` / Workboard card mirror.
  - `byclaw_btw_events`: HTML `BTWEvent` audit stream.
  - `byclaw_shared_artifacts`: HTML `SharedArtifact` / workspace mirror index.
  - `byclaw_task_events`: task-flow event stream.
  - `byclaw_acp_runs`, `byclaw_acp_events`: ACP execution ledger linked by `pipeline_run_id`.

## Local Test Flow

```bash
cd /Users/chenxiaofeng/code/ByClaw/byclaw-exe/extensions/byclaw-acp-adapter
PATH=/Users/chenxiaofeng/code/open/openclaw/node_modules/.bin:$PATH npm run build:fast
npm run test:unit

export REDIS_DATABASE=0
export REDIS_HOST=10.10.168.204
export REDIS_PORT=6379
export REDIS_USERNAME=default
export REDIS_PASSWORD=...
export USER_CODE=0027024710

npm run mock:redis
npm run prepare:test-config
# Optional: generate a local OpenClaw config that uses byclaw-remote-claude.
BYCLAW_ACP_USE_REMOTE_CLAUDE=1 npm run prepare:test-config
npm run smoke
```

`npm run test:unit` is offline and verifies that `sessionsSpawn.modelConfig`
and every `sessionsSpawn.agentModels.*.modelConfig` entry are passed through for
agent/team/workflow/loop plans. It also verifies the remote Claude bridge ACP
stdio lifecycle with a mock By-Framework worker.

Use the integration flow when Redis and the local OpenClaw checkout are ready:

```bash
npm run test:integration
# Optional end-to-end ACP execution through sessions_spawn:
npm run test:integration:execute-claude
```

To build and install this adapter into the local OpenClaw extension directory:

```bash
npm run pack:openclaw
```

This writes to `~/.openclaw/extensions/byclaw-acp-adapter` by default. Override
the target with `OPENCLAW_EXTENSION_TARGET=/path/to/byclaw-acp-adapter`.

## 204 BE Sync Flow

For the real 204 environment, do not use `mock:redis` as the source of digital
employees. Create or update the real BE resources first, then cache the returned
metadata for the adapter:

```bash
cd /Users/chenxiaofeng/code/ByClaw/byclaw-exe/extensions/byclaw-acp-adapter

export BYCLAW_API_BASE_URL=http://10.10.168.204:8080
export BYCLAW_API_BEYOND_TOKEN=...
export BYCLAW_API_SSO_TOKEN=...
export BYCLAW_API_SESSION_ID=...
export BYCLAW_API_COOKIE='SESSION=...; uc=0027024710; PORTAL-SESSION=...'
# Optional, only when the 204 gateway requires request signature headers:
export BYCLAW_API_EXTRA_HEADERS_JSON='{"x-signature-nonce":"...","x-signature-timestamp":"...","x-signature-value":"..."}'
export USER_CODE=0027024710
export BYCLAW_DIG_EMPLOYEE_OWNER_TYPE=enterprise
# Optional. Defaults to the wildcard toolCode returned by OPENCLAW_BUNDLED_TOOLS.
export BYCLAW_OPENCLAW_TOOL_MODE=wildcard

export REDIS_DATABASE=0
export REDIS_HOST=10.10.168.204
export REDIS_PORT=6379
export REDIS_USERNAME=default
export REDIS_PASSWORD=...

npm run sync:204-agents -- --delete-old-mock
```

The sync script calls:

- `POST /byaiService/system/staticdata/getDcSystemConfigListByStandType` as an auth/connectivity probe.
- `POST /byaiService/system/staticdata/getDcSystemConfig` with `paramCode=TEMPLATE_DIGITAL_EMPLOYEE` to load the FE digital-employee extension template.
- `POST /byaiService/system/staticdata/getDcSystemConfig` with `paramCode=OPENCLAW_BUNDLED_TOOLS` to load the FE-supported OpenClaw bundled tool codes for `relTools`.
- `POST /byaiService/digitalEmployeeController/saveDigitalEmployee` for new ByClaw roles.
- `POST /byaiService/digitalEmployeeController/updateDigitalEmployee` when a role already exists.
- `POST /byaiService/digitalEmployeeController/findDetailsById` indirectly through the save/update response.

After BE returns the real `resourceId`, the script writes:

- `DIG_EMPLOYEE_<realResourceId>`: real BE details plus ACP runtime metadata.
- `BYCLAW_AGENT_TEAM_rd-core`: real resource IDs grouped as the ByClaw team.
- `BYCLAW_WORKFLOW_feature-delivery`: workflow steps pointing to real resource IDs.
- `BYCLAW_LOOP_feature-delivery-loop`: reusable loop policy.

`--delete-old-mock` removes the legacy `DIG_EMPLOYEE_900001..900009` cache keys.
Secrets are read only from environment variables and are not written to repo
files.

The generated OpenClaw config is written to:

```text
/Users/chenxiaofeng/code/ByClaw/.tmp/openclaw-byclaw-acp-test.json
```

The test state and adapter SQLite database are under:

```text
/Users/chenxiaofeng/code/ByClaw/.tmp/openclaw-state
```

The smoke script prefers `node scripts/run-node.mjs gateway` when the local OpenClaw checkout is writable. If the checkout is read-only, it falls back to `node openclaw.mjs gateway` and verifies the adapter through HTTP routes.
