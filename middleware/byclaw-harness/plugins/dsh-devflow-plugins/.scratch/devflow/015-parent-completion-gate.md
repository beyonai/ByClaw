---
title: 'devflow 父卡完成门禁:-> done 否决、driver 跳过父卡、族归档'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-requirement-breakdown.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-requirement-breakdown.md`

## What to build

让"大需求完成"有机器判据,并让大需求不会被当成一次可执行派发。三件事共同构成父子语义的闭环:

- **完成门禁插件(新包)**:挂在既有的转换瀑布上,只卡父卡 `-> done` 这一条边——子卡未全部 `done` 时否决,理由点名剩余子卡的 id 与其当前阶段。不进 store、不加状态机、不动阶段联合类型。卡在 `-> done` 而不是更早的边,是为了让父卡自己的 `reviewing` / `testing` 成为"整体联调与整体验收"的落点。它的角色是"父卡完成门禁",与既有的"边上命令门禁"是两件事,因此独立成包,与其余 devflow 插件一样由用户 profile 组合;未组合时父子关系照常可用,只是没有完成门禁(可接受的降级)。
- **driver 跳过有子卡的卡**:派发前按 `parent` 过滤查一次该卡的子卡,有则记一条调试日志并跳过,队列与并发上限不受影响。这条规则不依赖门禁插件是否被组合,也不依赖部署把哪些阶段配成被驱动阶段。
- **族归档**:归档不再单独归档"父卡尚未完成"的 done 子卡;父卡 `done` 时,父卡与其全部子卡一起归入**父卡**最后一条 journal 条目所在的月份桶。不这么做,一个大需求的历史会被按月拆散、事后无法整体找回。没有父子关系的卡归档行为完全不变。

门禁只否决,不代替人或模型做移动:子卡全部完成不会自动把父卡推进。大需求的完成判据只有一个——全部子卡 `done` 加父卡自己走完流水线;不引入独立的 epic 验收清单。

## Acceptance criteria

- [ ] 子卡未全部 `done` 时,父卡 `-> done` 被否决,理由点名剩余子卡 id 与其当前阶段;全部子卡 `done` 后同一移动放行
- [ ] 无子卡的卡不受门禁影响;父卡的其余边(含进入 `blocked` 与打回)不受影响
- [ ] 门禁插件按真实 Loader 组合验证,fiber 处置后监听器摘除(HMR 安全);未组合该插件时父子关系仍可用
- [ ] 有子卡的卡进入被驱动阶段不派发并留下调试日志;子卡照常派发;跳过不影响队列顺序与并发上限
- [ ] 父卡未 `done` 时其已 `done` 的子卡留在活跃集,不被归档
- [ ] 父卡 `done` 后,父卡与全部子卡进入同一个月份桶(按父卡最后一条 journal 条目的月份);无父子关系的卡归档行为不回归
- [ ] 新包自带 `./invariant` companion(或给出包特定的空实现理由)、双语 README、config catalog 与 cordis catalog 门禁通过
- [ ] 逐文件覆盖率、Agent Note 同 PR

## Blocked by

- `.scratch/devflow/014-parent-child-cards.md`(门禁与 driver 跳过都要按 `parent` 过滤查子卡,族归档依赖 `DevCard.parent`)

## Resolution

Shipped on branch worktree-devflow-prd (`3cadcb689e`). New package `@zhchxiao123/dsh-devflow-parent-gate`: a `devflow/transition` listener that vetoes a card's move to `done` while any child sits elsewhere, naming each unfinished child with its stage; every other edge and every childless card delegates untouched, and a composition without the plugin keeps the relation unenforced. The driver checks for children before each dispatch and skips a decomposed requirement with a debug log naming the child count (an unreadable board skips too, since dispatching a possibly-parent card is the worse failure). `archiveDone` now archives families: a done child whose parent is still on the board stays with it, and once the parent is done the whole family lands in the parent's month bucket; a child that outlived its parent's archiving keeps its own month. The gate's invariant companion validates the same rule against the notification stream.

Verified: real Loader composition (veto naming the open child, no commit on veto, childless card and other edges unaffected, pass after the last child finishes) plus fiber-disposal HMR safety; driver tests for the parent skip and the undecidable-board skip; provider family-archiving test (held-back child, family bucket, orphan month, unchanged behavior without relations); invariant accept/reject. Per-file coverage 100%, typecheck, lint, doc-sync (28 gates), hygiene (only the pre-existing vendor-rescope drift remains) green.
