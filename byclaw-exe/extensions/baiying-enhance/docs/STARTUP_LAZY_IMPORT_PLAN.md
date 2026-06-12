# OpenClaw 启动耗时优化：Lazy Import 清单与目标耗时

## 实现状态（2026-05-28）

已落地：

- **P0**：`resource-metadata-context.ts` + `runBaiyingExecutor` / `executor/index` 延迟加载；esbuild **`--splitting`** 将 `baiying-call-tool`、`agent-watchdog`、`executor` 等拆到 `dist/chunks/`（主入口 `dist/index.js` ~19KB）。
- **P1**：`register-plugin.ts` 承载 `register()`；`baiying_call` 在 `registerService.start` 里 `import()` 预热；watchdog / dig-employee / archive 等同理。
- **P2**：`byai-channel` 的 `ByaiSdkApp`、`EventType` 改在 `startAccount` / `emitSdkText` 时动态 `import()`。

部署注意：发布 `dist/index.js` 时必须**同时**带上整个 `dist/chunks/` 目录。

---

基于 sandbox 日志（`sandbox-b2c9a659-…`，2026-05-28）的 trace 结论：**进程冷启动约 48.3s 到 `http server listening`**，其中 **~35.6s（~74%）** 花在 `baiying-enhance` 首次 `import()`，**~5.1s（~11%）** 花在第二轮插件加载里的 `byai-channel`。

本文档给出按优先级排序的 **lazy import 改造清单**、改动落点、风险与 **改完后的目标耗时**（估算，需在相同容器/磁盘上复测）。

---

## 1. 日志 Trace 摘要（基准）

| 标记 | 时间戳 | 相对起点 | 说明 |
|------|--------|----------|------|
| T0 | 17:02:30.378 | 0s | `[gateway] loading configuration` |
| T1 | 17:02:35.178 | +4.4s | `loading baiying-enhance`（开始 `import`） |
| T2 | 17:03:10.759 | **+35.6s** | `Baiying Enhance module imported` |
| T3 | 17:03:10.769 | +35.7s | `register`（import 后 ~10ms） |
| T4 | 17:03:11.155 | +36.0s | 首轮 `loaded 3 plugin(s) in 35981ms` |
| T5 | 17:03:18.668 | **+48.3s** | `http server listening (47.9s)` |
| T6 | 17:03:19.164 | +48.8s | `[gateway] ready` |

**结论：** 慢在 **ESM 模块图首次求值**，不是 `register()` / Redis sync / workspace reseed（这些在 `ready` 前后且多为 background）。

**冷/热对比（同一进程）：**

| 轮次 | 3 插件总耗时 | 说明 |
|------|-------------|------|
| 第 1 次 | 35981ms | `baiying-enhance` 冷 import |
| 第 2 次 | 5089ms | `byai-channel` `channel registered` 约 5s |
| 第 3 次+ | 46–99ms | 模块缓存命中 |

---

## 2. 冷启动 Import 链（根因）

`index.ts` 顶层 **静态** `import` 会在打出 `module imported` 之前拉齐整棵依赖树：

```text
index.ts
├── baiying-call-tool.ts          ★ 最重
│   └── resource-metadata.ts
│       └── executor/index.ts
│           └── executor.ts
│               ├── executor/call-agent.ts      → @byclaw/by-framework
│               ├── executor/doc-gateway.ts     → @byclaw/by-framework
│               ├── executor/resource-types/agent.ts → openclaw/plugin-sdk/gateway-runtime
│               ├── executor/doc-redis.ts       → ioredis
│               └── …（toolkit / mcp / doc 等）
├── agent-watchdog.ts             ★ 次重（大文件 + 大量本地模块，无 executor 但解析成本高）
├── redis-json-store.ts           → ioredis
├── dig-employee-auth-watch.ts    → ioredis
├── dig-employee-change-subscriber.ts → ioredis
├── workspace-archive-api.ts
│   └── backend-service-discovery.ts → ioredis
├── managed-agent-model-hook.ts   → 中等（openclaw compat，无 by-framework）
└── …（其余较轻）
```

构建使用 `esbuild --packages=external`（见 `package.json`），**`@byclaw/by-framework`、`ioredis`、`openclaw/*` 不在 bundle 内**，容器冷盘首次解析极慢。

`baiying-call-tool` 在 **模块加载时** 即通过 `resource-metadata` 牵出 **整个 executor**，而工具实际执行在首次 `baiying_call` 才需要——这是最大浪费点。

---

## 3. Lazy Import 清单（按优先级）

### P0 — 必须做（预期收回 ~25–32s）

| # | 当前静态依赖 | 建议改法 | 改动文件 |
|---|-------------|----------|----------|
| P0-1 | `index.ts` → `createBaiyingCallToolFactory` | `register()` 内 `await import("./src/baiying-call-tool.js")` 再 `api.registerTool` | `index.ts` |
| P0-2 | `baiying-call-tool.ts` → `runBaiyingExecutor` from `resource-metadata` | 拆文件：上下文构建留 `resource-metadata-context.ts`；`runBaiyingExecutor` 改为 `await import("./executor/index.js")`（工具 handler 内） | `baiying-call-tool.ts`, 新建 `resource-metadata-context.ts` |
| P0-3 | `resource-metadata.ts` 顶层 `import { runBaiyingExecutor } from "./executor/index.js"` | 删除；仅保留 `buildExecutorResourceContext` / `compactText`；或合并进 P0-2 的 context 模块 | `resource-metadata.ts` |
| P0-4 | `executor/index.ts` 顶层 `import { BaiyingExecutor } from "./executor.js"` | 可选：`runBaiyingExecutor` 内 `const { BaiyingExecutor } = await import("./executor.js")` + 保持 cache | `executor/index.ts` |

**验收：** 冷启动日志中 `module imported` 与 `loading baiying-enhance` 间隔 **< 5s**；首次用户触发 `baiying_call` 时允许 **+2–8s** 一次性 executor 加载（可打 `baiying-enhance: executor lazy-loaded in Nms`）。

---

### P1 — 强烈建议（预期再收 ~3–8s）

| # | 当前静态依赖 | 建议改法 | 改动文件 |
|---|-------------|----------|----------|
| P1-1 | `index.ts` → `createAgentWatchdog` | `registerService.start` 内 dynamic import | `index.ts`, `agent-watchdog.ts`（无改或仅 export） |
| P1-2 | `index.ts` → `createDigEmployeeAuthWatch` / `createDigEmployeeChangeSubscriber` | 同上，在 `start()` 里 import | `index.ts` |
| P1-3 | `index.ts` → `createRedisJsonStore` | `register()` 开头 dynamic import（`registerManagedAgentModelHooks` 需要 store，但不必在 **模块** 顶层加载 ioredis） | `index.ts`, `redis-json-store.ts` |
| P1-4 | `index.ts` → `createWorkspaceArchiveApi` | 仅 `workspaceArchiveBackend !== "local"` 时在 `start()` import | `index.ts` |
| P1-5 | `index.ts` → `loadMainAgentsTemplate` 等 from `main-workspace-seed` | 仅 `start()` 使用处 dynamic import | `index.ts` |

**目标：** `index.ts` 顶层仅保留 `node:*`、`AgentRegistryState`（type-only 的 `agent-adapter`）、`types`、插件元数据。

---

### P2 — byai-channel（预期收回第二轮 ~5s）

| # | 现象 | 建议改法 | 改动文件 |
|---|------|----------|----------|
| P2-1 | `channel-plugin-api.ts` → `channel.ts` → `@byclaw/by-framework` + `sdk-app.ts` | 将 `ByaiSdkApp` / `WorkerRunner` 等挪到 `sdk-app-lazy.ts`，`channel.ts` 的 `startAccount` 再 `import()` | `byai-channel/src/channel.ts`, `sdk-app.ts` |
| P2-2 | `defineBundledChannelEntry` 二次加载子入口 | 与 OpenClaw 侧确认是否可合并入口或缓存子 specifier（框架层，可选） | `byai-channel/index.ts` + 上游 OpenClaw |

**验收：** 第二轮 `loading byai-channel` → `channel registered` **< 1s**。

---

### P3 — 构建与观测（锦上添花）

| # | 项 | 说明 |
|---|-----|------|
| P3-1 | 将 `ioredis`、`@sinclair/typebox` bundle 进 `dist/index.js` | 减少冷盘 `node_modules` 随机读；`openclaw` / `@byclaw/by-framework` 仍 external |
| P3-2 | 启动分段计时 | 在 `index.ts` / `register` / 首次 `baiying_call` 打 `performance.now()` 日志，便于回归 |
| P3-3 | 减少 gateway 启动路径重复全量 plugin reload | 配置同步后的 reload 已 ~99ms，优先级低于 P0–P2 |

---

## 4. `index.ts` 改造示意（P0 + P1）

**改造前（节选）：** 顶层 10+ 个业务模块静态 import。

**改造后原则：**

```typescript
// 保留：node 内置、type-only、AgentRegistryState、types、plugin 对象骨架

const plugin = {
  id: "baiying-enhance",
  // ...
  async register(api: OpenClawPluginApi) {
    const [
      { createRedisJsonStore, setSharedRedisJsonStore },
      { registerBaiyingAimodelRuntimeProvider },
      { registerManagedAgentModelHooks },
      { registerBaiyingHttpRoutes },
      { loadBaiyingRedisEnvDefaults },
    ] = await Promise.all([
      import("./src/redis-json-store.js"),
      import("./src/aimodel-runtime-provider.js"),
      import("./src/managed-agent-model-hook.js"),
      import("./src/http-routes.js"),
      import("./src/redis-env.js"),
    ]);
    // … register hooks / routes / redis …

    const { createBaiyingCallToolFactory } = await import("./src/baiying-call-tool.js");
    api.registerTool(createBaiyingCallToolFactory({ /* … */ }), { name: "baiying_call" });

    api.registerService({
      start: async (ctx) => {
        const { createAgentWatchdog } = await import("./src/agent-watchdog.js");
        const { createDigEmployeeAuthWatch } = await import("./src/dig-employee-auth-watch.js");
        // …
      },
    });
  },
};
```

`register()` 内多模块可 `Promise.all` 并行 dynamic import（注意 `registerTool` 对 factory 的同步要求仅在于 **调用 registerTool 时** factory 已存在，不必在进程 import 阶段存在）。

---

## 5. Executor 子树外部依赖（P0 延迟目标）

| 包 | 引用位置（示例） | 冷启动是否必须 |
|----|------------------|----------------|
| `@byclaw/by-framework` | `executor/call-agent.ts`, `doc-gateway.ts`, `datacloud-mcp-url.ts`, `resource-types/agent.ts` | 否（仅 `baiying_call` / 资源执行） |
| `openclaw/plugin-sdk/gateway-runtime` | `executor/resource-types/agent.ts` | 否 |
| `ioredis` | `executor/doc-redis.ts` 等 | 否（register 另有独立 Redis 客户端） |
| `@sinclair/typebox` | `baiying-call-tool.ts` | 可保留（体积小）；或随 tool 模块 lazy |

---

## 6. `resource-metadata` 拆分示意（P0-2）

| 文件 | 职责 | 顶层依赖 |
|------|------|----------|
| `resource-metadata-context.ts` | `compactText`, `buildExecutorResourceContext` | 仅 types / `agent-adapter` |
| `resource-metadata.ts` | `runBaiyingExecutor` → dynamic `import("./executor/index.js")` | 无静态 executor |
| `baiying-call-tool.ts` | 从 context 模块 import；handler 内 `runBaiyingExecutor` | 无 executor 子树 |

---

## 7. 目标耗时（估算）

假设环境与基准日志相同（overlay 盘、Node 22、debugger 端口开启）。

| 阶段 | 当前 | P0 完成后 | P0+P1 | P0+P1+P2 | 备注 |
|------|------|-----------|-------|----------|------|
| `baiying-enhance` 冷 `import` | **~35.6s** | **~3–8s** | **~0.5–2s** | 同左 | P0 去掉 executor/by-framework |
| 首轮 3 插件 | ~36s | ~4–9s | ~2–4s | ~2–4s | |
| 第二轮（至 HTTP listen） | ~5s | ~5s | ~5s | **~0.5–1s** | P2 优化 byai-channel |
| **到 `http server listening`** | **~48s** | **~12–18s** | **~8–12s** | **~5–8s** | |
| **到 `gateway ready`** | **~49s** | **~13–19s** | **~9–13s** | **~6–9s** | |
| 首次 `baiying_call`（若 P0） | 0 | **+2–8s 一次性** | 同左 | 同左 | 可接受则产品无感 |

**保守目标（仅做 P0）：** 总启动 **≤ 18s**。
**推荐目标（P0+P1）：** 总启动 **≤ 12s**。
**理想目标（P0+P1+P2）：** 总启动 **≤ 8s**。

---

## 8. 实施顺序与 PR 建议

1. **PR-1（P0）**：拆分 `resource-metadata` + `index.ts` lazy `baiying-call-tool`；补 vitest：`runBaiyingExecutor` 仍可用。
2. **PR-2（P1）**：`index.ts` 其余模块改 `register` / `start` dynamic import。
3. **PR-3（P2）**：`byai-channel` sdk 延迟加载。
4. **PR-4（P3）**：esbuild 策略 + 启动计时日志。

每 PR 在相同 sandbox 打一次：

```bash
# 容器内关注两行间隔
docker logs <sandbox> 2>&1 | rg "loading baiying-enhance|module imported|http server listening"
```

---

## 9. 风险与约束

| 风险 | 缓解 |
|------|------|
| 首次 `baiying_call` 变慢 | 文档说明；可选在 `registerService.start` 后台 `import("./executor/index.js")` 预热 |
| `register()` 变 async | 确认 OpenClaw 插件 API 支持 async register；若不支持，用 void IIFE + 内部 Promise 队列 |
| 测试 mock 路径变化 | vitest 中对 dynamic import 使用 `vi.importActual` |
| 类型导出 | `export type` 仍放独立 `types.ts`，避免 type import 拉运行时 |

---

## 10. 不建议 lazy 的模块（须在 register 同步可用）

| 模块 | 原因 |
|------|------|
| `aimodel-runtime-provider` | 首轮对话 `before_model_resolve` 依赖 provider 注册 |
| `managed-agent-model-hook` | main run 的 aimodel run-check |
| `redis-json-store` + `setSharedRedisJsonStore` | register 阶段就要给 hooks；可 dynamic 但要在 register 内 await，不要推迟到 first message |
| `http-routes` | 若网关启动后立即探活 HTTP |

---

## 11. 相关文件索引

- 插件入口：[`../index.ts`](../index.ts)
- 最重依赖链：[`../src/baiying-call-tool.ts`](../src/baiying-call-tool.ts) → [`../src/resource-metadata.ts`](../src/resource-metadata.ts) → [`../src/executor/`](../src/executor/)
- 构建：[`../package.json`](../package.json) `build` 脚本
- 插件总览：[`PLUGIN_OVERVIEW.zh-CN.md`](./PLUGIN_OVERVIEW.zh-CN.md)
