# 模块关系说明

本文档详细说明 ByClaw 各模块的职责和相互关系。

## 模块总览

```
                    ┌─────────────┐
                    │   用户请求   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Nginx 网关  │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐       ┌─────▼─────┐      ┌────▼────┐
   │ 前端 FE │       │  后端 BE  │      │ 扩展 EX │
   └────┬────┘       └─────┬─────┘      └────┬────┘
        │                  │                 │
        │         ┌────────┴────────┐        │
        │         │                 │        │
        │    ┌────▼────┐      ┌────▼────┐   │
        │    │ 数据 DA │      │  QA 服务 │   │
        │    └────┬────┘      └────┬────┘   │
        │         │                 │        │
        └─────────┴─────────────────┴────────┘
                           │
                    ┌──────▼──────┐
                    │  基础设施层  │
                    │(DB/Redis/MinIO)
                    └─────────────┘
```

## 详细模块说明

### byclaw-fe (前端)

**职责：** 用户界面和交互

**技术：** React 18 + Umi Max 4 + TypeScript 5 + Ant Design 5

**功能：**
- AI 对话界面（流式响应、多模态）
- 知识库管理
- 数字员工配置与编排
- 管理后台（组织、权限、模型管理）
- 工作中心、技能中心、工具中心
- 移动端适配

**依赖：**
- → byclaw-be (REST API)
- → byclaw-be (WebSocket，通过 Netty 端口 8082)
- → MinIO (直接文件上传)

**端口：** 8080（部署）/ 8000（本地 dev server）

**特殊说明：**
- Ant Design 使用自定义前缀 `beyond`，所有 CSS 选择器为 `.beyond-*`
- 请求层使用 HMAC 签名机制
- 包管理器为 pnpm 9

---

### byclaw-be (后端)

**职责：** 核心业务逻辑和 API

**技术：** Spring Boot 3.4.5 + Java 21 + Spring Cloud 2024.0.1

**功能：**
- 用户认证授权（JWT + Spring Security + RBAC）
- 会话管理（Redis-backed Spring Session）
- AI 对话编排（LangChain4j + MCP）
- 知识库 API（RAG 检索）
- 数字员工 Agent 管理
- 文件管理（MinIO / SFTP）
- 系统配置与权限管理

**包结构（DDD 风格）：**

| 包 | 职责 |
|---|------|
| `com.iwhalecloud.byai.state` | 对话/聊天核心域（interfaces/controller, domain, application/service, infrastructure） |
| `com.iwhalecloud.byai.common` | 横切关注点（JWT, Feign, 加密, 存储, 日志, 国际化） |
| `com.iwhalecloud.byai.gateway` | API 网关路由、沙箱、渠道集成 |
| `com.iwhalecloud.byai.manager` | 管理面（用户、组织、模型、模板、权限） |

**依赖：**
- → PostgreSQL / OpenGauss (数据持久化，Druid 连接池)
- → Redis (缓存、会话、分布式锁、Pub/Sub)
- → MinIO / Aliyun OSS (文件存储)
- → Elasticsearch (全文检索)
- → Kafka (消息队列)
- → byclaw-data (Feign 调用)
- → byclaw-qa (Feign 调用)
- → OpenSandbox (代码沙箱执行)

**端口：** 8086 (HTTP) / 8082 (WebSocket/Netty)

**配置方式：** 外部 `config/application.properties`，通过 `${ENV_VAR:default}` 读取环境变量，无 YAML profiles。

---

### byclaw-exe (扩展插件)

**职责：** 技能脚本和扩展插件

**技术：** Python + TypeScript

**功能：**
- 自定义技能（skills/）
- 扩展插件（extensions/）
- 渠道集成脚本

**结构：**
```
byclaw-exe/
├── skills/          # 技能定义（Python）
│   └── byai-sqlite/
├── extensions/      # 扩展插件
│   ├── baiying-enhance/
│   ├── byai-channel/
│   └── byclaw-sqlite/
└── install.sh
```

**提供：**
- ← byclaw-be (调用扩展能力)

---

### byclaw-data (数据云服务)

**职责：** Agent 编排、数据处理

**技术：** Python 3.12 + uv

**功能：**
- Agent 编排（ReAct 模式，可配置最大轮次）
- 数据查询与分析
- Gateway Worker 模式

**依赖：**
- → PostgreSQL (数据存储)
- → MinIO (文件读取)
- → Redis (缓存)

**提供：**
- ← byclaw-be (Feign 调用)

**端口：** 8087

---

### byclaw-qa (QA 管理服务)

**职责：** Agent 管理和知识库服务

**技术：** Python 3.12 + uv

**功能：**
- Agent 数据管理
- 知识库缓存与检索
- QA Worker 异步任务

**依赖：**
- → PostgreSQL (数据存储)
- → MinIO (知识库文件)
- → Redis (缓存)

**提供：**
- ← byclaw-be (Feign 调用)

**端口：** 8000

## 模块间通信

### 同步调用

```
byclaw-fe ←──REST/WebSocket──→ byclaw-be
                                 │
                                 ├──Feign──→ byclaw-data (数据云)
                                 │
                                 ├──Feign──→ byclaw-qa (QA 服务)
                                 │
                                 └──Feign──→ OpenSandbox (代码沙箱)
```

### 异步消息

```
byclaw-be ──Pub/Sub──→ Redis ←──Sub── 各订阅方
byclaw-be ──Produce──→ Kafka ←──Consume── 消费方
```

### 数据流

```
用户上传文件
    │
    ▼
byclaw-fe ──→ byclaw-be ──→ MinIO (存储)
    │              │
    │              ▼
    │         PostgreSQL (元数据)
    │              │
    │              ▼
    │         byclaw-qa (异步处理)
    │              │
    │              ▼
    │         PostgreSQL (向量数据)
    │
    ▼
用户查询
    │
    ▼
byclaw-be ──→ RAG 检索 ──→ 返回结果
```

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| byclaw-fe | 8080 | 前端（Nginx） |
| byclaw-be | 8086 | 后端 HTTP API |
| byclaw-be | 8082 | 后端 WebSocket (Netty) |
| byclaw-data | 8087 | 数据云服务 |
| byclaw-qa | 8000 | QA 管理服务 |
| OpenSandbox | 9005 | 代码沙箱 |
| PostgreSQL | 5432 | 数据库 |
| Redis | 6379 | 缓存 |
| MinIO | 9000 | 对象存储 API |
| MinIO | 9001 | 对象存储控制台 |

## 开发关系

### 独立开发

各模块可以独立开发、独立测试：

```bash
# 仅开发前端
cd byclaw-fe && pnpm dev

# 仅开发后端
cd byclaw-be && mvn spring-boot:run

# 仅开发数据云
cd byclaw-data && uv run python -m byclaw_data.main
```

### 集成开发

使用 Docker Compose 启动依赖服务：

```bash
cd deploy/middleware
docker compose up -d
```

然后启动正在开发的模块即可。

### 统一启动

```bash
# 启动所有模块
./scripts/start.sh --all

# 启动前端
./scripts/start.sh --fe

# 启动后端
./scripts/start.sh --be
```
