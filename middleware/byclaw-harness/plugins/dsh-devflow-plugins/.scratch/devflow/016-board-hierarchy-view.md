---
title: 'devflow 看板层级视图:父行子进度、折叠展开与详情上下钻取'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-requirement-breakdown.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-requirement-breakdown.md`

## What to build

看板从扁平列表变为一层层级,让一个大需求在面板上只占一行、并一眼看出进度:

- **父行**:显示 `k/n` 子进度(已 `done` 的子卡数 / 子卡总数)与"子卡中存在受阻或被打回"的标记,可折叠或展开其子行;子行缩进呈现,保持既有的行内容(状态点、id、标题、阶段、进度条、revision)。
- **详情上下钻取**:父卡详情增加子卡清单(id / 标题 / 阶段),点击任一子卡切到该子卡详情;子卡详情显示父卡反链,点击回到父卡详情。沿用既有详情态的只读约定与开关/焦点行为,不引入新 z-index 层。
- **降级**:父卡已归档而子卡仍活跃时(孤儿子卡),子卡平铺呈现,不因缺失父卡而报错或消失。

全部由客户端从已取回的卡片列表派生——列表面已返回整个 root 的卡片且带 `parent`,因此**零新增 Remote 面**,与既有"派生指标不进缝"同一条路线。胶囊计数口径不变,仍是活跃卡总数,父卡照常计入;层级只影响列表呈现。视图严格只读:分组与折叠是呈现,不是流转。

## Acceptance criteria

- [ ] 父行显示 `k/n` 子进度,子行缩进呈现在父行之下;折叠/展开可用且不影响其他行
- [ ] 子卡中存在受阻或被打回时,父行出现标记;全部子卡正常时无标记
- [ ] 父卡详情列出子卡清单并可点进任一子卡;子卡详情显示父卡反链并可点回
- [ ] 孤儿子卡(父卡已归档)平铺呈现,不报错;顶层无子卡的卡呈现与今天一致
- [ ] 胶囊计数口径不变;排序与既有行内容不回归
- [ ] 不新增任何 Remote 面或缝操作;前端仍无任何传路径的能力
- [ ] jsdom 组件测(`k/n`、折叠展开、受阻标记、上下钻取、孤儿降级、只读断言)+ 双工作区 e2e 增量:台子上播一个父卡与两张子卡,断言层级与 `k/n`;`/devflow move` 把最后一张子卡推到 `done` 后父行进度实时更新;tripwire 无错误
- [ ] 双语文案与 README、client catalog 门禁、逐文件覆盖率、Agent Note 同 PR

## Blocked by

- `.scratch/devflow/014-parent-child-cards.md`(层级全部由前端从列表面的 `parent` 字段派生)

## Resolution

Shipped on branch worktree-devflow-prd. The board groups one level deep from the listing it already fetches (`groupByParent` in the plugin's board module): the requirement leads, its children sit indented under it, and a child whose parent is absent is promoted to a top-level row so no card can vanish. The parent row carries `k/n` breakdown progress and a marker when a child is blocked; a per-row toggle folds the children away and back (view state of the open panel). The detail view gained a relations section — a child's parent backlink and a parent's child list, each drilling to that card's detail, with an archived parent degrading to its bare id. Zero new Remote faces or seam operations; the pill count and the footer totals keep counting every card. Half of the marker criterion is deliberately unmet: the listing carries current stages, not history, so a child reworked back to `developing` is indistinguishable from one that arrived there normally — surfacing rework on the parent row would need each child's journal, which the "no new Remote face" decision rules out. The gap is recorded in the package's Known Limitations.

Verified: `board.client.spec.ts` for the grouping (nesting, orphan promotion, active-first ordering at both levels), jsdom component tests (nesting order, `k/n` with and without a blocked child, collapse/expand, one opener per card, orphan flat, both drill directions, archived-parent text), and the real-browser e2e increment (a seeded decomposed requirement nests with `sub 1/2` + `blocked child`, collapse/expand, a `/devflow move` recovery clearing the marker live, and detail drill-down both ways). Per-file coverage 100% on the package, typecheck, lint, build, doc-sync (28 gates) green.
