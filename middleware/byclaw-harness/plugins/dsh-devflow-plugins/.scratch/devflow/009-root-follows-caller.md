---
title: 'devflow root 按调用方解析:provider 多根化 + 工具/命令按会话 cwd 推导'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`

## What to build

把"用哪个根"从全局配置变为按调用方解析的显式维度。缝的每个操作携带 canonical root(目录路径),进入既有的 request/spec 显式 defaulting 步骤;读侧 `DevCard` 增加只读 root,使 gates/driver 从事件携带的卡片就能跟对目录;每卡串行锁的 key 从卡 id 变为 root+id。模型工具与 `/devflow` 命令从发起 agent 的会话 cwd 推导 `<cwd>/.devflow`;driver 按工作区根集合派发,门禁命令在卡片所属工作区目录里执行;归档、租约、投影重写全部按卡片所属根进行。配置项 `root` 降级为"调用方无法推导时的默认根",现有单根手动用法零迁移。workspace→root 的映射不进 Definition——devflow 缝只认目录。

## Acceptance criteria

- [ ] 缝操作携带 canonical root,defaulting 是 provider 内显式的 resolve 步骤而非隐式 `??`
- [ ] `DevCard` 携带只读 root;每卡串行化以 root+id 为 key(不同根的同名 id 互不阻塞)
- [ ] 工具与 `/devflow` 命令作用于发起会话 cwd 下的 `.devflow`,两个 cwd 不同的会话互不见对方的卡(组合测试)
- [ ] 门禁命令在卡片所属根的工作区目录执行;driver 派发不跨根串台
- [ ] 归档、claim 租约、card.md 投影重写按卡片所属根进行,语义与单根时一致
- [ ] 仅配置全局 root 的老用法(既有 example/snapshot)行为不变
- [ ] 文档与 Agent Note 同 PR

## Blocked by

None - can start immediately(与 008 并行)

## Resolution

Shipped on branch worktree-devflow-prd. The root became an explicit seam dimension resolved per call: reads take a trailing optional `root`, requests carry an optional `root` field resolved into their specs by the explicit defaulting steps (`resolve`, `resolveCreate`, and the provider's `resolveRoot` funnel for the spec-less operations), and `ClaimOptions` carries one for the lease. `DevCard` gained readonly `root` (resolved absolute path); per-card serialization and driver book-keeping key on root+id; creation chains serialize per root. The model tools and `/devflow` derive `<session cwd>/.devflow` from the invoking session header (no cwd → configured default root, so the old single-root usage and the Remote read faces are unchanged); gates run their commands in `dirname(attempt.root)` and park in the attempt's root; the driver claims, heartbeats, reads, and parks in the moved card's own root. Config `root` is now documented as the fallback default. Root never rides `CardFilter`, so the Remote wire still cannot carry paths.

Verified: multi-root store spec (scoped list/read, same-id independence with per-root events and journals, root-scoped create/claim/attach/archive) + two-workspace tool composition (create/list/show/transition/take/attach isolation, rootless fallback) + workspace-scoped `/devflow` composition + gate-workdir assertion + cross-root driver dispatch (lease and parking in the card's root); per-file coverage 100% on the devflow packages; typecheck, lint, doc-sync (catalogs and subsystem fences regenerated bilingually), build, and the board web e2e all green. The driver's activation sweep still covers only the default root (documented limitation; other roots dispatch via stage-changed) — the workspace-registry-driven board resolution is slice 010.
