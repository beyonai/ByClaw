---
title: 'devflow: 卸掉对 harness 源码的依赖,成为自足插件'
labels: [kind/refactor, ready-for-agent]
date: 2026-08-26
parent-prd: 2026-08-25-devflow-file-based-dev-state.md
---

# PRD — devflow:卸掉对 harness 源码的依赖,成为自足插件

## Problem Statement

devflow 的八个 host 包与一个 client 包本身都是纯插件——`packages/devflow/` 与 `packages/devflow-ui/` 整棵树在上游 master 里并不存在,是这条线新增的 161 个文件。但它**不能照原样搬出仓库**:为了让 Web 看板跑起来,当初改了四处 harness 自己的源码。

| 改动 | 作用 | 外部插件能否自持 |
|---|---|---|
| `api/remotes` 的 `API_REMOTE_FORWARDED_EVENTS` 加两项 | 看板随卡片流转实时刷新 | ✗ 硬编码 `as const` 数组,注释明说"转发多一个事件就是在这里加一项,没有别的办法" |
| `core/session` 的 `KNOWN_SESSION_EVENT_TYPES` 加两项 | `devflow/created`、`devflow/transition` 能被回放 | ✗ 由本仓库的 `SessionEventMap` 声明生成;`ignorable` 逃生门 `Session.append` 并不暴露 |
| `api/gateway` 客户端的参数个数校验放宽 | 允许省略尾部可选参数 | ✗ 需要框架侧修复 |
| `ui-primitives` 抽出 `escapeDismissHandler` | 与 ui-jobs 复用 | ✓ 自持一份即可 |

前两项尤其致命。转发白名单没有运行时注册面;而 session 事件那条不只是"少个特性"——一个 harness 不认识、又没有 `ignorable` 标记的事件出现在日志里,读取方会**拒绝重建整个会话**,这是它写在类型注释里的刻意设计。也就是说,把今天这套原样发布出去,会损坏没有对应改动的 harness 上的用户会话。

同时,生态里已经有现成的答案:`dsh-better-sidebar` 这个纯外部插件不用 Remote 面也不用转发事件,它用 `ctx.webServer.register` / `registerUpgrade` 开自己的 `/sidebar/api/*` 与 `/sidebar/ws/*`。那个服务的包 `@deepseek-ai/dsh-host-webserver` 就在 npm 上。

## Solution

**把数据通路从"框架转发"换成"插件自持",让 devflow 只依赖已发布的 harness 服务。**

- **读取面自持**:新增一个 host 半边的 Web 适配器,用 `ctx.webServer.register` 开一个前缀路由,把 `ctx.devflow` 的四个读操作(`list` / `read` / `history` / `holder`,以及看板用的聚合详情)投影成 POST + JSON 的方法调用。请求体只带**会话 id**,host 侧照旧解析 session → 工作区 → devflow 根——浏览器仍然拿不到、也发不出任何路径。只暴露读:流转、建卡、审批一概不进这个面。
- **推送面自持**:用 `ctx.webServer.registerUpgrade` 开一个 WS 端点,host 侧监听 `devflow/card-created` 与 `devflow/stage-changed`,把"某个 root 的看板变了"推给浏览器。客户端据此重取,与今天收到转发事件后的行为一致。
- **客户端换通道**:`ui-devflow` 的绑定层从 `ctx.remote.devflow.*` 改为 `fetch` 到自持路由,从 `ctx.remote.$on` 改为订阅自持 WS;`inject` 里不再需要 `remote` 与 `remote.devflow`。看板的一切可见行为——两面互斥、按 scope 绑定、可见性门、角标、统计头、筛选、层级、详情四段、分栏设置——逐条不变。
- **去掉两个 session 事件**:删掉 `devflow/created` / `devflow/transition` 的 `SessionEventMap` 声明与两次 `append`。全仓没有任何读取方,而工具调用本身已由 `tool/call` / `tool/result` 记入日志,这两条是冗余的痕迹。`KNOWN_SESSION_EVENT_TYPES` 是生成物,声明消失后它自动回到上游状态。
- **`escapeDismissHandler` 自持**:悬浮面在插件内保留自己的一份键盘处理;`ui-primitives` 与 `ui-jobs` 的抽取保持不动(那是本仓库自己的正当重构,与 devflow 无关)。

做完之后,`git diff origin/master` 在 `packages/api/`、`packages/core/`、`packages/client/ui-primitives/` 上应当不再有任何 devflow 痕迹——这就是"自足"的可验证判据。

**本 PRD 只做解耦,不做搬家。** 改名、独立仓库、npm 发布、bundle patch 是下一步,解耦干净之后才有意义。

## User Stories

1. 作为插件作者,我想让 devflow 只依赖已发布到 npm 的 harness 服务,以便它能被装进任何一台标准 harness 而不需要我先改它的源码。
2. 作为插件作者,我想让 `git diff` 证明这一点(核心包上再无 devflow 痕迹),以便"自足"是可验证的事实而不是印象。
3. 作为用户,我想让看板在卡片流转时仍然实时刷新,以便通路替换对我不可见。
4. 作为用户,我想让浏览器继续只发会话 id、拿不到任何文件路径,以便安全性质不因换通道而降级。
5. 作为用户,我想让看板的读取面**只读**,以便没有任何一条流转能绕开工具面、命令面与审批面。
6. 作为用户,我想让两套面(侧栏页 / 悬浮控件)的互斥、角标、可见性门、统计头、筛选、层级、详情四段、分栏设置全部原样保留。
7. 作为用户,我想让自持路由拒绝不可信来源的请求,以便它与既有 `/api` 路由的防线一致。
8. 作为用户,我想让 WS 断开后能自行恢复(重连或退化为按需重取),以便一次网络抖动不会让看板永久停更。
9. 作为一台没有装 devflow 的 harness 的用户,我想让删掉的那两个 session 事件不影响我读任何历史会话,以便这次清理不留下不可回放的日志。
10. 作为维护者,我想让路由前缀与 WS 路径带插件前缀,以便与其他插件的自持路由不冲突。

## Implementation Decisions

- **自持路由是一个新的 host 包**(devflow 的 Web 适配器),不塞进 provider,也不塞进工具包:它的角色是"把 `ctx.devflow` 投影到 HTTP/WS",是一个独立的 Consumer,`inject` 需要 `devflow` 与 `webServer`(会话解析所需的 `sessions` / `sessionPersistence` 按既有做法可选取用)。没组合它的部署照常拥有工具面与命令面,只是没有 Web 看板——与今天没组合 `ui-devflow` 时同构。
- **路由形状照抄生态惯例**:`kind: 'prefix'`、`POST` + JSON、路径末段是方法名、`{ ok, value }` / `{ ok:false, error }` 的信封。这不是发明,是与 better-sidebar 对齐,便于读者迁移经验。
- **只读面**:路由只投影读操作。写路径继续只存在于模型工具、`/devflow` 命令与审批 composer——这是 devflow 从第一份 PRD 起的三面分工,换通道不是放松它的理由。
- **会话 id 进请求体,root 留在 host**:与既有 Remote 面同一条安全性质,连解析代码都复用(session → 工作区 cwd → `<cwd>/.devflow`)。未知会话是稳定拒绝。
- **WS 帧只报"变了",不带负载**:推送里带上受影响的 root(或会话 id)与事件名即可,客户端据此决定重取哪一个绑定。不在 WS 上传卡片内容——那会把两条真相源(推送快照与重取结果)拉开。
- **可信来源门**:路由复用与 `/api` 相同的可信主机判定;若该判定的实现未从其包公开导出,在插件内重述同一条规则(与本地重述 better-sidebar 契约同一取舍)。
- **客户端只换取数层**:`binding.ts` 是唯一知道通路的模块,替换发生在它内部;视图、页面、两面选择器、设置读取一行不动。这也是 017 那次前置重构留下的空间。
- **`ui-devflow` 不再 inject `remote`**:少一条依赖,同时意味着它不再需要 `dsh-api-remotes` 与生成的 Remote 命名空间声明。
- **删除 session 事件,而不是给它们找台阶**:`ignorable` 需要 `Session.append` 开口子,那是上游的改动;而这两条事件没有读取方,删掉是净减。若日后确需会话侧痕迹,再走上游的注册面。
- **保留并单独上游化 gateway 的参数校验修复**:那是与 devflow 无关的真 bug(生成的调用面允许省略尾部可选参数,校验却按满参检查),留在本仓库并另行提 PR;devflow 解耦后不再依赖它。
- **保留 `ui-primitives` 的 `escapeDismissHandler`**:ui-jobs 在用,是本仓库自己的重构;devflow 的悬浮面改为自持一份,不再引用它。

## Testing Decisions

- **路由包**:真实 Loader 组合测,`webServer` 用桩(记录注册的路由与升级路径),断言方法分发、只读面(不存在写方法)、会话解析与未知会话的稳定拒绝、不可信来源被拒、错误信封,以及 fiber 处置后路由被撤销(HMR 安全)。
- **推送**:host 侧监听到 `devflow/card-created` / `devflow/stage-changed` 后向已连接的 socket 推一帧;断开的 socket 不再收到;处置后监听摘除。
- **客户端绑定层**:把 `fetch` 与 `WebSocket` 桩掉,断言取数请求的方法与请求体(只带会话 id)、推送触发重取、连接断开后的降级与恢复。既有的可见性门、角标、分桶断言全部保留并继续通过。
- **回归**:既有的双工作区真实浏览器 e2e 必须继续绿——它跑的是悬浮兜底路径的完整读路径,通路一换,它就是最有力的证据。台子里的 devflow overlay 需要补挂新的路由包。
- **自足判据成为一条门禁级检查**:`git diff origin/master` 在 `packages/api/`、`packages/core/`、`packages/client/ui-primitives/` 上不含 devflow 引用;至少在 PR 描述里给出这条命令的输出。
- 逐文件覆盖率、双语 README、cordis/config catalog 门禁、Agent Note 随各切片。

## Out of Scope

- **搬家本身**:改名(脱离 `@deepseek-ai/*` scope)、独立仓库、npm 发布、`dsh.plugin.json` 与 bundle patch、外部测试台子——解耦完成后另起一份 PRD;
- **上游 PR**:gateway 参数校验、转发事件的运行时注册面、`Session.append` 的 `ignorable` 选项——各自独立提出,不阻塞本 PRD;
- **写路径上 Web**:看板仍然严格只读;
- **Typert Remote 的通用替代**:本 PRD 只替换 devflow 自己的通路,不为其他插件设计公共方案;
- **协议版本化**:自持 JSON 面暂不引入版本协商,host 与 client 同包同版本发布。

## Further Notes

- 切片建议:**020 自持读取面**(路由包 + 客户端取数换通道,推送暂时留用既有转发事件,保证每一步都可跑)→ **021 自持推送面**(WS 端点 + 客户端订阅,拆掉对转发白名单的依赖,并回滚 `api/remotes` 与 `apiproxy` 的两处 devflow 痕迹)→ **022 清理残余**(删两个 session 事件与其声明、重生成 `known-event-types`、悬浮面自持 `escapeDismissHandler`、e2e 台子补挂、自足判据落进 PR 描述)。三片顺序执行,每片结束时 devflow 都是可用的。
- 兼容性:`.devflow` 目录格式、工具面、命令面、缝与所有 host 插件一行不动;变的只有 Web 通路。
- 参考:`ctx.webServer.register` / `registerUpgrade` 的契约在 `packages/host/webserver/src/index.ts`;生态先例在 `dsh-better-sidebar` 的 `src/index.ts`(`/sidebar/api` 前缀路由与 `fence`)。
