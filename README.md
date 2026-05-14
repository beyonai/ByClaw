# 🐋 ByClaw — 企业级 AI 操作系统

<p align="center">
  <strong>鲸智百应 · 重塑人机协作，驱动组织进化</strong>
</p>

<p align="center">
  <a href="https://github.com/beyonai/ByClaw/actions"><img src="https://img.shields.io/github/actions/workflow/status/beyonai/ByClaw/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/beyonai/ByClaw/releases"><img src="https://img.shields.io/github/v/release/beyonai/ByClaw?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=for-the-badge" alt="Apache 2.0 License"></a>
  <a href="https://github.com/beyonai/ByClaw/stargazers"><img src="https://img.shields.io/github/stars/beyonai/ByClaw?style=for-the-badge" alt="Stars"></a>
</p>

**ByClaw** 是一个开源的企业级 AI 操作系统，让 AI 从"外部工具"变成组织的**原生能力**。部署数字员工、编排多智能体工作流、将 AI 接入每一个业务系统——无需改写任何一行遗留代码。

就像 Windows 之于 PC、iOS 之于 iPhone——ByClaw 统一管理企业所有的数字员工、知识库和工具集成。

[核心亮点](#核心亮点) · [架构总览](#架构总览) · [快速开始](#快速开始) · [痛点与方案](#痛点与解决方案) · [参与贡献](CONTRIBUTING.md) · [安全策略](SECURITY.md)

---

## 为什么选择 ByClaw？

大多数企业 AI 项目失败，不是因为模型不行，而是组织无法跨越"AI 演示"到"AI 规模化生产"之间的鸿沟。ByClaw 用一个生产级操作系统层来解决这个问题。

| 痛点 | ByClaw 的解法 |
|------|--------------|
| AI 不懂业务语境，幻觉率 50-70% | 业务本体 + 结构化知识锚点 → 准确率 95%+ |
| 长时间 Agent 任务崩溃丢失状态 | 异步事件驱动调度 + 断点恢复 |
| MCP/工具爆炸撑爆上下文窗口 | **百应-Call** 渐进式加载——千级能力，恒定上下文 |
| 遗留系统没有 API、没有文档、找不到原开发者 | **ByUI** 多模态视觉操作——100% 系统覆盖 |
| AI 安全是事后补丁 | 五层治理骨架，架构内建，出厂即安全 |
| 多租户隔离成本高 | 用户图谱 + 按需沙箱池 → 单员工计算成本降低 70% |

---

## 核心亮点

- **数字员工** — 可视化创建、部署和管理 AI Agent。每个 Agent 拥有岗位说明书（JD），自动约束其行为边界（JD 逆向校验）。
- **多智能体协作** — Agent 之间通过事件驱动异步工作流协调。控制流与数据流分离，无论任务多复杂，Token 消耗恒定。
- **百应-Call** — 智能反向代理，将数千个 MCP/Skill 能力压缩到恒定级别的上下文。多智能体生产级运行的"中枢神经系统"。
- **知识库 (RAG)** — 10+ 数据源采集、异构文档统一转换（PDF/Word/PPT/图片/音视频 → Markdown）、双知识图谱、结构化锚点增强。
- **工具中心** — MCP 协议支持、自定义工具、代码沙箱、第三方集成。一次定义，同时输出 MCP Server / Skill / Plugin / Function。
- **企业治理** — 多租户 RBAC、HMAC 请求签名、全链路审计、零信任架构。"你的权限就是 AI 的边界。"

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                          交互层                                      │
│          Web UI · 移动端 · API · 微信 · 钉钉 · 飞书                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    ByClaw（开源 MVP）                                 │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐  │
│  │   网关层     │  │  Agent 内核  │  │  百应-Call  │  │  治理骨架  │  │
│  │  (路由/鉴权) │  │  (编排/调度)  │  │ (能力加载)  │  │  (五层安全) │  │
│  └─────────────┘  └──────────────┘  └────────────┘  └───────────┘  │
└──────────┬──────────────────┬──────────────────┬────────────────────┘
           │                  │                  │
┌──────────▼───┐  ┌──────────▼───┐  ┌───────────▼──┐
│  ByDataCloud │  │     ByKg     │  │    ByExe     │
│   数据中枢    │  │   知识中枢    │  │   执行中枢    │
│              │  │              │  │              │
│ • 业务本体   │  │ • 双知识图谱  │  │ • Function   │
│ • 联邦查询   │  │ • X2MD 引擎  │  │   Cloud      │
│ • 零 ETL    │  │ • 结构化锚点  │  │ • ByUI       │
│              │  │ • 复利飞轮   │  │ • MCP/Skill  │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 四大模块

| 模块 | 定位 | 开源状态 |
|------|------|:--------:|
| **ByClaw** | Agent 执行框架 + 多租户运行时 + 治理骨架 | ✅ 全部开源 |
| **ByDataCloud** | 企业数据中枢——业务本体、数据虚拟化、联邦查询 | 推理引擎 ✅ |
| **ByKg** | 知识中枢——双图谱、复利飞轮、结构化锚点 | 推理引擎 ✅ |
| **ByExe** | 执行中枢——遗留系统 AI 化、ByUI 视觉操作 | ByUI ✅ |

---

## 痛点与解决方案

<details>
<summary><strong>CEO：这不会又是一个做完 PoC 就没下文的项目吧？</strong></summary>

ByClaw 采用"复利飞轮"模型：每个数字员工的经验沉淀为组织知识资产，越用越聪明。3 年复合价值 300+。不是一次性投入，而是持续增值的 AI 资产。
</details>

<details>
<summary><strong>CFO：ROI 怎么算？</strong></summary>

每个数字员工有"数字薪资"，可量化对比人力成本。实测单员工 AI 辅助成本降低 70%。AgentPool 弹性沙箱池按需分配，空闲即回收。
</details>

<details>
<summary><strong>CIO：安全合规能过审吗？</strong></summary>

五层治理骨架（接入层→协调层→执行层→状态层→资源层）内建安全，不是事后补丁。零信任架构 + 全链路审计 + 权限继承引擎。支持全栈国产化适配（鲲鹏/飞腾/海光/昇腾 + 麒麟/统信/openEuler）。
</details>

<details>
<summary><strong>员工：AI 会取代我吗？</strong></summary>

ByClaw 的定位是"武装员工"而非"替代员工"。每人 1 个超级助手 + N 个自建个人助手 + M 个公司雇佣的数字员工。人机协作，不是人机对抗。
</details>

<details>
<summary><strong>开发者：又要重写所有系统对接？</strong></summary>

ByExe 执行中枢的核心原则："AI 适配 IT，而非 IT 重建适配 AI"。有 API 的系统用 Function Cloud 智能标注；没有 API 的系统用 ByUI 多模态视觉操作。30 年数字化投资，一次性激活。
</details>

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Umi Max 4 + TypeScript 5 + Ant Design 5 |
| 后端 | Spring Boot 3.4 + Java 21 + Spring Cloud 2024 + Spring Security 6 |
| AI 框架 | LangChain4j + Spring AI + MCP SDK |
| 数据/QA | Python 3.12+ + uv |
| 数据库 | PostgreSQL / OpenGauss |
| 缓存 | Redis（Spring Session） |
| 消息队列 | Kafka |
| 对象存储 | MinIO / 阿里云 OSS / SFTP |
| 搜索引擎 | Elasticsearch |
| 基础设施 | Docker Compose, GitHub Actions CI/CD |

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
# 编辑 .env，填入数据库密码、Redis 地址等

# 3. 启动中间件（Redis、MinIO、OpenGauss、Sandbox）
cd deploy/middleware && sh start-all.sh && cd ../..

# 4. 启动应用
cd deploy/standalone && docker compose up -d
```

访问 **http://localhost:8080** 开始使用。

### 本地开发

```bash
# 启动中间件
cd deploy/middleware && sh start-all.sh && cd ../..

# 方式一：统一脚本（推荐）
./scripts/start.sh --all

# 方式二：按模块启动
./scripts/start.sh --fe      # 前端 :8000
./scripts/start.sh --be      # 后端 :8086
./scripts/start.sh --qa      # QA 服务
./scripts/start.sh --data    # 数据云服务

# 停止服务
./scripts/stop.sh            # 停止全部
./scripts/stop.sh --fe       # 仅停止前端
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

## 路线图

- [x] ByClaw 开源 MVP（Agent 编排 + 治理骨架 + 多租户运行时）
- [x] 百应-Call 渐进式能力加载
- [x] 多渠道接入（Web、移动端、API）
- [ ] ByUI 开源（遗留系统视觉操作）
- [ ] ByDataCloud 推理引擎开源
- [ ] ByKg 推理引擎开源
- [ ] 插件市场
- [ ] 多语言国际化（英文 UI）
- [ ] Kubernetes Helm Charts

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
