# 企业 AI 转型"最后一公里"终于有解了！ByClaw 开源：数字员工 + 多智能体 + 零信任安全，一套打通

> Apache 2.0 全开源 · Java 21 + Python 3.12 + React 18 全栈 · 5 步 Docker 一键部署 · 从单 Agent PoC 到千人组织生产落地

---

90% 的企业 AI 转型卡在同一个地方：演示很精彩，生产跑不起来。

概念很火，试点很美——一碰核心数据、一要规模化、一进生产环境，立刻撞上四堵墙：**不敢用、不会用、接不通、算不清**。

BeyondAI 出了一套完整答案：**ByClaw（鲸智百应）**——企业级智能体组织操作系统，Apache 2.0 完全开源。

## 🏆 核心数据一览

| 维度 | ByClaw 的答案 |
|------|--------------|
| 项目定位 | 企业级智能体组织操作系统（OpenClaw 企业增强版）|
| 核心业务对象 | 数字员工 · 会话 · 长程任务 · 知识 · 工具 · 对象 · 视图 |
| 后端技术栈 | Java 21 · Spring Boot 3.4 · Spring Security · MyBatis |
| 前端技术栈 | React 18 · Ant Design 5 · TypeScript · Umi Max 4 |
| AI 接入层 | Spring AI · LangChain4j · MCP · OpenClaw |
| Python 执行层 | by-qa · by-datacloud · Skills / Workers |
| 前端功能页面 | 22+ 独立业务页面（对话/知识/工具/技能/沙箱/数据云…）|
| 部署方式 | Docker Compose 一键拉起 · 中间件与应用分层部署 |
| 许可证 | Apache 2.0 |

**三个一句话核心价值：**

- **CEO 敢拍板**：可视化数字员工管理，业务人员直接配置授权 AI，无需持续依赖技术团队
- **CIO 敢签字**：零信任安全网关 + 个人沙箱隔离 + 全链路审计，每条 AI 执行记录有迹可查
- **CFO 敢算账**：单实例多租户运行时，沙箱按需拉起用完自动释放，算力不空转

---

## 🤔 它到底干了什么？

ByClaw 把"智能体"从个人玩具变成了**组织生产力**。

它在开源智能体内核 OpenClaw 之上叠加了企业生产环境缺的那一层——多租户隔离、统一安全网关、合规沙箱、长程任务引擎、动态算力管理。不需要为每个业务线单独搭 AI 基础设施，一套 ByClaw 支撑整个组织。

BeyondAI 的必赢公式里，ByClaw 给出了"可信技术底座"这一块的完整答案：

> **可持续竞争力 = AI 原生思维 × 智能体组织架构 × 人机共生文化 × 可信技术底座**

---

## 🏗️ 怎么做到的？

### 五模块全栈闭环

按职责拆成五个清晰模块，各司其职：

| 模块 | 技术栈 | 核心职责 |
|------|--------|---------|
| `byclaw-fe` | React 18 · Ant Design 5 · TypeScript · Umi Max 4 | 门户 / 对话 / 数字员工 / 知识 / 工具 / 沙箱 / 管理后台 |
| `byclaw-be` | Java 21 · Spring Boot 3.4 · Spring Security · MyBatis | 核心 API · 认证授权 · 资源治理 · WebSocket/SSE 流式会话 |
| `byclaw-qa` | Python 3.12 · by-qa · uv | 知识库管理 · RAG 检索 · QA Worker · 文档索引 |
| `byclaw-data` | Python 3.12 · by-datacloud · MCP | DataCloud 数据云 · 数据分析 · MCP 工具调用 · 结果文件存储 |
| `byclaw-exe` | TypeScript · OpenClaw Plugin | 技能脚本 · 扩展插件 · 业务能力扩展 |

### 架构四原则

```
统一接入 → 集中治理 → 分布执行 → 资源隔离
```

用户从 Web、钉钉、移动端任何入口进来，经 Nginx 接入 → byclaw-be 安全网关认证授权 → 任务分发给 DataCloud / QA / OpenSandbox 执行。控制流由后端集中编排，数据流按类型分别进数据库、对象存储、缓存、沙箱。

### 数据架构：五类数据各归其位

| 数据类型 | 存储位置 | 说明 |
|---------|---------|------|
| 业务元数据（用户/组织/权限/数字员工） | OpenGauss / PostgreSQL | 结构化可查询可审计 |
| 热状态（会话/锁/配置快照/消息通道） | Redis | 低延迟 · Pub/Sub · Stream |
| 知识文件 / 结果文件 / 附件 | MinIO / OSS / SFTP | 对象存储 · 按需加载 |
| 向量与检索数据 | QA / DataCloud 服务内 | RAG 知识切片 · 检索召回 |
| 个人执行数据 | 独立沙箱空间 | 按用户隔离挂载 · 数随人走 |

---

## 🧪 五大核心功能解析

### ① 数字员工——给 AI 一个"岗位"

ByClaw 最核心的业务对象不是"AI 对话框"，而是有明确岗位、明确资源权限、明确执行策略的**数字员工**：

| 配置项 | 说明 |
|--------|------|
| 岗位职责 / 提示词 | 定义 AI 的角色和工作边界 |
| 模型策略 | 绑定大模型，支持热切换不重启 |
| 知识资源 | 绑定业务知识库，按需 RAG |
| 工具资源 | 绑定业务 API / MCP 工具 |
| 授权范围 | 可见 / 可用 / 可执行三层权限控制 |

HR、法务、财务、客服各有各的"AI 同事"，各自访问各自授权范围内的数据。

### ② 多智能体协作——长程任务不掉链

两个核心技术让多 Agent 协作跑得稳：

**异步事件驱动**：主 Agent 接任务后，通过 Redis Stream / Pub/Sub 把子任务分发给专属 Sub-Agent，结果异步回传，不阻塞主会话。

**控制流与数据流分离**：控制逻辑（谁做什么、按什么顺序）由后端集中编排；数据（文件、结果、知识）走独立的对象存储/沙箱通道，两者互不耦合。

### ③ 智能反向代理——MCP 爆上下文问题解决了

多个 MCP 工具同时挂载时，上下文窗口会被工具描述撑爆——这是多智能体生产落地的隐形杀手。

ByClaw 的**智能反向代理**把 N 个 MCP/Skill 能力压缩到恒定级别的上下文占用，让工具数量不再是上下文瓶颈。

### ④ 安全架构——零信任 + 零端口暴露

```
用户身份认证（JWT/Session/AccessToken）
    → 统一安全网关（签名校验 · 会话校验 · 路由控制）
    → 授权（组织 · 岗位 · 角色 · 权限组）
    → 数字员工执行
    → 个人沙箱（独立 · 租约 · 自动释放）
    → 数据隔离（按用户挂载 · 数随人走）
    → 全链路审计（日志 · 任务状态 · 资源变更）
```

**关键设计：零端口暴露** —— 沙箱容器内的 Agent 进程不向外暴露任何服务端口，所有结果通过 Redis 异步消息通道回传给后端，再由后端 WebSocket/SSE 推送前端。攻击面大幅收窄。

### ⑤ 模型热切换——换模型不重启

在平台上给数字员工换个大模型，Agent 不需要重启。

`baiying-enhance` 插件监听 Redis Pub/Sub，检测到变更事件后自动 diff → 热写 OpenClaw 配置 → 通知已存在的 Session 更新模型绑定。正在生成的对话回合不中断，下一条消息从新模型生效。

---

## 🚀 快速上手

### 环境要求

| 工具 | 版本要求 | 检查命令 |
|------|---------|---------|
| Docker & Compose V2 | 最新版 | `docker compose version` |
| Node.js | ≥ 18.20 | `node --version` |
| pnpm | ≥ 9.x | `pnpm --version` |
| JDK | 21 | `java -version` |
| Maven | ≥ 3.8 | `mvn --version` |
| Python | ≥ 3.12 | `python3 --version` |
| uv | 任意版本 | `uv --version` |

### 5 步 Docker 一键部署

```bash
# 1. 克隆仓库
git clone https://github.com/beyonai/ByClaw.git && cd ByClaw

# 2. 配置环境变量（填写 DB / Redis / MinIO 地址）
cp .env.example .env

# 3. 拉取中间件镜像（首次部署需要）
(cd deploy/middleware && sh pull.sh)

# 4. 启动中间件（Redis、MinIO、OpenGauss、Sandbox）
(cd deploy/middleware && sh start-all.sh)

# 5. 启动全部应用
(cd deploy/standalone && docker compose up -d)
```

访问 **http://localhost:8080** 即可开始使用。

### 按模块灵活启动（开发调试）

```bash
scripts/start.sh --all      # 全部启动
scripts/start.sh --fe       # 仅前端 :8000
scripts/start.sh --be       # 仅后端 :8086
scripts/start.sh --qa       # 仅 QA 知识问答服务
scripts/start.sh --data     # 仅数据云服务
```

启动脚本内置**环境预检**——自动验证所有工具版本，缺什么报什么，不让你猜为什么启动不了。

### 服务端口一览

| 服务 | 端口 |
|------|:----:|
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

## 🎯 谁该用？场景对照表

| 你的场景 | ByClaw 能给你什么 |
|---------|----------------|
| 有 AI 试点，想推进生产落地 | 完整多租户安全隔离 + 审计链路，让合规说得过去 |
| 想给不同部门配不同 AI 助手 | 数字员工 + 权限组体系，各部门各自管理 |
| 复杂业务需要多个 Agent 协作 | 异步事件驱动 + 控制/数据流分离，长程任务不掉链 |
| 担心 AI 执行泄露内部数据 | 零信任网关 + 个人沙箱 + 零端口暴露，三重隔离 |
| 已有 MCP 工具生态要集成 | DataCloud MCP + 智能上下文压缩，无缝接入 |
| 需要 AI 读企业内部知识库 | byclaw-qa 提供完整 RAG 链路：索引 → 检索 → 问答 |
| 合规要求严格需要全审计 | 日志 · 任务状态 · 会话记录 · 资源变更全部落地 |

---

## 总结

ByClaw 解决的不是"AI 够不够聪明"的问题，而是"企业敢不敢用、能不能用、用了管不管得住"的问题。

Apache 2.0 开源，可私有化部署，五模块架构清晰，这是一个真正为生产环境设计的企业级智能体底座。

管 AI 员工像管真员工，权限管控、审计追踪、沙箱隔离一个不少——这才是企业 AI 转型"最后一公里"的正确打开方式。

---

**项目地址**：https://github.com/beyonai/ByClaw

**许可证**：Apache License 2.0

**出品方**：BeyondAI · 站在未来，看见今天

---

*觉得有用？点赞转发让更多人看到 💪*
