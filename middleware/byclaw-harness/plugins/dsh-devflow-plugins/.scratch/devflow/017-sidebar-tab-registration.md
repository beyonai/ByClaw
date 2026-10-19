---
title: 'devflow 侧栏通路:注册 better-sidebar 页面并与悬浮控件互斥'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-board-in-sidebar.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-board-in-sidebar.md`

## What to build

让 devflow 看板在装了 [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) 的部署里成为一个侧边栏页面,在没装的部署里保持今天的悬浮控件——**任一时刻只有一个入口**。

**前置重构**先做:看板组件今天的三样输入(两个快照 hook 与翻译函数)全部来自 slot 渲染机器合成的 props。把它改成一个与渲染面无关的 props 面,两条路径各自组装——slot 路径照旧由 slot 机器合成;侧栏路径自己组装(翻译取自客户端 locale 服务的按命名空间绑定函数,快照由组件内订阅插件已持有的 store 得到)。这一步不改任何可见行为。

**接入**:

- **零依赖**:不引入 `dsh-better-sidebar` 包、不做任何 import(含 type-only)。在自己的 client half **本地重述最小服务契约**——只需要注册方法与能力探测两个字段。跨插件交互只经服务方法调用,符合双方的 client bundle 纯度门。
- **延迟可选注入**:用客户端已有的 `ctx.inject([...], cb)` 形式声明对 `betterSidebar` 服务的可选依赖。服务出现时才回调(解决激活顺序),不存在时回调根本不执行(解决缺席降级)。
- **注册**:回调内以 `ctx.effect(...)` 包裹注册,disposer 由 fiber 在卸载/HMR 时收回(不包 effect 会在下次激活时抛 `already registered`)。tab id 用带包前缀的 `dsh-devflow:board`(不得占用内置的 explorer/git/subagent/terminal/browser/editor/diff),`single: true`(再次打开聚焦既有页),`order` 60。
- **互斥**:侧栏服务在场 ⇒ 不注册会话头部的 slot 控件。判定必须由**同一处状态**决定,不允许两条注册路径各自判断。
- **失败隔离**:注册抛错(id 冲突等)只记 warn,插件其余注册照常完成。

页面内容此片**原样搬运**:把既有看板组件渲染进 tab,不改版面、不加统计头与筛选(那是下一片)。数据面完全不动——仍走既有 Remote `devflow` 命名空间,浏览器仍只发会话 id。

## Acceptance criteria

- [ ] 侧栏服务在场时注册 `dsh-devflow:board` 页面,`+` 菜单可打开,页面渲染出与今天一致的看板内容(层级、详情、时间线)
- [ ] 同一部署下**不再**注册会话头部的悬浮控件;侧栏服务缺席时悬浮控件行为逐字节不变
- [ ] 注册包在 `ctx.effect` 内:fiber 处置后注册被撤销,重复激活不抛 `already registered`
- [ ] 描述符字段正确:id 带包前缀且不与内置 7 个冲突、`single: true`、`order` 60
- [ ] `registerTab` 抛错只记 warn,插件其余注册与悬浮/侧栏之外的行为不受影响
- [ ] 全仓无对 `dsh-better-sidebar` 的 import 或依赖声明;client 纯度门与 `verify-client-packages` 通过
- [ ] 前置重构不改变既有可见行为:现有 jsdom 组件测与双工作区 e2e 全绿(它们跑的是悬浮兜底路径)
- [ ] 桩服务真实 Loader 组合测覆盖:注册发生、描述符字段、互斥两条路径、处置撤销、注册失败隔离
- [ ] 双语文案与 README、client catalog 门禁、逐文件覆盖率、Agent Note 同 PR

## Blocked by

None - can start immediately

## Resolution

Shipped on branch devflow-sidebar (`89cbbde224`). The prefactor split the board's views out of the floating control: the card list and the detail sheet now take plain values, so both surfaces render the same components and the sidebar path assembles what the slot renderer used to synthesize (translator from the locale service's namespace binding, snapshots by subscribing to the plugin's own stores). The foundation's contract is restated locally — no import, no dependency declaration, no type-only edge — and reached through `ctx.inject([...], cb)` plus a service-name lookup. ONE chooser owns the surface decision: it reads the foundation by name, mounts either surface as a child fiber, and swaps on `internal/service` when the foundation arrives or leaves, so the two can never both appear. The page registers as `dsh-devflow:board` (single-instance, order 60, function title so a locale switch follows) inside `ctx.effect`, and a refused registration warns without taking the rest of the plugin down.

Verified: plugin composition suite against a stubbed foundation over the real slot tree and the real locale plugin — registration and its field values, mutual exclusion in both directions (arrival and departure), disposal unregistering the page, refusal isolation, and a repeated notification changing nothing — plus a jsdom suite rendering the page against the plugin's real stores. The existing floating-path tests and the two-workspace browser e2e stayed green unchanged, which is the byte-identical-without-the-foundation evidence. Per-file coverage 100%, typecheck, lint, doc-sync (28 gates), hygiene green.

Note on "real Loader composition": no client package in this repository boots the Loader in tests — the client runtime is not Loader-driven — so the client equivalent used here is the plugin's own entry booted over the real SlotRegistry and locale plugin, with only the external foundation stubbed.
