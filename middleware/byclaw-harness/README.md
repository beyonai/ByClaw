# ByClaw DSH plugins

English | [中文](README.zh.md)

This repository maintains the ByClaw plugin suite for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). The plugins use DSH's public services, events, tools, prompts and bundle APIs. Version-pinned image-build patches for DSH compatibility and startup are documented below.

## Framework optimization in Docker

Both `Dockerfile` and `Dockerfile.extensions` include the repository-owned `@byclaw/by-framework@1.7.0-byclaw.1` artifact. Builds verify its SHA-256 and override older dependencies in both the builder workspace and the final profile. No npm publication or developer checkout is needed. The runner consumes messages independently of task completion, retains shutdown draining and checks consumer health. Both stages probe 64 waiting tasks followed by Resume; this validates scheduling, not Redis Cluster or model throughput.

Build from the repository root. See the [framework package guide](vendor/by-framework/README.md) for build commands, in-image verification and source provenance.

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
| Tool environment | `@byclaw/dsh-tool-env` | Opt-in: runs DSH's files, processes, terminals, PTC and sandbox in a separate tool sandbox over SSH; the sandbox comes from OpenSandbox directly or from ByClaw BE's sandbox API (`BYCLAW_DSH_TOOL_ENV`) | [中文](./plugins/dsh-tool-env/README.zh.md) · [English](./plugins/dsh-tool-env/README.md) |
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
├── @byclaw/dsh-tool-env
│   └── 可选：fs/subprocess/sandbox/PTC 改走 SSH 到独立工具沙箱（OpenSandbox 租约、空闲暂停、恢复）
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

## Shared DSH host

`scripts/byclaw-multi-host.mjs` serves many users from one process (one DSH
context per user, admin API and `/u/{user}/` web gateway on port 7300; BE's
`byclaw.sandbox.shared-dsh-host.*` settings point at it). The image carries the
launcher; start it through the entrypoint's `multi-host` mode, which runs it as
the DSH user (`byclaw`) whether the container starts as root or not:

```sh
docker run -d --name byclaw-multi-host --env-file host.env \
  -v /data/byclaw-multi-host:/data/multi-host byclaw/dsh:<tag> multi-host
```

The launcher's header comment lists its environment variables. Running the
image's default `web` entrypoint as a non-root user fails with "root entrypoint
required for private browser runtime"; that mode is for per-user sandboxes.

## Verification and startup

The plugins target DSH `0.2.1-rc.2`, the release `Dockerfile.base` pins (`DSH_REF`); their peer dependencies pin that release. The business images (`Dockerfile`, `Dockerfile.slim`, `Dockerfile.extensions`) therefore need a base built from this `Dockerfile.base`, passed as `--build-arg BASE_IMAGE=`; an older base (DSH 0.1.x, tag `2026.9.8`) fails early in the plugin-builder stage because the 0.2.1 workspace packages (for example `@deepseek-ai/dsh-agent-preset-registry`) are missing. The 0.1.5 module-path source patch (`scripts/prepare-dsh-local-modules.mjs`) is not applied: DSH 0.2.1 canonicalizes module directories itself. The new `prepare-dsh-startup-021.mjs` patch indexes immutable resolver path prefixes in the disposable build workspace; it rejects other DSH versions/source shapes. All three business images rebuild app-boot and copy its source and compiled output together. Model-routing compatibility is likewise applied only in that build workspace. When testing a source checkout, resolve plugin dependencies and launch DSH from that same checkout.

DSH 0.2.1 startup optimizations (2026-10-23) apply to **all three image variants**, including slim:

- Integration builds a tree-shaken pi-ai auth helper artifact (about 4.85 KB). `createProvider` uses pi-ai's public `/models` entry; startup no longer imports the aggregate entry's unused Typebox graph. Keep `pnpm build` intact: `tsc` alone does not produce the optimized helper.
- Devflow loads the TypeScript compiler on the first TS/JS code-anchor evaluation. Its synchronous symbol/hash API and anchor semantics remain unchanged. Model HTTP transport loads on the first model request; media HTTP transport loads on the first actual download. Connection/header deadlines, body cancellation and DNS pinning stay intact.
- DSH OTel, product telemetry and the Langfuse plugin ship bundled SDK implementations. Shared `@opentelemetry/api`, `api-logs` and Cordis remain external; all dynamic platform-detector chunks travel with the entry. A loopback collector verifies JSON/gzip logs and protobuf traces from the actual compiled artifacts during image build.
- Document conversion loads LibreOffice/font/codec dependencies on first conversion, with one shared import promise and retry on import failure. Plugin management loads `execa` only when an operation runs; child-process handles, output streaming, cancellation and repair remain intact. `prepare-dsh-lazy-021.mjs` version/source guards these build-only changes; all three images rebuild and copy source plus compiled output.
- The DSH resolver replaces repeated scans of large immutable package-root arrays with a per-generation prefix index. Native resolution precedence, package exports, profile replacement and Worker resolution remain covered by upstream tests.
- Existing compiled CLI/preload, lazy Skill version checks and **`by-framework@1.7.0-byclaw.1`** remain enabled. The framework archive/checksum and `unbounded` dispatch implementation are unchanged; the consumer verifier still exercises 64 waiting tasks, Resume admission, draining and health.
- The plugin-builder runs `startup-imports-verify.mjs` after building all bundles, rejecting eager Typebox/compiler loading and checking that TS anchors still work on demand. This gate is present in `Dockerfile`, `Dockerfile.slim` and `Dockerfile.extensions`.

Local verification used Node **22.19.0** on macOS, a disposable DSH **0.2.1-rc.2** workspace with the same complete business profile and optimized framework across all variants. Five interleaved fresh-process runs per variant used empty user patches, isolated homes, blocked business networking, and stopped immediately at integration `activate` (before business synchronization/Worker registration):

| Local startup measurement | Original | Prior optimization | Final |
| --- | ---: | ---: | ---: |
| Process launch → integration activation, median | 1.772 s | 1.021 s | 1.057 s |
| Five samples, seconds | 1.658 / 1.714 / 1.772 / 1.778 / 1.927 | 0.961 / 1.006 / 1.064 / 1.021 / 1.061 | 0.903 / 0.985 / 1.091 / 1.057 / 1.107 |
| Module load-hook calls before activation | 2,970 | 1,556 | **1,380** |

The final implementation reduces local median startup by **40.3%** and load-hook calls by **53.5%** against the original in this matched run. The five-run comparison did not establish a latency gain for the last lazy-loading pass alone, so a further **10 interleaved runs per variant** compared prior vs final: **1.020 s → 0.956 s median (6.2% reduction)**. These warm-cache macOS timings remain sensitive to other desktop work.

Earlier results were 2,981 → 2,100 → 1,567 calls. After pnpm refreshed the disposable workspace dependency layout, both the original and prior variants measured 11 fewer calls. The matched table above therefore uses 2,970 / 1,556 / 1,380; **176 calls** are removed by the final document/plugin-manager change itself. Both variants retain the same optimized framework.

These numbers are not ACS/NAS cold-start times and do not establish a new Worker-ready latency. The previously observed ACS CLI→activation interval was 19.558 s; its original logs cannot retrospectively assign all of that time to individual imports. Rebuild the selected image variant and remeasure a fresh ACS container using its image digest and the CLI/activate/worker-ready markers. No full Podman image build or ACS deployment was performed in this iteration.

Targeted validation: 5,045 upstream resolver tests, 36 Devflow anchor tests, 12 compiled Langfuse tests, 29 media-runtime tests, 90 Office conversion tests, 106 plugin-manager operation/process/GitHub/registry tests, real loopback telemetry export, compiled model runtime/routing/transport checks, lazy Skill checks, Worker concurrency/framework checks, and all three Dockerfile wiring checks. No production sandbox deployment is performed by these checks. Run the import regression after the full plugin build:

```sh
node plugins/byclaw-integration/scripts/startup-imports-verify.mjs
node scripts/verify-startup-bundles.mjs /workspace
```

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

DSH 0.2 rejects wildcard listeners, so `@byclaw/dsh-lan-web` binds `--host 0.0.0.0` to the first non-internal IPv4 address and does not serve 127.0.0.1. The image entrypoint mirrors that Web port on 127.0.0.1 (`scripts/dsh-loopback-forward.mjs`) so in-container clients, such as the OpenSandbox execd `/proxy/<port>` route, still reach DSH.

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

Generated dependency caches (`profiles/node_modules` and the web profile's `.dsh-module-fallback`) stay with the image and are repaired on local container storage. NAS holds links to the current image. Canonical module paths avoid repeated NAS traversal while retaining integrity checks, missing-link repair and user package precedence. The web `cordis.patch.yml`, sessions, credentials and business resources retain their existing persistence paths. No new `.env` setting is required; an unsupported DSH release or source layout fails the build explicitly.

Resource projection validates the previous catalog and copies only retained user templates and unknown files. ByClaw templates are regenerated from current authorization, avoiding a full copy followed by deletion. The existing generation lock, rollback, revocation cleanup and Skill version checks remain. A separate `session-metadata-ready` log distinguishes metadata recovery from builtin Skill loading.

Builtin Skills remain local. Scoped group employees are prepared when invoked. `allowSkillSyncFailure` controls skipping a failed Skill versus rejecting the lookup; later calls may retry. First Skill use carries network latency, and Worker readiness does not mean every Skill is warm.

Builds default to `NPM_REGISTRY=https://registry.npmmirror.com`. WeCom/Lark CLIs use an independent `connector-tools` cache stage. Lark binary downloads try npmmirror before GitHub and retain upstream SHA-256 verification; plugin edits do not invalidate this stage.

The Web module graph reuses unchanged JS/source-map artifacts; adding a plugin no longer decodes every previous bundle again. Bundle or map changes invalidate the cache. The pinned client-modules package is rebuilt inside the image builder, with no new runtime compilation step.

[Previous local comparison: CLI → integration 6.30 → 4.36 seconds](docs/startup-2026-10-22/client-composition-report.md) · [Earlier startup validation](docs/startup-2026-10-22/report.md)

This startup pass defers persistent browser-profile creation/locking until first use, resolves image-owned packages and Typert manifests on canonical local paths, and reuses serialized client source-map sections. No new `.env` setting is required. The supervisor still owns private credential descriptors, first-use activation and shutdown. Authorization synchronization and Skill version checks remain required. [Measurements, regression checks and ACS limitations](docs/startup-2026-10-22/startup-extreme-report.md).

`SEARXNG_WHEELHOUSE` is an optional build argument, not an `.env` requirement. Ordinary builds need no extra argument or mount and retain the original Tsinghua/PyPI online installation. Offline installation is enabled only when a wheel directory is explicitly supplied and mounted; missing packages fail rather than changing pinned versions. The argument is not persisted as a runtime ENV, and the image does not depend on the build host wheel directory at startup.
