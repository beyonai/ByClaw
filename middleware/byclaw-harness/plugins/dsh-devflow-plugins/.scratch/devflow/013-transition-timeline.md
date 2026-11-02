---
title: 'devflow 流转时间线:缝 history/holder + Remote detail 聚合 + 会话反链'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-card-detail-view.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-card-detail-view.md`

## What to build

给详情抽屉补上历史与归属:缝新增两个细粒度读操作——`history(id, root?)` 返回解码后的完整 journal 条目(结构非法 fail-loud 指明文件与行号,同 read),`holder(id, root?)` 返回当前租约持有者 `{ owner, heartbeatAt }`(无租约 undefined,损坏的 claim 文件 fail-loud);Remote 面新增聚合 `detail(id, sessionId)` 一次往返返回 `{ card, entries, holder }`,session→root 解析沿用既有的 host 侧路径(浏览器仍只发 id)。抽屉的时间线段逐条呈现 created/transition/artifact/claim-expired:执行者(human/agent 会话/command)、时间、边、打回 `reason`、审批签名 `gate.approvedBy`、接管的前任持有者;头部显示当前持有者与心跳新鲜度。`kind: 'agent'` 的执行者按 session id 渲染为可点击链接,点击用客户端既有能力切到那次会话,目标会话不在列表则退化为纯文本。每阶段停留时长、卡片总年龄、打回次数由客户端从条目派生;`at` 不可解析(手写 journal 的 `t1` 之类)只省略时长,渲染不失败。详情的实时性沿用整卡重取:命中当前卡的转发事件即重取 `detail`。

## Acceptance criteria

- [ ] `history`/`holder` 经 store 公开面验证:完整时间线解码回放、非法 journal fail-loud、无租约 undefined、损坏 claim fail-loud、多根下按 root 取历史
- [ ] Remote `detail` 聚合经 Definition 层验证(真实 Remote 适配器 + sessions/sessionPersistence 桩):session 解析、未知会话稳定拒绝、聚合结果拼装
- [ ] 时间线呈现全部四种条目,含打回 reason、审批签名与接管前任;头部持有者与心跳新鲜度正确
- [ ] agent 执行者可点击跳转对应会话;会话已删退化为纯文本
- [ ] 阶段时长/卡龄/打回次数客户端派生;`at` 不可解析仅省略时长
- [ ] `/devflow move` 后打开中的详情实时出现新时间线条目(e2e 增量)
- [ ] 详情仍严格只读(除关闭/返回与会话链接外无可交互元素)
- [ ] jsdom 组件测试 + 文档与 Agent Note 同 PR

## Blocked by

- `.scratch/devflow/012-card-detail-drawer.md`(时间线渲染进 012 的抽屉容器)

## Resolution

Shipped on branch worktree-devflow-prd. The seam grew `history(id, root?)` (the complete decoded journal in revision order, stream-validated exactly like a read so a broken journal fails loudly in both views, `path:line` attribution intact) and `holder(id, root?)` (the claim record's `{owner, heartbeatAt}`, `undefined` while unclaimed, loud on a corrupt file); the shared decode step was extracted from `foldJournalFile` rather than duplicated. The Remote face aggregates them with the read value behind one `detail(id, sessionId)` call resolved through the same session-to-root path — one round trip, ids only on the wire, unknown sessions the same stable rejection.

The drawer's timeline renders newest-first: per-entry headline (creation, `from → to` move with localized stage names, artifact registration, lease takeover with the evicted owner), actor (agent sessions the client list knew at load time become backlinks through the client sessions service's own `open`; vanished sessions stay plain text), rework reason, and approval signature; the section head shows the current holder with heartbeat freshness plus client-derived card age and rework count, and per-entry stayed durations derive from consecutive timestamps — every metric quietly disappears when a hand-written timestamp does not parse, so scripted cards render fine. The seam grew no statistics API.

Verified: provider history/holder specs (decoded order, malformed-entry and broken-stream fail-loud, root scoping, unclaimed undefined, corrupt claim loud) + Definition-level `detail` aggregation over the real Remote adapters (one resolved root across all three faces, holder key omitted while unclaimed, session resolution and rejections riding the 010 suite) + jsdom timeline suite (all four entry kinds, reasons, approvals, takeovers, holder freshness, backlink vs plain text, unparseable-timestamp degradation, rework counting, anonymous actors, empty timeline) + plugin suite (aggregated fetch, openable-session computation, openSession routing, stale/failure guards) + the real-browser e2e increment (timeline visible in the open detail, `/devflow move` appends a live `designing → ready` entry). Per-file coverage 100% on touched sources; typecheck, lint, doc-sync (catalogs and READMEs bilingually), build, and the one end-of-work full-suite run green except the known pre-existing environmental failures (subprocess exit timeouts, scrollbar rebind, skill-catalog directory leakage), all outside these slices' surfaces.
