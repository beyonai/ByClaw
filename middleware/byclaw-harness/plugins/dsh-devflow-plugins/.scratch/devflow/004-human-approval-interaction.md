---
title: 'devflow 人工审批 interaction 化 + headless blocked 降级'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-25
prd: .agents/prd/2026-08-25-devflow-file-based-dev-state.md
---

## Parent

PRD：`.agents/prd/2026-08-25-devflow-file-based-dev-state.md`

## What to build

把人工门禁接入 interaction 面：配置了审批的边（如 designing→ready、testing→done）在 gates 的 waterfall 监听器里挂起一次 `ctx.interaction` 审批请求——与工具权限确认同一通道，不经聊天、不经模型转译。批准 → 流转继续提交，journal 记 `by: {kind: human}`；打回 → 否决并记理由。headless / 无应答者场景：请求挂起、卡片进入 blocked 等人，与 interaction 能力现有 headless 行为一致。审批豁免配置（CI 场景）本切片不做（PRD 明确 out of scope，决策未收窄）。

## Acceptance criteria

- [ ] 审批边在有应答者时：批准 → 流转提交且 journal 签字人为 human；拒绝 → 否决且理由入 journal
- [ ] 审批决定不产生模型 turn；审批期间 agent 的同卡其他流转申请被 CAS/挂起语义正确拒绝
- [ ] headless 组合：审批边触发 → 卡片 blocked、请求挂起，进程可干净退出；恢复后卡片回到原阶段重新申请
- [ ] 未配置审批的边完全不受影响
- [ ] snapshot：headless 场景卡片停在审批点的转写
- [ ] 审批点配置为 schema 校验字段，引用不存在的边加载即败

## Blocked by

- `.scratch/devflow/003-command-gates-and-rework.md`

## Resolution

Shipped in commit a4bfe20fa6 (branch worktree-devflow-prd). All acceptance criteria met, with two recorded adaptations:
- The approval seam (`ctx.approval`) is agent-scoped and fail-closed, so "the request hangs" in headless resolves as an immediate `unavailable` (or an unreachable responder), after which the gates plugin vetoes the move and parks the card `blocked` with reason `awaiting human approval for <edge>` — the process exits cleanly with no pending work, matching the AC's intent.
- The journal's human signature is `gate.approvedBy` on the transition entry (the PRD's `gate` field), carried from the waterfall decision (`TransitionDecision.approvedBy`) rather than replacing the initiating `by` actor, so both the initiator and the approver stay auditable.
CI-exemption configuration (skipping approvals wholesale) remains out of scope per the PRD.
Verified: 92 package tests (approved/rejected/cancelled/unavailable matrix, command-before-approval ordering, blocked parking with recovery, downstream-veto passthrough, parking-failure warnings, plus REAL Loader headless composition parking a card blocked), per-file coverage thresholds, scoped typecheck/lint, and the touched doc-sync gates.
