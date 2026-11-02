---
title: 'devflow 侧栏 tab 行为:角标、可用性、可见性重取门与会话绑定'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-board-in-sidebar.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-board-in-sidebar.md`

## What to build

让侧栏页真正表现得像一个 tab,而不只是"被塞进 tab 的面板"。四件事:

- **角标**:tab 图标旁显示本工作区进行中的卡片数。这是 v0.12.0+ 能力,**先按底座的能力清单探测再用**(`features` 含 `badge` 才给出该字段),探测不到就无角标、页面主体照常。底座每次渲染 tab 栏都会调用取值函数,取值必须廉价(从已有快照读,不发请求)。
- **可用性**:该会话工作区没有任何卡片时,`+` 菜单里的看板项显示为**不可用**而不是消失——能力存在、只是此处没有数据。注意底座的语义:可用性判定只影响 `+` 菜单,不拦截定向打开。
- **可见性重取门**:tab 组件收到的可见性信号为 false(面板折叠或切到别的 tab)时**不发请求**;恢复可见时补一次全量重取,而不是回放期间攒下的事件。事件订阅本身照常,只是不触发网络。
- **会话绑定**:侧栏页显示**它自己那个 scope 的会话**的工作区看板(底座把会话 scope 作为 props 交给页面),而不是"当前选中会话"。看板与详情的快照 store 因此按会话分桶;今天那段"会话切换 → 关详情 → 重取"的逻辑在侧栏路径下退役。悬浮兜底路径继续用"当前选中会话",行为不变。

不新增任何 Remote 面或缝操作;版面仍是 017 搬过去的样子(重设计是下一片)。

## Acceptance criteria

- [ ] 角标显示进行中卡片数,数字随卡片流转实时变化;底座不报告 `badge` 能力时不给该字段且页面正常
- [ ] 角标取值不发起请求(从已有快照派生),取值函数抛错不影响渲染
- [ ] 该会话工作区无卡片时 `+` 菜单项为禁用态(非隐藏);有卡片时可用
- [ ] 不可见时不发起任何看板/详情请求;恢复可见时恰好补一次全量重取
- [ ] 侧栏页显示自己 scope 会话的看板:两个不同会话的侧栏页各看各的工作区,互不串
- [ ] 快照 store 按会话分桶;悬浮兜底路径的"当前选中会话"行为与既有 e2e 断言不回归
- [ ] 组件层 jsdom 覆盖:角标与可用性的取值、可见性门(不可见零请求、恢复补取)、会话分桶
- [ ] 逐文件覆盖率、双语文案、Agent Note 同 PR

## Blocked by

- `.scratch/devflow/017-sidebar-tab-registration.md`(tab 描述符与侧栏渲染路径在那一片建立)

## Resolution

Shipped on branch devflow-sidebar (`3b2e221dc8`). Board state became one binding per session (board snapshot, detail snapshot, and the fetches that fill them), extracted so both surfaces share it: the floating control points its single binding at the selected session and keeps its existing selection-change behavior, while the sidebar surface holds one binding per page scope. A page watches its own scope while it is the visible tab and lets go when it is not; forwarded devflow events refetch the watched bindings plus the selected session's, so a background tab of another session costs nothing while the badge the user is looking at stays live. The selected session's board is also refreshed once per established connection and on every real selection change, which is what gives the badge and the `+` menu something to report before the page is opened. The badge (in-progress count, derived from the last fetch, never a request) is supplied only where the foundation announces the `badge` capability and counts in-progress through the same predicate as the page's stats head, so the two can never disagree; `available` returns false only for a workspace known to hold no cards, so an unfetched workspace stays openable. Both read-only callbacks look their binding up without creating one — the foundation calls them per tab-bar render for whichever scopes it holds.

Verified: plugin composition tests rendering the registered page as the foundation would — per-scope fetching, a hidden page costing nothing of its own, one fetch on becoming visible, events reaching watched scopes and the selected session only, badge presence gated on the capability and its value costing no request, availability across empty/unknown/non-empty workspaces, and the selection-change and connection refreshes including the no-selection case — plus jsdom tests for the page's own scope binding and watch/unwatch lifecycle. Per-file coverage 100%, typecheck, lint, doc-sync (28 gates) green.

Amended after review: the AC's literal "不可见时不发起任何看板/详情请求" lost to story 3 ("不展开面板也知道有没有在跑的活"). Gating every refetch on page visibility froze the badge exactly when it is the only thing on screen, so events now also refresh the selected session's binding — at most one extra scope, and every other scope still costs nothing without a visible page. Two review defects were fixed with it: the read-only callbacks were allocating a binding for every scope the foundation asked about, and the badge counted blocked cards as in-progress while the stats head did not.
