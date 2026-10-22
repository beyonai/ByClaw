# ByClaw DSH 插件

[English](README.md) | 中文

这个仓库维护 ByClaw 面向 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的插件套件。插件通过 DSH 服务、事件、工具、系统提示词和 bundle 层接入，不修改 DSH 核心源码。

## 插件目录

| 插件 | 包名 | 作用 | 详细文档 |
| --- | --- | --- | --- |
| AgentTeams | `@byclaw/dsh-agent-teams` | 创建持久化多 Agent 团队，提供任务 DAG、调度、消息、归档和 Web 活动面板 | [中文](./plugins/agent-teams/README.zh.md) · [English](./plugins/agent-teams/README.md) |
| Todo Execution | `@byclaw/dsh-todo-execution` | 原生 todo 顺序校验、当前步骤上下文与结束检查 | [说明](./plugins/dsh-todo-execution/README.md) |
| ByClaw Integration | `@byclaw/dsh-integration` | 同步 ByClaw 数字员工、专家团、Skill 和模型，注册 `BYCLAW_DSH` Worker，映射 DSH 会话事件，并在不改写用户消息的前提下注入会话上下文 | [中文](./plugins/byclaw-integration/README.zh.md) · [English](./plugins/byclaw-integration/README.md) |
| Group Task Publication | `@byclaw/dsh-group-task-publication` | 为符合条件的群任务会话提供待发布确认卡片，可选安装 | [中文](./plugins/group-task-publication/README.zh.md) · [English](./plugins/group-task-publication/README.md) |
| Better Sidebar | `@byclaw/dsh-better-sidebar` | 提供工作区侧边栏、编辑器、终端、Git、浏览器及侧边栏扩展服务 | [中文](./plugins/dsh-better-sidebar/README.md) · [English](./plugins/dsh-better-sidebar/README_EN.md) |
| Diff Viewer | `@byclaw/dsh-diff-viewer` | 为 write/edit 工具提供可扩展的单栏或双栏可视化 diff | [README](./plugins/dsh-diff-viewer/README.md) |
| CodeGraph | `@byclaw/dsh-codegraph` | 装配 CodeGraph MCP，并向根 Agent 与委派 Agent 注册使用策略 | [中文](./plugins/dsh-codegraph/README.zh.md) · [English](./plugins/dsh-codegraph/README.md) |
| LAN Web | `@byclaw/dsh-lan-web` | 启用显式的 `dsh web --host 0.0.0.0` LAN 监听；ByClaw integration 可选关闭 Web token 鉴权 | [中文](./plugins/dsh-lan-web/README.zh.md) · [English](./plugins/dsh-lan-web/README.md) |
| Iron Rules | `@byclaw/dsh-iron-rules` | 把仓库携带的开发铁律送进模型上下文，并在产生代码改动的 turn 结束时运行各铁律的校验脚本 | [中文](./plugins/iron-rules/README.zh.md) · [English](./plugins/iron-rules/README.md) |
| 环境变量透传 | `@byclaw/dsh-bash-provider` | 把宿主全部环境变量（包括凭据命名变量）透传给模型侧 Bash 命令；同时把符合条件的命令路由给 rtk（Rust Token Killer）压缩工具输出、节省 token | [中文](./plugins/dsh-bash-provider/README.zh.md) · [English](./plugins/dsh-bash-provider/README.md) |
| Browser Use | `@byclaw/dsh-browser-use` | 提供一个有状态的 `browser` 工具；每个 session 单一 owner，并可启用完全独立的 Chromium/noVNC 桌面 | [中文](./plugins/dsh-browser-use/README.zh.md) · [English](./plugins/dsh-browser-use/README.md) |
| Devflow | `@zhchxiao123/dsh-devflow-bundle` | 提供文件化开发卡片、流转门禁、子 Agent 驱动、模型工具、命令、只读 Web 通道和看板 UI | [README](./plugins/dsh-devflow-plugins/README.md) · [中文](./plugins/dsh-devflow-plugins/docs/devflow.zh.md) |

ByClaw 包都是 DSH 私有工作区包，不发布到 npm registry。它们的 `workspace:` 依赖需要在 DSH 源码工作区中解析，因此应把插件目录放进 `<deepseek-harness>/plugins/` 后安装和构建。Devflow 是导入的独立插件工作区，其包同时发布到 npm。Better Sidebar、Diff Viewer 与 Devflow 保留上游许可证及导入来源；ByClaw 只负责维护自有包的身份和 profile 组合。环境变量透传插件还吸收了原独立插件 `dsh-bash-rtk` 的 rtk 命令压缩代码（原始出处 `DeepTrial/dsh-bash-rtk`，MIT 许可）到自己的源码里。

## 架构与加载关系

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
    ├── 文件化开发卡片、流转门禁与子 Agent 驱动
    ├── 模型工具与 /devflow 人工干预命令
    └── 只读 Web 投影与看板 UI
```

AgentTeams 应先于 ByClaw Integration 安装，因为专家团依赖它；其余插件可独立组合。ByClaw Integration 只负责持久化 ByAI 会话命名空间和工作区上下文；CodeGraph 负责自身的运行能力提示。

ByClaw Integration 把每条 ByAI 业务指令保持为未经改写的 `source: user` 消息。插件将外部 `session_id` 和 `cwd` 记录为持久会话数据，再在每个 Agent 的第一次获准步骤中追加独立的 `plugin:byclaw-context` 消息，使根 Agent 与委派 Agent 都能以正确来源获得同一工作区声明。

ByClaw 入站消息可以通过 `extra_payload.agent_id`、`agent_code` 或 `agent_name` 直接指定当前授权的数字员工或专家团；live smoke 脚本对应提供 `--agent-id`、`--agent-code` 和 `--agent-name`。没有结构化目标时，正文中的唯一且无歧义的 `@资源名称` 或 `@资源编码` 也可作为目标，匹配文本会在投递前移除。目标不存在、未授权、字段冲突或正文歧义时，会在创建子会话前失败；未指定目标的消息继续走主 Agent 原有路径。

## 前置条件

- DSH 源码工作区和可用的 `dsh` CLI
- Node.js `^22.19.0 || >=24`、pnpm，以及完成过 `pnpm install` 的 DSH 工作区
- ByClaw Integration：可访问的 ByClaw BE 和 Redis

可选的 Group Task Publication 插件在 Integration 之后安装，安装命令和配置见[插件文档](./plugins/group-task-publication/README.zh.md)。

## 安装

### 1. 把插件复制到 DSH 工作区

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

目标目录已存在时先保留自己的改动，再按 Git diff 合并更新；不要直接覆盖一个有未提交修改的插件目录。

### 2. 安装依赖并构建

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

修改插件源码后需要重新运行对应包的构建命令。

### 3. 加入 DSH profile

下面以 `web` profile 为例；无 Web UI 的部署可替换为 `headless`：

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

`dsh plugin add` 会把包链接或安装进 profile，并根据各包的 `dsh.bundle.patch` 把插件层加入 `dsh.profile.bundles`。

Devflow 源码 checkout 是一个嵌套 workspace。只用本地 `link:` 链接 bundle 时，bundle 的 `workspace:` 依赖不会展开到 profile，因此必须像上面一样链接全部十九个包。若从 npm 安装已发布的 `@zhchxiao123/dsh-devflow-bundle`，其发布依赖图是完整的，不需要额外传入这些本地路径。

这份 vendored 快照还带有一个很小的 ByClaw 兼容桥：Devflow 保留 DSH 官方右侧栏注册；当可选的 `dsh-better-sidebar` 服务存在时，同一个看板也会注册到实际显示的侧栏中。

## 环境变量

复制仓库中的示例并填写部署值：

```sh
cp /path/to/byclaw-dsh/.env.example /path/to/deepseek-harness/.env
```

DSH 启动器读取启动工作目录下的 `.env`；已导出的进程变量优先于该文件和 `$DSH_HOME/.env`。不要提交填写后的 `.env`。

| 变量 | 是否必需 | 用途 |
| --- | --- | --- |
| `USER_CODE` | 启用 Integration 时必需 | ByClaw 登录授权；也可在插件 `userCode` 中显式配置 |
| `REDIS_HOST`、`REDIS_PORT` | Integration 单机 Redis | Redis 地址，默认 `localhost:6379` |
| `REDIS_USERNAME`、`REDIS_PASSWORD` | 按 Redis 部署 | Redis 凭据 |
| `REDIS_DATABASE` | 可选 | 单机 Redis database，默认 `0` |
| `REDIS_MODE`、`REDIS_CLUSTER_NODES` | Redis Cluster | Cluster 模式和逗号分隔的 `host:port` 列表 |
| `REDIS_KEY_SCHEMA_VERSION` | Cluster 必须为 `v2` | 选择带 hash tag 的 Redis key 格式 |
| `BYCLAW_REDIS_MODEL_ENABLED` | 可选 | 默认开启 Redis 动态模型；设为 `false` 时必须在插件中同时配置 `provider` 和 `model` |
| `BYCLAW_DSH_WEB_AUTH_TOKEN` | 可选 | 对外固定的 DSH Web 启动 token，由适配器翻译为内部随机 token |
| `BYCLAW_DSH_WEB_AUTH_ENABLED` | 可选 | 默认 true；设为 `false` 时关闭 Web UI、HTTP API 和 WebSocket 的 token/cookie 鉴权，但保留 Host/Origin 校验 |
| `BYCLAW_DSH_BUSY_ENTER` | 可选；需启用 Bash provider bundle | 繁忙时 Enter 默认行为：`queue`（默认，排队发送）或 `steer`（插话发送）；已保存的界面设置优先，修改后重启 DSH |
| `BYCLAW_BROWSER_VIEWER` | 可选；Docker Browser Use | Docker 默认 `shared-novnc`，常驻一个持久 Chromium/VNC 桌面；`none` 为无头共享模式；`novnc` 保留旧的每会话独立桌面 |
| `BYCLAW_BROWSER_IDLE_MS` | 可选；Docker Browser Use | `none` 模式最后一个 Context 关闭后的 Chromium 保温时间；`shared-novnc` 随 browserd 常驻 |
| `BYCLAW_BYCLI_ENABLED` | 可选；Docker Browser Use | 默认 `true`；首次使用浏览器时等待扩展连接，之后监控和自愈桥接 |
| `BYCLAW_BROWSER_STARTUP` | 可选；Docker Browser Use | 镜像默认 `on-demand`，首次调用再启动浏览器与 byCLI；`eager` 恢复启动前等待 |
| `BYCLAW_DSH_CLI_ENTRY` | 可选；容器入口 | 默认 `apps/cli/lib/bin.js`，直接运行构建产物；源码回归可设 `apps/cli/src/bin.ts` |
| `BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX` | Redis 动态模型模式必需 | 解密 ByClaw 模型鉴权；只保存在进程环境中 |
| `BYCLAW_LLM_IDLE_TIME` | 可选 | 动态模型连接空闲超时秒数，默认 `600` |

## Profile 配置

各包的 `cordis.patch.yml` 负责插入插件行。机器级或 profile 级 `cordis.patch.yml` 可以按相同 `id` 覆盖整段 `config`；覆盖时必须重述该插件需要保留的全部配置。

下面配置会话与团队插件；能力与 Web 插件使用各自 bundle 默认组合：

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

专家团链路是“主 Agent → 团长 → 团员”两级委派，因此 `agent-teams.memberMaxDepth` 必须至少为 `2`。如果 `BYCLAW_REDIS_MODEL_ENABLED=false`，还要在 `byclaw-dsh.config` 中提供本地 `provider` 和 `model`。

每个字段的语义、失败条件和限制由各插件 README 维护：

- [AgentTeams 配置与架构](./plugins/agent-teams/README.zh.md#配置)
- [ByClaw Integration 配置与架构](./plugins/byclaw-integration/README.zh.md#配置)
- [Browser Use 工具、隔离、Docker 与 noVNC](./plugins/dsh-browser-use/README.zh.md)

## 验证与启动

AgentTeams、ByClaw Integration、Better Sidebar 和 Iron Rules 已在 DSH `0.1.3-alpha.2`（`c389f96`）上验证当前会话、子代理和提示词接口；相关 peer 依赖声明了所需接口的最低版本。兼容代码全部位于插件中，不修改 DSH 源码。使用源码工作区验证时，插件的依赖与启动的 DSH 必须来自同一个检出目录。

当前运行时端到端检查会使用独立的 `DSH_HOME` 和本地确定性模型适配器，两次启动官方 headless profile，验证 FIFO 后续任务、实时输出、模板配置、会话落盘与冷恢复，无需 Redis 或 API Key。先构建插件，再执行：

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

`--dump-config` 应显示 `agent-teams`、`byclaw-dsh`、`better-sidebar`、`dsh-diff-viewer`、`codegraph-mcp`、`dsh-codegraph`、`byclaw-lan-web-startup`、`byclaw-bash-provider`、`byclaw-browser-use`，以及从 `devflow` 到 `devflow-ui` 的 Devflow 运行项。Browser Use 只向模型暴露一个有状态的 `browser` 工具，私有租约与 capability 不进入模型上下文。Integration 先完成 Redis 订阅、授权资料与 Skill 关联索引同步，再上线 Worker；业务 Skill 的版本检查和内容下载在查询时执行。

Browser Use 包含真实 Chromium E2E、每会话桌面管理器及 noVNC 路由测试。`novnc` 模式下每个活跃 session 拥有独立 Chromium/X display/VNC 目标，8081 按可选 `sessionId` 路由；省略时默认选择最近创建且仍存活的 session。开发主机没有 Docker CLI，完整镜像和 Linux VNC 联调需在 Docker/CI 执行。`Dockerfile.base` 已包含 Xvfb/x11vnc/noVNC，必须先重建基础镜像再构建业务镜像。

CodeGraph 运行态检查要求使用 `plugins/dsh-codegraph/package.json` 声明的版本；Docker 构建会自动用 `Dockerfile.base` 继承的二进制执行该检查。

## 本地状态与安全

- AgentTeams 默认把团队状态写入会话工作区的 `.agent-teams/`。
- Integration 默认把模板与 Skill 缓存写入 DSH home 派生目录，并通过 Redis/ByClaw BE 读取授权资源。
- Browser Use 下载只保留到页面/租约结束；必须在 turn 结束前消费返回路径。普通下载没有插件级大小、数量或完成时间限制。
- Bash 的直接浏览器命令拒绝策略只是纵深防御，不是同容器硬隔离；不可信任意代码需要操作系统边界时应把 `browserd` 部署为 sidecar。
- `.env`、Redis 密码、模型解密密钥、生成的 `lib/`、`node_modules/` 和运行状态不属于源码仓库。

## 开发

所有维护插件都从 DSH 根工作区执行验证。修改后运行覆盖对应包的最小命令；文档和包级行为应与包元数据、服务注入列表和 bundle patch 保持一致。

### 启动与 Skill 懒加载

镜像构建阶段编译 DSH 和全部插件，运行时直接执行编译后的 CLI。浏览器、桌面和 byCLI 桥接默认在首次私有 browser 请求或受管 byCLI 浏览器命令时激活；首次请求等待激活完成，后续复用。

Integration 在 Worker 上线前同步授权员工、专家团、模型和 Skill 关联索引。业务 Skill 的版本请求、下载及解析延迟到当前员工查询 registry list/snapshot/get 时，包括 Skill 工具和提示词目录查询。每次查询检查版本，缓存缺失、不完整或版本变化时下载并原子替换；同版本复用缓存，并发请求合并。下载后复核授权和关联关系，刷新后的旧代际结果不能重新发布。

依赖缓存（`profiles/node_modules`、web 的 `.dsh-module-fallback`）由镜像提供并在容器本地修复，NAS 上只保留指向当前镜像的链接。模块解析先转换为真实路径，避免每个依赖反复穿过 NAS；完整性检查、缺失链接修复和用户包优先级仍保留。web 的 `cordis.patch.yml`、会话、凭据和业务资源继续按原路径持久化。无需新增 `.env` 配置；基础 DSH 版本或源码结构不匹配时构建会明确失败，避免静默套用补丁。

资源投影先校验旧目录，只复制需要保留的用户模板及未知文件；ByClaw 托管模板按当前授权重新生成，避免“整目录复制后再删除”的重复 NAS IO。发布仍在原代际锁下完成，保留失败回滚、撤权清理和 Skill 版本检查。启动日志单独记录 `session-metadata-ready`，区分元数据恢复与内置 Skill 加载。

内置 Skill 仍从镜像本地加载；专家团临时作用域员工在实际调用时准备。`allowSkillSyncFailure` 决定单个 Skill 失败时跳过还是拒绝查询，之后可重试。首次 Skill 查询承担网络耗时，Worker ready 不代表所有 Skill 已预热。

构建默认使用 `NPM_REGISTRY=https://registry.npmmirror.com`。企业微信/飞书 CLI 在独立 `connector-tools` 阶段缓存；飞书二进制改为阿里镜像优先、GitHub 兜底，仍执行官方 SHA-256 校验。插件变更不会使这个下载阶段失效。

Web 插件组成图现在复用未变化的 JS/source map 产物，插件新增时不重复解码所有旧 bundle；内容或 map 更新仍使缓存失效。构建阶段编译固定版本的 client-modules，运行时不新增编译步骤。

[CLI → integration 新一轮对照：本地 6.30 → 4.36 秒，ACS 待复测](docs/startup-2026-10-22/client-composition-report.md) · [此前启动优化记录](docs/startup-2026-10-22/report.md)

`SEARXNG_WHEELHOUSE` 只是可选的构建参数，不需要写进 `.env`。正常构建无需增加参数或挂载，仍使用原来的清华/PyPI 在线安装路径。仅显式传入该参数并挂载 wheel 目录时启用离线安装；目录缺包会报错，不会偷偷切换版本。该参数不写入运行时 ENV，镜像启动不依赖构建机器上的 wheel 目录。
