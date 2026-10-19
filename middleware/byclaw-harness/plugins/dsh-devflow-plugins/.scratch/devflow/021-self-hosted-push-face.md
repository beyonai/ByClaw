---
title: 'devflow 自持推送面:插件自己的 WS,并回滚 api/remotes'
labels: [kind/refactor, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-standalone-plugin.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-standalone-plugin.md`

## What to build

把看板的**实时刷新**从框架的转发事件白名单换成 devflow 自己的 WS,然后回滚那份白名单——`API_REMOTE_FORWARDED_EVENTS` 是硬编码 `as const` 数组,注释明说"转发多一个事件就是在这里加一项,没有别的办法",它是 devflow 无法自足的两个致命项之一。

**推送面**:`ctx.webServer.registerUpgrade({ path: '/devflow/ws', handler })`,握手过与读取面同一条可信来源门。host 侧监听 `devflow/card-created` 与 `devflow/stage-changed`,向已连接的 socket 推一帧。

- **帧只报"哪个 root 变了"**:事件名 + 受影响的 root(或会话 id),不带卡片负载。带负载会把推送快照与重取结果拉成两条真相源。
- **客户端据帧重取**:重取的绑定集合与今天收到转发事件后逐条一致——可见页面关注的 scope,加上被选中会话(角标与 `+` 菜单报告的那个)。
- **断开可恢复**:重连(带退避)或退化为按需重取,一次网络抖动不让看板永久停更。
- **处置对称**:fiber 处置后升级路径撤销、事件监听摘除、在连 socket 关闭。

**回滚 `api/remotes` 与 `apiproxy` 的 devflow 痕迹**:

- `packages/api/remotes/src/remote-events.ts` 的白名单两项;
- `packages/api/remotes/src/index.ts` 与 `packages/host/apiproxy/src/api-proxy.ts` 的 `import type {} from '@zhchxiao123/dsh-devflow/types'`;
- `packages/api/remotes/src/client/index.ts` 的 `devflowRemote` import 与注册。

**devflow 的 Typert Remote 面随之退役**:`@zhchxiao123/dsh-devflow` 的 `./typert` 与 `./remote` 导出、`remoteExport*` 注解与生成物。那几个会话作用域读方法本身留下来给 Web 适配器调用,但名字不该再自称 remote。`ui-devflow` 的 `inject` 去掉 `remote` 与 `remote.devflow`,`binding.ts` 去掉两行 type-only import。

片尾,`packages/api/` 与 `packages/host/apiproxy/` 上应当再无任何 devflow 引用。

## Acceptance criteria

- [ ] `/devflow/ws` 升级端点注册;不可信来源的握手被拒绝升级
- [ ] host 监听 `devflow/card-created` 与 `devflow/stage-changed`,向已连接 socket 推帧;帧内只有事件名与受影响 root(或会话 id),不含卡片内容
- [ ] 已断开的 socket 不再收到帧;fiber 处置后监听摘除、端点撤销、在连 socket 关闭
- [ ] 客户端收帧后重取的绑定集合与既有转发事件路径逐条一致(可见页面 scope + 被选中会话)
- [ ] WS 断开后可恢复:重连或退化为按需重取,有测试证明看板不会永久停更
- [ ] `API_REMOTE_FORWARDED_EVENTS` 的两项、两处 type-only import、`devflowRemote` 注册全部移除;`git diff origin/master -- packages/api packages/host/apiproxy` 不含 devflow 引用
- [ ] devflow 包不再导出 Typert Remote 面(`./typert` / `./remote` 与生成物一并退役),读方法名不再自称 remote
- [ ] `ui-devflow` 的 `inject` 不含 `remote` 与 `remote.devflow`;`binding.ts` 不再 type-only import Remote 声明
- [ ] 双工作区真实浏览器 e2e 全绿——它此时跑的已经是自持 HTTP + 自持 WS 的完整读路径
- [ ] 受影响的双语 README(devflow-web / ui-devflow / devflow)、catalog 门禁重生成、hygiene(knip 无死导出)、逐文件 100% 覆盖率、Agent Note 同 PR

## Blocked by

- `.scratch/devflow/020-self-hosted-read-face.md`(WS 端点与读取面同包同一条可信来源门;白名单只有在客户端不再依赖转发事件之后才能拆)

## Resolution

Shipped on branch devflow-sidebar. `/devflow/ws` is an upgrade endpoint in the same package behind the same fence: the host listens for `devflow/card-created` and `devflow/stage-changed` and sends every connected socket one frame. The channel is one-way — a client that speaks is closed with 1008, an invalid client frame drops that socket alone, and disposal takes the endpoint, both listeners, and every live socket down together. On the browser side a new binding-layer sibling owns the socket: it refetches on every frame and on every open (the first and every reopen, since a board that was down cannot know what it missed), and reopens on a fixed delay after a drop, so one network blip never leaves the board permanently stale.

The rollback landed with it. `API_REMOTE_FORWARDED_EVENTS` lost its two devflow entries; the two `import type {} from '@zhchxiao123/dsh-devflow/types'` lines and the `devflowRemote` mount are gone, as are the now-unused package.json dependencies and tsconfig references in `api/remotes` and `apiproxy`. The store's Typert Remote face retired with them: `DevflowStore` is a plain `Service` again, the `@Remote` decorators and the `./typert` / `./remote` exports are gone, and `readForSession` — which never had a browser consumer — went with them. `ui-devflow` injects `sessions`, `slots`, and `locale` only; board data needs no service at all. `git diff origin/master -- packages/api packages/host/apiproxy` now contains no devflow reference.

One deliberate deviation, recorded rather than silently taken: **the frame does not name the affected root.** The acceptance criteria ask for both "the frame carries the affected root" and "the refetch set matches the forwarded-event path item for item" — and the second forecloses the first. The browser keys bindings on session id and has no root-to-page map, so it cannot act on a root; shipping the field would put an unread value on a published wire, which `packages/AGENTS.md` refuses. The frame therefore carries the event name alone, and the README records the missing map as the deferred work.

Review found the reconnect met the liveness goal but not the criterion's wording (`重连(带退避)`): the first version reopened on a flat two-second delay forever. It now doubles from two seconds toward a thirty-second ceiling and resets on the next open, so one blip costs the floor while a host that stays down is not hammered.

Two smaller changes fell out of the rollback: the eager `connection/reset` refetch became the change stream's own open (the chat connection resetting is no longer related to this channel), and the plugin's client tests drive a stubbed `WebSocket` where they used to call a captured `$on` listener.

Verified: real Loader composition (store + webserver + route) over live sockets — a committed transition and a creation each reaching connected sockets, a closed socket receiving nothing further, the 1008 close on a client message, a hand-rolled peer's unmasked frame dropping that socket while the well-behaved one keeps receiving, the 403 before negotiation, and disposal closing live sockets, removing the listeners, and unclaiming the endpoint; the browser suite covering socket URL and scheme (including TLS), refetch on open and per frame, unknown/unparsable/binary frames changing nothing, reopen after a drop, and disposal cancelling a scheduled reopen. The two-workspace browser e2e stayed green. Per-file coverage 100% on every touched file; typecheck, lint, build, doc-sync (28 gates), hygiene green. Unchanged pre-existing failures: `rescope-vendor` drift, one jscpd clone inside `tool-devflow`, and the `ui-theme` scrollbar-rebind assertion.
