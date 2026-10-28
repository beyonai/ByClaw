# @byclaw/dsh-codegraph

[English](README.md) | 中文

这个 DSH 私有工作区插件统一维护 CodeGraph 运行能力。bundle 通过 `codegraph-mcp` 装配 `@deepseek-ai/dsh-mcp-client`，并注册根 Agent 与委派 Agent 都会继承的 CodeGraph 系统提示词。受支持的 CodeGraph 版本和 MCP 工具面在 `package.json` 的 `dsh.codegraph` 中声明；CodeGraph 1.6.0 默认只暴露 `codegraph_explore`。

## 安装

把本目录复制到 `<deepseek-harness>/plugins/dsh-codegraph`，然后执行：

```sh
cd /path/to/deepseek-harness
pnpm install
pnpm --filter @byclaw/dsh-codegraph run verify
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-codegraph
dsh --profile web --dump-config
```

最终装配树必须同时包含 `codegraph-mcp` 和 `dsh-codegraph`。默认 MCP 命令为 `codegraph serve --mcp`；如果命令不在 `PATH`，设置 `CODEGRAPH_COMMAND`，或在 profile patch 中覆盖完整的 `codegraph-mcp.config`。bundle 会显式传入 `CODEGRAPH_MCP_TOOLS=explore`，因此外部环境变量不能让注册的工具面偏离插件契约。

系统策略要求每次 CodeGraph 调用都把 Agent 当前运行上下文中的权威 cwd 作为 `projectPath`，MCP 进程 cwd 不用于选择项目。容器中可把 `CODEGRAPH_MCP_CWD` 设置为 `/` 等中立目录，避免扫描 DSH 安装目录来寻找默认项目；每次调用时通过 `projectPath` 选择真实项目的能力不受影响。MCP 进程无法启动或同步工具时插件会直接加载失败，避免出现“有提示词但没有工具”的假能力。

`Dockerfile.base` 通过 `ARG CODEGRAPH_VERSION` 声明并校验实际安装版本。扩展镜像构建期间，`verify:runtime` 会把继承到的 `codegraph --version` 与插件清单比较，完成真实 MCP 初始化，并要求 `tools/list` 与插件声明的工具面完全一致；任何不一致都会中止镜像构建。升级 CodeGraph 时，必须同时更新 Docker 参数、插件契约、系统策略和预期 MCP 工具面。

## 工具环境

DSH 的 MCP stdio 传输由 MCP SDK 在本机直接拉起服务进程，不经过 `ctx.subprocess`，因此 `codegraph-mcp` 行总是在 DSH 所在主机上运行 CodeGraph。工作区位于独立工具沙箱时，禁用该行，并在 `dsh-codegraph` 上设置 `workspaceOnToolEnvironment: true` 和私有的 `stateDir`。插件会为每个 MCP 连接通过 `ctx.subprocess` 启动 `command args`（默认 `codegraph serve --mcp`，工作目录 `cwd` 默认 `/by`），并挂载自己的 `codegraph` MCP 客户端；客户端经 `bridge/stdio-socket.mjs` 和 `stateDir` 中权限为 `0600` 的 Unix socket 连到该进程。工具名不变。服务进程的数据流会让工具沙箱在上下文存续期间保持唤醒，且工具沙箱镜像中必须安装 `codegraph`。

在工具环境上，CodeGraph 服务只在有调用时运行：插件自己保持客户端的 MCP 会话，`idleMs`（默认 120000）内没有请求就结束服务进程，使其流不再阻止工具沙箱空闲暂停；下一次调用时再启动一个并重放握手。服务对握手（`server/discover`、`initialize`、`tools/list`）的应答缓存在 `stateDir`，按服务命令和本机可执行文件区分，因此上下文注册工具时无需启动工具沙箱；服务的自我介绍与缓存不同时会刷新缓存。

## 验证

```sh
pnpm --filter @byclaw/dsh-codegraph run verify
pnpm --filter @byclaw/dsh-codegraph run verify:runtime
```

`verify` 会编译插件，检查清单契约、patch 配置和生成后的系统策略，并运行隔离的运行时校验器回归用例；`verify:contract` 只针对已有编译产物执行契约检查，使镜像构建不必重复编译插件。`verify:runtime` 要求 `PATH`（或 `CODEGRAPH_COMMAND`）上存在声明版本的 CodeGraph，并使用 patch 声明的环境核对其版本和实时 MCP 工具列表。端到端能力测试的入站消息只写业务意图。任务结束后检查 DSH 会话事件，确认 Agent 自主选择了 `mcp__codegraph__codegraph_explore` 工具。
