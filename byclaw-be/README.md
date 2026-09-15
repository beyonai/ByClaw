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

## 核心特性

- **微服务架构** - 基于 Spring Cloud 的分布式架构
- **高性能** - 支持高并发对话和流式响应
- **可扩展** - 插件化设计，易于扩展新功能
- **多模型支持** - 支持多种大语言模型接入
- **企业级安全** - 完整的认证、授权和审计机制

## 群聊引用续聊与自动协作

- 用户非引用 `@` 创建新的协作链；引用群消息或 Agent 之间 `@` 时，在该链中复用目标助理的子会话。每个助理保留自己的 session，首次参与时创建；重复消息只登记一次 turn。
- 每轮输入保存原始用户需求、本次实际发送者类型/ID/名称、接收者以及本次完整正文；Agent 委派传入其最终回复，资源列表同时保留背景和当前正文中的成员引用。
- 上述完整上下文只保存在 turn 调度快照中。子会话消息正文及普通聊天请求只保留“本次消息”的原文；首次执行、内部分类和普通追问均在 Gateway 出站时追加上下文，Agent 仍可读取原始需求、参与者和已发布成果。此调整适用于新写入的消息，不自动改写历史消息。
- `byai_group_chat_turn` 持久化逐轮身份、输入、分类、trace 和队列状态。同一 session 串行执行，不同 session 并行；自动 Agent 调用每条分支最多 6 跳，用户新消息重新开始自动计数，重试和等待不增加次数。
- 未完成任务（`ACTIVE`，包括 `WAITING_USER`）不接受群引用或 Agent 自动续接，排队消息执行前也会重新检查。进入任务子会话仍可按原有流程处理任务。
- 引用已完成任务时，内部分类会话先判断本次请求；普通追问继续原会话，新任务创建独立 session 并携带旧公开上下文，旧任务和发布记录不重新打开。内部分类不产生用户事件，不能从普通历史、运行快照或文件列表入口访问。
- 新表迁移位于 `deploy/migrations/versions/V0.4.1/V0.4.1__ddl.sql`，启动新版后端前须执行对应迁移。既有 execution 保留为会话入口和旧记录恢复依据，不重放已完成历史调用。
- 后端重启可恢复领取后尚未绑定 trace 的 turn，事务锁和 trace 条件更新防止重复发送。确定发生在 Gateway 路由前的准备失败会结束该 turn；已绑定 trace 且送达情况未知的请求不盲目重发，因此异常远端调用可能继续占用队列，需沿原运行恢复流程处理。

## 群聊上传附件

- `GROUP_CHAT_SEND` 的 `files` 与正文一同保存到消息的 `relatedResources.files`，并随 `MESSAGE_CREATED` 广播返回。仅附件消息和正文带附件消息均支持发送确认后的展示及历史加载。
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
- 初次群聊任务和 `ACTIVE` 任务子会话续聊通过 Gateway 追加统一交付提醒：Agent 在本轮交付可检查的新产物或修改版本后，温馨提醒用户检查，确认无误后可让 Agent 帮忙发布到群里。普通问答、未交付、失败、等待补充信息及已进入发布确认时不提醒；内部分类和已结束任务的追问不追加此提示。提醒不授权自动发布，也不改变现有确认流程。
- 群聊候选子会话从首个 turn 起复用 `ScriptService → RouteService → SessionStreamManager`，由普通聊天链路维护 Redis running/runtime、running snapshot、WebSocket 增量和完整消息落库。没有发起端 WebSocket 连接也能运行；用户在执行中进入或刷新任务会话时，普通聊天页加载快照后继续接收更新。
- 一条群消息引用多个数字员工时，各员工使用独立的子会话、trace 和回答消息 ID。首条消息完整保留 `resourceList` 供展示，子会话成员统计只计入实际执行的目标员工，BE 重启恢复后仍保持这一约束。
- 群聊观察器只负责读取 disposition 文件、提前提升 TASK、发送群内回执，以及从已落库的最终答案投影 CHAT 回复；不再独立消费或 ACK 子会话 Stream。初始投影失败可由持久化 execution 补偿，运行超过十分钟不会自动重新发送 Gateway 请求。
- 当前没有可靠的远端执行租约，因此不对“运行中但长时间没有结果”的任务盲目重发。若投递结果不确定或远端失联，应先核实 Gateway/Agent 状态；用户可取消异常任务。此修复不会自动恢复此前已经误标为 `SUCCEEDED` 的记录。
- Gateway 事件身份校验、流式聚合和恢复使用普通聊天链路。群聊完成投影按子会话和 trace 关联，并以已落库的回答为依据。结束事件已被看到不代表持久化及完成回调已成功；只有成功标记才允许重投时直接 ACK，避免失败回调被跳过。

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
- `POST /group-chats/invitations/validate`：请求体 `{"token":"…"}`；允许匿名预览，返回工作组名称/号码、邀请人、企业、成员数量、最多四位 `memberPreviews`（`displayName`/`type`/`avatar`）、有效期、加入开关和当前成员状态。
- `POST /group-chats/invitations/join`：登录后提交 `{token}`，由服务端解析绑定群 ID，复用 `GroupChatApplicationService.acceptInvitation(sessionId, token)`，锁群后重新校验有效期、群状态、开关、邀请人角色/账户状态及企业限制；返回成员信息，重复加入不重复写入。

凭证使用 SecureRandom 从大小写字母和数字共 62 个字符中逐位均匀选取，固定 8 位，默认有效期 7 天；Redis 保存会话索引、SHA-256 摘要键及群、邀请人、企业、过期时间、RSA 加密后的 token，不保存 token 明文，无需数据库迁移。
前端链接只使用 `/hacu/invite#token=…`，不得拼接展示资料或群 ID。创建和预览响应禁止缓存。Redis 记录丢失时邀请失效；生产 Redis 持久化策略由部署环境保障。
保留 `POST /group-chats/{sessionId}/members`，由 `GroupChatApplicationService.invite` 支持管理员直接添加真人或数字员工；请求体为 `{"type":"USER 或 AGENT","id":成员ID}`。
旧的 `/{sessionId}/invitation`（GET）、`/{sessionId}/join`（POST）、
`/join-by-number`（POST）、`/{sessionId}/join-requests`（GET）、`/{sessionId}/join-requests/me`（GET）
及 `/{sessionId}/join-requests/{requestId}/review`（POST）已移除（均在 `/group-chats` 下）。
群号申请/审批 service 方法及 DTO 同步删除。token 入群写操作由 `GroupChatApplicationService.acceptInvitation(sessionId, token)` 在凭证校验后执行，
不再调用旧 service；`GroupChatSettingsService` 仅保留群设置、昵称和解散能力，设置 DTO 移除群号加入开关及审批标记。
前端需同步更新并重新生成旧链接。历史申请数据不做清理或迁移，移除功能后不再读取。

`GroupChatInvitationService` 负责生成、预览、解析绑定群及凭证校验；接受邀请通过 `acceptInvitation` 与管理员 `invite` 共用内部 `insertMember` 写入方法，不在邀请 service 中重复实现。
Redis 邀请记录与会话索引在最后一次成功调用获取接口 7 天后自动过期；预览、加入均不续期，成功加入不删除；关闭链接加入或邀请人权限失效时立即拒绝使用，但不主动删除记录。旧 43 位凭证不再接受，需重新生成。

同一会话的获取在群行锁内串行，Lua 原子写入摘要记录与会话索引，两个 Redis 键共用 `{invitations}` hash tag。邀请人保留首次签发者，复用时仍检查其当前权限。加密复用 `RsaEncrypt` / `RsaDecrypt` 和现有 `byclaw.rsa.modules`、`byclaw.rsa.public-key`、`byclaw.rsa.private-key`；所有实例须使用一致的公私钥，轮换密钥前应处理旧邀请记录。新会话绑定使用独立 Redis 命名空间，上线前生成的无会话索引旧链接需重新获取，不迁移存量数据。
