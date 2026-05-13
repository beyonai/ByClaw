# ByClaw-BE

> BeyondAI 后端服务 - 企业级 AI 应用平台

[![CI](https://github.com/byclaw/byclaw-be/actions/workflows/ci.yml/badge.svg)](https://github.com/byclaw/byclaw-be/actions)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Java](https://img.shields.io/badge/Java-17%2B-orange)](https://openjdk.org/)
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

### 环境要求

- Java 17+
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
