---
title: 'devflow 看板工作区过滤:Remote workspace 解析 + 会话联动 + 双工作区 e2e'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`

## What to build

看板只显示当前会话所属工作区的卡,切会话自动切板。Remote 面新增 workspace id 参数,host 侧 BFF 查工作区注册表(canonical path)解析成根路径——浏览器绝不发送裸文件路径,这是安全边界;未分组会话按会话 cwd 走 host 侧同一条解析路径(以会话 id 换 cwd,仍不传路径)。看板 slot 本就是会话作用域:客户端由当前会话解析其工作区 id 后调 Remote,`card-created`/`stage-changed` 转发触发的重拉同样带上当前会话的维度。真实浏览器 e2e 覆盖双工作区场景:两个工作区各一张卡,两个会话切换,断言面板只显示所属工作区的卡、host 侧建卡后新行实时出现(一期"组件全绿、真实链路四个集成洞"的教训,这条测试缝必须与功能同 PR)。

## Acceptance criteria

- [ ] Remote 面收 workspace id 并在 host 侧解析;非法/未注册 id 得到稳定拒绝;客户端代码无任何传文件路径的能力
- [ ] 未分组会话以会话 id 在 host 侧换 cwd,看到按 `<cwd>/.devflow` 推导的板
- [ ] 切换会话时看板自动切换到对应工作区的卡,无手动过滤操作
- [ ] 双工作区真实浏览器 e2e:两工作区各一卡,切换会话断言互不串台;host 侧经 store 建卡(免模型)后当前工作区看板新行实时出现
- [ ] gateway 双端往返测试覆盖 workspace 解析与转发事件路径
- [ ] 文档与 Agent Note 同 PR

## Blocked by

- `.scratch/devflow/008-chat-card-creation.md`(e2e 断言建卡实时出现依赖 create;card-created 转发已存在)
- `.scratch/devflow/009-root-follows-caller.md`(Remote 面传递的 root 维度依赖缝多根化)

## Resolution

Shipped on branch worktree-devflow-prd, with one recorded design refinement: the Remote faces take the **viewing session's id**, not a separate workspace id. The board is always a session view, a grouped session's header cwd IS its workspace's canonical path, and one host-side resolution — live session registry first, else the persisted header via sessionPersistence, unknown session a stable rejection, cwd-less session the default root — covers grouped and ungrouped sessions through the same path the PRD prescribed for ungrouped ones. The browser therefore sends an id it already holds everywhere, no second identifier vocabulary crosses the wire, and no client code path can send a file path (root deliberately never rides CardFilter). The client scopes every fetch to the current selection and refetches once per real selection change (the sessions list store publishes far more often than the selection moves).

Verified: Definition-level resolution tests (live cwd, persisted cwd, cwd-less fallback, unknown-session rejection, no-session-service rejection over the real Remote adapters) + browser-half tests (session-scoped fetch argument, selection-change refetch, no refetch on unrelated list publishes, teardown) + the rewritten two-workspace real-browser e2e: two seeded sessions with distinct workspace cwds each show exactly their own card, switching sessions switches the board, and a `/devflow move` committed through the deterministic command plane updates the open board live over the real gateway and forwarded stage-changed — the full wire chain the AC's gateway round-trip called for, exercised end to end (the scaffold's seedSession gained a per-seed cwd for this). Per-file coverage 100% on touched sources; typecheck, lint, doc-sync, build all green.
