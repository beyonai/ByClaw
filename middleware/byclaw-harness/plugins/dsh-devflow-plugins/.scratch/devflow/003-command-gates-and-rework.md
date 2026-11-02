---
title: 'devflow 命令门禁与打回：gates waterfall 监听器 + attach_artifact'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-25
prd: .agents/prd/2026-08-25-devflow-file-based-dev-state.md
---

## Parent

PRD：`.agents/prd/2026-08-25-devflow-file-based-dev-state.md`

## What to build

门禁插件：在 `devflow/transition` waterfall 上挂监听器，按配置对指定边执行门禁命令（经 `ctx.shell`，与卡片 frontmatter 的边级覆盖合并），失败即不调 `next()` 带理由否决——短路即否决是该单决策事件的设计本身。同时补打回边语义（reviewing/testing → developing 必须附理由入 journal）与 `devflow_attach_artifact` 模型工具（阶段产物登记）。门禁定义在流程配置里而非卡片可写区，防被开发 agent 篡改。演示效果：测试红时 agent 的流转申请被拒且理由可读；评审 agent 打回并留下理由。

## Acceptance criteria

- [ ] 配置了门禁命令的边：命令非零退出 → 流转被拒，拒绝理由含命令输出摘要并入 journal
- [ ] 命令全绿 → 流转照常提交；未配置门禁的边不受影响
- [ ] 卡片级门禁覆盖与全局配置正确合并；门禁命令来源不含卡片正文可写区
- [ ] 打回边缺理由被拒；有理由时理由完整入 journal 并在 show 中可见
- [ ] attach_artifact 登记的产物路径出现在卡片历史中
- [ ] 第三方插件可另挂 waterfall 监听器叠加否决（策略扩展点有测试证明）
- [ ] snapshot：一次被门禁拒绝 + 一次打回的转写

## Blocked by

- `.scratch/devflow/002-transition-write-path.md`

## Resolution

Shipped in commits dbd9eb4561 + the lint follow-up (branch worktree-devflow-prd). All acceptance criteria met, with one recorded adaptation:
- "Card-level gate overrides" are configuration keyed by card id (`cards["<id>"]["from->to"]`), not card-frontmatter state: the issue also required gate sources to exclude card-writable files, and frontmatter is writable by the developing agent, so both requirements resolve to config-only sources.
Also shipped here: the transition waterfall now dispatches a complete `TransitionAttempt` (spec plus departure location) — discovered while keying gates on edges — and rework-reason enforcement lives in the executor as the stable `reason-required` rejection.
Verified: 79 package tests (scripted-shell gate matrix, veto-before-commit, output truncation, card overrides, HMR disposal, plus a REAL Loader composition running actual bash gate commands), per-file coverage thresholds, scoped typecheck/lint, and the touched doc-sync gates.
