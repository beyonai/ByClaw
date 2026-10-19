# @zhchxiao123/dsh-devflow-web

[English](README.md) | 中文

devflow 自持的浏览器通道：一个 Consumer，把 [`ctx.devflow`](../devflow/README.zh.md) 缝的读侧投影到 [`ctx.webServer`](../../host/webserver/README.zh.md) 上的一条带前缀 JSON 路由。看板经本插件而非任何框架自有的转发面拿到卡片，这正是 devflow 这套插件能装进一台原厂 harness 的原因——这里没有一样东西需要改动 harness 自己的包。

## 路由

一条前缀路由 `/devflow/api`，路径末段是方法名。前缀命名的是领域而不是 npm scope，因此把这些插件换个 scope 重新发布不是破坏性改名。

```
POST /devflow/api/<method>    { "sessionId": "...", "id": "..." }
  -> 200 { "ok": true, "value": ... } | { "ok": false, "error": "..." }
```

方法有六个，分处两张分发表，合起来就是这个面的全部。三个读：`list` 返回该会话的活跃卡片，`detail` 一次往返返回一张卡加它完整的解码 journal 与当前租约持有者，`archived` 返回该会话档案的一页——最新的月份桶在前，可用 `YYYY-MM` 的 `month` 收窄，被截断的一页带 `cursor` 供续读。`archived` 固定它读取的集合，而不是从 body 里取：把缝的完整查询开放给不可信调用者，等于让它选择 host 去遍历哪个集合，而看板并不需要这个能力。三个写，而且恰好就是一个人对「卡片在看板上的去留」所做的决定：`archive-done` 清扫已完成的卡，`archive` 归档一张，`abandon` 带着理由放弃一张——那条理由是它唯一留下的东西。两张表都没有的末段根本没有路由（404），每个方法都只接受 POST（405）。

**不**投影的是执行面：`transition`、`create`、`claim`、`attachArtifact` 在这里没有路由，`restore` 也没有——在「放弃」旁边摆一个「拿回来」，会让人以为放弃是可逆的，而它不是。devflow 的分面从来说的是「谁来决定什么」，不是「哪条通道来承载」：模型工具面负责执行，而归档与放弃是人做的决定。看板是人做决定的界面之一，不是第二个执行器。

两张表刻意不合并。读的失败是一个「看不到」的确定答案，理由留在 host 侧；写的领域拒绝则是调用方要分支的信息，带稳定 code 回传——`revision-mismatch`、`not-done`、`parent-active`、`already-done`、`already-archived`。一张表同时承载这两种语义，必然要放弃其中之一。基础设施失败对写和对读一样，仍然只留在 host 侧。

每次写的 actor 都由 host 自己填——`{ kind: 'human' }`，与 `/devflow` 命令面的 `command` actor 区分开，这样 journal 能说出这次决定是在哪个界面上做的。浏览器不能声称自己是谁；请求声明的是会话而不是根，所以它也报不出路径。

方法的返回值就是缝的读值原样——`list` 携带该会话的 `DevCard`，`detail` 加上解码 journal 与租约持有者——所以这个面发布的恰是 [Definition](../devflow/README.zh.md) 发布的，自己不持有投影层。Definition 新增的字段在落进缝的那个版本就上了 wire：`artifactRecords`（每条已登记产物的路径、kind、revision 与阶段）随 store 代写产物一起抵达，看板的卡片详情将随 kind 感知的产物展示落地成为它的读者；在那之前看板照旧渲染一直以来的 `artifacts` 路径投影。

写会带 `expectedRevision`（非负整数），`abandon` 还要带一条非空且限长的 `reason`。空理由在这里也会被拒：这个面描述的是「你发过来的东西」，而 store 自己的 `empty-reason` 仍然是它一贯的契约。`archived` 是唯一 body 里带自有收窄的读方法，每个字段都在抵达缝之前校验：`month` 必须是 `YYYY-MM`，`limit` 必须是正整数并被钳制到一个固定上限，`cursor` 必须是长度合理的字符串。这个上限是固定的而非可配置的，因为它约束的是一次不可信请求能让 host 遍历多少个卡片目录——这是「对外服务不可信调用者」的性质，而不是部署偏好；可调的那个是 store 自己的页大小。游标的*形状*属于 store，所以这道门只检查它是不是一个像样的字符串，把「不是本 store 签发的」交给 store 拒绝。

请求体带的是查看方会话，除此之外不带任何决定读取范围的东西。host 把该会话的工作区解析成它的 devflow 根，因此浏览器既选不了也发不出根、cwd 或任何别的路径。不带会话就读 store 的默认根；未知会话、缺失卡片与不可读的 journal 一律以 `ok: false` 抵达——那是看板呈现为“没有看板”的既定答案，而不是传输故障。读取失败的原因留在 host 侧的日志里：store 的消息点名 devflow 根下的文件，而浏览器不该从一个答案里学到它本来就问不出来的路径。这个面自己判定的拒绝则带上原因，因为那描述的是调用方发了什么——未知方法、非 POST 的读，或超长、不可解析、不是对象的请求体（后三者在分发之前以 400 拒掉）。只有可信来源门答得赤裸，因此不可信的调用方学不到这条路由期待什么。

## 变更流

一个升级端点 `/devflow/ws`，走同一道门。host 监听 `devflow/card-created`、`devflow/stage-changed`、`devflow/card-archived` 与 `devflow/card-restored`，向每个已连接的浏览器发一帧：

```json
{ "type": "devflow/stage-changed" }
```

一帧只说明这台 host 的 devflow 里有东西动了，除此之外什么都不说。浏览器以经读取面重取来回应它，因此一帧永远不会变成与看板所呈现之物赛跑的第二个真相——也永远不会把一张卡漏进工作区里并没有它的页面，因为那次重取与其他每次读取一样按会话取值。通道是单向的：客户端只要发东西就以 1008 关闭，非法帧只掐掉它自己那条 socket，而处置会把端点、监听与每条在连 socket 一并带走。

## 可信来源门

每个 API 请求、报告读取和 WebSocket 升级都在分发前显式调用公开的 `connection.requestRejection(req)`。注册 WebServer 路由不会自动应用认证。Connection 服务校验签名浏览器 cookie 和宿主策略；缺失、无效或过期 cookie 返回 401，Connection 服务缺失或异常同样返回 401。Devflow 另外使用自己的 `trustedHosts` 限制请求来源。`Host` 必须是 loopback 或配置过的 `trustedHosts` 权威（DNS 重绑定防线——`Host` 是被重绑定的页面唯一伪造不了的头）；显式的跨站 fetch 标记一律拒绝；带上来的 `Origin` 必须恰好是本权威。`trustedHosts` 的每一项必须是规范形式的裸 `host` 或 `host:port`，在装载时断言，因此一个笔误会当场失败，而不是悄悄让授权落空或放宽。把它配成该部署 `/api` 门上的同一份值，否则看板会恰好在聊天不通的地方不通。

组合只需在 store 与 webserver 旁边加一行；不组合它的部署照常拥有工具面与命令面，只是没有 Web 看板。

```yaml
- id: devflow
  name: '@zhchxiao123/dsh-devflow-filesystem'
- id: devflow-web
  name: '@zhchxiao123/dsh-devflow-web'
```

## Model Experience

None, as this package answers a human's browser with card state and touches no prompt, message, schema, stream, or tool result. 模型自己看到的同一批卡片仍由 [`dsh-tool-devflow`](../tool-devflow/README.zh.md) 负责。

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **这个面只读，而且保持只读** —— 从浏览器发起审批或阶段移动需要它自己的一面，而不是在这里加一个写方法。
- **没有协议版本协商** —— host 与浏览器两半随同一个包版本发布，因此信封与帧都不带版本字段；哪天通道的寿命超过了这个前提，就需要补上。
- **帧不说明是哪个 root 动了** —— 每个已连接的浏览器在每次变更时都重取，这正是这些事件经框架转发面抵达看板时的行为。点名受影响的 root 可以让某个页面跳过一次重取，但浏览器手里没有 root 到页面的映射可用来跳过；缺的是那张映射，而不是帧里的字段。
- **`trustedHosts` 要配两遍** —— 这里一遍、harness 的 `/api` 门上一遍，因为请求必须同时满足宿主 Connection 策略和本插件的额外来源限制。只改其中一处的部署会得到一块拉不动的看板。

## 验收构建身份

`POST /devflow/api/build-info` 沿用宿主认证与现有 POST 信任校验。
部署配置 `buildClient: { artifact: "/绝对路径/devflow-ui/lib/client.js", entry: "@zhchxiao123/dsh-devflow-ui" }`。
未配置或直接从源码运行时返回 `{ ok: true, value: { schemaVersion: 1, available: false } }`。
绝对路径不进入响应；可用时返回 buildId、每次加载独立的 instanceId、serverSha256 与 `client: { path, sha256 }`。
此身份覆盖当前 web 插件 index bundle 与选定 UI bundle；完整 Harness/Devflow 包集仍需另存部署哈希。

导出的 `artifactIdentity(serverArtifact, buildClient)` 供部署工具从本地产物计算同一身份。
插件加载时固定快照，文件变化或缺失后报告不可用。调用方还必须使用同一认证上下文读取 client.path 并核对字节哈希，
不能把配置路径当作实际提供内容的证明；Midscene JSON 探针已在用例前后执行此检查。

`acceptanceReports: [{ workspace: "/工作区绝对路径", output: "/私有外部结果目录" }]` 为对应会话工作区开放
`GET /devflow/reports/<sessionId>/<runId>/<asset>`。正式产物须登记在 manifest，探索产物须登记在显式 artifacts 列表。
路由在解析会话或读取文件前显式检查宿主 Connection 认证；响应设置 no-store、nosniff 和 sandbox，拒绝符号链接、穿越、未登记/私有文件及超过 64 MiB 的产物。

客户端路径取自已发布 `clientModules.graph()` 的条目，保留 `/plugins/??…&rev=…` 查询参数。端点通过公开 `clientPath()` 核对所配本地产物，并按 rc.2 源码中明确的末尾调试注释和单条目组合转换规则，将 `fetchBundle()` 与本地可执行源码匹配。`client.sha256` 标识实际响应字节；部署凭据的 build ID 仍绑定原始本地产物哈希。注册表缺失或字节陈旧、不匹配时返回不可用，不猜测静态路由。
