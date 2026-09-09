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

Stream 长轮询使用独立的 `sessionStreamRedisConnectionFactory`，业务 RedisTemplate 继续使用主连接池。
单实例监听数由 `byclaw.session-stream.max-listeners` 控制（默认 128），独立读池容量为该值加 1。
启动和停止中的读取任务也占用名额，直到读取任务实际退出才释放；超过上限会拒绝新增监听，
由调用方报错或后续恢复轮次重试，避免挤占业务 Redis 连接。

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `byclaw.session-stream.max-listeners` | 128 | 单实例长轮询并发上限 |
| `byclaw.session-stream.batch-delay-millis` | 20 | 消费合并窗口；0 关闭合并 |
| `byclaw.session-stream.batch-queue-capacity` | 256 | 每个 listener 的待处理缓冲上限 |
| `byclaw.running-snapshot.write-behind-millis` | 50 | 主会话快照合并窗口 |

每次最多处理 100 条消息，只合并连续且属于同一子会话、同一轮次的增量，合并后生成一次完整快照。
每个 listener 最多缓存 256 条待处理消息，加一个最多 100 条的执行/重试批次；满时阻塞该会话的
读取任务。这是 listener 队列上限，不等于 PEL 上限；读取容器当前批次尚未交付的记录也已进入 PEL。
未生成持久化快照的消息保留在 Redis PEL，成功后才逐条 ACK。业务处理失败后每秒重试
失败的后缀，后续事件等待，避免结束事件越过未持久化的增量。关闭 listener 时未处理的缓冲消息仍在 PEL；已完成持久化的执行中批次继续 ACK，
避免 HTTP 结束事件先关闭监听而遗留已处理消息。关闭后 ACK 失败登记到恢复队列，不再启动本地重试。
合并能减少完整投影的构建和传输次数；单次完整快照成本仍随回答长度增长。

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
