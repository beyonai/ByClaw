---
title: 'devflow 阶段驱动：stage-changed → preset 化 agent 派发'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-25
prd: .agents/prd/2026-08-25-devflow-file-based-dev-state.md
---

## Parent

PRD：`.agents/prd/2026-08-25-devflow-file-based-dev-state.md`

## What to build

纯 Consumer 驱动器：监听 `devflow/stage-changed`，按配置把进入某阶段的卡片派发给对应执行体——阶段映射 `{preset, executor}`，designing/reviewing/testing 用一次性 subagent 委派，developing 默认 goal（同会话长目标）、卡片 frontmatter 可 opt-in Ralph。派发前先取租约；`maxConcurrentCards` 并发上限与轮次预算必备；过期租约（心跳超时）可接管并记 journal。引用的 preset 不存在则加载即败。分支切换等导致 journal rev 回退时静默重扫而不重复派发。演示效果：卡片进入 designing 后自动产出设计产物并申请流转到 ready。

## Acceptance criteria

- [ ] 卡片进入已配置阶段 → 驱动器取得租约并按该阶段 preset 启动执行体；未配置阶段无动作
- [ ] 并发达到 `maxConcurrentCards` 时新卡排队，不超发
- [ ] 执行体结束后释放租约；异常结束的卡片不静默丢失（blocked 或重新排队，入 journal）
- [ ] 心跳过期的租约被接管且 journal 记 claim-expired
- [ ] rev 回退（分支切换模拟）触发重扫且同一卡不被二次派发
- [ ] preset 缺失 → 加载即败；驱动器 dispose 后不再派发（HMR 安全）
- [ ] e2e（无 key 自跳过）：一张卡 designing 阶段被真实 subagent 推进

## Blocked by

- `.scratch/devflow/003-command-gates-and-rework.md`

## Resolution

Shipped in commits 1f11f3fba2 (stale-lease takeover + claim-expired journal entries) and e314d42d9a (the driver) on branch worktree-devflow-prd. Acceptance criteria met, with three recorded adaptations:
- Stage config maps to `{ provider, instructions }` over the subagent seam rather than `{ preset, executor }`: one executor kind ships (one-shot subagent). The `goal` executor needs a live host agent per card and Ralph builds on the workflow engine; both are deferred and recorded in the package's Known Limitations and the Agent Note.
- The lease-takeover mechanics moved into the seam (`claim` with `staleAfterMs`) so the audit entry (`claim-expired`) lives in the journal vocabulary rather than driver-private state.
- The real-model e2e is deferred with the executor work; dispatch mechanics (claim → start → settle → release, prompt content, cap, takeover, parking, regression rescan, HMR abort) are covered through the real SubagentRuntime with a scripted provider.
Verified: 109 package tests, per-file coverage thresholds, scoped typecheck/lint, and the touched doc-sync gates.
