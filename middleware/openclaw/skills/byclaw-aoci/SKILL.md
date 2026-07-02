---
name: byclaw-aoci
description: |
  This skill provides a code index (AOCI) for navigating and analyzing the ByClaw (鲸智百应) enterprise Agent OS project.
  It should be used when the user asks to locate, analyze, or understand code within the byclaw codebase,
  including questions like "这个功能在哪里实现", "这个 API 怎么工作", "前端页面在哪个文件",
  "帮我分析一下数字员工的代码逻辑", "沙箱模块在哪", or any request involving byclaw/byai project code.
  Keywords: byclaw, 鲸智百应, byai, 代码定位, AOCI, 功能在哪, 代码分析, 查代码, 项目结构
agent_created: true
---

# ByClaw AOCI — 代码渐进式加载索引

## 概述

AOCI（渐进式代码索引）将 ByClaw 项目的全量代码索引按模块拆分为多个文件，支持按需加载，避免一次性加载全部索引带来的 token 浪费。

系统架构:
```
Nginx → byclaw-fe → byclaw-be(核心+统一安全网关)
               ↓
       {qa 知识/QA-Worker | data DataCloud/MCP-Worker | exe Skills/Ext}
               ↓
       OpenClaw/OpenSandbox → {OpenGauss | Redis | MinIO | 文件挂载 | 个人沙箱}
```

## 文件路径

所有 AOCI 文件作为 references 内置于 skill 目录下:
```
references/
├── AOCI-INDEX.md         # 加载策略与决策树
├── AOCI-byclaw-fe.md     # 前端模块索引
├── AOCI-byclaw-be.md     # 后端模块索引
├── AOCI-byclaw-exe.md    # 扩展模块索引
├── AOCI-deploy.md        # 部署模块索引
├── AOCI-byclaw-kgw.md    # 网关模块索引
├── AOCI-byclaw-qa.md     # QA 模块索引
└── AOCI-byclaw-supper.md # Supper 模块索引
```

| 文件 | 规模 | 覆盖范围 |
|------|------|----------|
| `AOCI-INDEX.md` | ~5KB | 加载策略与决策树 |
| `AOCI-byclaw-fe.md` | ~276KB | 前端：页面、组件、Hook、Model、Service、路由、配置 |
| `AOCI-byclaw-be.md` | ~515KB | 后端：Controller、Service、Mapper、Entity、Feign、Config、Gateway、Sandbox |
| `AOCI-byclaw-exe.md` | ~44KB | 扩展：OpenClaw 插件、Skill、Extension、Agent 运行时 |
| `AOCI-deploy.md` | ~4KB | 部署：数据库迁移、Docker、中间件配置 |
| `AOCI-byclaw-kgw.md` | <1KB | 网关模块（空壳仓库） |
| `AOCI-byclaw-qa.md` | ~4KB | QA 知识库 Worker |
| `AOCI-byclaw-supper.md` | <1KB | Supper 模块（空壳仓库） |

## 工作流程

### Step 1: 加载 INDEX

首先读取 `references/AOCI-INDEX.md`，理解模块结构和服务规模。INDEX 中包含:
- 系统架构图和服务技术栈概览
- 每个模块的覆盖范围和加载触发条件
- Agent 决策流程（前端优先 → 按需回退）
- 渐进式加载原则

### Step 2: 分析用户意图

根据用户问题，确定需要加载哪些模块。判断逻辑:

1. **涉及前端页面/组件/交互？** → 加载 `AOCI-byclaw-fe.md`
   - 关键词: `页面`, `组件`, `前端`, `交互`, `路由`, `model`, `service`, `弹窗`, `表单`, `表格`
   - 定位到前端文件后，可继续追问后端实现

2. **涉及后端 API/业务逻辑？** → 加载 `AOCI-byclaw-be.md`
   - 关键词: `Controller`, `Service`, `API`, `后端`, `业务逻辑`, `数据库`, `事务`, `权限`, `沙箱`
   - 理解控制流、数据持久化、服务编排

3. **涉及 Agent/插件/运行时？** → 加载 `AOCI-byclaw-exe.md`
   - 关键词: `skill`, `extension`, `agent`, `插件`, `运行时`, `baiying-enhance`, `数字员工`
   - 理解 Agent 运行态、插件机制、工作区管理

4. **涉及数据库/部署？** → 加载 `AOCI-deploy.md`
   - 关键词: `migration`, `DDL`, `表结构`, `Dockerfile`, `部署`, `中间件`, `配置`

5. **涉及 QA/知识库 Worker？** → 加载 `AOCI-byclaw-qa.md`
   - 关键词: `QA`, `知识库`, `问答`, `知识管理`

6. **涉及网关/API 路由？** → 加载 `AOCI-byclaw-kgw.md`

### Step 3: 按需加载模块

使用 Read 工具加载对应的 AOCI 模块文件。每个模块文件包含:
- 目录结构索引（以 `===path/===` 为节标题）
- 每个文件的标签（如 `File.tsx[TAG]`）、功能描述(`F:`)、关联关系(`R:`)、辅助信息(`A:`)、摘要(`S:`)

注意:
- `byclaw-be` 和 `byclaw-fe` 文件较大，确认需要时才加载
- 可先加载一个小模块验证方向，再决定是否需要更大模块
- 不确定时优先加载 `byclaw-fe`，通过前端操作反推后端

### Step 4: 定位并追踪代码

使用 AOCI 索引定位到目标文件后:
1. 通过文件标签（如 `[CC5FS]`）在索引中快速查找
2. 通过 `R:` 关联字段追踪上下游关系
3. 定位到具体文件路径后，使用 Read 工具读取真实源码
4. 需要跨文件追踪时，使用 codegraph 工具追踪 import/feign/service 调用链

### 核心原则

1. **最小必要:** 只加载与问题最相关的模块
2. **前端优先:** 不确定时先读 fe，通过用户操作反推后端
3. **按需回退:** 单模块不足时，再加载关联模块
4. **源码优先:** AOCI 仅用于定位文件，理解细节必须读真实源码
5. **标签跳转:** 使用 `[TAG]` 标签快速定位和关联查找
