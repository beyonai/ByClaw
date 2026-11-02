---
title: 'devflow journal 沙箱只读:文件策略剔除 .devflow/** 写权限 + 执行器面拒绝测试'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`

## What to build

封掉一期的已知限制:拥有 workspace-write 的开发 agent 能物理改写工作区内的 journal。用既有的文件策略能力把 `.devflow/**` 从开发 agent 的可写集中剔除:代码随便写,流程状态只能经 devflow 工具走执行器(CAS、边合法性、reason 要求、门禁全在那里)。devflow 工具的变更全部发生在 host 侧 store、不经过 agent 的文件工具,因此加固不影响任何正常流转。策略作为部署配置交付(与门禁配置同处 profile),不硬编码在插件里。强制执行发生在做决策的操作里,而不是"工具不提供"这种可绕开的表面约束。

## Acceptance criteria

- [ ] 策略生效时,agent 的文件写工具对 `.devflow/**` 内任意路径(journal、card.md、claim)被拒,拒绝断言在执行器面
- [ ] 同一策略生效时,devflow 工具的建卡与流转全部成功(加固不牺牲功能)
- [ ] 策略是 profile/cordis.yml 部署配置,插件内无硬编码路径规则
- [ ] 文档给出与门禁配置同处的 profile 配置示例
- [ ] Agent Note 同 PR

## Blocked by

None - can start immediately(独立于 008/009)

## Resolution

Shipped on branch worktree-devflow-prd as the new policy plugin `@zhchxiao123/dsh-devflow-fs-guard`: it registers deny listeners on the existing `fs/write-intent`/`fs/edit-intent` waterfalls the file tools dispatch before every mutation (the fs-observation-policy slot), throwing the structured `FS_SANDBOX_DENIED` with a message that points the model at devflow_transition/devflow_create when a target path contains a protected directory segment. Protected names are deployment config (`directories`, default `['.devflow']`; empty or ill-formed lists fail the load), delivered beside the gate configuration in the profile — no hardcoded path rules in any devflow plugin. Reads pass through. The devflow store writes host-side with plain node fs, so the transition executor stays the only write path and keeps working unchanged under the active policy.

Verified by the package's real-Loader composition suite: forged journal append and projection edit through the `write`/`edit` tools are denied in the executor with the journal byte-identical afterwards, ordinary workspace code stays writable, and the same session's devflow_transition and devflow_create succeed under the same active policy; custom `directories` override honored (default name then unprotected); load failures for empty/ill-formed lists; direct-load default coverage. Per-file coverage 100%, typecheck, lint, doc-sync (config catalog + event matrix + subsystem prose bilingually), and hygiene green except the pre-existing vendor-rescope drift (knip-logger-console / vendoring-cookbook-zh), which predates this branch's changes. Deferred (recorded in the README and Agent Note): carving the protected directories out of the shared sandbox `writableRoots` so the fence also covers bash.
