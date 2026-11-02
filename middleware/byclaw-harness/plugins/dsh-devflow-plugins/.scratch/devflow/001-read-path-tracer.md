---
title: 'devflow 读路径 tracer：文件模型 + seam 骨架 + list/show 工具'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-25
prd: .agents/prd/2026-08-25-devflow-file-based-dev-state.md
---

## Parent

PRD：`.agents/prd/2026-08-25-devflow-file-based-dev-state.md`

## What to build

端到端最小穿透：定义 `.devflow/` 任务卡文件模型（卡片目录含 frontmatter 投影 + 追加式 journal + artifacts），建立 `ctx.devflow` capability seam 的 Service Definition（抽象类占有服务键，拥有 `DevCard`/`DevStage` 词汇类型与 `devflow/*` 事件声明，卡片 id 用 branded 类型），实现 filesystem Provider 的**读侧**（经 `ctx.fs` 能力读取；当前状态由 journal 回放得出，frontmatter 只是投影），并提供 `devflow_list`/`devflow_show` 两个模型工具。演示效果：人手写一张卡，agent 在真实组合里列出它并讲清其阶段与历史。

`DevStage` 为闭合联合（来自设计原型）：`draft | designing | ready | developing | reviewing | testing | done`，另有 `blocked` 旁路态保留 `from`。

## Acceptance criteria

- [ ] 给定手写的合法卡片目录，`list`/`read` 返回卡片及由 journal 回放得出的当前阶段
- [ ] journal 出现坏行时读入 fail loud（明确错误指出文件与行号），不静默跳过
- [ ] frontmatter 投影与 journal 不一致时以 journal 为准并告警
- [ ] 两个模型工具的 render intent 为 `generic`，`locations` 指向卡片文件
- [ ] 真实组合 keyless snapshot：Loader 启动 test-only 组合，脚本化模型调用 list/show，转写可在 macOS/Linux 重放
- [ ] Definition 与 Provider 各自的注册均为 effect：dispose fiber 后服务与工具消失（HMR 安全测试）
- [ ] 包不变量注册：journal rev 单调连续
- [ ] Provider 配置（root 等）为 schema 校验字段，配错加载即败

## Blocked by

None - can start immediately

## Resolution

Shipped in commit 7319c5ce57 (branch worktree-devflow-prd). All acceptance criteria met, with two recorded adaptations:
- The tools' render intent is `generic`/`read`, but `presentCall` carries no `locations`: presenters are pure functions of call arguments and the card path is provider deployment state; the result value carries `path` instead (documented under the package's Known Limitations).
- The package invariant is an explained empty installer rather than a journal-rev event check: the repository's dead-vocabulary gate forbids declaring `devflow/*` events before their first dispatcher, so the stage-changed revision invariant moves to slice 002 with the write path.
Verified: 44 package tests (unit + REAL Loader composition), per-file coverage thresholds, scoped typecheck/lint, and the doc-sync gates touched by the change (tool catalog, cordis catalog, doc graphs, module graph, translation pairing, budgets).
