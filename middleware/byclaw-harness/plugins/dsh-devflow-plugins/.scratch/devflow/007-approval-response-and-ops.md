---
title: 'devflow 审批应答 + /devflow 干预命令 + 归档收尾'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-25
prd: .agents/prd/2026-08-25-devflow-file-based-dev-state.md
---

## Parent

PRD：`.agents/prd/2026-08-25-devflow-file-based-dev-state.md`

## What to build

操作面收尾。面板增加唯一可操作元素：审批行（批准/打回按钮），它是对 gates 挂起的 pending interaction 请求的**应答**——与工具权限确认同通道，不是 devflow mutation 动词；应答后流转在 host 侧照常走 waterfall 提交，journal 记 `by: human`。`/devflow` human command 承载确定性人工干预：强制流转、恢复 blocked、接管过期租约——经命令面执行，不产生模型 turn。done 卡片按月归档到归档目录，活跃目录保持小。

## Acceptance criteria

- [ ] 面板审批行批准 → 流转提交、journal 签字 human、面板与聊天流同步更新；打回 → 否决带理由
- [ ] 同一审批请求被两个窗口同时应答时恰好一次生效，另一次收到已应答提示
- [ ] `/devflow` 强制流转与恢复 blocked 正确写 journal（标注命令面来源），不出现模型 turn
- [ ] `/devflow` 接管过期租约后原持有 agent 的后续提交被 CAS 拒绝
- [ ] done 卡归档后 list 默认不含它、按需可查；归档卡的 journal 完整保留
- [ ] snapshot：命令面干预的转写；GIF：面板内完成一次审批

## Blocked by

- `.scratch/devflow/004-human-approval-interaction.md`
- `.scratch/devflow/006-web-readonly-panel.md`

## Resolution

Shipped in commit 3a911bbc14 (branch worktree-devflow-prd). The operations plane closes with two recorded deviations from the sketch:
- 审批应答：面板不新增审批行。004/006 已把审批路由到既有 approval composer（gates 经 `ctx.approval` 发起一次性请求），恰好一次生效与双窗口互斥由 interaction 平面自身保证；devflow 面板保持纯只读，本切片没有需要新建的应答通道。
- `/devflow` 不是门禁旁路：`move` 按卡片当前 revision 经普通执行器提交（边合法性、打回 reason、gates waterfall 照常裁决），journal actor 为 `{"kind":"command","name":"devflow"}`；恢复 blocked 就是一次普通 move。因此审批边即使用命令面也走 parked-blocked 路径——强制执行留在 executor（devflow-gates README 已同步）。`takeover` 是唯一强制动词：`claim(id, actor, { staleAfterMs: 0 })`，任何过去的心跳都算过期，驱逐以 `claim-expired` 入 journal，原持有者的下一次提交被 CAS 拒绝（严格年龄比较意味着同毫秒/未来心跳仍算存活，作为已记录边界）。
- 归档：能力缝新增 `archiveDone`，文件 Provider 把每张 done 卡目录按最后一条 journal 的月份整体 rename 进 `archive/<YYYY-MM>/<id>/`（`at` 无 YYYY-MM 前缀时回退当前月份）；`list` 只扫 `tasks/`，归档卡即离开看板且 journal 完整保留。归档只写不读（没有列出/恢复操作），已记入 README Known Limitations。
Verified: 6 command tests（含 real-Loader composition 转写：/devflow move 经命令运行时提交并落 command actor journal）+ devflow/ui-devflow/ui-jobs 全量 151 tests 零未覆盖行 + 双编译面 + doc-sync 全部门禁（type-equiv 手册化为逐符号块）+ duplication 0 clones（提取 escapeDismissHandler 进 ui-primitives）。快照转写由 loader-composition 测试承担；GIF 与真实模型 e2e 随 006 的遗留一并推迟。
