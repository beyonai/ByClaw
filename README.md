# ByClaw (鲸智百应)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

企业级 AI 应用平台，提供 Agent 管理、多轮对话、知识库（RAG）和工具编排能力。

> Policies: [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md). **AI agents:** [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md).

## 核心能力

- **AI 对话** — 多轮对话、流式响应、多模态交互
- **数字员工 (Agent)** — 可视化编排、工具调用、MCP 协议支持
- **知识库 (RAG)** — 文档解析、向量检索、智能问答
- **工具中心** — 自定义工具、代码沙箱、第三方集成
- **企业管理** — 多租户、RBAC 权限、组织架构

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Umi Max 4 + TypeScript 5 + Ant Design 5 |
| 后端 | Spring Boot 3.4 + Java 21 + Spring Cloud 2024 |
| AI 框架 | LangChain4j + Spring AI + MCP SDK |
| 数据云 | Python 3.12 + uv |
| 数据库 | PostgreSQL / OpenGauss |
| 缓存 | Redis (Jedis) |
| 消息 | Kafka |
| 存储 | MinIO / Aliyun OSS |
| 搜索 | Elasticsearch |

## 项目结构

| 目录 | 说明 | 技术 |
|------|------|------|
| `byclaw-fe/` | Web 前端 | React, Umi Max, TypeScript |
| `byclaw-be/` | 后端服务 | Spring Boot 3.4, Java 21 |
| `byclaw-data/` | 数据云服务（Agent 编排） | Python 3.12, uv |
| `byclaw-qa/` | QA 管理和 Agent 服务 | Python 3.12, uv |
| `byclaw-exe/` | 扩展插件和技能脚本 | Python, TypeScript |
| `deploy/` | 部署配置 | Docker Compose |
| `docs/` | 项目文档 | Markdown |
| `scripts/` | 自动化脚本 | Shell |
| `.github/` | CI/CD、模板 | GitHub Actions |

## 快速开始

### 环境要求

- Docker & Docker Compose V2
- Node.js >= 18.20.0, pnpm 9+
- JDK 21+, Maven 3.3.9+
- Python 3.12+, uv（可选）

### 一键部署

```bash
# 1. 克隆仓库
git clone <repo-url>
cd byclaw-all

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入数据库密码等配置

# 3. 启动中间件（Redis、MinIO、OpenGauss、OpenSandbox）
cd deploy/middleware && sh start-all.sh && cd ../..

# 4. 启动应用
cd deploy/standalone && docker compose up -d
```

访问 http://localhost:8080 开始使用。

### 本地开发

```bash
# 启动中间件
cd deploy/middleware && sh start-all.sh && cd ../..

# 启动后端
cd byclaw-be && mvn spring-boot:run

# 启动前端（新终端）
cd byclaw-fe && pnpm install && pnpm dev
```

前端 dev server 运行在 http://localhost:8000，自动代理 API 到后端。

### 统一启动脚本

```bash
./scripts/start.sh --all     # 启动所有模块
./scripts/start.sh --fe      # 仅前端
./scripts/start.sh --be      # 仅后端
./scripts/start.sh --qa      # QA 服务
./scripts/start.sh --data    # 数据云服务
```

## 端口说明

| 服务 | 默认端口 |
|------|---------|
| 前端 (Nginx) | 8080 |
| 后端 HTTP | 8086 |
| 后端 WebSocket | 8082 |
| QA Manager | 8000 |
| DataCloud | 8087 |
| Redis | 6379 |
| MinIO | 9000 (API) / 9001 (Console) |
| OpenGauss | 5432 |
| OpenSandbox | 9005 |

## 文档

详细文档请参考 [docs/](docs/) 目录：

- [快速开始](docs/quick-start/) — 最快速度跑起来
- [架构设计](docs/architecture/) — 系统架构和模块关系
- [开发指南](docs/development/) — 前端/后端/Python 开发规范
- [部署指南](docs/deployment/) — Docker 部署和配置
- [API 文档](docs/api/) — 接口说明和认证
- [用户指南](docs/guide/) — 功能使用说明
- [贡献指南](docs/contributing/) — 如何参与贡献

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)，scope 为模块名：

```
feat(fe): 新增对话历史搜索
fix(be): 修复分页边界问题
docs: 更新部署文档
```

详见 [.github/commit-convention.md](.github/commit-convention.md)。

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).

## License

[Apache License 2.0](LICENSE).
