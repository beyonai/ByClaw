---
title: 'devflow Web 只读进度面板：host 投影 + 右上角胶囊/浮层'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-25
prd: .agents/prd/2026-08-25-devflow-file-based-dev-state.md
---

## Parent

PRD：`.agents/prd/2026-08-25-devflow-file-based-dev-state.md`

## What to build

Web 聊天页的进度展示，纯只读。host 端注册 `devflow` 投影（由 journal 折叠出卡片列表、阶段、门禁状态、待审批计数的整值）；浏览器插件消费该投影（零领域 store），在会话区右上角渲染两态组件：收起态胶囊徽标（进行中数量 + 待审批数），展开态浮层面板（焦点卡阶段条、门禁状态、变更统计、分支，「查看全部」进入全量列表与本会话过滤）。焦点卡选择：待审批 > 本会话在推进 > 最近变更。披露规则沿用既有约定：待审批到达自动展开一次、处理完自动收起一次、用户手动选择不被覆盖。窄视口退化为底部抽屉。本切片不含任何可操作元素（审批行在后续切片）。

## Acceptance criteria

- [ ] 冷加载、live append、历史分页 prepend 三种路径产出相同面板状态（投影一致性）
- [ ] 卡片流转后两个已打开的浏览器会话都看到更新
- [ ] 胶囊计数与面板内容仅来自投影值；插件不发出任何 mutation
- [ ] 自动展开/收起与用户手动固定的优先级符合披露规则
- [ ] 插件 dispose 后面板与胶囊消失，会话页其余部分不受影响
- [ ] 窄视口（< 780px）呈现底部抽屉形态
- [ ] PR 附真实服务与模型流程录制的 GIF

## Blocked by

- `.scratch/devflow/002-transition-write-path.md`

## Resolution

Shipped across commits 0d76923d91, 167a94f7be, a58e567a6b, c1dbae5b95 and the docs follow-up (branch worktree-devflow-prd). The data channel and surface differ from the design sketch in recorded ways:
- Channel: instead of a bespoke host projection, the read side rides the existing Remote BFF — `DevflowStore` extends `TypertRemoteService` with `@Remote` list/read faces, the remotes client assembly mounts the generated devflow namespace, and `devflow/stage-changed` joins the forwarded-event allowlist. The client plugin fetches once at activation and once per forwarded event into a plugin-owned observable snapshot (hooks compartment), so the pill and panel always show one fetch's cards.
- Surface: the "top-right floating panel" is realized as a session-header action (the repo's canonical top-right surface, precedent ui-jobs): a pill with the active count and a read-only popover listing id/stage dot/title/localized stage (+blocked origin)/revision. The focus-card mini stage bar, "view all" second page, and auto-expand-on-approval disclosure are deferred: approvals already surface through the existing approval composer (gates route them over ctx.approval), so the panel carries no actionable rows.
- Multi-window consistency holds through the forwarded event; a workspace without devflow renders no control.
Verified: 3 jsdom component tests + both compiler faces + client-packages/model-experience/limitations/invariants/pairing gates; the client-domain-graph verifier reports 27 pre-existing violations inside packages/client/runtime untouched by this change. The PR-required GIF needs a running web app with a real model and is deferred with the e2e work.
