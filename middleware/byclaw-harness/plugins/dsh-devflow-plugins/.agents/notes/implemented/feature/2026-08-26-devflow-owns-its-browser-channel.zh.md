# Agent Note: devflow —— 这条插件线自持浏览器通道

Status: implemented

[English](2026-08-26-devflow-owns-its-browser-channel.md) | 中文

## Problem

`packages/devflow/` 与 `packages/devflow-ui/` 都是普通插件——两棵树里没有一样东西存在于上游，也没有一样东西给 harness 打补丁。但看板搬不出这个仓库，因为让它跑起来一共动了四处 harness 自有的包：`API_REMOTE_FORWARDED_EVENTS` 里两项（那是一个硬编码 `as const` 数组，它自己的注释就写着在那里加一项是转发事件的唯一办法）、生成的 `KNOWN_SESSION_EVENT_TYPES` 里两项、Typert Gateway 客户端放宽的参数个数校验，以及抽进 `ui-primitives` 的一个键盘辅助函数。

那对 session 事件才是危险的一处。一个 harness 不认识某个事件类型、而它的信封又没有 `ignorable` 标记时——那是 `Session.append` 并不暴露的逃生门——它会**拒绝重建整个会话**，这是刻意的设计。把这套插件照原样发布出去，会损坏每一台没有对应补丁的 harness 上的会话回放。

与此同时，生态里已经有了答案：`dsh-better-sidebar` 这个纯外部插件在 `ctx.webServer` 上自持 `/sidebar/api/*` 与 `/sidebar/ws/*`——而那个服务就发布在 npm 上。PRD（`.agents/prd/2026-08-26-devflow-standalone-plugin.md`）要求这里做同样的动作。

## Decision

**数据通路换主人：从"框架替我们转发"换成"插件自己提供"。**

- **一个新的 host 包 `@zhchxiao123/dsh-devflow-web` 拥有两个方向。** 它是 Consumer，不是 provider，也不属于 store：它的全部职责就是把 `ctx.devflow` 投影到 HTTP 上。不组合它的部署照常拥有工具面与命令面，只是没有 Web 看板——与此前不组合 `ui-devflow` 时同构。
- **读取面只读，而分发表就是那道强制。** `list` 与 `detail` 有路由；`transition`、`create`、`claim`、`attachArtifact` 与 `archiveDone` 一个都没有，并且有测试逐个枚举它们。devflow 的三面分工（模型工具、`/devflow`、审批）是设计的性质，而不是浏览器碰巧走哪条通道的性质。
- **只有两个方法，因为只有两个有消费者。** PRD 列了五个。`history` 与 `holder` 从来不在浏览器的线上——`detail` 把它们聚合起来，那正是它存在的理由——而 `read` 根本没有浏览器调用方。把另外三个发布出去，就是给一段没有东西在后面的线加面。
- **会话 id 是唯一会走上线的取值键。** host 把它解析成 devflow 根，与已退役的 Remote 面完全一样，因此浏览器仍然既选不了也发不出路径。响应照旧携带解析出的 `root`，一直如此；这条性质是单向的，从来就是。
- **可信来源规则是重述，不是 import。** `isTrustedApiRequest` 是 `client-connection` 的包内私有，而本插件只能依赖已发布的面。两份副本之间的分歧是这份副本的缺陷——它的模块文档把这句话明写了出来；`trustedHosts` 是装载时断言的受校验 Config 字段，因为那里的一个笔误会悄悄让授权落空或放宽。
- **读取失败的原因留在 host 侧。** store 自己的消息点名 devflow 根下的文件，把它转发出去就等于把一条浏览器本来问不出来的路径交给它。信封携带稳定的 `devflow-web: <method> failed`，其余留在日志里。这个面自己判定的拒绝——未知方法、非 POST、畸形请求体——则带上原因，因为那描述的是调用方发了什么；只有可信来源门答得赤裸，因此不可信的调用方学不到这条路由的任何事。
- **推送帧只报事件名，别的什么都不报。** 不带卡片——那会把第二个真相放进浏览器，与看板正在呈现的那次读取赛跑。也不带 root：验收标准同时还把重取集合钉在了转发事件所产生的那一份上，而浏览器按会话 id 给绑定分桶、手里没有 root 到页面的映射，因此 root 字段会成为一段已发布的线上没人读的值。帧是触发器，读取面才是答案。
- **浏览器半边自持恢复。** 它在每一帧与每次连接建立时重取——第一次与每次重连都算，因为断过的看板无从知道自己错过了什么——并在断开后以从两秒起翻倍、上限三十秒、下次打开即复位的延时重连。旧的 `connection/reset` 重取随那条依赖一起去掉了：聊天连接重置与这条通道已经没有关系。
- **两个 session 事件是删掉，不是找台阶。** 全仓没有任何读取方，而循环本来就把每次调用与它的结果记为 `tool/call` / `tool/result`，因此一份 devflow 形状的副本是没有读者的痕迹。`ignorable` 需要上游改 `Session.append`；删除什么都不需要，而且是净减。`KNOWN_SESSION_EVENT_TYPES` 是生成物，仅靠重新生成就回到了上游内容。

## Alternatives considered

- **给转发事件加一个运行时注册面** —— 那才是正确的上游修法，也仍然值得提，但它会让 devflow 依赖一个具备该能力的 harness 版本。自持通道让 devflow 在今天存在的 harness 上就能跑。
- **从 `client-connection` 导出 `isTrustedApiRequest`** —— 为了三十行的一条规则，再背上一处 harness 改动。重述是这笔交易里更便宜的一半，也是生态自己的先例。
- **把那两个 session 事件标成 `ignorable`** —— 需要 `Session.append` 上一个它没有的选项，也就是一处上游改动，只为留住两个没人读的事件。
- **为了与缝对称而在路由上保留 `read`/`history`/`holder`** —— 缝的形状不是线的形状；浏览器通道投影的是浏览器要的东西。

## Consequences

`git diff origin/master -- packages/api packages/core packages/client/ui-primitives` 里不含任何 devflow 引用。留在那里的都与之无关：Gateway 的参数个数修复（`b8368b8744`，自成一个提交、带自己的测试，可直接向上游提出），以及 `escapeDismissHandler` 抽取——它如今是一个有两个普通消费者、文档不点名任何一方的原语。唯一看似的例外是工具清单测试，它枚举的是工作区此刻持有的工具包，这些包搬走时它自己就空了。

`ui-devflow` 注入 `sessions`、`slots` 与 `locale`；看板数据一个服务都不需要。`DevflowStore` 重新是一个普通 `Service`，没有 Typert Remote 面，也不再依赖 `typert-protocol`。看板每一条可见行为都没有变，这一点由既有的双工作区浏览器 e2e 持续证明——它如今跑的正是自持读取面加自持推送面的完整路径。

仍然推迟、但现在已不再受阻的是搬家本身：脱离 `@deepseek-ai/*` 改名、独立仓库、npm 发布、`dsh.plugin.json` 与 bundle patch。用户可见的标识符已经为此提前选好：`/devflow/api`、`/devflow/ws` 与侧栏页面 id `dsh-devflow:board` 命名的是领域而不是 scope，因此改名不会是破坏性的。
