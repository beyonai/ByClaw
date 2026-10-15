---
title: 'devflow 详情抽屉:点击看板行进入只读需求书视图'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-card-detail-view.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-card-detail-view.md`

## What to build

看板行变为可点击:点击一行,在与看板同一 body-portal 层内进入该卡的只读详情态(列表 ↔ 详情双态,详情内可返回列表,Esc/点击外部关闭并把焦点归还触发元素;不引入新 z-index 层)。详情的需求书段包含:标题与 id、放大的阶段流水线(七段进度条加阶段名标注,受阻卡标注受阻来源)、revision、`body` 的 Markdown 渲染(验收标准的 `- [ ]` 按只读清单呈现,复选框不可交互)、已登记产物清单与卡片文件路径。数据用既有的 Remote `read(id, sessionId)` 面,点击行时拉取(列表保持轻,不预取正文);打开中的详情收到命中当前卡的转发事件(`stage-changed`/`card-created`)即重取。详情严格只读:除关闭/返回外无可交互元素,流转仍走聊天工具与 `/devflow`。**前置重构**:Markdown 正文渲染复用客户端既有渲染件;若 client 纯度门禁不允许跨插件值引用,按 ui-primitives 先例把渲染件提取为共享件,不在看板插件里重写渲染器。

## Acceptance criteria

- [ ] 点击看板行打开详情,正文 Markdown 渲染(标题层级、代码块、只读验收清单),产物清单与路径可见
- [ ] 放大阶段流水线显示当前位置;受阻卡显示受阻来源阶段
- [ ] 返回列表、Esc 与外点关闭均可用,关闭后焦点归还;列表行为(胶囊计数、排序)不变
- [ ] 详情数据经既有 Remote `read` 面按当前会话拉取;前端无任何传路径的能力
- [ ] 打开中的详情在该卡被 `/devflow move` 移动后实时刷新(阶段流水线更新)
- [ ] 除关闭/返回外无按钮或输入;渲染件复用不违反 client 纯度门禁
- [ ] jsdom 组件测试(开/关/焦点、渲染、只读断言)+ 既有双工作区 e2e 增量(点行开详情断言正文,move 后详情刷新)
- [ ] 文档与 Agent Note 同 PR

## Blocked by

None - can start immediately

## Resolution

Shipped on branch worktree-devflow-prd. Board rows became opener buttons; the panel gained a second, widened state that swaps the list for the clicked card's read-only detail: identity line, an enlarged pipeline naming every stage (blocked origin marked), the requirement Markdown rendered through the ALREADY-EXISTING shared `MarkdownText` primitive from ui-primitives (no extraction needed — the prefactor turned out to be free; GFM checklist checkboxes arrive disabled), the artifact list with an explicit empty label, and the card file path. The plugin owns a `detail` observable (closed/loading/loaded) beside the board source and injects `openCardDetail`/`closeCardDetail`; each open fetches once through the existing Remote `read(id, sessionId)` (zero seam/wire change, no client path capability), the open detail rides every event-driven board refresh, a stale settlement never clobbers a newer open (id-compare guards open/close/reopen races), a failed or rejected fetch closes back to the list, a session switch closes the detail, and Esc/outside/collapse close the whole popover with focus return.

Verified: jsdom component suite (row click intent, loaded detail rendering with disabled checklist, loading placeholder, empty artifacts + empty body, back intent, per-row single-opener read-only assertion) + browser-half plugin suite (session-scoped read argument, event-driven detail refetch, stop after close, session-switch close, stale-settlement and late-rejection guards, fetch-failure close) + the real-browser e2e increment (open detail from a row, requirement heading and checklist visible, `/devflow move` advances the open detail's current pipeline stage live, back returns to the list). Per-file coverage 100% on the package, typecheck, lint, doc-sync, build all green.
