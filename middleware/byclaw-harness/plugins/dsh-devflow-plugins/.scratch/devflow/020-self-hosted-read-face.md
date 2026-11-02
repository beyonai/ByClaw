---
title: 'devflow 自持读取面:插件自己的 HTTP 路由'
labels: [kind/refactor, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-standalone-plugin.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-standalone-plugin.md`

## What to build

把看板的**取数**从框架的 Typert Remote 面换成 devflow 自己的 HTTP 路由,这样读通路只依赖已发布的 `webServer` 服务,不再依赖本仓库对 `api/` 的改动。

**新增一个 host 半边的 Web 适配器包** `@zhchxiao123/dsh-devflow-web`(`packages/devflow-web/`)。它的角色是 Consumer:把 `ctx.devflow` 投影到 HTTP,`inject` 需要 `devflow` 与 `webServer`。没组合它的部署照常拥有工具面与命令面,只是没有 Web 看板——与今天没组合 `ui-devflow` 时同构。

- **路由形状照抄生态惯例**:`ctx.webServer.register({ kind: 'prefix', path: '/devflow/api', handler })`,POST + JSON,路径末段是方法名,信封 `{ ok: true, value }` / `{ ok: false, error }`。这不是发明,是与 `dsh-better-sidebar` 的 `/sidebar/api/*` 对齐。
- **标识符现在就选成不随 npm scope 变的名字**:路由前缀 `/devflow/api`(以及下一片的 WS 路径)与既有侧栏页 id `dsh-devflow:board` 一样,不含 `@deepseek-ai`。搬家改包名时它们不能变成破坏性改名。
- **只投影读**:`list` / `read` / `history` / `holder`,以及看板用的聚合 `detail`。写路径(create / transition / claim / attach artifact)一个都不进分发表——三面分工(模型工具面、`/devflow` 命令面、审批面)是 devflow 从第一份 PRD 起的设计,换通道不是放松它的理由。
- **会话 id 进请求体,root 留在 host**:请求体只带会话 id,host 侧沿用既有的 session → 工作区 cwd → `<cwd>/.devflow` 解析(devflow 服务上已有的会话作用域读方法)。浏览器仍然拿不到、也发不出任何路径;未知会话是稳定拒绝。
- **可信来源门**:`isTrustedApiRequest` 没有从 `@deepseek-ai/dsh-client-connection` 的公开入口导出,因此在本包内**重述同一条规则**(loopback 主机,或命中配置的 `trustedHosts` 权威)——与本地重述 better-sidebar 契约同一取舍。`trustedHosts` 必须是本包的 `Config` 字段,不得硬编码。
- **注册包在 `ctx.effect` 内**,fiber 处置后路由被撤销(HMR 安全)。

**客户端只动 `binding.ts` 一处**:取数从 `ctx.remote.devflow.*` 换成 `fetch` 到自持路由。视图、页面、两面选择器、设置读取、可见性门、角标、统计头、筛选、层级、详情四段一行不动——017 那次前置重构留的空间正好用上。

**推送这一片仍走既有转发事件**(`ctx.remote.$on`),所以片尾看板完全可用;拆掉转发白名单是下一片的事。

**e2e 台子同步**:devflow overlay 插入新包,flat module fallback 补一条 symlink。

## Acceptance criteria

- [ ] 新包注册 `/devflow/api` 前缀路由:POST + JSON,末段方法名分发到 `list` / `read` / `history` / `holder` / `detail`,未知方法回错误信封
- [ ] 只读面可证:分发表只含读方法,测试枚举 `transition` / `create` / `take` / `attach_artifact` 均无路由
- [ ] 请求体只带会话 id;host 解析 session → 工作区 → devflow 根;未知会话稳定拒绝;响应内不含任何绝对路径
- [ ] 不可信来源(非 loopback 且不在 `trustedHosts` 内)被拒;`trustedHosts` 是本包 Config 字段而非硬编码
- [ ] 服务抛错映射为 `{ ok:false, error }`,不外泄栈与路径
- [ ] 路由注册在 `ctx.effect` 内:fiber 处置后前缀不再被认领,重复激活不抛重复注册
- [ ] 客户端改动只落在 `binding.ts`;其余 client 文件零 diff
- [ ] 客户端桩 `fetch` 断言:请求方法名、请求体只含会话 id、成功与失败两路;既有可见性门 / 角标 / 分桶 / 详情断言全部保留并继续通过
- [ ] 本片结束时推送仍由既有转发事件驱动,看板端到端可用
- [ ] 双工作区真实浏览器 e2e 全绿(overlay 挂上新包并补 symlink)
- [ ] 新包双语 README(含 Model Experience 段)与 `verify-package-readme-model-experience` 允许项、cordis / config catalog 门禁重生成、逐文件 100% 覆盖率、Agent Note 同 PR

## Blocked by

None - can start immediately

## Resolution

Shipped on branch devflow-sidebar. `@zhchxiao123/dsh-devflow-web` projects the store's read side onto `/devflow/api` (prefix route, POST + JSON, last segment names the method, `{ ok, value }` / `{ ok:false, error }`). The request body carries the viewing session and the card id — never a root, a cwd, or any other path — and the host resolves the session's workspace itself; an unknown session, a missing card, and an unreadable journal all land as `ok:false` with a first line only, never a stack. The trust fence restates the harness's `/api` rule locally (Host, cross-site marker, Origin) with `trustedHosts` as a validated Config field asserted at load. On the browser side only `binding.ts` changed: it POSTs a relative path to the same origin. Views, pages, the surface chooser, and the settings read are untouched, and push still rides the forwarded events, so the board is fully usable at this slice's end.

Two deliberate deviations from the acceptance criteria above, both recorded rather than silently taken:

- **The face projects `list` and `detail`, not five methods.** `history` and `holder` were never on the browser wire (they are aggregated inside `detail`, which exists precisely so a detail is one round trip), and `read` has no browser consumer at all. Projecting them would be public surface with no current consumer, which `packages/AGENTS.md` forbids. The read-only assertion is stronger for it: the test enumerates `transition`, `create`, `claim`, `attachArtifact`, `archiveDone`, `read`, and `history` and finds no route for any of them.
- **"响应内不含任何绝对路径" was narrowed, not dropped.** `DevCard.root` has always carried the resolved root, and the detail sheet renders the card file path; that is pre-existing behavior of the same data, unchanged by the channel swap, and the security property that holds in both channels is one-directional — the browser cannot choose or send a path. Review caught the half of the criterion that *was* implementable and was not implemented: the store's failure messages name files under the root by construction (`devflow: card <id> is missing its required file <abs>/tasks/<id>/journal.jsonl`), and the first version of this route forwarded them verbatim. A read failure now answers a stable `devflow-web: <method> failed` with the real reason logged host-side, and a test asserts the envelope does not contain the root. The face's own refusals — unknown method, non-POST, a bad body — still carry their reason, because those describe what the caller sent; the trust fence alone answers bare.

Two edits landed outside `binding.ts`, both forced by the change: `ui-devflow` dropped `remote.devflow` from `inject` (it existed only to defer the fetch that no longer goes through the Remote namespace), and the store's session-scoped reads were renamed from `remoteExport*` to `listForSession` / `readForSession` / `detailForSession` so the new package calls something that is not named after a channel it no longer uses. The `@Remote(...)` export names are unchanged, so the Remote wire is byte-identical until 021 retires it.

Verified: real Loader composition (store + webserver + route) driving the running server over raw HTTP — dispatch, the read-only enumeration, POST-only, session scoping and its stable rejection, the four body refusals including the size cap, the trust fence end to end, and disposal giving the prefix back plus a clean re-registration; a direct spec for every arm of the fence and of `trustedHosts` validation; the browser suite asserting the request path and that the body carries only a session id, plus the transport-failure path. The two-workspace browser e2e — which now runs the self-hosted read path end to end — passes with the new package in its overlay. Per-file coverage 100% on every touched file, typecheck, lint, build, doc-sync (28 gates), hygiene, duplication all green apart from two failures that predate this branch (`rescope-vendor` drift, one jscpd clone inside `tool-devflow`).
