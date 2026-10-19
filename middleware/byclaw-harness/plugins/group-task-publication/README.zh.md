# @byclaw/dsh-group-task-publication

[English](README.md) | 中文

可选 DSH 插件，为符合条件的 ByClaw 会话提供 `prepare_group_task_publication`。HACU 判断、启用状态持久化、工具注册、文件校验和 BE 调用均由本插件负责。ByClaw Integration 不依赖本插件，不安装它也可正常运行。

## 装配与启用

本插件监听 Integration 的可等待事件 `byclaw/session-setup`。Integration 提供可信消息、显式的 Agent 实例及 context，以及获取当前登录请求头和映射 `/by/` 路径的宿主回调，不包含发布专属分支、配置或存储字段。不拦截异步 `agent/created`，也不替换已有方法。

当 `extraPayload.groupChat.conversationKey` 和 `extraPayload.groupChat.childSessionId` 同时为非空字符串或正的安全整数时启用工具。taskId 只取 `command.header.sessionId`。本插件在自己的 `byclaw_group_publications` 存储域中按 userCode 和业务 `command.header.sessionId` 保存启用状态。首次启用后，切换 `agent_id`、重新创建 DSH 会话、后续消息省略 `groupChat`、插件重新加载或进程重启，都会保留启用状态。不同用户和业务会话彼此隔离。旧记录按其中保存的 taskId 和 userCode 读取，使用时复制到业务会话键；DSH 创建时间不再参与启用判断。已经存在的普通会话可在后续符合条件的消息到来时启用。

宿主在 Agent setup 和复用会话接收输入前等待该事件，包括后台团队运行期间的追问。状态持久化先于工具注册，并在工厂发布新建或恢复的 Agent 前完成。工具只通过目标 Agent context 注册；重复 setup 不会重复注册，Agent 销毁或发布插件卸载时会注销工具。加载插件不注册全局模型工具，也不请求 BE。

## 实现分工

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 插件配置及通用会话事件订阅 |
| `context.ts` | HACU 条件和可信任务、用户绑定 |
| `state.ts` | 插件自己的启用状态持久化 |
| `tool.ts` | 模型工具定义及作用域注册 |
| `client.ts` | 参数与文件校验、鉴权回调、BE 协议和错误处理 |

依赖方向为本插件指向 `@byclaw/dsh-integration/session-extensions`，Integration 不反向依赖本插件。Integration 通过通用回调复用已有 `resolveByClawAuthorization` 和 `resolveByClawInboundPath` 行为，本插件不额外创建 Redis 连接。POST 和文件预检的期限由本插件配置 `timeoutMs` 控制，默认 30000 毫秒。

## 工具行为

`text` 是完整替换的正文，最多 100000 字符；`sourcePaths` 是完整替换的附件列表，最多 100 个路径，每项 1–4096 字符。非空白正文或至少一个路径必须满足一项，拒绝未声明的参数。附件必须是当前用户挂载的 `/by/` 根目录内可读取的普通文件。宿主映射支持本地测试目录，发送给 BE 的仍是原始虚拟路径。原始 JSON Schema 保留长度限制，Zod 在执行时强制校验；当前 DSH PTC 渲染器可能将有长度限制的入参类型表示为 `unknown`。

每次调用都通过宿主回调刷新登录请求头，要求存在 `Beyond-Token`，并设置 JSON Content-Type。`groupChat.contextToken` 不作为认证凭证。请求只发送一次 POST，地址为服务前缀下的 `/group-chat/tasks/{taskId}/pending-publication`；仅配置域名时补上 `/byaiService`。BE 校验 ACTIVE 状态、发起人身份和当前群成员资格，并在提交后推送私有卡片。

成功必须同时满足 HTTP 成功、`ResponseUtil.code` 为数字 `0` 或字符串 `"0"`，以及响应数据有效且 taskId 转为字符串后匹配。数字形式的任务和卡片 ID 必须为正的安全整数，更大的 ID 必须以上游字符串传入。只返回 `taskId`、`pendingPublicationId`、`text`、`sourcePaths` 和未经转换的 `createTime`；仅附件卡片的 `text` 可以为 `null`。已知业务错误返回安全的说明，不返回原始诊断或凭证。

准备卡片不会上传文件、发送群消息或完成任务；用户在 BE 卡片上确认发布。连接丢失、成功响应损坏或无法核实的结果均报告不确定，不自动重试 POST。同一地址的 GET 可查询当前卡片，但无法证明是哪一次并发请求产生的。

## 安装与验证

将本插件与 Integration 放入 DSH 工作区，先构建 Integration，再构建本可选插件，并把两者加入同一 profile。仓库 Docker 流程会自动发现所有插件 bundle，并按依赖顺序构建。

```sh
pnpm --filter @byclaw/dsh-integration run build
pnpm --filter @byclaw/dsh-group-task-publication run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/byclaw-integration
dsh plugin --profile web add /path/to/deepseek-harness/plugins/group-task-publication
pnpm --filter @byclaw/dsh-group-task-publication run verify
```

`--dump-config` 会显示 `group-task-publication`，其 patch 不包含凭证或宿主专属路径。验证覆盖参数和文件校验、鉴权、失败不重试、可选安装、等待状态写入、会话复用和恢复以及插件卸载，不请求 Redis 或 BE。

结果不确定时，错误会区分连接失败、HTTP 状态、JSON 解析、响应校验及任务身份不匹配。诊断只包含固定说明、状态码和已知字段名，不包含原始响应内容或凭证，也不会自动重试 POST。

运行日志统一使用 `[group-task-publication]` 前缀，每次调用通过 `requestId` 关联。日志包含参数、鉴权、文件校验阶段，POST 地址和超时配置，HTTP 状态、Content-Type，经过脱敏和长度限制的响应摘要（code、msg、ID、创建时间、正文长度、附件数量），以及成功或失败结果。网络失败会记录可识别的连接错误码和取消状态。不打印请求头、完整发布正文、附件路径和未知响应字段；非 JSON 响应只记录长度。
