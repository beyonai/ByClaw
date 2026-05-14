# <img src="byclaw-fe/public/favicon.svg" width="24" height="24"> ByClaw — 企业级智能体执行框架

<p align="center">
  <strong>鲸智百应 · 重塑人机协作，驱动组织进化</strong>
</p>

<p align="center">
  <a href="https://github.com/beyonai/ByClaw/actions"><img src="https://img.shields.io/github/actions/workflow/status/beyonai/ByClaw/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/beyonai/ByClaw/releases"><img src="https://img.shields.io/github/v/release/beyonai/ByClaw?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=for-the-badge" alt="Apache 2.0 License"></a>
  <a href="https://github.com/beyonai/ByClaw/stargazers"><img src="https://img.shields.io/github/stars/beyonai/ByClaw?style=for-the-badge" alt="Stars"></a>
</p>

<p align="center">
  <strong>中文</strong> | <a href="README_EN.md">English</a>
</p>

90% 的企业在智能体转型中卡在"最后一公里"——概念很火、试点很美，但一规模化、一进生产、一碰核心数据，就遇到四大死结：**不敢用、不会用、接不通、算不清**。

我们总结了智能体组织的必赢公式：

> **可持续竞争力 = AI 原生思维 × 智能体组织架构 × 人机共生文化 × 可信技术底座**

四者缺一不可。没有安全可控、可规模化、可沉淀的技术底座，所有智能体转型都只能停留在演示阶段。

**ByClaw（鲸智百应）** 就是为解决这个问题而生——企业级智能体组织操作系统，支撑新质生产力的可信 AI 底座。它是 OpenClaw 的"企业增强版"，在开源智能体内核之上叠加了企业生产环境所需的核心能力：多租户隔离、统一安全网关、合规沙箱、长程任务支持、动态算力分配与释放。从一个 Agent 的 PoC 到千人组织的全面落地，ByClaw 提供完整的技术底座——**让企业敢部署、CEO 敢拍板、CIO 敢签字、CFO 敢算账**。

[核心亮点](#核心亮点) · [架构总览](#架构总览) · [快速开始](#快速开始) · [痛点与方案](#痛点与解决方案) · [参与贡献](CONTRIBUTING.md) · [安全策略](SECURITY.md)

---

## 核心亮点

- **数字员工** — 可视化创建、部署和管理超级助手、个人助理、数字员工，它们拥有明确的岗位职责
- **多智能体协作** — 通过异步事件、控制流与数据流分离两种核心技术：实现多智能体之间的协作，控制流与数据流分离，解决多智能体参与的长程任务碰到的问题
- **智能反向代理** — 将多个 MCP/Skill 能力压缩到恒定级别的上下文，多智能体生产级运行的"中枢神经系统"
- **多租户运行时** — 单实例统一部署、统一管理，支撑整个组织
- **统一安全网关** — 身份认证、会话管控、零信任访问

---

## 架构总览

```
                    web / 钉钉 / 更多接入方式
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  第 1 层：接入层                                                  │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  统一接入  · websocket · 钉钉 · sse                               │
│  统一控制  · 认证 · 鉴权 · 路由                                    │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  第 2 层：协同层                                                  │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  意图感知 · 智能编排                                               │
│  异步调度（事件驱动、控制流与数据流分离、龙虾端口零暴露）                  │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  第 3 层：执行层                                                  │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  超级助手 · 个人助理 · 数字员工                                     │
│  Skill 渐进式加载                                                 │
│  BaiYing-call（业务资源按需加载、零敏感数据存储）                      │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  第 4 层：状态层                                                  │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  ★ 聊天会话                                                      │
│  ★ 个人记忆                                                      │
│  ★ 全局资源（业务工具、业务对象、业务视图、业务知识）                    │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  第 5 层：基础资源调度层                                            │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  每个员工独立沙箱环境 · 按需申请，用完释放                             │
│  每个员工独立数据空间 · 数随人走，多智能体共享                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 环境要求

| 工具 | 版本要求 | 验证命令 |
|------|---------|---------|
| Docker & Compose V2 | 最新版 | `docker compose version` |
| Node.js | >= 18.20 | `node --version` |
| pnpm | >= 9.x | `pnpm --version` |
| JDK | 21 | `java -version` |
| Maven | >= 3.8 | `mvn --version` |
| Python | >= 3.12 | `python3 --version` |
| uv | 任意版本 | `uv --version` |

### Docker 一键部署

```bash
# 1. 克隆仓库
git clone https://github.com/beyonai/ByClaw.git
cd ByClaw

# 2. 配置环境变量
cp .env.example .env
# ⚠️ 重要：.env.example 中所有地址默认为 127.0.0.1，
#    你需要根据 deploy/middleware 中各中间件实际暴露的端口，
#    逐项回填 DB_URL、DB_USER、DB_PASS、REDIS_HOST、REDIS_PORT、
#    REDIS_PASSWORD、MID_FTP_* 等配置。
#    如果中间件部署在远程机器，请替换为对应 IP。

# 3. 启动中间件（Redis、MinIO、OpenGauss、Sandbox）
cd deploy/middleware && sh start-all.sh && cd ../..

# 4. 启动应用
cd deploy/standalone && docker compose up -d
```

访问 **http://localhost:8080** 开始使用。

### 本地开发

本地开发同样需要先配置 `.env` 文件（步骤与上方 Docker 部署一致）。

中间件可以部署在本地，也可以部署在远程服务器——只需在 `.env` 中将 `127.0.0.1` 替换为远程服务器的 IP 和端口即可。

```bash
# 1. 配置环境变量（同上，必须先完成）
cp .env.example .env
# 根据中间件实际地址回填 DB_URL、REDIS_HOST 等

# 2. 启动中间件（本地部署时执行，远程部署则跳过此步）
cd deploy/middleware && sh start-all.sh && cd ../..

# 3. 启动应用（推荐统一脚本）
scripts/start.sh --all

# 按模块启动
scripts/start.sh --fe      # 前端 :8000
scripts/start.sh --be      # 后端 :8086
scripts/start.sh --qa      # QA 服务
scripts/start.sh --data    # 数据云服务

# 停止服务
scripts/stop.sh            # 停止全部
scripts/stop.sh --fe       # 仅停止前端
```

启动脚本会自动执行**环境预检**——校验所有工具、版本和依赖是否就绪，有问题会立即报错并给出修复建议。使用 `--skip-checks` 可跳过预检。

前端开发服务器运行在 http://localhost:8000，自动代理 API 请求到后端。

---

## 项目结构

```
ByClaw/
├── byclaw-fe/          # Web 前端（React, Umi Max, TypeScript）
├── byclaw-be/          # 后端服务（Spring Boot 3.4, Java 21）
├── byclaw-data/        # 数据云服务（Python 3.12, uv）
├── byclaw-qa/          # QA 与 Agent 服务（Python 3.12, uv）
├── byclaw-exe/         # 扩展插件与技能脚本
├── deploy/             # Docker Compose 部署配置
├── docs/               # 项目文档
├── scripts/            # 开发自动化脚本（start/stop/deploy）
└── .github/            # CI/CD 工作流与模板
```

---

## 端口说明

| 服务 | 默认端口 |
|------|:--------:|
| 前端（Nginx） | 8080 |
| 后端 HTTP | 8086 |
| 后端 WebSocket | 8082 |
| QA Manager | 8000 |
| DataCloud | 8087 |
| Redis | 6379 |
| MinIO API / Console | 9000 / 9001 |
| OpenGauss | 5432 |
| OpenSandbox | 9005 |

---

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)，scope 为模块名：

```
feat(fe): 新增对话历史搜索
fix(be): 修复分页边界问题
docs: 更新部署文档
```

详见 [.github/commit-convention.md](.github/commit-convention.md)。

---

## 参与贡献

欢迎参与！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解贡献流程。

使用 [Pull Request 模板](.github/PULL_REQUEST_TEMPLATE.md) 提交 PR。

---

## 社区

- [GitHub Issues](https://github.com/beyonai/ByClaw/issues) — Bug 反馈与功能建议
- [GitHub Discussions](https://github.com/beyonai/ByClaw/discussions) — 问题讨论与想法交流
- [安全策略](SECURITY.md) — 漏洞负责任披露

---

## 许可证

[Apache License 2.0](LICENSE)

---

<p align="center">
  <sub>由 <a href="https://github.com/beyonai">BeyondAI</a> 构建 · 站在未来，看见今天。</sub>
</p>
