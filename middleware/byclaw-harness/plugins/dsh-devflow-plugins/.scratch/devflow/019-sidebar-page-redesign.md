---
title: 'devflow 侧栏页面重设计:统计头、阶段筛选、全高列表与分段详情'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-board-in-sidebar.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-board-in-sidebar.md`

## What to build

把搬进侧栏的那块 344px 面板重做成一个用得住整列高度的页面。自上而下三段:

- **统计头**:本工作区卡片分布——进行中 / 受阻 / 已完成的计数。下方一排**阶段筛选**:七个流水线阶段加 `blocked`,单选,再次点击当前选项即取消筛选。筛选是纯客户端派生(列表本来就全量取回),不新增请求、不新增 Remote 面。
- **卡片列表**:占满剩余高度并滚动。层级语义**完全沿用**既有实现——父卡领头、子卡缩进、`k/n` 拆分进度、受阻标记、每行折叠、孤儿子卡平铺;筛选命中子卡时其父行保留为上下文。
- **详情**:选中卡片后在同一页推入(带返回),内容分为**需求书 / 拆分关系 / 阶段产物 / 流转时间线**四段,每段可独立折叠,时间线默认展开。这是相对悬浮版最大的收益——时间线不再被压在 480px 高的盒子里。

另加**左右分栏开关**:通过底座的声明式设置(插件自有设置行,持久化在底座的插件设置 blob 里,无需宿主 schema 字段)提供一个开关,开启后宽面板下列表常驻左侧、详情在右侧并列;默认关。做成设置项而不是宽度断点——面板宽度由用户拖拽且跨会话共享,断点在 jsdom 里测不出真实布局,设置项既可测又可发现。窄面板下用户自己关掉即可。

页面保持**严格只读**:除折叠、筛选、返回、上下钻取外没有任何可交互元素;流转仍走聊天工具与 `/devflow`,审批仍走审批 composer。悬浮兜底路径的版面不动。

## Acceptance criteria

- [ ] 统计头显示进行中 / 受阻 / 已完成计数,随卡片流转实时更新
- [ ] 阶段筛选单选生效、再次点击取消;筛选为纯客户端派生,不产生额外请求
- [ ] 筛选命中子卡时其父行作为上下文保留,层级不被打散
- [ ] 列表占满剩余高度并独立滚动;层级语义(父行 `k/n`、受阻标记、折叠、孤儿平铺)与既有断言一致
- [ ] 详情四段各自可折叠,时间线默认展开;四段内容与既有详情一致(需求书 Markdown 只读、拆分关系可钻取、产物清单、时间线含执行者/原因/审批/接管)
- [ ] 左右分栏开关出现在设置页该卡片的设置里,开启后列表与详情并列、关闭后回到单栏两态;默认关
- [ ] 严格只读:除折叠 / 筛选 / 返回 / 钻取外无按钮或输入
- [ ] 组件层 jsdom 覆盖:统计头取值、筛选与父行保留、四段折叠、分栏两态、只读断言
- [ ] 悬浮兜底路径版面不变,既有双工作区 e2e 全绿
- [ ] 双语文案(含设置行)、README、client catalog 门禁、逐文件覆盖率、Agent Note 同 PR
- [ ] 真机手测并录制 GIF 附 PR(侧栏形态的端到端无法自动化,PRD 已接受这一缺口)

## Blocked by

- `.scratch/devflow/017-sidebar-tab-registration.md`(页面外壳渲染在那一片建立的侧栏路径里;不依赖 018)

## Resolution

Shipped on branch devflow-sidebar. The page became a full-height column: a stats head (total, then in progress / blocked / done — three buckets that partition it, the blocked count toned when non-zero), a row of stage chips that narrow the list to one location (single-select, pressing the active chip clears it, entirely client-derived from the listing already fetched), and the grouped list filling the remaining height. Narrowing keeps a matching slice's requirement as its context and leaves its `k/n` counting the whole breakdown, not the filtered view. Opening a card replaces the list with its detail sheet, whose four blocks — requirement, breakdown, artifacts, timeline — render as foldable sections that all arrive open; the floating panel keeps its flat sheet unchanged. A side-by-side switch registered through the foundation's declarative page settings (gated on the `pluginSettings` and `stateSubscription` capabilities) keeps the list beside an open detail, with the back control giving way to a close one.

Verified: jsdom suite for the stats head, filtering with parent context and unfiltered `k/n`, the four foldable sections with the timeline open, split versus stacked layout and its close intent, the stacked fallback where the foundation cannot carry the preference, and a read-only assertion enumerating every control on the page (folds and the way back, nothing else, checklist inputs disabled); plugin composition test for the settings row's key and localized copy plus the page reading the persisted value. The floating surface's own tests and the two-workspace browser e2e (which runs the floating path, since the foundation is not in the test lanes) stayed green. Per-file coverage 100%, typecheck, lint, build, doc-sync (28 gates), hygiene green.

Not automated: the real sidebar rendering. The foundation cannot be booted in this repository's lanes, so the page is proven against a stubbed service and in jsdom; the PRD accepts hand verification plus a GIF on a profile that installs the foundation.
