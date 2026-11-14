# @byclaw/dsh-group-task-publication

[English](README.md) | 中文

可选 DSH 插件，为符合条件的 ByClaw 会话提供 `prepare_group_task_publication`。HACU 判断、启用状态持久化、工具注册、文件校验和 BE 调用均由本插件负责。ByClaw Integration 不依赖本插件，不安装它也可正常运行。

## 装配与启用

本插件监听 Integration 的可等待事件 `byclaw/session-setup`。Integration 提供可信消息、显式的 Agent 实例及 context，以及获取当前登录请求头和映射 `/by/` 路径的宿主回调，不包含发布专属分支、配置或存储字段。不拦截异步 `agent/created`，也不替换已有方法。

当 `extraPayload.groupChat.conversationKey` 和 `extraPayload.groupChat.childSessionId` 同时为非空字符串或正的安全整数时启用工具。taskId 只取 `command.header.sessionId`。本插件在自己的 `byclaw_group_publications` 存储域中按 userCode 和业务 `command.header.sessionId` 保存启用状态。首次启用后，切换 `agent_id`、重新创建 DSH 会话、后续消息省略 `groupChat`、插件重新加载或进程重启，都会保留启用状态。不同用户和业务会话彼此隔离。旧记录按其中保存的 taskId 和 userCode 读取，使用时复制到业务会话键；DSH 创建时间不再参与启用判断。已经存在的普通会话可在后续符合条件的消息到来时启用。

通过 `direct-tasks` 打开的私聊也可以使用工具。BE 从已鉴权的私聊记录生成 `groupPrivatePublication`，其中的私聊 ID 必须与命令头一致。插件保存来源群和租户绑定，在恢复会话或准备下一份租户草稿时沿用 `X-Enterprise-Id`。私聊无需发送群 @ 消息，也不参与 CHAT/TASK 判定。

宿主在 Agent setup 和复用会话接收输入前等待该事件，包括后台团队运行期间的追问。状态持久化先于工具注册，并在工厂发布新建或恢复的 Agent 前完成。工具只通过目标 Agent context 注册；重复 setup 不会重复注册，Agent 销毁或发布插件卸载时会注销工具。加载插件不注册全局模型工具，也不请求 BE。

Codex 固定路由通过 `byclaw/coding-setup` 复用相同启用状态与任务绑定，无需创建 DSH Agent。符合条件时在专用 `CODEX_HOME` 注册 `prepare_group_task_publication`。MCP 将请求写入本轮私有目录，runner 经 stdout 通知 Harness；Harness 调用已绑定的 `publication.prepare()`，复用原 DSH 客户端，每次通过宿主刷新当前用户认证。MCP 不需要 `BEYOND_TOKEN`，不直接请求 BE。文件检查与结果回传使用同一 coding 租约；仓库开发模式只准备正文和真实 Git 提交状态，不附源码。重复事件不重复发请求，取消后不启动排队请求，CLI 退出后清理本轮桥接目录。工具仅准备待确认内容，不上传、不发群、不完成任务，不确定失败不重试。最终 JSON 的 `publication` 必须为空，避免重复准备。

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

`text` 是完整替换的正文，最多 100000 字符；`sourcePaths` 是完整替换的附件列表，最多 100 个路径，每项 1–4096 字符。非空白正文或至少一个路径必须满足一项，拒绝未声明的参数。附件必须是当前用户挂载的 `/by/` 根目录内可读取的普通文件。宿主映射支持本地测试目录，发送给 BE 的仍是原始虚拟路径。在用户树位于独立工具环境的共享 DSH 宿主上，附件经上下文的文件系统在工具环境中检查。原始 JSON Schema 保留长度限制，Zod 在执行时强制校验；当前 DSH PTC 渲染器可能将有长度限制的入参类型表示为 `unknown`。

每次调用都通过宿主回调刷新登录请求头，要求存在 `Beyond-Token`，并设置 JSON Content-Type。`groupChat.contextToken` 不作为认证凭证。请求只发送一次 POST，地址为服务前缀下的 `/group-chat/tasks/{taskId}/pending-publication`；仅配置域名时补上 `/byaiService`。BE 校验进行中的群任务或私聊、发起人身份和当前群成员资格，并在提交后推送私有卡片。

同一私聊最多有一张未确认卡，每次准备整体替换该卡正文和附件清单。用户确认指定卡片版本后，可以在原会话继续准备下一份成果。工具只校验源文件，BE 在确认时读取文件当时的内容，按卡片版本转存到独立目录。后续发布复用同一个文件名也不会覆盖之前已经发布的附件。

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

## 真人待办

配置 `taskManagerAgentIds` 为允许使用待办提案工具的数字员工资源 ID 字符串数组（默认 `[]`）。员工名称可以任意设置或修改；工具仅按可信入站 `groupChat.targetAgentId` 匹配，不依赖显示名。匹配时 DSH Agent 注册 `prepare_group_human_tasks`。工具从宿主取得 sourceTaskSessionId 和用户登录头，模型只提供完整条目列表及更新时的 batchId/expectedRevision；创建和编辑提案不代表确认派发。确认必须由原发起人在客户端完成。相同入站消息和提案内容使用稳定请求标识；不会自动重试写入或替换验收版本。

关联真人待办的执行会话，通过可信 `groupChat.humanTaskId` 或 `groupPrivatePublication.humanTaskId` 持久化关联标记，成果准备工具改为“等待确认提交任务”的说明。仍然只准备草稿，不上传、不提交、不发送群消息。BE `complete` 负责按持久化关联分流，不能仅凭模型标记改变业务行为。

新增提案工具只接入 DSH Agent 工具上下文；CLI coding runtime 继续获得成果草稿能力，未新增提案适配。业务 API 见 `byclaw-be/docs/api/group-human-tasks.md`。本地无密钥验证运行 `pnpm run verify`，包括真实工具注册 schema、作用域、身份拒绝、重复请求、更新版本和待办标记恢复；平台实请求需要另行验证。
