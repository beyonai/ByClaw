# byclaw-super monorepo

本仓库包含两个逻辑层级：

- `by-conductor`：无多租户、无网络入口、无持久化绑定的 Agent 编排基础能力；
- `byclaw-super`：面向多租户部署的超级助手服务，负责通信、会话、排队、权限、持久化与恢复。

Pi SDK、OpenClaw 和 by-framework 的适配代码以目录形式接入，不进入 `by-conductor` 领域核心。

## 当前阶段

v1 采用**最小骨架**：只保留 monorepo 与唯一一条有价值的包边界（核心 ↔ 服务），其余结构以目录表达。

- 已删除前期的空壳源文件与独立适配包；
- `by-conductor` 仅保留包入口（`src/index.ts`）与 `domain/`、`ports/` 两个边界目录，暂无可调用实现；
- `apps/byclaw-super` 仅保留 `src/adapters/`、`src/server/` 目录骨架，暂无入口与服务；
- 旧 Fastify/Pi/SSE 示例保存在 `legacy/fastify-pi-starter/`，没有删除；
- 下一步应先固化核心契约，再实现最小内存闭环，按需把目录长出代码。

## 目录结构

```text
.
├── apps/
│   └── byclaw-super/                 # 可部署的多租户服务
│       └── src/
│           ├── adapters/             # 出站适配器：调用下游 Runtime / SDK
│           │   ├── pi/               #   Pi SDK AgentKernel
│           │   ├── openclaw/         #   OpenClaw RuntimeConnector
│           │   └── by-framework/     #   by-framework 出站 Transport
│           └── server/               # 入站：HTTP / SSE / by-framework
├── packages/
│   └── by-conductor/                 # 框架中立的编排核心
│       └── src/
│           ├── domain/               # Agent / Context / Execution 领域模型
│           └── ports/                # AgentKernel / RuntimeConnector / Transport 端口
├── docs/                             # 架构、契约与 ADR
└── legacy/fastify-pi-starter/        # 旧可运行示例
```

> monorepo ≠ 多 npm 包。v1 只用 2 个包固化"中立核心 vs 服务"边界；适配器作为目录随服务演进，等某个接缝真的需要独立发布时，再从目录提升为包（目录 → 包是单向安全演进）。

## 两层职责

### by-conductor 基础能力层

负责一次 Execution 内的：

- Agent、Catalog、Context 模型与不可变快照；
- AgentKernel 与 RuntimeConnector 端口；
- Delegation、取消和规范化事件；
- 可替换 Kernel、Runtime 与 Transport 的装配边界。

不负责用户认证、租户、Thread 队列、数据库、HTTP、SSE 或 by-framework 入站服务。

### byclaw-super 服务能力层

负责：

- HTTP Chat、SSE Chat、by-framework 三种入站通信；
- tenant/user 身份与权限隔离；
- Thread、Run、FIFO 排队和跨 Thread 并发；
- 上下文数据加载、快照持久化和恢复；
- RunEvent 保存、订阅、重放与协议映射；
- 数据库、Artifact、配置、可观测性和部署生命周期；
- Pi、OpenClaw 与 by-framework 适配器的最终装配。

## 通信入口

三种入口必须复用同一条应用链路：

```text
HTTP Chat ─────────┐
SSE Chat ──────────┼─> SubmitMessage -> EnqueueRun -> ThreadScheduler -> ExecuteRun
by-framework Worker┘
```

- 普通 Chat 等待 Run 终态并返回聚合结果；
- SSE 订阅并输出规范化 RunEvent；
- by-framework 入站把命令映射为同一 SubmitMessage，并把 RunEvent 映射回框架数据流。

`src/server/` 是别人调用本服务（入站）；`src/adapters/by-framework/` 是本服务调用下游 Runtime（出站），两个方向的命令、事件和生命周期不得混用。

## 会话与并发

```text
Tenant/User
  -> Thread
       -> Run（同一 Thread FIFO）
            -> Execution Attempt（由 Conductor 执行）
                 -> PiSession
                 -> Delegation
```

- 同一 Thread 同时只运行一个 Run，后续 Run 按 FIFO 排队；
- 不同 Thread 可以并发；
- PiSession 只属于一次 Execution Attempt，不是权威会话存储；
- 数据库保存 Thread、Run、CatalogSnapshot、ContextSnapshot 和 Delegation 状态。

## 依赖方向

```text
apps/byclaw-super
  -> packages/by-conductor        # 仅依赖核心公开 API

packages/by-conductor
  -X-> apps/byclaw-super
  -X-> Pi SDK / Fastify / by-framework / 数据库 SDK
```

## 基础命令

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 模块规则

- `packages/by-conductor/AGENTS.md`：编排核心边界；
- `apps/byclaw-super/AGENTS.md`：多租户服务边界；
- 根 `AGENTS.md`：只保存 monorepo 共同规则。
