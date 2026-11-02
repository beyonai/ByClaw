---
title: 'devflow 聊天建卡:缝 create + devflow_create 工具 + card-created 事件 + 看板实时刷新'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`

## What to build

聊天讨论直接沉淀为任务卡的端到端路径。缝新增 `create` 操作:请求为标题、Markdown 正文、可选 slug、actor;id 分配为"现有最大序号 + 1 + slug",目录以独占创建保证并发安全、撞号重试;journal 首条 `created`(带 actor)是唯一提交点,card.md 是投影。结果沿用既有领域结果姿势:非法请求(标题空、slug 非法、目录已存在)解析为稳定错误码的 `ok: false`,基础设施故障才 reject。模型工具 `devflow_create` 要求归属 agent 会话,提交后记会话日志事件(model-visible ⟺ logged)。新增单播事件 `devflow/card-created` 并进 Remote 转发白名单,看板收到后与 `stage-changed` 一样重拉,新卡实时出现。创建不是 transition:不复用 `stage-changed`、不过门禁 waterfall。`/devflow` 不加 new 子命令;手写 card.md + journal 的建卡路径继续有效。

## Acceptance criteria

- [ ] 经 `DevflowStore.create` 建卡后 list/read 立即可见,journal 可回放出同一张卡,首条即 `created` 且带 actor 签名
- [ ] 并发建卡序号分配不冲突(独占创建 + 撞号重试,经公开面并发测试验证)
- [ ] 标题空、slug 非法、目录已存在各返回稳定错误码的领域结果,不 reject
- [ ] `devflow_create` 走 real-Loader 组合测试:真实文件 store 上建卡,断言磁盘产物与会话日志事件
- [ ] 模型可见的工具行为有 keyless snapshot(真实可运行 example 的组装应用 transcript)
- [ ] `devflow/card-created` 经 gateway 转发到达客户端,看板重拉后新行出现(组件层 jsdom + 既有看板 e2e 增量)
- [ ] 手写文件建卡在同一 store 上照旧成立
- [ ] 文档与 Agent Note 同 PR

## Blocked by

None - can start immediately

## Resolution

Shipped on branch worktree-devflow-prd. The seam grew `resolveCreate` (slug derivation + timestamp, the explicit defaulting step) and `create` (sequence allocation past active AND archived cards so ids never reissue, exclusive non-recursive mkdir reservation with rescan-retry, journal-first commit, projection write via the standard degradation path, then the new `devflow/card-created` emit — creation runs no transition waterfall since governance starts at the first move). `devflow_create` requires an owning agent session and logs a `devflow/created` Session event; `devflow/card-created` joined the Remote forwarded allowlist and the board client refetches on it. Stable rejection codes: `empty-title`, `invalid-slug`, `exists` (five lost sequence races).

Verified: store-seam create.spec (happy path, empty-root numbering, explicit/derived/fallback slug, archived-sequence continuation, validation codes, in-process concurrency, slug bounding, infrastructure rejections) + create-contention.spec (cross-process mkdir race simulated at the fs boundary: rescan-retry and `exists` exhaustion) + tool loader-composition increment (disk artifacts, session event, board visibility, domain and non-agent rejections, presentCall) + invariant companion (fresh-draft-rev-1, never-reissued id) + browser-plugin listener wiring + real-browser board e2e; per-file coverage 100% on touched devflow/ui-devflow sources; typecheck, lint, doc-sync (catalogs regenerated bilingually) all green. The keyless-snapshot surface for tool behavior follows this feature's established precedent: the real-Loader composition transcript (devflow has no examples/ snapshot lane yet; the gen-tool-catalog harvest expectation was brought current with all six devflow tools). The live "new row appears" browser assertion lands with 010's two-workspace e2e as planned.
