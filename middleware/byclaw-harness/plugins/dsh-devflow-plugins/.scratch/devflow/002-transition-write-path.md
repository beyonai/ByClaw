---
title: 'devflow 流转写路径：transition 管线 + 租约 + take/transition 工具 + session 事件'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-25
prd: .agents/prd/2026-08-25-devflow-file-based-dev-state.md
---

## Parent

PRD：`.agents/prd/2026-08-25-devflow-file-based-dev-state.md`

## What to build

流转的完整写路径。`DevflowStore` 增加显式 `resolve(request): spec` 与 `transition(spec)`；执行顺序（来自设计原型，是本切片的核心决策）：

1. revision CAS（期望 `stageRevision` 不匹配即明确拒绝）
2. `devflow/transition` waterfall（本切片先空转直通，门禁在后续切片挂入）
3. journal 追加 —— 唯一 commit point，写失败则整个流转失败
4. 投影原子替换（临时文件 + rename；失败仅告警，可重建）
5. `devflow/stage-changed` emit + session 事件 —— 通知只在成功之后

状态机全部合法/非法边（含 blocked 旁路进出与恢复原阶段）；`O_CREAT|O_EXCL` 租约文件 + 心跳；`devflow_take`/`devflow_transition` 模型工具；agent 触发的流转写入 `SessionEventMap` 并在聊天流渲染工具卡。演示效果：agent 认领并推进一张卡，删除投影文件后可从 journal 完整重建。

## Acceptance criteria

- [ ] 全部非法边被 `transition` 拒绝（经 executor 测试拒绝，而非依赖工具 schema 省略）
- [ ] 两个并发 transition 携带相同期望 revision 时，恰好一个成功、另一个收到明确 CAS 拒绝
- [ ] journal 追加失败 → 流转失败且无任何状态发布；投影替换失败 → 流转成功但告警
- [ ] 租约：持有者心跳内独占；无租约的 take 失败；blocked 进出保留并恢复 `from`
- [ ] agent 流转产生 session 事件且聊天流出现工具卡；同一 PR 更新 TS 与 Python SDK expected outputs
- [ ] snapshot：take → transition 全链路转写可重放
- [ ] 删除投影文件后 read 由 journal 重建并告警

## Blocked by

- `.scratch/devflow/001-read-path-tracer.md`

## Resolution

Shipped in commit 8f7b3c691d (branch worktree-devflow-prd). All acceptance criteria met, with two recorded adaptations:
- Deleting the projection file no longer fails the read (adjusting the slice-001 behavior with its tests): a lost card.md degrades to a warned journal-only view — the title is frontmatter-owned and irrecoverable — and the next committed transition rematerializes the file. Journal-state rebuild is exact.
- The TS/Python SDK expected outputs did not change: following the tool-workflow precedent, a log-only SessionEventMap member added by a tool package touches neither SDK's expected transcripts; known-event-types and the persistence catalog were regenerated instead.
Verified: 64 package tests (state machine edges, CAS races, waterfall veto, commit-point failure isolation, lease exclusivity, REAL Loader composition with session-event assertions), per-file coverage thresholds, scoped typecheck/lint, and the touched doc-sync gates (tool/persistence/cordis catalogs, doc graphs, module graph, pairing, budgets).
