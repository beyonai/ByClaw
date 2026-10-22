# ByClaw DSH plugins

English | [中文](README.zh.md)

This repository maintains the ByClaw plugin suite for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). The plugins integrate through DSH services, events, tools, prompts, and bundle layers without modifying DSH core source.

## Plugin index

| Plugin | Package | Responsibility | Documentation |
| --- | --- | --- | --- |
| AgentTeams | `@byclaw/dsh-agent-teams` | Creates durable multi-agent teams with task DAGs, scheduling, messaging, archives, and a Web activity panel | [中文](./plugins/agent-teams/README.zh.md) · [English](./plugins/agent-teams/README.md) |
| Todo Execution | `@byclaw/dsh-todo-execution` | 原生 todo 顺序校验、当前步骤上下文与结束检查 | [说明](./plugins/dsh-todo-execution/README.md) |
| ByClaw Integration | `@byclaw/dsh-integration` | Synchronizes ByClaw digital employees, expert groups, Skills, and models; registers the `BYCLAW_DSH` Worker; maps DSH session events; and injects session context without rewriting user messages | [中文](./plugins/byclaw-integration/README.zh.md) · [English](./plugins/byclaw-integration/README.md) |
| Group Task Publication | `@byclaw/dsh-group-task-publication` | Optionally prepares confirmation cards for eligible group-task sessions | [中文](./plugins/group-task-publication/README.zh.md) · [English](./plugins/group-task-publication/README.md) |
| Better Sidebar | `@byclaw/dsh-better-sidebar` | Provides the workspace sidebar, editor, terminal, Git, browser, and sidebar extension service | [中文](./plugins/dsh-better-sidebar/README.md) · [English](./plugins/dsh-better-sidebar/README_EN.md) |
| Diff Viewer | `@byclaw/dsh-diff-viewer` | Replaces write/edit diff cards with a scalable unified or split visual diff | [README](./plugins/dsh-diff-viewer/README.md) |
| CodeGraph | `@byclaw/dsh-codegraph` | Composes the CodeGraph MCP server and registers CodeGraph usage policy for root and delegated Agents | [中文](./plugins/dsh-codegraph/README.zh.md) · [English](./plugins/dsh-codegraph/README.md) |
| LAN Web | `@byclaw/dsh-lan-web` | Enables the explicit `dsh web --host 0.0.0.0` LAN bind; ByClaw integration can optionally disable Web token authentication | [中文](./plugins/dsh-lan-web/README.zh.md) · [English](./plugins/dsh-lan-web/README.md) |
| Iron Rules | `@byclaw/dsh-iron-rules` | Carries a repository's development rules into the model context and runs each rule's check script when a turn that touched files stops | [中文](./plugins/iron-rules/README.zh.md) · [English](./plugins/iron-rules/README.md) |
| Environment Forwarding | `@byclaw/dsh-bash-provider` | Forwards every host environment variable, including credential-shaped names, to model-facing Bash commands; also routes eligible commands through rtk (Rust Token Killer) to compress tool output and save tokens | [中文](./plugins/dsh-bash-provider/README.zh.md) · [English](./plugins/dsh-bash-provider/README.md) |
| Browser Use | `@byclaw/dsh-browser-use` | Exposes one stateful `browser` tool with one owner per session and optional fully isolated per-session Chromium/noVNC desktops | [中文](./plugins/dsh-browser-use/README.zh.md) · [English](./plugins/dsh-browser-use/README.md) |
| Devflow | `@zhchxiao123/dsh-devflow-bundle` | Adds file-backed development cards, transition gates, subagent drivers, model tools, commands, a read-only Web channel, and a board UI | [README](./plugins/dsh-devflow-plugins/README.md) · [中文](./plugins/dsh-devflow-plugins/docs/devflow.zh.md) |

The ByClaw packages are private DSH workspace packages and are not published to the npm registry. Their `workspace:` dependencies resolve inside a DSH source workspace, so place the plugin directories below `<deepseek-harness>/plugins/` before installing and building them. Devflow is a vendored standalone plugin workspace whose packages are also published to npm. Better Sidebar, Diff Viewer, and Devflow retain their upstream licenses and import provenance; ByClaw owns the maintained package identities and profile composition of its own packages. Environment Forwarding additionally absorbed the formerly-standalone `dsh-bash-rtk` plugin's rtk command-compression code (originally `DeepTrial/dsh-bash-rtk`, MIT) into its own source.

## Architecture and load order

```text
DSH profile
├── @byclaw/dsh-agent-teams
│   ├── agent_teams_* 工具与系统提示词策略
│   ├── 持久团队、成员、任务 DAG、邮箱和调度器
│   └── 可选 Web 活动面板
├── @byclaw/dsh-integration
│   ├── Redis / ByClaw BE 资源与模型同步
│   ├── 数字员工与专家团模板、作用域 Skill
│   ├── BYCLAW_DSH Worker、原样业务消息和会话映射
│   ├── plugin:byclaw-context 会话与工作区注入
│   └── 专家团团长通过 AgentTeams 调度团员
├── @byclaw/dsh-better-sidebar
├── @byclaw/dsh-diff-viewer
├── @byclaw/dsh-codegraph
│   ├── codegraph-mcp：MCP 进程与工具注册
│   └── codegraph:usage-policy：根与委派 Agent 继承的系统提示词
├── @byclaw/dsh-lan-web
│   └── 替换 Web startup provider，保留 DSH 原生安全链
├── @byclaw/dsh-bash-provider
│   ├── 替换 sandboxed Bash provider，显式透传宿主环境
│   ├── 叠加把符合条件的 Bash 命令路由给 rtk 压缩输出（合并自原 dsh-bash-rtk 插件）
│   └── 拒绝 Agent 绕过 browser 工具直接启动 Playwright/Chromium/CDP
├── @byclaw/dsh-browser-use
│   ├── 当前 DSH Agent 直接驱动唯一 browser 工具，不启动第二个规划模型
│   ├── 每个 session 单一 Agent owner；novnc 模式提供独立 Chromium/X/VNC 桌面
│   └── 私有 browserd、租约队列、按 sessionId 路由与产物生命周期
└── @zhchxiao123/dsh-devflow-bundle
    ├── file-backed development cards, gates, and subagent drivers
    ├── model tools and the /devflow intervention command
    └── read-only Web projection and board UI
```

Install AgentTeams before ByClaw Integration because expert groups depend on it. Install the optional Group Task Publication plugin after Integration; its installation and configuration are documented in its README. The remaining packages compose independently. ByClaw Integration owns only the durable ByAI session namespace and workspace context; CodeGraph owns its runtime-capability prompt.

ByClaw Integration keeps each ByAI business instruction as an unchanged `source: user` message. It records the external `session_id` and `cwd` as durable session data, then adds a separate `plugin:byclaw-context` message on each Agent's first admitted step so root and delegated Agents receive the same workspace declaration with correct provenance.

ByClaw inbound messages can target an authorized digital employee or expert group directly with `extra_payload.agent_id`, `agent_code`, or `agent_name`; the live smoke helper exposes the same fields as `--agent-id`, `--agent-code`, and `--agent-name`. When structured metadata is absent, one unambiguous `@resource-name` or `@resource-code` mention in the message body is also accepted and removed before delivery. Invalid, unauthorized, conflicting, or ambiguous targets fail before a child session is created; messages without a target continue through the main Agent route.

## Prerequisites

- A DSH source workspace and an available `dsh` CLI
- Node.js `^22.19.0 || >=24`, pnpm, and a completed `pnpm install` in the DSH workspace
- ByClaw Integration: reachable ByClaw BE and Redis services

## Installation

### 1. Copy the plugins into the DSH workspace

```sh
git clone https://github.com/korvo873/byclaw-dsh.git /path/to/byclaw-dsh
cp -R /path/to/byclaw-dsh/plugins/agent-teams /path/to/deepseek-harness/plugins/
cp -R /path/to/byclaw-dsh/plugins/dsh-todo-execution /path/to/deepseek-harness/plugins/
cp -R /path/to/byclaw-dsh/plugins/byclaw-integration /path/to/deepseek-harness/plugins/
cp -R /path/to/byclaw-dsh/plugins/dsh-better-sidebar /path/to/deepseek-harness/plugins/
cp -R /path/to/byclaw-dsh/plugins/dsh-diff-viewer /path/to/deepseek-harness/plugins/
cp -R /path/to/byclaw-dsh/plugins/dsh-codegraph /path/to/deepseek-harness/plugins/
cp -R /path/to/byclaw-dsh/plugins/dsh-lan-web /path/to/deepseek-harness/plugins/
cp -R /path/to/byclaw-dsh/plugins/dsh-bash-provider /path/to/deepseek-harness/plugins/
cp -R /path/to/byclaw-dsh/plugins/dsh-browser-use /path/to/deepseek-harness/plugins/
cp -R /path/to/byclaw-dsh/plugins/dsh-devflow-plugins /path/to/deepseek-harness/plugins/
```

If a destination already exists, preserve its local changes and merge updates with a Git diff. Do not overwrite a plugin directory that contains uncommitted work.

### 2. Install dependencies and build

```sh
cd /path/to/deepseek-harness
pnpm install
pnpm --filter @byclaw/dsh-agent-teams run build
pnpm --filter @byclaw/dsh-todo-execution run build
pnpm --filter @byclaw/dsh-integration run build
pnpm --filter @byclaw/dsh-better-sidebar run build
pnpm --filter @byclaw/dsh-diff-viewer run build
pnpm --filter @byclaw/dsh-codegraph run build
pnpm --filter @byclaw/dsh-lan-web run build
pnpm --filter @byclaw/dsh-bash-provider run build
pnpm --dir plugins/dsh-browser-use run build
pnpm --dir plugins/dsh-devflow-plugins run build
```

Rebuild the affected package after changing plugin source.

### 3. Add the packages to a DSH profile

The example uses the `web` profile. Replace it with `headless` for a deployment without the Web UI:

```sh
dsh plugin --profile web add /path/to/deepseek-harness/plugins/agent-teams
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-todo-execution
dsh plugin --profile web add /path/to/deepseek-harness/plugins/byclaw-integration
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-better-sidebar
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-diff-viewer
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-codegraph
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-lan-web
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-bash-provider
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-browser-use
for manifest in /path/to/deepseek-harness/plugins/dsh-devflow-plugins/packages/*/package.json; do
  dsh plugin --profile web add "$(dirname "$manifest")"
done
dsh --profile web --dump-config
```

`dsh plugin add` links or installs each package into the profile and uses its `dsh.bundle.patch` declaration to append the plugin layer to `dsh.profile.bundles`.

The Devflow source checkout is a nested workspace. A local `link:` to its bundle does not expand the bundle's `workspace:` dependencies into the profile, so all nineteen packages must be linked as shown above. Installing the published `@zhchxiao123/dsh-devflow-bundle` package from npm does not need those extra path arguments because its published dependency graph is complete.

This vendored snapshot also carries a small ByClaw compatibility bridge: Devflow keeps its official DSH right-Sidebar registration and additionally registers the same board with `dsh-better-sidebar` when that optional service is present.

## Environment variables

Copy the example and fill in deployment values:

```sh
cp /path/to/byclaw-dsh/.env.example /path/to/deepseek-harness/.env
```

The DSH launcher reads `.env` from its launch working directory. An already exported process value takes precedence over that file and `$DSH_HOME/.env`. Never commit the completed `.env`.

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `USER_CODE` | Required when Integration is enabled | ByClaw login authorization; explicit plugin `userCode` may supply it instead |
| `REDIS_HOST`, `REDIS_PORT` | Integration with standalone Redis | Redis endpoint; defaults to `localhost:6379` |
| `REDIS_USERNAME`, `REDIS_PASSWORD` | Deployment-dependent | Redis credentials |
| `REDIS_DATABASE` | Optional | Standalone Redis database; defaults to `0` |
| `REDIS_MODE`, `REDIS_CLUSTER_NODES` | Redis Cluster | Cluster mode and a comma-separated `host:port` seed list |
| `REDIS_KEY_SCHEMA_VERSION` | Must be `v2` for Cluster | Selects the Redis key format with hash tags |
| `BYCLAW_REDIS_MODEL_ENABLED` | Optional | Enables Redis dynamic models by default; `false` requires both plugin `provider` and `model` |
| `BYCLAW_DSH_WEB_AUTH_TOKEN` | Optional | Fixed public DSH Web launch token translated to the internal random token |
| `BYCLAW_DSH_WEB_AUTH_ENABLED` | Optional | Defaults to true; `false` disables Web UI, HTTP API, and WebSocket token/cookie authentication while retaining Host/Origin checks |
| `BYCLAW_DSH_BUSY_ENTER` | Optional; Bash provider bundle | Busy Enter default: `queue` (default) or `steer`; saved UI preferences take precedence; restart DSH after changing |
| `BYCLAW_BROWSER_VIEWER` | Optional; Docker Browser Use | `shared-novnc` (Docker default) keeps one persistent Chromium/VNC desktop; `none` is headless shared mode; `novnc` retains legacy per-session desktops |
| `BYCLAW_BROWSER_IDLE_MS` | Optional; Docker Browser Use | Chromium warm-idle window after the last Context closes in `none` mode; `shared-novnc` remains alive for the browserd process lifetime |
| `BYCLAW_BYCLI_ENABLED` | Optional; Docker Browser Use | Defaults to `true`; waits for extension connectivity on first browser use and monitors/repairs the bridge at runtime |
| `BYCLAW_BROWSER_STARTUP` | Optional; Docker Browser Use | Images default to `on-demand`; first use starts Chromium and byCLI. `eager` restores startup gating |
| `BYCLAW_DSH_CLI_ENTRY` | Optional; container entrypoint | Defaults to compiled `apps/cli/lib/bin.js`; `apps/cli/src/bin.ts` is available for source-path regression comparisons |
| `BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX` | Required for Redis dynamic-model mode | Decrypts ByClaw model authorization and remains process-only |
| `BYCLAW_LLM_IDLE_TIME` | Optional | Dynamic-model idle timeout in seconds; defaults to `600` |

## Profile configuration

Each package's `cordis.patch.yml` inserts its plugin row. A machine-level or profile-level `cordis.patch.yml` can replace the complete `config` for the same `id`; every retained setting must be restated in that replacement.

This example configures the session/team plugins. The capability and Web plugins use their bundle defaults:

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams
    memberProvider: spawn
    memberMaxDepth: 2
    controlledWorkflow: true
    maxTaskAttempts: 3

- id: byclaw-dsh
  config:
    enabled: true
    userCode: !!js process.env.USER_CODE
    baseUrl: 'http://123.56.153.229:8080'
    stateDir: .agent-teams
    maxConcurrency: 8
    subagentProvider: spawn
    agentPreset: standard

- id: codegraph-mcp
  config:
    serverName: codegraph
    transport: stdio
    command: codegraph
    args: [serve, --mcp]
    cwd: !!js process.cwd()
    env:
      CODEGRAPH_MCP_TOOLS: explore
    toolCallTimeoutMs: 60000
    failOnStartupError: true
```

The expert-group path delegates twice—main agent to leader to member—so `agent-teams.memberMaxDepth` must be at least `2`. When `BYCLAW_REDIS_MODEL_ENABLED=false`, `byclaw-dsh.config` must also provide a local `provider` and `model`.

Each plugin README owns the detailed field semantics, failure conditions, and limitations:

- [AgentTeams configuration and architecture](./plugins/agent-teams/README.zh.md#配置)
- [ByClaw Integration configuration and architecture](./plugins/byclaw-integration/README.zh.md#配置)
- [Browser Use tool, isolation, Docker, and noVNC](./plugins/dsh-browser-use/README.md)

## Verification and startup

AgentTeams, ByClaw Integration, Better Sidebar, and Iron Rules are verified against DSH `0.1.3-alpha.2` (`c389f96`) and its current session, subagent, and prompt APIs; peer dependencies declare the required API versions. Compatibility changes stay in the plugins and do not modify DSH source. When testing a source checkout, resolve plugin dependencies and launch DSH from that same checkout.

The current-runtime end-to-end check launches the official headless profile twice with an isolated `DSH_HOME` and a deterministic local model adapter. It checks FIFO prompts, live output, template configuration, session persistence, and cold resume without Redis or API keys. Build the plugins first, then run:

```sh
DSH_ROOT=/path/to/deepseek-harness node plugins/byclaw-integration/scripts/current-dsh-e2e.mjs
```

```sh
cd /path/to/deepseek-harness
pnpm --filter @byclaw/dsh-agent-teams run verify
pnpm --filter @byclaw/dsh-integration run verify
pnpm --filter @byclaw/dsh-better-sidebar run build
pnpm --filter @byclaw/dsh-diff-viewer run check
pnpm --filter @byclaw/dsh-codegraph run verify
pnpm --filter @byclaw/dsh-codegraph run verify:runtime
pnpm --filter @byclaw/dsh-lan-web run verify
pnpm --filter @byclaw/dsh-bash-provider run verify
pnpm --dir plugins/dsh-browser-use run verify
pnpm --dir plugins/dsh-devflow-plugins run verify
pnpm --dir plugins/dsh-devflow-plugins run build
dsh --profile web --dump-config
dsh web --host 0.0.0.0 --no-open
```

`--dump-config` must show `agent-teams`, `byclaw-dsh`, `better-sidebar`, `dsh-diff-viewer`, `codegraph-mcp`, `dsh-codegraph`, `byclaw-lan-web-startup`, `byclaw-bash-provider`, `byclaw-browser-use`, and the Devflow rows from `devflow` through `devflow-ui`. Browser Use exposes exactly one stateful tool named `browser`; private leases and capabilities never enter model context. Integration subscribes to Redis and completes one blocking resource synchronization before its Worker starts.

Browser Use includes real Chromium E2E coverage plus per-session desktop-manager and noVNC routing tests. In `novnc` mode every active session owns a distinct Chromium/X display/VNC target, while port 8081 routes by optional `sessionId` and defaults to the newest live session when omitted. The development host has no Docker CLI, so full image and live Linux VNC verification must run in Docker/CI. Because `Dockerfile.base` contains Xvfb/x11vnc/noVNC packages, rebuild the base image before the business image.

The CodeGraph runtime check requires the version declared by `plugins/dsh-codegraph/package.json`; the Docker build runs it automatically against the binary inherited from `Dockerfile.base`.

The business `Dockerfile` installs the pinned `searxng-cli` search runtime for
`knowledge-collection` in an isolated Python environment. Its launcher supplies
the bundled engine settings by default; `SEARXNG_CLI_SETTINGS` can override them.
No search API key or separately hosted SearXNG server is required for this CLI
provider. The build checks Python dependencies and runs `--list-engines` as
`byclaw`; installation or initialization failures fail the image build. This
smoke check does not guarantee upstream search-engine connectivity. Rebuild and
deploy the business image to persist this dependency in new sandboxes; copying
skill files alone does not install it. After deployment, run a real public search
and full-text collection to verify network access and the collection pipeline.

## Local state and security

- AgentTeams stores team state in `.agent-teams/` below the session workspace by default.
- Integration stores templates and Skill caches below DSH-home-derived directories by default, and reads authorized resources through Redis and ByClaw BE.
- Browser Use keeps downloads only for the page/lease lifetime. Consume returned paths before turn end; normal downloads have no plugin-level size, count, or completion-time cap.
- The Bash direct-browser deny policy is defense in depth, not a hard same-container sandbox. Use a separate `browserd` sidecar when untrusted arbitrary code requires an OS-level boundary.
- `.env`, Redis passwords, model decryption keys, generated `lib/`, `node_modules/`, and runtime state do not belong in source control.

## Development

All maintained plugins participate in verification from the DSH root workspace. Run the smallest command covering the affected package after each change. Documentation and package behavior must stay aligned with package metadata, injected-service lists, and bundle patches.

### Startup and lazy Skills

DSH and plugins compile during image build; runtime executes the compiled CLI. Browser, desktop and byCLI bridge activation is deferred until the first private browser request or managed byCLI browser command. That request waits for activation; later calls reuse the browser.

Before Worker readiness, Integration synchronizes authorized employees, teams, models and Skill associations. Business Skill version checks, downloads and parsing happen when the current employee queries registry list/snapshot/get, including tools and prompt catalog assembly. Each lookup checks versions; missing, incomplete or changed caches are atomically replaced. Unchanged versions reuse disk content and concurrent requests coalesce. Authorization and associations are rechecked after loading; stale generations cannot republish results.

Builtin Skills remain local. Scoped group employees are prepared when invoked. `allowSkillSyncFailure` controls skipping a failed Skill versus rejecting the lookup; later calls may retry. First Skill use carries network latency, and Worker readiness does not mean every Skill is warm.

Builds default to `NPM_REGISTRY=https://registry.npmmirror.com`. WeCom/Lark CLIs use an independent `connector-tools` cache stage. Lark binary downloads try npmmirror before GitHub and retain upstream SHA-256 verification; plugin edits do not invalidate this stage.

[Startup benchmark, validation and limits](docs/startup-2026-10-22/report.md)

`SEARXNG_WHEELHOUSE` is an optional build argument, not an `.env` requirement. Ordinary builds need no extra argument or mount and retain the original Tsinghua/PyPI online installation. Offline installation is enabled only when a wheel directory is explicitly supplied and mounted; missing packages fail rather than changing pinned versions. The argument is not persisted as a runtime ENV, and the image does not depend on the build host wheel directory at startup.
