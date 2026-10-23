# 配置式 HTTP Hook

Hook 默认关闭。此版本接入 `user.registered` v1、`tenant.created` v1 和 `workgroup.created` v1，在对应业务创建事务提交后异步发送 HTTP；不保存任务，默认不自动重试，可按订阅开启有界内存重试，不保证重启恢复，也没有管理页面。HTTP 结果不会修改业务接口响应。多个订阅独立执行，不保证发送顺序。

## 启用与环境隔离

配置示例：`config/examples/hooks.yaml`。复制到部署环境的外部配置目录后修改，不能将真实地址、认证信息提交到代码仓库。

环境 A 无需增加配置；也可以显式设置 `BYCLAW_HOOKS_ENABLED=false`。关闭时不会绑定 Hook 订阅，不要求 URL 或 Token，不创建专用线程池和 HTTP 客户端。原有内部业务事件照常工作。

环境 B 设置 `BYCLAW_HOOKS_ENABLED=true`（或将全局 `enabled` 改为 true），只启用需要的订阅。默认启用的注册示例需由部署系统注入 `REGISTRATION_HOOK_URL`、`REGISTRATION_HOOK_TOKEN`，在现有启动命令后追加：

```bash
--spring.config.additional-location=file:/etc/byclaw/hooks.yaml
```

也可设置 `SPRING_CONFIG_ADDITIONAL_LOCATION=file:/etc/byclaw/hooks.yaml`。该选项追加 Spring 配置来源，不替换现有业务配置。这里使用必需文件，文件不存在时启动失败，避免误以为 Hook 已启用。外部文件由部署系统维护；修改文件后重启，当前版本不热更新。不要让环境 A 和 B 误用同一份启用配置。

如果启用了服务端多个副本，每个副本都加载相同配置。Hook 仅由处理该次注册事务的实例发送，不通过 Redis Pub/Sub 广播给所有实例。

## 事件及触发边界

`user.registered` v1 字段白名单：

| 路径 | 类型 | 含义 |
| --- | --- | --- |
| `event.id` | string | 一次事件的 UUID；同一事件的多个订阅共享 |
| `event.type` | string | `user.registered` |
| `event.version` | number | `1` |
| `event.occurredAt` | string | 事件触发时间，UTC ISO-8601，保留既有协议 |
| `event.occurredAtEpochSeconds` | number | 同一事件触发时间的 UTC Unix 秒 |
| `data.userId` | string | 用户 ID，避免长整数精度丢失 |
| `data.displayName` | string/null | 注册时用户名称 |
| `data.registrationSource` | string | `phone`、`apple` 或 `cas` |

覆盖 `UserApplicationService.registerByPhone`、`registerIosByPhone`、`registerByCasTicketUser` 创建的新账号。微信手机号首次登录复用手机号注册，因此来源也是 `phone`。已有账号登录、管理员新增用户不会触发。此版本不推断未登录用户的 tenantId，也不导出完整 Users、密码、手机号、邮箱或登录凭据。

这些注册方法通过 Spring 代理进入事务，加入调用方的现有事务；发布发生在用户保存和原有初始化完成后。外围事务回滚时不发送。缺少真实事务的调用会跳过投递并记录 `no_transaction`，不会降级为立即发送。

## 企业（租户）创建事件

`POST /admin/tenants/create` 经 `TenantAdminTenantService.create` 首次创建企业、套餐快照与拥有者后，发布 `tenant.created` v1。HTTP 通知仅在该创建事务提交后异步发送；失败或回滚不发送。相同 `requestId` 的幂等返回不重复发布。

该事件表示企业记录已创建、开通状态为 `RESERVED`，不代表数据库、Node 或沙箱已开通成功。Controller 随后调用 `provisioner.request` 请求开通；如果开通请求失败，已提交的租户创建事件仍可能送达。后续开通状态不属于本事件。

| 路径 | 类型 | 含义 |
| --- | --- | --- |
| `data.enterpriseId` | string | 企业（租户）ID |
| `data.enterpriseName` | string | 企业名称 |
| `data.packageId` | string | 创建时选择的套餐 ID |
| `data.packageName` | string | 套餐名称快照 |
| `data.createdBy` | string | 创建者用户 ID |
| `data.requestId` | string | 创建请求的幂等标识 |
| `data.provisionState` | string | 创建时状态，固定为 `RESERVED` |

事件元数据仍使用 `event.id`、`event.type`、`event.version`、`event.occurredAt`。不包含套餐完整内容、数据库连接信息、Node 凭据或其他租户配置。

通用 `config/examples/hooks.yaml` 的 `tenant-sync` 订阅展示了本事件的正文映射。默认不启用该订阅；启用时配置接收地址及认证方式。

## 工作组创建事件

工作组、group 和群聊是同一个业务概念。`POST /group-chats`（`GroupChatController.create`）发布 `workgroup.created` v1；普通 Java 创建路径和路由到租户 Node 的企业创建路径均已接入。同一请求只执行其中一条路径，成功时只登记一次事件。接口未提供创建幂等键，重复提交创建新工作组会产生新的事件。

| 路径 | 类型 | 含义 |
| --- | --- | --- |
| `data.groupId` | string | 工作组 ID，即群聊 `sessionId` |
| `data.groupName` | string | 最终创建的工作组名称 |
| `data.enterpriseId` | string/null | 工作组所属企业 ID；个人工作组允许为空 |
| `data.projectId` | string | 工作组关联项目 ID |
| `data.createdBy` | string | 创建者用户 ID |

不导出工作目标、聊天内容、成员列表或运行凭据。普通路径在项目、会话、初始成员、授权和权限设置完成后登记事件；企业路径在 Node 创建命令、授权及详情读取成功后登记，均等待 BE 创建事务提交后异步投递。创建失败、详情读取失败或 BE 事务回滚不发送。

BE 数据库与租户 Node 之间没有分布式事务：Node 已创建成功后，若后续 BE 操作失败，可能仍留下远端工作组，此时不会发送本事件。此 Hook 不提供跨进程恢复或远端数据补偿。

通用 `config/examples/hooks.yaml` 的 `workgroup-sync` 订阅展示了本事件的 HMAC 认证、正文映射及必需字段过滤。默认关闭该订阅；启用时注入地址与签名密钥。

## 示例与认证方式

仓库只提供一份通用示例 `config/examples/hooks.yaml`，包含三个可独立启停的订阅：

| 订阅 | 事件 | 认证示例 | 默认订阅开关 |
| --- | --- | --- | --- |
| registration-crm | user.registered | bearer | true |
| tenant-sync | tenant.created | none | false |
| workgroup-sync | workgroup.created | hmac-sha256 | false |

全局 `enabled` 默认为 false，所有投递都关闭。启用某个订阅前，按接收方协议配置 URL、认证、正文和重试策略；三个示例的认证与事件没有绑定关系，同一事件可以使用任一认证类型。

- `none` 不生成认证头，不代表目标接口无需访问控制，只适用于接收方明确允许的匿名请求。
- `bearer` 从外部配置读取 Token，发送 `Authorization: Bearer ...`。
- `hmac-sha256` 按 `canonical-fields` 拼接原文、计算签名，并按 `auth.headers` 生成认证头。示例中的 `hook-request-v1` 和 `X-Webhook-*` 只是可更换的演示值。

示例全局启用后，注册订阅需要 `REGISTRATION_HOOK_TOKEN`。另外启用工作组订阅时，需要 `WORKGROUP_HOOK_SIGNING_SECRET`，并配置目标 URL；可用 `HOOK_CLIENT_ID` 设置调用方标识。真实配置放在部署环境中，不提交业务接收方的专用配置或秘密。

`occurredAt` 为事件时间，重试保持不变；认证头中的 timestamp 为发送时间，每次尝试更新。事件可能乱序，接收方应以事件 ID 实现业务幂等；需等待前置资源时，可按接收方明确的状态码协议配置有限重试。HTTP 202 仍只算投递成功，不代表接收方的后续异步任务已完成。

## 通用 HMAC 配置能力

认证实现为 `common.hook.HmacHookSigner`，不是接收方适配器。`auth.type` 只支持 `none`、`bearer`、`hmac-sha256`；接收方的协议名、头名和原文排列只在 YAML 中出现。HMAC 输出固定为 HMAC-SHA256 的小写十六进制，原文按 UTF-8 编码。

`canonical-fields` 是有序列表，每项只能有一个 `from` 或字符串常量 `value`；`separator` 默认为实际换行符，可设置长度不超过 16 的分隔符，不自动追加末尾分隔符。允许引用：

| 来源 | 含义 |
| --- | --- |
| `auth.clientId` | YAML 中可选 client-id，引用时必须配置有效标识 |
| `request.method` | 实际 HTTP 方法 |
| `request.path` / `request.query` | 最终编码后的路径和查询字符串，缺少查询时为空 |
| `request.timestamp` / `request.nonce` | 本次发送生成的 Unix 秒字符串与随机 nonce |
| `request.bodySha256` | 实际正文原始字节的 SHA-256 小写十六进制 |
| `request.headers.<Header-Name>` | 原请求头，查找大小写不敏感，缺少时为空 |

`auth.headers` 的每个值也使用 `from/value`；除了上述来源，还允许 `from: signature` 读取计算结果。每次尝试的时间与 nonce 只生成一次，因此原文和输出头引用相同值。支持 1–32 段原文、1–16 个输出认证头。

不支持脚本、SpEL、任意环境变量读取或 `auth.secret` 字段引用，避免通过映射把共享密钥发送出去。需要其他签名协议时先检查这些原文/输出配置是否足够；非 HMAC-SHA256 或不同签名编码当前不支持，不能宣称支持任意认证算法。接收端需要的 anti-replay 字段必须按其协议配置进原文。

例如另一接收方要求“固定协议名 + 正文哈希”，输出到自定义头，只需配置：

```yaml
auth:
  type: hmac-sha256
  secret: "${OTHER_HOOK_SECRET}"
  canonical-fields:
    - value: custom-protocol
    - from: request.bodySha256
  headers:
    X-Custom-Signature:
      from: signature
```

## HTTP 配置

`subscriptions` 是以稳定订阅 ID 为键的 Map，ID 允许 1–64 个字母、数字、下划线和连字符。每个订阅可独立设置 `enabled: false`；一个事件可以有多个订阅。

- `event` 和 `event-version`：必须对应已注册事件与版本。
- `http.url`：HTTP(S) 绝对地址，允许部署环境的内部服务地址；不允许 URL 用户信息和 fragment。
- `http.method`：POST（默认）、PUT、PATCH、DELETE、GET；GET 不允许配置 body。
- `http.headers`：静态字符串请求头，支持 Spring `${ENV_VAR}` 占位符。若配置 Content-Type，只接受 `application/json`。
- `http.auth.type`：`none`（默认）、`bearer` 或 `hmac-sha256`。Bearer 使用 `http.auth.token`；通用 HMAC 使用 `secret/canonical-fields/headers`，可选 `client-id/separator/allow-loopback-http`。两种认证均不可与另一种凭据混用；动态认证输出头不能由静态 headers 重复配置。
- `required-data-fields`：订阅必需的白名单 data 字段名；字段缺失、为 null 或空字符串时过滤通知，不执行 HTTP。配置中不存在于事件 schema 的字段名会阻止启动。
- `retry.max-attempts`：总尝试次数，默认 1（不重试），允许 1–100；`retry.delay` 默认 5s，允许 100ms–5m；`retry.statuses` 指定可重试的 400–599 状态码；`retry.transport-errors` 默认 true，仅在次数上限大于 1 时生效。
- `http.body`：输出 JSON 字段与取值规则。每个字段必须且只能配置 `from` 或 `value`。`from` 仅接受上表路径；`value` 可为 YAML 字符串、数字、布尔值等常量。输出字符串使用 JSON 编码，不进行模板字符串拼接；当前只提供顶层字段映射，不执行脚本、SpEL，也不对 URL/Header 做事件字段插值。
- 非 GET 请求省略 body 或配置空 Map 时，发送默认的 `{ "event": { ... }, "data": { ... } }` 白名单信封。
- `defaults.connect-timeout` 默认 2s，`defaults.call-timeout` 默认 5s，均允许 1ms–60s；call-timeout 限制整个 HTTP 调用，不含队列等待。

执行器自动添加 `X-Hook-Event-Id`、`X-Hook-Subscription-Id` 和 `Idempotency-Key: <eventId>:<subscriptionId>`。这些 Header 以及 Host、Content-Length、Transfer-Encoding、Connection 不允许自行覆盖。HMAC 认证输出头也不能与静态 `http.headers` 同名（大小写不敏感）。

只有 2xx 视为成功。不会自动跟随重定向，禁用 HTTP 客户端的隐式重试，显式重试只按订阅策略执行，不附带当前用户的认证信息或 Cookie。调用地址和认证配置仅应由可信部署管理员维护；该功能不是面向普通用户开放的任意 URL 调用接口。

## 失败行为与可观测性

启用订阅的未知事件/版本、字段路径、非法地址或超时等会阻止启动，并给出具体配置路径。配置校验诊断不回显 URL、请求头或 Token 的值。配置加载失败时，仍需遵循部署日志的密钥访问控制。

独立线程池为核心 2、最大 4、队列 100，不复制用户 ThreadLocal。队列满时拒绝并记录结果，不转到注册请求线程执行。事务回调只负责入队，不等待 HTTP。延迟重试由独立定时线程唤醒后重新进入原执行器，最多保留 100 个待重试任务，不阻塞工作线程等待；达到上限时保留终止失败结果。进程退出、队列拒绝或接收方持续故障可能导致通知丢失；需要持久化可靠送达的业务不能仅依赖本版本。

失败日志记录订阅 ID、事件 ID、结果类别、状态码和耗时，不记录请求/响应正文、URL、Header 或原始网络异常内容。成功日志为 DEBUG。已有 MeterRegistry 时提供：

- `byclaw.hooks.deliveries`：按 `subscription`、`outcome` 计数。结果包括 `success`、`http_error`、`transport_error`、`rejected`、`mapping_error`、`no_transaction`、`filtered`、`retry_scheduled`。
- `byclaw.hooks.duration`：按 `subscription` 记录耗时；未开始 HTTP 的结果耗时为零。

暂停某个订阅或全局关闭需修改配置并重启，不会撤销已被接收端处理的请求。

## 接入其他业务事件

在业务模块提供 `HookEventSchema` Bean，定义事件类型、版本和数据字段白名单，然后在真实业务事务中调用 `HookPublisher.publish(type, version, data)`。业务负责判断成功和构造数据；通用 Hook 模块不依赖业务实体。注册部署订阅后才会对外发送。

不要在 Controller 返回 200 时统一触发，也不要订阅 `UsersCreatedEvent` 后将所有用户创建都当作自主注册。新增事件需验证提交/回滚、字段脱敏及实际业务入口；数据结构发生不兼容变化时提升事件版本。

## 验证范围

测试通过 Spring 外置配置加载、事务提交/回滚及回环 HTTP 验证通用行为。业务创建测试的外部数据库、Node 和授权依赖使用替身，不等于生产环境验收。

```bash
mvn -B -f byclaw-be/pom.xml -Dtest=HookIntegrationTest,HookAuthenticationIntegrationTest,TenantCreationHookTest,UserRegistrationHookTest,WorkgroupCreationHookTest,GroupChatCreationAndInvitationTest test
mvn -B -f byclaw-be/pom.xml verify
```
