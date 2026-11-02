# DeepSeek Harness 的 devflow

[English](README.en.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的文件化开发状态管理：每项工作是一张**卡片**，卡片历史是一份只追加日志，每次阶段流转都提交到这份日志。十一个运行时插件围绕同一个 `ctx.devflow` 服务接口组合，另有一个声明式安装 bundle；Harness agent 是工作流执行者。

本仓库是一条独立的插件产品线，只依赖 npm 已发布的 Harness 包，不会修改 Harness。

## 包组成

| 包 | 作用 |
|---|---|
| `@zhchxiao123/dsh-devflow` | `ctx.devflow` 服务定义：卡片数据模型以及日志解码和回放 |
| `@zhchxiao123/dsh-devflow-filesystem` | 服务提供者：磁盘上的 `.devflow/`、`O_EXCL` 租约和按月归档 |
| `@zhchxiao123/dsh-devflow-gates` | 流转 waterfall 上的策略：按边执行命令，并支持一次性人工批准 |
| `@zhchxiao123/dsh-devflow-parent-gate` | 完成策略：拆分后的需求只有在全部子需求完成后才能进入 `done` |
| `@zhchxiao123/dsh-devflow-fs-guard` | 禁止 agent 的文件工具写入 `.devflow/`，确保状态存储是唯一写入路径 |
| `@zhchxiao123/dsh-devflow-artifact-gate` | 对已配置流转边执行确定性的产物契约检查 |
| `@zhchxiao123/dsh-devflow-agent-gate` | 对已登记产物执行独立的 LLM 准入检查 |
| `@zhchxiao123/dsh-devflow-tool` | 模型侧工具（`devflow_list`、`devflow_create`、`devflow_transition` 等） |
| `@zhchxiao123/dsh-devflow-guidance` | 模型引导：承载跨工具过程判断的 `devflow-workflow` bundled skill（按需加载），加 `devflow-board` 看板快照运行时上下文 |
| `@zhchxiao123/dsh-devflow-command` | 确定性的 `/devflow` 人工干预入口 |
| `@zhchxiao123/dsh-devflow-web` | devflow 的浏览器通道：只读 JSON 路由和变更流 |
| `@zhchxiao123/dsh-devflow-ui` | 看板浏览器端：直接注册到 Harness 官方右侧栏 |

卡片可以从三个相互独立的入口流转：模型使用工具，人工通过 `/devflow` 干预，批准请求走 Harness 的 approval 机制。Web 看板**只读**：路由只提供两种读取，没有任何写操作端点。

## 定时任务与 GitHub 内容同步

两项可选能力可以独立安装，也可以组合使用：

| 包 | 作用 |
|---|---|
| `@zhchxiao123/dsh-scheduler` | 通用定时计划、处理器与投递状态的服务定义 |
| `@zhchxiao123/dsh-scheduler-local` | 固定间隔与 Cron、本地持久化、重启恢复和 `/scheduler` 管理入口 |
| `@zhchxiao123/dsh-github-sync` | GitHub 内容、版本、变更记录和消费者游标的服务定义 |
| `@zhchxiao123/dsh-github-sync-local` | Issue、评论和 Discussions 的同步、持久化及 `/github-sync` 管理入口 |

宿主运行时，扫描不依赖活跃聊天会话。同步插件可单独手动运行；同时加载定时器后，`github.sync` 处理器接收订阅 ID，返回已持久化的运行 ID。定时器分别展示投递和下游结果，后续插件按独立游标消费变更。内容同步不评估问题、不创建开发任务，也不执行 GitHub 写操作。


自动化按 Harness 项目绑定，原生右侧栏提供并列的“自动化”和“GitHub 订阅”页面：前者管理计划与投递，后者管理订阅、同步内容与运行。`scheduler-tool`、`github-sync-tool` 从真实会话取得项目，与页面共用业务服务；未归属的旧记录需显式认领。

参见 [定时器使用说明](packages/scheduler-local/README.zh.md)和 [GitHub 同步使用说明](packages/github-sync-local/README.zh.md)。这些插件使用 Node.js 24 的 SQLite，数据库必须位于本地文件系统；多实例仅在共享同一本地数据库的支持范围内协调。它们不默认加入 Devflow bundle。

## Harness 版本

全部 Harness 与 Cordis 依赖都固定为最新适配基线：`@deepseek-ai/*` 使用 `0.1.5-rc.2`，Cordis 使用 `4.0.2`。看板客户端遵循拆分后的 `dsh-client-store`、`dsh-client-ui-renderer` 与 `dsh-api-session-controller` 边界。最近一次本地 tarball 启动回归在 `0.1.3-alpha.2` 上完成。依赖不使用浮动范围跨越 1.0 前的兼容性边界。

## 安装到 Harness

```sh
dsh plugin --profile web add @zhchxiao123/dsh-devflow-bundle
```

安装只需要这一条命令：`dsh plugin add` 将安装交给 pnpm，然后根据安装结果更新 profile 的 bundle 栈，因此 bundle 会自行挂载全部 devflow 配置项，无需编辑 profile 文件。看板也包含在内。可在 [`devflow-bundle`](packages/devflow-bundle/README.md) 中查看挂载内容、默认禁用项和覆盖方式。

最新 Harness Web 已内置官方右侧栏。Devflow 会直接出现在右侧栏的开始页和页签中，不需要再安装第三方侧栏，也不再创建对话页上的悬浮入口。

可选的 [Midscene Web 验收包](packages/devflow-midscene/README.zh.md) 单独安装，提供验收技能、CLI 和报告，复用现有产物与完成门禁。默认 bundle 不包含它。

## 实际运行效果

以下截图来自 DSH Web 中本仓库的真实回归会话，不是界面示意图。

### 工作区看板

![devflow 七阶段 Kanban，显示独立任务、受阻卡和父需求泳道](docs/screenshots/devflow-kanban-board.png)

宽侧栏默认同时展示需求草稿、方案设计、待开发、开发中、评审、验证和已完成七列。独立任务集中在顶部；有子任务的父需求形成可折叠泳道，子任务只出现在自己的实际阶段。受阻卡回落到来源阶段并带明确标记，不会制造第八个状态列。它仍是只读观察面；实际流转由 Harness agent 的 `devflow_*` 工具或人工命令完成。

### 卡片详情

点击卡片即可进入详情页，查看当前阶段、revision、完整阶段轨道、需求正文、验收标准、拆分关系和已登记产物。

![已完成卡片的详情页，显示当前阶段、revision、阶段轨道、需求和交付内容](docs/screenshots/devflow-card-detail.png)

### 阶段产物与流转时间线

![卡片详情中的阶段产物与流转时间线，显示五类文档、阶段变更、闸门结果和流转原因](docs/screenshots/devflow-card-timeline.png)

详情页汇总需求文档、设计文档、开发报告、评审报告和测试报告，并在同一时间线中记录产物登记、阶段变更、revision、发生时间、停留时长、流转原因和闸门结果，因此可以直接追溯卡片如何从需求草稿推进到已完成。

## 插件市场信息

**核心价值：**为 Harness agent 提供可持久化、可检查的开发工作流，包括文件化卡片、带 revision 校验的安全流转、可选的产物和准入检查、人工干预以及只读 Web 看板。

| 项目 | 支持情况 |
|---|---|
| 安装包 | `@zhchxiao123/dsh-devflow-bundle` |
| Profile | 完整 bundle 使用 `web`；服务端插件也可以单独组合 |
| Harness 兼容性 | 固定 `@deepseek-ai/*` `0.1.5-rc.2`；Cordis `4.0.2`；最近一次本地启动回归在 `0.1.3-alpha.2` |
| 完整 Kanban 页面 | 直接接入 Harness `0.1.5-rc.2` 官方右侧栏，无额外侧栏依赖 |
| Node.js | `^22.19` 或 `>=24` |
| 本地数据 | 读写每个调用方工作区内的 `.devflow/`；状态存储不会修改项目源文件 |
| 网络与模型 | 不含遥测或内置第三方服务；可选的 agent 检查使用 Harness 已配置的模型提供方 |
| 命令 | 可选的命令检查只执行 profile 所有者显式配置的命令 |
| 默认设置 | 产物、agent、命令和批准检查已挂载，但在 profile 定义策略前保持禁用 |

安装入口是一个 `dsh.bundle` manifest，其 patch 负责挂载运行时包。函数插件按照 Harness loader 契约导出 `apply(ctx)`；服务包导出对应的服务类。

启用产物契约后，模型在尝试流转前就能看到产物要求。[真实 Loader 组合测试](packages/devflow-tool/tests/loader-composition.spec.ts)会断言如下形式的输出：

```text
Created card 0001-artifact-flow [draft] Artifact flow (rev 1).
artifact requirements for draft -> designing:
[missing] requirements-document

Card 0001-artifact-flow moved draft -> designing (rev 4).
artifact requirements for designing -> ready:
[missing] design-document
```

## 开始开发

```sh
git clone https://github.com/zhchxiao123/dsh-devflow-plugins.git
cd dsh-devflow-plugins
pnpm run init
```

`init` 按仓库记录的 lockfile 安装依赖，然后执行类型检查、lint 和测试；干净检出的仓库要么成功复现环境，要么明确暴露 Harness 依赖已经发生变化。之后可以运行：

```sh
pnpm run verify        # typecheck + lint + test, the pre-push gate
pnpm run test:coverage # per-file 100% on packages/*/src
pnpm run build         # emit lib/types
```

测试和类型检查通过 `tsconfig.base.json` 的 `paths` 在工作区包之间解析源码；使用方则通过 `exports` 解析构建后的 `lib/`。

## 开发记录

本仓库携带与代码同步演进的开发记录：

| 路径 | 内容 |
|---|---|
| `.agents/prd/` | 六份 PRD：每组改动的目标以及明确排除的范围 |
| `.scratch/devflow/` | 从 PRD 拆出的 22 个 issue 及各自的解决记录 |
| `.agents/notes/implemented/` | Agent Note：决策、备选方案及其理由 |
| `.agents/skills/` | 仓库工作方式：prose 规范、代码审查和 note 维护 |
| `docs/devflow.md` | 子系统说明 |
| `AGENTS.md` | 本插件产品线遵循的约定 |

从 `AGENTS.md` 开始阅读；首要规则是：**本插件产品线只依赖已发布的 Harness API。**

## 发布

十二个包始终以同一版本一起发布。详见 [RELEASING.md](RELEASING.md)；简化命令是 `pnpm run set-version <v> && pnpm run release`，只有类型检查、lint、测试、构建和 tarball 预检全部通过后才会发布。

## 测试

测试覆盖所有包，包括看板：`tests/loader-factory.ts` 通过模块表运行 Harness 已发布的客户端 bundle，使浏览器端测试使用真实的 `SlotRegistry` 而不是替身。`packages/*/src` 中每个文件都要求 100% 覆盖率，安装路径也会通过真实 Harness 启动进行验证。
