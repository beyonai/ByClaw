# AOCI 渐进式加载索引

> 本索引用于指导 Agent 按需加载 AOCI 模块文件，避免一次性加载 0.8MB 完整索引带来的 token 浪费与上下文稀释。

---

## 系统速览

**ByClaw（鲸智百应）** — 企业级智能体组织操作系统，OpenClaw 企业增强版。

```
Nginx → byclaw-fe → byclaw-be(核心+统一安全网关)
                ↓
        {qa 知识/QA-Worker | data DataCloud/MCP-Worker | exe Skills/Ext}
                ↓
        OpenClaw/OpenSandbox → {OpenGauss | Redis | MinIO | 文件挂载 | 个人沙箱}
```

**服务规模：**

| 模块 | 技术栈 | 规模 |
|------|--------|------|
| byclaw-fe | React18 + UmiMax4 + TS + AntD5 | 134K / 1017 文件 |
| byclaw-be | Java21 + SpringBoot3.4 + Security + MyBatis | 135K / 2092 文件 |
| byclaw-exe | TS（Skills/Extension） | 30K / 158 文件 |
| data | Python3.12（DataCloud/MCP） | 9.8K / 44 文件 |
| qa | Python3.12（知识/QA Worker） | 4.8K / 21 文件 |

---

## 模块索引与加载策略

### 1. byclaw-fe — 前端交互层

- **文件：** `AOCI-byclaw-fe.md`（约 276KB，1766 行）
- **覆盖范围：** 页面、组件、Hook、Model、Service、工具、路由、配置
- **何时加载：**
  - 用户问"这个功能在前端哪里"
  - 涉及页面、组件、交互、表单、弹窗、表格
  - 需要理解用户操作入口和前端数据流
  - 关键词：`页面`、`组件`、`前端`、`交互`、`路由`、`model`、`service`
- **作用：** 通过前端代码理解用户如何操作，再反向定位后端 API

### 2. byclaw-be — 后端业务层

- **文件：** `AOCI-byclaw-be.md`（约 515KB，3261 行）
- **覆盖范围：** Controller、Service、Mapper、Entity、Feign、Config、Gateway、Sandbox
- **何时加载：**
  - 用户问"这个 API 怎么实现的"
  - 涉及业务逻辑、权限、会话、资源、数字员工、沙箱
  - 已从前端定位到 API，需要追踪后端链路
  - 关键词：`Controller`、`Service`、`API`、`后端`、`业务逻辑`、`数据库`、`事务`
- **作用：** 理解控制流、数据持久化、服务编排

### 3. byclaw-exe — 扩展与运行时层

- **文件：** `AOCI-byclaw-exe.md`（约 44KB，145 行）
- **覆盖范围：** OpenClaw 插件、Skill、Extension、Agent 运行时、Redis Pub/Sub
- **何时加载：**
  - 用户问"数字员工运行时怎么工作"
  - 涉及 OpenClaw 插件、skill、extension、agent 同步
  - 关键词：`skill`、`extension`、`agent`、`插件`、`运行时`、`baiying-enhance`
- **作用：** 理解 Agent 运行态、插件机制、工作区 seed/archive

### 4. deploy — 部署与数据层

- **文件：** 当前未单独拆分，仍散落于 `AOCI-byclaw-be.md` 与源码中
- **覆盖范围：** 数据库迁移脚本、Dockerfile、配置
- **何时加载：**
  - 用户问"表结构在哪里"
  - 涉及数据库迁移、部署、环境配置
  - 关键词：`migration`、`DDL`、`表结构`、`Dockerfile`、`部署`
- **作用：** 理解 schema 与部署形态

---

## Agent 决策流程

```
用户提问
  │
  ▼
是否涉及前端页面/组件/交互？
  ├── 是 → 加载 AOCI-byclaw-fe.md
  │         ↓
  │      定位前端 Service/API
  │         ↓
  │      需要后端实现？ → 加载 AOCI-byclaw-be.md
  │
  └── 否 → 是否涉及 Agent/插件/运行时？
            ├── 是 → 加载 AOCI-byclaw-exe.md
            │         ↓
            │      需要后端配合？ → 加载 AOCI-byclaw-be.md
            │
            └── 否 → 是否涉及 DB/部署？
                      ├── 是 → 直接读 deploy/migrations 源码
                      └── 否 → 加载 AOCI-byclaw-be.md（默认）
```

---

## 渐进式加载原则

1. **最小必要原则：** 只加载与问题最相关的模块索引
2. **前端优先原则：** 不确定时先读 fe，通过用户操作反推后端
3. **按需回退原则：** 单模块不足时，再加载关联模块
4. **源码优先原则：** AOCI 仅用于定位，理解细节必须读真实源码
5. **codegraph 接力原则：** 通过 AOCI 获得文件标签和关联关系后，使用 codegraph/文件读取工具深入源码

---

## 与 codegraph 的协作

AOCI 解决"**文件在哪里、文件是干什么的**"的问题；
codegraph 解决"**代码怎么实现、调用关系是什么**"的问题。

典型工作流：

1. 通过 AOCI 索引定位到目标文件（如 `byclaw-fe/src/pages/digitalEmployees/...`）
2. 读取该文件源码
3. 若涉及跨文件调用，使用 codegraph 追踪 import / feign / service 调用链
4. 必要时再回查 AOCI 其他模块索引

---

## 文件位置

所有 AOCI 拆分文件应与原始 `AOCI.md` 位于同一目录：

```
note/project/
├── AOCI.md              # 原始完整索引（已停用，仅备份）
├── AOCI-INDEX.md        # 本文件：加载决策索引
├── AOCI-byclaw-fe.md    # 前端模块索引
├── AOCI-byclaw-be.md    # 后端模块索引
└── AOCI-byclaw-exe.md   # 扩展模块索引
```

---

## 标签快速定位

AOCI 中每个文件条目使用 `文件名[标签]` 格式，如 `Editable.tsx[CC5FS]`。
在模块索引内搜索该标签，可快速跳转到对应条目，再基于 `R:` 关联字段展开阅读。
