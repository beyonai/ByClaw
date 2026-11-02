---
title: 'devflow 清理残余与自足判据:删两个 session 事件、悬浮面自持 Esc'
labels: [kind/refactor, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-standalone-plugin.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-standalone-plugin.md`

## What to build

收掉最后两处对 harness 源码的依赖,并把"自足"变成一条可执行的判据。

**删掉两个 session 事件**:`devflow/created` 与 `devflow/transition` 的 `SessionEventMap` 声明,以及那两次 `Session.append`。全仓没有任何读取方,而工具调用本身已由 `tool/call` / `tool/result` 记入日志,这两条是冗余痕迹。这不只是"少个特性":一个 harness 不认识、又没有 `ignorable` 标记的事件出现在日志里,读取方会**拒绝重建整个会话**——那是它写在类型注释里的刻意设计,所以原样发布会损坏没有对应改动的 harness 上的用户会话。`packages/core/session/src/known-event-types.ts` 是生成物,声明消失后重新生成即自动回到上游状态。

**悬浮面自持 `escapeDismissHandler`**:在 `ui-devflow` 内保留自己的一份键盘处理,不再引用 `ui-primitives` 的抽取。那次抽取本身**保留**(ui-jobs 在用,是本仓库自己的正当重构),但它 JSDoc 里的 devflow 提及要去掉。悬浮面的 Esc 关闭行为逐字节不变。

**gateway 参数校验修复整理成独立提交**:生成的调用面允许省略尾部可选参数、校验却按满参检查——那是与 devflow 无关的真 bug。把它连同自己的测试与说明整理成一个可以直接提上游 PR 的独立提交,留在本仓库。devflow 解耦后不再依赖它(自持路由不经 Typert gateway)。

**自足判据**:`git diff origin/master -- packages/api packages/core packages/client/ui-primitives` 不含 devflow 引用,输出贴进 PR 描述。判据针对的是**源码**;`gen-tool-catalog` 之类枚举工作区现有包的生成物 / 清单测试不在其内——它们列的是"此刻组合了哪些包",搬家时自然清空。

## Acceptance criteria

- [ ] `devflow/created` / `devflow/transition` 的 `SessionEventMap` 声明与两次 `append` 全部删除;`known-event-types.ts` 重新生成后与 `origin/master` 逐行一致
- [ ] 有测试或说明证明:装了 devflow 的部署不再写入这两条事件,没装 devflow 的 harness 读任何历史会话不受影响
- [ ] 悬浮面自持 Esc 关闭,行为不变(既有悬浮面测试不改断言即通过)
- [ ] `ui-primitives` 的 `escapeDismissHandler` 保留给 ui-jobs,其 JSDoc 不再提 devflow;`ui-devflow` 不再依赖该导出,client 纯度门与 hygiene(knip)通过
- [ ] gateway 参数校验修复独立成一个提交,带自己的测试与说明,可直接摘出提上游
- [ ] `git diff origin/master -- packages/api packages/core packages/client/ui-primitives` 无 devflow 引用,命令输出进 PR 描述
- [ ] 全套 devflow 相关测试、双工作区 e2e、doc-sync、hygiene 全绿
- [ ] Agent Note 收口整条解耦线(通路从"框架转发"换成"插件自持"的决定、被否的替代、以及三个仍待上游的口子:转发事件的运行时注册面、`Session.append` 的 `ignorable` 选项、gateway 参数校验)

## Blocked by

- `.scratch/devflow/021-self-hosted-push-face.md`(自足判据要 021 先把 `packages/api/` 清干净才可能通过)

## Resolution

Shipped on branch devflow-sidebar. `devflow/created` and `devflow/transition` are gone — the two `Session.append` calls, the `SessionEventMap` declarations, and the module that held them (`tool-devflow/src/types.ts` existed for nothing else, so its `./types` export and `paths` entry went too). Regenerating `known-event-types.ts` returned it to master byte for byte.

One AC was reversed after review: **the floating board does not hold its own copy of `escapeDismissHandler`.** It was written that way and then reverted, because the stated rationale did not survive inspection — `DevflowBoardAction.tsx` imports `StateDot`, `IconChevronDownOutline14`, and `useDismissOnOutsidePointer` from `ui-primitives` in the same statement, so a private copy of the fourth import avoids no dependency and only guarantees the two copies drift. What the criterion was actually after is done: `ui-primitives` keeps the extraction, now with two ordinary consumers and a doc that no longer names devflow, so nothing in that package traces to this plugin line.

The criterion:

```
$ git diff origin/master -- packages/api packages/core packages/client/ui-primitives | grep -i devflow
+      'devflow_attach_artifact', 'devflow_create', 'devflow_list', 'devflow_show', 'devflow_take', 'devflow_transition',
```

That one line is `packages/core/tools/tests/gen-tool-catalog.spec.ts`, the generated inventory of whichever tool packages the workspace holds — the case this issue scopes out, and it empties itself when these packages move out. Everything else left in those trees is unrelated to devflow: the Gateway arity fix and the `escapeDismissHandler` extraction.

The gateway fix needed no isolating: it is already `b8368b8744`, a single commit touching only `packages/api/gateway` — the fix, its test, and its README — so it can be proposed upstream by cherry-pick. devflow no longer depends on it, having no Typert Remote face left to call.

One AC reading was resolved rather than taken literally: the replaced session-event assertions could not become `tool/call` / `tool/result` assertions in that suite, because it invokes tools through the executor directly rather than through the agent loop, so no tool records land in the session. They assert what actually changed instead — the card journal stays the authority (already asserted in the same tests) and the session log carries no devflow-shaped event at all.

Verified: the tool-devflow real Loader composition suite, the devflow and ui-devflow suites, the two-workspace browser e2e, per-file coverage 100% on every touched file, typecheck, lint, build, doc-sync (28 gates), hygiene, duplication. Full `pnpm run test`: 14832 passed, 8 failed — all pre-existing and environmental (subprocess process-exit ×5, `ui-theme` scrollbar rebind ×1, tool-skill catalog ×2), none in a file this branch touched. `rescope-vendor` drift and the one jscpd clone inside `tool-devflow` also predate this branch.
