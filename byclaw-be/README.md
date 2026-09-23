# ByClaw-BE

> BeyondAI 后端服务 - 企业级 AI 应用平台

[![CI](https://github.com/byclaw/byclaw-be/actions/workflows/ci.yml/badge.svg)](https://github.com/byclaw/byclaw-be/actions)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Java](https://img.shields.io/badge/Java-21%2B-orange)](https://openjdk.org/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.x-brightgreen)](https://spring.io/projects/spring-boot)

## 简介

ByClaw-BE 是 BeyondAI 平台的后端服务，提供完整的 AI 应用开发和管理能力，包括：

- 🤖 **智能体管理** - 创建、配置和部署 AI 智能体
- 💬 **对话系统** - 支持多轮对话、流式响应
- 🔐 **权限控制** - 基于 RBAC 的细粒度权限管理
- 📚 **知识库** - 文档管理和检索增强生成 (RAG)
- 🛠️ **工具集成** - 灵活的插件和工具编排
- 📊 **数据分析** - 对话分析和性能监控

## 邮箱连接器凭证存储

`mail-form` 连接器（QQ、163、阿里邮箱、Fastmail、自定义 IMAP）按用户和连接器各保存一套账户配置。
配置以 `MAIL_CONNECTOR_<connectorId>` 为键，SM4 加密存入 `po_user_private_param`，标记为 `CONNECTOR` 托管参数。
它不会进入通用环境变量 Redis 缓存，也不能从个人参数编辑接口直接修改。再次授权会覆盖同一连接器配置。
邮箱验证阶段不写数据库；配置和授权绑定在同一事务中保存，事务提交后按连接器生成 `/by/.connector-auth/.mail/<connector-code>.json`（schemaVersion 2）。
当前仅 QQ、163、Gmail、自定义 IMAP 产生文件；未开放的连接器不会产生投影。

配置内的同步状态为 `PENDING`、`NORMAL` 或 `PROJECTION_FAILED`；个人参数行本身仍使用 `NORMAL` / `DISABLED`。
同步失败不会回滚授权，定时任务默认启动 90 秒后、每 300 秒扫描 Redis 待处理用户和数据库个人参数分页，
即使 Redis 待处理记录丢失或服务重启也能重新生成文件。邮箱列表和邮箱元数据缓存可查询同步状态。
撤销会清空配置密文并保留禁用记录，供后续扫描清理文件。

私有目录使用 `700`、凭证文件使用 `600`。优先使用 Java `SecureDirectoryStream`，
Linux NFS 不提供该接口时通过 JNA 使用 `openat`、`statx`、`renameat`、`unlinkat`、`fsync`，
需要 64 位 x86_64/ARM64 Linux、支持 statx 的内核及 libc。文件和目录均同步完成后才更新成功状态。
macOS 兼容实现只放在测试源码中；生产环境不支持安全文件操作时保持失败并重试。

邮箱列表、编辑、删除、连接检查、OAuth 授权、缓存及投影重试统一使用个人参数存储，不读写旧邮箱表，不兼容或迁移旧数据。
每个用户、每种邮箱连接器只有一个账号；跨服务商需删除原账号后新增，不允许在原连接器身份上直接切换服务商。
无默认邮箱；仅一个账号时 Agent 自动选择，多个账号且用户未指定时询问。
已移除旧企业邮箱适配器和特殊参数键。定时协调仅删除旧 `accounts.json`，不读取或迁移它；
后端与邮件运行时必须同步部署，并重新授权连接器。本功能不修改数据库结构或初始化数据。

## 核心特性

- **微服务架构** - 基于 Spring Cloud 的分布式架构
- **高性能** - 支持高并发对话和流式响应
- **可扩展** - 插件化设计，易于扩展新功能
- **多模型支持** - 支持多种大语言模型接入
- **企业级安全** - 完整的认证、授权和审计机制

## 聊天用户资料

- 前端用户资料卡及助手设置统一使用已有的 `GET /system/user/getUserSuas?userId=42`，不新增 `/assiman/getUserSuas` 接口。
- `userId` 是必填的用户主键（Long），不是工号或姓名；前端附带的 `language` 参数不参与用户查询。用户不存在时返回 `{code: -1, msg: '用户不存在'}`。
- 成功返回 `{code: 0, data: {...}}`，资料卡读取 `userId`、`userName`、`userCode`（工号）、`phone`（沿用解密脱敏规则）、`pathName`（部门路径）、`positionName`（职位）。保留现有超级助手字段，助手或岗位记录缺失不会导致空指针异常。

## 群列表消息摘要

- `GET /group-chats?pageNum=1&pageSize=20` 仅在返回时将 `latestMessageContent` 中的 `{{DIG_EMPLOYEE_资源ID}}`、`{{HUMAN_资源ID}}` 转成 `@名称`，名称取最新消息 metadata 中 `resourceList.resourceName` 的快照。
- Agent 的 `[@成员名称](uid=成员UID)` 同样转成 `@名称`；优先使用资源快照名称，没有快照时使用链接中的成员名称。无法找到名称的占位符和其他资源占位符保留原文。
- 该转换适用于已有消息，不修改数据库正文、WebSocket 消息或 Agent 调度；查询所需的消息 metadata 不包含在接口响应中。

## 群聊入群授权

- 管理员邀请真人成员（`invite`）与用户接受链接邀请（`acceptInvitation`）统一经 `insertMember` 补齐项目成员和群内全部数字员工的使用授权；已是项目成员或群未关联项目时，也会补齐员工授权。
- 员工授权只追加 `DIG_EMPLOYEE / USER / FORCE_USE` 红名单，已有有效同维度授权不重复插入，其他红名单和全部黑名单保持不变，黑名单仍按既有规则优先生效。
- 项目成员、群成员和员工授权共用数据库事务，任一写入失败整体回滚。权限集合与用户权限缓存在事务提交后同步，回滚不发布权限缓存。
- 本次不处理退出或移除成员后的撤权，也不补建群初始授权、后续邀请数字员工时向已有真人授权或存量群数据。

## 群聊成员系统消息

- 已有工作组的直接邀请（真人或数字员工）、链接入群、主动退出和管理员移除，各保存一条 `byai_message.usage=5` 消息。建群时的初始成员不生成消息；最后一位真人群主退出仍走解散，不生成退群消息。角色变更和解散提示不在此类持久化范围内。
- 正文分别为 `邀请者 邀请 成员 加入工作组`、`成员 离开了工作组`、`操作者 将 成员 移出工作组`。名称保存操作时的快照，优先群昵称，再取用户或数字员工名称，缺失时显示 ID。链接入群使用链接记录中的邀请者，不使用加入者或转发者作为邀请者。
- 消息与成员变更同事务保存。提交后保留 `MEMBER_ADDED` / `MEMBER_REMOVED` 成员通知，并发送 `GROUP_CHAT_EVENT / MESSAGE_CREATED` 消息；失败回滚、重复入群不产生新消息。WebSocket 仍为尽力投递，掉线后通过历史接口恢复。
- `POST /group-chats/{sessionId}/context` 返回包含 `usage=5` 的会话时间线。历史与实时消息均提供 `messageId`、`usage=5`、`kind=SYSTEM_EVENT`、`role=event`、`speaker.type=system`、`content`、`createdAt` 和 `systemEvent`。`systemEvent` 含 `eventType`（`MEMBER_INVITED` / `MEMBER_LEFT` / `MEMBER_REMOVED`）、`operatorId`、`operatorName`、`memberId`、`memberType`、`memberName`；ID 使用字符串。前端按 `messageId` 合并实时与历史消息，后续需适配系统消息展示。
- Agent 使用的 `GroupChatContextService.load` 仍只读取 `usage=1/2`，筛选发生在分页与截断之前。`GroupChatSessionContextFileService` 写入 `group-history.json` 和 `task-history.jsonl` 时排除系统事件，也不通过回复引用带入系统事件正文。这些事件不会作为模型指令或助手回答进入上下文。
- 本次不改前端、不回填旧事件、不扩展消息搜索范围，也不修改数据库结构或初始化 SQL。

## 群聊引用续聊与自动协作

- 用户非引用 `@` 创建新的协作链；引用群消息或 Agent 之间 `@` 时，在该链中复用目标助理的子会话。每个助理保留自己的 session，首次参与时创建；重复消息只登记一次 turn。
- 每轮输入保存原始用户需求、本次实际发送者类型/ID/名称、接收者以及本次完整正文；Agent 委派传入其最终回复，资源列表同时保留背景和当前正文中的成员引用。
- 上述完整上下文只保存在 turn 调度快照中。子会话消息正文及普通聊天请求只保留“本次消息”的原文；首次执行和普通追问均在 Gateway 出站时追加上下文，Agent 仍可读取原始需求、参与者和已发布成果。此调整适用于新写入的消息，不自动改写历史消息。
- `byai_group_chat_turn` 持久化逐轮身份、输入、分类、trace 和队列状态。同一 session 串行执行，不同 session 并行；自动 Agent 调用每条分支最多 6 跳，用户新消息重新开始自动计数，重试和等待不增加次数。
- 未完成任务（`ACTIVE`，包括 `WAITING_USER`）不接受群引用或 Agent 自动续接，排队消息执行前也会重新检查。进入任务子会话仍可按原有流程处理任务。
- 引用已结束任务时，直接以 `CHAT_CONTINUATION / CHAT` 在对应原子会话回答，保留原始需求和已发布成果上下文，不再创建内部评估会话或等待分类文件。提示词禁止修改、新增交付物或重新发布旧任务；遇到此类请求，提醒用户在群里直接 @助理发起新请求，不要使用引用回复。旧任务和发布记录保持不变。
- 兼容旧版记录：尚未绑定 trace 的 `ASSESSMENT` 由调度器转为原会话追问；已绑定 trace 的旧评估结束为 `ASSESSMENT_RETIRED`，需要重新发送引用追问，不重发旧请求或投影内部答复。历史 `GROUP_CHAT_ROUTING` 会话继续禁止从普通入口访问。
- 新表迁移位于 `deploy/migrations/versions/V0.4.1/V0.4.1__ddl.sql`，启动新版后端前须执行对应迁移。既有 execution 保留为会话入口和旧记录恢复依据，不重放已完成历史调用。
- 后端重启可恢复领取后尚未绑定 trace 的 turn，事务锁和 trace 条件更新防止重复发送。确定发生在 Gateway 路由前的准备失败会结束该 turn；已绑定 trace 且送达情况未知的请求不盲目重发，因此异常远端调用可能继续占用队列，需沿原运行恢复流程处理。

## 群聊上传附件

- 群历史、Agent 群上下文、消息定位和话题根消息/回复/引用均保留正文为 `NULL` 但有 `related_resources` 的历史消息，分页计数采用同一条件。消息搜索排除 `NULL` 正文，关键词仅匹配正文，不搜索附件文件名；LIKE 使用 `ESCAPE CHR(92)`，兼容 Druid PostgreSQL 解析器并按字面匹配 `%`、`_` 和反斜杠。

- `GROUP_CHAT_SEND` 的 `files` 与正文一同保存到消息的 `relatedResources.files`，并随 `MESSAGE_CREATED` 广播返回。仅附件消息和正文带附件消息均支持发送确认后的展示及历史加载。
- 群聊消息 @ 数字员工时，本次消息的 `relatedResources.files` 会恢复到派发请求的 `files`，由 Gateway 作为 `text/files` 内容发送。若本次消息引用了其他群消息，派发提示词中的“本次引用消息”会明确给出引用 ID、正文、发言者和附件；已撤回的引用不会透出原正文或附件。
- `files` 非空时，`chatContent` 支持空字符串、纯空白、`null` 或省略；`null` 和省略正文按空字符串保存并广播，成功后返回 `GROUP_CHAT_ACCEPTED`。
- 此修复无需数据库迁移。修复前未保存附件关联的旧消息不会自动恢复，需要重新发送附件。

## 群聊待发布成果编辑

- `POST /byaiService/group-chat/tasks/{taskId}/pending-publication` 接受 `text`、`sourcePaths` 和可选的 `expectedPendingPublicationId`。编辑客户端必须以十进制字符串传入当前正数 ID，例如 `{"expectedPendingPublicationId":"95001","text":"修改后的正文","sourcePaths":[]}`；不传该字段时保留原 Agent / 客户端整体替换行为。
- 发起人仍在群内且任务为 `ACTIVE` 时才能准备内容。后端在任务行锁内比较当前卡片 ID；当前卡片缺失或 ID 不匹配时拒绝，不修改内容、不发送准备通知。成功整体替换并返回新 `pendingPublicationId`，清空旧上传进度，事务提交后发送私有 `TASK_PUBLICATION_PREPARED` 通知。
- 正文最多 100000 字符、附件最多 100 项、路径最多 4096 字符；正文与附件不能同时为空。移除附件只改变发布列表，不删除源文件或云盘文件，保存时不上传文件。
- 编辑客户端先保存，再用返回的新 ID 调用原 `POST /byaiService/group-chat/tasks/{taskId}/complete`，请求只传 `pendingPublicationId`，不能混传正文或附件。保存成功但确认失败时，未继续编辑的重试应复用该 ID 和上传记录；外部新版导致冲突时保留本地输入，由用户核对最新版。
- 本次编辑能力无需数据库迁移，部署顺序为后端先、前端后；旧后端忽略新增字段，不能提供编辑版本保护。回退前端不影响旧准备和确认调用。

## 群聊任务执行与恢复

- 群聊分类和 disposition 文件写入要求 Agent 静默执行；过程正文、最终答复和 `taskName` / `ackText` 只包含用户业务内容，不汇报内部分类、控制文件或协议。此约束由请求提示词引导，不改变分类文件读取和任务提升流程。

- Agent 成员引用仅接受 `[@成员名称](uid=目标成员uid)`；旧式 `uid?=`、普通 @ 文本和占位符不触发引用解析。合法引用保存到群历史前转换成 `{{目标成员uid}}` 并生成 `resourceList`，其中数字员工引用继续触发 child execution。

- 子任务 WebSocket 广播复用普通聚合器处理后的增量，答案和思考事件携带 `messageRenderVersion="v2"` 及对应分段 `seq`。无发起端连接或 BE 恢复后也使用同一格式，广播不会再次聚合正文。

- `TASK` 的 Agent 答案保存在独立任务会话；当前 turn 结束后进入 `WAITING_USER`，仍须发起人确认完成并发布到群里。
- 初次群聊任务和 `ACTIVE` 任务子会话续聊通过 Gateway 追加统一交付提醒：Agent 在本轮交付可检查的新产物或修改版本后，温馨提醒用户检查，确认无误后可让 Agent 帮忙发布到群里。普通问答、未交付、失败、等待补充信息及已进入发布确认时不提醒；已结束任务的追问不追加此提示。提醒不授权自动发布，也不改变现有确认流程。
- 群聊候选子会话从首个 turn 起复用 `ScriptService → RouteService → SessionStreamManager`，由普通聊天链路维护 Redis running/runtime、running snapshot、WebSocket 增量和完整消息落库。没有发起端 WebSocket 连接也能运行；用户在执行中进入或刷新任务会话时，普通聊天页加载快照后继续接收更新。
- 一条群消息引用多个数字员工时，各员工使用独立的子会话、trace 和回答消息 ID。首条消息完整保留 `resourceList` 供展示，子会话成员统计只计入实际执行的目标员工，BE 重启恢复后仍保持这一约束。
- 群聊观察器只负责读取 disposition 文件、提前提升 TASK、发送群内回执，以及从已落库的最终答案投影 CHAT 回复；不再独立消费或 ACK 子会话 Stream。初始投影失败可由持久化 execution 补偿，运行超过十分钟不会自动重新发送 Gateway 请求。
- 当前没有可靠的远端执行租约，因此不对“运行中但长时间没有结果”的任务盲目重发。若投递结果不确定或远端失联，应先核实 Gateway/Agent 状态；用户可取消异常任务。此修复不会自动恢复此前已经误标为 `SUCCEEDED` 的记录。
- Gateway 事件身份校验、流式聚合和恢复使用普通聊天链路。群聊完成投影按子会话和 trace 关联，并以已落库的回答为依据。结束事件已被看到不代表持久化及完成回调已成功；只有成功标记才允许重投时直接 ACK，避免失败回调被跳过。

## 任务内切换 Agent 与历史文件

- 未发布的群聊任务在当前 turn 结束后，发起人可以在同一子会话切换其他群内数字员工；目标员工必须存在并具有当前用户的资源授权。运行中的任务不能并行切换，已发布或已取消的任务不能从私有入口重新启动。
- 切换只改变本轮执行者。任务的初始目标和最终群结果署名保持为最初被 @ 的 Agent，子会话历史通过消息 metadata 中实际的 `agentId` 区分不同员工的正文。
- 群聊派发前，BE 在发起人的 UserFS 私有工作区生成 `/.sessions/{childSessionId}/.byclaw/context/{turnKey}/group-history.json`；任务子会话仅在本轮 Agent 与最近实际回答的 Agent 不同时生成群历史和 `task-history.jsonl`；同 Agent 续聊不生成这两份交接文件。Agent 的读取路径带 `/by` 前缀，由群聊历史和任务接手两个独立提示方法提供。提示只描述相关历史和文件路径，不暴露边界字段或讲解截断。执行端须具备该工作区的挂载及文件读取能力。
- 群历史沿用原有快照边界和上限（60 条、30,000 正文字符），任务续聊不会隐式读入委派后新增群消息。任务文件按本轮输入之前的消息顺序分页导出全部已持久化的用户／Agent 正文，不附加 inferLog、工具日志或结构化消息 JSON，不生成摘要。
- 每轮路径隔离；仅全部文件和完成标记写入成功后才发送 Gateway 请求。同轮重试验证并复用成功快照；查询、序列化、写入或完整性检查失败时提示“历史上下文准备失败，请重试”，本轮不发送。文件不写入公共群目录。
- 原有 `groupChat` 参数、OpenClaw 历史加载及注入保留，与文件提示并存。普通非群聊会话不生成上述文件。

## 最终正文持久化

- 共用聊天链路收到有效 `finalAnswer` 或 `final_answer` 时，`messageContent` 优先保存该正文，已有 `final_content` 同步记录；缺失、空白或 `[DONE]` 则保持累计正文回退。最终正文事件本身不结束 turn。
- `messageStruct` 仍保存完整结构化答案段供展示，`inferLog` 独立保存；运行快照分别保存累计正文和显式最终正文，恢复和重放不重复拼接。重新生成没有最终正文时，清除之前的 `final_content`。
- 历史文件直接读取 `messageContent`。已有消息无需回填；公开群回复仍保留原有可见性规则，不将工具过程或未完成的中间正文发布到群。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              外部服务层 (External Services)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  AI Writer   │  │   Chat BI    │  │   Sandbox    │  │   Python     │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Knowledge   │  │   Manager    │  │  Doc Chain   │  │   Memory     │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
└─────────┼────────────────┼────────────────┼────────────────┼───────────────┘
          │                │                │                │
          └────────────────┴────────┬───────┴────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────────┐
│                          Feign 客户端层 (Feign Clients)                      │
│                     ┌─────────────┴─────────────┐                           │
│                     │    FeignConfiguration     │                           │
│                     │   (服务调用/负载均衡/熔断)   │                           │
│                     └─────────────┬─────────────┘                           │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────────┐
│                         应用服务层 (Application Layer)                       │
│  ┌────────────────────────────────┼────────────────────────────────────┐   │
│  │                         ByClaw-BE Service                          │   │
│  │                                                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │   │
│  │  │   Auth      │  │   Agent     │  │Conversation │  │Knowledge │ │   │
│  │  │  认证授权    │  │  智能体管理  │  │   对话系统   │  │  知识库   │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────┬─────┘ │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │   │
│  │  │    Tool     │  │   Storage   │  │     Log     │  │  Common  │ │   │
│  │  │  工具集成    │  │  文件存储    │  │   日志监控   │  │  公共组件 │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────┬─────┘ │   │
│  │         └─────────────────┴────────────────┴──────────────┘       │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │              Elasticsearch 搜索服务层                      │   │   │
│  │  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │   │   │
│  │  │  │ Agent Meta │  │ Message    │  │   Message Rel      │  │   │   │
│  │  │  │   Index    │  │    Hot     │  │      Obj           │  │   │   │
│  │  │  └────────────┘  └────────────┘  └────────────────────┘  │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────────┐
│                        基础设施层 (Infrastructure)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │   MySQL     │  │   Redis     │  │Elasticsearch│  │   MinIO/OSS      │   │
│  │  关系数据库  │  │   缓存      │  │   搜索引擎   │  │   对象存储       │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 模块说明

### 核心模块

| 模块 | 路径 | 功能说明 |
|------|------|----------|
| **认证授权** | `application/service/auth/` | JWT 认证、RBAC 权限控制、用户会话管理 |
| **智能体管理** | `domain/agent/` | AI 智能体 CRUD、提示词模板、模型配置 |
| **对话系统** | `domain/chat/`, `conversation/` | 多轮对话、流式响应、会话管理 |
| **知识库** | `domain/knowledge/` | 文档管理、向量检索、RAG 实现 |
| **工具集成** | `domain/toolkit/` | 工具注册、动态加载、执行编排 |

### 基础设施模块

| 模块 | 路径 | 功能说明 |
|------|------|----------|
| **搜索服务** | `common/elasticsearch/` | 智能体索引、消息热数据、关联对象搜索 |
| **文件存储** | `storage/` | MinIO/阿里云 OSS 文件上传下载 |
| **日志监控** | `log/` | 异常日志、链路追踪、审计日志 |
| **公共组件** | `common/` | 加密工具、JWT、国际化、工具类 |

### 外部服务集成 (Feign)

| 服务 | 客户端 | 功能 |
|------|--------|------|
| AI Writer | `FeignAiWriterService` | AI 写作服务 |
| Chat BI | `FeignChatBiService` | 智能 BI 分析 |
| Knowledge | `FeignKnowledgeService` | 知识库服务 |
| Sandbox | `FeignSandboxService` | 沙箱执行环境 |
| Python | `FeignPythonToolService` | Python 工具执行 |
| Memory | `FeignPythonMemoryService` | 记忆服务 |
| Manager | `FeignManagerService` | 管理服务 |
| Doc Chain | `FeignDocChainService` | 文档链服务 |

## 项目结构

```
byclaw-be/
├── src/main/java/com/iwhalecloud/      # 源码目录
│   ├── aiFactory/byai/                 # AI Factory 模块
│   │   ├── application/                # 应用服务层
│   │   │   └── service/
│   │   │       ├── auth/               # 认证授权服务
│   │   │       ├── agent/              # 智能体服务
│   │   │       ├── chat/               # 对话服务
│   │   │       └── ...
│   │   ├── domain/                     # 领域层
│   │   │   ├── agent/                  # 智能体领域
│   │   │   ├── chat/                   # 对话领域
│   │   │   ├── auth/                   # 权限领域
│   │   │   ├── knowledge/              # 知识库领域
│   │   │   └── toolkit/                # 工具领域
│   │   ├── infrastructure/             # 基础设施层
│   │   │   ├── config/                 # 配置类
│   │   │   └── database/               # 数据库配置
│   │   └── interfaces/                 # 接口层
│   │       ├── controller/             # REST API
│   │       └── response/               # 响应封装
│   └── byai/                           # ByAI 模块
│       ├── common/                     # 公共组件
│       │   ├── elasticsearch/          # ES 搜索服务
│       │   ├── feign/                  # Feign 客户端
│       │   ├── jwt/                    # JWT 认证
│       │   ├── log/                    # 日志服务
│       │   └── util/                   # 工具类
│       ├── conversation/               # 对话服务入口
│       └── storage/                    # 文件存储
├── config/                             # 运行时配置
├── scripts/                            # 脚本工具
└── pom.xml                             # Maven 配置
```

## 快速开始

### 外部子会话快照恢复

外部子会话按确定的 Redis key 读取快照；首次消息或快照过期时直接返回缺失，
不执行 `KEYS` 或全库 `SCAN`。保存快照时同步登记专用 ZSET
`byai:chat:running:external-child:index`，只有索引与快照写入均成功后才允许后续广播和 ACK。
单机/哨兵使用 pipeline，Jedis Cluster 使用单 key 索引脚本后再保存快照，避免跨 slot 脚本和
不受支持的 Cluster pipeline。索引保留约 31 分钟，快照仍保留 30 分钟；每次登记最多清理
16 个过期索引项。已落库快照仍可用于重连，恢复通过已落库 Stream 水位过滤，不能直接删除
索引项，否则旧版本落库可能误删新版本的恢复入口。

启动恢复由独立的 `scoped-message-recovery` 线程执行，只遍历该索引，每批最多读取 100 个
快照及其水位，批次间等待 100ms；落库队列有至少 100 个待处理会话时暂停补入恢复数据。
实时消息入队不等待恢复线程，恢复数据不会替换正在排队的实时消息；恢复写入前再次核对
已落库水位，避免覆盖本实例已经完成的新写入。

这不是跨实例的版本写入协议：水位检查与数据库写入之间仍有竞态窗口，多实例同时恢复与写入
同一消息时仍需依赖后续的分布式互斥或数据库版本条件更新；本次修复不提供跨实例写入顺序保证。

**首次升级注意：**旧版本快照没有该索引，缺失索引时不会退回全库扫描。升级前应停止向旧实例
分配新消费任务，并正常关闭、确认 write-behind 队列已排空；仍有未落库快照时应先完成落库再
移除旧实例。旧快照的精确 key 重连读取保持可用，但不可依赖新版本启动自动发现旧的无索引积压。

真实 Redis 回归测试仅连接本机一次性测试实例（测试会清空该实例数据库）：

```bash
BYCLAW_TEST_REDIS_PORT=16389 mvn -B -f byclaw-be/pom.xml \
  -Dtest=ExternalChildSnapshotRedisTest,RunningChatSnapshotServiceTest,ScopedMessageWriteBehindTest test
BYCLAW_TEST_REDIS_CLUSTER_PORT=16390 mvn -B -f byclaw-be/pom.xml \
  -Dtest=ExternalChildSnapshotRedisClusterTest test
```

### 会话消费并发与背压

会话事件处理使用按 session 隔离的 `ReentrantLock`，保持同一会话串行，并避免 Java 21 虚拟线程
在持有 `synchronized` 监视器等待 I/O 时占住载体线程。启动登记和结束清理同样使用按会话的
生命周期锁；全局上下文锁只保护内存操作，不覆盖 Redis 调用。

Session Stream 的 key 继续由 Gateway SDK 全局协议决定，只使用既有 v1/v2；Redis Cluster 沿用带
hash tag 的 v2。BE 使用独立的 Lettuce/Netty 连接执行非阻塞、单 key `XREADGROUP`，多个会话共享底层
NIO 连接，不再为每个会话占用一个阻塞线程和 Jedis 连接，也不再设置 listener 数量上限。
每个会话同一时刻最多存在一个读取命令；实例级 in-flight 上限只延后轮询，不拒绝会话注册。
空闲轮询采用 5ms 到 250ms 的指数退避，读取异常每秒重试，业务回调转交 Java 21 虚拟线程，
不会阻塞 Netty event loop。集群模式始终发送单 key 命令，因此不会产生跨槽读取。

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `byclaw.session-stream.reactive-max-in-flight-reads` | 256 | 实例级 Redis 读取命令并发上限；饱和时延后轮询 |
| `byclaw.session-stream.reactive-poll-min-delay-millis` | 5 | 有消息时的最小轮询间隔 |
| `byclaw.session-stream.reactive-poll-max-idle-delay-millis` | 250 | 空闲轮询的最大退避间隔 |
| `byclaw.session-stream.reactive-poll-error-delay-millis` | 1000 | Redis 读取失败后的重试间隔 |
| `byclaw.session-stream.batch-delay-millis` | 20 | 消费合并窗口；0 关闭合并 |
| `byclaw.session-stream.batch-queue-capacity` | 256 | 每个 listener 的待处理缓冲上限 |
| `byclaw.running-snapshot.write-behind-millis` | 50 | 主会话快照合并窗口 |

每次最多处理 100 条消息，只合并连续且属于同一子会话、同一轮次的增量，合并后生成一次完整快照。
每个 listener 最多缓存 256 条待处理消息，加一个最多 100 条的执行/重试批次；满时阻塞该会话的
读取任务。这是 listener 队列上限，不等于 PEL 上限；单次读取尚未交付的记录也已进入 PEL。
未生成持久化快照的消息保留在 Redis PEL，成功后才逐条 ACK。业务处理失败后每秒重试
失败的后缀，后续事件等待，避免结束事件越过未持久化的增量。关闭 listener 时未处理的缓冲消息仍在 PEL；已完成持久化的执行中批次继续 ACK，
避免 HTTP 结束事件先关闭监听而遗留已处理消息。关闭后 ACK 失败登记到恢复队列，不再启动本地重试。
合并能减少完整投影的构建和传输次数；单次完整快照成本仍随回答长度增长。

子会话 WebSocket 广播按客户端等待实际 Netty 写入完成，每个连接最多一个执行中写入；
待发送队列仅保留同一 messageId 的最新完整投影，不同轮次分别保留，避免覆盖上一轮终态。
默认最多 64 个待发送消息投影、64 MiB 编码后内容（含执行中帧）、单帧 8 MiB、写入期限 5 秒。
分别通过 `byclaw.scoped-message.websocket-max-pending-contexts`、`websocket-max-retained-bytes`、
`websocket-max-frame-bytes`、`websocket-write-timeout-millis` 配置（后三项使用相同前缀）。
超过限制、写入超时或失败时关闭该慢客户端连接并记录日志；客户端重连后从持久化快照/历史恢复。
该限制只作用于子会话完整投影，编码字节限制不等于 JVM 实际堆占用，也不限制其他 WebSocket 事件。

活跃子会话复用本实例已加载的轮次标识；冷启动和终态之后重新读取 Redis 校验轮次。快照失败后
丢弃尚未持久化的内存累积，重试从已持久化水位恢复。主会话快照写入使用 4 个后台线程，Redis I/O
位于每个 key 的写锁内，消费入队只操作内存；终态写入等待旧写入结束，再覆盖为最终版本。

普通快照的 messageId 查询使用有 TTL 的精确索引，session 查询只遍历该 session 的 ZSET 索引。
`RunningChatSnapshotService` 的查询和删除均不再执行 Redis `KEYS` 或全 keyspace `SCAN`。
旧版本未建立索引的快照仍可通过精确 trace key 读取，不能通过新索引按 messageId 自动发现。

运行态扫描使用 SSCAN 加每批最多 100 条 MGET；恢复任务使用有界工作队列，按会话去重并轮转调度。
接管时先暂停新消息读取并保留租约和并发名额，每次最多处理 100 条 PEL 消息，约 1 秒后重新排队
处理下一批；历史消息处理完成后才放行新消息，业务失败停在失败位置重试。慢会话不会独占整个恢复线程。
会话运行态更新和取消也使用按会话的锁，Redis I/O 不再持有全局监视器。租约续期与 running 标记刷新
分别使用独立线程池；续期异常会停止归属不确定的本地监听，后续通过恢复流程接管。

### DSH AgentTeams 沙箱活跃心跳

DSH 的 `plugins/byclaw-integration` 插件按实际运行态汇总沙箱忙闲状态：父会话空闲时，仍在运行的
AgentTeams 子 Agent 或待响应交互会继续保持 busy。插件在忙闲切换时立即上报，并每 30 秒发送
新快照；使用至多一个正在发送的请求和一个待发送的最新快照，避免心跳积压。

后端默认订阅 `byai_gateway:registry:worker:stats:dsh`，识别
`byclaw_dsh.busy_state.redis_stats` v1 / `byclaw-dsh-busy-state` v1 消息，仅刷新该用户运行中的
`byclaw-dsh` 沙箱的访问时间、缓存及健康状态。DSH 心跳的 `emittedAt` 和 `payload.generatedAt`
都必须在最近 120 秒内，且不能超前服务器时间超过 30 秒；idle 不续活跃时间。
`sandbox.running-state.dsh-topic` 可覆盖订阅主题，
`sandbox.running-state.dsh-max-age-seconds` 可调整最大消息年龄，生产两端主题应保持一致。

此修复需要同时更新 DSH 插件和后端，只有 Worker 注册心跳无法替代沙箱忙闲心跳。
子任务结束后停止续活跃时间，沙箱按原有空闲超时规则释放；OpenClaw 心跳协议保持兼容。

### 环境要求

- Java 21+
- Maven 3.8+
- MySQL 8.0+ / PostgreSQL / OpenGauss
- Redis 5.0+
- Elasticsearch 7.x+ (可选)

### 安装

```bash
# 克隆仓库
git clone https://github.com/byclaw/byclaw-be.git
cd byclaw-be

# 编译项目
mvn clean compile

# 运行测试
mvn test

# 打包
mvn package -DskipTests
```

### 配置

1. 复制配置文件模板：

```bash
cp src/main/resources/application-dev.yml \
   src/main/resources/application-local.yml
```

2. 修改 `application-local.yml` 中的数据库、Redis 等连接配置

3. 启动服务：

```bash
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

### 短信验证码配置

阿里云短信配置通过 `config/application.properties` 和部署配置
`deploy/config/application.properties` 映射以下环境变量：
`ALIYUN_SMS_ACCESS_KEY_ID`、`ALIYUN_SMS_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME`、
`ALIYUN_SMS_ENDPOINT`、`ALIYUN_SMS_TEMPLATES_LOGIN`、`ALIYUN_SMS_TEMPLATES_REGISTER`。
Endpoint 默认使用 `dysmsapi.aliyuncs.com`，登录和注册模板均须包含 `${code}` 参数。
本地启动读取项目根目录 `.env`；Docker Compose 通过 `env_file` 注入变量，修改后需重建后端容器。
发送接口要求有效的图形验证码及同一 Session，并依赖数据库与 Redis。
`GET /system/session/captcha` 与 `POST /system/session/sms/send` 允许匿名访问，部署时加上配置的 context-path（例如 `/byaiService`）。放行按 HTTP 方法和完整路径匹配；图形验证码仍为两分钟有效且只能使用一次，手机号重复发送间隔和按 IP、业务类型计数的限流仍然生效。

### 微信小程序手机号登录配置

BE 的 `config/application.properties`（部署时为 `deploy/config/application.properties`）从服务端环境变量读取 `WECHAT_MINIAPP_APP_ID` 和 `WECHAT_MINIAPP_APP_SECRET`，绑定为 `wechat.miniapp.app-id`、`wechat.miniapp.app-secret`。二者必须属于发起手机号授权的同一个微信小程序，不能放进小程序包。可选的 `WECHAT_MINIAPP_LOGIN_RATE_LIMIT_PER_MINUTE` 默认为 300。

本地运行时将变量放在项目根目录 `.env`；Standalone Docker Compose 通过 `env_file` 读取该文件。K3s 部署需从 Secret 等服务端密钥来源注入这两个环境变量。未配置时 BE 可以启动，但 `POST /system/session/loginByWechatPhone` 会返回受控登录失败，不会尝试兑换手机号。

## 技术栈

- **框架**: Spring Boot 3.x, Spring Cloud, MyBatis-Plus
- **数据库**: MySQL/PostgreSQL, Druid 连接池
- **缓存**: Redis, Caffeine
- **搜索**: Elasticsearch
- **存储**: MinIO, 阿里云 OSS
- **文档**: OpenAPI 3.0, Swagger
- **构建**: Maven

## 文档

- Monorepo AI agent harness (repository root): `AGENTS.md`, `CLAUDE.md`
- [快速入门](docs/quick-start/README.md)
- [架构设计](docs/architecture/README.md)
- [API 文档](docs/api/README.md)
- [部署指南](docs/deployment/README.md)

## 贡献指南

我们欢迎所有形式的贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与项目。

## 安全

如果您发现安全问题，请按照 [SECURITY.md](SECURITY.md) 中的说明报告。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。

## 联系我们

- 📧 邮箱: contact@byclaw.ai
- 💬 讨论区: [GitHub Discussions](https://github.com/byclaw/byclaw-be/discussions)

---

<p align="center">Made with ❤️ by BeyondAI Team</p>

群历史 `context.messages[].attachments` 会合并普通消息附件与 `TASK_RESULT` 的 `metadata.files`。云盘附件包含 `fileName`、`filePath`、`cloudResourceId`，允许 `fileId` 为空；新发布会保存服务端校验后的云盘 ID，旧消息缺少该字段时从所属群项目补齐。项目不存在时仍返回文件名和路径，云盘 ID 为空。实时 `MESSAGE_CREATED` 同时返回 `attachments` 与兼容字段 `files`。

### 工作组邀请凭证接口

`GroupChatController` 提供以下接口（部署网关通常添加 `/byaiService` 前缀）：

- `POST /group-chats/{sessionId}/invitations`：已登录群主/管理员获取会话邀请；有效 token 复用并从当前时间续期 7 天，缺失或过期则新建；返回 `token`、`expiresAt`（毫秒）。
- `POST /group-chats/invitations/validate`：请求体 `{"token":"…"}`；允许匿名预览，返回工作组名称/号码、邀请人、企业、成员数量、最多四位 `memberPreviews`（`displayName`/`type`/`avatar`）、有效期、加入开关和当前成员状态。失败原因通过现有错误响应区分：`Invitation has expired`、`Invitation has been revoked`、`Group link joining is disabled`、`Group has been dissolved`；不包含原始 token。旧邀请码被替换后因不保留历史，只能报告无效。
- `POST /group-chats/invitations/join`：登录后提交 `{token}`，由服务端解析绑定群 ID，复用 `GroupChatApplicationService.acceptInvitation(sessionId, token)`，锁群后重新校验有效期、群状态、开关及邀请人角色/账户状态；不同企业的登录用户也可通过有效链接入群。返回成员信息，重复加入不重复写入。

凭证使用 SecureRandom 从大小写字母和数字共 62 个字符中逐位均匀选取，固定 8 位，默认有效期 7 天。V0.4.1 起持久化到 `message_share_link`：`link_type=GROUP_INVITATION`、`link_id=session_id`、`link_token` 保存原始邀请码，`creator_id`/`com_acct_id`/`expire_time` 保存邀请人、企业和有效期；一群一行，过期重建更新原行，不保留历史，不写消息关联表。
前端链接只使用 `/hacu/invite#token=…`，不得拼接展示资料或群 ID。创建和预览响应禁止缓存。邀请码不再依赖 Redis 或 RSA 配置，原 Redis 邀请不会自动迁移，上线后需重新获取。数据库中的原始邀请码属于访问凭证，避免输出到日志。
保留 `POST /group-chats/{sessionId}/members`，由 `GroupChatApplicationService.invite` 支持管理员直接添加真人或数字员工；请求体为 `{"type":"USER 或 AGENT","id":成员ID}`。
旧的 `/{sessionId}/invitation`（GET）、`/{sessionId}/join`（POST）、
`/join-by-number`（POST）、`/{sessionId}/join-requests`（GET）、`/{sessionId}/join-requests/me`（GET）
及 `/{sessionId}/join-requests/{requestId}/review`（POST）已移除（均在 `/group-chats` 下）。
群号申请/审批 service 方法及 DTO 同步删除。token 入群写操作由 `GroupChatApplicationService.acceptInvitation(sessionId, token)` 在凭证校验后执行，
不再调用旧 service；`GroupChatSettingsService` 仅保留群设置、昵称和解散能力，设置 DTO 移除群号加入开关及审批标记。
前端需同步更新并重新生成旧链接。历史申请数据不做清理或迁移，移除功能后不再读取。

`GroupChatInvitationService` 负责生成、预览、解析绑定群及凭证校验；接受邀请通过 `acceptInvitation` 与管理员 `invite` 共用内部 `insertMember` 写入方法，不在邀请 service 中重复实现。
邀请码在最后一次成功调用获取接口 7 天后逻辑过期（读取时检查 `expire_time`，不依赖自动清理）；预览、加入均不续期，成功加入不删除；关闭链接加入或邀请人权限失效时立即拒绝使用，但不主动删除记录。旧 43 位凭证不再接受，需重新生成。

同一会话的获取在群行锁与数据库事务内串行，邀请人保留首次签发者，复用时仍检查其当前权限。分享主表新增可空的 `link_type`，默认 `MESSAGE`，历史 NULL 按 MESSAGE 查询；消息分享仍使用原来的独立 link_id。主表查询、更新按类型隔离，表达式唯一索引以 `COALESCE(link_type, 'MESSAGE')` 分别约束 ID 和 token。

部署前先执行 `deploy/migrations/versions/V0.4.1/V0.4.1__ddl.sql`；若历史数据存在同类型重复 ID/token，唯一索引创建会失败，应先核查，迁移不自动删数据。此变更不修改 `deploy/middleware/initdb/`。避免新旧后端混跑：旧版本消息分享查询没有类型过滤，旧邀请服务仍读 Redis。

### 群消息任务归属字段

`POST /group-chats/{groupSessionId}/context` 的 `messages[]` 对 `TASK_RESULT` 和 `TASK_ACK` 消息返回
`initiatorUserId`（字符串），表示任务发起者的用户 ID，与 `taskId` 一样保留完整整数精度。
归属通过任务记录查询，并校验任务属于当前群；普通消息、任务不存在或引用无效时该字段为空，不从发言 Agent 或发布人推断。
实时任务消息 `MESSAGE_CREATED` 使用同名字符串字段。

前端处理 `kind="TASK_RESULT"` 时，只有 `initiatorUserId` 非空且等于当前登录用户 ID 的字符串形式才允许回复；
字段缺失或为空时禁用回复。此字段用于 UI 展示判断，BE 仍独立执行任务发起者校验。

历史文件导出会使用消息保存的成员名称快照，将 `{{DIG_EMPLOYEE_id}}` 和 `{{HUMAN_id}}` 转为 `@名称`（含群消息引用正文）。群消息读取 `metadata.resourceList`，任务用户消息优先读取 `related_resources.resourceList`，兼容 metadata 中的成员快照。无法还原名称的旧标记保留原文；数据库正文和原群历史接口保持不变。

### 群任务交付信号

任务交付提醒会要求 Agent 在 `/by/.sessions/{taskId}/.byclaw/task-delivery.json` 写入
`{"schemaVersion":"1","taskSessionId":"任务ID","delivered":true}`。同一子会话的有效信号跨轮次和 Agent 保留。
`GET /group-chat/tasks/{taskId}/delivery-status` 仅供仍在群内的任务发起人查询，返回字符串 taskId 和布尔 delivered。
无文件/无效协议返回 false，存储故障返回可重试错误；不增加数据库状态、不直接授权或触发发布。
前端进入、重连和每轮结束查询，按钮发送“确认完成并发布”，后续沿用现有发布卡片确认流程。

### 群成员批量添加

`POST /byaiService/group-chats/{sessionId}/members` 接受
`{"type":"AGENT","id":["20010807","20037876"]}`，真人成员使用 `type: "USER"`。
`id` 兼容旧客户端单值，响应 data 统一为成员数组。
空数组、空 ID 和非正整数不可提交；重复 ID 去重，已在群中的成员沿用拒绝规则。
整批成员、项目关系和使用授权在同一事务中完成，任一失败整批回滚，事件及缓存沿用提交后发布。

### 群聊 Agent 间 @ 调度

BE 仅在 CHAT 公开答复和任务最终发布的 `TASK_RESULT` 正文中解析 @ 并调度其他 Agent。
TASK 进行中的所有 turn（包括等待用户继续输入时的最终答复）都不触发 Agent 委派；正文中的 @ 及成员展示信息仍保留。
任务完成后的群内续聊沿用 `CHAT_CONTINUATION / CHAT`，允许继续 @ 调度，不重新打开原任务。

`TASK_RESULT` 使用确认发布的正文和群消息 ID 作为委派内容、触发 ID 与公开上下文边界，
保留原始任务 turn 的委派链和层数限制。成果消息的正文、`metadata.resourceList` 与实时事件保持一致。
发布与子委派登记共用事务；失败一起回滚，重复确认返回已有发布结果，不重复调度。


### Group topic message pagination

`GET /group-chats/{sessionId}/topics/{topicId}/messages?limit=20&cursor=...`
returns the normal response wrapper with `topicId`, `rootMessageId`, nullable
`rootMessage`, `messages`, `hasMore`, and nullable `nextCursor`. IDs are strings.
The current caller must be a group member and the topic must belong to that group.
The root is returned separately; replies include every branch with the same persisted
topic identity, ordered by `(createTime, messageId)` ascending. `limit` defaults to
20 and is clamped to 1–50. Message and reference projections reuse group history
visibility and resource handling.

Pass the opaque `nextCursor` unchanged to load subsequent replies. Cursors are scoped
to the group and topic and validated against their original visible message boundary.
If that boundary is no longer available, reload from the first page. This is a live
keyset view, not a cross-request snapshot. No exact reply count is returned. The
existing session/topic/time index supports the query; no schema migration is needed.
Sending remains the existing group send protocol with `replyToMessageId` set to the
root message ID. Deploy this endpoint before enabling the topic modal frontend.

### 新建群的默认数字员工

关联 [byclaw-hacu#6](https://github.com/beyonai/byclaw-hacu/issues/6)。
`GET /group-chats/default-assistant` 返回默认员工数组，每项包含 `resourceId`（字符串）、
`resourceName`、`resourceDesc`、`avatar`；无匹配时返回 `[]`。

`byai_system_config` 的 `param_code=BYAI_GROUP_WORK_ASSISTANT_NAME` 保持不变，`param_value`
兼容原有单个名称，也支持 JSON 名称数组，例如 `["群组工作助手","知识助手"]`。
配置缺失或空白时使用“群组工作助手”，`[]` 表示不配置默认员工。名称可按部署语言配置。
按配置顺序在平台范围内精确匹配已上架的组织级数字员工，不按当前企业过滤，排除数字员工组（017）。
每个名称返回全部匹配员工（按资源 ID 排序），最终按资源 ID 去重，不限制数量。

前端用查询结果回显各员工的名称、描述和头像；失败或结果为空时隐藏卡片，不影响创建。
`POST /group-chats` 通过 `agentIds` 数组提交回显的员工以及用户已选员工。
后端批量校验资源存在性，合并模板员工并去重后写入群成员，不再隐式追加默认助手。
创建响应 `members` 返回实际加入的员工，后续群详情沿用已有成员信息回显。
配置变更仅影响之后打开的创建页面。
