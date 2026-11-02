# @byclaw/dsh-bash-provider

[English](README.md) | 中文

这个可选 DSH profile bundle 会把 DSH 宿主进程中所有已定义的环境变量透传给模型侧 Bash 命令，并把符合条件的命令路由给 [rtk](https://github.com/rtk-ai/rtk)（Rust Token Killer）压缩输出、节省 token。它还会用当前 `USER_CODE` 读取 `SHARE_BFM_USER_CODE_<USER_CODE>` 解析内部用户 ID，再动态读取 `byai:user:private_params:<USER_CODE>` 与 `user:<userId>:login:auth`。`BEYOND_TOKEN`、`DEEPSEEK_API_KEY`、`PASSWORD`、`SECRET` 等凭据命名变量会通过 shell 请求的显式环境传入，因此能够绕过 DSH 对环境变量的隐式清洗，并继续传给 Bash 启动的程序，包括 Python 的 `os.environ`。

插件继承发行版自带的 sandboxed Bash provider，保留当前 sandbox provider、sandbox policy、进程树所有权、超时、输出限制和终止行为；改变的是显式子进程环境，以及（命令符合条件时）shell 源码本身。它不会修改 DSH 源码，也不会替换共享 subprocess 服务。

rtk 包装那部分原本是独立的 `@byclaw/dsh-bash-rtk` 插件（本身来自 [`DeepTrial/dsh-bash-rtk`](https://github.com/DeepTrial/dsh-bash-rtk)，MIT 许可），因为这套部署一直需要两个能力同时生效，所以合并进了这里，用一行 patch 就能覆盖两种能力。

## 安装

先在 DSH 工作区构建，再把插件加入需要暴露宿主环境的 profile：

```sh
pnpm --filter @byclaw/dsh-bash-provider run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-bash-provider
```

bundle 会停用发行版的 `bash-sandbox` 运行项，并以相同的 60 秒默认超时安装 `byclaw-bash-provider`。它在 Windows 上保持禁用，与发行版 Bash provider 一致。

## 繁忙时 Enter 发送行为

本包原名为 `dsh-env-forward`，当前源码目录为 `dsh-bash-provider`。bundle 用启动环境为 Web profile 的 `ui-conversation` 运行项设置默认值；发行版的 `settings` 运行项保持不变。

在 DSH 启动环境或其 `.env` 文件中设置：

```dotenv
BYCLAW_DSH_BUSY_ENTER=queue
```

`queue` 表示排队发送，也是未设置变量时的默认值；`steer` 表示插话发送。其他值（包括空字符串）无法通过校验，`ui-conversation` 运行项不会加载。profile 加载时读取该值，修改后需重启 DSH。透传给 Bash 的 Redis 参数不会配置 Host 界面。

此值是 `ui-conversation` 运行项的 `busyEnter` 默认值，不写入任何文件。界面保存的偏好写入 profile 的 `cordis.patch.yml`，其中的 `ui-conversation` 条目会替换这份配置，因此优先；删除该条目即可重新继承环境变量默认值。界面修改仍即时生效。智能体繁忙时，Enter 使用选中的行为，Cmd/Ctrl+Enter 使用另一种行为；鼠标发送按钮仍然排队。插话会在下一个可用步骤边界送达，不会中断正在执行的操作。

## 命令压缩（rtk）

插件在环境变量转发之后、`resolve()` 边界处重写符合条件的命令，在实际执行之前：

| 输入 (`command`) | 解析后的输出 | 原因 |
|---|---|---|
| `git status` | `rtk git status` | 简单命令 + 在白名单内 |
| `cargo build --release` | `rtk cargo build --release` | 简单命令 + 在白名单内 |
| `git status \| grep x` | `git status \| grep x` | 复杂 shell —— **直接透传** |
| `ls -la` | `ls -la` | 不在白名单 —— **直接透传** |
| `git status`（无 rtk） | `git status` | 二进制缺失 —— **恒等回退** |

三道独立关卡决定路由（见 [`src/rtk-wrap.ts`](src/rtk-wrap.ts)）：

1. **复杂度** —— 任何 shell 元字符（`| & ; < > \` $`）都会取消资格。包装这些会改变实际运行内容，故直接透传。
2. **白名单** —— 仅 `rtk` 实际实现的已知开发工具才符合资格（`rtk-wrap.ts` 中的映射表）。
3. **可用性** —— 执行器构造时会探测 `PATH` 上的 `rtk --version`（`src/index.ts` 的 `resolveRtk()`）；缺失时命令路由退化为**恒等**（环境变量转发仍然生效）。

**要求：** `rtk` 在 `PATH` 上（`rtk --version` 退出码为 0）。插件**不会**安装或管理 rtk —— 请自行安装并更新（例如 `cargo install rtk` 或下载发布二进制）。`Dockerfile.base` 已经为 byclaw-harness 的 Docker 镜像安装了固定版本的 `rtk`，所以这一条只在非 Docker 部署时才需要关心。被路由的命令集合由 rtk 自身定义，参见 [rtk 命令参考](https://github.com/rtk-ai/rtk#supported-ecosystems)。可选的 `rtkAvailable: boolean` 配置字段可以强制启用或禁用这个变换（适用于测试或非标准二进制路径）。

## 环境变量优先级

每次 Bash 执行按以下顺序合并环境变量：

1. 当前 DSH 宿主 `process.env` 中所有已定义的变量。
2. 进程内调用方通过 `ShellExecRequest.env` 显式传入的变量。
3. Redis 私有参数 JSON 中 `params` 对象里的字符串值。
4. Redis 登录 Hash，映射为 `BEYOND_TOKEN`、`SSO_TOKEN`、`WHALE_AGENT_AUTHORIZATION`、`USER_CODE`、`USER_ID` 和 `USER_NAME`。
5. `dsh-shell-env` 为当前执行生成的受管 `DSH_*` 快照。

后面的层级优先。因此，Redis 运行态值会覆盖同名本地变量和调用方变量，而 `DSH_SESSION_ID` 等受管当前值仍不会被覆盖。前台和后台命令都会在执行前立即刷新 Redis（缓存另在启动时及每 5 秒刷新）。每次刷新只尝试连接一次，硬超时为 1 秒，单次刷新内部不重试。key 不存在按正常空结果处理；连接/命令异常、非法 JSON 和错误 payload 结构只记录不含 Redis value 的错误，并保留上一份成功缓存；没有缓存时 Bash 继续使用本地环境和调用方环境。

透传作用于模型侧 `bash` 工具及其他经过 `ctx.shell` 的调用，不影响持久终端、PowerShell、MCP/LSP transport、subagent，也不影响直接调用 `ctx.subprocess` 的其他 consumer。

### 宿主共享凭据

bundle 会用 `byclaw-credentials` 替换发行版的 `credentials` 运行项，继承本地凭据提供方，复用现有 Bash Redis 读取类，但独立按需刷新并维护最近一次成功缓存。原有 Bash 读取、定时刷新和环境注入逻辑保持不变。原生 web search 和其他宿主插件可以通过 `ctx.credentials.resolve(ref)` 读取 Redis 对应值，无需先执行 Bash；不安装专用搜索适配器，也不新增模型工具。

每次读取引用都会为当前 `USER_CODE` 刷新 Redis，沿用一秒超时与失败处理。非空 Redis 值优先于原有本地凭据来源；成功刷新后值被删除或置空则恢复原有回退；Redis 故障时沿用最近成功值，没有缓存则回退。搜索显式配置的 `apiKey` 仍然优先。本功能只扩展凭据解析，不改变一般环境变量读取或搜索地址配置。

凭据描述只返回配置状态、来源（`redis`）和是否可写，不返回明文。可信宿主插件可以共享这些值，但不会新增让模型读取明文的工具，不写入全局 `process.env`，也不将 Redis 值持久化到凭据或设置文件。Redis 提供的引用在凭据页面/API 中只读，应在该用户的 Redis 私有参数中修改。下文所述的原有 Bash 访问能力仍然存在。

原先为 `credentials` 运行项自定义的存储路径、`dshHome` 或 watcher 配置需移到 `byclaw-credentials`。原有凭据文件和 credential-record API 继续可用。原生 `web-search-deepseek` 插件、profile 配置和已保存设置均保持不变。

## 安全限制

插件默认且只提供全量透传模式。任何获准运行 Bash 的 Agent 都可以读取、打印、写入或发送所有被透传的凭据。DSH sandbox 仍然控制文件系统副作用，但这个插件会有意取消 Bash 命令的环境变量隔离。

只应在可信 profile 中启用，并确保宿主进程没有 Agent 不应访问的凭据。条件允许时，应使用最小化的启动环境或专用服务账号运行 DSH。

## 开发验证

```sh
pnpm --filter @byclaw/dsh-bash-provider run test
pnpm --filter @byclaw/dsh-bash-provider run typecheck
pnpm --filter @byclaw/dsh-bash-provider run build
```
